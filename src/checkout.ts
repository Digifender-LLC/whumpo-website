import { BillingError, ensureBilling } from './billing';
import { creditPack } from './plans';

type StripeConfig = { STRIPE_TEST_KEY?: string; STRIPE_WEBHOOK_SECRET?: string };
type Order = { id: string; user_id: string; amount_cents: number; units: number; currency: string; status: string; session_id: string | null; created_at: number };
type StripeSession = { id: string; livemode: boolean; mode: string; status: string; payment_status: string; amount_total: number; currency: string; client_reference_id: string; metadata: { order_id?: string }; url?: string };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function checkoutEnabled(env: StripeConfig): boolean { return /^sk_test_[A-Za-z0-9]+$/.test(env.STRIPE_TEST_KEY ?? '') && /^whsec_[A-Za-z0-9]+$/.test(env.STRIPE_WEBHOOK_SECRET ?? ''); }
function config(env: StripeConfig) { if (!checkoutEnabled(env)) throw new BillingError(503, 'Stripe test checkout is not configured'); return env.STRIPE_TEST_KEY!; }
export async function boundedText(source: Request | Response, limit: number) {
 const reader = source.body?.getReader(); if (!reader) throw new BillingError(400,'A request body is required');
 const chunks: Uint8Array[] = []; let length = 0;
 while (true) { const {done,value} = await reader.read(); if(done) break; length += value.length; if(length>limit){await reader.cancel();throw new BillingError(413,'Payment payload is too large');}chunks.push(value); }
 const bytes = new Uint8Array(length); let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes);
}
async function stripe(env: StripeConfig, path: string, form?: URLSearchParams, idempotency?: string, transport: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<StripeSession> {
 const key = config(env);
 try {
  const response = await transport('https://api.stripe.com/v1/'+path,{method:form?'POST':'GET',headers:{authorization:'Bearer '+key,'Stripe-Version':'2025-02-24.acacia',...(form?{'content-type':'application/x-www-form-urlencoded','Idempotency-Key':idempotency!}:{})},body:form,redirect:'manual',signal:AbortSignal.timeout(15000)});
  if(!response.ok){await response.body?.cancel();throw new Error('stripe_failure');}
  const data = JSON.parse(await boundedText(response,131072)) as StripeSession;
  if(data.livemode !== false || !/^cs_test_[A-Za-z0-9]+$/.test(data.id))throw new Error('not_test');
  return data;
 } catch {throw new BillingError(502,'Stripe test checkout could not be verified. Retry the same request.');}
}
function checkSession(session: StripeSession, order: Order) {
 if(session.metadata?.order_id !== order.id || session.client_reference_id !== order.id || session.mode !== 'payment' || session.amount_total !== order.amount_cents || session.currency !== order.currency || (order.session_id !== null && order.session_id !== session.id))throw new BillingError(409,'Checkout details do not match the saved order');
}
export async function createCheckout(db: D1Database, env: StripeConfig, userId: string, id: unknown, product: unknown, transport?: typeof fetch) {
 config(env);
 if(typeof id !== 'string' || !uuid.test(id) || product !== 'credits-100')throw new BillingError(400,'Choose the available test credit pack');
 await ensureBilling(db,userId);
 try {await db.prepare("INSERT INTO checkout_orders(id,user_id,product,amount_cents,units,currency,created_at) VALUES(?,?,'credits-100',?,?,'usd',?) ON CONFLICT(id) DO NOTHING").bind(id,userId,creditPack.cents,creditPack.credits,Math.floor(Date.now()/1000)).run();}
 catch(cause){if(String(cause).includes('checkout_'))throw new BillingError(429,'Test checkout limit reached (5 per day, 100 per account)');throw cause;}
 const order = await db.prepare('SELECT * FROM checkout_orders WHERE id=? AND user_id=?').bind(id,userId).first<Order>();
 if(!order)throw new BillingError(409,'Checkout request ID is already used');
 if(order.status==='fulfilled')return {fulfilled:true};
 // Never recreate an old ambiguous order after Stripe expires its idempotency record.
 if(order.created_at+3600 <= Date.now()/1000)throw new BillingError(409,'This checkout has expired. Start a new test purchase.');
 const form = new URLSearchParams({mode:'payment','payment_method_types[0]':'card',client_reference_id:id,'metadata[order_id]':id,'line_items[0][price_data][currency]':'usd','line_items[0][price_data][unit_amount]':String(order.amount_cents),'line_items[0][price_data][product_data][name]':'Whumpo — 100 test build credits','line_items[0][quantity]':'1',success_url:'https://whumpo.com/workspace/?checkout=returned',cancel_url:'https://whumpo.com/workspace/?checkout=canceled',expires_at:String(order.created_at+3600)});
 const session = order.session_id ? await stripe(env,'checkout/sessions/'+order.session_id,undefined,undefined,transport) : await stripe(env,'checkout/sessions',form,'whumpo-test-'+id,transport);
 checkSession(session,order);
 await db.prepare('UPDATE checkout_orders SET session_id=? WHERE id=? AND (session_id IS NULL OR session_id=?)').bind(session.id,id,session.id).run();
 if(session.status !== 'open' || typeof session.url !== 'string')throw new BillingError(409,'Checkout is finished or expired. Refresh usage to see confirmed credits.');
 const url = new URL(session.url);if(url.protocol!=='https:' || url.hostname!=='checkout.stripe.com' || url.username || url.password || url.port)throw new BillingError(502,'Unexpected checkout destination');
 return {url:session.url,testMode:true};
}
export async function readStripeEvent(request: Request, env: StripeConfig) {
 config(env);
 const signature = request.headers.get('stripe-signature') ?? '';
 if(signature.length>4096)throw new BillingError(400,'Invalid webhook signature');
 const parts=signature.split(',').map(x=>x.trim()); const timestamps=parts.filter(x=>x.startsWith('t='));
 const timestamp=timestamps.length===1?timestamps[0].slice(2):'';
 if(!/^\d+$/.test(timestamp) || Math.abs(Date.now()/1000-Number(timestamp))>300)throw new BillingError(400,'Expired webhook signature');
 const raw=await boundedText(request,131072);
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.STRIPE_WEBHOOK_SECRET!),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 let verified=false;for(const part of parts){if(!/^v1=[a-f0-9]{64}$/.test(part))continue;const bytes=Uint8Array.from(part.slice(3).match(/../g)!,x=>parseInt(x,16));if(await crypto.subtle.verify('HMAC',key,bytes,new TextEncoder().encode(timestamp+'.'+raw)))verified=true;}
 if(!verified)throw new BillingError(400,'Invalid webhook signature');
 let event: {livemode?:boolean;type?:string;data?:{object?:{id?:string;customer?:string}}};
 try{event=JSON.parse(raw);}catch{throw new BillingError(400,'Invalid webhook payload');}
 if(!event || event.livemode!==false)throw new BillingError(400,'Only Stripe test events are accepted');
 return event;
}
export async function stripeWebhook(request: Request, db: D1Database, env: StripeConfig, transport?: typeof fetch) {
 const event=await readStripeEvent(request,env);
 if(!['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type ?? ''))return {received:true};
 const sessionId=event.data?.object?.id;
 if(typeof sessionId!=='string' || !/^cs_test_[A-Za-z0-9]+$/.test(sessionId))throw new BillingError(400,'Invalid test checkout session');
 // Retrieve authoritative state instead of trusting redirect parameters or event ordering.
 const session=await stripe(env,'checkout/sessions/'+sessionId,undefined,undefined,transport);
 if(session.id!==sessionId)throw new BillingError(409,'Checkout session mismatch');
 const orderId=session.metadata?.order_id;
 if(typeof orderId!=='string' || !uuid.test(orderId))return {received:true}; // Other applications on this Stripe account.
 const order=await db.prepare('SELECT * FROM checkout_orders WHERE id=?').bind(orderId).first<Order>();
 if(!order)return {received:true}; // Unrelated order or a deleted Whumpo account.
 checkSession(session,order);
 if(session.status!=='complete' || session.payment_status!=='paid')return {received:true};
 const now=new Date().toISOString();
 await db.batch([
  db.prepare("INSERT INTO credit_grants(id,user_id,units,reason,created_at) SELECT ?,user_id,units,'Stripe test credit purchase',? FROM checkout_orders WHERE id=? AND (session_id IS NULL OR session_id=?) ON CONFLICT(id) DO NOTHING").bind('stripe:'+session.id,now,order.id,session.id),
  db.prepare("UPDATE checkout_orders SET session_id=?,status='fulfilled',fulfilled_at=COALESCE(fulfilled_at,?) WHERE id=? AND EXISTS(SELECT 1 FROM credit_grants WHERE id=? AND user_id=checkout_orders.user_id AND units=checkout_orders.units AND reason='Stripe test credit purchase')").bind(session.id,Math.floor(Date.now()/1000),order.id,'stripe:'+session.id)
 ]);
 return {received:true};
}
