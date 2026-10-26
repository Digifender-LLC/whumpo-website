// WH-004 slice: the public stateless backend refuses to execute stored source whose digest no longer matches, through
// the sites Worker's real default export. Local SQLite (default) or local D1 (`--d1`); synthetic accounts, no network
// (the runtime binding is a counting stub; global fetch throws).
// Closes the evidence gap recorded at docs/boundary-audit.json (site-backend, target: "Immutable source digest-checked at
// serve time (the 503 branch is untested)"). The stored source is changed by temporarily lifting the immutability
// trigger, standing in for storage corruption or an out-of-band write that bypassed it. A mismatched digest (and a
// missing runtime binding, the other half of the same check) returns 503 before any dispatch or admission charge.
// Every refusal has a negative control in which only the property under test differs.
import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';

const m=await currentSiteFixtureHandlers(),{host}=m,store=await databaseFixture(),db=store.db,scopes=new Map(),scope=u=>scopes.get(u);
const {prepareBackendPublication:prepare,confirmBackendPublication:confirm}=m.backendPublication,{saveBackend,testBackend}=m.backend;
const id=()=>crypto.randomUUID(),now=()=>new Date().toISOString();let calls=0,checks=0;
const runtime={fetch:async(_url,init)=>{calls++;return Response.json({ok:true,value:JSON.parse(init.body).input});}};
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('No network is allowed');};
const original='export default input=>input',tampered='export default input=>({leaked:input})';
// The exact trigger from schema/platform.sql, recreated after the out-of-band write.
const immutable="CREATE TRIGGER backend_versions_immutable BEFORE UPDATE ON backend_versions BEGIN SELECT RAISE(ABORT,'backend_immutable'); END;";
async function rewrite(version,source){
 await db.prepare('DROP TRIGGER backend_versions_immutable').run();
 try{await db.prepare('UPDATE backend_versions SET source=? WHERE id=?').bind(source,version).run();}
 finally{await db.prepare(immutable).run();}
}
let ip=0;
const post=(project,path='',env={DB:db,BACKEND_RUNTIME:runtime})=>host.fetch(new Request(`https://${project}.whumpo.site/backend${path}`,{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':'198.18.7.'+(++ip)},body:'{"hello":"visitor"}'}),env);
const charged=async project=>({
 calls:(await db.prepare('SELECT coalesce(sum(calls),0) AS n FROM backend_public_usage WHERE project_id=?').bind(project).first()).n,
 clients:(await db.prepare("SELECT coalesce(sum(uses),0) AS n FROM public_client_usage WHERE scope='backend' AND project_id=?").bind(project).first()).n,
});
async function refused(response,label){
 assert.equal(response.status,503,label);assert.equal(response.headers.get('cache-control'),'no-store',label);
 assert.deepEqual(await response.json(),{ok:false,error:'unavailable'},label);checks++;
}

try{
 const authority=await workspaceFixture(db,m),user=authority.account;scopes.set(user,await authority.scope());
 const project=id(),version=id(),run=id(),review=id();
 await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Public function','','draft',?,?)").bind(project,user,now(),now()).run();
 await saveBackend(scope(user),user,project,version,original);await testBackend(scope(user),runtime,user,project,version,run,42);
 await prepare(scope(user),user,project,review,'publish',version,run);assert.equal((await confirm(scope(user),user,review)).status,'applied');

 // Negative control: the intact publication executes and is charged once per call.
 calls=0;let before=await charged(project);
 const served=await post(project);assert.equal(served.status,200);assert.deepEqual(await served.json(),{ok:true,value:{hello:'visitor'}});
 assert.equal(calls,1);let after=await charged(project);assert.deepEqual(after,{calls:before.calls+1,clients:before.clients+1});checks++;

 // Missing runtime binding: same check, refused before admission.
 before=after;await refused(await post(project,'',{DB:db}),'no runtime binding');
 assert.equal(calls,1);assert.deepEqual(await charged(project),before,'no admission is charged without a runtime');checks++;

 // Digest mismatch: the stored source no longer hashes to the published digest.
 await rewrite(version,tampered);
 const row=await db.prepare('SELECT source,digest FROM backend_versions WHERE id=?').bind(version).first();
 assert.equal(row.source,tampered,'the out-of-band write landed');
 await assert.rejects(db.prepare('UPDATE backend_versions SET source=? WHERE id=?').bind(original,version).run(),/backend_immutable/);checks++;
 for(const path of ['','/'+review]){
  await refused(await post(project,path),'tampered source on /backend'+(path?'/<publication>':''));
 }
 assert.equal(calls,1,'the tampered source never reached the runtime');
 assert.deepEqual(await charged(project),before,'a refused call charges neither the project nor the client allowance');checks++;
 const kept=await db.prepare('SELECT review_id FROM backend_publications WHERE project_id=?').bind(project).first();
 assert.equal(kept.review_id,review,'the refusal leaves the publication itself in place');checks++;

 // Negative control: restoring the original bytes (digest unchanged) serves again.
 await rewrite(version,original);
 const restored=await post(project,'/'+review);assert.equal(restored.status,200);assert.deepEqual(await restored.json(),{ok:true,value:{hello:'visitor'}});
 assert.equal(calls,2);assert.deepEqual(await charged(project),{calls:before.calls+1,clients:before.clients+1});checks++;

 console.log(`Boundary backend digest passed on ${process.argv.includes('--d1')?'local D1':'SQLite'}: ${checks} checks — a published backend whose stored source no longer matches its digest (and a host without the runtime binding) returns no-store 503 unavailable on /backend and the pinned publication path, without dispatching to the runtime or charging project or client admission; the intact and restored source serve 200. Synthetic, local only; no deployed Worker.`);
}finally{globalThis.fetch=originalFetch;await store.close?.();}
