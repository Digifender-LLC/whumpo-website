import {fixtureKeyring} from './helpers/connection-keyring.mjs';
import assert from 'node:assert/strict';
import {setTimeout} from 'node:timers/promises';
import {currentSiteFixtureHandlers,createFixtureProject} from './current-site-fixture.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';
const m=await currentSiteFixtureHandlers(),modules=await currentFixtureModules(['src/feature-preview-grants.ts']);
const {issueFeaturePreviewGrant}=await modules.module('src/feature-preview-grants.ts');
const fixture=await databaseFixture(),{db}=fixture,base='https://whumpo.com';
const env={DB:db,ENVIRONMENT:'local',API_LIMITER:{limit:async()=>({success:true})},
 GITHUB_CLIENT_ID:'fixture',GITHUB_CLIENT_SECRET:'synthetic',GITHUB_APP_ID:'1',GITHUB_APP_SLUG:'fixture',
 CLOUDFLARE_CLIENT_ID:'fixture',CLOUDFLARE_CLIENT_SECRET:'synthetic',CONNECTION_ENCRYPTION_KEYRING:fixtureKeyring('a'.repeat(64))};
const originalFetch=globalThis.fetch;let transports=0;
globalThis.fetch=async()=>{transports++;throw Error('No provider or inference transport is allowed');};
const call=(actor,path,method='GET')=>m.worker.fetch(new Request(base+'/api'+path,{method,headers:{origin:base,cookie:'__Host-whumpo_session='+actor.token}}),env);
async function ok(response){assert.equal(response.status,200,await response.clone().text());return response;}
try{
 for(const funding of ['invoice','preview']){
  const actor=await workspaceFixture(db,m),other=await workspaceFixture(db,m),scope=await actor.scope();
  const site=await createFixtureProject(scope,actor.account,'Landscaping fixture','A harmless landscaping website');
  const send=async content=>{const id=crypto.randomUUID(),revision=(await m.readChat(scope,actor.account)).state.revision;assert.equal((await m.sendChat(scope,actor.account,{id,revision,content})).status,200);return id;};
  await send('/confirm '+await send('/publish '+site.version));
  const served=()=>m.host.fetch(new Request('https://'+site.project+'.whumpo.site/'),{DB:db});
  const beforeSite=await(await ok(await served())).text();
  const exportPath='/site-versions/'+site.version+'/export';
  const beforeExport=Buffer.from(await(await ok(await call(actor,exportPath))).arrayBuffer());
  const start=Math.floor(Date.now()/1000)-1,end=start+7;
  if(funding==='invoice')await paidPlan(db,actor.account,'business',{start,end});
  else for(const provider of ['github','cloudflare'])await issueFeaturePreviewGrant(db,{
   id:crypto.randomUUID(),userId:actor.account,projectId:null,featureId:'connections.'+provider,operation:'connect',
   purpose:'private-test-acceptance',reviewReference:'https://github.com/zemdregon/whumpo/issues/65',startsAt:start,endsAt:end,
  },'local');
  const states={};
  for(const provider of ['github','cloudflare']){
   const result=await(await ok(await call(actor,'/connections/'+provider+'/start','POST'))).json();
   states[provider]=new URL(result.url).searchParams.get('state');assert.ok(states[provider]);
  }
  // Real service-interval expiry: no edited receipt, frozen clock or cached inclusion.
  await setTimeout(Math.max(0,end*1000-Date.now()+30));
  const status=await(await ok(await call(actor,'/connections'))).json();
  assert.equal((await m.getBilling(scope,actor.account)).plan.id,'explore');
  for(const provider of ['github','cloudflare']){
   assert.equal(status[provider].inclusion.connect,false);
   assert.equal((await call(actor,'/connections/'+provider+'/start','POST')).status,403);
   const callback=await call(actor,'/connections/'+provider+'/callback?state='+states[provider]+'&code=synthetic');
   assert.equal(callback.status,303);assert.match(callback.headers.get('location'),/connection_error=authorization/);
   await ok(await call(actor,'/connections/'+provider+'/disconnect','POST'));
  }
  assert.equal(await(await ok(await served())).text(),beforeSite);
  assert.deepEqual(Buffer.from(await(await ok(await call(actor,exportPath))).arrayBuffer()),beforeExport);
  assert.equal((await call(other,exportPath)).status,404);
  await ok(await call(actor,'/github/backups'));await ok(await call(actor,'/cloudflare/dns'));
  await actor.revoke();assert.equal((await call(actor,exportPath)).status,401);
  assert.equal(await(await ok(await served())).text(),beforeSite);
 }
 assert.equal(transports,0);assert.equal((await db.prepare('SELECT count(*) n FROM inference_calls').first()).n,0);
 assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 console.log(`Feature retention passed: real invoice and preview expiry refuse new OAuth and pending callbacks; published sites, exact source exports and local history survive; foreign/revoked owners remain denied (${process.argv.includes('--d1')?'local D1':'SQLite'}). No provider or inference calls.`);
}catch(error){console.error(String(error.stack||error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundled module>'));process.exitCode=1;}
finally{globalThis.fetch=originalFetch;await fixture.close();}
