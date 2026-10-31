import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
const b=await build({stdin:{contents:"export * from './src/stripe-billing';export {getBilling} from './src/billing';export {publicPlans} from './src/plans';export {default as worker} from './src/index';export {hashToken,newSessionToken} from './src/security';export {admitWorkspace} from './src/workspace-identity/admission';export {resolveIdentity} from './src/workspace-identity/authority';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const {startSubscription,refreshSubscriptions,subscriptionStatus,stripeBillingWebhook,paymentMethodCard,setCancelAtPeriodEnd,startPaymentMethodUpdate,completePaymentMethodUpdate,retryLatestInvoice,publishableKey,subscriptionsEnabled,getBilling,publicPlans,worker}=m;
const fixture=await databaseFixture({d1:true}),db=fixture.db,scopes=new Map(),scope=user=>scopes.get(user);
const prices={},priceMap=new Map();for(const p of publicPlans.filter(p=>p.monthlyCents))for(const interval of ['month','year']){const id='price_'+p.id.replaceAll('-','')+interval;prices[p.id+':'+interval]=id;priceMap.set(id,{id,livemode:false,currency:'usd',unit_amount:interval==='month'?p.monthlyCents:p.annualCents,recurring:{interval,interval_count:1}});}
const env={STRIPE_TEST_KEY:'sk_test_synthetic',STRIPE_WEBHOOK_SECRET:'whsec_synthetic',STRIPE_SANDBOX_CATALOG:JSON.stringify({version:1,prices}),STRIPE_TEST_PUBLISHABLE_KEY:'pk_test_'+'a'.repeat(40),STRIPE_CHECKOUT_OPEN:'true'},app='whumpo-sandbox-v1';
const sessions=new Map(),customers=new Map(),subs=new Map(),invoices=new Map(),keys=new Map(),methods=new Map(),setups=new Map();let writes=0,payFails=false,payAction=false,hideSecret=false,createHosted=false,expireFails=false,payCalls=0,failSubReads=false;
const transport=async(url,init)=>{
 assert.equal(init.redirect,'manual');assert.equal(init.headers.authorization,'Bearer '+env.STRIPE_TEST_KEY);assert.equal(init.headers['Stripe-Version'],'2026-10-28.endive');
 const path=new URL(url).pathname.replace('/v1/',''),q=new URL(url).searchParams,f=init.body;let value;
 if(init.method==='POST'){
  writes++;const key=init.headers['Idempotency-Key'];if(keys.has(key))return Response.json(keys.get(key));
  if(path.startsWith('customers/')){
   value=customers.get(path.split('/').at(-1));assert(value,'Missing customer fixture');
   if(f.has('email')){assert(/^[^\s@]+@[^\s@]+$/.test(f.get('email')),'Checkout must send the account email');value.email=f.get('email');}
   if(f.has('invoice_settings[default_payment_method]'))value.invoice_settings={default_payment_method:f.get('invoice_settings[default_payment_method]')};
   if(f.has('metadata[whumpo_pm_applied]'))value.metadata={...value.metadata,whumpo_pm_applied:f.get('metadata[whumpo_pm_applied]')};
  }
  else if(path==='customers'){value={id:'cus_'+crypto.randomUUID().replaceAll('-',''),livemode:false,metadata:{app,owner:f.get('metadata[owner]')}};customers.set(value.id,value);}
  else if(path==='checkout/sessions'&&f.get('mode')==='setup'){
   assert.equal(f.get('ui_mode'),'elements');assert(!f.has('success_url')&&!f.has('cancel_url'));assert.match(f.get('return_url'),/^https:\/\/whumpo\.com\/workspace\/\?payment_method=returned&session_id=\{CHECKOUT_SESSION_ID\}$/);
   const id='cs_test_'+crypto.randomUUID().replaceAll('-','');value={id,created:Math.floor(Date.now()/1000),livemode:false,customer:f.get('customer'),mode:'setup',ui_mode:'elements',status:'open',client_secret:id+'_secret_fixture',metadata:{app,owner:f.get('metadata[owner]'),purpose:f.get('metadata[purpose]')},setup_intent:null};sessions.set(id,value);
  }
  else if(path==='checkout/sessions'){
   assert.equal(f.get('mode'),'subscription');assert.equal(f.get('ui_mode'),'elements');assert.equal(f.get('line_items[0][quantity]'),'1');assert(!f.has('success_url')&&!f.has('cancel_url'),'hosted return URLs are gone');assert.match(f.get('return_url'),/^https:\/\/whumpo\.com\/workspace\/\?checkout=returned&session_id=\{CHECKOUT_SESSION_ID\}$/);assert(!f.has('trial_period_days'));
   const price=priceMap.get(f.get('line_items[0][price]')),id='cs_test_'+crypto.randomUUID().replaceAll('-','');value={id,created:Math.floor(Date.now()/1000),livemode:false,customer:f.get('customer'),mode:'subscription',ui_mode:createHosted?'hosted':'elements',status:'open',subscription:null,client_reference_id:f.get('client_reference_id'),client_secret:id+'_secret_fixture',metadata:{app,order:f.get('metadata[order]')},currency:'usd',amount_total:price.unit_amount,line_items:{has_more:false,data:[{quantity:1,price}]}};sessions.set(value.id,value);
  }else if(/^checkout\/sessions\/[^/]+\/expire$/.test(path)){value=sessions.get(path.split('/')[2]);assert(value);if(value.status==='complete'||expireFails)return new Response('{}',{status:400});value.status='expired';}
  else if(/^subscriptions\/[^/]+$/.test(path)){
   value=subs.get(path.split('/')[1]);assert(value,'Missing subscription fixture');
   if(f.has('cancel_at_period_end'))value.cancel_at_period_end=f.get('cancel_at_period_end')==='true';
   if(f.has('default_payment_method'))value.default_payment_method=f.get('default_payment_method');
  }else if(/^invoices\/[^/]+\/pay$/.test(path)){
   value=invoices.get(path.split('/')[1]);assert(value);payCalls++;if(payFails)return new Response('{"error":{"code":"card_declined"}}',{status:402});if(payAction)return new Response('{"error":{"code":"invoice_payment_intent_requires_action"}}',{status:402});
   value.status='paid';value.amount_paid=value.total;subs.get(invoiceSub(value)).status='active';
  }
  else throw Error('Unexpected mutation '+path);keys.set(key,value);
 }else if(path==='subscriptions')value={has_more:false,data:[...subs.values()].filter(s=>s.customer===q.get('customer'))};
 else if(path.startsWith('checkout/sessions/')){value=structuredClone(sessions.get(path.split('/').at(-1)));if(value){if(hideSecret)delete value.client_secret;if(value.setup_intent===null&&setups.has(value.id))value.setup_intent=setups.get(value.id);}}
 else if(path.startsWith('payment_methods/'))value=methods.get(path.split('/').at(-1));
 else if(path.startsWith('customers/')){value=structuredClone(customers.get(path.split('/').at(-1)));if(value?.invoice_settings?.default_payment_method&&q.getAll('expand[]').includes('invoice_settings.default_payment_method'))value.invoice_settings.default_payment_method=methods.get(value.invoice_settings.default_payment_method);}
 else if(path.startsWith('subscriptions/')){if(failSubReads)return new Response('{}',{status:500});value=structuredClone(subs.get(path.split('/').at(-1)));if(value&&q.getAll('expand[]').includes('default_payment_method')&&value.default_payment_method)value.default_payment_method=methods.get(value.default_payment_method);}
 else if(path.startsWith('invoices/'))value=invoices.get(path.split('/').at(-1));
 else throw Error('Unexpected read '+path);
 assert(value,'Missing fixture '+path);return Response.json(value);
};
async function account(){const a=await workspaceFixture(db,m);scopes.set(a.account,await a.scope());return a.account;}
async function event(type,id,options={}){const raw=JSON.stringify({id:'evt_fixture',type,livemode:options.live??false,data:{object:{id}}}),t=options.t??Math.floor(Date.now()/1000);const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);const signature=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(t+'.'+raw))).toString('hex');return new Request('https://whumpo.com/api/stripe/webhook',{method:'POST',headers:{'stripe-signature':`t=${t},v1=${options.bad?'0'.repeat(64):signature}`},body:raw});}
const invoiceSub=invoice=>invoice.parent.subscription_details.subscription;
// Shapes follow API 2026-10-28.endive: period end on the subscription item; subscription, price and proration on the invoice parent/pricing.
function paid(session,{paid=true,start=Math.floor(Date.now()/1000)-10,end=start+30*86400}={}){const price=session.line_items.data[0].price,id='sub_'+crypto.randomUUID().replaceAll('-',''),iid='in_'+crypto.randomUUID().replaceAll('-','');const sub={id,livemode:false,customer:session.customer,metadata:{...session.metadata},status:paid?'active':'incomplete',cancel_at_period_end:false,latest_invoice:iid,items:{has_more:false,data:[{quantity:1,price,current_period_end:end}]}};const invoice={id:iid,livemode:false,customer:session.customer,parent:{type:'subscription_details',subscription_details:{subscription:id}},status:paid?'paid':'open',currency:'usd',amount_paid:paid?price.unit_amount:0,total:price.unit_amount,hosted_invoice_url:'https://invoice.stripe.com/i/synthetic',created:start,billing_reason:'subscription_create',lines:{has_more:false,data:[{quantity:1,pricing:{price_details:{price:price.id}},parent:{type:'subscription_item_details',subscription_item_details:{subscription:id,proration:false}},amount:price.unit_amount,period:{start,end}}]}};session.status='complete';session.subscription=id;subs.set(id,sub);invoices.set(iid,invoice);return {sub,invoice};}
try{
 assert.equal(subscriptionsEnabled({}),false);assert.equal(subscriptionsEnabled({...env,STRIPE_TEST_KEY:'sk_live_synthetic'}),false);
 const owner=await account(),other=await account(),id=crypto.randomUUID();
 // D20 lock 1: with STRIPE_CHECKOUT_OPEN unset (or anything but 'true') every Stripe route, start, manage and webhook included, is closed with no Stripe call and no row written.
 for(const open of [undefined,'false','TRUE','1','','true ','yes']){
  const closed={...env,STRIPE_CHECKOUT_OPEN:open},w0=writes,gated=await account();assert.equal(subscriptionsEnabled(closed),false);
  assert.equal((await subscriptionStatus(scope(gated),closed,gated)).enabled,false);
  for(const call of [()=>startSubscription(scope(gated),closed,gated,{id:crypto.randomUUID(),plan:'starter',interval:'month'},transport),()=>refreshSubscriptions(scope(gated),closed,gated,transport),()=>setCancelAtPeriodEnd(scope(gated),closed,gated,true,transport),()=>setCancelAtPeriodEnd(scope(gated),closed,gated,false,transport),()=>startPaymentMethodUpdate(scope(gated),closed,gated,transport),()=>completePaymentMethodUpdate(scope(gated),closed,gated,{session:'cs_test_x'},transport),()=>retryLatestInvoice(scope(gated),closed,gated,transport),()=>paymentMethodCard(scope(gated),closed,gated,transport),async()=>stripeBillingWebhook(await event('invoice.paid','in_x'),db,closed,transport)])await assert.rejects(call(),{status:503});
  assert.equal(writes,w0);assert.equal((await db.prepare('SELECT COUNT(*) n FROM stripe_customers WHERE user_id=?').bind(gated).first()).n,0);
 }
 await assert.rejects(startSubscription(scope(owner),env,owner,{id,plan:'free',interval:'month'},transport),{status:400});assert.equal(writes,0);
 await refreshSubscriptions(scope(owner),env,owner,transport);assert.equal((await db.prepare('SELECT COUNT(*) n FROM stripe_customers').first()).n,0);
 const attempts=await Promise.allSettled([startSubscription(scope(owner),env,owner,{id,plan:'personal',interval:'month'},transport),startSubscription(scope(owner),env,owner,{id,plan:'personal',interval:'month'},transport)]);assert(attempts.some(x=>x.status==='fulfilled'));assert.equal(sessions.size,1);for(const a of attempts.filter(x=>x.status==='fulfilled')){assert.match(a.value.clientSecret,/^cs_test_[a-z0-9]+_secret_fixture$/);assert.equal(a.value.url,undefined);assert.equal(a.value.testMode,true);}for(const a of attempts.filter(x=>x.status==='rejected'))assert.equal(a.reason.status,409);
 const resumed=await startSubscription(scope(owner),env,owner,{id,plan:'personal',interval:'month'},transport);assert.match(resumed.clientSecret,/_secret_/);assert.equal(sessions.size,1);for(const t of ['stripe_customers','stripe_subscription_orders'])assert(!JSON.stringify((await db.prepare('SELECT * FROM '+t).all()).results).includes('_secret_'),'the client secret is never stored');assert.equal((await getBilling(scope(owner),owner)).plan.id,'explore');
 await assert.rejects(startSubscription(scope(other),env,other,{id,plan:'personal',interval:'month'},transport),{status:409});
 await assert.rejects(startSubscription(scope(owner),env,owner,{id:crypto.randomUUID(),plan:'starter',interval:'month'},transport),{status:409});
 const session=[...sessions.values()][0],{sub,invoice}=paid(session);
 for(const opts of [{bad:true},{t:1},{live:true}])await assert.rejects(stripeBillingWebhook(await event('invoice.paid',invoice.id,opts),db,env,transport),{status:400});
 invoice.amount_paid=1;await assert.rejects(stripeBillingWebhook(await event('invoice.paid',invoice.id),db,env,transport),{status:409});invoice.amount_paid=invoice.total;
 invoice.customer='cus_foreign';await assert.rejects(refreshSubscriptions(scope(owner),env,owner,transport),{status:409});invoice.customer=sub.customer;
 invoice.livemode=true;await assert.rejects(refreshSubscriptions(scope(owner),env,owner,transport),{status:409});invoice.livemode=false;
 await Promise.all([stripeBillingWebhook(await event('invoice.paid',invoice.id),db,env,transport),stripeBillingWebhook(await event('checkout.session.completed',session.id),db,env,transport)]);
 await stripeBillingWebhook(await event('invoice.payment_failed',invoice.id),db,env,transport);
 assert.equal((await getBilling(scope(owner),owner)).plan.id,'personal');assert.equal((await getBilling(scope(other),other)).plan.id,'explore');assert.equal((await getBilling(scope(owner),owner)).standardAI.creditCharge,0);assert.equal((await db.prepare('SELECT COUNT(*) n FROM stripe_paid_invoices').first()).n,1);

 assert.equal((await subscriptionStatus(scope(other),env,other)).invoices.length,0);
 // Publishable key: only pk_test_ is ever exposed; anything else disables the in-app checkout.
 const status0=await subscriptionStatus(scope(owner),env,owner);assert.equal(status0.publishableKey,env.STRIPE_TEST_PUBLISHABLE_KEY);assert.equal(status0.enabled,true);assert.equal(status0.hasCustomer,true);
 for(const bad of [undefined,'','pk_live_'+'a'.repeat(40),'sk_test_'+'a'.repeat(40),'pk_test_short'])assert.equal(publishableKey({STRIPE_TEST_PUBLISHABLE_KEY:bad}),null);
 assert.equal((await subscriptionStatus(scope(owner),env,owner)&&await subscriptionStatus(scope(owner),{...env,STRIPE_TEST_PUBLISHABLE_KEY:'pk_live_'+'a'.repeat(40)},owner)).enabled,false);
 // Card on file is read from Stripe, never stored.
 assert.deepEqual(await paymentMethodCard(scope(owner),env,owner,transport),{card:null,testMode:true});
 methods.set('pm_first',{id:'pm_first',livemode:false,customer:sub.customer,type:'card',card:{brand:'visa',last4:'4242',exp_month:12,exp_year:2030}});customers.get(sub.customer).invoice_settings={default_payment_method:'pm_first'};
 assert.deepEqual((await paymentMethodCard(scope(owner),env,owner,transport)).card,{brand:'visa',last4:'4242',expMonth:12,expYear:2030});
 methods.get('pm_first').customer='cus_foreign';await assert.rejects(paymentMethodCard(scope(owner),env,owner,transport),{status:409});methods.get('pm_first').customer=sub.customer;
 assert.deepEqual(await paymentMethodCard(scope(other),env,other,transport),{card:null,testMode:true});
 // Foreign owner, subscription and invoice are refused before any write.
 const before2=writes,nobody=await account();
 for(const call of [()=>setCancelAtPeriodEnd(scope(nobody),env,nobody,true,transport),()=>retryLatestInvoice(scope(nobody),env,nobody,transport),()=>startPaymentMethodUpdate(scope(nobody),env,nobody,transport),()=>completePaymentMethodUpdate(scope(nobody),env,nobody,{session:[...sessions.keys()][0]},transport)])await assert.rejects(call(),{status:409});
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM stripe_customers WHERE user_id=?').bind(nobody).first()).n,0,'management routes create no customer row');
 // Another owner who has a customer still cannot cancel, retry or complete the first owner\'s objects.
 for(const call of [()=>setCancelAtPeriodEnd(scope(other),env,other,true,transport),()=>retryLatestInvoice(scope(other),env,other,transport),()=>completePaymentMethodUpdate(scope(other),env,other,{session:[...sessions.keys()][0]},transport)])await assert.rejects(call(),{status:409});
 assert.equal(writes,before2);
 sub.customer='cus_foreign';await assert.rejects(setCancelAtPeriodEnd(scope(owner),env,owner,true,transport),{status:409});sub.customer=session.customer;
 sub.metadata.order=crypto.randomUUID();await assert.rejects(setCancelAtPeriodEnd(scope(owner),env,owner,true,transport),{status:409});sub.metadata.order=session.metadata.order;
 assert.equal(writes,before2);
 // Cancel at period end, then resume; paid coverage is unchanged by either.
 assert.equal((await setCancelAtPeriodEnd(scope(owner),env,owner,true,transport)).subscription.cancel_at_period_end,1);assert.equal(sub.cancel_at_period_end,true);
 assert.equal((await setCancelAtPeriodEnd(scope(owner),env,owner,false,transport)).subscription.cancel_at_period_end,0);assert.equal(sub.cancel_at_period_end,false);assert.equal((await getBilling(scope(owner),owner)).plan.id,'personal');
 // Cancel, resume, cancel inside one minute: each change reaches Stripe (a minute-bucketed key would replay the first reply and leave the renewal on).
 assert.equal((await setCancelAtPeriodEnd(scope(owner),env,owner,true,transport)).subscription.cancel_at_period_end,1);assert.equal(sub.cancel_at_period_end,true,'the second cancel reached Stripe');
 assert.equal((await setCancelAtPeriodEnd(scope(owner),env,owner,false,transport)).subscription.cancel_at_period_end,0);assert.equal(sub.cancel_at_period_end,false);
 // Update the payment method: a setup session, verified against the owner before it becomes the default.
 await assert.rejects(completePaymentMethodUpdate(scope(owner),env,owner,{session:'cs_live_x'},transport),{status:400});
 const setup=await startPaymentMethodUpdate(scope(owner),env,owner,transport),setupSession=sessions.get(setup.clientSecret.split('_secret_')[0]);assert.equal(setupSession.customer,sub.customer);
 await assert.rejects(completePaymentMethodUpdate(scope(owner),env,owner,{session:setupSession.id},transport),{status:409});
 methods.set('pm_new',{id:'pm_new',livemode:false,customer:sub.customer,type:'card',card:{brand:'mastercard',last4:'4444',exp_month:1,exp_year:2031}});setupSession.status='complete';setups.set(setupSession.id,{status:'succeeded',customer:sub.customer,payment_method:'pm_new'});
 setupSession.customer='cus_foreign';await assert.rejects(completePaymentMethodUpdate(scope(owner),env,owner,{session:setupSession.id},transport),{status:409});setupSession.customer=sub.customer;
 setupSession.metadata.owner=other;await assert.rejects(completePaymentMethodUpdate(scope(owner),env,owner,{session:setupSession.id},transport),{status:409});setupSession.metadata.owner=owner;
 methods.get('pm_new').customer='cus_foreign';await assert.rejects(completePaymentMethodUpdate(scope(owner),env,owner,{session:setupSession.id},transport),{status:409});methods.get('pm_new').customer=sub.customer;
 assert.equal(customers.get(sub.customer).invoice_settings.default_payment_method,'pm_first','a refused update changes nothing');
 assert.deepEqual((await completePaymentMethodUpdate(scope(owner),env,owner,{session:setupSession.id},transport)).card,{brand:'mastercard',last4:'4444',expMonth:1,expYear:2031});
 assert.equal(customers.get(sub.customer).invoice_settings.default_payment_method,'pm_new');assert.equal(sub.default_payment_method,'pm_new');
 await completePaymentMethodUpdate(scope(owner),env,owner,{session:setupSession.id},transport);
 // Replay: an older setup session, or one older than the last applied, never puts an earlier card back; the same one is harmless.
 methods.set('pm_old',{id:'pm_old',livemode:false,customer:sub.customer,type:'card',card:{brand:'visa',last4:'0002',exp_month:2,exp_year:2030}});
 const oldSetup=await startPaymentMethodUpdate(scope(owner),env,owner,transport),oldSession=sessions.get(oldSetup.clientSecret.split('_secret_')[0]);
 oldSession.status='complete';setups.set(oldSession.id,{status:'succeeded',customer:sub.customer,payment_method:'pm_old'});oldSession.created=setupSession.created-10;
 await assert.rejects(completePaymentMethodUpdate(scope(owner),env,owner,{session:oldSession.id},transport),{status:409});
 oldSession.created=Math.floor(Date.now()/1000)-7200;await assert.rejects(completePaymentMethodUpdate(scope(owner),env,owner,{session:oldSession.id},transport),{status:409});
 assert.equal(customers.get(sub.customer).invoice_settings.default_payment_method,'pm_new','an old session did not replace the newer card');assert.equal(sub.default_payment_method,'pm_new');
 // Lost return: the signed webhook applies a finished setup session for its owner, and only its owner.
 methods.set('pm_hook',{id:'pm_hook',livemode:false,customer:sub.customer,type:'card',card:{brand:'amex',last4:'0005',exp_month:3,exp_year:2032}});
 const hookSetup=await startPaymentMethodUpdate(scope(owner),env,owner,transport),hookSession=sessions.get(hookSetup.clientSecret.split('_secret_')[0]);
 hookSession.status='complete';setups.set(hookSession.id,{status:'succeeded',customer:sub.customer,payment_method:'pm_hook'});
 hookSession.metadata.owner=other;const w1=writes;await stripeBillingWebhook(await event('checkout.session.completed',hookSession.id),db,env,transport);assert.equal(writes,w1,'a setup session naming another owner changes nothing');hookSession.metadata.owner=owner;
 await stripeBillingWebhook(await event('checkout.session.expired',hookSession.id),db,env,transport);assert.equal(customers.get(sub.customer).invoice_settings.default_payment_method,'pm_new','only a completed session is applied');
 await stripeBillingWebhook(await event('checkout.session.completed',hookSession.id),db,env,transport);
 assert.equal(customers.get(sub.customer).invoice_settings.default_payment_method,'pm_hook');assert.equal(sub.default_payment_method,'pm_hook');
 await stripeBillingWebhook(await event('checkout.session.completed',hookSession.id),db,env,transport);
 sub.cancel_at_period_end=true;await refreshSubscriptions(scope(owner),env,owner,transport);assert.equal((await subscriptionStatus(scope(owner),env,owner)).subscription.cancel_at_period_end,1);assert.equal((await getBilling(scope(owner),owner)).plan.id,'personal');
 const future=new Date((invoice.lines.data[0].period.end+1)*1000);assert.equal((await getBilling(scope(owner),owner,future)).plan.id,'explore');
 await assert.rejects(db.prepare('UPDATE stripe_paid_invoices SET ends_at=ends_at+1 WHERE id=?').bind(invoice.id).run(),/immutable/);
 // Failed renewal never extends the previous paid coverage. Reordered paid delivery remains once-only.
 const renewal=structuredClone(invoice);renewal.id='in_renewal';renewal.status='open';renewal.amount_paid=0;renewal.billing_reason='subscription_cycle';renewal.lines.data[0].period={start:invoice.lines.data[0].period.end,end:invoice.lines.data[0].period.end+30*86400};invoices.set(renewal.id,renewal);sub.latest_invoice=renewal.id;sub.status='past_due';
 await refreshSubscriptions(scope(owner),env,owner,transport);assert.equal((await getBilling(scope(owner),owner,future)).plan.id,'explore');

 // Retry a failed invoice after a new payment method: foreign invoice refused, decline reported, success recorded once.
 renewal.customer='cus_foreign';await assert.rejects(retryLatestInvoice(scope(owner),env,owner,transport),{status:409});renewal.customer=sub.customer;
 const pays=payCalls;renewal.total=1;await assert.rejects(retryLatestInvoice(scope(owner),env,owner,transport),{status:409});renewal.total=renewal.lines.data[0].amount;assert.equal(payCalls,pays,'a mismatched amount is never paid');
 payAction=true;const needs=await retryLatestInvoice(scope(owner),env,owner,transport);payAction=false;assert.equal(new URL(needs.actionRequired.invoiceUrl).hostname,'invoice.stripe.com','a 3D Secure renewal sends the customer to the hosted invoice');
 payFails=true;await assert.rejects(retryLatestInvoice(scope(owner),env,owner,transport),{status:402});payFails=false;
 // Paid but the coverage record fails: the failure is reported, never swallowed.
 failSubReads=true;await assert.rejects(retryLatestInvoice(scope(owner),env,owner,transport),{status:502});failSubReads=false;renewal.status='open';renewal.amount_paid=0;subs.get(sub.id).status='past_due';
assert.equal((await getBilling(scope(owner),owner,future)).plan.id,'explore');
 assert.equal((await retryLatestInvoice(scope(owner),env,owner,transport)).subscription.payment_status,'paid');assert.equal((await getBilling(scope(owner),owner,future)).plan.id,'personal');
 renewal.status='paid';renewal.amount_paid=renewal.total;sub.status='active';await stripeBillingWebhook(await event('invoice.paid',renewal.id),db,env,transport);assert.equal((await getBilling(scope(owner),owner,future)).plan.id,'personal');
 await stripeBillingWebhook(await event('invoice.paid',invoice.id),db,env,transport);assert.equal((await db.prepare('SELECT COUNT(*) n FROM stripe_paid_invoices').first()).n,2);
 // Annual service dates cross a calendar boundary without an extra month or duplicate grants.
 const annual=await account(),aid=crypto.randomUUID();await startSubscription(scope(annual),env,annual,{id:aid,plan:'business',interval:'year'},transport);const annualSession=[...sessions.values()].at(-1),start=Date.UTC(2026,9,15)/1000,end=Date.UTC(2027,9,15)/1000;const a=paid(annualSession,{start,end});await refreshSubscriptions(scope(annual),env,annual,transport);assert.equal((await getBilling(scope(annual),annual,new Date((end-1)*1000))).plan.id,'business');assert.equal((await getBilling(scope(annual),annual,new Date(end*1000))).plan.id,'explore');assert.equal((await getBilling(scope(annual),annual,new Date((start-1)*1000))).plan.id,'explore');
 // A lost provider response recovers the exact checkout, never dispatches a new one.
 const lostOwner=await account(),lostId=crypto.randomUUID();let lost=false;const lossy=async(url,init)=>{const response=await transport(url,init);if(init.method==='POST'&&url.endsWith('/checkout/sessions')&&!lost){lost=true;throw Error('lost response');}return response;};
 await assert.rejects(startSubscription(scope(lostOwner),env,lostOwner,{id:lostId,plan:'starter',interval:'month'},lossy),{status:502});const size=sessions.size;await startSubscription(scope(lostOwner),env,lostOwner,{id:lostId,plan:'starter',interval:'month'},transport);assert.equal(sessions.size,size);

 // A leftover hosted-mode session, or one that will not return its secret, is expired and never reused; a fresh order follows.
 for(const mode of ['hosted','hidden']){
  const who=await account(),oid=crypto.randomUUID();await startSubscription(scope(who),env,who,{id:oid,plan:'starter',interval:'month'},transport);
  const open=[...sessions.values()].at(-1);if(mode==='hosted')open.ui_mode='hosted';else hideSecret=true;
  await assert.rejects(startSubscription(scope(who),env,who,{id:oid,plan:'starter',interval:'month'},transport),{status:409});hideSecret=false;
  assert.equal(open.status,'expired');assert.equal((await db.prepare('SELECT state FROM stripe_subscription_orders WHERE id=?').bind(oid).first()).state,'expired');
  assert.match((await startSubscription(scope(who),env,who,{id:crypto.randomUUID(),plan:'starter',interval:'month'},transport)).clientSecret,/_secret_/);
 }
 // A hosted session created for a fresh order is expired by re-reading that order (not 'checkout/sessions/null'); a refused expire is a 409, never a 502.
 {
  const who=await account(),oid=crypto.randomUUID();createHosted=true;await assert.rejects(startSubscription(scope(who),env,who,{id:oid,plan:'starter',interval:'month'},transport),{status:409});createHosted=false;
  assert.equal([...sessions.values()].at(-1).status,'expired');assert.equal((await db.prepare('SELECT state FROM stripe_subscription_orders WHERE id=?').bind(oid).first()).state,'expired');
  const w2=await account(),oid2=crypto.randomUUID();await startSubscription(scope(w2),env,w2,{id:oid2,plan:'starter',interval:'month'},transport);const open2=[...sessions.values()].at(-1);open2.ui_mode='hosted';expireFails=true;
  await assert.rejects(startSubscription(scope(w2),env,w2,{id:oid2,plan:'starter',interval:'month'},transport),{status:409});expireFails=false;assert.equal(open2.status,'open');assert.equal((await db.prepare('SELECT state FROM stripe_subscription_orders WHERE id=?').bind(oid2).first()).state,'pending');
 }
 // Unknown stale attempts are held, not recreated after the idempotency horizon.
 const stale=await account();await db.prepare('INSERT INTO stripe_customers(user_id,created_at) VALUES(?,?)').bind(stale,Math.floor(Date.now()/1000)-86400).run();const before=writes;await assert.rejects(startSubscription(scope(stale),env,stale,{id:crypto.randomUUID(),plan:'starter',interval:'month'},transport),{status:409});assert.equal(writes,before);
 // HTTP gates also apply before onboarding; billing never unlocks chat.
 const local={...fixture.env,ENVIRONMENT:'local',...env,API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}};
 for(const path of ['/api/billing/subscription/checkout','/api/billing/subscription/refresh','/api/billing/subscription/cancel','/api/billing/subscription/resume','/api/billing/subscription/retry','/api/billing/payment-method/setup','/api/billing/payment-method/complete']){assert.equal((await worker.fetch(new Request('https://whumpo.com'+path,{method:'POST'}),local)).status,403);assert.equal((await worker.fetch(new Request('https://whumpo.com'+path,{method:'POST',headers:{origin:'https://whumpo.com'}}),local)).status,401);}
 assert.equal((await worker.fetch(new Request('https://whumpo.com/api/billing/payment-method'),local)).status,401);
 await db.prepare('DELETE FROM users WHERE id=?').bind(owner).run();await stripeBillingWebhook(await event('invoice.paid',invoice.id),db,env,transport);assert.equal((await db.prepare('SELECT COUNT(*) n FROM stripe_paid_invoices WHERE user_id=?').bind(owner).first()).n,0);
 console.log('Subscriptions passed: fixed sandbox catalogue, owner isolation, concurrency and replay, signatures, paid invoices, missed/reordered events, failed renewal, annual boundaries, cancellation, no credits, uncertain writes, immutable receipts, deletion and HTTP gates.');
}finally{await fixture.close();}
