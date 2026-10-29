/** WH-201 storage slice for the verified address change (docs/email-change-and-compromise.md). The WH-200 module in this folder
 * decides every step over plain records; this file reads those records from D1 and writes each step's result in ONE batch. The
 * database repeats the module's predicates as triggers and constraints (schema/platform.sql: owner_email_changes,
 * owner_email_change_limits, users_email_lockstep), so a lost race or a forged write aborts the whole batch instead of committing
 * half a step. A write goes through the caller's workspace scope when there is one: its batch carries the current-identity
 * predicate (epoch, and a fresh passkey once the request elevated it), which is how `identityPredicate` is repeated in the
 * committing statements. No password, link sign-in or legacy reader exists here. The confirmation token plaintext never reaches
 * this file; only the SHA-256 verifier does. */
import type {IdentityPrincipal} from '../workspace-identity/authority';
import {EmailChangeError,emailChangeBounds} from './policy';
import type {AccountEmail,OwnerPrincipal} from './policy';
import {addressKey} from './change';
import type {AddressHolders,ChangeState,ChangeStep,EmailChange} from './change';
import {deliverNotice} from './token';
import type {DeliveryStep,Notice,PlatformMailer} from './token';

type Database=Pick<D1Database,'prepare'|'batch'>;
type Row={
 change_id:string;account_id:string;request_id:string;request_hash:string;new_address:string|null;new_address_hash:string;epoch:number;created_at:number;
 expires_at:number;state:ChangeState;revision:number;history:string;deliverable:number;token_verifier:string|null;previous_address:string|null;
 previous_verified_at:number|null;previous_verified_via:string|null;receipt_verified_at:number|null;undo_until:number|null;
};
const columns='change_id,account_id,request_id,request_hash,new_address,new_address_hash,epoch,created_at,expires_at,state,revision,history,deliverable,token_verifier,previous_address,previous_verified_at,previous_verified_via,receipt_verified_at,undo_until';

/** The module's principal from the identity engine's (seconds to milliseconds). */
export const ownerPrincipal=(p:IdentityPrincipal):OwnerPrincipal=>({accountId:p.accountId,kind:p.kind,purpose:p.purpose,authEpoch:p.authEpoch,
 proof:{method:p.proof.method,verifiedAt:p.proof.verifiedAt*1000}});

/** The account's address, verification state, authority epoch and stage, in one read. */
export async function readAccount(db:Database,accountId:string):Promise<AccountEmail|null> {
 const row=await db.prepare('SELECT u.id,u.email,u.email_verified_at,u.email_verified_via,a.auth_epoch,a.stage FROM users u JOIN identity_accounts a ON a.account_id=u.id WHERE u.id=?')
  .bind(accountId).first<{id:string;email:string;email_verified_at:number|null;email_verified_via:string|null;auth_epoch:number;stage:AccountEmail['stage']}>();
 return row?{accountId:row.id,email:row.email,verifiedAt:row.email_verified_at,verifiedVia:row.email_verified_via,authEpoch:row.auth_epoch,stage:row.stage}:null;
}

