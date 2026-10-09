/** WH-187 owner-only portable project bundle route (`whumpo-portable-export` v1, docs/portable-exports.md).
 *
 * It reuses the WH-018 account export machinery rather than adding a second export engine: the same exact owner review
 * (`account_lifecycle_reviews`, kind `export`: request id, opaque server-random digest, ten-minute expiry, per-account
 * capacity), the same fresh-passkey requirement and single-use consumption at download, the same per-account monthly
 * allowance (`account_export_usage`: downloads and photo reads, decision 2's recommended shared allowance) and the same
 * per-project section reader and serializers (project-sections.ts). A portable review binds `format:
 * whumpo-portable-export` and one project, so it can never be downloaded as an account export or the reverse, and a
 * replayed, expired, foreign-owner, changed-binding or stale-proof request is refused exactly like the account export.
 *
 * The binding is content-free and never includes approval, screening-hold or preservation-hold state, so a hold placed
 * after the review does not make it stale or visible; it applies at download time under the generic `not-cleared`
 * category. Only the authenticated owner session reaches this route (http.ts); no Chat turn, agent action, job or model
 * can prepare or download a bundle, and nothing is staged in R2 or logged. The bundle is composed in memory by the pure
 * composer (portable-bundle.ts) and returned with its SHA-256 out of band (`x-whumpo-bundle-sha256`). */
import {hashToken} from '../security';
import {requireFreshWorkspace} from '../workspace-identity/admission';
import {pin} from '../shared-modules/registry';
import type {ModuleKind} from '../project-specification/v3/modules';
import {AccountLifecycleError} from './errors';
import {consumeExportReview,exactRequest,exportDownloadRequest,loadExportReview,saveAccountReview} from './review';
import {approvedLibraryPhotos,accessRolesSection,datasetTargets,latestDirectory,ownedInstances,specificationHead,visitorDatasetPages,withheldLibraryPhotos,type FilesPage,type RecordsPage,type SectionEnv} from './project-sections';
import {composePortableBundle,PortableBundleError,portableFilter,portableFormat,portableFormatVersion,type PortableRecord,type PortableSource} from './portable-bundle';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** One serializer page per records schema (200 records) and 64 pages per files collection (512 files) in this slice;
 * a larger data set fails closed with BUNDLE_TOO_LARGE rather than producing a partial bundle. */
const filesPagesPerCollection=64;

type ProjectRow={id:string;name:string;spec_revision:number|null;spec_version:string|null;directory_revision:number|null;backend_revision:number|null;app_revision:number|null};
async function ownedProject(db:D1Database,user:string,project:string){
 return db.prepare(`SELECT p.id,p.name,h.revision spec_revision,h.version_id spec_version,d.revision directory_revision,b.revision backend_revision,a.revision app_revision
  FROM projects p LEFT JOIN project_spec_heads h ON h.project_id=p.id LEFT JOIN directories d ON d.project_id=p.id LEFT JOIN backend_publications b ON b.project_id=p.id LEFT JOIN app_spaces a ON a.project_id=p.id
  WHERE p.id=? AND p.owner_user_id=?`).bind(project,user).first<ProjectRow>();
}
/** Content-free exact binding: project revisions and module configuration revisions only. */
async function portableBinding(db:D1Database,user:string,project:string,visitorData:boolean){
 const row=await ownedProject(db,user,project);
 if(!row)return null;
 const modules=await ownedInstances(db,user,project);
 return {version:1,kind:'export',format:portableFormat,formatVersion:portableFormatVersion,filter:portableFilter,accountId:user,projectId:project,visitorData,
  specRevision:row.spec_revision,specVersionId:row.spec_version,directoryRevision:row.directory_revision,backendRevision:row.backend_revision,applicationRevision:row.app_revision,
  modules:modules.map(m=>[m.id,m.kind,m.config_revision])};
}

