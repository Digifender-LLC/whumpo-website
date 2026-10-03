Error.stackTraceLimit=0;
import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers,createFixtureWebsite} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
const m=await currentSiteFixtureHandlers(),store=await databaseFixture({d1:true}),db=store.db,owners=new Map(),scopes=new Map(),scope=user=>scopes.get(user);
async function accountAuthority(user=crypto.randomUUID()){const authority=await workspaceFixture(db,m,user);owners.set(user,authority);scopes.set(user,await authority.scope());return authority;}
const {readOnboarding,saveOnboarding,completeOnboarding,updateProfile,sendAIChat:sendInternalAIChat,readChat,sendChat,getBilling,welcomeDraftProject}=m;
// Exercise the internal constrained-build adapter; public Chat uses natural messages.
const sendAIChat=(db,user,id,revision,content,config,transport,options)=>sendInternalAIChat(db,user,id,revision,content,config,transport,options,true);
const config={baseURL:'https://opencode.ai/zen/go/v1',model:'muse-spark-1.3-contributor',apiKey:'synthetic',protocol:'responses'};
const page={name:'Copper Oven',headline:'Fresh bread for our neighbors',description:'Sourdough and pastries.',theme:'clay',aboutTitle:'Our bakery',aboutText:'A friendly neighborhood bakery.',sections:[],photos:[]};
const response=action=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'Proposed first draft',action})}]}],usage:{input_tokens:1000,output_tokens:400}});
try{
 async function account(){
  const user=crypto.randomUUID();await accountAuthority(user);
  assert.equal(await welcomeDraftProject(scope(user),user),null);
  await updateProfile(scope(user),user,{revision:0,name:'River',about_me:'Never share lavender telescope',share_context:false});
  const state=await readOnboarding(scope(user),user);
  await saveOnboarding(scope(user),user,{revision:0,stage:'review',prompt:'review',project_name:'Copper Oven',idea:'A bakery website. '+ 'Fresh bread. '.repeat(30)+'Opening hours Tuesday through Sunday, 7am to 2pm.',audience:'Neighbors',preferred_theme:'clay'});
  await completeOnboarding(scope(user),user,{revision:1});return {user,project:state.state.project_id};
 }
 async function run(owner,transport,database=scope(owner.user)){const {state}=await readChat(scope(owner.user),owner.user,true),id=crypto.randomUUID(),content='/first-draft '+owner.project;return {id,revision:state.revision,content,result:await sendAIChat(database,owner.user,id,state.revision,content,config,transport)};}
 const owner=await account(),foreign=await account();
 // Later projects, even with the same name, cannot displace the welcome target.
 for(let n=0;n<6;n++)await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Copper Oven','A different later project','draft',?,?)").bind(crypto.randomUUID(),owner.user,new Date(Date.now()+60000+n).toISOString(),new Date(Date.now()+60000+n).toISOString()).run();
 assert.equal((await readChat(scope(owner.user),owner.user,true)).firstDraft.id,owner.project);
 assert.equal(await welcomeDraftProject(scope(owner.user),owner.user,foreign.project),null);
 let calls=0;const transport=async(_url,init)=>{calls++;assert.ok(init.body.includes('Opening hours Tuesday through Sunday'));assert.ok(!init.body.includes('lavender telescope'));return response({kind:'specification',operation:'create',projectId:owner.project,config:page});};
 const made=await run(owner,transport);assert.equal(made.result.status,200);assert.equal(calls,1);
 assert.equal((await readChat(scope(owner.user),owner.user,true)).firstDraft,null);
 assert.equal((await db.prepare('SELECT project_id FROM site_versions WHERE id=?').bind(made.id).first()).project_id,owner.project);
 assert.equal((await db.prepare('SELECT project_id FROM welcome_first_drafts WHERE turn_id=?').bind(made.id).first()).project_id,owner.project);
 const charged=(await getBilling(scope(owner.user),owner.user)).standardAI.creditCharge;assert.equal(charged,0);
 await sendAIChat(scope(owner.user),owner.user,made.id,made.revision,made.content,config,transport);assert.equal(calls,1);assert.equal((await getBilling(scope(owner.user),owner.user)).standardAI.creditCharge,charged);
 const again=await run(owner,transport);assert.equal(again.result.status,409);assert.equal(calls,1);
 const denied=await sendAIChat(scope(foreign.user),foreign.user,crypto.randomUUID(),1,made.content,config,()=>assert.fail('Foreign first project must not dispatch'));assert.equal(denied.status,409);
 // Scope failures are rejected before any general action can run.
 const sameOwnerOther=crypto.randomUUID(),now=new Date().toISOString();
 await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Copper Oven','Different owned project','draft',?,?)").bind(sameOwnerOther,foreign.user,now,now).run();
 for(const action of [{kind:'project',purpose:'Unexpected second project',config:page},{kind:'specification',operation:'create',projectId:owner.project,config:page},{kind:'specification',operation:'create',projectId:sameOwnerOther,config:page},{kind:'inspect',scope:'usage'},{kind:'domain',operation:'prepare',projectId:foreign.project,hostname:'example.test'}]){
  const before=(await getBilling(scope(foreign.user),foreign.user)).standardAI.creditCharge;let dispatches=0;
  const turn=await run(foreign,async()=>{dispatches++;return response(action);});assert.equal(dispatches,1);
  assert.equal((await db.prepare('SELECT status FROM chat_turns WHERE id=?').bind(turn.id).first()).status,'failed');
  assert.equal(await db.prepare('SELECT id FROM site_versions WHERE id=?').bind(turn.id).first(),null);
  assert.equal((await getBilling(scope(foreign.user),foreign.user)).standardAI.creditCharge,before);assert.equal((await getBilling(scope(foreign.user),foreign.user)).standardAI.creditCharge,0);
  assert.equal((await db.prepare('SELECT status FROM inference_calls WHERE id=?').bind(turn.id).first()).status,'observed');
 }
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM projects WHERE owner_user_id=?').bind(foreign.user).first()).n,2);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM domain_claims d JOIN projects p ON p.id=d.project_id WHERE p.owner_user_id=?').bind(foreign.user).first()).n,0);
 const clarify=await run(foreign,async()=>response(null));assert.equal((await db.prepare('SELECT status FROM chat_turns WHERE id=?').bind(clarify.id).first()).status,'completed');assert.ok((await readChat(scope(foreign.user),foreign.user,true)).firstDraft);
 // A concurrent direct build wins; the AI write and its activity roll back together.
 const racing=await account();
 const race=await run(racing,async()=>{
  await createFixtureWebsite(scope(racing.user),racing.user,racing.project,page);
  return response({kind:'specification',operation:'create',projectId:racing.project,config:page});
 });
 assert.equal((await db.prepare('SELECT status FROM chat_turns WHERE id=?').bind(race.id).first()).status,'failed');assert.equal(await db.prepare('SELECT id FROM site_versions WHERE id=?').bind(race.id).first(),null);assert.equal(await db.prepare('SELECT id FROM activity_events WHERE id=?').bind('draft:'+race.id).first(),null);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM site_versions WHERE project_id=?').bind(racing.project).first()).n,1);assert.equal((await getBilling(scope(racing.user),racing.user)).standardAI.creditCharge,0);
 assert.equal(await db.prepare('SELECT turn_id FROM welcome_first_drafts WHERE project_id=?').bind(racing.project).first(),null);
 const removed=await account();let deleted=false;
 const deleteBeforeCommit=await owners.get(removed.user).scope(interceptDatabase(db,/^INSERT INTO project_spec_creations/,async()=>{if(!deleted){deleted=true;await db.prepare('DELETE FROM projects WHERE id=?').bind(removed.project).run();}}));
 const removal=await run(removed,async()=>response({kind:'specification',operation:'create',projectId:removed.project,config:page}),deleteBeforeCommit);
 const removedReceipt=await db.prepare('SELECT status,assistant_text FROM chat_turns WHERE id=?').bind(removal.id).first();
 assert.equal(deleted,true);assert.equal(removedReceipt.status,'failed');assert.match(removedReceipt.assistant_text,/project changed/);assert.equal((await getBilling(scope(removed.user),removed.user)).standardAI.creditCharge,0);
 // Losing the commit acknowledgment recovers the saved draft without dispatching again.
 const recovering=await account();let saved=false;
 const lossy=await owners.get(recovering.user).scope(interceptDatabase(db,/^INSERT INTO project_spec_creations/,async()=>{},async()=>{if(!saved){saved=true;throw Error('Lost draft commit acknowledgement');}}));
 let recoverCalls=0;const recovered=await run(recovering,async()=>{recoverCalls++;return response({kind:'specification',operation:'create',projectId:recovering.project,config:page});},lossy);
 assert.equal((await db.prepare('SELECT status FROM chat_turns WHERE id=?').bind(recovered.id).first()).status,'completed');assert.equal(recoverCalls,1);assert.equal(saved,true);
 await sendAIChat(scope(recovering.user),recovering.user,recovered.id,recovered.revision,recovered.content,config,()=>assert.fail('Do not redispatch a committed first draft'));
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM site_versions WHERE project_id=?').bind(recovering.project).first()).n,1);
 const guided=await account();assert.equal((await sendChat(scope(guided.user),guided.user,{id:crypto.randomUUID(),revision:1,content:'/first-draft '+guided.project})).status,503);
 assert.equal((await sendChat(scope(guided.user),guided.user,{id:crypto.randomUUID(),revision:1,content:'/first-draft invalid'},config)).status,400);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM publications').first()).n,0);
 // App handoff uses the full saved welcome brief and only the bounded build action.
 const appOwner=await account(),appTurn=crypto.randomUUID(),appCommand='/first-app '+appOwner.project,appState=(await readChat(scope(appOwner.user),appOwner.user,true)).state;
 let executions=0,appCalls=0;const backendRuntime={fetch:async(_url,init)=>{executions++;const request=JSON.parse(init.body);assert.deepEqual(request.input,{state:{},input:{note:'Synthetic note'}});return Response.json({ok:true,value:{state:{note:'Synthetic note'},result:'Saved'}});}};
 const appAction=projectId=>({kind:'backend',operation:'buildApplication',projectId,source:'export default ({input})=>({state:{note:input.note},result:"Saved"})',input:{state:{},input:{note:'Synthetic note'}},expected:{state:{note:'Synthetic note'},result:'Saved'}});
 const appTransport=async(_url,init)=>{appCalls++;assert.ok(init.body.includes('Opening hours Tuesday through Sunday'),'Full saved brief included');assert.ok(!init.body.includes('lavender telescope'));assert.ok(init.body.includes('only allowed actions are capabilities plan and backend buildApplication'));return appCalls===1?response({kind:'capabilities',operation:'plan',projectId:appOwner.project,needs:['custom.visitor-transition'],extension:{missing:'A private notebook replaces one note; the shared task list does not match this behavior.'}}):response({...appAction(appOwner.project),planId:appTurn});};
 assert.equal((await sendAIChat(scope(appOwner.user),appOwner.user,appTurn,appState.revision,appCommand,config,appTransport,{backendRuntime})).status,200);
 const appHistory=await readChat(scope(appOwner.user),appOwner.user,true);assert.equal(appHistory.firstDraft,null);assert.equal(appHistory.turns.at(-1).application_confirmation_id,appTurn);assert.equal(executions,1);assert.equal(appCalls,2);
 assert.equal((await db.prepare('SELECT turn_id FROM welcome_first_drafts WHERE project_id=?').bind(appOwner.project).first()).turn_id,appTurn);
 assert.equal((await db.prepare('SELECT enabled FROM app_spaces WHERE project_id=?').bind(appOwner.project).first()).enabled,0);
 assert.equal((await db.prepare('SELECT count(*) n FROM site_versions WHERE project_id=?').bind(appOwner.project).first()).n,0);
 await sendAIChat(scope(appOwner.user),appOwner.user,appTurn,appState.revision,appCommand,config,appTransport,{backendRuntime});assert.equal(appCalls,2);assert.equal(executions,1);
 assert.equal((await run(appOwner,()=>assert.fail('App already started'))).result.status,409);
 const scoped=await account();for(const action of [{kind:'specification',operation:'create',projectId:scoped.project,config:page},appAction(appOwner.project),{...appAction(scoped.project),operation:'create'},{kind:'inspect',scope:'usage'}]){
  const turn=crypto.randomUUID(),state=(await readChat(scope(scoped.user),scoped.user)).state;
  await sendAIChat(scope(scoped.user),scoped.user,turn,state.revision,'/first-app '+scoped.project,config,async()=>response(action),{backendRuntime});
  assert.equal((await db.prepare('SELECT status FROM chat_turns WHERE id=?').bind(turn).first()).status,'failed');assert.equal(await db.prepare('SELECT id FROM backend_versions WHERE id=?').bind(turn).first(),null);
 }
 assert.equal(executions,1);assert.equal((await getBilling(scope(scoped.user),scoped.user)).standardAI.creditCharge,0);
 assert.equal((await sendAIChat(scope(scoped.user),scoped.user,crypto.randomUUID(),(await readChat(scope(scoped.user),scoped.user)).state.revision,appCommand,config,()=>assert.fail('Foreign welcome project'))).status,409);
 // A website saved while the app inference runs wins without partial app artifacts.
 const racingApp=await account(),raceTurn=crypto.randomUUID(),raceState=(await readChat(scope(racingApp.user),racingApp.user)).state;
 await sendAIChat(scope(racingApp.user),racingApp.user,raceTurn,raceState.revision,'/first-app '+racingApp.project,config,async()=>{
  await createFixtureWebsite(scope(racingApp.user),racingApp.user,racingApp.project,page);return response({kind:'backend',operation:'buildApplication',projectId:racingApp.project,reference:'private-task-list@1'});
 },{backendRuntime});
 assert.equal((await db.prepare('SELECT status FROM chat_turns WHERE id=?').bind(raceTurn).first()).status,'failed');assert.equal(await db.prepare('SELECT id FROM backend_versions WHERE id=?').bind(raceTurn).first(),null);assert.equal(await db.prepare('SELECT turn_id FROM welcome_first_drafts WHERE turn_id=?').bind(raceTurn).first(),null);assert.equal((await getBilling(scope(racingApp.user),racingApp.user)).standardAI.creditCharge,0);assert.equal(executions,1);
 // Ordinary backend drafts also remove the start card; no assumption that only websites count.
 const existingApp=await account();await db.prepare('INSERT INTO backend_versions VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),existingApp.project,'export default x=>x','b'.repeat(64),new Date().toISOString()).run();assert.equal((await readChat(scope(existingApp.user),existingApp.user,true)).firstDraft,null);
 const noAI=await account();assert.equal((await sendChat(scope(noAI.user),noAI.user,{id:crypto.randomUUID(),revision:1,content:'/first-app '+noAI.project})).status,503);assert.equal((await sendChat(scope(noAI.user),noAI.user,{id:crypto.randomUUID(),revision:1,content:'/first-app invalid'},config)).status,400);
 console.log('First app passed: complete private brief, bounded same-project action, synthetic check and review, shared atomic claim, exact retry, website/app race, backend-aware starter card, foreign/forbidden denial and no automatic activation/publication.');
 console.log('First draft passed: exact welcome ownership, full saved brief, unshared bio exclusion, single dispatch, scoped action denial, actual cost receipts, replay, stale build rejection, atomic concurrent-build rollback, lost-commit recovery, no publication and guided-mode boundary.');
}finally{await store.close();}
