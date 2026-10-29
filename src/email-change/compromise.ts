/** WH-063 / WH-203 compromise review (contract version 1, docs/email-change-and-compromise.md section 3). Pure
 * functions over plain records: each step takes the server-resolved principal and the rows the caller read, and returns
 * the next rows, the notices to queue and the result, without storing anything. The caller persists a step in one
 * guarded batch: every review, change and connection write is revision-guarded (it must find the prior revision still
 * current), and the WH-201 storage slice must repeat each predicate (epoch, fresh passkey, review binding) inside the
 * committing statements, as the identity engine does.
 *
 * A compromise review is not lost-passkey recovery. The owner proves a fresh passkey on a current ordinary session,
 * reads one snapshot bound to the authority epoch, credential revision, kit generation and connection set, and secures
 * the account in one commit that removes the selected passkeys (emergency removal may go below two keys, down to zero),
 * advances the epoch (revoking every session, grant, challenge and kit offer, including the initiating session),
 * activates a saved replacement kit, closes a pending email change, disables the selected provider connections and
 * queues their revocation with the encrypted credential retained (revocation.ts). The receipt is content-free and
 * never claims to recover encrypted content. No password, recovery code, email link, support statement or Chat approval
 * is accepted anywhere here.
 *
 * WH-200 parts: pendingChangeForReview (the snapshot entry) and closeForSecurityReview (cancels a pending change inside
 * the commit and does nothing on a replay). Authority from before the commit is fenced by authorizeOwner (policy.ts),
 * admitSignIn and the stale-change rule in confirmEmailChange. */
import {hashToken} from '../security';
import {authorizeOwner,check,closedInput,contractVersion,normalizeAddress,plain,requestIdentifier} from './policy';
import type {AccountEmail,OwnerPrincipal} from './policy';
import {moved} from './change';
import type {EmailChange,NoticeDraft} from './change';
import {disableForReview} from './revocation';
import type {ProviderConnection,RevocationState} from './revocation';

const MIN=60000;
/** Recommended v1 values. reviewMs is the snapshot lifetime; kitOfferMs is the shared kit offer lifetime
 * (docs/identity-kits.md, thirty minutes); a review's offer is also bounded by the review. */
export const compromiseBounds=Object.freeze({reviewMs:10*MIN,kitOfferMs:30*MIN});
/** Authority rows a commit revokes: every row issued under an earlier epoch is deleted in the committing batch. The
 * same tables the identity engine's emergency removal deletes (removePasskey in src/workspace-identity/recovery.ts). */
export const revokedAuthority=Object.freeze(['sessions','grants','challenges','kitOffers'] as const);
/** What a restricted recovery grant may do: the shared restricted enrollment operations only. It never reaches email,
 * connection, export, project or compromise-review operations (authorizeOwner refuses it with IDENTITY_INCOMPLETE). */
export const recoveryGrantOperations=Object.freeze(['review_loss','add_passkey','kit','help','logout'] as const);

/** The account's identity state used by a review: the email state plus the passkey set, credential revision and kit.
 * `credentials` lists the active passkey IDs. `kitVerifier` is the SHA-256 verifier of the current kit key. */
