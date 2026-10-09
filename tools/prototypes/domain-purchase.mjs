// WH-034 offline domain purchase contract reference (WH-192). Validates the frozen quote, review, consent and order
// shapes and runs a synthetic in-memory purchase runtime against a synthetic registrar for the conformance harness in
// tests/domain-purchase-contract.mjs. It is not D1 storage, a payment integration, an HTTP handler or a registrar
// adapter. No Worker imports it. Production code must repeat every predicate inside its committing statements (see
// docs/domain-purchases.md). Synthetic names, prices and identifiers only.
import {createHash} from 'node:crypto';

export class DomainPurchaseContractError extends Error {
 constructor(code,path){super(`${code}: ${path}`);this.code=code;}
}
const check=(ok,code,path)=>{if(!ok)throw new DomainPurchaseContractError(code,path);};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
function shape(v,keys,path){
 check(plain(v),'INVALID_SHAPE',path);
 check(Object.keys(v).every(k=>keys.includes(k)),'UNKNOWN_FIELD',path);
 check(keys.every(k=>Object.hasOwn(v,k)),'MISSING_FIELD',path);
}
function canonical(v,depth=0){
 check(depth<=12,'TOO_DEEP','json');
 if(v===null||typeof v==='string'||typeof v==='boolean')return JSON.stringify(v);
 if(typeof v==='number'){check(Number.isFinite(v),'INVALID_NUMBER','json');return JSON.stringify(v);}
 if(Array.isArray(v))return '['+v.map(x=>canonical(x,depth+1)).join(',')+']';
 check(plain(v),'INVALID_SHAPE','json');
 return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k],depth+1)).join(',')+'}';
}
export const digest=v=>createHash('sha256').update(canonical(v)).digest('hex');
const sha=text=>createHash('sha256').update(text,'utf8').digest('hex');

/** Frozen vocabularies (contract version 1). There is no reader for any other version. */
export const contractVersion=1;
export const orderStates=Object.freeze(['quoted','consented','reserved','dispatching','registered','failed','unknown-outcome','unresolved','cancelled','expired']);
/** Allowed order transitions. Nothing returns to reserved/dispatching after a registrar call may have happened. */
export const transitions=Object.freeze({
 quoted:['consented','expired','cancelled'],
 consented:['reserved','expired','cancelled'],
 reserved:['dispatching','expired','cancelled'],
 dispatching:['registered','failed','unknown-outcome'],
 'unknown-outcome':['registered','failed','unresolved'],
 unresolved:['registered','failed'],
 registered:[],failed:[],cancelled:[],expired:[],
});
export const holdStates=Object.freeze(['held','captured','released']);
export const bounds=Object.freeze({quoteTtlMs:15*60000,reviewTtlMs:10*60000,leaseMs:60000,reconcileReads:3,reconcileWindowMs:72*3600000,transferLockMs:60*86400000,maxTotalCents:100000});
/** Mirrors src/plans.ts domainBenefit. Redemption belongs to WH-045 and is not enabled by this contract. */
export const benefitPolicy=Object.freeze({wholesaleCapCents:2000,currency:'USD',premiumEligible:false,redemptionEnabled:false});
/** v1 funds a purchase only from the owner's current payment method (WH-042). Premium AI credit (WH-044), build/test units and plan benefits are not domain funding. */
export const fundingSourceKinds=Object.freeze(['payment-method']);

// Keys a client, model or tool argument might use to choose price, funding or authority. Refused anywhere in a request.
const authorityKeys=new Set(['price','prices','pricecents','wholesale','wholesalecents','retailcents','total','totalcents','fee','feecents','tax','taxcents','currency','premium','funding','fundingsource','fundingsourceid','payer','benefit','benefitcents','discount','coupon','promotioncode','autorenew','approved','approval','authority','consent','consented','reviewid','quote','quotedigest','registrar','adapter','expiresat','term','termyears','years','duration','owner','ownerid']);
function noAuthority(v,path,depth=0){
 check(depth<=12,'TOO_DEEP',path);
 if(Array.isArray(v)){v.forEach((x,i)=>noAuthority(x,`${path}[${i}]`,depth+1));return;}
 if(!plain(v))return;
 for(const [k,x] of Object.entries(v)){
  check(!authorityKeys.has(k.toLowerCase().replace(/[-_]/g,'')),'CLIENT_AUTHORITY',`${path}.${k}`);
  noAuthority(x,`${path}.${k}`,depth+1);
 }
}
const cents=v=>Number.isSafeInteger(v)&&v>=0&&v<=bounds.maxTotalCents;
const id=v=>typeof v==='string'&&/^[a-z0-9][a-z0-9:-]{0,79}$/.test(v);
/** A registrable name in v1 is exactly two lowercase ASCII labels (eTLD+1 under a single-label public suffix). */
export function registrableName(v){
 check(typeof v==='string'&&v.length<=253,'INVALID_HOSTNAME','hostname');
 const labels=v.split('.');
 check(labels.length===2&&labels.every(l=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(l))&&/^[a-z]{2,63}$/.test(labels[1]),'INVALID_HOSTNAME','hostname');
 check(!['whumpo.com','whumpo.site'].includes(v)&&!['test','example','invalid','localhost','local','internal'].includes(labels[1]),'INVALID_HOSTNAME','hostname');
 return v;
}

