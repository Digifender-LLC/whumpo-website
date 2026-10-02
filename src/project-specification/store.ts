import {BackendError} from '../backend-error';
import {previewHeaders,type SiteConfig,type PhotoConfig} from '../components';
import {contentPolicyVersion} from '../content-policy';
import {contentRiskPolicyVersion} from '../content-risk';
import {requireSpecificationAvailable} from '../specification-safety';
import {compileProjectSpecification,compileSpecificationChange,currentCompilerLock,compileNewWebsite} from './compiler';
import {canonicalJSON,jsonDigest,sha256,shape,SpecificationError} from './v2/json';
import {projectPage} from './v2/schema';
import {requireSpecificationPhotos,inlineSpecificationPhotos} from '../specification-photos';
import {assertFeature} from '../feature-admission';
import {readSpecificationReviewDisplay} from './review-display';

const policy=contentPolicyVersion+':'+contentRiskPolicyVersion;
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const digest=/^[0-9a-f]{64}$/;
const changed=()=>new BackendError(409,'This website review changed or expired. Ask for a fresh review.');
function id(value:unknown):asserts value is string {if(typeof value!=='string'||!uuid.test(value))throw new BackendError(400,'Choose an owned project, version or review.');}
function revision(value:unknown):asserts value is number {if(!Number.isSafeInteger(value)||Number(value)<0)throw new BackendError(400,'Read the current website revision before proposing a change.');}
function safe(error:unknown):never {if(error instanceof BackendError)throw error;if(error instanceof SpecificationError||error instanceof Error&&error.message==='Rendered site too large')throw new BackendError(422,'This website configuration is not supported. Ask for a smaller compatible change.');throw error;}
type Head={project_id:string;name:string;draft_revision:number;revision:number;version_id:string|null;head_draft_revision:number|null;spec_json:string|null;spec_digest:string|null;lock_json:string|null};
type Site={id:string;project_id:string;component_id:string;config_json:string;html:string;digest:string};
type Proposal={id:string;user_id:string;project_id:string;operation:'change'|'restore';expected_revision:number;draft_revision:number;base_version_id:string|null;target_version_id:string|null;base_digest:string|null;request_hash:string;proposal_digest:string;spec_digest:string;manifest_digest:string;policy_version:string;expires_at:string;spec_json:string;lock_json:string;manifest_json:string;config_json:string;html:string;html_digest:string;diff_json:string;envelope_json:string};
type Receipt={id:string;project_id:string;proposal_id:string;proposal_digest:string;request_hash:string;version_id:string;revision:number};
async function head(db:D1Database,user:string,project:string){
 id(project);
 const row=await db.prepare(`SELECT p.id project_id,p.name,p.site_draft_revision draft_revision,coalesce(h.revision,0) revision,h.version_id,h.draft_revision head_draft_revision,v.spec_json,v.spec_digest,v.lock_json FROM projects p LEFT JOIN project_spec_heads h ON h.project_id=p.id LEFT JOIN project_spec_versions v ON v.version_id=h.version_id AND v.project_id=p.id WHERE p.id=? AND p.owner_user_id=?`).bind(project,user).first<Head>();
 if(!row)throw new BackendError(404,'Project not found.');return row;
}
async function site(db:D1Database,user:string,project:string,version:string){
 id(version);const row=await db.prepare('SELECT v.id,v.project_id,v.component_id,v.config_json,v.html,v.digest FROM site_versions v JOIN projects p ON p.id=v.project_id WHERE v.id=? AND v.project_id=? AND p.owner_user_id=?').bind(version,project,user).first<Site>();
 if(!row)throw new BackendError(404,'Saved website version not found.');return row;
}
export async function readSpecification(db:D1Database,user:string,project:string){
 const current=await head(db,user,project);
 if(current.version_id)await requireSpecificationAvailable(db,current.version_id);
 const versions=await db.prepare('SELECT v.version_id,v.revision,v.spec_digest,s.created_at FROM project_spec_versions v JOIN site_versions s ON s.id=v.version_id WHERE v.project_id=? ORDER BY v.revision DESC LIMIT 25').bind(project).all();
 return {projectId:project,revision:current.revision,versionId:current.version_id,otherDraftChanges:current.head_draft_revision!==null&&current.head_draft_revision!==current.draft_revision,specification:current.spec_json?JSON.parse(current.spec_json):null,versions:versions.results};
}
async function held(db:D1Database,user:string,hashes:string[]){
 if(await db.prepare("SELECT 1 FROM content_screening_decisions WHERE user_id=? AND kind='generated_artifact' AND required=1 AND digest IN(?,?,?) LIMIT 1").bind(user,...hashes).first())throw new BackendError(423,'This website content is held for safety review.');
}
function home(compiled:Awaited<ReturnType<typeof compileProjectSpecification>>){
 if(compiled.artifacts.length!==1||compiled.artifacts[0].path!=='/')throw new BackendError(422,'This saved-version adapter supports one website homepage. Additional routes need their own delivery adapter.');
 const {photos,...text}=projectPage(compiled.specification,compiled.artifacts[0].pageId);
 return {artifact:compiled.artifacts[0],config:photos.length?{...text,photos}:text,photos};
}
function fieldDiff(before:SiteConfig|PhotoConfig|null,after:SiteConfig|PhotoConfig){
 const fields=(c:SiteConfig|PhotoConfig|null)=>c?Object.fromEntries([['Site name',c.name],['Headline',c.headline],['Introduction',c.description],['Theme',c.theme],['About heading',c.aboutTitle],['About text',c.aboutText],['Photos','photos' in c?JSON.stringify(c.photos):'[]'],...c.sections.flatMap((s,i)=>[[`Section ${i+1} heading`,s.heading],[`Section ${i+1} text`,s.text]])]):{};
 const a=fields(before),b=fields(after);return [...new Set([...Object.keys(a),...Object.keys(b)])].filter(key=>a[key]!==b[key]).map(label=>({label,before:a[label]??null,after:b[label]??null}));
}
const description=(q:Pick<Proposal,'operation'|'expected_revision'|'expires_at'|'config_json'|'diff_json'>)=>{
 const name=(JSON.parse(q.config_json) as SiteConfig).name,fields=(JSON.parse(q.diff_json) as {label:string}[]).map(row=>row.label);
 return `Website changes for “${name}”\n${q.operation==='restore'?'Restore this saved website configuration':'Save these website changes'}?\n${fields.length?'Changed fields: '+fields.join(', '):'The website text and theme stay the same.'}\nReview the private preview and full comparison below. Approval creates a new private saved version at revision ${q.expected_revision+1}. Publishing requires its own review.\nThis does not change visitor data, permissions, connections or your live website.\nReview expires: ${q.expires_at}`;
};
function link(db:D1Database,user:string,turn:string,review:string,hash:string){return db.prepare('INSERT INTO project_spec_chat_links(turn_id,proposal_id,reply_digest) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=?)').bind(turn,review,hash,turn,user);}

