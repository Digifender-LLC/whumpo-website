/** WH-145 approved deterministic-rule authority for rule-eligible connector actions (contract version 1,
 * docs/connectors.md, "Authority classes"). Pure decision module over an injected store port, clock, id source, digest
 * function and acceptance record. It owns four things: what an owner approval binds to one rule revision, which
 * contexts and invocations are admitted under that approval, the claim-time limit (one compare-and-swap on a
 * per-approval per-period counter) and revocation. It does not execute anything, read or write a credential, call a
 * provider or build a request: the executor (WH-069) builds the request through ./builder with `approved-rule`
 * authority from an admission and then takes credential access through the WH-144 custody module.
 * UNWIRED: no Worker, route, D1 schema, environment or timer reaches it. The SQL adapter for `RuleStore` and its
 * tables are deferred to the next schema cutover. No model, inference, funding or maintenance dependency exists: the
 * option set is closed, so a rule job runs with owner-maintenance inference unavailable. */
import {availableProvider,check,connectorCatalog,ConnectorContractError,deepFreeze,plain,shape,validateCatalog,type ConnectorCatalog,type ConnectorProviderId,type Readiness} from './catalog';
import {createRequestBuilder} from './builder';
import type {connectorDigest} from '../connector-receipts';

export const ruleContractVersion=1;
/** Closed limit periods. A period is a UTC-aligned window derived from the injected clock; a week starts on Monday. */
export const rulePeriods=Object.freeze(['hour','day','week'] as const);
export type RulePeriod=typeof rulePeriods[number];
/** `maxPerPeriod` is a source ceiling that the owner may lower, never raise. A claim is a short lease: unredeemed it
 * keeps its quota unit (the limit errs toward fewer sends) and cannot be redeemed after `claimTtlMs`. */
export const ruleLimits=Object.freeze({maxPerPeriod:100,claimTtlMs:60000});
const periodMs:Readonly<Record<RulePeriod,number>>=Object.freeze({hour:3600000,day:86400000,week:604800000});
/** Every context kind that is refused, with its distinct code. Anything not listed and not the one rule context is
 * refused as CONTEXT_FORBIDDEN. All of them are decided before any store read. */
export const ruleContextRefusals:Readonly<Record<string,string>>=Object.freeze({
 visitor:'VISITOR_FORBIDDEN',
 'published-site':'PUBLISHED_REQUEST_FORBIDDEN','published-app':'PUBLISHED_REQUEST_FORBIDDEN',
 'quickjs-runtime':'RUNTIME_FORBIDDEN',
 webhook:'WEBHOOK_FORBIDDEN','incoming-message':'WEBHOOK_FORBIDDEN',
 schedule:'SCHEDULE_WITHOUT_APPROVED_RULE',
 'maintenance-agent':'MAINTENANCE_AGENT_FORBIDDEN',
 'provider-content':'UNTRUSTED_CONTENT_FORBIDDEN','untrusted-content':'UNTRUSTED_CONTENT_FORBIDDEN',
});

/** The WH-052 job envelope as the WH-069 resolver reduces it, after it has resolved the rule revision and owner from
 * authoritative state. `kind` and `purpose` are set by the server and never taken from request JSON. */
export type RuleContext={kind:'deterministic-rule';purpose:'deterministic-rule';ruleRevisionId:string;ownerId:string};
/** The current admitted workspace owner (WH-113), acting through an explicit control. Only this module's `approve` and
 * `revokeApproval` accept it; the caller must have derived it on the server, which this module cannot verify. */
export type RulePrincipal={kind:'owner-request';ownerId:string};
/** What a rule revision's action sends. `destination` is the operation's typed parameters (for HubSpot
 * `contact.create` there are none: the destination is the connected account, which the credential identity binds).
 * `bodyTemplate` is the revision's body template, `null` for an operation without a body. */
