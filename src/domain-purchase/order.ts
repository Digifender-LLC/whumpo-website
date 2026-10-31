/** WH-034 / WH-193 domain purchase order state machine (contract version 1, docs/domain-purchases.md).
 * Each step takes plain records (the order, its quote/review, server-resolved owner and project) and returns the next
 * order plus the funding-hold effect and any registration record, without storing anything. The caller persists the
 * result; the WH-194 storage slice must repeat each predicate in its committing statement. The only effectful
 * dependency is the registrar adapter, and only dispatchOrder calls register, once, after the caller commits the claim. */
import {jsonDigest,plain} from '../project-specification/v2/json';
import {check,consentText,consentTextDigest,contractVersion,domainPurchaseBounds,pricesUnchanged,quoteDigest,validateConsent} from './quote';
import type {Actor,DomainPurchaseQuote,DomainPurchaseReview,OwnerFunding,ProjectAuthority,PurchasePolicy} from './quote';
import type {RegistrarAdapter} from './registrar';

export const orderStates=Object.freeze(['quoted','consented','reserved','dispatching','registered','failed','unknown-outcome','unresolved','cancelled','expired'] as const);
export type OrderState=typeof orderStates[number];
/** Allowed order transitions. Nothing returns to reserved/dispatching after a registrar call may have happened. */
export const transitions:Readonly<Record<OrderState,readonly OrderState[]>>=Object.freeze({
 quoted:['consented','expired','cancelled'],
 consented:['reserved','expired','cancelled'],
 reserved:['dispatching','expired','cancelled'],
 dispatching:['registered','failed','unknown-outcome'],
 'unknown-outcome':['registered','failed','unresolved'],
 unresolved:['registered','failed'],
 registered:[],failed:[],cancelled:[],expired:[],
});
export const holdStates=Object.freeze(['held','captured','released'] as const);
/** States in which a registrar purchase call may already have happened. */
const inFlight:readonly OrderState[]=['dispatching','unknown-outcome','unresolved'];
const settled:readonly OrderState[]=['failed','cancelled','expired'];

export type Order={
 contractVersion:1;orderId:string;idempotencyKey:string;reviewId:string;quoteId:string;quoteDigest:string;ownerId:string;projectId:string;hostname:string;
 state:OrderState;history:string[];attempts:number;attempt:{attemptId:string;startedAt:number}|null;reconcileReads:number;uncertainAt:number|null;consentedAt:number;
};
export type Hold={orderId:string;sourceId:string;amountCents:number;state:typeof holdStates[number]};
export type HoldEffect={kind:'place';hold:Hold}|{kind:'capture'}|{kind:'release'};
export type Registration={hostname:string;ownerId:string;projectId:string;orderId:string;createdAt:number;expiresAt:number|null;autoRenew:boolean;renewalOptIn:{reviewId:string;renewalTotalCents:number}|null;chargeMismatch:boolean|null};
export type OrderStep={order:Order;hold:HoldEffect|null;registration:Registration|null;replayed?:true};

const step=(order:Order,hold:'capture'|'release'|null=null,registration:Registration|null=null):OrderStep=>({order,hold:hold?{kind:hold}:null,registration});
function moved(order:Order,to:OrderState,reason?:string):Order {
 check(transitions[order.state].includes(to),'INVALID_TRANSITION',`${order.state}->${to}`);
 return {...order,state:to,history:[...order.history,reason?`${to}:${reason}`:to]};
}
/** Holds are captured only on registered and released only from failed, cancelled or expired; anything else is a no-op. */
export function settleHold(hold:Hold|undefined,kind:'capture'|'release'):Hold|undefined {
 if(!hold||hold.state!=='held')return hold;
 return {...hold,state:kind==='capture'?'captured':'released'};
}
/** New registrations never auto-renew; turning it on is a separate exact review (renewal.ts). */
function newRegistration(order:Order,createdAt:number,expiresAt:number|null,chargeMismatch:boolean|null):Registration {
 return {hostname:order.hostname,ownerId:order.ownerId,projectId:order.projectId,orderId:order.orderId,createdAt,expiresAt,autoRenew:false,renewalOptIn:null,chargeMismatch};
}
/** One order per exact review: SHA-256 over {ownerId, projectId, hostname, reviewId, quoteDigest}. */
export const orderIdempotencyKey=(review:DomainPurchaseReview)=>jsonDigest({ownerId:review.ownerId,projectId:review.projectId,hostname:review.hostname,reviewId:review.reviewId,quoteDigest:review.quoteDigest});

