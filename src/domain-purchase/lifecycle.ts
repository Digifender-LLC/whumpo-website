/** WH-196 lifecycle of a purchased domain over src/domain-purchase/schema.sql: renewal opt-in, renewal approval, expiry reminders, transfer-out and the way
 * a purchased name enters hosting. Same rules as store.ts: one guarded statement per transition, the schema's triggers repeat every rule, and the pure
 * renewal module decides. Nothing here charges a card or renews at a registrar: a renewal approval is the record a future charger must require, and the
 * registrar is called only to read (lookup, auth code) or, once per transfer request, to unlock. The transfer authorization code is read for the owner at
 * the moment it is shown and has no column, event, log line or error text. Unreached by any Worker until a route and a registrar adapter exist. */
import {enqueueNotice} from '../notification-outbox';
import {dueReminder,confirmAutoRenew,currentRenewalTotal,prepareAutoRenew,renewalDecision,requestTransferOut} from './renewal';
import type {Registration} from './order';
import {DomainPurchaseError,check,domainPurchaseBounds} from './quote';
import type {Actor,PurchasePolicy} from './quote';
import type {RegistrarAdapter} from './registrar';

type Db=Pick<D1Database,'prepare'|'batch'>;
export type StoredRegistration=Registration&{state:'active'|'transfer-out'|'transferred-out'|'lapsed'};
type RegistrationRow={hostname:string;order_id:string;owner_user_id:string;project_id:string;state:StoredRegistration['state'];created_at:number;expires_at:number|null;auto_renew:number;renewal_review_id:string|null;renewal_total_cents:number|null;charge_mismatch:number|null};
const registrationColumns='hostname,order_id,owner_user_id,project_id,state,created_at,expires_at,auto_renew,renewal_review_id,renewal_total_cents,charge_mismatch';
const toRegistration=(r:RegistrationRow):StoredRegistration=>({hostname:r.hostname,ownerId:r.owner_user_id,projectId:r.project_id,orderId:r.order_id,createdAt:r.created_at,expiresAt:r.expires_at,autoRenew:r.auto_renew===1,
 renewalOptIn:r.auto_renew===1?{reviewId:r.renewal_review_id as string,renewalTotalCents:r.renewal_total_cents as number}:null,chargeMismatch:r.charge_mismatch===null?null:r.charge_mismatch===1,state:r.state});

export async function loadRegistration(db:Db,ownerId:string,hostname:string){
 const r=await db.prepare(`SELECT ${registrationColumns} FROM domain_registrations WHERE hostname=?1 AND owner_user_id=?2`).bind(hostname,ownerId).first<RegistrationRow>();
 return r?toRegistration(r):null;
}
/** The owner's registrations for the Domains page. Metadata only: no contact, no auth code. */
export async function listRegistrations(db:Db,ownerId:string){
 return (await db.prepare(`SELECT ${registrationColumns} FROM domain_registrations WHERE owner_user_id=?1 ORDER BY hostname LIMIT 100`).bind(ownerId).all<RegistrationRow>()).results.map(toRegistration);
}

