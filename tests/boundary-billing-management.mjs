// WH-004 slice: in-app billing management (replaces the hosted billing portal) through the platform Worker's real default
// export with a real fixture session cookie and the correct Origin. Local SQLite (default) or local D1 (`--d1`); synthetic
// accounts, no network: global fetch is replaced by a recording Stripe stub.
// Routes: POST /api/billing/subscription/{cancel,resume,retry}, POST /api/billing/payment-method/{setup,complete},
// GET /api/billing/payment-method. Each resolves the caller's own customer and subscription from the caller's own rows.
//   1. Foreign customer: an owner with no customer row, or a NULL customer id, gets 409 from every route and no Stripe call
//      is made; GET payment-method answers {card:null} without a call. No customer row is created or borrowed.
//   2. Foreign subscription: an owner with a customer but no subscription gets 409; a subscription whose Stripe customer or
//      order metadata is not the caller's is refused before any write.
//   3. Foreign invoice: the latest invoice of the caller's subscription belonging to another customer or subscription is
//      refused before pay.
//   4. Foreign setup session: another owner's completed setup session (customer, owner metadata, payment method) never
//      becomes the caller's default payment method.
// Negative control: the owner of the objects succeeds on the same routes and every write names only that owner's ids.
// See docs/boundary-tests/billing-management.md.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';

