/** WH-203 storage slice for the compromise review (docs/email-change-and-compromise.md section 3). The module in compromise.ts decides
 * every step over plain records; this file reads those records from the current schema and writes each step in ONE batch. The
 * schema repeats the review predicates (owner_security_reviews triggers and CHECKs), and the commit batch repeats the review binding,
 * the epoch and the fresh passkey in its statements, so a lost race or a forged write aborts the whole batch instead of committing
 * half a review. A write goes through the caller's workspace scope: its batch carries the current-identity predicate.
 *
 * Provider connections reuse the existing disconnect states (github_token_vault / cloudflare_token_vault state 'revoking', the
 * encrypted credential retained). No new dispatcher and no provider call is added here: the existing cleaners dispatch, and only
 * an exact receipt erases a credential. No password, link sign-in or legacy reader exists here. */
import {EmailChangeError} from './policy';
import {readAccount,readPendingChange,writeChange} from './store';
export {readPendingChange};
import {cloudflareConnectionHolds,githubConnectionHolds} from './connection-holds';
import type {ProviderConnection} from './revocation';
import type {ReviewCommitRequest,ReviewKitOffer,SavedReviewReceipt,SecurityAccount,SecurityReview,SessionSummary,CommitStep,ReviewReceipt} from './compromise';

type Database=Pick<D1Database,'prepare'|'batch'>;
type ReviewRow={review_id:string;account_id:string;epoch:number;credential_revision:number;kit_generation:number;credentials:string;connections:string;
 created_at:number;expires_at:number;state:'open'|'committed';revision:number;kit_offer_id:string|null;kit_verifier:string|null;
 kit_offer_created_at:number|null;kit_offer_expires_at:number|null;kit_saved_at:number|null;commit_request_hash:string|null;receipt:string|null;committed_at:number|null;commit_request_id:string|null};
const reviewColumns='review_id,account_id,epoch,credential_revision,kit_generation,credentials,connections,created_at,expires_at,state,revision,kit_offer_id,kit_verifier,kit_offer_created_at,kit_offer_expires_at,kit_saved_at,commit_request_id,commit_request_hash,receipt,committed_at';
/** The snapshot columns are bounded at 2048 bytes by the schema. */
const columnBytes=2048;

/** The account with its identity state: active passkeys, credential revision and kit. */
export async function readSecurityAccount(db:Database,accountId:string):Promise<SecurityAccount|null> {
 const account=await readAccount(db,accountId);if(!account)return null;
 const identity=await db.prepare('SELECT credential_revision,kit_generation,kit_verifier FROM identity_accounts WHERE account_id=?').bind(accountId)
  .first<{credential_revision:number;kit_generation:number;kit_verifier:string|null}>();
 if(!identity)return null;
 const keys=(await db.prepare("SELECT id FROM identity_credentials WHERE account_id=? AND status='active' ORDER BY id").bind(accountId).all<{id:string}>()).results.map(r=>r.id);
 return {...account,credentials:keys,credentialRevision:identity.credential_revision,kitGeneration:identity.kit_generation,kitVerifier:identity.kit_verifier??''};
}
/** Non-secret metadata of the account's current sessions (never a token or its hash). */
export async function readSessions(db:Database,accountId:string,epoch:number):Promise<SessionSummary[]> {
 return (await db.prepare('SELECT id,credential_id,issued_at FROM identity_sessions WHERE account_id=? AND auth_epoch=? ORDER BY id').bind(accountId,epoch).all<{id:string;credential_id:string|null;issued_at:number}>())
  .results.map(r=>({sessionId:r.id,credentialId:r.credential_id,issuedAt:r.issued_at*1000}));
}
/** Every held provider credential of the account, mapped onto revocation holds by the reviewed connection-holds rules. */
export async function readConnections(db:Database,accountId:string,now:number):Promise<ProviderConnection[]> {
 const rows=async<T>(sql:string)=>(await db.prepare(sql).bind(accountId).all<T>()).results;
 const github=githubConnectionHolds({accountId,now,rows:{
  connection:await db.prepare('SELECT user_id,active_token_id FROM github_connections WHERE user_id=?').bind(accountId).first<{user_id:string;active_token_id:string|null}>(),
  tokens:await rows('SELECT id,user_id,expires_at,state FROM github_token_vault WHERE user_id=? ORDER BY id'),
  custody:await rows('SELECT token_id,user_id,client_id,access_revoked_at FROM github_refresh_custody WHERE user_id=?'),
  claims:await rows('SELECT token_id,expires_at FROM github_revocation_claims WHERE token_id IN (SELECT id FROM github_token_vault WHERE user_id=?)'),
  grants:await rows('SELECT user_id,token_ids,state,settled_at FROM github_grant_revocations WHERE user_id=?'),
 }});
 const cloudflare=cloudflareConnectionHolds({accountId,now,tokens:await rows('SELECT id,user_id,expires_at,state,revoke_after FROM cloudflare_token_vault WHERE user_id=? ORDER BY id')});
 return [...github,...cloudflare];
}

