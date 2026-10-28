import {fixtureExtensionPlan} from './helpers/composition.mjs';
import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {assertReplyEditRefused} from './helpers/receipt-forge.mjs';
const m=await currentSiteFixtureHandlers(),store=await databaseFixture({d1:true}),db=store.db,owners=new Map(),scopes=new Map(),scope=user=>scopes.get(user);
async function accountAuthority(user=crypto.randomUUID()){const authority=await workspaceFixture(db,m,user);owners.set(user,authority);scopes.set(user,await authority.scope());return authority;}
const {sendChat,readChat,sendAIChat,getBilling}=m,id=()=>crypto.randomUUID();
async function account(){const user=id(),project=id(),now=new Date().toISOString();await accountAuthority(user);await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Calculator','Quote estimates','draft',?,?)").bind(project,user,now,now).run();await readChat(scope(user),user);return {user,project};}
let executions=0;const backendRuntime={fetch:async(_url,init)=>{executions++;const data=JSON.parse(init.body);return Response.json({ok:true,value:data.input?.state?{state:{count:(data.input.state.count??0)+(data.input.input.add??1)},result:'prepared'}:{total:data.input.quantity*data.input.price}});}};
async function guided(a,content){const revision=(await readChat(scope(a.user),a.user)).state.revision,request={id:id(),revision,content};const result=await sendChat(scope(a.user),a.user,request,undefined,{backendRuntime});assert.equal(result.status,200,JSON.stringify(result));return {request,turn:(await readChat(scope(a.user),a.user)).turns.at(-1)};}
async function ai(a,action){const request={id:id(),revision:(await readChat(scope(a.user),a.user)).state.revision,content:'Prepare my requested private backend operation'};let calls=0;const transport=async()=>{calls++;if(action.operation==='create'&&action.projectId===a.project&&!action.planId)action={...action,planId:await fixtureExtensionPlan(scope(a.user),a.user,a.project,request.id)};return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'Already deployed',action})}]}],usage:{input_tokens:800,output_tokens:300}});};const config={baseURL:'https://provider.test/v1',apiKey:'synthetic',model:'fixture',protocol:'responses'};assert.equal((await sendAIChat(scope(a.user),a.user,request.id,request.revision,request.content,config,transport,{backendRuntime})).status,200);await sendAIChat(scope(a.user),a.user,request.id,request.revision,request.content,config,transport,{backendRuntime});assert.equal(calls,1);return {request,turn:(await readChat(scope(a.user),a.user)).turns.at(-1)};}
try{
 const a=await account(),b=await account(),source='export default input=>({total:input.quantity*input.price})';
 const created=await ai(a,{kind:'backend',operation:'create',projectId:a.project,source}),version=created.request.id;
 assert.match(created.turn.assistant_text,/untested private backend draft/);assert.doesNotMatch(created.turn.assistant_text,/Already deployed/);
 assert.equal((await db.prepare('SELECT source FROM backend_versions WHERE id=?').bind(version).first()).source,source);
 assert.equal((await db.prepare('SELECT count(*) n FROM publications WHERE project_id=? AND version_id IS NOT NULL').bind(a.project).first()).n,0);
 const spent=(await getBilling(scope(a.user),a.user)).standardAI.creditCharge;
 assert.match((await guided(a,'/backends '+a.project)).turn.assistant_text,new RegExp(version));
 assert.ok((await guided(a,'/backend '+version)).turn.assistant_text.includes(source));
 const run=await guided(a,'/test-backend '+version+' {"quantity":3,"price":7}');assert.match(run.turn.assistant_text,/"total":21/);assert.equal(executions,1);
 await sendChat(scope(a.user),a.user,run.request,undefined,{backendRuntime});assert.equal(executions,1);
 assert.match((await guided(a,'/backend-result '+run.request.id)).turn.assistant_text,/"total":21/);assert.equal((await getBilling(scope(a.user),a.user)).standardAI.creditCharge,spent);
 assert.match((await guided(b,'/backend '+version)).turn.assistant_text,/not found/);
 assert.match((await guided(b,'/test-backend '+version+' null')).turn.assistant_text,/not found/);assert.equal(executions,1);
 assert.match((await guided(b,'/backend-result '+run.request.id)).turn.assistant_text,/not found/);
 const aiRun=await ai(a,{kind:'backend',operation:'test',versionId:version,input:{quantity:4,price:5}});assert.match(aiRun.turn.assistant_text,/"total":20/);assert.equal(executions,2);
 for(const action of [{kind:'backend',operation:'publish',versionId:version},{kind:'backend',operation:'test',versionId:version,input:{},confirm:true},{kind:'backend',operation:'create',projectId:b.project,source}]){const denied=await ai(a,action);assert.equal(await db.prepare('SELECT id FROM backend_versions WHERE id=?').bind(denied.request.id).first(),null);}
 assert.equal(executions,2);
 // Simultaneous guided requests with the same ID reserve one turn and one invocation.
 const request={id:id(),revision:(await readChat(scope(a.user),a.user)).state.revision,content:'/test-backend '+version+' {"quantity":2,"price":8}'};
 await Promise.all(Array.from({length:5},()=>sendChat(scope(a.user),a.user,request,undefined,{backendRuntime})));assert.equal(executions,3);
 assert.equal((await db.prepare('SELECT count(*) n FROM backend_runs WHERE id=?').bind(request.id).first()).n,1);
 const stateReview=await ai(b,{kind:'backend',operation:'create',projectId:b.project,source:'export default ({state,input})=>({state:{count:(state.count??0)+input.add},result:null})'});
 const prepared=await guided(b,'/review-backend-state '+stateReview.request.id+' {"add":5}');assert.match(prepared.turn.assistant_text,/Nothing has been applied/);
 assert.match((await guided(b,'/backend-state '+b.project)).turn.assistant_text,/"revision":0/);
 assert.match((await guided(b,'/backend-state-review '+prepared.request.id)).turn.assistant_text,/Before: {}/);
 // Receipt: an edited data-review reply is refused on the confirm control and changes nothing.
 await assertReplyEditRefused({db,kind:'backendState',reviewId:prepared.request.id,table:'backend_state_reviews',confirm:async action=>m.sendChatControl(scope(b.user),b.user,{id:id(),revision:(await readChat(scope(b.user),b.user)).state.revision,action:{type:'confirm',...action}},undefined,{backendRuntime})});
 assert.match((await guided(b,'/confirm-backend-state '+prepared.request.id)).turn.assistant_text,/Applied data review/);
 assert.match((await guided(b,'/backend-state '+b.project)).turn.assistant_text,/"count":5/);
 const history=await guided(b,'/backend-state-history '+b.project);assert.match(history.turn.assistant_text,new RegExp(prepared.request.id));
 const downloaded=await guided(b,'/export-backend-state '+prepared.request.id);assert.equal(downloaded.turn.backend_state_export_id,prepared.request.id);
 const restore=await guided(b,'/restore-backend-before '+prepared.request.id);assert.equal(restore.turn.backend_state_confirmation_id,restore.request.id);assert.match(restore.turn.assistant_text,/entire private data document/);
 const shownAgain=await guided(b,'/backend-state-review '+restore.request.id);assert.equal(shownAgain.turn.backend_state_confirmation_id,restore.request.id);
 await guided(b,'/confirm-backend-state '+restore.request.id);
 const transcript=await readChat(scope(b.user),b.user);assert.equal(transcript.turns.find(t=>t.id===restore.request.id).backend_state_confirmation_id,null);assert.equal(transcript.turns.find(t=>t.id===shownAgain.request.id).backend_state_confirmation_id,null);
 assert.match((await guided(b,'/backend-state '+b.project)).turn.assistant_text,/"state":{}/);
 const aiExport=await ai(b,{kind:'backend',operation:'exportState',snapshotId:prepared.request.id});assert.equal(aiExport.turn.backend_state_export_id,prepared.request.id);
 const aiRestore=await ai(b,{kind:'backend',operation:'restoreState',snapshotId:prepared.request.id});assert.equal(aiRestore.turn.backend_state_confirmation_id,aiRestore.request.id);
 assert.match((await guided(b,'/backend-state '+b.project)).turn.assistant_text,/"state":{}/);
 console.log('Backend chat checks passed: AI immutable drafts, exact server receipts, guided inspect/test/result, free guided usage, owner isolation, rejected publication/extra fields and replay-safe execution.');
}finally{await store.close();}
