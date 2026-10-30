// WH-083 M3 native side of the browser handoff: start and exchange. Both are anonymous; the browser completes at /api/auth/identity/v1/handoff/complete.
import {exchangeHandoff,handoffReturn,startHandoff} from '../workspace-identity/handoff';
import {mapIdentityError} from './auth';
import {MobileError,ok,readJson,signin,type MobileEnvironment} from './transport';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,iso=(s:number)=>new Date(s*1000).toISOString();
function text(v:unknown,re:RegExp):string{if(typeof v!=='string'||!re.test(v))throw new MobileError('invalid_request');return v;}

export async function handoffStartOperation(request:Request,env:MobileEnvironment){
 const d=await readJson(request,['version','purpose','state','codeChallenge','codeChallengeMethod','redirectUri']);
 if(d.codeChallengeMethod!=='S256'||d.redirectUri!==handoffReturn)throw new MobileError('invalid_request');
 try{
  const h=await startHandoff(env,{purpose:d.purpose,state:d.state,codeChallenge:d.codeChallenge});
  return ok({handoffId:h.id,browserPath:'/workspace/native/'+h.browserToken,expiresAt:iso(h.expiresAt)});
 }catch(error){throw mapIdentityError(error,signin());}
}
export async function handoffExchangeOperation(request:Request,env:MobileEnvironment){
 const d=await readJson(request,['version','handoffId','code','state','codeVerifier']);
 const input={handoffId:text(d.handoffId,uuid),code:text(d.code,/^[0-9a-f]{64}$/),state:text(d.state,/^[A-Za-z0-9_-]{16,128}$/),codeVerifier:text(d.codeVerifier,/^[A-Za-z0-9_-]{43,128}$/)};
 try{
  const s=await exchangeHandoff(env,input);
  // A handoff proves no passkey now: freshUntil is null and the session must reauthenticate before any fresh-passkey control.
  return ok({session:{token:s.token,expiresAt:iso(s.expiresAt),freshUntil:null}});
 }catch(error){throw mapIdentityError(error,signin());}
}