export type ConsentInput={
 actor:Actor;submission:unknown;review:DomainPurchaseReview|null|undefined;quote:DomainPurchaseQuote|null|undefined;
 project:ProjectAuthority|null|undefined;owner:OwnerFunding|null|undefined;
 /** Orders sharing this review's idempotency key or hostname, across every tenant. */
 related:readonly Order[];registrar:RegistrarAdapter;policy:PurchasePolicy;orderId:string;now:number;
};
/** Exact human consent. Replays the existing order for the same idempotency key; otherwise creates one consented order. */
export async function consentToOrder({actor,submission,review,quote,project,owner,related,registrar,policy,orderId,now}:ConsentInput):Promise<OrderStep> {
 const accepted=validateConsent(submission);
 check(plain(actor)&&actor.kind!=='model','MODEL_CANNOT_CONSENT','actor');
 check(actor.kind==='owner'&&typeof actor.ownerId==='string','HUMAN_REVIEW_REQUIRED','actor');
 check(review&&quote&&review.reviewId===accepted.reviewId&&quote.quoteId===review.quoteId,'UNKNOWN_REVIEW',accepted.reviewId);
 check(review.ownerId===actor.ownerId,'FOREIGN_OWNER',accepted.reviewId);
 const idempotencyKey=await orderIdempotencyKey(review);
 const existing=related.find(o=>o.idempotencyKey===idempotencyKey);
 if(existing)return {...step(existing),replayed:true};
 check(project&&project.projectId===review.projectId&&project.ownerId===review.ownerId&&project.revision===review.projectRevision,'STALE_REVIEW',review.projectId);
 check(now<review.expiresAt&&now<quote.expiresAt,'QUOTE_EXPIRED',review.reviewId);
 check(accepted.quoteDigest===review.quoteDigest&&await quoteDigest(quote)===review.quoteDigest,'REVIEW_MISMATCH',review.reviewId);
 check(accepted.consentTextDigest===review.consentTextDigest&&await consentTextDigest(consentText(quote))===review.consentTextDigest,'CONSENT_MISMATCH',review.reviewId);
 check(owner?.paymentMethod?.id===review.fundingSourceId,'FUNDING_CHANGED',review.reviewId);
 for(const other of related)if(other.hostname===review.hostname){
  check(other.state!=='registered','ALREADY_REGISTERED',review.hostname);
  check(settled.includes(other.state),'ORDER_IN_PROGRESS',review.hostname);
 }
 check(await pricesUnchanged(quote,{owner,registrar,policy,now}),'PRICE_CHANGED',review.reviewId);
 const order:Order={contractVersion,orderId,idempotencyKey,reviewId:review.reviewId,quoteId:quote.quoteId,quoteDigest:review.quoteDigest,ownerId:review.ownerId,projectId:review.projectId,hostname:review.hostname,
  state:'quoted',history:['quoted'],attempts:0,attempt:null,reconcileReads:0,uncertainAt:null,consentedAt:now};
 return step(moved(order,'consented'));
}

/** Server step: place the funding hold for exactly the consented amount on the bound source. */
export function reserveOrder({order,quote,now}:{order:Order;quote:DomainPurchaseQuote;now:number}):OrderStep {
 if(order.state!=='consented')return step(order);
 if(now>=quote.expiresAt)return step(moved(order,'expired','quote-expired'));
 return {...step(moved(order,'reserved')),hold:{kind:'place',hold:{orderId:order.orderId,sourceId:quote.funding.sourceId,amountCents:quote.funding.customerChargeCents,state:'held'}}};
}

export type DispatchInput={
 order:Order;quote:DomainPurchaseQuote;owner:OwnerFunding|null|undefined;registrar:RegistrarAdapter;policy:PurchasePolicy;now:number;
 /** Commit the claimed `dispatching` order (compare-and-set from `reserved`). Return false when another worker won;
  * register is called only after this resolves true. */
 claim:(claimed:Order)=>Promise<boolean>|boolean;
 /** The server found the project changed since the review (revision or owner): cancel before the purchase call. */
 stale?:boolean;
};
/** At most one registrar purchase call per order, ever. A lost, malformed or pending result becomes unknown-outcome. */
export async function dispatchOrder(input:DispatchInput):Promise<OrderStep&{claimed:boolean}> {
 const {order,quote,owner,registrar,policy,now}=input;
 check(!inFlight.includes(order.state),'NO_REDISPATCH',order.state);
 if(order.state!=='reserved')return {...step(order),claimed:false};
 if(now>=quote.expiresAt)return {...step(moved(order,'expired','quote-expired'),'release'),claimed:false};
 if(input.stale)return {...step(moved(order,'cancelled','project-changed'),'release'),claimed:false};
 if(!await pricesUnchanged(quote,{owner,registrar,policy,now}))return {...step(moved(order,'cancelled','price-changed'),'release'),claimed:false};
 const attempts=order.attempts+1;
 const claimed:Order={...moved(order,'dispatching'),attempts,attempt:{attemptId:`${order.orderId}:a${attempts}`,startedAt:now}};
 if(await input.claim(claimed)!==true)return {...step(order),claimed:false};
 let result:unknown;
 try{result=await registrar.register({hostname:order.hostname,orderRef:order.orderId,acknowledgePremium:quote.premium,autoRenew:false,privacy:'redaction'});}
 catch{result={kind:'lost'};}
 return {...registerOutcome(claimed,quote,result,now),claimed:true};
}
function registerOutcome(order:Order,quote:DomainPurchaseQuote,result:unknown,now:number):OrderStep {
 if(plain(result)&&result.kind==='registered'&&result.hostname===order.hostname&&result.orderRef===order.orderId&&Number.isSafeInteger(result.expiresAt))
  return step(moved(order,'registered'),'capture',newRegistration(order,now,result.expiresAt as number,result.chargedWholesaleCents!==quote.initial.wholesaleCents));
 if(plain(result)&&result.kind==='rejected')return step(moved(order,'failed','rejected'),'release');
 return step({...moved(order,'unknown-outcome','uncertain'),uncertainAt:now});
}