function toChange(row:Row):EmailChange {
 const receipt=row.receipt_verified_at!==null&&row.new_address!==null&&row.state==='confirmed'?{changeId:row.change_id,status:'confirmed' as const,email:row.new_address,verifiedAt:row.receipt_verified_at}:null;
 return {contractVersion:1,changeId:row.change_id,accountId:row.account_id,requestId:row.request_id,requestHash:row.request_hash,
  // A redacted address (closed change, hash only) can never match a live address.
  newAddress:row.new_address??'',epoch:row.epoch,createdAt:row.created_at,expiresAt:row.expires_at,state:row.state,revision:row.revision,history:JSON.parse(row.history),
  deliverable:row.deliverable===1,tokenVerifier:row.token_verifier,
  previous:row.previous_address!==null?{address:row.previous_address,verifiedAt:row.previous_verified_at,verifiedVia:row.previous_verified_via}:null,
  undoUntil:row.undo_until,receipt};
}
async function one(db:Database,where:string,...values:unknown[]):Promise<EmailChange|null> {
 const row=await db.prepare(`SELECT ${columns} FROM owner_email_changes WHERE ${where}`).bind(...values).first<Row>();return row?toChange(row):null;
}
export const readChange=(db:Database,accountId:string,changeId:string)=>one(db,'account_id=? AND change_id=?',accountId,changeId);
export const readPendingChange=(db:Database,accountId:string)=>one(db,"account_id=? AND state='pending'",accountId);
export const readChangeByRequest=(db:Database,accountId:string,requestId:string)=>one(db,'account_id=? AND request_id=?',accountId,requestId);
/** Any account's change that carries this verifier. The module compares the owning account itself. */
export const readChangeByVerifier=(db:Database,verifier:string)=>one(db,'token_verifier=?',verifier);
/** The account's confirmed change that can still be undone: inside its window, and the account still holds its new address. */
export async function readUndoableChange(db:Database,accountId:string,now:number):Promise<EmailChange|null> {
 return one(db,"account_id=? AND state='confirmed' AND undo_until>? AND new_address=(SELECT email FROM users WHERE id=?) ORDER BY undo_until DESC LIMIT 1",accountId,now,accountId);
}
/** Who holds an address: accounts whose current email it is, and confirmed changes reserving it as a previous address. */
export async function readHolders(db:Database,address:string):Promise<AddressHolders> {
 const accounts=(await db.prepare('SELECT id,email FROM users WHERE email=?').bind(address).all<{id:string;email:string}>()).results.map(r=>({accountId:r.id,email:r.email}));
 const changes=(await db.prepare(`SELECT ${columns} FROM owner_email_changes WHERE previous_address=? AND state='confirmed'`).bind(address).all<Row>()).results.map(toChange);
 return {accounts,changes};
}
/** Limit evidence inside its windows: the account's request and failure times, and the address's send times. */
export async function readLimits(db:Database,accountId:string,address:string|null,now:number){
 const times=async(sql:string,...values:unknown[])=>(await db.prepare(sql).bind(...values).all<{at:number}>()).results.map(r=>r.at);
 const requests=await times("SELECT at FROM owner_email_change_limits WHERE kind='request' AND account_id=? AND at>? ORDER BY at",accountId,now-emailChangeBounds.limitWindowMs);
 const failures=await times("SELECT at FROM owner_email_change_limits WHERE kind='failure' AND account_id=? AND at>? ORDER BY at",accountId,now-emailChangeBounds.failureWindowMs);
 const addressSends=address===null?[]:await times("SELECT at FROM owner_email_change_limits WHERE kind='send' AND address_key=? AND at>? ORDER BY at",await addressKey(address),now-emailChangeBounds.limitWindowMs);
 return {requests,failures,addressSends};
}

