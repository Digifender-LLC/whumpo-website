import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';

// WH-156 shared notification outbox (schema batch 3e) over the current schema on SQLite and, with --d1, actual local D1, with a SIMULATED provider:
// lost reply, throw, a worker interrupted after its claim, duplicate passes, the spending ceiling, the caps, suppression, record isolation and the
// unknown-outcome -> unresolved bound. No network, no provider and no mail: every send is a function in this file. Synthetic rows only.
const bundle=await build({stdin:{contents:"export * from './src/notification-outbox';export * from './src/job-journal';export * from './src/job-dispatcher';",resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const fixture=await databaseFixture(),db=fixture.db,d1=process.argv.includes('--d1');
const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('No network call is permitted');};
const run=(sql,...v)=>db.prepare(sql).bind(...v).run(),one=(sql,...v)=>db.prepare(sql).bind(...v).first(),all=async(sql,...v)=>(await db.prepare(sql).bind(...v).all()).results.map(r=>({...r}));
const id=()=>crypto.randomUUID(),T=Date.now(),minute=60000,hour=3600000,day=86400000;
// Each case starts with no unsent notice left over from the one before (they share the database); held attempts stay as they are.
const reset=()=>run("UPDATE notification_notices SET state='cancelled',reason='expired',outcome_at=? WHERE state IN ('queued','deferred')",Date.now());
let cases=0;const check=async(name,fn)=>{try{await reset();await fn();cases++;}catch(e){console.error('FAILED:',name);throw e;}};
const settings={provider:'cloudflare-email',review:'review-1',sendCeiling:1000};

/** The simulated provider. `mode` is what the next call does; every call is recorded and the provider takes the message in 'lost' and 'throw-after'. */
function provider(){
 const p={mode:'up',calls:[],taken:[],inspect:null};
 p.send=async notice=>{
  p.calls.push(notice);
  if(p.inspect)await p.inspect(notice);
  if(p.mode==='down')return {accepted:false,retryable:true};
  if(p.mode==='reject')return {accepted:false,retryable:false};
  if(p.mode==='suppressed')return {accepted:false,retryable:false,suppressed:true};
  if(p.mode==='throw')throw Error('PRIVATE-PROVIDER-ERROR');
  p.taken.push(notice.idempotencyKey);
  if(p.mode==='lost')return new Promise(()=>{}); // the provider took the message and the reply never returns
  return {accepted:true,providerRef:'ref-'+p.taken.length};
 };
 return p;
}
const clock=at=>new Date(at);
const pass=(p,at,options={})=>m.runNotificationDelivery(db,settings,p.send,{now:clock(at),timeoutMs:50,...options});
async function account({verified=true,destination=false}={}){
 const user=id(),project=id(),email=`${user}@example.test`;
 await run("INSERT INTO users(id,email,created_at) VALUES(?,?,'2026-10-30')",user,email);
 if(verified)await run("UPDATE users SET email_verified_at=?,email_verified_via='notify@whumpo.com' WHERE id=?",T,user);
 await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Fixture','Testing','draft','2026-10-30','2026-10-30')",project,user);
 let dest=null;
 if(destination){dest=id();await run("INSERT INTO contact_notification_destinations(id,user_id,project_id,address,created_at) VALUES(?,?,?,?,'2026-10-30')",dest,user,project,`dest-${user}@example.test`);}
 return {user,project,email,dest};
}
await run('DROP TRIGGER users_email_lockstep'); // verification normally moves only through a confirmed email change (the support tests do the same)
const accountNotice=(a,event,at,template='account.passkey-added@1')=>m.enqueueNotice(db,{userId:a.user,scope:'account-email',template,eventRef:event,now:at});
const verifyNotice=async(a,at)=>{
 const code='ABCD2345',expires=new Date(at+hour).toISOString();
 await run('UPDATE contact_notification_destinations SET verification_code=?,verification_expires_at=? WHERE id=?',code,expires,a.dest);
 return m.enqueueNotice(db,{userId:a.user,scope:'owner-destination',projectId:a.project,destinationId:a.dest,template:'owner.destination-verification@1',eventRef:'verify:'+a.dest+':'+code,now:at});
};
const notice=async idOrEvent=>await one('SELECT * FROM notification_notices WHERE id=?1 OR event_ref=?1',idOrEvent);
const job=jobId=>one('SELECT state,attempt,fence,result_ref,last_event FROM job_journal WHERE id=?',jobId);
const ledger=async()=>(await one("SELECT coalesce(sum(sends),0) n FROM notification_send_ledger")).n;
const rejects=(sql,pattern,...v)=>assert.rejects(()=>run(sql,...v),pattern);

try{
 await check('a queued notice is one notice row and one platform-email envelope; the template comes from the catalog, not a CHECK list',async()=>{
  const a=await account(),queued=await accountNotice(a,'e-queue',T);
  assert.equal(queued.queued,true);
  const n=await notice(queued.id),j=await job(n.job_id);
  assert.deepEqual({state:n.state,attempts:n.attempts,scope:n.scope,recipient_key:n.recipient_key,project:n.project_id,dest:n.destination_id},{state:'queued',attempts:0,scope:'account-email',recipient_key:'account-email:'+a.user,project:null,dest:null});
  assert.equal(n.expires_at-n.created_at,day);assert.equal(j.state,'ready');
  const envelope=JSON.parse((await one('SELECT envelope_json FROM job_journal WHERE id=?',n.job_id)).envelope_json);
  assert.deepEqual([envelope.purpose,envelope.limits.maxAttempts,envelope.actor.kind,envelope.ownerAccountId],['platform-email',1,'platform-obligation',a.user]);
  assert.equal(envelope.schedule.expiresAt,n.expires_at,'the envelope expires with the notice');
  assert.ok(!JSON.stringify(envelope).includes(a.email),'no address in the envelope');
  await assert.rejects(m.enqueueNotice(db,{userId:a.user,scope:'account-email',template:'nope.nothing@1',eventRef:'x',now:T}),/INVALID_NOTICE/);
  await assert.rejects(m.enqueueNotice(db,{userId:a.user,scope:'submitter',projectId:a.project,recipientRef:id(),template:'account.passkey-added@1',eventRef:'x',now:T}),/INVALID_NOTICE/,'a template is only for its audiences');
  await rejects("INSERT INTO notification_notices(id,user_id,scope,recipient_key,template,event_ref,created_at,expires_at) VALUES(?,?,'account-email',?,'not-versioned',?,?,?)",/CHECK/,id(),a.user,'account-email:'+a.user,'x',T,T+hour);
 });
 await check('a pass sends once: counted before the call, accepted afterwards, the envelope complete, a repeat sends nothing',async()=>{
  const a=await account(),p=provider(),queued=await accountNotice(a,'e-happy',T);
  p.inspect=async()=>{
   const n=await notice(queued.id);assert.equal(n.state,'dispatching');assert.equal(n.attempts,1);assert.equal(await ledger()>=1,true,'the send is counted before the provider is called');
   assert.equal((await job(n.job_id)).state,'awaiting');
  };
  const r=await pass(p,T+1);
  assert.equal(r.accepted,1);assert.equal(p.calls.length,1);
  const n=await notice(queued.id);
  assert.deepEqual({state:n.state,attempts:n.attempts,ref:n.provider_ref,reason:n.reason},{state:'accepted',attempts:1,ref:'ref-1',reason:null});
  assert.deepEqual({...await job(n.job_id)},{state:'complete',attempt:1,fence:1,result_ref:'accepted',last_event:'external_result'});
  assert.deepEqual(Object.keys(p.calls[0]).sort(),['idempotencyKey','kind','outboxId','projectId','recipient','template']);assert.equal(p.calls[0].recipient,a.email);assert.equal(p.calls[0].kind,'account');
  await pass(p,T+2*minute);assert.equal(p.calls.length,1,'nothing is sent twice');
 });
 await check('duplicate passes and duplicate events send once',async()=>{
  const a=await account(),p=provider(),first=await accountNotice(a,'e-dup',T),again=await accountNotice(a,'e-dup',T+1);
  assert.deepEqual([first.queued,again.queued,again.duplicate],[true,false,true]);
  assert.equal((await one("SELECT count(*) n FROM notification_notices WHERE event_ref='e-dup'")).n,1);
  const before=await ledger();
  await Promise.all([pass(p,T+5),pass(p,T+5),pass(p,T+5)]);
  assert.equal(p.calls.filter(c=>c.recipient===a.email).length,1,'one claim wins');assert.equal(await ledger(),before+1);
  assert.equal((await notice(first.id)).state,'accepted');
 });
 await check('a lost reply is held as unknown-outcome with its 72-hour bound and is never redispatched',async()=>{
  const a=await account(),p=provider(),queued=await accountNotice(a,'e-lost',T);p.mode='lost';
  const r=await pass(p,T+10);assert.equal(r.failed,1);assert.equal(p.taken.length,1,'the provider did take the message');
  const n=await notice(queued.id);
  assert.deepEqual({state:n.state,attempts:n.attempts,reason:n.reason,ref:n.provider_ref},{state:'unknown-outcome',attempts:1,reason:'uncertain',ref:null});
  assert.equal(n.reconcile_until-n.outcome_at,72*hour);assert.equal((await job(n.job_id)).state,'uncertain');
  p.mode='up';for(const later of [minute,hour,day,3*day])await pass(p,T+later);
  assert.equal(p.calls.length,1,'no redispatch, however long it waits');assert.equal((await notice(queued.id)).state,'unknown-outcome');
  await rejects("UPDATE notification_notices SET state='queued' WHERE id=?",/notification_notice_transition/,queued.id);
  await rejects("UPDATE notification_notices SET state='deferred',reason='unavailable' WHERE id=?",/notification_notice_transition/,queued.id);
  await rejects("UPDATE notification_notices SET state='dispatching',attempts=2,dispatched_at=?,outcome_at=NULL,reason=NULL WHERE id=?",/notification_notice_transition/,T,queued.id);
 });
 await check('a thrown provider call is the same: unknown-outcome, no error text stored, never resent',async()=>{
  const a=await account(),p=provider(),queued=await accountNotice(a,'e-throw',T);p.mode='throw';
  const r=await pass(p,T+20);assert.equal(r.failed,1);
  const n=await notice(queued.id);assert.deepEqual([n.state,n.reason],['unknown-outcome','uncertain']);
  assert.ok(!JSON.stringify(await all('SELECT * FROM notification_notices')).includes('PRIVATE-PROVIDER-ERROR'));
  p.mode='up';await pass(p,T+hour);assert.equal(p.calls.length,1);
 });
 await check('a worker interrupted after its claim leaves the attempt uncertain; the next pass holds it and sends nothing',async()=>{
  const a=await account(),p=provider(),queued=await accountNotice(a,'e-crash',T),n=await notice(queued.id);
  // What attempt() does up to the provider call, then the worker dies: lease, counted claim, intent, notice dispatching.
  const claimed=await m.claimJob(db,a.user,n.job_id,T+30);
  const day0=new Date(T+31).toISOString().slice(0,10);
  await db.batch([
   db.prepare("INSERT INTO notification_send_ledger(provider,day,sends,ceiling) VALUES('cloudflare-email',?,0,1000) ON CONFLICT(provider,day) DO NOTHING").bind(day0),
   m.beginStatement(db,claimed.lease,T+31),
   db.prepare("UPDATE notification_notices SET state='dispatching',attempts=1,dispatched_at=?,outcome_at=NULL,reason=NULL WHERE id=?").bind(T+31,n.id)]);
  assert.equal((await notice(n.id)).state,'dispatching');
  await pass(p,T+32);assert.equal((await notice(n.id)).state,'dispatching','within the lease the attempt may still be running');
  await pass(p,T+31+m.jobLeaseMaxMs+1);
  const held=await notice(n.id);
  assert.deepEqual([held.state,held.reason],['unknown-outcome','uncertain']);assert.equal(held.reconcile_until-held.outcome_at,72*hour);assert.equal(p.calls.length,0,'the interrupted attempt is never retried');
  assert.equal((await job(n.job_id)).state,'uncertain');
 });
 await check('definite refusals defer with a NEW envelope per attempt, bounded at six, and a rejection is final',async()=>{
  const a=await account(),p=provider(),queued=await accountNotice(a,'e-defer',T);p.mode='down';
  const first=(await notice(queued.id)).job_id;
  let r=await pass(p,T+100);assert.equal(r.retried,1);
  let n=await notice(queued.id);assert.deepEqual([n.state,n.reason,n.attempts],['deferred','unavailable',1]);assert.notEqual(n.job_id,first,'the next attempt is a new envelope');assert.equal((await job(first)).state,'complete');
  assert.equal((await one('SELECT max_attempts m FROM job_journal WHERE id=?',n.job_id)).m,1);
  await pass(p,T+100+minute);assert.equal(p.calls.length,1,'not before its backoff time');
  let at=T+100,attempts=1;
  while(attempts<6){at+=3*hour;r=await pass(p,at);attempts++;assert.equal((await notice(queued.id)).attempts,attempts);}
  n=await notice(queued.id);assert.deepEqual([n.state,n.reason,n.attempts],['failed','exhausted',6]);assert.equal(p.calls.length,6,'six attempts, six calls');
  const b=await account(),pb=provider(),rejected=await accountNotice(b,'e-reject',at+1);pb.mode='reject';await pass(pb,at+2);
  assert.deepEqual([(await notice(rejected.id)).state,(await notice(rejected.id)).reason],['failed','rejected']);
  await rejects("UPDATE notification_notices SET state='queued' WHERE id=?",/notification_notice_transition/,rejected.id);
 });
 await check('a provider-side suppression becomes the account suppression and stops every unsent notice',async()=>{
  const a=await account({destination:true}),p=provider();await verifyNotice(a,T);
  const other=await accountNotice(a,'e-sup-other',T+1);
  p.inspect=async n=>{p.mode=n.recipient.startsWith('dest-')?'suppressed':'up';};await pass(p,T+50);
  assert.equal((await one('SELECT reason FROM contact_notification_suppressions WHERE user_id=? AND address=?',a.user,`dest-${a.user}@example.test`)).reason,'provider');
  assert.equal((await one('SELECT state FROM contact_notification_destinations WHERE id=?',a.dest)).state,'suppressed');
  assert.deepEqual([(await notice('verify:'+a.dest+':ABCD2345')).state,(await notice('verify:'+a.dest+':ABCD2345')).reason],['failed','rejected']);
  assert.equal((await notice(other.id)).state,'accepted','a notice to a different address of the account is not touched');
 });
 await check('suppression cancels unsent notices and their envelopes for owner-destination and account-email; a sending notice is not touched',async()=>{
  const a=await account({destination:true}),p=provider();
  const deferredMode=await accountNotice(a,'e-sup-deferred',T);p.mode='down';
  // Defer one first (the per-run owner cap is two), then queue the rest and suppress both addresses.
  await pass(p,T+5);
  assert.equal((await notice(deferredMode.id)).state,'deferred');
  const v=await verifyNotice(a,T+6),acct=await accountNotice(a,'e-sup-acct',T+6);
  await run("INSERT INTO contact_notification_suppressions(user_id,address,reason,created_at) VALUES(?,?,'complaint','2026-10-30')",a.user,`dest-${a.user}@example.test`);
  await run("INSERT INTO contact_notification_suppressions(user_id,address,reason,created_at) VALUES(?,?,'bounce','2026-10-30')",a.user,a.email);
  for(const idv of [v.id,acct.id,deferredMode.id]){const n=await notice(idv);assert.deepEqual([n.state,n.reason],['cancelled','suppressed'],idv);assert.equal((await job(n.job_id)).state,'cancelled','the unclaimed envelope goes with it');}
  p.mode='up';const calls=p.calls.length;await pass(p,T+hour);assert.equal(p.calls.length,calls,'nothing is sent to a suppressed address');
  // A notice already with the provider keeps its state; the suppression is permanent for the account.
  const b=await account(),pb=provider(),sending=await accountNotice(b,'e-sup-sending',T);pb.mode='lost';await pass(pb,T+1);
  await run("INSERT INTO contact_notification_suppressions(user_id,address,reason,created_at) VALUES(?,?,'bounce','2026-10-30')",b.user,b.email);
  assert.equal((await notice(sending.id)).state,'unknown-outcome');
 });
 await check('the spending ceiling counts every call before it is made, refuses the rest and cannot be raised',async()=>{
  const owners=[await account(),await account(),await account()],p=provider(),tight={...settings,sendCeiling:2},F=Date.parse('2031-03-10T12:00:00.000Z');
  for(const [i,o] of owners.entries())await accountNotice(o,'e-ceiling-'+i,F);
  const r=await m.runNotificationDelivery(db,tight,p.send,{now:clock(F+1)});
  assert.equal(r.accepted,2);assert.equal(r.refused,1);assert.equal(p.calls.length,2,'the third call never reaches the provider');
  assert.equal((await one("SELECT count(*) n FROM notification_notices WHERE reason='ceiling' AND state='cancelled'")).n,1);
  assert.equal(await m.noticeSendsInWindow(db,'cloudflare-email',F+1),2);
  const day31=F+20*day,late=owners[0];await accountNotice(late,'e-ceiling-late',day31);
  const r2=await m.runNotificationDelivery(db,tight,p.send,{now:clock(day31+1)});assert.equal(r2.refused,1);assert.equal(p.calls.length,2,'still inside the 32-day window');
  await rejects("UPDATE notification_send_ledger SET ceiling=ceiling+1 WHERE day='2031-03-10'",/notification_send_final/);
  await rejects("UPDATE notification_send_ledger SET sends=0 WHERE day='2031-03-10'",/notification_send_final/);
  await rejects("UPDATE notification_send_ledger SET sends=sends+1 WHERE day='2031-03-10'",/notification_send_ceiling/);
  await rejects("INSERT INTO notification_send_ledger(provider,day,sends,ceiling) VALUES('cloudflare-email','2031-03-11',5,10)",/notification_send_final/);
  // A lowered ceiling applies at once; the window moves on after 32 days.
  const lowered=await account();await accountNotice(lowered,'e-ceiling-lowered',day31+hour);
  const r3=await m.runNotificationDelivery(db,{...settings,sendCeiling:1},p.send,{now:clock(day31+hour+1)});assert.equal(r3.refused,1);
  const after=F+33*day,fresh=await account();await accountNotice(fresh,'e-ceiling-after',after);
  const r4=await m.runNotificationDelivery(db,tight,p.send,{now:clock(after+1)});assert.equal(r4.accepted,1);assert.equal(p.calls.length,3);
  // The database refuses a dispatch the claim did not count first.
  const g=await account(),gq=await accountNotice(g,'e-ledger-missing',F+400*day),gn=await notice(gq.id),claimed=await m.claimJob(db,g.user,gn.job_id,F+400*day);
  await m.beginExternal(db,claimed.lease,F+400*day);
  await rejects("UPDATE notification_notices SET state='dispatching',attempts=1,dispatched_at=?,outcome_at=NULL,reason=NULL WHERE id=?",/notification_ledger_missing/,F+400*day,gn.id);
 });
 await check('caps: ten an hour and fifty a day per recipient, held by the guarded insert and, behind it, by the schema',async()=>{
  const a=await account(),queued=[];
  for(let i=0;i<12;i++)queued.push(await accountNotice(a,'e-cap-'+i,T+i));
  assert.equal(queued.filter(q=>q.queued).length,10,'the eleventh and twelfth queue nothing');assert.equal(queued[10].queued,false);assert.equal(queued[10].duplicate,false);
  await rejects("INSERT INTO notification_notices(id,user_id,scope,recipient_key,template,event_ref,created_at,expires_at) VALUES(?,?,'account-email',?,'account.passkey-added@1','e-cap-backstop',?,?)",/notification_notice_rate/,id(),a.user,'account-email:'+a.user,T+20,T+20+hour);
  // Fifty a day: five hours of ten.
  const b=await account();let queuedDay=0;
  for(let h=0;h<6;h++)for(let i=0;i<10;i++){const q=await accountNotice(b,`e-day-${h}-${i}`,T+h*(hour+1)+i);if(q.queued)queuedDay++;}
  assert.equal(queuedDay,50,'the day cap stops the sixth hour');
  await rejects("INSERT INTO notification_notices(id,user_id,scope,recipient_key,template,event_ref,created_at,expires_at) VALUES(?,?,'account-email',?,'account.passkey-added@1','e-day-backstop',?,?)",/notification_notice_rate/,id(),b.user,'account-email:'+b.user,T+5*(hour+1)+30,T+5*(hour+1)+30+hour);
  // Another recipient is not affected.
  assert.equal((await accountNotice(await account(),'e-cap-other',T)).queued,true);
 });
 await check('record isolation: one account\'s refusal, uncertainty or removal never touches another\'s notices',async()=>{
  const a=await account({destination:true}),b=await account({destination:true}),p=provider();
  const qa=await verifyNotice(a,T),qb=await verifyNotice(b,T);
  await rejects("INSERT INTO notification_notices(id,user_id,scope,project_id,destination_id,recipient_key,template,event_ref,created_at,expires_at) VALUES(?,?,'owner-destination',?,?,?,'owner.destination-verification@1','x-cross',?,?)",/notification_notice_scope/,id(),b.user,a.project,a.dest,'owner-destination:'+a.dest,T,T+hour);
  p.inspect=async n=>{if(n.recipient===`dest-${a.user}@example.test`)p.mode='lost';else p.mode='up';};
  await pass(p,T+3);
  assert.equal((await notice(qa.id)).state,'unknown-outcome');assert.equal((await notice(qb.id)).state,'accepted','the other account is served in the same pass');
  assert.deepEqual(p.calls.map(c=>c.recipient).sort(),[`dest-${a.user}@example.test`,`dest-${b.user}@example.test`].sort());
  // Removing one account's destination cancels only its own unsent notices.
  const c=await account({destination:true}),d=await account({destination:true}),qc=await verifyNotice(c,T),qd=await verifyNotice(d,T);
  await run('DELETE FROM contact_notification_destinations WHERE id=?',c.dest);
  assert.equal((await one('SELECT count(*) n FROM notification_notices WHERE id=?',qc.id)).n,0,'cancelled and cascaded with its destination');assert.equal((await notice(qd.id)).state,'queued');
  // A destination with an attempt in flight cannot be removed from under it.
  await rejects('DELETE FROM contact_notification_destinations WHERE id=?',/notification_notice_retained/,a.dest);
  // The sender is given only its own recipient and nothing from another account.
  assert.ok(p.calls.every(call=>call.projectId===a.project||call.projectId===b.project));
 });
 await check('unsupported scopes and templates are cancelled before any call',async()=>{
  const a=await account(),p=provider();
  const staff=await m.enqueueNotice(db,{userId:a.user,scope:'project-staff',projectId:a.project,recipientRef:id(),template:'appointment.staff-notice@1',eventRef:'e-staff',now:T});
  const confirm=await accountNotice(a,'e-confirm',T,'account.email-confirm@1');
  const unverified=await account({verified:false}),uq=await accountNotice(unverified,'e-unverified',T);
  const r=await pass(p,T+9);
  assert.equal(p.calls.length,0);
  for(const [q,reason] of [[staff,'template-withdrawn'],[confirm,'template-withdrawn'],[uq,'recipient-revoked']]){const n=await notice(q.id);assert.deepEqual([n.state,n.reason],['cancelled',reason]);assert.equal((await job(n.job_id)).state,'cancelled');}
  assert.equal(r.cancelled>=3,true);
 });
 await check('unknown-outcome leaves only for evidence, or for unresolved at three lookups or past its bound',async()=>{
  const bound=await account(),lookups=await account(),early=await account(),p=provider();p.mode='lost';
  const qb=await accountNotice(bound,'e-bound',T),ql=await accountNotice(lookups,'e-lookups',T),qe=await accountNotice(early,'e-early',T);
  await pass(p,T+1);for(const q of [qb,ql,qe])assert.equal((await notice(q.id)).state,'unknown-outcome');
  const n=await notice(qb.id);
  await rejects("UPDATE notification_notices SET state='unresolved',reason='unreconciled',outcome_at=? WHERE id=?",/notification_notice_transition/,T+2,qb.id);
  assert.equal((await m.maintainNotices(db,T+hour)).unresolved,0,'the hourly pass leaves a notice inside its bound');
  assert.equal(await m.recordNoticeLookup(db,ql.id),1);assert.equal(await m.recordNoticeLookup(db,ql.id),2);
  assert.equal((await m.maintainNotices(db,T+hour)).unresolved,0,'two lookups are not enough');
  assert.equal(await m.recordNoticeLookup(db,ql.id),3);assert.equal(await m.recordNoticeLookup(db,ql.id),null,'a fourth lookup is refused');
  await rejects("UPDATE notification_notices SET lookups=4 WHERE id=?",/CHECK/,ql.id);
  assert.equal((await m.maintainNotices(db,T+hour)).unresolved,1);
  const done=await notice(ql.id);assert.deepEqual([done.state,done.reason,done.lookups],['unresolved','unreconciled',3]);
  await m.maintainNotices(db,n.reconcile_until);
  for(const q of [qb,qe])assert.equal((await notice(q.id)).state,'unresolved','past the 72-hour bound the rest is unresolved');
  // Unresolved is final and retained: not deletable for 90 days, not pruned, and no call is made.
  await rejects("UPDATE notification_notices SET state='accepted',reason=NULL WHERE id=?",/notification_notice_transition/,qb.id);
  await rejects('DELETE FROM notification_notices WHERE id=?',/notification_notice_retained/,qb.id);
  await m.pruneNotices(db,T+10*day);assert.ok(await notice(qb.id),'unresolved evidence survives the 30-day prune');
  p.mode='up';await pass(p,T+5*day);assert.equal(p.calls.length,3);
 });
 await check('authenticated provider events move unknown-outcome and accepted notices; replays and out-of-order events change nothing',async()=>{
  const a=await account({destination:true}),p=provider();
  const lost=await verifyNotice(a,T);p.mode='lost';await pass(p,T+1);
  await assert.rejects(m.applyNoticeEvent(db,{noticeId:lost.id,type:'delivered',authenticated:false},T+2),/EVENT_NOT_AUTHENTICATED/);
  assert.equal((await notice(lost.id)).state,'unknown-outcome');
  assert.deepEqual(await m.applyNoticeEvent(db,{noticeId:lost.id,type:'accepted',providerRef:'late-ref',authenticated:true},T+3),{applied:true});
  let n=await notice(lost.id);assert.deepEqual([n.state,n.provider_ref],['accepted','late-ref']);
  await m.applyNoticeEvent(db,{noticeId:lost.id,type:'delivered',authenticated:true},T+4);assert.equal((await notice(lost.id)).state,'delivered');
  await m.applyNoticeEvent(db,{noticeId:lost.id,type:'accepted',providerRef:'other',authenticated:true},T+5);assert.equal((await notice(lost.id)).state,'delivered','out of order: ignored');
  await m.applyNoticeEvent(db,{noticeId:lost.id,type:'bounce',authenticated:true},T+6);assert.equal((await notice(lost.id)).state,'delivered','delivered only becomes complained');
  await m.applyNoticeEvent(db,{providerRef:'late-ref',type:'complaint',authenticated:true},T+7);assert.equal((await notice(lost.id)).state,'complained');
  assert.equal((await one('SELECT reason FROM contact_notification_suppressions WHERE user_id=? AND address=?',a.user,`dest-${a.user}@example.test`)).reason,'bounce','the first suppression stands; a later complaint does not rewrite it');
  await m.applyNoticeEvent(db,{noticeId:lost.id,type:'complaint',authenticated:true},T+8);assert.equal((await all('SELECT * FROM contact_notification_suppressions WHERE user_id=?',a.user)).length,1,'a replay changes nothing');
  assert.deepEqual(await m.applyNoticeEvent(db,{noticeId:id(),type:'bounce',authenticated:true},T),{applied:false});
  await assert.rejects(m.applyNoticeEvent(db,{type:'bounce',authenticated:true},T),/INVALID_NOTICE/);
 });
 await check('expiry, identity and retention: an unsent notice expires in 24 hours with its envelope, identity never changes, open notices are not deletable',async()=>{
  const a=await account(),p=provider(),queued=await accountNotice(a,'e-expire',T),n=await notice(queued.id);
  assert.deepEqual(await m.maintainNotices(db,T+day-1),{expired:0,unresolved:0});
  assert.equal((await m.maintainNotices(db,T+day)).expired>=1,true);
  const gone=await notice(queued.id);assert.deepEqual([gone.state,gone.reason],['cancelled','expired']);assert.equal((await job(n.job_id)).state,'cancelled');
  await pass(p,T+day+1);assert.equal(p.calls.length,0);
  const b=await account(),open=await accountNotice(b,'e-open',T);
  for(const set of ["user_id='x'","template='account.passkey-removed@1'","event_ref='other'","scope='submitter'","recipient_key='other'","created_at=1","expires_at=expires_at+1","provider='other'"])await rejects(`UPDATE notification_notices SET ${set} WHERE id=?`,/notification_notice_identity|CHECK|FOREIGN/,open.id);
  await rejects('DELETE FROM notification_notices WHERE id=?',/notification_notice_retained/,open.id);
  await rejects("INSERT INTO notification_notices(id,user_id,scope,recipient_key,template,event_ref,created_at,expires_at,state,attempts,dispatched_at) VALUES(?,?,'account-email',?,'account.passkey-added@1','e-init',?,?,'dispatching',1,?)",/notification_notice_initial|CHECK/,id(),b.user,'account-email:'+b.user,T,T+hour,T);
  await rejects("INSERT INTO notification_notices(id,user_id,scope,project_id,recipient_key,template,event_ref,created_at,expires_at) VALUES(?,?,'account-email',?,?,'account.passkey-added@1','e-shape',?,?)",/CHECK/,id(),b.user,b.project,'account-email:'+b.user,T,T+hour);
  await rejects("INSERT INTO notification_notices(id,user_id,scope,recipient_key,template,event_ref,created_at,expires_at) VALUES(?,?,'account-email','account-email:wrong','account.passkey-added@1','e-key',?,?)",/CHECK/,id(),b.user,T,T+hour);
  await rejects("INSERT INTO notification_notices(id,user_id,scope,recipient_key,template,event_ref,created_at,expires_at) VALUES(?,?,'account-email',?,'account.passkey-added@1','e-ttl',?,?)",/CHECK/,id(),b.user,'account-email:'+b.user,T,T+day+1);
  // Finished notices go 30 days after their outcome; account deletion takes everything, open or not.
  const finished=await accountNotice(b,'e-finished',T+1);await pass(p,T+2);assert.equal((await notice(finished.id)).state,'accepted');
  assert.equal(await m.pruneNotices(db,T+29*day),0);assert.ok(await m.pruneNotices(db,T+31*day)>=1);assert.equal(await notice(finished.id),null);
  await run('DELETE FROM users WHERE id=?',b.user);assert.equal((await one('SELECT count(*) n FROM notification_notices WHERE user_id=?',b.user)).n,0,'the account takes its open notices with it');
 });
 await check('safety holds keep a held project\'s notices and the old outboxes are gone',async()=>{
  const a=await account({destination:true}),p=provider(),queued=await verifyNotice(a,T);await pass(p,T+1);
  assert.equal((await notice(queued.id)).state,'accepted');
  await run("INSERT INTO safety_cases(id,subject_user_id,intake_ref,opened_by,opened_at,retention_due_at) VALUES('case-wh156',?,'intake-156','human:reviewer',unixepoch(),unixepoch()+31536000)",a.user);
  await run("INSERT INTO safety_preservation_holds(id,case_id,subject_user_id,scope,project_id,legal_basis_ref,approved_by,placed_at,review_due_at) VALUES('hold-wh156','case-wh156',?,'project',?,'basis-156','human:approver',unixepoch(),unixepoch()+86400)",a.user,a.project);
  await m.pruneNotices(db,T+40*day);assert.ok(await notice(queued.id),'retention skips a held project');
  await rejects('DELETE FROM notification_notices WHERE id=?',/safety_preservation_hold/,queued.id);
  assert.deepEqual(await all("SELECT name FROM sqlite_master WHERE name IN ('contact_notification_outbox','contact_notification_send_ledger','support_deliveries')"),[]);
 });
 assert.equal(network,0,'No network call was made');
 console.log(`Notification outbox: ${cases} cases passed on ${d1?'local D1':'SQLite'}; one journal envelope per attempt, counted before the call, lost reply, throw, interrupted worker, duplicate passes, ceiling, caps, suppression, record isolation, events and the unknown-outcome bound. Simulated provider only; no mail was sent.`);
}finally{globalThis.fetch=originalFetch;await fixture.close();}
