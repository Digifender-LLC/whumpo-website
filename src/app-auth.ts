import {visitorOrigin} from './hosts';
import {generateAuthenticationOptions, generateRegistrationOptions, verifyAuthenticationResponse, verifyRegistrationResponse, type AuthenticationResponseJSON, type RegistrationResponseJSON} from '@simplewebauthn/server';
import {BackendError} from './backend-versions';
import {hashToken, newSessionToken} from './security';
import {replacementAppRecoveryCode} from './app-recovery';

// Internal project visitor authentication service (WH-126). Visitor identity belongs to the project's single access
// module instance: enrollment, passkeys, recovery and sessions need that instance to be active, never a visitor
// application. The visitor host supplies challengeToken/session from HttpOnly cookies, enforces same-origin writes and
// request limits, and never exposes these values to generated code or the agent.
type Kind = 'signup' | 'login' | 'add';
type Challenge = {project_id:string; access_id:string; activation_revision:number; challenge:string; kind:Kind; visitor_id:string; invite_hash:string; session_hash:string};
type Key = {id:string; visitor_id:string; public_key:string; counter:number; revision:number};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const tokenPattern = /^[0-9a-f]{64}$/;
const b64 = (value:Uint8Array) => btoa(String.fromCharCode(...value)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const decode = (value:string) => Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')), c=>c.charCodeAt(0));
const digest = (kind:string, token:string) => hashToken(`whumpo-app-${kind}:`+token);
const nowSQL = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";
/** The project's active access instance and its activation revision; invitations and challenges bind both. */
const activeSQL = "SELECT ac.revision FROM module_instances i JOIN module_activations ac ON ac.instance_id=i.id JOIN module_activation_reviews ar ON ar.id=ac.review_id JOIN projects p ON p.id=i.project_id AND p.owner_user_id=ar.user_id WHERE i.project_id=? AND i.kind='access' AND ac.state='active'";
function rp(local:boolean,project:string) {
 const origin = local ? 'http://localhost:8787' : visitorOrigin(project);
 return {origin,rpID:new URL(origin).hostname};
}
const accessSQL = "SELECT i.id access_id,ac.revision FROM module_instances i JOIN module_activations ac ON ac.instance_id=i.id JOIN module_activation_reviews ar ON ar.id=ac.review_id JOIN projects p ON p.id=i.project_id AND p.owner_user_id=ar.user_id WHERE i.project_id=? AND i.kind='access' AND ac.state='active'";
async function active(db:D1Database, project:string) {
 const row = uuid.test(project) ? await db.prepare(accessSQL).bind(project).first<{access_id:string;revision:number}>() : null;
 if (!row) throw new BackendError(404,'Visitor access unavailable');
 return row;
}
async function owner(db:D1Database, user:string, project:string) {
 if (!uuid.test(project) || !await db.prepare('SELECT 1 FROM projects WHERE id=? AND owner_user_id=?').bind(project,user).first()) throw new BackendError(404,'Visitor access unavailable');
}

export async function createAppInvitation(db:D1Database, user:string, project:string) {
 await owner(db,user,project);
 const state = await db.prepare(accessSQL).bind(project).first<{access_id:string;revision:number}>(), code = newSessionToken();
 if (!state) throw new BackendError(409,'Activate this project’s visitor access module before inviting visitors');
 await db.prepare(`DELETE FROM app_invitations WHERE expires_at<=${nowSQL}`).run();
 const result = await db.prepare(`INSERT INTO app_invitations(code_hash,project_id,access_id,activation_revision) SELECT ?,i.project_id,i.id,ac.revision FROM module_instances i JOIN module_activations ac ON ac.instance_id=i.id JOIN module_activation_reviews ar ON ar.id=ac.review_id JOIN projects p ON p.id=i.project_id AND p.owner_user_id=ar.user_id WHERE i.id=? AND i.project_id=? AND p.owner_user_id=? AND i.kind='access' AND ac.state='active' AND ac.revision=?`).bind(await digest('invite',code),state.access_id,project,user,state.revision).run();
 if (result.meta.changes!==1) throw new BackendError(409,'Visitor access changed; try again');
 return {code,expiresInSeconds:86400}; // Owner-only, once. Never put in chat/logs/URLs.
}

export async function revokeAppVisitor(db:D1Database, user:string, project:string, visitor:string) {
 await owner(db,user,project);
 const result = await db.prepare('UPDATE app_visitors SET revoked=1 WHERE id=? AND project_id=? AND EXISTS(SELECT 1 FROM projects p WHERE p.id=? AND p.owner_user_id=?)').bind(visitor,project,project,user).run();
 if (result.meta.changes<1) throw new BackendError(404,'Visitor unavailable');
}

export async function appPasskeyOptions(db:D1Database, project:string, kind:Kind, local=false, secret='') {
 const {access_id:access,revision} = await active(db,project), {rpID} = rp(local,project);
 let visitor='', invite='', session='';
 if (kind==='signup') {
  if (!tokenPattern.test(secret)) throw new BackendError(403,'An unused application invitation is required');
  invite=await digest('invite',secret);
  const row=await db.prepare(`SELECT 1 FROM app_invitations WHERE code_hash=? AND project_id=? AND access_id=? AND activation_revision=? AND used_by IS NULL AND revoked=0 AND expires_at>${nowSQL}`).bind(invite,project,access,revision).first();
  if (!row) throw new BackendError(403,'An unused application invitation is required');
  visitor=crypto.randomUUID();
 } else if (kind==='add') {
  if (!tokenPattern.test(secret)) throw new BackendError(401,'Sign in again before adding a passkey');
  session=await digest('session',secret);
  const row=await db.prepare("SELECT v.id FROM app_sessions s JOIN app_visitors v ON v.id=s.visitor_id WHERE s.token_hash=? AND v.project_id=? AND v.access_id=? AND v.revoked=0 AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','+23 hours','+50 minutes')").bind(session,project,access).first<{id:string}>();
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
  db.prepare('INSERT INTO app_auth_challenges(token_hash,project_id,access_id,activation_revision,challenge,kind,visitor_id,invite_hash,session_hash) VALUES(?,?,?,?,?,?,?,?,?)').bind(await digest('challenge',challengeToken),project,access,revision,options.challenge,kind,visitor,invite,session)
 ]);
 return {options,challengeToken};
}

