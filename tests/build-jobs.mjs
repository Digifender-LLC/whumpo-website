// WH-074 pooled build job envelope: two-tenant contamination/cache separation, output ownership, cancellation,
// expiry, lease isolation, recorded cleanup failure, bounded capacity, owner session replay/concurrency, no visitor or
// workflow wake path, deterministic diagnostics before any optional model call, and the WH-050 operator `build` freeze.
// Uses the actual QuickJS runtime.
import {fixtureExtensionPlan} from './helpers/composition.mjs';
Error.stackTraceLimit=0;
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {currentSiteFixtureHandlers,enableFixtureVisitorAccess} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
import {runContainment,containmentInput,newActionId} from '../tools/operator-containment-input.mjs';
const m=await currentSiteFixtureHandlers(),store=await databaseFixture(),db=store.db,sql=store.sql;
const {buildJobs:J,backendChat:{backendAction:rawBackendAction,backendChatCommand},appActivation:{prepareApplication},sendAIChat,readChat,sendChat}=m;
const owners=new Map(),scopes=new Map(),scope=user=>scopes.get(user),id=()=>crypto.randomUUID(),sha=x=>createHash('sha256').update(x).digest('hex');
// WH-126: an application consumes its project's visitor access module, saved and activated through the real owner
// path. Those owner controls run before the account has any synthetic pending build turn, so `apps` projects are
// prepared up front and handed out by project(); other projects (and draft envelopes) have no access module.
const pools=new Map();
async function account(user=id(),apps=0){const authority=await workspaceFixture(db,m,user);owners.set(user,authority);scopes.set(user,await authority.scope());
 const pool=[];for(let i=0;i<apps;i++){const p=await plainProject(user);await enableFixtureVisitorAccess(scope(user),user,p);pool.push(p);}pools.set(user,pool);return user;}
