import {connectorCatalog,type ConnectorProvider} from './connector-catalog';
import {assertWorkspace,workspacePredicate} from './workspace-identity/admission';
import {featureRequest,inclusionPredicate,resolveFeatureInclusion,FeatureInclusionError,type FeatureRequest,type FeatureOperation} from './feature-inclusion';

export type ConnectionUse={projectId:string|null;operation:Exclude<FeatureOperation,'connect'>;dispatchId?:string}|{recoveryId:string};
export function connectionFeature(userId:string,provider:ConnectorProvider,projectId:string|null,operation:FeatureOperation):FeatureRequest {
 return featureRequest({userId,projectId,featureId:connectorCatalog.providers[provider].featureId,operation});
}
/** Current inclusion/ownership predicate, composed into the same SQL statement as a local effect.
 * No saved decision, UI flag or credential can freeze the interval or preview grant. */
export function featurePredicate(db:object,input:FeatureRequest){
 const actor=workspacePredicate(db,input.userId),included=inclusionPredicate(input);
 return {sql:`(${actor.sql} AND ${included.sql})`,params:[...actor.params,...included.params]};
}
export async function requireFeature(db:Pick<D1Database,'prepare'>,input:FeatureRequest){
 await assertWorkspace(db,input.userId);
 const decision=await resolveFeatureInclusion(db,input);
 await assertWorkspace(db,input.userId);
 if(!decision.included)throw new FeatureInclusionError(403,'This connection operation requires Business or Business Pro, or an explicit scoped test grant. Saved history, export and disconnect remain available.');
 return decision;
}
export async function assertFeature(db:Pick<D1Database,'prepare'>,input:FeatureRequest){
 const gate=featurePredicate(db,input);
 if(!await db.prepare(`SELECT 1 WHERE ${gate.sql}`).bind(...gate.params).first())throw new FeatureInclusionError(403,'Feature eligibility or project ownership changed. Refresh the current plan and prepare a new review.');
}
export async function connectionInclusion(db:D1Database,userId:string,provider:ConnectorProvider){
 await assertWorkspace(db,userId);
 const [connect,read]=await Promise.all(['connect','read'].map(operation=>resolveFeatureInclusion(db,connectionFeature(userId,provider,null,operation as FeatureOperation))));
 return {connect:connect.included,read:read.included,planId:connect.planId,source:connect.source?.kind??null};
}
