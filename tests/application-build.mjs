Error.stackTraceLimit=0;
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import wrangler from 'wrangler';
const dir=await mkdtemp('/tmp/whumpo-application-build-');let proxy,runtime;
try{
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--config','wrangler.runtime.jsonc','--dry-run','--outdir',dir+'/runtime'],{stdio:'pipe',maxBuffer:16*1024*1024});
 const require=createRequire(import.meta.resolve('wrangler')),{Miniflare,convertV4MiniflareOptions}=require('miniflare');
 runtime=new Miniflare(convertV4MiniflareOptions({modulesRoot:dir+'/runtime',modules:[{type:'ESModule',path:dir+'/runtime/worker.js'},...(await readdir(dir+'/runtime')).filter(p=>p.endsWith('.wasm')).map(p=>({type:'CompiledWasm',path:dir+'/runtime/'+p}))],compatibilityDate:'2026-09-29'}));
 proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB;
 const bundle=await build({stdin:{contents:"export * from './src/backend-chat';export * from './src/app-chat-actions';export * from './src/app-activation';export {prepareSiteAction} from './src/site-agent';export {sendAIChat} from './src/ai-chat';export {readChat,sendChat} from './src/chat';export {getBilling} from './src/billing';export * from './src/onboarding';export {updateProfile} from './src/profile';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
 const {backendAction,backendChatCommand,applicationChatActions,confirmApplication,prepareApplication,sendAIChat,readChat,sendChat,getBilling,readOnboarding,saveOnboarding,completeOnboarding,updateProfile}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
 const id=()=>crypto.randomUUID(),user=id(),foreign=id(),now=new Date().toISOString();let revision=0,calls=0;
 for(const u of [user,foreign])await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(u,u+'@example.test',now).run();
 const service={fetch:async(url,init)=>{calls++;assert.deepEqual(Object.keys(JSON.parse(init.body)),['version','source','input']);assert.equal(new Headers(init.headers).has('cookie'),false);return runtime.dispatchFetch(url,init);}};
 async function project(){const p=id();await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Notebook','','draft',?,?)").bind(p,user,now,now).run();return p;}
 async function turn(){const t=id();await db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,?,'Build a notebook','','2026-09-30T00:00:00.000Z','ai','pending')").bind(t,user,++revision).run();return t;}
 const action=p=>({kind:'backend',operation:'buildApplication',projectId:p,source:'export default ({state,input})=>({state:{note:input.note},result:"Saved"})',input:{state:{},input:{note:'Synthetic note'}},expected:{state:{note:'Synthetic note'},result:'Saved'}});
 const p=await project(),t=await turn(),a=action(p),built=await backendAction(db,user,t,a,service);assert.match(built.reply,/Application review/);assert.match(built.reply,/Only you can apply/);assert.equal(calls,1);assert.deepEqual(built.statements,[]);
 assert.equal((await db.prepare('SELECT enabled FROM app_spaces WHERE project_id=?').bind(p).first()).enabled,0);
 assert.equal((await db.prepare('SELECT count(*) n FROM app_page_reviews').first()).n,0);
 const original={id:t,status:'completed',user_text:'Build a notebook',assistant_text:built.reply};await applicationChatActions(db,user,[original]);assert.equal(original.application_confirmation_id,t);
 const readTurn={id:id(),status:'completed',user_text:'/application-build '+t,assistant_text:await backendChatCommand(db,user,id(),'/application-build '+t)()};await applicationChatActions(db,user,[readTurn]);assert.equal(readTurn.application_confirmation_id,t);
 assert.equal((await backendAction(db,user,t,a,service)).reply,built.reply);assert.equal(calls,1);
 await assert.rejects(backendAction(db,user,t,{...a,expected:{state:{note:'Different'},result:'Saved'}},service),e=>e.status===409);assert.equal(calls,1);
 await assert.rejects(backendAction(db,foreign,id(),a,service),e=>e.status===404);
 await assert.rejects(backendChatCommand(db,foreign,id(),'/application-build '+t)(),e=>e.status===404);
 for(const bad of [{...a,expected:{state:{},result:'Saved',extra:true}},{...a,input:{state:{},input:'x'.repeat(4097)}},{...a,source:'x'.repeat(8193)},{...a,confirm:true}])await assert.rejects(backendAction(db,user,await turn(),bad,service),e=>e.status===400);
 await assert.rejects(backendAction(db,user,await turn(),a),e=>e.status===503);
 const missing=id();await assert.rejects(backendAction(db,user,missing,a,service),e=>e.status===409);assert.equal(await db.prepare('SELECT id FROM backend_versions WHERE id=?').bind(missing).first(),null,'Missing pending turn rolls back draft');
 // Actual QuickJS mismatch cannot authorize the application.
 const mismatch=await turn(),bad=await backendAction(db,user,mismatch,{...a,projectId:await project(),expected:{state:{note:'wrong'},result:'Saved'}},service);assert.match(bad.reply,/did not pass/);assert.equal(calls,2);assert.equal(await db.prepare('SELECT id FROM app_activation_reviews WHERE id=?').bind(mismatch).first(),null);
 const badProject=(await db.prepare('SELECT project_id FROM backend_versions WHERE id=?').bind(mismatch).first()).project_id;await assert.rejects(prepareApplication(db,user,badProject,id(),'enable',mismatch,mismatch),e=>e.status===409);
 // Lost atomic draft acknowledgment saves evidence but does not dispatch.
 const lost=await turn(),lostA=action(await project()),lostDB=new Proxy(db,{get(target,key){if(key==='batch')return async statements=>{await target.batch(statements);throw Error('Lost acknowledgment');};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 assert.match((await backendAction(lostDB,user,lost,lostA,service)).reply,/no test was reserved/);assert.equal(calls,2);assert.match((await backendAction(db,user,lost,lostA,service)).reply,/no test was reserved/);assert.equal(calls,2);
 // Lost test reservation acknowledgment must never dispatch on replay.
 const reserved=await turn(),reservedA=action(await project()),reservationDB=new Proxy(db,{get(target,key){if(key==='prepare')return sql=>{const statement=target.prepare(sql);if(!sql.startsWith('INSERT INTO backend_runs'))return statement;return {bind(...args){const bound=statement.bind(...args);return {async run(){await bound.run();throw Error('Lost reservation acknowledgment');}};}};};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 assert.match((await backendAction(reservationDB,user,reserved,reservedA,service)).reply,/outcome is unknown/);assert.equal(calls,2);assert.match((await backendAction(db,user,reserved,reservedA,service)).reply,/outcome is unknown/);assert.equal(calls,2);
 // Concurrent duplicate actions still have one runtime dispatch and one draft.
 const concurrent=await turn(),concurrentA=action(await project());await Promise.all([backendAction(db,user,concurrent,concurrentA,service),backendAction(db,user,concurrent,concurrentA,service)]);assert.equal(calls,3);
 assert.match(await backendChatCommand(db,user,id(),'/application-build '+concurrent)(),/Application review/);
 // Explicit owner approval remains necessary and historical reads cannot reapply it.
 await confirmApplication(db,user,t);assert.match((await backendAction(db,user,t,a,service)).reply,/Status: applied/);assert.equal(calls,3);
 await db.prepare('INSERT INTO app_visitors(id,project_id) VALUES(?,?)').bind(id(),p).run();const enrolled=await turn();await assert.rejects(backendAction(db,user,enrolled,a,service),e=>e.status===409);assert.equal(await db.prepare('SELECT id FROM backend_versions WHERE id=?').bind(enrolled).first(),null);assert.equal(calls,3);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM inference_calls').first()).n,0);
 // Complete Chat integration with a deterministic OpenAI-compatible response.
 {
  const chatUser=id(),chatProject=id(),chatTurn=id();await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(chatUser,chatUser+'@example.test',now).run();
  await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Notebook','Private notes','draft',?,?)").bind(chatProject,chatUser,now,now).run();
  const state=(await readChat(db,chatUser)).state,config={baseURL:'https://provider.example/v1',apiKey:'synthetic',model:'fixture'},before=calls;let modelCalls=0;
  const transport=async()=>{modelCalls++;return Response.json({choices:[{message:{content:JSON.stringify({reply:'Untrusted model assurance',action:action(chatProject)})},finish_reason:'stop'}],usage:{prompt_tokens:1000,completion_tokens:200}});};
  const content='Build a private notebook app and test a synthetic note, then prepare my approval.';
  assert.equal((await sendAIChat(db,chatUser,chatTurn,state.revision,content,config,transport,{backendRuntime:service})).status,200);
  const history=await readChat(db,chatUser);assert.equal(history.turns.at(-1).application_confirmation_id,chatTurn);assert.doesNotMatch(history.turns.at(-1).assistant_text,/Untrusted model assurance/);assert.equal(modelCalls,1);assert.equal(calls-before,1);assert.equal((await getBilling(db,chatUser)).quota.reserved,0);
  await sendAIChat(db,chatUser,chatTurn,state.revision,content,config,transport,{backendRuntime:service});assert.equal(modelCalls,1);assert.equal(calls-before,1);
  await sendChat(db,chatUser,{id:id(),revision:history.state.revision,content:'/application-build '+chatTurn});assert.equal((await readChat(db,chatUser)).turns.at(-1).application_confirmation_id,chatTurn);assert.equal(calls-before,1);
 }
 if(process.env.RUN_LIVE_MUSE==='1'){
  const liveUser=id(),liveTurn=id();let liveProject=id();await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(liveUser,liveUser+'@example.test',now).run();
  await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Private notebook','A private note per visitor','draft',?,?)").bind(liveProject,liveUser,now,now).run();
  if(process.env.WELCOME_APP==='1'){
   await updateProfile(db,liveUser,{revision:0,name:'River',about_me:'Unshared lavender telescope',share_context:false});
   // Remove the setup fixture before welcome so it cannot bypass onboarding.
   await db.prepare('DELETE FROM projects WHERE id=?').bind(liveProject).run();
   const welcome=await readOnboarding(db,liveUser);liveProject=welcome.state.project_id;
   await saveOnboarding(db,liveUser,{revision:0,stage:'review',project_name:'Private notebook',idea:'A small private notebook app. Each invited visitor keeps a note that only they can read. It should be simple and friendly to use. The visitor writes their note and saves it, and can come back to see it later. This is a minimal first version of the app. Each visitor starts with an empty document. On submitting a note, replace their document with {note: the submitted text} and return the result string "Saved". Use synthetic sample text to test this behavior. Do not publish it yet.',audience:'Invited team members',preferred_theme:'ocean'});
   await completeOnboarding(db,liveUser,{revision:1});
  }
  const state=(await readChat(db,liveUser)).state,config={baseURL:'https://opencode.ai/zen/go/v1',model:'muse-spark-1.3-contributor',apiKey:(await readFile('opencode.key','utf8')).trim(),protocol:'responses'};
  let providerCalls=0;const transport=(url,init)=>{providerCalls++;if(process.env.WELCOME_APP==='1'){assert.ok(!init.body.includes('lavender telescope'));assert.ok(init.body.includes('return the result string'));}return fetch(url,init)},before=calls;
  const content=process.env.WELCOME_APP==='1'?'/first-app '+liveProject:'Build a small private notebook app for my existing Private notebook project. Each visitor starts with an empty document. When they submit a note, replace their document with {note: the submitted text} and return "Saved". Generate the backend and check it with the synthetic note "Hello notebook", then show me the approval review. Keep it disabled and unpublished.';
  const response=await sendAIChat(db,liveUser,liveTurn,state.revision,content,config,transport,{backendRuntime:service});
  const history=await readChat(db,liveUser),last=history.turns.at(-1),billing=await getBilling(db,liveUser);
  console.log(JSON.stringify({live:true,status:response.status,turnStatus:last?.status,providerCalls,runtimeCalls:calls-before,spent:billing.quota.spent,reserved:billing.quota.reserved,hasApproval:!!last?.application_confirmation_id}));
  assert.equal(response.status,200);assert.equal(last?.status,'completed');assert.equal(last?.application_confirmation_id,liveTurn,'Natural app request should finish with exact owner review');assert.equal(providerCalls,1);assert.equal(calls-before,1);assert.ok(billing.quota.spent>0&&billing.quota.spent<=50);assert.equal(billing.quota.reserved,0);
  assert.equal((await db.prepare('SELECT enabled FROM app_spaces WHERE project_id=?').bind(liveProject).first()).enabled,0);
  if(process.env.WELCOME_APP==='1'){assert.equal(history.firstDraft,null);assert.equal((await db.prepare('SELECT turn_id FROM welcome_first_drafts WHERE project_id=?').bind(liveProject).first()).turn_id,liveTurn);}
  await sendAIChat(db,liveUser,liveTurn,state.revision,content,config,transport,{backendRuntime:service});assert.equal(providerCalls,1);assert.equal(calls-before,1);
  const recovered=await sendChat(db,liveUser,{id:id(),revision:history.state.revision,content:'/application-build '+liveTurn});assert.equal(recovered.status,200);assert.equal((await readChat(db,liveUser)).turns.at(-1).application_confirmation_id,liveTurn);assert.equal((await getBilling(db,liveUser)).quota.spent,billing.quota.spent);
 }
 console.log('Application build passed: actual QuickJS, expected-output checks, immutable intent, pending-turn/owner/field gates, approval buttons and recovery, no automatic activation/page, concurrent replay, lost draft/reservation acknowledgments and enrolled-project migration gate.');
}finally{await runtime?.dispose();await proxy?.dispose();await rm(dir,{recursive:true,force:true});}
