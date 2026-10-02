import {assertWorkspace} from '../workspace-identity/admission';
import {verifyEnvelope,validateAnswers} from './protocol';
import {draftRetentionDue} from './retention';
/** Current owned historical facts only: no bindings, selectors or approval controls. */
export const interactionHistory=(db:D1Database,user:string,turnIds:string[])=>interactionFacts(db,user,turnIds,false);
/** Export includes retained latest drafts with their own observation/revision. */
export const interactionExport=(db:D1Database,user:string,turnIds:string[])=>interactionFacts(db,user,turnIds,true);
async function interactionFacts(db:D1Database,user:string,turnIds:string[],includeDrafts:boolean){
 await assertWorkspace(db,user);
 if(turnIds.length>50)throw new Error('Read at most fifty Chat turns.');
 if(!turnIds.length)return new Map<string,unknown>();
 const unavailable=`(i.removed_at IS NOT NULL OR (${draftRetentionDue}))`;
 const {results}=await db.prepare(`SELECT i.id,i.previous_interaction_id,child.id replacement_interaction_id,i.origin_turn_id,
 CASE WHEN ${unavailable} THEN NULL ELSE i.envelope_json END envelope_json,
 ${includeDrafts?`CASE WHEN ${unavailable} THEN NULL ELSE i.draft_json END`:'NULL'} draft_json,
 i.draft_saved_at,i.state,i.answer_revision,i.expires_at,i.removed_at,i.removal_reason,
 s.answers_json,s.created_at submitted_at,c.state continuation_state,c.reason,strftime('%Y-%m-%dT%H:%M:%fZ','now') now
 FROM chat_interactions i JOIN chat_turns t ON t.id=i.origin_turn_id AND t.user_id=i.user_id
 LEFT JOIN chat_interactions child ON child.previous_interaction_id=i.id AND child.user_id=i.user_id
 LEFT JOIN chat_interaction_submissions s ON s.interaction_id=i.id AND s.user_id=i.user_id
 LEFT JOIN chat_interaction_continuations c ON c.id=s.id
 WHERE i.user_id=? AND i.origin_turn_id IN (${turnIds.map(()=>'?')})
 AND (i.project_id IS NULL OR EXISTS(SELECT 1 FROM projects p WHERE p.id=i.project_id AND p.owner_user_id=i.user_id)) LIMIT 50`).bind(user,...turnIds).all<{id:string;previous_interaction_id:string|null;replacement_interaction_id:string|null;origin_turn_id:string;envelope_json:string|null;draft_json:string|null;draft_saved_at:string|null;state:string;answer_revision:number;expires_at:string;removed_at:string|null;removal_reason:string|null;answers_json:string|null;submitted_at:string|null;continuation_state:string|null;reason:string|null;now:string}>();
 const entries:([string,unknown])[]=[];
 for(const row of results){
  const identity={version:1,id:row.id,previousInteractionId:row.previous_interaction_id,replacementInteractionId:row.replacement_interaction_id,answerRevision:row.answer_revision};
  if(!row.envelope_json){entries.push([row.origin_turn_id,{...identity,state:'removed',removal:{reason:row.removal_reason??'inactive',completedAt:row.removed_at}}]);continue;}
  const {definition}=await verifyEnvelope(JSON.parse(row.envelope_json));
  entries.push([row.origin_turn_id,{...identity,title:definition.title,summary:definition.summary,state:row.state==='open'&&row.expires_at<=row.now?'expired':row.state,
   fields:definition.fields.map(f=>({id:f.id,label:f.label,help:f.help,type:f.type,required:f.required,...(f.default?(includeDrafts?{default:f.default}:{defaultProvenance:f.default.provenance}):{})})),
   ...(includeDrafts?{observedAt:row.now,draft:row.draft_saved_at&&row.draft_json?{answers:validateAnswers(definition,JSON.parse(row.draft_json),{partial:true}),savedAt:row.draft_saved_at,answerRevision:row.answer_revision}:null}:{}),
   submission:row.answers_json?{answers:JSON.parse(row.answers_json),submittedAt:row.submitted_at,continuation:{state:row.continuation_state,reason:row.reason}}:null}]);
 }
 await assertWorkspace(db,user);return new Map(entries);
}
