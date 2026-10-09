// WH-004 finding B5 reproduction (local SQLite fixture, synthetic accounts; no network or provider).
// Anonymous `POST /apps/:project/auth/login/options` stores one 5-minute challenge per call. The schema caps
// app_auth_challenges at 50 per project and 1,000 platform-wide, and nothing but expiry removes an unused row.
// Per-IP AUTH_LIMITER allows 10 per minute, so one client sustains 50 live rows (10/min x 5 min) for one project,
// and 20 clients fill the platform cap. Expected: a legitimate visitor of another project can still start sign-in.
// Exits 1 while the defect reproduces. Deliberately not in package.json scripts or any tools/verify.mjs profile.
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
// Exactly what the gateway calls for an anonymous login/options request (no invitation, no session).
const login=project=>auth.appPasskeyOptions(db,project,'login',false,'');
const count=async(sql,...p)=>(await db.prepare(sql).bind(...p).first()).n;
let reproduced=[];
try{
 // One anonymous client, one project: 50 unanswered login starts within five minutes.
 const victim=await app();
 for(let n=0;n<50;n++)await login(victim);
 assert.equal(await count('SELECT count(*) n FROM app_auth_challenges WHERE project_id=?',victim),50);
 try{await login(victim);}catch(error){reproduced.push(`project ${victim.slice(0,8)}: a visitor's login start fails after 50 anonymous starts (${String(error?.message??error).slice(0,80)})`);}
 // Twenty anonymous clients (one per project they target) fill the platform-wide table.
 for(let p=1;p<20;p++){const target=await app();for(let n=0;n<50;n++)await login(target);}
 assert.equal(await count('SELECT count(*) n FROM app_auth_challenges'),1000);
 const bystander=await app();
 assert.equal(await count('SELECT count(*) n FROM app_auth_challenges WHERE project_id=?',bystander),0);
 try{await login(bystander);}catch(error){reproduced.push(`unrelated project ${bystander.slice(0,8)}: its first login start fails once 1,000 anonymous challenges exist platform-wide (${String(error?.message??error).slice(0,80)})`);}
}finally{await store.close?.();}
if(reproduced.length){console.error('B5 reproduced:\n- '+reproduced.join('\n- '));process.exit(1);}
console.log('Anonymous login starts cannot exhaust visitor sign-in for a project or for other tenants.');
