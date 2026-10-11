/** WH-144 single-flight refresh custody and honest revocation (contract version 1, docs/connectors.md).
 * Pure decision module over an injected store port, vault, token transport and clock. It owns three things: when a
 * refresh credential may be used (only inside an admitted operation, one claimed call at a time), how a refreshed
 * credential is committed (rotation-safe, one compare-and-swap) and what a disconnect may honestly report as revoked.
 * UNWIRED: no Worker, route, D1 schema, environment or timer reaches it. The SQL adapter for `CustodyStore` and its
 * tables are deferred to the next schema cutover. Plaintext tokens exist only in local variables here: they never enter
 * an error, a result field, a log line or a non-ciphertext store field. */
import {availableProvider,catalogVaultContext,check,connectorCatalog,ConnectorContractError,plain,validateCatalog,type ConnectorCatalog,type ConnectorProviderEntry,type ConnectorProviderId} from './catalog';

/** Exactly the Consent vocabulary of docs/connectors.md for a credential that is not (re)connecting. */
export const custodyStates=Object.freeze(['active','reauthorization-required','revoking','revocation-pending','revocation-owner-action','revoked'] as const);
export type CustodyState=typeof custodyStates[number];
/** Bounds and lease lengths. A claim is a lease, not a lock: it only stops a second call while it has not expired. */
export const custodyLimits=Object.freeze({
 /** An access token expiring within this window is refreshed; a later expiry is returned without a provider call. */
 skewMs:30000,
 refreshLeaseMs:30000,revocationLeaseMs:60000,timeoutMs:10000,
 maxResponseBytes:16384,maxTokenLength:8192,maxRevocationWork:8,maxCallsPerAttempt:4,
});

export type CustodyClaim={claimId:string;expiresAt:number};
/** A sealed credential retained only so that it can be revoked. `recordId` is the vault record the ciphertext is bound to. */
export type RevocationWork={ciphertext:string;purpose:'token'|'refresh';recordId:string};
/** One credential. Every ciphertext here is sealed under the vault record id `${id}-${generation}` (custodyRecordId),
 * so a ciphertext copied from an earlier generation cannot be unsealed as the current one. */
export type CustodyRecord={
 id:string;ownerId:string;providerId:ConnectorProviderId;state:CustodyState;scopes:readonly string[];generation:number;
 accessCiphertext:string|null;accessExpiresAt:number|null;refreshCiphertext:string|null;
 refreshClaim:CustodyClaim|null;revocationClaim:CustodyClaim|null;revocationWork:readonly RevocationWork[];
};
export type CustodyNext={accessCiphertext:string;accessExpiresAt:number;scopes:readonly string[];refreshCiphertext:string};

/** Persistence port. Every method is ONE atomic compare-and-swap in the adapter (a conditional UPDATE or a single
 * transaction); the module assumes nothing across calls. Dispositions, in the exact terms an adapter must implement:
 * - claimRefresh: only if state is `active`, `generation` equals the argument and no unexpired refresh claim exists.
 * - commitRefresh: only if state is `active`, the stored refresh claim is `claimId` and generation is `fromGeneration`.
 *   Writes `next`, sets generation to fromGeneration+1 and clears the claim; the old refresh ciphertext is replaced by
 *   that same write and by nothing else.
 * - releaseRefreshClaim: clears the refresh claim iff it is `claimId`.
 * - markReauthorizationRequired: only if state is `active` and the stored claim is `claimId`; sets the state, clears
 *   access and refresh ciphertexts and the claim.
 * - beginRevocation: only if the owner matches; from `active`/`reauthorization-required` sets `revoking`, adds one to
 *   generation, clears the refresh claim and moves any held access/refresh ciphertext into `revocationWork` with record
 *   id custodyRecordId(id,generation before the bump) while clearing the record fields. Idempotent in every other state.
 *   Returns the record after the write, or null when the credential does not exist for that owner.
 * - claimRevocation: only in `revoking`/`revocation-pending`/`revocation-owner-action` with no unexpired claim.
 * - settleRevocation: only while the stored revocation claim is `claimId`. Removes the work whose ciphertext is listed,
 *   sets `state`, clears the claim and returns the stored state; a requested `revoked` with work remaining is stored as
 *   `revocation-pending`. Returns null when the claim is no longer held.
 * - stashRevocationWork: appends (deduplicated by ciphertext, bounded by custodyLimits.maxRevocationWork); a `revoked`
 *   credential with new work becomes `revocation-pending`. Returns false when it could not be stored. */
