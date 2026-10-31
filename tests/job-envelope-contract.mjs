import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {validateJobEnvelope,jobEnvelopeDigest,validateJobWake,matchJobWake,jobResourceSnapshot,assertJobResource} from '../tools/prototypes/job-envelope.mjs';
import {jobEnvelopeFixture as fixture,jobFixtureId as id,ownerA,ownerB} from './fixtures/job-envelope.mjs';
let checks=0;
function test(name,fn){try{fn();checks++;}catch(error){throw new Error(name,{cause:error});}}
const rejects=(fn,code)=>assert.throws(fn,e=>e.code===code);
function invalid(name,change,code,purpose='project-build'){test(name,()=>{const e=fixture(name,purpose);change(e);rejects(()=>validateJobEnvelope(e),code);});}
for(const purpose of ['platform-email','deterministic-rule','owner-push','account-cleanup','project-build','domain-registration'])test(purpose+' example',()=>{
 const e=fixture(purpose,purpose);assert.deepEqual(validateJobEnvelope(e),e);assert.notEqual(validateJobEnvelope(e),e);
 const reordered=Object.fromEntries(Object.entries(e).reverse());assert.equal(jobEnvelopeDigest(e),jobEnvelopeDigest(reordered));
 const changed=structuredClone(e);changed.intent.revision++;assert.notEqual(jobEnvelopeDigest(e),jobEnvelopeDigest(changed));
});
invalid('old version',e=>e.contractVersion=0,'unsupported_job_version');
invalid('future version',e=>e.contractVersion=2,'unsupported_job_version');
invalid('missing version',e=>delete e.contractVersion,'unknown_job_fields');
invalid('old untyped journal input',e=>e.contextHash='a'.repeat(64),'unknown_job_fields');
invalid('unregistered purpose',e=>e.purpose='arbitrary-fetch','unsupported_job_purpose');
invalid('scanner purpose not admitted',e=>e.purpose='scan','unsupported_job_purpose');
invalid('secret field',e=>e.token='synthetic-secret','unknown_job_fields');
invalid('inline private payload',e=>e.intent.payload='private text','unknown_job_fields');
invalid('provider URL',e=>e.intent.url='https://provider.invalid','unknown_job_fields');
invalid('physical DB locator',e=>e.resource.databaseId='provider-db','unknown_job_fields');
invalid('floating module pin',e=>e.resource.module.version='latest','INVALID_NUMBER');
invalid('unsupported adapter',e=>e.adapter.name='unregistered','unsupported_job_adapter');
invalid('future adapter',e=>e.adapter.version=2,'unsupported_job_adapter');
invalid('foreign resource',e=>e.resource.ref.projectId=id('foreign'),'foreign_job_resource');
invalid('resource removed',e=>e.resource=null,'invalid_job_scope');
invalid('platform email cannot target project',e=>e.projectId=id('foreign'),'invalid_job_scope','platform-email');
invalid('enrollment authority',e=>e.actor.purpose='enrollment','restricted_job_actor');
invalid('recovery authority',e=>e.actor.purpose='recovery','restricted_job_actor');
invalid('visitor authority',e=>e.actor.kind='visitor','restricted_job_actor');
invalid('copied allowed flag',e=>e.actor.allowed=true,'unknown_job_fields');
invalid('foreign account without membership',e=>e.actor.accountId=ownerB,'foreign_job_actor');
invalid('secret session token',e=>e.actor.sessionToken='synthetic','unknown_job_fields');
invalid('zero epoch',e=>e.actor.authEpoch=0,'foreign_job_actor');
invalid('email cannot borrow rule authority',e=>e.actor={kind:'approved-rule',ruleId:id('r'),revision:1,approvalReceiptId:id('a')},'unknown_job_fields','platform-email');
invalid('rule requires feature scope',e=>e.eligibility=null,'invalid_job','deterministic-rule');
invalid('rule wrong feature',e=>e.eligibility.featureId='ai.standard','invalid_job_eligibility','deterministic-rule');
invalid('rule wrong scope',e=>e.eligibility.projectId=null,'invalid_job_eligibility','deterministic-rule');
invalid('scheduled after expiry',e=>e.schedule.notBefore=e.schedule.expiresAt,'invalid_job_schedule');
invalid('unlimited attempts',e=>e.limits.maxAttempts=4,'invalid_job_limits');
invalid('unbounded invocation',e=>e.limits.deadlineMs=20001,'invalid_job_limits');
invalid('oversized envelope',e=>e.extra='x'.repeat(8192),'job_too_large');
test('future membership is a reference, never an implemented authority',()=>{
 const e=fixture('member','project-build');e.actor.accountId=ownerB;e.actor.membership={id:id('membership'),revision:2};
 assert.equal(validateJobEnvelope(e).ownerAccountId,ownerA);
});
test('resource snapshot follows the shared placement contract',()=>{
 const e=fixture('resource','deterministic-rule'),descriptor={contractVersion:1,ref:e.resource.ref,kind:'automation',module:e.resource.module,schema:e.resource.schema,
  ownership:{data:[],assets:[]},dependencies:[],lifecycle:{exportFormat:1,exportHook:null,deleteHook:'delete-v1',restoreHook:'restore-v1',migrateHook:'migrate-v1',portability:'not-verified'}};
 e.resource=jobResourceSnapshot(descriptor,3);assertJobResource(e,descriptor,3);
 rejects(()=>assertJobResource(e,descriptor,4),'stale_job_resource');
 const changed=structuredClone(descriptor);changed.schema.digest='f'.repeat(64);rejects(()=>assertJobResource(e,changed,3),'stale_job_resource');
 changed.schema=descriptor.schema;changed.ref.resourceId=id('replacement');rejects(()=>assertJobResource(e,changed,3),'stale_job_resource');
});
test('wake contains IDs only and binds the exact envelope',()=>{
 const e=fixture('wake'),wake={contractVersion:1,deliveryId:id('delivery'),jobId:e.jobId,envelopeDigest:jobEnvelopeDigest(e)};
 assert.deepEqual(validateJobWake(wake),wake);assert.deepEqual(matchJobWake(wake,e),wake);
 rejects(()=>matchJobWake({...wake,envelopeDigest:'f'.repeat(64)},e),'stale_job_delivery');
 rejects(()=>matchJobWake({...wake,jobId:id('other')},e),'stale_job_delivery');
 rejects(()=>validateJobWake({...wake,actor:e.actor}),'unknown_job_fields');
 rejects(()=>validateJobWake({...wake,providerToken:'synthetic'}),'unknown_job_fields');
 rejects(()=>validateJobWake({...wake,contractVersion:0}),'unsupported_job_version');
});
test('job feature identifier exists in current catalogue',()=>assert.match(readFileSync('src/plan-features.ts','utf8'),/id:'business\.workflows'/));
// WH-194: the domain registration purpose runs under the owner's workspace session, pins no module resource and registers once.
invalid('domain registration retried',e=>e.limits.maxAttempts=2,'invalid_job_limits','domain-registration');
invalid('domain registration without a project',e=>e.projectId=null,'invalid_job_scope','domain-registration');
invalid('domain registration with a platform actor',e=>e.actor={kind:'platform-obligation',obligationId:id('x'),policyRevision:1},'unknown_job_fields','domain-registration');
invalid('domain registration with a module resource',e=>e.resource=fixture('r','project-build').resource,'invalid_job_scope','domain-registration');
console.log(`Job envelope contract: ${checks} offline cases passed. Shared resource pins, bounded current metadata and delivery identity only; no runtime authorization, scheduler or provider/scanner execution.`);
