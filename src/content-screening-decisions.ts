import {planContentScreening,type ScreeningTarget} from './content-screening';
import type {ContentRiskHistory} from './content-risk';
export class ScreeningPersistenceError extends Error {
 readonly status=503;
 constructor(){super('Screening requirement could not be confirmed; keep the action on hold');}
}
type Decision={first_required:number;required:number;first_reason:string;escalation_reason:string|null};
/** Internal only. History/target must be derived from owned, trusted server records.
 * This stores requirements, not detector verdicts or action authorization. */
export async function reserveContentScreening(db:D1Database,history:ContentRiskHistory,target:ScreeningTarget,key:string|undefined,now=Date.now()){
 const plan=await planContentScreening(history,target,key,now);
 const identity=[target.userId,target.kind,target.digest,plan.policy];
 const read=()=>db.prepare('SELECT first_required,required,first_reason,escalation_reason FROM content_screening_decisions WHERE user_id=? AND kind=? AND digest=? AND policy_version=?').bind(...identity).first<Decision>();
 let recovered=false;
 try{
  await db.batch([
   db.prepare(`INSERT INTO content_screening_decisions(user_id,kind,digest,policy_version,first_required,required,first_reason,first_percent,first_risk_score)
    SELECT ?,?,?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM content_screening_decisions WHERE user_id=? AND kind=? AND digest=? AND policy_version=?)`).bind(...identity,Number(plan.required),Number(plan.required),plan.reason,plan.percent,plan.riskScore,...identity),
   db.prepare("UPDATE content_screening_decisions SET required=1,escalation_reason=?,escalated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id=? AND kind=? AND digest=? AND policy_version=? AND required=0 AND ?=1").bind(plan.reason,...identity,Number(plan.required)),
  ]);
 }catch{recovered=true;}
 let saved:Decision|null;
 try{saved=await read();}catch{throw new ScreeningPersistenceError();}
 if(!saved||(plan.required&&saved.required!==1))throw new ScreeningPersistenceError();
 return {policy:plan.policy,userId:target.userId,kind:target.kind,digest:target.digest,required:saved.required===1,
  reason:saved.escalation_reason??saved.first_reason,escalated:saved.first_required===0&&saved.required===1,
  recovered,permissionGranted:false as const};
}
