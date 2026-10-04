/** WH-015 restricted safety cases, preservation holds, restricted evidence and lawful-disclosure records (WH-131/WH-132).
 * Restricted operator surface only: never route these functions to a customer, visitor, building agent, Chat tool or model.
 * Every operation requires an authenticated Whumpo passkey session with a fresh (10-minute) passkey proof; the actor
 * reference is derived from that session (`human:<account id>`), never declared by the caller.
 * Inputs are opaque identifiers. Raw content, allegations, imagery, messages, names and credentials never belong here,
 * and nothing in this module logs, returns or transmits evidence bytes. */
import {assertCurrentIdentity,identityPredicate,IdentityError,type IdentityPrincipal,type IdentityPolicy} from './workspace-identity/authority';

export type SafetyCaseRole='case_reviewer'|'preservation_approver'|'case_auditor'|'disclosure_approver'|'role_administrator';
export type SafetyCaseFinding='uncertain_flag'|'confirmed_policy_finding'|'not_confirmed';
export type SafetyHoldScope='account'|'project'|'object';
export type SafetyEvidenceSource='project_photo'|'profile_photo'|'preserved_record';
export type SafetyCaseReason='missing_role'|'invalid_input'|'conflict'|'not_found'|'active_hold'|'case_closed'|'capacity'|'unavailable';
type AuditReason=SafetyCaseReason|'ok'|'unauthenticated'|'conflict_of_interest';
type Action='bootstrap_administrator'|'grant_role'|'revoke_role'|'open_case'|'link_evidence'|'record_finding'|'place_hold'|'release_hold'|'close_case'|'read_case'|'read_audit'|'list_holds'
 |'capture_evidence'|'dispose_evidence'|'request_disclosure'|'approve_disclosure'|'record_disclosure'|'cancel_disclosure'|'read_disclosure'
 |'list_retention'|'preview_retention'|'decide_retention';
type Q={sql:string;params:unknown[]};
type Database=Pick<D1Database,'prepare'|'batch'>;
type EvidenceEnv={DB:Database;FILES:Pick<R2Bucket,'get'|'put'|'head'|'delete'>};

export class SafetyCaseError extends Error{
 constructor(readonly reason:SafetyCaseReason){super('Safety case operation refused: '+reason);}
}
const roles:readonly SafetyCaseRole[]=['case_reviewer','preservation_approver','case_auditor','disclosure_approver','role_administrator'];
const caseRoles:readonly SafetyCaseRole[]=['case_reviewer','preservation_approver','case_auditor','disclosure_approver'];
const findings:readonly SafetyCaseFinding[]=['uncertain_flag','confirmed_policy_finding','not_confirmed'];
const scopes:readonly SafetyHoldScope[]=['account','project','object'];
const sources:readonly SafetyEvidenceSource[]=['project_photo','profile_photo','preserved_record'];
/** Fresh passkey proof within the existing identity authority; the same predicate gates every commit. */
const operatorPolicy:IdentityPolicy=Object.freeze({purpose:'workspace',freshPasskey:true,bindIdentityRevision:false});
export const restrictedEvidencePrefix='restricted/safety-evidence/';
/** WH-132 default retention term for cases and evidence objects (owner decision October 4, 2026, pending counsel). Each
 * case and evidence object records its own due date from this constant when it is created; at expiry the case appears
 * in the operator review queue as `retention_review_due`. Nothing is released or deleted without an operator decision. */
export const safetyRetentionDays=365;
const retentionSeconds=safetyRetentionDays*86400;
/** An extension's term, from the decision, in days (the same 366-day bound as a hold review term). */
export const maxRetentionExtensionDays=366;
const opaque=/^[A-Za-z0-9_.:-]{1,128}$/,account=/^[A-Za-z0-9_.:-]{1,122}$/;
const isOpaque=(v:unknown):v is string=>typeof v==='string'&&opaque.test(v);
const isAccount=(v:unknown):v is string=>typeof v==='string'&&account.test(v);
const isQ=(v:unknown):v is Q=>!!v&&typeof v==='object'&&'sql' in v&&'params' in v;
/** Composes SQL with positional parameters; values never become SQL text. */
function q(strings:TemplateStringsArray,...values:unknown[]):Q{
 let sql=strings[0];const params:unknown[]=[];
 values.forEach((value,i)=>{if(isQ(value)){sql+=value.sql;params.push(...value.params);}else{sql+='?';params.push(value);}sql+=strings[i+1];});
 return {sql,params};
}
const statement=(db:Database,x:Q)=>db.prepare(x.sql).bind(...x.params);
const hasRole=(actor:string,allowed:readonly SafetyCaseRole[])=>({sql:`EXISTS(SELECT 1 FROM safety_case_roles WHERE operator_ref=? AND revoked_at IS NULL AND role IN (${allowed.map(()=>'?').join(',')}))`,params:[actor,...allowed]});
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
const sha256=async(bytes:Uint8Array)=>hex(await crypto.subtle.digest('SHA-256',bytes));

function classify(error:unknown):SafetyCaseReason{
 const text=String(error);
 if(/safety_preservation_hold|safety_hold_active/.test(text))return 'active_hold';
 if(/safety_case_closed/.test(text))return 'case_closed';
 if(/safety_case_capacity/.test(text))return 'capacity';
 if(/safety_case_subject_missing|safety_case_evidence_missing|safety_hold_subject/.test(text))return 'not_found';
 if(/safety_case_immutable|safety_case_finding_order|safety_retention_changed|safety_retention_case_open|UNIQUE|CHECK constraint|FOREIGN KEY/.test(text))return 'conflict';
 return 'unavailable';
}
async function record(db:Database,actor:string|null,action:Action,caseId:string|null,target:string|null,outcome:'denied'|'rejected',reason:AuditReason){
 try{await db.prepare("INSERT INTO safety_case_audit(at,actor_ref,action,case_id,target_ref,outcome,reason) VALUES(unixepoch(),?,?,?,?,?,?)").bind(actor,action,caseId,target,outcome,reason).run();}
 catch(error){throw new SafetyCaseError(classify(error)==='capacity'?'capacity':'unavailable');}
}
type Attempt={principal:unknown;action:Action;caseId?:unknown;target?:unknown;valid?:boolean;roles:readonly SafetyCaseRole[];
 /** True when the actor may act on this subject; defaults to "not the case subject" when a case is named. */
 independent?:(account:string)=>Q;
 writes?:(gate:Q,actor:string)=>Q[];reads?:(gate:Q,actor:string)=>Q[];effect:(actor:string)=>Q;missing?:Q};
/** Authenticates the session's fresh passkey proof, then runs one transaction: gated effect(s), gated reads and one audit
 * row that states what actually happened. The commit itself re-checks the identity, so a proof revoked or aged after
 * admission cannot commit. */
