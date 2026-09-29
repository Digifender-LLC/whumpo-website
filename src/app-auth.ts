import {generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse, type AuthenticationResponseJSON, type RegistrationResponseJSON} from '@simplewebauthn/server';
import {BackendError} from './backend-versions';
import {hashToken, newSessionToken} from './security';
import {replacementAppRecoveryCode} from './app-recovery';

// Internal authentication service. The future controlled app host must supply
// challengeToken/session from HttpOnly cookies, enforce same-origin writes and
// request limits, and never expose these values to generated code or the agent.
type Kind = 'signup' | 'login' | 'add';
type Challenge = {project_id:string; program_revision:number; challenge:string; kind:Kind; visitor_id:string; invite_hash:string; session_hash:string;page_review_id:string|null};
type Key = {id:string; visitor_id:string; public_key:string; counter:number; revision:number};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const tokenPattern = /^[0-9a-f]{64}$/;
const b64 = (value:Uint8Array) => btoa(String.fromCharCode(...value)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const decode = (value:string) => Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0));
const digest = (kind:string, token:string) => hashToken(`whumpo-app-${kind}:`+token);
const nowSQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
const activeSQL = 'SELECT a.revision FROM app_spaces a JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id WHERE a.project_id=? AND a.enabled=1';
function rp(local:boolean) {
 const origin = local ? 'http://localhost:8787' : 'https://apps.digifender.com';
 return {origin,rpID:new URL(origin).hostname};
}
async function active(db:D1Database, project:string) {
 const row = uuid.test(project) ? await db.prepare(activeSQL).bind(project).first<{revision:number}>() : null;
 if (!row) throw new BackendError(404,'Application unavailable');
 return row;
}
async function owner(db:D1Database, user:string, project:string) {
 const state = await db.prepare('SELECT a.revision FROM app_spaces a JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id WHERE a.project_id=? AND a.owner_user_id=?').bind(project,user).first<{revision:number}>();
 if (!state) throw new BackendError(404,'Application unavailable');
 return state;
}

export async function createAppInvitation(db:D1Database, user:string, project:string) {
 const {revision} = await owner(db,user,project), code = newSessionToken();
 await db.prepare(`DELETE FROM app_invitations WHERE expires_at<=${nowSQL}`).run();
 const result = await db.prepare(`INSERT INTO app_invitations(code_hash,project_id,program_revision) SELECT ?,a.project_id,a.revision FROM app_spaces a JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id WHERE a.project_id=? AND a.owner_user_id=? AND a.enabled=1 AND a.revision=?`).bind(await digest('invite',code),project,user,revision).run();
 if (result.meta.changes!==1) throw new BackendError(409,'Application changed; try again');
 return {code,expiresInSeconds:86400}; // Owner-only, once. Never put in chat/logs/URLs.
}

export async function revokeAppVisitor(db:D1Database, user:string, project:string, visitor:string) {
 await owner(db,user,project);
 const result = await db.prepare('UPDATE app_visitors SET revoked=1 WHERE id=? AND project_id=? AND EXISTS(SELECT 1 FROM app_spaces a JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.owner_user_id WHERE a.project_id=? AND a.owner_user_id=?)').bind(visitor,project,project,user).run();
 if (result.meta.changes<1) throw new BackendError(404,'Visitor unavailable');
}

export async function appPasskeyOptions(db:D1Database, project:string, kind:Kind, local=false, secret='',pageReview:string|null=null) {
 const {revision} = await active(db,project), {rpID} = rp(local);
 let visitor='', invite='', session='';
 if (kind==='signup') {
  if (!tokenPattern.test(secret)) throw new BackendError(403,'An unused application invitation is required');
  invite=await digest('invite',secret);
  const row=await db.prepare(`SELECT 1 FROM app_invitations WHERE code_hash=? AND project_id=? AND program_revision=? AND used_by IS NULL AND revoked=0 AND expires_at>${nowSQL}`).bind(invite,project,revision).first();
  if (!row) throw new BackendError(403,'An unused application invitation is required');
  visitor=crypto.randomUUID();
 } else if (kind==='add') {
  if (!tokenPattern.test(secret)) throw new BackendError(401,'Sign in again before adding a passkey');
  session=await digest('session',secret);
  const row=await db.prepare("SELECT v.id FROM app_sessions s JOIN app_visitors v ON v.id=s.visitor_id WHERE s.token_hash=? AND v.project_id=? AND v.revoked=0 AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','+23 hours','+50 minutes')").bind(session,project).first<{id:string}>();
  if (!row) throw new BackendError(401,'Sign in again before adding a passkey');
  visitor=row.id;
 } else if (kind!=='login') throw new BackendError(400,'Unknown passkey operation');
 const keys=visitor ? (await db.prepare('SELECT id FROM app_passkeys WHERE visitor_id=?').bind(visitor).all<{id:string}>()).results : [];
 if (keys.length>=5) throw new BackendError(409,'You can save up to five app passkeys');
 const options=kind==='login'
  ? await generateAuthenticationOptions({rpID,userVerification:'required'})
  : await generateRegistrationOptions({rpID,rpName:'Whumpo application',userID:new Uint8Array(new TextEncoder().encode(visitor)),userName:`App ${project.slice(0,8)} · ${visitor.slice(0,8)}`,attestationType:'none',supportedAlgorithmIDs:[-7,-257],excludeCredentials:keys.map(key=>({id:key.id})),authenticatorSelection:{residentKey:'required',userVerification:'required'}});
 const challengeToken=newSessionToken();
 await db.batch([
  db.prepare(`DELETE FROM app_auth_challenges WHERE expires_at<=${nowSQL}`),
  db.prepare('INSERT INTO app_auth_challenges(token_hash,project_id,program_revision,challenge,kind,visitor_id,invite_hash,session_hash,page_review_id) VALUES(?,?,?,?,?,?,?,?,?)').bind(await digest('challenge',challengeToken),project,revision,options.challenge,kind,visitor,invite,session,pageReview)
 ]);
 return {options,challengeToken};
}

