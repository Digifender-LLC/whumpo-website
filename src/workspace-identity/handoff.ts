// WH-083 M3: the browser handoff. The app proves possession of a PKCE verifier, the browser proves a ready account with a fresh web passkey,
// and one 60-second code (stored hashed) turns the two into a native session. Only hashes are stored; a handoff creates no freshness.
import {hashToken,newSessionToken} from '../security';
import {IdentityError,assertCurrentIdentity,identityPredicate,type IdentityPrincipal} from './authority';
import {cleanIdentityCeremonies} from './ceremonies';
import {identityChanged,identityRecord,identityUnavailable,invalidIdentityRequest,type IdentityEnvironment} from './protocol';

export const handoffReturn='https://whumpo.com/app/return';
const denied=()=>new IdentityError(401,'proof_required','Sign in to continue.');
const b64url=(bytes:ArrayBuffer)=>btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
function shape(v:unknown,re:RegExp):string{if(typeof v!=='string'||!re.test(v))throw invalidIdentityRequest();return v;}

/** Anonymous: records purpose, state and the S256 challenge; returns the browser token (hashed at rest). */
export async function startHandoff(env:IdentityEnvironment,input:{purpose:unknown;state:unknown;codeChallenge:unknown}){
 if(input.purpose!=='signin'&&input.purpose!=='signup'&&input.purpose!=='recovery')throw invalidIdentityRequest();
 const state=shape(input.state,/^[A-Za-z0-9_-]{16,128}$/),challenge=shape(input.codeChallenge,/^[A-Za-z0-9_-]{43}$/);
 await cleanIdentityCeremonies(env.DB);
 const id=crypto.randomUUID(),token=newSessionToken();
 try{
  const row=await env.DB.prepare('INSERT INTO identity_handoffs(id,browser_token_hash,purpose,state,code_challenge,redirect_uri,created_at,expires_at) SELECT ?,?,?,?,?,?,unixepoch(),unixepoch()+300 RETURNING expires_at')
   .bind(id,await hashToken(token),input.purpose,state,challenge,handoffReturn).first<{expires_at:number}>();
  if(!row)throw identityUnavailable();
  return {id,browserToken:token,expiresAt:row.expires_at};
 }catch(error){
  if(error instanceof IdentityError)throw error;
  throw identityUnavailable(); // includes the 2000-row cap
 }
}

/** Cookie-authenticated web session with a fresh passkey proof on a ready account with two active keys. Binds the handoff and issues the code. */
export async function completeHandoff(env:IdentityEnvironment,p:IdentityPrincipal,input:unknown){
 const data=identityRecord(input,['version','browserToken']),browserToken=shape(data.browserToken,/^[a-f0-9]{64}$/),db=env.DB;
 if(p.kind!=='session'||p.purpose!=='workspace'||p.client!=='web')throw new IdentityError(403,'identity_incomplete','Finish setting up your account in the browser before returning to the app.');
 const policy={purpose:'workspace' as const,freshPasskey:true,bindIdentityRevision:true};
 await assertCurrentIdentity(db,p,policy); // proof_required when the passkey is stale: the page reauthenticates and retries
 const keys="(SELECT count(*) FROM identity_credentials WHERE account_id=? AND status='active')";
 if(((await db.prepare(`SELECT ${keys} AS n`).bind(p.accountId).first<{n:number}>())?.n??0)<2)throw new IdentityError(403,'identity_incomplete','Add a second passkey before returning to the app.');
 const gate=identityPredicate(db,p,policy),code=newSessionToken();
 let rows;
 try{
  rows=await db.prepare(`UPDATE identity_handoffs SET account_id=?,source_session_id=?,auth_epoch=?,code_hash=?,code_issued_at=unixepoch(),code_expires_at=unixepoch()+60
   WHERE browser_token_hash=? AND account_id IS NULL AND expires_at>unixepoch() AND ${keys}>=2 AND ${gate.sql} RETURNING state,redirect_uri`)
   .bind(p.accountId,p.authorityId,p.authEpoch,await hashToken(code),await hashToken(browserToken),p.accountId,...gate.params).all<{state:string;redirect_uri:string}>();
 }catch{throw identityChanged();}
 const row=rows.results[0];
 if(!row)throw identityChanged();
 return {returnUrl:`${row.redirect_uri}?code=${code}&state=${row.state}`};
}

