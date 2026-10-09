/** WH-034 / WH-193 domain purchase quote, review and consent (contract version 1, docs/domain-purchases.md).
 * Pure functions over plain data plus the read-only registrar check. No storage, route, Chat binding or Worker import:
 * the persistence slice (WH-194) must repeat every predicate here inside its committing statements. */
import {canonicalJSON,jsonDigest,plain,sha256} from '../project-specification/v2/json';
import {quoteDomainBenefit} from '../plans';
import type {RegistrarAdapter} from './registrar';

export class DomainPurchaseError extends Error {
 constructor(readonly code:string,readonly path='request'){super(`${code}: ${path}`);}
}
export function check(condition:unknown,code:string,path:string):asserts condition {
 if(!condition)throw new DomainPurchaseError(code,path);
}
function shape(value:unknown,keys:readonly string[],path:string):asserts value is Record<string,unknown> {
 check(plain(value),'INVALID_SHAPE',path);
 check(Object.keys(value).every(key=>keys.includes(key)),'UNKNOWN_FIELD',path);
 check(keys.every(key=>Object.hasOwn(value,key)),'MISSING_FIELD',path);
}

/** Frozen vocabularies (contract version 1). There is no reader for any other version. */
export const contractVersion=1;
export const domainPurchaseBounds=Object.freeze({quoteTtlMs:15*60000,reviewTtlMs:10*60000,leaseMs:60000,reconcileReads:3,reconcileWindowMs:72*3600000,transferLockMs:60*86400000,maxTotalCents:100000});
/** v1 funds a purchase only from the owner's current payment method (WH-042). Premium AI credit (WH-044), build/test units and plan benefits are not domain funding. */
export const fundingSourceKinds:readonly string[]=Object.freeze(['payment-method']);

export type Actor={kind:'owner'|'model'|'visitor'|'service'|'operator';ownerId:string};
export type Price={wholesaleCents:number;retailCents:number;feeCents:number;taxCents:number;totalCents:number};
export type DomainPurchaseQuote={
 contractVersion:1;quoteId:string;ownerId:string;projectId:string;hostname:string;
 operation:'register';termYears:1;currency:'USD';availability:'available';premium:boolean;
 registrar:{adapterId:string;adapterVersion:number};initial:Price;renewal:Price&{guaranteed:false};taxStatus:'computed';
 benefit:{eligible:boolean;coverableWholesaleCents:number;redemption:'not-enabled'};
 funding:{payer:'customer';sourceKind:'payment-method';sourceId:string;customerChargeCents:number;benefitCents:0};
 autoRenew:false;privacy:'redacted';termsVersion:string;quotedAt:number;expiresAt:number;
};
export type DomainPurchaseReview={
 contractVersion:1;reviewId:string;quoteId:string;quoteDigest:string;ownerId:string;projectId:string;projectRevision:number;
 hostname:string;fundingSourceId:string;consentTextDigest:string;expiresAt:number;
};
export type QuoteRequest={contractVersion:1;projectId:string;hostname:string};
export type ConsentSubmission={contractVersion:1;reviewId:string;quoteDigest:string;consentTextDigest:string;decision:'accept'};
/** Server-resolved inputs. Coverage and the payment method come from the one subscription/payment resolver (WH-042), never from a request. */
export type OwnerFunding={coverage:{planId:string;interval:'month'|'year'}|null;paymentMethod:{kind:string;id:string}|null};
export type ProjectAuthority={projectId:string;ownerId:string;revision:number};
/** Server pricing policy. `taxBasisPoints: null` means no approved tax method, which refuses every quote (TAX_UNKNOWN). */
export type PurchasePolicy={pricing:{markupCents:number;feeCents:number;taxBasisPoints:number|null};allowPremium:boolean};