export async function appPasskeyVerify(db:D1Database, project:string, kind:Kind, challengeToken:string, response:AuthenticationResponseJSON|RegistrationResponseJSON, local=false, currentSession='',pageReview:string|null=null) {
 if (!tokenPattern.test(challengeToken)) throw new BackendError(400,'Start app sign-in again');
 const challenge=await db.prepare(`DELETE FROM app_auth_challenges WHERE token_hash=? AND project_id=? AND kind=? AND expires_at>${nowSQL} RETURNING *`).bind(await digest('challenge',challengeToken),project,kind).first<Challenge>();
 if (!challenge) throw new BackendError(400,'App sign-in expired or already used');
 if(challenge.page_review_id!==pageReview)throw new BackendError(409,'Application page changed; start sign-in again');
 const state=await active(db,project);
 if (state.revision!==challenge.program_revision) throw new BackendError(409,'Application changed; sign in again');
 if (kind==='add'&&(!tokenPattern.test(currentSession)||await digest('session',currentSession)!==challenge.session_hash)) throw new BackendError(401,'App session changed; start passkey enrollment again');
 const {origin,rpID}=rp(local), session=newSessionToken(), sessionHash=await digest('session',session);
 if (kind==='login') {
  const assertion=response as AuthenticationResponseJSON;
  const key=typeof assertion?.id==='string' ? await db.prepare('SELECT k.* FROM app_passkeys k JOIN app_visitors v ON v.id=k.visitor_id WHERE k.id=? AND v.project_id=? AND v.revoked=0').bind(assertion.id,project).first<Key>() : null;
  if (!key || assertion.response?.userHandle!==b64(new TextEncoder().encode(key.visitor_id))) throw new BackendError(401,'App passkey verification failed');
  let verified;
  try { verified=await verifyAuthenticationResponse({response:assertion,expectedChallenge:challenge.challenge,expectedOrigin:origin,expectedRPID:rpID,requireUserVerification:true,credential:{id:key.id,publicKey:decode(key.public_key),counter:key.counter}}); }
  catch { throw new BackendError(401,'App passkey verification failed'); }
  if (!verified.verified) throw new BackendError(401,'App passkey verification failed');
  const results=await db.batch([
   db.prepare(`DELETE FROM app_sessions WHERE visitor_id=? AND expires_at<=${nowSQL}`).bind(key.visitor_id),
   db.prepare(`UPDATE app_passkeys SET counter=?,revision=revision+1 WHERE id=? AND revision=? AND EXISTS(${activeSQL} AND a.revision=?)`).bind(verified.authenticationInfo.newCounter,key.id,key.revision,project,challenge.program_revision),
   db.prepare('INSERT INTO app_sessions(token_hash,visitor_id,page_review_id) SELECT ?,visitor_id,? FROM app_passkeys WHERE id=? AND revision=? AND changes()=1').bind(sessionHash,pageReview,key.id,key.revision+1)
  ]);
  if (results[2].meta.changes!==1) throw new BackendError(409,'App credentials changed; sign in again');
  return {session,visitorId:key.visitor_id};
 }
 let verified;
 try { verified=await verifyRegistrationResponse({response:response as RegistrationResponseJSON,expectedChallenge:challenge.challenge,expectedOrigin:origin,expectedRPID:rpID,requireUserVerification:true,supportedAlgorithmIDs:[-7,-257]}); }
 catch { throw new BackendError(400,'App passkey verification failed'); }
 if (!verified.verified) throw new BackendError(400,'App passkey verification failed');
 const key=verified.registrationInfo.credential, visitor=challenge.visitor_id;
 if (kind==='add') {
  const result=await db.prepare(`INSERT INTO app_passkeys(id,visitor_id,public_key,counter) SELECT ?,v.id,?,? FROM app_visitors v JOIN app_sessions s ON s.visitor_id=v.id WHERE v.id=? AND v.project_id=? AND v.revoked=0 AND s.token_hash=? AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','+23 hours','+50 minutes') AND EXISTS(${activeSQL} AND a.revision=?)`).bind(key.id,b64(key.publicKey),key.counter,visitor,project,challenge.session_hash,project,challenge.program_revision).run();
  if (result.meta.changes!==1) throw new BackendError(401,'Sign in again before adding a passkey');
  return {visitorId:visitor};
 }
 const recoveryCode=newSessionToken();
 const results=await db.batch([
  db.prepare(`INSERT INTO app_visitors(id,project_id) SELECT ?,i.project_id FROM app_invitations i WHERE i.code_hash=? AND i.project_id=? AND i.program_revision=? AND i.used_by IS NULL AND i.revoked=0 AND i.expires_at>${nowSQL} AND EXISTS(${activeSQL} AND a.revision=?)`).bind(visitor,challenge.invite_hash,project,challenge.program_revision,project,challenge.program_revision),
  db.prepare('INSERT INTO app_passkeys(id,visitor_id,public_key,counter) SELECT ?,id,?,? FROM app_visitors WHERE id=?').bind(key.id,b64(key.publicKey),key.counter,visitor),
  db.prepare('UPDATE app_invitations SET used_by=? WHERE code_hash=? AND EXISTS(SELECT 1 FROM app_visitors WHERE id=?)').bind(visitor,challenge.invite_hash,visitor),
  db.prepare('INSERT INTO app_recovery_codes(visitor_id,code_hash) SELECT id,? FROM app_visitors WHERE id=?').bind(await digest('recovery',recoveryCode),visitor),
  db.prepare('INSERT INTO app_sessions(token_hash,visitor_id,page_review_id) SELECT ?,id,? FROM app_visitors WHERE id=?').bind(sessionHash,pageReview,visitor)
 ]);
 if (results[4].meta.changes!==1) throw new BackendError(403,'Application invitation changed or was already used');
 return {session,visitorId:visitor,recoveryCode};
}

