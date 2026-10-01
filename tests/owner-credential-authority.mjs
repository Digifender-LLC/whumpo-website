import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';

const built=await build({stdin:{contents:"export {hashToken,newSessionToken} from './src/security';export {default as platform} from './src/index';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {hashToken,newSessionToken,platform}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const directory=await mkdtemp('/tmp/whumpo-credential-authority-');let proxy,failed=0,passed=0;
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r});return {promise,resolve}};

// Pause immediately before the real D1 mutation, after all handler admission reads.
// Statements still execute against disposable D1, including the actual batch guards.
function pauseMutation(db,action){
 const ready=deferred(),release=deferred(),wrapped=new WeakMap();let paused=false;
 const matches=query=>action==='recovery-code'?query.startsWith('INSERT INTO recovery_codes'):query.includes("'passkey.removed'");
 async function intercept(queries){if(!paused&&queries.some(matches)){paused=true;ready.resolve();await release.promise;}}
 function wrap(statement,query){
  const result={bind:(...args)=>wrap(statement.bind(...args),query),first:(...args)=>statement.first(...args),all:(...args)=>statement.all(...args),run:async()=>{await intercept([query]);return statement.run();}};
  wrapped.set(result,{statement,query});return result;
 }
 return {ready:ready.promise,release:release.resolve,DB:{prepare:query=>wrap(db.prepare(query),query),batch:async statements=>{await intercept(statements.map(s=>wrapped.get(s)?.query??''));return db.batch(statements.map(s=>wrapped.get(s)?.statement??s));}}};
}