/** Renewal opt-in, step one: the exact review of the current renewal price. The owner or the model may prepare it; only the owner confirms. */
export async function prepareRenewalReview({db,actor,hostname,registrar,policy,reviewId,now}:{db:Db;actor:Actor;hostname:string;registrar:RegistrarAdapter;policy:PurchasePolicy;reviewId:string;now:number}){
 const registration=await loadRegistration(db,actor.ownerId,hostname);
 check(!registration||registration.state==='active','NOT_ACTIVE',hostname);
 const {review,consentText}=await prepareAutoRenew({actor,registration,registrar,policy,reviewId,now});
 await db.prepare('INSERT INTO domain_renewal_reviews(review_id,hostname,owner_user_id,renewal_total_cents,consent_text_digest,created_at,expires_at) VALUES(?,?,?,?,?,?,?)')
  .bind(review.reviewId,review.hostname,review.ownerId,review.renewalTotalCents,review.consentTextDigest,now,review.expiresAt).run();
 return {review,consentText};
}
/** Step two: the owner's exact confirmation. The price is read again, the review is single-use, and the schema turns auto-renew on in the same statement. */
export async function confirmRenewalReview({db,actor,submission,registrar,policy,now}:{db:Db;actor:Actor;submission:{reviewId?:unknown};registrar:RegistrarAdapter;policy:PurchasePolicy;now:number}){
 const row=typeof submission?.reviewId==='string'?await db.prepare('SELECT review_id,hostname,owner_user_id,renewal_total_cents,consent_text_digest,expires_at FROM domain_renewal_reviews WHERE review_id=?1 AND owner_user_id=?2')
  .bind(submission.reviewId,actor.ownerId).first<{review_id:string;hostname:string;owner_user_id:string;renewal_total_cents:number;consent_text_digest:string;expires_at:number}>():null;
 const review=row?{contractVersion:1 as const,reviewId:row.review_id,hostname:row.hostname,ownerId:row.owner_user_id,renewalTotalCents:row.renewal_total_cents,consentTextDigest:row.consent_text_digest,expiresAt:row.expires_at}:null;
 const registration=review?await loadRegistration(db,actor.ownerId,review.hostname):null;
 check(!registration||registration.state==='active','NOT_ACTIVE',registration?.hostname??'registration');
 await confirmAutoRenew({actor,submission,review,registration,registrar,policy,now});
 const won=await db.prepare('UPDATE domain_renewal_reviews SET confirmed_at=?1 WHERE review_id=?2 AND confirmed_at IS NULL AND expires_at>?1 RETURNING review_id').bind(now,review!.reviewId).first();
 check(won,'REVIEW_NOT_OPEN',review!.reviewId);
 return loadRegistration(db,actor.ownerId,review!.hostname) as Promise<StoredRegistration>;
}
/** Turning auto-renew off needs no review, and only the owner can. */
export async function turnOffAutoRenew(db:Db,actor:Actor,hostname:string){
 check(actor.kind==='owner'&&typeof actor.ownerId==='string','HUMAN_REVIEW_REQUIRED','actor');
 await db.prepare('UPDATE domain_registrations SET auto_renew=0,renewal_review_id=NULL,renewal_total_cents=NULL WHERE hostname=?1 AND owner_user_id=?2 AND auto_renew=1').bind(hostname,actor.ownerId).run();
 return loadRegistration(db,actor.ownerId,hostname);
}
/** The renewal-time decision for one name. A current opt-in covering the current price writes (or updates, so it follows the price) the one approval a
 * charger must require; a higher price turns auto-renew off, which deletes the approval in the same statement; no opt-in approves nothing. It never charges. */
export async function decideRenewal({db,hostname,registrar,policy,now}:{db:Db;hostname:string;registrar:RegistrarAdapter;policy:PurchasePolicy;now:number}){
 const row=await db.prepare(`SELECT ${registrationColumns} FROM domain_registrations WHERE hostname=?`).bind(hostname).first<RegistrationRow>();
 const registration=row?toRegistration(row):null;
 const {decision}=await renewalDecision({registration,registrar,policy});
 if(!decision.renew){
  if(decision.reason==='renewal-price-changed')await db.prepare('UPDATE domain_registrations SET auto_renew=0,renewal_review_id=NULL,renewal_total_cents=NULL WHERE hostname=?1 AND auto_renew=1').bind(hostname).run();
  return decision;
 }
 const reg=registration!,price=await currentRenewalTotal(hostname,registrar,policy);
 // The window is the schema's: 30 days before the expiry. Outside it nothing is written and the answer says so.
 if(reg.state!=='active'||reg.expiresAt===null||now>=reg.expiresAt||now<reg.expiresAt-30*86400000)return {renew:false as const,reason:'outside-renewal-window'};
 await db.prepare(`INSERT INTO domain_renewal_approvals(hostname,for_expiry,review_id,price_cents,approved_at) VALUES(?1,?2,?3,?4,?5)
  ON CONFLICT(hostname,for_expiry) DO UPDATE SET review_id=excluded.review_id,price_cents=excluded.price_cents,approved_at=excluded.approved_at`)
  .bind(hostname,reg.expiresAt,reg.renewalOptIn!.reviewId,price,now).run();
 return {renew:true as const,priceCents:price};
}