/** Saves a first private website and its current specification in the same Chat transaction.
 * A project may be created earlier in that transaction; DB guards enforce ownership and first-only admission. */
export async function createWebsite(db:D1Database,user:string,turn:string,project:string,input:unknown){
 try{
  id(turn);id(project);
  if(await db.prepare('SELECT id FROM site_versions WHERE project_id=? LIMIT 1').bind(project).first())throw new BackendError(409,'This project already has a website. Read its specification and prepare a change review.');
  const compiled=await compileNewWebsite(input),{artifact,config,photos}=home(compiled),now=new Date().toISOString();
  await requireSpecificationPhotos(db,user,project,photos);
  await held(db,user,[compiled.specificationDigest,compiled.manifestDigest,artifact.digest]);
  const requestHash=await jsonDigest({kind:'website.create',projectId:project,config:input});
  return {reply:`Saved the first private website for “${config.name}”. Open the preview below, then tell me what to change. Publishing requires a separate review.`,statements:[
   db.prepare("INSERT INTO site_versions(id,project_id,component_id,config_json,html,digest,created_at,source) SELECT ?,?,?,?,?,?,?,'ai' FROM chat_turns t JOIN projects p ON p.id=? AND p.owner_user_id=t.user_id WHERE t.id=? AND t.user_id=? AND t.mode='ai' AND t.status='pending' AND t.action_json IS NULL").bind(turn,project,artifact.component,canonicalJSON(config),artifact.html,artifact.digest,now,project,turn,user),
   ...photos.map((photo,n)=>db.prepare('INSERT INTO version_photos(version_id,file_id,position,alt) VALUES(?,?,?,?)').bind(turn,photo.id,n,photo.alt)),
   db.prepare('INSERT INTO project_spec_versions(version_id,project_id,revision,proposal_id,spec_json,spec_digest,lock_json,manifest_json,manifest_digest) VALUES(?,?,1,?,?,?,?,?,?)').bind(turn,project,turn,canonicalJSON(compiled.specification),compiled.specificationDigest,canonicalJSON(compiled.manifest.lock),canonicalJSON(compiled.manifest),compiled.manifestDigest),
   db.prepare('INSERT INTO project_spec_creations(id,user_id,project_id,request_hash,version_id) VALUES(?,?,?,?,?)').bind(turn,user,project,requestHash,turn)
  ]};
 }catch(error){return safe(error);}
}