async function attempt(db:Database,a:Attempt){
 const caseId=a.caseId===undefined?null:a.caseId,target=a.target===undefined?null:a.target;
 const safeCase=isOpaque(caseId)?caseId:null,safeTarget=isOpaque(target)?target:null;
 let identity:Q;
 try{identity=identityPredicate(db,a.principal as IdentityPrincipal,operatorPolicy);}
 catch(error){await record(db,null,a.action,safeCase,safeTarget,'denied','unauthenticated');throw error;}
 const principal=a.principal as IdentityPrincipal,accountId=principal.accountId,actor='human:'+accountId;
 if(!isAccount(accountId))throw new IdentityError(403,'identity_incomplete','Operator access requires a current account.');
 try{await assertCurrentIdentity(db,principal,operatorPolicy);}
 catch(error){await record(db,actor,a.action,safeCase,safeTarget,'denied','unauthenticated');throw error;}
 if((caseId!==null&&!isOpaque(caseId))||(target!==null&&!isOpaque(target))||a.valid===false){
  await record(db,actor,a.action,safeCase,safeTarget,'rejected','invalid_input');
  throw new SafetyCaseError('invalid_input');
 }
 const role=hasRole(actor,a.roles);
 const independent=a.independent?.(accountId)??(caseId===null?q`1`:q`NOT EXISTS(SELECT 1 FROM safety_cases WHERE id=${caseId} AND subject_user_id=${accountId})`);
 const gate=q`(${identity} AND ${role} AND ${independent})`;
 const writes=a.writes?.(gate,actor)??[],reads=a.reads?.(gate,actor)??[];
 const audit=q`INSERT INTO safety_case_audit(at,actor_ref,action,case_id,target_ref,outcome,reason) SELECT unixepoch(),${actor},${a.action},${caseId},${target},
  CASE WHEN NOT ${identity} OR NOT ${role} OR NOT ${independent} THEN 'denied' WHEN ${a.effect(actor)} THEN 'allowed' ELSE 'rejected' END,
  CASE WHEN NOT ${identity} THEN 'unauthenticated' WHEN NOT ${role} THEN 'missing_role' WHEN NOT ${independent} THEN 'conflict_of_interest'
   WHEN ${a.effect(actor)} THEN 'ok' WHEN ${a.missing??q`0`} THEN 'not_found' ELSE 'conflict' END RETURNING reason`;
 let results:D1Result[];
 try{results=await db.batch([...writes,...reads,audit].map(x=>statement(db,x)));}
 catch(error){const reason=classify(error);await record(db,actor,a.action,safeCase,safeTarget,'rejected',reason);throw new SafetyCaseError(reason);}
 const reason=(results.at(-1)?.results?.[0] as {reason?:string}|undefined)?.reason;
 if(reason==='unauthenticated')throw new IdentityError(409,'identity_changed','Your account access changed. Verify your current access and review this action again.');
 // A case about the operator themself is indistinguishable from an absent case.
 if(reason==='conflict_of_interest')throw new SafetyCaseError('not_found');
 if(reason!=='ok')throw new SafetyCaseError(reason==='missing_role'||reason==='not_found'||reason==='conflict'?reason:'unavailable');
 return {actor,accountId,rows:results.slice(writes.length,writes.length+reads.length).map(r=>(r.results??[]) as Record<string,unknown>[])};
}
const caseMissing=(caseId:unknown)=>q`NOT EXISTS(SELECT 1 FROM safety_cases WHERE id=${caseId})`;

/** Operator bootstrap only. Runs through Cloudflare-credentialed operator tooling (`tools/safety-case-bootstrap.mjs`), never
 * HTTP, and only while no role administrator is active. The named account must be a ready passkey identity; afterwards every
 * grant and revocation requires that administrator's authenticated session. */
