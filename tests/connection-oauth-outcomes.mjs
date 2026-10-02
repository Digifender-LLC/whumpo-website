import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';
import {fixtureKeyring} from './helpers/connection-keyring.mjs';
Error.stackTraceLimit=0;
const built=await build({stdin:{contents:"export * from './src/github-connection';export * from './src/cloudflare-connection';export * from './src/connection-rotation';export * from './src/connection-oauth-response';export * from './src/workspace-identity/admission';export * from './src/workspace-identity/authority';export * from './src/security';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const fixture=await databaseFixture(),{db}=fixture,key=fixtureKeyring(),privateText='PRIVATE_PROVIDER_RESPONSE_CANARY';
const json=(value,status=200)=>Response.json(value,{status});
const rejectResponse=(provider,extra={})=>json({error:provider==='github'?'bad_verification_code':'invalid_grant',error_description:privateText,...extra},provider==='github'?200:400);
const raw=text=>new Response(text,{headers:{'content-type':'application/json'}});
let refusals=0,journeys=0;
async function refused(p){await assert.rejects(p,error=>{assert.ok(!String(error).includes(privateText));return true;});refusals++;}
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>assert.fail('Synthetic OAuth checks cannot contact providers');
try{
 await m.initializeConnectionKeys(db,key,'synthetic-outcome-review');
 for(const provider of ['github','cloudflare']){
  const reasons=provider==='github'?['incorrect_client_credentials','redirect_uri_mismatch','bad_verification_code','unverified_user_email']:['invalid_request','invalid_client','invalid_grant','unauthorized_client','unsupported_grant_type','invalid_scope'];
  for(const reason of reasons){const value=await m.readOAuthTokenResponse(provider,json({error:reason,error_description:privateText},provider==='github'?200:400));assert.equal(value.kind,'rejected');assert.equal(value.settlement.reason,reason);assert.ok(!JSON.stringify(value).includes(privateText));}
  for(const response of [rejectResponse(provider,{access_token:null}),rejectResponse(provider,{refresh_token:privateText}),rejectResponse(provider,{unknown:'value'}),json({error:'unknown_error'}),json({error:reasons[0]},503),json({error:reasons[0]},429),raw('{"error":"bad_verification_code","error":"bad_verification_code"}'),raw('{"error":"bad_verification_code","\\u0065rror":"bad_verification_code"}'),raw('{"error":"bad_verification_code",}'),raw('{"error":'+privateText),raw('x'.repeat(16385)),new Response('<html>error</html>'),new Response(null,{status:302})])await refused(m.readOAuthTokenResponse(provider,response));
  for(const body of [
   '{"access_token":"ghu_first","access_token":"ghu_second"}',
   '{"access_token":"ghu_synthetic","refresh_token":"ghr_first","refresh_token":"ghr_second"}',
   '{"access_token":"ghu_synthetic","refresh_token":"ghr_first","\\u0072efresh_token":"ghr_second"}',
  ])await refused(m.readOAuthTokenResponse(provider,raw(body)));
  const nested=await m.readOAuthTokenResponse(provider,raw('{"access_token":"synthetic","extra":{"refresh_token":"nested"},"note":"refresh_token: \\"quoted\\""}'));
  assert.equal(nested.kind,'token');
  for(const scenario of ['rejected','signed-out-rejected','lost-settlement-ack','settlement-rollback','unknown','mixed-response','revoked','revocation-failed',...(provider==='github'?['refresh-revocation-unproven']:[])]){
   const owner=await workspaceFixture(db,m),scope=await owner.scope();await paidPlan(db,owner.account,'business');
   const config={clientId:'synthetic-client',clientSecret:'synthetic-secret',appId:123,slug:'fixture',key};
   const [start,finish]=provider==='github'?[m.startGitHub,m.finishGitHub]:[m.startCloudflare,m.finishCloudflare];
   const begun=await start(scope,owner.account,config),state=new URL(begun.url).searchParams.get('state');
   let exchanges=0,revocations=0;
   const persistenceFailure=['revoked','revocation-failed','refresh-revocation-unproven'].includes(scenario);
   const database=persistenceFailure?await owner.scope(interceptDatabase(db,new RegExp('INSERT INTO '+provider+'_token_vault'),async()=>{throw Error('synthetic custody unavailable');})):
    scenario==='lost-settlement-ack'?await owner.scope(interceptDatabase(db,/INSERT INTO connection_oauth_outcomes/,async()=>{},async()=>{throw Error('lost committed outcome reply');})):
    scenario==='settlement-rollback'?await owner.scope({prepare:db.prepare.bind(db),batch:statements=>db.batch([...statements,db.prepare('UPDATE connection_oauth_outcomes SET reason=reason WHERE user_id=?').bind(owner.account)])}):scope;
   const transport=async(url)=>{
    if(url.endsWith('/access_token')||url.endsWith('/oauth2/token')){
     exchanges++;
     const held=await db.prepare('SELECT * FROM connection_oauth_exchanges WHERE user_id=? AND provider=?').bind(owner.account,provider).first();
     assert.equal(held.client_id,config.clientId);assert.equal(held.state_hash,await m.hashToken(state));
     await assert.rejects(db.prepare('DELETE FROM connection_oauth_exchanges WHERE token_id=?').bind(held.token_id).run(),/connection_outcome_required/);
     if(scenario==='unknown')throw Error(privateText);
     if(scenario==='signed-out-rejected')await owner.revoke();
     if(persistenceFailure)return json(provider==='github'?{access_token:'ghu_synthetic_outcome',expires_in:3600,...(scenario==='refresh-revocation-unproven'?{refresh_token:'ghr_synthetic_retained'}:{})}:{access_token:'cf-synthetic-outcome',expires_in:3600,token_type:'bearer'});
     return rejectResponse(provider,scenario==='mixed-response'?{access_token:'synthetic-mixed-token'}:{});
    }
    if(url.endsWith('/token')||url.endsWith('/revoke')){revocations++;return new Response(null,{status:scenario==='revocation-failed'?503:provider==='github'?204:200});}
    throw Error('Unexpected provider request');
   };
   await refused(finish(database,owner.account,state,'synthetic-code',config,transport));assert.equal(exchanges,1);
   const hold=await db.prepare('SELECT * FROM connection_oauth_exchanges WHERE user_id=? AND provider=?').bind(owner.account,provider).first();
   const receipt=await db.prepare('SELECT * FROM connection_oauth_outcomes WHERE user_id=?').bind(owner.account).first();
   const terminal=['rejected','signed-out-rejected','lost-settlement-ack','revoked'].includes(scenario);
   assert.equal(!!receipt,terminal);assert.equal(!!hold,!terminal);assert.equal(revocations,persistenceFailure?1:0);
   assert.equal(await db.prepare(`SELECT 1 FROM ${provider}_token_vault WHERE user_id=?`).bind(owner.account).first(),null);
   if(terminal){
    assert.equal(receipt.state,scenario==='revoked'?'revoked':'rejected');assert.equal(receipt.provider,provider);assert.equal(receipt.client_id,config.clientId);assert.equal(receipt.state_hash,await m.hashToken(state));
    assert.ok(!JSON.stringify(receipt).includes(privateText));assert.ok(!JSON.stringify(receipt).includes('synthetic-code'));assert.ok(!JSON.stringify(receipt).includes('ghu_'));
    assert.equal(await db.prepare(`SELECT 1 FROM ${provider}_oauth_states WHERE user_id=?`).bind(owner.account).first(),null);
    await assert.rejects(db.prepare("UPDATE connection_oauth_outcomes SET reason='changed' WHERE id=?").bind(receipt.id).run(),/connection_outcome_immutable/);
    await assert.rejects(db.prepare('INSERT INTO connection_oauth_outcomes SELECT ?,user_id,provider,client_id,state_hash,key_id,revision,state,reason,http_status,dispatched_at,settled_at FROM connection_oauth_outcomes WHERE id=?').bind(crypto.randomUUID(),receipt.id).run(),/connection_outcome_admission/);
    if(scenario!=='signed-out-rejected')assert.ok((await start(scope,owner.account,config)).url);
   }else{
    await assert.rejects(start(scope,owner.account,config),{status:409});
    await assert.rejects(db.prepare('DELETE FROM connection_oauth_exchanges WHERE token_id=?').bind(hold.token_id).run(),/connection_outcome_required/);
   }
   journeys++;
  }
 }
 const unauthorized=await m.readOAuthTokenResponse('cloudflare',json({error:'invalid_client'},401));assert.equal(unauthorized.kind,'rejected');
 await refused(m.readOAuthTokenResponse('cloudflare',json({error:'invalid_grant'},401)));
 // A body can stall even after fetch resolves; cancel it at the fixed deadline.
 if(fixture.sql){let cancelled=false;await refused(m.readOAuthTokenResponse('github',new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'content-type':'application/json'}})));assert.equal(cancelled,true);}
 console.log(`OAuth outcomes passed: ${journeys} actual provider journeys, ${refusals} refusals; exact durable receipts, unknown holds, lost replies and private-body exclusion. No real provider requests.`);
}finally{globalThis.fetch=originalFetch;await fixture.close();}