/** Read the registrar after the fact. A lookup that shows the name is ours backfills a missing expiry or records a later one. A registration that names another
 * known order is definite proof the name is no longer ours: a name in transfer-out has been transferred, any other lapses, at any time. "Not found" is not proof, so
 * a name the registrar no longer shows lapses only after its expiry. Read-only at the registrar. */
export async function syncRegistration({db,hostname,registrar,now}:{db:Db;hostname:string;registrar:RegistrarAdapter;now:number}){
 const row=await db.prepare(`SELECT ${registrationColumns} FROM domain_registrations WHERE hostname=? AND state IN ('active','transfer-out')`).bind(hostname).first<RegistrationRow>();
 if(!row)return null;
 const found=await registrar.lookup(hostname);
 const registered=found.status==='registered'&&typeof found.orderRef==='string'&&found.orderRef.length>0;
 const ours=found.status==='registered'&&found.orderRef===row.order_id;
 const left=found.status==='transferred-out'||(registered&&!ours);
 const evidence=found.status==='transferred-out'?'registrar-reported':'registered-elsewhere';
 // Every write below names this row's order, so a slow sync can never touch a new owner's row for the same name.
 if(ours&&found.status==='registered'&&Number.isSafeInteger(found.expiresAt)&&(row.expires_at===null||found.expiresAt>row.expires_at))
  await db.prepare('UPDATE domain_registrations SET expires_at=?1 WHERE hostname=?2 AND order_id=?3 AND (expires_at IS NULL OR expires_at<?1)').bind(found.expiresAt,hostname,row.order_id).run();
 else if(left){
  if(row.state==='transfer-out'){
   let open=await db.prepare(`SELECT ${transferColumns} FROM domain_transfer_requests WHERE hostname=?1 AND state IN ('requested','unlocked','unknown-outcome')`).bind(hostname).first<TransferRow>();
   // A claim still in `requested` has no edge to completed: it becomes an unknown outcome first, then completes on this evidence.
   if(open&&open.state==='requested')open=await bump(db,toTransfer(open),'unknown-outcome',now,{}).then(r=>r&&{request_id:r.requestId,hostname:r.hostname,owner_user_id:r.ownerId,state:r.state,requested_at:r.requestedAt,version:r.version});
   if(open)await db.prepare(`UPDATE domain_transfer_requests SET state='completed',completion_evidence=?1,updated_at=max(?2,updated_at),version=version+1 WHERE request_id=?3 AND version=?4`).bind(evidence,now,open.request_id,open.version).run();
  }else if(found.status==='transferred-out')await db.prepare("UPDATE domain_registrations SET state='transferred-out',auto_renew=0,renewal_review_id=NULL,renewal_total_cents=NULL WHERE hostname=?1 AND order_id=?2 AND state='active'").bind(hostname,row.order_id).run();
  else await db.prepare("UPDATE domain_registrations SET state='lapsed',auto_renew=0,renewal_review_id=NULL,renewal_total_cents=NULL WHERE hostname=?1 AND order_id=?2 AND state='active'").bind(hostname,row.order_id).run();
 }
 else if(found.status==='not-found'&&row.state==='active'&&row.expires_at!==null&&now>=row.expires_at)
  await db.prepare("UPDATE domain_registrations SET state='lapsed',auto_renew=0,renewal_review_id=NULL,renewal_total_cents=NULL WHERE hostname=?1 AND order_id=?2 AND state='active' AND expires_at<=?3").bind(hostname,row.order_id,now).run();
 const next=await db.prepare(`SELECT ${registrationColumns} FROM domain_registrations WHERE hostname=?`).bind(hostname).first<RegistrationRow>();
 return next?toRegistration(next):null;
}

/** Reminders for names whose expiry window has opened (and for a lapsed name, its expired notice). One notice per name, kind and expiry (a duplicate queues nothing),
 * through the shared outbox: the row is the only effect. Content-free by design (no name in the email); queued rows are never sent while the sender gate is closed.
 * Names already reminded sit earlier in the order, so the scan pages by (expiry, name) until `limit` notices are queued instead of re-reading the same first rows. */
