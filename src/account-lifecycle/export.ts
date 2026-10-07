/** WH-018 reviewed platform account export (`whumpo-account-export-v1`, proposed LC-09 format in docs/data-lifecycle.md).
 * Distinct from WH-077 portable project delivery: this is the owner's account copy, not a runnable backup or restore input.
 *
 * Exact review: `prepareAccountExport` binds the account, the requested scope (owner/project data by default; visitor
 * datasets only when explicitly selected) and each project's current specification/directory/module configuration
 * revisions. `downloadAccountExport` needs a fresh passkey proof, the unexpired review digest and an unchanged binding,
 * then streams a ZIP from the authenticated platform route: nothing is staged in R2 or exposed by URL. Every read uses the
 * caller's admitted database (identity rechecked inside each statement) and the scoped private FILES binding, so a
 * revoked session stops the stream before `manifest.json` (the completion marker, written last) is produced.
 *
 * Composed from existing serializers: the Chat transcript export, profile photo reader, directory export (WH-129),
 * access roles (WH-126), records (WH-127) and files (WH-128). Never included: credentials, token or secret hashes,
 * recovery material, provider identifiers, object keys, safety cases/evidence/holds, scanner references, held or
 * unapproved media, internal proposal envelopes, other tenants' data. */
import {Zip,ZipPassThrough,strToU8} from 'fflate';
import {hashToken} from '../security';
import {requireFreshWorkspace} from '../workspace-identity/admission';
import {exportChatTranscript} from '../chat-transcript';
import {readProfile,profilePhoto} from '../profile';
import {getBilling} from '../billing';
import {directoryHistory,exportDirectory} from '../directory';
import {approvedPhotoSQL,ownerLibrarySQL,photoBytesMatch} from '../photo-safety';
import {maxPhotoBytes} from '../photo-format';
import {reserveStorage,StorageLimitError} from '../storage-budget';
import {exportAccessRoles} from '../shared-modules/access-export';
import {exportRecords} from '../shared-modules/records-export';
import {exportFiles} from '../shared-modules/files-export';
import {AccountLifecycleError,saveAccountReview} from './closure';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const archiveTime=new Date('2020-01-01T00:00:00Z');
type ProjectRow={id:string;name:string;purpose:string;status:string;audience:string;style_notes:string;preferred_theme:string;created_at:string;updated_at:string;spec_revision:number|null;directory_revision:number|null};
type InstanceRow={id:string;project_id:string;local_id:string;kind:'content'|'records'|'files'|'access';config_revision:number;config_json:string};
type Omission={section:string;reason:string;count?:number};
type Env={DB:D1Database;FILES?:R2Bucket};

function record(value:unknown,keys:readonly string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw new AccountLifecycleError(400,'invalid_request','Use the current account request.');
 const data=value as Record<string,unknown>;
 if(data.version!==1||Object.keys(data).length!==keys.length+1||!keys.every(k=>Object.hasOwn(data,k)))throw new AccountLifecycleError(400,'invalid_request','Use the current account request.');
 return data;
}
async function projects(db:D1Database,user:string){
 return (await db.prepare(`SELECT p.id,p.name,p.purpose,p.status,p.audience,p.style_notes,p.preferred_theme,p.created_at,p.updated_at,h.revision spec_revision,d.revision directory_revision
  FROM projects p LEFT JOIN project_spec_heads h ON h.project_id=p.id LEFT JOIN directories d ON d.project_id=p.id WHERE p.owner_user_id=? ORDER BY p.created_at,p.id`).bind(user).all<ProjectRow>()).results;
}
async function instances(db:D1Database,user:string){
 return (await db.prepare('SELECT i.id,i.project_id,i.local_id,i.kind,i.config_revision,i.config_json FROM module_instances i JOIN projects p ON p.id=i.project_id WHERE p.owner_user_id=? ORDER BY i.project_id,i.local_id').bind(user).all<InstanceRow>()).results;
}
async function exportBinding(db:D1Database,user:string,visitorData:boolean){
 const [rows,modules]=await Promise.all([projects(db,user),instances(db,user)]);
 return {version:1,kind:'export',format:'whumpo-account-export-v1',accountId:user,visitorData,
  projects:rows.map(p=>({id:p.id,specRevision:p.spec_revision,directoryRevision:p.directory_revision,modules:modules.filter(m=>m.project_id===p.id).map(m=>[m.id,m.kind,m.config_revision])}))};
}