// Keys a client, model or tool argument might use to choose price, funding or authority. Refused anywhere in a request.
const authorityKeys=new Set(['price','prices','pricecents','wholesale','wholesalecents','retailcents','total','totalcents','fee','feecents','tax','taxcents','taxstatus','currency','premium','acknowledgepremium','funding','fundingsource','fundingsourceid','payer','paymentmethod','benefit','benefitcents','discount','coupon','promotioncode','autorenew','privacy','approved','approval','authority','consent','consented','decision','reviewid','quote','quoteid','quotedigest','registrar','adapter','expiresat','term','termyears','years','duration','owner','ownerid']);
function noAuthority(value:unknown,path:string,depth=0){
 check(depth<=12,'TOO_DEEP',path);
 if(Array.isArray(value)){value.forEach((item,i)=>noAuthority(item,`${path}[${i}]`,depth+1));return;}
 if(!plain(value))return;
 for(const [key,item] of Object.entries(value)){
  check(!authorityKeys.has(key.toLowerCase().replace(/[-_]/g,'')),'CLIENT_AUTHORITY',`${path}.${key}`);
  noAuthority(item,`${path}.${key}`,depth+1);
 }
}
export const cents=(value:unknown):value is number=>Number.isSafeInteger(value)&&(value as number)>=0&&(value as number)<=domainPurchaseBounds.maxTotalCents;
const identifier=(value:unknown):value is string=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
const digestText=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);

/** A registrable name in v1 is exactly two lowercase ASCII/Punycode labels (eTLD+1 under a single-label public
 * suffix). Subdomains such as www.example.com, URLs, platform domains and reserved suffixes are refused. */
export function registrableName(value:unknown):string {
 check(typeof value==='string'&&value.length<=253,'INVALID_HOSTNAME','hostname');
 const labels=value.split('.');
 check(labels.length===2&&labels.every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))&&/^[a-z]{2,63}$/.test(labels[1]),'INVALID_HOSTNAME','hostname');
 check(!['whumpo.com','whumpo.site'].includes(value)&&!['test','example','invalid','localhost','local','internal'].includes(labels[1]),'INVALID_HOSTNAME','hostname');
 return value;
}

