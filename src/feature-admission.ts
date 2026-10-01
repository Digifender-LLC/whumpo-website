import {featureRequest,resolveFeatureInclusion,FeatureInclusionError,type FeatureRequest,type FeatureOperation} from './feature-inclusion';
import {launchFeaturesByPlan} from './plan-features';

export type ConnectionUse={projectId:string|null;operation:Exclude<FeatureOperation,'connect'>}|{recoveryId:string};
export function connectionFeature(userId:string,provider:'github'|'cloudflare',projectId:string|null,operation:FeatureOperation):FeatureRequest {
 return featureRequest({userId,projectId,featureId:`connections.${provider}`,operation});
}
/** Current inclusion/ownership predicate, composed into the same SQL statement as a local effect.
 * No saved decision, UI flag or credential can freeze the interval or preview grant. */
export function featurePredicate(input:FeatureRequest){
 const r=featureRequest(input),entries=Object.entries(launchFeaturesByPlan);
 const plans=entries.filter(([,p])=>(p.featureIds as readonly string[]).includes(r.featureId)).map(([id])=>id);
 const known=entries.filter(([id])=>id!=='explore').map(([id])=>id);
 const current="starts_at<=unixepoch() AND ends_at>unixepoch()";
 return {sql:`(EXISTS(SELECT 1 FROM users WHERE id=?) AND (? IS NULL OR EXISTS(SELECT 1 FROM projects WHERE id=? AND owner_user_id=?))
 AND NOT EXISTS(SELECT 1 FROM plan_entitlements WHERE user_id=? AND ${current} AND (plan_id NOT IN (${known.map(()=>'?')}) OR typeof(starts_at)!='integer' OR typeof(ends_at)!='integer' OR abs(starts_at)>9007199254740991 OR abs(ends_at)>9007199254740991))
 AND (EXISTS(SELECT 1 FROM plan_entitlements WHERE user_id=? AND ${current} AND plan_id IN (${plans.map(()=>'?')}))
 OR EXISTS(SELECT 1 FROM feature_preview_grants WHERE user_id=? AND project_id IS ? AND feature_id=? AND operation=? AND contract_version=1 AND purpose='private-test-acceptance' AND revoked_at IS NULL AND ${current})))`,
 params:[r.userId,r.projectId,r.projectId,r.userId,r.userId,...known,r.userId,...plans,r.userId,r.projectId,r.featureId,r.operation]};
}
export async function requireFeature(db:Pick<D1Database,'prepare'>,input:FeatureRequest){
 const decision=await resolveFeatureInclusion(db,input);
 if(!decision.included)throw new FeatureInclusionError(403,'This connection operation requires Business or Business Pro, or an explicit scoped test grant. Saved history, export and disconnect remain available.');
 return decision;
}
export async function assertFeature(db:Pick<D1Database,'prepare'>,input:FeatureRequest){
 const gate=featurePredicate(input);
 if(!await db.prepare(`SELECT 1 WHERE ${gate.sql}`).bind(...gate.params).first())throw new FeatureInclusionError(403,'Feature eligibility or project ownership changed. Refresh the current plan and prepare a new review.');
}
export async function connectionInclusion(db:D1Database,userId:string,provider:'github'|'cloudflare'){
 const [connect,read]=await Promise.all(['connect','read'].map(operation=>resolveFeatureInclusion(db,connectionFeature(userId,provider,null,operation as FeatureOperation))));
 return {connect:connect.included,read:read.included,planId:connect.planId,source:connect.source?.kind??null};
}
