import {generateAuthenticationOptions,generateRegistrationOptions,verifyAuthenticationResponse,verifyRegistrationResponse,type AuthenticationResponseJSON,type RegistrationResponseJSON} from '@simplewebauthn/server';
import {customerEligibilityVersion} from '../content-policy';
import {hashToken,newSessionToken} from '../security';
import {IdentityError,assertCurrentIdentity,identityPredicate,resolveIdentity,type IdentityPrincipal,type IdentityPolicy} from './authority';

import {identityRecord as record,identityRequestContext as context,identityDatabaseError as databaseError,identityChanged as changed,identityUnavailable as unavailable,invalidIdentityRequest as invalid,identityUUID as uuid,type IdentityEnvironment as Environment} from './protocol';
type Kind='signup'|'login'|'add'|'reauth';
type Challenge={id:string;kind:Kind;challenge:string;origin:string;rp_id:string;policy_version:number;client:string;account_id:string|null;
 email:string|null;invite_hash:string|null;eligibility_version:string|null;authority_id:string|null;authority_kind:string|null;
 auth_epoch:number|null;credential_revision:number|null;attempt_id:string|null;attempt_revision:number|null;
 request_id:string;request_hash:string;credential_name:string|null;expires_at:number;consumed_at:number};
type Candidate={id:string;account_id:string;public_key:ArrayBuffer|number[];counter:number;stage:IdentityPrincipal['stage'];
 auth_epoch:number;credential_revision:number;kit_generation:number;attempt_id:string|null;attempt_revision:number|null};