const priceKeys=['wholesaleCents','retailCents','feeCents','taxCents','totalCents'];
function validatePrice(p,path,renewal){
 shape(p,renewal?[...priceKeys,'guaranteed']:priceKeys,path);
 check(priceKeys.every(k=>cents(p[k])),'INVALID_AMOUNT',path);
 check(p.retailCents+p.feeCents+p.taxCents===p.totalCents,'INVALID_TOTAL',path);
 if(renewal)check(p.guaranteed===false,'RENEWAL_GUARANTEE',path);
}
const quoteKeys=['contractVersion','quoteId','ownerId','projectId','hostname','operation','termYears','currency','availability','premium','registrar','initial','renewal','taxStatus','benefit','funding','autoRenew','privacy','termsVersion','quotedAt','expiresAt'];
/** Closed v1 quote. Every value is computed on the server from an authenticated registrar check and server policy. */
export function validateQuote(q){
 check(plain(q),'INVALID_SHAPE','quote');
 check(q.contractVersion===contractVersion,'UNSUPPORTED_VERSION','quote.contractVersion');
 shape(q,quoteKeys,'quote');
 check([q.quoteId,q.ownerId,q.projectId,q.termsVersion].every(id),'INVALID_ID','quote');
 registrableName(q.hostname);
 check(q.operation==='register'&&q.termYears===1&&q.currency==='USD'&&q.availability==='available','INVALID_TERMS','quote');
 check(typeof q.premium==='boolean','INVALID_SHAPE','quote.premium');
 shape(q.registrar,['adapterId','adapterVersion'],'quote.registrar');check(id(q.registrar.adapterId)&&Number.isSafeInteger(q.registrar.adapterVersion),'INVALID_ID','quote.registrar');
 validatePrice(q.initial,'quote.initial',false);validatePrice(q.renewal,'quote.renewal',true);
 check(q.taxStatus==='computed','TAX_UNKNOWN','quote.taxStatus');
 shape(q.benefit,['eligible','coverableWholesaleCents','redemption'],'quote.benefit');
 check(q.benefit.redemption==='not-enabled'&&cents(q.benefit.coverableWholesaleCents),'BENEFIT_NOT_ENABLED','quote.benefit');
 check(!(q.premium&&(q.benefit.eligible||q.benefit.coverableWholesaleCents)),'PREMIUM_BENEFIT','quote.benefit');
 shape(q.funding,['payer','sourceKind','sourceId','customerChargeCents','benefitCents'],'quote.funding');
 check(q.funding.payer==='customer'&&fundingSourceKinds.includes(q.funding.sourceKind)&&id(q.funding.sourceId),'INVALID_FUNDING','quote.funding');
 check(q.funding.benefitCents===0,'BENEFIT_NOT_ENABLED','quote.funding');
 check(q.funding.customerChargeCents===q.initial.totalCents,'INVALID_TOTAL','quote.funding');
 check(q.autoRenew===false,'AUTO_RENEW_DEFAULT','quote.autoRenew');
 check(q.privacy==='redacted','PRIVACY_DEFAULT','quote.privacy');
 check(Number.isSafeInteger(q.quotedAt)&&Number.isSafeInteger(q.expiresAt)&&q.expiresAt>q.quotedAt&&q.expiresAt-q.quotedAt<=bounds.quoteTtlMs,'INVALID_EXPIRY','quote');
 return q;
}
const usd=c=>`$${Math.floor(c/100)}.${String(c%100).padStart(2,'0')}`;
/** Deterministic consent text. Its SHA-256 is what the human's consent binds. */
export function consentText(q){
 return [
  `Register ${q.hostname} for 1 year through ${q.registrar.adapterId}.`,
  `You pay ${usd(q.initial.totalCents)} now: price ${usd(q.initial.retailCents)}, fees ${usd(q.initial.feeCents)}, tax ${usd(q.initial.taxCents)}, charged to your payment method on file.`,
  q.premium?'This is a premium domain. Premium prices are never covered by a plan benefit.':'',
  'Your annual domain benefit is not applied to this purchase.',
  `Renewal is currently ${usd(q.renewal.totalCents)} per year and may change. Auto-renew is off; turning it on is a separate choice.`,
  'Registration contact details are redacted from public lookups where the registry allows it.',
  `Registrations cannot be refunded once complete. This quote expires at ${new Date(q.expiresAt).toISOString()}. Registrar terms ${q.termsVersion}.`,
 ].filter(Boolean).join('\n');
}
const quoteRequestKeys=['contractVersion','projectId','hostname'];
export function validateQuoteRequest(r){
 check(plain(r),'INVALID_SHAPE','request');
 noAuthority(r,'request');
 check(r.contractVersion===contractVersion,'UNSUPPORTED_VERSION','request.contractVersion');
 shape(r,quoteRequestKeys,'request');
 registrableName(r.hostname);
 return r;
}
const consentKeys=['contractVersion','reviewId','quoteDigest','consentTextDigest','decision'];
export function validateConsent(c){
 check(plain(c),'INVALID_SHAPE','consent');
 check(c.contractVersion===contractVersion,'UNSUPPORTED_VERSION','consent.contractVersion');
 shape(c,consentKeys,'consent');
 check(c.decision==='accept','INVALID_DECISION','consent.decision');
 check([c.quoteDigest,c.consentTextDigest].every(x=>typeof x==='string'&&/^[0-9a-f]{64}$/.test(x)),'INVALID_DIGEST','consent');
 return c;
}

