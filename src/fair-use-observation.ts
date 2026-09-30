import {assessFairUse,type FairUsePlan} from './fair-use-policy';
/** Successful archive preparation is a signal, not proof a browser saved the download. */
export async function noteSourceExport(db:D1Database,owner:string,version:string){
 await db.prepare(`UPDATE fair_use_project_lifecycle SET export_prepared_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')
 WHERE user_id=? AND ai_saved_at IS NOT NULL AND export_prepared_at IS NULL AND removed_at IS NULL
 AND project_id IN (SELECT v.project_id FROM site_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=? AND p.owner_user_id=?)`).bind(owner,version,owner).run();
}
/** Operator-only observation. No raw messages, metadata, source or cross-owner identifiers. */
export async function readFairUseObservation(db:D1Database,owner:string,plan:FairUsePlan,now=Date.now()){
 if(!Number.isSafeInteger(now)||now<0)throw Error('Invalid observation time');
 const exists=await db.prepare('SELECT id FROM users WHERE id=?').bind(owner).first();if(!exists)throw Error('Fair-use account not found');
 const start7=new Date(now-7*86400000).toISOString(),start30=new Date(now-30*86400000).toISOString(),end=new Date(now).toISOString();
 const rows=await db.batch<Record<string,number>>([
  db.prepare("SELECT COUNT(*) n FROM chat_turns WHERE user_id=? AND mode='ai' AND status='completed' AND created_at>=? AND created_at<=?").bind(owner,start7,end),
  db.prepare(`SELECT COUNT(*) created,COALESCE(SUM(CASE WHEN ai_saved_at>=created_at AND export_prepared_at>=ai_saved_at AND removed_at>=export_prepared_at AND removed_at<=? AND julianday(removed_at)-julianday(created_at)<=3 THEN 1 ELSE 0 END),0) cycles FROM fair_use_project_lifecycle WHERE user_id=? AND created_at>=? AND created_at<=?`).bind(end,owner,start7,end),
  db.prepare(`SELECT COALESCE(SUM(c.estimated_micros),0) micros FROM inference_calls c JOIN chat_turns t ON t.id=c.turn_id AND t.user_id=c.user_id WHERE c.user_id=? AND c.cost_basis='subscription-shadow' AND c.status='observed' AND t.status='completed' AND c.created_at>=? AND c.created_at<=?`).bind(owner,start30,end),
 ]);
 const turns=Number(rows[0].results[0]?.n??0),created=Number(rows[1].results[0]?.created??0),cycles=Number(rows[1].results[0]?.cycles??0),shadow=Number(rows[2].results[0]?.micros??0);
 // Paid expense attribution and contextual review are not live. Never treat missing
 // evidence as confirmed abuse, or hypothetical Muse costs as a provider invoice.
 const control=await db.prepare('SELECT requested_mode FROM fair_use_control WHERE id=1').first<{requested_mode:'monitor'|'enforce'}>();
 const assessment=assessFairUse(plan,{cost30dMicros:0,turns7d:turns,classifiedTurns7d:0,unrelatedTurns7d:0,createdProjects7d:created,completedExportDeleteCycles7d:cycles,review:{unrelatedConfirmed:false,churnConfirmed:false,noticeDelivered:false,unrelatedAfterNotice:0,churnAfterNotice:0}},{mode:control?.requested_mode??'monitor',now});
 return {asOf:end,windows:{activityFrom:start7,costFrom:start30},metrics:{completedAITurns7d:turns,createdProjects7d:created,observedExportRemovalCycles7d:cycles,museShadowMicros30d:shadow,verifiedStandardProviderMicros30d:null},coverage:{siteExports:'archive_prepared_not_download_confirmed',projectRemoval:'database_deletion_only_no_customer_removal_flow',purpose:'not_classified',providerExpense:'not_attributed',review:'not_connected'},assessment};
}
export async function cleanupFairUseObservations(db:D1Database){
 // Retain active-project identity, but only 90 days of removed-project observation.
 await db.prepare("DELETE FROM fair_use_project_lifecycle WHERE removed_at<strftime('%Y-%m-%dT%H:%M:%fZ','now','-90 days')").run();
}
