// Explicit opt-in: real test deployment + Stripe SANDBOX API, synthetic account only.
// Starts a custom-flow (Elements) Checkout Session and reads it back. Never enters card details or pays.
import assert from 'node:assert/strict';
import {readFile,writeFile,rm} from 'node:fs/promises';
import {requireCurrentProbeSchema,liveWorkspaceBrowser,seedCurrentProbeIdentity} from './helpers/live-workspace.mjs';
import {stripeClient,deleteFixtureCustomer,sweepFixtureCustomers} from '../tools/stripe-sandbox.mjs';
import {cloudflareClient,remoteD1} from '../tools/cms-cloudflare.mjs';
// Opt-in sandbox sweep: dry run unless --apply. Needs only .secrets/stripe-test.key (sk_test_), no D1.
if(process.argv.includes('--sweep')){
 const apply=process.argv.includes('--apply'),found=await sweepFixtureCustomers(await stripeClient('.secrets'),apply);
 console.log(JSON.stringify({apply,matched:found.length,customers:found},null,2));process.exit(0);
}
if(process.env.RUN_LIVE_CHECKOUT!=='1')throw Error('Set RUN_LIVE_CHECKOUT=1 for the live Stripe sandbox Checkout prefill check');
const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));assert.equal(config.vars.ENVIRONMENT,'test');
const db=remoteD1(cloudflareClient(config.account_id),config.d1_databases.find(d=>d.binding==='DB').database_id);
await requireCurrentProbeSchema(db);
const base='https://whumpo.com',id=crypto.randomUUID(),email='checkout-fixture-'+id+'@example.test';
const browser=liveWorkspaceBrowser(base),{json}=browser;
const cleanupFile='.secrets/checkout-prefill-live-account.json',evidenceFile='.secrets/checkout-prefill-live-evidence.json';
try{await readFile(cleanupFile);throw Error('Resolve the previous checkout fixture cleanup before a new run');}catch(error){if(error.code!=='ENOENT')throw error;}
await writeFile(cleanupFile,JSON.stringify({id,email}),{mode:0o600});
let success=false,originalFailure,sandbox=false,prefilled=false,stripeCustomerDeleted=false,stripeNote;
try{
 const [key]=await seedCurrentProbeIdentity(db,id,email);
 await browser.login(key,id);
 const started=await json('/api/billing/subscription/checkout','POST',{id:crypto.randomUUID(),plan:'starter',interval:'month'});
 // Abort unless the API says sandbox and returns a client secret for a sandbox session. There is no hosted URL any more.
 assert.equal(started.testMode,true,'ABORT: API did not report testMode');
 assert.equal(started.url,undefined,'the hosted Checkout URL is retired');
 assert.match(started.clientSecret,/^cs_test_[A-Za-z0-9]+_secret_[A-Za-z0-9]+$/,'ABORT: not a sandbox (cs_test_) client secret');
 sandbox=true;
 // Read the session and its customer from the Stripe sandbox API. No card is entered anywhere; the session is left to expire.
 const api=await stripeClient('.secrets'),session=await api('checkout/sessions/'+started.clientSecret.split('_secret_')[0]);
 assert.equal(session.ui_mode,'elements');assert.equal(session.livemode,false);
 const customer=await api('customers/'+session.customer);assert.equal(customer.email?.toLowerCase(),email,'the account email is prefilled on the customer');
 prefilled=true;
 await browser.logout();success=true;
}catch(error){originalFailure=error;throw error;}finally{
 try{ // Stripe sandbox cleanup must never block the D1 cleanup below.
  const row=await db.prepare('SELECT customer_id FROM stripe_customers WHERE user_id=?').bind(id).first();
  if(!row?.customer_id)stripeNote='no Stripe customer was created';
  else stripeCustomerDeleted=await deleteFixtureCustomer(await stripeClient('.secrets'),row.customer_id,email);
 }catch(e){stripeNote=e.code==='ENOENT'?'skipped: .secrets/stripe-test.key is missing':'Stripe delete failed: '+e.message;}
 try{await db.prepare('DELETE FROM users WHERE id=? AND email=?').bind(id,email).run();}catch{await writeFile(evidenceFile,JSON.stringify({success:false,cleanupVerified:false,originalFailure:originalFailure?.message??null}),{mode:0o600});throw Error('Synthetic fixture cleanup failed; preserve its identity file and inspect the recorded original outcome.');}
 for(const t of ['users WHERE id','identity_accounts WHERE account_id','stripe_customers WHERE user_id','stripe_subscription_orders WHERE user_id'])assert.equal(await db.prepare('SELECT 1 FROM '+t+'=?').bind(id).first(),null,'Cleanup left rows in '+t.split(' ')[0]);
 await rm(cleanupFile);
 const evidence={at:new Date().toISOString(),success,sandbox,prefilled,...(originalFailure?{failure:originalFailure.message}:{}),cleanupVerified:true,stripeCustomerDeleted,...(stripeNote?{stripeNote}:{})};
 await writeFile(evidenceFile,JSON.stringify(evidence,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify(evidence));
}
