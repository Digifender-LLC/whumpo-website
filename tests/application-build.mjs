import {fixtureExtensionPlan} from './helpers/composition.mjs';
import {recordFixtureBenchmark} from '../tools/benchmark-evidence.mjs';
Error.stackTraceLimit=0;
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
const m=await currentSiteFixtureHandlers(),store=await databaseFixture({d1:true}),db=store.db,owners=new Map(),scopes=new Map(),scope=user=>scopes.get(user);
async function accountAuthority(user=crypto.randomUUID()){const authority=await workspaceFixture(db,m,user);owners.set(user,authority);scopes.set(user,await authority.scope());return authority;}
const dir=await mkdtemp('/tmp/whumpo-application-build-');let runtime;
try{
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--config','wrangler.runtime.jsonc','--dry-run','--outdir',dir+'/runtime'],{stdio:'pipe',maxBuffer:16*1024*1024});
 const require=createRequire(import.meta.resolve('wrangler')),{Miniflare,convertV4MiniflareOptions}=require('miniflare');
 runtime=new Miniflare(convertV4MiniflareOptions({modulesRoot:dir+'/runtime',modules:[{type:'ESModule',path:dir+'/runtime/worker.js'},...(await readdir(dir+'/runtime')).filter(p=>p.endsWith('.wasm')).map(p=>({type:'CompiledWasm',path:dir+'/runtime/'+p}))],compatibilityDate:'2026-09-29'}));
 const {linkChatReviewReply,applicationChatActions,sendAIChat,readChat,sendChat,getBilling,readOnboarding,saveOnboarding,completeOnboarding,updateProfile}=m,{backendAction:rawBackendAction,backendChatCommand}=m.backendChat,{confirmApplication,prepareApplication}=m.appActivation;

 async function backendAction(database,owner,turn,action,service){
  if(action.operation==='buildApplication'&&typeof action.source==='string'&&Object.keys(action).every(k=>['kind','operation','projectId','source','input','expected'].includes(k))){
   const planId=await fixtureExtensionPlan(database,owner,action.projectId,turn,'custom.visitor-transition');
   action={...action,planId};
  }
  return rawBackendAction(database,owner,turn,action,service);
 }
 const id=()=>crypto.randomUUID(),user=id(),foreign=id(),now=new Date().toISOString();let revision=0,calls=0;
 for(const u of [user,foreign])await accountAuthority(u);
 const service={fetch:async(url,init)=>{calls++;assert.deepEqual(Object.keys(JSON.parse(init.body)),['version','source','input']);assert.equal(new Headers(init.headers).has('cookie'),false);return runtime.dispatchFetch(url,init);}};
 async function project(){const p=id();await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Notebook','','draft',?,?)").bind(p,user,now,now).run();return p;}
 async function turn(){const t=id();await db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,?,'Build a notebook','','2026-09-30T00:00:00.000Z','ai','pending')").bind(t,user,++revision).run();return t;}
 const action=p=>({kind:'backend',operation:'buildApplication',projectId:p,source:'export default ({state,input})=>({state:{note:input.note},result:"Saved"})',input:{state:{},input:{note:'Synthetic note'}},expected:{state:{note:'Synthetic note'},result:'Saved'}});
 const p=await project(),t=await turn(),a=action(p),built=await backendAction(scope(user),user,t,a,service);assert.match(built.reply,/Application review/);assert.match(built.reply,/Only you can apply/);assert.equal(calls,1);assert.deepEqual(built.statements,[]);
 assert.equal((await db.prepare('SELECT enabled FROM app_spaces WHERE project_id=?').bind(p).first()).enabled,0);
 assert.equal((await db.prepare('SELECT count(*) n FROM app_page_reviews').first()).n,0);
 assert.ok(await db.prepare('SELECT turn_id FROM chat_review_receipts WHERE turn_id=?').bind(t).first(),'Validated backend action already saved its receipt');
 await db.prepare('DELETE FROM chat_review_receipts WHERE turn_id=?').bind(t).run();
 const original={id:t,status:'completed',user_text:'Build a notebook',assistant_text:built.reply};await applicationChatActions(scope(user),user,[original]);assert.equal(original.application_confirmation_id,undefined,'Review ID alone is not presentation authority');
 await db.prepare("UPDATE chat_turns SET status='completed',assistant_text=? WHERE id=?").bind(built.reply,t).run();await linkChatReviewReply(scope(user),user,t,built.reply);await applicationChatActions(scope(user),user,[original]);assert.equal(original.application_confirmation_id,t);
 const readTurn={id:await turn(),status:'completed',user_text:'/application-build '+t,assistant_text:await backendChatCommand(scope(user),user,id(),'/application-build '+t)()};await applicationChatActions(scope(user),user,[readTurn]);assert.equal(readTurn.application_confirmation_id,undefined,'A command string cannot replace the saved receipt');
 await db.prepare("UPDATE chat_turns SET status='completed',assistant_text=? WHERE id=?").bind(readTurn.assistant_text,readTurn.id).run();await linkChatReviewReply(scope(user),user,readTurn.id,readTurn.assistant_text);await applicationChatActions(scope(user),user,[readTurn]);assert.equal(readTurn.application_confirmation_id,t);
 assert.equal((await backendAction(scope(user),user,t,a,service)).reply,built.reply);assert.equal(calls,1);
 await assert.rejects(backendAction(scope(user),user,t,{...a,expected:{state:{note:'Different'},result:'Saved'}},service),e=>e.status===409);assert.equal(calls,1);
 await assert.rejects(backendAction(scope(foreign),foreign,id(),a,service),e=>e.status===404);
 await assert.rejects(backendChatCommand(scope(foreign),foreign,id(),'/application-build '+t)(),e=>e.status===404);
 for(const bad of [{...a,expected:{state:{},result:'Saved',extra:true}},{...a,input:{state:{},input:'x'.repeat(4097)}},{...a,source:'x'.repeat(8193)},{...a,confirm:true}])await assert.rejects(backendAction(scope(user),user,await turn(),bad,service),e=>e.status===400);
 await assert.rejects(backendAction(scope(user),user,await turn(),a),e=>e.status===503);
 const missing=id();await assert.rejects(backendAction(scope(user),user,missing,a,service),e=>e.status===409);assert.equal(await db.prepare('SELECT id FROM backend_versions WHERE id=?').bind(missing).first(),null,'Missing pending turn rolls back draft');
 // Actual QuickJS mismatch cannot authorize the application.
 const mismatch=await turn(),bad=await backendAction(scope(user),user,mismatch,{...a,projectId:await project(),expected:{state:{note:'wrong'},result:'Saved'}},service);assert.match(bad.reply,/did not pass/);assert.equal(calls,2);assert.equal(await db.prepare('SELECT id FROM app_activation_reviews WHERE id=?').bind(mismatch).first(),null);
 const badProject=(await db.prepare('SELECT project_id FROM backend_versions WHERE id=?').bind(mismatch).first()).project_id;await assert.rejects(prepareApplication(scope(user),user,badProject,id(),'enable',mismatch,mismatch),e=>e.status===409);
 // Lost atomic draft acknowledgment saves evidence but does not dispatch.
 const lost=await turn(),lostA=action(await project()),lostDB=await owners.get(user).scope(interceptDatabase(db,/^INSERT INTO application_builds/,async()=>{},async()=>{throw Error('Lost draft acknowledgment');}));
 assert.match((await backendAction(lostDB,user,lost,lostA,service)).reply,/no test was reserved/);assert.equal(calls,2);assert.match((await backendAction(scope(user),user,lost,lostA,service)).reply,/no test was reserved/);assert.equal(calls,2);
 // Lost test reservation acknowledgment must never dispatch on replay.
 const reserved=await turn(),reservedA=action(await project()),reservationDB=await owners.get(user).scope(interceptDatabase(db,/^INSERT INTO backend_runs/,async()=>{},async()=>{throw Error('Lost reservation acknowledgment');}));
 assert.match((await backendAction(reservationDB,user,reserved,reservedA,service)).reply,/outcome is unknown/);assert.equal(calls,2);assert.match((await backendAction(scope(user),user,reserved,reservedA,service)).reply,/outcome is unknown/);assert.equal(calls,2);
 // Concurrent duplicate actions still have one runtime dispatch and one draft.
 const concurrent=await turn(),concurrentA=action(await project());await Promise.all([backendAction(scope(user),user,concurrent,concurrentA,service),backendAction(scope(user),user,concurrent,concurrentA,service)]);assert.equal(calls,3);
 assert.match(await backendChatCommand(scope(user),user,id(),'/application-build '+concurrent)(),/Application review/);
 // Explicit owner approval remains necessary and historical reads cannot reapply it.
 await confirmApplication(scope(user),user,t);assert.match((await backendAction(scope(user),user,t,a,service)).reply,/Status: applied/);assert.equal(calls,3);
 await db.prepare('INSERT INTO app_visitors(id,project_id) VALUES(?,?)').bind(id(),p).run();const enrolled=await turn();await assert.rejects(backendAction(scope(user),user,enrolled,a,service),e=>e.status===409);assert.equal(await db.prepare('SELECT id FROM backend_versions WHERE id=?').bind(enrolled).first(),null);assert.equal(calls,3);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM inference_calls').first()).n,0);
 // Complete Chat integration with a deterministic OpenAI-compatible response.
 {
  const chatUser=id(),chatProject=id(),chatTurn=id();await accountAuthority(chatUser);
  await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Notebook','Private notes','draft',?,?)").bind(chatProject,chatUser,now,now).run();
  const state=(await readChat(scope(chatUser),chatUser)).state,config={baseURL:'https://provider.example/v1',apiKey:'synthetic',model:'fixture'},before=calls;let modelCalls=0;
  const transport=async()=>{modelCalls++;const planId=await fixtureExtensionPlan(scope(chatUser),chatUser,chatProject,chatTurn,'custom.visitor-transition');return Response.json({choices:[{message:{content:JSON.stringify({reply:'Untrusted model assurance',action:{...action(chatProject),planId}})},finish_reason:'stop'}],usage:{prompt_tokens:1000,completion_tokens:200}});};
  const content='Build a private notebook app and test a synthetic note, then prepare my approval.';
  assert.equal((await sendAIChat(scope(chatUser),chatUser,chatTurn,state.revision,content,config,transport,{backendRuntime:service})).status,200);
  const history=await readChat(scope(chatUser),chatUser);assert.equal(history.turns.at(-1).application_confirmation_id,chatTurn);assert.doesNotMatch(history.turns.at(-1).assistant_text,/Untrusted model assurance/);assert.equal(modelCalls,1);assert.equal(calls-before,1);assert.equal((await getBilling(scope(chatUser),chatUser)).standardAI.creditCharge,0);
  await sendAIChat(scope(chatUser),chatUser,chatTurn,state.revision,content,config,transport,{backendRuntime:service});assert.equal(modelCalls,1);assert.equal(calls-before,1);
  await sendChat(scope(chatUser),chatUser,{id:id(),revision:history.state.revision,content:'/application-build '+chatTurn});assert.equal((await readChat(scope(chatUser),chatUser)).turns.at(-1).application_confirmation_id,chatTurn);assert.equal(calls-before,1);
 }
 if(process.env.RUN_LIVE_MUSE==='1'){
  const liveUser=id(),liveTurn=id();let liveProject=id();await accountAuthority(liveUser);
  await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Private notebook','A private note per visitor','draft',?,?)").bind(liveProject,liveUser,now,now).run();
  if(process.env.WELCOME_APP==='1'){
   await updateProfile(scope(liveUser),liveUser,{revision:0,name:'River',about_me:'Unshared lavender telescope',share_context:false});
   // Remove the setup fixture before welcome so it cannot bypass onboarding.
   await db.prepare('DELETE FROM projects WHERE id=?').bind(liveProject).run();
   const welcome=await readOnboarding(scope(liveUser),liveUser);liveProject=welcome.state.project_id;
   await saveOnboarding(scope(liveUser),liveUser,{revision:0,stage:'review',prompt:'review',project_name:'Private notebook',idea:'A small private notebook app. Each invited visitor keeps a note that only they can read. It should be simple and friendly to use. The visitor writes their note and saves it, and can come back to see it later. This is a minimal first version of the app. Each visitor starts with an empty document. On submitting a note, replace their document with {note: the submitted text} and return the result string "Saved". Use synthetic sample text to test this behavior. Do not publish it yet.',audience:'Invited team members',preferred_theme:'ocean'});
   await completeOnboarding(scope(liveUser),liveUser,{revision:1});
  }
  const state=(await readChat(scope(liveUser),liveUser)).state,config={baseURL:'https://opencode.ai/zen/go/v1',model:'muse-spark-1.3-contributor',apiKey:(await readFile('opencode.key','utf8')).trim(),protocol:'responses'};
  let providerCalls=0;const transport=(url,init)=>{providerCalls++;if(process.env.WELCOME_APP==='1'){assert.ok(!init.body.includes('lavender telescope'));assert.ok(init.body.includes('return the result string'));}return fetch(url,init)},before=calls;
  const content=process.env.WELCOME_APP==='1'?'/first-app '+liveProject:'Build a small private notebook app for my existing Private notebook project. Each visitor starts with an empty document. When they submit a note, replace their document with {note: the submitted text} and return "Saved". Generate the backend and check it with the synthetic note "Hello notebook", then show me the approval review. Keep it disabled and unpublished.';
  const response=await sendAIChat(scope(liveUser),liveUser,liveTurn,state.revision,content,config,transport,{backendRuntime:service},process.env.WELCOME_APP==='1');
  const history=await readChat(scope(liveUser),liveUser),last=history.turns.at(-1),billing=await getBilling(scope(liveUser),liveUser);
  console.log(JSON.stringify({live:true,status:response.status,turnStatus:last?.status,providerCalls,runtimeCalls:calls-before,standardAICustomerCharge:billing.standardAI.creditCharge,hasApproval:!!last?.application_confirmation_id}));
  assert.equal(response.status,200);assert.equal(last?.status,'completed');assert.equal(last?.application_confirmation_id,liveTurn,'Natural app request should finish with exact owner review');assert.equal(providerCalls,2);assert.equal(calls-before,1);assert.equal(billing.standardAI.creditCharge,0);
  assert.equal((await db.prepare('SELECT enabled FROM app_spaces WHERE project_id=?').bind(liveProject).first()).enabled,0);
  if(process.env.WELCOME_APP==='1'){assert.equal(history.firstDraft,null);assert.equal((await db.prepare('SELECT turn_id FROM welcome_first_drafts WHERE project_id=?').bind(liveProject).first()).turn_id,liveTurn);}
  await sendAIChat(scope(liveUser),liveUser,liveTurn,state.revision,content,config,transport,{backendRuntime:service});assert.equal(providerCalls,2);assert.equal(calls-before,1);
  const recovered=await sendChat(scope(liveUser),liveUser,{id:id(),revision:history.state.revision,content:'/application-build '+liveTurn});assert.equal(recovered.status,200);assert.equal((await readChat(scope(liveUser),liveUser)).turns.at(-1).application_confirmation_id,liveTurn);assert.equal((await getBilling(scope(liveUser),liveUser)).standardAI.creditCharge,billing.standardAI.creditCharge);
 }
 // A supported starter uses pinned platform source and the existing build/review lifecycle.
 const libraryProject=await project(),libraryTurn=await turn(),beforeLibrary=calls;
 const libraryAction={kind:'backend',operation:'buildApplication',projectId:libraryProject,reference:'private-task-list@1'};
 const library=await rawBackendAction(scope(user),user,libraryTurn,libraryAction,service);assert.match(library.reply,/Application review/);assert.equal(calls,beforeLibrary+1);
 assert.equal((await db.prepare('SELECT component_id FROM backend_component_instances WHERE version_id=?').bind(libraryTurn).first()).component_id,'private-task-list');
 assert.equal(await db.prepare('SELECT plan_id FROM backend_extension_uses WHERE version_id=?').bind(libraryTurn).first(),null);
 assert.equal((await db.prepare('SELECT enabled FROM app_spaces WHERE project_id=?').bind(libraryProject).first()).enabled,0);
 await rawBackendAction(scope(user),user,libraryTurn,libraryAction,service);assert.equal(calls,beforeLibrary+1);
 await assert.rejects(rawBackendAction(scope(user),user,await turn(),{...libraryAction,source:'export default x=>x'},service),e=>e.status===400);
 await assert.rejects(rawBackendAction(scope(user),user,await turn(),{...libraryAction,reference:'line-total@1'},service),e=>e.status===400);
 await recordFixtureBenchmark(db,'application-build',{runtimeCalls:calls});
 console.log('Application build passed: actual QuickJS, expected-output checks, immutable intent, pending-turn/owner/field gates, approval buttons and recovery, no automatic activation/page, concurrent replay, lost draft/reservation acknowledgments and enrolled-project migration gate.');
}finally{await runtime?.dispose();await store.close();await rm(dir,{recursive:true,force:true});}
