// WH-143: single-use lookup consent (src/lookup-consent.ts) and its WH-105 Chat card binding, on disposable SQLite and, with --d1,
// actual local D1. Synthetic rows only: no provider, network, credential or model.
import assert from 'node:assert/strict';
Error.stackTraceLimit=0;
import {databaseFixture} from './helpers/current-database.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';
const modules=await currentFixtureModules(['src/lookup-consent.ts','src/chat-interactions/store.ts','src/chat-interactions/maintained.ts','src/chat-interactions/protocol.ts']);
const lc=await modules.module('src/lookup-consent.ts'),forms=await modules.module('src/chat-interactions/store.ts'),maintained=await modules.module('src/chat-interactions/maintained.ts'),protocol=await modules.module('src/chat-interactions/protocol.ts');
const fixture=await databaseFixture(),{db}=fixture;
const id=()=>crypto.randomUUID(),run=(q,...v)=>db.prepare(q).bind(...v).run(),row=(q,...v)=>db.prepare(q).bind(...v).first();
let cases=0;const test=async(name,fn)=>{try{await fn();cases++;}catch(error){console.error('FAILED:',name);throw error;}};
const code=expected=>({name:'Error',message:'Lookup consent '+expected});
const lookup={provider:'gmail',operationId:'messages.search',credentialId:'credential-1',params:{q:'invoice from Acme'},destination:'owner-panel'};
const approved={trainsOnData:false,approvedForConnectorContent:true};
async function owner(){const a=await workspaceFixture(db,modules.identity),user=a.account,scope=await a.scope();await paidPlan(db,user,'business');await run("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')",user);return {user,scope};}
// Same scope, but the statements' database clock runs 20 minutes ahead (the schema triggers keep the real clock).
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
// A consent that expires in 3 seconds, copying a real issued binding (the schema freezes expiry, so waiting is the honest way to test it).
async function shortLived(o,confirmed){const src=await row('SELECT * FROM lookup_consents WHERE consent_id=?',await lc.issueLookupConsent(o.scope,o.user,lookup)),cid=id(),now=Date.now();
 await run("INSERT INTO lookup_consents(consent_id,owner_id,provider,operation_id,credential_id,params_digest,destination,created_at,expires_at,state,revision) VALUES(?,?,?,?,?,?,?,?,?,'issued',1)",cid,o.user,src.provider,src.operation_id,src.credential_id,src.params_digest,src.destination,now-897000,now+3000);
 if(confirmed)await run("UPDATE lookup_consents SET state='confirmed',confirmed_at=?,revision=2 WHERE consent_id=?",now,cid);
 return cid;}
