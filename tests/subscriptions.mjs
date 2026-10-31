import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
const b=await build({stdin:{contents:"export * from './src/stripe-billing';export {getBilling} from './src/billing';export {publicPlans} from './src/plans';export {default as worker} from './src/index';export {hashToken,newSessionToken} from './src/security';export {admitWorkspace} from './src/workspace-identity/admission';export {resolveIdentity} from './src/workspace-identity/authority';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const {startSubscription,refreshSubscriptions,subscriptionStatus,stripeBillingWebhook,billingPortal,subscriptionsEnabled,getBilling,publicPlans,worker}=m;
const fixture=await databaseFixture({d1:true}),db=fixture.db,scopes=new Map(),scope=user=>scopes.get(user);
const prices={},priceMap=new Map();for(const p of publicPlans.filter(p=>p.monthlyCents))for(const interval of ['month','year']){const id='price_'+p.id.replaceAll('-','')+interval;prices[p.id+':'+interval]=id;priceMap.set(id,{id,livemode:false,currency:'usd',unit_amount:interval==='month'?p.monthlyCents:p.annualCents,recurring:{interval,interval_count:1}});}
const env={STRIPE_TEST_KEY:'sk_test_synthetic',STRIPE_WEBHOOK_SECRET:'whsec_synthetic',STRIPE_CHECKOUT_OPEN:'true',STRIPE_SANDBOX_CATALOG:JSON.stringify({version:1,prices,portal:'bpc_synthetic'})},app='whumpo-sandbox-v1';
const sessions=new Map(),customers=new Map(),subs=new Map(),invoices=new Map(),keys=new Map();let writes=0;
const transport=async(url,init)=>{
 assert.equal(init.redirect,'manual');assert.equal(init.headers.authorization,'Bearer '+env.STRIPE_TEST_KEY);assert.equal(init.headers['Stripe-Version'],'2025-02-24.acacia');
 const path=new URL(url).pathname.replace('/v1/',''),q=new URL(url).searchParams,f=init.body;let value;
 if(init.method==='POST'){
  writes++;const key=init.headers['Idempotency-Key'];if(keys.has(key))return Response.json(keys.get(key));
  if(path.startsWith('customers/')){value=customers.get(path.split('/').at(-1));assert(value,'Missing customer fixture');assert(/^[^\s@]+@[^\s@]+$/.test(f.get('email')),'Checkout must send the account email');value.email=f.get('email');}
  else if(path==='customers'){value={id:'cus_'+crypto.randomUUID().replaceAll('-',''),livemode:false,metadata:{app,owner:f.get('metadata[owner]')}};customers.set(value.id,value);}
  else if(path==='checkout/sessions'){
   assert.equal(f.get('mode'),'subscription');assert.equal(f.get('line_items[0][quantity]'),'1');assert.equal(f.get('success_url'),'https://whumpo.com/workspace/?checkout=returned');assert(!f.has('trial_period_days'));
   const price=priceMap.get(f.get('line_items[0][price]'));value={id:'cs_test_'+crypto.randomUUID().replaceAll('-',''),livemode:false,customer:f.get('customer'),mode:'subscription',status:'open',subscription:null,client_reference_id:f.get('client_reference_id'),metadata:{app,order:f.get('metadata[order]')},url:'https://checkout.stripe.com/c/pay/synthetic',currency:'usd',amount_total:price.unit_amount,line_items:{has_more:false,data:[{quantity:1,price}]}};sessions.set(value.id,value);
  }else if(path==='billing_portal/sessions'){value={id:'bps_synthetic',livemode:false,customer:f.get('customer'),configuration:f.get('configuration'),url:'https://billing.stripe.com/p/session/synthetic'};assert.equal(f.get('return_url'),'https://whumpo.com/workspace/?checkout=returned');}
  else throw Error('Unexpected mutation '+path);keys.set(key,value);
 }else if(path==='subscriptions')value={has_more:false,data:[...subs.values()].filter(s=>s.customer===q.get('customer'))};
 else if(path.startsWith('checkout/sessions/'))value=sessions.get(path.split('/').at(-1));
 else if(path.startsWith('subscriptions/'))value=subs.get(path.split('/').at(-1));
 else if(path.startsWith('invoices/'))value=invoices.get(path.split('/').at(-1));
 else throw Error('Unexpected read '+path);
 assert(value,'Missing fixture '+path);return Response.json(value);
};
async function account(){const a=await workspaceFixture(db,m);scopes.set(a.account,await a.scope());return a.account;}
async function event(type,id,options={}){const raw=JSON.stringify({id:'evt_fixture',type,livemode:options.live??false,data:{object:{id}}}),t=options.t??Math.floor(Date.now()/1000);const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET),{name:'HMAC',hash:'SHA-256'},false,['sign']);const signature=Buffer.from(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(t+'.'+raw))).toString('hex');return new Request('https://whumpo.com/api/stripe/webhook',{method:'POST',headers:{'stripe-signature':`t=${t},v1=${options.bad?'0'.repeat(64):signature}`},body:raw});}
function paid(session,{paid=true,start=Math.floor(Date.now()/1000)-10,end=start+30*86400}={}){const price=session.line_items.data[0].price,id='sub_'+crypto.randomUUID().replaceAll('-',''),iid='in_'+crypto.randomUUID().replaceAll('-','');const sub={id,livemode:false,customer:session.customer,metadata:{...session.metadata},status:paid?'active':'incomplete',cancel_at_period_end:false,current_period_end:end,latest_invoice:iid,items:session.line_items};const invoice={id:iid,livemode:false,customer:session.customer,subscription:id,status:paid?'paid':'open',paid,paid_out_of_band:false,currency:'usd',amount_paid:paid?price.unit_amount:0,total:price.unit_amount,hosted_invoice_url:'https://invoice.stripe.com/i/synthetic',created:start,billing_reason:'subscription_create',lines:{has_more:false,data:[{type:'subscription',subscription:id,quantity:1,proration:false,price,amount:price.unit_amount,period:{start,end}}]}};session.status='complete';session.subscription=id;subs.set(id,sub);invoices.set(iid,invoice);return {sub,invoice};}
try{
 assert.equal(subscriptionsEnabled({}),false);assert.equal(subscriptionsEnabled({...env,STRIPE_TEST_KEY:'sk_live_synthetic'}),false);
 const owner=await account(),other=await account(),id=crypto.randomUUID();
 // Q-007: anything but exactly 'true' keeps checkout closed, with zero transport calls.
 for(const open of [undefined,'','TRUE','1','true ','yes']){const closed={...env,STRIPE_CHECKOUT_OPEN:open};let hits=0;const probe=async()=>{hits++;throw Error();};assert.equal(subscriptionsEnabled(closed),false);await assert.rejects(startSubscription(scope(owner),closed,owner,{id,plan:'personal',interval:'month'},probe),{status:503});await assert.rejects(billingPortal(scope(owner),closed,owner,probe),{status:503});await assert.rejects(refreshSubscriptions(scope(owner),closed,owner,probe),{status:503});assert.equal(hits,0);}
 await assert.rejects(startSubscription(scope(owner),env,owner,{id,plan:'free',interval:'month'},transport),{status:400});assert.equal(writes,0);
 await refreshSubscriptions(scope(owner),env,owner,transport);assert.equal((await db.prepare('SELECT COUNT(*) n FROM stripe_customers').first()).n,0);
 const attempts=await Promise.allSettled([startSubscription(scope(owner),env,owner,{id,plan:'personal',interval:'month'},transport),startSubscription(scope(owner),env,owner,{id,plan:'personal',interval:'month'},transport)]);assert(attempts.some(x=>x.status==='fulfilled'));assert.equal(sessions.size,1);for(const a of attempts.filter(x=>x.status==='rejected'))assert.equal(a.reason.status,409);
 await startSubscription(scope(owner),env,owner,{id,plan:'personal',interval:'month'},transport);assert.equal(sessions.size,1);assert.equal((await getBilling(scope(owner),owner)).plan.id,'explore');
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
 assert.equal((await billingPortal(scope(owner),env,owner,transport)).testMode,true);assert.equal((await subscriptionStatus(scope(other),env,other)).invoices.length,0);
 sub.cancel_at_period_end=true;await refreshSubscriptions(scope(owner),env,owner,transport);assert.equal((await subscriptionStatus(scope(owner),env,owner)).subscription.cancel_at_period_end,1);assert.equal((await getBilling(scope(owner),owner)).plan.id,'personal');
 const future=new Date((invoice.lines.data[0].period.end+1)*1000);assert.equal((await getBilling(scope(owner),owner,future)).plan.id,'explore');
 await assert.rejects(db.prepare('UPDATE stripe_paid_invoices SET ends_at=ends_at+1 WHERE id=?').bind(invoice.id).run(),/immutable/);
 // Failed renewal never extends the previous paid coverage. Reordered paid delivery remains once-only.
 const renewal=structuredClone(invoice);renewal.id='in_renewal';renewal.status='open';renewal.paid=false;renewal.amount_paid=0;renewal.billing_reason='subscription_cycle';renewal.lines.data[0].period={start:invoice.lines.data[0].period.end,end:invoice.lines.data[0].period.end+30*86400};invoices.set(renewal.id,renewal);sub.latest_invoice=renewal.id;sub.status='past_due';
 await refreshSubscriptions(scope(owner),env,owner,transport);assert.equal((await getBilling(scope(owner),owner,future)).plan.id,'explore');
 renewal.status='paid';renewal.paid=true;renewal.amount_paid=renewal.total;sub.status='active';await stripeBillingWebhook(await event('invoice.paid',renewal.id),db,env,transport);assert.equal((await getBilling(scope(owner),owner,future)).plan.id,'personal');
 await stripeBillingWebhook(await event('invoice.paid',invoice.id),db,env,transport);assert.equal((await db.prepare('SELECT COUNT(*) n FROM stripe_paid_invoices').first()).n,2);
 // Annual service dates cross a calendar boundary without an extra month or duplicate grants.
 const annual=await account(),aid=crypto.randomUUID();await startSubscription(scope(annual),env,annual,{id:aid,plan:'business',interval:'year'},transport);const annualSession=[...sessions.values()].at(-1),start=Date.UTC(2026,9,15)/1000,end=Date.UTC(2027,9,15)/1000;const a=paid(annualSession,{start,end});await refreshSubscriptions(scope(annual),env,annual,transport);assert.equal((await getBilling(scope(annual),annual,new Date((end-1)*1000))).plan.id,'business');assert.equal((await getBilling(scope(annual),annual,new Date(end*1000))).plan.id,'explore');assert.equal((await getBilling(scope(annual),annual,new Date((start-1)*1000))).plan.id,'explore');
 // A lost provider response recovers the exact checkout, never dispatches a new one.
 const lostOwner=await account(),lostId=crypto.randomUUID();let lost=false;const lossy=async(url,init)=>{const response=await transport(url,init);if(init.method==='POST'&&url.endsWith('/checkout/sessions')&&!lost){lost=true;throw Error('lost response');}return response;};
 await assert.rejects(startSubscription(scope(lostOwner),env,lostOwner,{id:lostId,plan:'starter',interval:'month'},lossy),{status:502});const size=sessions.size;await startSubscription(scope(lostOwner),env,lostOwner,{id:lostId,plan:'starter',interval:'month'},transport);assert.equal(sessions.size,size);
 // Unknown stale attempts are held, not recreated after the idempotency horizon.
 const stale=await account();await db.prepare('INSERT INTO stripe_customers(user_id,created_at) VALUES(?,?)').bind(stale,Math.floor(Date.now()/1000)-86400).run();const before=writes;await assert.rejects(startSubscription(scope(stale),env,stale,{id:crypto.randomUUID(),plan:'starter',interval:'month'},transport),{status:409});assert.equal(writes,before);
 // HTTP gates also apply before onboarding; billing never unlocks chat.
 const local={...fixture.env,ENVIRONMENT:'local',...env,API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}};
 for(const path of ['/api/billing/subscription/checkout','/api/billing/portal','/api/billing/subscription/refresh']){assert.equal((await worker.fetch(new Request('https://whumpo.com'+path,{method:'POST'}),local)).status,403);assert.equal((await worker.fetch(new Request('https://whumpo.com'+path,{method:'POST',headers:{origin:'https://whumpo.com'}}),local)).status,401);}
 await db.prepare('DELETE FROM users WHERE id=?').bind(owner).run();await stripeBillingWebhook(await event('invoice.paid',invoice.id),db,env,transport);assert.equal((await db.prepare('SELECT COUNT(*) n FROM stripe_paid_invoices WHERE user_id=?').bind(owner).first()).n,0);
 console.log('Subscriptions passed: fixed sandbox catalogue, owner isolation, concurrency and replay, signatures, paid invoices, missed/reordered events, failed renewal, annual boundaries, cancellation, no credits, uncertain writes, immutable receipts, deletion and HTTP gates.');
}finally{await fixture.close();}
