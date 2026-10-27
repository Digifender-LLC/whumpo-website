import {canonicalJSON,jsonDigest,sha256,SpecificationError} from '../project-specification/v2/json';
import {classifyModuleChange,type ModuleInstance} from '../project-specification/v3/modules';
import {assertFeature,featurePredicate} from '../feature-admission';
import {FeatureInclusionError,featureRequest} from '../feature-inclusion';
import {assertWorkspace} from '../workspace-identity/admission';
import {chatTurnGroups} from '../chat-turn-groups';
import {ModuleError} from './policy';
import {catalogState,currentSpecification,instanceOf,moduleDescriptor,moduleFeature,pin,registeredInstances,type RegistryRow} from './registry';

/** WH-125 exact owner activation/disable reviews. Both steps are typed owner Chat controls whose statements
 * commit with the Chat turn: `moduleActivationReview` prepares, `moduleActivationApply` (recent sign-in) applies.
 * Activation composes current core.forms/core.editing inclusion and identity into the committing statement;
 * disabling needs only current identity and ownership, so it outlives plan loss. Replies carry instance ids,
 * kinds, states and revisions only: no configuration value or visitor-submitted value enters Chat. */
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
type Action='activate'|'disable';
type Review={id:string;user_id:string;project_id:string;resource_id:string;local_id:string;kind:ModuleInstance['kind'];action:Action;feature_id:'core.forms'|'core.editing';source_version_id:string;source_spec_digest:string;module_digest:string;schema_digest:string;config_json:string;config_digest:string;descriptor_json:string;descriptor_digest:string;dependencies_json:string;expected_config_revision:number;next_config_revision:number;expected_activation_revision:number;widening:number;request_hash:string;created_at:number;expires_at:number};
type SavedReview=Review&{review_digest:string};
const kindNames={content:'content collection',records:'records and forms',files:'files and galleries',access:'visitor access'} as const;
const changed=()=>new ModuleError('stale_configuration','This module review changed or expired. Ask for a fresh review.');
/** The digest binds every reviewed field, so the confirming control approves exactly what was shown. */
const reviewDigest=(r:Review)=>jsonDigest({contract:'module-activation-review@1',...r},65536);

function describe(r:Review,dependencies:string[]){
 const name=`“${r.local_id}” ${kindNames[r.kind]} module`;
 if(r.action==='disable')return `Review disabling the ${name}\nVisitor, staff and public requests stop at their next request. Saved configuration, owner reads, export and re-activation stay available. Nothing is deleted.\nApproval requires a recent sign-in. Review expires: ${new Date(r.expires_at*1000).toISOString()}`;
 return `Review activating the ${name}\n${r.expected_config_revision===0?'Registers this module':r.next_config_revision>r.expected_config_revision?'Applies the changed saved configuration':'Re-activates the saved configuration'} at configuration revision ${r.next_config_revision}, from the current saved website configuration.\n${r.widening?'This allows new people to submit or read through this module.\n':''}${dependencies.length?`Depends on active modules: ${dependencies.join(', ')}.\n`:''}While active, the module serves its configured visitors only through its own checks. Activation publishes no page, sends no message and runs no AI. Visitor-submitted values stay in your dashboard and never enter Chat or AI requests.\nApproval requires a recent sign-in. Review expires: ${new Date(r.expires_at*1000).toISOString()}`;
}
function link(db:D1Database,user:string,turn:string,review:string,hash:string){
 return db.prepare('INSERT INTO module_activation_links(turn_id,review_id,reply_digest) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=?)').bind(turn,review,hash,turn,user);
}
async function forbiddenWithoutInclusion(db:D1Database,user:string,project:string,feature:'core.forms'|'core.editing'){
 try{await assertFeature(db,featureRequest({userId:user,projectId:project,featureId:feature,operation:'prepare'}));}
 catch(error){if(error instanceof FeatureInclusionError)throw new ModuleError('forbidden','Activating this module requires Starter or a higher plan, or an explicit scoped test grant. Owner reads, export and disable stay available.');throw error;}
}