// Synthetic build turns use revisions far above the owners' own Chat revisions (fixture access controls, later Chat).
const stamp=new Date().toISOString();let revision=100000;
async function plainProject(owner){const p=id();await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Notebook','','draft',?,?)").bind(p,owner,stamp,stamp).run();return p;}
async function project(owner){return pools.get(owner)?.shift()??plainProject(owner);}
async function turn(owner){const t=id();await db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,?,'Build it','','2026-10-04T00:00:00.000Z','ai','pending')").bind(t,owner,++revision).run();return t;}
async function build(owner,p,t,source,input,expected,service){
 const planId=await fixtureExtensionPlan(scope(owner),owner,p,t,'custom.visitor-transition');
 return (await rawBackendAction(scope(owner),owner,t,{kind:'backend',operation:'buildApplication',projectId:p,source,input,expected,planId},service)).reply;
}
const note='export default ({state,input})=>({state:{note:input.note},result:"Saved"})';
const noteIn=v=>({state:{},input:{note:v}}),noteOut=v=>({state:{note:v},result:'Saved'});
const job=t=>db.prepare('SELECT * FROM build_jobs WHERE id=?').bind(t).first();
const cleanups=t=>db.prepare('SELECT attempt,outcome,reason,held_ms FROM build_job_cleanups WHERE job_id=? ORDER BY attempt').bind(t).all().then(r=>r.results);
/** Ages fixture timestamps by lifting the transition trigger for one statement, as other expiry fixtures do. */
function age(t,columns){
 const trigger=sql.prepare("SELECT sql FROM sqlite_master WHERE name='build_job_transition'").get().sql;sql.exec('DROP TRIGGER build_job_transition');
 try{for(const [column,modifier] of Object.entries(columns))sql.prepare(`UPDATE build_jobs SET ${column}=strftime('%Y-%m-%dT%H:%M:%fZ','now',?) WHERE id=?`).run(modifier,t);}finally{sql.exec(trigger);}
}
/** A saved owner build intent without dispatch, for direct envelope checks. */
async function draft(owner,p=undefined){
 p??=await plainProject(owner);const t=await turn(owner),source=note+'//'+t,digest=sha(source);
 await db.prepare('INSERT INTO backend_versions(id,project_id,source,digest,created_at) VALUES(?,?,?,?,?)').bind(t,p,source,digest,stamp).run();
 await db.prepare('INSERT INTO application_builds(id,project_id,user_id,request_hash) VALUES(?,?,?,?)').bind(t,p,owner,'a'.repeat(64)).run();
 return {t,p,digest,admit:async()=>{const admitted=await J.admitBuildJob(db,{id:t,user:owner,project:p,inputDigest:'b'.repeat(64),sourceDigest:digest});await admitted.statement.run();return admitted.lease;}};
}
const dir=await mkdtemp('/tmp/whumpo-build-jobs-');let runtime;
try{
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--config','wrangler.runtime.jsonc','--dry-run','--outdir',dir+'/runtime'],{stdio:'pipe',maxBuffer:16*1024*1024});
 const require=createRequire(import.meta.resolve('wrangler')),{Miniflare,convertV4MiniflareOptions}=require('miniflare');
 runtime=new Miniflare(convertV4MiniflareOptions({modulesRoot:dir+'/runtime',modules:[{type:'ESModule',path:dir+'/runtime/worker.js'},...(await readdir(dir+'/runtime')).filter(p=>p.endsWith('.wasm')).map(p=>({type:'CompiledWasm',path:dir+'/runtime/'+p}))],compatibilityDate:'2026-09-29'}));
 let calls=0,gate=null,onCall=null;
 const service={fetch:async(url,init)=>{calls++;await onCall?.();if(gate)await gate;return runtime.dispatchFetch(url,init);}};
 const [alice,bob]=[await account(undefined,4),await account(undefined,2)];

 // 1. Two tenants: fresh runtime memory per job, shared toolchain key, private artifact keys even for identical bytes.
 const aP=await project(alice),aT=await turn(alice),bP=await project(bob),bT=await turn(bob);
 const leak='export default ({state,input})=>{globalThis.carry=input.note;return {state:{note:input.note},result:"Saved"};}';
 assert.match(await build(alice,aP,aT,leak,noteIn('ALICE_PRIVATE_CANARY'),noteOut('ALICE_PRIVATE_CANARY'),service),/Application review/);
 const probe='export default ({state,input})=>({state:{seen:typeof globalThis.carry==="undefined"?"clean":String(globalThis.carry)},result:"Saved"})';
 assert.match(await build(bob,bP,bT,probe,{state:{},input:{}},{state:{seen:'clean'},result:'Saved'},service),/Application review/,'The second tenant sees no state from the first job');
 const [aJob,bJob]=[await job(aT),await job(bT)];
 assert.equal(aJob.state,'published');assert.equal(bJob.state,'published');assert.equal(aJob.cleanup,'released');
 assert.equal(aJob.toolchain_key,bJob.toolchain_key,'Prepared runtime image is shared');assert.equal(aJob.toolchain_key,await J.sharedToolchainKey());
 assert.ok(![alice,bob,aP,bP,aT,bT].some(x=>aJob.toolchain_key.includes(x)),'Shared key carries no tenant identity');
 assert.equal(aJob.artifact_key,`private/${aP}/${aT}/${sha(leak)}`);
 const same=[[alice,await project(alice)],[bob,await project(bob)]],sameKeys=[];
 for(const [owner,p] of same){const t=await turn(owner);await build(owner,p,t,note,noteIn('x'),noteOut('x'),service);sameKeys.push((await job(t)).artifact_key);}
 assert.notEqual(sameKeys[0],sameKeys[1],'Identical private bytes never share an artifact key');assert.equal(sameKeys[0].slice(-64),sameKeys[1].slice(-64));
 for(const bad of [{...J.runtimeToolchain,project:aP},{...J.runtimeToolchain,source:note},{engine:'x'}])await assert.rejects(J.sharedToolchainKey(bad),e=>e.status===400);
 assert.equal((await cleanups(aT))[0].reason,'runtime-returned');assert.ok((await cleanups(aT))[0].held_ms>=0);

 // 2. Output ownership: another tenant cannot publish, prepare or claim a job's output.
 await assert.rejects(J.assertBuildOutput(scope(bob),bob,bP,aT),e=>e.status===409);
 await assert.rejects(prepareApplication(scope(bob),bob,bP,id(),'enable',aT,aT),e=>e.status===409);
 assert.throws(()=>sql.prepare('INSERT INTO app_activation_reviews(id,project_id,user_id,version_id,run_id,enabled,base_revision) VALUES(?,?,?,?,?,1,0)').run(id(),bP,bob,aT,aT));
 assert.throws(()=>sql.prepare('UPDATE build_jobs SET artifact_key=? WHERE id=?').run(`private/${bP}/${aT}/${'c'.repeat(64)}`,aT),/build_job_immutable/);

 // 3. Cancellation mid-flight: the sent test is not recalled, but the job cannot finish or publish; cleanup is recorded.
 const cP=await project(alice),cT=await turn(alice);onCall=()=>J.cancelBuildJob(scope(alice),alice,cT);
 assert.match(await build(alice,cP,cT,note,noteIn('c'),noteOut('c'),service),/This build was cancelled/);onCall=null;
 assert.equal((await job(cT)).state,'cancelled');assert.equal((await cleanups(cT))[0].reason,'runtime-returned');
 assert.equal(await db.prepare('SELECT id FROM app_activation_reviews WHERE run_id=?').bind(cT).first(),null);
 await assert.rejects(prepareApplication(scope(alice),alice,cP,id(),'enable',cT,cT),e=>e.status===409,'A cancelled job never publishes later');
 // Cancelled after success but before publication.
 const sP=await project(alice),sT=await turn(alice),cancelling=await owners.get(alice).scope(interceptDatabase(db,/^INSERT INTO app_activation_reviews/,async()=>{await J.cancelBuildJob(scope(alice),alice,sT);}));
 const sPlan=await fixtureExtensionPlan(scope(alice),alice,sP,sT,'custom.visitor-transition');
 assert.match((await rawBackendAction(cancelling,alice,sT,{kind:'backend',operation:'buildApplication',projectId:sP,source:note,input:noteIn('s'),expected:noteOut('s'),planId:sPlan},service)).reply,/could not be confirmed/);
 assert.equal((await job(sT)).state,'cancelled');assert.equal(await db.prepare('SELECT id FROM app_activation_reviews WHERE run_id=?').bind(sT).first(),null);
 // Cancel before dispatch: no spend, and the job's own reservation is refused.
 const pre=await draft(alice),preLease=await pre.admit();assert.match(await backendChatCommand(scope(alice),alice,id(),'/cancel-build '+pre.t)(),/No test was sent/);
 assert.equal(await J.dispatchBuildJob(db,preLease),false);assert.equal(await J.finishBuildJob(db,preLease,'failed',[]),false);
 assert.throws(()=>sql.prepare('INSERT INTO backend_runs(id,user_id,project_id,version_id,request_hash) VALUES(?,?,?,?,?)').run(pre.t,alice,pre.p,pre.t,'d'.repeat(64)),/build_job_inactive/);
 assert.deepEqual((await cleanups(pre.t)).map(c=>c.reason),['not-dispatched']);
 await assert.rejects(J.cancelBuildJob(scope(bob),bob,pre.t),e=>e.status===404,'Only the owner can cancel');

 // 4. Lease isolation: one job's lease cannot dispatch or finish another, and dispatch (the spend) happens once.
 const carol=await account(),one=await draft(carol),two=await draft(carol),oneLease=await one.admit(),twoLease=await two.admit();
 assert.equal(await J.dispatchBuildJob(db,{job:one.t,token:twoLease.token}),false);assert.equal(await J.finishBuildJob(db,{job:one.t,token:twoLease.token},'failed',[]),false);
 assert.equal(await J.dispatchBuildJob(db,oneLease),true);assert.equal(await J.dispatchBuildJob(db,oneLease),false);
 assert.throws(()=>sql.prepare('INSERT INTO backend_runs(id,user_id,project_id,version_id,request_hash) VALUES(?,?,?,?,?)').run(two.t,carol,two.p,two.t,'d'.repeat(64)),/build_job_inactive/,'Undispatched job cannot spend');
 assert.throws(()=>sql.prepare("UPDATE build_jobs SET state='succeeded',finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?").run(one.t),/build_job_success/,'Success requires the job’s own passing receipt');

 // 5. Expiry: unfinished jobs past their deadline become expired, cannot dispatch, finish or spend; cleanup recorded.
 age(two.t,{expires_at:'-1 seconds'});assert.equal(await J.dispatchBuildJob(db,twoLease),false);
 await J.reconcileBuildJobs(db);assert.equal((await job(two.t)).state,'expired');assert.equal(await J.finishBuildJob(db,twoLease,'failed',[]),false);
 assert.deepEqual((await cleanups(two.t)).map(c=>[c.outcome,c.reason]),[['released','not-dispatched']]);
 // A dispatched job that expires keeps its slot until the runtime's per-call bound has elapsed.
 age(one.t,{expires_at:'-1 seconds'});await J.reconcileBuildJobs(db);assert.equal((await job(one.t)).state,'expired');assert.equal((await job(one.t)).cleanup,'pending');
 age(one.t,{dispatched_at:'-31 seconds'});await J.reconcileBuildJobs(db);assert.deepEqual((await cleanups(one.t)).map(c=>c.reason),['runtime-bound-elapsed']);
 assert.throws(()=>sql.prepare('INSERT INTO build_jobs(id,project_id,user_id,purpose,origin,lease_digest,input_digest,toolchain_key,artifact_key,expires_at) SELECT id,project_id,user_id,purpose,origin,lease_digest,input_digest,toolchain_key,artifact_key,expires_at FROM build_jobs WHERE id=?').run(one.t));

 // 6. Cleanup failure is recorded and keeps capacity held; the deterministic reconciler releases it only when knowable.
 const dave=await account(undefined,1),fP=await project(dave),fT=await turn(dave),broken={fetch:async()=>{calls++;return new Response('unavailable',{status:500});}};
 assert.match(await build(dave,fP,fT,note,noteIn('f'),noteOut('f'),broken),/did not pass/);
 assert.deepEqual((await cleanups(fT)).map(c=>[c.outcome,c.reason]),[['failed','runtime-unconfirmed']]);assert.equal((await job(fT)).cleanup,'failed');
 const blocked=await turn(dave);await assert.rejects(build(dave,fP,blocked,note,noteIn('g'),noteOut('g'),service),e=>e.status===429);
 assert.equal(await db.prepare('SELECT id FROM backend_versions WHERE id=?').bind(blocked).first(),null,'Refused capacity saves nothing');
 age(fT,{dispatched_at:'-31 seconds'});await J.reconcileBuildJobs(db);
 assert.deepEqual((await cleanups(fT)).map(c=>[c.attempt,c.outcome,c.reason]),[[1,'failed','runtime-unconfirmed'],[2,'released','runtime-bound-elapsed']]);
 assert.match(await build(dave,fP,await turn(dave),note,noteIn('g'),noteOut('g'),service),/Application review/);
 assert.throws(()=>sql.prepare("UPDATE build_job_cleanups SET outcome='released' WHERE job_id=?").run(fT),/build_job_cleanup_immutable/);

 // 7. Owner session replay and concurrency: replay never re-dispatches; one active job per project.
 const erin=await account(undefined,3),eP=await project(erin),eT=await turn(erin),before=calls;let release;gate=new Promise(r=>{release=r;});
 const first=build(erin,eP,eT,note,noteIn('e'),noteOut('e'),service);
 while(calls===before)await new Promise(r=>setTimeout(r,5));
 const busy=await turn(erin);await assert.rejects(build(erin,eP,busy,note,noteIn('e2'),noteOut('e2'),service),e=>e.status===429);
 const otherP=await project(erin),other=await turn(erin);const parallel=build(erin,otherP,other,note,noteIn('o'),noteOut('o'),service);
 release();gate=null;const reply=await first;await parallel;assert.match(reply,/Application review/);assert.equal(calls,before+2);
 assert.equal(await build(erin,eP,eT,note,noteIn('e'),noteOut('e'),service),reply,'Replay reads the saved build');assert.equal(calls,before+2);
 // Lost admission acknowledgment: the lease is gone, replay cannot dispatch, and expiry frees the slot.
 const lostP=await project(erin),lostT=await turn(erin),lostDB=await owners.get(erin).scope(interceptDatabase(db,/^INSERT INTO application_builds/,async()=>{},async()=>{throw Error('Lost acknowledgment');}));
 const lostPlan=await fixtureExtensionPlan(scope(erin),erin,lostP,lostT,'custom.visitor-transition'),lostAction={kind:'backend',operation:'buildApplication',projectId:lostP,source:note,input:noteIn('l'),expected:noteOut('l'),planId:lostPlan};
 assert.match((await rawBackendAction(lostDB,erin,lostT,lostAction,service)).reply,/no test was reserved/);assert.match((await rawBackendAction(scope(erin),erin,lostT,lostAction,service)).reply,/Build job: running/);
 assert.equal(calls,before+2);age(lostT,{expires_at:'-1 seconds'});await J.reconcileBuildJobs(db);assert.match(await backendChatCommand(scope(erin),erin,id(),'/application-build '+lostT)(),/expired before its test was sent/);

 // 8. Visitor and workflow paths cannot create or wake a job; only an owner's pending Chat build intent can.
 const frank=await account(),stale=await draft(frank);await db.prepare("UPDATE chat_turns SET status='completed' WHERE id=?").bind(stale.t).run();
 await assert.rejects(stale.admit(),/build_job_owner/);
 const foreign=await draft(frank);await assert.rejects(J.admitBuildJob(db,{id:foreign.t,user:alice,project:foreign.p,inputDigest:'b'.repeat(64),sourceDigest:foreign.digest}).then(a=>a.statement.run()),/build_job_owner/);
 // Type-only imports are erased from Worker bundles and are not a runtime path.
 const root=resolve(dirname(new URL(import.meta.url).pathname),'..'),forbidden=['src/ai-chat.ts','src/application-build.ts','src/build-jobs.ts','src/backend-chat.ts','src/ai.ts'];
 async function graph(entry,seen=new Set()){
  if(seen.has(entry))return seen;seen.add(entry);const text=await readFile(resolve(root,entry),'utf8');
  for(const [,spec] of text.matchAll(/(?:import|export)\s(?!type\s)[^'"]*?from\s*['"](\.[^'"]+)['"]/g)){let next=resolve(dirname(resolve(root,entry)),spec).slice(root.length+1);if(!next.startsWith('src/')||/\.(json|wasm|mjs|js)$/.test(next))continue;if(!next.endsWith('.ts'))next+='.ts';try{await readFile(resolve(root,next));}catch{next=next.replace(/\.ts$/,'/index.ts');}if(next.endsWith('.ts'))await graph(next,seen);}
  return seen;
 }
 for(const entry of ['src/site-host.ts','src/app-host.ts','src/runtime/worker.ts']){const reach=await graph(entry);assert.deepEqual(forbidden.filter(f=>reach.has(f)),[],entry+' must not reach owner maintenance or build execution');}
 const index=await readFile(resolve(root,'src/index.ts'),'utf8'),start=index.indexOf('runMaintenance('),scheduled=index.slice(start);assert.ok(start>0&&/reconcileBuildJobs/.test(scheduled.slice(0,4000))&&!/sendAIChat|buildApplication|backendAction/.test(scheduled.slice(0,4000)),'Scheduled maintenance runs only deterministic reconciliation');
 const quiet=calls;await J.reconcileBuildJobs(db);assert.equal(calls,quiet,'Reconciliation dispatches nothing');

 // 9. Bounded shared capacity: per account and platform pool; deadlines cannot exceed the reviewed bound.
 const gina=await account(),held=[];for(let i=0;i<3;i++){const d=await draft(gina);held.push(d);await d.admit();}
 await assert.rejects((await draft(gina)).admit(),/build_job_capacity/,'Fourth concurrent job for one account');
 const longer=await draft(frank);await assert.rejects(db.prepare(`INSERT INTO build_jobs(id,project_id,user_id,purpose,origin,lease_digest,input_digest,toolchain_key,artifact_key,expires_at) VALUES(?,?,?,'project-build','owner-chat',?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now','+121 seconds'))`).bind(longer.t,longer.p,frank,'e'.repeat(64),'b'.repeat(64),await J.sharedToolchainKey(),`private/${longer.p}/${longer.t}/${longer.digest}`).run(),/build_job_invalid/);
 const active=async()=>(await db.prepare("SELECT count(*) n FROM build_jobs WHERE state='running' OR cleanup<>'released'").first()).n,pool=[];
 while(await active()<J.buildJobLimits.pool){const u=await account(),d=await draft(u);await d.admit();pool.push([u,d.t]);}
 const overflow=await account();await assert.rejects((await draft(overflow)).admit(),/build_job_capacity/,'Platform pool ceiling');
 for(const [u,t] of [...pool,...held.map(d=>[gina,d.t])])await J.cancelBuildJob(scope(u),u,t);
 assert.ok(await active()<J.buildJobLimits.pool);

 // 10. Synthetic maintenance task: deterministic diagnostics precede and gate any optional model repair.
 const hana=await account(undefined,2),hP=await project(hana),hT=await turn(hana),runtimeBefore=calls;
 const remote='import helper from "https://example.invalid/x.js";\nexport default ({state,input})=>({state:{note:helper(input.note)},result:"Saved"})';
 const diagnosed=await build(hana,hP,hT,remote,noteIn('h'),noteOut('h'),service);
 assert.match(diagnosed,/Deterministic checks failed before any test/);assert.match(diagnosed,/dependency failed \(remote_dependency\)/);assert.match(diagnosed,/No model repair was run/);
 assert.equal(calls,runtimeBefore,'No runtime spend for a deterministic failure');assert.deepEqual((await cleanups(hT)).map(c=>c.reason),['not-dispatched']);
 const missingP=await project(hana),missing=await turn(hana);assert.match(await build(hana,missingP,missing,'const handler=({state})=>({state,result:"x"})',{state:{},input:{}},{state:{},result:'x'},service),/type failed \(missing_default_export\)/);
 assert.equal(calls,runtimeBefore);
 // Owner inspection is deterministic and calls no model.
 let modelCalls=0;assert.match(await backendChatCommand(scope(hana),hana,id(),'/application-build '+hT)(),/dependency failed/);assert.equal(modelCalls,0);
 // Optional repair only on an explicit owner request, and only after diagnostics are recorded.
 // Fixture build turns finish as an ordinary Chat request would before the owner sends the next one.
 await db.prepare("UPDATE chat_turns SET status='completed' WHERE user_id=? AND status='pending'").bind(hana).run();
 const repair=id(),state=(await readChat(scope(hana),hana)).state,config={baseURL:'https://provider.example/v1',apiKey:'synthetic',model:'fixture'};
 const transport=async()=>{modelCalls++;assert.match((await job(hT)).diagnostics_json,/remote_dependency/,'Diagnostics exist before the model call');const planId=await fixtureExtensionPlan(scope(hana),hana,hP,repair,'custom.visitor-transition');return Response.json({choices:[{message:{content:JSON.stringify({reply:'Repaired',action:{kind:'backend',operation:'buildApplication',projectId:hP,source:note,input:noteIn('h'),expected:noteOut('h'),planId}})},finish_reason:'stop'}],usage:{prompt_tokens:100,completion_tokens:50}});};
 assert.equal((await sendAIChat(scope(hana),hana,repair,state.revision,'Please repair the build '+hT+' using only built-in JavaScript.',config,transport,{backendRuntime:service})).status,200);
 assert.equal(modelCalls,1);assert.equal(calls,runtimeBefore+1);assert.equal((await job(repair)).state,'published');
 const repaired=(await readChat(scope(hana),hana)).turns.find(t=>t.id===repair);assert.equal(repaired?.application_confirmation_id,repair);
 await sendChat(scope(hana),hana,{id:id(),revision:(await readChat(scope(hana),hana)).state.revision,content:'/application-build '+hT});assert.equal(modelCalls,1,'Status reads never wake the model');

 // 11. WH-050 operator `build` freeze: refuses new jobs and cancels running/unpublished ones in the frozen scope only.
 const ivy=await account(undefined,1),jack=await account(undefined,1),hours=n=>new Date(Date.now()+n*3600000).toISOString(),freeze=(subject,extra={})=>({action:'contain',id:newActionId(),subject,scopes:{build:'freeze'},expiresAt:hours(2),operator:'human:fixture',reason:'Synthetic build containment',...extra});
 async function contain(request){const preview=await runContainment(db,request);assert.equal(preview.preview,true);return runContainment(db,request,preview.applyDigest);}
 for(const bad of [{build:1},{build:0},{build:'stop'}])assert.throws(()=>containmentInput(JSON.stringify(freeze({kind:'project',id:id()},{scopes:bad}))),/Invalid operator containment request/,'Build is freeze-only; limits stay as built');
 const running=await draft(ivy,await project(ivy)),runningLease=await running.admit(),sibling=await draft(ivy),siblingLease=await sibling.admit(),neighbour=await draft(jack),neighbourLease=await neighbour.admit();
 const projectFreeze=freeze({kind:'project',id:running.p});await contain(projectFreeze);
 assert.equal((await job(running.t)).state,'cancelled','A project freeze cancels its running job in the same write');assert.ok((await job(running.t)).finished_at);
 assert.equal(await J.dispatchBuildJob(db,runningLease),false);assert.equal(await J.finishBuildJob(db,runningLease,'failed',[]),false);
 assert.equal((await job(sibling.t)).state,'running','Another project of the same account is untouched');assert.equal((await job(neighbour.t)).state,'running','Another tenant is untouched');
 await J.reconcileBuildJobs(db);assert.deepEqual((await cleanups(running.t)).map(c=>c.reason),['not-dispatched'],'Cleanup is recorded by the deterministic reconciler');
 await assert.rejects((await draft(ivy,running.p)).admit(),/build_job_capacity/,'New jobs in the frozen project are refused with the generic capacity error');
 const refusedTurn=await turn(ivy);await assert.rejects(build(ivy,running.p,refusedTurn,note,noteIn('z'),noteOut('z'),service),e=>e.status===429&&!/contain|operator|freeze/i.test(e.message),'The owner sees only the generic capacity response');
 assert.equal(await db.prepare('SELECT id FROM backend_versions WHERE id=?').bind(refusedTurn).first(),null,'A refused build saves nothing');
 assert.throws(()=>sql.prepare("INSERT INTO operator_containments(id,scope,subject_kind,subject_id,allowance,operator_ref,reason,request_digest,expires_at) VALUES(?,'build','project',?,3,'human:x','r',?,strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 hour'))").run(newActionId(),running.p,'f'.repeat(64)),/CHECK/,'No build allowance can be stored');
 // A job that already succeeded but is not yet published is cancelled too, so it can never prepare an approval review.
 const kP=await project(jack),kT=await turn(jack),kPlan=await fixtureExtensionPlan(scope(jack),jack,kP,kT,'custom.visitor-transition');
 await J.cancelBuildJob(scope(jack),jack,neighbour.t);
 const freezing=await owners.get(jack).scope(interceptDatabase(db,/^INSERT INTO app_activation_reviews/,async()=>{await contain(freeze({kind:'project',id:kP}));}));
 assert.match((await rawBackendAction(freezing,jack,kT,{kind:'backend',operation:'buildApplication',projectId:kP,source:note,input:noteIn('k'),expected:noteOut('k'),planId:kPlan},service)).reply,/could not be confirmed/);
 assert.equal((await job(kT)).state,'cancelled');assert.equal(await db.prepare('SELECT id FROM app_activation_reviews WHERE run_id=?').bind(kT).first(),null);
 await assert.rejects(prepareApplication(scope(jack),jack,kP,id(),'enable',kT,kT),e=>e.status===409,'A frozen job never publishes later');
 // An account freeze covers every project the account owns; status reports active build usage without content.
 await contain(freeze({kind:'account',id:ivy}));assert.equal((await job(sibling.t)).state,'cancelled');assert.equal(await J.dispatchBuildJob(db,siblingLease),false);
 await assert.rejects((await draft(ivy)).admit(),/build_job_capacity/,'Any project of a frozen account is refused');
 const status=await runContainment(db,{action:'status',subject:{kind:'account',id:ivy}});assert.ok(status.usage.projects.every(p=>p.build.contained&&p.build.allowance===0));
 // Lifting restores admission; cancelled jobs stay cancelled. Published jobs are never changed by a freeze.
 for(const c of status.containments.filter(c=>c.state==='active'))await contain({action:'lift',id:c.id,operator:'human:fixture',reason:'Synthetic lift'});
 assert.equal((await job(running.t)).state,'cancelled');await J.reconcileBuildJobs(db);
 assert.match(await build(ivy,running.p,await turn(ivy),note,noteIn('after'),noteOut('after'),service),/Application review/,'Admission resumes after the lift');
 const published=(await db.prepare("SELECT count(*) n FROM build_jobs WHERE state='published'").first()).n;await contain(freeze({kind:'account',id:alice}));
 assert.equal((await db.prepare("SELECT count(*) n FROM build_jobs WHERE state='published'").first()).n,published,'A freeze never alters a published job');
 assert.equal(neighbourLease.job,neighbour.t);

 console.log('Build jobs passed: two-tenant fresh runtime memory, shared toolchain vs private artifact keys, output ownership, cancellation before/during/after execution, lease isolation, single spend, expiry, recorded cleanup failure holding capacity, per-project/account/pool bounds, owner replay/concurrency/lost lease, no visitor/workflow/scheduled wake path, deterministic diagnostics before an optional model repair, and the operator build freeze (refuses new jobs, cancels running and unpublished jobs in scope, generic response, lift restores admission).');
}finally{await runtime?.dispose();await store.close();await rm(dir,{recursive:true,force:true});}
