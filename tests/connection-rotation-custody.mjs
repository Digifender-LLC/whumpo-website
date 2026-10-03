import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';
import {fixtureKeyring} from './helpers/connection-keyring.mjs';
const built=await build({stdin:{contents:"export * from './src/github-connection';export * from './src/cloudflare-connection';export * from './src/connection-rotation';export * from './src/connection-vault';export * from './src/workspace-identity/admission';export * from './src/workspace-identity/authority';export * from './src/security';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const a=fixtureKeyring('ab'.repeat(32),'key-a'),b=fixtureKeyring('cd'.repeat(32),'key-b',[{id:'key-a',secret:'ab'.repeat(32)}]);
for(const provider of ['github','cloudflare'])for(const scenario of ['cancel-before-admission','disconnect','lost-save-ack','unknown-exchange']){
 const fixture=await databaseFixture(),{db}=fixture;
 try{
  await m.initializeConnectionKeys(db,a,'initial-review');await m.registerConnectionKeys(db,b,'next-review');
  const owner=await workspaceFixture(db,m),scope=await owner.scope();await paidPlan(db,owner.account,'business');
  const config={clientId:'fixture',clientSecret:'synthetic',appId:123,slug:'fixture',key:a};
  const [start,finish,disconnect]=provider==='github'?[m.startGitHub,m.finishGitHub,m.disconnectGitHub]:[m.startCloudflare,m.finishCloudflare,m.disconnectCloudflare];
  const activation={id:'custody-rotation',reviewId:'custody-review',expectedRevision:1};
  let exchanges=0,revocations=0,intercepted=false;
  const transport=async(url)=>{
   if(url.endsWith('/access_token')||url.endsWith('/oauth2/token')){
    exchanges++;
    assert.equal((await m.connectionKeyRetirementStatus(db,'key-a')).unsettledExchanges,1);
    await assert.rejects(m.beginConnectionRotation(db,b,activation),/unavailable/);
    if(scenario==='unknown-exchange')throw Error('Provider response was lost');
    if(scenario==='disconnect')await disconnect(scope,owner.account,undefined,transport);
    return Response.json(provider==='github'?{access_token:'ghu_synthetic_custody',expires_in:3600}:{access_token:'cf-synthetic-custody',token_type:'bearer',expires_in:3600});
   }
   if(url.endsWith('/user'))return Response.json({id:123,login:'fixture'});
   if(url.endsWith('/token')||url.endsWith('/revoke')){revocations++;return new Response(null,{status:503});}
   throw Error('Unexpected synthetic provider dispatch');
  };
  const begun=await start(scope,owner.account,config),state=new URL(begun.url).searchParams.get('state');
  const database=scenario==='cancel-before-admission'?await owner.scope(interceptDatabase(db,/INSERT INTO connection_oauth_exchanges/,async()=>disconnect(scope,owner.account,undefined))):scenario==='lost-save-ack'?await owner.scope(interceptDatabase(db,new RegExp('INSERT INTO '+provider+'_token_vault'),async()=>{},async()=>{
   if(intercepted)return;intercepted=true;
   assert.equal((await m.connectionKeyRetirementStatus(db,'key-a')).unsettledExchanges,0);
   await m.beginConnectionRotation(db,b,activation);await m.rotateConnectionBatch(db,b,activation.id,'before-callback-ack',20);
   throw Error('Lost custody acknowledgment after rotation');
  })):scope;
  if(scenario==='lost-save-ack')assert.equal((await finish(database,owner.account,state,'synthetic-code',config,transport)).connected,true);
  else await assert.rejects(finish(database,owner.account,state,'synthetic-code',config,transport),error=>[409,503].includes(error.status));
  if(scenario==='cancel-before-admission'){assert.equal(exchanges,0);assert.equal(revocations,0);assert.equal((await m.connectionKeyRetirementStatus(db,'key-a')).unsettledExchanges,0);await m.beginConnectionRotation(db,b,activation);console.log(provider+': cancellation before exchange admission passed.');continue;}
  assert.equal(exchanges,1);
  const token=await db.prepare(`SELECT id,state,ciphertext FROM ${provider}_token_vault WHERE user_id=?`).bind(owner.account).first();
  if(scenario==='unknown-exchange'){
   assert.equal(token,null);await assert.rejects(start(scope,owner.account,config),{status:409});
   await disconnect(scope,owner.account,undefined);
   assert.equal((await m.connectionKeyRetirementStatus(db,'key-a')).unsettledExchanges,1);
   await assert.rejects(m.beginConnectionRotation(db,b,activation),/unavailable/);assert.equal(revocations,0);
  }else{
   assert.equal((await m.connectionKeyRetirementStatus(db,'key-a')).unsettledExchanges,0);
   if(scenario==='disconnect'){
    assert.equal(token.state,'revoking');assert.equal(revocations,1);
    await m.beginConnectionRotation(db,b,activation);await m.rotateConnectionBatch(db,b,activation.id,'after-disconnect',20);
    const retained=await db.prepare(`SELECT state,ciphertext FROM ${provider}_token_vault WHERE id=?`).bind(token.id).first();assert.equal(retained.state,'revoking');assert.equal(m.connectionCiphertextKeyId(retained.ciphertext),'key-b');
   }else{assert.equal(token.state,'active');assert.equal(m.connectionCiphertextKeyId(token.ciphertext),'key-b');assert.equal(revocations,0);}
  }
  console.log(provider+': '+scenario+' passed against actual OAuth custody and rotation handlers.');
 }finally{await fixture.close();}
}
