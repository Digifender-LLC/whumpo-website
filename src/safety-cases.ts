/** WH-015 restricted safety cases and preservation holds.
 * Trusted operator integration only: never route these functions to a customer, visitor, building agent or model.
 * Inputs are opaque identifiers. Raw content, allegations, imagery, messages, names and credentials never belong here.
 * Actor references (`human:<id>`) are declarations until authenticated operator identity exists (WH-124);
 * the schema and these functions make every decision attributable to a named human role holder, never to a model. */
export type SafetyCaseRole='case_reviewer'|'preservation_approver'|'case_auditor';
export type SafetyCaseFinding='uncertain_flag'|'confirmed_policy_finding'|'not_confirmed';
export type SafetyCaseReason='missing_role'|'invalid_input'|'conflict'|'not_found'|'active_hold'|'case_closed'|'capacity'|'unavailable';
type Action='grant_role'|'revoke_role'|'open_case'|'link_evidence'|'record_finding'|'place_hold'|'release_hold'|'close_case'|'read_case'|'read_audit'|'list_holds';
type Q={sql:string;params:unknown[]};

export class SafetyCaseError extends Error{
 constructor(readonly reason:SafetyCaseReason){super('Safety case operation refused: '+reason);}
}
const roles:readonly SafetyCaseRole[]=['case_reviewer','preservation_approver','case_auditor'];
const findings:readonly SafetyCaseFinding[]=['uncertain_flag','confirmed_policy_finding','not_confirmed'];
const opaque=/^[A-Za-z0-9_.:-]{1,128}$/,human=/^human:[A-Za-z0-9_.:-]{1,122}$/;
const isOpaque=(v:unknown):v is string=>typeof v==='string'&&opaque.test(v);
const isHuman=(v:unknown):v is string=>typeof v==='string'&&human.test(v);
const isQ=(v:unknown):v is Q=>!!v&&typeof v==='object'&&'sql' in v&&'params' in v;
/** Composes SQL with positional parameters; values never become SQL text. */
function q(strings:TemplateStringsArray,...values:unknown[]):Q{
 let sql=strings[0];const params:unknown[]=[];
 values.forEach((value,i)=>{if(isQ(value)){sql+=value.sql;params.push(...value.params);}else{sql+='?';params.push(value);}sql+=strings[i+1];});
 return {sql,params};
}
const statement=(db:D1Database,x:Q)=>db.prepare(x.sql).bind(...x.params);
const holds=(actor:string,allowed:readonly SafetyCaseRole[])=>allowed.length
 ?{sql:`EXISTS(SELECT 1 FROM safety_case_roles WHERE operator_ref=? AND revoked_at IS NULL AND role IN (${allowed.map(()=>'?').join(',')}))`,params:[actor,...allowed]}
 :q`1`;

function classify(error:unknown):SafetyCaseReason{
 const text=String(error);
 if(/safety_preservation_hold|safety_hold_active/.test(text))return 'active_hold';
 if(/safety_case_closed/.test(text))return 'case_closed';
 if(/safety_case_capacity/.test(text))return 'capacity';
 if(/safety_case_subject_missing|safety_case_evidence_missing|safety_hold_subject/.test(text))return 'not_found';
 if(/safety_case_immutable|safety_case_finding_order|UNIQUE|CHECK constraint/.test(text))return 'conflict';
 return 'unavailable';
}
async function record(db:D1Database,actor:string|null,action:Action,caseId:string|null,target:string|null,outcome:'denied'|'rejected',reason:SafetyCaseReason){
 try{await db.prepare("INSERT INTO safety_case_audit(at,actor_ref,action,case_id,target_ref,outcome,reason) VALUES(unixepoch(),?,?,?,?,?,?)").bind(actor,action,caseId,target,outcome,reason).run();}
 catch(error){throw new SafetyCaseError(classify(error)==='capacity'?'capacity':'unavailable');}
}
type Attempt={actor:unknown;action:Action;caseId?:unknown;target?:unknown;valid?:boolean;roles:readonly SafetyCaseRole[];
 writes?:(role:Q,actor:string)=>Q[];reads?:(role:Q,actor:string)=>Q[];effect:(actor:string)=>Q;missing?:Q};
