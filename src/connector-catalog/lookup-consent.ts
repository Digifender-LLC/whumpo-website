/** WH-143 request-bound lookup consent and minimized connector receipts (contract version 1, docs/connectors.md,
 * "Request-bound lookup and data-use consent" and "Actions, receipts and unknown outcomes").
 * Pure decision module over an injected store port, credential lookup, model-route registry and clock. It owns: who may
 * ask for a lookup (only the current admitted owner may issue, confirm or consume), what a consent record binds (owner,
 * provider, operation, credential, parameter digest, destination, route), its single-use and expiry discipline, when a
 * disconnect voids it, when `model-context` is admissible, how a provider result is marked untrusted, and which fields a
 * stored connector receipt may carry. UNWIRED: no Worker, route, D1 schema, Chat card or environment reaches it. The SQL
 * adapter for `LookupConsentStore`, its tables, the WH-105 card bindings and the `connector-content`/`connector-receipts`
 * lifecycle admission are deferred to the next schema cutover and the WH-009/WH-116 owner retention decision. No timer:
 * expiry is a comparison with the injected clock. Plaintext credentials, provider content and request parameters are never
 * stored: a record holds identifiers and one digest. The digest is `connectorDigest` of ../connector-receipts (canonical
 * JSON, SHA-256), the same function that binds action reviews; this module defines no second canonicalization. */
import {availableProvider,check,connectorCatalog,ConnectorContractError,deepFreeze,plain,receiptStates,shape,validateCatalog,type AuthorityClass,type ConnectorCatalog,type ConnectorProviderEntry,type ConnectorProviderId,type Destination} from './catalog';
import {createRequestBuilder} from './builder';
import {connectorDigest} from '../connector-receipts';

/** Exactly the consent vocabulary of docs/connectors.md. `expired` is also what a past `expiresAt` reads as. */
export const lookupStates=Object.freeze(['issued','confirmed','consumed','void','expired'] as const);
export type LookupState=typeof lookupStates[number];
/** A consent lives at most 15 minutes (the contract's bound) and by default 5. */
export const lookupLimits=Object.freeze({maxTtlMs:900000,defaultTtlMs:300000});

/** The only principal that may issue, confirm or consume: the server-derived current admitted owner (WH-113). */
export type OwnerPrincipal={kind:'owner';ownerId:string};
/** A model proposal may only be described by `propose`; it never creates an executable record. */
export type ModelProposalPrincipal={kind:'model-proposal'};
/** One distinct refusal code per non-owner source. Every other kind, or a malformed principal, is PRINCIPAL_NOT_OWNER. */
export const principalRefusals=Object.freeze({
 'model-proposal':'PRINCIPAL_MODEL_PROPOSAL','provider-content':'PRINCIPAL_PROVIDER_CONTENT','rule-job':'PRINCIPAL_RULE_JOB',
 visitor:'PRINCIPAL_VISITOR',runtime:'PRINCIPAL_RUNTIME',webhook:'PRINCIPAL_WEBHOOK',
} as const);

export type LookupRecord={
 id:string;ownerId:string;providerId:ConnectorProviderId;operationId:string;credentialId:string;paramsDigest:string;
 destination:Destination;
 /** The inference route a `model-context` consent is bound to; null for every other destination. */
 routeId:string|null;
 /** True only for a synthetic-fixture consent. Visible on every record, grant and result derived from it. */
 synthetic:boolean;issuedAt:number;expiresAt:number;state:LookupState;
};
export type LookupRequest={
 providerId:string;operationId:string;params:Record<string,unknown>;body?:unknown;destination:Destination;
 routeId?:string;expiresAt?:number;synthetic?:boolean;
};
export type LookupPresentation={
 id:string;providerId:string;operationId:string;credentialId:string;params:Record<string,unknown>;body?:unknown;
 destination:Destination;routeId?:string;
};
/** Persistence port. Every method is ONE atomic compare-and-swap in the adapter (a conditional UPDATE or a single
 * transaction); the module assumes nothing across calls. Dispositions, in the exact terms an adapter must implement:
 * - insert: stores the record in state `issued`; false (and no write) when the id already exists.
 * - confirm: `issued` -> `confirmed` only if `ownerId` and `credentialId` equal the record's and `expiresAt > now`.
 * - consume: `confirmed` -> `consumed` only if owner, provider, operation, credential, `paramsDigest`, `destination` and
 *   `routeId` all equal the record's and `expiresAt > now`. One winner among concurrent callers.
 * - expire: `issued`/`confirmed` -> `expired` only if `expiresAt <= now`.
 * - voidForCredential: every `issued`/`confirmed` record of that owner, provider and credential -> `void`, in one write.
 *   Consumed, expired and already void records are untouched. Returns how many were voided. */