export async function bootstrapSafetyRoleAdministrator(db:Database,input:{grantId:string;accountId:string}){
 const {grantId,accountId}=input;
 if(!isOpaque(grantId)||!isAccount(accountId)){await record(db,null,'bootstrap_administrator',null,isOpaque(grantId)?grantId:null,'rejected','invalid_input');throw new SafetyCaseError('invalid_input');}
 const operator='human:'+accountId,effect=q`EXISTS(SELECT 1 FROM safety_case_roles WHERE id=${grantId} AND operator_ref=${operator} AND role='role_administrator' AND granted_by='operator:bootstrap' AND revoked_at IS NULL)`;
 const writes=[q`INSERT INTO safety_case_roles(id,operator_ref,role,granted_by,granted_at) SELECT ${grantId},${operator},'role_administrator','operator:bootstrap',unixepoch()
   WHERE NOT EXISTS(SELECT 1 FROM safety_case_roles WHERE id=${grantId}) AND NOT EXISTS(SELECT 1 FROM safety_case_roles WHERE role='role_administrator' AND revoked_at IS NULL)
    AND EXISTS(SELECT 1 FROM identity_accounts WHERE account_id=${accountId} AND stage='ready')`,
  q`INSERT INTO safety_case_audit(at,actor_ref,action,case_id,target_ref,outcome,reason) SELECT unixepoch(),NULL,'bootstrap_administrator',NULL,${grantId},
   CASE WHEN ${effect} THEN 'allowed' ELSE 'rejected' END,CASE WHEN ${effect} THEN 'ok' WHEN NOT EXISTS(SELECT 1 FROM identity_accounts WHERE account_id=${accountId} AND stage='ready') THEN 'not_found' ELSE 'conflict' END RETURNING reason`];
 let results:D1Result[];
 try{results=await db.batch(writes.map(x=>statement(db,x)));}
 catch(error){const reason=classify(error);await record(db,null,'bootstrap_administrator',null,grantId,'rejected',reason);throw new SafetyCaseError(reason);}
 const reason=(results.at(-1)?.results?.[0] as {reason?:string}|undefined)?.reason;
 if(reason!=='ok')throw new SafetyCaseError(reason==='not_found'?'not_found':'conflict');
 return {grantId,operatorRef:operator,role:'role_administrator' as const};
}
/** Role administration requires an authenticated role administrator. Grantees are ready passkey identities; self-grants are refused. */
export async function grantSafetyCaseRole(db:Database,principal:unknown,input:{grantId:string;operatorAccountId:string;role:SafetyCaseRole}){
 const {grantId,operatorAccountId,role}=input,operator='human:'+operatorAccountId;
 await attempt(db,{principal,action:'grant_role',target:grantId,roles:['role_administrator'],valid:isAccount(operatorAccountId)&&roles.includes(role),
  independent:account=>q`${operatorAccountId}<>${account}`,
  writes:(gate,actor)=>[q`INSERT INTO safety_case_roles(id,operator_ref,role,granted_by,granted_at) SELECT ${grantId},${operator},${role},${actor},unixepoch()
   WHERE ${gate} AND EXISTS(SELECT 1 FROM identity_accounts WHERE account_id=${operatorAccountId} AND stage='ready')
    AND NOT EXISTS(SELECT 1 FROM safety_case_roles WHERE id=${grantId}) AND NOT EXISTS(SELECT 1 FROM safety_case_roles WHERE operator_ref=${operator} AND role=${role} AND revoked_at IS NULL)`],
  effect:actor=>q`EXISTS(SELECT 1 FROM safety_case_roles WHERE id=${grantId} AND operator_ref=${operator} AND role=${role} AND granted_by=${actor} AND revoked_at IS NULL)`,
  missing:q`NOT EXISTS(SELECT 1 FROM identity_accounts WHERE account_id=${operatorAccountId} AND stage='ready')`});
}
export async function revokeSafetyCaseRole(db:Database,principal:unknown,input:{grantId:string;revokeRef:string}){
 const {grantId,revokeRef}=input;
 await attempt(db,{principal,action:'revoke_role',target:grantId,roles:['role_administrator'],valid:isOpaque(revokeRef),
  writes:(gate,actor)=>[q`UPDATE safety_case_roles SET revoked_at=unixepoch(),revoked_by=${actor},revoke_ref=${revokeRef} WHERE id=${grantId} AND revoked_at IS NULL AND ${gate}`],
  effect:actor=>q`EXISTS(SELECT 1 FROM safety_case_roles WHERE id=${grantId} AND revoked_by=${actor} AND revoke_ref=${revokeRef})`,
  missing:q`NOT EXISTS(SELECT 1 FROM safety_case_roles WHERE id=${grantId})`});
}
/** A new case is always an uncertain flag. Confirmation is a separate named human decision. */
export async function openSafetyCase(db:Database,principal:unknown,input:{caseId:string;subjectUserId:string;intakeRef:string}){
 const {caseId,subjectUserId,intakeRef}=input;
 await attempt(db,{principal,action:'open_case',caseId,roles:['case_reviewer'],valid:isOpaque(subjectUserId)&&isOpaque(intakeRef),
  independent:account=>q`${subjectUserId}<>${account}`,
  writes:(gate,actor)=>[
   q`INSERT INTO safety_cases(id,subject_user_id,intake_ref,opened_by,opened_at,retention_due_at) SELECT ${caseId},${subjectUserId},${intakeRef},${actor},unixepoch(),unixepoch()+${retentionSeconds} WHERE ${gate} AND NOT EXISTS(SELECT 1 FROM safety_cases WHERE id=${caseId})`,
   q`INSERT INTO safety_case_findings(case_id,seq,finding,reviewer_ref,decision_ref,recorded_at) SELECT ${caseId},1,'uncertain_flag',${actor},${intakeRef},unixepoch()
    WHERE ${gate} AND NOT EXISTS(SELECT 1 FROM safety_case_findings WHERE case_id=${caseId})`],
  effect:actor=>q`EXISTS(SELECT 1 FROM safety_cases WHERE id=${caseId} AND subject_user_id=${subjectUserId} AND intake_ref=${intakeRef} AND opened_by=${actor})`});
}
/** Links an existing reviewed ledger record of the same subject. Linking never changes the finding. */
export async function linkSafetyCaseEvidence(db:Database,principal:unknown,input:{caseId:string;evidenceId:string}){
 const {caseId,evidenceId}=input;
 await attempt(db,{principal,action:'link_evidence',caseId,target:evidenceId,roles:['case_reviewer'],
  writes:(gate,actor)=>[q`INSERT INTO safety_case_evidence(case_id,evidence_id,linked_by,linked_at) SELECT ${caseId},${evidenceId},${actor},unixepoch()
   WHERE ${gate} AND EXISTS(SELECT 1 FROM safety_cases WHERE id=${caseId}) AND NOT EXISTS(SELECT 1 FROM safety_case_evidence WHERE case_id=${caseId} AND evidence_id=${evidenceId})`],
  effect:()=>q`EXISTS(SELECT 1 FROM safety_case_evidence WHERE case_id=${caseId} AND evidence_id=${evidenceId})`,missing:caseMissing(caseId)});
}
/** Appends a reviewed decision. Corrections append; earlier decisions remain. */
export async function recordSafetyCaseFinding(db:Database,principal:unknown,input:{caseId:string;finding:SafetyCaseFinding;decisionRef:string}){
 const {caseId,finding,decisionRef}=input;
 await attempt(db,{principal,action:'record_finding',caseId,target:decisionRef,roles:['case_reviewer'],valid:findings.includes(finding),
  writes:(gate,actor)=>[q`INSERT INTO safety_case_findings(case_id,seq,finding,reviewer_ref,decision_ref,recorded_at)
   SELECT ${caseId},COALESCE((SELECT max(seq) FROM safety_case_findings WHERE case_id=${caseId}),0)+1,${finding},${actor},${decisionRef},unixepoch()
   WHERE ${gate} AND EXISTS(SELECT 1 FROM safety_cases WHERE id=${caseId}) AND NOT EXISTS(SELECT 1 FROM safety_case_findings WHERE case_id=${caseId} AND decision_ref=${decisionRef})`],
  effect:actor=>q`EXISTS(SELECT 1 FROM safety_case_findings WHERE case_id=${caseId} AND decision_ref=${decisionRef} AND finding=${finding} AND reviewer_ref=${actor})`,missing:caseMissing(caseId)});
}
/** Places a hold over the subject account, one of its projects or one project photo. legalBasisRef names the separate
 * human applicability/retention decision. */
export async function placePreservationHold(db:Database,principal:unknown,input:{holdId:string;caseId:string;legalBasisRef:string;reviewDays:number;scope?:SafetyHoldScope;projectId?:string;fileId?:string}){
 const {holdId,caseId,legalBasisRef,reviewDays}=input,scope=input.scope??'account',projectId=input.projectId??null,fileId=input.fileId??null;
 const shaped=scopes.includes(scope)&&(scope==='account'?projectId===null&&fileId===null:isOpaque(projectId)&&(scope==='project'?fileId===null:isOpaque(fileId)));
 await attempt(db,{principal,action:'place_hold',caseId,target:holdId,roles:['preservation_approver'],valid:shaped&&isOpaque(legalBasisRef)&&Number.isSafeInteger(reviewDays)&&reviewDays>=1&&reviewDays<=366,
  writes:(gate,actor)=>[q`INSERT INTO safety_preservation_holds(id,case_id,subject_user_id,scope,project_id,file_id,legal_basis_ref,approved_by,placed_at,review_due_at)
   SELECT ${holdId},id,subject_user_id,${scope},${projectId},${fileId},${legalBasisRef},${actor},unixepoch(),unixepoch()+${reviewDays}*86400 FROM safety_cases
   WHERE id=${caseId} AND ${gate} AND NOT EXISTS(SELECT 1 FROM safety_preservation_holds WHERE id=${holdId})`],
  effect:actor=>q`EXISTS(SELECT 1 FROM safety_preservation_holds WHERE id=${holdId} AND case_id=${caseId} AND scope=${scope} AND project_id IS ${projectId} AND file_id IS ${fileId}
   AND legal_basis_ref=${legalBasisRef} AND approved_by=${actor} AND released_at IS NULL)`,missing:caseMissing(caseId)});
}
/** Explicit, audited release; the hold record remains. Restricted evidence objects are unaffected by release. */
export async function releasePreservationHold(db:Database,principal:unknown,input:{holdId:string;caseId:string;releaseRef:string}){
 const {holdId,caseId,releaseRef}=input;
 await attempt(db,{principal,action:'release_hold',caseId,target:holdId,roles:['preservation_approver'],valid:isOpaque(releaseRef),
  writes:(gate,actor)=>[q`UPDATE safety_preservation_holds SET released_at=unixepoch(),released_by=${actor},release_ref=${releaseRef} WHERE id=${holdId} AND case_id=${caseId} AND released_at IS NULL AND ${gate}`],
  effect:actor=>q`EXISTS(SELECT 1 FROM safety_preservation_holds WHERE id=${holdId} AND case_id=${caseId} AND released_by=${actor} AND release_ref=${releaseRef})`,
  missing:q`NOT EXISTS(SELECT 1 FROM safety_preservation_holds WHERE id=${holdId} AND case_id=${caseId})`});
}
/** Closing requires every hold to be released, every open disclosure settled and every capture finished. */
export async function closeSafetyCase(db:Database,principal:unknown,input:{caseId:string;closeRef:string}){
 const {caseId,closeRef}=input;
 await attempt(db,{principal,action:'close_case',caseId,target:closeRef,roles:['case_reviewer'],
  writes:(gate,actor)=>[q`UPDATE safety_cases SET closed_at=unixepoch(),closed_by=${actor},close_ref=${closeRef} WHERE id=${caseId} AND closed_at IS NULL AND ${gate}`],
  effect:actor=>q`EXISTS(SELECT 1 FROM safety_cases WHERE id=${caseId} AND closed_by=${actor} AND close_ref=${closeRef})`,missing:caseMissing(caseId)});
}
type HoldView={id:string;scope:SafetyHoldScope;projectId:string|null;fileId:string|null;legalBasisRef:string;approvedBy:string;placedAt:number;reviewDueAt:number;
 releasedAt:number|null;releasedBy:string|null;releaseRef:string|null;active:boolean;overdue:boolean};
