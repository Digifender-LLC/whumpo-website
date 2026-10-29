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
 const now='(unixepoch()*1000)',run=async(sql:string)=>(await db.prepare(sql).bind(limit).run()).meta.changes;
 const expired=await run(`UPDATE owner_email_changes SET state='expired',revision=revision+1,history=json_insert(history,'$[#]','expired') WHERE change_id IN (SELECT change_id FROM owner_email_changes WHERE state='pending' AND expires_at<=${now} ORDER BY expires_at LIMIT ?)`);
 const redacted=await run(`UPDATE owner_email_changes SET new_address=NULL,previous_address=NULL,revision=revision+1 WHERE change_id IN (SELECT change_id FROM owner_email_changes WHERE (new_address IS NOT NULL OR previous_address IS NOT NULL) AND (state NOT IN ('pending','confirmed') OR (state='confirmed' AND undo_until<=${now})) ORDER BY expires_at LIMIT ?)`);
 const changes=await run(`DELETE FROM owner_email_changes WHERE change_id IN (SELECT change_id FROM owner_email_changes WHERE state!='pending' AND max(expires_at,COALESCE(undo_until,0))<=${now}-${emailChangeRetention.closedChangeDays*86400000} ORDER BY expires_at LIMIT ?)`);
 const limits=await run(`DELETE FROM owner_email_change_limits WHERE id IN (SELECT id FROM owner_email_change_limits WHERE at<=${now}-${emailChangeRetention.limitHours*3600000} ORDER BY at LIMIT ?)`);
 const reviews=await run(`DELETE FROM owner_security_reviews WHERE review_id IN (SELECT review_id FROM owner_security_reviews WHERE COALESCE(committed_at,expires_at)<=${now}-${emailChangeRetention.reviewDays*86400000} ORDER BY expires_at LIMIT ?)`);
 return {expired,redacted,changes,limits,reviews};
}