const b=await build({stdin:{contents:"export {publicPlans} from './src/plans';export {default as worker} from './src/index';export {hashToken,newSessionToken} from './src/security';export {admitWorkspace} from './src/workspace-identity/admission';export {resolveIdentity} from './src/workspace-identity/authority';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const {publicPlans,worker}=m;
const store=await databaseFixture(),db=store.db,hex=()=>crypto.randomUUID().replaceAll('-','');
// Fixture values are built at runtime from short, obviously fake parts; none is a real or credential-shaped literal.
const prices={};for(const p of publicPlans.filter(p=>p.monthlyCents))for(const interval of ['month','year'])prices[p.id+':'+interval]=['price',p.id.replaceAll('-','')+interval].join('_');
const stripeEnv={STRIPE_TEST_KEY:['sk','test','fixture'].join('_'),STRIPE_WEBHOOK_SECRET:['whsec','fixture'].join('_'),STRIPE_SANDBOX_CATALOG:JSON.stringify({version:1,prices}),STRIPE_TEST_PUBLISHABLE_KEY:['pk','test',hex()+hex()].join('_'),STRIPE_CHECKOUT_OPEN:'true'};
const env={...store.env,DB:db,ENVIRONMENT:'test',...stripeEnv,API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}};
const ctx={waitUntil(){throw Error('No background work is expected');}};

// Stripe stub state. `calls` records every request with its form body.
const calls=[],objects={sub:null,invoice:null,customer:{id:null,livemode:false},setup:null,pm:null};
const stub=async(input,init)=>{
 const u=new URL(typeof input==='string'?input:input.url),path=u.pathname.replace('/v1/','');
 assert.equal(u.origin,'https://api.stripe.com','only the Stripe API is reachable');assert.equal(init.redirect,'manual');
 calls.push({method:init.method,path,form:init.body?Object.fromEntries(init.body):null});
 if(init.method==='POST'&&path.startsWith('subscriptions/'))return Response.json({...objects.sub,cancel_at_period_end:init.body.get('cancel_at_period_end')==='true'});
 if(init.method==='POST'&&path==='checkout/sessions')return Response.json({id:'cs_test_'+hex(),livemode:false,mode:'setup',customer:init.body.get('customer'),metadata:{app:'whumpo-sandbox-v1',owner:init.body.get('metadata[owner]')},client_secret:'cs_test_x_secret_y'});
 if(init.method==='POST')return Response.json({id:path,livemode:false});
 if(path.startsWith('subscriptions/'))return Response.json(objects.sub);
 if(path.startsWith('invoices/'))return Response.json(objects.invoice);
 if(path.startsWith('checkout/sessions/'))return Response.json(objects.setup);
 if(path.startsWith('payment_methods/'))return Response.json(objects.pm);
 if(path.startsWith('customers/'))return Response.json({id:path.split('/')[1],livemode:false,metadata:{}});
 throw Error('Unexpected Stripe call '+init.method+' '+path);
};
const originalFetch=globalThis.fetch;globalThis.fetch=stub;

const account=()=>workspaceFixture(db,m);
const call=(token,method,path,body)=>worker.fetch(new Request('https://whumpo.com/api/billing/'+path,{method,headers:{origin:'https://whumpo.com',cookie:'__Host-whumpo_session='+token,...(body?{'content-type':'application/json'}:{})},body:body?JSON.stringify(body):undefined}),env,ctx);
const customers=async()=>JSON.stringify((await db.prepare('SELECT user_id,customer_id FROM stripe_customers ORDER BY user_id').all()).results);
const posts=()=>calls.filter(c=>c.method==='POST');
const mutating=[['POST','subscription/cancel'],['POST','subscription/resume'],['POST','subscription/retry'],['POST','payment-method/setup'],['POST','payment-method/complete',{session:'cs_test_'+hex()}]];

try{
 const owner=await account(),other=await account(),none=await account(),nullRow=await account();
 const ownerCustomer='cus_'+hex(),otherCustomer='cus_'+hex();
 await db.prepare('INSERT INTO stripe_customers(user_id,customer_id,created_at) VALUES(?,?,unixepoch())').bind(owner.account,ownerCustomer).run();
 await db.prepare('INSERT INTO stripe_customers(user_id,customer_id,created_at) VALUES(?,?,unixepoch())').bind(other.account,otherCustomer).run();
 await db.prepare('INSERT INTO stripe_customers(user_id,customer_id,created_at) VALUES(?,NULL,unixepoch())').bind(nullRow.account).run();
 const invoiceId=await paidPlan(db,owner.account,'personal');
 const row=await db.prepare('SELECT s.id,s.order_id,o.price_id FROM stripe_subscriptions s JOIN stripe_subscription_orders o ON o.id=s.order_id WHERE s.user_id=?').bind(owner.account).first(),price=row.price_id;
 const subscription=(over={})=>({id:row.id,livemode:false,customer:ownerCustomer,metadata:{app:'whumpo-sandbox-v1',order:row.order_id},status:'active',cancel_at_period_end:false,latest_invoice:invoiceId,items:{has_more:false,data:[{quantity:1,current_period_end:Math.floor(Date.now()/1000)+86400,price:{id:price,livemode:false,currency:'usd',unit_amount:3000,recurring:{interval:'month',interval_count:1}}}]},...over});
 objects.sub=subscription();objects.invoice={id:invoiceId,livemode:false,customer:ownerCustomer,parent:{subscription_details:{subscription:row.id}},status:'open'};
 const before=await customers();

 // 1. Foreign customer: no customer row, or a NULL customer id.
 for(const [label,who] of [['no stripe_customers row',none],['row with NULL customer_id',nullRow]]){
  for(const [method,path,body] of mutating){const response=await call(who.token,method,path,body);assert.equal(response.status,409,label+': '+path);assert.deepEqual(await response.json(),{error:'Start a sandbox checkout first.'},label+': '+path);}
  const card=await call(who.token,'GET','payment-method');assert.equal(card.status,200);assert.deepEqual(await card.json(),{card:null,testMode:true});
 }
 assert.equal(calls.length,0,'no Stripe call is made for an owner without a customer');assert.equal(await customers(),before,'no customer row is created, changed or borrowed');

 // 2. Foreign subscription: a customer without a subscription, and Stripe objects that are not the caller's.
 for(const path of ['subscription/cancel','subscription/resume','subscription/retry'])assert.equal((await call(other.token,'POST',path)).status,409,'customer without a subscription: '+path);
 assert.equal(calls.length,0,'a missing subscription is refused from the caller\'s own rows, before Stripe');
 objects.sub=subscription({customer:'cus_'+hex()});
 for(const path of ['subscription/cancel','subscription/retry'])assert.equal((await call(owner.token,'POST',path)).status,409,'foreign customer on the subscription: '+path);
 objects.sub=subscription({metadata:{app:'whumpo-sandbox-v1',order:crypto.randomUUID()}});
 assert.equal((await call(owner.token,'POST','subscription/cancel')).status,409,'foreign order metadata');
 assert.deepEqual(posts(),[],'no write was sent for a foreign subscription');

 // 3. Foreign invoice.
 objects.sub=subscription();objects.invoice={...objects.invoice,customer:'cus_'+hex()};
 assert.equal((await call(owner.token,'POST','subscription/retry')).status,409,'foreign invoice');
 objects.invoice={...objects.invoice,customer:ownerCustomer,parent:{subscription_details:{subscription:'sub_'+hex()}}};
 assert.equal((await call(owner.token,'POST','subscription/retry')).status,409,'invoice of another subscription');
 assert.deepEqual(posts(),[],'no invoice was paid');

 // 4. Foreign setup session: owner metadata, customer and payment method must all be the caller's.
 const sessionId='cs_test_'+hex(),pm='pm_'+hex();
 const setupFor=(customer,ownerId)=>({id:sessionId,created:Math.floor(Date.now()/1000),livemode:false,mode:'setup',customer,status:'complete',metadata:{app:'whumpo-sandbox-v1',owner:ownerId,purpose:'payment-method'},setup_intent:{status:'succeeded',customer,payment_method:pm}});
 objects.pm={id:pm,livemode:false,customer:otherCustomer,type:'card',card:{brand:'visa',last4:'4242',exp_month:1,exp_year:2031}};
 objects.setup=setupFor(otherCustomer,other.account);
 assert.equal((await call(owner.token,'POST','payment-method/complete',{session:sessionId})).status,409,'another owner\'s setup session');
 objects.setup=setupFor(ownerCustomer,other.account);
 assert.equal((await call(owner.token,'POST','payment-method/complete',{session:sessionId})).status,409,'owner metadata of another owner');
 objects.setup=setupFor(ownerCustomer,owner.account);
 assert.equal((await call(owner.token,'POST','payment-method/complete',{session:sessionId})).status,409,'payment method attached to another customer');
 assert.equal((await call(owner.token,'POST','payment-method/complete',{session:'cs_live_'+hex()})).status,400,'only test sessions are accepted');
 assert.deepEqual(posts(),[],'no default payment method was written');

 // Negative control: the owner of the objects succeeds, and every write names only the owner's own ids.
 objects.invoice={...objects.invoice,parent:{subscription_details:{subscription:row.id}}};
 objects.pm={...objects.pm,customer:ownerCustomer};
 const done=await call(owner.token,'POST','payment-method/complete',{session:sessionId});assert.equal(done.status,200);
 assert.deepEqual((await done.json()).card,{brand:'visa',last4:'4242',expMonth:1,expYear:2031});
 assert.equal((await call(owner.token,'POST','subscription/cancel')).status,200,'negative control: cancel at period end');
 assert.ok(posts().length>=3);
 for(const w of posts())assert.ok(w.path===`customers/${ownerCustomer}`||w.path===`subscriptions/${row.id}`,'write '+w.path+' names only the owner\'s objects');
 assert.equal(posts().find(w=>w.path===`customers/${ownerCustomer}`).form['invoice_settings[default_payment_method]'],pm);
 console.log('Billing management boundary passed: owners with no customer id, a customer without a subscription, or a foreign subscription, invoice or setup session are refused with no Stripe write; the owner of the objects succeeds and writes name only the owner\'s ids.');
}catch(error){console.error(error);process.exitCode=1;}
finally{globalThis.fetch=originalFetch;await store.close?.();}