export async function queueDueReminders(db:Db,now:number,limit=100){
 check(Number.isSafeInteger(limit)&&limit>0&&limit<=500,'INVALID_LIMIT','limit');
 let queued=0,afterExpiry=-1,afterName='';
 for(let page=0;page<50&&queued<limit;page++){
  const rows=(await db.prepare(`SELECT hostname,owner_user_id,state,expires_at FROM domain_registrations WHERE state IN ('active','transfer-out','lapsed') AND expires_at BETWEEN ?1 AND ?2
   AND (expires_at>?3 OR (expires_at=?3 AND hostname>?4)) ORDER BY expires_at,hostname LIMIT 100`).bind(now-5*86400000,now+30*86400000,afterExpiry,afterName).all<{hostname:string;owner_user_id:string;state:string;expires_at:number}>()).results;
  if(!rows.length)break;
  for(const r of rows){
   afterExpiry=r.expires_at;afterName=r.hostname;
   const kind=dueReminder(r.expires_at,now);
   if(!kind||(r.state==='lapsed'&&kind!=='expired'))continue;
   const result=await enqueueNotice(db as D1Database,{userId:r.owner_user_id,scope:'account-email',template:`domain.expiry-${kind}@1`,eventRef:`${r.hostname}:${kind}:${r.expires_at}`,now});
   if(result.queued&&++queued>=limit)break;
  }
 }
 return {queued};
}

type TransferRow={request_id:string;hostname:string;owner_user_id:string;state:'requested'|'unlocked'|'unknown-outcome'|'failed'|'completed';requested_at:number;version:number};
const transferColumns='request_id,hostname,owner_user_id,state,requested_at,version';
const toTransfer=(r:TransferRow)=>({requestId:r.request_id,hostname:r.hostname,ownerId:r.owner_user_id,state:r.state,requestedAt:r.requested_at,version:r.version});
export type TransferRequest=ReturnType<typeof toTransfer>;
async function moveTransfer(db:Db,r:TransferRequest,to:TransferRequest['state'],now:number){
 const row=await db.prepare(`UPDATE domain_transfer_requests SET state=?1,updated_at=?2,version=version+1 WHERE request_id=?3 AND version=?4 RETURNING ${transferColumns}`).bind(to,now,r.requestId,r.version).first<TransferRow>();
 return row?toTransfer(row):null;
}
export const loadTransfer=async(db:Db,ownerId:string,hostname:string)=>{
 const r=await db.prepare(`SELECT ${transferColumns} FROM domain_transfer_requests WHERE hostname=?1 AND owner_user_id=?2 ORDER BY requested_at DESC LIMIT 1`).bind(hostname,ownerId).first<TransferRow>();
 return r?toTransfer(r):null;
};
/** Owner-only transfer-out. The request is claimed in D1 before the registrar is asked, the registrar is asked at most once per request, and a repeat
 * (a lost response, a second tab) returns the existing request without another provider call. A lost or malformed answer is an unknown outcome that
 * `reconcileTransfers` settles by reading. The response never contains the authorization code. */