export type SafetyEvidenceObjectView={id:string;source:SafetyEvidenceSource;sourceRef:string;contentType:string;sha256:string;size:number;capturedBy:string;capturedAt:number;retentionDueAt:number;storedAt:number|null;disposedAt:number|null};
export type SafetyRetentionDecisionView={seq:number;decision:'extend'|'release';reviewedDueAt:number;nextDueAt:number|null;reviewSha256:string;decisionRef:string;decidedBy:string;decidedAt:number};
export type SafetyCaseView={id:string;subjectUserId:string;intakeRef:string;openedBy:string;openedAt:number;closedAt:number|null;
 retention:{dueAt:number;released:boolean;reviewDue:boolean;decisions:SafetyRetentionDecisionView[]};
 currentFinding:SafetyCaseFinding;findings:{seq:number;finding:SafetyCaseFinding;reviewerRef:string;decisionRef:string;recordedAt:number}[];
 evidenceIds:string[];holds:HoldView[];evidenceObjects:SafetyEvidenceObjectView[];disclosures:{id:string;state:string;itemCount:number;requestedAt:number}[]};
const evidenceColumns=q`id,source,source_ref AS sourceRef,content_type AS contentType,sha256,size,captured_by AS capturedBy,captured_at AS capturedAt,retention_due_at AS retentionDueAt,stored_at AS storedAt,disposed_at AS disposedAt`;
const decisionColumns=q`seq,decision,reviewed_due_at AS reviewedDueAt,next_due_at AS nextDueAt,review_sha256 AS reviewSha256,decision_ref AS decisionRef,decided_by AS decidedBy,decided_at AS decidedAt`;
/** Restricted read: identifiers, digests and decisions only, never evidence bytes. The read itself is audited. */
export async function readSafetyCase(db:Database,principal:unknown,input:{caseId:string}):Promise<SafetyCaseView>{
 const {caseId}=input;
 const {rows:[cases,rows,links,held,objects,disclosures,retention,decisions]}=await attempt(db,{principal,action:'read_case',caseId,roles:caseRoles,
  reads:gate=>[
   q`SELECT id,subject_user_id AS subjectUserId,intake_ref AS intakeRef,opened_by AS openedBy,opened_at AS openedAt,closed_at AS closedAt FROM safety_cases WHERE id=${caseId} AND ${gate}`,
   q`SELECT seq,finding,reviewer_ref AS reviewerRef,decision_ref AS decisionRef,recorded_at AS recordedAt FROM safety_case_findings WHERE case_id=${caseId} AND ${gate} ORDER BY seq`,
   q`SELECT evidence_id AS evidenceId FROM safety_case_evidence WHERE case_id=${caseId} AND ${gate} ORDER BY evidence_id`,
   q`SELECT id,scope,project_id AS projectId,file_id AS fileId,legal_basis_ref AS legalBasisRef,approved_by AS approvedBy,placed_at AS placedAt,review_due_at AS reviewDueAt,released_at AS releasedAt,released_by AS releasedBy,release_ref AS releaseRef,
    released_at IS NULL AS active,(released_at IS NULL AND review_due_at<=unixepoch()) AS overdue FROM safety_preservation_holds WHERE case_id=${caseId} AND ${gate} ORDER BY placed_at,id`,
   q`SELECT ${evidenceColumns} FROM safety_evidence_objects WHERE case_id=${caseId} AND ${gate} ORDER BY captured_at,id`,
   q`SELECT id,state,item_count AS itemCount,requested_at AS requestedAt FROM safety_disclosures WHERE case_id=${caseId} AND ${gate} ORDER BY requested_at,id`,
   q`SELECT due_at AS dueAt,released,(released=0 AND due_at<=unixepoch()) AS reviewDue FROM safety_case_retention WHERE case_id=${caseId} AND ${gate}`,
   q`SELECT ${decisionColumns} FROM safety_retention_decisions WHERE case_id=${caseId} AND ${gate} ORDER BY seq`],
  effect:()=>q`EXISTS(SELECT 1 FROM safety_cases WHERE id=${caseId})`,missing:caseMissing(caseId)});
 const row=cases[0],term=retention[0];if(!row||!rows.length||!term)throw new SafetyCaseError('unavailable');
 return {...(row as Pick<SafetyCaseView,'id'|'subjectUserId'|'intakeRef'|'openedBy'|'openedAt'|'closedAt'>),
  retention:{dueAt:term.dueAt as number,released:!!term.released,reviewDue:!!term.reviewDue,decisions:decisions as SafetyRetentionDecisionView[]},currentFinding:rows.at(-1)!.finding as SafetyCaseFinding,findings:rows as SafetyCaseView['findings'],
  evidenceIds:links.map(l=>l.evidenceId as string),holds:held.map(h=>({...h,active:!!h.active,overdue:!!h.overdue})) as HoldView[],
  evidenceObjects:objects as SafetyEvidenceObjectView[],disclosures:disclosures as SafetyCaseView['disclosures']};
}
/** Auditor-only access history for one case. */
export async function readSafetyCaseAudit(db:Database,principal:unknown,input:{caseId:string}){
 const {caseId}=input;
 const {rows:[rows]}=await attempt(db,{principal,action:'read_audit',caseId,roles:['case_auditor'],
  reads:gate=>[q`SELECT seq,at,actor_ref AS actorRef,action,target_ref AS targetRef,outcome,reason FROM safety_case_audit WHERE case_id=${caseId} AND ${gate} ORDER BY seq LIMIT 1000`],
  effect:()=>q`1`});
 return rows;
}
/** Active holds, including overdue reviews; an overdue hold still blocks deletion until released. Holds on the
 * operator's own account are never listed to them. */