/** Anonymous: verifies state and PKCE, consumes the code once and mints an android session carrying the SOURCE proof time (so no freshness). */
export async function exchangeHandoff(env:IdentityEnvironment,input:{handoffId:string;code:string;state:string;codeVerifier:string}){
 const db=env.DB,codeHash=await hashToken(input.code);
 const row=await db.prepare('SELECT state,code_challenge FROM identity_handoffs WHERE id=? AND code_hash=? AND native_session_id IS NULL AND code_expires_at>unixepoch() AND expires_at>unixepoch()')
  .bind(input.handoffId,codeHash).first<{state:string;code_challenge:string}>();
 if(!row)throw denied();
 const challenge=b64url(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(input.codeVerifier)));
 if(row.state!==input.state||row.code_challenge!==challenge){
  // A holder of the code with the wrong state or verifier burns it: no second guess.
  await db.prepare('DELETE FROM identity_handoffs WHERE id=? AND code_hash=? AND native_session_id IS NULL').bind(input.handoffId,codeHash).run();
  throw denied();
 }
 const token=newSessionToken(),sessionId=crypto.randomUUID();
 // One transaction: claim the handoff against the CURRENT source session (epoch, stage, key, expiry), then mint from it.
 const [,minted]=await db.batch([
  db.prepare(`UPDATE identity_handoffs SET native_session_id=? WHERE id=? AND code_hash=? AND native_session_id IS NULL AND code_expires_at>unixepoch() AND expires_at>unixepoch()
   AND EXISTS(SELECT 1 FROM identity_current_authorities c WHERE c.authority_id=identity_handoffs.source_session_id AND c.kind='session' AND c.client='web'
    AND c.account_id=identity_handoffs.account_id AND c.auth_epoch=identity_handoffs.auth_epoch)
   AND (SELECT count(*) FROM identity_credentials WHERE account_id=identity_handoffs.account_id AND status='active')>=2`).bind(sessionId,input.handoffId,codeHash),
  db.prepare(`INSERT INTO identity_sessions SELECT ?,?,h.account_id,1,h.auth_epoch,'android',s.credential_id,'handoff',s.proof_at,unixepoch(),s.expires_at,?,s.lineage_id
   FROM identity_handoffs h JOIN identity_sessions s ON s.id=h.source_session_id WHERE h.id=? AND h.native_session_id=? RETURNING expires_at`).bind(sessionId,await hashToken(token),sessionId,input.handoffId,sessionId)
 ]);
 const session=minted.results[0] as {expires_at:number}|undefined;
 if(!session)throw denied();
 return {token,expiresAt:session.expires_at};
}

/** Read-only, for the consent page: what an open handoff asks for. Needs an ordinary session; reveals only the purpose of an unbound, unexpired handoff. */
export async function previewHandoff(env:IdentityEnvironment,p:IdentityPrincipal,input:unknown){
 const data=identityRecord(input,['version','browserToken']),browserToken=shape(data.browserToken,/^[a-f0-9]{64}$/);
 if(p.kind!=='session'||p.purpose!=='workspace'||p.client!=='web')throw new IdentityError(403,'identity_incomplete','Finish setting up your account in the browser before returning to the app.');
 const row=await env.DB.prepare('SELECT purpose FROM identity_handoffs WHERE browser_token_hash=? AND account_id IS NULL AND expires_at>unixepoch()').bind(await hashToken(browserToken)).first<{purpose:string}>();
 if(!row)throw identityChanged();
 return {purpose:row.purpose};
}