export async function preparePortableExport(db:D1Database,user:string,input:unknown){
 const data=exactRequest(input,['requestId','projectId','visitorData']);
 if(typeof data.requestId!=='string'||!uuid.test(data.requestId)||typeof data.projectId!=='string'||!uuid.test(data.projectId)||typeof data.visitorData!=='boolean')
  throw new AccountLifecycleError(400,'invalid_request','Choose a request ID, one of your projects and whether to include visitor datasets.');
 const binding=await portableBinding(db,user,data.projectId,data.visitorData);
 // Another owner's project and a missing project are one generic refusal.
 if(!binding)throw new AccountLifecycleError(404,'not_found','Project not found.');
 if(binding.specVersionId===null)throw new AccountLifecycleError(409,'action_required','Save a website for this project before preparing a portable export.');
 const saved=await saveAccountReview(db,user,'export',data.requestId,await hashToken(JSON.stringify(['portable-export@1',user,data.projectId,data.visitorData])),binding);
 if(JSON.stringify(saved.binding)!==JSON.stringify(binding))throw new AccountLifecycleError(409,'stale_review','This project changed since this review. Prepare a new portable export review.');
 const visitorSets=binding.modules.filter(m=>m[1]==='records'||m[1]==='files').length;
 return {version:1 as const,review:{id:data.requestId,digest:saved.reviewDigest,expiresAt:saved.expiresAt,format:portableFormat,formatVersion:portableFormatVersion,filter:portableFilter,
  projectId:data.projectId,visitorData:data.visitorData,
  tiers:{'static-site':'Runnable only when every exported page passes the static check (no script, network call, Whumpo address or form endpoint).',data:'Data only: readable and checksummed, not a running application.',application:'Unavailable in this version: managed capabilities do not run outside Whumpo.'},
  includes:['Saved website specification and exact compiler, component and module versions','Public website pages whose photos are approved, with their response headers','Other approved project photos','Published directory data and staff role list','Reviewed custom function source that is cleared',
   ...(data.visitorData?['Visitor datasets you selected: retained module records and approved module file uploads, including visitor identifiers']:[])],
  excludes:['Passkeys, sessions, recovery material, provider tokens, secrets and keys','Anything not cleared: unapproved, pending or blocked media, uncleared source and held items, counted together',
   'Staff-only pages (their text stays in the specification)','Other accounts\' data and internal review records','Contact inbox messages (use the inbox export)',
   ...(data.visitorData?[]:[`Visitor datasets (${visitorSets} module instances); request them separately`])],
  notice:'The download is a private copy for you, built when you download it. It does not move, unpublish or delete anything in Whumpo. Its SHA-256 is returned with the download so you can verify the file.'}};
}

/** Reads one owned project's exportable rows through the shared section reader and serializers. Credential, session,
 * recovery, provider-token, safety-case and contact-message tables are never read; presence flags are counts only. */