export async function listActivePreservationHolds(db:Database,principal:unknown){
 const {accountId,rows:[rows]}=await attempt(db,{principal,action:'list_holds',roles:['preservation_approver','case_auditor'],
  reads:gate=>[q`SELECT id,case_id AS caseId,subject_user_id AS subjectUserId,scope,project_id AS projectId,file_id AS fileId,review_due_at AS reviewDueAt,(review_due_at<=unixepoch()) AS overdue
   FROM safety_preservation_holds WHERE released_at IS NULL AND ${gate} ORDER BY review_due_at,id LIMIT 1000`],
  effect:()=>q`1`});
 return rows.filter(r=>r.subjectUserId!==accountId).map(r=>({...r,overdue:!!r.overdue}));
}

type CaptureSource={bytes:()=>Promise<Uint8Array>;sha256:string;size:number;contentType:'image/jpeg'|'application/json';covered:Q};
const absent='0'.repeat(64);
async function captureSource(env:EvidenceEnv,caseId:string,holdId:string,source:SafetyEvidenceSource,sourceRef:string):Promise<CaptureSource|null>{
 const subject=(await env.DB.prepare('SELECT subject_user_id AS s FROM safety_cases WHERE id=?').bind(caseId).first<{s:string}>())?.s;
 if(!subject)return null;
 const hold=q`safety_preservation_holds h WHERE h.id=${holdId} AND h.case_id=${caseId} AND h.released_at IS NULL`;
 if(source==='project_photo'){
  const file=await env.DB.prepare("SELECT f.object_key,f.digest,f.size FROM project_files f JOIN projects p ON p.id=f.project_id WHERE f.id=? AND f.status='ready' AND p.owner_user_id=?").bind(sourceRef,subject).first<{object_key:string;digest:string;size:number}>();
  if(!file)return null;
  return {sha256:file.digest,size:file.size,contentType:'image/jpeg',bytes:async()=>{
   const object=await env.FILES.get(file.object_key);
   if(!object||object.size!==file.size){await object?.body.cancel();throw new SafetyCaseError('unavailable');}
   const bytes=new Uint8Array(await object.arrayBuffer());if(await sha256(bytes)!==file.digest)throw new SafetyCaseError('unavailable');return bytes;},
   covered:q`EXISTS(SELECT 1 FROM ${hold} AND EXISTS(SELECT 1 FROM project_files f JOIN projects p ON p.id=f.project_id WHERE f.id=${sourceRef} AND f.status='ready'
    AND f.digest=${file.digest} AND f.size=${file.size} AND p.owner_user_id=h.subject_user_id
    AND (h.scope='account' OR (h.scope='project' AND h.project_id=f.project_id) OR (h.scope='object' AND h.file_id=f.id))))`};
 }
 if(source==='profile_photo'){
  if(sourceRef!==subject)return null;
  const profile=await env.DB.prepare('SELECT photo FROM user_profiles WHERE user_id=? AND photo IS NOT NULL').bind(subject).first<{photo:string}>();
  if(!profile)return null;
  const bytes=Uint8Array.from(atob(profile.photo),c=>c.charCodeAt(0)),digest=await sha256(bytes);
  return {sha256:digest,size:bytes.length,contentType:'image/jpeg',bytes:async()=>bytes,
   covered:q`EXISTS(SELECT 1 FROM ${hold} AND h.scope='account' AND EXISTS(SELECT 1 FROM user_profiles WHERE user_id=h.subject_user_id AND user_id=${sourceRef} AND photo_digest=${digest}))`};
 }
 if(!/^[1-9][0-9]{0,15}$/.test(sourceRef))return null;
 const preserved=await env.DB.prepare('SELECT payload_json FROM safety_preserved_records WHERE seq=? AND subject_user_id=?').bind(Number(sourceRef),subject).first<{payload_json:string}>();
 if(!preserved)return null;
 const bytes=new TextEncoder().encode(preserved.payload_json);
 return {sha256:await sha256(bytes),size:bytes.length,contentType:'application/json',bytes:async()=>bytes,
  covered:q`EXISTS(SELECT 1 FROM ${hold} AND EXISTS(SELECT 1 FROM safety_preserved_records r WHERE r.seq=${Number(sourceRef)} AND r.subject_user_id=h.subject_user_id
   AND (h.scope='account' OR (h.scope='project' AND h.project_id=r.project_id))))`};
}
/** Copies one held object into restricted evidence storage (private FILES bucket, reserved prefix). The source must be
 * inside the named active hold's scope. Exact retries resume an unconfirmed copy; bytes never leave the Worker. */
export async function captureSafetyEvidence(env:EvidenceEnv,principal:unknown,input:{objectId:string;caseId:string;holdId:string;source:SafetyEvidenceSource;sourceRef:string}){
 const {objectId,caseId,holdId,source,sourceRef}=input;
 const valid=isOpaque(objectId)&&isOpaque(caseId)&&isOpaque(holdId)&&sources.includes(source)&&isOpaque(sourceRef);
 // Source facts are read server-side only; nothing is returned or stored unless the gated insert below admits it.
 const found=valid?await captureSource(env,caseId,holdId,source,sourceRef):null;
 const sha=found?.sha256??absent,size=found?.size??1,contentType=found?.contentType??'application/json',key=restrictedEvidencePrefix+caseId+'/'+objectId;
 const exact=q`id=${objectId} AND case_id=${caseId} AND hold_id=${holdId} AND source=${source} AND source_ref=${sourceRef} AND sha256=${sha} AND size=${size} AND content_type=${contentType} AND disposed_at IS NULL`;
 await attempt(env.DB,{principal,action:'capture_evidence',caseId,target:objectId,roles:['preservation_approver'],valid,
  writes:(gate,actor)=>[q`INSERT INTO safety_evidence_objects(id,case_id,hold_id,subject_user_id,source,source_ref,storage_key,content_type,sha256,size,captured_by,captured_at,retention_due_at)
   SELECT ${objectId},c.id,${holdId},c.subject_user_id,${source},${sourceRef},${key},${contentType},${sha},${size},${actor},unixepoch(),unixepoch()+${retentionSeconds} FROM safety_cases c
   WHERE c.id=${caseId} AND ${gate} AND ${found?found.covered:q`0`} AND NOT EXISTS(SELECT 1 FROM safety_evidence_objects WHERE id=${objectId})`],
  effect:()=>q`EXISTS(SELECT 1 FROM safety_evidence_objects WHERE ${exact})`,
  missing:found?q`NOT EXISTS(SELECT 1 FROM safety_preservation_holds WHERE id=${holdId} AND case_id=${caseId} AND released_at IS NULL)`:q`1`});
 const row=await env.DB.prepare('SELECT stored_at FROM safety_evidence_objects WHERE id=?').bind(objectId).first<{stored_at:number|null}>();
 if(!row||!found)throw new SafetyCaseError('unavailable');
 if(row.stored_at===null){
  const bytes=await found.bytes();
  if(bytes.length!==size||await sha256(bytes)!==sha)throw new SafetyCaseError('unavailable');
  const stored=await env.FILES.put(key,bytes,{onlyIf:{etagDoesNotMatch:'*'},httpMetadata:{contentType},customMetadata:{sha256:sha}});
  if(!stored){const existing=await env.FILES.head(key);if(existing?.customMetadata?.sha256!==sha||existing.size!==size)throw new SafetyCaseError('unavailable');}
  await env.DB.prepare('UPDATE safety_evidence_objects SET stored_at=unixepoch() WHERE id=? AND stored_at IS NULL').bind(objectId).run();
 }
 return {objectId,caseId,sha256:sha,size,contentType,stored:true as const};
}
/** Audited disposal of one restricted evidence object, only after the case is closed, no disclosure is open, an operator
 * released the case's retention (WH-132) and no hold on the case or its subject is active (enforced by the schema). */
