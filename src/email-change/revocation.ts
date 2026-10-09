/** WH-063 / WH-203 provider-connection revocation after a compromise review (contract version 1,
 * docs/email-change-and-compromise.md "Provider connections: revoke at the provider before local erasure"). Pure
 * functions over plain connection records plus one injected adapter, the ProviderRevoker.
 *
 * Order: local access is disabled first, so no capability can use the credential; the encrypted credential is kept as
 * reconciliation authority; revocation is dispatched once per claimed attempt; the credential is erased only with an
 * exact receipt (the existing adapters: GitHub single-token 204, Cloudflare RFC 7009 200). A timeout, throw, lost
 * response, unrecognized reply or an attempt interrupted after its claim is `uncertain`: the hold and the credential
 * stay, erasure and account closure are blocked, and nothing is redispatched. Reconciliation is read-only and takes
 * authenticated provider evidence ("not found" is not proof); after a bounded number of reads or time it becomes
 * `unresolved` and stays for operator attention. A definitive refusal that changed nothing returns to the queue for the
 * same retired credential. These records never hold credential material: `credentialHeld` says whether the caller
 * still keeps the ciphertext, and only the adapter behind ProviderRevoker ever decrypts it. */
import {authorizeOwner,check,plain} from './policy';
import type {AccountEmail,OwnerPrincipal} from './policy';

const DAY=24*60*60000;
/** Recommended v1 values: 3 authenticated reads in 72 hours before an uncertain hold becomes unresolved. */
export const revocationBounds=Object.freeze({reconcileReads:3,reconcileWindowMs:3*DAY});
export const revocationStates=Object.freeze(['none','queued','dispatching','revoked','uncertain','unresolved'] as const);
export type RevocationState=typeof revocationStates[number];
export type RevocationReceipt={connectionId:string;at:number;evidence:'direct'|'reconciled'};
export type ProviderConnection={
 connectionId:string;accountId:string;provider:string;
 /** Local capability access. `disabled` takes effect before any provider call. */
 access:'active'|'disabled';
 /** True while the caller still holds the encrypted credential (reconciliation authority). */
 credentialHeld:boolean;
 revocation:{state:RevocationState;attempts:number;reads:number;since:number|null;receipt:RevocationReceipt|null};
 revision:number;
};
/** States in which a held credential blocks erasure and account closure. */
export const holdStates:readonly RevocationState[]=Object.freeze(['queued','dispatching','uncertain','unresolved']);

/** 'revoked' only for an exact provider receipt; 'not-revoked' only for a definitive refusal that changed nothing.
 * Anything else, including a throw, is an unknown outcome. */
export type RevokeOutcome='revoked'|'not-revoked';
export interface ProviderRevoker {revoke(request:{provider:string;connectionId:string}):Promise<RevokeOutcome|unknown>|RevokeOutcome|unknown}

const bump=(c:ProviderConnection,changes:Partial<ProviderConnection>,revocation?:Partial<ProviderConnection['revocation']>):ProviderConnection=>
 ({...c,...changes,revocation:{...c.revocation,...revocation},revision:c.revision+1});

/** Applied inside the compromise commit: disable local access immediately and queue revocation with the credential
 * retained. A revocation already queued, in flight, uncertain, unresolved or settled is left as it is, so a second
 * review never redispatches an outcome that is still unknown. */
export function disableForReview(connection:ProviderConnection):ProviderConnection {
 if(connection.revocation.state!=='none')return connection.access==='disabled'?connection:bump(connection,{access:'disabled'});
 return bump(connection,{access:'disabled'},{state:'queued',since:null,receipt:null});
}
/** Use of a connection by a capability: a current ordinary session of a ready account, and local access active. */
export function authorizeConnectionUse({principal,account,connection,now}:{principal:OwnerPrincipal|null;account:AccountEmail;connection:ProviderConnection|null;now:number}) {
 authorizeOwner(principal,account,{fresh:false,now});
 check(connection&&connection.accountId===account.accountId,'UNKNOWN_CONNECTION');
 check(connection.access==='active','CONNECTION_DISABLED');
 return {connectionId:connection.connectionId,provider:connection.provider};
}

export type DispatchStep={connection:ProviderConnection;outcome:'revoked'|'retry'|'unknown'|'not-queued'|'not-claimed'};
/** One revocation attempt. The caller commits the claimed (`dispatching`) record under its revision guard before the
 * single provider call; returning false from claim means another worker claimed first and nothing is sent. A record
 * found still `dispatching` (an interrupted attempt) is an unknown outcome and is never redispatched. */