export interface LookupConsentStore {
 insert(record:LookupRecord):Promise<boolean>;
 load(id:string):Promise<LookupRecord|null>;
 confirm(id:string,guard:{ownerId:string;credentialId:string;now:number}):Promise<boolean>;
 consume(id:string,guard:{ownerId:string;providerId:string;operationId:string;credentialId:string;paramsDigest:string;destination:Destination;routeId:string|null;now:number}):Promise<boolean>;
 expire(id:string,now:number):Promise<boolean>;
 voidForCredential(guard:{ownerId:string;providerId:string;credentialId:string}):Promise<number>;
}
/** The inference-route admission record (docs/inference-privacy.md): only `trainingEnabled: false` together with
 * `approvedForConnectorContent: true` admits real connector content. Null when the route is unknown. */
export type LookupRoute={trainingEnabled:boolean;approvedForConnectorContent:boolean};
export type LookupOptions={
 catalog?:ConnectorCatalog;store:LookupConsentStore;now:()=>number;newId:()=>string;
 routes:{lookup(routeId:string):Promise<LookupRoute|null>};
 /** The owner's ACTIVE credential for a provider (id and the scopes it actually holds), or null when there is none. */
 credentials:{current(ownerId:string,providerId:string):Promise<{id:string;scopes:readonly string[]}|null>};
 /** Fixture suites only: when false (the default) no synthetic consent can be issued or consumed. */
 allowSynthetic?:boolean;
};
/** A non-executable description of a lookup: no id, no state, never accepted by issue, confirm or consume. */
export type LookupProposal=Readonly<{kind:'lookup-proposal';executable:false;providerId:ConnectorProviderId;operationId:string;destination:Destination;paramsDigest:string}>;
/** What a successful consume returns: the one use of a confirmed consent. Minted only by consume. */
export type LookupGrant=Readonly<{consentId:string;ownerId:string;providerId:ConnectorProviderId;operationId:string;credentialId:string;destination:Destination;paramsDigest:string;routeId:string|null;synthetic:boolean;expiresAt:number}>;
/** A provider result. Nothing in it is an instruction, a principal, a confirmation, a tool selection or a destination. */
export type UntrustedResult=Readonly<{provenance:'untrusted-external';consentId:string;providerId:ConnectorProviderId;operationId:string;destination:Destination;synthetic:boolean;data:unknown}>;

/** The connector receipt allowlist: identifiers, digests, enumerations and timestamps only (docs/connectors.md data
 * classification). Anything else, such as a body, params, content, subject, address or token, is refused. */
const identifier=(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,128}$/.test(v);
const digest=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
const stamp=(v:unknown)=>Number.isSafeInteger(v)&&(v as number)>=0||typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(v)&&!Number.isNaN(Date.parse(v));
const receiptRules:Readonly<Record<string,(value:unknown)=>boolean>>=Object.freeze({
 receiptId:identifier,ownerId:identifier,projectId:identifier,providerId:identifier,operationId:(v:unknown)=>typeof v==='string'&&/^[a-z][A-Za-z]*(?:\.[a-z][A-Za-z]*)+$/.test(v),
 authority:(v:unknown)=>v==='owner-request'||v==='approved-rule',ruleRevisionId:identifier,credentialId:identifier,providerAccountId:identifier,
 destinationDigest:digest,operationDigest:digest,requestDigest:digest,reviewDigest:digest,
 price:(v:unknown)=>plain(v)&&Object.keys(v).sort().join()==='basis,customerUnits'&&Number.isSafeInteger(v.customerUnits)&&(v.customerUnits as number)>=0&&(v.basis==='plan-inclusion'||v.basis==='quoted'),
 state:(v:unknown)=>receiptStates.includes(v as typeof receiptStates[number]),providerObjectId:identifier,
 detailCode:(v:unknown)=>typeof v==='string'&&/^[A-Z][A-Z0-9_]{0,63}$/.test(v),createdAt:stamp,settledAt:stamp,
});
const receiptRequired=Object.freeze(['receiptId','ownerId','providerId','operationId','credentialId','requestDigest','reviewDigest','state','createdAt']);
/** The complete list of field names a minimized receipt may carry. */
export const minimizedReceiptFields=Object.freeze(Object.keys(receiptRules));
export type MinimizedReceipt=Readonly<Record<string,unknown>>;

