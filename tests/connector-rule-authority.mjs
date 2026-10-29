import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';

// WH-145: src/connector-catalog/rule-authority.ts against the reference runtime in tools/prototypes/connectors.mjs.
// Synthetic data only; no database, network or credential.
const root=fileURLToPath(new URL('..',import.meta.url));
const entry="export * from './src/connector-catalog/catalog';export * from './src/connector-catalog/rule-authority';export {createReferenceRuntime,digest} from './tools/prototypes/connectors.mjs';";
const out=await build({stdin:{contents:entry,resolveDir:root,loader:'ts'},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
const m=await import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));

const live=()=>{const c=structuredClone(m.connectorCatalog);for(const e of Object.values(c.providers))e.readiness='live-accepted';return c;};
const params={},body={properties:{email:'lead@example.test'}};
const approval={operationId:'contact.create',destinationDigest:m.digest(params),bodyTemplateDigest:m.digest(body),maxPerPeriod:2,credentialId:'cred-1'};
const rule=(extra={})=>({kind:'rule',ownerId:'owner-a',ruleId:'rule-1',ruleRevision:3,jobDigest:'j'.repeat(64),approval,...extra});
const use=(extra={})=>({providerId:'hubspot',operationId:'contact.create',destinationDigest:approval.destinationDigest,bodyTemplateDigest:approval.bodyTemplateDigest,credentialId:'cred-1',usedThisPeriod:0,...extra});
const admit=(catalog,p,u)=>{try{m.admitRuleAction(catalog,p,u);}catch(e){return e.code;}return null;};

// Reference outcome from the prototype's prepareAction for the same principal and inputs.
function reference(catalog,principal,provider,op,reqParams=params,reqBody=body){
 const rt=m.createReferenceRuntime({catalog,transport:async()=>{throw new Error('no network');}});
 rt.connect('owner-a',provider,{token_type:'Bearer',access_token:'a',expires_in:1800,refresh_token:'r'});
 try{rt.prepareAction(principal,provider,op,reqParams,reqBody);}catch(e){return e.code;}return null;
}

// Refusal codes shared with the reference.
assert.equal(admit(m.connectorCatalog,rule(),use()),'ADAPTER_NOT_ACCEPTED');
const synthetic=structuredClone(m.connectorCatalog);for(const e of Object.values(synthetic.providers))e.readiness='synthetic-conformant';
assert.equal(reference(synthetic,rule(),'hubspot','contact.create'),'ADAPTER_NOT_ACCEPTED');
assert.equal(admit(live(),rule(),use({providerId:'gmail',operationId:'message.send'})),'OWNER_REQUEST_ONLY');
assert.equal(reference(live(),rule(),'gmail','message.send'),'OWNER_REQUEST_ONLY');
assert.equal(admit(live(),rule({approval:undefined}),use()),'RULE_APPROVAL_REQUIRED');
assert.equal(reference(live(),rule({approval:undefined}),'hubspot','contact.create'),'RULE_APPROVAL_REQUIRED');
assert.equal(admit(live(),rule(),use({destinationDigest:m.digest({x:1})})),'RULE_DESTINATION_MISMATCH');
assert.equal(reference(live(),rule({approval:{...approval,destinationDigest:m.digest({x:1})}}),'hubspot','contact.create'),'RULE_DESTINATION_MISMATCH');
assert.equal(admit(live(),rule(),use({bodyTemplateDigest:m.digest({x:1})})),'RULE_DESTINATION_MISMATCH');
assert.equal(reference(live(),rule(),'hubspot','contact.create',params,{properties:{email:'other@example.test'}}),'RULE_DESTINATION_MISMATCH');
assert.equal(admit(live(),rule(),use({usedThisPeriod:2})),'RULE_LIMIT');
assert.equal(reference(live(),rule({approval:{...approval,maxPerPeriod:0}}),'hubspot','contact.create'),'RULE_LIMIT');
// RULE_READ_FORBIDDEN: the reference refuses a rule read before admission.
assert.equal(admit(live(),rule(),use({providerId:'gmail',operationId:'messages.search'})),'RULE_READ_FORBIDDEN');
{
 const rt=m.createReferenceRuntime({catalog:live(),transport:async()=>{throw new Error('no network');}});
 await assert.rejects(()=>rt.read(rule(),'gmail','messages.search',{q:'x'}),e=>e.code==='RULE_READ_FORBIDDEN');
}

// Every real adapter refuses today: nothing is live-accepted.
for(const [id,e] of Object.entries(m.connectorCatalog.providers))assert.notEqual(e.readiness,'live-accepted',id);

// Other principals and unknown names.
for(const kind of ['owner','visitor','runtime','maintainer','external-content'])assert.equal(admit(live(),rule({kind}),use()),'PRINCIPAL_FORBIDDEN',kind);
assert.equal(admit(live(),rule(),use({providerId:'nope'})),'UNKNOWN_PROVIDER');
assert.equal(admit(live(),rule(),use({operationId:'nope'})),'UNKNOWN_OPERATION');

// Malformed approval or rule identity.
const without=k=>Object.fromEntries(Object.entries(approval).filter(([key])=>key!==k));
for(const bad of [null,'x',{...approval,maxPerPeriod:0},{...approval,maxPerPeriod:1.5},{...approval,credentialId:''},without('bodyTemplateDigest'),without('credentialId')])
 assert.equal(admit(live(),rule({approval:bad}),use()),'RULE_APPROVAL_REQUIRED',JSON.stringify(bad));
for(const extra of [{ruleId:undefined},{ruleRevision:'3'},{jobDigest:undefined}])assert.equal(admit(live(),rule(extra),use()),'RULE_APPROVAL_REQUIRED');

// Each bound field, one at a time.
assert.equal(admit(live(),rule({approval:{...approval,operationId:'contact.update'}}),use()),'RULE_DESTINATION_MISMATCH');
assert.equal(admit(live(),rule(),use({destinationDigest:'0'.repeat(64)})),'RULE_DESTINATION_MISMATCH');
assert.equal(admit(live(),rule(),use({bodyTemplateDigest:'0'.repeat(64)})),'RULE_DESTINATION_MISMATCH');
assert.equal(admit(live(),rule(),use({credentialId:'cred-2'})),'RULE_CREDENTIAL_MISMATCH');
assert.equal(admit(live(),rule(),use({usedThisPeriod:-1})),'RULE_LIMIT');

// The exact bound use is admitted up to the limit, in both implementations.
assert.deepEqual(m.admitRuleAction(live(),rule(),use({usedThisPeriod:1})),approval);
assert.equal(reference(live(),rule(),'hubspot','contact.create'),null);
console.log('connector-rule-authority: ok');
