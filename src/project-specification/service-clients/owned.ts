import {BackendError} from '../../backend-error';
import {requireSpecificationAvailable} from '../../specification-safety';
import {jsonDigest,sha256,SpecificationError} from '../v2/json';
import {compileServiceClientArtifacts,validateServiceClientSpecification,validateServiceClientTarget,type ServiceClientTarget} from './compiler';

const validID=(value:string)=>/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(value);
const unavailable=()=>new BackendError(409,'The website or its services changed. Prepare a fresh review.');
type Row={project_id:string;version_id:string;component_id:string;config_json:string;html:string;digest:string;site_revision:number;live_version_id:string|null;contact_revision:number;contact_active:number;form_revision:number;form_review_id:string|null;form_active:number;backend_revision:number|null;backend_review_id:string|null;backend_version_id:string|null;backend_digest:string|null;backend_source:string|null};
/** Owner must come from authenticated server context, never model/request fields. Read-only. */
async function ownedSnapshot(db:D1Database,user:string,project:string,version:string){
 if(!validID(project)||!validID(version))throw new BackendError(400,'Choose an owned project and saved website version.');
 // One statement supplies a coherent ownership/publication/settings snapshot.
 const row=await db.prepare(`SELECT p.id project_id,v.id version_id,v.component_id,v.config_json,v.html,v.digest,
 coalesce(s.revision,0) site_revision,s.version_id live_version_id,
 coalesce(c.revision,0) contact_revision,CASE WHEN c.enabled=1 AND s.version_id IS NOT NULL AND c.publication_revision=s.revision THEN 1 ELSE 0 END contact_active,
 coalesce(f.revision,0) form_revision,f.review_id form_review_id,CASE WHEN lf.id IS NULL THEN 0 ELSE 1 END form_active,
 b.revision backend_revision,r.id backend_review_id,bv.id backend_version_id,bv.digest backend_digest,bv.source backend_source
 FROM projects p JOIN site_versions v ON v.project_id=p.id AND v.id=?
 LEFT JOIN publications s ON s.project_id=p.id
 LEFT JOIN contact_settings c ON c.project_id=p.id
 LEFT JOIN backend_form_settings f ON f.project_id=p.id
 LEFT JOIN backend_live_forms lf ON lf.project_id=p.id
 LEFT JOIN backend_publications b ON b.project_id=p.id
 LEFT JOIN backend_publication_reviews r ON r.id=b.review_id AND r.project_id=p.id AND r.user_id=p.owner_user_id AND r.status='applied' AND r.operation='publish' AND r.version_id=b.version_id
 LEFT JOIN backend_versions bv ON bv.id=r.version_id AND bv.project_id=p.id
 WHERE p.id=? AND p.owner_user_id=?`).bind(version,project,user).first<Row>();
 if(!row)throw new BackendError(404,'Saved website version not found.');
 await requireSpecificationAvailable(db,version);
 if(await sha256(row.html)!==row.digest)throw unavailable();
 if(row.backend_source!==null&&await sha256(row.backend_source)!==row.backend_digest)throw unavailable();
 if(await db.prepare("SELECT 1 FROM content_screening_decisions WHERE user_id=? AND kind='generated_artifact' AND required=1 AND digest IN (?,?) LIMIT 1").bind(user,row.digest,row.backend_digest).first())throw new BackendError(423,'This website or service is held for safety review.');
 const target=validateServiceClientTarget({projectId:row.project_id,website:{versionId:row.version_id,digest:row.digest},publication:{revision:row.site_revision,versionId:row.live_version_id},
 contact:{revision:row.contact_revision,active:row.contact_active===1},form:{revision:row.form_revision,reviewId:row.form_review_id,active:row.form_active===1},
 backend:row.backend_review_id&&row.backend_version_id&&row.backend_digest?{revision:row.backend_revision,reviewId:row.backend_review_id,versionId:row.backend_version_id,digest:row.backend_digest}:null});
 return {target,website:{componentId:row.component_id,config:JSON.parse(row.config_json),html:row.html}};
}
function safe(error:unknown):never {
 if(error instanceof BackendError)throw error;
 if(error instanceof SpecificationError||error instanceof SyntaxError||error instanceof Error&&error.message==='Rendered site too large')throw new BackendError(422,'This website service configuration is not supported.');
 throw error;
}
/** Produces private evidence only. It does not save, publish, activate or invoke a service. */
export async function compileOwnedServiceClients(db:D1Database,user:string,project:string,version:string,input:unknown,lock:unknown){
 try{
  const specification=validateServiceClientSpecification(input),snapshot=await ownedSnapshot(db,user,project,version);
  if(specification.statelessForm&&!snapshot.target.backend)throw new BackendError(409,'Publish and review a tested backend before preparing its website client.');
  return await compileServiceClientArtifacts(specification,snapshot.target,snapshot.website,lock);
 }catch(error){return safe(error);}
}
/** Read-time freshness check, not an atomic mutation/activation grant. Apply needs SQL guards. */
export async function requireCurrentServiceClientTarget(db:D1Database,user:string,expected:ServiceClientTarget){
 try{
  const target=validateServiceClientTarget(expected),current=await ownedSnapshot(db,user,target.projectId,target.website.versionId);
  if(await jsonDigest(current.target,4096)!==await jsonDigest(target,4096))throw unavailable();
  return current.target;
 }catch(error){return safe(error);}
}
