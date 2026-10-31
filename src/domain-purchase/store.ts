/** WH-194 domain purchase storage over src/domain-purchase/schema.sql. D1 cannot read and then branch inside one commit, so every
 * transition here is ONE guarded statement (or one batch): its WHERE clause is the version compare-and-set, `RETURNING` or `changes`
 * says whether it won, and the schema's triggers re-check the contract and settle the funding hold and the registration in the same
 * statement. The pure module (order.ts) still decides; nothing here calls a registrar except `dispatch`, which calls register only after
 * the claim committed. A caller that loses a race gets `false`/`null`, never a second purchase. No auth code is read or stored here. */
import {canonicalJSON} from '../project-specification/v2/json';
import {applyRegistrarEvent,cancelOrder,consentToOrder,dispatchOrder,expireDispatchLease,expireStale,orderIdempotencyKey,reconcileOrder,reserveOrder} from './order';
import type {ConsentInput,Order,OrderStep,RegistrarEvent} from './order';
import {DomainPurchaseError,check,consentText,domainPurchaseBounds,registrableName} from './quote';
import type {Actor,DomainPurchaseQuote,DomainPurchaseReview,OwnerFunding,ProjectAuthority,PurchasePolicy} from './quote';
import type {RegistrarAdapter} from './registrar';

type Db=Pick<D1Database,'prepare'|'batch'>;
/** An order as stored: the contract's order plus the compare-and-set counter every transition bumps. */
export type StoredOrder=Order&{version:number};
export type RegistrantContact={name:string;organization?:string;street:string;city:string;region?:string;postalCode?:string;country:string;phone:string;email:string};
/** Terminal drafts (quotes and reviews that never became an order) and their registrant contact are removed this long after expiry. Interim default pending an owner decision. */
export const domainDraftRetentionMs=24*3600*1000;

type OrderRow={order_id:string;idempotency_key:string;review_id:string;quote_id:string;quote_digest:string;owner_user_id:string;project_id:string;hostname:string;state:Order['state'];
 history_json:string;attempts:number;attempt_id:string|null;attempt_started_at:number|null;reconcile_reads:number;uncertain_at:number|null;consented_at:number;version:number};
const orderColumns='order_id,idempotency_key,review_id,quote_id,quote_digest,owner_user_id,project_id,hostname,state,history_json,attempts,attempt_id,attempt_started_at,reconcile_reads,uncertain_at,consented_at,version';
const toOrder=(r:OrderRow):StoredOrder=>({contractVersion:1,orderId:r.order_id,idempotencyKey:r.idempotency_key,reviewId:r.review_id,quoteId:r.quote_id,quoteDigest:r.quote_digest,ownerId:r.owner_user_id,
 projectId:r.project_id,hostname:r.hostname,state:r.state,history:JSON.parse(r.history_json),attempts:r.attempts,attempt:r.attempt_id?{attemptId:r.attempt_id,startedAt:r.attempt_started_at as number}:null,
 reconcileReads:r.reconcile_reads,uncertainAt:r.uncertain_at,consentedAt:r.consented_at,version:r.version});

