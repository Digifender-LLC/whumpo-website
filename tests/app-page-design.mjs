import {recordFixtureBenchmark} from '../tools/benchmark-evidence.mjs';
Error.stackTraceLimit=0;
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
const bundle=await build({stdin:{contents:"export * from './src/app-page-design';export * from './src/backend-versions';export * from './src/app-activation';export * from './src/app-pages';export * from './src/ai-chat';export * from './src/chat';export * from './src/billing';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {readAppPageDesign,appPageDesignPrompt,appPageDesignData,saveBackend,testBackend,prepareApplication,confirmApplication,prepareAppPage,confirmAppPage,readAppPage,sendAIChat,readChat,sendChat,getBilling}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const dir=await mkdtemp('/tmp/whumpo-page-design-');let proxy;
const id=()=>crypto.randomUUID(),source='export default ({input})=>({state:{note:input.note},result:"Saved"})';
const form={title:'Private notebook',description:'A private note for each invited member',buttonLabel:'Save note',fields:[{key:'note',label:'Your note',type:'text'}]};
const config={baseURL:'https://opencode.ai/zen/go/v1',apiKey:'synthetic',model:'muse-spark-1.3-contributor',protocol:'responses'};
const response=action=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'Proposed page',action})}]}],usage:{input_tokens:1000,output_tokens:300}});
try{
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB;
 async function account(approved=true){const user=id(),project=id(),version=id(),test=id(),review=id(),now=new Date().toISOString();await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(user,user+'@example.test',now).run();await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Private notebook','A private note for each invited member','draft',?,?)").bind(project,user,now,now).run();await saveBackend(db,user,project,version,source);await testBackend(db,{fetch:async()=>Response.json({ok:true,value:{state:{note:'PRIVATE_RECEIPT_CANARY'},result:'PRIVATE_RECEIPT_CANARY'}})},user,project,version,test,{state:{},input:{note:'Synthetic'}});await prepareApplication(db,user,project,review,'enable',version,test);if(approved)await confirmApplication(db,user,review);await readChat(db,user);return {user,project,version,test,review};}
 const a=await account(),b=await account(),disabled=await account(false),request=p=>({kind:'backend',operation:'reviewAppPage',projectId:p,form});
 assert.equal(await readAppPageDesign(db,b.user,a.project),null);assert.equal(await readAppPageDesign(db,disabled.user,disabled.project),null);
 const context=await readAppPageDesign(db,a.user,a.project);assert.equal(context.source,source);assert.equal(context.programRevision,1);assert.ok(!JSON.stringify(context).includes('PRIVATE_RECEIPT_CANARY'));assert.ok(!appPageDesignPrompt(context).includes(JSON.stringify(source)));assert.ok(appPageDesignData(context).includes(JSON.stringify(source)));
 let calls=0;const state=(await readChat(db,a.user)).state,turn=id(),content='/design-app-page '+a.project;
 const transport=async(_url,init)=>{calls++;const messages=JSON.parse(init.body).input;assert.ok(messages.filter(m=>m.role==='user').some(m=>m.content.includes('input.note')));assert.ok(messages.filter(m=>m.role==='system').every(m=>!m.content.includes('input.note')));assert.ok(!init.body.includes('PRIVATE_RECEIPT_CANARY'));return response(request(a.project));};
 assert.equal((await sendAIChat(db,a.user,turn,state.revision,content,config,transport)).status,200);assert.equal(calls,1);const history=await readChat(db,a.user);assert.equal(history.turns.at(-1).app_page_confirmation_id,turn);assert.equal((await readAppPage(db,a.user,a.project)).page,null);
 const spent=(await getBilling(db,a.user)).quota.spent;await sendAIChat(db,a.user,turn,state.revision,content,config,transport);assert.equal(calls,1);assert.equal((await getBilling(db,a.user)).quota.spent,spent);
 await assert.rejects(prepareAppPage(db,a.user,a.project,turn,form,{...context,programRevision:0}),e=>e.status===409);
 // Scope failures cannot create code, publish, or target another project.
 for(const action of [request(b.project),{kind:'backend',operation:'reviewDisableApplication',projectId:a.project},{kind:'backend',operation:'buildApplication',projectId:a.project,source},{kind:'inspect',scope:'usage'}]){
  const t=id(),rev=(await readChat(db,a.user)).state.revision;await sendAIChat(db,a.user,t,rev,content,config,async()=>response(action));assert.equal((await db.prepare('SELECT status FROM chat_turns WHERE id=?').bind(t).first()).status,'failed');assert.equal(await db.prepare('SELECT id FROM app_page_reviews WHERE id=?').bind(t).first(),null);
 }
 assert.equal((await sendAIChat(db,b.user,id(),0,content,config,()=>assert.fail('Foreign target must not dispatch'))).status,409);
 // Program changes while inference runs cannot bind the output to the new program.
 const changing=await account(),changeTurn=id(),changeState=(await readChat(db,changing.user)).state;
 await sendAIChat(db,changing.user,changeTurn,changeState.revision,'/design-app-page '+changing.project,config,async()=>{const off=id();await prepareApplication(db,changing.user,changing.project,off,'disable',null,null);await confirmApplication(db,changing.user,off);return response(request(changing.project));});
 assert.equal(await db.prepare('SELECT id FROM app_page_reviews WHERE id=?').bind(changeTurn).first(),null);
 // A page published during inference changes its revision and rejects this stale review.
 const racing=await account(),raceTurn=id(),raceState=(await readChat(db,racing.user)).state;
 await sendAIChat(db,racing.user,raceTurn,raceState.revision,'/design-app-page '+racing.project,config,async()=>{const page=id();await prepareAppPage(db,racing.user,racing.project,page,form);await confirmAppPage(db,racing.user,page);return response(request(racing.project));});assert.equal(await db.prepare('SELECT id FROM app_page_reviews WHERE id=?').bind(raceTurn).first(),null);assert.equal(await readAppPageDesign(db,racing.user,racing.project),null);
 // History may include owner-only records; this focused request must not copy it to inference.
 const privateHistory=await account();await db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,1,'Read private state','PRIVATE_HISTORY_CANARY',?,'guided','completed')").bind(id(),privateHistory.user,new Date().toISOString()).run();await db.prepare('UPDATE workspace_state SET revision=1 WHERE user_id=?').bind(privateHistory.user).run();
 await sendAIChat(db,privateHistory.user,id(),1,'/design-app-page '+privateHistory.project,config,async(_url,init)=>{assert.ok(!init.body.includes('PRIVATE_HISTORY_CANARY'));return response(null);});
 const noAI=await account();assert.equal((await sendChat(db,noAI.user,{id:id(),revision:0,content:'/design-app-page '+noAI.project})).status,503);assert.equal((await sendChat(db,noAI.user,{id:id(),revision:0,content:'/design-app-page invalid'},config)).status,400);
 if(process.env.RUN_LIVE_MUSE==='1'){
  const live=await account(),t=id(),rev=(await readChat(db,live.user)).state.revision,liveConfig={...config,apiKey:(await readFile('opencode.key','utf8')).trim()};let liveCalls=0;
  await sendAIChat(db,live.user,t,rev,'/design-app-page '+live.project,liveConfig,(url,init)=>{liveCalls++;assert.ok(!init.body.includes('PRIVATE_RECEIPT_CANARY'));return fetch(url,init)});
  const row=await db.prepare('SELECT config_json FROM app_page_reviews WHERE id=?').bind(t).first(),billing=await getBilling(db,live.user);console.log(JSON.stringify({live:true,calls:liveCalls,hasReview:!!row,spent:billing.quota.spent,reserved:billing.quota.reserved}));assert.ok(row,'Muse must prepare the page review');assert.equal(liveCalls,1);const fields=JSON.parse(row.config_json).fields;assert.deepEqual(fields.map(f=>({key:f.key,type:f.type})),[{key:'note',type:'text'}]);assert.equal((await readChat(db,live.user)).turns.at(-1).app_page_confirmation_id,t);assert.equal((await readAppPage(db,live.user,live.project)).page,null);assert.equal(billing.quota.reserved,0);assert.equal(billing.quota.spent,0);
 }
 await recordFixtureBenchmark(db,'page-design');
 console.log('Page design passed: approved owned source, focused single-call proposal, exact program/page revisions, replay, forbidden/foreign denial, private history/receipt exclusion, no code execution and separate publication approval.');
}finally{await proxy?.dispose();await rm(dir,{recursive:true,force:true});}
