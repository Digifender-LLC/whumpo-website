import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
const m=await currentSiteFixtureHandlers(),store=await databaseFixture(),db=store.db;
const {worker,agentProfile,readProfile,updateProfile}=m;
try{
 const a=await workspaceFixture(db,m),b=await workspaceFixture(db,m),owner=a.account,other=b.account,token=a.token,admitted=await a.scope(),foreign=await b.scope();
 assert.equal((await readProfile(admitted,owner)).accountId,owner);assert.equal((await readProfile(foreign,other)).accountId,other);
 await assert.rejects(updateProfile(admitted,owner,{revision:0,accountId:other}),/Invalid profile fields/);
 await updateProfile(admitted,owner,{revision:0,name:'River',about_me:'Garden services',share_context:true});assert.deepEqual({...await agentProfile(admitted,owner)},{name:'River',about_me:'Garden services'});
 const request=cookie=>new Request('https://whumpo.com/api/profile',{headers:cookie?{cookie:'__Host-whumpo_session='+cookie}: {}}),env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})}},ctx={waitUntil(){}};
 assert.equal((await worker.fetch(request(''),env,ctx)).status,401);
 const response=await worker.fetch(request(token),env,ctx);assert.equal(response.status,200);const profile=await response.json();assert.equal(profile.accountId,owner);assert.notEqual(profile.accountId,other);
 await a.revoke();assert.equal((await worker.fetch(request(token),env,ctx)).status,401);
 console.log('Recovery account identity passed: current owner cookie, distinct accounts, client mutation refused, identity excluded from opted-in agent profile and revoked-session refusal. Complete-schema disposable fixture; no media/provider calls.');
}finally{await store.close();}
