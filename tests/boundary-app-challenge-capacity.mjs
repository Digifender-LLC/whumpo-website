// WH-004 finding B5 (fixed in the WH-170/WH-201 schema change): anonymous `POST /apps/:project/auth/login/options` stores a 5-minute
// challenge per call. The schema now caps live challenges at 5 per (project, client hash) on top of the 50-per-project and 1,000-platform
// caps, and a full table is a typed 429 instead of a generic 503. Local SQLite fixture, synthetic accounts; no network or provider.
// Exits 0 when one client is refused with 429 after five starts while another client (and another project) can still start sign-in.
import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers,enableFixtureVisitorAccess} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';

const m=await currentSiteFixtureHandlers(),store=await databaseFixture(),db=store.db;
const {appAuth:auth}=m,{saveBackend,testBackend}=m.backend,{prepareApplication,confirmApplication}=m.appActivation;
const id=()=>crypto.randomUUID(),now=()=>new Date().toISOString();
async function app(){
 const authority=await workspaceFixture(db,m),user=authority.account,project=id(),version=id(),test=id(),scope=await authority.scope();
 await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Challenge capacity fixture','','draft',?,?)").bind(project,user,now(),now()).run();
 await saveBackend(scope,user,project,version,'export default ({state,input})=>({state:input,result:state})');
 await testBackend(scope,{fetch:()=>Response.json({ok:true,value:{state:{},result:{}}})},user,project,version,test,{state:{},input:{}});
 await enableFixtureVisitorAccess(scope,user,project);
 const review=id();await prepareApplication(scope,user,project,review,'enable',version,test);await confirmApplication(scope,user,review);
 return project;
}
// Exactly what the gateway calls for an anonymous login/options request (no invitation, no session), with the connecting address.
const login=(project,client)=>auth.appPasskeyOptions(db,project,'login',false,'',client);
const refused=async(promise)=>assert.rejects(promise,e=>e?.status===429&&/Try again/.test(e.message)&&!/app_challenge/.test(e.message));
const count=async(sql,...p)=>(await db.prepare(sql).bind(...p).first()).n;
try{
 const victim=await app();
 // One client: five live challenges, then a typed 429; its refusal stores nothing.
 for(let n=0;n<5;n++)await login(victim,'203.0.113.1');
 await refused(login(victim,'203.0.113.1'));
 assert.equal(await count('SELECT count(*) n FROM app_auth_challenges WHERE project_id=?',victim),5);
 // A different client can still start a login for the same project, and the same client for another project.
 await login(victim,'203.0.113.2');
 const other=await app();await login(other,'203.0.113.1');
 // Only a hash of the address is stored.
 const rows=(await db.prepare('SELECT client_hash FROM app_auth_challenges').all()).results;
 assert.ok(rows.every(r=>/^[0-9a-f]{64}$/.test(r.client_hash)));assert.ok(!JSON.stringify(rows).includes('203.0.113'));
 // Ten clients fill the project cap of 50: the next client gets the typed 429, and another project is unaffected.
 for(let c=3;c<=10;c++)for(let n=0;n<5;n++)await login(victim,'203.0.113.'+c);
 for(let n=0;n<4;n++)await login(victim,'203.0.113.11');
 assert.equal(await count('SELECT count(*) n FROM app_auth_challenges WHERE project_id=?',victim),50);
 await refused(login(victim,'203.0.113.200'));
 await login(other,'203.0.113.3');
 // Twenty projects of fifty fill the platform cap through many clients; a bystander project then gets the typed 429, never a 503.
 for(let p=0;p<20;p++){const target=await app();for(let c=0;c<10;c++)for(let n=0;n<5;n++){try{await login(target,'198.51.100.'+c);}catch(e){assert.equal(e.status,429);}}}
 assert.equal(await count('SELECT count(*) n FROM app_auth_challenges'),1000);
 await refused(login(await app(),'192.0.2.9'));
}finally{await store.close?.();}
console.log('Anonymous login starts cannot exhaust visitor sign-in: one client is capped at five live challenges per project with a typed 429, other clients and projects still start sign-in, and the project and platform caps return the same typed 429.');
