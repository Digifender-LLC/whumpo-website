import {BillingError} from './billing';
import {boundedText,stripeTestConfigured,readStripeEvent} from './stripe-common';
import {plans} from './plans';
import {hashToken} from './security';

// D17: one pin for every request; @stripe/stripe-js 10.x is the matching 'endive' release train.
export const stripeVersion='2026-10-28.endive';
export const stripeApp='whumpo-sandbox-v1';
type Config={STRIPE_TEST_KEY?:string;STRIPE_WEBHOOK_SECRET?:string;STRIPE_SANDBOX_CATALOG?:string;STRIPE_TEST_PUBLISHABLE_KEY?:string;STRIPE_CHECKOUT_OPEN?:string};
// A catalogue saved before the portal was retired may still carry `portal`; it is ignored.
type Catalog={version:1;prices:Record<string,string>};
type Order={id:string;user_id:string;plan_id:string;interval:'month'|'year';price_id:string;amount_cents:number;created_at:number;state:string;session_id:string|null;subscription_id:string|null};
type Customer={user_id:string;customer_id:string|null;created_at:number};
type Metadata={app?:string;owner?:string;order?:string;purpose?:string};
type Price={id:string;livemode:boolean;currency:string;unit_amount:number;recurring?:{interval:string;interval_count:number}};
type Session={id:string;created?:number;livemode:boolean;customer:string;mode:string;ui_mode?:string;status:string;subscription:string|null;client_reference_id:string;client_secret?:string|null;metadata:Metadata;currency:string;amount_total:number;line_items:{has_more:boolean;data:{quantity:number;price:Price}[]}};
type Subscription={id:string;livemode:boolean;customer:string;metadata:Metadata;status:string;cancel_at_period_end:boolean;current_period_end?:number;latest_invoice:string|null;items:{has_more:boolean;data:{quantity:number;price:Price;current_period_end?:number}[]}};
// Basil and later move these fields; the legacy spellings stay readable so a replayed older payload still verifies.
type InvoiceLine={type?:string;subscription?:string|null;quantity:number;proration?:boolean;price?:Price;amount:number;period:{start:number;end:number};pricing?:{price_details?:{price?:string}};parent?:{type?:string;subscription_item_details?:{subscription?:string|null;proration?:boolean}}};
type Invoice={id:string;livemode:boolean;customer:string;amount_due?:number;subscription?:string|null;parent?:{subscription_details?:{subscription?:string|null}};status:string;paid?:boolean;paid_out_of_band?:boolean;currency:string;amount_paid:number;total:number;hosted_invoice_url:string|null;created:number;billing_reason:string;lines:{has_more:boolean;data:InvoiceLine[]}};
const invoiceSubscription=(i:Invoice)=>i.parent?.subscription_details?.subscription??i.subscription??null;
const periodEnd=(s:Subscription)=>s.items?.data?.[0]?.current_period_end??s.current_period_end;
const returnURL='https://whumpo.com/workspace/?checkout=returned&session_id={CHECKOUT_SESSION_ID}';
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const now=()=>Math.floor(Date.now()/1000);
const objectId=(id:unknown,prefix:string):id is string=>typeof id==='string'&&new RegExp('^'+prefix+'_[A-Za-z0-9]+$').test(id);
function requireMatch(value:unknown){if(!value)throw new BillingError(409,'Stripe sandbox details do not match the saved billing record.');}
function catalog(env:Config):Catalog{
 // Owner decision Q-007 (D20 lock 1): checkout stays closed unless exactly 'true'. One choke point for every Stripe path. Lock 2 is the sk_test_-only key check and the livemode===false reads.
 if(env.STRIPE_CHECKOUT_OPEN!=='true')throw new BillingError(503,"Checkout isn't open yet. Explore is still available.");
 try{
  if(!stripeTestConfigured(env))throw Error();
  const c=JSON.parse(env.STRIPE_SANDBOX_CATALOG??'') as Catalog;
  if(c.version!==1)throw Error();
  for(const p of plans.filter(p=>p.monthlyCents))for(const interval of ['month','year'])if(!objectId(c.prices?.[p.id+':'+interval],'price'))throw Error();
  return c;
 }catch{throw new BillingError(503,'Sandbox subscriptions are not configured. Explore is still available.');}
}
export function subscriptionsEnabled(env:Config){try{catalog(env);return true;}catch{return false;}}
// Public Worker var, never a secret. Anything but a test publishable key is refused, so real-money mode stays impossible.
export function publishableKey(env:Config){const k=env.STRIPE_TEST_PUBLISHABLE_KEY??'';return /^pk_test_[A-Za-z0-9]{20,200}$/.test(k)?k:null;}
async function stripe<T>(env:Config,path:string,transport:typeof fetch,form?:URLSearchParams,key?:string):Promise<T>{
 catalog(env);let declined=false,code='';
 try{
  const response=await transport('https://api.stripe.com/v1/'+path,{method:form?'POST':'GET',headers:{authorization:'Bearer '+env.STRIPE_TEST_KEY,'Stripe-Version':stripeVersion,...(form?{'content-type':'application/x-www-form-urlencoded','Idempotency-Key':key!}:{})},body:form,redirect:'manual',signal:AbortSignal.timeout(15000)});
  if(!response.ok){declined=response.status===402;if(declined){try{const j=JSON.parse(await boundedText(response,8192)) as {error?:{code?:string}};code=String(j?.error?.code??'');}catch{/* the status alone says it was refused */}}else await response.body?.cancel();throw Error();}
  return JSON.parse(await boundedText(response,262144)) as T;
 }catch{if(declined){if(code==='invoice_payment_intent_requires_action'||code==='authentication_required')throw new BillingError(402,'This payment needs 3D Secure confirmation from your bank.','requires_action');throw new BillingError(402,'The card on file was declined. Update your payment method and try again.','declined');}throw new BillingError(502,'Stripe sandbox could not be reached. Refresh or retry the same checkout; your billing record is saved.');}
}
function hostedURL(value:unknown,host:string){
 if(typeof value!=='string'||value.length>4096)throw new BillingError(502,'Invalid Stripe destination');
 const u=new URL(value);if(u.protocol!=='https:'||u.hostname!==host||u.username||u.password||u.port)throw new BillingError(502,'Invalid Stripe destination');return value;
}
function checkPrice(price:Price,order:Order){requireMatch(price?.id===order.price_id&&price.livemode===false&&price.currency==='usd'&&price.unit_amount===order.amount_cents&&price.recurring?.interval===order.interval&&price.recurring.interval_count===1);}
async function withCustomer<T>(db:D1Database,user:string,work:(customer:Customer)=>Promise<T>){
 await db.prepare('INSERT INTO stripe_customers(user_id,created_at) VALUES(?,?) ON CONFLICT(user_id) DO NOTHING').bind(user,now()).run();
 const lease=crypto.randomUUID();
 const acquired=await db.prepare('UPDATE stripe_customers SET lease=?,lease_until=unixepoch()+180 WHERE user_id=? AND lease_until<unixepoch()').bind(lease,user).run();
 if(acquired.meta.changes!==1)throw new BillingError(409,'Billing is already being checked. Wait a moment, then refresh.');
 try{return await work((await db.prepare('SELECT * FROM stripe_customers WHERE user_id=?').bind(user).first<Customer>())!);}
 finally{await db.prepare('UPDATE stripe_customers SET lease=NULL,lease_until=0 WHERE user_id=? AND lease=?').bind(user,lease).run();}
}
async function customerId(db:D1Database,env:Config,c:Customer,transport:typeof fetch){
 if(c.customer_id)return c.customer_id;
 // Never recreate an uncertain customer after Stripe's idempotency retention.
 if(c.created_at+20*3600<=now())throw new BillingError(409,'This unfinished billing setup needs operator reconciliation.');
 const customer=await stripe<{id:string;livemode:boolean;metadata:Metadata}>(env,'customers',transport,new URLSearchParams({'metadata[app]':stripeApp,'metadata[owner]':c.user_id}),'whumpo-customer-'+c.user_id);
 requireMatch(objectId(customer.id,'cus')&&customer.livemode===false&&customer.metadata?.app===stripeApp&&customer.metadata.owner===c.user_id);
 await db.prepare('UPDATE stripe_customers SET customer_id=? WHERE user_id=? AND (customer_id IS NULL OR customer_id=?)').bind(customer.id,c.user_id,customer.id).run();
 requireMatch((await db.prepare('SELECT customer_id FROM stripe_customers WHERE user_id=?').bind(c.user_id).first<Customer>())?.customer_id===customer.id);return customer.id;
}
async function readSession(db:D1Database,env:Config,order:Order,customer:string,transport:typeof fetch,session?:Session){
 const s=session??await stripe<Session>(env,'checkout/sessions/'+order.session_id+'?expand[]=line_items.data.price',transport);
 requireMatch(objectId(s.id,'cs_test')&&s.livemode===false&&s.customer===customer&&s.mode==='subscription'&&s.metadata?.app===stripeApp&&s.metadata.order===order.id&&s.client_reference_id===order.id&&(!order.session_id||s.id===order.session_id));
 requireMatch(s.currency==='usd'&&s.amount_total===order.amount_cents&&s.line_items?.has_more===false&&s.line_items.data.length===1&&s.line_items.data[0].quantity===1);
 checkPrice(s.line_items.data[0].price,order);
 requireMatch(['open','complete','expired'].includes(s.status));
 if(s.status==='complete')requireMatch(objectId(s.subscription,'sub'));
 await db.prepare("UPDATE stripe_subscription_orders SET session_id=?,subscription_id=COALESCE(subscription_id,?),state=? WHERE id=? AND state='pending'").bind(s.id,s.status==='complete'?s.subscription:null,s.status==='open'?'pending':s.status,order.id).run();
 if(s.status==='complete')await syncSubscription(db,env,s.subscription!,customer,transport);
 return s;
}
type Void={invoiceId:string;reason:'refund'|'dispute-lost';sourceId:string};
const voidRow=(db:D1Database,v:Void)=>db.prepare('INSERT INTO stripe_invoice_voids(invoice_id,reason,source_id,created_at) VALUES(?,?,?,?) ON CONFLICT(invoice_id) DO NOTHING').bind(v.invoiceId,v.reason,v.sourceId,now());
// A void that names this invoice is written in the same batch as the invoice, so a refund delivered first never leaves a moment of coverage.
async function recordInvoice(db:D1Database,env:Config,id:string,sub:Subscription,order:Order,transport:typeof fetch,voided?:Void){
 requireMatch(objectId(id,'in'));
 const invoice=await stripe<Invoice>(env,'invoices/'+id,transport);
 requireMatch(invoice.id===id&&invoice.livemode===false&&invoice.customer===sub.customer&&invoiceSubscription(invoice)===sub.id);
 if(invoice.status!=='paid')return invoice.status;
 requireMatch(!invoice.paid_out_of_band&&invoice.currency==='usd'&&invoice.amount_paid===order.amount_cents&&invoice.total===order.amount_cents&&['subscription_create','subscription_cycle'].includes(invoice.billing_reason));
 requireMatch(invoice.lines?.has_more===false&&invoice.lines.data.length===1);
 const line=invoice.lines.data[0],detail=line.parent?.subscription_item_details;
 if(line.price)checkPrice(line.price,order);else requireMatch(line.pricing?.price_details?.price===order.price_id);
 requireMatch((line.type===undefined||line.type==='subscription')&&(detail?.subscription??line.subscription)===sub.id&&line.quantity===1&&(detail?.proration??line.proration)===false&&line.amount===order.amount_cents);
 const {start,end}=line.period;
 requireMatch(Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>0&&end>start&&end-start<=(order.interval==='year'?367:32)*86400);
 const url=invoice.hosted_invoice_url?hostedURL(invoice.hosted_invoice_url,'invoice.stripe.com'):null;
 const insert=db.prepare('INSERT INTO stripe_paid_invoices(id,user_id,subscription_id,plan_id,amount_cents,interval,starts_at,ends_at,hosted_url,created_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,order.user_id,sub.id,order.plan_id,order.amount_cents,order.interval,start,end,url,invoice.created);
 await db.batch(voided?.invoiceId===id?[insert,voidRow(db,voided)]:[insert]);
 const saved=await db.prepare('SELECT * FROM stripe_paid_invoices WHERE id=?').bind(id).first<{user_id:string;subscription_id:string;plan_id:string;amount_cents:number;starts_at:number;ends_at:number}>();
 requireMatch(saved?.user_id===order.user_id&&saved.subscription_id===sub.id&&saved.plan_id===order.plan_id&&saved.amount_cents===order.amount_cents&&saved.starts_at===start&&saved.ends_at===end);
 return invoice.status;
}
async function syncSubscription(db:D1Database,env:Config,id:string,customer:string,transport:typeof fetch,invoiceId?:string,voided?:Void){
 requireMatch(objectId(id,'sub'));
 const sub=await stripe<Subscription>(env,'subscriptions/'+id,transport);
 requireMatch(sub.id===id&&sub.livemode===false&&sub.customer===customer);
 if(sub.metadata?.app!==stripeApp||!sub.metadata.order)return;
 const order=await db.prepare('SELECT o.* FROM stripe_subscription_orders o JOIN stripe_customers c ON c.user_id=o.user_id WHERE o.id=? AND c.customer_id=?').bind(sub.metadata.order,customer).first<Order>();
 if(!order)return;
 requireMatch(order.state!=='expired'&&(!order.subscription_id||order.subscription_id===id));
 requireMatch(sub.items?.has_more===false&&sub.items.data.length===1&&sub.items.data[0].quantity===1);checkPrice(sub.items.data[0].price,order);
 const end=periodEnd(sub);requireMatch(Number.isSafeInteger(end)&&typeof sub.cancel_at_period_end==='boolean');
 await db.batch([
  db.prepare("UPDATE stripe_subscription_orders SET subscription_id=?,state='complete' WHERE id=? AND state='pending'").bind(id,order.id),
  db.prepare('INSERT INTO stripe_subscriptions(id,order_id,user_id,status,cancel_at_period_end,period_end,latest_invoice_id,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,cancel_at_period_end=excluded.cancel_at_period_end,period_end=excluded.period_end,latest_invoice_id=excluded.latest_invoice_id,updated_at=excluded.updated_at').bind(id,order.id,order.user_id,sub.status,sub.cancel_at_period_end?1:0,end,sub.latest_invoice,now())
 ]);
 if(sub.latest_invoice){const status=await recordInvoice(db,env,sub.latest_invoice,sub,order,transport,voided);await db.prepare('UPDATE stripe_subscriptions SET payment_status=? WHERE id=? AND latest_invoice_id=?').bind(status,id,sub.latest_invoice).run();}
 if(invoiceId&&invoiceId!==sub.latest_invoice)await recordInvoice(db,env,invoiceId,sub,order,transport,voided);
}
async function syncCustomer(db:D1Database,env:Config,c:Customer,transport:typeof fetch){
 if(!c.customer_id)return;
 const pending=await db.prepare("SELECT * FROM stripe_subscription_orders WHERE user_id=? AND state='pending'").bind(c.user_id).first<Order>();
 if(pending?.session_id)await readSession(db,env,pending,c.customer_id,transport);
 // Provider read recovers a subscription whose checkout reply/webhook was lost.
 const list=await stripe<{data:Subscription[];has_more:boolean}>(env,'subscriptions?customer='+c.customer_id+'&status=all&limit=10',transport);
 if(list.has_more)throw new BillingError(409,'Subscription history needs operator reconciliation.');
 for(const s of list.data){requireMatch(s.livemode===false&&s.customer===c.customer_id);if(s.metadata?.app===stripeApp)await syncSubscription(db,env,s.id,c.customer_id,transport);}
}
export async function subscriptionStatus(db:D1Database,env:Config,user:string){
 const subscription=await db.prepare("SELECT s.id,s.status,s.cancel_at_period_end,s.period_end,s.payment_status,o.plan_id,o.interval,o.amount_cents FROM stripe_subscriptions s JOIN stripe_subscription_orders o ON o.id=s.order_id WHERE s.user_id=? ORDER BY CASE WHEN s.status IN ('canceled','incomplete_expired') THEN 1 ELSE 0 END,o.created_at DESC,s.id DESC LIMIT 1").bind(user).first();
 const invoices=(await db.prepare('SELECT id,plan_id,amount_cents,interval,starts_at,ends_at,hosted_url,created_at FROM stripe_paid_invoices WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 24').bind(user).all()).results;
 const pending=await db.prepare("SELECT id,plan_id,interval,amount_cents FROM stripe_subscription_orders WHERE user_id=? AND state='pending'").bind(user).first();
 return {enabled:subscriptionsEnabled(env)&&!!publishableKey(env),publishableKey:publishableKey(env),testMode:true,subscription,invoices,pending,hasCustomer:!!(await db.prepare('SELECT customer_id FROM stripe_customers WHERE user_id=? AND customer_id IS NOT NULL').bind(user).first())};
}
export async function refreshSubscriptions(db:D1Database,env:Config,user:string,transport:typeof fetch=fetch){
 catalog(env);if(await db.prepare('SELECT user_id FROM stripe_customers WHERE user_id=?').bind(user).first())await withCustomer(db,user,c=>syncCustomer(db,env,c,transport));return subscriptionStatus(db,env,user);
}
export async function startSubscription(db:D1Database,env:Config,user:string,input:{id?:unknown;plan?:unknown;interval?:unknown},transport:typeof fetch=fetch){
 const c=catalog(env),plan=plans.find(p=>p.id===input.plan&&p.monthlyCents>0);
 if(typeof input.id!=='string'||!uuid.test(input.id)||!plan||!['month','year'].includes(String(input.interval)))throw new BillingError(400,'Choose a sandbox plan and billing interval.');
 const id=input.id,interval=input.interval as 'month'|'year',amount=interval==='month'?plan.monthlyCents:plan.annualCents;
 return withCustomer(db,user,async customer=>{
  const customerID=await customerId(db,env,customer,transport);customer.customer_id=customerID;
  // Stripe Checkout asks for an email unless the customer already has one. Send the account email on file.
  const email=(await db.prepare('SELECT email FROM users WHERE id=?').bind(user).first<{email:string}>())?.email;
  if(email)await stripe<{id:string}>(env,'customers/'+customerID,transport,new URLSearchParams({email}),'whumpo-customer-email-'+customerID+'-'+(await hashToken(email)).slice(0,32));
  await syncCustomer(db,env,customer,transport);
  let order=await db.prepare('SELECT * FROM stripe_subscription_orders WHERE id=? AND user_id=?').bind(id,user).first<Order>();
  if(order)requireMatch(order.plan_id===plan.id&&order.interval===interval);
  if(order?.state==='complete')return {complete:true,testMode:true};
  if(order?.state==='expired')throw new BillingError(409,'This checkout expired. Choose a plan again.');
  if(await db.prepare("SELECT id FROM stripe_subscriptions WHERE user_id=? AND status NOT IN ('canceled','incomplete_expired')").bind(user).first())throw new BillingError(409,'You already have a sandbox subscription. Manage it in Billing.');
  if(!order){
   if(await db.prepare("SELECT id FROM stripe_subscription_orders WHERE user_id=? AND state='pending'").bind(user).first())throw new BillingError(409,'Resume your existing checkout before starting another.');
   const count=await db.prepare('SELECT COUNT(*) n FROM stripe_subscription_orders WHERE user_id=? AND created_at>?').bind(user,now()-86400).first<{n:number}>();
   if(count!.n>=5)throw new BillingError(429,'Five sandbox checkouts per day are available.');
   await db.prepare('INSERT INTO stripe_subscription_orders(id,user_id,plan_id,interval,price_id,amount_cents,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,user,plan.id,interval,c.prices[plan.id+':'+interval],amount,now()).run();
   order=await db.prepare('SELECT * FROM stripe_subscription_orders WHERE id=? AND user_id=?').bind(id,user).first<Order>();requireMatch(order);
  }
  if(order!.created_at+3600<=now()&&!order!.session_id)throw new BillingError(409,'This unfinished checkout needs operator reconciliation. It will not be charged again.');
  const form=new URLSearchParams({mode:'subscription',customer:customerID,'payment_method_types[0]':'card','line_items[0][price]':order!.price_id,'line_items[0][quantity]':'1',client_reference_id:id,'metadata[app]':stripeApp,'metadata[order]':id,'subscription_data[metadata][app]':stripeApp,'subscription_data[metadata][order]':id,ui_mode:'elements',return_url:returnURL,expires_at:String(order!.created_at+3600),'automatic_tax[enabled]':'true',billing_address_collection:'required','customer_update[address]':'auto','expand[0]':'line_items.data.price'});
  let s=await readSession(db,env,order!,customerID,transport,order!.session_id?undefined:await stripe<Session>(env,'checkout/sessions',transport,form,'whumpo-subscription-'+id));
  // readSession has just saved the session id; reload so any later re-read names it (a fresh order held none).
  order=await db.prepare('SELECT * FROM stripe_subscription_orders WHERE id=? AND user_id=?').bind(id,user).first<Order>();requireMatch(order);
  if(s.status==='complete')return {complete:true,testMode:true};
  if(s.status!=='open')throw new BillingError(409,'This checkout expired. Refresh Billing to choose again.');
  if(s.ui_mode!=='elements'||typeof s.client_secret!=='string'||!s.client_secret){
   // A hosted-mode leftover, or a session that will not hand its secret back, is expired and never reused. Whether Stripe
   // refuses to expire a session that has a payment in flight is unverified (no sandbox run yet), so the outcome is never
   // assumed: if the expire call fails for any reason the session is re-read and only its own status is trusted.
   let refused=false;
   try{await stripe<Session>(env,'checkout/sessions/'+s.id+'/expire',transport,new URLSearchParams(),'whumpo-expire-'+s.id);}catch(e){if(!(e instanceof BillingError))throw e;refused=true;}
   s=await readSession(db,env,order!,customerID,transport);
   if(s.status==='complete')return {complete:true,testMode:true};
   if(s.status==='open'||refused&&s.status!=='expired')throw new BillingError(409,'This saved checkout could not be refreshed right now. Wait a moment, then refresh Billing.');
   throw new BillingError(409,'This saved checkout was refreshed. Choose your plan again.');
  }
  return {clientSecret:s.client_secret,testMode:true};
 });
}
// In-app replacements for the retired billing portal. Every route resolves the caller's own customer and subscription from
// their rows; no customer, subscription, invoice or session id is accepted from the client except the setup session id,
// which is verified against the caller's customer and owner metadata before anything is written.
type Card={brand:string;last4:string;exp_month:number;exp_year:number};
type PaymentMethod={id:string;livemode:boolean;customer:string|null;type:string;card?:Card};
// Management routes never create a customer row; only checkout does.
async function requireCustomer(db:D1Database,user:string){
 const row=await db.prepare('SELECT customer_id FROM stripe_customers WHERE user_id=? AND customer_id IS NOT NULL').bind(user).first<Customer>();
 if(!row?.customer_id)throw new BillingError(409,'Start a sandbox checkout first.');return row.customer_id;
}
async function ownedSubscription(db:D1Database,env:Config,user:string,transport:typeof fetch){
 const row=await db.prepare("SELECT s.id,s.order_id,c.customer_id FROM stripe_subscriptions s JOIN stripe_customers c ON c.user_id=s.user_id WHERE s.user_id=? AND c.customer_id IS NOT NULL AND s.status NOT IN ('canceled','incomplete_expired') ORDER BY s.updated_at DESC LIMIT 1").bind(user).first<{id:string;order_id:string;customer_id:string}>();
 if(!row)throw new BillingError(409,'You do not have an active sandbox subscription.');
 const sub=await stripe<Subscription>(env,'subscriptions/'+row.id,transport);
 requireMatch(sub.id===row.id&&sub.livemode===false&&sub.customer===row.customer_id&&sub.metadata?.app===stripeApp&&sub.metadata.order===row.order_id);
 return {sub,customer:row.customer_id,orderId:row.order_id};
}
const cardOf=(pm:PaymentMethod|null|undefined,customer:string)=>{
 if(!pm||typeof pm!=='object')return null;
 requireMatch(pm.livemode===false&&pm.customer===customer);
 return pm.type==='card'&&pm.card?{brand:String(pm.card.brand),last4:String(pm.card.last4),expMonth:pm.card.exp_month,expYear:pm.card.exp_year}:null;
};
// Card brand and last four are read from Stripe on demand and stored nowhere.
export async function paymentMethodCard(db:D1Database,env:Config,user:string,transport:typeof fetch=fetch){
 catalog(env);
 const row=await db.prepare('SELECT customer_id FROM stripe_customers WHERE user_id=? AND customer_id IS NOT NULL').bind(user).first<Customer>();
 if(!row?.customer_id)return {card:null,testMode:true};
 const customer=await stripe<{id:string;livemode:boolean;invoice_settings?:{default_payment_method?:PaymentMethod|null}}>(env,'customers/'+row.customer_id+'?expand[]=invoice_settings.default_payment_method',transport);
 requireMatch(customer.id===row.customer_id&&customer.livemode===false);
 let pm=customer.invoice_settings?.default_payment_method;
 if(!pm){
  const active=await db.prepare("SELECT id FROM stripe_subscriptions WHERE user_id=? AND status NOT IN ('canceled','incomplete_expired') LIMIT 1").bind(user).first<{id:string}>();
  if(active)pm=(await stripe<{id:string;customer:string;livemode:boolean;default_payment_method?:PaymentMethod|null}>(env,'subscriptions/'+active.id+'?expand[]=default_payment_method',transport)).default_payment_method;
 }
 return {card:cardOf(pm,row.customer_id),testMode:true};
}
export async function setCancelAtPeriodEnd(db:D1Database,env:Config,user:string,cancel:boolean,transport:typeof fetch=fetch){
 catalog(env);await requireCustomer(db,user);
 return withCustomer(db,user,async customer=>{
  const {sub,customer:cus}=await ownedSubscription(db,env,user,transport);
  if(sub.status==='canceled'||sub.status==='incomplete_expired')throw new BillingError(409,'This subscription has ended.');
  if(sub.cancel_at_period_end!==cancel)await stripe<Subscription>(env,'subscriptions/'+sub.id,transport,new URLSearchParams({cancel_at_period_end:String(cancel)}),'whumpo-cancel-'+sub.id+'-'+cancel+'-'+crypto.randomUUID());
  // A random key per change: cancel, resume, cancel must each reach Stripe. The state check above and the lease make a retried request safe.
  await syncSubscription(db,env,sub.id,cus,transport);
  return subscriptionStatus(db,env,customer.user_id);
 });
}
export async function startPaymentMethodUpdate(db:D1Database,env:Config,user:string,transport:typeof fetch=fetch){
 catalog(env);
 const customerID=await requireCustomer(db,user);
 const s=await stripe<Session>(env,'checkout/sessions',transport,new URLSearchParams({mode:'setup',ui_mode:'elements',customer:customerID,currency:'usd','payment_method_types[0]':'card',return_url:'https://whumpo.com/workspace/?payment_method=returned&session_id={CHECKOUT_SESSION_ID}','metadata[app]':stripeApp,'metadata[owner]':user,'metadata[purpose]':'payment-method',expires_at:String(now()+1800),'expand[0]':'setup_intent'}),'whumpo-setup-'+crypto.randomUUID());
 requireMatch(objectId(s.id,'cs_test')&&s.livemode===false&&s.mode==='setup'&&s.customer===customerID&&s.metadata?.owner===user&&typeof s.client_secret==='string');
 return {clientSecret:s.client_secret,testMode:true};
}
// Applies a finished setup session as the default payment method. Used by the caller's return and by the signed webhook, with
// the same ownership checks. A session older than an hour, or older than the last one applied for this customer, is refused, so
// an old return URL cannot put an earlier card back; the same session applied twice is harmless.
async function applySetup(db:D1Database,env:Config,user:string,sessionId:string,transport:typeof fetch){
 return withCustomer(db,user,async customer=>{
  if(!customer.customer_id)throw new BillingError(409,'Start a sandbox checkout first.');
  const s=await stripe<Session&{setup_intent:{status:string;customer:string;payment_method:string|null}|null}>(env,'checkout/sessions/'+sessionId+'?expand[]=setup_intent',transport);
  requireMatch(s.id===sessionId&&s.livemode===false&&s.mode==='setup'&&s.customer===customer.customer_id&&s.metadata?.app===stripeApp&&s.metadata.owner===user&&s.metadata.purpose==='payment-method');
  if(s.status!=='complete')throw new BillingError(409,'The new payment method was not saved. Try again.');
  requireMatch(Number.isSafeInteger(s.created));
  if(now()-s.created!>3600)throw new BillingError(409,'This card update is too old to apply. Start the update again.');
  const si=s.setup_intent;requireMatch(si&&si.status==='succeeded'&&si.customer===customer.customer_id&&objectId(si.payment_method,'pm'));
  const pm=await stripe<PaymentMethod>(env,'payment_methods/'+si!.payment_method,transport);
  requireMatch(pm.id===si!.payment_method&&pm.livemode===false&&pm.customer===customer.customer_id);
  const current=await stripe<{id:string;livemode:boolean;metadata?:Record<string,string>}>(env,'customers/'+customer.customer_id,transport);
  requireMatch(current.id===customer.customer_id&&current.livemode===false);
  const last=Number(current.metadata?.whumpo_pm_applied??0);
  if(Number.isFinite(last)&&s.created!<last)throw new BillingError(409,'A newer card update has already been applied. Start the update again if you want this card.');
  await stripe(env,'customers/'+customer.customer_id,transport,new URLSearchParams({'invoice_settings[default_payment_method]':pm.id,'metadata[whumpo_pm_applied]':String(s.created)}),'whumpo-default-pm-'+s.id);
  const active=await db.prepare("SELECT id FROM stripe_subscriptions WHERE user_id=? AND status NOT IN ('canceled','incomplete_expired') LIMIT 1").bind(user).first<{id:string}>();
  if(active){const {sub}=await ownedSubscription(db,env,user,transport);await stripe(env,'subscriptions/'+sub.id,transport,new URLSearchParams({default_payment_method:pm.id}),'whumpo-sub-pm-'+s.id);}
  return {card:cardOf(pm,customer.customer_id),testMode:true};
 });
}
export async function completePaymentMethodUpdate(db:D1Database,env:Config,user:string,input:{session?:unknown},transport:typeof fetch=fetch){
 catalog(env);
 if(!objectId(input.session,'cs_test'))throw new BillingError(400,'Payment method update not found.');
 await requireCustomer(db,user);
 return applySetup(db,env,user,input.session,transport);
}
export async function retryLatestInvoice(db:D1Database,env:Config,user:string,transport:typeof fetch=fetch){
 catalog(env);await requireCustomer(db,user);
 return withCustomer(db,user,async()=>{
  const {sub,customer,orderId}=await ownedSubscription(db,env,user,transport);
  if(!sub.latest_invoice)throw new BillingError(409,'There is no unpaid invoice to retry.');
  const order=await db.prepare('SELECT amount_cents FROM stripe_subscription_orders WHERE id=? AND user_id=?').bind(orderId,user).first<{amount_cents:number}>();
  const invoice=await stripe<Invoice>(env,'invoices/'+sub.latest_invoice,transport);
  requireMatch(order&&invoice.id===sub.latest_invoice&&invoice.livemode===false&&invoice.customer===customer&&invoiceSubscription(invoice)===sub.id);
  if(invoice.status==='paid'){await syncSubscription(db,env,sub.id,customer,transport);return subscriptionStatus(db,env,user);}
  if(invoice.status!=='open')throw new BillingError(409,'This invoice cannot be retried.');
  // Only the exact saved plan amount is ever paid here.
  requireMatch(invoice.currency==='usd'&&invoice.total===order!.amount_cents&&(invoice.amount_due===undefined||invoice.amount_due===order!.amount_cents));
  // A fresh key each time: a retry after updating the card must not replay an earlier decline. The status check above and the lease keep a double click harmless.
  let failure:unknown;
  try{await stripe(env,'invoices/'+invoice.id+'/pay',transport,new URLSearchParams(),'whumpo-retry-'+invoice.id+'-'+crypto.randomUUID());}catch(e){failure=e;}
  // Recording coverage is never swallowed: if it fails after a payment, say so rather than reporting success.
  try{await syncSubscription(db,env,sub.id,customer,transport,invoice.id);}catch(e){if(!failure)throw e;}
  if(failure instanceof BillingError&&failure.code==='requires_action'){
   // The customer must finish 3D Secure with their bank; Stripe's hosted invoice page is the way to do that.
   return {...await subscriptionStatus(db,env,user),actionRequired:{invoiceUrl:invoice.hosted_invoice_url?hostedURL(invoice.hosted_invoice_url,'invoice.stripe.com'):null}};
  }
  if(failure)throw failure;
  return subscriptionStatus(db,env,user);
 });
}
type PaymentFact={id:string;livemode:boolean;payment_intent?:string|null;refunded?:boolean;status?:string};
type InvoicePayments={has_more:boolean;data:{invoice?:string|{id?:string}|null}[]};
/**
 * WH-042: a fully refunded charge or a dispute closed as lost ends the coverage of the invoice that payment settled. The event only names the object: it is read again, must be
 * test mode, and is followed through its payment intent to the invoice payment. Partial refunds, open disputes and payments for no invoice of ours change nothing. Any shape
 * that does not match throws (a 409 the provider retries), so an unrecognised event never silently keeps or removes access. The row is a compensating fact; the invoice is untouched.
 * Delivery order does not matter: a refund or loss that arrives before its invoice was recorded reads that invoice through the same verified path as invoice.paid and records it
 * together with its void, so a later invoice.paid, subscription event or Refresh finds the void already there and grants nothing.
 */
async function voidInvoiceForPayment(db:D1Database,env:Config,type:'charge.refunded'|'charge.dispute.closed',id:string,transport:typeof fetch){
 const fact=await stripe<PaymentFact>(env,(type==='charge.refunded'?'charges/':'disputes/')+id,transport);
 requireMatch(fact.id===id&&fact.livemode===false);
 if(type==='charge.refunded'?fact.refunded!==true:fact.status!=='lost')return;
 const intent=fact.payment_intent;requireMatch(objectId(intent,'pi'));
 const found=await stripe<InvoicePayments>(env,'invoice_payments?'+new URLSearchParams({'payment[type]':'payment_intent','payment[payment_intent]':intent!,limit:'2'}),transport);
 requireMatch(found.has_more===false&&Array.isArray(found.data)&&found.data.length<=1);
 if(!found.data.length)return;
 const ref=found.data[0].invoice,invoiceId=typeof ref==='string'?ref:ref?.id;
 requireMatch(objectId(invoiceId,'in'));
 const voided:Void={invoiceId:invoiceId!,reason:type==='charge.refunded'?'refund':'dispute-lost',sourceId:id};
 if(await db.prepare('SELECT id FROM stripe_paid_invoices WHERE id=?').bind(invoiceId).first()){await voidRow(db,voided).run();return;}
 const invoice=await stripe<Invoice>(env,'invoices/'+invoiceId,transport);requireMatch(invoice.id===invoiceId&&invoice.livemode===false);
 const sub=invoiceSubscription(invoice);
 if(!objectId(sub,'sub')||!await db.prepare('SELECT user_id FROM stripe_customers WHERE customer_id=?').bind(invoice.customer).first())return;
 await syncSubscription(db,env,sub,invoice.customer,transport,invoiceId,voided);
 // Settled by a payment that was returned, yet not recordable as paid: a later read could still grant it, so never answer success.
 if(!await db.prepare('SELECT id FROM stripe_paid_invoices WHERE id=?').bind(invoiceId).first())requireMatch(invoice.status==='paid');
}
export async function stripeBillingWebhook(request:Request,db:D1Database,env:Config,transport:typeof fetch=fetch){
 const event=await readStripeEvent(request,env),id=event.data?.object?.id;
 catalog(env);
 if(event.type?.startsWith('checkout.session.')){
  requireMatch(objectId(id,'cs_test'));
  const plain=await stripe<Session>(env,'checkout/sessions/'+id,transport);
  requireMatch(plain.id===id&&plain.livemode===false);
  if(plain.mode==='setup'){
   // A saved card whose return was lost: apply it for the owner named in the session, under the same checks as the return.
   const owner=plain.metadata?.owner;
   if(event.type==='checkout.session.completed'&&plain.metadata?.app===stripeApp&&plain.metadata.purpose==='payment-method'&&typeof owner==='string'&&await db.prepare('SELECT user_id FROM stripe_customers WHERE user_id=? AND customer_id=?').bind(owner,plain.customer).first())await applySetup(db,env,owner,id!,transport);
   return {received:true};
  }
  if(plain.mode!=='subscription'||plain.metadata?.app!==stripeApp)return {received:true};
  const s=await stripe<Session>(env,'checkout/sessions/'+id+'?expand[]=line_items.data.price',transport);
  requireMatch(s.id===id&&s.livemode===false);
  const order=await db.prepare('SELECT o.* FROM stripe_subscription_orders o JOIN stripe_customers c ON c.user_id=o.user_id WHERE o.id=? AND c.customer_id=?').bind(s.metadata.order??'',s.customer).first<Order>();
  if(order)await readSession(db,env,order,s.customer,transport,s);
 }else if(event.type?.startsWith('invoice.')&&objectId(id,'in')){
  const invoice=await stripe<Invoice>(env,'invoices/'+id,transport);requireMatch(invoice.id===id&&invoice.livemode===false);
  const c=await db.prepare('SELECT user_id FROM stripe_customers WHERE customer_id=?').bind(invoice.customer).first();
  const invoiceSub=invoiceSubscription(invoice);
  if(c&&objectId(invoiceSub,'sub'))await syncSubscription(db,env,invoiceSub,invoice.customer,transport,id);
 }else if(event.type==='charge.refunded'&&objectId(id,'ch')||event.type==='charge.dispute.closed'&&objectId(id,'dp')){
  await voidInvoiceForPayment(db,env,event.type as 'charge.refunded'|'charge.dispute.closed',id as string,transport);
 }else if(event.type?.startsWith('customer.subscription.')&&objectId(id,'sub')){
  const sub=await stripe<Subscription>(env,'subscriptions/'+id,transport);requireMatch(sub.id===id&&sub.livemode===false);
  if(await db.prepare('SELECT user_id FROM stripe_customers WHERE customer_id=?').bind(sub.customer).first())await syncSubscription(db,env,id,sub.customer,transport);
 }
 return {received:true};
}