export type RuleInvocation={providerId:string;operationId:string;destination:Readonly<Record<string,unknown>>;bodyTemplate:Readonly<Record<string,unknown>>|null};
export type RuleApprovalInput=RuleInvocation&{ruleRevisionId:string;maxPerPeriod:number;period:RulePeriod;credentialId:string};
/** Immutable once stored, except `revokedAt`, which only `revokeApproval` sets. A new revision is a new approval. */
export type RuleApproval={
 version:1;approvalId:string;ruleRevisionId:string;ownerId:string;providerId:ConnectorProviderId;operationId:string;
 destinationDigest:string;bodyTemplateDigest:string;maxPerPeriod:number;period:RulePeriod;
 credentialId:string;credentialIdentityDigest:string;readinessAtApproval:Readiness;approvedAt:number;revokedAt:number|null;
};
/** Credential metadata only. This module never receives a token, ciphertext or vault context. `identityDigest` is the
 * digest of what identifies the connection (credential id, provider account); a refresh does not change it and a
 * reconnection to another account does. `state` is the WH-144 custody state. */
export type RuleCredential={id:string;ownerId:string;providerId:string;state:string;identityDigest:string;scopes:readonly string[]};
export type RuleClaim={claimId:string;approvalId:string;ruleRevisionId:string;ownerId:string;providerId:ConnectorProviderId;operationId:string;credentialId:string;periodKey:string;expiresAt:number};
export type RuleAdmission=Readonly<{
 authority:'approved-rule';approvalId:string;ruleRevisionId:string;ownerId:string;providerId:ConnectorProviderId;operationId:string;
 credentialId:string;destinationDigest:string;bodyTemplateDigest:string;maxPerPeriod:number;period:RulePeriod;
}>;

/** Persistence port. Every method is ONE atomic compare-and-swap in the adapter (a conditional statement or a single
 * transaction); the module assumes nothing across calls. Dispositions, in the exact terms an adapter must implement:
 * - insertApproval: only if no approval exists for `ruleRevisionId`; returns false otherwise. Stored approvals are
 *   immutable except `revokedAt`.
 * - loadApproval: by rule revision; null when none exists.
 * - loadCredential: the metadata view of one credential; null when none exists.
 * - claimQuota: ONE write. If the approval does not exist or is revoked, `revoked`. If the counter for
 *   (approvalId, periodKey) is already `max`, `exceeded` and nothing is written. Otherwise adds one to that counter and
 *   stores the claim as unredeemed in the same write, and returns `claimed`.
 * - redeemClaim: only if the claim exists for that owner and rule revision, is unredeemed and unvoided, has not
 *   expired and its approval is not revoked; marks it redeemed and returns it. Otherwise null and nothing changes.
 * - revokeApproval: only if an approval exists for that revision and owner; sets `revokedAt` if unset (a repeat
 *   is true and changes nothing) and voids every unredeemed claim of that approval in the same write. False otherwise. */
export interface RuleStore {
 insertApproval(approval:RuleApproval):Promise<boolean>;
 loadApproval(ruleRevisionId:string):Promise<RuleApproval|null>;
 loadCredential(credentialId:string):Promise<RuleCredential|null>;
 claimQuota(claim:RuleClaim&{max:number}):Promise<'claimed'|'exceeded'|'revoked'>;
 redeemClaim(redeem:{ownerId:string;ruleRevisionId:string;claimId:string;now:number}):Promise<RuleClaim|null>;
 revokeApproval(ownerId:string,ruleRevisionId:string,at:number):Promise<boolean>;
}
export type RuleAuthorityOptions={
 catalog?:ConnectorCatalog;store:RuleStore;now:()=>number;newId:()=>string;
 /** The recorded live acceptance (WH-031/032, WH-096-100) of one operation. Catalog readiness is metadata only. */
 acceptance:(providerId:ConnectorProviderId,operationId:string)=>boolean|Promise<boolean>;
 /** The repository's one canonical digest, `connectorDigest` of src/connector-receipts.ts, injected so that this module
  * imports only the catalog and the builder. */
 digest:typeof connectorDigest;
};

