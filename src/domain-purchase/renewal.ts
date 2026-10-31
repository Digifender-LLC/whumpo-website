/** WH-193 renewal opt-in and transfer-out rules over a plain registration record (contract version 1). Auto-renew is
 * off for every registration; turning it on needs its own exact owner review of the current renewal price. The
 * lifecycle around these rules (reminders, disconnect, transfer delivery) belongs to WH-196. Read-only registrar use. */
import {plain} from '../project-specification/v2/json';
import {cents,check,consentTextDigest,contractVersion,domainPurchaseBounds,serverPrice} from './quote';
import type {Actor,PurchasePolicy} from './quote';
import type {Registration} from './order';
import type {RegistrarAdapter} from './registrar';

export type RenewalReview={contractVersion:1;reviewId:string;hostname:string;ownerId:string;renewalTotalCents:number;consentTextDigest:string;expiresAt:number};
const usd=(c:number)=>`$${Math.floor(c/100)}.${String(c%100).padStart(2,'0')}`;

/** Current all-in renewal total from a read-only registrar lookup and server pricing. */
export async function currentRenewalTotal(hostname:string,registrar:RegistrarAdapter,policy:PurchasePolicy){
 const found=await registrar.lookup(hostname);
 check(plain(found)&&found.status==='registered'&&plain(found.renewal)&&found.renewal.currency==='USD'&&cents(found.renewal.wholesaleCents),'UNAVAILABLE',hostname);
 return serverPrice(found.renewal.wholesaleCents,policy.pricing).totalCents;
}
/** Owner or model prepares the opt-in review; only the owner can confirm it. */
export async function prepareAutoRenew({actor,registration,registrar,policy,reviewId,now}:{actor:Actor;registration:Registration|null|undefined;registrar:RegistrarAdapter;policy:PurchasePolicy;reviewId:string;now:number}){
 check(registration&&plain(actor)&&(actor.kind==='owner'||actor.kind==='model')&&actor.ownerId===registration.ownerId,'FOREIGN_OWNER',registration?.hostname??'registration');
 const renewalTotalCents=await currentRenewalTotal(registration.hostname,registrar,policy);
 const text=`Turn on auto-renew for ${registration.hostname}. Each year the renewal price, currently ${usd(renewalTotalCents)}, is charged to your payment method on file. If the renewal price rises, auto-renew stops until you review again.`;
 const review:RenewalReview={contractVersion,reviewId,hostname:registration.hostname,ownerId:registration.ownerId,renewalTotalCents,consentTextDigest:await consentTextDigest(text),expiresAt:now+domainPurchaseBounds.reviewTtlMs};
 return {review,consentText:text};
}
export async function confirmAutoRenew({actor,submission,review,registration,registrar,policy,now}:{actor:Actor;submission:unknown;review:RenewalReview|null|undefined;registration:Registration|null|undefined;registrar:RegistrarAdapter;policy:PurchasePolicy;now:number}):Promise<Registration> {
 check(plain(submission),'INVALID_SHAPE','renewal');
 check(submission.contractVersion===contractVersion,'UNSUPPORTED_VERSION','renewal.contractVersion');
 check(Object.keys(submission).every(key=>['contractVersion','reviewId','consentTextDigest'].includes(key)),'UNKNOWN_FIELD','renewal');
 check(plain(actor)&&actor.kind!=='model','MODEL_CANNOT_CONSENT','actor');
 check(review&&registration&&review.reviewId===submission.reviewId&&review.hostname===registration.hostname&&actor.kind==='owner'&&actor.ownerId===review.ownerId&&registration.ownerId===review.ownerId,'FOREIGN_OWNER',String(submission.reviewId));
 check(now<review.expiresAt,'QUOTE_EXPIRED',review.reviewId);
 check(submission.consentTextDigest===review.consentTextDigest,'CONSENT_MISMATCH',review.reviewId);
 check(await currentRenewalTotal(review.hostname,registrar,policy)===review.renewalTotalCents,'PRICE_CHANGED',review.reviewId);
 return {...registration,autoRenew:true,renewalOptIn:{reviewId:review.reviewId,renewalTotalCents:review.renewalTotalCents}};
}
/** Renewal-time check: an opt-in never covers a higher renewal price; a rise turns auto-renew off. */
export async function renewalDecision({registration,registrar,policy}:{registration:Registration|null|undefined;registrar:RegistrarAdapter;policy:PurchasePolicy}){
 check(registration,'UNKNOWN_REGISTRATION','registration');
 const optIn=registration.renewalOptIn;
 if(!registration.autoRenew||!optIn)return {decision:{renew:false,reason:'auto-renew-off'},registration};
 if(await currentRenewalTotal(registration.hostname,registrar,policy)>optIn.renewalTotalCents)
  return {decision:{renew:false,reason:'renewal-price-changed'},registration:{...registration,autoRenew:false,renewalOptIn:null}};
 return {decision:{renew:true},registration};
}
/** ICANN Expired Registration Recovery Policy cadence: about a month and a week before expiry, and within five days after. Each kind has one window; `now`
 * is in at most one. Nothing is sent from here: the lifecycle store queues a never-sent notice per kind (event reference = name, kind and expiry). */
const DAY=86400000;
export const reminderWindows=Object.freeze([
 {kind:'month',from:-30*DAY,to:-7*DAY},{kind:'week',from:-7*DAY,to:0},{kind:'expired',from:DAY,to:5*DAY},
] as const);
export type ReminderKind=typeof reminderWindows[number]['kind'];
export function dueReminder(expiresAt:number,now:number):ReminderKind|null {
 check(Number.isSafeInteger(expiresAt)&&Number.isSafeInteger(now),'INVALID_SHAPE','reminder');
 return reminderWindows.find(w=>now>=expiresAt+w.from&&now<expiresAt+w.to)?.kind??null;
}
/** Transfer-out honours the ICANN 60-day post-registration lock; the auth code goes only to the owner, never to a model. */
export function requestTransferOut({actor,registration,now}:{actor:Actor;registration:Registration|null|undefined;now:number}){
 check(registration&&plain(actor)&&actor.kind==='owner'&&actor.ownerId===registration.ownerId,'FOREIGN_OWNER',registration?.hostname??'registration');
 check(now-registration.createdAt>=domainPurchaseBounds.transferLockMs,'TRANSFER_LOCKED',registration.hostname);
 return {result:{hostname:registration.hostname,state:'auth-code-issued',delivery:'owner-only'},registration:{...registration,autoRenew:false,renewalOptIn:null}};
}
