import {BackendError,listBackends} from './backend-versions';
import {backendFormConfig} from './backend-form-render';
type Review={id:string;user_id:string;project_id:string;program_revision:number;base_revision:number;config_json:string|null;status:string;expires_at:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const applicationURL=(project:string)=>`https://apps.digifender.com/apps/${project}/`;
export async function liveAppPage(db:D1Database,project:string){return db.prepare('SELECT * FROM app_live_pages WHERE project_id=?').bind(project).first<{id:string;project_id:string;config_json:string;program_revision:number;revision:number}>();}
export async function readAppPage(db:D1Database,user:string,project:string){
 await listBackends(db,user,project);
 const current=await db.prepare('SELECT revision,review_id FROM app_page_settings WHERE project_id=?').bind(project).first<{revision:number;review_id:string|null}>();
 const page=await liveAppPage(db,project);return {projectId:project,revision:current?.revision??0,reviewId:current?.review_id??null,page,url:page?applicationURL(project):null};
}
export async function readAppPageReview(db:D1Database,user:string,id:string){
 const row=await db.prepare('SELECT r.* FROM app_page_reviews r JOIN projects p ON p.id=r.project_id AND p.owner_user_id=r.user_id WHERE r.id=? AND r.user_id=?').bind(id,user).first<Review>();
 if(!row)throw new BackendError(404,'Application page review not found');return row;
}
export async function prepareAppPage(db:D1Database,user:string,project:string,id:string,value:unknown){
 if(!uuid.test(id))throw new BackendError(400,'Provide a review UUID');
 await listBackends(db,user,project);const config=value===null?null:JSON.stringify(backendFormConfig(value));
 const old=await db.prepare('SELECT id FROM app_page_reviews WHERE id=?').bind(id).first();
 if(!old){
  const app=await db.prepare('SELECT revision,enabled FROM app_spaces WHERE project_id=? AND owner_user_id=?').bind(project,user).first<{revision:number;enabled:number}>();
  if(!app||config&&!app.enabled)throw new BackendError(409,'Authorize a tested application before publishing its page');
  await db.prepare('INSERT OR IGNORE INTO app_page_settings(project_id) VALUES(?)').bind(project).run();
  const current=await readAppPage(db,user,project);
  try{await db.prepare('INSERT INTO app_page_reviews(id,user_id,project_id,program_revision,base_revision,config_json) VALUES(?,?,?,?,?,?)').bind(id,user,project,app.revision,current.revision,config).run();}catch{/* Read back only this exact request after uncertain storage. */}
 }
 let row:Review;try{row=await readAppPageReview(db,user,id);}catch{throw new BackendError(409,'Page review unavailable; the app changed or review storage is full');}
 if(row.project_id!==project||row.config_json!==config)throw new BackendError(409,'Review ID already used');return row;
}
export async function confirmAppPage(db:D1Database,user:string,id:string){
 const row=await readAppPageReview(db,user,id);if(row.status==='applied')return row;
 try{await db.prepare("UPDATE app_page_reviews SET status='applied' WHERE id=? AND user_id=? AND status='pending'").bind(id,user).run();}catch{const saved=await readAppPageReview(db,user,id);if(saved.status==='applied')return saved;throw new BackendError(409,'Page review expired or the application changed; prepare a new review');}
 return readAppPageReview(db,user,id);
}
export function describeAppPage(row:Review){return `Application page review ${row.id}\nStatus: ${row.status}\nProject: ${row.project_id}\nProgram revision: ${row.program_revision}\nPage revision: ${row.base_revision}\n${row.config_json?'Publish this page at '+applicationURL(row.project_id)+'? Its title, description and fields become public. Visitors need an invitation and a passkey. The form sends their input and private document to the already-authorized program. Fields must match its tested input contract. Results appear as text, never executable markup.\nForm: '+row.config_json:'Take this application page and its visitor API offline? Stored visitor documents and history are retained.'}\nThis change signs out every visitor and cancels pending sign-ins. In-flight data commits require a still-valid session. Full deletion, export and retention controls are unfinished. This does not change the project’s stateless website or public backend.\nExpires: ${row.expires_at}\n${row.status==='pending'?'Only you can apply this exact review: /confirm-app-page '+row.id:'This review was applied. Read /app-page '+row.project_id+' for current availability.'}`;}