export async function startTransferOut({db,actor,hostname,registrar,requestId,now}:{db:Db;actor:Actor;hostname:string;registrar:RegistrarAdapter;requestId:string;now:number}){
 const registration=await loadRegistration(db,actor.ownerId,hostname);
 const prior=registration?await loadTransfer(db,actor.ownerId,hostname):null;
 if(prior&&['requested','unlocked','unknown-outcome'].includes(prior.state))return {request:prior,replayed:true as const};
 check(registration?.state==='active','NOT_ACTIVE',hostname);
 requestTransferOut({actor,registration,now});// owner only, and the 60-day lock
 let claimed:TransferRow|null;
 try{
  claimed=await db.prepare(`INSERT INTO domain_transfer_requests(request_id,hostname,owner_user_id,state,requested_at,updated_at) VALUES(?1,?2,?3,'requested',?4,?4) ON CONFLICT DO NOTHING RETURNING ${transferColumns}`)
   .bind(requestId,hostname,actor.ownerId,now).first<TransferRow>();
 }catch{
  // A concurrent start won: the schema refuses a second claim for a name already in transfer-out. Replay the winner; anything else is the lock.
  const open=await loadTransfer(db,actor.ownerId,hostname);
  if(open&&['requested','unlocked','unknown-outcome'].includes(open.state))return {request:open,replayed:true as const};
  throw new DomainPurchaseError('TRANSFER_LOCKED',hostname);
 }
 if(!claimed){const open=await loadTransfer(db,actor.ownerId,hostname);if(open)return {request:open,replayed:true as const};throw new DomainPurchaseError('TRANSFER_UNAVAILABLE',hostname);}
 let result:unknown;
 try{result=await registrar.beginTransferOut({hostname,requestRef:requestId});}catch{result={kind:'lost'};}
 const kind=(result as {kind?:unknown})?.kind;
 const to=kind==='unlocked'?'unlocked':kind==='rejected'?'failed':'unknown-outcome';
 const request=await moveTransfer(db,toTransfer(claimed),to,now);
 // A sweep or another worker moved the claim first: return the request as it stands now, never null.
 if(!request)return {request:await loadTransfer(db,actor.ownerId,hostname) as TransferRequest,replayed:true as const};
 return {request,replayed:false as const};
}
/** Settle unknown or open transfers by reading the registrar. Only positive evidence completes one: a registration naming another order, or the registrar's own
 * transfer-complete report. Absence ("not found", a lookup gap, an outage) is never evidence, however often it repeats; a request that stays open is failed after
 * fourteen days by `sweepTransfers`, which returns the name to active. "Unlocked" is the registrar's own report. Reads are spaced and round-robin (least recently
 * touched first); one failing lookup costs that request one retry; nothing repeats the unlock. */
export async function reconcileTransfers(db:Db,registrar:RegistrarAdapter,now:number,limit=20){
 const rows=(await db.prepare(`SELECT ${transferColumns} FROM domain_transfer_requests WHERE state IN ('unknown-outcome','unlocked') AND updated_at<=?2 ORDER BY updated_at LIMIT ?1`).bind(limit,now-domainPurchaseBounds.reconcileSpacingMs).all<TransferRow>()).results;
 let moved=0;
 for(const row of rows){
  try{
   const r=toTransfer(row),found=await registrar.lookup(r.hostname);
   let result:TransferRequest|null=null;
   if(found.status==='transferred-out')result=await bump(db,r,'completed',now,{evidence:'registrar-reported'});
   else if(found.status==='registered'&&typeof found.orderRef==='string'&&found.orderRef.length>0&&!(await ours(db,r.hostname,found.orderRef)))
    result=await bump(db,r,'completed',now,{evidence:'registered-elsewhere'});
   else if(found.status==='registered'&&found.unlocked===true&&r.state==='unknown-outcome')result=await bump(db,r,'unlocked',now,{});
   else result=await bump(db,r,r.state,now,{});// touched, nothing proven: it goes to the back of the line
   if(result&&result.state!==r.state)moved++;
  }catch{/* one failing lookup costs this request one retry later */}
 }
 return {moved};
}
const ours=async(db:Db,hostname:string,orderRef:string)=>!!await db.prepare('SELECT 1 x FROM domain_registrations WHERE hostname=?1 AND order_id=?2').bind(hostname,orderRef).first();
async function bump(db:Db,r:TransferRequest,to:TransferRequest['state'],now:number,{evidence}:{evidence?:'registered-elsewhere'|'registrar-reported'}){
 const row=await db.prepare(`UPDATE domain_transfer_requests SET state=?1,updated_at=max(?2,updated_at),version=version+1,completion_evidence=coalesce(?3,completion_evidence) WHERE request_id=?4 AND version=?5 RETURNING ${transferColumns}`)
  .bind(to,now,evidence??null,r.requestId,r.version).first<TransferRow>();
 return row?toTransfer(row):null;
}
/** A transfer request no worker will finish never traps the owner: a claim older than the lease becomes an unknown outcome, and a request that stays unresolved or
 * unlocked longer than fourteen days is failed, which returns the name to active so the owner can start again (a repeat unlock is safe; nothing is lost). */
