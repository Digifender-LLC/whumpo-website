import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
const built=await build({stdin:{contents:"export {recoverAccount} from './src/passkeys';export {hashToken} from './src/security';export {default as platform} from './src/index';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {recoverAccount,hashToken,platform}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const dir=await mkdtemp('/tmp/whumpo-owner-recovery-');let proxy;
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}};
try{
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
 proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB;
 async function fixture(){
  const user=crypto.randomUUID(),email=user+'@example.test',code=crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-',''),now=new Date().toISOString();
  await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(user,email,now).run();
  await db.prepare('INSERT INTO recovery_codes VALUES(?,?,?)').bind(user,await hashToken(code),now).run();
  const key=async id=>db.prepare("INSERT INTO passkeys(id,user_id,public_key,counter,name,created_at) VALUES(?,?,'fixture',0,'Synthetic',?)").bind(id,user,now).run();
  const session=async id=>db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(id,user,'2099-01-01T00:00:00.000Z',now).run();
  await key('original-'+user);await session('old-'+user);
  return {user,email,code,key,session,request:{email,code,nonce:'b'.repeat(64)}};
 }
 // Both attempts pass the identity read before either transaction starts. The losing
 // transaction runs after the winner has enrolled a new key and received a session.
 for(const [winningMode,losingMode] of [['all','all'],['none','all'],['some','some']]){
  const f=await fixture(),ready=deferred(),release=deferred();let batches=0;
  const paused={prepare:q=>db.prepare(q),batch:async statements=>{if(++batches===1){ready.resolve();await release.promise;}return db.batch(statements)}};
  const losing=recoverAccount({DB:paused},{...f.request,lostPasskeys:{mode:losingMode,ids:losingMode==='some'?['original-'+f.user]:[]}}).then(value=>({value}),error=>({error}));
  await ready.promise;
  await recoverAccount({DB:db},{...f.request,lostPasskeys:{mode:winningMode,ids:winningMode==='some'?['original-'+f.user]:[]}});
  await f.key('replacement-'+f.user);await f.session('new-'+f.user);
  release.resolve();const result=await losing;assert.equal(result.error?.status,409);
  assert.ok(await db.prepare('SELECT id FROM passkeys WHERE id=?').bind('replacement-'+f.user).first(),'losing recovery must not remove a replacement key');
  assert.ok(await db.prepare('SELECT token_hash FROM sessions WHERE token_hash=?').bind('new-'+f.user).first(),'losing recovery must not revoke a new session');
  assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM activity_events WHERE user_id=? AND action='account.recovered'").bind(f.user).first()).n,1,'exactly one recovery event');
  assert.equal(Boolean(await db.prepare('SELECT id FROM passkeys WHERE id=?').bind('original-'+f.user).first()),winningMode==='none');
 }
 // A newer recovery between rotation and session creation invalidates the older
 // completion, even when the older handler still holds a verified user object.
 const delayed=await fixture();let intercepted=false;const rawStatements=new WeakMap();
 const sessionRace={batch:statements=>db.batch(statements.map(s=>rawStatements.get(s)??s)),prepare(query){const statement=db.prepare(query);return {bind(...args){const bound=statement.bind(...args);const wrapped={first:()=>bound.first(),all:()=>bound.all(),run:async()=>{
  if(query.startsWith('INSERT INTO sessions (')&&!intercepted){intercepted=true;
   const code=await hashToken(`whumpo-owner-recovery-v1|${delayed.code}|${delayed.request.nonce}`);
   await recoverAccount({DB:db},{email:delayed.email,code,nonce:'c'.repeat(64),lostPasskeys:{mode:'none',ids:[]}});
   await delayed.session('latest-'+delayed.user);
  }
  return bound.run();
 }};rawStatements.set(wrapped,bound);return wrapped;}}}};
 const response=await platform.fetch(new Request('http://localhost/api/auth/recover',{method:'POST',headers:{origin:'http://localhost','content-type':'application/json'},body:JSON.stringify({...delayed.request,lostPasskeys:{mode:'none',ids:[]}})}),{DB:sessionRace,ENVIRONMENT:'local',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})}},{waitUntil(){throw Error('No background work expected')}});
 assert.ok(intercepted);assert.equal(response.status,401,'superseded recovery must not issue a new session');assert.equal(response.headers.get('set-cookie'),null);
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id=?').bind(delayed.user).first()).n,1);
 // Failure in a cleanup statement rolls back code rotation, audit and key removal.
 const f=await fixture();await db.prepare("CREATE TRIGGER synthetic_recovery_failure BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT,'synthetic_cleanup_failure'); END").run();
 await assert.rejects(recoverAccount({DB:db},{...f.request,lostPasskeys:{mode:'all',ids:[]}}),/synthetic_cleanup_failure/);
 assert.equal((await db.prepare('SELECT code_hash FROM recovery_codes WHERE user_id=?').bind(f.user).first()).code_hash,await hashToken(f.code));
 assert.ok(await db.prepare('SELECT id FROM passkeys WHERE id=?').bind('original-'+f.user).first());
 assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM activity_events WHERE user_id=?').bind(f.user).first()).n,0);
 console.log('Owner recovery concurrency passed: duplicate and conflicting same-code attempts cannot remove replacement credentials/sessions or duplicate activity; cleanup failure rolls back the transaction.');
}catch(error){console.error(error.message);process.exitCode=1;}finally{await proxy?.dispose();await rm(dir,{recursive:true,force:true});}
