import {readFile,writeFile,mkdir,chmod} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

export const version='2025-02-24.acacia',app='whumpo-sandbox-v1';
// R14: the one Whumpo sandbox account (docs/stripe-pricing-tables.md). A sandbox key for any other account is refused.
export const expectedAccount='acct_1ULu0ZEz67CfHgqS';
export async function stripeClient(directory){
 const key=(await readFile(join(directory,'stripe-test.key'),'utf8')).trim();
 if(!/^sk_test_[A-Za-z0-9]+$/.test(key))throw Error('Only a Stripe sk_test_ sandbox key is accepted.');
 return async(path,form,keyId,method)=>{
  const response=await fetch('https://api.stripe.com/v1/'+path,{method:method??(form?'POST':'GET'),headers:{authorization:'Bearer '+key,'Stripe-Version':version,...(form?{'content-type':'application/x-www-form-urlencoded','Idempotency-Key':keyId}:{})},body:form?new URLSearchParams(form):undefined,redirect:'error',signal:AbortSignal.timeout(20000)});
  const body=await response.json();
  if(!response.ok)throw Error('Stripe sandbox request failed: '+response.status+' '+String(body.error?.code??body.error?.type??'unknown')+' ('+path.split('?')[0]+')');
  if(body.livemode===true||body.data?.some(row=>row.livemode===true))throw Error('Live Stripe object refused.');
  return body;
 };
}
// Only synthetic checkout-fixture customers may ever be deleted by these helpers.
export const fixtureEmail=/^checkout-fixture-[0-9a-f-]{36}@example\.test$/;
export async function deleteFixtureCustomer(api,customerId,email){
 if(!fixtureEmail.test(email))throw Error('Refusing to delete a customer for a non-fixture email.');
 const customer=await api('customers/'+encodeURIComponent(customerId));
 if(customer.deleted||customer.email!==email)return false;
 return (await api('customers/'+encodeURIComponent(customerId),undefined,undefined,'DELETE')).deleted===true;
}
// Dry run unless apply. Returns the fixture customers found (with `deleted` when applied).
export async function sweepFixtureCustomers(api,apply=false){
 const found=[];let after;
 for(;;){
  const page=await api('customers?limit=100'+(after?'&starting_after='+after:''));
  for(const c of page.data)if(typeof c.email==='string'&&fixtureEmail.test(c.email))found.push({id:c.id,email:c.email});
  if(!page.has_more)break;after=page.data.at(-1).id;
 }
 if(apply)for(const c of found)c.deleted=await deleteFixtureCustomer(api,c.id,c.email);
 return found;
}
export async function configure(directory,apply=false){
 const api=await stripeClient(directory),balance=await api('balance');
 if(balance.livemode!==false)throw Error('Cannot verify sandbox mode.');
 if((await api('account')).id!==expectedAccount)throw Error('This key belongs to a different Stripe account than the Whumpo sandbox.');
 console.log('Stripe sandbox credentials verified; no live billing.');
 if(!apply)return;
 await mkdir(directory,{recursive:true,mode:0o700});await chmod(join(directory,'stripe-test.key'),0o600);
 const file=join(directory,'stripe-setup.json');let journal;
 try{journal=JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;journal={id:crypto.randomUUID(),created:Date.now(),prices:{}};await writeFile(file,JSON.stringify(journal),{mode:0o600});}
 const save=()=>writeFile(file,JSON.stringify(journal,null,2),{mode:0o600});
 const b=await build({entryPoints:['src/plans.ts'],bundle:true,platform:'node',format:'esm',write:false});
 const {publicPlans}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
 const mutate=async(path,form,key)=>{if(Date.now()-journal.created>20*3600000)throw Error('Setup journal is older than the safe replay window. Inspect saved resources before continuing.');return api(path,form,app+'-'+journal.id+'-'+key);};
 for(const p of publicPlans.filter(p=>p.monthlyCents)){
  const productId='whumpo_sandbox_'+p.id.replaceAll('-','_')+'_v1';
  const products=await api('products?limit=100');if(products.has_more)throw Error('Catalogue exceeds bounded setup inventory.');
  let product=products.data.find(x=>x.id===productId);
  if(!product)product=await mutate('products',{id:productId,name:'Whumpo '+p.name+' — sandbox',description:'Test subscription only. No real charges, domain redemption, resource top-ups or premium model credits.','metadata[app]':app},'product-'+p.id);
  if(product.livemode!==false||product.metadata?.app!==app)throw Error('Product ownership mismatch.');
  for(const interval of ['month','year']){
   const lookup='whumpo_sandbox_'+p.id+'_'+interval+'_v1',amount=interval==='month'?p.monthlyCents:p.annualCents;
   const prices=await api('prices?lookup_keys[]='+encodeURIComponent(lookup));let price=prices.data[0];
   if(!price)price=await mutate('prices',{product:productId,currency:'usd',unit_amount:String(amount),'recurring[interval]':interval,lookup_key:lookup,'metadata[app]':app},'price-'+p.id+'-'+interval);
   if(price.livemode!==false||price.product!==productId||price.unit_amount!==amount||price.currency!=='usd'||price.recurring?.interval!==interval||price.recurring.interval_count!==1||!price.active)throw Error('Price mismatch.');
   journal.prices[p.id+':'+interval]=price.id;await save();
  }
 }
 if(!journal.portal){
  const portal=await mutate('billing_portal/configurations',{'business_profile[headline]':'Whumpo sandbox — no real charges','features[invoice_history][enabled]':'true','features[payment_method_update][enabled]':'true','features[subscription_cancel][enabled]':'true','features[subscription_cancel][mode]':'at_period_end','features[subscription_update][enabled]':'false','features[customer_update][enabled]':'false','default_return_url':'https://whumpo.com/workspace/?checkout=returned','metadata[app]':app},'portal');
  if(portal.livemode!==false)throw Error('Portal is not in sandbox mode.');journal.portal=portal.id;await save();
 }
 if(!journal.webhook){
  const existing=await api('webhook_endpoints?limit=100');
  if(existing.data.some(w=>w.url==='https://whumpo.com/api/stripe/webhook'))throw Error('A webhook already exists. Reconcile its saved signing secret before creating another.');
  const form={url:'https://whumpo.com/api/stripe/webhook',api_version:version,description:'Whumpo private test billing','metadata[app]':app};
  ['checkout.session.completed','checkout.session.expired','checkout.session.async_payment_succeeded','invoice.paid','invoice.payment_failed','customer.subscription.created','customer.subscription.updated','customer.subscription.deleted'].forEach((event,i)=>form['enabled_events['+i+']']=event);
  const webhook=await mutate('webhook_endpoints',form,'webhook');
  if(webhook.livemode!==false||!/^whsec_[A-Za-z0-9]+$/.test(webhook.secret??''))throw Error('Invalid sandbox webhook.');
  await writeFile(join(directory,'stripe-webhook.key'),webhook.secret+'\n',{mode:0o600});journal.webhook=webhook.id;await save();
 }
 const webhook=await api('webhook_endpoints/'+journal.webhook),portal=await api('billing_portal/configurations/'+journal.portal);
 if(webhook.livemode!==false||webhook.url!=='https://whumpo.com/api/stripe/webhook'||webhook.api_version!==version||webhook.status!=='enabled'||portal.livemode!==false||portal.features.subscription_update.enabled||portal.features.subscription_cancel.mode!=='at_period_end')throw Error('Saved setup changed; inspect before deployment.');
 const config={version:1,prices:journal.prices,portal:journal.portal};
 await writeFile(join(directory,'stripe-catalog.json'),JSON.stringify(config),{mode:0o600});
 console.log('Verified four sandbox products, eight recurring prices, restricted billing portal and signed webhook. Configuration saved privately.');
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [directory,mode]=process.argv.slice(2);
 if(!directory||mode&&mode!=='--configure'){console.error('Usage: node tools/stripe-sandbox.mjs SECRET_DIRECTORY [--configure]');process.exitCode=1;}
 else await configure(resolve(directory),mode==='--configure').catch(e=>{console.error(e.message);process.exitCode=1;});
}