export async function prepareAccountExport(db:D1Database,user:string,input:unknown){
 const data=record(input,['requestId','visitorData']);
 if(typeof data.requestId!=='string'||!uuid.test(data.requestId)||typeof data.visitorData!=='boolean')throw new AccountLifecycleError(400,'invalid_request','Choose a request ID and whether to include visitor datasets.');
 const binding=await exportBinding(db,user,data.visitorData);
 const saved=await saveAccountReview(db,user,'export',data.requestId,await hashToken(JSON.stringify(['account-export@1',user,data.visitorData])),binding);
 if(JSON.stringify(saved.binding)!==JSON.stringify(binding))throw new AccountLifecycleError(409,'stale_review','Your projects changed since this review. Prepare a new export review.');
 const modules=binding.projects.flatMap(p=>p.modules);
 return {version:1 as const,review:{id:data.requestId,digest:saved.reviewDigest,expiresAt:saved.expiresAt,format:'whumpo-account-export-v1',visitorData:data.visitorData,
  projects:binding.projects.length,
  includes:['Account and profile settings (no sign-in credentials)','Approved profile photo','Plan and standard AI usage history','Connection status and GitHub backup destinations','Saved Chat transcript','Each project: details, current saved website specification and saved version list, published directory snapshot, approved photos, staff role list',
   ...(data.visitorData?['Visitor datasets you selected: module records and approved module file uploads, including visitor identifiers']:[])],
  excludes:['Passkeys, recovery material, sessions and provider tokens','Safety reviews, preservation records and anything held or not yet approved','Internal review envelopes and other accounts\' data',
   ...(data.visitorData?[]:[`Visitor datasets (${modules.filter(m=>m[1]==='records'||m[1]==='files').length} module instances); request them separately`]),'Contact inbox messages (kept in your inbox for 30 days)','Visitor application documents (each visitor exports their own)'],
  notice:'The download is a private copy for you. It is not a backup Whumpo can restore, and it is generated from current data when you download it.'}};
}

/** Per-account monthly export allowance (account_export_usage): 10 downloads and 5,000 photo reads per account, checked
 * before the platform-wide storage ceiling, so one account's repeated exports cannot exhaust shared photo capacity. */
export const exportDownloadsPerMonth=10,exportPhotoReadsPerMonth=5000;
const allowanceMessage='This account reached its monthly export allowance. Try again after the monthly reset.';
async function reserveExportPhotoAllowance(db:D1Database,user:string){
 const row=await db.prepare(`INSERT INTO account_export_usage(user_id,period,photo_reads) VALUES(?,strftime('%Y-%m','now'),1)
  ON CONFLICT(user_id,period) DO UPDATE SET photo_reads=photo_reads+1 WHERE photo_reads<${exportPhotoReadsPerMonth} RETURNING photo_reads`).bind(user).first();
 if(!row)throw new StorageLimitError(allowanceMessage);
}

