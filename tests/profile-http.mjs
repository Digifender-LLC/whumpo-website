// In-process: connected platform handler and disposable D1; no server and no port. Accounts are passkey-only,
// so the former password-replacement steps no longer exist; session revocation covers the old-session case.
import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
const m=await currentSiteFixtureHandlers(),store=await databaseFixture({d1:true,r2:true}),db=store.db,base='http://localhost:8793';
try{
const env={...store.env,ENVIRONMENT:'local',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})}};
async function call(path,method='GET',data,cookie='',origin=base){const pending=[];const r=await m.worker.fetch(new Request(base+'/api'+path,{method,headers:{origin,cookie,'content-type':'application/json'},body:data?JSON.stringify(data):undefined}),env,{waitUntil:t=>pending.push(t)});await Promise.all(pending);return {status:r.status,data:await r.json()};}
const owner=await workspaceFixture(db,m),cookie='__Host-whumpo_session='+owner.token;
assert.equal((await call('/profile')).status,401);
assert.equal((await call('/profile','PATCH',{revision:0,name:'Synthetic'},cookie,'https://untrusted.example')).status,403);
const profile=await call('/profile','PATCH',{revision:0,name:'Synthetic',about_me:'Local test',share_context:false,theme:'dark'},cookie);assert.equal(profile.status,200,JSON.stringify(profile.data));assert.equal(profile.data.theme,'dark');
const read=await call('/profile','GET',undefined,cookie);assert.equal(read.status,200);assert.equal(read.data.name,'Synthetic');assert.equal(read.data.theme,'dark');
await owner.revoke();assert.equal((await call('/profile','GET',undefined,cookie)).status,401);
console.log('Profile HTTP passed: private reads, origin rejection, saved preferences and revoked-session refusal.');
}finally{await store.close?.();}
