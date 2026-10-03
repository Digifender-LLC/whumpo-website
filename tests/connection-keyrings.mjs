import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';
import {fixtureKeyring} from './helpers/connection-keyring.mjs';

const built=await build({stdin:{contents:"export * from './src/github-connection';export * from './src/cloudflare-connection';export * from './src/connection-vault';export * from './src/connection-rotation';export * from './src/workspace-identity/admission';export * from './src/workspace-identity/authority';export * from './src/security';export {default as worker} from './src/index';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const first=fixtureKeyring('ab'.repeat(32),'key-a'),next=fixtureKeyring('cd'.repeat(32),'key-b',[{id:'key-a',secret:'ab'.repeat(32)}]);
const fixture=await databaseFixture(),db=fixture.db,originalFetch=globalThis.fetch;
let unsolicited=0;
globalThis.fetch=async()=>{unsolicited++;throw Error('No real provider transport is allowed');};
try{
 await m.initializeConnectionKeys(db,first,'key-review');
 const started=new Map();
 for(const provider of ['github','cloudflare']){
  const owner=await workspaceFixture(db,m),scope=await owner.scope();await paidPlan(db,owner.account,'business');
  const config={clientId:'fixture',clientSecret:'synthetic',...(provider==='github'?{appId:123,slug:'fixture'}:{}),key:first};
  const begun=await (provider==='github'?m.startGitHub:m.startCloudflare)(scope,owner.account,config);
  started.set(provider,{owner,scope,state:new URL(begun.url).searchParams.get('state')});
 }
 await m.registerConnectionKeys(db,next,'key-review-b');
 const racingOwner=await workspaceFixture(db,m);await paidPlan(db,racingOwner.account,'business');let activated=false;
 const racingDB=interceptDatabase(db,/INSERT INTO github_oauth_states/,async()=>{if(!activated){activated=true;await m.beginConnectionRotation(db,next,{id:'keyring-rotation',reviewId:'key-review-b',expectedRevision:1});}});
 const racingResponse=await m.worker.fetch(new Request('https://whumpo.com/api/connections/github/start',{method:'POST',body:JSON.stringify({handoff:null}),headers:{'content-type':'application/json',origin:'https://whumpo.com',cookie:'__Host-whumpo_session='+racingOwner.token}}),{DB:racingDB,ENVIRONMENT:'local',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})},GITHUB_CLIENT_ID:'fixture',GITHUB_CLIENT_SECRET:'synthetic',GITHUB_APP_ID:'123',GITHUB_APP_SLUG:'fixture',CONNECTION_ENCRYPTION_KEYRING:first});
 assert.equal(racingResponse.status,503);const rejected=await racingResponse.text();assert.match(rejected,/Platform recovery is required/);assert.doesNotMatch(rejected,/key-a|key-b|wv2|SQLITE|abababab/);assert.equal(activated,true);

 for(const provider of ['github','cloudflare']){
  const {owner,scope,state}=started.get(provider);
  const base={clientId:'fixture',clientSecret:'synthetic',...(provider==='github'?{appId:123,slug:'fixture'}:{})},a={...base,key:first},b={...base,key:next};
  const methods=provider==='github'?[m.startGitHub,m.finishGitHub,m.disconnectGitHub,m.cleanupGitHub]:[m.startCloudflare,m.finishCloudflare,m.disconnectCloudflare,m.cleanupCloudflare];
  const [start,finish,disconnect,cleanup]=methods;
  let dispatches=0,revoked=0;
  const transport=async(url,init)=>{
   dispatches++;
   if(url==='https://github.com/login/oauth/access_token')return Response.json({access_token:'ghu_synthetic_keyring',expires_in:3600});
   if(url==='https://api.github.com/user')return Response.json({id:123,login:'fixture'});
   if(url==='https://dash.cloudflare.com/oauth2/token')return Response.json({access_token:'cf_synthetic_keyring',expires_in:3600,token_type:'bearer'});
   if(url==='https://api.github.com/applications/fixture/token'){assert.equal(JSON.parse(init.body).access_token,'ghu_synthetic_keyring');revoked++;return new Response(null,{status:204});}
   if(url==='https://dash.cloudflare.com/oauth2/revoke'){assert.equal(init.body.get('token'),'cf_synthetic_keyring');revoked++;return new Response(null,{status:200});}
   throw Error('Unexpected synthetic provider operation');
  };
  // OAuth starts with A; its exact PKCE record remains readable after B becomes
  // the configured write key, while the newly staged token is encrypted by B.
  await assert.rejects(start(scope,owner.account,a),error=>error instanceof m.ConnectionVaultError&&error.code==='write-key');
  const flow=await db.prepare(`SELECT verifier_ciphertext FROM ${provider}_oauth_states WHERE user_id=?`).bind(owner.account).first();
  assert.equal(m.connectionCiphertextKeyId(flow.verifier_ciphertext),'key-a');
  await finish(scope,owner.account,state,'synthetic-code',b,transport);
  const row=await db.prepare(`SELECT id,ciphertext,state FROM ${provider}_token_vault WHERE user_id=?`).bind(owner.account).first();
  assert.equal(row.state,'active');assert.equal(m.connectionCiphertextKeyId(row.ciphertext),'key-b');
  const count=dispatches;
  const read=provider==='github'?()=>m.githubInstallations(scope,owner.account,a,transport):()=>m.cloudflareZones(scope,owner.account,a,1,transport);
  await assert.rejects(read(),error=>error instanceof m.ConnectionVaultError&&error.code==='missing-key');assert.equal(dispatches,count);

  // The actual HTTP boundary exposes a bounded unavailable response without
  // logging a raw cryptographic exception or sending any provider request.
  const env={DB:db,ENVIRONMENT:'local',API_LIMITER:{limit:async()=>({success:true})},
   GITHUB_CLIENT_ID:base.clientId,GITHUB_CLIENT_SECRET:base.clientSecret,GITHUB_APP_ID:'123',GITHUB_APP_SLUG:'fixture',
   CLOUDFLARE_CLIENT_ID:base.clientId,CLOUDFLARE_CLIENT_SECRET:base.clientSecret,CONNECTION_ENCRYPTION_KEYRING:first};
  const path=provider==='github'?'github/installations':'cloudflare/zones';
  const response=await m.worker.fetch(new Request('https://whumpo.com/api/connections/'+path,{headers:{origin:'https://whumpo.com',cookie:'__Host-whumpo_session='+owner.token}}),env);
  assert.equal(response.status,503);const text=await response.text();assert.match(text,/Platform recovery is required/);assert.doesNotMatch(text,/synthetic_keyring|key-a|key-b|wv2|abababab|cdcdcdcd/);
  assert.equal(unsolicited,0);

  // A missing key cannot be reported as successful revocation or erase the
  // retained encrypted obligation. The exact correct key can finish it later.
  await disconnect(scope,owner.account,a,transport);
  assert.equal(dispatches,count);assert.equal(revoked,0);
  const retained=await db.prepare(`SELECT ciphertext,state FROM ${provider}_token_vault WHERE id=?`).bind(row.id).first();
  assert.deepEqual({...retained},{ciphertext:row.ciphertext,state:'revoking'});
  if(provider==='github')await db.prepare("UPDATE github_revocation_claims SET expires_at='2000-01-01T00:00:00.000Z' WHERE token_id=?").bind(row.id).run();
  else await db.prepare("UPDATE cloudflare_token_vault SET revoke_after='2000-01-01T00:00:00.000Z' WHERE id=?").bind(row.id).run();
  await cleanup(db,b,transport,owner.account);assert.equal(revoked,1);
  assert.equal(await db.prepare(`SELECT id FROM ${provider}_token_vault WHERE id=?`).bind(row.id).first(),null);
  console.log(provider+': retained-key PKCE/current-key token, missing-key provider refusal and HTTP 503, retained revocation custody and exact-key cleanup passed.');
 }
 await m.rotateConnectionBatch(db,next,'keyring-rotation','keyring-final');
 assert.equal((await m.connectionRotationStatus(db,'keyring-rotation')).state,'complete');
 assert.equal(unsolicited,0);
}finally{globalThis.fetch=originalFetch;await fixture.close();}
