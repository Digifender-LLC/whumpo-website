/** WH-063 / WH-200 verified account email change: frozen policy, closed input and owner authority
 * (contract version 1, docs/email-change-and-compromise.md). Pure functions over plain data. No storage, route, Chat
 * binding, sender or Worker import: the trusted adapter and storage slice (WH-201) resolve the identity principal and
 * must repeat every predicate here inside its committing statements (identityPredicate in
 * src/workspace-identity/authority.ts already rechecks the epoch and the fresh-passkey window in SQL).
 *
 * An email address, verified or not, is never a sign-in method, a recovery factor or an authorization factor. Nothing in
 * this module turns an address, a link or a verification state into a session, a grant or an approval. */

export class EmailChangeError extends Error {
 constructor(readonly code:string,readonly detail=''){super(detail?`${code}: ${detail}`:code);this.name='EmailChangeError';}
}
export function check(condition:unknown,code:string,detail=''):asserts condition {
 if(!condition)throw new EmailChangeError(code,detail);
}
export const plain=(value:unknown):value is Record<string,unknown>=>
 !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.getPrototypeOf(value)===Object.prototype;

/** Frozen contract version. There is no reader for any other version. */
export const contractVersion=1;
const MIN=60000,HOUR=60*MIN,DAY=24*HOUR;
/** Recommended v1 values (owner decisions 1 and 2 in the contract), applied as versioned policy constants.
 * freshPasskeyMs is the identity engine's existing window (`proof_at>unixepoch()-600`). */
export const emailChangeBounds=Object.freeze({
 freshPasskeyMs:10*MIN,tokenLifetimeMs:HOUR,undoWindowMs:7*DAY,
 requestsPerAccountPerDay:3,messagesPerAddressPerDay:3,confirmFailuresPerHour:5,
 limitWindowMs:DAY,failureWindowMs:HOUR,maxTokenLength:128,
});
/** The only sender: platform delivery (WH-036), `platform-obligation` class. Never a customer's connected mailbox. */
export const platformSender=Object.freeze({address:'notify@whumpo.com',displayName:'Whumpo',authority:'platform-obligation'} as const);
/** Retired or never-admitted proof kinds. Presenting one is refused; nothing revives password authority. */
export const retiredAuthorityFields:readonly string[]=Object.freeze(['password','passwordHash','newPassword','recoveryCode','magicLink','emailCode','otp']);
export const messageKinds=Object.freeze(['confirm-new-address','change-requested','change-completed','change-undone','security-review-completed'] as const);
export type MessageKind=typeof messageKinds[number];

/** Closed request record: retired proof fields first, then unknown fields, then the exact version. */
export function closedInput(input:unknown,allowed:readonly string[]):Record<string,unknown> {
 check(plain(input),'INVALID_REQUEST');
 for(const key of Object.keys(input))check(!retiredAuthorityFields.includes(key),'RETIRED_AUTHORITY',key);
 for(const key of Object.keys(input))check(allowed.includes(key),'UNKNOWN_FIELD',key);
 check(input.version===contractVersion,'UNSUPPORTED_VERSION',String(input.version));
 return input;
}
export function requestIdentifier(value:unknown):string {
 check(typeof value==='string'&&/^[A-Za-z0-9-]{8,64}$/.test(value),'INVALID_REQUEST','requestId');
 return value;
}
/** Same rule as the WH-036 destination normalizer (normalizeDestination in src/contact-notifications.ts): one plain
 * lower-case mailbox, no display name, comma, angle bracket, quote or control character. */
export function normalizeAddress(value:unknown):string {
 check(typeof value==='string','INVALID_ADDRESS');
 const address=value.trim().toLowerCase();
 check(address.length>=3&&address.length<=254&&/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(address),'INVALID_ADDRESS');
 return address;
}

/** The server-resolved identity principal, as plain data. Times are milliseconds; the WH-201 adapter converts the
 * identity engine's seconds. A restricted enrollment or recovery grant has kind `grant`. */
