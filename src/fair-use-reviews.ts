import {fairUsePolicyVersion,fairUseThresholds,type FairUsePlan} from './fair-use-policy';
// Internal operator service: do not expose context/reviewer identities to a model
// or customer API. These records do not authorize notices or restrictions.
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const categories=['unrelated_chat','project_churn','legitimate_capacity'] as const;
const outcomes=['legitimate_use','insufficient_evidence','confirmed_pattern'] as const;
type Category=typeof categories[number];type Outcome=typeof outcomes[number];
export type FairUseReview={id:string;user_id:string;policy_version:string;plan_id:FairUsePlan;category:Category;opened_by:string;context:string;created_at:string;revision:number;state:'open'|'resolved';outcome:Outcome|null;resolution:string|null;resolved_by:string|null;resolved_at:string|null};
export class FairUseReviewError extends Error{constructor(public status:number,message:string){super(message);}}
function identifier(value:string){if(typeof value!=='string'||!uuid.test(value))throw new FairUseReviewError(400,'Invalid review or account identifier');return value;}
function text(value:string,max:number){if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw new FairUseReviewError(400,'Invalid review text');return value.trim();}
export async function readFairUseReview(db:D1Database,user:string,id:string){
 const row=await db.prepare('SELECT * FROM fair_use_reviews WHERE id=? AND user_id=?').bind(identifier(id),identifier(user)).first<FairUseReview>();
 if(!row)throw new FairUseReviewError(404,'Review not found');return row;
}
export async function openFairUseReview(db:D1Database,user:string,id:string,input:{plan:FairUsePlan;category:Category;reviewer:string;context:string}){
 identifier(user);identifier(id);
 if(!Object.hasOwn(fairUseThresholds,input.plan)||!categories.includes(input.category))throw new FairUseReviewError(400,'Invalid review scope');
 const reviewer=text(input.reviewer,100),context=text(input.context,2000);
 const inserted=await db.prepare(`INSERT INTO fair_use_reviews(id,user_id,policy_version,plan_id,category,opened_by,context)
 SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=?) ON CONFLICT(id) DO NOTHING`).bind(id,user,fairUsePolicyVersion,input.plan,input.category,reviewer,context,user).run();
 const row=await readFairUseReview(db,user,id);
 if(row.policy_version!==fairUsePolicyVersion||row.plan_id!==input.plan||row.category!==input.category||row.opened_by!==reviewer||row.context!==context)throw new FairUseReviewError(409,'Review ID already belongs to a different request');
 return {review:row,replayed:inserted.meta.changes===0,enforcementEnabled:false as const};
}
export async function resolveFairUseReview(db:D1Database,user:string,id:string,input:{revision:number;outcome:Outcome;reviewer:string;resolution:string}){
 identifier(user);identifier(id);
 if(input.revision!==0||!outcomes.includes(input.outcome))throw new FairUseReviewError(400,'Invalid review resolution');
 const reviewer=text(input.reviewer,100),resolution=text(input.resolution,2000);
 const result=await db.prepare(`UPDATE fair_use_reviews SET state='resolved',revision=revision+1,outcome=?,resolution=?,resolved_by=?,resolved_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND user_id=? AND state='open' AND revision=?`).bind(input.outcome,resolution,reviewer,id,user,input.revision).run();
 const row=await readFairUseReview(db,user,id);
 if(row.outcome!==input.outcome||row.resolution!==resolution||row.resolved_by!==reviewer)throw new FairUseReviewError(409,'Review was resolved differently; read the saved decision');
 return {review:row,replayed:result.meta.changes===0,enforcementEnabled:false as const};
}
