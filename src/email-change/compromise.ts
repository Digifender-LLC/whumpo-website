/** WH-063 / WH-200 email-change transitions used by a compromise review (contract version 1,
 * docs/email-change-and-compromise.md section 3). WH-200 owns only how a pending address change responds to a review:
 * the review snapshot reports it, and the guarded commit closes it. Fencing of older authority is in authorizeOwner
 * (policy.ts: authority from an earlier epoch is refused) and in confirmEmailChange (a change requested under an earlier
 * epoch is stale), so a session, in-flight sign-in or emailed token issued before the commit cannot change the address
 * afterward.
 *
 * Left for WH-203: the review snapshot and its staleness binding (epoch, credential revision, kit generation,
 * connection set), emergency passkey removal below two keys, the epoch advance that revokes every session, grant,
 * challenge and kit offer, kit rotation with save-before-rotation, provider-connection disable and revoke-before-erase
 * with held unknown outcomes, the content-free receipt and the security-review notice. */
import {moved} from './change';
import type {EmailChange} from './change';

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