/** Lease sweep: a dispatch claimed longer than the lease ago may have reached the registrar. */
export function expireDispatchLease({order,now}:{order:Order;now:number}):OrderStep {
 if(order.state!=='dispatching'||!order.attempt||now-order.attempt.startedAt<domainPurchaseBounds.leaseMs)return step(order);
 return step({...moved(order,'unknown-outcome','interrupted'),uncertainAt:now});
}

/** Sweep for orders no worker will finish: an unreserved or reserved order whose quote has expired is released so it stops blocking the name for every tenant. */
export function expireStale({order,quote,now}:{order:Order;quote:DomainPurchaseQuote;now:number}):OrderStep {
 if(!['consented','reserved'].includes(order.state)||now<quote.expiresAt)return step(order);
 return step(moved(order,'expired','quote-expired'),order.state==='reserved'?'release':null);
}

/** Bounded read-only reconciliation. Never calls register; "not found" or "in progress" is not proof either way. */
export async function reconcileOrder({order,registrar,now}:{order:Order;registrar:RegistrarAdapter;now:number}):Promise<OrderStep> {
 if(order.state!=='unknown-outcome')return step(order);
 const since=order.uncertainAt??now;
 if(order.reconcileReads>=domainPurchaseBounds.reconcileReads||now-since>=domainPurchaseBounds.reconcileWindowMs)return step(moved(order,'unresolved','reconcile-bound'));
 const read:Order={...order,reconcileReads:order.reconcileReads+1};
 const found=await registrar.lookup(order.hostname);
 const ours=plain(found)&&found.status!=='not-found'&&found.orderRef===order.orderId;
 if(ours&&found.status==='registered'&&Number.isSafeInteger(found.expiresAt))return step(moved(read,'registered','reconciled'),'capture',newRegistration(order,now,found.expiresAt,null));
 if(ours&&found.status==='failed')return step(moved(read,'failed','reconciled-failed'),'release');
 // Only a registration that names a different, known order is proof it is not ours. A null reference or a malformed answer proves nothing (it may be ours with a lost reference), so it ends in the bound, never in a release.
 if(!ours&&plain(found)&&found.status==='registered'&&typeof found.orderRef==='string'&&found.orderRef.length>0&&found.orderRef!==order.orderId)return step(moved(read,'failed','registered-elsewhere'),'release');
 if(read.reconcileReads>=domainPurchaseBounds.reconcileReads)return step(moved(read,'unresolved','reconcile-bound'));
 return step(read);
}

export type RegistrarEvent={eventId:string;orderId:string;attemptId:string;type:string;authenticated:boolean;expiresAt?:number};
export type EventOutcome={applied:true}|{applied:false;duplicate:true}|{applied:false;stale:true}|{applied:false;ignored:true};
/** Authenticated registrar result for one attempt. The caller records `eventId` as seen whenever this returns.
 * Duplicate, stale and out-of-order events are ignored, so a late failure never undoes a registration. */
export function applyRegistrarEvent({order,event,seen,now}:{order:Order|null|undefined;event:RegistrarEvent;seen:boolean;now:number}):{outcome:EventOutcome;step:OrderStep|null} {
 check(plain(event)&&event.authenticated===true,'EVENT_NOT_AUTHENTICATED','event');
 check(typeof event.eventId==='string'&&event.eventId.length>0&&event.eventId.length<=200,'INVALID_EVENT','event.eventId');
 if(seen)return {outcome:{applied:false,duplicate:true},step:null};
 if(!order||!order.attempt||order.orderId!==event.orderId||order.attempt.attemptId!==event.attemptId)return {outcome:{applied:false,stale:true},step:null};
 const to=event.type==='registered'?'registered':event.type==='failed'?'failed':null;
 if(!to||!transitions[order.state].includes(to))return {outcome:{applied:false,ignored:true},step:null};
 if(to==='failed')return {outcome:{applied:true},step:step(moved(order,'failed','event'),'release')};
 const expiresAt=Number.isSafeInteger(event.expiresAt)?event.expiresAt as number:null;
 return {outcome:{applied:true},step:step(moved(order,'registered','event'),'capture',newRegistration(order,now,expiresAt,null))};
}

/** Owner cancellation works only before the purchase call. */
export function cancelOrder({actor,order}:{actor:Actor;order:Order|null|undefined}):OrderStep {
 check(order&&plain(actor)&&actor.kind==='owner'&&actor.ownerId===order.ownerId,'FOREIGN_OWNER',order?.orderId??'order');
 check(['quoted','consented','reserved'].includes(order.state),'CANNOT_RECALL',order.state);
 return step(moved(order,'cancelled','owner-cancelled'),'release');
}