function toReview(row:ReviewRow):SecurityReview {
 return {contractVersion:1,reviewId:row.review_id,accountId:row.account_id,epoch:row.epoch,credentialRevision:row.credential_revision,kitGeneration:row.kit_generation,
  credentials:JSON.parse(row.credentials),connections:JSON.parse(row.connections),createdAt:row.created_at,expiresAt:row.expires_at,state:row.state,revision:row.revision};
}
const toOffer=(row:ReviewRow):ReviewKitOffer|null=>row.kit_offer_id===null?null:
 {offerId:row.kit_offer_id,accountId:row.account_id,reviewId:row.review_id,epoch:row.epoch,verifier:row.kit_verifier!,createdAt:row.kit_offer_created_at!,expiresAt:row.kit_offer_expires_at!,savedAt:row.kit_saved_at};
export async function readReview(db:Database,accountId:string,reviewId:string){
 const row=await db.prepare(`SELECT ${reviewColumns} FROM owner_security_reviews WHERE account_id=? AND review_id=?`).bind(accountId,reviewId).first<ReviewRow>();
 return row?{review:toReview(row),offer:toOffer(row)}:null;
}
/** The newest open, unexpired review of this account (prepare reuses it, so a reload never spends one of the account's 20 stored reviews). */
export async function readOpenReview(db:Database,accountId:string,now:number){
 const row=await db.prepare(`SELECT ${reviewColumns} FROM owner_security_reviews WHERE account_id=? AND state='open' AND expires_at>? ORDER BY created_at DESC LIMIT 1`).bind(accountId,now).first<ReviewRow>();
 return row?{review:toReview(row),offer:toOffer(row)}:null;
}
/** The saved commit receipt for (account, request ID): a lost reply is answered from here with no second effect. */
export async function readSavedReceipt(db:Database,accountId:string,requestId:string):Promise<SavedReviewReceipt|null> {
 const row=await db.prepare('SELECT commit_request_hash,receipt,committed_at FROM owner_security_reviews WHERE account_id=? AND commit_request_id=? AND state=\'committed\'').bind(accountId,requestId)
  .first<{commit_request_hash:string;receipt:string;committed_at:number}>();
 return row?{accountId,requestId,requestHash:row.commit_request_hash,receipt:JSON.parse(row.receipt) as ReviewReceipt,committedAt:row.committed_at}:null;
}
export async function insertReview(db:Database,review:SecurityReview){
 const credentials=JSON.stringify(review.credentials),connections=JSON.stringify(review.connections);
 if(new TextEncoder().encode(credentials).length>columnBytes||new TextEncoder().encode(connections).length>columnBytes)throw new EmailChangeError('REVIEW_TOO_LARGE');
 await db.prepare("INSERT INTO owner_security_reviews(review_id,account_id,epoch,credential_revision,kit_generation,credentials,connections,created_at,expires_at,state,revision) VALUES(?,?,?,?,?,?,?,?,?,'open',1)")
  .bind(review.reviewId,review.accountId,review.epoch,review.credentialRevision,review.kitGeneration,credentials,connections,review.createdAt,review.expiresAt).run();
}
/** Set once: the schema refuses to replace an offer or its verifier. */
export async function persistKitOffer(db:Database,review:SecurityReview,offer:ReviewKitOffer){
 const done=await db.prepare("UPDATE owner_security_reviews SET kit_offer_id=?,kit_verifier=?,kit_offer_created_at=?,kit_offer_expires_at=?,revision=revision+1 WHERE review_id=? AND account_id=? AND state='open' AND revision=? AND kit_offer_id IS NULL RETURNING review_id")
  .bind(offer.offerId,offer.verifier,offer.createdAt,offer.expiresAt,review.reviewId,review.accountId,review.revision).all();
 if(done.results.length!==1)throw new EmailChangeError('STALE_REVIEW','race');
}
export async function persistKitSaved(db:Database,review:SecurityReview,offer:ReviewKitOffer){
 const done=await db.prepare("UPDATE owner_security_reviews SET kit_saved_at=?,revision=revision+1 WHERE review_id=? AND account_id=? AND state='open' AND revision=? AND kit_offer_id=? AND kit_saved_at IS NULL RETURNING review_id")
  .bind(offer.savedAt,review.reviewId,review.accountId,review.revision,offer.offerId).all();
 if(done.results.length!==1)throw new EmailChangeError('STALE_REVIEW','race');
}