const added=(before:readonly number[],after:readonly number[]|undefined)=>{
 const remaining=[...before];const fresh:number[]=[];
 for(const t of after??[]){const i=remaining.indexOf(t);if(i>=0)remaining.splice(i,1);else fresh.push(t);}
 return fresh;
};
function writeChange(db:Database,change:EmailChange){
 const previous=change.previous;
 return db.prepare('UPDATE owner_email_changes SET state=?,revision=?,history=?,token_verifier=?,previous_address=?,previous_verified_at=?,previous_verified_via=?,receipt_verified_at=?,undo_until=? WHERE change_id=?')
  .bind(change.state,change.revision,JSON.stringify(change.history),change.tokenVerifier,previous?.address??null,previous?.verifiedAt??null,previous?.verifiedVia??null,change.receipt?.verifiedAt??null,change.undoUntil,change.changeId);
}
async function insertChange(db:Database,change:EmailChange){
 return db.prepare(`INSERT INTO owner_email_changes(${columns}) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
  .bind(change.changeId,change.accountId,change.requestId,change.requestHash,change.newAddress,await addressKey(change.newAddress),change.epoch,change.createdAt,change.expiresAt,
   change.state,change.revision,JSON.stringify(change.history),change.deliverable?1:0,change.tokenVerifier,null,null,null,null,null);
}

export type Seen={requests:readonly number[];failures:readonly number[];addressSends:readonly number[]};
/** Persist one module step in one batch, in the order the triggers need: limit evidence, then the changes (a superseded change
 * before its replacement), then the account's address. Revision+1 on every update is the optimistic guard: a concurrent writer
 * makes the batch abort. The caller reports the step's refusal only after this returns. */
export async function persistStep<R>(db:Database,step:ChangeStep<R>,{accountId,address,seen,now}:{accountId:string;address:string|null;seen:Seen;now:number}) {
 const statements:D1PreparedStatement[]=[];
 const limit=(kind:string,key:'account'|'address',value:string)=>db.prepare('INSERT INTO owner_email_change_limits(kind,account_id,address_key,at) VALUES(?,?,?,?)')
  .bind(kind,key==='account'?value:null,key==='address'?value:null,now);
 const lim=step.limits;
 if(lim?.requests&&added(seen.requests,lim.requests).length)statements.push(limit('request','account',accountId));
 if(lim?.addressSends&&address!==null&&added(seen.addressSends,lim.addressSends).length)statements.push(limit('send','address',await addressKey(address)));
 if(lim?.failures&&added(seen.failures,lim.failures).length)statements.push(limit('failure','account',accountId));
 for(const change of step.changes)statements.push(change.revision===1?await insertChange(db,change):writeChange(db,change));
 if(step.account)statements.push(db.prepare('UPDATE users SET email=?,email_verified_at=?,email_verified_via=? WHERE id=?').bind(step.account.email,step.account.verifiedAt,step.account.verifiedVia,step.account.accountId));
 if(statements.length)await db.batch(statements);
}

/** Maps a database refusal to the module's error codes. A lost race is `STALE_CHANGE`: the caller rereads and decides again. */
export function storeError(cause:unknown):EmailChangeError|null {
 const text=String(cause);
 if(text.includes('email_change_rate_limited'))return new EmailChangeError('RATE_LIMITED','database');
 if(/email_change_(?:revision|confirm|close|claim|undo|frozen|transition|history)|users_email_lockstep|UNIQUE constraint failed: (?:owner_email_changes|users)/.test(text))return new EmailChangeError('STALE_CHANGE','race');
 if(/email_change_(?:identity|new|limits|immutable)|users_email_new/.test(text))return new EmailChangeError('IDENTITY_CHANGED','database');
 return null;
}

/** The delivery claim for `deliverNotice`: commits the minted verifier with the claimed attempt BEFORE the single provider call.
 * A lost revision race (another worker claimed first) sends nothing. */
export const claimConfirmation=(db:Database)=>async(notice:Notice,change:EmailChange|null)=>{
 if(notice.kind!=='confirm-new-address'||!change)return true;
 try{await db.batch([writeChange(db,change)]);return true;}catch{return false;}
};
/** One delivery attempt: read the notice's change, claim, call the mailer once, then persist a deferral (verifier cleared) or a
 * definite non-delivery (`undeliverable`). An unknown outcome keeps the verifier and is never redispatched. */
export async function deliverStored(db:Database,notice:Notice,mailer:PlatformMailer,now:number):Promise<DeliveryStep> {
 const change=notice.changeId?await one(db,'change_id=?',notice.changeId):null;
 const step=await deliverNotice({notice,change,mailer,claim:claimConfirmation(db),now});
 const claimedRevision=(change?.revision??0)+1;
 if(step.change&&change&&step.change.revision>claimedRevision)await db.batch([writeChange(db,step.change)]);
 return step;
}