export async function disposeSafetyEvidence(env:EvidenceEnv,principal:unknown,input:{objectId:string;caseId:string;disposeRef:string}){
 const {objectId,caseId,disposeRef}=input;
 await attempt(env.DB,{principal,action:'dispose_evidence',caseId,target:objectId,roles:['preservation_approver'],valid:isOpaque(objectId)&&isOpaque(disposeRef),
  writes:(gate,actor)=>[q`UPDATE safety_evidence_objects SET disposed_at=unixepoch(),disposed_by=${actor},dispose_ref=${disposeRef} WHERE id=${objectId} AND case_id=${caseId} AND disposed_at IS NULL AND ${gate}`],
  effect:actor=>q`EXISTS(SELECT 1 FROM safety_evidence_objects WHERE id=${objectId} AND case_id=${caseId} AND disposed_by=${actor} AND dispose_ref=${disposeRef})`,
  missing:q`NOT EXISTS(SELECT 1 FROM safety_evidence_objects WHERE id=${objectId} AND case_id=${caseId})`});
 // Retried with the same input after an uncertain R2 response; deletion is idempotent.
 await env.FILES.delete(restrictedEvidencePrefix+caseId+'/'+objectId);
 return {objectId,disposed:true as const};
}

type ManifestItem={id:string;sha256:string;size:number;contentType:string};
const canonicalManifest=(m:{caseId:string;legalProcessRef:string;recipientRef:string;items:ManifestItem[]})=>
 JSON.stringify({version:1,caseId:m.caseId,legalProcessRef:m.legalProcessRef,recipientRef:m.recipientRef,items:m.items.map(i=>({id:i.id,sha256:i.sha256,size:i.size,contentType:i.contentType}))});
/** Requests a lawful disclosure of an exact manifest of stored evidence objects. Nothing is sent: a different
 * disclosure approver must approve the exact manifest digest, and completion of the separate, counsel-reviewed
 * out-of-band transfer is recorded afterwards. */
export async function requestSafetyDisclosure(db:Database,principal:unknown,input:{disclosureId:string;caseId:string;legalProcessRef:string;recipientRef:string;evidenceObjectIds:string[]}){
 const {disclosureId,caseId,legalProcessRef,recipientRef}=input,ids=Array.isArray(input.evidenceObjectIds)?[...input.evidenceObjectIds]:[];
 const valid=isOpaque(disclosureId)&&isOpaque(legalProcessRef)&&isOpaque(recipientRef)&&ids.length>=1&&ids.length<=100&&ids.every(isOpaque)&&new Set(ids).size===ids.length;
 ids.sort();
 const objects=valid&&isOpaque(caseId)?(await db.prepare(`SELECT id,sha256,size,content_type AS contentType FROM safety_evidence_objects WHERE case_id=? AND stored_at IS NOT NULL AND disposed_at IS NULL AND id IN (${ids.map(()=>'?').join(',')}) ORDER BY id`)
  .bind(caseId,...ids).all<ManifestItem>()).results:[];
 const complete=objects.length===ids.length;
 const manifest=await sha256(new TextEncoder().encode(canonicalManifest({caseId:String(caseId),legalProcessRef:String(legalProcessRef),recipientRef:String(recipientRef),items:objects})));
 await attempt(db,{principal,action:'request_disclosure',caseId,target:disclosureId,roles:['case_reviewer'],valid,
  writes:(gate,actor)=>[q`INSERT INTO safety_disclosures(id,case_id,legal_process_ref,recipient_ref,manifest_sha256,item_count,state,requested_by,requested_at)
    SELECT ${disclosureId},id,${legalProcessRef},${recipientRef},${manifest},${ids.length},'requested',${actor},unixepoch() FROM safety_cases
    WHERE id=${caseId} AND ${gate} AND ${complete?1:0} AND NOT EXISTS(SELECT 1 FROM safety_disclosures WHERE id=${disclosureId})`,
   ...objects.map(o=>q`INSERT INTO safety_disclosure_items(disclosure_id,evidence_object_id,sha256) SELECT ${disclosureId},${o.id},${o.sha256}
    WHERE ${gate} AND EXISTS(SELECT 1 FROM safety_disclosures WHERE id=${disclosureId} AND case_id=${caseId} AND requested_by=${actor} AND manifest_sha256=${manifest} AND state='requested')
     AND NOT EXISTS(SELECT 1 FROM safety_disclosure_items WHERE disclosure_id=${disclosureId} AND evidence_object_id=${o.id})`)],
  effect:actor=>q`EXISTS(SELECT 1 FROM safety_disclosures d WHERE d.id=${disclosureId} AND d.case_id=${caseId} AND d.requested_by=${actor} AND d.manifest_sha256=${manifest}
   AND d.legal_process_ref=${legalProcessRef} AND d.recipient_ref=${recipientRef} AND d.item_count=${ids.length}
   AND (SELECT count(*) FROM safety_disclosure_items WHERE disclosure_id=d.id)=${ids.length})`,
  missing:complete?caseMissing(caseId):q`1`});
 return {disclosureId,caseId,manifestSha256:manifest,itemCount:ids.length,state:'requested' as const};
}
/** Second-person approval of the exact manifest digest the approver reviewed. Self-approval is refused. */
export async function approveSafetyDisclosure(db:Database,principal:unknown,input:{disclosureId:string;caseId:string;manifestSha256:string}){
 const {disclosureId,caseId,manifestSha256}=input;
 await attempt(db,{principal,action:'approve_disclosure',caseId,target:disclosureId,roles:['disclosure_approver'],valid:isOpaque(disclosureId)&&typeof manifestSha256==='string'&&/^[0-9a-f]{64}$/.test(manifestSha256),
  writes:(gate,actor)=>[q`UPDATE safety_disclosures SET state='approved',approved_by=${actor},approved_at=unixepoch()
   WHERE id=${disclosureId} AND case_id=${caseId} AND state='requested' AND manifest_sha256=${manifestSha256} AND requested_by<>${actor} AND ${gate}`],
  effect:actor=>q`EXISTS(SELECT 1 FROM safety_disclosures WHERE id=${disclosureId} AND case_id=${caseId} AND approved_by=${actor} AND manifest_sha256=${manifestSha256} AND state IN ('approved','recorded'))`,
  missing:q`NOT EXISTS(SELECT 1 FROM safety_disclosures WHERE id=${disclosureId} AND case_id=${caseId})`});
 return {disclosureId,state:'approved' as const};
}
/** Records that the approved, separately reviewed out-of-band transfer happened. This function transmits nothing. */
export async function recordSafetyDisclosure(db:Database,principal:unknown,input:{disclosureId:string;caseId:string;outcomeRef:string}){
 const {disclosureId,caseId,outcomeRef}=input;
 await attempt(db,{principal,action:'record_disclosure',caseId,target:disclosureId,roles:['disclosure_approver'],valid:isOpaque(disclosureId)&&isOpaque(outcomeRef),
  writes:(gate,actor)=>[q`UPDATE safety_disclosures SET state='recorded',closed_by=${actor},closed_at=unixepoch(),close_ref=${outcomeRef} WHERE id=${disclosureId} AND case_id=${caseId} AND state='approved' AND ${gate}`],
  effect:actor=>q`EXISTS(SELECT 1 FROM safety_disclosures WHERE id=${disclosureId} AND case_id=${caseId} AND state='recorded' AND closed_by=${actor} AND close_ref=${outcomeRef})`,
  missing:q`NOT EXISTS(SELECT 1 FROM safety_disclosures WHERE id=${disclosureId} AND case_id=${caseId})`});
 return {disclosureId,state:'recorded' as const};
}
export async function cancelSafetyDisclosure(db:Database,principal:unknown,input:{disclosureId:string;caseId:string;cancelRef:string}){
 const {disclosureId,caseId,cancelRef}=input;
 await attempt(db,{principal,action:'cancel_disclosure',caseId,target:disclosureId,roles:['case_reviewer','disclosure_approver'],valid:isOpaque(disclosureId)&&isOpaque(cancelRef),
  writes:(gate,actor)=>[q`UPDATE safety_disclosures SET state='cancelled',closed_by=${actor},closed_at=unixepoch(),close_ref=${cancelRef} WHERE id=${disclosureId} AND case_id=${caseId} AND state IN ('requested','approved') AND ${gate}`],
  effect:actor=>q`EXISTS(SELECT 1 FROM safety_disclosures WHERE id=${disclosureId} AND case_id=${caseId} AND state='cancelled' AND closed_by=${actor} AND close_ref=${cancelRef})`,
  missing:q`NOT EXISTS(SELECT 1 FROM safety_disclosures WHERE id=${disclosureId} AND case_id=${caseId})`});
 return {disclosureId,state:'cancelled' as const};
}
/** Restricted manifest read: identifiers, digests and sizes only. */
export async function readSafetyDisclosure(db:Database,principal:unknown,input:{disclosureId:string;caseId:string}){
 const {disclosureId,caseId}=input;
 const {rows:[rows,items]}=await attempt(db,{principal,action:'read_disclosure',caseId,target:disclosureId,roles:caseRoles,valid:isOpaque(disclosureId),
  reads:gate=>[q`SELECT id,case_id AS caseId,legal_process_ref AS legalProcessRef,recipient_ref AS recipientRef,manifest_sha256 AS manifestSha256,item_count AS itemCount,state,
    requested_by AS requestedBy,requested_at AS requestedAt,approved_by AS approvedBy,approved_at AS approvedAt,closed_by AS closedBy,closed_at AS closedAt,close_ref AS closeRef
    FROM safety_disclosures WHERE id=${disclosureId} AND case_id=${caseId} AND ${gate}`,
   q`SELECT o.id,o.sha256,o.size,o.content_type AS contentType FROM safety_disclosure_items i JOIN safety_evidence_objects o ON o.id=i.evidence_object_id
    WHERE i.disclosure_id=${disclosureId} AND o.case_id=${caseId} AND ${gate} ORDER BY o.id`],
  effect:()=>q`EXISTS(SELECT 1 FROM safety_disclosures WHERE id=${disclosureId} AND case_id=${caseId})`,
  missing:q`NOT EXISTS(SELECT 1 FROM safety_disclosures WHERE id=${disclosureId} AND case_id=${caseId})`});
 if(!rows[0])throw new SafetyCaseError('unavailable');
 return {...rows[0],items};
}