export interface CustodyStore {
 load(id:string):Promise<CustodyRecord|null>;
 claimRefresh(id:string,claim:CustodyClaim&{now:number;generation:number}):Promise<boolean>;
 commitRefresh(id:string,commit:{claimId:string;fromGeneration:number;next:CustodyNext}):Promise<boolean>;
 releaseRefreshClaim(id:string,claimId:string):Promise<boolean>;
 markReauthorizationRequired(id:string,claimId:string):Promise<boolean>;
 beginRevocation(id:string,ownerId:string):Promise<CustodyRecord|null>;
 claimRevocation(id:string,claim:CustodyClaim&{now:number}):Promise<boolean>;
 settleRevocation(id:string,claimId:string,settle:{state:'revoked'|'revocation-pending'|'revocation-owner-action';settled:readonly string[]}):Promise<CustodyState|null>;
 releaseRevocationClaim(id:string,claimId:string):Promise<boolean>;
 stashRevocationWork(id:string,work:RevocationWork):Promise<boolean>;
}
/** The vault is injected already bound to its keyring; the context is the catalog vault context. */
export type CustodyVault={seal(context:string,value:string):Promise<string>;unseal(context:string,ciphertext:string):Promise<string>};
export type CustodyClient={clientId:string;clientSecret?:string};
/** A fetch-shaped request. The transport must send it as is, follow no redirect, and never log `url` or `body`:
 * a HubSpot revocation carries the token in the URL path. */
export type CustodyRequest={url:string;method:'POST'|'DELETE';headers:Readonly<Record<string,string>>;body?:string;redirect:'manual';signal:AbortSignal};
export type CustodyResponse={status:number;body:ReadableStream<Uint8Array>|null};
export type CustodyUse={kind:'admitted-operation';ownerId:string;operationId:string};
/** The access token is a non-enumerable property: it survives only an explicit read, never JSON, spread or console output. */
export type AccessGrant=Readonly<{credentialId:string;generation:number;expiresAt:number;scopes:readonly string[];refreshed:boolean}>&{readonly accessToken:string};
export type CustodyOutcome={state:CustodyState;remote:boolean|'access-only';ownerAction:boolean;code?:string;reason?:string};
export type CustodyOptions={
 catalog?:ConnectorCatalog;store:CustodyStore;vault:CustodyVault;clients:Readonly<Partial<Record<ConnectorProviderId,CustodyClient>>>;
 transport:(request:CustodyRequest)=>Promise<CustodyResponse>;now:()=>number;newId:()=>string;
 /** Owner decision pending (docs/connectors.md open decision 3): false never sends a token in a URL path. */
 allowPathTokenRevocation?:boolean;
};

/** The vault record id every ciphertext of generation `generation` is bound to. */
export const custodyRecordId=(credentialId:string,generation:number)=>`${credentialId}-${generation}`;
const workRecordId=(credentialId:string,claimId:string)=>`${credentialId}-w-${claimId}`;
const tokenText=(value:unknown):value is string=>typeof value==='string'&&/^[\x21-\x7e]+$/.test(value)&&value.length<=custodyLimits.maxTokenLength;
const form=(fields:Record<string,string>)=>new URLSearchParams(fields).toString();

