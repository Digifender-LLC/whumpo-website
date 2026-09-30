import {readFairUseObservation} from './fair-use-observation';
import {fairUsePolicyVersion,fairUseThresholds,type FairUsePlan} from './fair-use-policy';
// Internal operator service: do not expose context/reviewer identities to a model
// or customer API. These records do not authorize notices or restrictions.
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const categories=['unrelated_chat','project_churn','legitimate_capacity'] as const;
const outcomes=['legitimate_use','insufficient_evidence','confirmed_pattern'] as const;
type Category=typeof categories[number];type Outcome=typeof outcomes[number];
export type FairUseReview={id:string;user_id:string;policy_version:string;plan_id:FairUsePlan;category:Category;opened_by:string;context:string;created_at:string;revision:number;state:'open'|'resolved';outcome:Outcome|null;resolution:string|null;resolved_by:string|null;resolved_at:string|null;observation_json:string|null};
export class FairUseReviewError extends Error{constructor(public status:number,message:string){super(message);}}
function identifier(value:string){if(typeof value!=='string'||!uuid.test(value))throw new FairUseReviewError(400,'Invalid review or account identifier');return value;}
function text(value:string,max:number){if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))throw new FairUseReviewError(400,'Invalid review text');return value.trim();}
export async function readFairUseReview(db:D1Database,user:string,id:string){
 const row=await db.prepare('SELECT * FROM fair_use_reviews WHERE id=? AND user_id=?').bind(identifier(id),identifier(user)).first<FairUseReview>();
 if(!row)throw new FairUseReviewError(404,'Review not found');return row;
}
const currentPlanSQL="SELECT c.id FROM plan_grants g JOIN plan_catalog c ON c.id=g.plan_id WHERE g.user_id=? AND g.period=? ORDER BY c.tier DESC,c.monthly_units DESC,c.published_sites DESC,c.id LIMIT 1";
export async function previewFairUseReviewObservation(db:D1Database,user:string,plan:FairUsePlan){
 identifier(user);if(!Object.hasOwn(fairUseThresholds,plan))throw new FairUseReviewError(400,'Invalid review plan');
 const now=Date.now(),period=new Date(now).toISOString().slice(0,7);
 const account=await db.prepare('SELECT id FROM users WHERE id=?').bind(user).first();if(!account)throw new FairUseReviewError(404,'Account not found');
 const current=await db.prepare(currentPlanSQL).bind(user,period).first<{id:string}>();
 if(current?.id!==plan)throw new FairUseReviewError(409,'Review plan does not match the current entitlement receipt');
 const observation=await readFairUseObservation(db,user,plan,now);
 return {version:1,entitlement:{planId:plan,period,basis:'current_period_plan_grants'},...observation};
}
export async function openFairUseReview(db:D1Database,user:string,id:string,input:{plan:FairUsePlan;category:Category;reviewer:string;context:string}){
 identifier(user);identifier(id);
 if(!Object.hasOwn(fairUseThresholds,input.plan)||!categories.includes(input.category))throw new FairUseReviewError(400,'Invalid review scope');
 const reviewer=text(input.reviewer,100),context=text(input.context,2000);
 const same=(row:FairUseReview)=>{if(row.policy_version!==fairUsePolicyVersion||row.plan_id!==input.plan||row.category!==input.category||row.opened_by!==reviewer||row.context!==context)throw new FairUseReviewError(409,'Review ID already belongs to a different request');return row;};
 const existing=await db.prepare('SELECT * FROM fair_use_reviews WHERE id=? AND user_id=?').bind(id,user).first<FairUseReview>();
 if(existing)return {review:same(existing),replayed:true,enforcementEnabled:false as const};
 const observation=await previewFairUseReviewObservation(db,user,input.plan),encoded=JSON.stringify(observation);
 if(encoded.length>8192)throw new FairUseReviewError(409,'Review observation exceeds its storage bound');
 // Recheck entitlement in the insertion statement, including a month boundary.
 // Usage is the recorded read-time observation, not a claim of invoice accuracy.
 const inserted=await db.prepare(`INSERT INTO fair_use_reviews(id,user_id,policy_version,plan_id,category,opened_by,context,observation_json)
 SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=?) AND (${currentPlanSQL})=? AND strftime('%Y-%m','now')=? ON CONFLICT(id) DO NOTHING`).bind(id,user,fairUsePolicyVersion,input.plan,input.category,reviewer,context,encoded,user,user,observation.entitlement.period,input.plan,observation.entitlement.period).run();
 let row:FairUseReview;try{row=await readFairUseReview(db,user,id);}catch(error){
  if(error instanceof FairUseReviewError&&error.status===404&&!(await db.prepare('SELECT id FROM fair_use_reviews WHERE id=?').bind(id).first()))throw new FairUseReviewError(409,'Account or entitlement changed before the review was saved');throw error;
 }
 return {review:same(row),replayed:inserted.meta.changes===0,enforcementEnabled:false as const};
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
export async function listFairUseReviews(db:D1Database,user:string,before?:{createdAt:string;id:string}){
 identifier(user);
 if(before&&(typeof before.createdAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(before.createdAt)||!Number.isFinite(Date.parse(before.createdAt))))throw new FairUseReviewError(400,'Invalid review cursor');
 if(before)identifier(before.id);
 const {results}=await db.prepare(`SELECT * FROM fair_use_reviews WHERE user_id=? AND (? IS NULL OR created_at<? OR (created_at=? AND id<?)) ORDER BY created_at DESC,id DESC LIMIT 26`).bind(user,before?.createdAt??null,before?.createdAt??null,before?.createdAt??null,before?.id??null).all<FairUseReview>();
 const reviews=results.slice(0,25),last=reviews.at(-1);
 return {reviews,nextBefore:results.length>25&&last?{createdAt:last.created_at,id:last.id}:null,enforcementEnabled:false as const};
}