async function card(o,consentId){
 const turn=id();
 await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) SELECT ?,user_id,revision+1,'Look up an email','Review lookup',datetime('now'),'ai','completed' FROM workspace_state WHERE user_id=?",turn,o.user);
 await run('UPDATE workspace_state SET revision=revision+1 WHERE user_id=?',o.user);
 const plan=await forms.prepareLookupConsentIntake(o.scope,o.user,{originTurnId:turn,consentId});await o.scope.batch(plan.statements);
 const value=await forms.readInteraction(o.scope,o.user,plan.interactionId);
 return {value,card:{interactionId:value.envelope.id,definitionDigest:value.envelope.definitionDigest,cardId:'lookup-consent'}};
}
const state=(user,consentId)=>row('SELECT state FROM lookup_consents WHERE owner_id=? AND consent_id=?',user,consentId).then(r=>r?.state);
try{
 await test('issue: exact catalog read only, typed params, declared destination; model-context needs an approved non-training route',async()=>{
  const o=await owner(),cid=await lc.issueLookupConsent(o.scope,o.user,lookup);
  const stored=await row('SELECT * FROM lookup_consents WHERE consent_id=?',cid);
  assert.equal(stored.state,'issued');assert.equal(stored.owner_id,o.user);assert.match(stored.params_digest,/^[0-9a-f]{64}$/);assert.ok(stored.expires_at-stored.created_at<=900000);
  assert.ok(!JSON.stringify(stored).includes('invoice'),'parameters are digested, never stored');
  for(const bad of [{...lookup,provider:'github',operationId:'installations.list'},{...lookup,provider:'nobody'},{...lookup,operationId:'message.send'},{...lookup,operationId:'nope'},{...lookup,params:{}},{...lookup,params:{q:''}},{...lookup,params:{q:'x',extra:1}},{...lookup,destination:'chat-reply'},{...lookup,credentialId:'bad id!'},null])
   await assert.rejects(lc.issueLookupConsent(o.scope,o.user,bad),code('INVALID'));
  await assert.rejects(lc.issueLookupConsent(o.scope,o.user,{...lookup,destination:'model-context'}),code('MODEL_ROUTE'));
  for(const route of [{trainsOnData:true,approvedForConnectorContent:true},{trainsOnData:false,approvedForConnectorContent:false},{trainsOnData:null,approvedForConnectorContent:true}])
   await assert.rejects(lc.issueLookupConsent(o.scope,o.user,{...lookup,destination:'model-context'},route),code('MODEL_ROUTE'));
  await lc.issueLookupConsent(o.scope,o.user,{...lookup,destination:'model-context'},approved);
 });
 await test('issue: an owner holds at most 20 unexpired consents',async()=>{
  const o=await owner();for(let n=0;n<20;n++)await lc.issueLookupConsent(o.scope,o.user,lookup);
  await assert.rejects(lc.issueLookupConsent(o.scope,o.user,lookup),code('LIMIT'));
 });
 await test('card binding: the card names the consent; only the owner confirms, once, through that card',async()=>{
  const o=await owner(),other=await owner(),cid=await lc.issueLookupConsent(o.scope,o.user,lookup),c=await card(o,cid);
  assert.deepEqual(maintained.lookupConsentCard(c.value.envelope.definition),{cardId:'lookup-consent',consentId:cid});
  assert.equal(c.value.envelope.definition.cards[0].reviewId,cid);
  await protocol.requireCurrentClient(c.value.envelope,{versions:[1],fieldTypes:[],bindings:['connector.lookup-consent@1']});
  await assert.rejects(protocol.requireCurrentClient(c.value.envelope,{versions:[1],fieldTypes:[],bindings:[]}),{code:'CLIENT_UPDATE_REQUIRED'});
  assert.deepEqual(await lc.readLookupConsentSummary(o.scope,o.user,c.card),{version:1,provider:'gmail',operationId:'messages.search',destination:'owner-panel',expiresAt:new Date(stored(await row('SELECT expires_at e FROM lookup_consents WHERE consent_id=?',cid))).toISOString(),state:'issued'});
  // Another account, a stale digest, a wrong card ID, or a foreign consent cannot use the card.
  await assert.rejects(lc.confirmLookupConsent(other.scope,other.user,c.card),{status:404});
  for(const bad of [{...c.card,definitionDigest:'d'.repeat(64)},{...c.card,cardId:'other'}])await assert.rejects(lc.confirmLookupConsent(o.scope,o.user,bad),code('CARD'));
  const foreign=await lc.issueLookupConsent(other.scope,other.user,lookup);
  await assert.rejects(card(o,foreign),/chat_interaction_changed|constraint|denied|CHECK/i);
  assert.equal(await state(o.user,cid),'issued');
  await lc.confirmLookupConsent(o.scope,o.user,c.card);assert.equal(await state(o.user,cid),'confirmed');
  await assert.rejects(lc.confirmLookupConsent(o.scope,o.user,c.card),code('ALREADY_CONFIRMED'));
  assert.equal((await lc.readLookupConsentSummary(o.scope,o.user,c.card)).state,'confirmed');
 });
 await test('card binding: a dismissed card, an expired consent and a model-context consent on the training route do not confirm',async()=>{
  const o=await owner(),a=await lc.issueLookupConsent(o.scope,o.user,lookup),ca=await card(o,a);
  await forms.mutateInteraction(o.scope,o.user,{version:1,requestId:id(),interactionId:ca.card.interactionId,definitionDigest:ca.card.definitionDigest,expectedAnswerRevision:0,operation:'cancel'});
  await assert.rejects(lc.confirmLookupConsent(o.scope,o.user,ca.card),{status:410});
  const b=await shortLived(o,false),cb=await card(o,b);await sleep(4300);
  await assert.rejects(lc.confirmLookupConsent(o.scope,o.user,cb.card),code('EXPIRED'));
  const m=await lc.issueLookupConsent(o.scope,o.user,{...lookup,destination:'model-context'},approved),cm=await card(o,m);
  await assert.rejects(lc.confirmLookupConsent(o.scope,o.user,cm.card),code('MODEL_ROUTE'));
  await lc.confirmLookupConsent(o.scope,o.user,cm.card,approved);
 });
 await test('consume: only a confirmed consent, exactly once, for the identical lookup',async()=>{
  const o=await owner(),cid=await lc.issueLookupConsent(o.scope,o.user,lookup);
  await assert.rejects(lc.consumeLookupConsent(o.scope,o.user,cid,lookup),code('NOT_CONFIRMED'));
  await lc.confirmLookupConsent(o.scope,o.user,(await card(o,cid)).card);
  for(const bad of [{...lookup,credentialId:'credential-2'},{...lookup,params:{q:'invoice from Other'}},{...lookup,operationId:'message.get',params:{id:'abc'}},{...lookup,provider:'hubspot'},{...lookup,destination:'model-context'}])
   await assert.rejects(lc.consumeLookupConsent(o.scope,o.user,cid,bad,approved),/Lookup consent (MISMATCH|INVALID)/);
  assert.equal(await state(o.user,cid),'confirmed','a refused lookup does not spend the consent');
  await assert.rejects(lc.consumeLookupConsent(o.scope,o.user,'not-an-id',lookup),code('INVALID'));
  await lc.consumeLookupConsent(o.scope,o.user,cid,lookup);
  assert.equal(await state(o.user,cid),'used');assert.ok((await row('SELECT settled_at s FROM lookup_consents WHERE consent_id=?',cid)).s>0);
  await assert.rejects(lc.consumeLookupConsent(o.scope,o.user,cid,lookup),code('ALREADY_USED'));
 });
 await test('consume: concurrent attempts spend it once; foreign, expired, voided and unknown consents are refused',async()=>{
  const o=await owner(),other=await owner(),cid=await lc.issueLookupConsent(o.scope,o.user,lookup);
  await lc.confirmLookupConsent(o.scope,o.user,(await card(o,cid)).card);
  await assert.rejects(lc.consumeLookupConsent(other.scope,other.user,cid,lookup),code('NOT_FOUND'));
  await assert.rejects(lc.consumeLookupConsent(o.scope,o.user,id(),lookup),code('NOT_FOUND'));
  const old=await shortLived(o,true);await sleep(4300);await assert.rejects(lc.consumeLookupConsent(o.scope,o.user,old,lookup),code('EXPIRED'));
  const results=await Promise.allSettled([1,2,3].map(()=>lc.consumeLookupConsent(o.scope,o.user,cid,lookup)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const v=await lc.issueLookupConsent(o.scope,o.user,lookup);await run("UPDATE lookup_consents SET state='voided',settled_at=unixepoch()*1000,revision=revision+1 WHERE consent_id=?",v);
  await assert.rejects(lc.consumeLookupConsent(o.scope,o.user,v,lookup),code('VOIDED'));
 });
 await test('consume: a model-context consent is refused when the route trains on data, even if confirmed under another route',async()=>{
  const o=await owner(),input={...lookup,destination:'model-context'},cid=await lc.issueLookupConsent(o.scope,o.user,input,approved);
  await lc.confirmLookupConsent(o.scope,o.user,(await card(o,cid)).card,approved);
  await assert.rejects(lc.consumeLookupConsent(o.scope,o.user,cid,input),code('MODEL_ROUTE'));
  assert.equal(await state(o.user,cid),'confirmed');
  await lc.consumeLookupConsent(o.scope,o.user,cid,input,approved);
 });
 await test('model-route gate: the current route is training-enabled and not approved',()=>{
  assert.deepEqual({...lc.currentModelRoute},{trainsOnData:true,approvedForConnectorContent:false});
  assert.throws(()=>lc.assertModelRoute('model-context',lc.currentModelRoute),code('MODEL_ROUTE'));
  lc.assertModelRoute('owner-panel',lc.currentModelRoute);lc.assertModelRoute('model-context',approved);
 });
}finally{await fixture.close?.();}
function stored(r){return r.e;}
console.log(`lookup-consent: ${cases} cases passed (${process.argv.includes('--d1')?'actual local D1':'in-memory SQLite'}).`);
