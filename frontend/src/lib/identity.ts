import {browserSupportsWebAuthn,startAuthentication,startRegistration} from '@simplewebauthn/browser';
import type {PublicKeyCredentialCreationOptionsJSON,PublicKeyCredentialRequestOptionsJSON} from '@simplewebauthn/browser';
import type {IdentityState,IdentityStateResponse} from '../../../src/workspace-identity/presentation';
export type {IdentityState,IdentityStateResponse,PreparedIdentityKit,IdentityOffer} from '../../../src/workspace-identity/presentation';
export class IdentityClientError extends Error{constructor(message:string,readonly code:string,readonly status:number){super(message)}}
/** Deliberately outside QueryClient: secrets and ceremony responses never enter shared caches. */
export async function identityRequest<T>(action:string,data:Record<string,unknown>={}):Promise<T>{
 let response:Response;
 try{response=await fetch('/api/auth/identity/v1/'+action,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',headers:{'content-type':'application/json'},body:JSON.stringify({version:1,...data})});}
 catch{throw new IdentityClientError('The reply did not arrive. Check saved progress before trying again.','uncertain',0);}
 let result;try{result=await response.json();}catch{throw new IdentityClientError('Whumpo could not confirm the result. Check saved progress.','uncertain',response.status);}
 if(!response.ok)throw new IdentityClientError(result.error??'This identity action could not finish.',result.code??'unavailable',response.status);
 if(result.version!==1)throw new IdentityClientError('Refresh Whumpo to use its current account flow.','client_upgrade_required',409);
 return result as T;
}
export const identityState=()=>identityRequest<IdentityStateResponse>('state');
export function identityIntent(s:IdentityState){return {requestId:crypto.randomUUID(),attemptId:s.attemptId,expectedRevision:s.expectedRevision,expectedEpoch:s.expectedEpoch};}
export function sameIdentityReview(a:IdentityState,b:IdentityState){return a.accountId===b.accountId&&a.attemptId===b.attemptId&&a.expectedEpoch===b.expectedEpoch&&a.expectedRevision===b.expectedRevision;}
export async function identityCeremony(kind:'signup'|'login'|'add'|'reauth'|'recovery/complete',data:Record<string,unknown>={}){
 if(!browserSupportsWebAuthn())throw Error('Use an up-to-date browser that supports passkeys to continue.');
 const result=await identityRequest<{options?:PublicKeyCredentialCreationOptionsJSON&PublicKeyCredentialRequestOptionsJSON;completed?:unknown}>(kind+'/options',data);
 if(result.completed)return;
 if(!result.options)throw Error('Refresh Whumpo to start a current passkey request.');
 let credential;
 try{credential=kind==='signup'||kind==='add'?await startRegistration({optionsJSON:result.options}):await startAuthentication({optionsJSON:result.options});}
 catch{throw Error('The passkey step was not completed. Your saved progress is unchanged. Try again or use another passkey provider.');}
 await identityRequest(kind+'/verify',{credential});
}
