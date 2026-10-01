import {requireServiceClientActivation} from './project-specification/service-clients/activation';
import {BackendError,listBackends} from './backend-versions';
import {backendFormConfig} from './backend-form-render';
type FormReview={id:string;user_id:string;project_id:string;enabled:number;config_json:string|null;site_revision:number;backend_publication_id:string|null;base_revision:number;status:string;expires_at:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export async function readBackendForm(db:D1Database,user:string,project:string){
 await listBackends(db,user,project);
 const current=await db.prepare('SELECT revision,review_id FROM backend_form_settings WHERE project_id=?').bind(project).first<{revision:number;review_id:string|null}>();
 const active=await db.prepare('SELECT id,config_json,backend_publication_id FROM backend_live_forms WHERE project_id=?').bind(project).first();
 return {projectId:project,revision:current?.revision??0,reviewId:current?.review_id??null,active};
}
export async function readBackendFormReview(db:D1Database,user:string,id:string){const row=await db.prepare('SELECT r.* FROM backend_form_reviews r JOIN projects p ON p.id=r.project_id AND p.owner_user_id=r.user_id WHERE r.id=? AND r.user_id=?').bind(id,user).first<FormReview>();if(!row)throw new BackendError(404,'Backend form review not found');return row;}
export async function prepareBackendForm(db:D1Database,user:string,project:string,id:string,value:unknown){
 if(!uuid.test(id))throw new BackendError(400,'Provide a review UUID');
 await listBackends(db,user,project);const config=value===null?null:JSON.stringify(backendFormConfig(value));
 const old=await db.prepare('SELECT id FROM backend_form_reviews WHERE id=?').bind(id).first();
 if(!old){
  await db.prepare('INSERT OR IGNORE INTO backend_form_settings(project_id) VALUES(?)').bind(project).run();
  const current=await readBackendForm(db,user,project);
  const targets=await db.prepare('SELECT s.revision,b.review_id FROM publications s JOIN backend_publications b ON b.project_id=s.project_id WHERE s.project_id=? AND s.version_id IS NOT NULL AND b.version_id IS NOT NULL').bind(project).first<{revision:number;review_id:string}>();
  if(config&&!targets)throw new BackendError(409,'Publish a website and tested backend before configuring its form');
  try{await db.prepare('INSERT INTO backend_form_reviews(id,user_id,project_id,enabled,config_json,site_revision,backend_publication_id,base_revision) VALUES(?,?,?,?,?,?,?,?)').bind(id,user,project,config?1:0,config,config?targets!.revision:-1,config?targets!.review_id:null,current.revision).run();}catch{/* Read exact saved review after an uncertain acknowledgment. */}
 }
 let row:FormReview;try{row=await readBackendFormReview(db,user,id);}catch{throw new BackendError(409,'Form review unavailable: the website/backend changed or review storage is full');}
 if(row.project_id!==project||row.config_json!==config)throw new BackendError(409,'Review ID already used');return row;
}
export async function confirmBackendForm(db:D1Database,user:string,id:string){
 const row=await readBackendFormReview(db,user,id);if(row.status==='applied')return row;
 await requireServiceClientActivation(db,user,'statelessForm',id);
 try{await db.prepare("UPDATE backend_form_reviews SET status='applied' WHERE id=? AND user_id=? AND status='pending'").bind(id,user).run();}catch{const saved=await readBackendFormReview(db,user,id);if(saved.status==='applied')return saved;throw new BackendError(409,'Form review expired or the website, backend or settings changed; prepare a new review');}
 return readBackendFormReview(db,user,id);
}
export function describeBackendForm(row:FormReview){return `Website tool review ${row.id}\nStatus: ${row.status}\nProject: ${row.project_id}\n${row.enabled?'Enable this form on website revision '+row.site_revision+' using backend publication '+row.backend_publication_id+'?\nFields and labels: '+row.config_json+'\nVisitor inputs go to this public stateless function; results are shown as text. The gateway does not save inputs or results. Existing backend daily limits apply. Changing the website or backend hides this form until reviewed again. Static source exports do not include this hosted tool.':'Hide the form from the website. The public backend endpoint remains available; use /unpublish-backend to review taking that endpoint offline.'}\nExpires: ${row.expires_at}\n${row.status==='pending'?'Only you can apply this exact review: /confirm-backend-form '+row.id:'This review was applied. Read /backend-form '+row.project_id+' for current status.'}`;}
export async function activeBackendForm(db:D1Database,project:string){return db.prepare('SELECT id,config_json,backend_publication_id FROM backend_live_forms WHERE project_id=?').bind(project).first<{id:string;config_json:string;backend_publication_id:string}>();}
