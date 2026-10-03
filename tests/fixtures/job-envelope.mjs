// Synthetic decision examples. UUIDs/digests are metadata, not authorization.
import {createHash} from 'node:crypto';
export const jobFixtureId=label=>{const h=createHash('sha256').update(label).digest('hex').slice(0,32);return [h.slice(0,8),h.slice(8,12),h.slice(12,16),h.slice(16,20),h.slice(20)].join('-');};
export const ownerA=jobFixtureId('owner-a'),ownerB=jobFixtureId('owner-b');
const pin=name=>({name,version:1,digest:'a'.repeat(64)});
export function jobEnvelopeFixture(label,purpose='platform-email',owner=ownerA,notBefore=0){
 const projectWork=['deterministic-rule','project-build'].includes(purpose),projectId=projectWork?jobFixtureId(owner+'-project'):null;
 return {contractVersion:1,jobId:jobFixtureId(label),ownerAccountId:owner,projectId,purpose,adapter:pin(purpose),
  actor:purpose==='project-build'?{kind:'workspace-session',accountId:owner,authorityId:jobFixtureId(label+'-session'),authEpoch:1,purpose:'workspace',membership:null}:
   purpose==='deterministic-rule'?{kind:'approved-rule',ruleId:jobFixtureId(label+'-rule'),revision:1,approvalReceiptId:jobFixtureId(label+'-approval')}:
   {kind:'platform-obligation',obligationId:jobFixtureId(label+'-obligation'),policyRevision:1},
  resource:projectWork?{ref:{projectId,resourceId:jobFixtureId(label+'-resource')},descriptorDigest:'b'.repeat(64),module:pin(purpose==='project-build'?'content':'automation'),schema:pin('job-input'),placementRevision:1}:null,
  intent:{operationId:jobFixtureId(label+'-operation'),receiptId:jobFixtureId(label+'-receipt'),receiptDigest:'c'.repeat(64),revision:0,inputReferenceId:jobFixtureId(label+'-input'),inputDigest:'d'.repeat(64)},
  eligibility:purpose==='deterministic-rule'?{featureId:'business.workflows',operation:'dispatch',projectId}:null,
  schedule:{createdAt:0,notBefore,expiresAt:604800000},limits:{maxAttempts:3,deadlineMs:20000}};
}
