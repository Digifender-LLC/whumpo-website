import {listCMS,readCMSReview,prepareCMS,confirmCMS,CMSProjectError} from './cms-projects';
import {readBackendState,readBackendReview,prepareBackendState,confirmBackendState,backendStateHistory,exportBackendState,restoreBackendState} from './backend-state';
import {BackendError,listBackends,saveBackend,testBackend} from './backend-versions';
import {readDirectory,directoryHistory,exportDirectory,DirectoryError} from './directory';
import {HealthError,listHealth,checkHealth,maintainHealth} from './site-health';
import {DiffError,compareVersions,compareReview,diffPage} from './version-diff';
import {contactPage} from './contact-page';
import {ContactError,contactInbox,deleteContact,cleanupContacts} from './contacts';
import {listDNSActions,reviewTXT,reviewCNAME,confirmDNS} from './cloudflare-dns';
import {cloudflareConfig,cloudflareStatus,startCloudflare,cancelCloudflare,finishCloudflare,disconnectCloudflare,cloudflareZones,cleanupCloudflare} from './cloudflare-connection';
import {hostingConfig,hostingConnections,reviewHosting,confirmHosting,refreshHosting,disconnectHosting,maintainHosting} from './domain-hosting';
import {githubRepositories,listBackups,reviewBackup,confirmBackup} from './github-backups';
import {ConnectionError,githubConfig,startGitHub,cancelGitHub,finishGitHub,disconnectGitHub,connectionStatus,cleanupGitHub,githubInstallations} from './github-connection';
import {DomainError,listDomains} from './domains';
import { ownedPreview } from './photo-versions';
import { StorageLimitError } from './storage-budget';
import { FileError, uploadPhoto, listPhotos, readPhoto, cleanupPhotos } from './files';
import { ownedExport } from './exports';
import { checkoutEnabled, createCheckout, stripeWebhook } from './checkout';
import { componentCatalog, previewHeaders } from './components';
import { hashPassword, hashToken, newSessionToken, verifyPassword } from "./security";
import { plans, creditPack } from "./plans";
import { readChat, sendChat } from "./chat";
import { AuthError, passkeyOptions, passkeyVerify, recoverAccount } from "./passkeys";
import { BillingError, getBilling, setOverage } from "./billing";
import { configuredAI } from "./ai-chat";

type User = { id: string; email: string };
type Project = { id: string; name: string; purpose: string; status: string; created_at: string; updated_at: string };
const sessionDays = 7;
const jsonHeaders = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy":"no-referrer" };

