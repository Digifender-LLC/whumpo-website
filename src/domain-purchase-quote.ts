import {hostname} from './domains';
/** Authenticated registrar adapter output only; never accept quotes from model/tool arguments. */
export type DomainPurchaseQuote={
 id:string;provider:string;providerReference:string;ownerId:string;projectId:string;
 domain:string;operation:'register'|'renew';years:1;currency:'USD';
 available:boolean;premium:boolean;priceCents:number;feeCents:number;taxCents:number;
 renewalPriceCents:number;renewalFeeCents:number;renewalTaxCents:number;
 quotedAt:number;expiresAt:number;termsVersion:string;
};
const keys=['id','provider','providerReference','ownerId','projectId','domain','operation','years','currency','available','premium','priceCents','feeCents','taxCents','renewalPriceCents','renewalFeeCents','renewalTaxCents','quotedAt','expiresAt','termsVersion'];
const text=(value:unknown)=>typeof value==='string'&&value.length>0&&value.length<=200&&!/[\x00-\x20\x7f]/.test(value);
const money=(value:unknown)=>Number.isSafeInteger(value)&&Number(value)>=0&&Number(value)<=100000000;
export class DomainQuoteError extends Error{constructor(){super('Domain quote is incomplete, expired, unavailable, or does not match this request.');}}
function validate(quote:DomainPurchaseQuote,owner:string,project:string,now:number){
 if(!quote||typeof quote!=='object'||Array.isArray(quote)||Object.keys(quote).length!==keys.length||Object.keys(quote).some(key=>!keys.includes(key)))throw new DomainQuoteError();
 if(![quote.id,quote.provider,quote.providerReference,quote.ownerId,quote.projectId,quote.termsVersion].every(text)||quote.ownerId!==owner||quote.projectId!==project||quote.currency!=='USD'||quote.years!==1||!['register','renew'].includes(quote.operation)||typeof quote.premium!=='boolean'||quote.available!==true)throw new DomainQuoteError();
 try{if(typeof quote.domain!=='string'||hostname(quote.domain)!==quote.domain)throw new DomainQuoteError();}catch{throw new DomainQuoteError();}
 if(![quote.priceCents,quote.feeCents,quote.taxCents,quote.renewalPriceCents,quote.renewalFeeCents,quote.renewalTaxCents].every(money)||![quote.quotedAt,quote.expiresAt,now].every(Number.isSafeInteger)||quote.quotedAt<0||quote.quotedAt>now||quote.expiresAt<=now||quote.expiresAt<=quote.quotedAt||quote.expiresAt-quote.quotedAt>15*60*1000)throw new DomainQuoteError();
}
async function fingerprint(quote:DomainPurchaseQuote){
 const bytes=new TextEncoder().encode(JSON.stringify(keys.map(key=>[key,quote[key as keyof DomainPurchaseQuote]])));
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
/** Read-only review. This neither authorizes a charge nor redeems an annual benefit. */
export async function reviewDomainPurchaseQuote(input:DomainPurchaseQuote,owner:string,project:string,now:number){
 const quote=structuredClone(input);validate(quote,owner,project,now);
 return {quoteId:quote.id,domain:quote.domain,operation:quote.operation,years:quote.years,currency:quote.currency,premium:quote.premium,
  priceCents:quote.priceCents,feeCents:quote.feeCents,taxCents:quote.taxCents,
  totalCents:quote.priceCents+quote.feeCents+quote.taxCents,
  renewalPriceCents:quote.renewalPriceCents,renewalFeeCents:quote.renewalFeeCents,renewalTaxCents:quote.renewalTaxCents,
  renewalTotalCents:quote.renewalPriceCents+quote.renewalFeeCents+quote.renewalTaxCents,
  renewalPriceGuaranteed:false as const,autoRenew:false as const,expiresAt:quote.expiresAt,
  termsVersion:quote.termsVersion,fingerprint:await fingerprint(quote),purchaseEnabled:false as const,benefitRedeemed:false as const};
}
/** Check a user's exact reviewed choice; funding/ownership/registrar checks remain separate. */
export async function matchesDomainPurchaseReview(quote:DomainPurchaseQuote,owner:string,project:string,reviewFingerprint:string,maxChargeCents:number,now:number){
 if(!/^[0-9a-f]{64}$/.test(reviewFingerprint)||!Number.isSafeInteger(maxChargeCents)||maxChargeCents<0)throw new DomainQuoteError();
 const review=await reviewDomainPurchaseQuote(quote,owner,project,now);
 if(review.fingerprint!==reviewFingerprint||review.totalCents>maxChargeCents)throw new DomainQuoteError();
 return review;
}