export async function readPortableProject(env:SectionEnv,user:string,project:string,visitorData:boolean):Promise<PortableSource>{
 const db=env.DB,row=await ownedProject(db,user,project);
 if(!row)throw new AccountLifecycleError(404,'not_found','Project not found.');
 const head=await specificationHead(db,project);
 let specification:PortableSource['specification']=null,site:PortableSource['site']=null;
 if(head){
  const lock=JSON.parse(head.lock_json) as {schemaVersion:number;compiler:{id:string;version:number;digest:string};components:{id:string;version:number;digest:string}[]};
  specification={projectId:project,versionId:head.version_id,digest:head.spec_digest,json:head.spec_json,schemaVersion:lock.schemaVersion,
   compiler:{name:lock.compiler.id,version:lock.compiler.version,digest:lock.compiler.digest},components:lock.components.map(c=>({id:`${c.id}@${c.version}`,digest:c.digest})),held:head.held===1};
  if(head.held!==1){
   const version=await db.prepare('SELECT id,project_id,component_id,html,digest FROM site_versions WHERE id=? AND project_id=?').bind(head.version_id,project).first<{id:string;project_id:string;component_id:string;html:string;digest:string}>();
   if(version){
    const refs=(await db.prepare('SELECT v.file_id,f.project_id FROM version_photos v JOIN project_files f ON f.id=v.file_id WHERE v.version_id=? ORDER BY v.position').bind(version.id).all<{file_id:string;project_id:string}>()).results;
    site={projectId:version.project_id,versionId:version.id,component:version.component_id,html:version.html,digest:version.digest,photos:refs.map(r=>({fileId:r.file_id,projectId:r.project_id}))};
   }
  }
 }
 const photos:PortableSource['photos']=[];
 for await(const f of approvedLibraryPhotos(env,user,project))photos.push({id:f.id,projectId:f.project_id,digest:f.digest,bytes:f.bytes,cleared:true});
 const withheldPhotos=await withheldLibraryPhotos(db,project);
 const directoryDoc=await latestDirectory(db,user,project);
 const rows=await ownedInstances(db,user,project);
 const instances:PortableSource['instances']=[],roles:PortableSource['roles']=[],records:PortableSource['records']=[],files:PortableSource['files']=[];
 for(const m of rows){
  const config=JSON.parse(m.config_json) as {forms?:unknown[];retentionDays?:number};
  instances.push({resourceId:m.id,projectId:m.project_id,localId:m.local_id,kind:m.kind,configRevision:m.config_revision,
   module:pin(m.kind as ModuleKind,'module',m.module_digest),schema:pin(m.kind as ModuleKind,'schema',m.schema_digest),forms:Array.isArray(config.forms)&&config.forms.length>0});
  if(m.kind==='access'){
   const document=await accessRolesSection(db,user,project,m);
   if(document)roles.push({resourceId:m.id,projectId:m.project_id,document});
  }else if(visitorData&&(m.kind==='records'||m.kind==='files')){
   for(const target of datasetTargets(m)){
    const {pages,complete}=await visitorDatasetPages(env,user,project,m,target,m.kind==='records'?1:filesPagesPerCollection);
    if(m.kind==='records'){
     const page=pages[0] as RecordsPage;
     records.push({resourceId:m.id,projectId:m.project_id,schemaId:target,retentionDays:config.retentionDays??0,document:page as unknown as PortableSource['records'][number]['document']});
    }else{
     const list=pages as FilesPage[];
     files.push({resourceId:m.id,projectId:m.project_id,collectionId:target,withheld:list[0]?.withheld??0,complete,
      files:list.flatMap(p=>p.files.map(f=>({id:f.fileId,projectId:p.project.id,digest:f.sha256,bytes:Uint8Array.from(atob(f.bytes),c=>c.charCodeAt(0)),cleared:true,uploadedBy:f.uploadedBy,visitorId:f.visitorId,width:f.width,height:f.height,createdAt:f.createdAt})))});
    }
   }
  }
 }
 // Custom function source. Cleared only when the owner reviewed it (an applied publication or activation review for
 // that exact version) and it is not held (WH-014 held_backend_versions); a saved but never reviewed program is uncleared.
 const published=await db.prepare(`SELECT v.id,v.project_id,v.source,v.digest,EXISTS(SELECT 1 FROM held_backend_versions h WHERE h.id=v.id) held FROM backend_publications b
  JOIN backend_publication_reviews r ON r.id=b.review_id AND r.project_id=b.project_id AND r.status='applied' AND r.operation='publish' AND r.version_id=b.version_id
  JOIN backend_versions v ON v.id=b.version_id AND v.project_id=b.project_id WHERE b.project_id=?`).bind(project).first<{id:string;project_id:string;source:string;digest:string;held:number}>();
 const application=await db.prepare(`SELECT a.resource_id,v.id,v.project_id,v.source,v.digest,EXISTS(SELECT 1 FROM held_backend_versions h WHERE h.id=v.id) held,
  EXISTS(SELECT 1 FROM app_activation_reviews r WHERE r.project_id=a.project_id AND r.version_id=a.version_id AND r.enabled=1 AND r.status='applied') reviewed
  FROM app_spaces a JOIN backend_versions v ON v.id=a.version_id AND v.project_id=a.project_id WHERE a.project_id=?`).bind(project).first<{resource_id:string;id:string;project_id:string;source:string;digest:string;held:number;reviewed:number}>();
 const saved=(await db.prepare('SELECT count(*) n FROM backend_versions WHERE project_id=?').bind(project).first<{n:number}>())?.n??0;
 const programs:PortableSource['programs']=[];
 if(published&&published.held!==1)programs.push({id:'backend',projectId:published.project_id,source:published.source,digest:published.digest,cleared:true});
 else if(saved>0)programs.push({id:'backend',projectId:project,source:null,digest:null,cleared:false});
 if(application)programs.push(application.held!==1&&application.reviewed===1
  ?{id:'application',projectId:application.project_id,source:application.source,digest:application.digest,cleared:true}
  :{id:'application',projectId:project,source:null,digest:null,cleared:false});
 // Presence of managed dependencies: counts only; no message, address, token, proof, hostname or provider id is read.
 const presence=await db.prepare(`SELECT
  (SELECT count(*) FROM contact_settings WHERE project_id=?1 AND enabled=1)+(SELECT count(*) FROM contact_submissions WHERE project_id=?1) contact,
  (SELECT count(*) FROM github_backups WHERE project_id=?1)+(SELECT count(*) FROM domain_connections WHERE project_id=?1 AND state<>'disconnected') connectors,
  (SELECT count(*) FROM domain_claims WHERE project_id=?1)+(SELECT count(*) FROM domain_connections WHERE project_id=?1 AND state<>'disconnected') domains,
  (SELECT count(*) FROM backend_form_settings WHERE project_id=?1) forms`).bind(project).first<{contact:number;connectors:number;domains:number;forms:number}>();
 return {ownerId:user,project:{id:row.id,ownerId:user,name:row.name},specification,site,photos,withheldPhotos,
  directory:directoryDoc?{projectId:directoryDoc.project.id,document:directoryDoc as unknown as Record<string,unknown>}:null,
  instances,roles,records,files,programs,frontends:[],
  presence:{contactInbox:(presence?.contact??0)>0,connectors:(presence?.connectors??0)>0,domains:(presence?.domains??0)>0,forms:(presence?.forms??0)>0,customFunctions:saved>0||!!application},
  resources:{customFunctions:application?[application.resource_id]:[]}};
}