const segment=/^[A-Za-z0-9_-]{1,128}$/;
const hex=/^[0-9a-f]{64}$/;
const isId=(value:unknown):value is string=>typeof value==='string'&&segment.test(value);
const contextKeys=['kind','purpose','ruleRevisionId','ownerId'];
const invocationKeys=['providerId','operationId','destination','bodyTemplate'];
const approvalKeys=[...invocationKeys,'ruleRevisionId','maxPerPeriod','period','credentialId'];

/** The limit window for `at` (epoch milliseconds). A counter is keyed by this string, so a clock that moves into a new
 * period starts a new count and a clock that moves back reads the earlier period's count. */
export function rulePeriodKey(period:unknown,at:unknown):string {
 check(rulePeriods.includes(period as RulePeriod),'INVALID_PERIOD','period');
 check(typeof at==='number'&&Number.isSafeInteger(at)&&at>=0,'INVALID_CLOCK','rule-authority');
 // 1970-01-05T00:00Z, the first Monday, is 4 days after the epoch.
 return `${period}:${Math.floor((at-(period==='week'?4*86400000:0))/periodMs[period as RulePeriod])}`;
}

export function createRuleAuthority(options:RuleAuthorityOptions){
 // A closed option set: there is no inference, model, funding or maintenance option to pass.
 shape(options,['store','now','newId','acceptance','digest'],'rule-authority',['catalog']);
 const {store,now,newId,acceptance,digest}=options;
 check(store!==null&&typeof store==='object'&&typeof now==='function'&&typeof newId==='function'&&typeof acceptance==='function'&&typeof digest==='function','INVALID_RULE_OPTIONS','rule-authority');
 const catalog=deepFreeze(JSON.parse(JSON.stringify(options.catalog??connectorCatalog)) as ConnectorCatalog);
 validateCatalog(catalog);
 const dryRun=createRequestBuilder(catalog);
 const clock=()=>{const value=now();check(typeof value==='number'&&Number.isSafeInteger(value)&&value>=0,'INVALID_CLOCK','rule-authority');return value;};
 const fresh=()=>{const id=newId();check(isId(id),'INVALID_ID','rule-authority');return id;};
 const accepted=async(providerId:ConnectorProviderId,operationId:string)=>{try{return await acceptance(providerId,operationId)===true;}catch{return false;}};

 function ownerOf(principal:unknown):string {
  check(plain(principal)&&principal.kind==='owner-request'&&Object.keys(principal).length===2&&isId(principal.ownerId),'PRINCIPAL_FORBIDDEN','principal');
  return principal.ownerId as string;
 }
 /** The one context a rule job may arrive in. Every refusal is decided here, before any store read. */
 function ruleContext(context:unknown){
  const kind=plain(context)?context.kind:undefined;
  if(typeof kind==='string'&&Object.hasOwn(ruleContextRefusals,kind))throw new ConnectorContractError(ruleContextRefusals[kind],'context');
  check(plain(context)&&context.kind==='deterministic-rule'&&context.purpose==='deterministic-rule'&&Object.keys(context).length===contextKeys.length&&contextKeys.every(key=>Object.hasOwn(context,key))&&isId(context.ruleRevisionId)&&isId(context.ownerId),'CONTEXT_FORBIDDEN','context');
  return {ruleRevisionId:context.ruleRevisionId as string,ownerId:context.ownerId as string};
 }
 /** Catalog-only eligibility: an action that declares `approved-rule`. Rules never read or reconcile, and holding a
  * scope grants nothing. Readiness is a separate gate (approval records it, admission enforces it). */
 function eligible(providerId:unknown,operationId:unknown){
  const entry=availableProvider(catalog,providerId);
  check(typeof operationId==='string'&&Object.hasOwn(entry.operations,operationId),'UNKNOWN_OPERATION',`${String(providerId)}.${String(operationId)}`);
  const op=entry.operations[operationId];
  check(op.kind==='action','RULE_READ_FORBIDDEN',operationId);
  check(op.authority.includes('approved-rule'),'OWNER_REQUEST_ONLY',operationId);
  return {entry,providerId:providerId as ConnectorProviderId,operationId};
 }
 /** Typed destination parameters and a body the operation declares, under the credential's actual scopes, by the same
  * builder the executor uses. The rule gates are this module's own; the request itself is built later. */
 function wellFormed(providerId:ConnectorProviderId,operationId:string,destination:unknown,bodyTemplate:unknown,scopes:readonly string[]){
  check(plain(destination),'INVALID_PARAM','destination');
  check(bodyTemplate===null||plain(bodyTemplate),'BODY_NOT_ALLOWED','bodyTemplate');
  dryRun({providerId,operationId,params:destination,authority:'owner-request',grantedScopes:scopes,...(bodyTemplate===null?{}:{body:bodyTemplate})});
 }
 async function digests(destination:unknown,bodyTemplate:unknown):Promise<[string,string]> {
  try{
   const result=[await digest(destination),await digest(bodyTemplate)];
   if(result.every(value=>typeof value==='string'&&hex.test(value)))return result as [string,string];
  }catch{/* the one refusal below */}
  throw new ConnectorContractError('DIGEST_UNAVAILABLE','rule-authority');
 }

 /** Records the owner's approval of one rule revision. Does not run anything and consumes no limit. */
 async function approve(principal:unknown,input:unknown):Promise<RuleApproval> {
  const ownerId=ownerOf(principal);
  shape(input,approvalKeys,'approval');
  const {ruleRevisionId,credentialId,maxPerPeriod,period,destination,bodyTemplate}=input;
  check(isId(ruleRevisionId)&&isId(credentialId),'INVALID_APPROVAL','approval');
  check(typeof maxPerPeriod==='number'&&Number.isSafeInteger(maxPerPeriod)&&maxPerPeriod>=1&&maxPerPeriod<=ruleLimits.maxPerPeriod,'INVALID_LIMIT','maxPerPeriod');
  check(rulePeriods.includes(period as RulePeriod),'INVALID_PERIOD','period');
  const {entry,providerId,operationId}=eligible(input.providerId,input.operationId);
  const credential=await store.loadCredential(credentialId);
  // One code for an unknown credential and another owner's: no credential-existence oracle.
  check(credential!==null&&credential.id===credentialId&&credential.ownerId===ownerId,'OWNER_MISMATCH','credential');
  check(credential.providerId===providerId,'CREDENTIAL_MISMATCH',providerId);
  check(credential.state==='active','CREDENTIAL_NOT_ACTIVE',providerId);
  check(typeof credential.identityDigest==='string'&&hex.test(credential.identityDigest),'INVALID_CREDENTIAL','credential');
  wellFormed(providerId,operationId,destination,bodyTemplate,credential.scopes);
  const [destinationDigest,bodyTemplateDigest]=await digests(destination,bodyTemplate);
  const approval=deepFreeze<RuleApproval>({
   version:ruleContractVersion,approvalId:fresh(),ruleRevisionId,ownerId,providerId,operationId,destinationDigest,bodyTemplateDigest,
   maxPerPeriod,period:period as RulePeriod,credentialId,credentialIdentityDigest:credential.identityDigest,
   readinessAtApproval:entry.readiness,approvedAt:clock(),revokedAt:null,
  });
  check(await store.insertApproval(approval),'APPROVAL_EXISTS','approval');
  return approval;
 }

 /** Decides whether a rule job may use its approval for exactly this invocation. Reads and consumes nothing. */
 async function admit(context:unknown,invocation:unknown):Promise<RuleAdmission> {
  const {ruleRevisionId,ownerId}=ruleContext(context);
  shape(invocation,invocationKeys,'invocation');
  const {entry,providerId,operationId}=eligible(invocation.providerId,invocation.operationId);
  const approval=await store.loadApproval(ruleRevisionId);
  // One code for an unknown revision and another owner's approval: approvals are not an existence oracle.
  check(approval!==null&&approval.ruleRevisionId===ruleRevisionId&&approval.ownerId===ownerId,'APPROVAL_NOT_FOUND','approval');
  check(approval.version===ruleContractVersion,'UNSUPPORTED_VERSION','approval');
  check(approval.revokedAt===null,'APPROVAL_REVOKED','approval');
  check(approval.providerId===providerId&&approval.operationId===operationId,'OPERATION_MISMATCH',operationId);
  // Catalog readiness is metadata the catalog never derives: the recorded acceptance is required as well.
  check(entry.readiness==='live-accepted'&&await accepted(providerId,operationId),'ADAPTER_NOT_ACCEPTED',providerId);
  const credential=await store.loadCredential(approval.credentialId);
  check(credential!==null&&credential.id===approval.credentialId&&credential.ownerId===approval.ownerId&&credential.providerId===approval.providerId&&credential.identityDigest===approval.credentialIdentityDigest,'CREDENTIAL_CHANGED','credential');
  check(credential.state==='active','CREDENTIAL_NOT_ACTIVE',providerId);
  wellFormed(providerId,operationId,invocation.destination,invocation.bodyTemplate,credential.scopes);
  const [destinationDigest,bodyTemplateDigest]=await digests(invocation.destination,invocation.bodyTemplate);
  check(destinationDigest===approval.destinationDigest,'DESTINATION_MISMATCH',operationId);
  check(bodyTemplateDigest===approval.bodyTemplateDigest,'TEMPLATE_MISMATCH',operationId);
  return deepFreeze({
   authority:'approved-rule' as const,approvalId:approval.approvalId,ruleRevisionId,ownerId,providerId,operationId,credentialId:approval.credentialId,
   destinationDigest,bodyTemplateDigest,maxPerPeriod:approval.maxPerPeriod,period:approval.period,
  });
 }

 /** Admission followed by the claim-time limit, so a claim cannot exist without an admission. One compare-and-swap on
  * the (approval, period) counter: concurrent claims never exceed `maxPerPeriod`, and a refused claim consumes nothing. */
 async function claim(context:unknown,invocation:unknown):Promise<RuleClaim> {
  const admission=await admit(context,invocation),at=clock();
  const token=deepFreeze<RuleClaim>({
   claimId:fresh(),approvalId:admission.approvalId,ruleRevisionId:admission.ruleRevisionId,ownerId:admission.ownerId,providerId:admission.providerId,
   operationId:admission.operationId,credentialId:admission.credentialId,periodKey:rulePeriodKey(admission.period,at),expiresAt:at+ruleLimits.claimTtlMs,
  });
  const result=await store.claimQuota({...token,max:admission.maxPerPeriod});
  if(result!=='claimed')throw new ConnectorContractError(result==='exceeded'?'RULE_LIMIT_EXCEEDED':'APPROVAL_REVOKED',admission.operationId);
  return token;
 }

 /** Uses a claim once, immediately before dispatch. The returned record comes from the store, never from the token. */
 async function redeem(context:unknown,claimId:unknown):Promise<RuleClaim> {
  const {ruleRevisionId,ownerId}=ruleContext(context);
  check(isId(claimId),'CLAIM_NOT_REDEEMABLE','claim');
  const stored=await store.redeemClaim({ownerId,ruleRevisionId,claimId,now:clock()});
  // One code for an unknown, foreign, used, voided and expired claim.
  check(stored!==null&&stored.claimId===claimId&&stored.ownerId===ownerId&&stored.ruleRevisionId===ruleRevisionId,'CLAIM_NOT_REDEEMABLE','claim');
  return deepFreeze({...stored});
 }

 /** Voids the approval and its unredeemed claims. Idempotent. A request already redeemed cannot be recalled. */
 async function revokeApproval(principal:unknown,ruleRevisionId:unknown) {
  const ownerId=ownerOf(principal);
  check(isId(ruleRevisionId)&&await store.revokeApproval(ownerId,ruleRevisionId,clock()),'APPROVAL_NOT_FOUND','approval');
  return Object.freeze({ruleRevisionId,state:'revoked' as const});
 }

 return Object.freeze({approve,admit,claim,redeem,revokeApproval});
}
