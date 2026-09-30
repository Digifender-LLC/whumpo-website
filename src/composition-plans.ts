import {capabilityRequest,composeCapabilities,capabilityCatalogDigest,type CapabilityRequest} from './capability-catalog';
import {BackendError} from './backend-versions';
import {hashToken} from './security';

type PlanRow={id:string;user_id:string;project_id:string;request_hash:string;catalog_digest:string;plan_json:string;details_revision:number;backend_count:number;backend_revision:number;extension_scope:string;expires_at:number};
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
async function ownedProject(db:D1Database,user:string,project:string){
 const row=await db.prepare('SELECT details_revision,backend_revision,(SELECT count(*) FROM backend_versions WHERE project_id=p.id) AS backend_count FROM projects p WHERE id=? AND owner_user_id=?').bind(project,user).first<{details_revision:number;backend_count:number;backend_revision:number}>();
 if(!row)throw new BackendError(404,'Project not found');return row;
}
function describePlan(plan:ReturnType<typeof composeCapabilities>){
 const selected=plan.contracts.map(e=>`${e.title}: ${e.status==='planned'?'not available yet':e.status==='extension'?(plan.extension?'needs a small custom addition':'not available with this request'):'available'}`).join('\n');
 const next=plan.outcome==='unsupported'?'Part of this request is not supported yet. I can explain the available options and help choose a workable first version.':plan.extension?'I saved a plan for the small custom addition. It will be prepared privately and reviewed before going live.':'These existing capabilities can support your request. Changes will use their normal preview and review steps.';
 return `Here is how I can help:\n${selected}${plan.unknown.length?'\nSome requested capabilities are not recognized.':''}\n\n${next}`;
}
export async function prepareCompositionPlan(db:D1Database,user:string,id:string,raw:Record<string,unknown>){
 if(!capabilityRequest(raw)||!uuid.test(id))throw new BackendError(400,'Choose an owned project and one to four capabilities.');
 const request:CapabilityRequest={kind:'capabilities',operation:'plan',projectId:raw.projectId,needs:[...raw.needs].sort(),...(raw.extension?{extension:{missing:raw.extension.missing,...(raw.extension.baseVersionId?{baseVersionId:raw.extension.baseVersionId}:{})}}:{})};
 const state=await ownedProject(db,user,request.projectId),requestHash=await hashToken(JSON.stringify(request));
 const read=()=>db.prepare('SELECT * FROM composition_plans WHERE id=? AND user_id=? AND project_id=?').bind(id,user,request.projectId).first<PlanRow>();
 const result=(row:PlanRow)=>{
  if(row.request_hash!==requestHash)throw new BackendError(409,'This plan ID already describes a different request.');
  const plan=JSON.parse(row.plan_json) as ReturnType<typeof composeCapabilities>;
  return {reply:describePlan(plan),inspection:JSON.stringify({type:'capability_plan',planId:id,catalogDigest:row.catalog_digest,expiresAt:row.expires_at,projectId:row.project_id,...plan}),statements:[] as D1PreparedStatement[]};
 };
 const previous=await read();if(previous)return result(previous);
 const plan=composeCapabilities(request),digest=await capabilityCatalogDigest();
 if(plan.extension){
  const base=plan.extension.baseVersionId;
  if(state.backend_count&&!base)throw new BackendError(409,'Inspect the existing backend and identify its baseVersionId before planning a private customization.');
  if(base&&!await db.prepare('SELECT id FROM backend_versions WHERE id=? AND project_id=?').bind(base,request.projectId).first())throw new BackendError(404,'Base backend version not found');
 }
 const json=JSON.stringify(plan),expires=Math.floor(Date.now()/1000)+900;
 try{await db.prepare('INSERT INTO composition_plans(id,user_id,project_id,request_hash,catalog_digest,plan_json,details_revision,backend_count,backend_revision,extension_scope,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)').bind(id,user,request.projectId,requestHash,digest,json,state.details_revision,state.backend_count,state.backend_revision,plan.extension?.scope??'none',expires).run();}
 catch{const saved=await read();if(saved)return result(saved);throw new BackendError(409,'The project or planning allowance changed. Request a fresh capability plan.');}
 const saved=await read();if(!saved)throw new BackendError(503,'Saved capability plan unavailable');return result(saved);
}

/** Used only on owner-maintainer generated-source paths, never visitor handlers. */
export async function requireExtensionPlan(db:D1Database,user:string,project:string,planId:unknown,scope:'pure-function'|'visitor-transition'){
 if(typeof planId!=='string'||!uuid.test(planId))throw new BackendError(409,'Inspect the capability catalog and save a missing-capability plan before generating custom code.');
 const state=await ownedProject(db,user,project);
 const row=await db.prepare('SELECT * FROM composition_plans WHERE id=? AND user_id=? AND project_id=?').bind(planId,user,project).first<PlanRow>();
 if(!row)throw new BackendError(404,'Capability plan not found');
 if(row.extension_scope!==scope)throw new BackendError(409,'This plan does not allow that custom extension. Use its supported configuration or library actions.');
 if(row.expires_at<=Math.floor(Date.now()/1000)||row.catalog_digest!==await capabilityCatalogDigest()||row.details_revision!==state.details_revision||row.backend_revision!==state.backend_revision)throw new BackendError(409,'The capability plan is stale. Inspect the current project and prepare a new plan.');
 const plan=JSON.parse(row.plan_json) as ReturnType<typeof composeCapabilities>;
 if(plan.extension?.baseVersionId&&!await db.prepare('SELECT id FROM backend_versions WHERE id=? AND project_id=?').bind(plan.extension.baseVersionId,project).first())throw new BackendError(409,'The customization base was removed. Prepare a new plan.');
 return (versionId:string)=>db.prepare('INSERT INTO backend_extension_uses(version_id,plan_id) VALUES(?,?)').bind(versionId,planId);
}