/** Preparation returns statements for the existing atomic AI-result transaction. */
export async function prepareSpecification(db:D1Database,user:string,turn:string,request:Record<string,unknown>){
 try{
  const operation=request.operation;
  shape(request,operation==='change'?['kind','operation','projectId','expectedRevision','operations']:['kind','operation','projectId','expectedRevision','versionId']);
  if(request.kind!=='specification'||!['change','restore'].includes(String(operation)))throw new BackendError(400,'Choose a supported website configuration operation.');
  id(turn);id(request.projectId);revision(request.expectedRevision);
  const current=await head(db,user,request.projectId),requestHash=await jsonDigest(request);
  if(current.version_id)await requireSpecificationAvailable(db,current.version_id);
  const prior=await db.prepare('SELECT * FROM project_spec_proposals WHERE id=? AND user_id=?').bind(turn,user).first<Proposal>();
  if(prior){if(prior.request_hash!==requestHash)throw new BackendError(409,'This request ID already describes another website change.');return {reply:description(prior),statements:[] as D1PreparedStatement[]};}
  if(current.revision!==request.expectedRevision)throw changed();
  let compiled:Awaited<ReturnType<typeof compileProjectSpecification>>,target:string|null=null;
  if(operation==='restore'){
   id(request.versionId);target=request.versionId;const old=await site(db,user,current.project_id,target);
   const saved=await db.prepare('SELECT spec_json,lock_json,spec_digest,manifest_digest FROM project_spec_versions WHERE version_id=? AND project_id=?').bind(target,current.project_id).first<{spec_json:string;lock_json:string;spec_digest:string;manifest_digest:string}>();
   if(!saved)throw new BackendError(404,'Saved website configuration not found.');
   compiled=await compileProjectSpecification(JSON.parse(saved.spec_json),JSON.parse(saved.lock_json));
   if(compiled.specificationDigest!==saved.spec_digest||compiled.manifestDigest!==saved.manifest_digest||home(compiled).artifact.digest!==old.digest||home(compiled).artifact.html!==old.html)throw new BackendError(409,'The saved website failed its integrity check.');
  }else{
   if(!current.spec_json||!current.lock_json)throw new BackendError(409,'Create this website’s first draft before proposing changes.');
   if(current.draft_revision!==current.head_draft_revision)throw new BackendError(409,'The website draft changed. Read its current specification before preparing a new review.');
   compiled=(await compileSpecificationChange(JSON.parse(current.spec_json),request.operations,JSON.parse(current.lock_json))).compiled;
  }
  const {artifact,config,photos}=home(compiled);
  await requireSpecificationPhotos(db,user,current.project_id,photos);
  await held(db,user,[compiled.specificationDigest,compiled.manifestDigest,artifact.digest]);
  let before:SiteConfig|null=null;
  if(current.spec_json){const priorCompiled=await compileProjectSpecification(JSON.parse(current.spec_json),JSON.parse(current.lock_json!));before=home(priorCompiled).config;}
  const diff=fieldDiff(before,config),expiresAt=new Date(Date.now()+600000).toISOString();
  const envelope={id:turn,projectId:current.project_id,operation,expectedRevision:current.revision,draftRevision:current.draft_revision,baseVersionId:current.version_id,targetVersionId:target,baseDigest:current.spec_digest,nextDigest:compiled.specificationDigest,manifestDigest:compiled.manifestDigest,diffDigest:await jsonDigest(diff,65536),requiredReviews:[],expiresAt,policyVersion:policy};
  const row={id:turn,user_id:user,project_id:current.project_id,operation:operation as Proposal['operation'],expected_revision:current.revision,draft_revision:current.draft_revision,base_version_id:current.version_id,target_version_id:target,base_digest:current.spec_digest,request_hash:requestHash,proposal_digest:await jsonDigest(envelope),spec_digest:compiled.specificationDigest,manifest_digest:compiled.manifestDigest,policy_version:policy,expires_at:expiresAt,spec_json:canonicalJSON(compiled.specification),lock_json:canonicalJSON(compiled.manifest.lock),manifest_json:canonicalJSON(compiled.manifest),config_json:canonicalJSON(config),html:artifact.html,html_digest:artifact.digest,diff_json:canonicalJSON(diff,65536),envelope_json:canonicalJSON(envelope)} satisfies Proposal;
  const keys=Object.keys(row) as (keyof Proposal)[],reply=description(row);
  return {reply,statements:[
   // Expired candidate bytes are disposable; immutable versions and apply receipts
   // survive independently. Bound cross-project cleanup as well as retained rows.
   db.prepare("DELETE FROM project_spec_proposals WHERE expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') AND (project_id=? OR id IN(SELECT id FROM project_spec_proposals WHERE expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') ORDER BY expires_at LIMIT 100))").bind(current.project_id),
   db.prepare(`INSERT INTO project_spec_proposals(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).bind(...keys.map(key=>row[key])),link(db,user,turn,turn,await sha256(reply))]};
 }catch(error){return safe(error);}
}

/** Rechecks saved bytes, exact policy/compiler identity, safety holds and current base. */
export async function readSpecificationProposal(db:D1Database,user:string,review:string){
 id(review);const q=await db.prepare('SELECT q.* FROM project_spec_proposals q JOIN projects p ON p.id=q.project_id AND p.owner_user_id=q.user_id WHERE q.id=? AND q.user_id=?').bind(review,user).first<Proposal>();
 if(!q)throw new BackendError(404,'Website review not found.');
 const current=await head(db,user,q.project_id);
 if(q.policy_version!==policy||q.expires_at<=new Date().toISOString()||current.revision!==q.expected_revision||current.draft_revision!==q.draft_revision||current.version_id!==q.base_version_id||current.spec_digest!==q.base_digest)throw changed();
 if(q.base_version_id)await requireSpecificationAvailable(db,q.base_version_id);
 if(q.target_version_id){await site(db,user,q.project_id,q.target_version_id);await requireSpecificationAvailable(db,q.target_version_id);}
 try{
  const compiled=await compileProjectSpecification(JSON.parse(q.spec_json),JSON.parse(q.lock_json)),{artifact,config}=home(compiled);
  const envelope=JSON.parse(q.envelope_json);
  if(await jsonDigest(envelope)!==q.proposal_digest||envelope.id!==q.id||envelope.projectId!==q.project_id||envelope.operation!==q.operation||envelope.expectedRevision!==q.expected_revision||envelope.draftRevision!==q.draft_revision||envelope.baseVersionId!==q.base_version_id||envelope.targetVersionId!==q.target_version_id||envelope.baseDigest!==q.base_digest||envelope.nextDigest!==q.spec_digest||envelope.manifestDigest!==q.manifest_digest||envelope.policyVersion!==q.policy_version||envelope.expiresAt!==q.expires_at||canonicalJSON(envelope.requiredReviews)!=='[]'||envelope.diffDigest!==await jsonDigest(JSON.parse(q.diff_json),65536)||compiled.specificationDigest!==q.spec_digest||compiled.manifestDigest!==q.manifest_digest||canonicalJSON(compiled.manifest)!==q.manifest_json||canonicalJSON(config)!==q.config_json||artifact.html!==q.html||artifact.digest!==q.html_digest)throw changed();
 }catch(error){return safe(error);}
 await requireSpecificationPhotos(db,user,q.project_id,projectPage(JSON.parse(q.spec_json),'home').photos);
 await held(db,user,[q.spec_digest,q.manifest_digest,q.html_digest]);return q;
}

export async function applySpecificationCommand(db:D1Database,user:string,turn:string,command:string){
 if(!command.startsWith('/confirm-specification '))return;
 const [_,review,hash,revisionText,...extra]=command.split(/\s+/);
 if(extra.length||!uuid.test(review??'')||!digest.test(hash??'')||!/^\d{1,15}$/.test(revisionText??''))throw new BackendError(400,'Choose the exact saved website review.');
 const expectedRevision=Number(revisionText),requestHash=await jsonDigest({reviewId:review,proposalDigest:hash,expectedRevision});
 const applied=await db.prepare('SELECT a.* FROM project_spec_applies a JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.user_id WHERE a.proposal_id=? AND a.user_id=?').bind(review,user).first<Receipt>();
 if(applied){if(applied.request_hash!==requestHash)throw changed();return {reply:'This website review was already saved. Read your saved versions for its current availability.',statements:[] as D1PreparedStatement[]};}
 const q=await readSpecificationProposal(db,user,review);
 if(q.proposal_digest!==hash||q.expected_revision!==expectedRevision)throw changed();
 return {reply:`Saved private website revision ${expectedRevision+1}. Open the preview below. Your live website changes only after a separate publication review.`,statements:[
  db.prepare("INSERT INTO site_versions(id,project_id,component_id,config_json,html,digest,created_at,source,base_version_id) SELECT ?,project_id,json_extract(manifest_json,'$.artifacts[0].component'),config_json,html,html_digest,?,'guided',base_version_id FROM project_spec_proposals WHERE id=? AND user_id=? AND EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=?)").bind(turn,new Date().toISOString(),review,user,turn,user),
  ...projectPage(JSON.parse(q.spec_json),'home').photos.map((photo,n)=>db.prepare('INSERT INTO version_photos(version_id,file_id,position,alt) VALUES(?,?,?,?)').bind(turn,photo.id,n,photo.alt)),
  db.prepare('INSERT INTO project_spec_versions(version_id,project_id,revision,proposal_id,spec_json,spec_digest,lock_json,manifest_json,manifest_digest) SELECT ?,project_id,expected_revision+1,id,spec_json,spec_digest,lock_json,manifest_json,manifest_digest FROM project_spec_proposals WHERE id=? AND user_id=? AND EXISTS(SELECT 1 FROM site_versions WHERE id=?)').bind(turn,review,user,turn),
  // Attempt the receipt whenever this confirmation turn exists. A candidate removed
  // after validation must abort the transaction, not silently save a success reply.
  db.prepare('INSERT INTO project_spec_applies(id,user_id,project_id,proposal_id,proposal_digest,request_hash,version_id,revision) SELECT ?,?,?,?,?,?,?,? FROM chat_turns WHERE id=? AND user_id=?').bind(turn,user,q.project_id,review,hash,requestHash,turn,expectedRevision+1,turn,user)
 ]};
}

export async function specificationAction(db:D1Database,user:string,turn:string,request:Record<string,unknown>){
 try{
  if(request.operation==='create'){shape(request,['kind','operation','projectId','config']);id(request.projectId);if(!await db.prepare('SELECT id FROM projects WHERE id=? AND owner_user_id=?').bind(request.projectId,user).first())throw new BackendError(404,'Project not found.');return createWebsite(db,user,turn,request.projectId,request.config);}
  if(request.operation==='read'){
   shape(request,['kind','operation','projectId']);id(request.projectId);const data=await readSpecification(db,user,request.projectId);
   // Inspection continuations accept a bounded string. Include editable references
   // and actual text, not the ever-growing version history or a status-only reply.
   const s=data.specification,inspection=JSON.stringify({type:'website_specification',projectId:data.projectId,revision:data.revision,versionId:data.versionId,otherDraftChanges:data.otherDraftChanges,...(s?{name:s.name,theme:s.design.theme,pages:s.pages,content:s.content}:{})});
   return {reply:data.versionId?`Saved website configuration revision ${data.revision}.${data.otherDraftChanges?' The draft changed; request a fresh review.':''}`:'This project has no website yet. Ask to create its first private draft.',inspection,statements:[] as D1PreparedStatement[]};
  }
  if(request.operation==='review'){
   shape(request,['kind','operation','reviewId']);id(request.reviewId);const q=await readSpecificationProposal(db,user,request.reviewId),reply=description(q);
   return {reply,statements:[link(db,user,turn,q.id,await sha256(reply))]};
  }
  return await prepareSpecification(db,user,turn,request);
 }catch(error){return safe(error);}
}

export async function specificationChatLinks(db:D1Database,user:string,turns:Record<string,unknown>[]){
 const {results}=await db.prepare('SELECT l.turn_id,l.proposal_id,l.reply_digest FROM project_spec_chat_links l JOIN chat_turns t ON t.id=l.turn_id WHERE t.user_id=? ORDER BY t.revision DESC LIMIT 100').bind(user).all<{turn_id:string;proposal_id:string;reply_digest:string}>();
 for(const link of results){const turn=turns.find(t=>t.id===link.turn_id);if(!turn||turn.status!=='completed'||typeof turn.assistant_text!=='string'||await sha256(turn.assistant_text)!==link.reply_digest)continue;
  try{const q=await readSpecificationProposal(db,user,link.proposal_id);turn.specification_review={id:q.id,proposalDigest:q.proposal_digest,expectedRevision:q.expected_revision};}catch(error){if(!(error instanceof BackendError))throw error;}
 }
}
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
/** Shared comparison facts. Existing review validation remains authoritative. */
export async function specificationReviewDetails(db:D1Database,user:string,review:string){
 const q=await readSpecificationProposal(db,user,review);
 const gate={userId:user,projectId:q.project_id,featureId:'core.editing' as const,operation:'read' as const};
 await assertFeature(db,gate);
 const project=await head(db,user,q.project_id);
 const result={version:1,source:'project_spec_proposals',observedAt:new Date().toISOString(),expiresAt:q.expires_at,
  review:{id:q.id,proposalDigest:q.proposal_digest,expectedRevision:q.expected_revision},project:{id:q.project_id,name:project.name},operation:q.operation,changes:JSON.parse(q.diff_json)};
 // Reuse the domain validator after assembling facts; late removal, ownership,
 // base, expiry and safety changes must not return an earlier private snapshot.
 const latest=await readSpecificationProposal(db,user,review);
 if(latest.proposal_digest!==q.proposal_digest)throw changed();
 await assertFeature(db,gate);
 const display=readSpecificationReviewDisplay({...result,observedAt:new Date().toISOString()});
 if(!display)throw changed();
 return display;
}
export async function specificationPreview(db:D1Database,user:string,review:string,comparison=false,files?:R2Bucket){
 const q=await readSpecificationProposal(db,user,review);
 if(!comparison)return new Response(await inlineSpecificationPhotos(db,files,user,q.project_id,q.html,projectPage(JSON.parse(q.spec_json),'home').photos),{headers:{...previewHeaders,'content-security-policy':previewHeaders['content-security-policy']+'; img-src data:'}});
 const rows=JSON.parse(q.diff_json) as {label:string;before:string|null;after:string|null}[];
 const html=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Review website changes · Whumpo</title><style>body{font:16px/1.6 system-ui;background:#f8fafc;color:#0f2d5b;margin:0}main{max-width:850px;margin:auto;padding:24px}section{background:white;border:1px solid #dae5f0;border-radius:16px;padding:20px;margin:16px 0}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}h1{font-size:30px}h2{font-size:20px}h3{font-size:14px}</style><main><h1>Review website changes</h1><p>Approval saves a private version. Publishing remains a separate review. Return to Chat to approve this exact change.</p>${rows.length?rows.map(row=>`<section><h2>${escape(row.label)}</h2><h3>Before</h3><pre>${escape(row.before??'Not included')}</pre><h3>After</h3><pre>${escape(row.after??'Not included')}</pre></section>`).join(''):'<p>The website text and theme are unchanged. This records a new configuration version.</p>'}</main></html>`;
 return new Response(html,{headers:previewHeaders});
}
