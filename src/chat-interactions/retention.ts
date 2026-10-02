/** Owner-approved policy: seven days since the last accepted draft edit (or
 * issuance when untouched). Expiry of authority and payload retention differ. */
export const draftRetentionDue="i.removed_at IS NULL AND i.state!='submitted' AND strftime('%Y-%m-%dT%H:%M:%fZ',COALESCE(i.draft_saved_at,i.created_at),'+7 days')<=strftime('%Y-%m-%dT%H:%M:%fZ','now')";
/** System maintenance only: no inference, domain dispatch or submitted cleanup. */
export async function cleanupInteractionDrafts(db:D1Database){
 const result=await db.prepare(`UPDATE chat_interactions SET envelope_json=NULL,draft_json='{}',draft_saved_at=NULL,answer_revision=answer_revision+1,removed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),removal_reason='inactive'
  WHERE id IN (SELECT i.id FROM chat_interactions i WHERE ${draftRetentionDue} ORDER BY COALESCE(i.draft_saved_at,i.created_at),i.id LIMIT 100)`).run();
 return {removed:result.meta.changes};
}