type Receipt={id:string;account_id:string;kind:Kind;request_hash:string;credential_id:string;attempt_id:string|null;created_at:number};
const encoder=new TextEncoder();
const proof=()=>new IdentityError(401,'proof_required','Passkey verification failed or expired. Start verification again.');
function credential(value:unknown){
 if(!value||typeof value!=='object'||Array.isArray(value))throw proof();
 try{
  if(encoder.encode(JSON.stringify(value)).length>65536)throw proof();
  const response=(value as {response?:{clientDataJSON?:unknown}}).response,raw=response?.clientDataJSON;
  if(typeof raw!=='string'||raw.length>8192)throw proof();
  const bytes=Uint8Array.from(atob(raw.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  const data=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes));
  if(!data||typeof data!=='object'||(data.crossOrigin!==undefined&&data.crossOrigin!==false)||data.topOrigin!==undefined)throw proof();
 }catch{throw proof();}
 return value;
}
function operationPolicy(p:IdentityPrincipal):IdentityPolicy{return {purpose:p.purpose,freshPasskey:p.kind==='session',bindIdentityRevision:true};}
const receiptGate='EXISTS(SELECT 1 FROM identity_ceremony_receipts WHERE id=? AND execution_nonce=?)';
export async function cleanIdentityCeremonies(db:D1Database){
 // Bounded, expired admission only. Verified pending progress is never timed out.
 await db.batch([
  db.prepare('DELETE FROM identity_challenges WHERE id IN (SELECT id FROM identity_challenges WHERE expires_at<=unixepoch() ORDER BY expires_at LIMIT 500)'),
  db.prepare('DELETE FROM identity_grants WHERE id IN (SELECT id FROM identity_grants WHERE expires_at<=unixepoch() ORDER BY expires_at LIMIT 500)'),
  db.prepare('DELETE FROM identity_sessions WHERE id IN (SELECT id FROM identity_sessions WHERE expires_at<=unixepoch() ORDER BY expires_at LIMIT 500)'),
  db.prepare('DELETE FROM identity_ceremony_receipts WHERE id IN (SELECT id FROM identity_ceremony_receipts WHERE created_at<=unixepoch()-604800 ORDER BY created_at LIMIT 500)'),
  db.prepare('DELETE FROM identity_kit_offers WHERE id IN (SELECT id FROM identity_kit_offers WHERE expires_at<=unixepoch() ORDER BY expires_at LIMIT 500)'),
  db.prepare('DELETE FROM identity_effect_receipts WHERE id IN (SELECT id FROM identity_effect_receipts WHERE created_at<=unixepoch()-604800 ORDER BY created_at LIMIT 500)')
 ]);
}
async function turnstile(request:Request,env:Environment,token:unknown,origin:string){
 if(!env.TURNSTILE_SECRET)throw unavailable();
 if(typeof token!=='string'||token.length<1||token.length>2048)throw invalid();
 try{
  const response=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',redirect:'error',
   headers:{'content-type':'application/json'},body:JSON.stringify({secret:env.TURNSTILE_SECRET,response:token,remoteip:request.headers.get('cf-connecting-ip')}),signal:AbortSignal.timeout(10000)});
  if(!response.ok||!response.body)throw unavailable();
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>8192)throw unavailable();chunks.push(next.value);}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const result=JSON.parse(new TextDecoder().decode(bytes));
  if(result?.success!==true||result.hostname!==new URL(origin).hostname||result.action!=='register')throw proof();
 }catch(error){if(error instanceof IdentityError)throw error;throw unavailable();}
}
async function consume(db:D1Database,token:unknown,kind:Kind,rp:ReturnType<typeof context>){
 if(typeof token!=='string'||!/^[0-9a-f]{64}$/.test(token))throw proof();
 // Invalid responses and wrong-kind attempts burn the presented challenge too.
 const c=await db.prepare('DELETE FROM identity_challenges WHERE token_hash=? RETURNING *,unixepoch() AS consumed_at').bind(await hashToken(token)).first<Challenge>();
 if(!c||c.kind!==kind||c.expires_at<=c.consumed_at||c.policy_version!==1||c.client!=='web'||c.origin!==rp.origin||c.rp_id!==rp.rpID)throw proof();
 return c;
}
async function saveChallenge(db:D1Database,rp:ReturnType<typeof context>,kind:Kind,challenge:string,fields:{accountId?:string;email?:string;inviteHash?:string;p?:IdentityPrincipal;requestId:string;requestHash:string;name?:string}){
 const id=crypto.randomUUID(),token=newSessionToken(),p=fields.p;
 const gate=p?identityPredicate(db,p,kind==='reauth'?{purpose:p.purpose,freshPasskey:false,bindIdentityRevision:true}:operationPolicy(p)):null;
 // INSERT ... SELECT allows the same committing guard as credential changes.
 const query=`INSERT INTO identity_challenges SELECT ?,?,?,?,1,'web',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,unixepoch(),unixepoch()+300${gate?` WHERE ${gate.sql}`:''}`;
 const statement=db.prepare(query).bind(id,await hashToken(token),challenge,kind,rp.origin,rp.rpID,fields.accountId??p?.accountId??null,fields.email??null,fields.inviteHash??null,kind==='signup'?customerEligibilityVersion:null,
  p?.authorityId??null,p?.kind??null,p?.authEpoch??null,p?.credentialRevision??null,p?.attempt?.id??null,p?.attempt?.revision??null,fields.requestId,fields.requestHash,fields.name??null,...(gate?.params??[]));
 try{if((await statement.run()).meta.changes!==1)throw changed();}catch(error){databaseError(error);}
 return {challengeToken:token};
}
async function registration(db:D1Database,rp:ReturnType<typeof context>,accountId:string,email:string){
 const keys=await db.prepare('SELECT id FROM identity_credentials WHERE account_id=? ORDER BY id').bind(accountId).all<{id:string}>();
 if(keys.results.length>=10)throw new IdentityError(409,'identity_changed','Ten passkeys are already saved. Review a removal before adding another.');
 return generateRegistrationOptions({rpName:'Whumpo',rpID:rp.rpID,userName:email,userID:new Uint8Array(encoder.encode(accountId)),attestationType:'none',
  excludeCredentials:keys.results.map(k=>({id:k.id})),supportedAlgorithmIDs:[-7,-257],authenticatorSelection:{residentKey:'required',userVerification:'required'}});
}
export async function signupOptions(request:Request,env:Environment,input:unknown){
 const rp=context(request,env),data=record(input,['version','email','inviteCode','usBased','turnstileToken']);
 if(data.usBased!==true)throw new IdentityError(403,'invalid_identity_request','Confirm that you or your organization are based in the United States.');
 if(typeof data.email!=='string'||data.email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())||typeof data.inviteCode!=='string'||data.inviteCode.length>256)throw invalid();
 const email=data.email.trim().toLowerCase(),inviteHash=await hashToken(data.inviteCode.trim());
 if(!await env.DB.prepare("SELECT 1 FROM invitations WHERE code_hash=? AND used_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(inviteHash).first())throw proof();
 await turnstile(request,env,data.turnstileToken,rp.origin);
 if(await env.DB.prepare('SELECT 1 FROM users WHERE email=?').bind(email).first())throw changed();
 await cleanIdentityCeremonies(env.DB);
 const accountId=crypto.randomUUID(),requestId=crypto.randomUUID(),options=await registration(env.DB,rp,accountId,email);
 const saved=await saveChallenge(env.DB,rp,'signup',options.challenge,{accountId,email,inviteHash,requestId,requestHash:await hashToken(JSON.stringify(['signup',accountId,email,inviteHash,customerEligibilityVersion]))});
 return {options,...saved};
}
async function verifyRegistration(c:Challenge,input:unknown){
 const response=credential(input) as RegistrationResponseJSON;
 try{
  const verified=await verifyRegistrationResponse({response,expectedChallenge:c.challenge,expectedOrigin:c.origin,expectedRPID:c.rp_id,requireUserVerification:true,supportedAlgorithmIDs:[-7,-257]});
  if(!verified.verified)throw proof();
  return verified.registrationInfo.credential;
 }catch{throw proof();}
}
async function issued(db:D1Database,kind:'session'|'grant',token:string){
 const principal=await resolveIdentity(db,{version:1,client:'web',kind,token});
 // Transport must put token in its matching secure HttpOnly cookie, never a JSON body/log.
 return {kind,token,principal};
}
export async function signupVerify(request:Request,env:Environment,challengeToken:unknown,input:unknown){
 const rp=context(request,env),c=await consume(env.DB,challengeToken,'signup',rp),data=record(input,['version','credential']);
 if(c.eligibility_version!==customerEligibilityVersion)throw changed();
 const key=await verifyRegistration(c,data.credential),attempt=crypto.randomUUID(),nonce=crypto.randomUUID(),grantId=crypto.randomUUID(),token=newSessionToken();
 const db=env.DB,account=c.account_id!;
 try{
  const result=await db.batch([
   db.prepare("INSERT INTO users(id,email,created_at) SELECT ?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM invitations WHERE code_hash=? AND used_at IS NULL AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') AND ?>unixepoch()")
    .bind(account,c.email,c.invite_hash,c.expires_at),
   db.prepare('UPDATE invitations SET used_by=?,used_at=unixepoch() WHERE code_hash=? AND used_at IS NULL AND EXISTS(SELECT 1 FROM users WHERE id=?)').bind(account,c.invite_hash,account),
   db.prepare("INSERT INTO identity_accounts(account_id,policy_version,stage,auth_epoch,current_attempt_id) SELECT id,1,'enrolling',1,? FROM users WHERE id=?").bind(attempt,account),
   db.prepare("INSERT INTO identity_attempts SELECT ?,account_id,'enrollment','open',0,1,0,unixepoch() FROM identity_accounts WHERE account_id=?").bind(attempt,account),
   db.prepare("INSERT INTO identity_credentials SELECT ?,account_id,?,?,'First passkey','staged',?,unixepoch(),NULL FROM identity_accounts WHERE account_id=?")
    .bind(key.id,key.publicKey,key.counter,attempt,account),
   db.prepare("INSERT INTO customer_eligibility(user_id,declaration_version,country_scope,signup_method) SELECT account_id,?,'US','passkey' FROM identity_accounts WHERE account_id=?").bind(customerEligibilityVersion,account),
   db.prepare("INSERT INTO identity_ceremony_receipts SELECT ?,?,account_id,'signup',?,?,?,unixepoch() FROM identity_accounts WHERE account_id=?").bind(c.request_id,nonce,c.request_hash,key.id,attempt,account),
   db.prepare(`INSERT INTO identity_grants SELECT ?,?,account_id,1,auth_epoch,'web','enrollment',id,'registration',unixepoch(),revision,?,NULL,unixepoch(),unixepoch()+1800 FROM identity_attempts WHERE id=? AND ${receiptGate}`)
    .bind(grantId,await hashToken(token),key.id,attempt,c.request_id,nonce)
  ]);
  if(result[0].meta.changes!==1||result[7].meta.changes!==1)throw changed();
 }catch(error){databaseError(error);}
 return issued(db,'grant',token);
}

function intent(input:unknown){
 const data=record(input,['version','requestId','attemptId','expectedRevision','name']);
 if(typeof data.requestId!=='string'||!uuid.test(data.requestId)||(data.attemptId!==null&&(typeof data.attemptId!=='string'||!uuid.test(data.attemptId)))
  ||typeof data.expectedRevision!=='number'||!Number.isSafeInteger(data.expectedRevision)||data.expectedRevision<0
  ||typeof data.name!=='string'||!data.name.trim()||data.name.length>100)throw invalid();
 return {requestId:data.requestId,attemptId:data.attemptId,expectedRevision:data.expectedRevision,name:data.name.trim()};
}
export async function addPasskeyOptions(request:Request,env:Environment,p:IdentityPrincipal,input:unknown){
 const rp=context(request,env),change=intent(input),requestHash=await hashToken(JSON.stringify(['add',p.accountId,change]));
 await assertCurrentIdentity(env.DB,p,{purpose:p.purpose,freshPasskey:false,bindIdentityRevision:false});
 const receipt=await env.DB.prepare('SELECT id,account_id,kind,request_hash,credential_id,attempt_id,created_at FROM identity_ceremony_receipts WHERE id=? AND account_id=?').bind(change.requestId,p.accountId).first<Receipt>();
 if(receipt){
  if(receipt.kind!=='add'||receipt.request_hash!==requestHash)throw new IdentityError(409,'request_conflict','This request ID already belongs to a different change.');
  return {completed:{operationId:receipt.id,credentialId:receipt.credential_id}};
 }
 if(await env.DB.prepare('SELECT 1 FROM identity_effect_receipts WHERE id=?').bind(change.requestId).first())throw new IdentityError(409,'request_conflict','This request ID already belongs to a different change.');
 if(change.attemptId!==(p.attempt?.id??null)||change.expectedRevision!==(p.attempt?.revision??p.credentialRevision))throw changed();
 await assertCurrentIdentity(env.DB,p,operationPolicy(p));
 if(p.purpose==='recovery'&&!await env.DB.prepare("SELECT 1 FROM identity_attempts WHERE id=? AND account_id=? AND status='secured'").bind(p.attempt!.id,p.accountId).first())throw changed();
 const user=await env.DB.prepare('SELECT email FROM users WHERE id=?').bind(p.accountId).first<{email:string}>();if(!user)throw changed();
 await cleanIdentityCeremonies(env.DB);
 const options=await registration(env.DB,rp,p.accountId,user.email);
 const saved=await saveChallenge(env.DB,rp,'add',options.challenge,{p,requestId:change.requestId,requestHash,name:change.name});
 return {options,...saved};
}
function boundPrincipal(c:Challenge,p:IdentityPrincipal){
 if(c.account_id!==p.accountId||c.authority_id!==p.authorityId||c.authority_kind!==p.kind||c.auth_epoch!==p.authEpoch
  ||c.credential_revision!==p.credentialRevision||c.attempt_id!==(p.attempt?.id??null)||c.attempt_revision!==(p.attempt?.revision??null))throw changed();
}
export async function addPasskeyVerify(request:Request,env:Environment,p:IdentityPrincipal,challengeToken:unknown,input:unknown){
 const rp=context(request,env),c=await consume(env.DB,challengeToken,'add',rp),data=record(input,['version','credential']);
 boundPrincipal(c,p);await assertCurrentIdentity(env.DB,p,operationPolicy(p));
 const key=await verifyRegistration(c,data.credential),gate=identityPredicate(env.DB,p,operationPolicy(p)),nonce=crypto.randomUUID();
 try{
  const result=await env.DB.batch([
   env.DB.prepare(`INSERT INTO identity_ceremony_receipts SELECT ?,?,?,'add',?,?,?,unixepoch() WHERE ?>unixepoch() AND ${gate.sql}`)
    .bind(c.request_id,nonce,p.accountId,c.request_hash,key.id,c.attempt_id,c.expires_at,...gate.params),
   env.DB.prepare(`INSERT INTO identity_credentials SELECT ?,?,?,?, ?,?,?,unixepoch(),NULL WHERE ${receiptGate} RETURNING id`)
    .bind(key.id,p.accountId,key.publicKey,key.counter,c.credential_name,p.kind==='session'?'active':'staged',c.attempt_id,c.request_id,nonce)
  ]);
  if(result[0].meta.changes!==1||result[1].results.length!==1)throw changed();
 }catch(error){databaseError(error);}
 return {operationId:c.request_id,credentialId:key.id};
}

export async function loginOptions(request:Request,env:Environment,input:unknown){
 const rp=context(request,env);record(input,['version']);await cleanIdentityCeremonies(env.DB);
 const options=await generateAuthenticationOptions({rpID:rp.rpID,userVerification:'required'}),requestId=crypto.randomUUID();
 return {options,...await saveChallenge(env.DB,rp,'login',options.challenge,{requestId,requestHash:await hashToken(JSON.stringify(['login',requestId]))})};
}
export async function reauthenticationOptions(request:Request,env:Environment,p:IdentityPrincipal,input:unknown){
 const rp=context(request,env);record(input,['version']);
 await assertCurrentIdentity(env.DB,p,{purpose:p.purpose,freshPasskey:false,bindIdentityRevision:true});
 const keys=await env.DB.prepare('SELECT id FROM identity_authentication_candidates WHERE account_id=? ORDER BY id').bind(p.accountId).all<{id:string}>();
 if(!keys.results.length)throw proof();
 await cleanIdentityCeremonies(env.DB);
 const options=await generateAuthenticationOptions({rpID:rp.rpID,userVerification:'required',allowCredentials:keys.results.map(k=>({id:k.id}))}),requestId=crypto.randomUUID();
 return {options,...await saveChallenge(env.DB,rp,'reauth',options.challenge,{p,requestId,requestHash:await hashToken(JSON.stringify(['reauth',p.authorityId,p.authEpoch,p.attempt]))})};
}
async function authenticate(request:Request,env:Environment,challengeToken:unknown,input:unknown,p?:IdentityPrincipal){
 const rp=context(request,env),c=await consume(env.DB,challengeToken,p?'reauth':'login',rp),data=record(input,['version','credential']);
 if(p){boundPrincipal(c,p);await assertCurrentIdentity(env.DB,p,{purpose:p.purpose,freshPasskey:false,bindIdentityRevision:true});}
 const response=credential(data.credential) as AuthenticationResponseJSON;
 if(typeof response.id!=='string'||!/^[A-Za-z0-9_-]{1,1024}$/.test(response.id))throw proof();
 const key=await env.DB.prepare('SELECT * FROM identity_authentication_candidates WHERE id=?').bind(response.id).first<Candidate>();
 if(!key||(p&&key.account_id!==p.accountId))throw proof();
 const handle=btoa(String.fromCharCode(...encoder.encode(key.account_id))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
 const returnedHandle=response.response?.userHandle;
 if(p?(returnedHandle!=null&&returnedHandle!==handle):returnedHandle!==handle)throw proof();
 let newCounter:number;
 try{
  const result=await verifyAuthenticationResponse({response,expectedChallenge:c.challenge,expectedOrigin:c.origin,expectedRPID:c.rp_id,requireUserVerification:true,
   credential:{id:key.id,publicKey:new Uint8Array(key.public_key),counter:key.counter}});
  if(!result.verified)throw proof();newCounter=result.authenticationInfo.newCounter;
 }catch{throw proof();}
 const now=await env.DB.prepare('SELECT unixepoch() AS at').first<{at:number}>();if(!now)throw unavailable();
 const nonce=crypto.randomUUID(),token=newSessionToken(),tokenHash=await hashToken(token),authorityId=crypto.randomUUID();
 const gate=p?identityPredicate(env.DB,p,{purpose:p.purpose,freshPasskey:false,bindIdentityRevision:true}):null;
 const admission=env.DB.prepare(`INSERT INTO identity_ceremony_receipts SELECT ?,?,?,?, ?,?,?,unixepoch() FROM identity_authentication_candidates
  WHERE id=? AND account_id=? AND public_key=? AND counter=? AND stage=? AND auth_epoch=? AND credential_revision=? AND attempt_id IS ? AND attempt_revision IS ? AND ?>unixepoch()${gate?` AND ${gate.sql}`:''}`)
  .bind(c.request_id,nonce,key.account_id,c.kind,c.request_hash,key.id,key.attempt_id,key.id,key.account_id,new Uint8Array(key.public_key),key.counter,key.stage,key.auth_epoch,key.credential_revision,key.attempt_id,key.attempt_revision,c.expires_at,...(gate?.params??[]));
 // Reauthentication refreshes proof within the existing purpose. In particular, a
 // pre-secure recovery grant cannot become a workspace session through this path.
 const authorityKind=p?.kind??(key.stage==='ready'?'session':'grant');
 const attempt=p?.attempt??(key.attempt_id===null?null:{id:key.attempt_id,revision:key.attempt_revision!});
 const purpose=p?.purpose??(key.stage==='enrolling'?'enrollment':'recovery');
 const authority=authorityKind==='session'
  ?env.DB.prepare(`INSERT INTO identity_sessions SELECT ?,?,?,1,?,'web',?,'passkey',?,unixepoch(),? WHERE ${receiptGate} RETURNING id`)
   .bind(authorityId,tokenHash,key.account_id,key.auth_epoch,key.id,now.at,now.at+604800,c.request_id,nonce)
  :env.DB.prepare(`INSERT INTO identity_grants SELECT ?,?,?,1,?,'web',?,?,'passkey',?,?,?,NULL,unixepoch(),? WHERE ${receiptGate} RETURNING id`)
   .bind(authorityId,tokenHash,key.account_id,key.auth_epoch,purpose,attempt!.id,now.at,attempt!.revision,key.id,now.at+1800,c.request_id,nonce);
 try{
  const result=await env.DB.batch([admission,
   env.DB.prepare(`UPDATE identity_credentials SET counter=?,last_used_at=? WHERE id=? AND account_id=? AND ${receiptGate}`).bind(newCounter,now.at,key.id,key.account_id,c.request_id,nonce),
   ...(p?[env.DB.prepare(`DELETE FROM ${p.kind==='session'?'identity_sessions':'identity_grants'} WHERE id=? AND account_id=? AND ${receiptGate}`).bind(p.authorityId,p.accountId,c.request_id,nonce)]:[]),authority
  ]);
  if(result[0].meta.changes!==1||result[result.length-1].results.length!==1)throw changed();
 }catch(error){databaseError(error);}
 return issued(env.DB,authorityKind,token);
}
export const loginVerify=(request:Request,env:Environment,challengeToken:unknown,input:unknown)=>authenticate(request,env,challengeToken,input);
export const reauthenticationVerify=(request:Request,env:Environment,p:IdentityPrincipal,challengeToken:unknown,input:unknown)=>authenticate(request,env,challengeToken,input,p);