/** WH-132 retention review queue (owner decision October 4, 2026, pending counsel). Lists cases whose retention term
 * (the case's own one-year term, its latest extension, and every evidence object not yet disposed of) has passed
 * without a decision as `retention_review_due`, and released cases that still hold stored evidence as
 * `released_pending_disposal`. Identifiers, dates and counts only. A case about the operator is never listed to them. */
export type SafetyRetentionReviewItem={caseId:string;subjectUserId:string;status:'retention_review_due'|'released_pending_disposal';openedAt:number;closedAt:number|null;
 retentionDueAt:number;storedEvidence:number;activeHolds:number;openDisclosures:number;releasable:boolean};
export async function listSafetyRetentionReviews(db:Database,principal:unknown):Promise<SafetyRetentionReviewItem[]>{
 const {rows:[rows]}=await attempt(db,{principal,action:'list_retention',roles:['preservation_approver','case_auditor'],
  reads:(gate,actor)=>[q`SELECT c.id AS caseId,c.subject_user_id AS subjectUserId,c.opened_at AS openedAt,c.closed_at AS closedAt,r.due_at AS retentionDueAt,r.released,
    (SELECT count(*) FROM safety_evidence_objects o WHERE o.case_id=c.id AND o.stored_at IS NOT NULL AND o.disposed_at IS NULL) AS storedEvidence,
    (SELECT count(*) FROM safety_evidence_objects o WHERE o.case_id=c.id AND o.stored_at IS NULL) AS unfinishedCaptures,
    (SELECT count(*) FROM safety_preservation_holds h WHERE h.released_at IS NULL AND (h.case_id=c.id OR h.subject_user_id=c.subject_user_id)) AS activeHolds,
    (SELECT count(*) FROM safety_disclosures d WHERE d.case_id=c.id AND d.state IN ('requested','approved')) AS openDisclosures
   FROM safety_cases c JOIN safety_case_retention r ON r.case_id=c.id
   WHERE ((r.released=0 AND r.due_at<=unixepoch()) OR (r.released=1 AND EXISTS(SELECT 1 FROM safety_evidence_objects o WHERE o.case_id=c.id AND o.stored_at IS NOT NULL AND o.disposed_at IS NULL)))
    AND 'human:'||c.subject_user_id<>${actor} AND ${gate} ORDER BY r.due_at,c.id LIMIT 1000`],
  effect:()=>q`1`});
 return rows.map(r=>({caseId:r.caseId as string,subjectUserId:r.subjectUserId as string,status:r.released?'released_pending_disposal' as const:'retention_review_due' as const,openedAt:r.openedAt as number,
  closedAt:r.closedAt as number|null,retentionDueAt:r.retentionDueAt as number,storedEvidence:r.storedEvidence as number,activeHolds:r.activeHolds as number,openDisclosures:r.openDisclosures as number,
  releasable:!r.released&&r.closedAt!==null&&r.activeHolds===0&&r.openDisclosures===0&&r.unfinishedCaptures===0}));
}

