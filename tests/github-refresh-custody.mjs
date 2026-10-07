import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';
import {fixtureKeyring} from './helpers/connection-keyring.mjs';
import {keyBackupFixture} from './helpers/key-backup.mjs';
import {accountClosureInventory} from '../tools/account-closure-inventory.mjs';
import {captureRestoreManifest,restoreManifestDigest,inspectIsolatedRestore} from '../tools/restore-admission.mjs';
import {currentSchemaArtifact} from '../tools/current-schema.mjs';

Error.stackTraceLimit=0;
const modules=await currentFixtureModules(['src/github-connection.ts','src/connection-rotation.ts','src/connection-vault.ts']);
const m=modules.identity,g=await modules.module('src/github-connection.ts'),r=await modules.module('src/connection-rotation.ts'),v=await modules.module('src/connection-vault.ts');
const fixture=await databaseFixture(),{db}=fixture,backups=await keyBackupFixture(),id=()=>crypto.randomUUID();
const config={clientId:'refresh-fixture',clientSecret:'synthetic-only',appId:123,slug:'fixture',key:fixtureKeyring()};
const refreshToken='ghr_PRIVATE_REFRESH_CUSTODY_CANARY',accessToken='ghu_PRIVATE_ACCESS_CUSTODY_CANARY';
let refusals=0,journeys=0;
const reject=async(f,pattern)=>{await assert.rejects(f,error=>{assert.ok(!String(error).includes(refreshToken));assert.ok(!String(error).includes(accessToken));return pattern?pattern.test(String(error)):true;});refusals++;};
async function owner(){const owner=await workspaceFixture(db,m);await paidPlan(db,owner.account,'business');return owner;}
async function run(owner,{duringExchange,duringUser,database,accessLifetime=3600,refreshLifetime=15897600,refresh=refreshToken,revokeStatus=204,who={id:12345,login:'fixture'}}={}){
 const scope=database??await owner.scope(),begun=await g.startGitHub(scope,owner.account,config);let exchanges=0,revocations=0,users=0;
 const transport=async(url,init)=>{
  assert.ok(!String(init.body??'').includes(refreshToken),'Refresh material must never be sent by access/grant cleanup or API use');
  if(url==='https://github.com/login/oauth/access_token'){
   exchanges++;await duringExchange?.();return Response.json({access_token:accessToken,expires_in:accessLifetime,refresh_token:refresh,...(refreshLifetime!==undefined?{refresh_token_expires_in:refreshLifetime}:{}),token_type:'bearer',scope:''});
  }
  if(url==='https://api.github.com/user'){users++;await duringUser?.();return Response.json(who);}
  if(url==='https://api.github.com/applications/'+config.clientId+'/token'){assert.equal(init.method,'DELETE');revocations++;return new Response(null,{status:revokeStatus});}
  assert.fail('Unexpected credential/provider operation');
 };
 const finish=()=>g.finishGitHub(scope,owner.account,new URL(begun.url).searchParams.get('state'),'synthetic-code',config,transport);
 journeys++;return {finish,counts:()=>({exchanges,revocations,users}),transport};
}
const row=owner=>db.prepare('SELECT * FROM github_refresh_custody WHERE user_id=?').bind(owner.account).first();
const token=owner=>db.prepare('SELECT * FROM github_token_vault WHERE user_id=?').bind(owner.account).first();
async function restore(){
 const manifest=await captureRestoreManifest(db,{snapshotId:id(),streamId:'refresh-independent',sequence:0}),keyBackup=(await backups.create(config.key)).proof;
 const evidenceSource={fetch:async request=>{const input=await request.json(),stamp=Date.now();return Response.json({version:2,streamId:'refresh-independent',snapshotId:manifest.snapshotId,manifestDigest:restoreManifestDigest(manifest),challenge:input.challenge,archiveState:'permitted',capturedSequence:0,baseSequence:0,currentSequence:0,issuedAt:stamp,expiresAt:stamp+10000,events:[],keyBackup:{backupId:keyBackup.backupId,sha256:keyBackup.sha256,keyIds:keyBackup.keyIds}});}};
 return inspectIsolatedRestore({db,manifest,keyBackup,evidenceSource,expectedStreamId:'refresh-independent'});
}
const globalFetch=globalThis.fetch;globalThis.fetch=()=>assert.fail('Refresh custody checks cannot contact real providers');
try{
 await r.initializeConnectionKeys(db,config.key,'refresh-review');
 const a=await owner(),flow=await run(a);assert.equal((await flow.finish()).connected,true);
 assert.deepEqual(flow.counts(),{exchanges:1,revocations:0,users:1});
 let saved=await row(a);assert.ok(saved);assert.equal(saved.client_id,config.clientId);assert.equal(saved.github_user_id,'12345');assert.equal(saved.access_revoked_at,null);assert.ok(saved.expires_at>(await token(a)).expires_at);
 assert.equal(await v.unseal(config.key,`whumpo:github:refresh:${a.account}:${saved.token_id}`,saved.ciphertext),refreshToken);
 for(const context of [`whumpo:github:token:${a.account}:${saved.token_id}`,`whumpo:cloudflare:token:${a.account}:${saved.token_id}`,`whumpo:github:refresh:other:${saved.token_id}`,`whumpo:github:refresh:${a.account}:other`])await reject(()=>v.unseal(config.key,context,saved.ciphertext));
 await reject(()=>v.seal(config.key,`whumpo:cloudflare:refresh:${a.account}:${saved.token_id}`,refreshToken));
 const access=await g.githubAccess(await a.scope(),a.account,config,async(_url,init)=>{assert.equal(init.headers.authorization,'Bearer '+accessToken);return Response.json({ok:true});},{projectId:null,operation:'read'});
 await access.send('installations.list');
 const status=await g.connectionStatus(await a.scope(),a.account,config);assert.ok(!JSON.stringify(status).includes(refreshToken));assert.ok(!JSON.stringify(status).includes('ciphertext'));
 const activeBudget=await restore();assert.deepEqual(activeBudget.holds,['connector-budget-window']);
 // This fixture's independent restore journey starts after its content-free read window expires.
 // Replace only this counter with an expired window; credential and uncertain-effect rows stay intact.
 await db.batch([db.prepare("DELETE FROM connector_request_budgets WHERE user_id=? AND provider='github' AND kind='read'").bind(a.account),db.prepare("INSERT INTO connector_request_budgets(user_id,provider,kind,window_start,used) VALUES(?,'github','read',0,1)").bind(a.account)]);
 const before=await restore();assert.equal(before.status,'verified',JSON.stringify(before));assert.equal(before.keys.credentials,2);assert.equal(before.tables,(await currentSchemaArtifact()).expected.tables);
 // Rotation uses the existing CAS journal and the distinct refresh purpose.
 const next=fixtureKeyring('cd'.repeat(32),'refresh-next',JSON.parse(config.key).keys);
 await r.registerConnectionKeys(db,next,'refresh-review-next');await r.beginConnectionRotation(db,next,{id:'refresh-rotation',reviewId:'refresh-review-next',expectedRevision:1});
 await r.rotateConnectionBatch(db,next,'refresh-rotation','refresh-batch');config.key=next;
 saved=await row(a);assert.equal(v.connectionCiphertextKeyId(saved.ciphertext),'refresh-next');assert.equal(await v.unseal(next,`whumpo:github:refresh:${a.account}:${saved.token_id}`,saved.ciphertext),refreshToken);
 assert.equal(saved.github_user_id,'12345','Rotation preserves the provider identity of this grant');
 assert.equal((await restore()).status,'verified');
 for(const statement of [db.prepare('UPDATE github_refresh_custody SET github_user_id=NULL WHERE token_id=?').bind(saved.token_id),db.prepare("UPDATE github_refresh_custody SET github_user_id='54321' WHERE token_id=?").bind(saved.token_id),db.prepare("UPDATE github_connections SET github_user_id='54321' WHERE user_id=?").bind(a.account)])await reject(()=>statement.run());
 for(const statement of [db.prepare('DELETE FROM github_refresh_custody WHERE token_id=?').bind(saved.token_id),db.prepare('DELETE FROM github_token_vault WHERE id=?').bind(saved.token_id),db.prepare("UPDATE github_refresh_custody SET client_id='other' WHERE token_id=?").bind(saved.token_id),db.prepare("UPDATE github_refresh_custody SET expires_at='2000-01-01' WHERE token_id=?").bind(saved.token_id)])await reject(()=>statement.run());
 // A single access-token 204 is recorded narrowly, with encrypted refresh custody retained.
 await g.disconnectGitHub(await a.scope(),a.account,config,flow.transport);
 saved=await row(a);assert.ok(saved.access_revoked_at);assert.equal((await token(a)).state,'revoking');
 assert.equal((await g.connectionStatus(await a.scope(),a.account,config)).github.revocationPending,true);
 const after=await restore();assert.deepEqual(after.holds,['uncertain-effect']);assert.equal(after.servingAllowed,false);assert.equal(after.retirementAllowed,false);
 const count=flow.counts().revocations;await g.cleanupGitHub(db,config,flow.transport,a.account);assert.equal(flow.counts().revocations,count,'An observed access-token revocation is not redispatched');
 await reject(()=>db.prepare('UPDATE github_refresh_custody SET access_revoked_at=NULL WHERE token_id=?').bind(saved.token_id).run());
 await reject(()=>db.prepare("UPDATE github_token_vault SET state='active' WHERE id=?").bind(saved.token_id).run());
 const inventory=await accountClosureInventory(db,a.account);assert.equal(inventory.counts.githubRefreshCustody,1);assert.equal(inventory.readyForDeletion,false);assert.ok(!JSON.stringify(inventory).includes(refreshToken));
 // Acknowledgement loss after the whole transaction reads back both credentials.
 const b=await owner();let lost=false;
 const lostScope=await b.scope(interceptDatabase(db,/INSERT INTO github_refresh_custody/,async()=>{},async()=>{if(!lost){lost=true;throw Error('lost committed reply');}}));
 const replay=await run(b,{database:lostScope});assert.equal((await replay.finish()).connected,true);assert.ok(await row(b));assert.equal(replay.counts().exchanges,1);
 // Cancellation after dispatch leaves both credentials under cleanup custody.
 const c=await owner(),cancelled=await run(c,{duringExchange:()=>g.disconnectGitHub(cScope,c.account,undefined)}),cScope=await c.scope();
 await reject(cancelled.finish);assert.ok(await row(c));assert.equal((await token(c)).state,'revoking');assert.ok((await row(c)).access_revoked_at);
 // Signing out cannot prevent custody of an already issued refresh credential.
 const d=await owner(),signedOut=await run(d,{duringExchange:()=>d.revoke()});await reject(signedOut.finish);assert.ok(await row(d));assert.equal((await row(d)).github_user_id,null);assert.equal((await token(d)).state,'revoking');
 await g.cleanupGitHub(db,config,signedOut.transport,d.account);assert.ok((await row(d)).access_revoked_at);
 // Missing/invalid refresh lifetime is retained with unknown expiry, never activated.
 const e=await owner(),unknownLifetime=await run(e,{refreshLifetime:0});await reject(unknownLifetime.finish);assert.equal((await row(e)).expires_at,null);assert.ok((await row(e)).access_revoked_at);
 // Original OAuth client is pinned for access revocation of the saved pair.
 const f=await owner(),changedClient=await run(f);await changedClient.finish();
 const wrongClient={...config,clientId:'different-client'};
 assert.equal((await g.connectionStatus(await f.scope(),f.account,wrongClient)).github.connected,false);
 await reject(async()=>g.githubAccess(await f.scope(),f.account,wrongClient,()=>assert.fail('No API dispatch for another client'),{projectId:null,operation:'read'}));
 await g.disconnectGitHub(await f.scope(),f.account,undefined);
 await g.cleanupGitHub(db,{...config,clientId:'different-client'},()=>assert.fail('No dispatch with another OAuth client'),f.account);assert.equal((await row(f)).access_revoked_at,null);
 await g.cleanupGitHub(db,config,changedClient.transport,f.account);assert.ok((await row(f)).access_revoked_at);
 // Actual access expiry does not cascade-delete a six-month refresh credential.
 const h=await owner(),short=await run(h,{accessLifetime:3});await short.finish();await new Promise(resolve=>setTimeout(resolve,3100));
 await g.cleanupGitHub(db,config,short.transport,h.account);assert.ok(await row(h));assert.equal((await token(h)).state,'revoking');assert.equal((await g.connectionStatus(await h.scope(),h.account,config)).github.connected,false);assert.equal((await g.connectionStatus(await h.scope(),h.account,config)).github.revocationPending,true);
 // Atomic insertion failure cannot release an exchange using only half a pair.
 const failed=await owner(),failedFlow=await run(failed);
 await db.prepare("CREATE TRIGGER synthetic_refresh_failure BEFORE INSERT ON github_refresh_custody BEGIN SELECT RAISE(ABORT,'synthetic_refresh_failure'); END").run();
 try{await reject(failedFlow.finish);assert.equal(await row(failed),null);assert.equal(await token(failed),null);}
 finally{await db.prepare('DROP TRIGGER synthetic_refresh_failure').run();}
 assert.ok(await db.prepare('SELECT 1 FROM connection_oauth_exchanges WHERE user_id=?').bind(failed.account).first());assert.equal(await db.prepare('SELECT 1 FROM connection_oauth_outcomes WHERE user_id=?').bind(failed.account).first(),null);
 assert.equal(failedFlow.counts().revocations,1);
 // Current table admission rejects fabricated/unowned refresh custody.
 await reject(()=>db.prepare('INSERT INTO github_refresh_custody(token_id,user_id,client_id,ciphertext) VALUES(?,?,?,?)').bind(id(),b.account,config.clientId,saved.ciphertext).run());
 // New consent to another GitHub account must never relabel an older grant.
 const switcher=await owner(),firstIdentity=await run(switcher,{who:{id:101,login:'first'}});await firstIdentity.finish();
 const firstGrant=await row(switcher),secondIdentity=await run(switcher,{who:{id:202,login:'second'}});await secondIdentity.finish();
 const grants=(await db.prepare('SELECT github_user_id,access_revoked_at FROM github_refresh_custody WHERE user_id=? ORDER BY github_user_id').bind(switcher.account).all()).results;
 assert.deepEqual(grants.map(r=>r.github_user_id),['101','202']);assert.ok(grants[0].access_revoked_at);assert.equal(grants[1].access_revoked_at,null);
 assert.equal((await db.prepare('SELECT github_user_id FROM github_connections WHERE user_id=?').bind(switcher.account).first()).github_user_id,'202');
 assert.equal((await db.prepare('SELECT github_user_id FROM github_refresh_custody WHERE token_id=?').bind(firstGrant.token_id).first()).github_user_id,'101');
 // A response already requested may record identity after local sign-out or
 // disconnect, but its credentials must not regain workspace access.
 const signedOutLookup=await owner(),lateIdentity=await run(signedOutLookup,{duringUser:()=>signedOutLookup.revoke()});
 await reject(lateIdentity.finish);assert.equal((await row(signedOutLookup)).github_user_id,'12345');assert.equal((await token(signedOutLookup)).state,'revoking');
 const disconnectedLookup=await owner(),lookupScope=await disconnectedLookup.scope(),lateDisconnected=await run(disconnectedLookup,{duringUser:()=>g.disconnectGitHub(lookupScope,disconnectedLookup.account,undefined)});
 await reject(lateDisconnected.finish);assert.equal((await row(disconnectedLookup)).github_user_id,'12345');assert.equal((await token(disconnectedLookup)).state,'revoking');
 // Lost identity-write acknowledgment reads back that exact token's identity.
 const lostIdentityOwner=await owner();let identityReplyLost=false;
 const lostIdentityScope=await lostIdentityOwner.scope(interceptDatabase(db,/UPDATE github_refresh_custody SET github_user_id/,async()=>{},async()=>{if(!identityReplyLost){identityReplyLost=true;throw Error('lost identity acknowledgment');}}));
 const lostIdentity=await run(lostIdentityOwner,{database:lostIdentityScope});assert.equal((await lostIdentity.finish()).connected,true);assert.equal((await row(lostIdentityOwner)).github_user_id,'12345');assert.equal(lostIdentity.counts().users,1);
 // A failed/invalid lookup or failed identity write leaves an unidentified
 // obligation. Neither stored login nor later successful consent can fill it.
 const invalidIdentityOwner=await owner(),invalidIdentity=await run(invalidIdentityOwner,{who:{id:0,login:'fixture'}});await reject(invalidIdentity.finish);assert.equal((await row(invalidIdentityOwner)).github_user_id,null);
 const failedIdentityOwner=await owner(),failedIdentity=await run(failedIdentityOwner);
 await db.prepare("CREATE TRIGGER synthetic_identity_failure BEFORE UPDATE OF github_user_id ON github_refresh_custody BEGIN SELECT RAISE(ABORT,'synthetic_identity_failure'); END").run();
 try{await reject(failedIdentity.finish);assert.equal((await row(failedIdentityOwner)).github_user_id,null);assert.equal((await token(failedIdentityOwner)).state,'revoking');}
 finally{await db.prepare('DROP TRIGGER synthetic_identity_failure').run();}
 const unknownGrant=await row(failedIdentityOwner),knownLater=await run(failedIdentityOwner,{who:{id:303,login:'later'}});await knownLater.finish();
 assert.equal((await db.prepare('SELECT github_user_id FROM github_refresh_custody WHERE token_id=?').bind(unknownGrant.token_id).first()).github_user_id,null);
 assert.equal((await db.prepare('SELECT github_user_id FROM github_connections WHERE user_id=?').bind(failedIdentityOwner.account).first()).github_user_id,'303');
 // Retained grants from a previous app must not occupy the bounded cleanup
 // window forever and starve work for the currently configured app.
 const previousClient=[];
 for(let i=0;i<5;i++){
  const retired=await owner(),retiredFlow=await run(retired,{accessLifetime:300});await retiredFlow.finish();
  await g.disconnectGitHub(await retired.scope(),retired.account,undefined);previousClient.push(retired);
 }
 config.clientId='current-refresh-fixture';
 const currentOwner=await owner(),currentFlow=await run(currentOwner);await currentFlow.finish();
 await g.disconnectGitHub(await currentOwner.scope(),currentOwner.account,undefined);
 await g.cleanupGitHub(db,config,currentFlow.transport);
 assert.equal(currentFlow.counts().revocations,1,'Unrelated app credentials must not starve current cleanup');
 assert.ok((await row(currentOwner)).access_revoked_at);
 for(const retired of previousClient)assert.equal((await row(retired)).access_revoked_at,null,'Other app custody remains pending');
 if(fixture.sql){
  const values=fixture.sql.prepare('SELECT * FROM github_refresh_custody').all();assert.ok(!JSON.stringify(values).includes(refreshToken));assert.ok(values.every(v=>v.ciphertext.startsWith('wv2.')));
 }
 console.log(JSON.stringify({suite:'github-refresh-custody',journeys,refusals,retainedAfterAccessRevocation:true,providerGrantReconciliation:false,liveProviderAccess:false}));
}finally{globalThis.fetch=globalFetch;await backups.close();await fixture.close();}