/** One transaction: gated effect(s), gated reads, then one audit row that states what actually happened. */
async function attempt(db:D1Database,a:Attempt){
 const caseId=a.caseId===undefined?null:a.caseId,target=a.target===undefined?null:a.target;
 if(!isHuman(a.actor)||(caseId!==null&&!isOpaque(caseId))||(target!==null&&!isOpaque(target))||a.valid===false){
  await record(db,isHuman(a.actor)?a.actor:null,a.action,isOpaque(caseId)?caseId:null,isOpaque(target)?target:null,'rejected','invalid_input');
  throw new SafetyCaseError('invalid_input');
 }
 const actor=a.actor,role=holds(actor,a.roles),writes=a.writes?.(role,actor)??[],reads=a.reads?.(role,actor)??[];
 const audit=q`INSERT INTO safety_case_audit(at,actor_ref,action,case_id,target_ref,outcome,reason) SELECT unixepoch(),${actor},${a.action},${caseId},${target},
  CASE WHEN NOT ${role} THEN 'denied' WHEN ${a.effect(actor)} THEN 'allowed' ELSE 'rejected' END,
  CASE WHEN NOT ${role} THEN 'missing_role' WHEN ${a.effect(actor)} THEN 'ok' WHEN ${a.missing??q`0`} THEN 'not_found' ELSE 'conflict' END RETURNING reason`;
 let results:D1Result[];
 try{results=await db.batch([...writes,...reads,audit].map(x=>statement(db,x)));}
 catch(error){const reason=classify(error);await record(db,actor,a.action,caseId as string|null,target as string|null,'rejected',reason);throw new SafetyCaseError(reason);}
 const reason=(results.at(-1)?.results?.[0] as {reason?:string}|undefined)?.reason;
 if(reason!=='ok')throw new SafetyCaseError(reason==='missing_role'||reason==='not_found'||reason==='conflict'?reason:'unavailable');
 return results.slice(writes.length,writes.length+reads.length).map(r=>(r.results??[]) as Record<string,unknown>[]);
}
const caseExists=(caseId:unknown)=>q`NOT EXISTS(SELECT 1 FROM safety_cases WHERE id=${caseId})`;

