import {recordFixtureBenchmark} from '../tools/benchmark-evidence.mjs';
Error.stackTraceLimit=0;
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {currentSiteFixtureHandlers,enableFixtureVisitorAccess} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
const m=await currentSiteFixtureHandlers(),store=await databaseFixture({d1:true}),db=store.db,owners=new Map(),scopes=new Map(),scope=user=>scopes.get(user);
async function accountAuthority(user=crypto.randomUUID()){const authority=await workspaceFixture(db,m,user);owners.set(user,authority);scopes.set(user,await authority.scope());return authority;}
const {readAppPageDesign,appPageDesignPrompt,appPageDesignData}=m.appPageDesign,{saveBackend,testBackend}=m.backend,{prepareApplication,confirmApplication}=m.appActivation,{prepareAppPage,confirmAppPage,readAppPage}=m.appPages,{sendAIChat:sendInternalAIChat,readChat,sendChat,getBilling}=m;
// Exercise the internal constrained-build adapter; public Chat uses natural messages.
const sendAIChat=(db,user,id,revision,content,config,transport,options)=>sendInternalAIChat(db,user,id,revision,content,config,transport,options,true);
const id=()=>crypto.randomUUID(),source='export default ({input})=>({state:{note:input.note},result:"Saved"})';
const form={title:'Private notebook',description:'A private note for each invited member',buttonLabel:'Save note',fields:[{key:'note',label:'Your note',type:'text'}]};
const config={baseURL:'https://opencode.ai/zen/go/v1',apiKey:'synthetic',model:'muse-spark-1.3-contributor',protocol:'responses'};
const response=action=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'Proposed page',action})}]}],usage:{input_tokens:1000,output_tokens:300}});
try{
 async function account(approved=true){const user=id(),project=id(),version=id(),test=id(),review=id(),now=new Date().toISOString();await accountAuthority(user);await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Private notebook','A private note for each invited member','draft',?,?)").bind(project,user,now,now).run();await saveBackend(scope(user),user,project,version,source);await testBackend(scope(user),{fetch:async()=>Response.json({ok:true,value:{state:{note:'PRIVATE_RECEIPT_CANARY'},result:'PRIVATE_RECEIPT_CANARY'}})},user,project,version,test,{state:{},input:{note:'Synthetic'}});await enableFixtureVisitorAccess(scope(user),user,project);await prepareApplication(scope(user),user,project,review,'enable',version,test);if(approved)await confirmApplication(scope(user),user,review);await readChat(scope(user),user);return {user,project,version,test,review};}
 const a=await account(),b=await account(),disabled=await account(false),request=p=>({kind:'backend',operation:'reviewAppPage',projectId:p,form});
 assert.equal(await readAppPageDesign(scope(b.user),b.user,a.project),null);assert.equal(await readAppPageDesign(scope(disabled.user),disabled.user,disabled.project),null);
 const context=await readAppPageDesign(scope(a.user),a.user,a.project);assert.equal(context.source,source);assert.equal(context.programRevision,1);assert.ok(!JSON.stringify(context).includes('PRIVATE_RECEIPT_CANARY'));assert.ok(!appPageDesignPrompt(context).includes(JSON.stringify(source)));assert.ok(appPageDesignData(context).includes(JSON.stringify(source)));
 let calls=0;const state=(await readChat(scope(a.user),a.user)).state,turn=id(),content='/design-app-page '+a.project;
 const transport=async(_url,init)=>{calls++;const messages=JSON.parse(init.body).input;assert.ok(messages.filter(m=>m.role==='user').some(m=>m.content.includes('input.note')));assert.ok(messages.filter(m=>m.role==='system').every(m=>!m.content.includes('input.note')));assert.ok(!init.body.includes('PRIVATE_RECEIPT_CANARY'));return response(request(a.project));};
 assert.equal((await sendAIChat(scope(a.user),a.user,turn,state.revision,content,config,transport)).status,200);assert.equal(calls,1);const history=await readChat(scope(a.user),a.user);assert.equal(history.turns.at(-1).app_page_confirmation_id,turn);assert.equal((await readAppPage(scope(a.user),a.user,a.project)).page,null);
 const spent=(await getBilling(scope(a.user),a.user)).standardAI.creditCharge;await sendAIChat(scope(a.user),a.user,turn,state.revision,content,config,transport);assert.equal(calls,1);assert.equal((await getBilling(scope(a.user),a.user)).standardAI.creditCharge,spent);
 await assert.rejects(prepareAppPage(scope(a.user),a.user,a.project,turn,form,{...context,programRevision:0}),e=>e.status===409);
 // Scope failures cannot create code, publish, or target another project.
 for(const action of [request(b.project),{kind:'backend',operation:'reviewDisableApplication',projectId:a.project},{kind:'backend',operation:'buildApplication',projectId:a.project,source},{kind:'inspect',scope:'usage'}]){
  const t=id(),rev=(await readChat(scope(a.user),a.user)).state.revision;await sendAIChat(scope(a.user),a.user,t,rev,content,config,async()=>response(action));assert.equal((await db.prepare('SELECT status FROM chat_turns WHERE id=?').bind(t).first()).status,'failed');assert.equal(await db.prepare('SELECT id FROM app_page_reviews WHERE id=?').bind(t).first(),null);
 }
 assert.equal((await sendAIChat(scope(b.user),b.user,id(),(await readChat(scope(b.user),b.user)).state.revision,content,config,()=>assert.fail('Foreign target must not dispatch'))).status,409);
 // Program changes while inference runs cannot bind the output to the new program.
 const changing=await account(),changeTurn=id(),changeState=(await readChat(scope(changing.user),changing.user)).state;
 await sendAIChat(scope(changing.user),changing.user,changeTurn,changeState.revision,'/design-app-page '+changing.project,config,async()=>{const off=id();await prepareApplication(scope(changing.user),changing.user,changing.project,off,'disable',null,null);await confirmApplication(scope(changing.user),changing.user,off);return response(request(changing.project));});
 assert.equal(await db.prepare('SELECT id FROM app_page_reviews WHERE id=?').bind(changeTurn).first(),null);
 // A page published during inference changes its revision and rejects this stale review.
 const racing=await account(),raceTurn=id(),raceState=(await readChat(scope(racing.user),racing.user)).state;
 await sendAIChat(scope(racing.user),racing.user,raceTurn,raceState.revision,'/design-app-page '+racing.project,config,async()=>{const page=id();await prepareAppPage(scope(racing.user),racing.user,racing.project,page,form);await confirmAppPage(scope(racing.user),racing.user,page);return response(request(racing.project));});assert.equal(await db.prepare('SELECT id FROM app_page_reviews WHERE id=?').bind(raceTurn).first(),null);assert.equal(await readAppPageDesign(scope(racing.user),racing.user,racing.project),null);
 // History may include owner-only records; this focused request must not copy it to inference.
 const privateHistory=await account(),historyRevision=(await readChat(scope(privateHistory.user),privateHistory.user)).state.revision+1;await db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,?,'Read private state','PRIVATE_HISTORY_CANARY',?,'guided','completed')").bind(id(),privateHistory.user,historyRevision,new Date().toISOString()).run();await db.prepare('UPDATE workspace_state SET revision=? WHERE user_id=?').bind(historyRevision,privateHistory.user).run();
 await sendAIChat(scope(privateHistory.user),privateHistory.user,id(),historyRevision,'/design-app-page '+privateHistory.project,config,async(_url,init)=>{assert.ok(!init.body.includes('PRIVATE_HISTORY_CANARY'));return response(null);});
 const noAI=await account(),noAIRevision=()=>readChat(scope(noAI.user),noAI.user).then(r=>r.state.revision);assert.equal((await sendChat(scope(noAI.user),noAI.user,{id:id(),revision:await noAIRevision(),content:'/design-app-page '+noAI.project})).status,503);assert.equal((await sendChat(scope(noAI.user),noAI.user,{id:id(),revision:await noAIRevision(),content:'/design-app-page invalid'},config)).status,400);
 if(process.env.RUN_LIVE_MUSE==='1'){
  const live=await account(),t=id(),rev=(await readChat(scope(live.user),live.user)).state.revision,liveConfig={...config,apiKey:(await readFile('opencode.key','utf8')).trim()};let liveCalls=0;
  await sendAIChat(scope(live.user),live.user,t,rev,'/design-app-page '+live.project,liveConfig,(url,init)=>{liveCalls++;assert.ok(!init.body.includes('PRIVATE_RECEIPT_CANARY'));return fetch(url,init)});
  const row=await db.prepare('SELECT config_json FROM app_page_reviews WHERE id=?').bind(t).first(),billing=await getBilling(scope(live.user),live.user);console.log(JSON.stringify({live:true,calls:liveCalls,hasReview:!!row,standardAICustomerCharge:billing.standardAI.creditCharge}));assert.ok(row,'Muse must prepare the page review');assert.equal(liveCalls,1);const fields=JSON.parse(row.config_json).fields;assert.deepEqual(fields.map(f=>({key:f.key,type:f.type})),[{key:'note',type:'text'}]);assert.equal((await readChat(scope(live.user),live.user)).turns.at(-1).app_page_confirmation_id,t);assert.equal((await readAppPage(scope(live.user),live.user,live.project)).page,null);assert.equal(billing.standardAI.creditCharge,0);
 }
 await recordFixtureBenchmark(db,'page-design');
 console.log('Page design passed: approved owned source, focused single-call proposal, exact program/page revisions, replay, forbidden/foreign denial, private history/receipt exclusion, no code execution and separate publication approval.');
}finally{await store.close();}
