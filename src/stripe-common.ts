import { BillingError } from './billing';

type StripeConfig = { STRIPE_TEST_KEY?: string; STRIPE_WEBHOOK_SECRET?: string };
export function stripeTestConfigured(env: StripeConfig): boolean { return /^sk_test_[A-Za-z0-9]+$/.test(env.STRIPE_TEST_KEY ?? '') && /^whsec_[A-Za-z0-9]+$/.test(env.STRIPE_WEBHOOK_SECRET ?? ''); }
export async function boundedText(source: Request | Response, limit: number) {
 const reader = source.body?.getReader(); if (!reader) throw new BillingError(400,'A request body is required');
 const chunks: Uint8Array[] = []; let length = 0;
 while (true) { const {done,value} = await reader.read(); if(done) break; length += value.length; if(length>limit){await reader.cancel();throw new BillingError(413,'Payment payload is too large');}chunks.push(value); }
 const bytes = new Uint8Array(length); let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}return new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes);
}
export async function readStripeEvent(request: Request, env: StripeConfig) {
 if (!stripeTestConfigured(env)) throw new BillingError(503, 'Stripe sandbox is not configured');
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