export type SecurityAccount=AccountEmail&{credentials:readonly string[];credentialRevision:number;kitGeneration:number;kitVerifier:string};
/** Non-secret session metadata shown in the snapshot. Never a token or its hash. */
export type SessionSummary={sessionId:string;credentialId:string|null;issuedAt:number};
export type ReviewState='open'|'committed';
export type SecurityReview={
 contractVersion:1;reviewId:string;accountId:string;
 /** The binding: a commit is refused as STALE_REVIEW unless all of these are still current. */
 epoch:number;credentialRevision:number;kitGeneration:number;credentials:readonly string[];connections:readonly string[];
 createdAt:number;expiresAt:number;state:ReviewState;revision:number;
};
/** A replacement kit offered inside a review. Only the verifier is stored; the plaintext key goes to the owner once. */
export type ReviewKitOffer={offerId:string;accountId:string;reviewId:string;epoch:number;verifier:string;createdAt:number;expiresAt:number;savedAt:number|null};
export type ReviewSnapshot={
 reviewId:string;expiresAt:number;credentials:string[];sessions:SessionSummary[];kitGeneration:number;
 pendingEmailChange:{changeId:string;expiresAt:number}|null;
 connections:{connectionId:string;provider:string;access:'active'|'disabled';revocation:RevocationState}[];
 /** Account recovery is not content recovery: Whumpo holds no customer content keys. */
 accountRecoveryOnly:true;
};
export type ReviewReceipt={
 reviewId:string;epoch:number;stage:SecurityAccount['stage'];revokedCredentials:string[];kitRotated:boolean;
 pendingEmailChange:'cancelled'|null;connections:{connectionId:string;access:'disabled';revocation:RevocationState}[];
 sessionsRevoked:'all';accountRecoveryOnly:true;
};
/** The saved effect receipt for one request ID: a replay with the same payload reads it, a changed payload conflicts. */
export type SavedReviewReceipt={accountId:string;requestId:string;requestHash:string;receipt:ReviewReceipt;committedAt:number};
export type ReviewCommitRequest={requestId:string;reviewId:string;revokeCredentials:string[];rotateKit:{offerId:string}|null;revokeConnections:string[]};

/** Snapshot entry for the review: the open pending change, if any. */
export function pendingChangeForReview(change:EmailChange|null,now:number):{changeId:string;expiresAt:number}|null {
 return change&&change.state==='pending'&&now<change.expiresAt?{changeId:change.changeId,expiresAt:change.expiresAt}:null;
}
/** Applied inside the compromise commit. A pending change is cancelled (its token is then refused as closed);
 * any other state is returned unchanged, so a replayed or competing commit has no second effect. */
export function closeForSecurityReview(change:EmailChange):EmailChange {
 if(change.state!=='pending')return change;
 return moved(change,'cancelled','security-review');
}

const identifier=(value:unknown,code:string)=>{check(typeof value==='string'&&/^[A-Za-z0-9-]{1,64}$/.test(value),code);return value;};
// Passkey credential IDs are base64url (identity_credentials.id: 1..1024 characters of [A-Za-z0-9_-]); review and connection IDs have no underscore.
const credentialId=(value:unknown)=>{check(typeof value==='string'&&/^[A-Za-z0-9_-]{1,1024}$/.test(value),'INVALID_SELECTION');return value;};
function selection(value:unknown,what:string,parse:(x:unknown,code:string)=>string=identifier):string[] {
 check(value===undefined||Array.isArray(value),'INVALID_SELECTION',what);
 const list=(value??[]).map(x=>parse(x,'INVALID_SELECTION'));
 check(new Set(list).size===list.length,'INVALID_SELECTION',what);
 return list.sort();
}
const ownConnections=(connections:readonly ProviderConnection[],accountId:string)=>connections.filter(c=>c.accountId===accountId);
const sameList=(a:readonly string[],b:readonly string[])=>a.length===b.length&&a.every((x,i)=>x===b[i]);

export function parseReviewPrepare(input:unknown):Record<string,never> {closedInput(input,['version']);return {};}
export function parseKitOffer(input:unknown):{reviewId:string} {return {reviewId:identifier(closedInput(input,['version','reviewId']).reviewId,'UNKNOWN_REVIEW')};}
export function parseKitSave(input:unknown):{offerId:string} {return {offerId:identifier(closedInput(input,['version','offerId']).offerId,'UNKNOWN_OFFER')};}
/** Closed commit input. Any other field (a password, a content-recovery request, a support or Chat approval) is refused. */
export function parseReviewCommit(input:unknown):ReviewCommitRequest {
 const data=closedInput(input,['version','requestId','reviewId','revokeCredentials','rotateKit','revokeConnections']);
 let rotateKit:{offerId:string}|null=null;
 if(data.rotateKit!==null&&data.rotateKit!==undefined){
  check(plain(data.rotateKit)&&sameList(Object.keys(data.rotateKit),['offerId']),'UNKNOWN_FIELD','rotateKit');
  rotateKit={offerId:identifier(data.rotateKit.offerId,'UNKNOWN_OFFER')};
 }
 return {requestId:requestIdentifier(data.requestId),reviewId:identifier(data.reviewId,'UNKNOWN_REVIEW'),
  revokeCredentials:selection(data.revokeCredentials,'credentials',credentialId),rotateKit,revokeConnections:selection(data.revokeConnections,'connections')};
}