/** Persist the quote and its exact review in one batch. A repeated prepare with the same ids is an error, never an overwrite. */
export async function saveReview(db:Db,quote:DomainPurchaseQuote,review:DomainPurchaseReview,now:number){
 registrableName(quote.hostname);registrableName(review.hostname);
 await db.batch([
  db.prepare('INSERT INTO domain_quotes(quote_id,owner_user_id,project_id,hostname,quote_json,quote_digest,quoted_at,expires_at) VALUES(?,?,?,?,?,?,?,?)')
   .bind(quote.quoteId,quote.ownerId,quote.projectId,quote.hostname,canonicalJSON(quote),review.quoteDigest,quote.quotedAt,quote.expiresAt),
  db.prepare('INSERT INTO domain_reviews(review_id,quote_id,quote_digest,owner_user_id,project_id,project_revision,hostname,funding_source_id,consent_text_digest,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
   .bind(review.reviewId,review.quoteId,review.quoteDigest,review.ownerId,review.projectId,review.projectRevision,review.hostname,review.fundingSourceId,review.consentTextDigest,now,review.expiresAt)]);
}
export async function loadReview(db:Db,ownerId:string,reviewId:string){
 const r=await db.prepare('SELECT r.review_id,r.quote_id,r.quote_digest,r.owner_user_id,r.project_id,r.project_revision,r.hostname,r.funding_source_id,r.consent_text_digest,r.expires_at,q.quote_json FROM domain_reviews r JOIN domain_quotes q ON q.quote_id=r.quote_id WHERE r.review_id=?1 AND r.owner_user_id=?2')
  .bind(reviewId,ownerId).first<Record<string,any>>();
 if(!r)return null;
 const review:DomainPurchaseReview={contractVersion:1,reviewId:r.review_id,quoteId:r.quote_id,quoteDigest:r.quote_digest,ownerId:r.owner_user_id,projectId:r.project_id,projectRevision:r.project_revision,
  hostname:r.hostname,fundingSourceId:r.funding_source_id,consentTextDigest:r.consent_text_digest,expiresAt:r.expires_at};
 return {review,quote:JSON.parse(r.quote_json) as DomainPurchaseQuote};
}
/** The owner's own registrant contact for one unexpired review, before consent. Required ICANN elements only; the registrar sees it, no model or log does. */
export async function saveRegistrantContact(db:Db,actor:Actor,reviewId:string,contact:RegistrantContact,now:number){
 check(actor.kind==='owner'&&typeof actor.ownerId==='string','HUMAN_REVIEW_REQUIRED','actor');
 const allowed=['name','organization','street','city','region','postalCode','country','phone','email'];
 check(contact&&typeof contact==='object'&&Object.keys(contact).every(k=>allowed.includes(k)),'UNKNOWN_FIELD','contact');
 try{
  await db.prepare('INSERT INTO domain_registrant_contacts(review_id,owner_user_id,contact_name,organization,street,city,region,postal_code,country,phone,email,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
   .bind(reviewId,actor.ownerId,contact.name,contact.organization??null,contact.street,contact.city,contact.region??null,contact.postalCode??null,contact.country,contact.phone,contact.email,now).run();
 }catch(error){throw new DomainPurchaseError('INVALID_CONTACT','contact');}
}

/** Orders of any tenant that share the idempotency key or the name: the module's `related` input. */
export async function relatedOrders(db:Db,idempotencyKey:string,hostname:string):Promise<StoredOrder[]>{
 return (await db.prepare(`SELECT ${orderColumns} FROM domain_orders WHERE idempotency_key=?1 OR (hostname=?2 AND released=0)`).bind(idempotencyKey,hostname).all<OrderRow>()).results.map(toOrder);
}
export async function loadOrder(db:Db,ownerId:string,orderId:string){
 const r=await db.prepare(`SELECT ${orderColumns} FROM domain_orders WHERE order_id=?1 AND owner_user_id=?2`).bind(orderId,ownerId).first<OrderRow>();
 return r?toOrder(r):null;
}
async function loadQuote(db:Db,quoteId:string){
 const r=await db.prepare('SELECT quote_json FROM domain_quotes WHERE quote_id=?').bind(quoteId).first<{quote_json:string}>();
 return r?JSON.parse(r.quote_json) as DomainPurchaseQuote:null;
}
/** One guarded transition: wins only while the stored version is still the one the step started from. The triggers settle the hold and write the registration. */
async function commit(db:Db,step:OrderStep,now:number){
 const o=step.order as StoredOrder,reg=step.registration;
 const r=await db.prepare(`UPDATE domain_orders SET state=?1,history_json=?2,attempts=?3,attempt_id=?4,attempt_started_at=?5,reconcile_reads=?6,uncertain_at=?7,registration_expires_at=?8,charge_mismatch=?9,updated_at=max(?10,updated_at),version=version+1
  WHERE order_id=?11 AND version=?12 RETURNING version`)
  .bind(o.state,JSON.stringify(o.history),o.attempts,o.attempt?.attemptId??null,o.attempt?.startedAt??null,o.reconcileReads,o.uncertainAt,reg?.expiresAt??null,reg?(reg.chargeMismatch===null?null:Number(reg.chargeMismatch)):null,now,o.orderId,o.version).first<{version:number}>();
 return r?r.version:null;
}
const noChange=(step:OrderStep,before:StoredOrder)=>step.order.state===before.state&&step.order.reconcileReads===before.reconcileReads;

export type ConsentRequest=Omit<ConsentInput,'related'|'orderId'|'review'|'quote'>&{db:Db;reviewId:string;orderId:string};
/** Exact human consent, committed. A repeat of the same review returns the existing order; a second review of a name in progress is refused. */
export async function consent(input:ConsentRequest):Promise<OrderStep&{order:StoredOrder}>{
 const {db,reviewId,orderId,actor,project,now}=input;
 const loaded=actor.kind==='owner'?await loadReview(db,actor.ownerId,reviewId):null;
 const key=loaded?await orderIdempotencyKey(loaded.review):'0'.repeat(64);
 const related=loaded?await relatedOrders(db,key,loaded.review.hostname):[];
 const step=await consentToOrder({...input,review:loaded?.review,quote:loaded?.quote,related,orderId});
 if(step.replayed)return step as OrderStep&{order:StoredOrder};
 const review=loaded!.review;
 // The server-resolved project revision and funding source are bound into the inserting statement; the triggers repeat the review, owner and expiry predicates.
 const row=await db.prepare(`INSERT INTO domain_orders(order_id,idempotency_key,review_id,quote_id,quote_digest,owner_user_id,project_id,hostname,state,history_json,consented_at,updated_at)
  SELECT ?1,?2,r.review_id,r.quote_id,r.quote_digest,r.owner_user_id,r.project_id,r.hostname,'consented','["quoted","consented"]',?3,?3 FROM domain_reviews r
  WHERE r.review_id=?4 AND r.project_revision=?5 AND r.funding_source_id=?6 ON CONFLICT DO NOTHING RETURNING ${orderColumns}`)
  .bind(orderId,key,now,review.reviewId,project!.revision,review.fundingSourceId).first<OrderRow>();
 if(row)return {...step,order:toOrder(row)};
 // Nothing inserted: the same consent won elsewhere (replay), or another order holds the name.
 const existing=(await relatedOrders(db,key,review.hostname));
 const same=existing.find(o=>o.idempotencyKey===key);
 if(same)return {order:same,hold:null,registration:null,replayed:true};
 throw new DomainPurchaseError(existing.some(o=>o.state==='registered')?'ALREADY_REGISTERED':'ORDER_IN_PROGRESS',review.hostname);
}

/** Place the funding hold (the schema writes it with the transition). */
export async function reserve(db:Db,ownerId:string,orderId:string,now:number){
 const order=await loadOrder(db,ownerId,orderId),quote=order&&await loadQuote(db,order.quoteId);
 if(!order||!quote)return null;
 const step=reserveOrder({order,quote,now});
 if(!noChange(step,order))await commit(db,step,now);// a lost race means someone else already reserved or expired it
 return loadOrder(db,ownerId,orderId);
}
/** `project` is the server-resolved current project authority; a changed revision or owner since the review cancels the order before the purchase call. */
export type DispatchRequest={db:Db;ownerId:string;orderId:string;owner:OwnerFunding|null|undefined;project:ProjectAuthority|null|undefined;registrar:RegistrarAdapter;policy:PurchasePolicy;now:number};
/** Claim, then call register at most once. The claim is the attempt row: a second claim cannot insert one, so a second call cannot follow. */
export async function dispatch({db,ownerId,orderId,owner,project,registrar,policy,now}:DispatchRequest){
 const order=await loadOrder(db,ownerId,orderId),quote=order&&await loadQuote(db,order.quoteId);
 if(!order||!quote)return null;
 const reviewed=await db.prepare('SELECT project_revision FROM domain_reviews WHERE review_id=?').bind(order.reviewId).first<{project_revision:number}>();
 const stale=!(project&&project.projectId===order.projectId&&project.ownerId===order.ownerId&&reviewed&&project.revision===reviewed.project_revision);
 const result=await dispatchOrder({order,quote,owner,registrar,policy,now,stale,claim:async claimed=>{
  const version=await commit(db,{order:claimed,hold:null,registration:null},now);
  if(version===null)return false;
  (claimed as StoredOrder).version=version;return true;
 }});
 // After a claim the outcome step continues from the claimed version; an expiry or price-change step continues from the stored one.
 // A step that lost its compare-and-set carries no settlement: a slow worker must not hand a capture or a registration to its caller.
 const won=(!noChange(result,order)||result.claimed)?await commit(db,result,now):1;
 const settled=won===null?{...result,hold:null,registration:null}:result;
 return {...settled,order:(await loadOrder(db,ownerId,orderId)) as StoredOrder};
}
/** Owner cancellation, only before the purchase call. */
export async function cancel(db:Db,actor:Actor,orderId:string,now:number){
 const order=await loadOrder(db,actor.ownerId,orderId);
 const step=cancelOrder({actor,order});
 return (await commit(db,step,now))===null?null:loadOrder(db,actor.ownerId,orderId);
}
/** Sweep for orders no worker will finish: consented or reserved orders whose quote expired are expired (the hold of a reserved one is released), so they stop blocking the name for every tenant. */
export async function sweepStranded(db:Db,now:number,limit=50){
 const rows=(await db.prepare(`SELECT ${orderColumns.split(',').map(c=>'o.'+c).join(',')} FROM domain_orders o JOIN domain_quotes q ON q.quote_id=o.quote_id WHERE o.state IN ('consented','reserved') AND q.expires_at<=?1 ORDER BY q.expires_at LIMIT ?2`).bind(now,limit).all<OrderRow>()).results;
 let moved=0;
 for(const row of rows){
  const order=toOrder(row),quote=await loadQuote(db,order.quoteId);
  if(!quote)continue;
  try{if(await commit(db,expireStale({order,quote,now}),now)!==null)moved++;}catch{/* one bad row never stops the sweep */}
 }
 return {moved};
}
/** Sweep: dispatches claimed longer than the lease ago become unknown-outcome (the purchase may have happened). Bounded; losers of a race are skipped. */
export async function sweepLeases(db:Db,now:number,limit=50){
 const rows=(await db.prepare(`SELECT ${orderColumns} FROM domain_orders WHERE state='dispatching' AND attempt_started_at<=?1 ORDER BY attempt_started_at LIMIT ?2`).bind(now-domainPurchaseBounds.leaseMs,limit).all<OrderRow>()).results;
 let moved=0;
 for(const row of rows){const order=toOrder(row);try{if(await commit(db,expireDispatchLease({order,now}),now)!==null)moved++;}catch{/* one bad row never stops the sweep */}}
 return {moved};
}
/** Bounded read-only reconciliation of unknown outcomes: at most three reads, at least six hours apart, within 72 hours. Never calls register. */
export async function reconcileUnknown(db:Db,registrar:RegistrarAdapter,now:number,limit=20){
 const rows=(await db.prepare(`SELECT ${orderColumns} FROM domain_orders WHERE state='unknown-outcome' AND updated_at<=?2 ORDER BY updated_at LIMIT ?1`).bind(limit,now-domainPurchaseBounds.reconcileSpacingMs).all<OrderRow>()).results;
 let moved=0;
 for(const row of rows){
  try{
   const order=toOrder(row),step=await reconcileOrder({order,registrar,now});
   if(!noChange(step,order)&&await commit(db,step,now)!==null)moved++;
  }catch{/* a thrown lookup costs this order one retry later, not the whole batch */}
 }
 return {moved};
}
/** An authenticated registrar event, applied at most once. Duplicates and stale attempts are remembered and ignored. */
export async function receiveRegistrarEvent(db:Db,event:RegistrarEvent,now:number){
 const order=await db.prepare(`SELECT ${orderColumns} FROM domain_orders WHERE order_id=?`).bind(event.orderId).first<OrderRow>();
 const seen=!!await db.prepare('SELECT 1 x FROM domain_registrar_events WHERE event_id=?').bind(event.eventId).first();
 const {outcome,step}=applyRegistrarEvent({order:order&&toOrder(order),event,seen,now});
 if(seen||!order)return outcome;
 const remember=(applied:number)=>db.prepare('INSERT INTO domain_registrar_events(event_id,order_id,attempt_id,event_type,applied,received_at) SELECT ?1,?2,?3,?4,?5,?6 WHERE ?5=0 OR changes()=1 ON CONFLICT DO NOTHING')
  .bind(event.eventId,event.orderId,event.attemptId,event.type,applied,now);
 if(!step){await remember(0).run();return outcome;}
 const o=step.order as StoredOrder,reg=step.registration;
 // The order change and the event receipt are one batch: the receipt is written only if the change won.
 const [update]=await db.batch([
  db.prepare(`UPDATE domain_orders SET state=?1,history_json=?2,registration_expires_at=?3,charge_mismatch=?4,updated_at=max(?5,updated_at),version=version+1 WHERE order_id=?6 AND version=?7 RETURNING version`)
   .bind(o.state,JSON.stringify(o.history),reg?.expiresAt??null,reg?(reg.chargeMismatch===null?null:Number(reg.chargeMismatch)):null,now,o.orderId,o.version),
  remember(1)]);
 return update.results.length===1?outcome:{applied:false as const,stale:true as const};
}

/** Nightly: quotes and reviews that never became an order, with any registrant contact, a day after they expired. Orders are never pruned here. */
export async function pruneDomainDrafts(db:Db,now:number,limit=200){
 check(Number.isSafeInteger(limit)&&limit>0&&limit<=1000,'INVALID_LIMIT','limit');
 const r=await db.prepare(`DELETE FROM domain_quotes WHERE quote_id IN (SELECT quote_id FROM domain_quotes q WHERE q.expires_at<=?1 AND NOT EXISTS(SELECT 1 FROM domain_orders o WHERE o.quote_id=q.quote_id) ORDER BY q.expires_at LIMIT ?2) RETURNING quote_id`)
  .bind(now-domainDraftRetentionMs,limit).all();
 return {quotes:r.results.length};
}

/** The exact review as every surface shows it (Chat card `domain.purchase-review@1` and the Domains page read this one function), so the two can
 * never differ. The text is rendered by the server from the stored quote; the order state shows what consent already did. Read-only, owner-only. */
export async function readDomainReview(db:Db,ownerId:string,reviewId:string,now:number){
 const loaded=await loadReview(db,ownerId,reviewId);
 if(!loaded)return null;
 const {review,quote}=loaded;
 const order=await db.prepare('SELECT order_id,state FROM domain_orders WHERE review_id=?').bind(reviewId).first<{order_id:string;state:string}>();
 return {version:1 as const,reviewId,hostname:review.hostname,currency:quote.currency,initialTotalCents:quote.initial.totalCents,renewalTotalCents:quote.renewal.totalCents,renewalGuaranteed:false as const,
  autoRenew:false as const,privacy:quote.privacy,expiresAt:review.expiresAt,open:!order&&now<review.expiresAt&&now<quote.expiresAt,orderId:order?.order_id??null,orderState:order?.state??null,
  consentText:consentText(quote),consentTextDigest:review.consentTextDigest,quoteDigest:review.quoteDigest};
}