/** WH-126: one visitor identity namespace (one project session cookie) per project, so at most one access instance. */
const accessSingle=()=>new ModuleError('invalid_request','This project already has a visitor access module. A project has one visitor sign-in, so remove the extra access module from the website configuration.');
/** `/review-module-activation PROJECT INSTANCE activate|disable` from the typed moduleActivationReview control. */
export async function prepareModuleActivationCommand(db:D1Database,user:string,turn:string,command:string){
 if(!command.startsWith('/review-module-activation '))return;
 const m=/^\/review-module-activation ([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}) ([a-z][a-z0-9-]{0,39}) (activate|disable)$/.exec(command);
 if(!m||!uuid.test(turn))throw new ModuleError('invalid_request','Choose one configured module to review.');
 const [,project,localId,action]=m as unknown as [string,string,string,Action];
 await assertWorkspace(db,user);
 const rows=await ownedRegistry(db,user,project),row=rows.find(r=>r.local_id===localId),now=Math.floor(Date.now()/1000);
 let review:Review,dependencies:string[]=[];
 if(action==='disable'){
  if(!row||row.state===null||row.activation_revision===null)throw new ModuleError('not_found','This module has not been activated.');
  if(!['active','suspended'].includes(row.state))throw new ModuleError('unavailable','This module is not active.');
  review={id:turn,user_id:user,project_id:project,resource_id:row.id,local_id:row.local_id,kind:row.kind,action,feature_id:moduleFeature(row.kind),source_version_id:row.source_version_id,source_spec_digest:row.source_spec_digest,
   module_digest:row.module_digest,schema_digest:row.schema_digest,config_json:row.config_json,config_digest:row.config_digest,descriptor_json:row.descriptor_json,descriptor_digest:row.descriptor_digest,dependencies_json:row.dependencies_json,
   expected_config_revision:row.config_revision,next_config_revision:row.config_revision,expected_activation_revision:row.activation_revision,widening:0,request_hash:'',created_at:now,expires_at:now+600};
 }else{
  const spec=await currentSpecification(db,user,project);
  if(!spec)throw new ModuleError('not_found','Save a website configuration that includes this module first.');
  if(await db.prepare('SELECT 1 FROM project_spec_held WHERE version_id=?').bind(spec.versionId).first())throw new ModuleError('unavailable','This website configuration is held for safety review.');
  const instance=spec.instances.find(i=>i.id===localId);
  if(!instance)throw new ModuleError('not_found','This module is not in the current saved website configuration.');
  const catalog=catalogState(instance.kind,instance.module.digest,instance.schema.digest);
  if(catalog==='withdrawn')throw new ModuleError('unavailable','This module version has been withdrawn. Existing owner reads, export and disable stay available.');
  if(catalog==='stale')throw new ModuleError('stale_module_version');
  if(instance.kind==='access'&&!row&&rows.some(r=>r.kind==='access'))throw accessSingle();
  const feature=moduleFeature(instance.kind);await forbiddenWithoutInclusion(db,user,project,feature);
  const deps=instance.dependencies.map(id=>{
   const d=rows.find(r=>r.local_id===id);
   if(!d||d.state!=='active')throw new ModuleError('unavailable',`Activate the “${id}” module first.`);
   dependencies.push(id);return {resourceId:d.id,module:pin(d.kind,'module',d.module_digest)};
  });
  const configDigest=await jsonDigest(instance.config);
  let widening=false,next=1;
  if(row){
   if(row.kind!==instance.kind||row.module_digest!==instance.module.digest||row.schema_digest!==instance.schema.digest)throw new ModuleError('incompatible');
   if(row.state==='migrating')throw new ModuleError('unavailable');
   next=row.config_revision;
   if(configDigest!==row.config_digest){
    try{widening=classifyModuleChange({...await instanceOf(row),dependencies:instance.dependencies} as ModuleInstance,instance).permissions;}
    catch(error){if(error instanceof SpecificationError)throw new ModuleError('incompatible');throw error;}
    next=row.config_revision+1;
   }
   if(row.state==='active'&&next===row.config_revision&&row.source_version_id===spec.versionId)throw new ModuleError('invalid_request','This module is already active with the current saved configuration.');
  }else widening=classifyModuleChange(undefined,instance).permissions;
  const resourceId=row?.id??crypto.randomUUID(),descriptor=moduleDescriptor(project,resourceId,instance,deps);
  review={id:turn,user_id:user,project_id:project,resource_id:resourceId,local_id:localId,kind:instance.kind,action,feature_id:feature,source_version_id:spec.versionId,source_spec_digest:spec.digest,
   module_digest:instance.module.digest,schema_digest:instance.schema.digest,config_json:canonicalJSON(instance.config,16384),config_digest:configDigest,descriptor_json:canonicalJSON(descriptor),descriptor_digest:await jsonDigest(descriptor),
   dependencies_json:JSON.stringify(deps.map(d=>d.resourceId)),expected_config_revision:row?.config_revision??0,next_config_revision:row?next:1,expected_activation_revision:row?.activation_revision??0,widening:widening?1:0,request_hash:'',created_at:now,expires_at:now+600};
 }
 review.request_hash=await jsonDigest({kind:'moduleActivationReview',projectId:project,instanceId:localId,action});
 const saved:SavedReview={...review,review_digest:await reviewDigest(review)},keys=Object.keys(saved) as (keyof SavedReview)[],reply=describe(review,dependencies);
 return {reply,statements:[
  // Expired unapplied reviews no longer count against capacity; WH-182 compacts them into sealed receipts.
  db.prepare(`INSERT INTO module_activation_reviews(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).bind(...keys.map(k=>saved[k])),
  link(db,user,turn,turn,await sha256(reply))
 ]};
}
async function ownedRegistry(db:D1Database,user:string,project:string){
 if(!await db.prepare('SELECT 1 FROM projects WHERE id=? AND owner_user_id=?').bind(project,user).first())throw new ModuleError('not_found','Project not found.');
 return registeredInstances(db,project);
}
async function ownedReview(db:D1Database,user:string,review:string){
 const row=await db.prepare('SELECT r.* FROM module_activation_reviews r JOIN projects p ON p.id=r.project_id AND p.owner_user_id=r.user_id WHERE r.id=? AND r.user_id=?').bind(review,user).first<SavedReview>();
 if(!row)throw new ModuleError('not_found','Module review not found.');
 return row;
}
/** Read-time validity for presentation and preflight; the committing trigger repeats every check. */
async function pendingReview(db:D1Database,user:string,id:string){
 const r=await ownedReview(db,user,id),{review_digest,...fields}=r;
 if(await db.prepare('SELECT 1 FROM module_activation_applies WHERE review_id=?').bind(id).first())throw changed();
 if(r.expires_at<=Math.floor(Date.now()/1000)||await reviewDigest(fields)!==review_digest)throw changed();
 const current=(await registeredInstances(db,r.project_id)).find(x=>x.local_id===r.local_id);
 if((current?.activation_revision??0)!==r.expected_activation_revision||(current?.config_revision??0)!==r.expected_config_revision||(current&&current.id!==r.resource_id))throw changed();
 if(r.action==='activate'){
  const catalog=catalogState(r.kind,r.module_digest,r.schema_digest);
  if(catalog==='withdrawn')throw new ModuleError('unavailable','This module version has been withdrawn.');
  if(catalog==='stale')throw new ModuleError('stale_module_version');
  const spec=await currentSpecification(db,user,r.project_id);
  if(!spec||spec.versionId!==r.source_version_id||spec.digest!==r.source_spec_digest)throw changed();
 }
 return r;
}

/** `/confirm-module-activation REVIEW DIGEST EXPECTED_REVISION` from the typed moduleActivationApply control.
 * A lost acknowledgement reads the existing receipt; a concurrent activation/disable has one database winner. */
export async function applyModuleActivationCommand(db:D1Database,user:string,turn:string,command:string){
 if(!command.startsWith('/confirm-module-activation '))return;
 const [,review,digest,revisionText,...extra]=command.split(/\s+/);
 if(extra.length||!uuid.test(review??'')||!/^[0-9a-f]{64}$/.test(digest??'')||!/^\d{1,15}$/.test(revisionText??''))throw new ModuleError('invalid_request','Choose the exact module review.');
 const expectedRevision=Number(revisionText),requestHash=await jsonDigest({reviewId:review,reviewDigest:digest,expectedRevision});
 const receipt=await db.prepare('SELECT a.request_hash,a.state,r.local_id,r.kind FROM module_activation_applies a JOIN module_activation_reviews r ON r.id=a.review_id JOIN projects p ON p.id=r.project_id AND p.owner_user_id=a.user_id WHERE a.review_id=? AND a.user_id=?').bind(review,user).first<{request_hash:string;state:string;local_id:string;kind:keyof typeof kindNames}>();
 if(receipt){
  if(receipt.request_hash!==requestHash)throw changed();
  return {reply:`This module review was already applied: the “${receipt.local_id}” ${kindNames[receipt.kind]} module was ${receipt.state==='active'?'activated':'disabled'}. This is a saved receipt; read the current module status before changing it again.`,statements:[] as D1PreparedStatement[]};
 }
 const r=await pendingReview(db,user,review);
 if(r.review_digest!==digest||r.expected_activation_revision!==expectedRevision)throw changed();
 const activate=r.action==='activate',state=activate?'active':'inactive';
 const gate=activate?featurePredicate(db,featureRequest({userId:user,projectId:r.project_id,featureId:r.feature_id,operation:'confirm'})):{sql:'1',params:[] as unknown[]};
 return {reply:activate?`Activated the “${r.local_id}” ${kindNames[r.kind]} module at configuration revision ${r.next_config_revision}. It serves only through its own checks while active; disabling stays available at any time.`
  :`Disabled the “${r.local_id}” ${kindNames[r.kind]} module. Visitor, staff and public requests now stop; saved configuration, owner reads and export stay available.`,
 statements:[
  db.prepare(`INSERT INTO module_activation_applies(id,user_id,review_id,review_digest,request_hash,admitted,state,activation_revision,created_at)
   SELECT ?,?,?,?,?,(SELECT 1 WHERE ${gate.sql}),?,?,unixepoch() FROM chat_turns WHERE id=? AND user_id=?`)
   .bind(turn,user,review,digest,requestHash,...gate.params,state,expectedRevision+1,turn,user)
 ]};
}

/** Attach the exact pending review to the Chat turn whose saved reply described it. */
export async function moduleActivationChatLinks(db:D1Database,user:string,turns:Record<string,unknown>[]){
 for(const ids of chatTurnGroups(turns)){
  const {results}=await db.prepare(`SELECT l.turn_id,l.review_id,l.reply_digest FROM module_activation_links l JOIN chat_turns t ON t.id=l.turn_id WHERE t.user_id=? AND l.turn_id IN (${ids.map(()=>'?').join(',')})`).bind(user,...ids).all<{turn_id:string;review_id:string;reply_digest:string}>();
  for(const row of results){
   const turn=turns.find(t=>t.id===row.turn_id);
   if(!turn||turn.status!=='completed'||typeof turn.assistant_text!=='string'||await sha256(turn.assistant_text)!==row.reply_digest)continue;
   try{const r=await pendingReview(db,user,row.review_id);turn.module_activation_review={id:r.id,reviewDigest:r.review_digest,expectedRevision:r.expected_activation_revision,action:r.action,instanceId:r.local_id,kind:r.kind};}
   catch(error){if(!(error instanceof ModuleError))throw error;}
  }
 }
}
/** Chat error mapping for the committing triggers. */
export function moduleActivationFailure(cause:unknown){
 const text=String(cause);
 if(!/module_activation_/.test(text))return null;
 if(text.includes('module_activation_forbidden'))return new ModuleError('forbidden','Feature eligibility or project ownership changed. Owner reads, export and disable stay available.');
 if(text.includes('module_activation_access_single'))return accessSingle();
 if(text.includes('module_activation_held'))return new ModuleError('unavailable','This website configuration is held for safety review.');
 if(text.includes('module_activation_capacity'))return new ModuleError('limited','Module review history has reached its test capacity.');
 return changed();
}