/** Fresh passkey proof, the unexpired exact portable review and an unchanged binding; the single-use download and the
 * monthly allowance are consumed before any read, then the bundle is composed and returned with its SHA-256. */
export async function downloadPortableExport(env:SectionEnv,user:string,input:unknown){
 const db=env.DB,data=exportDownloadRequest(input);
 await requireFreshWorkspace(db,user);
 const review=await loadExportReview(db,user,data.reviewId,data.reviewDigest);
 const stored=JSON.parse(review.binding_json) as {format?:unknown;projectId?:unknown;visitorData?:unknown};
 // An account export review is never a portable review, and the reverse is refused by the account export's own binding.
 if(stored.format!==portableFormat||typeof stored.projectId!=='string'||typeof stored.visitorData!=='boolean')throw new AccountLifecycleError(409,'stale_review','This export review is no longer current. Prepare a new review.');
 const binding=await portableBinding(db,user,stored.projectId,stored.visitorData);
 if(!binding||JSON.stringify(binding)!==review.binding_json)throw new AccountLifecycleError(409,'stale_review','This project changed since this review. Prepare a new portable export review.');
 await consumeExportReview(db,user,data.reviewId,data.reviewDigest);
 const cutoff=new Date(review.created_at*1000).toISOString();
 let bundle:Awaited<ReturnType<typeof composePortableBundle>>;
 try{
  const source=await readPortableProject(env,user,stored.projectId,stored.visitorData);
  bundle=await composePortableBundle(source,{ownerId:user,projectId:stored.projectId,visitorData:stored.visitorData,cutoff});
 }catch(error){
  if(error instanceof PortableBundleError){
   if(error.code==='BUNDLE_TOO_LARGE')throw new AccountLifecycleError(413,'bundle_too_large','This project is larger than a portable export allows in this test release. Nothing partial was produced.');
   if(error.code==='FORBIDDEN')throw new AccountLifecycleError(404,'not_found','Project not found.');
   throw new AccountLifecycleError(503,'closure_unavailable','A portable export section could not be verified. Prepare a fresh export.');
  }
  throw error;
 }
 return new Response(bundle.bytes,{headers:{'content-type':'application/zip','content-length':String(bundle.bytes.length),'content-disposition':'attachment; filename="whumpo-portable-export.zip"',
  'x-whumpo-bundle-sha256':bundle.sha256,'cache-control':'private, no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox",'referrer-policy':'no-referrer'}});
}
