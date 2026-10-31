// WH-052 offline contract reference. This validates metadata, never permission.
// No Worker, provider, credential, user payload or runtime scheduler imports.
import {createHash} from 'node:crypto';
import {validateResourceReference,validateArtifactPin,validateDescriptor,descriptorDigest} from './workload-placement.mjs';
export class JobEnvelopeError extends Error {constructor(code){super(code);this.code=code;}}
const check=(ok,code='invalid_job')=>{if(!ok)throw new JobEnvelopeError(code);};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const shape=(v,keys)=>{check(plain(v));check(Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k)),'unknown_job_fields');};
const uuid=v=>check(typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v),'invalid_job_id');
const integer=v=>check(Number.isSafeInteger(v)&&v>=0,'invalid_job_number');
const hash=v=>check(typeof v==='string'&&/^[0-9a-f]{64}$/.test(v),'invalid_job_digest');
function canonical(v,depth=0){
 check(depth<=10,'job_too_deep');
 if(v===null||typeof v==='string'||typeof v==='boolean')return JSON.stringify(v);
 if(typeof v==='number'){integer(v);return JSON.stringify(v);}
 if(Array.isArray(v)){check(v.length<=16,'job_too_many_items');return '['+v.map(x=>canonical(x,depth+1)).join(',')+']';}
 check(plain(v));return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k],depth+1)).join(',')+'}';
}
function copy(v,max=8192){const json=canonical(v);check(Buffer.byteLength(json)<=max,'job_too_large');return JSON.parse(json);}
export const jobPurposes=['platform-email','deterministic-rule','owner-push','account-cleanup','project-build','domain-registration'];
export function validateJobEnvelope(input){
 const e=copy(input);
 shape(e,['contractVersion','jobId','ownerAccountId','projectId','purpose','adapter','actor','resource','intent','eligibility','schedule','limits']);
 check(e.contractVersion===1,'unsupported_job_version');uuid(e.jobId);uuid(e.ownerAccountId);if(e.projectId!==null)uuid(e.projectId);
 check(jobPurposes.includes(e.purpose),'unsupported_job_purpose');validateArtifactPin(e.adapter);
 check(e.adapter.name===e.purpose&&e.adapter.version===1,'unsupported_job_adapter');
 shape(e.intent,['operationId','receiptId','receiptDigest','revision','inputReferenceId','inputDigest']);
 for(const k of ['operationId','receiptId','inputReferenceId'])uuid(e.intent[k]);
 hash(e.intent.receiptDigest);hash(e.intent.inputDigest);integer(e.intent.revision);
 if(e.purpose==='project-build'||e.purpose==='domain-registration'){
  shape(e.actor,['kind','accountId','authorityId','authEpoch','purpose','membership']);
  check(e.actor.kind==='workspace-session'&&e.actor.purpose==='workspace','restricted_job_actor');
  uuid(e.actor.accountId);uuid(e.actor.authorityId);integer(e.actor.authEpoch);
  if(e.actor.membership!==null){shape(e.actor.membership,['id','revision']);uuid(e.actor.membership.id);integer(e.actor.membership.revision);}
  check(e.actor.authEpoch>0&&(e.actor.accountId===e.ownerAccountId?e.actor.membership===null:e.actor.membership!==null),'foreign_job_actor');
 }else if(e.purpose==='deterministic-rule'){
  shape(e.actor,['kind','ruleId','revision','approvalReceiptId']);
  check(e.actor.kind==='approved-rule','restricted_job_actor');uuid(e.actor.ruleId);uuid(e.actor.approvalReceiptId);integer(e.actor.revision);
 }else{
  shape(e.actor,['kind','obligationId','policyRevision']);
  check(e.actor.kind==='platform-obligation','restricted_job_actor');uuid(e.actor.obligationId);integer(e.actor.policyRevision);
  check(e.actor.policyRevision>0,'invalid_job_number');
 }
 if(e.resource!==null){
  shape(e.resource,['ref','descriptorDigest','module','schema','placementRevision']);
  validateResourceReference(e.resource.ref);hash(e.resource.descriptorDigest);
  validateArtifactPin(e.resource.module);validateArtifactPin(e.resource.schema);integer(e.resource.placementRevision);
  check(e.resource.ref.projectId===e.projectId,'foreign_job_resource');
 }
 const projectWork=['project-build','deterministic-rule'].includes(e.purpose);
 // A domain registration belongs to one project's order but pins no module resource; its register step runs once (docs/domain-purchases.md).
 check(e.purpose==='domain-registration'?(e.projectId!==null&&e.resource===null):projectWork?(e.projectId!==null&&e.resource!==null):(e.projectId===null&&e.resource===null),'invalid_job_scope');
 if(e.purpose==='deterministic-rule'){
  shape(e.eligibility,['featureId','operation','projectId']);
  check(e.eligibility.featureId==='business.workflows'&&e.eligibility.operation==='dispatch'&&e.eligibility.projectId===e.projectId,'invalid_job_eligibility');
 }else check(e.eligibility===null,'invalid_job_eligibility');
 shape(e.schedule,['createdAt','notBefore','expiresAt']);for(const n of Object.values(e.schedule))integer(n);
 check(e.schedule.createdAt<=e.schedule.notBefore&&e.schedule.notBefore<e.schedule.expiresAt,'invalid_job_schedule');
 shape(e.limits,['maxAttempts','deadlineMs']);integer(e.limits.maxAttempts);integer(e.limits.deadlineMs);
 check(e.limits.maxAttempts>=1&&e.limits.maxAttempts<=3&&e.limits.deadlineMs>=1&&e.limits.deadlineMs<=20000,'invalid_job_limits');
 check(e.purpose!=='domain-registration'||e.limits.maxAttempts===1,'invalid_job_limits');
 return e;
}
export const jobEnvelopeDigest=input=>createHash('sha256').update(canonical(validateJobEnvelope(input))).digest('hex');
/** Compare a trusted registry snapshot; this is not a runtime resource resolver. */
export function jobResourceSnapshot(input,placementRevision){
 const d=validateDescriptor(input);integer(placementRevision);
 return {ref:d.ref,descriptorDigest:descriptorDigest(d),module:d.module,schema:d.schema,placementRevision};
}
export function assertJobResource(input,currentDescriptor,currentPlacementRevision){
 const e=validateJobEnvelope(input),current=jobResourceSnapshot(currentDescriptor,currentPlacementRevision);
 check(e.resource!==null&&canonical(e.resource)===canonical(current),'stale_job_resource');
}
/** A transport wake can only point to D1 state. It contains no actor or authority. */
export function validateJobWake(input){
 const w=copy(input,512);shape(w,['contractVersion','deliveryId','jobId','envelopeDigest']);
 check(w.contractVersion===1,'unsupported_job_version');uuid(w.deliveryId);uuid(w.jobId);hash(w.envelopeDigest);return w;
}
export function matchJobWake(input,envelope){
 const w=validateJobWake(input),e=validateJobEnvelope(envelope);
 check(w.jobId===e.jobId&&w.envelopeDigest===jobEnvelopeDigest(e),'stale_job_delivery');return w;
}
