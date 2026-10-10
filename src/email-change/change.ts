/** WH-063 / WH-200 verified address change state machine (contract version 1, docs/email-change-and-compromise.md).
 * Each step takes plain records (the resolved principal, the account email state, the change rows the caller read)
 * and returns the next records plus the notices to queue, without storing anything. The caller persists the result
 * with a revision guard (every transition writes `revision+1` and must find the prior revision still current), and
 * persists a step's records before reporting its `refusal`. The WH-201 storage slice must repeat each predicate in its
 * committing statement. The confirmation token is never created here: token.ts mints it inside the claimed delivery
 * attempt, and only its SHA-256 verifier ever reaches a record. */
import {hashToken} from '../security';
import {authorizeOwner,check,closedInput,contractVersion,emailChangeBounds,normalizeAddress,platformSender,requestIdentifier,within} from './policy';
import type {AccountEmail,MessageKind,OwnerPrincipal} from './policy';

export const changeStates=Object.freeze(['pending','confirmed','undone','cancelled','superseded','stale','expired','undeliverable','unavailable'] as const);
export type ChangeState=typeof changeStates[number];
/** Allowed transitions. Only `pending` can confirm; only `confirmed` can be undone; nothing returns to `pending`. */
export const changeTransitions:Readonly<Record<ChangeState,readonly ChangeState[]>>=Object.freeze({
 pending:['confirmed','cancelled','superseded','stale','expired','undeliverable','unavailable'],
 confirmed:['undone'],
 undone:[],cancelled:[],superseded:[],stale:[],expired:[],undeliverable:[],unavailable:[],
});
export type PreviousAddress={address:string;verifiedAt:number|null;verifiedVia:string|null};
export type ConfirmReceipt={changeId:string;status:'confirmed';email:string;verifiedAt:number};
export type EmailChange={
 contractVersion:1;changeId:string;accountId:string;requestId:string;requestHash:string;newAddress:string;
 /** Authority epoch at request time; any advance before confirmation makes the change stale. */
 epoch:number;createdAt:number;expiresAt:number;state:ChangeState;revision:number;history:string[];
 /** False when the address is used or reserved by another account, or its daily message bound is spent: no
  * confirmation is ever sent, and the requester sees the same response. */
 deliverable:boolean;
 /** SHA-256 verifier of the token minted in the current delivery attempt; never the plaintext. */
 tokenVerifier:string|null;
 /** Set on confirmation: the address and verification state restored by undo, reserved until undoUntil. */
 previous:PreviousAddress|null;undoUntil:number|null;receipt:ConfirmReceipt|null;
};
export type NoticeDraft={kind:MessageKind;changeId:string|null;to:string};
export type ChangeRequest={requestId:string;newAddress:string};
export type PendingResponse={status:'pending-confirmation';changeId:string;expiresAt:number};
/** Records a caller found for an address: accounts whose current email is that address, and confirmed changes whose
 * previous address is that address. addressReserved decides; the requester's own records never reserve. */
export type AddressHolders={accounts:readonly Pick<AccountEmail,'accountId'|'email'>[];changes:readonly EmailChange[]};
export type Refusal={code:string;detail:string};
export type ChangeStep<R>={
 changes:EmailChange[];account:AccountEmail|null;notices:NoticeDraft[];
 limits:{requests?:number[];addressSends?:number[];failures?:number[]}|null;result:R|null;refusal:Refusal|null;
};
const step=<R>(parts:Partial<ChangeStep<R>>):ChangeStep<R>=>({changes:[],account:null,notices:[],limits:null,result:null,refusal:null,...parts});

export function moved(change:EmailChange,to:ChangeState,reason?:string):EmailChange {
 check(changeTransitions[change.state].includes(to),'INVALID_TRANSITION',`${change.state}->${to}`);
 return {...change,state:to,revision:change.revision+1,history:[...change.history,reason?`${to}:${reason}`:to]};
}
/** The one response shape for every accepted request, whether or not a confirmation will be sent. */
export const pendingResponse=(change:EmailChange):PendingResponse=>({status:'pending-confirmation',changeId:change.changeId,expiresAt:change.expiresAt});
/** Per-address daily message key: the limits table stores this hash, never the address. */
export const addressKey=(address:string)=>hashToken(`email-change-address:${address}`);

