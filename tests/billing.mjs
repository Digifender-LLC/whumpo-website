import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile,readdir} from 'node:fs/promises';
import {build} from 'esbuild';
import {paidPlan} from './helpers/paid-plan.mjs';
const {outputFiles}=await build({stdin:{contents:"export * from './src/billing';export {default as worker} from './src/index';export {hashToken} from './src/security';export {reconcileChat} from './src/ai-chat';export {ensureInferenceBudget} from './src/model-costs';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {getBilling,ensureBilling,worker,hashToken,reconcileChat,ensureInferenceBudget}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
const sql=new DatabaseSync(':memory:');sql.exec('PRAGMA foreign_keys=ON');
const db={prepare(q){const bind=p=>({run:async()=>{const r=sql.prepare(q).run(...p);return {meta:{changes:r.changes}};},first:async()=>sql.prepare(q).get(...p)??null,all:async()=>({results:sql.prepare(q).all(...p)})});return {...bind([]),bind:(...p)=>bind(p)};}};
const retired=['billing_accounts','usage_periods','usage_operations','billing_ledger','credit_grants','plan_grants','checkout_orders','usage_waivers'];
try{
 const files=(await readdir('migrations')).filter(f=>f.endsWith('.sql')).sort();
 for(const f of files.filter(f=>f<'0117'))sql.exec(await readFile('migrations/'+f,'utf8'));
 const owner=crypto.randomUUID(),other=crypto.randomUUID(),turn=crypto.randomUUID(),now=new Date().toISOString();
 for(const id of [owner,other])sql.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").run(id,id+'@example.invalid',now);
 sql.prepare('INSERT INTO billing_accounts(user_id) VALUES(?)').run(owner);
 sql.prepare("INSERT INTO usage_periods(user_id,period,allowance) VALUES(?,'2026-10',50)").run(owner);
 sql.prepare("INSERT INTO usage_operations(id,user_id,period,request_hash,quoted_units,quota_reserved,credits_reserved,created_at,updated_at,expires_at) VALUES(?,?,'2026-10',?,10,10,0,?,?,?)").run(turn,owner,'a'.repeat(64),now,now,now);
 sql.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,1,'Old test','Pending',?,'ai','pending')").run(turn,owner,now);
 await paidPlan(db,owner,'personal');
 for(const f of files.filter(f=>f>='0117'))sql.exec(await readFile('migrations/'+f,'utf8'));
 for(const table of retired)assert.equal(sql.prepare('SELECT name FROM sqlite_schema WHERE name=?').get(table),undefined,table);
 assert.equal(sql.prepare('SELECT status FROM chat_turns WHERE id=?').get(turn).status,'failed');
 assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(),[]);
 assert.deepEqual(sql.prepare('SELECT id FROM plan_catalog ORDER BY tier').all().map(r=>r.id),['explore','starter','personal','business','business-pro']);
 assert.throws(()=>sql.exec("INSERT INTO plan_catalog VALUES('launch',1,3)"),/immutable/);
 for(const id of ['launch','studio','explore','unknown'])assert.throws(()=>sql.prepare("INSERT INTO stripe_subscription_orders(id,user_id,plan_id,interval,price_id,amount_cents,created_at) VALUES(?,?,?,'month','price_fixture',1700,1)").run(crypto.randomUUID(),owner,id),/current_plan_required/);
 const b=await getBilling(db,owner);assert.equal(b.plan.id,'personal');assert.equal(b.standardAI.creditCharge,0);assert.deepEqual(Object.keys(b).sort(),['period','plan','standardAI']);assert.equal((await getBilling(db,other)).plan.id,'explore');
 const at=2_000_000_000,when=t=>new Date(t*1000);
 await paidPlan(db,other,'personal',{start:at-200,end:at+20});await paidPlan(db,other,'personal',{start:at-100,end:at+200});
 await paidPlan(db,other,'personal',{start:at+100,end:at+300});
 assert.deepEqual((await ensureBilling(db,other,when(at))).coverage,{startsAt:at-200,endsAt:at+200});
 assert.deepEqual((await ensureBilling(db,other,when(at+100))).coverage,{startsAt:at-100,endsAt:at+300});
 assert.equal((await ensureBilling(db,other,when(at+300))).coverage,null);
 for(const bounds of [{starts_at:at+1,ends_at:at+10},{starts_at:at-10,ends_at:at},{starts_at:at-0.5,ends_at:at+10},{starts_at:at-10,ends_at:Number.MAX_SAFE_INTEGER+1}]){
  const invalid={prepare:()=>({bind:()=>({all:async()=>({results:[{plan_id:'personal',...bounds}]})})})};
  await assert.rejects(ensureBilling(invalid,other,when(at)),e=>e.status===409);
 }
 for(const plan_id of ['launch','studio','unknown','explore'])await assert.rejects(ensureBilling({prepare(){return {bind(){return {all:async()=>({results:[{plan_id}]})}}}}},owner),e=>e.status===409);
 for(const plan of ['unknown','constructor','toString'])await assert.rejects(ensureInferenceBudget(db,owner,'2026-10',plan),/Unknown inference plan/);
 const orphan=crypto.randomUUID();sql.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,2,'Missing current receipt','Pending',?,'ai','pending')").run(orphan,owner,now);
 await assert.rejects(reconcileChat(db,owner),e=>e.status===409);assert.equal(sql.prepare('SELECT status FROM chat_turns WHERE id=?').get(orphan).status,'pending');
 const token='1'.repeat(64);sql.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(await hashToken(token),owner,new Date(Date.now()+60000).toISOString(),now);
 const env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})}},ctx={waitUntil(){throw Error('No background work')}};
 for(const path of ['checkout','preferences']){
  const r=await worker.fetch(new Request('https://whumpo.com/api/billing/'+path,{method:'POST',headers:{origin:'https://whumpo.com',cookie:'tellumo_session='+token,'content-type':'application/json'},body:JSON.stringify({id:crypto.randomUUID(),product:'credits-100',overageEnabled:true})}),env,ctx);assert.equal(r.status,404,path);
 }
 const r=await worker.fetch(new Request('https://whumpo.com/api/billing',{headers:{cookie:'tellumo_session='+token}}),env,ctx);assert.equal(r.status,200);assert(!Object.hasOwn(await r.json(),'creditPack'));
 console.log('Current billing passed: populated test-state reset, no retired tables/plans/routes, invoice coverage, no customer metering, unknown plan rejection and missing-receipt refusal. Actual handlers + SQLite, no provider calls.');
}finally{sql.close();}
