/** WH-201 bounded maintenance for the email-change classes (docs/email-change-and-compromise.md section 4). Fixed, reviewed SQL
 * only, on the database clock (the same clock the schema's triggers use, so this job can neither shorten an undo window nor reset
 * a limit); each statement touches at most `limit` rows, so a backlog drains over successive daily runs instead of one long write.
 *  - pending changes past their expiry become `expired` (a token is refused once expired);
 *  - closed changes lose their plaintext addresses (the hash stays), a confirmed one when its seven-day undo window ends;
 *  - closed changes are deleted 30 days after the later of their expiry and undo deadline (never a pending one);
 *  - rate-limit evidence is deleted after 48 hours;
 *  - compromise-review rows are deleted 90 days after commit or expiry. */
export const emailChangeRetention=Object.freeze({closedChangeDays:30,limitHours:48,reviewDays:90,batch:200});

export async function maintainEmailChanges(db:Pick<D1Database,'prepare'>,limit:number=emailChangeRetention.batch){
 if(!Number.isSafeInteger(limit)||limit<1||limit>1000)throw Error('Invalid maintenance bounds');
 // Fixed SQL, one literal per statement; 2592000000 = 30 days, 172800000 = 48 hours, 7776000000 = 90 days (emailChangeRetention).
 const expired=(await db.prepare("UPDATE owner_email_changes SET state='expired',revision=revision+1,history=json_insert(history,'$[#]','expired') WHERE change_id IN (SELECT change_id FROM owner_email_changes WHERE state='pending' AND expires_at<=(unixepoch()*1000) ORDER BY expires_at LIMIT ?)").bind(limit).run()).meta.changes;
 const redacted=(await db.prepare("UPDATE owner_email_changes SET new_address=NULL,previous_address=NULL,revision=revision+1 WHERE change_id IN (SELECT change_id FROM owner_email_changes WHERE (new_address IS NOT NULL OR previous_address IS NOT NULL) AND (state NOT IN ('pending','confirmed') OR (state='confirmed' AND undo_until<=(unixepoch()*1000))) ORDER BY expires_at LIMIT ?)").bind(limit).run()).meta.changes;
 const changes=(await db.prepare("DELETE FROM owner_email_changes WHERE change_id IN (SELECT change_id FROM owner_email_changes WHERE state!='pending' AND max(expires_at,COALESCE(undo_until,0))<=(unixepoch()*1000)-2592000000 ORDER BY expires_at LIMIT ?)").bind(limit).run()).meta.changes;
 const limits=(await db.prepare('DELETE FROM owner_email_change_limits WHERE id IN (SELECT id FROM owner_email_change_limits WHERE at<=(unixepoch()*1000)-172800000 ORDER BY at LIMIT ?)').bind(limit).run()).meta.changes;
 const reviews=(await db.prepare('DELETE FROM owner_security_reviews WHERE review_id IN (SELECT review_id FROM owner_security_reviews WHERE COALESCE(committed_at,expires_at)<=(unixepoch()*1000)-7776000000 ORDER BY expires_at LIMIT ?)').bind(limit).run()).meta.changes;
 return {expired,redacted,changes,limits,reviews};
}