/** The commit, in one batch. Order matters to the triggers: the account's epoch advances first, the review is marked committed last
 * (owner_security_review_commit requires the epoch advanced by exactly one). Every statement after the first repeats the review
 * binding and the new epoch, and the leading admission check refuses the whole batch unless the review is still open at the revision
 * read, the account still matches the snapshot, every selected passkey is still active and the connection set is unchanged. */
export async function persistCommit(db:Database,{review,offer,step,request,account}:{review:SecurityReview;offer:ReviewKitOffer|null;step:CommitStep;request:ReviewCommitRequest;account:SecurityAccount}){
 const rotate=Boolean(request.rotateKit&&offer);
 const open=`EXISTS(SELECT 1 FROM owner_security_reviews WHERE review_id=? AND account_id=? AND state='open' AND revision=? AND unixepoch()*1000<expires_at${rotate?' AND kit_offer_id=? AND kit_saved_at IS NOT NULL AND kit_offer_expires_at>unixepoch()*1000':''})`;
 const openParams=[review.reviewId,review.accountId,review.revision,...(rotate?[offer!.offerId]:[])];
 const advanced=`EXISTS(SELECT 1 FROM identity_accounts WHERE account_id=? AND auth_epoch=?)`;
 const after=`${open} AND ${advanced}`,afterParams=[...openParams,account.accountId,account.authEpoch+1];
 const revoked=JSON.stringify(request.revokeCredentials);
 const github=step.connections.filter(c=>c.connectionId.startsWith('gh-')),cloudflare=step.connections.filter(c=>c.connectionId.startsWith('cf-'));
 const vaultId=(c:ProviderConnection)=>c.connectionId.slice(3);
 const statements:D1PreparedStatement[]=[
  db.prepare(`INSERT INTO identity_admission_checks(denied) SELECT 1 WHERE NOT (${open}
   AND EXISTS(SELECT 1 FROM identity_accounts WHERE account_id=? AND stage='ready' AND auth_epoch=? AND credential_revision=? AND kit_generation=?)
   AND (SELECT count(*) FROM identity_credentials WHERE account_id=? AND status='active' AND id IN (SELECT value FROM json_each(?)))=?
   AND (SELECT count(*) FROM github_token_vault WHERE user_id=?)+(SELECT count(*) FROM cloudflare_token_vault WHERE user_id=?)=?)`)
   .bind(...openParams,account.accountId,account.authEpoch,review.credentialRevision,review.kitGeneration,account.accountId,revoked,request.revokeCredentials.length,account.accountId,account.accountId,review.connections.length),
  // Epoch advance, remaining-key stage and the saved kit in ONE statement (identity_account_monotonic needs them together).
  db.prepare(`UPDATE identity_accounts SET auth_epoch=auth_epoch+1,current_attempt_id=NULL,
    stage=CASE WHEN EXISTS(SELECT 1 FROM identity_credentials WHERE account_id=? AND status='active' AND id NOT IN (SELECT value FROM json_each(?))) THEN stage ELSE 'recovering' END,
    kit_verifier=CASE WHEN ? THEN (SELECT kit_verifier FROM owner_security_reviews WHERE review_id=?) ELSE kit_verifier END,kit_generation=kit_generation+?
   WHERE account_id=? AND stage='ready' AND auth_epoch=? AND credential_revision=? AND kit_generation=? AND ${open}`)
   .bind(account.accountId,revoked,rotate?1:0,review.reviewId,rotate?1:0,account.accountId,account.authEpoch,review.credentialRevision,review.kitGeneration,...openParams),
  ...['identity_sessions','identity_grants','identity_challenges','identity_kit_offers'].map(table=>db.prepare(`DELETE FROM ${table} WHERE account_id=? AND ${after}`).bind(account.accountId,...afterParams)),
  db.prepare(`UPDATE identity_attempts SET status='cancelled',revision=revision+1 WHERE account_id=? AND status IN ('open','secured') AND ${after}`).bind(account.accountId,...afterParams),
  db.prepare(`DELETE FROM identity_credentials WHERE account_id=? AND status='active' AND id IN (SELECT value FROM json_each(?)) AND ${after}`).bind(account.accountId,revoked,...afterParams),
 ];
 // Disable local access first and keep the encrypted credential: the same rows the existing disconnect writes.
 if(github.length)statements.push(db.prepare(`DELETE FROM github_oauth_states WHERE user_id=? AND ${after}`).bind(account.accountId,...afterParams));
 for(const c of github)statements.push(
  db.prepare(`UPDATE github_token_vault SET state='revoking' WHERE id=? AND user_id=? AND ${after}`).bind(vaultId(c),account.accountId,...afterParams),
  db.prepare(`UPDATE github_connections SET active_token_id=NULL WHERE user_id=? AND active_token_id=? AND ${after}`).bind(account.accountId,vaultId(c),...afterParams),
  db.prepare(`DELETE FROM github_token_staging WHERE token_id=? AND ${after}`).bind(vaultId(c),...afterParams));
 if(cloudflare.length)statements.push(db.prepare(`UPDATE cloudflare_oauth_states SET cancelled=1 WHERE user_id=? AND ${after}`).bind(account.accountId,...afterParams));
 for(const c of cloudflare)statements.push(db.prepare(`UPDATE cloudflare_token_vault SET state='revoking' WHERE id=? AND user_id=? AND ${after}`).bind(vaultId(c),account.accountId,...afterParams));
 if(step.change)statements.push(writeChange(db,step.change));
 statements.push(db.prepare("UPDATE owner_security_reviews SET state='committed',revision=revision+1,commit_request_id=?,commit_request_hash=?,receipt=?,committed_at=? WHERE review_id=? AND account_id=? AND state='open' AND revision=? RETURNING review_id")
  .bind(request.requestId,step.receipt!.requestHash,JSON.stringify(step.result),step.receipt!.committedAt,review.reviewId,review.accountId,review.revision));
 const results=await db.batch(statements);
 if(results.at(-1)!.results.length!==1)throw new EmailChangeError('STALE_REVIEW','race');
}

/** Maps a database refusal to the module's error codes. */
export function reviewStoreError(cause:unknown):EmailChangeError|null {
 const text=String(cause);
 if(/UNIQUE constraint failed: owner_security_reviews\.account_id, owner_security_reviews\.commit_request_id|UNIQUE constraint failed: owner_security_reviews/.test(text))return new EmailChangeError('REQUEST_CONFLICT','database');
 if(text.includes('security_review_new'))return new EmailChangeError('REVIEW_LIMIT','database');
 if(/security_review_(?:guard|commit|retained)|email_change_(?:revision|transition|close|history|frozen)|identity_admission_denied/.test(text))return new EmailChangeError('STALE_REVIEW','race');
 return null;
}