function json(data: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...jsonHeaders, ...headers } });
}
function error(status: number, message: string): Response { return json({ error: message }, status); }
function cookie(token: string, request: Request): string {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `tellumo_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${sessionDays * 86400}${secure}`;
}
function clearCookie(request: Request): string { return cookie("", request).replace(/Max-Age=\d+/, "Max-Age=0"); }
function sessionToken(request: Request): string | null {
  const value = request.headers.get("cookie")?.match(/(?:^|;\s*)tellumo_session=([0-9a-f]{64})(?:;|$)/);
  return value?.[1] ?? null;
}
async function body(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return null;
  if (Number(request.headers.get("content-length") ?? 0) > 16_384) return null;
  try {
    const reader = request.body?.getReader();
    if (!reader) return null;
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 16_384) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const raw = new TextDecoder().decode(bytes);
    const data: unknown = JSON.parse(raw);
    return data !== null && typeof data === "object" && !Array.isArray(data) ? data as Record<string, unknown> : null;
  } catch { return null; }
}
function localMode(request: Request, env: Env): boolean {
  return String(env.ENVIRONMENT) === "local";
}
function passwordPepper(request: Request, env: Env): string {
  return localMode(request, env) ? "local-development-only-pepper-not-for-production" : env.PASSWORD_PEPPER ?? "";
}
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  return origin !== null && origin === new URL(request.url).origin;
}
async function currentUser(request: Request, env: Env): Promise<User | null> {
  const token = sessionToken(request);
  if (!token) return null;
  return env.DB.prepare("SELECT users.id, users.email FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?")
    .bind(await hashToken(token), new Date().toISOString()).first<User>();
}
async function recentSession(request: Request, env: Env): Promise<boolean> {
  const token = sessionToken(request);
  if (!token) return false;
  const session = await env.DB.prepare("SELECT token_hash FROM sessions WHERE token_hash = ? AND expires_at > ? AND created_at > ?").bind(await hashToken(token), new Date().toISOString(), new Date(Date.now() - 600000).toISOString()).first();
  return !!session;
}
async function issueSession(request: Request, env: Env, user: User, recoveryCode?: string): Promise<Response> {
  const token = newSessionToken();
  const now = new Date();
  const expiry = new Date(now.getTime() + sessionDays * 86400_000).toISOString();
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
    .bind(await hashToken(token), user.id, expiry, now.toISOString()).run();
  return json({ user, ...(recoveryCode ? { recoveryCode } : {}) }, 200, { "set-cookie": cookie(token, request) });
}
async function handle(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);
  const method = request.method;
  if (method === "GET" && pathname === "/api/health") return json({ status: "ok" });
  if (method === "GET" && pathname === "/api/config") return json({ inviteRequired: !localMode(request, env), turnstileSiteKey: localMode(request, env) ? null : env.TURNSTILE_SITE_KEY });
  if (method === "POST" && pathname === "/api/stripe/webhook") return json(await stripeWebhook(request, env.DB, env));
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && !sameOrigin(request)) return error(403, "Origin check failed");
  const ip = request.headers.get("cf-connecting-ip") || "local";
  if (!(await env.API_LIMITER.limit({ key: ip })).success) return error(429, "Too many requests. Try again in a minute.");
  if (method === "GET" && pathname === "/api/plans") return json({ plans, creditPack, currency: "USD", draft: true, checkoutEnabled: checkoutEnabled(env), checkoutMode: "test", subscriptionsEnabled: false });
  if (method === "POST" && pathname.startsWith("/api/auth/") && pathname !== "/api/auth/logout") {
    if (!(await env.AUTH_LIMITER.limit({ key: ip })).success) return error(429, "Too many sign-in attempts. Try again in a minute.");
  }

  const passkeyRoute = pathname.match(/^\/api\/auth\/passkeys\/(signup|login|add)\/(options|verify)$/);
  if (method === "POST" && passkeyRoute) {
    const data = await body(request);
    if (!data) return error(400, "A JSON request is required");
    const kind = passkeyRoute[1] as "signup" | "login" | "add";
    const signedIn = await currentUser(request, env);
    if (kind === "add" && !(await recentSession(request, env))) return error(401, "Sign in again before adding a passkey");
    if (passkeyRoute[2] === "options") {
      const result = await passkeyOptions(request, env, kind, data, signedIn);
      return json({ options: result.options }, 200, { "set-cookie": result.cookie });
    }
    const result = await passkeyVerify(request, env, kind, data, signedIn);
    return kind === "add" ? json({ ok: true }) : issueSession(request, env, result.user, result.recoveryCode);
  }
  if (method === "POST" && pathname === "/api/auth/recover") {
    const data = await body(request);
    if (!data) return error(400, "A JSON request is required");
    const result = await recoverAccount(env, data);
    return issueSession(request, env, result.user, result.recoveryCode);
  }

  if (method === "POST" && pathname === "/api/auth/register") {
    const data = await body(request);
    const email = typeof data?.email === "string" ? data.email.trim().toLowerCase() : "";
    const password = data?.password;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || typeof password !== "string" || password.length < 12 || password.length > 128)
      return error(400, "Use a valid email and a password of 12 to 128 characters");
    const local = localMode(request, env);
    const now = new Date().toISOString();
    const inviteHash = typeof data?.inviteCode === "string" ? await hashToken(data.inviteCode.trim()) : "";
    if (!local && !(await env.DB.prepare("SELECT code_hash FROM invitations WHERE code_hash = ? AND used_by IS NULL AND expires_at > ?").bind(inviteHash, now).first())) return error(403, "A valid unused invitation is required");
    const turnstileSecret = env.TURNSTILE_SECRET;
    if (!local && turnstileSecret) {
      if (typeof data?.turnstileToken !== "string") return error(400, "Verification required");
      const form = new FormData();
      form.set("secret", turnstileSecret); form.set("response", data.turnstileToken);
      form.set("remoteip", ip);
      const check = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body: form, signal: AbortSignal.timeout(10_000) });
      const result = await check.json<{ success: boolean; hostname?: string; action?: string }>();
      if (!result.success || result.hostname !== new URL(request.url).hostname || result.action !== "register") return error(400, "Verification failed. Please try again.");
    } else if (!local) {
      return error(503, "Registration is not configured");
    }
    const passwordInfo = await hashPassword(password, passwordPepper(request, env));
    const user = { id: crypto.randomUUID(), email };
    try {
      const insert = local
        ? env.DB.prepare("INSERT INTO users (id, email, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?)").bind(user.id, user.email, passwordInfo.salt, passwordInfo.hash, now)
        : env.DB.prepare("INSERT INTO users (id, email, password_salt, password_hash, created_at) SELECT ?, ?, ?, ?, ? FROM invitations WHERE code_hash = ? AND used_by IS NULL AND expires_at > ?").bind(user.id, user.email, passwordInfo.salt, passwordInfo.hash, now, inviteHash, now);
      const result = await env.DB.batch([
        insert,
        env.DB.prepare("UPDATE invitations SET used_by = ? WHERE code_hash = ? AND used_by IS NULL AND EXISTS (SELECT 1 FROM users WHERE id = ?)").bind(user.id, inviteHash, user.id),
        env.DB.prepare("INSERT INTO activity_events (id, user_id, action, summary, created_at) SELECT ?, id, 'user.created', 'Account created', ? FROM users WHERE id = ?").bind(crypto.randomUUID(), now, user.id)
      ]);
      if (result[0].meta.changes !== 1) return error(403, "Invitation already used or expired");
    } catch (cause) {
      if (String(cause).includes("user_quota")) return error(409, "The test platform has reached its account limit");
      if (String(cause).includes("UNIQUE constraint failed: users.email")) return error(409, "An account with this email already exists");
      throw cause;
    }
    return issueSession(request, env, user);
  }
  if (method === "POST" && pathname === "/api/auth/login") {
    const data = await body(request);
    const email = typeof data?.email === "string" ? data.email.trim().toLowerCase() : "";
    const password = data?.password;
    if (!email || email.length > 254 || typeof password !== "string" || password.length > 128) return error(400, "Email and password required");
    const row = await env.DB.prepare("SELECT id, email, password_salt, password_hash FROM users WHERE email = ?")
      .bind(email).first<User & { password_salt: string; password_hash: string }>();
    const valid = await verifyPassword(password, row?.password_salt ?? "00".repeat(16), row?.password_hash ?? "", passwordPepper(request, env));
    if (!row || !valid) return error(401, "Invalid email or password");
    return issueSession(request, env, { id: row.id, email: row.email });
  }

  const user = await currentUser(request, env);
  if (!user) return error(401, "Sign in required");
  if(method==='GET'&&pathname==='/api/cms')return json({instances:await listCMS(env.DB,user.id)});
  if(method==='POST'&&pathname==='/api/cms/setup-reviews'){
    const data=await body(request);
    if(typeof data?.id!=='string'||typeof data.projectId!=='string'||typeof data.title!=='string'||typeof data.tagline!=='string')return error(400,'Provide a request ID, project, title and tagline');
    return json(await prepareCMS(env.DB,user.id,data.id,data.projectId,data.title,data.tagline));
  }
  const cmsReviewRoute=pathname.match(/^\/api\/cms\/setup-reviews\/([0-9a-f-]{36})(\/confirm)?$/);
  if(cmsReviewRoute){
    if(method==='GET'&&!cmsReviewRoute[2])return json(await readCMSReview(env.DB,user.id,cmsReviewRoute[1]));
    if(method==='POST'&&cmsReviewRoute[2])return json(await confirmCMS(env.DB,user.id,cmsReviewRoute[1]));
  }
  const historyRoute=pathname.match(/^\/api\/projects\/([0-9a-f-]{36})\/backend-state\/history$/);
  if(method==='GET'&&historyRoute)return json(await backendStateHistory(env.DB,user.id,historyRoute[1]));
  const snapshotRoute=pathname.match(/^\/api\/backend-state-snapshots\/([0-9a-f-]{36})\/(export|restore)$/);
  if(snapshotRoute){
    if(method==='GET'&&snapshotRoute[2]==='export')return json(await exportBackendState(env.DB,user.id,snapshotRoute[1]),200,{'content-disposition':'attachment; filename="townhello-backend-state-'+snapshotRoute[1]+'.json"'});
    if(method==='POST'&&snapshotRoute[2]==='restore'){
      const data=await body(request);if(typeof data?.id!=='string'||(data.side!=='before'&&data.side!=='after'))return error(400,'Provide a review ID and before or after snapshot side');
      return json(await restoreBackendState(env.DB,user.id,data.id,snapshotRoute[1],data.side));
    }
  }
  const stateRoute=pathname.match(/^\/api\/projects\/([0-9a-f-]{36})\/backend-state$/);
  if(stateRoute){
    if(method==='GET')return json(await readBackendState(env.DB,user.id,stateRoute[1]));
    if(method==='POST'){
      const data=await body(request);
      if(typeof data?.id!=='string'||typeof data.versionId!=='string'||!('input' in data))return error(400,'Provide a review ID, backend version ID and JSON input');
      return json(await prepareBackendState(env.DB,env.BACKEND_RUNTIME,user.id,stateRoute[1],data.versionId,data.id,data.input));
    }
  }
  const stateReviewRoute=pathname.match(/^\/api\/backend-state-reviews\/([0-9a-f-]{36})(\/confirm)?$/);
  if(stateReviewRoute){
    if(method==='GET'&&!stateReviewRoute[2])return json(await readBackendReview(env.DB,user.id,stateReviewRoute[1]));
    if(method==='POST'&&stateReviewRoute[2])return json(await confirmBackendState(env.DB,user.id,stateReviewRoute[1]));
  }
  const backendRoute=pathname.match(/^\/api\/projects\/([0-9a-f-]{36})\/backends(?:\/([0-9a-f-]{36})\/test)?$/);
  if(backendRoute){
    if(method==='GET'&&!backendRoute[2])return json({versions:await listBackends(env.DB,user.id,backendRoute[1])});
    if(method==='POST'){
      const data=await body(request);if(!data)return error(400,'A bounded JSON request is required');
      return backendRoute[2]?json(await testBackend(env.DB,env.BACKEND_RUNTIME,user.id,backendRoute[1],backendRoute[2],data.id,data.input)):json(await saveBackend(env.DB,user.id,backendRoute[1],data.id,data.source),201);
    }
  }
  const inboxMatch=pathname.match(/^\/api\/projects\/([0-9a-f-]{36})\/inbox$/);
  if(method==='GET'&&inboxMatch)return json(await contactInbox(env.DB,user.id,inboxMatch[1]));
  const messageMatch=pathname.match(/^\/api\/contact-messages\/([0-9a-f-]{36})$/);
  if(method==='DELETE'&&messageMatch){await deleteContact(env.DB,user.id,messageMatch[1]);return json({ok:true});}
  if(method==='GET'&&pathname==='/api/domain-hosting')return json({enabled:!!hostingConfig(env),connections:await hostingConnections(env.DB,user.id)});
  if(method==='POST'&&pathname==='/api/domain-hosting/review'){
    const data=await body(request);if(typeof data?.id!=='string'||typeof data.claimId!=='string')return error(400,'Choose a domain ownership claim.');
    return json(await reviewHosting(env.DB,user.id,data.id,data.claimId,hostingConfig(env)));
  }
  const hostingAction=pathname.match(/^\/api\/domain-hosting\/([0-9a-f-]{36})\/(confirm|refresh|disconnect)$/);
  if(method==='POST'&&hostingAction){const fn=hostingAction[2]==='confirm'?confirmHosting:hostingAction[2]==='refresh'?refreshHosting:disconnectHosting;return json(await fn(env.DB,user.id,hostingAction[1],hostingConfig(env)));}
  if (method === "GET" && pathname === "/api/domains") return json({...await listDomains(env.DB,user.id),connectionEnabled:!!hostingConfig(env)});
  if (method === "GET" && pathname === "/api/components") return json({components:componentCatalog});
  const filesMatch = pathname.match(/^\/api\/projects\/([0-9a-f-]{36})\/files(?:\/([0-9a-f-]{36}))?$/);
  if (filesMatch && method === 'GET' && !filesMatch[2]) return json(await listPhotos(env.DB,user.id,filesMatch[1]));
  if (filesMatch && method === 'PUT' && filesMatch[2]) return json(await uploadPhoto(request,env,user.id,filesMatch[1],filesMatch[2]));
  const photoMatch=pathname.match(/^\/api\/files\/([0-9a-f-]{36})$/);
  if (photoMatch && method === 'GET') return readPhoto(env,user.id,photoMatch[1]);
  const diffMatch=pathname.match(/^\/api\/site-versions\/([0-9a-f-]{36})\/diff$/);
  if(method==='GET'&&diffMatch){const params=new URL(request.url).searchParams;if([...params.keys()].some(k=>k!=='base')||params.getAll('base').length>1)return error(400,'Choose a single baseline.');return diffPage(await compareVersions(env.DB,user.id,diffMatch[1],params.get('base')??undefined));}
  const reviewDiff=pathname.match(/^\/api\/publication-reviews\/([0-9a-f-]{36})\/diff$/);
  if(method==='GET'&&reviewDiff)return diffPage(await compareReview(env.DB,user.id,reviewDiff[1]));
  const exportMatch = pathname.match(/^\/api\/site-versions\/([0-9a-f-]{36})\/export$/);
  if (method === 'GET' && exportMatch) {
    const archive = await ownedExport(env.DB, user.id, exportMatch[1], env.FILES);
    return archive ? new Response(archive, {headers:{'content-type':'application/zip','content-disposition':`attachment; filename="tellumo-site-${exportMatch[1]}.zip"`,'cache-control':'private, no-store','x-content-type-options':'nosniff','content-security-policy':"sandbox; default-src 'none'",'referrer-policy':'no-referrer'}}) : error(404,'Saved version not found');
  }
  const previewMatch = pathname.match(/^\/api\/site-versions\/([0-9a-f-]{36})\/preview$/);
  if (method === 'GET' && previewMatch) {
    return await ownedPreview(env,user.id,previewMatch[1]) ?? error(404,'Preview not found');
  }
  const versionsMatch = pathname.match(/^\/api\/projects\/([0-9a-f-]{36})\/versions$/);
  if (method === 'GET' && versionsMatch) {
    if (!(await env.DB.prepare('SELECT id FROM projects WHERE id = ? AND owner_user_id = ?').bind(versionsMatch[1],user.id).first())) return error(404,'Project not found');
    const {results} = await env.DB.prepare('SELECT id,component_id,digest,created_at FROM site_versions WHERE project_id = ? ORDER BY created_at DESC,id DESC LIMIT 25').bind(versionsMatch[1]).all();
    return json({versions:results});
  }
  if (method === "GET" && pathname === "/api/billing") return json({ ...await getBilling(env.DB, user.id), checkoutEnabled: checkoutEnabled(env), checkoutMode: "test", creditPack });
  if (method === "POST" && pathname === "/api/billing/checkout") {
    const data = await body(request);
    return json(await createCheckout(env.DB, env, user.id, data?.id, data?.product));
  }
  if (method === "POST" && pathname === "/api/billing/preferences") {
    const data = await body(request);
    if (typeof data?.overageEnabled !== "boolean") return error(400, "Choose whether existing credits may cover overage");
    await setOverage(env.DB, user.id, data.overageEnabled);
    return json({ ...await getBilling(env.DB, user.id), checkoutEnabled: checkoutEnabled(env), checkoutMode: "test", creditPack });
  }
  if (method === "GET" && pathname === "/api/passkeys") {
    const { results } = await env.DB.prepare("SELECT id, name, created_at, last_used_at FROM passkeys WHERE user_id = ? ORDER BY created_at").bind(user.id).all();
    return json({ passkeys: results });
  }
  if (method === "POST" && pathname === "/api/auth/passkeys/remove") {
    if (!(await recentSession(request, env))) return error(401, "Sign in again before removing a passkey");
    const data = await body(request);
    if (typeof data?.id !== "string") return error(400, "Passkey ID required");
    const eventId = crypto.randomUUID();
    const removed = await env.DB.batch([
      env.DB.prepare("INSERT INTO activity_events (id, user_id, action, summary, created_at) SELECT ?, user_id, 'passkey.removed', 'Passkey removed; all sessions signed out', ? FROM passkeys WHERE id = ? AND user_id = ? AND ((SELECT COUNT(*) FROM passkeys WHERE user_id = ?) > 1 OR EXISTS (SELECT 1 FROM users WHERE id = ? AND password_hash != 'passkey-only'))").bind(eventId, new Date().toISOString(), data.id, user.id, user.id, user.id),
      env.DB.prepare("DELETE FROM passkeys WHERE id = ? AND user_id = ? AND EXISTS (SELECT 1 FROM activity_events WHERE id = ?)").bind(data.id, user.id, eventId),
      env.DB.prepare("DELETE FROM sessions WHERE user_id = ? AND EXISTS (SELECT 1 FROM activity_events WHERE id = ?)").bind(user.id, eventId)
    ]);
    if (removed[0].meta.changes !== 1) return error(409, "Add another passkey before removing your last one, or refresh if it was already removed");
    return json({ ok: true, signedOut: true }, 200, { "set-cookie": clearCookie(request) });
  }
  if (method === "POST" && pathname === "/api/auth/recovery-code") {
    if (!(await recentSession(request, env))) return error(401, "Sign in again before replacing a recovery code");
    const recoveryCode = newSessionToken();
    await env.DB.prepare("INSERT INTO recovery_codes (user_id, code_hash, created_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET code_hash = excluded.code_hash, created_at = excluded.created_at").bind(user.id, await hashToken(recoveryCode), new Date().toISOString()).run();
    return json({ recoveryCode });
  }
  if (method === "GET" && pathname === "/api/connections") return json({...await connectionStatus(env.DB,user.id,githubConfig(env)),cloudflare:await cloudflareStatus(env.DB,user.id,cloudflareConfig(env))});
  const directoryHistoryRoute=pathname.match(/^\/api\/projects\/([0-9a-f-]{36})\/directory\/history$/);
  if(method==='GET'&&directoryHistoryRoute)return json(await directoryHistory(env.DB,user.id,directoryHistoryRoute[1]));
  const directoryExportRoute=pathname.match(/^\/api\/projects\/([0-9a-f-]{36})\/directory\/snapshots\/([0-9a-f-]{36})\/export$/);
  if(method==='GET'&&directoryExportRoute)return json(await exportDirectory(env.DB,user.id,directoryExportRoute[1],directoryExportRoute[2]),200,{'content-disposition':'attachment; filename="tellumo-directory-'+directoryExportRoute[2]+'.json"'});
  const directoryProject=pathname.match(/^\/api\/projects\/([0-9a-f-]{36})\/directory$/);
  if(method==='GET'&&directoryProject){const d=await readDirectory(env.DB,user.id,directoryProject[1]);return json({projectId:d.id,name:d.name,revision:d.revision,listings:d.draft,published:d.published,publishedAt:d.published?d.published_at:null});}
  if(method==='GET'&&pathname==='/api/site-health')return json(await listHealth(env.DB,user.id));
  const healthProject=pathname.match(/^\/api\/projects\/([0-9a-f-]{36})\/health$/);
  if(method==='POST'&&healthProject){if(String(env.ENVIRONMENT)==='local')return error(503,'Website checks are unavailable in this environment.');return json(await checkHealth(env.DB,user.id,healthProject[1]));}
  if(method==='GET'&&pathname==='/api/cloudflare/dns')return json({enabled:!!cloudflareConfig(env),...await listDNSActions(env.DB,user.id)});
  if(method==='POST'&&pathname==='/api/cloudflare/dns/review'){
    const data=await body(request);if(typeof data?.id!=='string'||typeof data.claimId!=='string'||typeof data.zoneId!=='string')return error(400,'Choose a claim and Cloudflare zone.');
    return json(await reviewTXT(env.DB,user.id,data.id,data.claimId,data.zoneId,cloudflareConfig(env)));
  }
  if(method==='POST'&&pathname==='/api/cloudflare/dns/routing-review'){
    const data=await body(request);if(!data||Object.keys(data).some(k=>!['id','connectionId','zoneId'].includes(k))||typeof data.id!=='string'||typeof data.connectionId!=='string'||typeof data.zoneId!=='string')return error(400,'Choose a hosting connection and Cloudflare zone.');
    return json(await reviewCNAME(env.DB,user.id,data.id,data.connectionId,data.zoneId,cloudflareConfig(env),fetch,!!hostingConfig(env)));
  }
  const dnsConfirmation=pathname.match(/^\/api\/cloudflare\/dns\/([0-9a-f-]{36})\/confirm$/);
  if(method==='POST'&&dnsConfirmation)return json(await confirmDNS(env.DB,user.id,dnsConfirmation[1],cloudflareConfig(env),fetch,!!hostingConfig(env)));
  if(method==='POST'&&pathname==='/api/connections/cloudflare/start'){
    if(!(await recentSession(request,env)))return error(401,'Sign in again before connecting Cloudflare.');
    return json(await startCloudflare(env.DB,user.id,await hashToken(sessionToken(request)!),cloudflareConfig(env)));
  }
  if(method==='GET'&&pathname==='/api/connections/cloudflare/callback'){
    const params=new URL(request.url).searchParams;let destination='/workspace/?connection=cloudflare';
    try{if(params.has('error')){await cancelCloudflare(env.DB,user.id,await hashToken(sessionToken(request)!),params.get('state')??'');throw new ConnectionError(400,'Cloudflare authorization cancelled.');}await finishCloudflare(env.DB,user.id,await hashToken(sessionToken(request)!),params.get('state')??'',params.get('code')??'',cloudflareConfig(env));}
    catch(cause){if(!(cause instanceof ConnectionError))throw cause;destination+='&connection_error=authorization';}
    return new Response(null,{status:303,headers:{location:destination,'cache-control':'no-store','referrer-policy':'no-referrer'}});
  }
  if(method==='POST'&&pathname==='/api/connections/cloudflare/disconnect')return json(await disconnectCloudflare(env.DB,user.id,cloudflareConfig(env)));
  if(method==='GET'&&pathname==='/api/connections/cloudflare/zones')return json(await cloudflareZones(env.DB,user.id,cloudflareConfig(env),Number(new URL(request.url).searchParams.get('page')??1)));
  if (method === "POST" && pathname === "/api/connections/github/start") {
    if(!(await recentSession(request,env)))return error(401,'Sign in again before connecting GitHub.');
    return json(await startGitHub(env.DB,user.id,await hashToken(sessionToken(request)!),githubConfig(env)));
  }
  if (method === "GET" && pathname === "/api/connections/github/callback") {
    const params=new URL(request.url).searchParams;
    let destination='/workspace/?connection=github';
    try{if(params.has('error')){await cancelGitHub(env.DB,user.id,await hashToken(sessionToken(request)!),params.get('state')??'');throw new ConnectionError(400,'GitHub authorization was cancelled.');}await finishGitHub(env.DB,user.id,await hashToken(sessionToken(request)!),params.get('state')??'',params.get('code')??'',githubConfig(env));}
    catch(cause){if(!(cause instanceof ConnectionError))throw cause;destination+='&connection_error=authorization';}
    return new Response(null,{status:303,headers:{location:destination,'cache-control':'no-store','referrer-policy':'no-referrer'}});
  }
  if (method === "POST" && pathname === "/api/connections/github/disconnect") return json(await disconnectGitHub(env.DB,user.id,githubConfig(env)));
  if (method === "GET" && pathname === "/api/connections/github/installations") return json(await githubInstallations(env.DB,user.id,githubConfig(env)));
  if (method === "GET" && pathname === "/api/connections/github/repositories") {
    const params=new URL(request.url).searchParams;
    return json(await githubRepositories(env.DB,user.id,githubConfig(env),Number(params.get('installation')),Number(params.get('page')??1)));
  }
  if (method === "GET" && pathname === "/api/github/backups") return json(await listBackups(env.DB,user.id));
  if (method === "POST" && pathname === "/api/github/backups/review") {
    const data=await body(request);if(!data)return error(400,'A backup review is required.');
    return json(await reviewBackup(env.DB,env.FILES,user.id,data,githubConfig(env)));
  }
  const backupConfirm=pathname.match(/^\/api\/github\/backups\/([0-9a-f-]{36})\/confirm$/);
  if(method==='POST'&&backupConfirm)return json(await confirmBackup(env.DB,env.FILES,user.id,backupConfirm[1],githubConfig(env)));
  if (method === "GET" && pathname === "/api/me") return json({ user });
  if (method === "GET" && pathname === "/api/chat") return json(await readChat(env.DB, user.id, !!configuredAI(env)));
  if (method === "POST" && pathname === "/api/chat") {
    const data = await body(request);
    if (!data) return error(400, "A JSON message is required");
    const result = await sendChat(env.DB, user.id, data, configuredAI(env),{backendRuntime:env.BACKEND_RUNTIME,config:cloudflareConfig(env),hostingReady:!!hostingConfig(env),hosting:hostingConfig(env),github:githubConfig(env),files:env.FILES,healthChecks:String(env.ENVIRONMENT)!=='local'});
    return result.error ? error(result.status, result.error) : json(await readChat(env.DB, user.id, !!configuredAI(env)));
  }
  if (method === "POST" && pathname === "/api/auth/logout") {
    const token = sessionToken(request);
    if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await hashToken(token)).run();
    return json({ ok: true }, 200, { "set-cookie": clearCookie(request) });
  }
  if (method === "GET" && pathname === "/api/projects") {
    const { results } = await env.DB.prepare("SELECT id, name, purpose, status, created_at, updated_at FROM projects WHERE owner_user_id = ? ORDER BY updated_at DESC LIMIT 100")
      .bind(user.id).all<Project>();
    return json({ projects: results });
  }
  if (method === "POST" && pathname === "/api/projects") {
    const data = await body(request);
    const name = typeof data?.name === "string" ? data.name.trim() : "";
    const purpose = typeof data?.purpose === "string" ? data.purpose.trim() : "";
    if (!name || name.length > 100 || purpose.length > 1000) return error(400, "Name is required and must be 100 characters or fewer");
    const now = new Date().toISOString();
    const project: Project = { id: crypto.randomUUID(), name, purpose, status: "draft", created_at: now, updated_at: now };
    try { await env.DB.batch([
      env.DB.prepare("INSERT INTO projects (id, owner_user_id, name, purpose, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(project.id, user.id, name, purpose, project.status, now, now),
      env.DB.prepare("INSERT INTO activity_events (id, user_id, project_id, action, summary, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), user.id, project.id, "project.created", `Created project ${name}`, now)
    ]); } catch (cause) {
      if (String(cause).includes("project_quota")) return error(409, "The test platform allows 20 projects per account");
      throw cause;
    }
    return json({ project }, 201);
  }
  const projectMatch = pathname.match(/^\/api\/projects\/([0-9a-f-]{36})$/);
  if (method === "GET" && projectMatch) {
    const project = await env.DB.prepare("SELECT id, name, purpose, status, created_at, updated_at FROM projects WHERE id = ? AND owner_user_id = ?")
      .bind(projectMatch[1], user.id).first<Project>();
    return project ? json({ project }) : error(404, "Project not found");
  }
  if (method === "GET" && pathname === "/api/activity") {
    const { results } = await env.DB.prepare("SELECT id, project_id, action, summary, created_at FROM activity_events WHERE user_id = ? ORDER BY created_at DESC LIMIT 100")
      .bind(user.id).all();
    return json({ activity: results });
  }
  return error(404, "Not found");
}

export default {
  async scheduled(_event: ScheduledController, env: Env) {
    if(_event.cron==='47 * * * *'){const checks=await Promise.allSettled([maintainHosting(env.DB,hostingConfig(env)),maintainHealth(env.DB)]);if(checks.some(r=>r.status==='rejected'))throw Error('Scheduled website checks failed');return;}
    const results=await Promise.allSettled([cleanupContacts(env.DB),cleanupPhotos(env),cleanupGitHub(env.DB,githubConfig(env)),cleanupCloudflare(env.DB,cloudflareConfig(env))]);
    if(results.some(result=>result.status==='rejected'))throw Error('Scheduled maintenance failed');
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = crypto.randomUUID();
    try {
      const contactMatch=new URL(request.url).pathname.match(/^\/contact\/([0-9a-f-]{36})$/);
      if(contactMatch)return contactPage(request,env,contactMatch[1]);
      if (new URL(request.url).pathname.startsWith("/api/")) return await handle(request, env);
      return env.ASSETS.fetch(request);
    } catch (cause) {
      if (cause instanceof CMSProjectError || cause instanceof BackendError || cause instanceof DirectoryError || cause instanceof HealthError || cause instanceof DiffError || cause instanceof ContactError || cause instanceof ConnectionError || cause instanceof DomainError || cause instanceof AuthError || cause instanceof BillingError || cause instanceof FileError || cause instanceof StorageLimitError) return error(cause.status, cause.message);
      console.error(JSON.stringify({ event: "request.failed", requestId, cause: String(cause) }));
      return json({ error: "Internal error", requestId }, 500);
    }
  }
} satisfies ExportedHandler<Env>;
