import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';

// Schema batch 3a (WH-052 P-2) over the current schema on disposable in-memory SQLite and, with --d1, actual local D1: the three job-journal tables,
// their indexes and triggers, the maintenance_health 'jobs' name, and the state machine as a full matrix (every event tried from every state, only the
// legal ones succeed). The behaviour of src/job-journal.ts is tests/job-journal.mjs. Synthetic rows only.
const fixture=await databaseFixture(),db=fixture.db;
const id=()=>crypto.randomUUID(),run=(sql,...v)=>db.prepare(sql).bind(...v).run(),all=async(sql,...v)=>(await db.prepare(sql).bind(...v).all()).results,one=async(sql,...v)=>{const r=await db.prepare(sql).bind(...v).first();return r&&{...r};};
const rejects=(p,re)=>assert.rejects(p,re);
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(e){console.error('FAILED:',name);throw e;}};
const owner=id();await run("INSERT INTO users(id,email,created_at) VALUES(?,?,'2026-10-29')",owner,owner+'@example.test');
const hex=c=>c.repeat(64),expiry=604800000;
const admit=async(purpose='platform-email',due=0)=>{
 const job=id(),json=JSON.stringify({jobId:job,limits:{maxAttempts:3},ownerAccountId:owner,purpose,schedule:{createdAt:0,expiresAt:expiry,notBefore:due}});
 await run("INSERT INTO job_journal(id,owner_user_id,purpose,envelope_json,envelope_digest,created_at,expires_at,max_attempts,due,initial_due,last_event,last_at) VALUES(?,?,?,?,?,0,?,3,?,?,'enqueued',0)",job,owner,purpose,json,hex('a'),expiry,due,due);
 return job;
};
// One statement per event, as src/job-journal.ts writes them, minus the compare-and-set WHERE: the schema must refuse every illegal use on its own.
const events={
 claimed:t=>["UPDATE job_journal SET state='leased',fence=fence+1,lease_until=?1+60000,last_event='claimed',last_at=?1,last_ref=NULL WHERE id=?2",t],
 intent:t=>["UPDATE job_journal SET state='awaiting',attempt=attempt+1,attempt_id=id||'.'||(attempt+1),last_event='intent',last_at=?1,last_ref=id||'.'||(attempt+1) WHERE id=?2",t],
 uncertain:t=>["UPDATE job_journal SET state='uncertain',last_event='uncertain',last_at=?1,last_ref=NULL WHERE id=?2",t],
 expired:t=>["UPDATE job_journal SET state='expired',fence=fence+1,lease_until=0,last_event='expired',last_at=?1,last_ref=NULL WHERE id=?2",t],
 external_result:t=>["UPDATE job_journal SET state=CASE cancel_requested WHEN 1 THEN 'cancelled' ELSE 'complete' END,result_ref='matrix-result',lease_until=0,last_event='external_result',last_at=?1,last_ref='matrix-result' WHERE id=?2",t],
 confirmed_not_sent:t=>["UPDATE job_journal SET fence=fence+1,lease_until=0,attempt_id=NULL,last_event='confirmed_not_sent',last_at=?1,last_ref='matrix-proof',state=CASE WHEN cancel_requested=1 THEN 'cancelled' WHEN expires_at<=?1 THEN 'expired' WHEN attempt>=max_attempts THEN 'operator' ELSE 'ready' END,due=?1+min(3600000,60000*(1<<(attempt-1))) WHERE id=?2",t],
 cancel_requested:t=>["UPDATE job_journal SET cancel_requested=1,fence=fence+1,last_event='cancel_requested',last_at=?1,last_ref=NULL,state=CASE WHEN state IN ('awaiting','uncertain') OR (state='operator' AND attempt_id IS NOT NULL) THEN state ELSE 'cancelled' END WHERE id=?2",t],
 chunk_committed:t=>["UPDATE job_journal SET cursor=cursor+5,state='ready',due=?1,fence=fence+1,lease_until=0,last_event='chunk_committed',last_at=?1,last_ref=NULL WHERE id=?2",t],
 operator_hold:t=>["UPDATE job_journal SET state='operator',fence=fence+1,lease_until=0,last_event='operator_hold',last_at=?1,last_ref='matrix-hold' WHERE id=?2",t],
 operator_release:t=>["UPDATE job_journal SET state='ready',fence=fence+1,lease_until=0,due=?1,last_event='operator_release',last_at=?1,last_ref='matrix-release' WHERE id=?2",t],
};
// Times: a live lease (to 60,000) at 100; an expired one at 70,000; the envelope's expiry at 604,800,000.
const at={claimed:70000,expired:expiry,default:100};
const apply=(event,job)=>{const [sql,t]=events[event](at[event]??at.default);return run(sql,t,job);};
const reach={
 ready:async()=>admit(),
 leased:async()=>{const j=await admit();await apply0('claimed',j,0);return j;},
 awaiting:async()=>{const j=await reach.leased();await apply0('intent',j,1);return j;},
 uncertain:async()=>{const j=await reach.awaiting();await apply0('uncertain',j,2);return j;},
 'operator with attempt':async()=>{const j=await reach.uncertain();await apply0('operator_hold',j,3);return j;},
 'operator without attempt':async()=>{const j=await admit();await apply0('operator_hold',j,3);return j;},
 complete:async()=>{const j=await reach.awaiting();await apply0('external_result',j,3);return j;},
 cancelled:async()=>{const j=await admit();await apply0('cancel_requested',j,3);return j;},
 expired:async()=>{const j=await admit();await apply0('expired',j,expiry);return j;},
};
const apply0=(event,job,t)=>run(events[event](t)[0],t,job);
const legal={
 ready:['claimed','expired','cancel_requested','operator_hold'],
 leased:['claimed','intent','expired','cancel_requested','operator_hold'],
 awaiting:['uncertain','external_result','confirmed_not_sent','cancel_requested'],
 uncertain:['external_result','confirmed_not_sent','cancel_requested','operator_hold'],
 'operator with attempt':['external_result','confirmed_not_sent','cancel_requested'],
 'operator without attempt':['operator_release','cancel_requested'],
 complete:[],cancelled:[],expired:[],
};
try{
 await check('the three tables, their indexes and triggers exist; maintenance_health admits the jobs pass and nothing else new',async()=>{
  const names=(await all("SELECT type,name FROM sqlite_master WHERE name LIKE 'job\\_%' ESCAPE '\\' ORDER BY type,name")).map(r=>r.type+':'+r.name);
  assert.deepEqual(names,['index:job_journal_due','index:job_journal_events_once','index:job_journal_owner','index:job_outbox_acknowledged',
   'table:job_journal','table:job_journal_events','table:job_outbox',
   'trigger:job_journal_enqueued','trigger:job_journal_event','trigger:job_journal_event_new','trigger:job_journal_event_retained','trigger:job_journal_event_update',
   'trigger:job_journal_identity','trigger:job_journal_new','trigger:job_journal_retained','trigger:job_journal_transition',
   'trigger:job_outbox_identity','trigger:job_outbox_new','trigger:job_outbox_retained']);
  const columns=async index=>(await all(`SELECT name FROM pragma_index_info('${index}') ORDER BY seqno`)).map(r=>r.name);
  assert.deepEqual(await columns('job_journal_due'),['state','due','id']);assert.deepEqual(await columns('job_journal_owner'),['owner_user_id','state']);assert.deepEqual(await columns('job_outbox_acknowledged'),['acknowledged_at']);
  const fks=await all("SELECT \"from\",\"table\",on_delete FROM pragma_foreign_key_list('job_journal')");assert.deepEqual(fks.map(r=>[r.from,r.table,r.on_delete]),[['owner_user_id','users','CASCADE']]);
  await run("INSERT INTO maintenance_health(job,run_id,started_at,status) VALUES('jobs',?,1,'completed')",id());
  await rejects(run("INSERT INTO maintenance_health(job,run_id,started_at,status) VALUES('job_journal',?,1,'completed')",id()),/CHECK/);
 });
 await check('admission: the stored envelope must agree with every derived column; ids, digests and the attempt bound are checked',async()=>{
  const job=id(),base={id:job,owner:owner,purpose:'platform-email',created:0,expires:expiry,max:3,due:0};
  const raw=(over={},json)=>{const v={...base,...over};
   return run("INSERT INTO job_journal(id,owner_user_id,purpose,envelope_json,envelope_digest,created_at,expires_at,max_attempts,due,initial_due,last_event,last_at) VALUES(?,?,?,?,?,?,?,?,?,?,'enqueued',?)",
    v.id,v.owner,v.purpose,json??JSON.stringify({jobId:v.id,limits:{maxAttempts:3},ownerAccountId:owner,purpose:'platform-email',schedule:{createdAt:0,expiresAt:expiry,notBefore:0}}),over.digest??hex('b'),v.created,v.expires,v.max,v.due,v.due,v.created);};
  for(const over of [{id:'NOT-A-UUID'},{digest:'z'.repeat(64)},{digest:'ab'},{purpose:'unknown'},{max:4},{max:0},{expires:0},{owner:id()},{due:expiry},{created:5}])await rejects(raw(over),/CHECK|FOREIGN|job_journal_new/);
  await rejects(raw({},'not json'),/CHECK|malformed JSON|JSON/);await rejects(raw({},'{}'),/job_journal_new/);await rejects(raw({due:7},JSON.stringify({jobId:job,limits:{maxAttempts:3},ownerAccountId:owner,purpose:'platform-email',schedule:{createdAt:0,expiresAt:expiry,notBefore:0}})),/job_journal_new/);
  await raw();
  const row=await one('SELECT * FROM job_journal WHERE id=?',job);assert.deepEqual([row.state,row.fence,row.attempt,row.cursor,row.lease_until,row.last_event],['ready',0,0,0,0,'enqueued']);
  assert.deepEqual((await all('SELECT event,fence,attempt FROM job_journal_events WHERE job_id=?',job)).map(r=>[r.event,r.fence,r.attempt]),[['enqueued',0,0]]);
  const outbox=await all('SELECT * FROM job_outbox WHERE job_id=?',job);assert.equal(outbox.length,1);assert.match(outbox[0].delivery_id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);assert.equal(outbox[0].envelope_digest,hex('b'));assert.equal(outbox[0].acknowledged_at,null);
  await rejects(raw({}),/UNIQUE|PRIMARY/);
  await rejects(run('INSERT INTO job_outbox(delivery_id,job_id,envelope_digest) VALUES(?,?,?)',id(),job,hex('b')),/UNIQUE|job_outbox_new/,'one outbox entry per job');
 });
 await check('the state machine as a matrix: from every state each event succeeds only where the schema allows it, and a refused event changes nothing',async()=>{
  let tried=0,allowed=0;
  for(const [state,legalEvents] of Object.entries(legal)){
   for(const event of Object.keys(events)){
    if(event==='chunk_committed')continue; // account-cleanup only, below
    const job=await reach[state](),before=await one('SELECT * FROM job_journal WHERE id=?',job),count=(await one('SELECT count(*) n FROM job_journal_events WHERE job_id=?',job)).n;
    tried++;
    if(legalEvents.includes(event)){allowed++;await apply(event,job);
     const after=await one('SELECT * FROM job_journal WHERE id=?',job);assert.equal(after.last_event,event,`${state} -> ${event}`);
     assert.equal((await one('SELECT count(*) n FROM job_journal_events WHERE job_id=?',job)).n,count+1,`${state} -> ${event} writes exactly one event`);
     const last=await one('SELECT event,fence,attempt,at,reference FROM job_journal_events WHERE job_id=? ORDER BY sequence DESC LIMIT 1',job);
     assert.deepEqual([last.event,last.fence,last.attempt,last.at,last.reference],[after.last_event,after.fence,after.attempt,after.last_at,after.last_ref]);
    }else{
     await rejects(apply(event,job),/job_journal_transition|CHECK/,`${state} -> ${event} must be refused`);
     assert.deepEqual(await one('SELECT * FROM job_journal WHERE id=?',job),before);assert.equal((await one('SELECT count(*) n FROM job_journal_events WHERE job_id=?',job)).n,count);
    }
   }
  }
  assert.equal(tried,9*9);assert.equal(allowed,Object.values(legal).flat().length);
 });
 await check('chunk commits are for account-cleanup jobs holding a live lease, and the cursor only moves forward',async()=>{
  const mail=await reach.leased();await rejects(apply('chunk_committed',mail),/job_journal_transition/);
  const cleanup=await admit('account-cleanup');await apply0('claimed',cleanup,0);
  await rejects(run("UPDATE job_journal SET cursor=0,state='ready',due=100,fence=fence+1,lease_until=0,last_event='chunk_committed',last_at=100 WHERE id=?",cleanup),/job_journal_transition/,'cursor must advance');
  await rejects(run("UPDATE job_journal SET cursor=5,state='ready',due=70000,fence=fence+1,lease_until=0,last_event='chunk_committed',last_at=70000 WHERE id=?",cleanup),/job_journal_transition/,'lease already expired');
  await apply('chunk_committed',cleanup);assert.deepEqual(await one('SELECT state,cursor,fence,lease_until FROM job_journal WHERE id=?',cleanup),{state:'ready',cursor:5,fence:2,lease_until:0});
  await apply0('claimed',cleanup,100);await run("UPDATE job_journal SET cursor=9,state='complete',due=150,fence=fence+1,lease_until=0,last_event='chunk_committed',last_at=150 WHERE id=?",cleanup);
  assert.equal((await one('SELECT state FROM job_journal WHERE id=?',cleanup)).state,'complete');
  const mailDone=await admit();await apply0('claimed',mailDone,0);await apply0('intent',mailDone,1);
  await rejects(run("UPDATE job_journal SET state='complete',lease_until=0,last_event='external_result',last_at=5 WHERE id=?",mailDone),/job_journal_transition/,'a completed email job must carry its result reference');
 });
 await check('field-level rules of the transitions: the lease window, the attempt bound, backoff, fence steps and untouched columns',async()=>{
  const job=await admit(),up=(set,t=0)=>run(`UPDATE job_journal SET ${set} WHERE id=?`,job);
  await rejects(up("state='leased',fence=2,lease_until=60000,last_event='claimed',last_at=0"),/job_journal_transition/,'the fence moves one step');
  await rejects(up("state='leased',fence=1,lease_until=60001,last_event='claimed',last_at=0"),/job_journal_transition/,'a lease is at most 60 s');
  await rejects(up("state='leased',fence=1,lease_until=0,last_event='claimed',last_at=0"),/job_journal_transition|CHECK/,'a lease must end after it starts');
  await rejects(up("state='leased',fence=1,lease_until=60000,last_event='claimed',last_at=0,attempt=1,attempt_id='x.1'"),/job_journal_transition/,'a claim cannot invent an attempt');
  await rejects(up("state='leased',fence=1,lease_until=60000,last_event='claimed',last_at=0,cursor=3"),/job_journal_transition/);
  await rejects(up("state='leased',fence=1,lease_until=60000,last_event='claimed',last_at=0,last_ref='x'"),/job_journal_transition/);
  await rejects(up("state='leased',fence=1,lease_until=60000,last_event='nonsense',last_at=0"),/CHECK|job_journal_transition/);
  await apply0('claimed',job,0);
  await rejects(up("state='awaiting',attempt=2,attempt_id=id||'.2',last_event='intent',last_at=1,last_ref=id||'.2'"),/job_journal_transition/,'attempts count up by one');
  await rejects(up("state='awaiting',attempt=1,attempt_id='someone-else.1',last_event='intent',last_at=1,last_ref='someone-else.1'"),/job_journal_transition/,'the attempt id is derived from the job');
  await apply0('intent',job,1);
  for(let attempt=1;attempt<=3;attempt++){
   const wrongDue=`fence=fence+1,lease_until=0,attempt_id=NULL,last_event='confirmed_not_sent',last_at=5,last_ref='p',state='${attempt<3?'ready':'operator'}',due=5+1`;
   await rejects(up(wrongDue),/job_journal_transition/,'the backoff is fixed by the attempt number');
   if(attempt===3)break;
   await apply0('confirmed_not_sent',job,5);assert.deepEqual(await one('SELECT state,due,attempt FROM job_journal WHERE id=?',job),{state:'ready',due:5+60000*2**(attempt-1),attempt});
   await apply0('claimed',job,5+60000*2**(attempt-1));await apply0('intent',job,5+60000*2**(attempt-1)+1);
  }
  await rejects(up("attempt=3"),/job_journal_transition/);
  assert.deepEqual(await one('SELECT state,attempt FROM job_journal WHERE id=?',job),{state:'awaiting',attempt:3},'the third and last attempt is recorded by its intent');
 });
 await check('identity columns never change, even inside an otherwise legal transition',async()=>{
  const job=await admit();
  for(const set of ["owner_user_id='"+id()+"'","purpose='owner-push'","envelope_digest='"+hex('f')+"'",`envelope_json='{}'`,"created_at=1","initial_due=4","expires_at=expires_at-1","max_attempts=1","id='"+id()+"'"])
   await rejects(run(`UPDATE job_journal SET state='leased',fence=1,lease_until=60000,last_event='claimed',last_at=0,${set} WHERE id=?`,job),/job_journal_identity|CHECK|FOREIGN/);
  assert.equal((await one('SELECT fence FROM job_journal WHERE id=?',job)).fence,0);
 });
 await check('events are immutable receipts: no update, no forged insert, no duplicate, and deletable only with a finished job',async()=>{
  const job=await reach.awaiting(),first=await one('SELECT * FROM job_journal_events WHERE job_id=? ORDER BY sequence LIMIT 1',job);
  await rejects(run("UPDATE job_journal_events SET at=at+1 WHERE sequence=?",first.sequence),/job_journal_event_immutable/);await rejects(run("UPDATE job_journal_events SET event='claimed' WHERE sequence=?",first.sequence),/job_journal_event_immutable/);
  await rejects(run("INSERT INTO job_journal_events(job_id,event,fence,attempt,at) VALUES(?,'claimed',1,0,0)",job),/UNIQUE|job_journal_event_new/,'a repeat of the same receipt');
  await rejects(run("INSERT INTO job_journal_events(job_id,event,fence,attempt,at) VALUES(?,'cancel_requested',5,1,9)",job),/job_journal_event_new/,'a receipt for something that did not happen');
  await rejects(run("INSERT INTO job_journal_events(job_id,event,fence,attempt,at) VALUES(?,'lease_lost',0,0,1)",job),/CHECK|job_journal_event_new/);
  await rejects(run('DELETE FROM job_journal_events WHERE sequence=?',first.sequence),/job_journal_event_retained/);
  await rejects(run('DELETE FROM job_journal WHERE id=?',job),/job_journal_retained/);
  const finished=await reach.complete();
  await run('DELETE FROM job_journal WHERE id=?',finished);
  for(const table of ['job_journal_events','job_outbox'])assert.equal((await one(`SELECT count(*) n FROM ${table} WHERE job_id=?`,finished)).n,0,table+' left with its finished job');
  const second=await reach.cancelled();await run('DELETE FROM job_journal_events WHERE job_id=?',second);
  assert.equal((await one('SELECT count(*) n FROM job_journal_events WHERE job_id=?',second)).n,0,'events of a finished job may be deleted');
 });
 await check('the outbox: identity frozen, acknowledged once, deleted only with a finished job',async()=>{
  const job=await reach.leased(),entry=await one('SELECT * FROM job_outbox WHERE job_id=?',job);
  for(const set of ['delivery_id=\''+id()+'\'','job_id=\''+id()+'\'','envelope_digest=\''+hex('9')+'\''])await rejects(run(`UPDATE job_outbox SET ${set} WHERE delivery_id=?`,entry.delivery_id),/job_outbox_identity|FOREIGN/);
  await rejects(run('UPDATE job_outbox SET acknowledged_at=NULL WHERE delivery_id=?',entry.delivery_id),/job_outbox_identity/);
  await run('UPDATE job_outbox SET acknowledged_at=77 WHERE delivery_id=?',entry.delivery_id);
  await rejects(run('UPDATE job_outbox SET acknowledged_at=78 WHERE delivery_id=?',entry.delivery_id),/job_outbox_identity/);
  await rejects(run('DELETE FROM job_outbox WHERE delivery_id=?',entry.delivery_id),/job_outbox_retained/);
  await rejects(run("INSERT INTO job_outbox(delivery_id,job_id,envelope_digest) VALUES(?,?,?)",id(),id(),hex('a')),/job_outbox_new|FOREIGN/);
  assert.equal((await one('SELECT state FROM job_journal WHERE id=?',job)).state,'leased','the acknowledgement is not a state change');
 });
 await check('account deletion cascades through the journal, its events and its outbox, even for unfinished jobs; another account is untouched',async()=>{
  const gone=id();await run("INSERT INTO users(id,email,created_at) VALUES(?,?,'2026-10-29')",gone,gone+'@example.test');
  const job=id(),json=JSON.stringify({jobId:job,limits:{maxAttempts:3},ownerAccountId:gone,purpose:'owner-push',schedule:{createdAt:0,expiresAt:expiry,notBefore:0}});
  await run("INSERT INTO job_journal(id,owner_user_id,purpose,envelope_json,envelope_digest,created_at,expires_at,max_attempts,due,initial_due,last_event,last_at) VALUES(?,?,'owner-push',?,?,0,?,3,0,0,'enqueued',0)",job,gone,json,hex('c'),expiry);
  await apply0('claimed',job,0);await apply0('intent',job,1);
  const keep=await one('SELECT count(*) n FROM job_journal WHERE owner_user_id=?',owner);
  await run('DELETE FROM users WHERE id=?',gone);
  for(const table of ['job_journal_events','job_outbox'])assert.equal((await one(`SELECT count(*) n FROM ${table} WHERE job_id=?`,job)).n,0,table);
  assert.equal((await one('SELECT count(*) n FROM job_journal WHERE id=?',job)).n,0);assert.equal((await one('SELECT count(*) n FROM job_journal WHERE owner_user_id=?',owner)).n,keep.n);
 });
 console.log(`Schema batch 3a: ${cases} cases passed on ${process.argv.includes('--d1')?'local D1':'SQLite'}; job journal tables, indexes and triggers, the full state-transition matrix, immutable events, the outbox and the account cascade. No provider call, no job runner wiring.`);
}finally{await fixture.close();}
