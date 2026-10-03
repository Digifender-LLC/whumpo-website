import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
const m=await currentSiteFixtureHandlers(),store=await databaseFixture({d1:true}),db=store.db,scopes=new Map(),scope=user=>scopes.get(user);
const {saveBackend,listBackends,testBackend,callBackend}=m.backend;
const id=()=>crypto.randomUUID();const now=()=>new Date().toISOString();
async function account(){const authority=await workspaceFixture(db,m),user=authority.account,project=id();scopes.set(user,await authority.scope());await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Backend fixture','','draft',?,?)").bind(project,user,now(),now()).run();return {...authority,user,project};}
let calls=0;const service={fetch:async(url,init)=>{calls++;assert.equal(url,'https://runtime/execute');assert.equal(init.headers.authorization,undefined);const body=JSON.parse(init.body);assert.deepEqual(Object.keys(body),['version','source','input']);return Response.json({ok:true,value:body.input});}};
try{
 const a=await account(),b=await account(),v=id(),source='export default x=>x';await saveBackend(scope(a.user),a.user,a.project,v,source);
 await saveBackend(scope(a.user),a.user,a.project,v,source);assert.equal((await listBackends(scope(a.user),a.user,a.project)).length,1);
 await assert.rejects(saveBackend(scope(a.user),a.user,a.project,v,source+' '),e=>e.status===409);
 await assert.rejects(listBackends(scope(b.user),b.user,a.project),e=>e.status===404);
 await assert.rejects(testBackend(scope(b.user),service,b.user,b.project,v,id(),{}),e=>e.status===404);assert.equal(calls,0);
 await assert.rejects(db.prepare('UPDATE backend_versions SET source=? WHERE id=?').bind('new',v).run(),/backend_immutable/);
 const run=id(),result=await testBackend(scope(a.user),service,a.user,a.project,v,run,{private:'fixture'});assert.deepEqual(result.result,{ok:true,value:{private:'fixture'}});
 assert.deepEqual(await testBackend(scope(a.user),service,a.user,a.project,v,run,{private:'fixture'}),result);assert.equal(calls,1);
 await assert.rejects(testBackend(scope(a.user),service,a.user,a.project,v,run,{different:1}),e=>e.status===409);
 const concurrent=id();await Promise.all(Array.from({length:8},()=>testBackend(scope(a.user),service,a.user,a.project,v,concurrent,{})));assert.equal(calls,2);
 // Simulate reservation commit followed by a lost acknowledgment. No blind dispatch.
 let lost=true;const lossy=await a.scope(interceptDatabase(db,/^INSERT INTO backend_runs/,async()=>{},async()=>{if(lost){lost=false;throw Error('lost ack');}}));
 const pending=id();assert.equal((await testBackend(lossy,service,a.user,a.project,v,pending,{})).state,'running');assert.equal(calls,2);assert.equal((await testBackend(scope(a.user),service,a.user,a.project,v,pending,{})).state,'running');
 const batch=await Promise.allSettled(Array.from({length:25},()=>testBackend(scope(a.user),service,a.user,a.project,v,id(),{})));assert.equal(batch.filter(x=>x.status==='fulfilled').length,17);assert.equal((await db.prepare('SELECT count(*) n FROM backend_runs WHERE project_id=?').bind(a.project).first()).n,20);
 for(const row of batch.filter(x=>x.status==='rejected'))assert.equal(row.reason.status,429);
 const before=calls;await testBackend(scope(a.user),service,a.user,a.project,v,run,{private:'fixture'});assert.equal(calls,before);
 const invalidServices=[()=>new Response('<html>provider error</html>',{status:500}),()=>Response.json({ok:true,value:1,extra:'secret'}),()=>Response.json({ok:false,error:'raw secret'},{status:422}),()=>new Response('x'.repeat(19000),{headers:{'content-type':'application/json'}}),()=>Response.json({ok:true,value:'x'.repeat(17000)}),()=>{throw Error('provider credential');}];
 for(const fetch of invalidServices)assert.deepEqual(await callBackend({fetch},source,{}),{ok:false,error:'unavailable'});
 assert.deepEqual(await callBackend({fetch:()=>Response.json({ok:false,error:'work_limit'},{status:422})},source,{}),{ok:false,error:'work_limit'});
 const bversion=id();await saveBackend(scope(b.user),b.user,b.project,bversion,source);assert.equal((await testBackend(scope(b.user),service,b.user,b.project,bversion,id(),42)).result.value,42);
 const rows=await Promise.allSettled(Array.from({length:30},()=>saveBackend(scope(b.user),b.user,b.project,id(),source)));assert.equal(rows.filter(r=>r.status==='fulfilled').length,24);
 await assert.rejects(db.prepare('INSERT INTO backend_runs(id,user_id,project_id,version_id,request_hash) VALUES(?,?,?,?,?)').bind(id(),b.user,a.project,v,'bad').run(),/backend_owner|backend_run_quota/);
 console.log('Backend gateway checks passed: immutable owned versions, replay/conflict isolation, concurrent dispatch-once, lost reservation acknowledgment, atomic quota, private transport and bounded error normalization.');
}finally{await store.close();}
