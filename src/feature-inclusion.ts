import {ensureBilling} from './billing';
import {launchFeatureCatalogue,launchFeaturesByPlan,type LaunchFeatureId} from './plan-features';

export class FeatureInclusionError extends Error {
 constructor(public status:number,message:string){super(message);}
}
export const featureOperations=['connect','read','prepare','confirm','dispatch'] as const;
export type FeatureOperation=typeof featureOperations[number];
export type FeatureScope={userId:string;projectId:string|null};
export type FeatureRequest=FeatureScope&{featureId:LaunchFeatureId;operation:FeatureOperation};
type Database=Pick<D1Database,'prepare'>;
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const knownFeatures=new Set<string>(launchFeatureCatalogue.features.map(f=>f.id));

export function featureRequest(value:unknown):FeatureRequest {
 const r=value as FeatureRequest;
 if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).length!==4||Object.keys(r).some(k=>!['userId','projectId','featureId','operation'].includes(k))
  ||typeof r.userId!=='string'||!uuid.test(r.userId)||(r.projectId!==null&&(typeof r.projectId!=='string'||!uuid.test(r.projectId)))
  ||!knownFeatures.has(r.featureId)||!featureOperations.includes(r.operation))throw new FeatureInclusionError(400,'Choose a current feature, operation and exact account or project scope.');
 return {userId:r.userId,projectId:r.projectId,featureId:r.featureId,operation:r.operation};
}
export function featureTime(date:Date){
 const at=Math.floor(date.getTime()/1000);
 if(!Number.isSafeInteger(at)||at<0)throw new FeatureInclusionError(400,'Invalid feature decision time.');
 return at;
}
export async function requireFeatureScope(db:Database,scope:FeatureScope){
 const row=scope.projectId===null
  ?await db.prepare('SELECT id FROM users WHERE id=?').bind(scope.userId).first()
  :await db.prepare('SELECT id FROM projects WHERE id=? AND owner_user_id=?').bind(scope.projectId,scope.userId).first();
 if(!row)throw new FeatureInclusionError(404,'Feature scope is unavailable.');
}

/** Inclusion only, never authentication, consent, readiness, review approval or permission to execute.
 * Domain adapters must re-read this at each effect boundary alongside those current guards. */
export async function resolveFeatureInclusion(db:Database,input:FeatureRequest,date=new Date()){
 const request=featureRequest(input),at=featureTime(date);
 await requireFeatureScope(db,request);
 const {plan,coverage}=await ensureBilling(db,request.userId,new Date(at*1000));
 const base={contract:'whumpo-feature-inclusion' as const,version:1 as const,purpose:'inclusion-only' as const,
  scope:request,evaluatedAt:at,planId:plan.id};
 const features:readonly string[]=launchFeaturesByPlan[plan.id].featureIds;
 if(coverage&&features.includes(request.featureId))return {...base,included:true as const,
  source:{kind:'invoice' as const,planId:plan.id,startsAt:coverage.startsAt,endsAt:coverage.endsAt}};
 const grant=await db.prepare(`SELECT id,starts_at,ends_at FROM feature_preview_grants
  WHERE user_id=? AND project_id IS ? AND feature_id=? AND operation=? AND contract_version=1
  AND purpose='private-test-acceptance' AND revoked_at IS NULL AND starts_at<=? AND ends_at>?
  ORDER BY ends_at DESC,id LIMIT 1`).bind(request.userId,request.projectId,request.featureId,request.operation,at,at)
  .first<{id:string;starts_at:number;ends_at:number}>();
 if(grant)return {...base,included:true as const,source:{kind:'private-preview' as const,grantId:grant.id,startsAt:grant.starts_at,endsAt:grant.ends_at}};
 return {...base,included:false as const,source:null};
}
