import assert from 'node:assert/strict';
import {build} from 'esbuild';
const {outputFiles}=await build({stdin:{contents:"export * from './src/stripe-common';export {stripeBillingWebhook,subscriptionsEnabled} from './src/stripe-billing';export {publicPlans} from './src/plans';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {stripeTestConfigured,boundedText,readStripeEvent,stripeBillingWebhook,subscriptionsEnabled,publicPlans}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
const prices={};for(const p of publicPlans.filter(p=>p.monthlyCents))for(const i of ['month','year'])prices[p.id+':'+i]='price_fixture';
const env={STRIPE_TEST_KEY:'sk_test_synthetic',STRIPE_WEBHOOK_SECRET:'whsec_synthetic',STRIPE_SANDBOX_CATALOG:JSON.stringify({version:1,prices,portal:'bpc_fixture'})};
const db={prepare(){throw Error('Retired checkout must not access a database');},batch(){throw Error('Retired checkout must not fulfill');}};
let calls=0;const transport=async(url,init)=>{calls++;assert.equal(init.method,'GET');assert.equal(init.redirect,'manual');return Response.json({id:'cs_test_retired',livemode:false,mode:'payment',metadata:{order_id:crypto.randomUUID()},status:'complete',payment_status:'paid',amount_total:500,currency:'usd'});};
async function signed({t=Math.floor(Date.now()/1000),bad=false,live=false,type='checkout.session.completed',raw,multiple=false}={}){
 raw??=JSON.stringify({livemode:live,type,data:{object:{id:'cs_test_retired'}}});
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(t+'.'+raw))).toString('hex');
 return new Request('https://whumpo.com/api/stripe/webhook',{method:'POST',headers:{'stripe-signature':`t=${t},v1=${bad?'0'.repeat(64):sig}${multiple?',v1='+'0'.repeat(64):''}`},body:raw});
}
assert.equal(stripeTestConfigured({}),false);assert.equal(stripeTestConfigured({...env,STRIPE_TEST_KEY:'sk_live_fixture'}),false);assert.equal(subscriptionsEnabled(env),true);
for(const opts of [{bad:true},{t:1},{t:Math.floor(Date.now()/1000)+600},{live:true},{raw:'null'},{raw:'{'}])await assert.rejects(readStripeEvent(await signed(opts),env),e=>e.status===400);
await assert.rejects(boundedText(new Response('x'.repeat(11)),10),e=>e.status===413);
await assert.rejects(stripeBillingWebhook(await signed(),db,{...env,STRIPE_SANDBOX_CATALOG:undefined},transport),e=>e.status===503);assert.equal(calls,0);
for(const type of ['checkout.session.completed','checkout.session.async_payment_succeeded'])assert.deepEqual(await stripeBillingWebhook(await signed({type,multiple:true}),db,env,transport),{received:true});assert.equal(calls,2);
assert.deepEqual(await stripeBillingWebhook(await signed({type:'unrelated.event'}),db,env,transport),{received:true});assert.equal(calls,2);
console.log('Stripe boundary passed: bounded signed test payloads, signature rotation/age, missing current catalogue rejected, retired payment events acknowledged without fulfillment or database access.');
