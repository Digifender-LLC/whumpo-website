import {BillingError} from './billing';
import {boundedText,stripeTestConfigured,readStripeEvent} from './stripe-common';
import {plans} from './plans';
import {hashToken} from './security';

export const stripeVersion='2025-02-24.acacia';
export const stripeApp='whumpo-sandbox-v1';
type Config={STRIPE_TEST_KEY?:string;STRIPE_WEBHOOK_SECRET?:string;STRIPE_SANDBOX_CATALOG?:string};
type Catalog={version:1;prices:Record<string,string>;portal:string};
type Order={id:string;user_id:string;plan_id:string;interval:'month'|'year';price_id:string;amount_cents:number;created_at:number;state:string;session_id:string|null;subscription_id:string|null};
type Customer={user_id:string;customer_id:string|null;created_at:number};
type Metadata={app?:string;owner?:string;order?:string};
type Price={id:string;livemode:boolean;currency:string;unit_amount:number;recurring?:{interval:string;interval_count:number}};
type Session={id:string;livemode:boolean;customer:string;mode:string;status:string;subscription:string|null;client_reference_id:string;metadata:Metadata;url?:string;currency:string;amount_total:number;line_items:{has_more:boolean;data:{quantity:number;price:Price}[]}};
type Subscription={id:string;livemode:boolean;customer:string;metadata:Metadata;status:string;cancel_at_period_end:boolean;current_period_end:number;latest_invoice:string|null;items:{has_more:boolean;data:{quantity:number;price:Price}[]}};
type Invoice={id:string;livemode:boolean;customer:string;subscription:string;status:string;paid:boolean;paid_out_of_band:boolean;currency:string;amount_paid:number;total:number;hosted_invoice_url:string|null;created:number;billing_reason:string;lines:{has_more:boolean;data:{type:string;subscription:string;quantity:number;proration:boolean;price:Price;amount:number;period:{start:number;end:number}}[]}};
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const now=()=>Math.floor(Date.now()/1000);
const objectId=(id:unknown,prefix:string):id is string=>typeof id==='string'&&new RegExp('^'+prefix+'_[A-Za-z0-9]+$').test(id);
function requireMatch(value:unknown){if(!value)throw new BillingError(409,'Stripe sandbox details do not match the saved billing record.');}
function catalog(env:Config):Catalog{
 try{
  if(!stripeTestConfigured(env))throw Error();
  const c=JSON.parse(env.STRIPE_SANDBOX_CATALOG??'') as Catalog;
  if(c.version!==1||!objectId(c.portal,'bpc'))throw Error();
  for(const p of plans.filter(p=>p.monthlyCents))for(const interval of ['month','year'])if(!objectId(c.prices?.[p.id+':'+interval],'price'))throw Error();
  return c;
 }catch{throw new BillingError(503,'Sandbox subscriptions are not configured. Explore is still available.');}
}
export function subscriptionsEnabled(env:Config){try{catalog(env);return true;}catch{return false;}}
async function stripe<T>(env:Config,path:string,transport:typeof fetch,form?:URLSearchParams,key?:string):Promise<T>{
 catalog(env);
 try{
  const response=await transport('https://api.stripe.com/v1/'+path,{method:form?'POST':'GET',headers:{authorization:'Bearer '+env.STRIPE_TEST_KEY,'Stripe-Version':stripeVersion,...(form?{'content-type':'application/x-www-form-urlencoded','Idempotency-Key':key!}:{})},body:form,redirect:'manual',signal:AbortSignal.timeout(15000)});
  if(!response.ok){await response.body?.cancel();throw Error();}
  return JSON.parse(await boundedText(response,262144)) as T;
 }catch{throw new BillingError(502,'Stripe sandbox could not be reached. Refresh or retry the same checkout; your billing record is saved.');}
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
async function recordInvoice(db:D1Database,env:Config,id:string,sub:Subscription,order:Order,transport:typeof fetch){
 requireMatch(objectId(id,'in'));
 const invoice=await stripe<Invoice>(env,'invoices/'+id,transport);
 requireMatch(invoice.id===id&&invoice.livemode===false&&invoice.customer===sub.customer&&invoice.subscription===sub.id);
 if(invoice.status!=='paid'||!invoice.paid)return invoice.status;
 requireMatch(invoice.paid_out_of_band===false&&invoice.currency==='usd'&&invoice.amount_paid===order.amount_cents&&invoice.total===order.amount_cents&&['subscription_create','subscription_cycle'].includes(invoice.billing_reason));
 requireMatch(invoice.lines?.has_more===false&&invoice.lines.data.length===1);
 const line=invoice.lines.data[0];checkPrice(line.price,order);
 requireMatch(line.type==='subscription'&&line.subscription===sub.id&&line.quantity===1&&line.proration===false&&line.amount===order.amount_cents);
 const {start,end}=line.period;
 requireMatch(Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&start>0&&end>start&&end-start<=(order.interval==='year'?367:32)*86400);
 const url=invoice.hosted_invoice_url?hostedURL(invoice.hosted_invoice_url,'invoice.stripe.com'):null;
 await db.prepare('INSERT INTO stripe_paid_invoices(id,user_id,subscription_id,plan_id,amount_cents,interval,starts_at,ends_at,hosted_url,created_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,order.user_id,sub.id,order.plan_id,order.amount_cents,order.interval,start,end,url,invoice.created).run();
 const saved=await db.prepare('SELECT * FROM stripe_paid_invoices WHERE id=?').bind(id).first<{user_id:string;subscription_id:string;plan_id:string;amount_cents:number;starts_at:number;ends_at:number}>();
 requireMatch(saved?.user_id===order.user_id&&saved.subscription_id===sub.id&&saved.plan_id===order.plan_id&&saved.amount_cents===order.amount_cents&&saved.starts_at===start&&saved.ends_at===end);
 return invoice.status;
}
async function syncSubscription(db:D1Database,env:Config,id:string,customer:string,transport:typeof fetch,invoiceId?:string){
 requireMatch(objectId(id,'sub'));
 const sub=await stripe<Subscription>(env,'subscriptions/'+id,transport);
 requireMatch(sub.id===id&&sub.livemode===false&&sub.customer===customer);
 if(sub.metadata?.app!==stripeApp||!sub.metadata.order)return;
 const order=await db.prepare('SELECT o.* FROM stripe_subscription_orders o JOIN stripe_customers c ON c.user_id=o.user_id WHERE o.id=? AND c.customer_id=?').bind(sub.metadata.order,customer).first<Order>();
 if(!order)return;
 requireMatch(order.state!=='expired'&&(!order.subscription_id||order.subscription_id===id));
 requireMatch(sub.items?.has_more===false&&sub.items.data.length===1&&sub.items.data[0].quantity===1);checkPrice(sub.items.data[0].price,order);
 requireMatch(Number.isSafeInteger(sub.current_period_end)&&typeof sub.cancel_at_period_end==='boolean');
 await db.batch([
  db.prepare("UPDATE stripe_subscription_orders SET subscription_id=?,state='complete' WHERE id=? AND state='pending'").bind(id,order.id),
  db.prepare('INSERT INTO stripe_subscriptions(id,order_id,user_id,status,cancel_at_period_end,period_end,latest_invoice_id,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,cancel_at_period_end=excluded.cancel_at_period_end,period_end=excluded.period_end,latest_invoice_id=excluded.latest_invoice_id,updated_at=excluded.updated_at').bind(id,order.id,order.user_id,sub.status,sub.cancel_at_period_end?1:0,sub.current_period_end,sub.latest_invoice,now())
 ]);
 if(sub.latest_invoice){const status=await recordInvoice(db,env,sub.latest_invoice,sub,order,transport);await db.prepare('UPDATE stripe_subscriptions SET payment_status=? WHERE id=? AND latest_invoice_id=?').bind(status,id,sub.latest_invoice).run();}
 if(invoiceId&&invoiceId!==sub.latest_invoice)await recordInvoice(db,env,invoiceId,sub,order,transport);
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
 return {enabled:subscriptionsEnabled(env),testMode:true,subscription,invoices,pending,portalAvailable:!!(await db.prepare('SELECT customer_id FROM stripe_customers WHERE user_id=? AND customer_id IS NOT NULL').bind(user).first())};
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
  const form=new URLSearchParams({mode:'subscription',customer:customerID,'payment_method_types[0]':'card','line_items[0][price]':order!.price_id,'line_items[0][quantity]':'1',client_reference_id:id,'metadata[app]':stripeApp,'metadata[order]':id,'subscription_data[metadata][app]':stripeApp,'subscription_data[metadata][order]':id,success_url:'https://whumpo.com/workspace/?checkout=returned',cancel_url:'https://whumpo.com/workspace/?checkout=canceled',expires_at:String(order!.created_at+3600),'expand[0]':'line_items.data.price'});
  const s=await readSession(db,env,order!,customerID,transport,order!.session_id?undefined:await stripe<Session>(env,'checkout/sessions',transport,form,'whumpo-subscription-'+id));
  if(s.status==='complete')return {complete:true,testMode:true};
  if(s.status!=='open')throw new BillingError(409,'This checkout expired. Refresh Billing to choose again.');
  return {url:hostedURL(s.url,'checkout.stripe.com'),testMode:true};
 });
}
export async function billingPortal(db:D1Database,env:Config,user:string,transport:typeof fetch=fetch){
 const c=catalog(env),customer=await db.prepare('SELECT customer_id FROM stripe_customers WHERE user_id=?').bind(user).first<Customer>();
 if(!customer?.customer_id)throw new BillingError(409,'Start a sandbox checkout first.');
 const portal=await stripe<{id:string;livemode:boolean;customer:string;configuration:string;url:string}>(env,'billing_portal/sessions',transport,new URLSearchParams({customer:customer.customer_id,configuration:c.portal,return_url:'https://whumpo.com/workspace/?checkout=returned'}),'whumpo-portal-'+crypto.randomUUID());
 requireMatch(portal.livemode===false&&portal.customer===customer.customer_id&&portal.configuration===c.portal);
 return {url:hostedURL(portal.url,'billing.stripe.com'),testMode:true};
}
export async function stripeBillingWebhook(request:Request,db:D1Database,env:Config,transport:typeof fetch=fetch){
 const event=await readStripeEvent(request,env),id=event.data?.object?.id;
 catalog(env);
 if(event.type?.startsWith('checkout.session.')){
  requireMatch(objectId(id,'cs_test'));
  const s=await stripe<Session>(env,'checkout/sessions/'+id+'?expand[]=line_items.data.price',transport);
  requireMatch(s.id===id&&s.livemode===false);
  if(s.mode!=='subscription'||s.metadata?.app!==stripeApp)return {received:true};
  const order=await db.prepare('SELECT o.* FROM stripe_subscription_orders o JOIN stripe_customers c ON c.user_id=o.user_id WHERE o.id=? AND c.customer_id=?').bind(s.metadata.order??'',s.customer).first<Order>();
  if(order)await readSession(db,env,order,s.customer,transport,s);
 }else if(event.type?.startsWith('invoice.')&&objectId(id,'in')){
  const invoice=await stripe<Invoice>(env,'invoices/'+id,transport);requireMatch(invoice.id===id&&invoice.livemode===false);
  const c=await db.prepare('SELECT user_id FROM stripe_customers WHERE customer_id=?').bind(invoice.customer).first();
  if(c&&objectId(invoice.subscription,'sub'))await syncSubscription(db,env,invoice.subscription,invoice.customer,transport,id);
 }else if(event.type?.startsWith('customer.subscription.')&&objectId(id,'sub')){
  const sub=await stripe<Subscription>(env,'subscriptions/'+id,transport);requireMatch(sub.id===id&&sub.livemode===false);
  if(await db.prepare('SELECT user_id FROM stripe_customers WHERE customer_id=?').bind(sub.customer).first())await syncSubscription(db,env,id,sub.customer,transport);
 }
 return {received:true};
}
