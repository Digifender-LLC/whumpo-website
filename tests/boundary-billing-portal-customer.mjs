// WH-004 slice: owner billing portal without a Stripe customer, through the platform Worker's real default export and
// the real `billingPortal`. Local SQLite (default) or local D1 (`--d1`); synthetic accounts, no network (global fetch is
// replaced by a recording Stripe stub that answers only billing-portal session creation).
// Closes the gap recorded at docs/boundary-audit.json, family "billing-owner", cell "authority": "No test calls the
// portal for an owner without a customer (code returns 409)" (src/stripe-billing.ts billingPortal).
//   1. An owner with no stripe_customers row gets 409 "Start a sandbox checkout first." from POST /api/billing/portal,
//      even while another owner has a customer: no Stripe call is made and no customer row is created or borrowed.
//   2. An owner whose row exists but has no customer id yet (checkout started, customer not created) gets the same 409.
//   3. The function-level call refuses identically for both.
// Every refusal has a negative control: the same request from an owner with a customer returns 200 and opens exactly
// one portal session for that owner's own customer id. See docs/boundary-tests/billing-portal-customer.md.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';

const b=await build({stdin:{contents:"export {billingPortal} from './src/stripe-billing';export {publicPlans} from './src/plans';export {default as worker} from './src/index';export {hashToken,newSessionToken} from './src/security';export {admitWorkspace} from './src/workspace-identity/admission';export {resolveIdentity} from './src/workspace-identity/authority';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const {billingPortal,publicPlans,worker}=m;
const store=await databaseFixture(),db=store.db,scopes=new Map(),scope=u=>scopes.get(u),id=()=>crypto.randomUUID(),hex=()=>id().replaceAll('-','');
// Fixture values are built at runtime from short, obviously fake parts; none is a real or credential-shaped literal.
const prices={};for(const p of publicPlans.filter(p=>p.monthlyCents))for(const interval of ['month','year'])prices[p.id+':'+interval]=['price',p.id.replaceAll('-','')+interval].join('_');
const portalConfiguration=['bpc','fixture'].join('_');
const stripeEnv={STRIPE_TEST_KEY:['sk','test','fixture'].join('_'),STRIPE_WEBHOOK_SECRET:['whsec','fixture'].join('_'),STRIPE_SANDBOX_CATALOG:JSON.stringify({version:1,prices,portal:portalConfiguration})};
const env={...store.env,DB:db,ENVIRONMENT:'test',...stripeEnv,API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}};
const ctx={waitUntil(){throw Error('No background work is expected');}};

// Stripe stub: only billing_portal/sessions is answered; every call is recorded with the customer it named.
const portalCalls=[];
const stub=async(input,init)=>{
 const u=new URL(typeof input==='string'?input:input.url);
 assert.equal(u.origin,'https://api.stripe.com','only the Stripe API is reachable');assert.equal(init.redirect,'manual');
 assert.equal(init.headers.authorization,['Bearer',stripeEnv.STRIPE_TEST_KEY].join(' '));
 if(init.method!=='POST'||u.pathname!=='/v1/billing_portal/sessions')throw Error('Unexpected Stripe call '+init.method+' '+u.pathname);
 const customer=init.body.get('customer');portalCalls.push(customer);
 return Response.json({id:'bps_'+hex(),livemode:false,customer,configuration:init.body.get('configuration'),url:'https://billing.stripe.com/p/session/'+hex()});
};
const originalFetch=globalThis.fetch;globalThis.fetch=stub;

async function account(){const a=await workspaceFixture(db,m);scopes.set(a.account,await a.scope());return a;}
const portal=token=>worker.fetch(new Request('https://whumpo.com/api/billing/portal',{method:'POST',headers:{origin:'https://whumpo.com',cookie:'__Host-whumpo_session='+token}}),env,ctx);
const customers=async()=>(await db.prepare('SELECT user_id,customer_id,created_at FROM stripe_customers ORDER BY user_id').all()).results;
const refusal='Start a sandbox checkout first.';

try{
 const owner=await account(),none=await account(),pending=await account();
 const ownerCustomer='cus_'+hex();
 await db.prepare('INSERT INTO stripe_customers(user_id,customer_id,created_at) VALUES(?,?,unixepoch())').bind(owner.account,ownerCustomer).run();
 // A started checkout whose provider customer was never created leaves a row with a NULL customer_id.
 await db.prepare('INSERT INTO stripe_customers(user_id,customer_id,created_at) VALUES(?,NULL,unixepoch())').bind(pending.account).run();

 // Negative control: the owner with a customer opens exactly one portal session for their own customer.
 const control=await portal(owner.token);
 assert.equal(control.status,200,'negative control: an owner with a customer reaches the portal');
 const opened=await control.json();
 assert.equal(opened.testMode,true);assert.equal(new URL(opened.url).hostname,'billing.stripe.com');
 assert.deepEqual(portalCalls,[ownerCustomer],'the portal session names the owner\'s own customer');
 const before=JSON.stringify(await customers());

 // 1 and 2. Owners without a customer id are refused before any Stripe call, over HTTP and at the function level.
 for(const [label,who] of [['no stripe_customers row',none],['row with NULL customer_id',pending]]){
  const calls=portalCalls.length;
  const response=await portal(who.token);
  assert.equal(response.status,409,label+': POST /api/billing/portal');
  assert.deepEqual(await response.json(),{error:refusal},label+': exact refusal message');
  await assert.rejects(billingPortal(scope(who.account),env,who.account,stub),e=>e?.status===409&&e.message===refusal,label+': billingPortal');
  assert.equal(portalCalls.length,calls,label+': no Stripe call is made');
  assert.equal(JSON.stringify(await customers()),before,label+': no customer row is created, changed or borrowed');
 }

 // The control still works after the refusals, and only ever names the owner's customer.
 assert.equal((await portal(owner.token)).status,200,'negative control after the refusals');
 assert.deepEqual(portalCalls,[ownerCustomer,ownerCustomer]);
 console.log('Billing portal customer gate passed: owners with no customer row or a NULL customer id get 409 over HTTP and at the function level, with no Stripe call and no customer row borrowed from another owner; an owner with a customer opens a portal session for their own customer only.');
}catch(error){console.error(error);process.exitCode=1;}
finally{globalThis.fetch=originalFetch;await store.close?.();}
