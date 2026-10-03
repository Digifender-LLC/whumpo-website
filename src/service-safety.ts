import type {SafetyService,ServiceSafetyResource,ServiceSafetyReview,ServiceSafetyReviews} from './service-safety-shape';
import {BackendError} from './backend-error';
import {backendEndpoint,prepareBackendPublication,confirmBackendPublication} from './backend-publication';
import {applicationURL,prepareAppPage,confirmAppPage} from './app-pages';
import {assertWorkspace} from './workspace-identity/admission';

const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const revision=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
export function safetyService(value:unknown):SafetyService{if(value==='backend'||value==='application')return value;throw new BackendError(400,'Choose a backend tool or visitor app.');}
function identifier(value:unknown):asserts value is string{if(typeof value!=='string'||!uuid.test(value))throw new BackendError(400,'Choose a current project or saved review.');}
type ResourceRow={projectId:string;name:string;backendRevision:number|null;backendVersion:string|null;programRevision:number|null;pageRevision:number|null;livePage:string|null};
const resources=`SELECT p.id AS projectId,p.name,b.revision AS backendRevision,b.version_id AS backendVersion,
 a.revision AS programRevision,s.revision AS pageRevision,l.id AS livePage FROM projects p
 LEFT JOIN backend_publications b ON b.project_id=p.id LEFT JOIN app_spaces a ON a.project_id=p.id AND a.owner_user_id=p.owner_user_id
 LEFT JOIN app_page_settings s ON s.project_id=p.id LEFT JOIN app_live_pages l ON l.project_id=p.id`;
/** Only operational metadata. Program source, visitor records, cookies and tests
 * are never sent to the safety page. */
