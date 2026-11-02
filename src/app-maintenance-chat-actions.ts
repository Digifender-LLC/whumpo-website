import {hashToken} from './security';
import {readMigrationReview} from './app-migration-approval';
import {readProgramRollback} from './app-program-rollback';
import type {AppMaintenancePresentation} from './app-maintenance-shape';
type Turn=Record<string,unknown>;
export async function linkMaintenanceReply(db:D1Database,user:string,turn:string,kind:'upgrade'|'rollback',id:string,reply:string){
 if(!reply.startsWith(`Application ${kind==='upgrade'?'upgrade':'program rollback'} review ${id}\n`))return;
 await db.prepare('INSERT OR IGNORE INTO app_maintenance_chat_links(turn_id,user_id,kind,review_id,reply_digest) SELECT id,user_id,?,?,? FROM chat_turns WHERE id=? AND user_id=?').bind(kind,id,await hashToken(reply),turn,user).run();
}
/** Bounded recent controls with current owned authority and an exact server reply digest. */
export async function appMaintenanceChatActions(db:D1Database,user:string,turns:Turn[]){
 for(const t of turns)delete t.app_maintenance_review;
 const candidates=turns.filter(t=>t.status==='completed'&&typeof t.assistant_text==='string'&&/^Application (upgrade|program rollback) review /.test(t.assistant_text)).slice(0,20);
 if(!candidates.length)return;
 const {results:links}=await db.prepare(`SELECT turn_id,kind,review_id,reply_digest FROM app_maintenance_chat_links WHERE user_id=? AND turn_id IN (${candidates.map(()=>'?').join(',')})`).bind(user,...candidates.map(t=>String(t.id))).all<{turn_id:string;kind:'upgrade'|'rollback';review_id:string;reply_digest:string}>();
 const cache=new Map<string,AppMaintenancePresentation|null>();
 for(const l of links){
  const turn=candidates.find(t=>t.id===l.turn_id)!;if(await hashToken(String(turn.assistant_text))!==l.reply_digest)continue;
  const key=l.kind+':'+l.review_id;
  if(!cache.has(key)){
   try{
    if(l.kind==='upgrade'){
     const r=await readMigrationReview(db,user,l.review_id);
     cache.set(key,{kind:'upgrade',id:r.id,projectId:r.projectId,projectName:r.projectName,documents:r.documents,expiresAt:r.expiresAt,state:r.state as AppMaintenancePresentation['state'],fromVersion:r.fromVersion,toVersion:r.toVersion,pointId:r.id,beforePointId:r.id,transformVersion:r.transformVersion,testId:r.testId,ready:r.ready,pending:r.pending,failed:r.failed,busy:r.busy,changedDocuments:r.changedDocuments});
    }else{
     const r=await readProgramRollback(db,user,l.review_id);
     cache.set(key,{kind:'rollback',id:r.id,projectId:r.projectId,projectName:r.projectName,documents:r.documents,expiresAt:r.expiresAt,state:r.state as AppMaintenancePresentation['state'],fromVersion:r.from.id,toVersion:r.to.id,pointId:r.pointId,beforePointId:r.beforePointId,pointCreatedAt:r.pointCreatedAt,ready:0,pending:0,failed:0});
    }
   }catch{cache.set(key,null); /* Missing or invalid authority must never expose a control. */}
  }
  const metadata=cache.get(key);if(metadata)turn.app_maintenance_review=metadata;
 }
}