const idPattern=/^[A-Za-z0-9_-]{1,128}$/;
/** Objects minted by this module, by identity. A JSON copy of a result still carries `provenance`, which is refused too. */
const untrusted=new WeakSet<object>(),proposals=new WeakSet<object>(),grants=new WeakSet<object>(),results=new WeakSet<object>();
/** Refuses any value that is, or contains, a provider result or a proposal: such a value is data, never authority. */
function trusted(value:unknown,path:string,depth=0):void {
 if(value===null||typeof value!=='object')return;
 check(depth<=8,'INVALID_SHAPE',path);
 check(!proposals.has(value)&&!(plain(value)&&value.kind==='lookup-proposal'),'PROPOSAL_NOT_EXECUTABLE',path);
 check(!untrusted.has(value)&&!(plain(value)&&value.provenance==='untrusted-external'),'UNTRUSTED_INPUT',path);
 for(const item of Object.values(value))trusted(item,path,depth+1);
}
function jsonData(value:unknown,depth=0):boolean {
 if(depth>12)return false;
 if(value===null||typeof value==='string'||typeof value==='boolean')return true;
 if(typeof value==='number')return Number.isFinite(value);
 if(Array.isArray(value))return value.every(item=>jsonData(item,depth+1));
 return plain(value)&&Object.values(value).every(item=>jsonData(item,depth+1));
}
function taint(value:unknown):void {
 if(value===null||typeof value!=='object'||untrusted.has(value))return;
 untrusted.add(value);for(const item of Object.values(value))taint(item);
}

