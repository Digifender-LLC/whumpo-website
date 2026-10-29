/** WH-143 bounded maintenance for the connector-receipts class (docs/data-lifecycle.json). Fixed SQL on the database clock, the same
 * clock the schema's retention triggers use; each statement touches at most `limit` rows.
 *  - lookup consents are deleted seven days after use, voiding or expiry;
 *  - receipts are deleted 400 days after their last change, never while dispatching or uncertain. */
export const connectorRecordRetention=Object.freeze({consentDays:7,receiptDays:400,batch:200});

export async function maintainConnectorRecords(db:Pick<D1Database,'prepare'>,limit:number=connectorRecordRetention.batch){
 if(!Number.isSafeInteger(limit)||limit<1||limit>1000)throw Error('Invalid maintenance bounds');
 // 604800000 = 7 days, 34560000000 = 400 days (connectorRecordRetention).
 const consents=(await db.prepare('DELETE FROM lookup_consents WHERE consent_id IN (SELECT consent_id FROM lookup_consents WHERE COALESCE(settled_at,expires_at)<=(unixepoch()*1000)-604800000 ORDER BY expires_at LIMIT ?)').bind(limit).run()).meta.changes;
 const receipts=(await db.prepare("DELETE FROM connector_receipts WHERE receipt_id IN (SELECT receipt_id FROM connector_receipts WHERE state NOT IN ('dispatching','uncertain') AND updated_at<=(unixepoch()*1000)-34560000000 ORDER BY updated_at LIMIT ?)").bind(limit).run()).meta.changes;
 return {consents,receipts};
}
