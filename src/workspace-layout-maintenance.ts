/** B11 bounded maintenance: an owner keeps the latest 50 layout receipts (the newest is the current layout and is never pruned).
 * The schema trigger workspace_layout_receipt_cap enforces the same cap on every insert; this nightly pass removes any older surplus. */
export const layoutReceiptCap=50;

export async function pruneLayoutReceipts(db:Pick<D1Database,'prepare'>,limit:number=200){
 if(!Number.isSafeInteger(limit)||limit<1||limit>1000)throw Error('Invalid maintenance bounds');
 // 50 = layoutReceiptCap.
 const layoutReceipts=(await db.prepare('DELETE FROM workspace_layout_receipts WHERE rowid IN (SELECT r.rowid FROM workspace_layout_receipts r WHERE r.to_revision<=(SELECT max(m.to_revision) FROM workspace_layout_receipts m WHERE m.user_id=r.user_id)-50 LIMIT ?)').bind(limit).run()).meta.changes;
 return {layoutReceipts};
}
