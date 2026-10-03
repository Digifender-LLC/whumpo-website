import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';
import {fixtureKeyring} from './helpers/connection-keyring.mjs';
import {captureRestoreConstraint,captureRestoreManifest,restoreManifestDigest,inspectIsolatedRestore} from '../tools/restore-admission.mjs';
import {keyBackupFixture} from './helpers/key-backup.mjs';
import {accountClosureInventory} from '../tools/account-closure-inventory.mjs';
import {maintenanceReport} from '../tools/report-maintenance.mjs';

Error.stackTraceLimit=0;
const modules=await currentFixtureModules(['src/github-connection.ts','src/github-grant-revocation.ts','src/connection-rotation.ts']);
const m=modules.identity,g=await modules.module('src/github-connection.ts'),a=await modules.module('src/github-grant-revocation.ts'),keys=await modules.module('src/connection-rotation.ts');
const fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID(),key=fixtureKeyring(),backups=await keyBackupFixture();
let cases=0,refusals=0;
const noFetch=()=>assert.fail('No provider dispatch permitted'),deny=async promise=>{await assert.rejects(promise);refusals++;};
async function owner(proof=-5){const o=await workspaceFixture(db,m,id(),proof);await paidPlan(db,o.account,'business');return o;}
async function connect(o,config,identity=123){
 const scope=await o.scope(),start=await g.startGitHub(scope,o.account,config),token='ghu_SYNTHETIC_'+id().replaceAll('-','');
 await g.finishGitHub(scope,o.account,new URL(start.url).searchParams.get('state'),'synthetic-code',config,async url=>{
  if(url.endsWith('/access_token'))return Response.json({access_token:token,expires_in:3600,refresh_token:'ghr_SYNTHETIC_'+id().replaceAll('-',''),refresh_token_expires_in:15897600});
  if(url.endsWith('/user'))return Response.json({id:identity,login:'fixture'});
  if(url.endsWith('/token'))return new Response(null,{status:204});
  return noFetch();
 });return token;
}
async function setup(){const o=await owner(),config={clientId:'grant-'+id(),clientSecret:'synthetic-secret',appId:123,slug:'fixture',key},token=await connect(o,config),scope=await o.scope(),reviewId=id();const review=await a.reviewGitHubGrant(scope,o.account,reviewId,config);cases++;return {o,config,token,scope,reviewId,review};}
const stored=rid=>db.prepare('SELECT * FROM github_grant_revocations WHERE id=?').bind(rid).first();
const count=async(o,table='github_refresh_custody')=>(await db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id=?`).bind(o.account).first()).n;
const confirm=(s,transport=noFetch,scope=s.scope)=>a.confirmGitHubGrant(scope,s.o.account,s.reviewId,'REVOKE_APP_ACCESS',s.config,transport);
const originalFetch=globalThis.fetch;globalThis.fetch=noFetch;
try{
 await keys.initializeConnectionKeys(db,key,'grant-fixture-review');
 const s=await setup();assert.equal(s.review.credentialCount,1);assert.match(s.review.disclosure,/all access/);assert.equal(s.review.scope,'all-app-access');assert.ok(!JSON.stringify(s.review).includes(s.token));
 assert.deepEqual(await a.reviewGitHubGrant(s.scope,s.o.account,s.reviewId,s.config),s.review);
 let sends=0;const approved=await confirm(s,async(url,init)=>{sends++;assert.equal(url,'https://api.github.com/applications/'+s.config.clientId+'/grant');assert.equal(init.method,'DELETE');assert.equal(init.redirect,'manual');assert.ok(init.signal);assert.deepEqual(JSON.parse(init.body),{access_token:s.token});assert.ok(!init.body.includes('ghr_'));return new Response(null,{status:204});});
 assert.equal(approved.state,'revoked');assert.equal(sends,1);assert.equal(await count(s.o),0);assert.equal(await count(s.o,'github_token_vault'),0);assert.equal((await g.connectionStatus(s.scope,s.o.account,s.config)).github.connected,false);
 assert.deepEqual(await confirm(s),approved);assert.deepEqual(await a.cancelGitHubGrant(s.scope,s.o.account,s.reviewId),approved);
 const observed=await captureRestoreConstraint(db,{kind:'external-effect',store:'github_grant_revocations',effectId:s.reviewId});assert.equal(observed.data.state,'reconciled');
 const manifest=await captureRestoreManifest(db,{snapshotId:id(),streamId:'grant-independent',sequence:0}),proof=(await backups.create(key)).proof;
 const evidenceSource={fetch:async request=>{const input=await request.json(),now=Date.now();return Response.json({version:2,streamId:'grant-independent',snapshotId:manifest.snapshotId,manifestDigest:restoreManifestDigest(manifest),challenge:input.challenge,archiveState:'permitted',capturedSequence:0,baseSequence:0,currentSequence:1,issuedAt:now,expiresAt:now+10000,events:[{sequence:1,...observed}],keyBackup:{backupId:proof.backupId,sha256:proof.sha256,keyIds:proof.keyIds}});}};
 const restored=await inspectIsolatedRestore({db,manifest,keyBackup:proof,evidenceSource,expectedStreamId:'grant-independent'});assert.equal(restored.status,'verified',JSON.stringify(restored));assert.equal(restored.servingAllowed,false);assert.equal(restored.providerDispatchAllowed,false);assert.equal(restored.retirementAllowed,false);
 await deny(db.prepare("UPDATE github_grant_revocations SET token_ids='[]' WHERE id=?").bind(s.reviewId).run());await deny(db.prepare('DELETE FROM github_grant_revocations WHERE id=?').bind(s.reviewId).run());
 const other=await owner();await deny(a.confirmGitHubGrant(await other.scope(),other.account,s.reviewId,'REVOKE_APP_ACCESS',s.config,noFetch));assert.deepEqual((await a.githubGrantReviews(await other.scope(),other.account)).reviews,[]);
 const multiple=await setup();await connect(multiple.o,multiple.config);multiple.reviewId=id();assert.equal((await a.reviewGitHubGrant(multiple.scope,multiple.o.account,multiple.reviewId,multiple.config)).credentialCount,2);assert.equal((await confirm(multiple,async()=>new Response(null,{status:204}))).state,'revoked');assert.equal(await count(multiple.o),0);
 const selected=await setup();await connect(selected.o,selected.config,789);selected.reviewId=id();await a.reviewGitHubGrant(selected.scope,selected.o.account,selected.reviewId,selected.config);await confirm(selected,async()=>new Response(null,{status:204}));assert.equal(await count(selected.o),1);assert.equal((await db.prepare('SELECT github_user_id FROM github_refresh_custody WHERE user_id=?').bind(selected.o.account).first()).github_user_id,'123');
 const expired=await setup(),expiredRecord=await stored(expired.reviewId);expired.reviewId=id();
 await db.prepare("INSERT INTO github_grant_revocations(id,user_id,client_id,github_user_id,login,token_id,token_ids,state,created_at,expires_at) VALUES(?,?,?,?,?,?,?,'review',?,?)").bind(expired.reviewId,expired.o.account,expired.config.clientId,expiredRecord.github_user_id,expiredRecord.login,expiredRecord.token_id,expiredRecord.token_ids,new Date(Date.now()-700000).toISOString(),new Date(Date.now()-100000).toISOString()).run();await deny(confirm(expired));assert.equal(await count(expired.o),1);
 const word=await setup();await deny(a.confirmGitHubGrant(word.scope,word.o.account,word.reviewId,'yes',word.config,noFetch));assert.equal((await stored(word.reviewId)).state,'review');
 const cancelled=await setup();assert.equal((await a.cancelGitHubGrant(cancelled.scope,cancelled.o.account,cancelled.reviewId)).state,'cancelled');assert.equal((await confirm(cancelled)).state,'cancelled');assert.equal(await count(cancelled.o),1);
 assert.equal((await captureRestoreConstraint(db,{kind:'external-effect',store:'github_grant_revocations',effectId:cancelled.reviewId})).data.state,'reconciled');
 const replaced=await setup();await connect(replaced.o,replaced.config);await deny(confirm(replaced));assert.equal((await stored(replaced.reviewId)).state,'review');
 const disconnected=await setup();await g.disconnectGitHub(disconnected.scope,disconnected.o.account,undefined);await deny(confirm(disconnected));
 const client=await setup();await deny(a.confirmGitHubGrant(client.scope,client.o.account,client.reviewId,'REVOKE_APP_ACCESS',{...client.config,clientId:'different'},noFetch));
 const stale=await setup(),staleActor=await owner(-3600);await connect(staleActor,stale.config,456);const staleScope=await staleActor.scope(),staleId=id();await a.reviewGitHubGrant(staleScope,staleActor.account,staleId,stale.config);await deny(a.confirmGitHubGrant(staleScope,staleActor.account,staleId,'REVOKE_APP_ACCESS',stale.config,noFetch));
 const shared=await setup(),secondOwner=await owner();await connect(secondOwner,shared.config);await deny(confirm(shared));assert.equal(await count(secondOwner),1);assert.equal(await count(shared.o),1);
 const unknown=await setup(),unknownOwner=await owner();await deny(connect(unknownOwner,unknown.config,0));await deny(confirm(unknown));
 const exchange=await setup(),exchangeOwner=await owner(),exchangeScope=await exchangeOwner.scope(),begun=await g.startGitHub(exchangeScope,exchangeOwner.account,exchange.config);
 await deny(g.finishGitHub(exchangeScope,exchangeOwner.account,new URL(begun.url).searchParams.get('state'),'synthetic-code',exchange.config,async()=>{throw Error('lost token response');}));await deny(confirm(exchange));
 // A flow prepared before dispatch must still be refused at atomic exchange
 // admission. Retrying either confirmation cannot send a second grant delete.
 const concurrent=await setup(),nextOwner=await owner(),nextScope=await nextOwner.scope(),nextStart=await g.startGitHub(nextScope,nextOwner.account,concurrent.config);let concurrentSends=0;
 await confirm(concurrent,async()=>{
  concurrentSends++;assert.equal((await confirm(concurrent)).state,'dispatching');
  await deny(g.startGitHub(nextScope,nextOwner.account,concurrent.config));
  await deny(g.finishGitHub(nextScope,nextOwner.account,new URL(nextStart.url).searchParams.get('state'),'synthetic-code',concurrent.config,noFetch));
  await g.cleanupGitHub(db,concurrent.config,noFetch,concurrent.o.account);
  return new Response(null,{status:204});
 });assert.equal(concurrentSends,1);assert.equal((await stored(concurrent.reviewId)).state,'revoked');await g.startGitHub(nextScope,nextOwner.account,concurrent.config);
 const lost=await setup();let lostSends=0;assert.equal((await confirm(lost,async()=>{lostSends++;throw Error('lost provider response');})).state,'uncertain');assert.equal((await confirm(lost)).state,'uncertain');assert.equal(lostSends,1);assert.equal(await count(lost.o),1);await deny(g.startGitHub(lost.scope,lost.o.account,lost.config));assert.equal((await captureRestoreConstraint(db,{kind:'external-effect',store:'github_grant_revocations',effectId:lost.reviewId})).data.state,'unknown');
 const rejected=await setup();assert.equal((await confirm(rejected,async()=>new Response(null,{status:422}))).state,'uncertain');assert.equal(await count(rejected.o),1);
 const claimLoss=await setup();let lostClaim=false;const claimScope=await claimLoss.o.scope(interceptDatabase(db,/UPDATE github_grant_revocations SET state='dispatching'/,async()=>{},async()=>{if(!lostClaim){lostClaim=true;throw Error('lost claim reply');}}));assert.equal((await confirm(claimLoss,noFetch,claimScope)).state,'dispatching');assert.equal((await confirm(claimLoss)).state,'dispatching');
 const receiptLoss=await setup();let lostReceipt=false;const receiptScope=await receiptLoss.o.scope(interceptDatabase(db,/UPDATE github_grant_revocations SET state='revoked'/,async()=>{},async()=>{if(!lostReceipt){lostReceipt=true;throw Error('lost settlement reply');}}));assert.equal((await confirm(receiptLoss,async()=>new Response(null,{status:204}),receiptScope)).state,'revoked');assert.equal(await count(receiptLoss.o),0);
 const rollback=await setup();await db.prepare("CREATE TRIGGER synthetic_grant_cleanup_failure BEFORE DELETE ON github_token_vault BEGIN SELECT RAISE(ABORT,'synthetic_cleanup_failure'); END").run();
 try{assert.equal((await confirm(rollback,async()=>new Response(null,{status:204}))).state,'uncertain');assert.equal(await count(rollback.o),1);assert.equal(await count(rollback.o,'github_token_vault'),1);}finally{await db.prepare('DROP TRIGGER synthetic_grant_cleanup_failure').run();}
 const signout=await setup();await deny(confirm(signout,async()=>{await signout.o.revoke();return new Response(null,{status:204});}));assert.equal((await stored(signout.reviewId)).state,'revoked');assert.equal(await count(signout.o),0);
 const report=await maintenanceReport(db,Date.now());assert.ok(report.backlogs.find(r=>r.queue==='github_grant_unknown').count>=4);assert.ok(!JSON.stringify(report).includes('ghu_'));
 assert.equal((await accountClosureInventory(db,lost.o.account)).counts.githubGrantUncertain,1);
 console.log(JSON.stringify({suite:'github-grant-revocation',cases,refusals,duplicateDispatches:0,terminalRestoreReceipt:true,liveProviderAccess:false}));
}finally{globalThis.fetch=originalFetch;await backups.close();await fixture.close();}
