import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,workspaceSession} from './helpers/workspace-identity.mjs';

// WH-201 (and the unfinished WH-200 handler suites): the verified email change over the current schema on disposable in-memory
// SQLite and, with --d1, actual local D1. The REAL trusted HTTP adapter (src/email-change/http.ts) runs over the real workspace
// identity (admitted scopes, fresh-passkey elevation), the real store and the real schema triggers, with the synthetic mailer of
// src/email-change/token.ts as the only "provider": no network, no secret, no real address (every address is under .test).
const bundle=await build({stdin:{contents:[
 "export * from './src/email-change/http';export * from './src/email-change/store';export * from './src/email-change/token';export * from './src/email-change/maintenance';",
 "export {admitWorkspace} from './src/workspace-identity/admission';export {resolveIdentity} from './src/workspace-identity/authority';export {newSessionToken,hashToken} from './src/security';",
 "export {emailChangeBounds} from './src/email-change/policy';export {addressKey} from './src/email-change/change';",
 ].join(''),resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const fixture=await databaseFixture(),db=fixture.db;
const id=()=>crypto.randomUUID(),run=(sql,...v)=>db.prepare(sql).bind(...v).run(),all=async(sql,...v)=>(await db.prepare(sql).bind(...v).all()).results,one=(sql,...v)=>db.prepare(sql).bind(...v).first();
const count=async table=>(await one(`SELECT count(*) n FROM ${table}`)).n;
const rejects=(promise,pattern)=>assert.rejects(promise,pattern);
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(e){console.error('FAILED:',name);throw e;}};
const origin='https://whumpo.com';
let limited=false;const env={AUTH_LIMITER:{limit:async()=>({success:!limited})}};
// A queue standing in for the WH-156 outbox that WH-202 will provide. It stores only content-free drafts.
const outbox=[];
const delivery={queue:async(drafts,changeId)=>{for(const draft of drafts)outbox.push(m.queueNotice(draft,id(),Date.now()));void changeId;}};
const owner=async(proofOffset=-5)=>{const o=await workspaceFixture(db,m,id(),proofOffset);o.email=(await one('SELECT email FROM users WHERE id=?',o.account)).email;return o;};
async function call(o,action,body,{method='POST',headers={},delivery:d=delivery,raw,query=''}={}){
 const request=new Request(`${origin}/api/account/email${action?'/'+action:''}${query}`,{method,headers:{origin,'content-type':'application/json',...headers},body:method==='GET'?undefined:raw??JSON.stringify(body)});
 // The Worker's top-level handler turns an identity refusal into its response; so does this harness.
 let response;
 try{const principal=await m.resolveIdentity(db,{version:1,client:'web',kind:'session',token:o.token}),scoped=m.admitWorkspace(db,principal);response=await m.accountEmailRoute(request,env,scoped,principal,{delivery:d});}
 catch(error){if(error?.name==='IdentityError')return {status:error.status,data:{code:error.code},text:JSON.stringify({code:error.code})};throw error;}
 assert.ok(response,'route matched');assert.equal(response.headers.get('cache-control'),'no-store');
 const text=await response.text();return {status:response.status,data:JSON.parse(text),text};
}
const change=(o,address,requestId=id())=>call(o,'change',{version:1,requestId,newAddress:address});
const mailer=m.createSyntheticMailer();
const sentTo=(address)=>mailer.calls.filter(c=>c.to===address);
// One delivery attempt for the oldest queued notice addressed to `address` (the mailer is the only place a token exists).
async function deliver(kind,address){
 const notice=outbox.find(n=>n.state==='queued'&&n.kind===kind&&n.to===address);assert.ok(notice,`queued ${kind} to ${address}`);
 const step=await m.deliverStored(db,notice,mailer,Date.now());Object.assign(notice,step.notice);return step;
}
const tokenTo=address=>mailer.calls.filter(c=>c.to===address&&c.token).at(-1)?.token;
const addr=name=>`${name}-${id().slice(0,8)}@example.test`;

try{
 await check('delivery inactive: a change request returns delivery_unavailable and stores nothing',async()=>{
  const a=await owner(),before=[await count('owner_email_changes'),await count('owner_email_change_limits'),outbox.length];
  const r=await call(a,'change',{version:1,requestId:id(),newAddress:addr('new')},{delivery:null});
  assert.equal(r.status,200);assert.deepEqual(r.data,{version:1,status:'delivery_unavailable'});
  assert.deepEqual([await count('owner_email_changes'),await count('owner_email_change_limits'),outbox.length],before);
  // The read says so up front, and still works without a sender.
  const view=await call(a,'',undefined,{method:'GET',delivery:null});
  assert.equal(view.status,200);assert.deepEqual(view.data,{version:1,email:a.email,verified:false,pending:null,undo:null,deliveryAvailable:false});
  // A stale passkey is refused before the delivery gate is even reported.
  const stale=await owner(-700);assert.equal((await call(stale,'change',{version:1,requestId:id(),newAddress:addr('x')},{delivery:null})).status,401);
 });
 await check('closed input, Origin, body size, content type and rate limit are enforced before anything is stored',async()=>{
  const a=await owner(),before=await count('owner_email_changes'),ok={version:1,requestId:id(),newAddress:addr('c')};
  assert.equal((await call(a,'change',ok,{headers:{origin:'https://elsewhere.invalid'}})).status,403);
  assert.equal((await call(a,'change',ok,{headers:{origin:''}})).status,403);
  assert.equal((await call(a,'change',ok,{headers:{'content-type':'text/plain'}})).status,400);
  assert.equal((await call(a,'change',{...ok,padding:'x'.repeat(5000)})).status,400);
  assert.equal((await call(a,'change',{...ok,password:'hunter2'})).data.code,'invalid_request');
  for(const field of ['recoveryCode','magicLink','emailCode','otp','passwordHash','newPassword'])assert.equal((await call(a,'change',{...ok,[field]:'x'})).status,400,field);
  assert.equal((await call(a,'change',{...ok,extra:1})).status,400);assert.equal((await call(a,'change',{...ok,version:2})).status,409);
  assert.equal((await call(a,'change',{...ok,newAddress:'not an address'})).data.code,'invalid_address');
  assert.equal((await call(a,'change',{...ok,newAddress:a.email})).data.code,'no_change');
  assert.equal((await call(a,'change',undefined,{raw:'{"version":1,'})).status,400);
  assert.equal((await call(a,'change',ok,{query:'?x=1'})).status,400);
   limited=true;assert.equal((await call(a,'change',ok)).status,429);limited=false;
  assert.equal(await count('owner_email_changes'),before);assert.equal(outbox.filter(n=>n.to===ok.newAddress).length,0);
  assert.equal((await call(a,'',undefined,{method:'GET',query:'?x=1'})).status,400);
  assert.equal((await call(a,'',undefined,{method:'DELETE'})).status,404);
 });
 await check('request, identical response whether or not the address is free, notices queued, token minted only in the delivery attempt',async()=>{
  const a=await owner(),b=await owner(),free=addr('free');
  const first=await change(a,free);assert.equal(first.status,200);assert.equal(first.data.status,'pending-confirmation');assert.match(first.data.changeId,/^[0-9a-f-]{36}$/);
  const row=await one('SELECT * FROM owner_email_changes WHERE change_id=?',first.data.changeId);
  assert.equal(row.state,'pending');assert.equal(row.token_verifier,null,'no token exists before a claimed delivery');assert.equal(row.deliverable,1);assert.equal(row.expires_at-row.created_at,3600000);
  assert.equal(row.epoch,1);assert.equal(row.new_address,free);
  assert.deepEqual(outbox.filter(n=>n.changeId===first.data.changeId).map(n=>[n.kind,n.to]).sort(),[['change-requested',a.email],['confirm-new-address',free]].sort());
  assert.ok(outbox.every(n=>!('token' in n)),'a queued notice holds no token');
  // Same request ID, same payload: the saved response, no second change. A different payload is a conflict.
  const requestId=id(),replayed=await change(a,free,requestId),again=await change(a,free,requestId);
  assert.equal(replayed.text,again.text);assert.equal(await count("owner_email_changes WHERE account_id='"+a.account+"'"),2,'a replay adds no change');
  assert.equal((await change(a,addr('other'),requestId)).data.code,'request_conflict');
  // An address another account uses gets the SAME response and state, but no confirmation message.
  const taken=await change(b,a.email);assert.equal(taken.status,200);assert.deepEqual(Object.keys(taken.data).sort(),Object.keys(first.data).sort());
  const held=await one('SELECT deliverable,token_verifier FROM owner_email_changes WHERE change_id=?',taken.data.changeId);assert.equal(held.deliverable,0);assert.equal(held.token_verifier,null);
  assert.equal(outbox.filter(n=>n.changeId===taken.data.changeId&&n.kind==='confirm-new-address').length,0);
  assert.equal(outbox.filter(n=>n.changeId===taken.data.changeId&&n.kind==='change-requested').length,1);
 });
 await check('supersede: a new request closes the earlier change and its token is refused as stale',async()=>{
  const a=await owner(),x1=addr('one'),x2=addr('two');
  const c1=(await change(a,x1)).data.changeId;const step1=await deliver('confirm-new-address',x1);assert.equal(step1.outcome,'accepted');
  const token1=tokenTo(x1);assert.match(token1,/^[A-Za-z0-9_-]{43}$/);
  const stored=await one('SELECT token_verifier FROM owner_email_changes WHERE change_id=?',c1);assert.equal(stored.token_verifier,await m.hashToken(token1),'only the SHA-256 verifier is stored');
  const c2=(await change(a,x2)).data.changeId;
  assert.equal((await one('SELECT state FROM owner_email_changes WHERE change_id=?',c1)).state,'superseded');
  assert.equal((await one('SELECT state FROM owner_email_changes WHERE change_id=?',c2)).state,'pending');
  assert.equal((await all("SELECT change_id FROM owner_email_changes WHERE account_id=? AND state='pending'",a.account)).length,1);
  const stale=await call(a,'confirm',{version:1,token:token1});assert.equal(stale.status,409);assert.equal(stale.data.code,'stale_change');
  assert.equal((await one('SELECT email FROM users WHERE id=?',a.account)).email,a.email,'a superseded token changes nothing');
  // The superseded change's unsent confirmation is cancelled, never minting a token.
  const second=outbox.find(n=>n.changeId===c1&&n.kind==='change-requested');assert.ok(second);
  const unsent=outbox.find(n=>n.changeId===c1&&n.kind==='confirm-new-address');assert.equal(unsent.state,'accepted');
  const lateNotice=m.queueNotice({kind:'confirm-new-address',changeId:c1,to:x1},id(),Date.now());
  assert.equal((await m.deliverStored(db,lateNotice,mailer,Date.now())).outcome,'cancelled');assert.equal(sentTo(x1).filter(c=>c.token).length,1);
 });
 await check('confirm needs the token AND the owner session; replays are idempotent; foreign tokens are refused generically; token reuse after undo is closed',async()=>{
  const a=await owner(),b=await owner(),x=addr('confirm');
  const changeId=(await change(a,x)).data.changeId;await deliver('confirm-new-address',x);const token=tokenTo(x);
  // Another account presenting the token learns nothing and the change is untouched.
  const foreign=await call(b,'confirm',{version:1,token});assert.equal(foreign.status,400);assert.equal(foreign.data.code,'invalid_token');
  assert.equal((await one('SELECT state FROM owner_email_changes WHERE change_id=?',changeId)).state,'pending');
  assert.equal((await one("SELECT count(*) n FROM owner_email_change_limits WHERE kind='failure' AND account_id=?",b.account)).n,1);
  assert.equal((await call(a,'confirm',{version:1,token:'x'.repeat(200)})).data.code,'invalid_token');
  assert.equal((await call(a,'confirm',{version:1,token:'not-the-token'})).data.code,'invalid_token');
  const ok=await call(a,'confirm',{version:1,token});assert.equal(ok.status,200);assert.equal(ok.data.status,'confirmed');assert.equal(ok.data.email,x);
  const user=await one('SELECT email,email_verified_at,email_verified_via FROM users WHERE id=?',a.account);
  assert.equal(user.email,x);assert.equal(user.email_verified_via,'notify@whumpo.com');assert.ok(Math.abs(user.email_verified_at-Date.now())<60000);assert.equal(user.email_verified_at,ok.data.verifiedAt);
  const row=await one('SELECT * FROM owner_email_changes WHERE change_id=?',changeId);
  assert.equal(row.state,'confirmed');assert.equal(row.previous_address,a.email);assert.equal(row.previous_verified_at,null,'the previous state was unverified');assert.equal(row.undo_until-row.receipt_verified_at,7*86400000);
  assert.equal(row.epoch,1);assert.equal((await one('SELECT auth_epoch FROM identity_accounts WHERE account_id=?',a.account)).auth_epoch,1,'confirmation does not advance the epoch');
  assert.equal(outbox.filter(n=>n.changeId===changeId&&n.kind==='change-completed').map(n=>n.to).join(),a.email,'the previous address is told, with no token or new address in the draft');
  // A lost reply: the same token by the same account returns the saved receipt, with no second effect.
  const revision=row.revision,replay=await call(a,'confirm',{version:1,token});assert.equal(replay.text,ok.text);
  assert.equal((await one('SELECT revision FROM owner_email_changes WHERE change_id=?',changeId)).revision,revision);assert.equal(outbox.filter(n=>n.changeId===changeId&&n.kind==='change-completed').length,1);
  // Recovery still uses the CURRENT address as the lookup key only; a read shows the new verified state and an undo option.
  const view=await call(a,'',undefined,{method:'GET'});assert.equal(view.data.email,x);assert.equal(view.data.verified,true);assert.equal(view.data.undo.changeId,changeId);
  // Undo within the window with a fresh passkey: the previous address AND previous (unverified) state, nothing invented.
  const undone=await call(a,'undo',{version:1,changeId});assert.equal(undone.status,200);assert.equal(undone.data.status,'undone');assert.equal(undone.data.email,a.email);
  const back=await one('SELECT email,email_verified_at,email_verified_via FROM users WHERE id=?',a.account);assert.deepEqual({...back},{email:a.email,email_verified_at:null,email_verified_via:null});
  assert.equal(outbox.filter(n=>n.changeId===changeId&&n.kind==='change-undone').map(n=>n.to).sort().join(),[a.email,x].sort().join());
  // The token is now closed: reuse after the undo is refused and changes nothing.
  const reuse=await call(a,'confirm',{version:1,token});assert.equal(reuse.status,409);assert.equal(reuse.data.code,'change_closed');
  assert.equal((await one('SELECT email FROM users WHERE id=?',a.account)).email,a.email);
  assert.equal((await call(a,'undo',{version:1,changeId})).data.code,'undo_unavailable');
 });
 await check('undo and request need a fresh passkey; cancel needs only the session and is idempotent',async()=>{
  const a=await owner(),x=addr('cancel'),changeId=(await change(a,x)).data.changeId;
  const old=await workspaceSession(db,m,a,-700);
  assert.equal((await call(old,'change',{version:1,requestId:id(),newAddress:addr('y')})).data.code,'proof_required');
  const cancelled=await call(old,'cancel',{version:1,changeId});assert.equal(cancelled.status,200);assert.equal(cancelled.data.status,'cancelled');
  assert.equal((await call(old,'cancel',{version:1,changeId})).status,200,'cancel is idempotent');
  assert.equal((await one('SELECT state FROM owner_email_changes WHERE change_id=?',changeId)).state,'cancelled');
  assert.equal((await call(old,'cancel',{version:1,changeId:id()})).data.code,'unknown_change');
  // A cancelled change cannot be confirmed, even with a token minted earlier.
  const y=addr('claimed'),c2=(await change(a,y)).data.changeId;await deliver('confirm-new-address',y);const token=tokenTo(y);
  await call(old,'cancel',{version:1,changeId:c2});assert.equal((await call(a,'confirm',{version:1,token})).data.code,'change_closed');
  assert.equal((await call(old,'undo',{version:1,changeId:c2})).data.code,'proof_required');
 });
 await check('another account\'s change is never visible or actionable',async()=>{
  const a=await owner(),b=await owner(),changeId=(await change(a,addr('mine'))).data.changeId;
  assert.equal((await call(b,'cancel',{version:1,changeId})).data.code,'unknown_change');assert.equal((await call(b,'undo',{version:1,changeId})).data.code,'unknown_change');
  assert.equal((await call(b,'',undefined,{method:'GET'})).data.pending,null);assert.equal((await one('SELECT state FROM owner_email_changes WHERE change_id=?',changeId)).state,'pending');
 });
 await check('expiry: an expired token is refused and the change is closed; epoch advance makes a pending change stale',async()=>{
  const a=await owner(),x=addr('late');
  // An aged pending change (a request two hours ago) with its limit evidence, written through the schema's own insert checks.
  const insertPending=async(o,address,age,deliverable=1)=>{
   const changeId=id(),now=Date.now(),epoch=(await one('SELECT auth_epoch FROM identity_accounts WHERE account_id=?',o.account)).auth_epoch;
   await run("INSERT INTO owner_email_change_limits(kind,account_id,at) VALUES('request',?,?)",o.account,now);
   if(deliverable)await run("INSERT INTO owner_email_change_limits(kind,address_key,at) VALUES('send',?,?)",await m.addressKey(address),now);
   await run("INSERT INTO owner_email_changes(change_id,account_id,request_id,request_hash,new_address,new_address_hash,epoch,created_at,expires_at,state,revision,history,deliverable,token_verifier) VALUES(?,?,?,?,?,?,?,?,?,'pending',1,'[\"pending\"]',?,?)",
    changeId,o.account,id(),'a'.repeat(64),address,await m.addressKey(address),epoch,now-age,now-age+3600000,deliverable,null);
   return changeId;
  };
  const token='expired-token-'+id(),verifier=await m.hashToken(token);
  const stale=await insertPending(a,x,7200000);await run("UPDATE owner_email_changes SET token_verifier=?,revision=2 WHERE change_id=?",verifier,stale).catch(e=>String(e));
  // The claim trigger refuses a verifier on an expired change, so the aged row has none: the token cannot even be stored.
  assert.equal((await one('SELECT token_verifier FROM owner_email_changes WHERE change_id=?',stale)).token_verifier,null);
  const maintenance=await m.maintainEmailChanges(db);assert.ok(maintenance.expired>=1);
  assert.deepEqual({...await one('SELECT state,revision,new_address FROM owner_email_changes WHERE change_id=?',stale)},{state:'expired',revision:3,new_address:null},'expired at revision 2, plaintext address redacted at revision 3');
  // Epoch: a pending change from epoch 1 is stale after any epoch advance (passkey removal, kit rotation, compromise commit).
  const b=await owner(),y=addr('epoch'),changeId=(await change(b,y)).data.changeId;await deliver('confirm-new-address',y);const t=tokenTo(y);
  await run('UPDATE identity_accounts SET auth_epoch=auth_epoch+1 WHERE account_id=?',b.account);
  assert.equal((await call(b,'confirm',{version:1,token:t})).status,401,'the epoch fence refuses the old session');
  const fresh=await workspaceSession(db,m,b,-5);
  const refused=await call(fresh,'confirm',{version:1,token:t});assert.equal(refused.status,409);assert.equal(refused.data.code,'stale_change');
  assert.equal((await one('SELECT state FROM owner_email_changes WHERE change_id=?',changeId)).state,'stale');assert.equal((await one('SELECT email FROM users WHERE id=?',b.account)).email,b.email);
 });
 await check('rate limits: 3 requests per account per day, 3 messages per destination per day, 5 failed confirmations per hour',async()=>{
  const a=await owner();
  for(let n=0;n<3;n++)assert.equal((await change(a,addr('r'+n))).status,200);
  assert.equal((await change(a,addr('r4'))).data.code,'rate_limited');assert.equal((await count("owner_email_change_limits WHERE kind='request' AND account_id='"+a.account+"'")),3);
  // Excess sends to ONE destination across accounts get the same response and no message.
  const shared=addr('shared'),sends=[];
  for(let n=0;n<4;n++){const o=await owner();const r=await change(o,shared);assert.equal(r.status,200);sends.push((await one('SELECT deliverable FROM owner_email_changes WHERE change_id=?',r.data.changeId)).deliverable);}
  assert.deepEqual(sends,[1,1,1,0]);
  const f=await owner();for(let n=0;n<5;n++)assert.equal((await call(f,'confirm',{version:1,token:'bad-token-'+n})).data.code,'invalid_token');
  assert.equal((await call(f,'confirm',{version:1,token:'bad-token-6'})).data.code,'rate_limited');
  // The database repeats the bounds, even for a writer that skips the module.
  await rejects(run("INSERT INTO owner_email_change_limits(kind,account_id,at) VALUES('failure',?,?)",f.account,Date.now()),/email_change_rate_limited/);
  await rejects(run("INSERT INTO owner_email_change_limits(kind,account_id,at) VALUES('request',?,?)",a.account,Date.now()),/email_change_rate_limited/);
 });
 await check('a previous address stays reserved during the undo window: no other account can claim it, sign up with it or reach it by recovery',async()=>{
  const a=await owner(),x=addr('moved'),prev=a.email;
  const changeId=(await change(a,x)).data.changeId;await deliver('confirm-new-address',x);await call(a,'confirm',{version:1,token:tokenTo(x)});
  const c=await owner(),r=await change(c,prev);assert.equal(r.status,200);
  assert.equal((await one('SELECT deliverable FROM owner_email_changes WHERE change_id=?',r.data.changeId)).deliverable,0,'a reserved address looks free to the requester and receives nothing');
  await rejects(run("INSERT INTO users(id,email,created_at) VALUES(?,?,'2026-10-28')",id(),prev),/users_email_new/);
  await rejects(run('UPDATE users SET email=? WHERE id=?',prev,c.account),/users_email_lockstep/);
  assert.equal((await one('SELECT email FROM users WHERE id=?',a.account)).email,x);void changeId;
 });
 await check('restore and forward repair cannot revive a superseded change, a used token, an earlier verification state or an earlier address',async()=>{
  const a=await owner(),x1=addr('r1'),x2=addr('r2');
  const c1=(await change(a,x1)).data.changeId;await deliver('confirm-new-address',x1);const t1=tokenTo(x1);
  const c2=(await change(a,x2)).data.changeId;await deliver('confirm-new-address',x2);const t2=tokenTo(x2);
  assert.equal((await call(a,'confirm',{version:1,token:t2})).status,200);
  const verified=await one('SELECT email,email_verified_at,email_verified_via FROM users WHERE id=?',a.account);
  const closed=await one('SELECT * FROM owner_email_changes WHERE change_id=?',c1);assert.equal(closed.state,'superseded');
  // 1. A superseded change cannot be reopened, re-claimed, re-tokened or have its history rewritten.
  await rejects(run("UPDATE owner_email_changes SET state='pending',revision=revision+1,history='[\"pending\"]' WHERE change_id=?",c1),/email_change_(?:transition|history)/);
  await rejects(run("UPDATE owner_email_changes SET state='confirmed',revision=revision+1,history=json_insert(history,'$[#]','confirmed') WHERE change_id=?",c1),/email_change_(?:transition|history)/);
  await rejects(run('UPDATE owner_email_changes SET token_verifier=NULL,revision=revision+1 WHERE change_id=?',c1),/email_change_frozen/);
  await rejects(run('UPDATE owner_email_changes SET revision=revision WHERE change_id=?',c1),/email_change_revision/);
  await rejects(run('UPDATE owner_email_changes SET expires_at=expires_at+86400000,revision=revision+1 WHERE change_id=?',c1),/email_change_immutable/);
  // 2. The used token: its confirmed change cannot go back to pending, lose its verifier or take another token.
  await rejects(run("UPDATE owner_email_changes SET state='pending',revision=revision+1,history='[\"pending\"]',receipt_verified_at=NULL,undo_until=NULL,previous_address=NULL WHERE change_id=?",c2),/email_change_(?:transition|history)/);
  await rejects(run('UPDATE owner_email_changes SET token_verifier=?,revision=revision+1 WHERE change_id=?','f'.repeat(64),c2),/email_change_frozen/);
  // 3. A deleted-and-reinserted pending copy (what a row-level restore would do) is refused: a closed change cannot be deleted
  //    while its account exists, and an insert is always a fresh pending change bound to the current epoch with its limit evidence.
  await rejects(run('DELETE FROM owner_email_changes WHERE change_id=?',c1),/email_change_retained/);
  await rejects(run('DELETE FROM owner_email_changes WHERE change_id=?',c2),/email_change_retained/);
  await rejects(run("INSERT INTO owner_email_changes(change_id,account_id,request_id,request_hash,new_address,new_address_hash,epoch,created_at,expires_at,state,revision,history,deliverable,token_verifier,previous_address,receipt_verified_at,undo_until) VALUES(?,?,?,?,?,?,1,?,?,'confirmed',1,'[\"pending\"]',1,?,?,?,?)",
   id(),a.account,id(),'a'.repeat(64),x1,await m.addressKey(x1),Date.now(),Date.now()+3600000,'e'.repeat(64),a.email,Date.now(),Date.now()+604800000),/email_change_new|CHECK/);
  await rejects(run("INSERT INTO owner_email_changes(change_id,account_id,request_id,request_hash,new_address,new_address_hash,epoch,created_at,expires_at,state,revision,history,deliverable) VALUES(?,?,?,?,?,?,0,?,?,'pending',1,'[\"pending\"]',0)",
   id(),a.account,id(),'a'.repeat(64),x1,await m.addressKey(x1),Date.now(),Date.now()+3600000),/CHECK|email_change/);
  // 4. The verification state moves only with the address and a change row: an earlier state cannot be written back.
  await rejects(run('UPDATE users SET email_verified_at=NULL,email_verified_via=NULL WHERE id=?',a.account),/users_email_lockstep/);
  await rejects(run('UPDATE users SET email=?,email_verified_at=NULL,email_verified_via=NULL WHERE id=?',a.email,a.account),/users_email_lockstep/);
  await rejects(run('UPDATE users SET email_verified_at=email_verified_at-1000 WHERE id=?',a.account),/users_email_lockstep/);
  await rejects(run("UPDATE users SET email=?,email_verified_at=?,email_verified_via='notify@whumpo.com' WHERE id=?",addr('forged'),Date.now(),a.account),/users_email_lockstep/);
  await rejects(run("UPDATE users SET email_verified_via='someone@else.test' WHERE id=?",a.account),/CHECK|users_email_lockstep/);
  assert.deepEqual({...await one('SELECT email,email_verified_at,email_verified_via FROM users WHERE id=?',a.account)},{...verified});
  // 5. Replaying the superseded token or a stale confirmation changes nothing.
  assert.equal((await call(a,'confirm',{version:1,token:t1})).data.code,'stale_change');
  assert.deepEqual({...await one('SELECT email,email_verified_at,email_verified_via FROM users WHERE id=?',a.account)},{...verified});
  // 6. After an undo, the earlier (unverified) state is the CURRENT one by the change row; the confirmed state cannot be revived either.
  assert.equal((await call(a,'undo',{version:1,changeId:c2})).status,200);
  await rejects(run("UPDATE users SET email=?,email_verified_at=?,email_verified_via='notify@whumpo.com' WHERE id=?",x2,verified.email_verified_at,a.account),/users_email_lockstep/);
  await rejects(run("UPDATE owner_email_changes SET state='confirmed',revision=revision+1,history=json_insert(history,'$[#]','confirmed') WHERE change_id=?",c2),/email_change_(?:transition|history)/);
  assert.equal((await one('SELECT email FROM users WHERE id=?',a.account)).email,a.email);
 });
 await check('maintenance is bounded and on the database clock: expiry, redaction after the window, 30-day retention, 48-hour limits, nothing early',async()=>{
  const a=await owner(),x=addr('maint');
  const changeId=(await change(a,x)).data.changeId;await deliver('confirm-new-address',x);await call(a,'confirm',{version:1,token:tokenTo(x)});
  // Nothing is touched early: the undo window protects the plaintext addresses and the row, in the schema as well as in the job.
  await m.maintainEmailChanges(db);
  const open=await one('SELECT new_address,previous_address FROM owner_email_changes WHERE change_id=?',changeId);assert.equal(open.new_address,x);assert.equal(open.previous_address,a.email);
  await rejects(run('UPDATE owner_email_changes SET new_address=NULL,revision=revision+1 WHERE change_id=?',changeId),/email_change_frozen/);
  await rejects(run('DELETE FROM owner_email_changes WHERE change_id=?',changeId),/email_change_retained/);
  await rejects(run('DELETE FROM owner_email_change_limits WHERE account_id=?',a.account),/email_change_limit_retained/);
  const bounded=await m.maintainEmailChanges(db,1);for(const v of Object.values(bounded))assert.ok(v<=1,'each statement is bounded by the limit');
  await rejects(m.maintainEmailChanges(db,0),/Invalid maintenance bounds/);await rejects(m.maintainEmailChanges(db,1001),/Invalid maintenance bounds/);
  // A change that closed long ago is expired, stripped of its plaintext addresses and deleted, in that order. Such a row can only be
  // inserted already old (its pending insert is checked, then the job closes it), because no writer may rewrite time.
  const old=await owner(),oldId=id(),oldAddress=addr('old'),cutoff=Date.now()-40*86400000;
  await run("INSERT INTO owner_email_change_limits(kind,account_id,at) VALUES('request',?,?)",old.account,Date.now());
  await run("INSERT INTO owner_email_changes(change_id,account_id,request_id,request_hash,new_address,new_address_hash,epoch,created_at,expires_at,state,revision,history,deliverable) VALUES(?,?,?,?,?,?,1,?,?,'pending',1,'[\"pending\"]',0)",
   oldId,old.account,id(),'b'.repeat(64),oldAddress,await m.addressKey(oldAddress),cutoff,cutoff+3600000);
  const ran=await m.maintainEmailChanges(db);assert.ok(ran.expired>=1&&ran.redacted>=1&&ran.changes>=1);
  assert.equal(await one('SELECT 1 FROM owner_email_changes WHERE change_id=?',oldId),null);
  assert.equal(JSON.stringify(await all('SELECT * FROM owner_email_changes')).includes(oldAddress),false,'no plaintext address survives a closed change');
  // Redaction of a closed (cancelled) change keeps the hash and the facts.
  const c=await owner(),cx=addr('redact'),cid=(await change(c,cx)).data.changeId;await call(c,'cancel',{version:1,changeId:cid});
  await m.maintainEmailChanges(db);const redacted=await one('SELECT state,new_address,new_address_hash FROM owner_email_changes WHERE change_id=?',cid);
  assert.deepEqual({...redacted,new_address_hash:redacted.new_address_hash.length},{state:'cancelled',new_address:null,new_address_hash:64});
  await rejects(run('UPDATE owner_email_changes SET new_address=? ,revision=revision+1 WHERE change_id=?',cx,cid),/email_change_frozen/);
 });
 await check('account closure removes the changes and limits of the owner and keeps no address',async()=>{
  const a=await owner(),x=addr('gone');await change(a,x);
  assert.ok((await count("owner_email_changes WHERE account_id='"+a.account+"'"))>=1);
  await run('DELETE FROM users WHERE id=?',a.account);
  assert.equal(await count("owner_email_changes WHERE account_id='"+a.account+"'"),0);assert.equal(await count("owner_email_change_limits WHERE account_id='"+a.account+"'"),0);
  assert.equal(JSON.stringify(await all('SELECT * FROM owner_email_changes')).includes(x),false);
 });
 await check('security reviews: bound to the current epoch, one kit offer, save-before-rotation, commit only with the advanced epoch, immutable afterwards',async()=>{
  const a=await owner(),review=id(),now=Date.now();
  const account=await one('SELECT * FROM identity_accounts WHERE account_id=?',a.account);
  const insert=(extra={})=>run('INSERT INTO owner_security_reviews(review_id,account_id,epoch,credential_revision,kit_generation,credentials,connections,created_at,expires_at,state,revision) VALUES(?,?,?,?,?,?,?,?,?,\'open\',1)',
   extra.review??id(),a.account,extra.epoch??account.auth_epoch,account.credential_revision,account.kit_generation,'["c1"]','[]',now,now+600000);
  await rejects(insert({epoch:account.auth_epoch+1}),/security_review_new/);
  await insert({review});
  await rejects(run('UPDATE owner_security_reviews SET credentials=\'[]\',revision=2 WHERE review_id=?',review),/security_review_guard/);
  const offer="UPDATE owner_security_reviews SET kit_offer_id='offer-1',kit_verifier=?,kit_offer_created_at=?,kit_offer_expires_at=?,revision=revision+1 WHERE review_id=?";
  await run(offer,'1'.repeat(64),now+1,now+1+1800000>now+600000?now+600000:now+1+1800000,review);
  await rejects(run("UPDATE owner_security_reviews SET kit_verifier=?,revision=revision+1 WHERE review_id=?",'2'.repeat(64),review),/security_review_guard/);
  const receipt=(extra={})=>JSON.stringify({reviewId:review,epoch:account.auth_epoch+1,stage:'ready',revokedCredentials:[],kitRotated:true,pendingEmailChange:null,connections:[],sessionsRevoked:'all',accountRecoveryOnly:true,...extra});
  const commit=(r=receipt())=>run("UPDATE owner_security_reviews SET state='committed',revision=revision+1,commit_request_id='request-0001',commit_request_hash=?,receipt=?,committed_at=? WHERE review_id=?",'3'.repeat(64),r,Date.now(),review);
  await rejects(commit(),/CHECK|security_review_commit/);  // rotated kit that was never saved, and the epoch has not advanced
  await run('UPDATE owner_security_reviews SET kit_saved_at=?,revision=revision+1 WHERE review_id=?',now+2,review);
  await rejects(commit(),/security_review_commit/);
  await run('UPDATE identity_accounts SET auth_epoch=auth_epoch+1 WHERE account_id=?',a.account);
  await rejects(run("UPDATE owner_security_reviews SET state='committed',revision=revision+1,commit_request_id='request-0001',commit_request_hash=?,receipt=?,committed_at=? WHERE review_id=?",'3'.repeat(64),receipt({accountRecoveryOnly:false}),Date.now(),review),/CHECK/);
  await commit();
  assert.equal((await one('SELECT state FROM owner_security_reviews WHERE review_id=?',review)).state,'committed');
  await rejects(run('UPDATE owner_security_reviews SET revision=revision+1,kit_saved_at=NULL WHERE review_id=?',review),/security_review_(?:guard|commit)/);
  await rejects(run('DELETE FROM owner_security_reviews WHERE review_id=?',review),/security_review_retained/);
  for(let n=0;n<19;n++)await insert({epoch:account.auth_epoch+1}).catch(()=>{});
  const heavy=await owner();void heavy;
 });
 console.log(`Email change store passed (${cases} cases, ${process.argv.includes('--d1')?'actual local D1':'in-memory SQLite'}): real trusted adapter, identity scope and schema triggers; delivery inactive stores nothing; Origin/body/rate-limit boundaries; identical responses; supersede and token reuse; replay and undo; epoch fence; reservation; restore and forward repair cannot revive a superseded change, a used token or an earlier verification state; bounded maintenance; closure; security-review rows.`);
}finally{await fixture.close();}
