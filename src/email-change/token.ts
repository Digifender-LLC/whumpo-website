/** WH-063 / WH-200 confirmation tokens and notice delivery (contract version 1, docs/email-change-and-compromise.md).
 * The token is 256 random bits (base64url), minted only inside a claimed delivery attempt. Its SHA-256 verifier is
 * written with the claim, before the provider call; the plaintext exists only in that one mailer call and the
 * recipient's mailbox, never in a record, notice, receipt or log. The only effectful dependency is the mailer, and
 * only deliverNotice calls it, once per claimed attempt, after the caller commits the claim. No provider is
 * implemented here: platform delivery is WH-036/WH-202, and the synthetic mailer below is for tests only. */
import {hashToken} from '../security';
import {check,emailChangeBounds,platformSender} from './policy';
import type {MessageKind} from './policy';
import {moved} from './change';
import type {EmailChange,NoticeDraft} from './change';

export const noticeStates=Object.freeze(['queued','dispatching','accepted','failed','unknown-outcome','cancelled'] as const);
export type NoticeState=typeof noticeStates[number];
/** A queued account notice. Content-free: it holds no token, no other address and no account content. */
export type Notice=NoticeDraft&{noticeId:string;state:NoticeState;attempts:number;queuedAt:number};
/** What reaches the mailer. `token` is present only on the new-address confirmation. */
export type PlatformMessage={from:string;displayName:string;to:string;kind:MessageKind;noticeId:string;token?:string};
/** accepted; deferred (definitely not sent, retry with a new token); rejected or suppressed (definitely not sent, stop).
 * Anything else, including a throw or a lost response, is an unknown outcome and is never redispatched. */
export type SendOutcome='accepted'|'deferred'|'rejected'|'suppressed';
export interface PlatformMailer {send(message:PlatformMessage):Promise<SendOutcome|unknown>|SendOutcome|unknown}

const base64url=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
/** 256 random bits, base64url (43 characters). */
export const mintConfirmationToken=()=>base64url(crypto.getRandomValues(new Uint8Array(32)));
/** The stored verifier for a presented token, or null when the value cannot be a token (counted as a failed attempt). */
export async function tokenVerifier(token:unknown):Promise<string|null> {
 return typeof token==='string'&&token.length>0&&token.length<=emailChangeBounds.maxTokenLength?hashToken(token):null;
}
export const queueNotice=(draft:NoticeDraft,noticeId:string,now:number):Notice=>({...draft,noticeId,state:'queued',attempts:0,queuedAt:now});

export type DeliveryInput={
 notice:Notice;
 /** The change named by notice.changeId, if any, read with the notice. */
 change:EmailChange|null;
 mailer:PlatformMailer;
 /** Commits the claimed notice and change (with the token verifier) under their revision guards. Returning false
  * means another worker claimed first: nothing is sent. The plaintext token is never passed to claim. */
 claim:(notice:Notice,change:EmailChange|null)=>Promise<boolean>|boolean;
 now:number;
};
export type DeliveryStep={notice:Notice;change:EmailChange|null;outcome:'accepted'|'deferred'|'failed'|'unknown'|'cancelled'|'not-claimed'|'not-queued'};

/** One delivery attempt for one queued notice. A confirmation for a change that is no longer pending (superseded,
 * cancelled, closed) or has expired is cancelled unsent. A notice left `dispatching` by an interrupted worker is never
 * picked up again: it is an unknown outcome, and the change simply expires if the message never arrived. */
export async function deliverNotice({notice,change,mailer,claim,now}:DeliveryInput):Promise<DeliveryStep> {
 if(notice.state!=='queued')return {notice,change,outcome:'not-queued'};
 const confirmation=notice.kind==='confirm-new-address';
 if(confirmation&&(!change||change.changeId!==notice.changeId||change.state!=='pending'||now>=change.expiresAt))return {notice:{...notice,state:'cancelled'},change,outcome:'cancelled'};
 let token:string|null=null,claimedChange=change;
 if(confirmation&&change){token=mintConfirmationToken();claimedChange={...change,tokenVerifier:await hashToken(token),revision:change.revision+1};}
 const claimed:Notice={...notice,state:'dispatching',attempts:notice.attempts+1};
 if(!await claim(claimed,claimedChange))return {notice,change,outcome:'not-claimed'};
 const message:PlatformMessage={from:platformSender.address,displayName:platformSender.displayName,to:notice.to,kind:notice.kind,noticeId:notice.noticeId,...(token?{token}:{})};
 let outcome:unknown;
 try{outcome=await mailer.send(message);}catch{outcome='unknown';}
 if(outcome==='accepted')return {notice:{...claimed,state:'accepted'},change:claimedChange,outcome:'accepted'};
 if(outcome==='deferred')return {notice:{...claimed,state:'queued'},change:confirmation&&claimedChange?{...claimedChange,tokenVerifier:null,revision:claimedChange.revision+1}:claimedChange,outcome:'deferred'};
 if(outcome==='rejected'||outcome==='suppressed')return {notice:{...claimed,state:'failed'},change:confirmation&&claimedChange?{...moved(claimedChange,'undeliverable',String(outcome)),tokenVerifier:null}:claimedChange,outcome:'failed'};
 return {notice:{...claimed,state:'unknown-outcome'},change:claimedChange,outcome:'unknown'};
}

/** Synthetic in-memory mailer for tests: no network and no provider. It accepts only recipients under the reserved
 * `.test` top-level domain (RFC 2606) and rejects every other address, so no real mailbox can be addressed. `decide`
 * scripts an outcome per message ('throw' simulates a lost response). `delivered` holds what reached a mailbox
 * (accepted, or unknown outcomes that did arrive). */
export function createSyntheticMailer({decide=()=>'accepted'}:{decide?:(message:PlatformMessage)=>SendOutcome|'unknown'|'throw'}={}){
 const calls:PlatformMessage[]=[],delivered:PlatformMessage[]=[];
 return {
  calls,delivered,
  async send(message:PlatformMessage):Promise<SendOutcome|'unknown'>{
   check(message.from===platformSender.address,'INVALID_SENDER',message.from);
   calls.push({...message});
   if(!/^[^@\s]+@(?:[a-z0-9-]+\.)+test$/.test(message.to))return 'rejected';
   const outcome=decide(message);
   if(outcome==='accepted'||outcome==='unknown')delivered.push({...message});
   if(outcome==='throw')throw new Error('synthetic transport loss');
   return outcome;
  },
 } satisfies PlatformMailer&Record<string,unknown>;
}
