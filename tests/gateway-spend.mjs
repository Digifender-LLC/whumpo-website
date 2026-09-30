import assert from 'node:assert/strict';import {mkdtemp,readFile,rm} from 'node:fs/promises';import {execFileSync} from 'node:child_process';import {build} from 'esbuild';import wrangler from 'wrangler';
const b=await build({stdin:{contents:"export * from './src/gateway-spend';export * from './src/inference-routing';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {planInferenceRoute,inferenceRoutingPolicy,reserveGatewaySpend,dispatchGatewaySpend,releaseGatewaySpend,uncertainGatewaySpend,settleGatewaySpend}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const scenario=JSON.parse(await readFile('tests/fixtures/inference-routing-scenario.json','utf8'));
const dir=await mkdtemp('/tmp/whumpo-gateway-spend-');let proxy;
try{
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',dir],{stdio:'pipe'});
 proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB;
 const owner=crypto.randomUUID(),other=crypto.randomUUID();for(const user of [owner,other])await db.prepare("INSERT INTO users(id,email,password_salt,password_hash,created_at) VALUES(?,?,'test','test',?)").bind(user,user+'@example.test',new Date().toISOString()).run();
 const task=crypto.randomUUID(),now=Date.now(),expires=now+3600000;
 const candidate={...scenario.candidates[0],rateValidFrom:now-1,rateValidUntil:expires,benchmark:{...scenario.candidates[0].benchmark,validUntil:expires}};
 const req={...scenario.request,ownerId:owner,taskId:task,now};const decision=planInferenceRoute([candidate],req);
 const buckets={task:crypto.randomUUID(),account:crypto.randomUUID(),platform:crypto.randomUUID(),premium:crypto.randomUUID(),approval:crypto.randomUUID()};
 for(const scope of ['task','account','platform','premium'])await db.prepare('INSERT INTO gateway_spend_buckets(id,scope,user_id,task_id,limit_micros) VALUES(?,?,?,?,?)').bind(buckets[scope],scope,scope==='platform'?null:owner,scope==='task'?task:null,scope==='premium'?10000:3000).run();
 const standard={task:buckets.task,account:buckets.account,platform:buckets.platform};
 const balances=()=>db.prepare('SELECT id,held_micros,spent_micros FROM gateway_spend_buckets ORDER BY id').all();
 const ids=[crypto.randomUUID(),crypto.randomUUID()];const results=await Promise.allSettled(ids.map(id=>reserveGatewaySpend(db,owner,id,decision,standard)));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const winner=ids[results.findIndex(r=>r.status==='fulfilled')];for(const row of (await balances()).results.filter(r=>r.id!==buckets.premium))assert.equal(row.held_micros,2100);
 assert.equal((await reserveGatewaySpend(db,owner,winner,decision,standard)).replayed,true);
 await assert.rejects(reserveGatewaySpend(db,other,winner,decision,standard));
 await assert.rejects(reserveGatewaySpend(db,owner,winner,{...decision,selected:{...decision.selected,model:'changed'}},standard));
 assert.equal(await dispatchGatewaySpend(db,other,winner),false);assert.equal(await dispatchGatewaySpend(db,owner,winner),true);assert.equal(await dispatchGatewaySpend(db,owner,winner),false);
 await uncertainGatewaySpend(db,owner,winner);assert.equal(await releaseGatewaySpend(db,owner,winner),false);
 await assert.rejects(settleGatewaySpend(db,owner,winner,1001,1000));for(const row of (await balances()).results.filter(r=>r.id!==buckets.premium))assert.equal(row.held_micros,2100);
 const settled=await settleGatewaySpend(db,owner,winner,100,200);assert.equal(settled.providerMicros,400);assert.equal(settled.customerMicros,0);assert.equal((await settleGatewaySpend(db,owner,winner,100,200)).replayed,true);await assert.rejects(settleGatewaySpend(db,owner,winner,101,200));
 for(const row of (await balances()).results.filter(r=>r.id!==buckets.premium)){assert.equal(row.held_micros,0);assert.equal(row.spent_micros,400);}
 await assert.rejects(db.prepare('UPDATE gateway_spend_attempts SET snapshot=? WHERE id=?').bind('{}',winner).run());await assert.rejects(db.prepare('DELETE FROM gateway_spend_attempts WHERE id=?').bind(winner).run());
 // Atomic release vs dispatch: either safe release or one dispatch, never both.
 const racing=crypto.randomUUID();await reserveGatewaySpend(db,owner,racing,decision,standard);const race=await Promise.all([dispatchGatewaySpend(db,owner,racing),releaseGatewaySpend(db,owner,racing)]);assert.equal(race.filter(Boolean).length,1);if(race[0])await settleGatewaySpend(db,owner,racing,0,0);
 const unused=crypto.randomUUID();await reserveGatewaySpend(db,owner,unused,decision,standard);assert.equal(await releaseGatewaySpend(db,owner,unused),true);assert.equal(await releaseGatewaySpend(db,owner,unused),false);assert.equal(await dispatchGatewaySpend(db,owner,unused),false);
 // Premium approvals are cumulative across attempts, not per-call allowances.
 for(const id of [buckets.task,buckets.account,buckets.platform])await db.prepare('UPDATE gateway_spend_buckets SET limit_micros=20000 WHERE id=?').bind(id).run();
 // Each operator scope independently denies admission; no partial hold survives.
 for(const field of ['task','account','platform']){const bucket=buckets[field],row=await db.prepare('SELECT spent_micros FROM gateway_spend_buckets WHERE id=?').bind(bucket).first();await db.prepare('UPDATE gateway_spend_buckets SET limit_micros=? WHERE id=?').bind(row.spent_micros+2099,bucket).run();const before=(await balances()).results;await assert.rejects(reserveGatewaySpend(db,owner,crypto.randomUUID(),decision,standard));assert.deepEqual((await balances()).results,before);await db.prepare('UPDATE gateway_spend_buckets SET limit_micros=20000 WHERE id=?').bind(bucket).run();}
 await assert.rejects(reserveGatewaySpend(db,owner,crypto.randomUUID(),{...decision,selected:{...decision.selected,rateValidUntil:Date.now()-10000}},standard));
 const approval={approvalId:buckets.approval,ownerId:owner,taskId:task,catalogVersion:req.catalogVersion,policy:inferenceRoutingPolicy,expiresAt:expires,candidateIds:[candidate.id],tariffId:'synthetic-tariff',retailMultiplierBps:15000,maxCustomerMicros:4000,remainingCustomerMicros:10000};
 await db.prepare("INSERT INTO gateway_spend_buckets(id,scope,user_id,task_id,limit_micros,terms_json) VALUES(?,'approval',?,?,4000,?)").bind(buckets.approval,owner,task,JSON.stringify(approval)).run();
 const premium=planInferenceRoute([{...candidate,premium:true}],{...req,tier:'premium',premium:approval});const premiumIds=[crypto.randomUUID(),crypto.randomUUID()];const admissions=await Promise.allSettled(premiumIds.map(id=>reserveGatewaySpend(db,owner,id,premium,buckets)));assert.equal(admissions.filter(r=>r.status==='fulfilled').length,1);
 const premiumId=premiumIds[admissions.findIndex(r=>r.status==='fulfilled')];await dispatchGatewaySpend(db,owner,premiumId);
 await assert.rejects(db.prepare("UPDATE gateway_spend_attempts SET status='settled',input_tokens=100,output_tokens=200,provider_actual=1,customer_actual=1 WHERE id=?").bind(premiumId).run());
 const settlements=await Promise.all([settleGatewaySpend(db,owner,premiumId,100,200),settleGatewaySpend(db,owner,premiumId,100,200)]);assert.equal(settlements.filter(r=>!r.replayed).length,1);const paid=settlements[0];assert.equal(paid.providerMicros,400);assert.equal(paid.customerMicros,600);
 for(const id of [buckets.premium,buckets.approval]){const row=await db.prepare('SELECT held_micros,spent_micros FROM gateway_spend_buckets WHERE id=?').bind(id).first();assert.deepEqual(row,{held_micros:0,spent_micros:600});}
 await assert.rejects(db.prepare('UPDATE gateway_spend_buckets SET limit_micros=5000 WHERE id=?').bind(buckets.approval).run());
 const invalidId=crypto.randomUUID(),before=(await balances()).results;await assert.rejects(reserveGatewaySpend(db,owner,invalidId,{...premium,selected:{...premium.selected,taskId:'other-task'}},buckets));assert.deepEqual((await balances()).results,before);assert.equal(await db.prepare('SELECT id FROM gateway_spend_attempts WHERE id=?').bind(invalidId).first(),null);
 console.log('Actual D1 gateway spend passed: atomic multi-budget admission, concurrent contention, owner/replay isolation, immutable receipts, dispatch/release race, unknown holds, overrun refusal, exact settlement and cumulative premium approval cap. No provider calls or purchased credits.');
}finally{await proxy?.dispose();await rm(dir,{recursive:true,force:true});}
