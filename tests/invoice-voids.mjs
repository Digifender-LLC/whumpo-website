import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';

// WH-042: a fully refunded charge or a dispute closed as lost voids the invoice it settled (a compensating row; the invoice stays immutable) and the entitlement view reads past it.
// Synthetic transport only: the shapes are the ones src/stripe-billing.ts reads (Charge.refunded, Dispute.status, payment_intent, invoice_payments by payment intent); no Stripe call.
const b=await build({stdin:{contents:"export {stripeBillingWebhook} from './src/stripe-billing';export {getBilling} from './src/billing';export {plans} from './src/plans';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
const m=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const fixture=await databaseFixture({d1:true}),db=fixture.db;
const prices={};for(const p of m.plans.filter(p=>p.monthlyCents))for(const i of ['month','year'])prices[p.id+':'+i]='price_'+p.id.replaceAll('-','')+i;
const env={STRIPE_TEST_KEY:'sk_test_synthetic',STRIPE_WEBHOOK_SECRET:'whsec_synthetic',STRIPE_SANDBOX_CATALOG:JSON.stringify({version:1,prices}),STRIPE_TEST_PUBLISHABLE_KEY:'pk_test_'+'a'.repeat(40),STRIPE_CHECKOUT_OPEN:'true'};
async function event(type,id,t=Math.floor(Date.now()/1000)){const raw=JSON.stringify({id:'evt_'+id,type,livemode:false,data:{object:{id}}});const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(t+'.'+raw))).toString('hex');return new Request('https://whumpo.com/api/stripe/webhook',{method:'POST',headers:{'stripe-signature':`t=${t},v1=${sig}`},body:raw});}
const objects=new Map(),payments=new Map();let reads=[];
const transport=async(url,init)=>{
 assert.equal(init.method,'GET','voiding never writes to Stripe');assert.equal(init.headers['Stripe-Version'],'2026-10-28.endive');
 const u=new URL(url),path=u.pathname.replace('/v1/','');reads.push(path+u.search);
 if(path==='invoice_payments'){assert.equal(u.searchParams.get('payment[type]'),'payment_intent');const found=payments.get(u.searchParams.get('payment[payment_intent]'));return Response.json(found??{has_more:false,data:[]});}
 const value=objects.get(path);return value?Response.json(value):new Response('{}',{status:404});
};
const owner=async()=>{const id=crypto.randomUUID();await db.prepare("INSERT INTO users(id,email,created_at) VALUES(?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(id,id+'@example.invalid').run();return id;};
const voids=async()=>(await db.prepare('SELECT invoice_id,reason,source_id FROM stripe_invoice_voids ORDER BY invoice_id').all()).results;
const covered=async user=>(await m.getBilling(db,user)).plan.id;
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(e){console.error('FAILED:',name);throw e;}};
const settle=(invoice,pi)=>payments.set(pi,{has_more:false,data:[{invoice,status:'paid'}]});

try{
await check('a fully refunded charge ends the coverage of its invoice; the invoice row is untouched',async()=>{
 const user=await owner(),invoice=await paidPlan(db,user,'starter');
 assert.equal(await covered(user),'starter');
 settle(invoice,'pi_refund1');objects.set('charges/ch_refund1',{id:'ch_refund1',livemode:false,payment_intent:'pi_refund1',refunded:true});
 await m.stripeBillingWebhook(await event('charge.refunded','ch_refund1'),db,env,transport);
 assert.deepEqual((await voids()).filter(v=>v.invoice_id===invoice),[{invoice_id:invoice,reason:'refund',source_id:'ch_refund1'}]);
 assert.notEqual(await covered(user),'starter','coverage ended');
 assert.ok(await db.prepare('SELECT 1 x FROM stripe_paid_invoices WHERE id=?').bind(invoice).first(),'the paid invoice is kept');
 await m.stripeBillingWebhook(await event('charge.refunded','ch_refund1'),db,env,transport);
 assert.equal((await voids()).filter(v=>v.invoice_id===invoice).length,1,'redelivery adds nothing');
});
await check('a partial refund, an open dispute and a won dispute change nothing',async()=>{
 const user=await owner(),invoice=await paidPlan(db,user,'personal');
 settle(invoice,'pi_keep');
 objects.set('charges/ch_keep',{id:'ch_keep',livemode:false,payment_intent:'pi_keep',refunded:false});
 await m.stripeBillingWebhook(await event('charge.refunded','ch_keep'),db,env,transport);
 for(const status of ['needs_response','under_review','won','warning_closed']){objects.set('disputes/dp_keep',{id:'dp_keep',livemode:false,payment_intent:'pi_keep',status});await m.stripeBillingWebhook(await event('charge.dispute.closed','dp_keep'),db,env,transport);}
 assert.equal((await voids()).some(v=>v.invoice_id===invoice),false);assert.equal(await covered(user),'personal');
});
await check('a dispute closed as lost voids its invoice',async()=>{
 const user=await owner(),invoice=await paidPlan(db,user,'business');
 settle(invoice,'pi_lost');objects.set('disputes/dp_lost',{id:'dp_lost',livemode:false,payment_intent:'pi_lost',status:'lost'});
 await m.stripeBillingWebhook(await event('charge.dispute.closed','dp_lost'),db,env,transport);
 assert.deepEqual((await voids()).filter(v=>v.invoice_id===invoice),[{invoice_id:invoice,reason:'dispute-lost',source_id:'dp_lost'}]);assert.notEqual(await covered(user),'business');
});
await check('only the voided invoice loses coverage; a payment for no invoice of ours changes nothing',async()=>{
 const user=await owner(),a=await paidPlan(db,user,'starter',{start:Math.floor(Date.now()/1000)-60,end:Math.floor(Date.now()/1000)+86400}),c=await paidPlan(db,user,'business',{start:Math.floor(Date.now()/1000)-60,end:Math.floor(Date.now()/1000)+86400});
 settle(a,'pi_a');objects.set('charges/ch_a',{id:'ch_a',livemode:false,payment_intent:'pi_a',refunded:true});
 await m.stripeBillingWebhook(await event('charge.refunded','ch_a'),db,env,transport);
 assert.equal(await covered(user),'business','the other paid invoice still covers');
 const before=(await voids()).length;
 objects.set('charges/ch_none',{id:'ch_none',livemode:false,payment_intent:'pi_none',refunded:true});await m.stripeBillingWebhook(await event('charge.refunded','ch_none'),db,env,transport);
 settle('in_unknown1','pi_unk');objects.set('charges/ch_unk',{id:'ch_unk',livemode:false,payment_intent:'pi_unk',refunded:true});await m.stripeBillingWebhook(await event('charge.refunded','ch_unk'),db,env,transport);
 assert.equal((await voids()).length,before,'no invoice payment and an invoice we never recorded each add nothing');
 void c;
});
await check('an unrecognised shape throws instead of silently keeping or removing access',async()=>{
 const user=await owner(),invoice=await paidPlan(db,user,'starter');settle(invoice,'pi_odd');
 const attempts=[['charges/ch_live1',{id:'ch_live1',livemode:true,payment_intent:'pi_odd',refunded:true}],['charges/ch_mismatch',{id:'ch_other',livemode:false,payment_intent:'pi_odd',refunded:true}],['charges/ch_nopi',{id:'ch_nopi',livemode:false,refunded:true}],['charges/ch_badpi',{id:'ch_badpi',livemode:false,payment_intent:'x y',refunded:true}]];
 for(const [path,obj] of attempts){objects.set(path,obj);await assert.rejects(m.stripeBillingWebhook(await event('charge.refunded',path.split('/')[1]),db,env,transport),{status:409},path);}
 payments.set('pi_two',{has_more:false,data:[{invoice},{invoice}]});objects.set('charges/ch_two',{id:'ch_two',livemode:false,payment_intent:'pi_two',refunded:true});
 await assert.rejects(m.stripeBillingWebhook(await event('charge.refunded','ch_two'),db,env,transport),{status:409});
 payments.set('pi_more',{has_more:true,data:[{invoice}]});objects.set('charges/ch_more',{id:'ch_more',livemode:false,payment_intent:'pi_more',refunded:true});
 await assert.rejects(m.stripeBillingWebhook(await event('charge.refunded','ch_more'),db,env,transport),{status:409});
 payments.set('pi_badinv',{has_more:false,data:[{invoice:'not_an_invoice'}]});objects.set('charges/ch_badinv',{id:'ch_badinv',livemode:false,payment_intent:'pi_badinv',refunded:true});
 await assert.rejects(m.stripeBillingWebhook(await event('charge.refunded','ch_badinv'),db,env,transport),{status:409});
 assert.equal((await voids()).some(v=>v.invoice_id===invoice),false);
});
await check('a void is a fact: it cannot be edited or removed on its own, and goes with its invoice',async()=>{
 const user=await owner(),invoice=await paidPlan(db,user,'starter');settle(invoice,'pi_imm');objects.set('charges/ch_imm',{id:'ch_imm',livemode:false,payment_intent:'pi_imm',refunded:true});
 await m.stripeBillingWebhook(await event('charge.refunded','ch_imm'),db,env,transport);
 await assert.rejects(db.prepare("UPDATE stripe_invoice_voids SET reason='dispute-lost' WHERE invoice_id=?").bind(invoice).run(),/immutable/);
 await assert.rejects(db.prepare('DELETE FROM stripe_invoice_voids WHERE invoice_id=?').bind(invoice).run(),/immutable/);
 await assert.rejects(db.prepare("INSERT INTO stripe_invoice_voids(invoice_id,reason,source_id,created_at) VALUES(?,'chargeback','x',1)").bind(invoice).run());
 await db.prepare('DELETE FROM users WHERE id=?').bind(user).run();
 assert.equal((await voids()).some(v=>v.invoice_id===invoice),false,'the account deletion removes the invoice and its void together');
});
await check('the webhook stays closed with checkout closed, and makes no Stripe write',async()=>{
 const user=await owner(),invoice=await paidPlan(db,user,'starter');settle(invoice,'pi_closed');objects.set('charges/ch_closed',{id:'ch_closed',livemode:false,payment_intent:'pi_closed',refunded:true});
 await assert.rejects(m.stripeBillingWebhook(await event('charge.refunded','ch_closed'),db,{...env,STRIPE_CHECKOUT_OPEN:undefined},transport),{status:503});
 assert.equal((await voids()).some(v=>v.invoice_id===invoice),false);
});
console.log(`Invoice voids passed (${cases} cases): full refund and lost dispute void the invoice by compensating row, partial/open/won change nothing, unrecognised shapes throw, immutable rows, cascade with the account, closed gate; synthetic transport, no Stripe call.`);
}finally{await fixture.close();}
