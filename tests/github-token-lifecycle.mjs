import {fixtureKeyring} from './helpers/connection-keyring.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,workspaceSession} from './helpers/workspace-identity.mjs';
const built=await build({stdin:{contents:"export * from './src/github-connection';export {hashToken,newSessionToken} from './src/security';export {admitWorkspace} from './src/workspace-identity/admission';export {resolveIdentity} from './src/workspace-identity/authority';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const {startGitHub,finishGitHub,disconnectGitHub,connectionStatus,cleanupGitHub,githubAccess}=m;
const config={clientId:'Iv1.test',clientSecret:'synthetic',appId:123,slug:'fixture',key:fixtureKeyring('ab'.repeat(32))};
let fixture,passed=0,failed=0;
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}};
try{
 fixture=await databaseFixture({d1:true});const db=fixture.db,identities=new Map(),scopes=new Map(),scope=user=>scopes.get(user);
 async function owner(){const a=await workspaceFixture(db,m);identities.set(a.account,a);scopes.set(a.account,await a.scope());await paidPlan(db,a.account,'business');return a.account;}
 const active=user=>db.prepare('SELECT c.active_token_id,t.state FROM github_connections c LEFT JOIN github_token_vault t ON t.id=c.active_token_id WHERE c.user_id=?').bind(user).first();
 function provider(token,{onUser,onRevoke,revokeStatus=204}={}){return async(url,init)=>{
  if(url==='https://github.com/login/oauth/access_token')return Response.json({access_token:token,expires_in:3600});
  if(url==='https://api.github.com/user'){await onUser?.();return Response.json({id:44,login:'fixture'});}
  if(url==='https://api.github.com/applications/Iv1.test/token'){await onRevoke?.(JSON.parse(init.body).access_token);return new Response(null,{status:revokeStatus});}
  throw Error('Unexpected provider URL');
 };}
 async function connect(user,token,options){const start=await startGitHub(scope(user),user,config);return finishGitHub(scope(user),user,new URL(start.url).searchParams.get('state'),'synthetic-code',config,provider(token,options));}
 async function check(name,run){try{await run();passed++;console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+': '+e.message.split('\n')[0]);}}
 await check('disconnect A cannot revoke B while its identity lookup is pending',async()=>{
  const a=await owner(),b=await owner(),revoked=[];
  await connect(a,'ghu_owner_a');
  await connect(b,'ghu_owner_b',{onUser:()=>disconnectGitHub(scope(a),a,config,provider('unused',{onRevoke:t=>revoked.push(t)}))});
  assert.deepEqual(revoked,['ghu_owner_a']);assert.equal((await connectionStatus(scope(b),b,config)).github.connected,true);
 });
 await check('scheduled cleanup cannot revoke a token being validated',async()=>{
  const user=await owner(),revoked=[];
  await connect(user,'ghu_pending',{onUser:()=>cleanupGitHub(db,config,provider('unused',{onRevoke:t=>revoked.push(t)}))});
  assert.deepEqual(revoked,[]);assert.equal((await connectionStatus(scope(user),user,config)).github.connected,true);
 });
 await check('failed replacement preserves the old active token',async()=>{
  const user=await owner();await connect(user,'ghu_old');const old=await active(user),revoked=[];
  await assert.rejects(connect(user,'ghu_unavailable',{onUser:()=>db.prepare('DELETE FROM github_token_vault WHERE user_id=? AND id!=?').bind(user,old.active_token_id).run(),onRevoke:t=>revoked.push(t)}));
  assert.deepEqual(await active(user),old);assert.deepEqual(revoked,[]);
 });
 await check('concurrent cleanup claims dispatch one revocation',async()=>{
  const user=await owner();await connect(user,'ghu_cleanup');await disconnectGitHub(scope(user),user,undefined);
  const entered=deferred(),release=deferred();let dispatches=0;
  const transport=provider('unused',{onRevoke:async()=>{dispatches++;entered.resolve();if(dispatches>1)release.resolve();await release.promise;}});
  const first=cleanupGitHub(db,config,transport);let timer;
  try{await Promise.race([entered.promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Revocation did not begin')),15000)})]);clearTimeout(timer);
   const second=cleanupGitHub(db,config,transport);await Promise.race([second,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Competing cleaner did not finish')),15000)})]);clearTimeout(timer);assert.equal(dispatches,1);release.resolve();await first;
  }finally{clearTimeout(timer);release.resolve();await first;}
 });
 await check('pending token grants no capability before validation',async()=>{
  const user=await owner();await connect(user,'ghu_no_capability',{onUser:async()=>{
   await assert.rejects(githubAccess(scope(user),user,config,fetch,{projectId:null,operation:'read'}),e=>e.status===401);
   assert.equal((await connectionStatus(scope(user),user,config)).github.connected,false);
   assert.equal((await db.prepare('SELECT COUNT(*) n FROM github_token_staging s JOIN github_token_vault t ON t.id=s.token_id WHERE t.user_id=?').bind(user).first()).n,1);
  }});
  assert.equal((await connectionStatus(scope(user),user,config)).github.connected,true);
 });
 for(const cleanup of [false,true])await check('expired staging lease rejects activation'+(cleanup?' after cleanup':''),async()=>{
  const user=await owner();await connect(user,'ghu_preserved');const old=await active(user),revoked=[];
  const transport=provider('unused',{onRevoke:t=>revoked.push(t)});
  await assert.rejects(connect(user,'ghu_expired_stage',{onUser:async()=>{
   await db.prepare("UPDATE github_token_staging SET expires_at='2000-01-01' WHERE token_id IN (SELECT id FROM github_token_vault WHERE user_id=?)").bind(user).run();
   if(cleanup)await cleanupGitHub(db,config,transport);
  },onRevoke:t=>revoked.push(t)}),e=>e.status===409);
  assert.deepEqual(await active(user),old);assert.deepEqual(revoked,['ghu_expired_stage']);
 });
 await check('new flow cancels old staging without changing the active connection',async()=>{
  const user=await owner();await connect(user,'ghu_kept');const old=await active(user),revoked=[];const replacement=await workspaceSession(db,m,identities.get(user)),replacementScope=await replacement.scope();let next;
  await assert.rejects(connect(user,'ghu_superseded',{onUser:async()=>{next=await startGitHub(replacementScope,user,config);},onRevoke:t=>revoked.push(t)}),e=>e.status===409);
  assert.deepEqual(await active(user),old);assert.deepEqual(revoked,['ghu_superseded']);
  await finishGitHub(replacementScope,user,new URL(next.url).searchParams.get('state'),'code',config,provider('ghu_new_flow'));
  assert.equal((await connectionStatus(scope(user),user,config)).github.connected,true);
 });
 await check('retirement failure rolls back replacement before cleanup',async()=>{
  const user=await owner();await connect(user,'ghu_rollback_old');const old=await active(user),revoked=[];
  await db.prepare(`CREATE TRIGGER synthetic_github_failure BEFORE UPDATE OF state ON github_token_vault WHEN OLD.id='${old.active_token_id}' BEGIN SELECT RAISE(ABORT,'synthetic_retirement_failure'); END`).run();
  try{await assert.rejects(connect(user,'ghu_rollback_new',{onRevoke:t=>revoked.push(t)}),e=>e.status===503);assert.deepEqual(await active(user),old);assert.deepEqual(revoked,['ghu_rollback_new']);}
  finally{await db.prepare('DROP TRIGGER synthetic_github_failure').run();}
 });
 await check('expired authorization flow cannot replace the active connection',async()=>{
  const user=await owner();await connect(user,'ghu_flow_old');const old=await active(user),revoked=[];
  await assert.rejects(connect(user,'ghu_flow_expired',{onUser:()=>db.prepare("UPDATE github_oauth_states SET expires_at='2000-01-01' WHERE user_id=?").bind(user).run(),onRevoke:t=>revoked.push(t)}),e=>e.status===409);
  assert.deepEqual(await active(user),old);assert.deepEqual(revoked,['ghu_flow_expired']);
 });
 await check('staging insertion failure leaves no orphan vault credential',async()=>{
  const user=await owner();await connect(user,'ghu_insert_old');const old=await active(user),revoked=[];
  await db.prepare("CREATE TRIGGER synthetic_staging_failure BEFORE INSERT ON github_token_staging BEGIN SELECT RAISE(ABORT,'synthetic_staging_failure'); END").run();
  try{await assert.rejects(connect(user,'ghu_insert_failed',{onRevoke:t=>revoked.push(t)}),e=>e.status===503);
   assert.deepEqual(await active(user),old);assert.deepEqual(revoked,['ghu_insert_failed']);assert.equal((await db.prepare('SELECT COUNT(*) n FROM github_token_vault WHERE user_id=?').bind(user).first()).n,1);
  }finally{await db.prepare('DROP TRIGGER synthetic_staging_failure').run();}
 });
 await check('interactive disconnect does not process another owners queued revocation',async()=>{
  const a=await owner(),b=await owner(),revoked=[];await connect(b,'ghu_other_queue');await disconnectGitHub(scope(b),b,undefined);
  await disconnectGitHub(scope(a),a,config,provider('unused',{onRevoke:t=>revoked.push(t)}));assert.deepEqual(revoked,[]);
  assert.equal((await connectionStatus(scope(b),b,config)).github.revocationPending,true);
  await cleanupGitHub(db,config,provider('unused',{onRevoke:t=>revoked.push(t)}),b);assert.deepEqual(revoked,['ghu_other_queue']);
 });
 await check('late cleaner acknowledgement cannot settle a replacement claim',async()=>{
  const user=await owner();await connect(user,'ghu_claim_fence');await disconnectGitHub(scope(user),user,undefined);
  const ready=deferred(),release=deferred();let timer;
  const first=cleanupGitHub(db,config,provider('unused',{onRevoke:async()=>{ready.resolve();await release.promise;}}),user);
  try{
   await Promise.race([ready.promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Claim barrier timeout')),15000)})]);clearTimeout(timer);
   await db.prepare("UPDATE github_revocation_claims SET expires_at='2000-01-01' WHERE token_id IN (SELECT id FROM github_token_vault WHERE user_id=?)").bind(user).run();
   // A new cleaner takes over, but the provider is unavailable. The old 204
   // cannot delete its retained work after losing the claim.
   await cleanupGitHub(db,config,provider('unused',{revokeStatus:503}),user);
   release.resolve();await first;assert.equal((await connectionStatus(scope(user),user,config)).github.revocationPending,true);
   await cleanupGitHub(db,config,provider('unused'),user);assert.equal((await connectionStatus(scope(user),user,config)).github.revocationPending,false);
  }finally{clearTimeout(timer);release.resolve();await first;}
 });
 console.log(JSON.stringify({suite:'github-token-lifecycle',passed,failed}));if(failed)process.exitCode=1;
}finally{await fixture?.close();}
