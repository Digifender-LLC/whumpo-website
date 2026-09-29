import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
async function module(path){const b=await build({entryPoints:[path],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {createCheckout,stripeWebhook,checkoutEnabled}=await module('src/checkout.ts');const {getBilling}=await module('src/billing.ts');const worker=(await module('src/index.ts')).default;
const dir=await mkdtemp('/tmp/whumpo-checkout-');execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',dir],{stdio:'pipe'});
const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB;
const config={STRIPE_TEST_KEY:'sk_test_synthetic',STRIPE_WEBHOOK_SECRET:'whsec_synthetic'};
async function account(){const id=crypto.randomUUID();await db.prepare("INSERT INTO users(id,email,password_salt,password_hash,created_at) VALUES(?,?,?,'test',?)").bind(id,id+'@example.com','00',new Date().toISOString()).run();return id;}
let calls=0;const sessions=new Map(),keys=new Map();
const transport=async(url,init)=>{
 calls++;assert.equal(init.redirect,'manual');assert.equal(init.headers.authorization,'Bearer '+config.STRIPE_TEST_KEY);new Request(url,init);
 if(init.method==='POST'){
  const p=init.body;assert.equal(p.get('line_items[0][price_data][unit_amount]'),'500');assert.equal(p.get('line_items[0][quantity]'),'1');assert.equal(p.get('success_url'),'https://digifender.com/workspace/?checkout=returned');
  const key=init.headers['Idempotency-Key'];if(keys.has(key))return Response.json(keys.get(key));
  const id='cs_test_'+crypto.randomUUID().replaceAll('-','');const order=p.get('metadata[order_id]');const session={id,livemode:false,mode:'payment',status:'open',payment_status:'unpaid',amount_total:500,currency:'usd',metadata:{order_id:order},client_reference_id:order,url:'https://checkout.stripe.com/c/pay/'+id};sessions.set(id,session);keys.set(key,session);return Response.json(session);
 }
 return Response.json(sessions.get(url.split('/').at(-1)));
};
async function signed(sessionId,options={}){
 const raw=JSON.stringify({id:'evt_synthetic',type:options.type??'checkout.session.completed',livemode:options.live??false,data:{object:{id:sessionId}}});const timestamp=options.timestamp??Math.floor(Date.now()/1000);
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(config.STRIPE_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(timestamp+'.'+raw))).toString('hex');return new Request('https://digifender.com/api/stripe/webhook',{method:'POST',headers:{'stripe-signature':`t=${timestamp},v1=${options.bad?'0'.repeat(64):sig}`},body:raw});
}
try{
 const owner=await account(),other=await account();const id=crypto.randomUUID();
 assert.equal(checkoutEnabled({}),false);assert.equal(checkoutEnabled({...config,STRIPE_TEST_KEY:'sk_live_synthetic'}),false);
 await assert.rejects(createCheckout(db,{},owner,id,'credits-100',transport),{status:503});assert.equal(calls,0);
 const before=await getBilling(db,owner);const pair=await Promise.all([createCheckout(db,config,owner,id,'credits-100',transport),createCheckout(db,config,owner,id,'credits-100',transport)]);assert.equal(pair[0].url,pair[1].url);assert.equal(sessions.size,1);
 assert.equal((await getBilling(db,owner)).credits.available,0);await assert.rejects(createCheckout(db,config,other,id,'credits-100',transport),{status:409});await assert.rejects(createCheckout(db,config,owner,crypto.randomUUID(),'credits-9999',transport),{status:400});
 const session=[...sessions.values()][0];
 await stripeWebhook(await signed(session.id),db,config,transport);assert.equal((await getBilling(db,owner)).credits.available,0);
 for(const opts of [{bad:true},{timestamp:1},{timestamp:Math.floor(Date.now()/1000)+600},{live:true}])await assert.rejects(stripeWebhook(await signed(session.id,opts),db,config,transport),{status:400});
 session.status='complete';session.payment_status='paid';session.amount_total=1;await assert.rejects(stripeWebhook(await signed(session.id),db,config,transport),{status:409});session.amount_total=500;
 session.livemode=true;await assert.rejects(stripeWebhook(await signed(session.id),db,config,transport),{status:502});session.livemode=false;
 await Promise.all([stripeWebhook(await signed(session.id),db,config,transport),stripeWebhook(await signed(session.id,{type:'checkout.session.async_payment_succeeded'}),db,config,transport)]);
 await stripeWebhook(await signed(session.id),db,config,transport);
 assert.equal((await getBilling(db,owner)).credits.available,100);assert.equal((await getBilling(db,other)).credits.available,0);assert.equal((await getBilling(db,owner)).quota.spent,before.quota.spent);assert.deepEqual(await createCheckout(db,config,owner,id,'credits-100',transport),{fulfilled:true});
 assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM credit_grants WHERE user_id=?").bind(owner).first()).n,1);
 // Webhook can beat the session-write acknowledgement and must still fulfill once.
 const id2=crypto.randomUUID();await createCheckout(db,config,owner,id2,'credits-100',transport);const session2=[...sessions.values()].at(-1);
 // Simulate a committed order followed by a provider reply that never reached the caller.
 const id3=crypto.randomUUID();const lossy=async(url,init)=>{const response=await transport(url,init);throw new Error('lost provider acknowledgement');};await assert.rejects(createCheckout(db,config,owner,id3,'credits-100',lossy),{status:502});const session3=[...sessions.values()].at(-1);session3.status='complete';session3.payment_status='paid';await stripeWebhook(await signed(session3.id),db,config,transport);assert.deepEqual(await createCheckout(db,config,owner,id3,'credits-100',transport),{fulfilled:true});assert.equal((await getBilling(db,owner)).credits.available,200);
 // Atomic credit/order commit acknowledgement loss: retry cannot double credit.
 session2.status='complete';session2.payment_status='paid';let lost=false;const lossyDB=new Proxy(db,{get(target,key){if(key==='batch')return async x=>{const r=await target.batch(x);if(!lost){lost=true;throw Error('lost D1 acknowledgement');}return r;};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 await assert.rejects(stripeWebhook(await signed(session2.id),lossyDB,config,transport));await stripeWebhook(await signed(session2.id),db,config,transport);assert.equal((await getBilling(db,owner)).credits.available,300);
 // Local API keeps browser endpoints session/origin gated; webhook uses its own signature gate.
 const env={...proxy.env,ENVIRONMENT:'local',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}};
 assert.equal((await worker.fetch(new Request('https://digifender.com/api/billing/checkout',{method:'POST'}),env)).status,403);
 assert.equal((await worker.fetch(new Request('https://digifender.com/api/billing/checkout',{method:'POST',headers:{origin:'https://digifender.com'}}),env)).status,401);
 assert.equal((await worker.fetch(new Request('https://digifender.com/api/stripe/webhook',{method:'POST'}),env)).status,503);
 assert.equal((await worker.fetch(new Request('https://digifender.com/api/stripe/webhook',{method:'POST'}),{...env,...config})).status,400);
 for(let n=0;n<2;n++)await createCheckout(db,config,owner,crypto.randomUUID(),'credits-100',transport);await assert.rejects(createCheckout(db,config,owner,crypto.randomUUID(),'credits-100',transport),{status:429});
 await db.prepare('DELETE FROM users WHERE id=?').bind(owner).run();await stripeWebhook(await signed(session.id),db,config,transport);
 console.log('Checkout passed: test-only configuration, server prices, ownership, concurrency, signature/age checks, paid-state validation, duplicate/out-of-order events, lost acknowledgements, quotas, deleted users and API gates.');
}finally{await proxy.dispose();await rm(dir,{recursive:true,force:true});}
