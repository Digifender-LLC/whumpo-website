import {acceptsCustomerEligibility,customerEligibilityMessage} from './content-policy';
import { generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse, type AuthenticationResponseJSON, type RegistrationResponseJSON } from '@simplewebauthn/server';
import { hashToken, newSessionToken } from './security';

type User = { id: string; email: string };
type Challenge = { challenge: string; kind: 'signup' | 'login' | 'add'; user_id: string; email: string; invite_hash: string };
export class AuthError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
function rp(request: Request, env: Env) {
  // Wrangler rewrites route/origin headers locally; bind WebAuthn to the browser's explicit dev origin.
  const origin = String(env.ENVIRONMENT) === 'local' ? 'http://localhost:8787' : 'https://whumpo.com';
  const url = new URL(origin);
  if (String(env.ENVIRONMENT) === 'local' && !['localhost', '127.0.0.1'].includes(url.hostname)) throw new AuthError(400, 'Use localhost for passkey development');
  return { origin, rpID: url.hostname };
}
function challengeCookie(token: string, request: Request) {
  return `tellumo_challenge=${token}; HttpOnly; SameSite=Strict; Path=/api/auth; Max-Age=300${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
}
async function remember(env: Env, request: Request, challenge: string, kind: Challenge['kind'], user?: User, inviteHash = '') {
  const token = newSessionToken(), now = new Date().toISOString();
  const previous = request.headers.get('cookie')?.match(/(?:^|;\s*)tellumo_challenge=([0-9a-f]{64})(?:;|$)/)?.[1];
  await env.DB.batch([
    env.DB.prepare('DELETE FROM auth_challenges WHERE expires_at <= ? OR token_hash = ?').bind(now, previous ? await hashToken(previous) : ''),
    env.DB.prepare('INSERT INTO auth_challenges (token_hash, challenge, kind, user_id, email, invite_hash, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(await hashToken(token), challenge, kind, user?.id || '', user?.email || '', inviteHash, new Date(Date.now() + 300000).toISOString())
  ]);
  return challengeCookie(token, request);
}
async function consume(env: Env, request: Request, kind: Challenge['kind']) {
  const token = request.headers.get('cookie')?.match(/(?:^|;\s*)tellumo_challenge=([0-9a-f]{64})(?:;|$)/)?.[1];
  if (!token) throw new AuthError(400, 'Start passkey verification again');
  // Consume before verification so malformed assertions and simultaneous replays cannot reuse it.
  const challenge = await env.DB.prepare('DELETE FROM auth_challenges WHERE token_hash = ? AND kind = ? AND expires_at > ? RETURNING challenge, kind, user_id, email, invite_hash').bind(await hashToken(token), kind, new Date().toISOString()).first<Challenge>();
  if (!challenge) throw new AuthError(400, 'Passkey request expired or was already used. Start again.');
  return challenge;
}
async function invitation(env: Env, request: Request, data: Record<string, unknown>) {
  if (String(env.ENVIRONMENT) !== 'local' && !acceptsCustomerEligibility(data)) throw new AuthError(403, customerEligibilityMessage);
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AuthError(400, 'Enter a valid email');
  const inviteHash = typeof data.inviteCode === 'string' ? await hashToken(data.inviteCode.trim()) : '';
  if (String(env.ENVIRONMENT) !== 'local') {
    const invite = await env.DB.prepare('SELECT code_hash FROM invitations WHERE code_hash = ? AND used_by IS NULL AND expires_at > ?').bind(inviteHash, new Date().toISOString()).first();
    if (!invite) throw new AuthError(403, 'A valid unused invitation is required');
    if (!env.TURNSTILE_SECRET) throw new AuthError(503, 'Registration is not configured');
    if (typeof data.turnstileToken !== 'string') throw new AuthError(400, 'Verification required');
    const check = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: data.turnstileToken, remoteip: request.headers.get('cf-connecting-ip') }), signal: AbortSignal.timeout(10000) });
    const result = await check.json<{ success: boolean; hostname?: string; action?: string }>();
    if (!result.success || result.hostname !== 'whumpo.com' || result.action !== 'register') throw new AuthError(400, 'Verification failed. Please try again.');
  }
  if (await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first()) throw new AuthError(409, 'An account with this email already exists. Sign in to add a passkey.');
  return { user: { id: crypto.randomUUID(), email }, inviteHash };
}

export async function passkeyOptions(request: Request, env: Env, kind: Challenge['kind'], data: Record<string, unknown>, signedIn: User | null) {
  const { rpID } = rp(request, env);
  if (kind === 'login') {
    const options = await generateAuthenticationOptions({ rpID, userVerification: 'required' });
    return { options, cookie: await remember(env, request, options.challenge, kind) };
  }
  if (kind === 'add' && !signedIn) throw new AuthError(401, 'Sign in again before adding a passkey');
  const { user, inviteHash } = kind === 'signup' ? await invitation(env, request, data) : { user: signedIn!, inviteHash: '' };
  const { results } = await env.DB.prepare('SELECT id FROM passkeys WHERE user_id = ?').bind(user.id).all<{ id: string }>();
  if (results.length >= 10) throw new AuthError(409, 'You can save up to ten passkeys');
  const options = await generateRegistrationOptions({ rpName: 'Whumpo', rpID, userName: user.email, userID: new Uint8Array(new TextEncoder().encode(user.id)), attestationType: 'none', excludeCredentials: results.map(key => ({ id: key.id })), supportedAlgorithmIDs: [-7, -257], authenticatorSelection: { residentKey: 'required', userVerification: 'required' } });
  return { options, cookie: await remember(env, request, options.challenge, kind, user, inviteHash) };
}

export async function passkeyVerify(request: Request, env: Env, kind: Challenge['kind'], data: Record<string, unknown>, signedIn: User | null): Promise<{ user: User; recoveryCode?: string; credentialId?: string }> {
  if (kind === 'signup' && String(env.ENVIRONMENT) !== 'local' && !acceptsCustomerEligibility(data)) throw new AuthError(403, customerEligibilityMessage);
  const challenge = await consume(env, request, kind);
  const { origin, rpID } = rp(request, env);
  if (kind === 'add' && (!signedIn || signedIn.id !== challenge.user_id)) throw new AuthError(401, 'Sign in again before adding a passkey');
  if (kind === 'login') {
    const response = data.credential as AuthenticationResponseJSON;
    const key = typeof response?.id === 'string' ? await env.DB.prepare('SELECT passkeys.*, users.email FROM passkeys JOIN users ON users.id = passkeys.user_id WHERE passkeys.id = ?').bind(response.id).first<{ id: string; user_id: string; email: string; public_key: string; counter: number }>() : null;
    if (!key || response.response?.userHandle !== base64(new TextEncoder().encode(key.user_id))) throw new AuthError(401, 'Passkey verification failed');
    let result;
    try { result = await verifyAuthenticationResponse({ response, expectedChallenge: challenge.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true, credential: { id: key.id, publicKey: decode(key.public_key), counter: key.counter } }); }
    catch { throw new AuthError(401, 'Passkey verification failed'); }
    if (!result.verified) throw new AuthError(401, 'Passkey verification failed');
    const changed = await env.DB.prepare('UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ? AND counter = ?').bind(result.authenticationInfo.newCounter, new Date().toISOString(), key.id, key.counter).run();
    if (changed.meta.changes !== 1) throw new AuthError(409, 'Passkey changed during sign-in. Try again.');
    return { user: { id: key.user_id, email: key.email }, credentialId: key.id };
  }
  let verified;
  try { verified = await verifyRegistrationResponse({ response: data.credential as RegistrationResponseJSON, expectedChallenge: challenge.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true, supportedAlgorithmIDs: [-7, -257] }); }
  catch { throw new AuthError(400, 'Passkey verification failed. Please start again.'); }
  if (!verified.verified) throw new AuthError(400, 'Passkey verification failed');
  const credential = verified.registrationInfo.credential;
  const now = new Date().toISOString(), user = { id: challenge.user_id, email: challenge.email };
  const recoveryCode = kind === 'signup' ? newSessionToken() : undefined;
  const statements: D1PreparedStatement[] = [];
  if (kind === 'signup') {
    const sql = "INSERT INTO users (id, email, password_salt, password_hash, created_at) SELECT ?, ?, ?, 'passkey-only', ?";
    const args = [user.id, user.email, '00'.repeat(16), now];
    statements.push(String(env.ENVIRONMENT) === 'local' ? env.DB.prepare(sql).bind(...args) : env.DB.prepare(sql + ' FROM invitations WHERE code_hash = ? AND used_by IS NULL AND expires_at > ?').bind(...args, challenge.invite_hash, now));
    statements.push(env.DB.prepare('UPDATE invitations SET used_by = ? WHERE code_hash = ? AND used_by IS NULL AND EXISTS (SELECT 1 FROM users WHERE id = ?)').bind(user.id, challenge.invite_hash, user.id));
    statements.push(env.DB.prepare('INSERT INTO recovery_codes (user_id, code_hash, created_at) SELECT id, ?, ? FROM users WHERE id = ?').bind(await hashToken(recoveryCode!), now, user.id));
  }
  const name = typeof data.name === 'string' && data.name.trim() ? data.name.trim().slice(0, 80) : 'My passkey';
  const session = request.headers.get('cookie')?.match(/(?:^|;\s*)tellumo_session=([0-9a-f]{64})(?:;|$)/)?.[1];
  const sessionGuard = kind === 'add' ? ' AND EXISTS (SELECT 1 FROM sessions WHERE user_id = users.id AND token_hash = ? AND expires_at > ? AND created_at > ?)' : '';
  statements.push(env.DB.prepare(`INSERT INTO passkeys (id, user_id, public_key, counter, name, created_at) SELECT ?, id, ?, ?, ?, ? FROM users WHERE id = ?${sessionGuard}`)
    .bind(credential.id, base64(credential.publicKey), credential.counter, name, now, user.id, ...(kind === 'add' ? [session ? await hashToken(session) : '', now, new Date(Date.now() - 600000).toISOString()] : [])));
  statements.push(env.DB.prepare("INSERT INTO activity_events (id, user_id, action, summary, created_at) SELECT ?, user_id, 'passkey.added', 'Passkey added', ? FROM passkeys WHERE id = ? AND user_id = ?").bind(crypto.randomUUID(), now, credential.id, user.id));
  try {
    const result = await env.DB.batch(statements);
    if (result[kind === 'signup' ? 3 : 0].meta.changes !== 1) throw new AuthError(kind === 'add' ? 401 : 403, kind === 'add' ? 'Session changed. Sign in again before adding a passkey.' : 'Invitation expired or was already used. Please start again.');
  } catch (cause) {
    if (cause instanceof AuthError) throw cause;
    if (/UNIQUE|quota/.test(String(cause))) throw new AuthError(409, 'This account or passkey already exists, or the test account limit has been reached.');
    throw cause;
  }
  return { user, recoveryCode };
}

async function recoveryIdentity(env: Env, data: Record<string, unknown>) {
  const email = typeof data.email === 'string' ? data.email.trim().toLowerCase() : '';
  const code = typeof data.code === 'string' ? data.code.trim() : '';
  if (!/^[0-9a-f]{64}$/.test(code)) throw new AuthError(401, 'Invalid email or recovery code');
  const user = await env.DB.prepare('SELECT users.id, users.email FROM users JOIN recovery_codes ON users.id = recovery_codes.user_id WHERE email = ? AND code_hash = ?').bind(email, await hashToken(code)).first<User>();
  if (!user) throw new AuthError(401, 'Invalid email or recovery code');
  return { user, code };
}

export async function recoveryPasskeys(env: Env, data: Record<string, unknown>) {
  const { user } = await recoveryIdentity(env, data);
  const { results } = await env.DB.prepare('SELECT id, name, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at, id').bind(user.id).all<{ id: string; name: string; created_at: string; last_used_at: string | null }>();
  return { passkeys: results };
}

export async function recoverAccount(env: Env, data: Record<string, unknown>) {
  const { user, code } = await recoveryIdentity(env, data);
  const nonce = data.nonce;
  if (typeof nonce !== 'string' || !/^[0-9a-f]{64}$/.test(nonce)) throw new AuthError(400, 'Save a new recovery code before continuing');
  const choice = data.lostPasskeys;
  if (!choice || typeof choice !== 'object' || Array.isArray(choice)) throw new AuthError(400, 'Choose which passkeys were lost');
  const selection = choice as Record<string, unknown>;
  if (!['all', 'some', 'none'].includes(String(selection.mode))) throw new AuthError(400, 'Choose all, some, or none of your passkeys');
  const ids = selection.ids;
  if (!Array.isArray(ids) || ids.length > 10 || ids.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,1024}$/.test(id)) || new Set(ids).size !== ids.length) throw new AuthError(400, 'Choose valid passkeys');
  if (selection.mode === 'some' ? ids.length === 0 : ids.length !== 0) throw new AuthError(400, 'Choose valid passkeys');
  const replacement = await hashToken(`whumpo-owner-recovery-v1|${code}|${nonce}`);
  const oldHash = await hashToken(code), newHash = await hashToken(replacement), now = new Date().toISOString();
  const selected = selection.mode === 'some' ? ids as string[] : [];
  const selectedCheck = selected.length ? ` AND (SELECT COUNT(*) FROM passkeys WHERE user_id = ? AND id IN (${selected.map(() => '?').join(',')})) = ?` : '';
  const update = env.DB.prepare(`UPDATE recovery_codes SET code_hash = ?, created_at = ? WHERE user_id = ? AND code_hash = ?${selectedCheck}`)
    .bind(newHash, now, user.id, oldHash, ...(selected.length ? [user.id, ...selected, selected.length] : []));
  // Only this attempt's successful rotation may admit cleanup. A deterministic
  // replacement hash alone also matches a competing attempt using the same nonce.
  const receiptId = crypto.randomUUID();
  const admitted = "EXISTS (SELECT 1 FROM activity_events WHERE id = ? AND user_id = ? AND action = 'account.recovered')";
  const revoked = selection.mode === 'none' ? null : selection.mode === 'all'
    ? env.DB.prepare(`DELETE FROM passkeys WHERE user_id = ? AND ${admitted}`).bind(user.id, receiptId, user.id)
    : env.DB.prepare(`DELETE FROM passkeys WHERE user_id = ? AND id IN (${selected.map(() => '?').join(',')}) AND ${admitted}`)
      .bind(user.id, ...selected, receiptId, user.id);
  const results = await env.DB.batch([
    update,
    env.DB.prepare("INSERT INTO activity_events (id, user_id, action, summary, created_at) SELECT ?, user_id, 'account.recovered', ?, ? FROM recovery_codes WHERE user_id = ? AND code_hash = ? AND changes() = 1")
      .bind(receiptId, `Account recovered; previous sessions signed out; ${selection.mode === 'all' ? 'all' : selection.mode === 'none' ? 'no' : selected.length} passkeys removed`, now, user.id, newHash),
    ...(revoked ? [revoked] : []),
    env.DB.prepare(`DELETE FROM sessions WHERE user_id = ? AND ${admitted}`).bind(user.id, receiptId, user.id)
  ]);
  if (results[0].meta.changes !== 1 || results[1].meta.changes !== 1) throw new AuthError(409, 'Recovery code or selected passkeys changed. Start again.');
  if (selection.mode === 'some' && results[2].meta.changes !== selected.length) throw new AuthError(409, 'Selected passkeys changed. Start again.');
  return { user, recoveryCode: replacement };
}
