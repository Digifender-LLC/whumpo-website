import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
const m=await currentSiteFixtureHandlers(),store=await databaseFixture({d1:true}),db=store.db,owners=new Map(),scopes=new Map(),scope=user=>scopes.get(user);
async function owner(user=crypto.randomUUID()){if(!owners.has(user)){const authority=await workspaceFixture(db,m,user);owners.set(user,authority);scopes.set(user,await authority.scope());}return user;}
const {prepareBackendPublication:prepare,confirmBackendPublication:confirm,readBackendPublication:read,readBackendPublicationReview:review,publicBackend}=m.backendPublication,{saveBackend,testBackend}=m.backend,{backendChatCommand,backendAction}=m.backendChat,host=m.host;
const id=()=>crypto.randomUUID(),now=()=>new Date().toISOString();let calls=0;
const service={fetch:async(url,init)=>{calls++;assert.deepEqual(Object.keys(init.headers),['content-type']);const body=JSON.parse(init.body);assert.deepEqual(Object.keys(body),['version','source','input']);return Response.json({ok:true,value:body.input});}};
async function account(user=id()){const project=id();await owner(user);await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Public function','','draft',?,?)").bind(project,user,now(),now()).run();return {user,project};}
async function version(a){const v=id(),r=id();await saveBackend(scope(a.user),a.user,a.project,v,'export default input=>input');await testBackend(scope(a.user),service,a.user,a.project,v,r,42);return {v,r};}
async function publish(a,v){const rid=id();await prepare(scope(a.user),a.user,a.project,rid,'publish',v.v,v.r);await confirm(scope(a.user),a.user,rid);return rid;}
const request=(input={hello:'visitor'},extra={})=>new Request('https://00000000-0000-0000-0000-000000000000.whumpo.site/backend',{method:'POST',headers:{'content-type':'application/json',cookie:'secret=session',authorization:'Bearer platform-secret'},body:JSON.stringify(input),...extra});
const call=(a,input,env=db)=>publicBackend(request(input),env,service,a.project);
try{
 const a=await account(),b=await account(),v=await version(a),vb=await version(b);calls=0;
 assert.equal((await call(a,{})).status,404);
 const rid=id();await prepare(scope(a.user),a.user,a.project,rid,'publish',v.v,v.r);assert.equal((await call(a,{})).status,404);
 await assert.rejects(prepare(scope(b.user),b.user,a.project,id(),'publish',v.v,v.r),e=>e.status===404);
 await assert.rejects(prepare(scope(a.user),a.user,a.project,id(),'publish',v.v,vb.r),e=>e.status===409);
 await assert.rejects(review(scope(b.user),b.user,rid),e=>e.status===404);
 const competing=id();await prepare(scope(a.user),a.user,a.project,competing,'publish',v.v,v.r);
 const confirmed=await confirm(scope(a.user),a.user,rid);assert.equal(confirmed.status,'applied');
 await assert.rejects(confirm(scope(a.user),a.user,competing),e=>e.status===409);
 assert.equal((await read(scope(a.user),a.user,a.project)).revision,1);
 const status=await db.prepare('SELECT service_status,site_live,backend_live FROM project_service_status WHERE id=?').bind(a.project).first();assert.deepEqual(status,{service_status:'live',site_live:0,backend_live:1});
 const expired=id();await db.prepare("INSERT INTO backend_publication_reviews(id,user_id,project_id,operation,version_id,run_id,base_revision,expires_at) VALUES(?,?,?,'publish',?,?,1,'2000-01-01T00:00:00.000Z')").bind(expired,a.user,a.project,v.v,v.r).run();await assert.rejects(confirm(scope(a.user),a.user,expired),e=>e.status===409);
 const failed=id();await testBackend(scope(a.user),{fetch:()=>Response.json({ok:false,error:'execution_failed'},{status:422})},a.user,a.project,v.v,failed,{});await assert.rejects(prepare(scope(a.user),a.user,a.project,id(),'publish',v.v,failed),e=>e.status===409);
 assert.deepEqual(await (await call(a,{hello:'visitor'})).json(),{ok:true,value:{hello:'visitor'}});assert.equal(calls,1);
 const routed=await host.fetch(new Request(`https://${a.project}.whumpo.site/backend`,{method:'POST',headers:{'content-type':'application/json'},body:'42'}),{DB:db,BACKEND_RUNTIME:service});assert.equal(routed.status,200);assert.deepEqual(await routed.json(),{ok:true,value:42});
 const invalid=[request({}, {method:'GET',body:undefined}),request({}, {headers:{'content-type':'text/plain'}}),request({}, {body:'not JSON'}),request({}, {body:'"'+'x'.repeat(8192)+'"'})];
 for(const [i,req] of invalid.entries())assert.equal((await publicBackend(req,db,service,a.project)).status,[405,415,400,413][i]);
 const preflight=await publicBackend(request({}, {method:'OPTIONS',body:undefined}),db,service,a.project);assert.equal(preflight.status,204);assert.equal(preflight.headers.get('access-control-allow-credentials'),null);
 const ownershipRace=new Proxy(db,{get(target,key){if(key==='prepare')return sql=>{const stmt=target.prepare(sql);if(!sql.startsWith('INSERT INTO backend_public_usage'))return stmt;return {bind(...args){const bound=stmt.bind(...args);return {async run(){await db.prepare('UPDATE projects SET owner_user_id=? WHERE id=?').bind(b.user,a.project).run();return bound.run();}};}};};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 const beforeRace=calls;assert.equal((await call(a,{},ownershipRace)).status,429);assert.equal(calls,beforeRace);await db.prepare('UPDATE projects SET owner_user_id=? WHERE id=?').bind(a.user,a.project).run();
 const before=calls;const lossy=new Proxy(db,{get(target,key){if(key==='prepare')return sql=>{const stmt=target.prepare(sql);if(!sql.startsWith('INSERT INTO backend_public_usage'))return stmt;return {bind(...args){const bound=stmt.bind(...args);return {async run(){await bound.run();throw Error('lost acknowledgment');}};}};};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 assert.equal((await call(a,{},lossy)).status,429);assert.equal(calls,before);assert.equal((await db.prepare('SELECT calls FROM backend_public_usage WHERE project_id=?').bind(a.project).first()).calls,3);
 const batch=await Promise.all(Array.from({length:105},()=>call(a,{})));assert.equal(batch.filter(r=>r.status===200).length,97);assert.equal(batch.filter(r=>r.status===429).length,8);
 assert.equal((await db.prepare('SELECT calls FROM backend_public_usage WHERE project_id=?').bind(a.project).first()).calls,100);
 const off=id();await prepare(scope(a.user),a.user,a.project,off,'unpublish',v.v,null);await confirm(scope(a.user),a.user,off);assert.equal((await call(a,{})).status,404);assert.equal((await db.prepare('SELECT service_status FROM project_service_status WHERE id=?').bind(a.project).first()).service_status,'draft');
 await confirm(scope(a.user),a.user,rid);assert.equal((await call(a,{})).status,404);assert.equal((await read(scope(a.user),a.user,a.project)).revision,2);
 const republish=await publish(a,v);await confirm(scope(a.user),a.user,off);assert.equal((await read(scope(a.user),a.user,a.project)).reviewId,republish);assert.equal((await call(a,{})).status,429,'Republishing cannot reset public quota');
 // Account and platform ceilings span independently published projects.
 for(let i=0;i<4;i++){const p=await account(a.user),pv=await version(p);await publish(p,pv);assert.ok((await Promise.all(Array.from({length:100},()=>call(p,{})))).every(r=>r.status===200));}
 const extra=await account(a.user),extraV=await version(extra);await publish(extra,extraV);assert.equal((await call(extra,{})).status,429);
 for(let i=0;i<5;i++){const p=await account(b.user),pv=await version(p);await publish(p,pv);assert.ok((await Promise.all(Array.from({length:100},()=>call(p,{})))).every(r=>r.status===200));}
 const c=await account(),cv=await version(c);await publish(c,cv);assert.equal((await call(c,{})).status,429);
 const guided=await backendChatCommand(scope(a.user),a.user,id(),`/backend-publication ${a.project}`)();assert.ok(guided.includes(republish));
 const reviewText=await backendChatCommand(scope(a.user),a.user,id(),`/backend-publication-review ${republish}`)();assert.ok(reviewText.includes('Source (untrusted code)'));assert.ok(reviewText.includes('Anyone can POST JSON'));
 await assert.rejects(backendAction(scope(a.user),a.user,id(),{kind:'backend',operation:'confirmPublication',reviewId:republish}),e=>e.status===400);
 console.log('Public backend checks passed: exact tested reviews, ownership, stale confirmation, route/CORS/input boundaries, dispatch-after-reservation, concurrent project/account/global quotas, withdrawal and replay safety.');
}finally{await store.close();}