export async function appPasskeyVerify(db:D1Database, project:string, kind:Kind, challengeToken:string, response:AuthenticationResponseJSON|RegistrationResponseJSON, local=false, currentSession='') {
 if (!tokenPattern.test(challengeToken)) throw new BackendError(400,'Start app sign-in again');
 const challenge=await db.prepare(`DELETE FROM app_auth_challenges WHERE token_hash=? AND project_id=? AND kind=? AND expires_at>${nowSQL} RETURNING *`).bind(await digest('challenge',challengeToken),project,kind).first<Challenge>();
 if (!challenge) throw new BackendError(400,'App sign-in expired or already used');
 const state=await active(db,project);
 if (state.access_id!==challenge.access_id||state.revision!==challenge.activation_revision) throw new BackendError(409,'Visitor access changed; sign in again');
 if (kind==='add'&&(!tokenPattern.test(currentSession)||await digest('session',currentSession)!==challenge.session_hash)) throw new BackendError(401,'App session changed; start passkey enrollment again');
 const {origin,rpID}=rp(local,project), session=newSessionToken(), sessionHash=await digest('session',session);
 if (kind==='login') {
  const assertion=response as AuthenticationResponseJSON;
  const key=typeof assertion?.id==='string' ? await db.prepare('SELECT k.* FROM app_passkeys k JOIN app_visitors v ON v.id=k.visitor_id WHERE k.id=? AND v.project_id=? AND v.access_id=? AND v.revoked=0').bind(assertion.id,project,challenge.access_id).first<Key>() : null;
  if (!key || assertion.response?.userHandle!==b64(new TextEncoder().encode(key.visitor_id))) throw new BackendError(401,'App passkey verification failed');
  let verified;
  try { verified=await verifyAuthenticationResponse({response:assertion,expectedChallenge:challenge.challenge,expectedOrigin:origin,expectedRPID:rpID,requireUserVerification:true,credential:{id:key.id,publicKey:decode(key.public_key),counter:key.counter}}); }
  catch { throw new BackendError(401,'App passkey verification failed'); }
  if (!verified.verified) throw new BackendError(401,'App passkey verification failed');
  const results=await db.batch([
   db.prepare(`DELETE FROM app_sessions WHERE visitor_id=? AND expires_at<=${nowSQL}`).bind(key.visitor_id),
   db.prepare(`UPDATE app_passkeys SET counter=?,revision=revision+1 WHERE id=? AND revision=? AND EXISTS(${activeSQL} AND ac.revision=?)`).bind(verified.authenticationInfo.newCounter,key.id,key.revision,project,challenge.activation_revision),
   db.prepare('INSERT INTO app_sessions(token_hash,visitor_id) SELECT ?,visitor_id FROM app_passkeys WHERE id=? AND revision=? AND changes()=1').bind(sessionHash,key.id,key.revision+1)
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
  const result=await db.prepare(`INSERT INTO app_passkeys(id,visitor_id,public_key,counter) SELECT ?,v.id,?,? FROM app_visitors v JOIN app_sessions s ON s.visitor_id=v.id WHERE v.id=? AND v.project_id=? AND v.access_id=? AND v.revoked=0 AND s.token_hash=? AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','+23 hours','+50 minutes') AND EXISTS(${activeSQL} AND ac.revision=?)`).bind(key.id,b64(key.publicKey),key.counter,visitor,project,challenge.access_id,challenge.session_hash,project,challenge.activation_revision).run();
  if (result.meta.changes!==1) throw new BackendError(401,'Sign in again before adding a passkey');
  return {visitorId:visitor};
 }
 const recoveryCode=newSessionToken();
 const results=await db.batch([
  db.prepare(`INSERT INTO app_visitors(id,project_id,access_id) SELECT ?,i.project_id,i.access_id FROM app_invitations i WHERE i.code_hash=? AND i.project_id=? AND i.access_id=? AND i.activation_revision=? AND i.used_by IS NULL AND i.revoked=0 AND i.expires_at>${nowSQL} AND EXISTS(${activeSQL} AND ac.revision=?)`).bind(visitor,challenge.invite_hash,project,challenge.access_id,challenge.activation_revision,project,challenge.activation_revision),
  db.prepare('INSERT INTO app_passkeys(id,visitor_id,public_key,counter) SELECT ?,id,?,? FROM app_visitors WHERE id=?').bind(key.id,b64(key.publicKey),key.counter,visitor),
  db.prepare('UPDATE app_invitations SET used_by=? WHERE code_hash=? AND EXISTS(SELECT 1 FROM app_visitors WHERE id=?)').bind(visitor,challenge.invite_hash,visitor),
  db.prepare('INSERT INTO app_recovery_codes(visitor_id,code_hash) SELECT id,? FROM app_visitors WHERE id=?').bind(await digest('recovery',recoveryCode),visitor),
  db.prepare('INSERT INTO app_sessions(token_hash,visitor_id) SELECT ?,id FROM app_visitors WHERE id=?').bind(sessionHash,visitor)
 ]);
 if (results[4].meta.changes!==1) throw new BackendError(403,'Application invitation changed or was already used');
 return {session,visitorId:visitor,recoveryCode};
}

export async function recoverAppVisitor(db:D1Database, project:string, code:string,nonce?:string) {
 const {access_id:access,revision}=await active(db,project);
 if (!tokenPattern.test(code)) throw new BackendError(401,'Invalid application recovery code');
 const hash=await digest('recovery',code), replacement=nonce?await replacementAppRecoveryCode(code,nonce):newSessionToken(), replacementHash=await digest('recovery',replacement), session=newSessionToken();
 const retryHash=nonce?replacementHash:hash;
 const row=await db.prepare('SELECT r.visitor_id FROM app_recovery_codes r JOIN app_visitors v ON v.id=r.visitor_id WHERE r.code_hash IN (?,?) AND v.project_id=? AND v.access_id=? AND v.revoked=0').bind(hash,retryHash,project,access).first<{visitor_id:string}>();
 if (!row) throw new BackendError(401,'Invalid application recovery code');
 // Recovery invalidates all old credentials, including sign-ins being verified.
 // The fresh session may add a replacement passkey without changing identity/data.
 const results=await db.batch([
  db.prepare(`UPDATE app_recovery_codes SET code_hash=? WHERE visitor_id=? AND code_hash IN (?,?) AND EXISTS(${activeSQL} AND ac.revision=?)`).bind(replacementHash,row.visitor_id,hash,retryHash,project,revision),
  db.prepare('DELETE FROM app_sessions WHERE visitor_id=? AND EXISTS(SELECT 1 FROM app_recovery_codes WHERE visitor_id=? AND code_hash=?)').bind(row.visitor_id,row.visitor_id,replacementHash),
  db.prepare('DELETE FROM app_passkeys WHERE visitor_id=? AND EXISTS(SELECT 1 FROM app_recovery_codes WHERE visitor_id=? AND code_hash=?)').bind(row.visitor_id,row.visitor_id,replacementHash),
  db.prepare('INSERT INTO app_sessions(token_hash,visitor_id) SELECT ?,visitor_id FROM app_recovery_codes WHERE visitor_id=? AND code_hash=?').bind(await digest('session',session),row.visitor_id,replacementHash)
 ]);
 if (results[3].meta.changes!==1) throw new BackendError(401,'Application recovery code changed or was already used');
 return {session,visitorId:row.visitor_id,recoveryCode:replacement};
}
