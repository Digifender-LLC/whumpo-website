import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';

// WH-145: the rule_approvals table and its minimal store (issue, read, count a use) over the current schema on disposable in-memory
// SQLite and, with --d1, actual local D1. Synthetic rows only: no provider, network, credential or job runner (WH-069 is not wired).
const bundle=await build({stdin:{contents:"export * from './src/connector-catalog/rule-approvals-store';export * from './src/connector-catalog/rule-authority';export {connectorCatalog} from './src/connector-catalog/catalog';",resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const fixture=await databaseFixture(),db=fixture.db;
const id=()=>crypto.randomUUID(),run=(sql,...v)=>db.prepare(sql).bind(...v).run(),one=(sql,...v)=>db.prepare(sql).bind(...v).first();
const hex=c=>c.repeat(64),rejects=(p,re)=>assert.rejects(p,re),day=86400000;
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(e){console.error('FAILED:',name);throw e;}};
const user=async()=>{const u=id();await run("INSERT INTO users(id,email,created_at) VALUES(?,?,'2026-10-29')",u,u+'@example.test');return u;};
const input=(ownerId,x={})=>({ownerId,ruleId:x.ruleId??'rule-1',ruleRevision:x.rev??1,providerId:x.provider??'hubspot',operationId:'contact.create',destinationDigest:hex('a'),bodyTemplateDigest:hex('b'),credentialId:'credential-1',maxPerPeriod:x.max??2});
const raw=(o,n)=>run("INSERT INTO rule_approvals(approval_id,owner_id,rule_id,rule_revision,provider,operation_id,destination_digest,template_digest,credential_id,max_per_period,period_start,used_count,created_at,revision) VALUES(?,?,'r',?,'hubspot','contact.create',?,?,'c',2,0,0,1,1)",id(),o,n,hex('a'),hex('b'));
try{
 await check('issue binds operation, destination, template, limit and credential; read returns the shape admitRuleAction takes',async()=>{
  const o=await user(),approvalId=await m.issueRuleApproval(db,input(o));
  const read=await m.readRuleApproval(db,o,'rule-1',1);
  assert.deepEqual(read,{approvalId,providerId:'hubspot',approval:{operationId:'contact.create',destinationDigest:hex('a'),bodyTemplateDigest:hex('b'),maxPerPeriod:2,credentialId:'credential-1'},usedThisPeriod:0});
  const live=structuredClone(m.connectorCatalog);for(const p of Object.values(live.providers))p.readiness='live-accepted';
  const principal={kind:'rule',ownerId:o,ruleId:'rule-1',ruleRevision:1,jobDigest:hex('j'),approval:read.approval};
  const use={providerId:read.providerId,operationId:'contact.create',destinationDigest:hex('a'),bodyTemplateDigest:hex('b'),credentialId:'credential-1',usedThisPeriod:read.usedThisPeriod};
  assert.deepEqual(m.admitRuleAction(live,principal,use),read.approval);
  assert.equal(await m.readRuleApproval(db,o,'rule-1',2),null);assert.equal(await m.readRuleApproval(db,await user(),'rule-1',1),null,'another owner reads nothing');
 });
 await check('one approval per rule revision; malformed bindings, unknown provider and github are refused',async()=>{
  const o=await user();await m.issueRuleApproval(db,input(o));
  await rejects(m.issueRuleApproval(db,input(o)),/UNIQUE/);await m.issueRuleApproval(db,input(o,{rev:2}));
  await rejects(m.issueRuleApproval(db,{...input(o,{rev:3}),destinationDigest:'z'.repeat(64)}),/CHECK/);
  await rejects(m.issueRuleApproval(db,{...input(o,{rev:3}),maxPerPeriod:0}),/CHECK/);await rejects(m.issueRuleApproval(db,input(o,{rev:3,provider:'github'})),/CHECK/);
  await rejects(m.issueRuleApproval(db,input(id(),{rev:9})),/FOREIGN KEY/);
  await rejects(run("INSERT INTO rule_approvals(approval_id,owner_id,rule_id,rule_revision,provider,operation_id,destination_digest,template_digest,credential_id,max_per_period,period_start,used_count,created_at,revision) VALUES(?,?,'r',1,'hubspot','contact.create',?,?,'c',2,0,1,1,1)",id(),o,hex('a'),hex('b')),/rule_approval_new/);
 });
 await check('the use counter stops at the limit and counts exactly',async()=>{
  const o=await user(),a=await m.issueRuleApproval(db,input(o));
  assert.equal(await m.countRuleUse(db,o,a),true);assert.equal((await m.readRuleApproval(db,o,'rule-1',1)).usedThisPeriod,1);
  assert.equal(await m.countRuleUse(db,o,a),true);assert.equal(await m.countRuleUse(db,o,a),false);assert.equal((await m.readRuleApproval(db,o,'rule-1',1)).usedThisPeriod,2);
  assert.equal(await m.countRuleUse(db,await user(),a),false,'another owner cannot count the use');assert.equal(await m.countRuleUse(db,o,id()),false);
  const racing=await m.issueRuleApproval(db,input(o,{rev:5,max:3}));
  assert.equal((await Promise.all([1,2,3,4,5].map(()=>m.countRuleUse(db,o,racing)))).filter(Boolean).length,3);
 });
 await check('guards: binding frozen, counter moves one step on the database clock, revoked is final, only revoked rows delete',async()=>{
  const o=await user(),a=await m.issueRuleApproval(db,input(o));
  for(const set of ["destination_digest='"+hex('c')+"'","template_digest='"+hex('c')+"'","credential_id='other'","operation_id='contact.update'","max_per_period=9","owner_id='x'","rule_revision=7","created_at=2"])
   await rejects(run(`UPDATE rule_approvals SET ${set},revision=revision+1 WHERE approval_id=?`,a),/rule_approval_guard|FOREIGN KEY/,set);
  const today=Math.floor(Date.now()/day)*day;
  await rejects(run('UPDATE rule_approvals SET used_count=2,period_start=?,revision=revision+1 WHERE approval_id=?',today,a),/rule_approval_guard/);   // skipping a step
  await rejects(run('UPDATE rule_approvals SET used_count=1,period_start=?,revision=revision+1 WHERE approval_id=?',today-day,a),/rule_approval_guard/); // wrong period
  await rejects(run('UPDATE rule_approvals SET used_count=1,period_start=?,revision=revision+2 WHERE approval_id=?',today,a),/rule_approval_guard/);
  await rejects(run('DELETE FROM rule_approvals WHERE approval_id=?',a),/rule_approval_retained/);
  await m.countRuleUse(db,o,a);
  await run('UPDATE rule_approvals SET revoked_at=?,revision=revision+1 WHERE approval_id=?',Date.now(),a);
  assert.equal(await m.countRuleUse(db,o,a),false);assert.equal(await m.readRuleApproval(db,o,'rule-1',1),null);
  await rejects(run('UPDATE rule_approvals SET revoked_at=NULL,revision=revision+1 WHERE approval_id=?',a),/rule_approval_guard/);
  await run('DELETE FROM rule_approvals WHERE approval_id=?',a);
 });
 await check('an owner holds at most 200 approvals; the account cascade removes unrevoked ones',async()=>{
  const o=await user();for(let n=1;n<=200;n++)await raw(o,n);
  await rejects(m.issueRuleApproval(db,input(o,{rev:201})),/rule_approval_new/);
  await run('DELETE FROM users WHERE id=?',o);assert.equal((await one('SELECT count(*) n FROM rule_approvals WHERE owner_id=?',o)).n,0);
 });
 // Last: it removes the guard trigger to age a row by a day, since the guard rightly refuses to move the period backwards.
 await check('a new UTC day restarts the count; yesterday reads as unused',async()=>{
  const o=await user(),a=await m.issueRuleApproval(db,input(o)),yesterday=Math.floor(Date.now()/day)*day-day;
  await m.countRuleUse(db,o,a);await m.countRuleUse(db,o,a);assert.equal(await m.countRuleUse(db,o,a),false);
  await run('DROP TRIGGER rule_approval_guard');await run('UPDATE rule_approvals SET period_start=? WHERE approval_id=?',yesterday,a);
  assert.equal((await m.readRuleApproval(db,o,'rule-1',1)).usedThisPeriod,0);
  assert.equal(await m.countRuleUse(db,o,a),true);assert.equal((await one('SELECT used_count n FROM rule_approvals WHERE approval_id=?',a)).n,1);
 });
 console.log(`Rule approval store: ${cases} cases passed on ${process.argv.includes('--d1')?'local D1':'SQLite'}; binding, one-step counter on the database clock, limit, revocation, cap and cascade. No provider, network or job runner.`);
}finally{await fixture.close();}