export type OwnerPrincipal={
 accountId:string;kind:'session'|'grant';purpose:'workspace'|'enrollment'|'recovery';authEpoch:number;
 proof:{method:'passkey'|'registration'|'recovery-key'|'recovery-commit';verifiedAt:number};
};
/** The account's current email state, read with the principal. `authEpoch` is identity_accounts.auth_epoch. */
export type AccountEmail={
 accountId:string;email:string;verifiedAt:number|null;verifiedVia:string|null;authEpoch:number;stage:'enrolling'|'ready'|'recovering';
};

/** Direct owner control authority. Only a current ordinary session of a `ready` account passes; a fresh passkey
 * (at most ten minutes old) is required where the contract says so. Authority issued under an earlier epoch (before a
 * passkey removal, kit rotation, recovery securing or compromise commit) is refused, so a session or in-flight sign-in
 * minted before a compromise review cannot reach these operations afterward. */
export function authorizeOwner(principal:OwnerPrincipal|null|undefined,account:AccountEmail,{fresh,now}:{fresh:boolean;now:number}):OwnerPrincipal {
 check(plain(principal)&&plain(account)&&principal.accountId===account.accountId,'AUTH_REQUIRED');
 check(principal.authEpoch===account.authEpoch,'IDENTITY_CHANGED');
 check(principal.kind==='session'&&principal.purpose==='workspace'&&account.stage==='ready','IDENTITY_INCOMPLETE');
 if(fresh)check(principal.proof.method==='passkey'&&now-principal.proof.verifiedAt<=emailChangeBounds.freshPasskeyMs,'PROOF_REQUIRED');
 return principal;
}
/** Entries of `times` inside the trailing window ending at `now`. */
export const within=(times:readonly number[]|null|undefined,windowMs:number,now:number)=>(times??[]).filter(t=>now-t<windowMs);

/** Lifecycle classes (WH-116/WH-009 extension). WH-201 stores `owner-email-changes`, `owner-email-change-limits` and
 * `owner-security-reviews` in schema/platform.sql and registers them in docs/data-lifecycle.json (the test pins the match).
 * `platform-notifications` stays planned: the shared outbox is WH-156/WH-202, and no token is ever written to it. */
export const dataClasses=Object.freeze([
 {id:'owner-email',status:'current-extension',records:['account email','verification time and sender'],protection:'managed-readable',secrets:'none',
  retention:'while the account exists; enters closure purge',export:'address, verified time',deletion:'account closure'},
 {id:'owner-email-changes',status:'current',records:['pending change','confirmation-token verifier','previous-address undo reservation'],protection:'managed-readable',secrets:'token verifier only (SHA-256); plaintext exists only in the one provider call',
  retention:'pending until confirmed, cancelled, superseded, stale or expired; terminal rows 30 days with the new address replaced by its hash; previous address until the undo window ends',
  export:'current pending address and expiry; never token verifiers, request hashes or rate-limit keys',deletion:'cancellation, expiry cleanup, account closure'},
 {id:'owner-email-change-limits',status:'current',records:['per-account request times','hashed per-address daily send keys','confirmation failure counts'],protection:'managed-readable',secrets:'none (address keys are hashes)',
  retention:'48 hours',export:'none',deletion:'bounded maintenance'},
 {id:'platform-notifications',status:'planned',records:['content-free account notices in the WH-156 shared outbox'],protection:'managed-readable',secrets:'none: the confirmation token is never stored in the outbox',
  retention:'30 days; unknown-outcome and unresolved evidence until resolved',export:'state and time only',deletion:'outbox expiry'},
 {id:'owner-security-reviews',status:'current',records:['review snapshot identifiers','selections','kit offer verifier','commit receipt'],protection:'managed-readable',secrets:'kit offer verifier only (SHA-256); otherwise identifiers and counts, never kit, token or credential material',
  retention:'90 days after commit or expiry',export:'review time, selections and outcome',deletion:'retention cleanup, account closure'},
 {id:'connections',status:'current',records:['encrypted provider credentials held for revocation','revocation receipts'],protection:'application-encrypted',secrets:'ciphertext retained until definitive provider revocation',
  retention:'until definitive revocation or reconciled evidence; unresolved holds block closure',export:'connection state only',deletion:'only after an exact revocation receipt'},
]);
