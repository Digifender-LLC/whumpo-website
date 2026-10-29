import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';

// Schema batch 2 guards over the current schema on disposable in-memory SQLite and, with --d1, actual local D1: the WH-018
// account_closures table (forward-only states, terminal immutability, one open closure, survives the account) and the
// directories.live_digest check (a live directory always has its digest and review). Synthetic rows only.
const fixture=await databaseFixture(),db=fixture.db;
const id=()=>crypto.randomUUID(),run=(sql,...v)=>db.prepare(sql).bind(...v).run(),one=(sql,...v)=>db.prepare(sql).bind(...v).first();
const hex=c=>c.repeat(64),rejects=(p,re)=>assert.rejects(p,re);
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(e){console.error('FAILED:',name);throw e;}};
const open=(account,closure=id(),at=1000)=>run("INSERT INTO account_closures(closure_id,account_id,state,revision,requested_at,updated_at,history) VALUES(?,?,'requested',1,?,?,'[\"requested\"]')",closure,account,at,at).then(()=>closure);
// One forward step: the revision, the history and the update time move with the state, as src/account-closure/machine.ts does.
const step=(closure,state,extra='',at=2000)=>run(`UPDATE account_closures SET state=?,revision=revision+1,updated_at=?,history=json_insert(history,'$[#]',?)${extra} WHERE closure_id=?`,state,at,state,closure);
const reviewed=async c=>step(c,'reviewed',`,review_digest='${hex('a')}'`);
const confirmed=async c=>{await reviewed(c);await step(c,'confirmed');};
const quiescing=async c=>{await confirmed(c);await step(c,'quiescing',',quiesced_at=2500');};
try{
 await check('a closure starts requested at revision 1; one open closure per account; terminal ones do not block a new request',async()=>{
  const a='account-'+id(),c=await open(a);
  await rejects(open(a),/UNIQUE/);await open('account-'+id());
  const raw=(state,revision,updated,history)=>run('INSERT INTO account_closures(closure_id,account_id,state,revision,requested_at,updated_at,history) VALUES(?,?,?,?,1000,?,?)',id(),'account-'+id(),state,revision,updated,history);
  await rejects(raw('reviewed',1,1000,'["requested"]'),/account_closure_new/);await rejects(raw('requested',2,1000,'["requested"]'),/account_closure_new|CHECK/);
  await rejects(raw('requested',1,1000,'["requested","reviewed"]'),/account_closure_new/);await rejects(raw('requested',1,1001,'["requested"]'),/account_closure_new/);
  await step(c,'cancelled');await open(a);
  assert.equal((await one('SELECT count(*) n FROM account_closures WHERE account_id=?',a)).n,2);
 });
 await check('the full path requested -> reviewed -> confirmed -> quiescing -> closed, one step at a time',async()=>{
  const c=await open('account-'+id());
  await rejects(step(c,'confirmed'),/account_closure_guard/);await rejects(step(c,'quiescing',',quiesced_at=2500'),/account_closure_guard|CHECK/);await rejects(step(c,'closed',',closed_at=3000'),/account_closure_guard|CHECK/);
  await reviewed(c);await rejects(step(c,'quiescing',',quiesced_at=2500'),/account_closure_guard|CHECK/);await rejects(step(c,'requested'),/account_closure_guard/);
  await step(c,'confirmed');await step(c,'quiescing',',quiesced_at=2500');await step(c,'closed',',closed_at=3000',3000);
  const row=await one('SELECT * FROM account_closures WHERE closure_id=?',c);
  assert.deepEqual([row.state,row.revision,row.history,row.review_digest,row.quiesced_at,row.closed_at],['closed',5,'["requested","reviewed","confirmed","quiescing","closed"]',hex('a'),2500,3000]);
 });
 await check('closed, cancelled and failed are immutable; cancel is allowed before closed, fail only from confirmed or quiescing',async()=>{
  const closed=await open('account-'+id());await quiescing(closed);await step(closed,'closed',',closed_at=3000',3000);
  const cancelled=await open('account-'+id());await reviewed(cancelled);await step(cancelled,'cancelled');
  const failed=await open('account-'+id());await confirmed(failed);await step(failed,'failed',",failure_code='provider-timeout'");
  for(const c of [closed,cancelled,failed]){
   for(const to of ['reviewed','confirmed','quiescing','cancelled'])await rejects(step(c,to,to==='quiescing'?',quiesced_at=2500':''),/account_closure_guard|CHECK/);
   await rejects(run('UPDATE account_closures SET updated_at=updated_at+1,revision=revision+1 WHERE closure_id=?',c),/account_closure_guard/);
  }
  const early=await open('account-'+id());await rejects(step(early,'failed',",failure_code='x'"),/account_closure_guard/);
  const live=await open('account-'+id());await quiescing(live);await step(live,'cancelled');
  assert.equal((await one('SELECT quiesced_at q FROM account_closures WHERE closure_id=?',live)).q,2500,'a cancelled closure keeps its quiesce time');
 });
 await check('identity, digest and quiesce time are frozen outside their step; revision and history must advance together',async()=>{
  const c=await open('account-'+id());
  for(const set of ["account_id='other'","closure_id='other'","requested_at=999"])await rejects(run(`UPDATE account_closures SET ${set},state='reviewed',revision=revision+1,updated_at=2000,history=json_insert(history,'$[#]','reviewed'),review_digest='${hex('a')}' WHERE closure_id=?`,c),/account_closure_guard|CHECK/,set);
  await rejects(run(`UPDATE account_closures SET state='reviewed',revision=revision+2,updated_at=2000,history=json_insert(history,'$[#]','reviewed'),review_digest='${hex('a')}' WHERE closure_id=?`,c),/account_closure_guard/);
  await rejects(run(`UPDATE account_closures SET state='reviewed',revision=revision+1,updated_at=2000,history='["requested","closed"]',review_digest='${hex('a')}' WHERE closure_id=?`,c),/account_closure_guard/);
  await rejects(run(`UPDATE account_closures SET state='reviewed',revision=revision+1,updated_at=500,history=json_insert(history,'$[#]','reviewed'),review_digest='${hex('a')}' WHERE closure_id=?`,c),/account_closure_guard|CHECK/);
  await reviewed(c);
  await rejects(run(`UPDATE account_closures SET state='confirmed',revision=revision+1,updated_at=2100,history=json_insert(history,'$[#]','confirmed'),review_digest='${hex('b')}' WHERE closure_id=?`,c),/account_closure_guard/);
  await rejects(run(`UPDATE account_closures SET state='confirmed',revision=revision+1,updated_at=2100,history=json_insert(history,'$[#]','confirmed'),quiesced_at=2100 WHERE closure_id=?`,c),/account_closure_guard/);
  await rejects(step(c,'confirmed',",review_digest=NULL"),/account_closure_guard|CHECK/);
 });
 await check('state-specific columns are enforced and a closure is never deleted, nor tied to the account',async()=>{
  const a=id();await run("INSERT INTO users(id,email,created_at) VALUES(?,?,'2026-10-29')",a,a+'@example.test');
  const c=await open(a);await rejects(step(c,'reviewed'),/CHECK/);await reviewed(c);await step(c,'confirmed');
  await rejects(step(c,'failed'),/CHECK/);await rejects(step(c,'failed',",failure_code='Bad Code'"),/CHECK/);
  await rejects(run('DELETE FROM account_closures WHERE closure_id=?',c),/account_closure_retained/);
  await run('DELETE FROM users WHERE id=?',a);
  assert.equal((await one('SELECT state FROM account_closures WHERE closure_id=?',c)).state,'confirmed','the record outlives the account');
  await rejects(run('DELETE FROM account_closures WHERE closure_id=?',c),/account_closure_retained/);
 });
 await check('directories: a live row always has its digest and review; unpublished rows have neither',async()=>{
  const owner=id(),project=id(),review=id(),live='[{"name":"A"}]';
  await run("INSERT INTO users(id,email,created_at) VALUES(?,?,'2026-10-29')",owner,owner+'@example.test');
  await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Garden','Landscaping','draft',datetime('now'),datetime('now'))",project,owner);
  await run('INSERT INTO directories(project_id) VALUES(?)',project);
  await run("INSERT INTO directory_reviews(id,user_id,project_id,kind,snapshot_json,digest,expected_revision,publication_revision,expires_at) VALUES(?,?,?,'publish',?,?,0,0,'2999-01-01T00:00:00Z')",review,owner,project,live,hex('d'));
  await rejects(run('UPDATE directories SET live_json=? WHERE project_id=?',live,project),/CHECK/);
  await rejects(run('UPDATE directories SET live_json=?,live_review_id=? WHERE project_id=?',live,review,project),/CHECK/);
  await rejects(run('UPDATE directories SET live_json=?,live_digest=? WHERE project_id=?',live,hex('d'),project),/CHECK/);
  await rejects(run('UPDATE directories SET live_digest=? WHERE project_id=?',hex('d'),project),/CHECK/);
  await run('UPDATE directories SET live_json=?,live_review_id=?,live_digest=? WHERE project_id=?',live,review,hex('d'),project);
  await rejects(run('UPDATE directories SET live_digest=NULL WHERE project_id=?',project),/CHECK/);
  await run('UPDATE directories SET live_json=NULL,live_review_id=NULL,live_digest=NULL WHERE project_id=?',project);
 });
 console.log(`Schema batch 2: ${cases} cases passed on ${process.argv.includes('--d1')?'local D1':'SQLite'}; account closure states and immutability, and the live directory digest check. No route, job or deployment.`);
}finally{await fixture.close();}