const json=(value:unknown)=>strToU8(JSON.stringify(value,null,2)+'\n');
async function sha256(bytes:Uint8Array){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');}
const configIds=(value:string,key:'schemas'|'collections')=>{const list=(JSON.parse(value) as Record<string,unknown>)[key];return Array.isArray(list)?list.map(x=>(x as {id:string}).id).filter(x=>typeof x==='string'):[];};

/** Each section is produced and buffered one at a time (bounded test-stage sizes); the archive itself is streamed. */
async function* sections(env:Env,user:string,binding:Awaited<ReturnType<typeof exportBinding>>,omissions:Omission[]):AsyncGenerator<[string,Uint8Array]>{
 const db=env.DB,profile=await readProfile(db,user);
 yield ['account.json',json({accountId:user,email:profile.email,profile:{name:profile.name,aboutMe:profile.about_me,theme:profile.theme,avatar:profile.avatar_id,shareContextWithAI:profile.share_context===1,measurementConsent:profile.measurement_consent===1},onboardingComplete:profile.onboardingComplete})];
 if(profile.photoSafety==='approved'){
  try{yield ['profile/photo.jpg',new Uint8Array(await (await profilePhoto(db,user)).arrayBuffer())];}catch{omissions.push({section:'profile/photo.jpg',reason:'not-currently-approved'});}
 }else if(profile.photoSafety!=='none')omissions.push({section:'profile/photo.jpg',reason:'not-currently-approved'});
 yield ['usage.json',json(await getBilling(db,user))];
 const connected=await db.prepare("SELECT (SELECT count(*) FROM github_token_vault WHERE user_id=? AND state='active') github,(SELECT count(*) FROM cloudflare_token_vault WHERE user_id=? AND state='active') cloudflare").bind(user,user).first<{github:number;cloudflare:number}>();
 const backups=(await db.prepare('SELECT project_id,version_id,repo_owner,repo_name,branch,path,state,commit_sha,created_at FROM github_backups WHERE user_id=? ORDER BY created_at,id LIMIT 500').bind(user).all<Record<string,unknown>>()).results;
 yield ['connections.json',json({github:{connected:(connected?.github??0)>0},cloudflare:{connected:(connected?.cloudflare??0)>0},githubBackups:backups.map(b=>({projectId:b.project_id,versionId:b.version_id,repository:`${b.repo_owner}/${b.repo_name}`,branch:b.branch,path:b.path,state:b.state,commit:b.commit_sha,createdAt:b.created_at}))})];
 const chat=await exportChatTranscript(new Request('https://whumpo.com/api/chat/export'),db,user);
 yield ['chat/transcript.json',new Uint8Array(await chat.arrayBuffer())];
 const rows=await projects(db,user),modules=await instances(db,user);
 for(const p of rows){
  const base=`projects/${p.id}/`;
  const versions=(await db.prepare('SELECT v.id,v.created_at,v.digest,s.version_id live FROM site_versions v LEFT JOIN publications s ON s.project_id=v.project_id AND s.version_id=v.id WHERE v.project_id=? ORDER BY v.created_at,v.id').bind(p.id).all<{id:string;created_at:string;digest:string;live:string|null}>()).results;
  yield [base+'project.json',json({id:p.id,name:p.name,purpose:p.purpose,status:p.status,audience:p.audience,styleNotes:p.style_notes,preferredTheme:p.preferred_theme,createdAt:p.created_at,updatedAt:p.updated_at,
   savedVersions:versions.map(v=>({id:v.id,createdAt:v.created_at,sha256:v.digest,live:v.live!==null}))})];
  const head=await db.prepare('SELECT h.revision,h.version_id,v.spec_json,v.spec_digest FROM project_spec_heads h JOIN project_spec_versions v ON v.version_id=h.version_id WHERE h.project_id=?').bind(p.id).first<{revision:number;version_id:string;spec_json:string;spec_digest:string}>();
  if(head)yield [base+'specification.json',json({format:'whumpo-project-specification',revision:head.revision,versionId:head.version_id,specDigest:head.spec_digest,specification:JSON.parse(head.spec_json) as unknown})];
  const history=await directoryHistory(db,user,p.id);
  if(history.snapshots.length)yield [base+'directory.json',json(await exportDirectory(db,user,p.id,history.snapshots[0].id))];
  // Owner photo library: only ready photos whose exact digest is currently approved, re-hashed after the private read.
  const photos=(await db.prepare(`SELECT f.id,f.object_key,f.digest,f.size,f.width,f.height,f.created_at FROM project_files f WHERE f.project_id=? AND f.status='ready' AND ${ownerLibrarySQL} AND ${approvedPhotoSQL} ORDER BY f.created_at,f.id`).bind(p.id).all<{id:string;object_key:string;digest:string;size:number;width:number;height:number;created_at:string}>()).results;
  const withheld=(await db.prepare(`SELECT count(*) n FROM project_files f WHERE f.project_id=? AND ${ownerLibrarySQL} AND NOT (f.status='ready' AND ${approvedPhotoSQL})`).bind(p.id).first<{n:number}>())?.n??0;
  if(withheld)omissions.push({section:base+'photos',reason:'not-currently-approved',count:withheld});
  const listed:Record<string,unknown>[]=[];
  for(const f of photos){
   if(!env.FILES)throw new AccountLifecycleError(503,'closure_unavailable','Photo storage is unavailable. Try the export again later.');
   if(f.size>maxPhotoBytes)throw new AccountLifecycleError(503,'closure_unavailable','A photo could not be verified.');
   await reserveExportPhotoAllowance(db,user);
   await reserveStorage(db,'read');
   const object=await env.FILES.get(f.object_key);
   if(!object||object.size!==f.size){await object?.body.cancel();throw new AccountLifecycleError(503,'closure_unavailable','A photo could not be verified.');}
   const bytes=new Uint8Array(await object.arrayBuffer());
   if(!await photoBytesMatch(bytes,f.digest))throw new AccountLifecycleError(503,'closure_unavailable','A photo could not be verified.');
   listed.push({id:f.id,file:`photos/${f.id}.jpg`,width:f.width,height:f.height,size:f.size,sha256:f.digest,createdAt:f.created_at});
   yield [`${base}photos/${f.id}.jpg`,bytes];
  }
  if(listed.length)yield [base+'photos.json',json({photos:listed})];
  for(const m of modules.filter(m=>m.project_id===p.id)){
   const prefix=`${base}modules/${m.local_id}/`;
   if(m.kind==='access'){
    const state=await db.prepare('SELECT 1 FROM module_access_states WHERE instance_id=?').bind(m.id).first();
    if(state)yield [prefix+'roles.json',json(await exportAccessRoles(db,user,p.id,m.id,m.config_revision))];
   }else if(m.kind==='records'||m.kind==='files'){
    if(!binding.visitorData){omissions.push({section:prefix,reason:'visitor-dataset-not-requested'});continue;}
    for(const target of configIds(m.config_json,m.kind==='records'?'schemas':'collections')){
     const pages:unknown[]=[];let after:string|null=null;
     do{
      const page:{next:string|null}=m.kind==='records'
       ?await exportRecords(db,user,p.id,m.id,m.config_revision,{recordId:target,after})
       :await exportFiles(db,env.FILES as R2Bucket,user,p.id,m.id,m.config_revision,{collectionId:target,after},()=>reserveExportPhotoAllowance(db,user));
      pages.push(page);after=page.next;
     }while(after&&pages.length<500);
     if(after)throw new AccountLifecycleError(503,'closure_unavailable','A visitor dataset is too large for this test export.');
     yield [`${prefix}${m.kind}-${target}.json`,json({pages})];
    }
   }
  }
 }
}

/** Fresh passkey proof, unexpired exact review and an unchanged binding; the response is a private no-store stream. */
export async function downloadAccountExport(env:Env,user:string,input:unknown){
 const db=env.DB,data=record(input,['reviewId','reviewDigest']);
 if(typeof data.reviewId!=='string'||!uuid.test(data.reviewId)||typeof data.reviewDigest!=='string'||!/^[a-f0-9]{64}$/.test(data.reviewDigest))throw new AccountLifecycleError(400,'invalid_request','Use the current export review.');
 await requireFreshWorkspace(db,user);
 const review=await db.prepare("SELECT binding_json,review_digest,created_at FROM account_lifecycle_reviews WHERE id=? AND user_id=? AND kind='export' AND expires_at>unixepoch()").bind(data.reviewId,user).first<{binding_json:string;review_digest:string;created_at:number}>();
 if(!review||review.review_digest!==data.reviewDigest)throw new AccountLifecycleError(409,'stale_review','This export review is no longer current. Prepare a new review.');
 const stored=JSON.parse(review.binding_json) as Awaited<ReturnType<typeof exportBinding>>;
 const binding=await exportBinding(db,user,stored.visitorData===true);
 if(JSON.stringify(binding)!==review.binding_json)throw new AccountLifecycleError(409,'stale_review','Your projects changed since this review. Prepare a new export review.');
 // Single use: the download consumes its exact review and one monthly download in one transaction.
 let consumed:D1Result[];
 try{
  consumed=await db.batch([
   db.prepare(`INSERT INTO account_export_usage(user_id,period,downloads) SELECT ?,strftime('%Y-%m','now'),1
    WHERE EXISTS(SELECT 1 FROM account_lifecycle_reviews WHERE id=? AND user_id=? AND kind='export' AND review_digest=? AND expires_at>unixepoch())
    ON CONFLICT(user_id,period) DO UPDATE SET downloads=downloads+1`).bind(user,data.reviewId,user,data.reviewDigest),
   db.prepare("DELETE FROM account_lifecycle_reviews WHERE id=? AND user_id=? AND kind='export' AND review_digest=? AND expires_at>unixepoch() RETURNING id").bind(data.reviewId,user,data.reviewDigest),
  ]);
 }catch(error){
  if(/CHECK constraint failed/i.test(String(error)))throw new AccountLifecycleError(409,'request_conflict',allowanceMessage);
  throw error;
 }
 if(!consumed[1]?.results?.length)throw new AccountLifecycleError(409,'stale_review','This export review is no longer current. Prepare a new review.');
 const omissions:Omission[]=[
  {section:'credentials',reason:'never-exported'},{section:'safety-restricted',reason:'never-exported'},
  {section:'contacts',reason:'separate-inbox-retention'},{section:'visitor-application-documents',reason:'exported-by-each-visitor'},
 ];
 const files:{path:string;bytes:number;sha256:string}[]=[],generatedAt=new Date().toISOString();
 const readme=`Whumpo account export (whumpo-account-export-v1)\n\nGenerated ${generatedAt} for account ${user} from review ${data.reviewId}.\n\nThis archive is your private copy of the account data listed in manifest.json. It is not a Whumpo backup and cannot be restored or imported. manifest.json is written last; if it is missing, the download was interrupted and is incomplete.\n\nIncluded: account and profile settings, an approved profile photo, plan and standard AI usage, connection status and GitHub backup destinations, the saved Chat transcript, and for each project its details, current saved website specification, saved version list, published directory snapshot, approved photos and staff role list.${stored.visitorData?' You also selected visitor datasets: module records and approved module file uploads, which contain other people\'s submissions and identifiers. Store and share them accordingly.':''}\n\nNever included: passkeys, recovery material, sessions, provider tokens or keys, safety reviews and preserved records, media that is held or not currently approved, internal review envelopes and other accounts' data. manifest.json lists each omission.\n\nData stays with providers you connected (GitHub repositories, Cloudflare zones) and in this download; Whumpo cannot recall copies you keep. Sections are read one after another, so a project changed during the download may show slightly different times between files.\n`;
 const entries=(async function*():AsyncGenerator<[string,Uint8Array]>{
  yield ['README.txt',strToU8(readme)];
  yield* sections(env,user,stored,omissions);
 })();
 let zip:Zip|null=null,cancelled=false;
 const stream=new ReadableStream<Uint8Array>({
  start(controller){
   zip=new Zip((error,chunk,final)=>{if(cancelled)return;if(error){controller.error(error);return;}controller.enqueue(chunk);if(final)controller.close();});
  },
  async pull(controller){
   try{
    const next=await entries.next();
    if(cancelled)return;
    const add=(name:string,bytes:Uint8Array)=>{const file=new ZipPassThrough(name);file.mtime=archiveTime;zip!.add(file);file.push(bytes,true);};
    if(next.done){
     add('manifest.json',json({format:'whumpo-account-export-v1',formatVersion:1,exportReview:data.reviewId,accountId:user,generatedAt,
      scope:{ownerData:true,visitorData:stored.visitorData===true},projects:stored.projects.map(p=>p.id),files,omissions,complete:true}));
     zip!.end();return;
    }
    const [name,bytes]=next.value;
    files.push({path:name,bytes:bytes.length,sha256:await sha256(bytes)});add(name,bytes);
   }catch{if(!cancelled)controller.error(new Error('Account export interrupted. Prepare a fresh export.'));}
  },
  cancel(){cancelled=true;void entries.return(undefined);},
 });
 return new Response(stream,{headers:{'content-type':'application/zip','content-disposition':'attachment; filename="whumpo-account-export.zip"','cache-control':'private, no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox",'referrer-policy':'no-referrer'}});
}