/** True when another account uses the address, or holds it as the previous address inside its undo window. */
export function addressReserved(address:string,accountId:string,holders:AddressHolders,now:number):boolean {
 return holders.accounts.some(a=>a.accountId!==accountId&&a.email===address)
  ||holders.changes.some(c=>c.accountId!==accountId&&c.state==='confirmed'&&c.previous?.address===address&&c.undoUntil!==null&&now<c.undoUntil);
}

export function parseChangeRequest(input:unknown):ChangeRequest {
 const data=closedInput(input,['version','requestId','newAddress']);
 return {requestId:requestIdentifier(data.requestId),newAddress:normalizeAddress(data.newAddress)};
}
export function parseConfirmation(input:unknown):{token:unknown} {
 return {token:closedInput(input,['version','token']).token};
}
export function parseChangeReference(input:unknown):{changeId:string} {
 const data=closedInput(input,['version','changeId']);
 check(typeof data.changeId==='string'&&/^[A-Za-z0-9-]{1,64}$/.test(data.changeId),'UNKNOWN_CHANGE');
 return {changeId:data.changeId};
}

export type RequestInput={
 principal:OwnerPrincipal|null;account:AccountEmail;request:ChangeRequest;
 /** False while platform delivery (WH-036) is not active: the request is refused and nothing is stored. */
 deliveryActive:boolean;
 /** This account's change with the same request ID, if any (any state). */
 prior:EmailChange|null;
 /** This account's current pending change, if any. */
 pending:EmailChange|null;
 holders:AddressHolders;
 /** Request times for this account, and confirmation-message times for addressKey(newAddress). */
 limits:{requests:readonly number[];addressSends:readonly number[]};
 changeId:string;now:number;
};
/** Request a change (fresh passkey). Supersedes any earlier pending change and queues the new-address confirmation
 * (when deliverable) and a content-free notice to the current address, in one step. */
export async function requestEmailChange({principal,account,request,deliveryActive,prior,pending,holders,limits,changeId,now}:RequestInput):Promise<ChangeStep<PendingResponse>> {
 authorizeOwner(principal,account,{fresh:true,now});
 check(deliveryActive,'DELIVERY_UNAVAILABLE');
 const requestHash=await hashToken(JSON.stringify(['email-change',contractVersion,account.accountId,request.requestId,request.newAddress]));
 if(prior){check(prior.accountId===account.accountId&&prior.requestHash===requestHash,'REQUEST_CONFLICT',request.requestId);return step({result:pendingResponse(prior)});}
 check(request.newAddress!==account.email,'NO_CHANGE');
 const recent=within(limits.requests,emailChangeBounds.limitWindowMs,now);
 check(recent.length<emailChangeBounds.requestsPerAccountPerDay,'RATE_LIMITED','requests');
 const superseded=pending&&pending.state==='pending'?[moved(pending,'superseded','new-request')]:[];
 const reserved=addressReserved(request.newAddress,account.accountId,holders,now);
 const sends=within(limits.addressSends,emailChangeBounds.limitWindowMs,now);
 const deliverable=!reserved&&sends.length<emailChangeBounds.messagesPerAddressPerDay;
 const change:EmailChange={contractVersion,changeId,accountId:account.accountId,requestId:request.requestId,requestHash,newAddress:request.newAddress,
  epoch:account.authEpoch,createdAt:now,expiresAt:now+emailChangeBounds.tokenLifetimeMs,state:'pending',revision:1,history:['pending'],
  deliverable,tokenVerifier:null,previous:null,undoUntil:null,receipt:null};
 const notices:NoticeDraft[]=[];
 if(deliverable)notices.push({kind:'confirm-new-address',changeId,to:request.newAddress});
 notices.push({kind:'change-requested',changeId,to:account.email});
 return step({changes:[...superseded,change],notices,result:pendingResponse(change),
  limits:{requests:[...recent,now],addressSends:deliverable?[...sends,now]:sends}});
}

export type ConfirmInput={
 principal:OwnerPrincipal|null;account:AccountEmail;
 /** tokenVerifier(token) of the presented token, or null when it was not a usable token. */
 verifier:string|null;
 /** The change whose stored verifier equals `verifier`, if any. */
 change:EmailChange|null;
 /** Holders of change.newAddress, read in the same snapshot. */
 holders:AddressHolders;
 /** Failed confirmation times for this account. */
 failures:readonly number[];now:number;
};
/** Confirm with BOTH the emailed token and the owner's current ordinary session for the same account. A link alone,
 * or a token presented by another account, never changes the account. A replay by the same account returns the saved
 * receipt with no second effect. */
