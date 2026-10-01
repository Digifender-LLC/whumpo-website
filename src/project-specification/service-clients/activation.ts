import {BackendError} from '../../backend-error';
import {contentPolicyVersion} from '../../content-policy';
import {contentRiskPolicyVersion} from '../../content-risk';
import {previewHeaders} from '../../components';
import {canonicalJSON,jsonDigest,sha256,shape,SpecificationError} from '../v2/json';
import {compileOwnedServiceClients} from './owned';
import type {ServiceClientSpecification,ServiceClientTarget} from './compiler';
import {readSavedServiceClientVersion,readServiceClientHead} from './store';
const policy=contentPolicyVersion+':'+contentRiskPolicyVersion;
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const changed=()=>new BackendError(409,'The saved settings or live services changed. Ask for a fresh activation review.');
function id(value:unknown):asserts value is string {if(typeof value!=='string'||!uuid.test(value))throw new BackendError(400,'Choose an owned saved settings version or review.');}
function safe(error:unknown):never {if(error instanceof BackendError)throw error;if(error instanceof SpecificationError||error instanceof SyntaxError)throw new BackendError(422,'These service settings are no longer supported.');throw error;}
type Service='contact'|'statelessForm';
type Review={id:string;user_id:string;project_id:string;version_id:string;version_revision:number;spec_digest:string;service:Service;enabled:number;request_hash:string;target_json:string;target_digest:string;manifest_digest:string;preview_digest:string;candidate_digest:string;policy_version:string;expires_at:string;status:string};
async function snapshot(db:D1Database,user:string,project:string,version:string){
 const head=await readServiceClientHead(db,user,project);if(head.version_id!==version)throw new BackendError(409,'Restore those settings as a new private revision before preparing activation.');
 const saved=await readSavedServiceClientVersion(db,user,project,version),compiled=await compileOwnedServiceClients(db,user,project,saved.website_version_id,JSON.parse(saved.spec_json),JSON.parse(saved.lock_json));
 const prior=JSON.parse(saved.target_json) as ServiceClientTarget;
 if(compiled.specification.statelessForm&&(compiled.target.backend?.versionId!==prior.backend?.versionId||compiled.target.backend?.digest!==prior.backend?.digest))throw new BackendError(409,'The saved form belongs to a different backend. Prepare and save settings for the newly reviewed backend first.');
 return {saved,compiled};
}
function description(row:Review,spec?:ServiceClientSpecification){
 if(row.status==='applied')return `This ${row.service==='contact'?'contact':'website-tool'} review was already applied. It is a historical receipt; read the current project status before claiming the service is live.`;
 const form=spec?.statelessForm?.config;
 const effect=row.service==='contact'?(row.enabled?'Enable contact intake for this website. Visitors can send their name, email and message to your private inbox. Messages are retained for 30 days; no email or AI processing is involved.':'Stop new contact submissions. Existing messages remain private until their normal expiry.'):(row.enabled?`Show “${form!.title}” on this website.\n${form!.description}\nButton: ${form!.buttonLabel}\nFields: ${form!.fields.map(f=>f.label+' ('+(f.type==='boolean'?'yes/no':f.type)+')').join(', ')}\nInputs go only to the separately reviewed stateless function. The gateway does not retain inputs/results; existing daily limits apply.`:'Hide the website tool. Its separately published backend remains available until you review taking that endpoint offline.');
 return `Review ${row.service==='contact'?'contact intake':'website tool'}\nSaved settings revision ${row.version_revision}\n${effect}\n\nThis approval changes only the named service. Publishing/restoring a website or replacing its backend requires fresh service reviews. Static exports exclude these hosted services.\nReview the private comparison before approving. Expires: ${row.expires_at}`;
}
async function ownedReview(db:D1Database,user:string,review:string){id(review);const row=await db.prepare('SELECT a.*,s.status FROM service_client_activation_reviews a JOIN service_client_activation_state s ON s.id=a.id JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.user_id WHERE a.id=? AND a.user_id=?').bind(review,user).first<Review>();if(!row)throw new BackendError(404,'Service activation review not found.');return row;}
async function ready(db:D1Database,user:string,row:Review){
 if(row.status!=='pending'||row.policy_version!==policy||row.expires_at<=new Date().toISOString())throw changed();
 const result=await snapshot(db,user,row.project_id,row.version_id),{compiled,saved}=result;
 if(saved.revision!==row.version_revision||saved.spec_digest!==row.spec_digest||canonicalJSON(compiled.target,4096)!==row.target_json||compiled.targetDigest!==row.target_digest||compiled.manifestDigest!==row.manifest_digest||compiled.artifacts[0].digest!==row.preview_digest||compiled.artifacts[1].digest!==row.candidate_digest)throw changed();
 if(await db.prepare('SELECT id FROM service_client_activation_held WHERE id=?').bind(row.id).first())throw new BackendError(423,'These service settings are held for safety review.');
 if(!await db.prepare('SELECT id FROM service_client_activation_valid WHERE id=?').bind(row.id).first())throw changed();return result;
}
/** Additional checks only for linked reviews. Ordinary critical disable reviews keep their own guards. */
export async function requireServiceClientActivation(db:D1Database,user:string,service:Service,review:string){
 try{const linked=await db.prepare('SELECT service FROM service_client_activation_reviews WHERE id=?').bind(review).first<{service:Service}>();if(!linked)return;if(linked.service!==service)throw changed();const row=await ownedReview(db,user,review);if(row.status==='applied')return;await ready(db,user,row);}catch(error){return safe(error);}
}
function link(db:D1Database,user:string,turn:string,review:string,hash:string){return db.prepare('INSERT INTO service_client_activation_links(turn_id,review_id,reply_digest) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=?)').bind(turn,review,hash,turn,user);}
export async function prepareServiceClientActivation(db:D1Database,user:string,turn:string,request:Record<string,unknown>){
 try{
  shape(request,['kind','operation','projectId','versionId','service']);if(request.kind!=='serviceClients'||request.operation!=='reviewActivation'||!['contact','statelessForm'].includes(String(request.service)))throw new BackendError(400,'Choose one service to review.');id(turn);id(request.projectId);id(request.versionId);
  const requestHash=await jsonDigest(request),old=await db.prepare('SELECT id,request_hash FROM service_client_activation_reviews WHERE id=? AND user_id=?').bind(turn,user).first<{id:string;request_hash:string}>();
  if(old){if(old.request_hash!==requestHash)throw changed();const row=await ownedReview(db,user,turn),result=row.status==='pending'?await ready(db,user,row):null;return {reply:description(row,result?.compiled.specification),statements:[] as D1PreparedStatement[]};}
  const {saved,compiled}=await snapshot(db,user,request.projectId,request.versionId),service=request.service as Service,enabled=compiled.specification[service]?1:0;
  if(enabled&&compiled.target.publication.versionId!==saved.website_version_id)throw new BackendError(409,'Publish the website version named in these saved settings before preparing its service activation.');
  const row:Review={id:turn,user_id:user,project_id:request.projectId,version_id:request.versionId,version_revision:saved.revision,spec_digest:saved.spec_digest,service,enabled,request_hash:requestHash,target_json:canonicalJSON(compiled.target,4096),target_digest:compiled.targetDigest,manifest_digest:compiled.manifestDigest,preview_digest:compiled.artifacts[0].digest,candidate_digest:compiled.artifacts[1].digest,policy_version:policy,expires_at:new Date(Date.now()+600000).toISOString(),status:'pending'};
  const {status,...values}=row,keys=Object.keys(values) as (keyof typeof values)[],target=compiled.target,reply=description(row,compiled.specification);
  const statements=service==='contact'?[
   db.prepare('INSERT OR IGNORE INTO contact_settings(project_id) SELECT ? WHERE EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=?)').bind(row.project_id,turn,user),
   db.prepare('INSERT INTO contact_reviews(id,user_id,project_id,enabled,expected_revision,publication_revision,expires_at) VALUES(?,?,?,?,?,?,?)').bind(turn,user,row.project_id,enabled,target.contact.revision,target.publication.versionId?target.publication.revision:-1,row.expires_at)
  ]:[
   db.prepare('INSERT OR IGNORE INTO backend_form_settings(project_id) SELECT ? WHERE EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=?)').bind(row.project_id,turn,user),
   db.prepare('INSERT INTO backend_form_reviews(id,user_id,project_id,enabled,config_json,site_revision,backend_publication_id,base_revision,expires_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(turn,user,row.project_id,enabled,enabled?canonicalJSON(compiled.specification.statelessForm!.config,4096):null,enabled?target.publication.revision:-1,enabled?target.backend!.reviewId:null,target.form.revision,row.expires_at)
  ];
  return {reply,statements:[...statements,db.prepare(`INSERT INTO service_client_activation_reviews(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).bind(...keys.map(key=>values[key])),link(db,user,turn,turn,await sha256(reply))]};
 }catch(error){return safe(error);}
}
export async function serviceClientActivationAction(db:D1Database,user:string,turn:string,request:Record<string,unknown>){
 try{
  if(request.operation==='reviewActivation')return await prepareServiceClientActivation(db,user,turn,request);
  if(request.operation==='activations'){
   shape(request,['kind','operation','projectId']);id(request.projectId);await readServiceClientHead(db,user,request.projectId);
   const {results}=await db.prepare('SELECT a.id,a.version_id,a.version_revision,a.service,a.enabled,a.expires_at,s.status FROM service_client_activation_reviews a JOIN service_client_activation_state s ON s.id=a.id WHERE a.project_id=? AND a.user_id=? ORDER BY a.created_at DESC,a.id DESC LIMIT 20').bind(request.projectId,user).all();
   return {reply:results.length?'Found saved service reviews. Ask to inspect one before continuing.':'No service activation reviews yet.',inspection:JSON.stringify({type:'website_service_reviews',projectId:request.projectId,reviews:results}),statements:[] as D1PreparedStatement[]};
  }
  shape(request,['kind','operation','reviewId']);if(request.operation!=='activationReview')throw new BackendError(400,'Choose a supported service review operation.');id(request.reviewId);const row=await ownedReview(db,user,request.reviewId),result=row.status==='pending'?await ready(db,user,row):null,reply=description(row,result?.compiled.specification);
  return {reply,statements:row.status==='pending'?[link(db,user,turn,row.id,await sha256(reply))]:[] as D1PreparedStatement[]};
 }catch(error){return safe(error);}
}
export async function serviceClientActivationChatLinks(db:D1Database,user:string,turns:Record<string,unknown>[]){
 const cache=new Map<string,Promise<Review|null>>();const available=(review:string)=>{if(!cache.has(review))cache.set(review,(async()=>{try{const row=await ownedReview(db,user,review);await ready(db,user,row);return row;}catch(error){if(error instanceof BackendError||error instanceof SpecificationError)return null;throw error;}})());return cache.get(review)!;};
 const {results:linked}=await db.prepare('SELECT id FROM service_client_activation_reviews WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 100').bind(user).all<{id:string}>();
 // Do not attach stale companion approval metadata to a reopened underlying review.
 for(const turn of turns)for(const key of ['contact_confirmation_id','backend_form_confirmation_id'])if(typeof turn[key]==='string'&&linked.some(r=>r.id===turn[key])&&!await available(String(turn[key])))delete turn[key];
 const {results}=await db.prepare('SELECT l.turn_id,l.review_id,l.reply_digest FROM service_client_activation_links l JOIN chat_turns t ON t.id=l.turn_id WHERE t.user_id=? ORDER BY t.revision DESC LIMIT 100').bind(user).all<{turn_id:string;review_id:string;reply_digest:string}>();
 for(const row of results){const turn=turns.find(t=>t.id===row.turn_id);if(!turn||turn.status!=='completed'||typeof turn.assistant_text!=='string'||await sha256(turn.assistant_text)!==row.reply_digest)continue;const review=await available(row.review_id);if(review){delete turn.contact_confirmation_id;delete turn.backend_form_confirmation_id;turn.service_client_activation={id:review.id,service:review.service,enabled:review.enabled===1};}}
}
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export async function serviceClientActivationPreview(db:D1Database,user:string,review:string,comparison=false){
 try{const row=await ownedReview(db,user,review),{compiled,saved}=await ready(db,user,row);if(!comparison)return new Response(compiled.artifacts[0].html,{headers:previewHeaders});
  const current=row.service==='contact'?compiled.target.contact.active:compiled.target.form.active;
  const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Review service activation · Whumpo</title><style>body{margin:0;font:16px/1.6 system-ui;color:#0f2d5b;background:#f8fafc}main{max-width:850px;margin:auto;padding:24px}section{background:white;padding:20px;border:1px solid #dae5f0;border-radius:16px;margin:16px 0}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font-weight:600}</style><main><h1>Review ${row.service==='contact'?'contact intake':'website tool'}</h1><section><h2>Before</h2><p>${current?'Available':'Unavailable'} on the current website.</p></section><section><h2>Requested change</h2><pre>${escape(description(row,compiled.specification))}</pre></section><details><summary>Technical details</summary><pre>${escape(JSON.stringify({reviewId:row.id,savedVersionId:saved.id,savedRevision:saved.revision,configuration:compiled.specification,target:compiled.target,manifestDigest:compiled.manifestDigest},null,2))}</pre></details><p>Return to Chat for the separate approval. This preview cannot submit data or run code.</p></main></html>`;
  return new Response(html,{headers:previewHeaders});
 }catch(error){return safe(error);}
}
export async function serviceClientActivationReceipt(db:D1Database,user:string,review:string){
 const row=await db.prepare("SELECT a.service,a.enabled FROM service_client_activation_reviews a JOIN service_client_activation_state s ON s.id=a.id JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.user_id WHERE a.id=? AND a.user_id=? AND s.status='applied'").bind(review,user).first<{service:Service;enabled:number}>();
 return row?`Applied the reviewed ${row.service==='contact'?'contact intake':'website tool'} ${row.enabled?'enablement':'disablement'}. This is a saved receipt; later website or backend changes can make the service unavailable. Ask for the current status before making further changes.`:undefined;
}