export type PrepareInput={
 principal:OwnerPrincipal|null;account:SecurityAccount;
 /** This account's current pending email change, if any. */
 pending:EmailChange|null;
 sessions:readonly SessionSummary[];
 /** This account's provider connections. */
 connections:readonly ProviderConnection[];
 reviewId:string;now:number;
};
/** Prepare (fresh passkey): one snapshot bound to the epoch, credential revision, kit generation and connection set,
 * valid for compromiseBounds.reviewMs. Stores only identifiers and counts. */
export function prepareCompromiseReview({principal,account,pending,sessions,connections,reviewId,now}:PrepareInput):{review:SecurityReview;result:ReviewSnapshot} {
 authorizeOwner(principal,account,{fresh:true,now});
 const own=ownConnections(connections,account.accountId).slice().sort((a,b)=>a.connectionId<b.connectionId?-1:1);
 const credentials=[...account.credentials].sort();
 const review:SecurityReview={contractVersion,reviewId,accountId:account.accountId,epoch:account.authEpoch,credentialRevision:account.credentialRevision,
  kitGeneration:account.kitGeneration,credentials,connections:own.map(c=>c.connectionId),createdAt:now,expiresAt:now+compromiseBounds.reviewMs,state:'open',revision:1};
 return {review,result:{reviewId,expiresAt:review.expiresAt,credentials:[...credentials],
  sessions:sessions.map(({sessionId,credentialId,issuedAt})=>({sessionId,credentialId,issuedAt})).sort((a,b)=>a.sessionId<b.sessionId?-1:1),
  kitGeneration:account.kitGeneration,pendingEmailChange:pendingChangeForReview(pending,now),
  connections:own.map(c=>({connectionId:c.connectionId,provider:c.provider,access:c.access,revocation:c.revocation.state})),accountRecoveryOnly:true}};
}

const reviewCurrent=(review:SecurityReview,account:SecurityAccount,now:number)=>
 review.state==='open'&&now<review.expiresAt&&review.epoch===account.authEpoch;

/** Offer a replacement kit bound to this review (fresh passkey). The caller generates the key with the shared kit
 * generator and passes only its verifier; the plaintext is returned to the owner once and never stored. */
export function prepareReviewKit({principal,account,review,offerId,verifier,now}:{principal:OwnerPrincipal|null;account:SecurityAccount;review:SecurityReview|null;offerId:string;verifier:string;now:number}):ReviewKitOffer {
 authorizeOwner(principal,account,{fresh:true,now});
 check(review&&review.accountId===account.accountId,'UNKNOWN_REVIEW');
 check(reviewCurrent(review,account,now),'STALE_REVIEW');
 check(typeof verifier==='string'&&/^[0-9a-f]{64}$/.test(verifier),'INVALID_REQUEST','verifier');
 return {offerId,accountId:account.accountId,reviewId:review.reviewId,epoch:account.authEpoch,verifier,createdAt:now,
  expiresAt:Math.min(now+compromiseBounds.kitOfferMs,review.expiresAt),savedAt:null};
}
/** Record the owner's acknowledgment that the offered kit was saved (save-before-rotation). Idempotent. */
export function saveReviewKit({principal,account,offer,now}:{principal:OwnerPrincipal|null;account:SecurityAccount;offer:ReviewKitOffer|null;now:number}):ReviewKitOffer {
 authorizeOwner(principal,account,{fresh:false,now});
 check(offer&&offer.accountId===account.accountId,'UNKNOWN_OFFER');
 check(offer.epoch===account.authEpoch&&now<offer.expiresAt,'STALE_OFFER');
 return offer.savedAt!==null?offer:{...offer,savedAt:now};
}

