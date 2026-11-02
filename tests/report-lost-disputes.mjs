import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';
import {lostDisputes} from '../tools/report-lost-disputes.mjs';

// WH-041 Q-31: the support-review flag for a lost dispute is a read-only list of the dispute-lost voids. Local D1 only; no Stripe or Cloudflare call.
const fixture=await databaseFixture({d1:true}),db=fixture.db;
const owner=async()=>{const id=crypto.randomUUID();await db.prepare("INSERT INTO users(id,email,created_at) VALUES(?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(id,id+'@example.invalid').run();return id;};
const voidOf=(invoice,reason,source,at)=>db.prepare('INSERT INTO stripe_invoice_voids(invoice_id,reason,source_id,created_at) VALUES(?,?,?,?)').bind(invoice,reason,source,at).run();
try{
 const none=await lostDisputes(db);assert.deepEqual([none.count,none.disputes,none.truncated],[0,[],false]);assert.match(none.nextStep,/No lost disputes/);
 const a=await owner(),b=await owner(),c=await owner();
 const ia=await paidPlan(db,a,'starter'),ib=await paidPlan(db,b,'personal'),ic=await paidPlan(db,c,'business');
 await voidOf(ib,'dispute-lost','dp_second',2000);await voidOf(ia,'dispute-lost','dp_first',1000);await voidOf(ic,'refund','ch_refund',1500);
 const report=await lostDisputes(db);
 assert.equal(report.count,2,'a refund void is not a lost dispute');
 assert.deepEqual(report.disputes.map(d=>[d.accountId,d.invoiceId,d.disputeId,d.voidedAt]),[[a,ia,'dp_first',new Date(1000*1000).toISOString()],[b,ib,'dp_second',new Date(2000*1000).toISOString()]],'oldest first, ids only');
 assert.deepEqual(Object.keys(report.disputes[0]).sort(),['accountId','disputeId','invoiceId','voidedAt'],'no identity, email or payment field');
 assert.equal(JSON.stringify(report).includes('example.invalid'),false,'no email in the output');
 const before=(await db.prepare('SELECT COUNT(*) n FROM stripe_invoice_voids').first()).n;await lostDisputes(db);assert.equal((await db.prepare('SELECT COUNT(*) n FROM stripe_invoice_voids').first()).n,before,'read-only');
 const cut=await lostDisputes(db,1);assert.deepEqual([cut.count,cut.truncated],[1,true],'a longer list says so');
 for(const bad of [0,-1,1.5,1001,'3'])await assert.rejects(lostDisputes(db,bad),/Invalid limit/);
 await assert.rejects(lostDisputes({prepare:()=>({bind:()=>({all:async()=>({results:[{account_id:1,invoice_id:'i',dispute_id:'d',voided_at:1}]})})})}),/unavailable/);
 console.log('Lost dispute report passed: only dispute-lost voids, oldest first, internal ids only, no email, read-only, truncation stated, limits validated, malformed rows refused; local D1, no network.');
}finally{await fixture.close();}