const priceKeys=['wholesaleCents','retailCents','feeCents','taxCents','totalCents'];
function validatePrice(value:unknown,path:string,renewal:boolean){
 shape(value,renewal?[...priceKeys,'guaranteed']:priceKeys,path);
 check(priceKeys.every(key=>cents(value[key])),'INVALID_AMOUNT',path);
 const p=value as Price;
 check(p.retailCents+p.feeCents+p.taxCents===p.totalCents,'INVALID_TOTAL',path);
 if(renewal)check(value.guaranteed===false,'RENEWAL_GUARANTEE',path);
}
const quoteKeys=['contractVersion','quoteId','ownerId','projectId','hostname','operation','termYears','currency','availability','premium','registrar','initial','renewal','taxStatus','benefit','funding','autoRenew','privacy','termsVersion','quotedAt','expiresAt'];
/** Closed v1 quote. Every value is computed on the server from an authenticated registrar check and server policy. */
export function validateQuote(value:unknown):DomainPurchaseQuote {
 check(plain(value),'INVALID_SHAPE','quote');
 check(value.contractVersion===contractVersion,'UNSUPPORTED_VERSION','quote.contractVersion');
 shape(value,quoteKeys,'quote');
 const q=value as DomainPurchaseQuote;
 check([q.quoteId,q.ownerId,q.projectId,q.termsVersion].every(identifier),'INVALID_ID','quote');
 registrableName(q.hostname);
 check(q.operation==='register'&&q.termYears===1&&q.currency==='USD'&&q.availability==='available','INVALID_TERMS','quote');
 check(typeof q.premium==='boolean','INVALID_SHAPE','quote.premium');
 shape(q.registrar,['adapterId','adapterVersion'],'quote.registrar');
 check(identifier(q.registrar.adapterId)&&Number.isSafeInteger(q.registrar.adapterVersion)&&q.registrar.adapterVersion>0,'INVALID_ID','quote.registrar');
 validatePrice(q.initial,'quote.initial',false);validatePrice(q.renewal,'quote.renewal',true);
 check(q.taxStatus==='computed','TAX_UNKNOWN','quote.taxStatus');
 shape(q.benefit,['eligible','coverableWholesaleCents','redemption'],'quote.benefit');
 check(typeof q.benefit.eligible==='boolean'&&q.benefit.redemption==='not-enabled'&&cents(q.benefit.coverableWholesaleCents),'BENEFIT_NOT_ENABLED','quote.benefit');
 check(!(q.premium&&(q.benefit.eligible||q.benefit.coverableWholesaleCents)),'PREMIUM_BENEFIT','quote.benefit');
 shape(q.funding,['payer','sourceKind','sourceId','customerChargeCents','benefitCents'],'quote.funding');
 check(q.funding.payer==='customer'&&fundingSourceKinds.includes(q.funding.sourceKind)&&identifier(q.funding.sourceId),'INVALID_FUNDING','quote.funding');
 check(q.funding.benefitCents===0,'BENEFIT_NOT_ENABLED','quote.funding');
 check(q.funding.customerChargeCents===q.initial.totalCents,'INVALID_TOTAL','quote.funding');
 check(q.autoRenew===false,'AUTO_RENEW_DEFAULT','quote.autoRenew');
 check(q.privacy==='redacted','PRIVACY_DEFAULT','quote.privacy');
 check(Number.isSafeInteger(q.quotedAt)&&Number.isSafeInteger(q.expiresAt)&&q.quotedAt>=0&&q.expiresAt>q.quotedAt&&q.expiresAt-q.quotedAt<=domainPurchaseBounds.quoteTtlMs,'INVALID_EXPIRY','quote');
 return q;
}
const usd=(c:number)=>`$${Math.floor(c/100)}.${String(c%100).padStart(2,'0')}`;
/** Deterministic consent text. Its SHA-256 is what the human's consent binds. */
export function consentText(q:DomainPurchaseQuote){
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
/** SHA-256 over canonical JSON; key order is irrelevant and any field change produces a new digest. */
export const quoteDigest=(q:DomainPurchaseQuote)=>jsonDigest(q);
export const consentTextDigest=(text:string)=>sha256(text);

/** The only caller-supplied quote input: a project and a hostname. Price, funding, premium, auto-renew and approval fields are refused. */
export function validateQuoteRequest(request:unknown):QuoteRequest {
 check(plain(request),'INVALID_SHAPE','request');
 noAuthority(request,'request');
 check(request.contractVersion===contractVersion,'UNSUPPORTED_VERSION','request.contractVersion');
 shape(request,['contractVersion','projectId','hostname'],'request');
 check(identifier(request.projectId),'INVALID_ID','request.projectId');
 registrableName(request.hostname);
 return request as QuoteRequest;
}
export function validateConsent(submission:unknown):ConsentSubmission {
 check(plain(submission),'INVALID_SHAPE','consent');
 check(submission.contractVersion===contractVersion,'UNSUPPORTED_VERSION','consent.contractVersion');
 shape(submission,['contractVersion','reviewId','quoteDigest','consentTextDigest','decision'],'consent');
 check(submission.decision==='accept','INVALID_DECISION','consent.decision');
 check(identifier(submission.reviewId)&&digestText(submission.quoteDigest)&&digestText(submission.consentTextDigest),'INVALID_DIGEST','consent');
 return submission as ConsentSubmission;
}

/** Server price for one wholesale amount. Unknown tax policy refuses the quote rather than pricing zero tax. */
export function serverPrice(wholesaleCents:unknown,pricing:PurchasePolicy['pricing']):Price {
 check(cents(wholesaleCents),'INVALID_AMOUNT','registrar.price');
 check(cents(pricing.markupCents)&&cents(pricing.feeCents),'INVALID_POLICY','pricing');
 check(pricing.taxBasisPoints!==null&&Number.isSafeInteger(pricing.taxBasisPoints)&&pricing.taxBasisPoints>=0&&pricing.taxBasisPoints<=10000,'TAX_UNKNOWN','pricing.taxBasisPoints');
 const retail=wholesaleCents+pricing.markupCents,fee=pricing.feeCents,tax=Math.round((retail+fee)*pricing.taxBasisPoints/10000);
 return {wholesaleCents,retailCents:retail,feeCents:fee,taxCents:tax,totalCents:retail+fee+tax};
}

export type QuoteInput={quoteId:string;ownerId:string;projectId:string;hostname:string;owner:OwnerFunding|null|undefined;registrar:RegistrarAdapter;policy:PurchasePolicy;now:number};
/** Compute a v1 quote from a fresh read-only registrar check and server policy. Never reads a client value. */
export async function computeQuote({quoteId,ownerId,projectId,hostname,owner,registrar,policy,now}:QuoteInput):Promise<DomainPurchaseQuote> {
 registrableName(hostname);
 const c=await registrar.check(hostname);
 check(plain(c)&&c.name===hostname&&c.registrable===true,'UNAVAILABLE',hostname);
 check(c.currency==='USD','INVALID_TERMS','currency');
 check(typeof c.premium==='boolean','INVALID_SHAPE','registrar.premium');
 check(policy.allowPremium===true||!c.premium,'PREMIUM_NOT_OFFERED',hostname);
 const source=owner?.paymentMethod;
 check(source&&fundingSourceKinds.includes(source.kind),'NO_FUNDING_SOURCE',ownerId);
 const initial=serverPrice(c.registrationWholesaleCents,policy.pricing),renewal={...serverPrice(c.renewalWholesaleCents,policy.pricing),guaranteed:false as const};
 const benefit=owner?.coverage?quoteDomainBenefit(owner.coverage.planId,owner.coverage.interval,initial.wholesaleCents,c.premium):null;
 return validateQuote({contractVersion,quoteId,ownerId,projectId,hostname,operation:'register',termYears:1,currency:'USD',availability:'available',premium:c.premium,
  registrar:{adapterId:registrar.adapterId,adapterVersion:registrar.adapterVersion},initial,renewal,taxStatus:'computed',
  benefit:{eligible:benefit?.eligible===true,coverableWholesaleCents:benefit?.eligible?benefit.coveredCents:0,redemption:'not-enabled'},
  funding:{payer:'customer',sourceKind:source.kind,sourceId:source.id,customerChargeCents:initial.totalCents,benefitCents:0},
  autoRenew:false,privacy:'redacted',termsVersion:c.termsVersion,quotedAt:now,expiresAt:now+domainPurchaseBounds.quoteTtlMs});
}
/** Recompute the price-bearing part of a quote from a fresh read-only check. Any difference (initial or renewal
 * price, premium, adapter, terms or funding source) requires a new review. A failed check counts as changed. */
export async function pricesUnchanged(q:DomainPurchaseQuote,{owner,registrar,policy,now}:{owner:OwnerFunding|null|undefined;registrar:RegistrarAdapter;policy:PurchasePolicy;now:number}){
 let fresh:DomainPurchaseQuote;
 try{fresh=await computeQuote({quoteId:q.quoteId,ownerId:q.ownerId,projectId:q.projectId,hostname:q.hostname,owner,registrar,policy,now});}catch{return false;}
 const pick=(x:DomainPurchaseQuote)=>({premium:x.premium,initial:x.initial,renewal:x.renewal,registrar:x.registrar,termsVersion:x.termsVersion,funding:x.funding});
 return canonicalJSON(pick(fresh))===canonicalJSON(pick(q));
}

export type PrepareInput={actor:Actor;request:unknown;project:ProjectAuthority|null|undefined;owner:OwnerFunding|null|undefined;registrar:RegistrarAdapter;policy:PurchasePolicy;ids:{quoteId:string;reviewId:string};now:number};
/** Owner or model prepares a quote and its exact review. Only project and hostname are accepted from the caller. */
export async function prepareDomainPurchase({actor,request,project,owner,registrar,policy,ids,now}:PrepareInput){
 const r=validateQuoteRequest(request);
 check(plain(actor)&&(actor.kind==='owner'||actor.kind==='model')&&typeof actor.ownerId==='string','NOT_AUTHORIZED','actor');
 check(project&&project.projectId===r.projectId&&project.ownerId===actor.ownerId,'FOREIGN_OWNER',r.projectId);
 const quote=await computeQuote({quoteId:ids.quoteId,ownerId:actor.ownerId,projectId:r.projectId,hostname:r.hostname,owner,registrar,policy,now});
 const text=consentText(quote);
 const review:DomainPurchaseReview={contractVersion,reviewId:ids.reviewId,quoteId:quote.quoteId,quoteDigest:await quoteDigest(quote),ownerId:quote.ownerId,projectId:quote.projectId,projectRevision:project.revision,
  hostname:quote.hostname,fundingSourceId:quote.funding.sourceId,consentTextDigest:await consentTextDigest(text),expiresAt:Math.min(quote.expiresAt,now+domainPurchaseBounds.reviewTtlMs)};
 return {quote,review,consentText:text};
}