export type CommitInput={
 principal:OwnerPrincipal|null;account:SecurityAccount;request:ReviewCommitRequest;
 /** The saved receipt for (account, request ID), if any. */
 prior:SavedReviewReceipt|null;
 review:SecurityReview|null;
 /** The offer named by request.rotateKit, if any. */
 offer:ReviewKitOffer|null;
 /** This account's current pending email change, if any. */
 pending:EmailChange|null;
 /** This account's provider connections. */
 connections:readonly ProviderConnection[];
 now:number;
};
export type CommitStep={
 account:SecurityAccount|null;review:SecurityReview|null;change:EmailChange|null;connections:ProviderConnection[];
 /** The offer activated by this commit; delete it with the other revoked rows. */
 consumedOfferId:string|null;
 /** Delete every session, grant, challenge and kit offer of the account issued under an epoch below this one. */
 revokeAuthorityBefore:number|null;
 notices:NoticeDraft[];receipt:SavedReviewReceipt|null;result:ReviewReceipt;
};

/** Commit (fresh passkey, request ID, exact selections): one guarded transaction that rechecks the snapshot. */
export async function commitCompromiseReview({principal,account,request,prior,review,offer,pending,connections,now}:CommitInput):Promise<CommitStep> {
 authorizeOwner(principal,account,{fresh:true,now});
 const requestHash=await hashToken(JSON.stringify(['compromise-review',contractVersion,account.accountId,request.requestId,request.reviewId,
  request.revokeCredentials,request.rotateKit?.offerId??null,request.revokeConnections]));
 // A lost reply is recovered by a new sign-in at the new epoch replaying the same request ID: it reads the receipt.
 if(prior){check(prior.accountId===account.accountId&&prior.requestHash===requestHash,'REQUEST_CONFLICT',request.requestId);
  return {account:null,review:null,change:null,connections:[],consumedOfferId:null,revokeAuthorityBefore:null,notices:[],receipt:null,result:prior.receipt};}
 check(review&&review.accountId===account.accountId,'UNKNOWN_REVIEW');
 const own=ownConnections(connections,account.accountId),current=own.map(c=>c.connectionId).sort();
 check(reviewCurrent(review,account,now)&&review.credentialRevision===account.credentialRevision&&review.kitGeneration===account.kitGeneration&&sameList(review.connections,current),'STALE_REVIEW');
 check(request.revokeCredentials.every(k=>review.credentials.includes(k)&&account.credentials.includes(k)),'INVALID_SELECTION','credentials');
 check(request.revokeConnections.every(k=>review.connections.includes(k)),'INVALID_SELECTION','connections');
 if(request.rotateKit){
  check(offer&&offer.offerId===request.rotateKit.offerId&&offer.accountId===account.accountId&&offer.reviewId===review.reviewId&&offer.epoch===account.authEpoch&&now<offer.expiresAt&&offer.savedAt!==null,'KIT_NOT_SAVED');
 }
 const rotated=request.rotateKit&&offer?offer:null;
 // Emergency revocation: no two-key minimum here. Zero remaining keys puts the account in `recovering`, where the
 // saved current kit opens the existing restricted all-loss flow.
 const credentials=account.credentials.filter(k=>!request.revokeCredentials.includes(k));
 const next:SecurityAccount={...account,credentials,
  credentialRevision:account.credentialRevision+(request.revokeCredentials.length?1:0),
  stage:credentials.length?account.stage:'recovering',authEpoch:account.authEpoch+1,
  kitGeneration:rotated?account.kitGeneration+1:account.kitGeneration,kitVerifier:rotated?rotated.verifier:account.kitVerifier};
 const change=pending&&pending.accountId===account.accountId?closeForSecurityReview(pending):null;
 const disabled=own.filter(c=>request.revokeConnections.includes(c.connectionId)).map(c=>disableForReview(c));
 const receipt:ReviewReceipt={reviewId:review.reviewId,epoch:next.authEpoch,stage:next.stage,revokedCredentials:[...request.revokeCredentials],kitRotated:Boolean(rotated),
  pendingEmailChange:change&&change!==pending?'cancelled':null,
  connections:disabled.map(c=>({connectionId:c.connectionId,access:'disabled' as const,revocation:c.revocation.state})),sessionsRevoked:'all',accountRecoveryOnly:true};
 return {account:next,review:{...review,state:'committed',revision:review.revision+1},change:change&&change!==pending?change:null,connections:disabled,
  consumedOfferId:rotated?rotated.offerId:null,revokeAuthorityBefore:next.authEpoch,
  notices:[{kind:'security-review-completed',changeId:null,to:account.email}],
  receipt:{accountId:account.accountId,requestId:request.requestId,requestHash,receipt,committedAt:now},result:receipt};
}

