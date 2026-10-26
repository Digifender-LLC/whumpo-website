// Connected current-schema HTTP smoke. Real signed WebAuthn is exercised first
// by test:smoke; these ready-account rows isolate workspace and quota checks.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,completeWelcome} from './helpers/workspace-identity.mjs';
const built=await build({stdin:{resolveDir:process.cwd(),contents:"export {default as worker} from './src/index';export {hashToken,newSessionToken} from './src/security';export {admitWorkspace} from './src/workspace-identity/admission';export {resolveIdentity} from './src/workspace-identity/authority';"},bundle:true,format:'esm',platform:'node',write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const fixture=await databaseFixture({d1:true}),db=fixture.db;
const base='https://whumpo.com',env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}},ctx={waitUntil(){throw Error('Smoke must not dispatch background work')}};
const call=(owner,path,body,origin=base)=>m.worker.fetch(new Request(base+path,{method:body===undefined?'GET':'POST',headers:{origin,'content-type':'application/json',...(owner?{cookie:'__Host-whumpo_session='+owner.token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})}),env,ctx);
try{
 assert.equal((await call(null,'/api/health')).status,200);
 const owner=await workspaceFixture(db,m),other=await workspaceFixture(db,m);
 assert.equal((await call(owner,'/api/chat')).status,409,'First-project welcome gates the workspace');
 await completeWelcome(db,owner.account);
 const created=await call(owner,'/api/projects',{name:'Private site',purpose:'Tenant isolation check'});
 assert.equal(created.status,201,await created.clone().text());const {project}=await created.json();
 assert.equal((await call(owner,'/api/projects/'+project.id)).status,200);
 assert.equal((await call(other,'/api/projects/'+project.id)).status,404);
 assert.equal((await call(null,'/api/projects/'+project.id)).status,401);
 assert.equal((await call(owner,'/api/projects',{name:'Rejected'},'https://invalid.example')).status,403);
 const activity=await call(owner,'/api/activity');assert.equal(activity.status,200);
 assert.ok((await activity.json()).activity.some(e=>e.action==='project.created'));
 const batch=await Promise.all(Array.from({length:22},(_,index)=>call(owner,'/api/projects',{name:`Quota ${index}`})));
 assert.equal(batch.filter(r=>r.status===201).length,18);assert.equal(batch.filter(r=>r.status===409).length,4);
 assert.equal((await db.prepare('SELECT count(*) n FROM projects WHERE owner_user_id=?').bind(owner.account).first()).n,20);
 assert.equal((await db.prepare("SELECT count(*) n FROM activity_events WHERE user_id=? AND action='project.created'").bind(owner.account).first()).n,20,'Rejected project batches leave no activity receipt');
 const logout=await call(owner,'/api/auth/identity/v1/logout',{version:1});assert.equal(logout.status,200);
 const cleared=logout.headers.getSetCookie().find(c=>c.startsWith('__Host-whumpo_session=;'));
 assert.ok(cleared?.includes('Path=/; Secure; HttpOnly; SameSite=Lax'));
 assert.equal(new Date(cleared.match(/Expires=([^;]+)/)[1]).getTime(),0,'Logout expires the current cookie');
 assert.equal((await call(owner,'/api/me')).status,401);assert.equal((await call(owner,'/api/projects',{name:'After logout'})).status,401);
 assert.equal((await call(other,'/api/me')).status,200);
 for(const path of ['login','register','recover'])assert.equal((await call(null,'/api/auth/'+path,{})).status,404);
 assert.equal((await db.prepare('SELECT count(*) n FROM inference_calls').first()).n,0);
 console.log('Current HTTP smoke passed: health, welcome gate, two-owner isolation, Origin, activity, atomic concurrent quota, current logout and retired-route refusal. Disposable local D1; synthetic ready accounts; no inference or external provider calls.');
}finally{await fixture.close();}
