// The seven native identity operations. Passkey ceremonies are the shared web ceremonies run with client 'android' and the allowlisted
// apk-key-hash origin; sessions are native (client 'android'); the session cap (10) is the shared database trigger.
import {hashToken} from '../security';
import {identityPredicate,type IdentityPrincipal} from '../workspace-identity/authority';
import {loginOptions,nativeLoginVerify,nativeReauthenticationVerify,reauthenticationOptions} from '../workspace-identity/ceremonies';
import {identityChanged} from '../workspace-identity/protocol';
import {mapIdentityError} from './auth';
import {MobileError,credentialJson,fresh,minimumBuild,ok,readJson,signin,type MobileEnvironment} from './transport';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const iso=(seconds:number)=>new Date(seconds*1000).toISOString();
const freshUntil=(p:IdentityPrincipal)=>p.proof.verifiedAt+600;
const sessionBody=(p:IdentityPrincipal,token?:string)=>({session:{...(token?{token}:{}),expiresAt:iso(p.expiresAt),freshUntil:iso(freshUntil(p))}});
const verifyBody=async(request:Request)=>{
 const data=await readJson(request,['version','challengeId','credential']);
 if(typeof data.challengeId!=='string'||!uuid.test(data.challengeId))throw new MobileError('invalid_request');
 return {challengeId:data.challengeId,credential:credentialJson(data.credential)};
};
async function challenge(env:MobileEnvironment,made:{options:unknown;challengeId:string}){
 const row=await env.DB.prepare('SELECT expires_at FROM identity_challenges WHERE id=?').bind(made.challengeId).first<{expires_at:number}>();
 if(!row)throw new MobileError('unavailable');
 return ok({challengeId:made.challengeId,expiresAt:iso(row.expires_at),options:made.options});
}

export const config=(env:MobileEnvironment)=>ok({contract:1,minimumBuild:minimumBuild(env),rpId:'whumpo.com',browserReturn:'https://whumpo.com/app/return'});

export async function loginOptionsOperation(request:Request,env:MobileEnvironment){
 await readJson(request,['version']);
 try{const made=await loginOptions(request,env,{version:1},{});return await challenge(env,{...made,options:{...made.options,allowCredentials:made.options.allowCredentials??[]}});}catch(error){throw mapIdentityError(error,signin());}
}
export async function loginVerifyOperation(request:Request,env:MobileEnvironment){
 const {challengeId,credential}=await verifyBody(request);
 try{
  const issued=await nativeLoginVerify(env,challengeId,{version:1,credential});
  return ok(sessionBody(issued.principal,issued.token));
 }catch(error){throw mapIdentityError(error,signin());}
}
export async function reauthOptionsOperation(request:Request,env:MobileEnvironment,p:IdentityPrincipal){
 await readJson(request,['version']);
 try{return await challenge(env,await reauthenticationOptions(request,env,p,{version:1},{}));}catch(error){throw mapIdentityError(error,signin());}
}
/** The same token and the same absolute expiry: only the proof time (and so freshUntil) moves. */
export async function reauthVerifyOperation(request:Request,env:MobileEnvironment,p:IdentityPrincipal,token:string){
 const {challengeId,credential}=await verifyBody(request);
 try{return ok(sessionBody((await nativeReauthenticationVerify(env,p,challengeId,{version:1,credential},token)).principal));}
 catch(error){throw mapIdentityError(error,fresh());}
}
const mask=(email:string)=>{const at=email.lastIndexOf('@');return at<1?'***':email[0]+'***'+email.slice(at);};
export async function sessionOperation(env:MobileEnvironment,p:IdentityPrincipal){
 const gate=identityPredicate(env.DB,p,{purpose:'workspace',freshPasskey:false,bindIdentityRevision:false});
 const user=await env.DB.prepare(`SELECT email,unixepoch() AS now FROM users WHERE id=? AND ${gate.sql}`).bind(p.accountId,...gate.params).first<{email:string;now:number}>();
 if(!user)throw mapIdentityError(identityChanged(),signin());
 const live=p.proof.method==='passkey'&&freshUntil(p)>user.now;
 return ok({session:{expiresAt:iso(p.expiresAt),freshUntil:live?iso(freshUntil(p)):null},account:{label:mask(user.email)}});
}
export async function logoutOperation(request:Request,env:MobileEnvironment,token:string){
 await readJson(request,['version']);
 const hash=await hashToken(token);
 await env.DB.batch([
  env.DB.prepare("DELETE FROM identity_challenges WHERE authority_kind='session' AND authority_id IN (SELECT id FROM identity_sessions WHERE token_hash=? AND client='android')").bind(hash),
  env.DB.prepare("DELETE FROM identity_sessions WHERE token_hash=? AND client='android'").bind(hash)
 ]);
 return ok({signedOut:true});
}