export function confirmEmailChange({principal,account,verifier,change,holders,failures,now}:ConfirmInput):ChangeStep<ConfirmReceipt> {
 authorizeOwner(principal,account,{fresh:false,now});
 const recent=within(failures,emailChangeBounds.failureWindowMs,now);
 check(recent.length<emailChangeBounds.confirmFailuresPerHour,'RATE_LIMITED','confirmations');
 if(!change||verifier===null||change.tokenVerifier!==verifier||change.accountId!==account.accountId)return step({limits:{failures:[...recent,now]},refusal:{code:'INVALID_TOKEN',detail:''}});
 if(change.state==='confirmed')return step({result:change.receipt});
 check(change.state!=='superseded','STALE_CHANGE','superseded');
 check(change.state==='pending','CHANGE_CLOSED',change.state);
 if(now>=change.expiresAt)return step({changes:[moved(change,'expired')],refusal:{code:'TOKEN_EXPIRED',detail:''}});
 if(change.epoch!==account.authEpoch)return step({changes:[moved(change,'stale','epoch')],refusal:{code:'STALE_CHANGE',detail:'epoch'}});
 if(addressReserved(change.newAddress,account.accountId,holders,now))return step({changes:[moved(change,'unavailable')],refusal:{code:'ADDRESS_UNAVAILABLE',detail:''}});
 const previous:PreviousAddress={address:account.email,verifiedAt:account.verifiedAt,verifiedVia:account.verifiedVia};
 const receipt:ConfirmReceipt={changeId:change.changeId,status:'confirmed',email:change.newAddress,verifiedAt:now};
 // The verifier is kept on the confirmed row so a replay of the same token by the same account reads this receipt.
 const confirmed:EmailChange={...moved(change,'confirmed'),previous,undoUntil:now+emailChangeBounds.undoWindowMs,receipt};
 return step({changes:[confirmed],account:{...account,email:change.newAddress,verifiedAt:now,verifiedVia:platformSender.address},
  notices:[{kind:'change-completed',changeId:change.changeId,to:previous.address}],result:receipt});
}

export type ChangeReferenceInput={principal:OwnerPrincipal|null;account:AccountEmail;changeId:string;change:EmailChange|null;now:number};
/** Cancel a pending change from any current ordinary session. Idempotent; never reopens a closed change. */
export function cancelEmailChange({principal,account,change,now}:ChangeReferenceInput):ChangeStep<{changeId:string;status:'cancelled'}> {
 authorizeOwner(principal,account,{fresh:false,now});
 check(change&&change.accountId===account.accountId,'UNKNOWN_CHANGE');
 const result={changeId:change.changeId,status:'cancelled' as const};
 if(change.state==='cancelled')return step({result});
 check(change.state==='pending','CHANGE_CLOSED',change.state);
 return step({changes:[moved(change,'cancelled','owner')],result});
}
/** Undo a confirmed change inside the undo window (fresh passkey). Restores the previous address with its previous
 * verification state (it never invents verification), notifies both addresses and closes the token. */
export function undoEmailChange({principal,account,change,now}:ChangeReferenceInput):ChangeStep<{changeId:string;status:'undone';email:string}> {
 authorizeOwner(principal,account,{fresh:true,now});
 check(change&&change.accountId===account.accountId,'UNKNOWN_CHANGE');
 check(change.state==='confirmed'&&change.previous!==null&&change.undoUntil!==null&&now<change.undoUntil&&account.email===change.newAddress,'UNDO_UNAVAILABLE');
 const previous=change.previous;
 return step({changes:[moved(change,'undone')],
  account:{...account,email:previous.address,verifiedAt:previous.verifiedAt,verifiedVia:previous.verifiedVia},
  notices:[{kind:'change-undone',changeId:change.changeId,to:change.newAddress},{kind:'change-undone',changeId:change.changeId,to:previous.address}],
  result:{changeId:change.changeId,status:'undone',email:previous.address}});
}
/** Owner read. The pending view has the same shape whether or not a confirmation was sent. */
export function readAccountEmail({principal,account,pending,now}:{principal:OwnerPrincipal|null;account:AccountEmail;pending:EmailChange|null;now:number}) {
 authorizeOwner(principal,account,{fresh:false,now});
 const open=pending&&pending.accountId===account.accountId&&pending.state==='pending'&&now<pending.expiresAt;
 return {email:account.email,verified:account.verifiedAt!==null,pending:open?{changeId:pending.changeId,expiresAt:pending.expiresAt}:null};
}
