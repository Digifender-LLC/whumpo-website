import {BackendError} from '../../backend-error';
import {contentPolicyVersion} from '../../content-policy';
import {contentRiskPolicyVersion} from '../../content-risk';
import {previewHeaders,photoConfig} from '../../components';
import {requireSpecificationAvailable} from '../../specification-safety';
import {canonicalJSON,jsonDigest,sha256,shape,SpecificationError} from '../v2/json';
import {compileServiceClientArtifacts,currentServiceClientLock,type ServiceClientSpecification,type ServiceClientTarget} from './compiler';
import {compileOwnedServiceClients} from './owned';
import {inlineSpecificationPhotos} from '../../specification-photos';
const policy=contentPolicyVersion+':'+contentRiskPolicyVersion;
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const digest=/^[0-9a-f]{64}$/;
const changed=()=>new BackendError(409,'These website service settings changed or expired. Ask for a fresh review.');
function id(v:unknown):asserts v is string {if(typeof v!=='string'||!uuid.test(v))throw new BackendError(400,'Choose an owned project, website version or service review.');}
function revision(v:unknown):asserts v is number {if(!Number.isSafeInteger(v)||Number(v)<0)throw new BackendError(400,'Read the current service settings before preparing a change.');}
function safe(e:unknown):never {if(e instanceof BackendError)throw e;if(e instanceof SpecificationError||e instanceof SyntaxError||e instanceof Error&&e.message==='Rendered site too large')throw new BackendError(422,'This website service configuration is not supported.');throw e;}
type Artifact={website_version_id:string;spec_json:string;spec_digest:string;target_json:string;target_digest:string;lock_json:string;manifest_json:string;manifest_digest:string;preview_html:string;preview_digest:string;candidate_html:string;candidate_digest:string};
type Saved=Artifact&{id:string;project_id:string;revision:number;proposal_id:string;created_at:string};
type Proposal=Artifact&{id:string;user_id:string;project_id:string;operation:'prepare'|'restore';expected_revision:number;base_version_id:string|null;base_digest:string|null;restore_version_id:string|null;request_hash:string;proposal_digest:string;diff_json:string;envelope_json:string;policy_version:string;expires_at:string};
type Compiled=Awaited<ReturnType<typeof compileServiceClientArtifacts>>;
async function head(db:D1Database,user:string,project:string){
 id(project);const row=await db.prepare('SELECT p.id project_id,p.name,coalesce(h.revision,0) revision,h.version_id,v.spec_digest FROM projects p LEFT JOIN service_client_heads h ON h.project_id=p.id LEFT JOIN service_client_versions v ON v.id=h.version_id AND v.project_id=p.id WHERE p.id=? AND p.owner_user_id=?').bind(project,user).first<{project_id:string;name:string;revision:number;version_id:string|null;spec_digest:string|null}>();
 if(!row)throw new BackendError(404,'Project not found.');return row;
}
async function holds(db:D1Database,user:string,artifact:Artifact){
 const target=JSON.parse(artifact.target_json) as ServiceClientTarget;
 await requireSpecificationAvailable(db,artifact.website_version_id);
 if(await db.prepare("SELECT 1 FROM content_screening_decisions WHERE user_id=? AND kind='generated_artifact' AND required=1 AND digest IN(?,?,?,?,?,?) LIMIT 1").bind(user,artifact.spec_digest,artifact.manifest_digest,artifact.preview_digest,artifact.candidate_digest,target.website.digest,target.backend?.digest??null).first())throw new BackendError(423,'These website service settings are held for safety review.');
}
function artifact(compiled:Compiled):Artifact {
 const [preview,candidate]=compiled.artifacts;
 return {website_version_id:compiled.target.website.versionId,spec_json:canonicalJSON(compiled.specification,6144),spec_digest:compiled.specificationDigest,target_json:canonicalJSON(compiled.target,4096),target_digest:compiled.targetDigest,lock_json:canonicalJSON(compiled.manifest.lock,4096),manifest_json:canonicalJSON(compiled.manifest,16384),manifest_digest:compiled.manifestDigest,preview_html:preview.html,preview_digest:preview.digest,candidate_html:candidate.html,candidate_digest:candidate.digest};
}
function matches(saved:Artifact,compiled:Compiled){const actual=artifact(compiled);return (Object.keys(actual) as (keyof Artifact)[]).every(key=>saved[key]===actual[key]);}
async function savedVersion(db:D1Database,user:string,project:string,version:string){
 id(version);const row=await db.prepare('SELECT v.* FROM service_client_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=? AND v.project_id=? AND p.owner_user_id=?').bind(version,project,user).first<Saved>();
 if(!row)throw new BackendError(404,'Saved service configuration not found.');
 const site=await db.prepare('SELECT component_id,config_json,html FROM site_versions WHERE id=? AND project_id=?').bind(row.website_version_id,project).first<{component_id:string;config_json:string;html:string}>();
 if(!site)throw changed();
 const target=JSON.parse(row.target_json) as ServiceClientTarget;
 if(target.projectId!==project||target.website.versionId!==row.website_version_id)throw changed();
 const compiled=await compileServiceClientArtifacts(JSON.parse(row.spec_json),target,{componentId:site.component_id,config:JSON.parse(site.config_json),html:site.html},JSON.parse(row.lock_json));
 if(!matches(row,compiled))throw changed();await holds(db,user,row);return row;
}
const compare=(before:Saved|null,next:Compiled)=>({
 website:{before:before?.website_version_id??null,after:next.target.website.versionId},
 configuration:{before:before?JSON.parse(before.spec_json):null,after:next.specification},
 serviceTarget:{before:before?JSON.parse(before.target_json):null,after:next.target},
 requiredReviews:next.requiredReviews
});
function description(q:Proposal){const s=JSON.parse(q.spec_json) as ServiceClientSpecification;return `Website service settings\n${q.operation==='restore'?'Restore these saved service settings as a new private revision':'Save these service settings privately'}?\nContact intake: ${s.contact?'requested':'not requested'}. Website tool: ${s.statelessForm?s.statelessForm.config.title:'not requested'}.\nReview the disabled preview and comparison below. Approval saves private service revision ${q.expected_revision+1}. It does not publish a page, enable or disable a service, run code, or change visitor data. Website publication, contact intake and website-tool activation keep their separate reviews.\nExpires: ${q.expires_at}`;}
function link(db:D1Database,user:string,turn:string,review:string,hash:string){return db.prepare('INSERT INTO service_client_chat_links(turn_id,proposal_id,reply_digest) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=?)').bind(turn,review,hash,turn,user);}
function envelope(q:Omit<Proposal,'envelope_json'|'proposal_digest'>,diffDigest:string){return {id:q.id,projectId:q.project_id,operation:q.operation,expectedRevision:q.expected_revision,baseVersionId:q.base_version_id,baseDigest:q.base_digest,restoreVersionId:q.restore_version_id,websiteVersionId:q.website_version_id,specificationDigest:q.spec_digest,targetDigest:q.target_digest,manifestDigest:q.manifest_digest,diffDigest,policyVersion:q.policy_version,expiresAt:q.expires_at};}
/** Returns statements for the existing AI result transaction; no side effects while interpreting. */
export async function prepareServiceClients(db:D1Database,user:string,turn:string,request:Record<string,unknown>){
 try{
  const operation=request.operation;shape(request,operation==='prepare'?['kind','operation','projectId','websiteVersionId','expectedRevision','configuration']:['kind','operation','projectId','expectedRevision','versionId']);
  if(request.kind!=='serviceClients'||!['prepare','restore'].includes(String(operation)))throw new BackendError(400,'Choose a supported service configuration operation.');
  id(turn);id(request.projectId);revision(request.expectedRevision);const current=await head(db,user,request.projectId),requestHash=await jsonDigest(request,8192);
  const old=await db.prepare('SELECT * FROM service_client_proposals WHERE id=? AND user_id=?').bind(turn,user).first<Proposal>();
  if(old){if(old.request_hash!==requestHash)throw changed();return {reply:description(old),statements:[] as D1PreparedStatement[]};}
  if(current.revision!==request.expectedRevision)throw changed();
  const before=current.version_id?await savedVersion(db,user,current.project_id,current.version_id):null;
  let compiled:Compiled,restored:string|null=null;
  if(operation==='prepare'){id(request.websiteVersionId);compiled=await compileOwnedServiceClients(db,user,current.project_id,request.websiteVersionId,request.configuration,currentServiceClientLock());}
  else {
   id(request.versionId);restored=request.versionId;const previous=await savedVersion(db,user,current.project_id,restored);
   compiled=await compileOwnedServiceClients(db,user,current.project_id,previous.website_version_id,JSON.parse(previous.spec_json),JSON.parse(previous.lock_json));
   const priorTarget=JSON.parse(previous.target_json) as ServiceClientTarget;
   if(compiled.specification.statelessForm&&(compiled.target.backend?.versionId!==priorTarget.backend?.versionId||compiled.target.backend?.digest!==priorTarget.backend?.digest))throw new BackendError(409,'The saved form uses a different backend version. Review that endpoint separately before restoring its form settings.');
  }
  const data=artifact(compiled);await holds(db,user,data);const diff=compare(before,compiled);
  const row={...data,id:turn,user_id:user,project_id:current.project_id,operation:operation as Proposal['operation'],expected_revision:current.revision,base_version_id:current.version_id,base_digest:current.spec_digest,restore_version_id:restored,request_hash:requestHash,diff_json:canonicalJSON(diff,16384),policy_version:policy,expires_at:new Date(Date.now()+600000).toISOString()};
  const body=envelope(row,await jsonDigest(diff,16384));const q:Proposal={...row,envelope_json:canonicalJSON(body,16384),proposal_digest:await jsonDigest(body,16384)};
  const keys=Object.keys(q) as (keyof Proposal)[],reply=description(q);
  return {reply,statements:[db.prepare("DELETE FROM service_client_proposals WHERE expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND (project_id=? OR id IN(SELECT id FROM service_client_proposals WHERE expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') ORDER BY expires_at LIMIT 100))").bind(current.project_id),db.prepare(`INSERT INTO service_client_proposals(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).bind(...keys.map(key=>q[key])),link(db,user,turn,turn,await sha256(reply))]};
 }catch(e){return safe(e);}
}
export async function readServiceClientProposal(db:D1Database,user:string,review:string){
 try{
  id(review);const q=await db.prepare('SELECT q.* FROM service_client_proposals q JOIN projects p ON p.id=q.project_id AND p.owner_user_id=q.user_id WHERE q.id=? AND q.user_id=?').bind(review,user).first<Proposal>();
  if(!q)throw new BackendError(404,'Service configuration review not found.');
  if(q.policy_version!==policy||q.expires_at<=new Date().toISOString())throw changed();
  await holds(db,user,q);
  const current=await head(db,user,q.project_id);if(current.revision!==q.expected_revision||current.version_id!==q.base_version_id||current.spec_digest!==q.base_digest)throw changed();
  if(q.base_version_id)await savedVersion(db,user,q.project_id,q.base_version_id);
  if(q.restore_version_id)await savedVersion(db,user,q.project_id,q.restore_version_id);
  const compiled=await compileOwnedServiceClients(db,user,q.project_id,q.website_version_id,JSON.parse(q.spec_json),JSON.parse(q.lock_json));
  if(!matches(q,compiled))throw changed();
  const expected=envelope(q,await jsonDigest(JSON.parse(q.diff_json),16384));
  if(canonicalJSON(expected,16384)!==q.envelope_json||await jsonDigest(expected,16384)!==q.proposal_digest||!await db.prepare('SELECT id FROM service_client_valid_proposals WHERE id=?').bind(q.id).first())throw changed();
  return q;
 }catch(e){return safe(e);}
}
export async function applyServiceClientsCommand(db:D1Database,user:string,turn:string,command:string){
 if(!command.startsWith('/confirm-service-clients '))return;
 const [_,review,hash,revisionText,...extra]=command.split(/\s+/);
 if(extra.length||!uuid.test(review??'')||!digest.test(hash??'')||!/^\d{1,15}$/.test(revisionText??''))throw new BackendError(400,'Choose the exact saved service settings review.');
 const expectedRevision=Number(revisionText),requestHash=await jsonDigest({reviewId:review,proposalDigest:hash,expectedRevision});
 const receipt=await db.prepare('SELECT a.request_hash FROM service_client_applies a JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.user_id WHERE a.proposal_id=? AND a.user_id=?').bind(review,user).first<{request_hash:string}>();
 if(receipt){if(receipt.request_hash!==requestHash)throw changed();return {reply:'These service settings were already saved. Read the project’s service history for their current availability.',statements:[] as D1PreparedStatement[]};}
 const q=await readServiceClientProposal(db,user,review);if(q.proposal_digest!==hash||q.expected_revision!==expectedRevision)throw changed();
 const fields=['website_version_id','spec_json','spec_digest','target_json','target_digest','lock_json','manifest_json','manifest_digest','preview_html','preview_digest','candidate_html','candidate_digest'];
 return {reply:`Saved private service settings revision ${expectedRevision+1}. Your website and services have not been activated or changed. Their separate publication and activation reviews are still required.`,statements:[
  db.prepare(`INSERT INTO service_client_versions(id,project_id,revision,proposal_id,${fields.join(',')}) SELECT ?,project_id,expected_revision+1,id,${fields.join(',')} FROM service_client_proposals WHERE id=? AND user_id=? AND EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=?)`).bind(turn,review,user,turn,user),
  // Missing proposal after preflight must abort, not commit a success-only chat turn.
  db.prepare('INSERT INTO service_client_applies(id,user_id,project_id,proposal_id,proposal_digest,request_hash,version_id,revision) SELECT ?,?,?,?,?,?,?,? FROM chat_turns WHERE id=? AND user_id=?').bind(turn,user,q.project_id,review,hash,requestHash,turn,expectedRevision+1,turn,user)
 ]};
}
export async function readServiceClients(db:D1Database,user:string,project:string){
 try{
  const current=await head(db,user,project),saved=current.version_id?await savedVersion(db,user,project,current.version_id):null;
  const versions=await db.prepare('SELECT v.id,v.revision,v.website_version_id,v.created_at FROM service_client_versions v WHERE v.project_id=? ORDER BY v.revision DESC LIMIT 25').bind(project).all();
  return {projectId:project,revision:current.revision,versionId:current.version_id,websiteVersionId:saved?.website_version_id??null,configuration:saved?JSON.parse(saved.spec_json):null,versions:versions.results};
 }catch(e){return safe(e);}
}
export async function serviceClientAction(db:D1Database,user:string,turn:string,request:Record<string,unknown>){
 try{
  if(request.operation==='read'){
   shape(request,['kind','operation','projectId']);id(request.projectId);const data=await readServiceClients(db,user,request.projectId);
   return {reply:data.versionId?`Saved website service settings revision ${data.revision}. Saving does not activate services.`:'No saved service settings yet. Select an owned website version and prepare its desired contact or website-tool settings.',inspection:JSON.stringify({type:'website_service_settings',projectId:data.projectId,revision:data.revision,versionId:data.versionId,websiteVersionId:data.websiteVersionId,configuration:data.configuration}),statements:[] as D1PreparedStatement[]};
  }
  if(request.operation==='history'){shape(request,['kind','operation','projectId']);id(request.projectId);const data=await readServiceClients(db,user,request.projectId);return {reply:data.versions.length?`Saved service settings: ${data.versions.map(v=>'revision '+v.revision).join(', ')}. Ask to inspect or restore one as a new private revision.`:'No saved service settings yet.',inspection:JSON.stringify({type:'website_service_history',projectId:data.projectId,revision:data.revision,versions:data.versions}),statements:[] as D1PreparedStatement[]};}
  if(request.operation==='review'){shape(request,['kind','operation','reviewId']);id(request.reviewId);const q=await readServiceClientProposal(db,user,request.reviewId),reply=description(q);return {reply,statements:[link(db,user,turn,q.id,await sha256(reply))]};}
  return await prepareServiceClients(db,user,turn,request);
 }catch(e){return safe(e);}
}
export async function serviceClientChatLinks(db:D1Database,user:string,turns:Record<string,unknown>[]){
 const {results:saved}=await db.prepare('SELECT a.id,v.id version_id FROM service_client_applies a JOIN service_client_versions v ON v.id=a.version_id AND v.project_id=a.project_id JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.user_id WHERE a.user_id=? AND NOT EXISTS(SELECT 1 FROM service_client_held WHERE id=v.id) ORDER BY a.revision DESC LIMIT 100').bind(user).all<{id:string;version_id:string}>();
 for(const row of saved){const turn=turns.find(t=>t.id===row.id);if(turn?.status==='completed')turn.service_client_version_id=row.version_id;}

 const {results}=await db.prepare('SELECT l.turn_id,l.proposal_id,l.reply_digest FROM service_client_chat_links l JOIN chat_turns t ON t.id=l.turn_id WHERE t.user_id=? ORDER BY t.revision DESC LIMIT 100').bind(user).all<{turn_id:string;proposal_id:string;reply_digest:string}>();
 for(const row of results){const turn=turns.find(t=>t.id===row.turn_id);if(!turn||turn.status!=='completed'||typeof turn.assistant_text!=='string'||await sha256(turn.assistant_text)!==row.reply_digest)continue;try{const q=await readServiceClientProposal(db,user,row.proposal_id);turn.service_client_review={id:q.id,proposalDigest:q.proposal_digest,expectedRevision:q.expected_revision};}catch(e){if(!(e instanceof BackendError))throw e;}}
}
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
async function previewPhotos(db:D1Database,user:string,version:string,html:string,files?:R2Bucket){
 const row=await db.prepare('SELECT v.project_id,v.component_id,v.config_json FROM site_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=? AND p.owner_user_id=?').bind(version,user).first<{project_id:string;component_id:string;config_json:string}>();
 if(!row)throw new BackendError(404,'Saved website not found.');
 return inlineSpecificationPhotos(db,files,user,row.project_id,html,row.component_id==='photo-page@1'?photoConfig(JSON.parse(row.config_json)).photos:[]);
}
const photoPreviewHeaders={...previewHeaders,'content-security-policy':previewHeaders['content-security-policy']+'; img-src data:'};
export async function serviceClientPreview(db:D1Database,user:string,review:string,comparison=false,files?:R2Bucket){
 const q=await readServiceClientProposal(db,user,review);if(!comparison)return new Response(await previewPhotos(db,user,q.website_version_id,q.preview_html,files),{headers:photoPreviewHeaders});
 const diff=JSON.parse(q.diff_json),s=JSON.parse(q.spec_json) as ServiceClientSpecification;
 const describe=(v:ServiceClientSpecification|null)=>{
  if(!v)return 'No saved service settings';const form=v.statelessForm?.config;
  const lines=[`Contact intake: ${v.contact?'requested':'not requested'}`,`Website tool: ${form?.title??'not requested'}`];
  if(form){if(form.description)lines.push(form.description);lines.push(`Button: ${form.buttonLabel}`,'Fields:');for(const field of form.fields)lines.push(`• ${field.label}: ${field.type==='boolean'?'yes/no':field.type}${field.type==='text'&&field.optional?' (optional)':''}${field.type==='choice'?' — '+field.options.map(option=>option.label).join(', '):''}`);}
  return lines.join('\n');
 };
 const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Review website services · Whumpo</title><style>body{margin:0;font:16px/1.6 system-ui;color:#0f2d5b;background:#f8fafc}main{max-width:850px;margin:auto;padding:24px}section{background:white;padding:20px;border:1px solid #dae5f0;border-radius:16px;margin:16px 0}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:600}</style><main><h1>Review website service settings</h1><p>This saves a private configuration. It does not change your live page, collect messages or activate a website tool. Return to Chat to approve.</p><section><h2>Before</h2><pre>${escape(describe(diff.configuration.before))}</pre></section><section><h2>After</h2><pre>${escape(describe(s))}</pre></section><section><p>Changed website or service settings require a fresh review. Restoring settings cannot restore a removed service or change which backend runs a saved form.</p><details><summary>Technical details</summary><pre>${escape(JSON.stringify({configuration:diff.configuration,website:diff.website,serviceTarget:diff.serviceTarget},null,2))}</pre></details></section></main></html>`;
 return new Response(html,{headers:previewHeaders});
}
export async function savedServiceClientPreview(db:D1Database,user:string,version:string,files?:R2Bucket){
 try{id(version);const row=await db.prepare('SELECT v.project_id FROM service_client_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=? AND p.owner_user_id=?').bind(version,user).first<{project_id:string}>();if(!row)throw new BackendError(404,'Saved service configuration not found.');const saved=await savedVersion(db,user,row.project_id,version);return new Response(await previewPhotos(db,user,saved.website_version_id,saved.preview_html,files),{headers:photoPreviewHeaders});}catch(e){return safe(e);}
}
// Shared owned reads for the separate activation handoff; never permission to activate.
export {savedVersion as readSavedServiceClientVersion,head as readServiceClientHead};
