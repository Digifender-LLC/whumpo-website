import assert from 'node:assert/strict';
import {authenticator} from './app-authenticator.mjs';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
const m=await currentSiteFixtureHandlers(),store=await databaseFixture({d1:true}),db=store.db,owners=new Map(),scopes=new Map(),scope=user=>scopes.get(user);
async function owner(user=crypto.randomUUID()){const authority=await workspaceFixture(db,m,user);owners.set(user,authority);scopes.set(user,await authority.scope());return authority;}
const {appLifecycle:life,appData:data,appAuth:auth,appPages:pages,hashToken}=m,{saveBackend,testBackend}=m.backend,{prepareApplication,confirmApplication}=m.appActivation,{applicationGateway}=m.appGateway;
const id=()=>crypto.randomUUID(),now=()=>new Date().toISOString();
const service={fetch:async(_url,init)=>{const {input}=JSON.parse(init.body);return Response.json({ok:true,value:{state:input.input,result:'saved'}});}};
async function app(){const user=id(),project=id(),version=id(),test=id(),review=id();await owner(user);await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Lifecycle','','draft',?,?)").bind(project,user,now(),now()).run();await saveBackend(scope(user),user,project,version,'export default ({state,input})=>({state:input,result:"saved"})');await testBackend(scope(user),service,user,project,version,test,{state:{},input:{}});await prepareApplication(scope(user),user,project,review,'enable',version,test);await confirmApplication(scope(user),user,review);return {user,project,version};}
async function signup(a){const invite=await auth.createAppInvitation(scope(a.user),a.user,a.project),opt=await auth.appPasskeyOptions(db,a.project,'signup',false,invite.code),key=authenticator(),result=await auth.appPasskeyVerify(db,a.project,'signup',opt.challengeToken,key.registration(opt.options),false);const actor=await data.appIdentity(db,result.session,a.project);return {...result,who:actor.visitor_id,key,invite};}
const erase=async(a,v,revision,request,database=db)=>{const review=request??(await life.prepareAppDeletion(db,v.session,a.project)).id;return life.deleteAppAccount(database,v.session,a.project,review,revision,'DELETE');};
async function erased(v){for(const table of ['app_deletion_reviews','app_sessions','app_passkeys','app_recovery_codes','app_auth_challenges','app_runs','app_documents'])assert.equal((await db.prepare(`SELECT count(*) n FROM ${table} WHERE visitor_id=?`).bind(v.who).first()).n,0,table);assert.equal(await db.prepare('SELECT id FROM app_visitors WHERE id=?').bind(v.who).first(),null);assert.equal(await db.prepare('SELECT code_hash FROM app_invitations WHERE used_by=?').bind(v.who).first(),null);}
try{
 const a=await app(),b=await app(),x=await signup(a),y=await signup(a),z=await signup(b);
 await assert.rejects(life.deleteAppAccount(db,'',a.project,id(),0,'DELETE'),e=>e.status===401);
 await data.transitionAppData(db,service,x.session,a.project,id(),0,{note:'private A'});await data.transitionAppData(db,service,y.session,a.project,id(),0,{note:'private B'});
 const response=await life.exportAppAccount(db,x.session,a.project),exported=await response.json();assert.match(response.headers.get('content-disposition'),/^attachment/);assert.deepEqual(exported.document.value,{note:'private A'});assert.equal(exported.operations.length,1);assert.ok(!JSON.stringify(exported).includes('private B'));assert.ok(!JSON.stringify(exported).includes(x.session));assert.ok(!JSON.stringify(exported).includes(x.recoveryCode));assert.ok(!JSON.stringify(exported).includes('session_hash'));
 await assert.rejects(life.exportAppAccount(db,x.session,b.project),e=>e.status===401);await assert.rejects(erase(b,x,1),e=>e.status===401);
 await assert.rejects(life.deleteAppAccount(db,x.session,a.project,id(),1,'delete'),e=>e.status===400);await assert.rejects(erase(a,x,0),e=>e.status===409);
 const old='f'.repeat(64);await db.prepare("INSERT INTO app_sessions(token_hash,visitor_id,expires_at) VALUES(?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now','+23 hours'))").bind(await hashToken('townhello-app-session:'+old),x.who).run();await assert.rejects(erase(a,{session:old},1),e=>e.status===409);
 await auth.appPasskeyOptions(db,a.project,'add',false,x.session); // pending challenge must disappear too
 const stream=(await life.exportAppAccount(db,x.session,a.project)).body.getReader();await stream.read();
 const request=(await life.prepareAppDeletion(db,x.session,a.project)).id,lossy=new Proxy(db,{get(target,key){if(key==='batch')return async statements=>{await target.batch(statements);throw Error('lost commit acknowledgment');};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 assert.deepEqual(await erase(a,x,1,request,lossy),{deleted:true,id:request});await erased(x);assert.equal((await db.prepare('SELECT attempts FROM app_daily_usage WHERE project_id=?').bind(a.project).first()).attempts,2);await assert.rejects(async()=>{while(!(await stream.read()).done){};});
 assert.deepEqual(await erase(a,x,1,request),{deleted:true,id:request});await assert.rejects(erase(a,y,1,request));assert.deepEqual((await data.readAppData(db,y.session,a.project)).state,{note:'private B'});
 const c=await signup(a),concurrent=(await life.prepareAppDeletion(db,c.session,a.project)).id;assert.ok((await Promise.all(Array.from({length:5},()=>erase(a,c,0,concurrent)))).every(v=>v.deleted));await erased(c);
 // An in-flight guest cannot write data back after deletion.
 const flight=await signup(b);await assert.rejects(data.transitionAppData(db,{fetch:async(...args)=>{await erase(b,flight,0);return service.fetch(...args);}},flight.session,b.project,id(),0,{secret:'must not return'}),e=>e.status===503);await erased(flight);assert.equal((await db.prepare('SELECT attempts FROM app_daily_usage WHERE project_id=?').bind(b.project).first()).attempts,1);
 // Confirming the exact deletion does not require the page to remain published.
 const env={DB:db,ENVIRONMENT:'test',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})},BACKEND_RUNTIME:service};
 const call=(path,method='GET',body,token=x.session,origin=`https://app-${a.project}.whumpo.site`)=>applicationGateway(new Request(`https://app-${a.project}.whumpo.site/${path}`,{method,headers:{origin,'content-type':'application/json',cookie:`__Host-whumpo-app-session-${a.project}=${token}`},body:body===undefined?undefined:JSON.stringify(body)}),env);
 assert.equal((await call('account/delete','POST',{id:request,revision:1,confirmation:'DELETE'},x.session,'https://evil.example')).status,403);
 assert.equal((await call('account/delete','POST',{id:request,revision:1,confirmation:'DELETE'})).status,200);
 assert.equal((await call('account/delete','POST',{id:request,revision:1,confirmation:'DELETE'},y.session)).status,409);
 // No page means no export endpoint; publishing enables only the current visitor's export.
 assert.equal((await call('export','GET',undefined,y.session)).status,404);
 const page=id();await pages.prepareAppPage(scope(a.user),a.user,a.project,page,{title:'Private notes',description:'',buttonLabel:'Save',fields:[{key:'note',label:'Note',type:'text'}]});await pages.confirmAppPage(scope(a.user),a.user,page);
 const fresh=await data.issueAppSession(db,y.who);assert.equal((await call('export','GET',undefined,fresh)).status,200);
 // Deletion cannot reset project admission: aggregate quota applies without retained runs.
 await db.prepare('UPDATE app_daily_usage SET attempts=100 WHERE project_id=?').bind(a.project).run();await assert.rejects(data.transitionAppData(db,service,fresh,a.project,id(),1,{note:'over quota'}),e=>e.status===409);
 // Expired owner erasure receipts are cleaned; current receipts survive the same sweep.
 const retained=await signup(a),oldReceipt=id(),newReceipt=id();await auth.revokeAppVisitor(scope(a.user),a.user,a.project,y.who);await auth.revokeAppVisitor(scope(a.user),a.user,a.project,retained.who);
 await db.prepare("INSERT INTO app_owner_erasures(id,user_id,project_id,visitor_id,created_at,expires_at) VALUES(?,?,?,?, '2020-01-01T00:00:00.000Z','2020-01-31T00:00:00.000Z')").bind(oldReceipt,a.user,a.project,y.who).run();
 await db.prepare('INSERT INTO app_owner_erasures(id,user_id,project_id,visitor_id) VALUES(?,?,?,?)').bind(newReceipt,a.user,a.project,retained.who).run();
 await life.cleanupAppLifecycle(db);assert.equal(await db.prepare('SELECT id FROM app_owner_erasures WHERE id=?').bind(oldReceipt).first(),null);assert.ok(await db.prepare('SELECT id FROM app_owner_erasures WHERE id=?').bind(newReceipt).first());await erased(y);await erased(retained);
 await life.cleanupAppLifecycle(db);assert.equal((await db.prepare('SELECT attempts FROM app_daily_usage WHERE project_id=?').bind(a.project).first()).attempts,100);
 console.log('Visitor lifecycle passed: private streamed export, origin/identity checks, fresh sign-in and revision guards, atomic credential/data erasure, lost-ack and concurrent retry, interrupted export, in-flight non-resurrection, retained quotas and gateway receipts after withdrawal.');
}finally{await store.close();}