type Grant={accessToken:string;expiresIn:number;scopes:readonly string[];refreshToken:string|null};
type Rejected={code:'INVALID_TOKEN'|'SCOPE_WIDENED';issuedRefresh:string|null};
/** Admission of a token response. A refresh may narrow scopes but never widen them past what was granted or what the
 * catalog declares. `issuedRefresh` is kept even for a refused response so the issued credential can be revoked. */
function admitGrant(body:unknown,previous:readonly string[],entry:ConnectorProviderEntry):Grant|Rejected {
 if(!plain(body))return {code:'INVALID_TOKEN',issuedRefresh:null};
 const issued=tokenText(body.refresh_token)?body.refresh_token:null;
 const bad=(code:Rejected['code']):Rejected=>({code,issuedRefresh:issued});
 if(typeof body.token_type!=='string'||body.token_type.toLowerCase()!=='bearer'||!tokenText(body.access_token))return bad('INVALID_TOKEN');
 const lifetime=body.expires_in;
 if(typeof lifetime!=='number'||!Number.isSafeInteger(lifetime)||lifetime<1||lifetime>entry.authorization.maxAccessSeconds)return bad('INVALID_TOKEN');
 if(body.refresh_token!==undefined&&issued===null)return bad('INVALID_TOKEN');
 let scopes=previous;
 if(body.scope!==undefined){
  if(typeof body.scope!=='string')return bad('INVALID_TOKEN');
  const parts=body.scope.split(' ');
  if(parts.some(part=>!part))return bad('INVALID_TOKEN');
  if(!parts.every(part=>previous.includes(part)&&entry.scopes.includes(part)))return bad('SCOPE_WIDENED');
  scopes=previous.filter(scope=>parts.includes(scope));
 }
 return {accessToken:body.access_token,expiresIn:lifetime,scopes,refreshToken:issued};
}
/** Reads at most maxResponseBytes; a longer body is refused rather than truncated. */
async function readBounded(response:CustodyResponse):Promise<string> {
 if(response.body===null)return '';
 const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
 try{
  for(;;){
   const {done,value}=await reader.read();if(done)break;
   size+=value.byteLength;check(size<=custodyLimits.maxResponseBytes,'RESPONSE_TOO_LARGE','response');chunks.push(value);
  }
 }catch(error){await reader.cancel().catch(()=>{});throw error;}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
}
const drain=async(response:CustodyResponse)=>{try{await response.body?.cancel();}catch{/* already closed */}};
function parseJson(text:string):unknown {try{return JSON.parse(text);}catch{return undefined;}}

