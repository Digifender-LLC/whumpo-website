import {liveAppPage,applicationURL} from './app-pages';
import {requireBackendVersionAvailable,heldRefusal,artifactHeldMessage} from './artifact-admission';
import {BackendError,listBackends} from './backend-versions';
import {hashToken} from './security';
import {readVisitorApplicationResource} from './app-resource';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type Review={id:string;project_id:string;user_id:string;version_id:string;run_id:string|null;enabled:number;base_revision:number;status:string;expires_at:string;source:string;digest:string};
export async function readApplication(db:D1Database,user:string,project:string){
 await listBackends(db,user,project);
 const row=await db.prepare('SELECT a.version_id,a.enabled,a.revision,a.review_id,(SELECT count(*) FROM app_visitors WHERE project_id=a.project_id) AS visitors FROM app_spaces a WHERE a.project_id=? AND a.owner_user_id=?').bind(project,user).first();
 // WH-126: visitor identity belongs to the project's access module instance; the application consumes it.
 const access=await db.prepare("SELECT i.id resource_id,i.local_id,ac.state,ac.revision activation_revision FROM module_instances i LEFT JOIN module_activations ac ON ac.instance_id=i.id WHERE i.project_id=? AND i.kind='access'").bind(project).first<{resource_id:string;local_id:string;state:string|null;activation_revision:number|null}>();
 const visitorAccess=access?{resourceId:access.resource_id,instanceId:access.local_id,state:access.state,activationRevision:access.activation_revision}:null;
 const page=await liveAppPage(db,project);return {projectId:project,configuration:row,visitorAccess,resource:await readVisitorApplicationResource(db,project),publicAccessReady:!!page,url:page?applicationURL(project):null,message:page?'The reviewed visitor page is available. Registration requires an invitation and a passkey.':visitorAccess?.state==='active'?'Visitor access is active. No visitor page is published for this application yet; ask for an application-page review.':'Activate the project’s visitor access module before inviting visitors. No visitor page is published for this application.'};
}
export async function readApplicationReview(db:D1Database,user:string,id:string){
 const row=await db.prepare('SELECT r.*,v.source,v.digest FROM app_activation_reviews r JOIN projects p ON p.id=r.project_id AND p.owner_user_id=r.user_id JOIN backend_versions v ON v.id=r.version_id AND v.project_id=r.project_id WHERE r.id=? AND r.user_id=?').bind(id,user).first<Review>();
 if(!row)throw new BackendError(404,'Application review not found');if(await hashToken(row.source)!==row.digest)throw new BackendError(409,'Application source integrity check failed');return row;
}
export async function prepareApplication(db:D1Database,user:string,project:string,id:string,operation:'enable'|'disable',version:string|null,run:string|null){
 if(!uuid.test(id)||!['enable','disable'].includes(operation)||operation==='enable'&&(!version||!uuid.test(version)||!run||!uuid.test(run))||operation==='disable'&&(version!==null||run!==null))throw new BackendError(400,'Provide an application operation and a successful state-transition test for enable');
 await listBackends(db,user,project);
 const previous=await db.prepare('SELECT id FROM app_activation_reviews WHERE id=?').bind(id).first();
 if(!previous){
  if(operation==='enable'){
   await requireBackendVersionAvailable(db,version!);
   // WH-126: the application consumes the project's access module instance (its visitor identities); it never owns them.
   if(!await db.prepare("SELECT 1 FROM module_instances WHERE project_id=? AND kind='access'").bind(project).first())throw new BackendError(409,'Activate this project’s visitor access module before authorizing an application');
   try{await db.prepare("INSERT OR IGNORE INTO app_spaces(project_id,owner_user_id,version_id,access_id,resource_id) SELECT ?,?,?,i.id,? FROM module_instances i WHERE i.project_id=? AND i.kind='access'").bind(project,user,version,crypto.randomUUID(),project).run();}catch{throw new BackendError(409,'Choose an owned backend version');}
  }
  const current=await db.prepare('SELECT version_id,revision FROM app_spaces WHERE project_id=? AND owner_user_id=?').bind(project,user).first<{version_id:string;revision:number}>();
  if(!current)throw new BackendError(404,'Application configuration not found');
  try{await db.prepare('INSERT INTO app_activation_reviews(id,project_id,user_id,version_id,run_id,enabled,base_revision) VALUES(?,?,?,?,?,?,?)').bind(id,project,user,operation==='enable'?version:current.version_id,run,operation==='enable'?1:0,current.revision).run();}catch{/* Recover only an exact committed review. */}
 }
 let row:Review;try{row=await readApplicationReview(db,user,id);}catch{throw new BackendError(409,'Review unavailable; check the transition test, current configuration and review allowance');}
 if(row.project_id!==project||row.enabled!==(operation==='enable'?1:0)||operation==='enable'&&row.version_id!==version||row.run_id!==run)throw new BackendError(409,'Review ID already used');return row;
}
export async function confirmApplication(db:D1Database,user:string,id:string){
 const row=await readApplicationReview(db,user,id);if(row.status==='applied')return row;
 if(row.enabled)await requireBackendVersionAvailable(db,row.version_id);
 try{await db.prepare("UPDATE app_activation_reviews SET status='applied' WHERE id=? AND user_id=? AND status='pending'").bind(id,user).run();}catch(error){const saved=await readApplicationReview(db,user,id);if(saved.status==='applied')return saved;if(heldRefusal(error))throw new BackendError(423,artifactHeldMessage);throw new BackendError(409,'Review expired, configuration changed, or a program replacement needs a visitor-data migration');}
 return readApplicationReview(db,user,id);
}
export function describeApplicationReview(row:Review){return `Application review ${row.id}\nStatus: ${row.status}\nProject: ${row.project_id}\nProgram: ${row.version_id}\nSHA-256: ${row.digest}\nBase revision: ${row.base_revision}\nTest: ${row.run_id??'not applicable'}\n${row.enabled?'Authorize this program to receive an authenticated visitor’s private document and input and return its replacement document and result. Each visitor has a separate document, limited to 4 KiB. No other visitor data, owner workspace data, credentials or network are supplied. State/results remain in private storage and operation history; visitors can export and delete their own account, while automatic retention and whole-app recovery remain unfinished. Limits: 100 visitors/project, 20 attempts/visitor/day and 100/project/day. Visitors are the project’s visitor access module identities; the module must stay active for them to sign in. Changing code after visitors exist requires a separate migration workflow, which is not available yet. A passing example does not prove compatibility for all inputs.':'Disable this application. Visitors keep their project visitor sign-in, which belongs to the visitor access module, but cannot use this application. Existing documents and operation history remain stored. Already committed operations remain committed; in-flight state changes will be rejected. Stateless backend endpoints are separate and are not changed.'}\nThis authorizes the program only. A separate application-page review is required to publish a visitor page. Reauthorizing this program hides any existing visitor page until reviewed again.\nSource (untrusted code):\n${row.source}\nExpires: ${row.expires_at}\n${row.status==='pending'?"Only you can apply this exact review using its confirmation button. Review: "+row.id:"This review was applied. Ask for the current status of project "+row.project_id+'.'}`;}
