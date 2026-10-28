import assert from 'node:assert/strict';
const sha256=async text=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))].map(b=>b.toString(16).padStart(2,'0')).join('');
/** Negative evidence for a review kind that carries a chat_review_receipts row.
 * 1. the review's reply was receipted with the digest of the exact stored text (fails when the receipt write is removed);
 * 2. editing every receipted reply makes the confirm control answer 409 and leaves the review row untouched;
 * 3. restoring the text lets the same confirm pass the receipt check again (the caller then confirms as usual).
 * `confirm` is the suite's own way of sending the control: ({kind,reviewId}) => {status}. */
export async function assertReplyEditRefused({db,kind,reviewId,table,confirm,statusColumn='status'}){
 const turns=(await db.prepare('SELECT r.turn_id,r.reply_digest,t.assistant_text FROM chat_review_receipts r JOIN chat_turns t ON t.id=r.turn_id WHERE r.kind=? AND r.review_id=?').bind(kind,reviewId).all()).results;
 assert.ok(turns.length>0,`${kind}: a receipt was written with the review`);
 for(const t of turns)assert.equal(t.reply_digest,await sha256(t.assistant_text),`${kind}: receipt digest is the digest of the shown reply`);
 const before=await db.prepare(`SELECT ${statusColumn} s FROM ${table} WHERE id=?`).bind(reviewId).first();
 for(const t of turns)await db.prepare("UPDATE chat_turns SET assistant_text='Edited. '||assistant_text WHERE id=?").bind(t.turn_id).run();
 const refused=await confirm({kind,reviewId});
 for(const t of turns)await db.prepare('UPDATE chat_turns SET assistant_text=? WHERE id=?').bind(t.assistant_text,t.turn_id).run();
 assert.equal(refused.status,409,`${kind}: confirm after an edited reply is refused`);
 assert.deepEqual(await db.prepare(`SELECT ${statusColumn} s FROM ${table} WHERE id=?`).bind(reviewId).first(),before,`${kind}: the refused confirm changed nothing`);
 return turns.length;
}