/** Synthetic in-memory registrar. check/lookup are read-only; register is the only purchase call and is counted. */
export function createSyntheticRegistrar({adapterId='synthetic-registrar',adapterVersion=1,prices={}}={}){
 const s={prices:structuredClone(prices),registrations:{},workflows:{},script:[],calls:{check:0,register:0,lookup:0},registerLog:[]};
 const r={
  adapterId,adapterVersion,calls:s.calls,registerLog:s.registerLog,
  setPrice(name,p){s.prices[name]={...s.prices[name],...p};},
  takeBy(name,orderRef){s.registrations[name]={orderRef,expiresAt:0,createdAt:0};},
  /** Script the next register outcome: ok | rejected | pending | timeout-before | timeout-after | malformed. */
  next(kind){s.script.push(kind);},
  finishPending(name,ok,now){const w=s.workflows[name];if(!w)return;w.status=ok?'succeeded':'failed';if(ok)s.registrations[name]={orderRef:w.orderRef,createdAt:now,expiresAt:now+365*86400000};},
  check(name){
   s.calls.check++;const p=s.prices[name];
   if(!p||s.registrations[name])return {name,registrable:false,reason:'domain_unavailable'};
   return {name,registrable:true,premium:!!p.premium,currency:'USD',registrationWholesaleCents:p.registration,renewalWholesaleCents:p.renewal,termsVersion:p.terms??'synthetic-terms-1'};
  },
  renewalCheck(name){s.calls.check++;const p=s.prices[name];return p?{currency:'USD',renewalWholesaleCents:p.renewal}:null;},
  register({hostname,orderRef,acknowledgePremium,now}){
   s.calls.register++;s.registerLog.push(hostname);
   const kind=s.script.shift()??'ok',p=s.prices[hostname];
   const record=()=>{s.registrations[hostname]={orderRef,createdAt:now,expiresAt:now+365*86400000};};
   if(kind==='rejected'||!p||s.registrations[hostname]||(p.premium&&!acknowledgePremium))return {kind:'rejected',code:'domain_unavailable'};
   if(kind==='timeout-before')throw Error('synthetic timeout before the registrar acted');
   if(kind==='timeout-after'){record();throw Error('synthetic timeout after the registrar acted');}
   if(kind==='pending'){s.workflows[hostname]={orderRef,status:'in_progress'};return {kind:'pending'};}
   if(kind==='malformed'){record();return {kind:'registered'};}
   record();return {kind:'registered',hostname,orderRef,expiresAt:s.registrations[hostname].expiresAt,chargedWholesaleCents:p.registration};
  },
  lookup(name){
   s.calls.lookup++;
   const reg=s.registrations[name];if(reg)return {status:'registered',orderRef:reg.orderRef,expiresAt:reg.expiresAt};
   const w=s.workflows[name];if(w)return {status:w.status==='failed'?'failed':'in_progress',orderRef:w.orderRef};
   return {status:'not-found'};
  },
 };
 return r;
}