/** Role administration is owner-held operator tooling. Self-grants are refused; every grant is audited. */
export async function grantSafetyCaseRole(db:D1Database,input:{grantId:string;operatorRef:string;role:SafetyCaseRole;grantedBy:string}){
 const {grantId,operatorRef,role,grantedBy}=input;
 await attempt(db,{actor:grantedBy,action:'grant_role',target:grantId,roles:[],valid:isHuman(operatorRef)&&roles.includes(role)&&operatorRef!==grantedBy,
  writes:()=>[q`INSERT INTO safety_case_roles(id,operator_ref,role,granted_by,granted_at) SELECT ${grantId},${operatorRef},${role},${grantedBy},unixepoch()
   WHERE NOT EXISTS(SELECT 1 FROM safety_case_roles WHERE id=${grantId}) AND NOT EXISTS(SELECT 1 FROM safety_case_roles WHERE operator_ref=${operatorRef} AND role=${role} AND revoked_at IS NULL)`],
  effect:()=>q`EXISTS(SELECT 1 FROM safety_case_roles WHERE id=${grantId} AND operator_ref=${operatorRef} AND role=${role} AND granted_by=${grantedBy} AND revoked_at IS NULL)`});
}
export async function revokeSafetyCaseRole(db:D1Database,input:{grantId:string;revokedBy:string;revokeRef:string}){
 const {grantId,revokedBy,revokeRef}=input;
 await attempt(db,{actor:revokedBy,action:'revoke_role',target:grantId,roles:[],valid:isOpaque(revokeRef),
  writes:()=>[q`UPDATE safety_case_roles SET revoked_at=unixepoch(),revoked_by=${revokedBy},revoke_ref=${revokeRef} WHERE id=${grantId} AND revoked_at IS NULL`],
  effect:()=>q`EXISTS(SELECT 1 FROM safety_case_roles WHERE id=${grantId} AND revoked_by=${revokedBy} AND revoke_ref=${revokeRef})`,
  missing:q`NOT EXISTS(SELECT 1 FROM safety_case_roles WHERE id=${grantId})`});
}
/** A new case is always an uncertain flag. Confirmation is a separate named human decision. */
export async function openSafetyCase(db:D1Database,input:{caseId:string;subjectUserId:string;intakeRef:string;actor:string}){
 const {caseId,subjectUserId,intakeRef,actor}=input;
 await attempt(db,{actor,action:'open_case',caseId,roles:['case_reviewer'],valid:isOpaque(subjectUserId)&&isOpaque(intakeRef),
  writes:role=>[
   q`INSERT INTO safety_cases(id,subject_user_id,intake_ref,opened_by,opened_at) SELECT ${caseId},${subjectUserId},${intakeRef},${actor},unixepoch() WHERE ${role} AND NOT EXISTS(SELECT 1 FROM safety_cases WHERE id=${caseId})`,
   q`INSERT INTO safety_case_findings(case_id,seq,finding,reviewer_ref,decision_ref,recorded_at) SELECT ${caseId},1,'uncertain_flag',${actor},${intakeRef},unixepoch()
    WHERE ${role} AND NOT EXISTS(SELECT 1 FROM safety_case_findings WHERE case_id=${caseId})`],
  effect:()=>q`EXISTS(SELECT 1 FROM safety_cases WHERE id=${caseId} AND subject_user_id=${subjectUserId} AND intake_ref=${intakeRef} AND opened_by=${actor})`});
}
/** Links an existing reviewed ledger record of the same subject. Linking never changes the finding. */
export async function linkSafetyCaseEvidence(db:D1Database,input:{caseId:string;evidenceId:string;actor:string}){
 const {caseId,evidenceId,actor}=input;
 await attempt(db,{actor,action:'link_evidence',caseId,target:evidenceId,roles:['case_reviewer'],
  writes:role=>[q`INSERT INTO safety_case_evidence(case_id,evidence_id,linked_by,linked_at) SELECT ${caseId},${evidenceId},${actor},unixepoch()
   WHERE ${role} AND EXISTS(SELECT 1 FROM safety_cases WHERE id=${caseId}) AND NOT EXISTS(SELECT 1 FROM safety_case_evidence WHERE case_id=${caseId} AND evidence_id=${evidenceId})`],
  effect:()=>q`EXISTS(SELECT 1 FROM safety_case_evidence WHERE case_id=${caseId} AND evidence_id=${evidenceId})`,missing:caseExists(caseId)});
}
/** Appends a reviewed decision. Corrections append; earlier decisions remain. */
export async function recordSafetyCaseFinding(db:D1Database,input:{caseId:string;finding:SafetyCaseFinding;decisionRef:string;actor:string}){
 const {caseId,finding,decisionRef,actor}=input;
 await attempt(db,{actor,action:'record_finding',caseId,target:decisionRef,roles:['case_reviewer'],valid:findings.includes(finding),
  writes:role=>[q`INSERT INTO safety_case_findings(case_id,seq,finding,reviewer_ref,decision_ref,recorded_at)
   SELECT ${caseId},COALESCE((SELECT max(seq) FROM safety_case_findings WHERE case_id=${caseId}),0)+1,${finding},${actor},${decisionRef},unixepoch()
   WHERE ${role} AND EXISTS(SELECT 1 FROM safety_cases WHERE id=${caseId}) AND NOT EXISTS(SELECT 1 FROM safety_case_findings WHERE case_id=${caseId} AND decision_ref=${decisionRef})`],
  effect:a=>q`EXISTS(SELECT 1 FROM safety_case_findings WHERE case_id=${caseId} AND decision_ref=${decisionRef} AND finding=${finding} AND reviewer_ref=${a})`,missing:caseExists(caseId)});
}
/** Places an account-scope hold. legalBasisRef names the separate human applicability/retention decision. */
export async function placePreservationHold(db:D1Database,input:{holdId:string;caseId:string;legalBasisRef:string;reviewDays:number;actor:string}){
 const {holdId,caseId,legalBasisRef,reviewDays,actor}=input;
 await attempt(db,{actor,action:'place_hold',caseId,target:holdId,roles:['preservation_approver'],valid:isOpaque(legalBasisRef)&&Number.isSafeInteger(reviewDays)&&reviewDays>=1&&reviewDays<=366,
  writes:role=>[q`INSERT INTO safety_preservation_holds(id,case_id,subject_user_id,scope,legal_basis_ref,approved_by,placed_at,review_due_at)
   SELECT ${holdId},id,subject_user_id,'account',${legalBasisRef},${actor},unixepoch(),unixepoch()+${reviewDays}*86400 FROM safety_cases
   WHERE id=${caseId} AND ${role} AND NOT EXISTS(SELECT 1 FROM safety_preservation_holds WHERE id=${holdId})`],
  effect:a=>q`EXISTS(SELECT 1 FROM safety_preservation_holds WHERE id=${holdId} AND case_id=${caseId} AND legal_basis_ref=${legalBasisRef} AND approved_by=${a} AND released_at IS NULL)`,missing:caseExists(caseId)});
}
/** Explicit, audited release; the hold record remains. */
export async function releasePreservationHold(db:D1Database,input:{holdId:string;caseId:string;releaseRef:string;actor:string}){
 const {holdId,caseId,releaseRef,actor}=input;
 await attempt(db,{actor,action:'release_hold',caseId,target:holdId,roles:['preservation_approver'],valid:isOpaque(releaseRef),
  writes:role=>[q`UPDATE safety_preservation_holds SET released_at=unixepoch(),released_by=${actor},release_ref=${releaseRef} WHERE id=${holdId} AND case_id=${caseId} AND released_at IS NULL AND ${role}`],
  effect:a=>q`EXISTS(SELECT 1 FROM safety_preservation_holds WHERE id=${holdId} AND case_id=${caseId} AND released_by=${a} AND release_ref=${releaseRef})`,
  missing:q`NOT EXISTS(SELECT 1 FROM safety_preservation_holds WHERE id=${holdId} AND case_id=${caseId})`});
}
/** Closing requires every hold on the case to be released first. */
export async function closeSafetyCase(db:D1Database,input:{caseId:string;closeRef:string;actor:string}){
 const {caseId,closeRef,actor}=input;
 await attempt(db,{actor,action:'close_case',caseId,target:closeRef,roles:['case_reviewer'],
  writes:role=>[q`UPDATE safety_cases SET closed_at=unixepoch(),closed_by=${actor},close_ref=${closeRef} WHERE id=${caseId} AND closed_at IS NULL AND ${role}`],
  effect:a=>q`EXISTS(SELECT 1 FROM safety_cases WHERE id=${caseId} AND closed_by=${a} AND close_ref=${closeRef})`,missing:caseExists(caseId)});
}
export type SafetyCaseView={id:string;subjectUserId:string;intakeRef:string;openedBy:string;openedAt:number;closedAt:number|null;
 currentFinding:SafetyCaseFinding;findings:{seq:number;finding:SafetyCaseFinding;reviewerRef:string;decisionRef:string;recordedAt:number}[];
 evidenceIds:string[];holds:{id:string;scope:'account';legalBasisRef:string;approvedBy:string;placedAt:number;reviewDueAt:number;releasedAt:number|null;releasedBy:string|null;releaseRef:string|null;active:boolean;overdue:boolean}[]};
