import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {currentSiteFixtureHandlers,createFixtureProject,proposeFixtureWebsite,applyFixtureWebsite,configureFixtureModules} from './current-site-fixture.mjs';
import {moduleInstances} from './fixtures/module-compositions/instances.mjs';
import {printOutcomeCosts} from '../tools/report-outcome-costs.mjs';

const bundle=await build({stdin:{contents:"export * from './src/outcome-producer';export * from './src/outcome-cost';export * from './src/cost-events';export * from './src/cost-event-store';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
const api=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const m=await currentSiteFixtureHandlers(),fixture=await databaseFixture({d1:process.argv.includes('--d1')}),db=fixture.db;
const originalFetch=globalThis.fetch;let network=0;
globalThis.fetch=async()=>{network++;throw Error('No inference, provider or external request is available');};
const id=()=>crypto.randomUUID(),marker='PRIVATE-OWNER-PROMPT-SOURCE-TEXT-'+id();
const from=new Date().toISOString().slice(0,10)+'T00:00:00.000Z',to=new Date(Date.parse(from)+86400000).toISOString(),before=new Date(Date.parse(from)-86400000).toISOString();
let n=0,cases=0;
const check=async(name,fn)=>{try{await fn();cases++;}catch(e){console.error('FAILED:',name);throw e;}};
const cls=(r,c)=>r.report.classes.find(x=>x.outcomeClass===c);
async function cost(owner,project,task,over={}){
 const e={contractVersion:1,source:'inference-receipt',sourceEventId:'fixture-'+(++n),providerEventId:null,revision:1,kind:'usage',dimension:'ai.inference.call',workload:'chat-ai',workClass:'task',taskRef:task,attempt:1,
  attribution:{scope:'tenant',ownerId:owner,projectId:project,resourceId:null},placementClass:'shared-api',quantity:{state:'known',value:1,unit:'call'},cost:{basis:'receipt',micros:100,ref:'synthetic'},outcome:'settled',customerUnits:0,aiTier:'standard',detail:{inputTokens:10,outputTokens:20},occurredAt:from,observedAt:from,idempotencyKey:'',...over};
 e.idempotencyKey=await api.idempotencyKey(e);return api.validateCostEvent(e);
}
const add=async(...args)=>{const e=await cost(...args);await api.appendCostEvent(db,e);return e;};
try{
 const A=await workspaceFixture(db,m),B=await workspaceFixture(db,m),a=await A.scope(),b=await B.scope();
 const p=await createFixtureProject(a,A.account,marker,marker),other=await createFixtureProject(a,A.account,marker,marker),foreign=await createFixtureProject(b,B.account,marker,marker);
 const spec=JSON.parse((await db.prepare('SELECT spec_json FROM project_spec_versions WHERE version_id=?').bind(p.version).first()).spec_json),headline=spec.pages[0].headline;
 const stale=await proposeFixtureWebsite(a,A.account,p.project,[{type:'content.replace',contentId:headline,text:marker+'-stale'}],m);
 const q=await proposeFixtureWebsite(a,A.account,p.project,[{type:'content.replace',contentId:headline,text:marker+'-applied'}],m);
 const applied=await applyFixtureWebsite(a,A.account,q,m);assert.equal(applied.status,200,applied.error);
 const failed={version:id()},failedRevision=(await m.readChat(a,A.account)).state.revision;
 await assert.rejects(()=>m.sendChatControl(a,A.account,{id:failed.version,revision:failedRevision,action:{type:'specificationApply',reviewId:stale.id,proposalDigest:stale.proposal_digest,expectedRevision:stale.expected_revision}}),e=>e.status===409);
 const pins=kind=>{const e=m.moduleCatalog.find(x=>x.kind===kind);return {module:{...e.module},schema:{...e.schema}};};
 const composition=await configureFixtureModules(a,A.account,p.project,[moduleInstances(pins).contentInstance],m);
 const otherReview=await proposeFixtureWebsite(a,A.account,other.project,[{type:'content.replace',contentId:headline,text:marker+'-other-project'}],m);
 assert.equal((await applyFixtureWebsite(a,A.account,otherReview,m)).status,200);
 // The second project composes the same content kind plus access and files through the real owner path (WH-078 reuse).
 const {accessInstance,filesInstance,contentInstance}=moduleInstances(pins);
 assert.ok(await configureFixtureModules(a,A.account,other.project,[contentInstance,accessInstance,filesInstance],m));
 const savedOnly=await proposeFixtureWebsite(a,A.account,p.project,[{type:'content.replace',contentId:headline,text:marker+'-not-applied'}],m);
 const turn=id(),revision=(await m.readChat(a,A.account)).state.revision;
 await a.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,mode,status,created_at) VALUES(?,?,?,?,'','ai','pending',?)").bind(turn,A.account,revision+1,marker,from).run();
 const plan=await m.compositionPlans.prepareCompositionPlan(a,A.account,turn,{kind:'capabilities',operation:'plan',projectId:p.project,needs:['custom.computation'],extension:{missing:marker}});
 await a.batch(plan.statements);
 let produced;
 await check('only committed receipt identities produce outcomes, not stale/failed/proposed/planned turns',async()=>{
  produced=await api.produceOutcomes(db,from,to,A.account);
  assert.equal(produced.receipts,4);assert.equal(produced.outcomes.length,4);
  assert.deepEqual(produced.unsupported,{missingVersion:0,classificationUnknown:0});
  assert.equal(produced.outcomes.filter(o=>o.outcomeClass==='configuration').length,2);
  assert.equal(produced.outcomes.filter(o=>o.outcomeClass==='composition').length,2);
  assert.ok(produced.outcomes.every(o=>o.success&&o.qualityPass===null&&o.fallback===null));
  assert.ok(produced.outcomes.some(o=>o.taskRef===applied.version));
  for(const t of [p.version,other.version,q.id,stale.id,failed.version,savedOnly.id,turn,foreign.version])assert.ok(!produced.outcomes.some(o=>o.taskRef===t));
  assert.deepEqual(api.producedMissingCapabilities,[]);
 });
 const revisionOne=await cost(A.account,p.project,q.id,{cost:{basis:'unknown',reason:'usage-pending',exposureMicros:300},outcome:'pending'});
 const revisionTwo=await api.validateCostEvent({...revisionOne,revision:2,cost:{basis:'receipt',micros:250,ref:'synthetic'},outcome:'settled',observedAt:new Date(Date.parse(from)+1000).toISOString()});
 await check('out-of-order settled revision, stale pending revision and duplicate delivery are counted once',async()=>{
  assert.equal((await api.appendCostEvent(db,revisionTwo)).status,'accepted');
  assert.equal((await api.appendCostEvent(db,revisionOne)).status,'stale-revision');
  assert.equal((await api.appendCostEvent(db,revisionTwo)).status,'duplicate');
 });
 await add(A.account,p.project,applied.version,{cost:{basis:'receipt',micros:50,ref:'synthetic'}});
 await add(A.account,p.project,applied.version,{occurredAt:before,observedAt:before,cost:{basis:'receipt',micros:70,ref:'synthetic'}});
 await add(A.account,null,composition.review.id,{cost:{basis:'shadow',micros:300,ref:'subscription-shadow'}});
 await add(A.account,p.project,composition.version,{cost:{basis:'unknown',reason:'usage-pending',exposureMicros:null},outcome:'uncertain'});
 await add(A.account,p.project,applied.version,{source:'cloudflare-usage-import',dimension:'worker.requests',workload:'site-publication',aiTier:null,detail:{},quantity:{state:'known',value:1000000,unit:'request'},cost:{basis:'tariff',tariff:{id:'pool-proposal',version:1}}});
 // Both same-owner/wrong-project and other-owner/same-task traps must stay out of the accepted outcome.
 await add(A.account,other.project,q.id,{cost:{basis:'receipt',micros:900,ref:'synthetic'}});
 await add(B.account,foreign.project,q.id,{cost:{basis:'receipt',micros:800,ref:'synthetic'}});
 // A wrong-project event outside the window is unrelated history, not unattributed work in this period.
 await add(A.account,other.project,q.id,{occurredAt:before,observedAt:before,cost:{basis:'receipt',micros:33,ref:'synthetic'}});
 await add(A.account,p.project,stale.id,{cost:{basis:'receipt',micros:110,ref:'synthetic'}});
 await add(A.account,p.project,failed.version,{cost:{basis:'receipt',micros:40,ref:'synthetic'}});
 await add(A.account,p.project,savedOnly.id,{cost:{basis:'unknown',reason:'usage-pending',exposureMicros:500},outcome:'pending'});
 await add(A.account,p.project,turn,{cost:{basis:'shadow',micros:60,ref:'subscription-shadow'}});
 await add(null,null,null,{source:'cloudflare-usage-import',dimension:'worker.requests',workload:'site-publication',aiTier:null,detail:{},quantity:{state:'known',value:1,unit:'request'},workClass:'standing',attribution:{scope:'platform',pool:'shared-account'},cost:{basis:'receipt',micros:700,ref:'synthetic'}});
 let result;
 await check('exact proposal/confirmation links preserve ownership, project isolation, bounds and minimization',async()=>{
  const queries=[];
  const readonly={prepare(sql){assert.match(sql,/^(SELECT|WITH) /);assert.doesNotMatch(sql,/SELECT\s+\*|user_text|assistant_text|\bname\b|plan_json|action_json|manifest_json/);queries.push(sql);return {bind(...p){const s=db.prepare(sql).bind(...p);return {async all(){const r=await s.all();assert.ok(!JSON.stringify(r.results).includes(marker));return r;}};}};}};
  result=await api.producedOutcomeCostReport(readonly,from,to,A.account);
  assert.equal(queries.length,2);assert.ok(queries.every(q=>/LIMIT (2001|10001)/.test(q)));
  const config=cls(result,'configuration'),comp=cls(result,'composition');
  assert.equal(config.cost.observedMicros,370);assert.ok(config.cost.tariffMicros>0);
  assert.equal(config.cost.knownMicros,370+config.cost.tariffMicros);
  assert.equal(comp.cost.shadowMicros,300);assert.equal(comp.cost.unknownEvents,1);assert.equal(comp.cost.unfinishedEvents,1);
  assert.equal(comp.cost.unboundedExposureEvents,1);
  assert.equal(result.report.unattributed.knownMicros,1050);assert.equal(result.report.unattributed.unknownEvents,1);
  assert.equal(result.report.unattributed.boundedExposureMicros,500);assert.equal(result.report.unattributed.shadowMicros,60);
  assert.equal(result.report.pooledOverhead.knownMicros,700);assert.equal(result.report.duplicateEventsDropped,1);
  assert.equal(result.report.customerUnits,0);assert.equal(config.qualityNotAssessed,2);assert.equal(comp.qualityNotAssessed,2);
  assert.equal(config.noCostEvents,1);assert.equal(api.compareClasses(result.report,'configuration','composition',{minSuccesses:1}).comparable,false);
  for(const c of ['custom-component','custom-backend','dedicated-runtime'])assert.equal(cls(result,c).outcomes,0);
  const serialized=JSON.stringify(result);
  for(const token of [marker,B.account,foreign.project,foreign.version,q.id,turn,'subscription-shadow'])assert.ok(!serialized.includes(token),token);
  assert.equal(result.report.classes.reduce((s,c)=>s+c.cost.observedMicros,0)+result.report.unattributed.observedMicros+result.report.pooledOverhead.observedMicros,2120);
 });
 await check('the operator printer runs end-to-end on the same populated current-schema database',async()=>{
  let printed;await printOutcomeCosts(db,from,to,A.account,text=>{printed=text;});assert.deepEqual(JSON.parse(printed),result);
 });
 await check('invalid windows and owner refuse before reading',async()=>{
  const noRead={prepare(){throw Error('must not read');}};
  for(const args of [[from,to,'private name'],[to,from,A.account],['2026-02-30T00:00:00.000Z',to,A.account],[before,new Date(Date.parse(before)+94*86400000).toISOString(),A.account]])await assert.rejects(()=>api.produceOutcomes(noRead,...args),e=>['INVALID_OWNER','INVALID_WINDOW'].includes(e.code));
 });
 await check('another account and the exclusive date boundary do not see these receipts',async()=>{
  const own=await api.producedOutcomeCostReport(db,from,to,B.account);assert.equal(own.evidence.produced,0);assert.equal(own.report.unattributed.knownMicros,800);
  const empty=await api.produceOutcomes(db,before,from,A.account);assert.equal(empty.receipts,0);
 });
 await check('ambiguous aliases, cross-outcome aliasing and unexpected link fields fail closed',async()=>{
  const link=produced.taskLinks[0],records=produced.outcomes;
  for(const links of [[link,link],[{...link,outcomeTaskRef:foreign.version}],[{...link,source:marker}],[{...link,taskRef:records.find(o=>o.taskRef!==link.taskRef).taskRef}]])assert.throws(()=>api.outcomeCostReport([],records,links),e=>e.code==='INVALID_TASK_LINK');
 });
 await check('read bounds refuse rather than report a partial prefix',async()=>{
  const overflow={prepare(){return {bind(){return {all:async()=>({results:Array(2001).fill({})})};}};}};
  await assert.rejects(()=>api.produceOutcomes(overflow,from,to,A.account),e=>e.code==='OUTCOME_BOUND');
  const oversized={prepare(sql){return /FROM cost_events/.test(sql)?{bind(){return {all:async()=>({results:Array(10001).fill({})})};}}:db.prepare(sql);}};
  await assert.rejects(()=>api.producedOutcomeCostReport(oversized,from,to,A.account),e=>e.code==='EVENT_BOUND');
 });
 await check('missing versions and unknown classifications stay unsupported, not inferred',async()=>{
  const known={valid_version:1,schema_version:3,compiler_version:7,known_instances:1,known_modules:1,instances:1,modules:1,content_instances:1,records_instances:0,files_instances:0,access_instances:0,notifications_module:0,automation_module:0};
  const row=over=>({id:id(),user_id:A.account,project_id:p.project,proposal_id:id(),...known,...over});
  // Per-kind instance counts that do not add up, or an extra-module flag that disagrees with the module count, are not classified.
  const rows=[{id:id(),user_id:A.account,project_id:p.project,proposal_id:id(),valid_version:0},{id:id(),user_id:A.account,project_id:p.project,proposal_id:id(),valid_version:1,schema_version:99},row({instances:2}),row({notifications_module:1}),row({modules:2})];
  const missing={prepare(){return {bind(){return {all:async()=>({results:rows})};}};}};
  const out=await api.produceOutcomes(missing,from,to,A.account);assert.equal(out.outcomes.length,0);assert.deepEqual(out.unsupported,{missingVersion:1,classificationUnknown:4});
  const fine=await api.produceOutcomes({prepare(){return {bind(){return {all:async()=>({results:[row({})]})};}};}},from,to,A.account);
  assert.equal(fine.outcomes.length,1);assert.equal(fine.reuse.byKind.find(k=>k.kind==='content').outcomes,1);
 });
 await check('composition reuse is counted from the same receipts by standard kind and distinct project, with no ids, names or configuration',async()=>{
  const reuse=result.reuse;
  assert.deepEqual(reuse,produced.reuse);
  assert.equal(reuse.successfulConfiguration,2);assert.equal(reuse.successfulComposition,2);assert.equal(reuse.compositionProjects,2);assert.equal(reuse.withoutEvidence,0);assert.equal(reuse.unsuccessful,0);
  assert.deepEqual(reuse.byKind,[{kind:'content',outcomes:2,projects:2,instances:2,reusedAcrossProjects:true},{kind:'records',outcomes:0,projects:0,instances:0,reusedAcrossProjects:false},
   {kind:'files',outcomes:1,projects:1,instances:1,reusedAcrossProjects:false},{kind:'access',outcomes:1,projects:1,instances:1,reusedAcrossProjects:false}]);
  assert.ok(reuse.byModule.every(k=>k.outcomes===0&&k.projects===0));
  assert.equal(reuse.costAllocated,false);assert.equal(reuse.moduleMaintenance,'not-measured');
  const serialized=JSON.stringify(reuse);
  for(const token of [marker,A.account,p.project,other.project,'listings','members','media','directory'])assert.ok(!serialized.includes(token),token);
 });
 assert.equal(network,0);console.log(`outcome-producer: ${cases} connected current-schema cases passed${process.argv.includes('--d1')?' (local D1)':''}; no network or provider calls`);
}catch(error){console.error(String(error.stack||error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundled module>'));process.exitCode=1;}
finally{globalThis.fetch=originalFetch;await fixture.close();}
