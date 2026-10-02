import assert from 'node:assert/strict';
import {authenticator} from './app-authenticator.mjs';
// Invoked by the connected app harness with its actual platform, visitor host,
// isolated QuickJS runtime and disposable database. No guest reply is stubbed.
export async function taskListAppJourney({db,account,call,host,env,setupChat,executions}){
 const id=()=>crypto.randomUUID(),owner=await account(),startExecutions=executions();
 async function json(path,body,status=200,method){const response=await call(owner,path,body,method);assert.equal(response.status,status,await response.clone().text());return response.json();}
 async function chat(content){return (await setupChat(owner,content)).turns.at(-1);}
 await json('/profile',{revision:0,name:'Task owner',avatar_id:'leaf'},200,'PATCH');await json('/onboarding');
 await json('/onboarding',{revision:0,stage:'review',prompt:'review',project_name:'Private tasks',idea:'A separate task list for each invited visitor',audience:'Our group',preferred_theme:'forest'},200,'PUT');await json('/onboarding/complete',{revision:1});
 const project=(await db.prepare('SELECT id FROM projects WHERE owner_user_id=?').bind(owner.user).first()).id,path='/projects/'+project,origin='https://app-'+project+'.whumpo.site';
 const copied=await chat('/use-backend '+project+' private-task-list@1'),version=copied.id;assert.match(copied.assistant_text,/Copied private-task-list@1/);assert.equal(executions(),startExecutions);
 const provenance=await db.prepare('SELECT component_id,component_version FROM backend_component_instances WHERE version_id=?').bind(version).first();assert.deepEqual(provenance,{component_id:'private-task-list',component_version:1});
 const sample={input:{state:{},input:{action:'add',text:'Synthetic example'}},expected:{state:{nextId:2,items:[{id:1,text:'Synthetic example',done:false}]},result:{items:[{id:1,text:'Synthetic example',done:false}]}}};
 const checked=await chat('/check-backend '+version+' '+JSON.stringify(sample)),run=checked.id;assert.equal(executions(),startExecutions+1);
 const program=await chat('/enable-application '+version+' '+run);assert.equal(program.application_confirmation_id,program.id);
 assert.equal((await host.fetch(new Request(origin+'/'),env)).status,404);
 await chat('/confirm-application '+program.id);assert.equal((await host.fetch(new Request(origin+'/'),env)).status,404);
 const form={title:'Private tasks',description:'Choose add, list, complete, reopen or remove. Use a saved task ID for changes.',buttonLabel:'Apply task action',fields:[{key:'action',label:'What would you like to do?',type:'choice',options:[{value:'add',label:'Add a task'},{value:'list',label:'Show my tasks'},{value:'complete',label:'Mark complete'},{value:'reopen',label:'Reopen a task'},{value:'remove',label:'Remove a task'}]},{key:'text',label:'New task text (for adding)',type:'text',optional:true},{key:'id',label:'Task ID (0 for new tasks)',type:'number'}]};
 const page=await chat('/configure-app-page '+project+' '+JSON.stringify(form));assert.equal(page.app_page_confirmation_id,page.id);
 await chat('/confirm-app-page '+page.id);assert.equal((await host.fetch(new Request(origin+'/'),env)).status,200);
 function client(){const jar=new Map();return {async request(suffix,body){const response=await host.fetch(new Request(origin+suffix,{method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')},body:body===undefined?undefined:JSON.stringify(body)}),env);for(const cookie of response.headers.getSetCookie()){const pair=cookie.split(';')[0],position=pair.indexOf('=');jar.set(pair.slice(0,position),pair.slice(position+1));}return {status:response.status,data:await response.json()};}};}
 async function signup(client){const invite=await json(path+'/application-access/invitations',{},201),key=authenticator(origin),options=await client.request('/auth/signup/options',{inviteCode:invite.code});assert.equal(options.status,200);assert.equal((await client.request('/auth/signup/verify',{credential:key.registration(options.data.options)})).status,200);}
 const first=client(),second=client();await signup(first);await signup(second);
 const config=await first.request('/config');assert.equal(config.status,200);assert.deepEqual(config.data.form,form);assert.equal(config.data.pageId,page.id);
 const beforeChoice=executions();
 for(const action of ['', 'destroy', 'Add a task']){const bad=await first.request('/data',{id:id(),revision:0,pageId:page.id,input:{action,id:0,text:''}});assert.equal(bad.status,400);}
 assert.equal(executions(),beforeChoice,'Unapproved choices must not reach the runtime');
 const initial={id:id(),revision:0,pageId:page.id,input:{action:'add',id:0,text:'First visitor private task'}};
 const response=await first.request('/data',initial);assert.equal(response.status,200);assert.equal(response.data.state,'complete');assert.equal(executions(),startExecutions+2);
 assert.deepEqual((await first.request('/data',initial)).data,response.data);assert.equal(executions(),startExecutions+2);
 assert.equal((await second.request('/receipts/'+initial.id)).status,404);assert.deepEqual((await second.request('/data')).data.state,{});
 let changes=0;
 async function change(client,input){const before=(await client.request('/data')).data,operation={id:id(),revision:before.revision,pageId:page.id,input:{id:0,text:'',...input}},result=await client.request('/data',operation);assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.state,'complete',JSON.stringify(result.data));changes++;return (await client.request('/data')).data;}
 const other=await change(second,{action:'add',text:'Second visitor private task'});assert.equal(other.state.items[0].id,1);assert.ok(!JSON.stringify(other).includes('First visitor'));
 await change(first,{action:'add',text:'Another task'});
 assert.equal((await change(first,{action:'complete',id:1})).state.items[0].done,true);
 assert.equal((await change(first,{action:'reopen',id:1})).state.items[0].done,false);
 assert.deepEqual((await change(first,{action:'remove',id:1})).state.items.map(i=>i.id),[2]);
 const final=await change(first,{action:'add',text:'Newest task'});assert.deepEqual(final.state.items.map(i=>i.id),[2,3]);
 const beforeInvalid=await first.request('/data'),calls=executions();
 assert.equal((await first.request('/data',{...initial,id:id(),input:{action:'remove',id:2,text:''}})).status,409);assert.equal(executions(),calls,'Stale revision must not dispatch');
 const invalid=await first.request('/data',{id:id(),revision:beforeInvalid.data.revision,pageId:page.id,input:{action:'remove',id:999,text:''}});assert.equal(invalid.status,200);assert.equal(invalid.data.state,'failed');assert.deepEqual((await first.request('/data')).data,beforeInvalid.data);
 const exported=await first.request('/export');assert.equal(exported.status,200);assert.deepEqual(exported.data.document.value,final.state);
 const status=await chat('/app-status '+project);for(const text of ['First visitor private task','Second visitor private task','Newest task'])assert.ok(!status.assistant_text.includes(text));
 const off=await chat('/disable-app-page '+project);await chat('/confirm-app-page '+off.id);assert.equal((await first.request('/data')).status,404);assert.equal((await host.fetch(new Request(origin+'/'),env)).status,404);
 await chat('/confirm-app-page '+page.id);assert.equal((await host.fetch(new Request(origin+'/'),env)).status,404);
 assert.equal(executions(),startExecutions+3+changes);assert.equal((await db.prepare('SELECT COUNT(*) n FROM inference_calls').first()).n,0);
 console.log('Shared task-list journey passed: Chat copy/check, exact provenance, separate authority/page approvals, signed visitor passkeys, isolated task CRUD, replay/stale refusal, unchanged failed transitions, export and withdrawal with no inference.');
}