/** Restricted read: identifiers and decisions only. The read itself is audited. */
export async function readSafetyCase(db:D1Database,input:{caseId:string;actor:string}):Promise<SafetyCaseView>{
 const {caseId,actor}=input;
 const [cases,rows,links,held]=await attempt(db,{actor,action:'read_case',caseId,roles,
  reads:role=>[
   q`SELECT id,subject_user_id AS subjectUserId,intake_ref AS intakeRef,opened_by AS openedBy,opened_at AS openedAt,closed_at AS closedAt FROM safety_cases WHERE id=${caseId} AND ${role}`,
   q`SELECT seq,finding,reviewer_ref AS reviewerRef,decision_ref AS decisionRef,recorded_at AS recordedAt FROM safety_case_findings WHERE case_id=${caseId} AND ${role} ORDER BY seq`,
   q`SELECT evidence_id AS evidenceId FROM safety_case_evidence WHERE case_id=${caseId} AND ${role} ORDER BY evidence_id`,
   q`SELECT id,scope,legal_basis_ref AS legalBasisRef,approved_by AS approvedBy,placed_at AS placedAt,review_due_at AS reviewDueAt,released_at AS releasedAt,released_by AS releasedBy,release_ref AS releaseRef,
    released_at IS NULL AS active,(released_at IS NULL AND review_due_at<=unixepoch()) AS overdue FROM safety_preservation_holds WHERE case_id=${caseId} AND ${role} ORDER BY placed_at,id`],
  effect:()=>q`EXISTS(SELECT 1 FROM safety_cases WHERE id=${caseId})`,missing:caseExists(caseId)});
 const row=cases[0];if(!row||!rows.length)throw new SafetyCaseError('unavailable');
 return {...(row as Omit<SafetyCaseView,'currentFinding'|'findings'|'evidenceIds'|'holds'>),currentFinding:rows.at(-1)!.finding as SafetyCaseFinding,findings:rows as SafetyCaseView['findings'],
  evidenceIds:links.map(l=>l.evidenceId as string),holds:held.map(h=>({...h,active:!!h.active,overdue:!!h.overdue})) as SafetyCaseView['holds']};
}
/** Auditor-only access history for one case. */
export async function readSafetyCaseAudit(db:D1Database,input:{caseId:string;actor:string}){
 const {caseId,actor}=input;
 const [rows]=await attempt(db,{actor,action:'read_audit',caseId,roles:['case_auditor'],
  reads:role=>[q`SELECT seq,at,actor_ref AS actorRef,action,target_ref AS targetRef,outcome,reason FROM safety_case_audit WHERE case_id=${caseId} AND ${role} ORDER BY seq LIMIT 1000`],
  effect:()=>q`1`});
 return rows;
}
/** Active holds, including overdue reviews; an overdue hold still blocks deletion until released. */
export async function listActivePreservationHolds(db:D1Database,input:{actor:string}){
 const [rows]=await attempt(db,{actor:input.actor,action:'list_holds',roles:['preservation_approver','case_auditor'],
  reads:role=>[q`SELECT id,case_id AS caseId,subject_user_id AS subjectUserId,review_due_at AS reviewDueAt,(review_due_at<=unixepoch()) AS overdue
   FROM safety_preservation_holds WHERE released_at IS NULL AND ${role} ORDER BY review_due_at,id LIMIT 1000`],
  effect:()=>q`1`});
 return rows.map(r=>({...r,overdue:!!r.overdue}));
}