export async function dispatchRevocation({connection,revoker,claim,now}:{connection:ProviderConnection;revoker:ProviderRevoker;claim:(claimed:ProviderConnection)=>Promise<boolean>|boolean;now:number}):Promise<DispatchStep> {
 if(connection.revocation.state==='dispatching')return {connection:bump(connection,{},{state:'uncertain',since:now}),outcome:'unknown'};
 if(connection.revocation.state!=='queued')return {connection,outcome:'not-queued'};
 const claimed=bump(connection,{},{state:'dispatching',attempts:connection.revocation.attempts+1});
 if(!await claim(claimed))return {connection,outcome:'not-claimed'};
 let outcome:unknown;
 try{outcome=await revoker.revoke({provider:connection.provider,connectionId:connection.connectionId});}catch{outcome='unknown';}
 // The exact receipt settles the hold; the credential is erased in the same write that records it.
 if(outcome==='revoked')return {connection:bump(claimed,{credentialHeld:false},{state:'revoked',receipt:{connectionId:connection.connectionId,at:now,evidence:'direct'}}),outcome:'revoked'};
 if(outcome==='not-revoked')return {connection:bump(claimed,{},{state:'queued'}),outcome:'retry'};
 return {connection:bump(claimed,{},{state:'uncertain',since:now}),outcome:'unknown'};
}
/** Authenticated provider evidence read by the adapter (never a revoke call). `revoked` is an exact provider
 * statement that the credential no longer works; `not-found` and anything else are not proof. */
export type ReconcileEvidence={authenticated:boolean;result:'revoked'|'not-found'|'active'|string};
/** Read-only reconciliation of an uncertain hold. */
export function reconcileRevocation({connection,evidence,now}:{connection:ProviderConnection|null;evidence:unknown;now:number}):ProviderConnection {
 check(connection,'UNKNOWN_CONNECTION');
 check(connection.revocation.state==='uncertain','NOT_UNCERTAIN',connection.revocation.state);
 check(plain(evidence)&&evidence.authenticated===true,'EVIDENCE_NOT_AUTHENTICATED');
 const reads=connection.revocation.reads+1;
 if(evidence.result==='revoked')return bump(connection,{credentialHeld:false},{state:'revoked',reads,receipt:{connectionId:connection.connectionId,at:now,evidence:'reconciled'}});
 const since=connection.revocation.since??now;
 const unresolved=reads>=revocationBounds.reconcileReads||now-since>=revocationBounds.reconcileWindowMs;
 return bump(connection,{},{state:unresolved?'unresolved':'uncertain',reads});
}
/** Local erasure (cleanup, account closure) of a credential: only with an exact revocation receipt. */
export function eraseConnectionCredential(connection:ProviderConnection|null):ProviderConnection {
 check(connection,'UNKNOWN_CONNECTION');
 check(connection.revocation.state==='revoked'&&connection.revocation.receipt!==null,'RECONCILIATION_HOLD',connection.revocation.state);
 return connection.credentialHeld?bump(connection,{credentialHeld:false}):connection;
}
/** Connections whose held credential blocks account closure: any revocation that is queued, in flight, uncertain or
 * unresolved. */
export function closureHolds(connections:readonly ProviderConnection[]):string[] {
 return connections.filter(c=>c.credentialHeld&&holdStates.includes(c.revocation.state)).map(c=>c.connectionId).sort();
}

/** Synthetic in-memory revoker for tests: no network, no provider and no credential. `decide` scripts an outcome per
 * request ('throw' simulates a lost response). Only the two providers that have revocation adapters today are
 * recognized; any other provider gets an unrecognized reply, which the dispatcher treats as unknown. */
export function createSyntheticRevoker({decide=()=>'revoked'}:{decide?:(request:{provider:string;connectionId:string})=>RevokeOutcome|'unknown'|'throw'}={}){
 const calls:{provider:string;connectionId:string}[]=[];
 return {
  calls,
  async revoke(request:{provider:string;connectionId:string}):Promise<RevokeOutcome|'unknown'|'unrecognized'>{
   calls.push({provider:request.provider,connectionId:request.connectionId});
   if(request.provider!=='github'&&request.provider!=='cloudflare')return 'unrecognized';
   const outcome=decide(request);
   if(outcome==='throw')throw new Error('synthetic transport loss');
   return outcome;
  },
 } satisfies ProviderRevoker&Record<string,unknown>;
}