export async function safetyResources(db:D1Database,user:string,projects:string[]):Promise<ServiceSafetyResource[]>{
 if(!projects.length)return [];
 if(projects.length>50)throw new BackendError(400,'Choose up to 50 projects.');projects.forEach(identifier);
 const {results}=await db.prepare(resources+` WHERE p.owner_user_id=? AND p.id IN (${projects.map(()=>'?').join(',')}) ORDER BY p.id`).bind(user,...projects).all<ResourceRow>();
 await assertWorkspace(db,user);
 return results.flatMap(row=>[
  ...(row.backendRevision===null?[]:[{kind:'backend' as const,projectId:row.projectId,name:row.name,url:backendEndpoint(row.projectId),published:row.backendVersion!==null,revision:row.backendRevision,programRevision:null,versionId:row.backendVersion}]),
  ...(row.programRevision===null||row.pageRevision===null?[]:[{kind:'application' as const,projectId:row.projectId,name:row.name,url:applicationURL(row.projectId),published:row.livePage!==null,revision:row.pageRevision,programRevision:row.programRevision,versionId:null}]),
 ]);
}
type Candidate={id:string;projectId:string;name:string;status:'pending'|'applied';expiresAt:string;expectedRevision:number;programRevision:number|null;versionId:string|null;revision:number;currentProgramRevision:number|null;currentVersion:string|null;published:number};
function query(kind:SafetyService){return kind==='backend'
 ? `SELECT r.id,r.project_id AS projectId,p.name,r.status,r.expires_at AS expiresAt,r.base_revision AS expectedRevision,NULL AS programRevision,r.version_id AS versionId,
 b.revision,NULL AS currentProgramRevision,b.version_id AS currentVersion,b.version_id IS NOT NULL AS published
 FROM backend_publication_reviews r JOIN projects p ON p.id=r.project_id AND p.owner_user_id=r.user_id JOIN backend_publications b ON b.project_id=p.id
 WHERE r.user_id=? AND r.operation='unpublish'`
 : `SELECT r.id,r.project_id AS projectId,p.name,r.status,r.expires_at AS expiresAt,r.base_revision AS expectedRevision,r.program_revision AS programRevision,NULL AS versionId,
 s.revision,a.revision AS currentProgramRevision,NULL AS currentVersion,l.id IS NOT NULL AS published
 FROM app_page_reviews r JOIN projects p ON p.id=r.project_id AND p.owner_user_id=r.user_id JOIN app_page_settings s ON s.project_id=p.id
 JOIN app_spaces a ON a.project_id=p.id AND a.owner_user_id=r.user_id LEFT JOIN app_live_pages l ON l.project_id=p.id
 WHERE r.user_id=? AND r.config_json IS NULL`;
}
function present(kind:SafetyService,row:Candidate):ServiceSafetyReview{
 const changed=row.expectedRevision!==row.revision||(kind==='backend'?row.versionId!==row.currentVersion:row.programRevision!==row.currentProgramRevision);
 return {id:row.id,kind,projectId:row.projectId,name:row.name,url:kind==='backend'?backendEndpoint(row.projectId):applicationURL(row.projectId),expiresAt:row.expiresAt,expectedRevision:row.expectedRevision,programRevision:row.programRevision,versionId:row.versionId,publishedNow:!!row.published,
 state:row.status==='applied'?'applied':row.expiresAt<=new Date().toISOString()?'expired':changed?'changed':'pending'};
}
export async function readServiceSafetyReview(db:D1Database,user:string,kind:SafetyService,id:string):Promise<ServiceSafetyReview>{
 safetyService(kind);identifier(id);
 const row=await db.prepare(query(kind)+' AND r.id=?').bind(user,id).first<Candidate>();
 if(!row)throw new BackendError(404,'Saved withdrawal not found.');await assertWorkspace(db,user);return present(kind,row);
}
export async function serviceSafetyReviews(db:D1Database,user:string,kind:SafetyService,project:string,after:string|null):Promise<ServiceSafetyReviews>{
 safetyService(kind);identifier(project);if(after!==null)identifier(after);
 if(!await db.prepare('SELECT id FROM projects WHERE id=? AND owner_user_id=?').bind(project,user).first())throw new BackendError(404,'Project not found.');
 const {results}=await db.prepare(query(kind)+' AND r.project_id=? AND (? IS NULL OR r.id>?) ORDER BY r.id LIMIT 21').bind(user,project,after,after).all<Candidate>();
 await assertWorkspace(db,user);return {version:1,reviews:results.slice(0,20).map(r=>present(kind,r)),next:results.length>20?results[19].id:null};
}
export async function prepareServiceSafetyReview(db:D1Database,user:string,value:unknown){
 if(!exact(value,['version','id','kind','projectId','expectedRevision','programRevision','versionId'])||value.version!==1||!revision(value.expectedRevision))throw new BackendError(400,'Use the current withdrawal request.');
 const kind=safetyService(value.kind);identifier(value.id);identifier(value.projectId);
 if(kind==='backend'){
  identifier(value.versionId);if(value.programRevision!==null)throw new BackendError(400,'Backend tools have no visitor-app revision.');
  await prepareBackendPublication(db,user,value.projectId,value.id,'unpublish',value.versionId,null,value.expectedRevision);
 }else{
  if(value.versionId!==null||!revision(value.programRevision))throw new BackendError(400,'Choose the current visitor-app page and program revisions.');
  await prepareAppPage(db,user,value.projectId,value.id,null,{projectId:value.projectId,programRevision:value.programRevision,pageRevision:value.expectedRevision});
 }
 return {version:1 as const,review:await readServiceSafetyReview(db,user,kind,value.id)};
}
/** No enable/publish payload is accepted; the same existing domain handlers and
 * schema triggers apply this exact negative action. */
export async function confirmServiceSafetyReview(db:D1Database,user:string,kind:SafetyService,id:string,value:unknown){
 if(!exact(value,['version','confirmation'])||value.version!==1||value.confirmation!=='TAKE_OFFLINE')throw new BackendError(400,'Confirm this exact withdrawal.');
 const review=await readServiceSafetyReview(db,user,kind,id);
 if(review.state==='applied')return {version:1 as const,review};
 if(review.state!=='pending')throw new BackendError(409,'This review changed or expired. Check current status and prepare a fresh review.');
 if(kind==='backend')await confirmBackendPublication(db,user,id);else await confirmAppPage(db,user,id);
 return {version:1 as const,review:await readServiceSafetyReview(db,user,kind,id)};
}