export async function recoverAppVisitor(db:D1Database, project:string, code:string,pageReview:string|null=null,nonce?:string) {
 const {revision}=await active(db,project);
 if (!tokenPattern.test(code)) throw new BackendError(401,'Invalid application recovery code');
 const hash=await digest('recovery',code), replacement=nonce?await replacementAppRecoveryCode(code,nonce):newSessionToken(), replacementHash=await digest('recovery',replacement), session=newSessionToken();
 const retryHash=nonce?replacementHash:hash;
 const row=await db.prepare('SELECT r.visitor_id FROM app_recovery_codes r JOIN app_visitors v ON v.id=r.visitor_id WHERE r.code_hash IN (?,?) AND v.project_id=? AND v.revoked=0').bind(hash,retryHash,project).first<{visitor_id:string}>();
 if (!row) throw new BackendError(401,'Invalid application recovery code');
 // Recovery invalidates all old credentials, including sign-ins being verified.
 // The fresh session may add a replacement passkey without changing identity/data.
 const results=await db.batch([
  db.prepare(`UPDATE app_recovery_codes SET code_hash=? WHERE visitor_id=? AND code_hash IN (?,?) AND EXISTS(${activeSQL} AND a.revision=?)`).bind(replacementHash,row.visitor_id,hash,retryHash,project,revision),
  db.prepare('DELETE FROM app_sessions WHERE visitor_id=? AND EXISTS(SELECT 1 FROM app_recovery_codes WHERE visitor_id=? AND code_hash=?)').bind(row.visitor_id,row.visitor_id,replacementHash),
  db.prepare('DELETE FROM app_passkeys WHERE visitor_id=? AND EXISTS(SELECT 1 FROM app_recovery_codes WHERE visitor_id=? AND code_hash=?)').bind(row.visitor_id,row.visitor_id,replacementHash),
  db.prepare('INSERT INTO app_sessions(token_hash,visitor_id,page_review_id) SELECT ?,visitor_id,? FROM app_recovery_codes WHERE visitor_id=? AND code_hash=?').bind(await digest('session',session),pageReview,row.visitor_id,replacementHash)
 ]);
 if (results[3].meta.changes!==1) throw new BackendError(401,'Application recovery code changed or was already used');
 return {session,visitorId:row.visitor_id,recoveryCode:replacement};
}
