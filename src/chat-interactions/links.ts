import {assertWorkspace} from '../workspace-identity/admission';
/** Transcript pointers contain no draft values or actionable definitions. */
export async function interactionChatLinks(db:D1Database,user:string,turns:{id:unknown;[key:string]:unknown}[]){
 await assertWorkspace(db,user);if(turns.length>100)throw Error('Read at most one hundred current turns.');if(!turns.length)return;
 const links:{id:string;origin_turn_id:string}[]=[];
 // Leave room for owner parameters within D1's per-statement binding bound.
 for(let offset=0;offset<turns.length;offset+=50){
  const page=turns.slice(offset,offset+50);
  const {results}=await db.prepare(`SELECT i.id,i.origin_turn_id FROM chat_interactions i
  WHERE i.user_id=? AND i.origin_turn_id IN (${page.map(()=>'?').join(',')})
  AND (i.project_id IS NULL OR EXISTS(SELECT 1 FROM projects p WHERE p.id=i.project_id AND p.owner_user_id=i.user_id)) LIMIT 50`).bind(user,...page.map(t=>t.id)).all<{id:string;origin_turn_id:string}>();
  links.push(...results);
 }
 await assertWorkspace(db,user);
 for(const r of links){const turn=turns.find(t=>t.id===r.origin_turn_id);if(turn)turn.interaction_id=r.id;}
}