type RetentionInput={caseId:string;decision:'extend'|'release';decisionRef:string;extendDays?:number|null};
type RetentionFacts={dueAt:number;closedAt:number|null;evidence:{id:string;sha256:string;retentionDueAt:number;stored:boolean;disposed:boolean}[]};
const validRetention=(input:RetentionInput)=>isOpaque(input.caseId)&&isOpaque(input.decisionRef)&&['extend','release'].includes(input.decision)
 &&(input.decision==='extend'?Number.isSafeInteger(input.extendDays)&&Number(input.extendDays)>=1&&Number(input.extendDays)<=maxRetentionExtensionDays:input.extendDays===undefined||input.extendDays===null);
const factsSQL=(caseId:unknown,gate:Q)=>[
 q`SELECT r.due_at AS dueAt,c.closed_at AS closedAt FROM safety_cases c JOIN safety_case_retention r ON r.case_id=c.id WHERE c.id=${caseId} AND r.released=0 AND ${gate}`,
 q`SELECT id,sha256,retention_due_at AS retentionDueAt,stored_at IS NOT NULL AS stored,disposed_at IS NOT NULL AS disposed FROM safety_evidence_objects WHERE case_id=${caseId} AND ${gate} ORDER BY id`];
function retentionFacts(head:Record<string,unknown>[],evidence:Record<string,unknown>[]):RetentionFacts|null{
 if(!head[0])return null;
 return {dueAt:head[0].dueAt as number,closedAt:head[0].closedAt as number|null,
  evidence:evidence.map(e=>({id:e.id as string,sha256:e.sha256 as string,retentionDueAt:e.retentionDueAt as number,stored:!!e.stored,disposed:!!e.disposed}))};
}
/** The exact reviewed decision: the case, the decision and its term, the due date being reviewed, the case's closure and
 * every evidence object with its digest and term. Any change in between makes apply refuse. */
async function retentionDigest(input:RetentionInput,facts:RetentionFacts){
 const canonical=JSON.stringify({version:1,caseId:input.caseId,decision:input.decision,decisionRef:input.decisionRef,extendDays:input.decision==='extend'?input.extendDays:null,
  reviewedDueAt:facts.dueAt,closedAt:facts.closedAt,evidence:facts.evidence.map(e=>({id:e.id,sha256:e.sha256,retentionDueAt:e.retentionDueAt,stored:e.stored,disposed:e.disposed}))});
 return sha256(new TextEncoder().encode(canonical));
}
/** Preview of an extend or release decision for a case whose retention review is due. Writes nothing except the
 * audit row; returns the facts and the `reviewSha256` that apply must repeat. Preservation approvers only. */
export async function previewSafetyRetentionDecision(db:Database,principal:unknown,input:RetentionInput){
 const valid=validRetention(input),due=q`EXISTS(SELECT 1 FROM safety_case_retention WHERE case_id=${input.caseId} AND released=0 AND due_at<=unixepoch())`;
 const {rows:[head,evidence,blockers]}=await attempt(db,{principal,action:'preview_retention',caseId:input.caseId,target:isOpaque(input.decisionRef)?input.decisionRef:null,roles:['preservation_approver'],valid,
  reads:gate=>[...factsSQL(input.caseId,gate),
   q`SELECT (SELECT count(*) FROM safety_preservation_holds h WHERE h.released_at IS NULL AND (h.case_id=c.id OR h.subject_user_id=c.subject_user_id)) AS activeHolds,
     (SELECT count(*) FROM safety_disclosures d WHERE d.case_id=c.id AND d.state IN ('requested','approved')) AS openDisclosures,
     (SELECT count(*) FROM safety_evidence_objects o WHERE o.case_id=c.id AND o.stored_at IS NULL) AS unfinishedCaptures FROM safety_cases c WHERE c.id=${input.caseId} AND ${gate}`],
  effect:()=>due,missing:caseMissing(input.caseId)});
 const facts=retentionFacts(head,evidence),b=blockers[0];
 if(!facts||!b)throw new SafetyCaseError('unavailable');
 const releasable=facts.closedAt!==null&&b.activeHolds===0&&b.openDisclosures===0&&b.unfinishedCaptures===0;
 return {caseId:input.caseId,decision:input.decision,decisionRef:input.decisionRef,extendDays:input.decision==='extend'?input.extendDays as number:null,
  reviewedDueAt:facts.dueAt,closedAt:facts.closedAt,evidence:facts.evidence,activeHolds:b.activeHolds as number,openDisclosures:b.openDisclosures as number,
  unfinishedCaptures:b.unfinishedCaptures as number,releasable,reviewSha256:await retentionDigest(input,facts)};
}
/** Applies the exact previewed decision. Extend sets a new due date `extendDays` from now; release ends the retention
 * term so evidence objects may later be disposed of by the separate audited disposal. Release needs a closed case with
 * no active hold on the case or its subject, no open disclosure and no unfinished capture (the schema repeats every
 * condition, including that the reviewed due date is still current and has passed). Exact retries are idempotent. */
export async function applySafetyRetentionDecision(db:Database,principal:unknown,input:RetentionInput&{reviewSha256:string}){
 const {caseId,decision,decisionRef,reviewSha256}=input,valid=validRetention(input)&&typeof reviewSha256==='string'&&/^[0-9a-f]{64}$/.test(reviewSha256);
 // Facts are re-read server-side only to recompute the digest; nothing is returned unless the gated insert admits it.
 const [head,evidence]=valid?(await db.batch(factsSQL(caseId,q`1`).map(x=>statement(db,x)))).map(r=>(r.results??[]) as Record<string,unknown>[]):[[],[]];
 const facts=retentionFacts(head,evidence),matches=!!facts&&await retentionDigest(input,facts)===reviewSha256;
 const days=decision==='extend'?Number(input.extendDays):0;
 await attempt(db,{principal,action:'decide_retention',caseId,target:isOpaque(decisionRef)?decisionRef:null,roles:['preservation_approver'],valid,
  writes:(gate,actor)=>[q`INSERT INTO safety_retention_decisions(case_id,seq,decision,reviewed_due_at,next_due_at,review_sha256,decision_ref,decided_by,decided_at)
   SELECT c.id,COALESCE((SELECT max(seq) FROM safety_retention_decisions WHERE case_id=c.id),0)+1,${decision},${facts?.dueAt??0},
    CASE WHEN ${decision}='extend' THEN unixepoch()+${days*86400} END,${reviewSha256},${decisionRef},${actor},unixepoch() FROM safety_cases c
   WHERE c.id=${caseId} AND ${gate} AND ${matches?1:0} AND NOT EXISTS(SELECT 1 FROM safety_retention_decisions WHERE case_id=${caseId} AND decision_ref=${decisionRef})`],
  effect:actor=>q`EXISTS(SELECT 1 FROM safety_retention_decisions WHERE case_id=${caseId} AND decision_ref=${decisionRef} AND decision=${decision} AND review_sha256=${reviewSha256} AND decided_by=${actor})`,
  missing:caseMissing(caseId)});
 const saved=await db.prepare('SELECT seq,next_due_at AS nextDueAt FROM safety_retention_decisions WHERE case_id=? AND decision_ref=?').bind(caseId,decisionRef).first<{seq:number;nextDueAt:number|null}>();
 if(!saved)throw new SafetyCaseError('unavailable');
 return {caseId,decision,seq:saved.seq,nextDueAt:saved.nextDueAt};
}