try{
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','tellumo-control','--local','--persist-to',directory],{stdio:'pipe',maxBuffer:16*1024*1024});
 proxy=await wrangler.getPlatformProxy({persist:{path:directory+'/v3'},remoteBindings:false});const db=proxy.env.DB;
 const environment=database=>({DB:database,ENVIRONMENT:'local',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})}});
 const context={waitUntil(){throw Error('No background work expected')}};
 async function request(path,token,data,database=db){
  return platform.fetch(new Request('http://localhost'+path,{method:'POST',headers:{origin:'http://localhost','content-type':'application/json',...(token?{cookie:'tellumo_session='+token}:{})},body:JSON.stringify(data)}),environment(database),context);
 }
 async function fixture(){
  const user=crypto.randomUUID(),email=user+'@example.test',code=newSessionToken(),token=newSessionToken(),now=new Date().toISOString();
  await db.prepare("INSERT INTO users VALUES(?,?,'00','passkey-only',?)").bind(user,email,now).run();
  await db.prepare('INSERT INTO recovery_codes VALUES(?,?,?)').bind(user,await hashToken(code),now).run();
  const keys=['first-'+user,'backup-'+user];
  for(const key of keys)await db.prepare("INSERT INTO passkeys(id,user_id,public_key,counter,name,created_at) VALUES(?,?,'synthetic',0,'Fixture',?)").bind(key,user,now).run();
  const addSession=async()=>{const value=newSessionToken();await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await hashToken(value),user,new Date(Date.now()+86400000).toISOString(),new Date().toISOString()).run();return value;};
  await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await hashToken(token),user,new Date(Date.now()+86400000).toISOString(),now).run();
  return {user,email,code,token,keys,addSession};
 }
 async function snapshot(user){
  return {
   account:await db.prepare('SELECT password_hash,password_salt FROM users WHERE id=?').bind(user).first(),
   code:await db.prepare('SELECT code_hash FROM recovery_codes WHERE user_id=?').bind(user).first(),
   keys:(await db.prepare('SELECT id FROM passkeys WHERE user_id=? ORDER BY id').bind(user).all()).results,
   sessions:(await db.prepare('SELECT token_hash FROM sessions WHERE user_id=? ORDER BY token_hash').bind(user).all()).results,
   removals:(await db.prepare("SELECT id FROM activity_events WHERE user_id=? AND action='passkey.removed' ORDER BY id").bind(user).all()).results,
  };
 }
 async function deny(response){
  assert.ok([401,409].includes(response.status),'stale credential request must be refused');
  assert.equal(response.headers.get('set-cookie'),null,'denial must not issue or clear another session');
  assert.equal(Object.hasOwn(await response.json(),'recoveryCode'),false,'denial must not return a replacement recovery code');
 }
 async function check(name,run){try{await run();passed++;console.log('PASS '+name);}catch(error){failed++;console.error('FAIL '+name+': '+error.message.split('\n')[0]);}}
 async function revoke(f,kind){
  const response=kind==='recover'
   ?await request('/api/auth/recover',undefined,{email:f.email,code:f.code,nonce:'a'.repeat(64),lostPasskeys:{mode:'none',ids:[]}})
   :await request('/api/profile/password',await f.addSession(),{newPassword:'synthetic-new-password-123'});
  assert.equal(response.status,200,'competing recovery/password request succeeds');
  const cookie=response.headers.get('set-cookie');assert.ok(cookie?.includes('tellumo_session='));
  assert.equal(await db.prepare('SELECT token_hash FROM sessions WHERE token_hash=?').bind(await hashToken(f.token)).first(),null,'old session revoked');
 }
 async function interleave(action,change,{missingCode=false}={}){
  const f=await fixture();if(missingCode)await db.prepare('DELETE FROM recovery_codes WHERE user_id=?').bind(f.user).run();
  const gate=pauseMutation(db,action);
  const pending=request('/api/auth/'+(action==='recovery-code'?'recovery-code':'passkeys/remove'),f.token,action==='recovery-code'?{}:{id:f.keys[0]},gate.DB);
  let timer;try{
   await Promise.race([gate.ready,pending.then(()=>{throw Error('Request completed without reaching mutation barrier')}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Mutation barrier timed out')),15000)})]);
   clearTimeout(timer);await change(f);const expected=await snapshot(f.user);gate.release();
   const response=await pending;await deny(response);
   assert.deepEqual(await snapshot(f.user),expected,'stale request must preserve current credentials, sessions and events');
  }finally{clearTimeout(timer);gate.release();await pending;}
 }

 await check('current owner replaces its recovery code',async()=>{
  const f=await fixture(),before=await snapshot(f.user),response=await request('/api/auth/recovery-code',f.token,{});assert.equal(response.status,200);
  const result=await response.json();assert.match(result.recoveryCode,/^[0-9a-f]{64}$/);assert.notEqual(result.recoveryCode,f.code);
  const after=await snapshot(f.user);assert.equal(after.code.code_hash,await hashToken(result.recoveryCode));assert.deepEqual(after.sessions,before.sessions);assert.deepEqual(after.keys,before.keys);
 });
 await check('current owner can create a missing recovery code',async()=>{
  const f=await fixture();await db.prepare('DELETE FROM recovery_codes WHERE user_id=?').bind(f.user).run();
  const response=await request('/api/auth/recovery-code',f.token,{});assert.equal(response.status,200);
  const result=await response.json(),after=await snapshot(f.user);assert.equal(after.code.code_hash,await hashToken(result.recoveryCode));
 });
 await check('current owner removes one key and signs itself out',async()=>{
  const f=await fixture(),other=await fixture(),untouched=await snapshot(other.user),response=await request('/api/auth/passkeys/remove',f.token,{id:f.keys[0]});
  assert.equal(response.status,200);assert.equal((await response.json()).signedOut,true);
  const after=await snapshot(f.user);assert.deepEqual(after.keys,[{id:f.keys[1]}]);assert.equal(after.sessions.length,0);assert.equal(after.removals.length,1);assert.deepEqual(await snapshot(other.user),untouched);
 });
 await check('foreign and last remaining passkeys cannot be removed',async()=>{
  const f=await fixture(),other=await fixture(),before=await snapshot(other.user);
  assert.equal((await request('/api/auth/passkeys/remove',f.token,{id:other.keys[0]})).status,409);assert.deepEqual(await snapshot(other.user),before);
  await db.prepare('DELETE FROM passkeys WHERE id=?').bind(f.keys[1]).run();const own=await snapshot(f.user);
  assert.equal((await request('/api/auth/passkeys/remove',f.token,{id:f.keys[0]})).status,409);assert.deepEqual(await snapshot(f.user),own);
 });
 for(const action of ['recovery-code','passkey-remove']){
  for(const kind of ['recover','password'])await check(action+' cannot outlive '+kind,()=>interleave(action,f=>revoke(f,kind)));
  await check(action+' rejects expiry after admission',()=>interleave(action,async f=>db.prepare("UPDATE sessions SET expires_at='2000-01-01T00:00:00.000Z' WHERE token_hash=?").bind(await hashToken(f.token)).run()));
  await check(action+' rejects lost freshness after admission',()=>interleave(action,async f=>db.prepare("UPDATE sessions SET created_at='2000-01-01T00:00:00.000Z' WHERE token_hash=?").bind(await hashToken(f.token)).run()));
  for(const field of ['expires_at','created_at'])await check(action+' uses database time for '+field,()=>interleave(action,async f=>{
   // Move the boundary just ahead of the already-prepared mutation, then let
   // real database time cross it. A captured JS timestamp would still admit it.
   await db.prepare(`UPDATE sessions SET ${field}=strftime('%Y-%m-%dT%H:%M:%fZ','now',${field==='created_at'?"'-10 minutes',":''}'+0.2 seconds') WHERE token_hash=?`).bind(await hashToken(f.token)).run();
   await new Promise(resolve=>setTimeout(resolve,300));
  }));
  await check(action+' requires the session to still belong to the same owner',()=>interleave(action,async f=>{
   const other=await fixture();await db.prepare('UPDATE sessions SET user_id=? WHERE token_hash=?').bind(other.user,await hashToken(f.token)).run();
  }));
 }
 // Exercise the INSERT as well as ON CONFLICT replacement path after revocation.
 await check('revoked request cannot create an absent recovery code',()=>interleave('recovery-code',f=>revoke(f,'password'),{missingCode:true}));

 await check('passkey body delayed across recovery cannot delete recovered state',async()=>{
  const f=await fixture(),bodyRead=deferred();let controller;
  const stream=new ReadableStream({start(value){controller=value},pull(){bodyRead.resolve();}},{highWaterMark:0});
  const pending=platform.fetch(new Request('http://localhost/api/auth/passkeys/remove',{method:'POST',headers:{origin:'http://localhost',cookie:'tellumo_session='+f.token,'content-type':'application/json'},body:stream,duplex:'half'}),environment(db),context);
  let timer;try{
   await Promise.race([bodyRead.promise,pending.then(()=>{throw Error('Request completed before reading the delayed body')}),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Body read timed out')),15000)})]);
   clearTimeout(timer);await revoke(f,'recover');const expected=await snapshot(f.user);
   controller.enqueue(new TextEncoder().encode(JSON.stringify({id:f.keys[0]})));controller.close();
   await deny(await pending);assert.deepEqual(await snapshot(f.user),expected,'late body must not remove retained keys or fresh sessions');
  }finally{clearTimeout(timer);try{controller.close()}catch{}await pending;}
 });
 await check('failed passkey cleanup rolls back its authority receipt',async()=>{
  const f=await fixture(),before=await snapshot(f.user);
  await db.prepare("CREATE TRIGGER synthetic_credential_failure BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT,'synthetic_credential_cleanup_failure'); END").run();
  try{assert.equal((await request('/api/auth/passkeys/remove',f.token,{id:f.keys[0]})).status,500);assert.deepEqual(await snapshot(f.user),before);}
  finally{await db.prepare('DROP TRIGGER synthetic_credential_failure').run();}
 });
 console.log(JSON.stringify({suite:'owner-credential-authority',passed,failed}));if(failed)process.exitCode=1;
}catch(error){console.error(error.message.split('\n')[0]);process.exitCode=1;}finally{await proxy?.dispose();await rm(directory,{recursive:true,force:true});}