export async function sweepTransfers(db:Db,now:number,limit=50){
 let moved=0;
 const stuck=(await db.prepare(`SELECT ${transferColumns} FROM domain_transfer_requests WHERE state='requested' AND updated_at<=?1 LIMIT ?2`).bind(now-domainPurchaseBounds.leaseMs,limit).all<TransferRow>()).results;
 for(const row of stuck){try{if(await bump(db,toTransfer(row),'unknown-outcome',now,{}))moved++;}catch{/* next */}}
 const old=(await db.prepare(`SELECT ${transferColumns} FROM domain_transfer_requests WHERE state IN ('unknown-outcome','unlocked') AND requested_at<=?1 LIMIT ?2`).bind(now-14*86400000,limit).all<TransferRow>()).results;
 for(const row of old){try{if(await bump(db,toTransfer(row),'failed',now,{}))moved++;}catch{/* next */}}
 return {moved};
}
/** The owner leaves the transfer: an open request that is not yet completed is failed and the name returns to active. Owner only. */
export async function cancelTransfer(db:Db,actor:Actor,hostname:string,now:number){
 check(actor.kind==='owner'&&typeof actor.ownerId==='string','HUMAN_REVIEW_REQUIRED','actor');
 const open=await loadTransfer(db,actor.ownerId,hostname);
 check(open&&['requested','unknown-outcome','unlocked'].includes(open.state),'NO_OPEN_TRANSFER',hostname);
 return bump(db,open,'failed',now,{});
}
/** The authorization code for the owner of an unlocked name, read from the registrar now. Owners only: a model, visitor, service or operator is refused, and the
 * code is returned to this caller alone, never stored, logged or put in an error. */
export async function readAuthCode({db,actor,hostname,registrar}:{db:Db;actor:Actor;hostname:string;registrar:RegistrarAdapter}){
 check(actor?.kind==='owner'&&typeof actor.ownerId==='string','AUTH_CODE_OWNER_ONLY','actor');
 const transfer=await loadTransfer(db,actor.ownerId,hostname);
 const registration=await loadRegistration(db,actor.ownerId,hostname);
 check(transfer&&transfer.state==='unlocked'&&registration?.state==='transfer-out','TRANSFER_NOT_UNLOCKED',hostname);
 let found:unknown;
 try{found=await registrar.authCode(hostname);}catch{throw new DomainPurchaseError('AUTH_CODE_UNAVAILABLE',hostname);}
 const code=(found as {code?:unknown})?.code;
 check(typeof code==='string'&&code.length>0&&code.length<=128,'AUTH_CODE_UNAVAILABLE',hostname);
 return {hostname,authCode:code};
}

/** G-D8, decided: a purchased name enters hosting through the same ownership claim as any name, with registrar evidence as the proof instead of a DNS
 * TXT record. The claim is written (verified now) only for the owner of an active registration of that exact name in that project, and expires like
 * a TXT claim, so hosting review and confirmation are unchanged. Buying a name never connects it. */
export async function claimPurchasedName({db,actor,projectId,hostname,now,windowMs=7*86400000}:{db:Db;actor:Actor;projectId:string;hostname:string;now:number;windowMs?:number}){
 check(actor.kind==='owner'&&typeof actor.ownerId==='string','HUMAN_REVIEW_REQUIRED','actor');
 const at=new Date(now).toISOString(),expires=new Date(now+windowMs).toISOString(),token='registrar-evidence:'+[...crypto.getRandomValues(new Uint8Array(16))].map(b=>b.toString(16).padStart(2,'0')).join('');
 const row=await db.prepare(`INSERT INTO domain_claims(id,project_id,hostname,token,expires_at,verified_at,created_at)
  SELECT ?1,g.project_id,g.hostname,?2,?3,?4,?4 FROM domain_registrations g WHERE g.hostname=?5 AND g.owner_user_id=?6 AND g.project_id=?7 AND g.state='active' AND g.expires_at>?8
  ON CONFLICT(project_id,hostname) DO UPDATE SET token=excluded.token,expires_at=excluded.expires_at,verified_at=excluded.verified_at RETURNING id`)
  .bind(crypto.randomUUID(),token,expires,at,hostname,actor.ownerId,projectId,now).first<{id:string}>();
 check(row,'NOT_REGISTERED',hostname);
 return {claimId:row.id};
}