export function createCredentialCustody(options:CustodyOptions){
 const {catalog=connectorCatalog,store,vault,clients,transport,now,newId,allowPathTokenRevocation=false}=options;
 validateCatalog(catalog);
 check(store&&vault&&clients&&typeof transport==='function'&&typeof now==='function'&&typeof newId==='function','INVALID_CUSTODY_OPTIONS','custody');
 const clock=()=>{const value=now();check(Number.isFinite(value),'INVALID_CLOCK','custody');return value;};
 const context=(record:CustodyRecord,purpose:'token'|'refresh',recordId:string)=>catalogVaultContext(catalog,record.providerId,purpose,record.ownerId,recordId);
 const unsealed=async(record:CustodyRecord,purpose:'token'|'refresh',recordId:string,ciphertext:string)=>{
  try{return await vault.unseal(context(record,purpose,recordId),ciphertext);}
  catch{throw new ConnectorContractError('VAULT_UNAVAILABLE',record.providerId);}
 };
 function granted(record:CustodyRecord,accessToken:string,refreshed:boolean):AccessGrant {
  const view={credentialId:record.id,generation:record.generation,expiresAt:record.accessExpiresAt as number,scopes:[...record.scopes],refreshed};
  Object.defineProperty(view,'accessToken',{value:accessToken,enumerable:false});
  return Object.freeze(view) as unknown as AccessGrant;
 }
 const fresh=(record:CustodyRecord)=>record.accessCiphertext!==null&&record.accessExpiresAt!==null&&record.accessExpiresAt>clock()+custodyLimits.skewMs;
 async function currentGrant(record:CustodyRecord){
  const token=await unsealed(record,'token',custodyRecordId(record.id,record.generation),record.accessCiphertext as string);
  return granted(record,token,false);
 }
 /** Newly issued refresh credential that will not become custody: kept as encrypted revocation work, never dropped. */
 async function stash(record:CustodyRecord,claimId:string,token:string|null){
  if(token===null)return true;
  try{
   const recordId=workRecordId(record.id,claimId);
   return await store.stashRevocationWork(record.id,{ciphertext:await vault.seal(context(record,'refresh',recordId),token),purpose:'refresh',recordId});
  }catch{return false;}
 }
 const discarded=async(record:CustodyRecord,claimId:string,token:string|null)=>{
  throw new ConnectorContractError(await stash(record,claimId,token)?'REFRESH_DISCARDED':'REFRESH_DISCARDED_UNSTASHED',record.providerId);
 };
 const ownedRecord=async(ownerId:string,credentialId:string)=>{
  check(typeof ownerId==='string'&&typeof credentialId==='string','OWNER_MISMATCH','credential');
  const record=await store.load(credentialId);
  // One code for an unknown credential and another owner's: no credential-existence oracle.
  check(record!==null&&record.ownerId===ownerId,'OWNER_MISMATCH','credential');
  return record;
 };

 /** Returns an access token for an operation that has already been admitted, refreshing it only when it has expired
  * (within the skew window). There is no other entry point that can start a refresh. */
 async function refreshAccess(use:CustodyUse,credentialId:string):Promise<AccessGrant> {
  check(plain(use)&&use.kind==='admitted-operation'&&typeof use.ownerId==='string'&&typeof use.operationId==='string'&&use.operationId.length>0,'NOT_ADMITTED','use');
  const record=await ownedRecord(use.ownerId,credentialId);
  const entry=availableProvider(catalog,record.providerId);
  check(Object.hasOwn(entry.operations,use.operationId),'NOT_ADMITTED','operation');
  check(entry.authorization.refresh==='single-flight','REFRESH_NOT_ALLOWED',record.providerId);
  check(record.state!=='reauthorization-required','REAUTHORIZATION_REQUIRED',record.providerId);
  check(record.state==='active','CREDENTIAL_NOT_ACTIVE',record.providerId);
  if(fresh(record))return currentGrant(record);
  const client=Object.hasOwn(clients,record.providerId)?clients[record.providerId]:undefined;
  check(client!==undefined&&typeof client.clientId==='string'&&client.clientId.length>0,'CLIENT_NOT_CONFIGURED',record.providerId);

  const claimId=newId();
  if(!await store.claimRefresh(record.id,{claimId,expiresAt:clock()+custodyLimits.refreshLeaseMs,now:clock(),generation:record.generation})){
   // Another use holds the claim, or its commit already landed. Never a second token call from this use.
   const again=await store.load(record.id);
   check(again!==null&&again.ownerId===use.ownerId,'OWNER_MISMATCH','credential');
   check(again.state!=='reauthorization-required','REAUTHORIZATION_REQUIRED',record.providerId);
   check(again.state==='active','CREDENTIAL_NOT_ACTIVE',record.providerId);
   if(fresh(again))return currentGrant(again);
   throw new ConnectorContractError('REFRESH_IN_PROGRESS',record.providerId);
  }
  let finished=false;
  try{
   if(record.refreshCiphertext===null){
    finished=await store.markReauthorizationRequired(record.id,claimId);
    throw new ConnectorContractError('REAUTHORIZATION_REQUIRED',record.providerId);
   }
   const refreshToken=await unsealed(record,'refresh',custodyRecordId(record.id,record.generation),record.refreshCiphertext);
   const fields:Record<string,string>={grant_type:'refresh_token',refresh_token:refreshToken,client_id:client.clientId};
   if(client.clientSecret)fields.client_secret=client.clientSecret;
   let response:CustodyResponse;
   try{
    response=await transport({url:entry.authorization.token,method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',accept:'application/json'},body:form(fields),redirect:'manual',signal:AbortSignal.timeout(custodyLimits.timeoutMs)});
   }
   // A lost reply is a credential outcome with no customer-visible side effect: this use fails, the retained refresh
   // credential is untouched, and the next admitted use may retry it under a new claim.
   catch{throw new ConnectorContractError('REFRESH_UNCERTAIN',record.providerId);}
   let text:string|null;
   try{text=await readBounded(response);}catch{text=null;}
   const status=response.status;
   if(status!==200){
    const rejected=status>=400&&status<500&&status!==408&&status!==429;
    check(rejected,'REFRESH_UNCERTAIN',record.providerId);
    const reply=parseJson(text??'');
    if(status===400&&plain(reply)&&reply.error==='invalid_grant'){
     finished=await store.markReauthorizationRequired(record.id,claimId);
     check(finished,'REFRESH_DISCARDED',record.providerId);
     throw new ConnectorContractError('REAUTHORIZATION_REQUIRED',record.providerId);
    }
    throw new ConnectorContractError('REFRESH_FAILED',record.providerId);
   }
   const body=text===null?undefined:parseJson(text);
   check(body!==undefined,'REFRESH_UNCERTAIN',record.providerId);
   const grant=admitGrant(body,record.scopes,entry);
   if('code' in grant){
    await stash(record,claimId,grant.issuedRefresh);
    if(grant.code==='SCOPE_WIDENED'){
     // Store nothing from the widened response. The grant that was refused is still live at the provider, so the
     // retained refresh credential also becomes revocation work before reauthorization is required.
     const kept=await store.stashRevocationWork(record.id,{ciphertext:record.refreshCiphertext,purpose:'refresh',recordId:custodyRecordId(record.id,record.generation)});
     // Cleared only once the live credential is preserved as work; if the work list is full it stays custody.
     if(kept)finished=await store.markReauthorizationRequired(record.id,claimId);
    }
    throw new ConnectorContractError(grant.code,record.providerId);
   }
   const next=record.generation+1;
   let candidate:CustodyNext;
   try{
    candidate={
     accessCiphertext:await vault.seal(context(record,'token',custodyRecordId(record.id,next)),grant.accessToken),
     accessExpiresAt:clock()+grant.expiresIn*1000,scopes:grant.scopes,
     // Rotated token if issued, else the same token re-sealed so that every ciphertext is bound to the new generation.
     refreshCiphertext:await vault.seal(context(record,'refresh',custodyRecordId(record.id,next)),grant.refreshToken??refreshToken),
    };
   }catch{
    if(grant.refreshToken!==null)await discarded(record,claimId,grant.refreshToken);
    throw new ConnectorContractError('VAULT_UNAVAILABLE',record.providerId);
   }
   let committed:boolean;
   try{committed=await store.commitRefresh(record.id,{claimId,fromGeneration:record.generation,next:candidate});}
   catch(error){await stash(record,claimId,grant.refreshToken);throw error;}
   // The credential was disconnected or replaced while the call was in flight: nothing from this reply becomes custody.
   if(!committed)return await discarded(record,claimId,grant.refreshToken);
   finished=true;
   return granted({...record,generation:next,accessExpiresAt:candidate.accessExpiresAt,scopes:grant.scopes},grant.accessToken,true);
  }finally{
   if(!finished)await store.releaseRefreshClaim(record.id,claimId).catch(()=>false);
  }
 }

 // ---------- Revocation ----------
 const needsClient=(entry:ConnectorProviderEntry)=>entry.authorization.revocation==='rfc7009'||entry.authorization.revocation==='github-token-delete';
 /** One definitive-or-not provider revocation call for one sealed credential. Never throws and never returns token text. */
 async function revokeOne(record:CustodyRecord,entry:ConnectorProviderEntry,client:CustodyClient|undefined,item:RevocationWork):Promise<boolean> {
  let token:string;
  try{token=await vault.unseal(context(record,item.purpose,item.recordId),item.ciphertext);}catch{return false;}
  const a=entry.authorization;
  let request:CustodyRequest;
  let definitive:readonly number[]=[200,204];
  const common={redirect:'manual' as const,signal:AbortSignal.timeout(custodyLimits.timeoutMs)};
  if(a.revocation==='rfc7009'){
   const fields:Record<string,string>={token,token_type_hint:item.purpose==='refresh'?'refresh_token':'access_token',client_id:client!.clientId};
   if(client!.clientSecret)fields.client_secret=client!.clientSecret;
   request={url:a.revoke as string,method:'POST',headers:{'content-type':'application/x-www-form-urlencoded',accept:'application/json'},body:form(fields),...common};
  }else if(a.revocation==='github-token-delete'){
   definitive=[204];
   const basic=btoa(`${client!.clientId}:${client!.clientSecret??''}`);
   request={url:(a.revoke as string).replace('{clientId}',encodeURIComponent(client!.clientId)),method:'DELETE',headers:{authorization:`Basic ${basic}`,'content-type':'application/json',accept:'application/vnd.github+json'},body:JSON.stringify({access_token:token}),...common};
  }else{
   // provider-refresh-delete: the token is a URL path segment. Reached only under allowPathTokenRevocation.
   request={url:(a.revoke as string).replace('{token}',encodeURIComponent(token)),method:'DELETE',headers:{accept:'application/json'},...common};
  }
  try{
   const response=await transport(request);
   await drain(response);
   return definitive.includes(response.status);
  }catch{return false;}
 }
 /** Targets that need a provider call, by catalog revocation kind. */
 function targets(kind:ConnectorProviderEntry['authorization']['revocation'],work:readonly RevocationWork[]):readonly RevocationWork[] {
  const refresh=work.filter(item=>item.purpose==='refresh'),access=work.filter(item=>item.purpose==='token');
  if(kind==='rfc7009')return refresh.length>0?refresh:access.slice(0,1);
  if(kind==='github-token-delete')return access;
  if(kind==='provider-refresh-delete')return allowPathTokenRevocation?refresh:[];
  return [];
 }
 function outcome(record:{state:CustodyState;revocationWork:readonly RevocationWork[]},entry:ConnectorProviderEntry,extra:{code?:string}={}):CustodyOutcome {
  const kind=entry.authorization.revocation,{state}=record;
  if(state==='revoked')return {state,remote:true,ownerAction:false};
  if(state==='revocation-owner-action')return {state,remote:false,ownerAction:true,reason:kind==='local-only-owner-removal'?'local-only-owner-removal':'path-token-policy'};
  if(state==='revocation-pending'&&kind==='github-token-delete'&&!extra.code&&record.revocationWork.length>0&&record.revocationWork.every(item=>item.purpose==='refresh')){
   // The access token delete is settled; the retained refresh credential's grant is a separate reviewed flow.
   return {state,remote:'access-only',ownerAction:true,reason:'refresh-grant-retained'};
  }
  return {state,remote:false,ownerAction:false,...(extra.code?{code:extra.code}:state==='revocation-pending'?{code:'REVOCATION_PENDING'}:{})};
 }
 /** A state that needs no provider call and no claim. */
 function idle(record:CustodyRecord,entry:ConnectorProviderEntry){
  const kind=entry.authorization.revocation;
  if(record.state==='revoked')return true;
  if(record.state==='revocation-owner-action')return kind==='local-only-owner-removal'&&record.revocationWork.length===0||kind==='provider-refresh-delete'&&targets(kind,record.revocationWork).length===0;
  return record.state==='revocation-pending'&&kind==='github-token-delete'&&targets(kind,record.revocationWork).length===0&&record.revocationWork.length>0;
 }
 async function pursue(record:CustodyRecord):Promise<CustodyOutcome> {
  const entry=availableProvider(catalog,record.providerId),kind=entry.authorization.revocation;
  if(idle(record,entry))return outcome(record,entry);
  const claimId=newId();
  if(!await store.claimRevocation(record.id,{claimId,expiresAt:clock()+custodyLimits.revocationLeaseMs,now:clock()})){
   // Another disconnect or reconciliation holds the lease: at most one provider call is in flight.
   const current=await store.load(record.id);
   return {state:current?.state??record.state,remote:false,ownerAction:false,code:'REVOCATION_IN_PROGRESS'};
  }
  let settledState:CustodyState|null|undefined;
  try{
   const current=await store.load(record.id);
   check(current!==null&&current.ownerId===record.ownerId,'OWNER_MISMATCH','credential');
   const work=current.revocationWork,client=Object.hasOwn(clients,record.providerId)?clients[record.providerId]:undefined;
   const wanted=targets(kind,work).slice(0,custodyLimits.maxCallsPerAttempt);
   const done:string[]=[];let failure:string|null=null;
   if(wanted.length>0&&needsClient(entry)&&(client===undefined||!client.clientId))failure='CLIENT_NOT_CONFIGURED';
   else for(const item of wanted){
    if(await revokeOne(current,entry,client,item))done.push(item.ciphertext);else{failure='REVOCATION_PENDING';break;}
   }
   const complete=failure===null&&done.length===targets(kind,work).length;
   // A revoked grant covers every token issued under it; a local-only removal deletes the local copies and nothing else.
   const everything=kind==='local-only-owner-removal'||complete&&(kind==='rfc7009'||kind==='provider-refresh-delete'&&allowPathTokenRevocation);
   const settled=everything?work.map(item=>item.ciphertext):done;
   const remaining=work.filter(item=>!settled.includes(item.ciphertext));
   const state=kind==='local-only-owner-removal'||kind==='provider-refresh-delete'&&!allowPathTokenRevocation?'revocation-owner-action':remaining.length===0?'revoked':'revocation-pending';
   settledState=await store.settleRevocation(record.id,claimId,{state,settled});
   if(settledState===null)return {state:current.state,remote:false,ownerAction:false,code:'REVOCATION_CLAIM_LOST'};
   const after=await store.load(record.id);
   return outcome({state:settledState,revocationWork:after?.revocationWork??remaining},entry,failure?{code:failure}:{});
  }finally{
   if(settledState===undefined)await store.releaseRevocationClaim(record.id,claimId).catch(()=>false);
  }
 }
 /** Disables local use first (atomically), then revokes at the provider only as far as its declared kind honestly can.
  * Idempotent: a repeated or competing call never makes a second provider call for the same work. */
 async function disconnect(ownerId:string,credentialId:string):Promise<CustodyOutcome> {
  check(typeof ownerId==='string'&&typeof credentialId==='string','OWNER_MISMATCH','credential');
  const record=await store.beginRevocation(credentialId,ownerId);
  check(record!==null&&record.ownerId===ownerId,'OWNER_MISMATCH','credential');
  return pursue(record);
 }
 /** Re-attempts retained revocation work under a new lease. Only an explicit owner/operator action or an admitted
  * disconnect retry may call it; it cannot start a revocation of an active credential. */
 async function reconcileRevocation(ownerId:string,credentialId:string):Promise<CustodyOutcome> {
  const record=await ownedRecord(ownerId,credentialId);
  check(record.state!=='active'&&record.state!=='reauthorization-required','NOT_REVOKING',record.providerId);
  return pursue(record);
 }
 return Object.freeze({refreshAccess,disconnect,reconcileRevocation});
}