/** Synthetic runtime: one platform, owners, projects, quotes, reviews, orders, funding holds and registrations. */
export function createReferenceRuntime({registrar,pricing={markupCents:0,feeCents:0,taxBasisPoints:0},allowPremium=false,now=1_000_000}={}){
 const s={now,owners:{},projects:{},quotes:{},reviews:{},orders:{},byKey:{},holds:{},registrations:{},renewalReviews:{},events:new Set(),seq:0};
 const nextId=prefix=>`${prefix}-${String(++s.seq).padStart(4,'0')}`;
 const move=(o,to,reason)=>{check(transitions[o.state].includes(to),'INVALID_TRANSITION',`${o.state}->${to}`);o.state=to;o.history.push(reason?`${to}:${reason}`:to);};
 const release=o=>{const h=s.holds[o.orderId];if(h&&h.state==='held')h.state='released';};
 const capture=o=>{const h=s.holds[o.orderId];if(h&&h.state==='held')h.state='captured';};
 const terminal=o=>['failed','cancelled','expired'].includes(o.state);
 function computeQuote(ownerId,projectId,hostname){
  const owner=s.owners[ownerId];
  const c=registrar.check(hostname);
  check(c.registrable===true,'UNAVAILABLE',hostname);
  check(c.currency==='USD','INVALID_TERMS','currency');
  check(allowPremium||!c.premium,'PREMIUM_NOT_OFFERED',hostname);
  check(owner.paymentMethod&&fundingSourceKinds.includes(owner.paymentMethod.kind),'NO_FUNDING_SOURCE',ownerId);
  const price=(wholesale)=>{const retail=wholesale+pricing.markupCents,fee=pricing.feeCents,tax=Math.round((retail+fee)*pricing.taxBasisPoints/10000);return {wholesaleCents:wholesale,retailCents:retail,feeCents:fee,taxCents:tax,totalCents:retail+fee+tax};};
  const initial=price(c.registrationWholesaleCents),renewal={...price(c.renewalWholesaleCents),guaranteed:false};
  const plan=owner.plan??{interval:'month',annualDomains:0};
  const eligible=plan.interval==='year'&&plan.annualDomains>0&&!c.premium;
  return validateQuote({contractVersion,quoteId:nextId('quote'),ownerId,projectId,hostname,operation:'register',termYears:1,currency:'USD',availability:'available',premium:c.premium,
   registrar:{adapterId:registrar.adapterId,adapterVersion:registrar.adapterVersion},initial,renewal,taxStatus:'computed',
   benefit:{eligible,coverableWholesaleCents:eligible?Math.min(c.registrationWholesaleCents,benefitPolicy.wholesaleCapCents):0,redemption:'not-enabled'},
   funding:{payer:'customer',sourceKind:owner.paymentMethod.kind,sourceId:owner.paymentMethod.id,customerChargeCents:initial.totalCents,benefitCents:0},
   autoRenew:false,privacy:'redacted',termsVersion:c.termsVersion,quotedAt:s.now,expiresAt:s.now+bounds.quoteTtlMs});
 }
 // Recompute the price-bearing part of a quote from a fresh read-only check. Any difference requires a new review.
 function priceUnchanged(q){
  let fresh;try{fresh=computeQuote(q.ownerId,q.projectId,q.hostname);}catch{return false;}
  const pick=x=>({premium:x.premium,initial:x.initial,renewal:x.renewal,registrar:x.registrar,termsVersion:x.termsVersion,funding:{...x.funding}});
  return canonical(pick(fresh))===canonical(pick(q));
 }
 function currentRenewalTotal(hostname){
  const c=registrar.renewalCheck(hostname);check(c&&c.currency==='USD'&&cents(c.renewalWholesaleCents),'UNAVAILABLE',hostname);
  const retail=c.renewalWholesaleCents+pricing.markupCents,fee=pricing.feeCents;
  return retail+fee+Math.round((retail+fee)*pricing.taxBasisPoints/10000);
 }
 function ownedProject(actor,projectId){
  check(actor&&(actor.kind==='owner'||actor.kind==='model')&&typeof actor.ownerId==='string','NOT_AUTHORIZED','actor');
  const p=s.projects[projectId];check(p&&p.ownerId===actor.ownerId,'FOREIGN_OWNER',projectId);return p;
 }
 const rt={
  get now(){return s.now;},
  advance(ms){s.now+=ms;},
  addOwner(ownerId,{plan,paymentMethod}={}){s.owners[ownerId]={plan,paymentMethod};},
  setPaymentMethod(ownerId,pm){s.owners[ownerId].paymentMethod=pm;},
  addProject(projectId,ownerId){s.projects[projectId]={ownerId,revision:1};},
  transferProject(projectId,ownerId){s.projects[projectId].ownerId=ownerId;s.projects[projectId].revision++;},
  /** Owner or model prepares a quote and review. Only project and hostname are accepted from the caller. */
  prepare(actor,request){
   validateQuoteRequest(request);ownedProject(actor,request.projectId);
   const q=computeQuote(actor.ownerId,request.projectId,request.hostname);s.quotes[q.quoteId]=q;
   const text=consentText(q),p=s.projects[q.projectId];
   const review={contractVersion,reviewId:nextId('review'),quoteId:q.quoteId,quoteDigest:digest(q),ownerId:q.ownerId,projectId:q.projectId,projectRevision:p.revision,hostname:q.hostname,fundingSourceId:q.funding.sourceId,consentTextDigest:sha(text),expiresAt:Math.min(q.expiresAt,s.now+bounds.reviewTtlMs)};
   s.reviews[review.reviewId]=review;
   return {quote:structuredClone(q),review:structuredClone(review),consentText:text};
  },
  /** Exact human consent. Creates at most one order per review (idempotency key). */
  consent(actor,submission){
   validateConsent(submission);
   check(actor&&actor.kind!=='model','MODEL_CANNOT_CONSENT','actor');
   check(actor&&actor.kind==='owner'&&typeof actor.ownerId==='string','HUMAN_REVIEW_REQUIRED','actor');
   const review=s.reviews[submission.reviewId];check(review,'UNKNOWN_REVIEW',submission.reviewId);
   check(review.ownerId===actor.ownerId,'FOREIGN_OWNER',submission.reviewId);
   const q=s.quotes[review.quoteId];
   const key=digest({ownerId:review.ownerId,projectId:review.projectId,hostname:review.hostname,reviewId:review.reviewId,quoteDigest:review.quoteDigest});
   if(s.byKey[key])return structuredClone(s.orders[s.byKey[key]]);
   const p=s.projects[review.projectId];
   check(p&&p.ownerId===review.ownerId&&p.revision===review.projectRevision,'STALE_REVIEW',review.projectId);
   check(s.now<review.expiresAt&&s.now<q.expiresAt,'QUOTE_EXPIRED',review.reviewId);
   check(submission.quoteDigest===review.quoteDigest&&digest(q)===review.quoteDigest,'REVIEW_MISMATCH',review.reviewId);
   check(submission.consentTextDigest===review.consentTextDigest&&sha(consentText(q))===review.consentTextDigest,'CONSENT_MISMATCH',review.reviewId);
   check(s.owners[review.ownerId].paymentMethod?.id===review.fundingSourceId,'FUNDING_CHANGED',review.reviewId);
   for(const o of Object.values(s.orders))if(o.hostname===review.hostname){
    check(o.state!=='registered','ALREADY_REGISTERED',review.hostname);
    check(terminal(o),'ORDER_IN_PROGRESS',review.hostname);
   }
   check(priceUnchanged(q),'PRICE_CHANGED',review.reviewId);
   const order={contractVersion,orderId:nextId('order'),idempotencyKey:key,reviewId:review.reviewId,quoteId:q.quoteId,quoteDigest:review.quoteDigest,ownerId:review.ownerId,projectId:review.projectId,hostname:review.hostname,state:'quoted',history:['quoted'],attempts:0,attempt:null,reconcileReads:0,uncertainAt:null,consentedAt:s.now};
   move(order,'consented');
   s.orders[order.orderId]=order;s.byKey[key]=order.orderId;
   return structuredClone(order);
  },
  /** Server step: place the funding hold for the exact consented amount. */
  reserve(orderId){
   const o=s.orders[orderId];check(o,'UNKNOWN_ORDER',orderId);
   if(o.state!=='consented')return structuredClone(o);
   const q=s.quotes[o.quoteId];
   if(s.now>=q.expiresAt){move(o,'expired','quote-expired');return structuredClone(o);}
   s.holds[orderId]={orderId,sourceId:q.funding.sourceId,amountCents:q.funding.customerChargeCents,state:'held'};
   move(o,'reserved');return structuredClone(o);
  },
  /** Server step: at most one registrar purchase call per order, ever. `interrupt` simulates a worker stopping after the claim commits. */
  dispatch(orderId,{interrupt=false}={}){
   const o=s.orders[orderId];check(o,'UNKNOWN_ORDER',orderId);
   check(!['dispatching','unknown-outcome','unresolved'].includes(o.state),'NO_REDISPATCH',o.state);
   if(o.state!=='reserved')return structuredClone(o);
   const q=s.quotes[o.quoteId];
   if(s.now>=q.expiresAt){move(o,'expired','quote-expired');release(o);return structuredClone(o);}
   if(!priceUnchanged(q)){move(o,'cancelled','price-changed');release(o);return structuredClone(o);}
   move(o,'dispatching');o.attempts++;o.attempt={attemptId:`${o.orderId}:a${o.attempts}`,startedAt:s.now};
   if(interrupt)return structuredClone(o);
   let result;
   try{result=registrar.register({hostname:o.hostname,orderRef:o.orderId,acknowledgePremium:q.premium,autoRenew:false,privacy:'redaction',now:s.now});}
   catch{result={kind:'lost'};}
   if(result?.kind==='registered'&&result.hostname===o.hostname&&result.orderRef===o.orderId&&Number.isSafeInteger(result.expiresAt)){
    move(o,'registered');capture(o);
    s.registrations[o.hostname]={hostname:o.hostname,ownerId:o.ownerId,projectId:o.projectId,orderId:o.orderId,createdAt:s.now,expiresAt:result.expiresAt,autoRenew:false,renewalOptIn:null,chargeMismatch:result.chargedWholesaleCents!==q.initial.wholesaleCents};
   }else if(result?.kind==='rejected'){move(o,'failed','rejected');release(o);}
   else{move(o,'unknown-outcome','uncertain');o.uncertainAt=s.now;}
   return structuredClone(o);
  },
  /** Lease sweep: an interrupted dispatch may have reached the registrar. */
  sweep(){
   for(const o of Object.values(s.orders))if(o.state==='dispatching'&&s.now-o.attempt.startedAt>=bounds.leaseMs){move(o,'unknown-outcome','interrupted');o.uncertainAt=s.now;}
  },
  /** Bounded read-only reconciliation. Never calls register; "not found" is not proof of non-registration. */
  reconcile(orderId){
   const o=s.orders[orderId];check(o,'UNKNOWN_ORDER',orderId);
   if(o.state!=='unknown-outcome')return structuredClone(o);
   if(o.reconcileReads>=bounds.reconcileReads||s.now-o.uncertainAt>=bounds.reconcileWindowMs){move(o,'unresolved','reconcile-bound');return structuredClone(o);}
   o.reconcileReads++;
   const found=registrar.lookup(o.hostname);
   if(found.status==='registered'&&found.orderRef===o.orderId){
    move(o,'registered','reconciled');capture(o);
    s.registrations[o.hostname]={hostname:o.hostname,ownerId:o.ownerId,projectId:o.projectId,orderId:o.orderId,createdAt:s.now,expiresAt:found.expiresAt,autoRenew:false,renewalOptIn:null,chargeMismatch:false};
   }else if(found.status==='failed'&&found.orderRef===o.orderId){move(o,'failed','reconciled-failed');release(o);}
   else if(found.status==='registered'){move(o,'failed','registered-elsewhere');release(o);}
   if(o.state==='unknown-outcome'&&o.reconcileReads>=bounds.reconcileReads)move(o,'unresolved','reconcile-bound');
   return structuredClone(o);
  },
  /** Authenticated registrar result for one attempt. Duplicate, stale and out-of-order events are ignored. */
  applyRegistrarEvent({eventId,orderId,attemptId,type,authenticated}){
   check(authenticated===true,'EVENT_NOT_AUTHENTICATED','event');
   if(s.events.has(eventId))return {applied:false,duplicate:true};
   s.events.add(eventId);
   const o=s.orders[orderId];if(!o||!o.attempt||o.attempt.attemptId!==attemptId)return {applied:false,stale:true};
   const to=type==='registered'?'registered':type==='failed'?'failed':null;
   if(!to||!transitions[o.state].includes(to))return {applied:false,ignored:true};
   move(o,to,'event');if(to==='registered'){capture(o);s.registrations[o.hostname]={hostname:o.hostname,ownerId:o.ownerId,projectId:o.projectId,orderId:o.orderId,createdAt:s.now,expiresAt:s.now+365*86400000,autoRenew:false,renewalOptIn:null,chargeMismatch:false};}else release(o);
   return {applied:true};
  },
  cancel(actor,orderId){
   const o=s.orders[orderId];check(o&&actor?.kind==='owner'&&actor.ownerId===o.ownerId,'FOREIGN_OWNER',orderId);
   check(['quoted','consented','reserved'].includes(o.state),'CANNOT_RECALL',o.state);
   move(o,'cancelled','owner-cancelled');release(o);return structuredClone(o);
  },
  /** Auto-renew is off by default. Turning it on needs its own exact review of the current renewal price. */
  prepareAutoRenew(actor,hostname){
   const r=s.registrations[hostname];check(r&&actor&&['owner','model'].includes(actor.kind)&&actor.ownerId===r.ownerId,'FOREIGN_OWNER',hostname);
   const renewalTotalCents=currentRenewalTotal(hostname);
   const text=`Turn on auto-renew for ${hostname}. Each year the renewal price, currently ${usd(renewalTotalCents)}, is charged to your payment method on file. If the renewal price rises, auto-renew stops until you review again.`;
   const review={contractVersion,reviewId:nextId('renewal'),hostname,ownerId:r.ownerId,renewalTotalCents,consentTextDigest:sha(text),expiresAt:s.now+bounds.reviewTtlMs};
   s.renewalReviews[review.reviewId]=review;return {review:structuredClone(review),consentText:text};
  },
  confirmAutoRenew(actor,{contractVersion:v,reviewId,consentTextDigest}){
   check(v===contractVersion,'UNSUPPORTED_VERSION','renewal.contractVersion');
   check(actor&&actor.kind!=='model','MODEL_CANNOT_CONSENT','actor');
   const review=s.renewalReviews[reviewId];check(review&&actor.kind==='owner'&&actor.ownerId===review.ownerId,'FOREIGN_OWNER',reviewId);
   check(s.now<review.expiresAt,'QUOTE_EXPIRED',reviewId);
   check(consentTextDigest===review.consentTextDigest,'CONSENT_MISMATCH',reviewId);
   check(currentRenewalTotal(review.hostname)===review.renewalTotalCents,'PRICE_CHANGED',reviewId);
   const r=s.registrations[review.hostname];r.autoRenew=true;r.renewalOptIn={reviewId,renewalTotalCents:review.renewalTotalCents};
   return structuredClone(r);
  },
  /** Renewal-time check: an opt-in never covers a higher renewal price. */
  renewalDecision(hostname){
   const r=s.registrations[hostname];check(r,'UNKNOWN_REGISTRATION',hostname);
   if(!r.autoRenew)return {renew:false,reason:'auto-renew-off'};
   if(currentRenewalTotal(hostname)>r.renewalOptIn.renewalTotalCents){r.autoRenew=false;r.renewalOptIn=null;return {renew:false,reason:'renewal-price-changed'};}
   return {renew:true};
  },
  /** Transfer-out honours the ICANN 60-day post-registration lock; the auth code goes only to the owner, never to a model. */
  requestTransferOut(actor,hostname){
   const r=s.registrations[hostname];check(r&&actor?.kind==='owner'&&actor.ownerId===r.ownerId,'FOREIGN_OWNER',hostname);
   check(s.now-r.createdAt>=bounds.transferLockMs,'TRANSFER_LOCKED',hostname);
   r.autoRenew=false;r.renewalOptIn=null;
   return {hostname,state:'auth-code-issued',delivery:'owner-only'};
  },
  order:id=>structuredClone(s.orders[id]),
  orders:()=>Object.keys(s.orders),
  hold:id=>structuredClone(s.holds[id]),
  registration:name=>structuredClone(s.registrations[name]),
  quote:id=>structuredClone(s.quotes[id]),
 };
 return rt;
}
