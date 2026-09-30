import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
const bundled=await build({stdin:{contents:"export * from './src/onboarding';export * from './src/profile';export * from './src/ai-chat';export * from './src/chat';export * from './src/billing';export * from './src/first-draft';export * from './src/first-draft-command';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {readOnboarding,saveOnboarding,completeOnboarding,updateProfile,sendAIChat,readChat,sendChat,getBilling,welcomeDraftProject,displayChatRequest}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const dir=await mkdtemp('/tmp/whumpo-first-draft-');let proxy;
const config={baseURL:'https://opencode.ai/zen/go/v1',model:'muse-spark-1.3-contributor',apiKey:'synthetic',protocol:'responses'};
const page={name:'Copper Oven',headline:'Fresh bread for our neighbors',description:'Sourdough and pastries.',theme:'clay',aboutTitle:'Our bakery',aboutText:'A friendly neighborhood bakery.',sections:[]};
const response=action=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'Proposed first draft',action})}]}],usage:{input_tokens:1000,output_tokens:400}});
try{
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
 proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB;
 async function account(){
  const user=crypto.randomUUID(),now=new Date().toISOString();await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(user,user+'@example.test',now).run();
  assert.equal(await welcomeDraftProject(db,user),null);
  await updateProfile(db,user,{revision:0,name:'River',about_me:'Never share lavender telescope',share_context:false});
  const state=await readOnboarding(db,user);
  await saveOnboarding(db,user,{revision:0,stage:'review',project_name:'Copper Oven',idea:'A bakery website. '+ 'Fresh bread. '.repeat(30)+'Opening hours Tuesday through Sunday, 7am to 2pm.',audience:'Neighbors',preferred_theme:'clay'});
  await completeOnboarding(db,user,{revision:1});return {user,project:state.state.project_id};
 }
 async function run(owner,transport,store=db){const {state}=await readChat(db,owner.user,true),id=crypto.randomUUID(),content='/first-draft '+owner.project;return {id,revision:state.revision,content,result:await sendAIChat(store,owner.user,id,state.revision,content,config,transport)};}
 const owner=await account(),foreign=await account();
 // Later projects, even with the same name, cannot displace the welcome target.
 for(let n=0;n<6;n++)await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Copper Oven','A different later project','draft',?,?)").bind(crypto.randomUUID(),owner.user,new Date(Date.now()+60000+n).toISOString(),new Date(Date.now()+60000+n).toISOString()).run();
 assert.equal((await readChat(db,owner.user,true)).firstDraft.id,owner.project);
 assert.equal(await welcomeDraftProject(db,owner.user,foreign.project),null);
 assert.equal(displayChatRequest('/first-draft '+owner.project),'Build my first private website draft using my saved brief.');
 assert.equal(displayChatRequest('Please explain /first-draft'),'Please explain /first-draft');
 let calls=0;const transport=async(_url,init)=>{calls++;assert.ok(init.body.includes('Opening hours Tuesday through Sunday'));assert.ok(!init.body.includes('lavender telescope'));return response({kind:'preview',projectId:owner.project,config:page});};
 const made=await run(owner,transport);assert.equal(made.result.status,200);assert.equal(calls,1);
 assert.equal((await readChat(db,owner.user,true)).firstDraft,null);
 assert.equal((await db.prepare('SELECT project_id FROM site_versions WHERE id=?').bind(made.id).first()).project_id,owner.project);
 assert.equal((await db.prepare('SELECT project_id FROM welcome_first_drafts WHERE turn_id=?').bind(made.id).first()).project_id,owner.project);
 const charged=(await getBilling(db,owner.user)).quota.spent;assert.ok(charged>0);
 await sendAIChat(db,owner.user,made.id,made.revision,made.content,config,transport);assert.equal(calls,1);assert.equal((await getBilling(db,owner.user)).quota.spent,charged);
 const again=await run(owner,transport);assert.equal(again.result.status,409);assert.equal(calls,1);
 const denied=await sendAIChat(db,foreign.user,crypto.randomUUID(),1,made.content,config,()=>assert.fail('Foreign first project must not dispatch'));assert.equal(denied.status,409);
 // Scope failures are rejected before any general action can run.
 const sameOwnerOther=crypto.randomUUID(),now=new Date().toISOString();
 await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Copper Oven','Different owned project','draft',?,?)").bind(sameOwnerOther,foreign.user,now,now).run();
 for(const action of [{kind:'project',purpose:'Unexpected second project',config:page},{kind:'preview',projectId:owner.project,config:page},{kind:'preview',projectId:sameOwnerOther,config:page},{kind:'inspect',scope:'usage'},{kind:'domain',operation:'prepare',projectId:foreign.project,hostname:'example.test'}]){
  const before=(await getBilling(db,foreign.user)).quota.spent;let dispatches=0;
  const turn=await run(foreign,async()=>{dispatches++;return response(action);});assert.equal(dispatches,1);
  assert.equal((await db.prepare('SELECT status FROM chat_turns WHERE id=?').bind(turn.id).first()).status,'failed');
  assert.equal(await db.prepare('SELECT id FROM site_versions WHERE id=?').bind(turn.id).first(),null);
  assert.equal((await getBilling(db,foreign.user)).quota.spent,before);assert.equal((await getBilling(db,foreign.user)).quota.reserved,0);
  assert.equal((await db.prepare('SELECT status FROM inference_calls WHERE id=?').bind(turn.id).first()).status,'observed');
 }
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM projects WHERE owner_user_id=?').bind(foreign.user).first()).n,2);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM domain_claims d JOIN projects p ON p.id=d.project_id WHERE p.owner_user_id=?').bind(foreign.user).first()).n,0);
 const clarify=await run(foreign,async()=>response(null));assert.equal((await db.prepare('SELECT status FROM chat_turns WHERE id=?').bind(clarify.id).first()).status,'completed');assert.ok((await readChat(db,foreign.user,true)).firstDraft);
 // A concurrent direct build wins; the AI write and its activity roll back together.
 const racing=await account(),existing=crypto.randomUUID();
 const race=await run(racing,async()=>{
  await db.prepare("INSERT INTO site_versions(id,project_id,component_id,config_json,html,digest,created_at,source) VALUES(?,?,'site-page@1',?,'<h1>Saved elsewhere</h1>',?,?,'guided')").bind(existing,racing.project,JSON.stringify(page),'a'.repeat(64),new Date().toISOString()).run();
  return response({kind:'preview',projectId:racing.project,config:page});
 });
 assert.equal((await db.prepare('SELECT status FROM chat_turns WHERE id=?').bind(race.id).first()).status,'failed');assert.equal(await db.prepare('SELECT id FROM site_versions WHERE id=?').bind(race.id).first(),null);assert.equal(await db.prepare('SELECT id FROM activity_events WHERE id=?').bind('draft:'+race.id).first(),null);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM site_versions WHERE project_id=?').bind(racing.project).first()).n,1);assert.equal((await getBilling(db,racing.user)).quota.spent,0);assert.equal((await getBilling(db,racing.user)).quota.reserved,0);
 assert.equal(await db.prepare('SELECT turn_id FROM welcome_first_drafts WHERE project_id=?').bind(racing.project).first(),null);
 const removed=await account();let deleted=false;
 const deleteBeforeCommit=new Proxy(db,{get(target,key){if(key==='batch')return async statements=>{
  if(!deleted&&await target.prepare("SELECT id FROM chat_turns WHERE user_id=? AND status='pending'").bind(removed.user).first()){deleted=true;await target.prepare('DELETE FROM projects WHERE id=?').bind(removed.project).run();}
  return target.batch(statements);
 };const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 const removal=await run(removed,async()=>response({kind:'preview',projectId:removed.project,config:page}),deleteBeforeCommit);
 const removedReceipt=await db.prepare('SELECT status,assistant_text FROM chat_turns WHERE id=?').bind(removal.id).first();
 assert.equal(deleted,true);assert.equal(removedReceipt.status,'failed');assert.match(removedReceipt.assistant_text,/project changed/);assert.equal((await getBilling(db,removed.user)).quota.spent,0);
 // Losing the commit acknowledgment recovers the saved draft without dispatching again.
 const recovering=await account();let saved=false;
 const lossy=new Proxy(db,{get(target,key){if(key==='batch')return async statements=>{const result=await target.batch(statements);if(!saved&&(await target.prepare('SELECT id FROM site_versions WHERE project_id=?').bind(recovering.project).first())){saved=true;throw Error('Lost draft commit acknowledgement');}return result;};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 let recoverCalls=0;const recovered=await run(recovering,async()=>{recoverCalls++;return response({kind:'preview',projectId:recovering.project,config:page});},lossy);
 assert.equal((await db.prepare('SELECT status FROM chat_turns WHERE id=?').bind(recovered.id).first()).status,'completed');assert.equal(recoverCalls,1);
 await sendAIChat(db,recovering.user,recovered.id,recovered.revision,recovered.content,config,()=>assert.fail('Do not redispatch a committed first draft'));
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM site_versions WHERE project_id=?').bind(recovering.project).first()).n,1);
 const guided=await account();assert.equal((await sendChat(db,guided.user,{id:crypto.randomUUID(),revision:1,content:'/first-draft '+guided.project})).status,503);
 assert.equal((await sendChat(db,guided.user,{id:crypto.randomUUID(),revision:1,content:'/first-draft invalid'},config)).status,400);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM publications').first()).n,0);
 console.log('First draft passed: exact welcome ownership, full saved brief, unshared bio exclusion, single dispatch, scoped action denial, actual cost receipts, replay, stale build rejection, atomic concurrent-build rollback, lost-commit recovery, no publication and guided-mode boundary.');
}finally{if(proxy)await proxy.dispose();await rm(dir,{recursive:true,force:true});}