/** A sign-in challenge as stored: the epoch it was issued under, and its expiry. */
export type SignInChallenge={accountId:string;epoch:number;expiresAt:number};
export type Admission={accountId:string;kind:'session'|'grant';purpose:'workspace'|'recovery';authEpoch:number;proof:{method:'passkey'|'recovery-key';verifiedAt:number}};
/** Completing a passkey sign-in. A challenge issued before an epoch advance (a compromise commit, passkey removal or
 * kit rotation) fails afterward, even if it was read before the commit; a removed passkey cannot complete a sign-in.
 * Only a retained passkey signs in, at the current epoch. */
export function admitSignIn({challenge,account,credentialId,now}:{challenge:SignInChallenge|null;account:SecurityAccount;credentialId:unknown;now:number}):Admission {
 check(challenge&&challenge.accountId===account.accountId&&now<challenge.expiresAt,'PROOF_REQUIRED');
 check(challenge.epoch===account.authEpoch,'IDENTITY_CHANGED');
 check(typeof credentialId==='string'&&account.credentials.includes(credentialId),'PROOF_REQUIRED');
 const ready=account.stage==='ready';
 return {accountId:account.accountId,kind:ready?'session':'grant',purpose:ready?'workspace':'recovery',authEpoch:account.authEpoch,proof:{method:'passkey',verifiedAt:now}};
}
/** Recovery start: the email is a lookup key only and the current kit is the proof. Only an account's current address
 * resolves it; a pending change's new address never does. `changes` are the change rows naming the address: a
 * previous address another account holds reserved inside its undo window makes the lookup ambiguous, which is refused
 * rather than resolved. Every failure is the same RECOVERY_PROOF. The result is restricted recovery authority (a grant
 * for recoveryGrantOperations), never a session, whatever the address's verification state. */
export function admitRecovery({address,accounts,changes,keyVerifier,now}:{address:unknown;accounts:readonly SecurityAccount[];changes:readonly EmailChange[];keyVerifier:string|null;now:number}):Admission {
 let normalized:string|null=null;
 try{normalized=normalizeAddress(address);}catch{normalized=null;}
 const account=normalized===null?null:accounts.find(x=>x.email===normalized)??null;
 const ambiguous=account!==null&&changes.some(c=>c.accountId!==account.accountId&&c.state==='confirmed'&&c.previous?.address===normalized&&c.undoUntil!==null&&now<c.undoUntil);
 const proven=account!==null&&!ambiguous&&keyVerifier!==null&&keyVerifier===account.kitVerifier;
 check(proven&&(account.stage==='ready'||account.stage==='recovering'),'RECOVERY_PROOF');
 return {accountId:account.accountId,kind:'grant',purpose:'recovery',authEpoch:account.authEpoch,proof:{method:'recovery-key',verifiedAt:now}};
}