export function createLookupConsent(options:LookupOptions){
 const {catalog=connectorCatalog,store,now,newId,routes,credentials,allowSynthetic=false}=options;
 validateCatalog(catalog);
 check(store&&typeof store.load==='function'&&typeof now==='function'&&typeof newId==='function'&&routes&&typeof routes.lookup==='function'&&credentials&&typeof credentials.current==='function','INVALID_LOOKUP_OPTIONS','lookup');
 // A private frozen copy: a later change to the caller's catalog object cannot change what a consent was issued against.
 const snapshot=deepFreeze(JSON.parse(JSON.stringify(catalog)) as ConnectorCatalog),buildRequest=createRequestBuilder(snapshot);
 const clock=()=>{const value=now();check(Number.isFinite(value),'INVALID_CLOCK','lookup');return value;};

 function principalOf(principal:unknown,accept:readonly string[]):string|null {
  trusted(principal,'principal');
  check(plain(principal)&&typeof principal.kind==='string','PRINCIPAL_NOT_OWNER','principal');
  const kind=principal.kind;
  check(accept.includes(kind),Object.hasOwn(principalRefusals,kind)?principalRefusals[kind as keyof typeof principalRefusals]:'PRINCIPAL_NOT_OWNER','principal');
  const keys=Object.keys(principal);
  if(kind!=='owner'){check(keys.length===1,'PRINCIPAL_NOT_OWNER','principal');return null;}
  check(keys.length===2&&typeof principal.ownerId==='string'&&idPattern.test(principal.ownerId),'PRINCIPAL_NOT_OWNER','principal');
  return principal.ownerId as string;
 }
 const ownerOf=(principal:unknown)=>{const ownerId=principalOf(principal,['owner']);check(ownerId!==null,'PRINCIPAL_NOT_OWNER','principal');return ownerId;};
 const known=(id:unknown,code:string)=>check(typeof id==='string'&&idPattern.test(id),code,'lookup');

 function locate(input:Record<string,unknown>){
  const entry=availableProvider(snapshot,input.providerId),providerId=input.providerId as ConnectorProviderId,operationId=input.operationId;
  check(typeof operationId==='string'&&Object.hasOwn(entry.operations,operationId),'UNKNOWN_OPERATION',`${providerId}.${String(operationId)}`);
  return {entry,providerId,operationId,op:entry.operations[operationId]};
 }
 /** Typed validation by the shared builder, then the digest of exactly what the read will be: typed params and body. */
 async function bind(input:Record<string,unknown>,located:ReturnType<typeof locate>,granted:readonly string[]){
  const {providerId,operationId,op}=located;
  check(op.kind==='read','NOT_A_READ',operationId);
  // owner-control reads serve only the owner's own explicit control or card; they are not lookup-consent subjects.
  check(op.consent==='request-bound','NOT_REQUEST_BOUND',operationId);
  check(typeof input.destination==='string'&&op.destinations.includes(input.destination as Destination),'DESTINATION_NOT_ALLOWED',`${providerId}.${operationId}`);
  buildRequest({providerId,operationId,params:input.params as Record<string,unknown>,authority:'owner-request',grantedScopes:granted,...(input.body!==undefined?{body:input.body}:{})});
  // The declared range bound (same rule as the reference runtime): `to` after `from` and no wider than maxRangeDays.
  if(op.bounds.maxRangeDays!==undefined){
   const {from,to}=input.params as Record<string,string>,days=(Date.parse(to)-Date.parse(from))/864e5;
   check(days>0&&days<=op.bounds.maxRangeDays,'RANGE_TOO_WIDE',operationId);
  }
  return connectorDigest({params:input.params,body:input.body===undefined?null:input.body});
 }
 function syntheticAllowed(entry:ConnectorProviderEntry,providerId:string,synthetic:boolean){
  // Only a provider that is still synthetic-conformant can have a synthetic consent: never one with a real connection.
  check(!synthetic||allowSynthetic&&entry.readiness==='synthetic-conformant','SYNTHETIC_NOT_ALLOWED',providerId);
 }
 /** model-context needs a recorded, not-training-enabled route approved for connector content (a synthetic consent only
  * needs the route to exist). Checked on issue, confirm and consume; a refusal never spends the record. */
 async function routeAdmits(destination:Destination,routeId:string|null,synthetic:boolean){
  if(destination!=='model-context'){check(routeId===null,'ROUTE_NOT_APPLICABLE','route');return;}
  check(routeId!==null&&idPattern.test(routeId),'ROUTE_REQUIRED','route');
  const route=await routes.lookup(routeId);
  check(plain(route),'ROUTE_UNKNOWN','route');
  check(synthetic||route.trainingEnabled===false&&route.approvedForConnectorContent===true,'ROUTE_NOT_APPROVED','route');
 }
 async function currentCredential(ownerId:string,providerId:string){
  const current=await credentials.current(ownerId,providerId);
  check(plain(current)&&typeof current.id==='string'&&idPattern.test(current.id)&&Array.isArray(current.scopes),'NO_ACTIVE_CREDENTIAL',providerId);
  return current as {id:string;scopes:readonly string[]};
 }
 const view=(record:LookupRecord,state=record.state):LookupRecord=>({id:record.id,ownerId:record.ownerId,providerId:record.providerId,operationId:record.operationId,credentialId:record.credentialId,paramsDigest:record.paramsDigest,destination:record.destination,routeId:record.routeId,synthetic:record.synthetic,issuedAt:record.issuedAt,expiresAt:record.expiresAt,state});
 /** The reason a record cannot be used, from its stored state (diagnostic only: the store's compare-and-swap decided). */
 async function unusable(record:LookupRecord,at:number,needConfirmed:boolean){
  if(record.state==='consumed')check(false,'CONSENT_CONSUMED','consent');
  if(record.state==='void')check(false,'CONSENT_VOID','consent');
  if(record.state==='expired'||record.expiresAt<=at){await store.expire(record.id,at).catch(()=>false);check(false,'CONSENT_EXPIRED','consent');}
  check(!(needConfirmed&&record.state==='issued'),'CONSENT_NOT_CONFIRMED','consent');
 }
 async function refusal(id:string,ownerId:string,at:number,needConfirmed:boolean):Promise<never> {
  const record=await store.load(id);
  check(record!==null&&record.ownerId===ownerId,'CONSENT_NOT_FOUND','consent');
  await unusable(record,at,needConfirmed);
  throw new ConnectorContractError('CONSENT_MISMATCH','consent');
 }

 /** Describes a lookup for the owner without storing anything. The only way a model's request is represented: the
  * returned object has no id and no state and is refused by issue, confirm and consume. */
 async function propose(principal:OwnerPrincipal|ModelProposalPrincipal,input:LookupRequest):Promise<LookupProposal> {
  principalOf(principal,['owner','model-proposal']);
  trusted(input,'lookup');
  shape(input,['providerId','operationId','params','destination'],'lookup',['body']);
  const located=locate(input);
  const paramsDigest=await bind(input,located,located.op.scopes);
  const proposal=Object.freeze({kind:'lookup-proposal' as const,executable:false as const,providerId:located.providerId,operationId:located.operationId,destination:input.destination,paramsDigest});
  proposals.add(proposal);
  return proposal;
 }
 /** Issues the consent record for one exact lookup. Owner only. Nothing is read from the provider here. */
 async function issue(principal:OwnerPrincipal,input:LookupRequest):Promise<LookupRecord> {
  const ownerId=ownerOf(principal);
  trusted(input,'lookup');
  shape(input,['providerId','operationId','params','destination'],'lookup',['body','routeId','expiresAt','synthetic']);
  check(input.synthetic===undefined||typeof input.synthetic==='boolean','INVALID_SYNTHETIC','lookup');
  const located=locate(input),synthetic=input.synthetic===true;
  syntheticAllowed(located.entry,located.providerId,synthetic);
  const issuedAt=clock(),expiresAt=input.expiresAt===undefined?issuedAt+lookupLimits.defaultTtlMs:input.expiresAt;
  check(typeof expiresAt==='number'&&Number.isSafeInteger(expiresAt)&&expiresAt>issuedAt&&expiresAt<=issuedAt+lookupLimits.maxTtlMs,'INVALID_EXPIRY','lookup');
  const credential=await currentCredential(ownerId,located.providerId);
  const paramsDigest=await bind(input,located,credential.scopes);
  const routeId=input.routeId===undefined?null:input.routeId;
  check(routeId===null||typeof routeId==='string','ROUTE_REQUIRED','route');
  await routeAdmits(input.destination,routeId,synthetic);
  const id=newId();
  known(id,'INVALID_ID');
  const record:LookupRecord={id,ownerId,providerId:located.providerId,operationId:located.operationId,credentialId:credential.id,paramsDigest,destination:input.destination,routeId,synthetic,issuedAt,expiresAt,state:'issued'};
  check(await store.insert(record),'CONSENT_NOT_STORED','consent');
  return view(record);
 }
 /** Owner-only compare-and-swap issued -> confirmed. A repeated confirm of a still-valid confirmed record returns it. */
 async function confirm(principal:OwnerPrincipal,id:string):Promise<LookupRecord> {
  const ownerId=ownerOf(principal);
  known(id,'CONSENT_NOT_FOUND');
  const at=clock(),record=await store.load(id);
  check(record!==null&&record.ownerId===ownerId,'CONSENT_NOT_FOUND','consent');
  await unusable(record,at,false);
  const current=await currentCredential(ownerId,record.providerId);
  check(current.id===record.credentialId,'CREDENTIAL_CHANGED',record.providerId);
  syntheticAllowed(availableProvider(snapshot,record.providerId),record.providerId,record.synthetic);
  await routeAdmits(record.destination,record.routeId,record.synthetic);
  if(record.state==='confirmed')return view(record);
  if(!await store.confirm(id,{ownerId,credentialId:record.credentialId,now:at})){
   const again=await store.load(id);
   if(again!==null&&again.ownerId===ownerId&&again.state==='confirmed'&&again.expiresAt>at)return view(again);
   return refusal(id,ownerId,at,false);
  }
  return view(record,'confirmed');
 }
 /** The read presents exactly what it will send. The digest is recomputed here from the typed params and body, and ONE
  * compare-and-swap confirmed -> consumed matches every bound field. Single use: a second consume always fails. */
 async function consume(principal:OwnerPrincipal,presentation:LookupPresentation):Promise<LookupGrant> {
  const ownerId=ownerOf(principal);
  trusted(presentation,'lookup');
  shape(presentation,['id','providerId','operationId','credentialId','params','destination'],'lookup',['body','routeId']);
  known(presentation.id,'CONSENT_NOT_FOUND');
  const at=clock(),located=locate(presentation);
  const current=await currentCredential(ownerId,located.providerId);
  check(typeof presentation.credentialId==='string'&&current.id===presentation.credentialId,'CREDENTIAL_CHANGED',located.providerId);
  const paramsDigest=await bind(presentation,located,current.scopes);
  const record=await store.load(presentation.id);
  check(record!==null&&record.ownerId===ownerId,'CONSENT_NOT_FOUND','consent');
  await unusable(record,at,true);
  syntheticAllowed(located.entry,located.providerId,record.synthetic);
  const routeId=presentation.routeId===undefined?null:presentation.routeId;
  check(routeId===null||typeof routeId==='string','ROUTE_REQUIRED','route');
  await routeAdmits(presentation.destination,routeId,record.synthetic);
  const bound={ownerId,providerId:located.providerId,operationId:located.operationId,credentialId:current.id,paramsDigest,destination:presentation.destination,routeId};
  if(!await store.consume(presentation.id,{...bound,now:at}))return refusal(presentation.id,ownerId,at,true);
  const grant=Object.freeze({consentId:presentation.id,...bound,synthetic:record.synthetic,expiresAt:record.expiresAt});
  grants.add(grant);
  return grant;
 }
 /** Disconnect and reconnection void every unspent consent of the credential in one write. Only ever removes authority,
  * so it needs no principal. Returns the number voided. */
 async function voidForCredential(ownerId:string,providerId:string,credentialId:string):Promise<number> {
  check(typeof ownerId==='string'&&typeof providerId==='string'&&typeof credentialId==='string','OWNER_MISMATCH','credential');
  const count=await store.voidForCredential({ownerId,providerId,credentialId});
  check(Number.isSafeInteger(count)&&count>=0,'INVALID_STORE_RESULT','lookup');
  return count;
 }

 /** Marks a provider result for the consumed lookup as untrusted external data bound to the consented destination. */
 function markUntrusted(grant:LookupGrant,data:unknown):UntrustedResult {
  check(typeof grant==='object'&&grant!==null&&grants.has(grant),'GRANT_REQUIRED','result');
  check(jsonData(data),'INVALID_RESULT','result');
  const copy=deepFreeze(JSON.parse(JSON.stringify(data)) as unknown);
  taint(copy);
  const result=Object.freeze({provenance:'untrusted-external' as const,consentId:grant.consentId,providerId:grant.providerId,operationId:grant.operationId,destination:grant.destination,synthetic:grant.synthetic,data:copy});
  untrusted.add(result);results.add(result);
  return result;
 }
 /** The one exit for a result's data: only the destination that was consented, and that the operation lists, receives it. */
 function admitResult(result:UntrustedResult,destination:Destination):unknown {
  check(typeof result==='object'&&result!==null&&results.has(result),'RESULT_REQUIRED','result');
  const entry=availableProvider(snapshot,result.providerId),op=entry.operations[result.operationId];
  check(typeof destination==='string'&&destination===result.destination&&op!==undefined&&op.destinations.includes(destination),'DESTINATION_NOT_ALLOWED',`${result.providerId}.${result.operationId}`);
  return result.data;
 }

 /** The stored shape of a connector receipt: allowlisted identifiers, digests, enumerations and timestamps only. */
 function minimizedReceipt(fields:unknown):MinimizedReceipt {
  trusted(fields,'receipt');
  check(plain(fields),'INVALID_SHAPE','receipt');
  check(Reflect.ownKeys(fields).every(key=>typeof key==='string'&&Object.hasOwn(receiptRules,key)),'RECEIPT_FIELD_NOT_ALLOWED','receipt');
  for(const name of receiptRequired)check(Object.hasOwn(fields,name),'RECEIPT_FIELD_MISSING',name);
  for(const [name,value] of Object.entries(fields))check(receiptRules[name](value),'RECEIPT_FIELD_INVALID',name);
  const entry=availableProvider(snapshot,fields.providerId),operationId=fields.operationId as string;
  check(Object.hasOwn(entry.operations,operationId),'UNKNOWN_OPERATION',`${String(fields.providerId)}.${operationId}`);
  const op=entry.operations[operationId];
  // Reads show and discard their content: only an action has a receipt.
  check(op.kind==='action','RECEIPT_NOT_ACTION',operationId);
  const authority=fields.authority===undefined?'owner-request':fields.authority;
  check(op.authority.includes(authority as AuthorityClass),'OWNER_REQUEST_ONLY',operationId);
  check((authority==='approved-rule')===(fields.ruleRevisionId!==undefined),'RECEIPT_FIELD_INVALID','ruleRevisionId');
  const out:Record<string,unknown>={};
  for(const name of minimizedReceiptFields)if(Object.hasOwn(fields,name))out[name]=name==='price'?{...(fields.price as object)}:fields[name];
  return deepFreeze(out);
 }
 return Object.freeze({propose,issue,confirm,consume,voidForCredential,markUntrusted,admitResult,minimizedReceipt});
}
