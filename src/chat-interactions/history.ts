import {assertWorkspace} from '../workspace-identity/admission';
import {verifyEnvelope} from './protocol';
/** Current owned historical facts only: no bindings, source selectors, digests or approval controls. */
export async function interactionHistory(db:D1Database,user:string,turnIds:string[]){
 await assertWorkspace(db,user);
 if(turnIds.length>50)throw new Error('Read at most fifty Chat turns.');
 if(!turnIds.length)return new Map<string,unknown>();
 const {results}=await db.prepare(`SELECT i.id,i.previous_interaction_id,child.id replacement_interaction_id,i.origin_turn_id,i.envelope_json,i.state,i.answer_revision,i.expires_at,s.answers_json,s.created_at submitted_at,c.state continuation_state,c.reason,strftime('%Y-%m-%dT%H:%M:%fZ','now') now
 FROM chat_interactions i JOIN chat_turns t ON t.id=i.origin_turn_id AND t.user_id=i.user_id
 LEFT JOIN chat_interactions child ON child.previous_interaction_id=i.id AND child.user_id=i.user_id
 LEFT JOIN chat_interaction_submissions s ON s.interaction_id=i.id AND s.user_id=i.user_id
 LEFT JOIN chat_interaction_continuations c ON c.id=s.id
 WHERE i.user_id=? AND i.origin_turn_id IN (${turnIds.map(()=>'?')})
 AND (i.project_id IS NULL OR EXISTS(SELECT 1 FROM projects p WHERE p.id=i.project_id AND p.owner_user_id=i.user_id)) LIMIT 50`).bind(user,...turnIds).all<{id:string;previous_interaction_id:string|null;replacement_interaction_id:string|null;origin_turn_id:string;envelope_json:string;state:string;answer_revision:number;expires_at:string;answers_json:string|null;submitted_at:string|null;continuation_state:string|null;reason:string|null;now:string}>();
 const entries:([string,unknown])[]=[];
 for(const row of results){
  const {definition}=await verifyEnvelope(JSON.parse(row.envelope_json));
  entries.push([row.origin_turn_id,{version:1,id:row.id,previousInteractionId:row.previous_interaction_id,replacementInteractionId:row.replacement_interaction_id,title:definition.title,summary:definition.summary,state:row.state==='open'&&row.expires_at<=row.now?'expired':row.state,answerRevision:row.answer_revision,
   fields:definition.fields.map(f=>({id:f.id,label:f.label,help:f.help,type:f.type,required:f.required,...(f.default?{default:f.default}:{})})),
   submission:row.answers_json?{answers:JSON.parse(row.answers_json),submittedAt:row.submitted_at,continuation:{state:row.continuation_state,reason:row.reason}}:null}]);
 }
 await assertWorkspace(db,user);return new Map(entries);
}
