import {browserSupportsWebAuthn,startAuthentication,startRegistration} from '@simplewebauthn/browser';
import type {PublicKeyCredentialCreationOptionsJSON,PublicKeyCredentialRequestOptionsJSON} from '@simplewebauthn/browser';
import type {IdentityState,IdentityStateResponse} from '../../../src/workspace-identity/presentation';
import {announceIdentityChange,identityGeneration,invalidateIdentity} from './identity-invalidation';
export type {IdentityState,IdentityStateResponse,PreparedIdentityKit,IdentityOffer} from '../../../src/workspace-identity/presentation';
export class IdentityClientError extends Error{constructor(message:string,readonly code:string,readonly status:number){super(message)}}
export const identityChanged=()=>new IdentityClientError('Account access changed. Check your current account before continuing.','identity_changed',409);
// Reauthentication refreshes the same account proof. These actions can replace
// access or its epoch; other tabs must discard private state even on a lost reply.
const accessChanges=new Set(['logout','signup/verify','login/verify','recovery/start','kit/rotate','enrollment/complete','enrollment/cancel','recovery/secure','recovery/complete/verify','passkey/remove']);
const cookieChanges=new Set([...accessChanges,'reauth/verify']);
/** Deliberately outside QueryClient: secrets and ceremony responses never enter shared caches. */
export async function identityRequest<T>(action:string,data:Record<string,unknown>={}):Promise<T>{
 const generation=identityGeneration();
 if(action==='state'){
  // Wait for an already-running cookie exchange, then release the barrier
  // before reading. A held state response must never hold up sign-out.
  await navigator.locks.request('whumpo.identity-access',{mode:'shared'},()=>{});
  if(generation!==identityGeneration())throw identityChanged();
 }
 if(!cookieChanges.has(action))return identityFetch<T>(action,data,generation);
 // Serialize the HTTP exchanges that set/clear HttpOnly access cookies, not the
 // user's passkey prompt. A late refresh cookie must arrive before a queued
 // sign-out clears it. A generation check alone cannot fence Set-Cookie.
 return navigator.locks.request('whumpo.identity-access',()=>{
  if(action!=='logout'&&generation!==identityGeneration())throw identityChanged();
  return identityFetch<T>(action,data,action==='logout'?identityGeneration():generation);
 });
}
async function identityFetch<T>(action:string,data:Record<string,unknown>,generation:number):Promise<T>{
 const changesAccess=accessChanges.has(action);
 let response:Response;
 try{response=await fetch('/api/auth/identity/v1/'+action,{method:'POST',credentials:'same-origin',cache:'no-store',redirect:'error',...(action==='state'||cookieChanges.has(action)?{signal:AbortSignal.timeout(15000)}:{}),headers:{'content-type':'application/json'},body:JSON.stringify({version:1,...data})});}
 catch{if(changesAccess)invalidateIdentity(true);if(generation!==identityGeneration())throw identityChanged();throw new IdentityClientError('The reply did not arrive. Check saved progress before trying again.','uncertain',0);}
 // Cookies may already have changed even if the response body is lost or this
 // request belongs to a discarded view. Never replay the mutation automatically.
 if(changesAccess)announceIdentityChange();
 let result;try{result=await response.json();}catch{if(changesAccess)invalidateIdentity();if(generation!==identityGeneration())throw identityChanged();throw new IdentityClientError('Whumpo could not confirm the result. Check saved progress.','uncertain',response.status);}
 if(generation!==identityGeneration()){if(changesAccess)invalidateIdentity();throw identityChanged();}
 if(!response.ok)throw new IdentityClientError(result.error??'This identity action could not finish.',result.code??'unavailable',response.status);
 if(result.version!==1)throw new IdentityClientError('Refresh Whumpo to use its current account flow.','client_upgrade_required',409);
 return result as T;
}
export async function identityState():Promise<IdentityStateResponse>{
 try{return await identityRequest<IdentityStateResponse>('state');}
 catch(error){if(error instanceof IdentityClientError&&error.code==='proof_required')return {version:1,identity:null};throw error;}
}
export function identityIntent(s:IdentityState){return {requestId:crypto.randomUUID(),attemptId:s.attemptId,expectedRevision:s.expectedRevision,expectedEpoch:s.expectedEpoch};}
export function sameIdentityReview(a:IdentityState,b:IdentityState){return a.accountId===b.accountId&&a.attemptId===b.attemptId&&a.expectedEpoch===b.expectedEpoch&&a.expectedRevision===b.expectedRevision;}
export async function identityCeremony(kind:'signup'|'login'|'add'|'reauth'|'recovery/complete',data:Record<string,unknown>={}){
 const generation=identityGeneration();
 if(!browserSupportsWebAuthn())throw Error('Use an up-to-date browser that supports passkeys to continue.');
 const result=await identityRequest<{options?:PublicKeyCredentialCreationOptionsJSON&PublicKeyCredentialRequestOptionsJSON;completed?:unknown}>(kind+'/options',data);
 if(result.completed)return;
 if(!result.options)throw Error('Refresh Whumpo to start a current passkey request.');
 let credential;
 try{credential=kind==='signup'||kind==='add'?await startRegistration({optionsJSON:result.options}):await startAuthentication({optionsJSON:result.options});}
 catch{throw Error('The passkey step was not completed. Your saved progress is unchanged. Try again or use another passkey provider.');}
 if(generation!==identityGeneration())throw identityChanged();
 await identityRequest(kind+'/verify',{credential});
}
