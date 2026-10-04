import {readViewBinding} from './workspace-view-bindings';
import {viewComponents} from './workspace-view-contract';
import type {ViewComponentData} from './workspace-view-data';
import {featurePredicate} from './feature-admission';
import {interactionGuard} from './chat-interactions/store';
import {trafficDescription,trafficNotice} from './site-traffic';

/** The model receives the same exact, scoped facts as maintained view cards.
 * A read is a dated observation, never proof of uptime, approval or completeness. */
export async function readProjectObservations(db:D1Database,user:string,projectId:string){
 const projects=await readViewBinding(db,user,'projects',projectId);
 const traffic=await readViewBinding(db,user,'traffic',projectId);
 return {projects,traffic,trafficNotice};
}

/** Fence already-read facts at dispatch and reply commit. Revocation cannot
 * leave a successful model reply containing facts it may no longer read. */
export function observationGuards(db:D1Database,user:string,observations:ViewComponentData[]){
 return observations.flatMap(o=>{
  if(o.status!=='ready')return [];
  const feature=viewComponents[o.kind].feature;if(feature===null)return [];
  const gate=featurePredicate(db,{userId:user,projectId:o.projectId,featureId:feature,operation:'read'});
  const projects=o.projectId===null&&o.kind==='traffic'?[...new Set(o.data.rows.map(row=>row.project_id))]:[];
  return [interactionGuard(db,gate.sql,gate.params),...projects.map(project=>interactionGuard(db,'EXISTS(SELECT 1 FROM projects WHERE id=? AND owner_user_id=?)',[project,user]))];
 });
}

export async function inspectTraffic(db:D1Database,user:string,projectId:string|null){
 const observation=await readViewBinding(db,user,'traffic',projectId);
 const guards=observationGuards(db,user,[observation]);
 const reply=observation.kind==='traffic'&&observation.status==='ready'
  ?trafficDescription(observation.data)
  :observation.status==='denied'?'Traffic is not available with your current access. No traffic count was read.':'Traffic information is temporarily unavailable. This does not mean there were no page requests.';
 return {reply,inspection:JSON.stringify({type:'traffic_observation',observation,notice:trafficNotice}),inspectionGuards:guards,statements:guards};
}
