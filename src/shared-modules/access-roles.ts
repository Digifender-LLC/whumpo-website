import {jsonDigest,sha256} from '../project-specification/v2/json';
import {assertFeature,featurePredicate} from '../feature-admission';
import {FeatureInclusionError,featureRequest} from '../feature-inclusion';
import {assertWorkspace} from '../workspace-identity/admission';
import {chatTurnGroups} from '../chat-turn-groups';
import {ModuleError} from './policy';
import {compactedReview,turnoverStatements} from '../review-turnover';
import {registeredInstances} from './registry';
import {linkedReviewedReply,reviewedReplyGuard} from '../chat-review-receipts';

/** WH-126 exact owner staff role reviews. Both steps are typed owner Chat controls whose statements commit with the
 * Chat turn: `accessRoleReview` prepares, `accessRoleApply` (recent sign-in) applies. Granting composes current
 * core.editing inclusion and identity into the committing statement; revoking needs only identity and ownership, so it
 * outlives plan loss and works in every activation state. Each applied review advances the access revision once.
 * Replies carry the instance id and an opaque visitor id only: no credential or visitor-submitted value enters Chat. */
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
type Action='grant'|'revoke';
type Review={id:string;user_id:string;project_id:string;instance_id:string;local_id:string;visitor_id:string;role:'staff';action:Action;config_revision:number;expected_access_revision:number;request_hash:string;created_at:number;expires_at:number};
type SavedReview=Review&{review_digest:string};
const changed=()=>new ModuleError('stale_configuration','This staff role review changed or expired. Ask for a fresh review.');
const reviewDigest=(r:Review)=>jsonDigest({contract:'access-role-review@1',...r},65536);
const short=(visitor:string)=>visitor.slice(0,8);
const staffDeclared=(config:string)=>{try{const roles=JSON.parse(config)?.roles;return Array.isArray(roles)&&roles.includes('staff');}catch{return false;}};

function describe(r:Review){
 const expires=`Approval requires a recent sign-in. Review expires: ${new Date(r.expires_at*1000).toISOString()}`;
 if(r.action==='revoke')return `Review removing the staff role from visitor ${short(r.visitor_id)} in the “${r.local_id}” visitor access module\nIt takes effect at their next request and inside any change already in progress. They keep their visitor sign-in and private data. Nothing else changes.\n${expires}`;
 return `Review granting the staff role to visitor ${short(r.visitor_id)} in the “${r.local_id}” visitor access module\nStaff can use only the staff views, staff-writable fields and staff file collections that your modules declare. Staff get no workspace sign-in, Chat, publishing, spending or account management, and you can remove the role at any time.\n${expires}`;
}
async function roleState(db:D1Database,instance:string,visitor:string){
 return (await db.prepare("SELECT state FROM module_access_roles WHERE instance_id=? AND visitor_id=? AND role='staff'").bind(instance,visitor).first<{state:string}>())?.state??null;
}

/** `/review-access-role PROJECT INSTANCE VISITOR grant|revoke` from the typed accessRoleReview control. */
export async function prepareAccessRoleCommand(db:D1Database,user:string,turn:string,command:string){
 if(!command.startsWith('/review-access-role '))return;
 const m=/^\/review-access-role ([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}) ([a-z][a-z0-9-]{0,39}) ([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}) (grant|revoke)$/.exec(command);
 if(!m||!uuid.test(turn))throw new ModuleError('invalid_request','Choose one visitor and one access module to review.');
 const [,project,localId,visitor,action]=m as unknown as [string,string,string,string,Action];
 await assertWorkspace(db,user);
 if(!await db.prepare('SELECT 1 FROM projects WHERE id=? AND owner_user_id=?').bind(project,user).first())throw new ModuleError('not_found','Project not found.');
 const row=(await registeredInstances(db,project)).find(r=>r.local_id===localId&&r.kind==='access');
 const state=row?await db.prepare('SELECT revision FROM module_access_states WHERE instance_id=?').bind(row.id).first<{revision:number}>():null;
 if(!row||!state||row.state===null)throw new ModuleError('not_found','This visitor access module has not been activated.');
 const target=await db.prepare('SELECT revoked FROM app_visitors WHERE id=? AND project_id=? AND access_id=?').bind(visitor,project,row.id).first<{revoked:number}>();
 if(!target)throw new ModuleError('not_found','Visitor not found.');
 const current=await roleState(db,row.id,visitor);
 if(action==='grant'){
  if(row.state!=='active')throw new ModuleError('unavailable','Activate this visitor access module before granting roles.');
  if(!staffDeclared(row.config_json))throw new ModuleError('forbidden','This visitor access module does not declare the staff role.');
  if(target.revoked)throw new ModuleError('forbidden','This visitor’s access was revoked.');
  if(current==='granted')throw new ModuleError('invalid_request','This visitor already has the staff role.');
  try{await assertFeature(db,featureRequest({userId:user,projectId:project,featureId:'core.editing',operation:'prepare'}));}
  catch(error){if(error instanceof FeatureInclusionError)throw new ModuleError('forbidden','Granting staff roles requires Starter or a higher plan, or an explicit scoped test grant. Reading and removing roles stay available.');throw error;}
 }else if(current!=='granted')throw new ModuleError('invalid_request','This visitor does not have the staff role.');
 const now=Math.floor(Date.now()/1000);
 const review:Review={id:turn,user_id:user,project_id:project,instance_id:row.id,local_id:localId,visitor_id:visitor,role:'staff',action,config_revision:row.config_revision,expected_access_revision:state.revision,
  request_hash:await jsonDigest({kind:'accessRoleReview',projectId:project,instanceId:localId,visitorId:visitor,action}),created_at:now,expires_at:now+600};
 const saved:SavedReview={...review,review_digest:await reviewDigest(review)},keys=Object.keys(saved) as (keyof SavedReview)[],reply=describe(review);
 return {reply,statements:[
  // Expired unapplied reviews no longer count against capacity; this batch first seals and removes the project's eligible rows (WH-182).
  ...await turnoverStatements(db,'module_access_role_reviews',{user,project}),
  db.prepare(`INSERT INTO module_access_role_reviews(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).bind(...keys.map(k=>saved[k])),
  db.prepare('INSERT INTO module_access_role_links(turn_id,review_id,reply_digest) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=?)').bind(turn,turn,await sha256(reply),turn,user)
 ]};
}

async function pendingReview(db:D1Database,user:string,id:string){
 const r=await db.prepare('SELECT r.* FROM module_access_role_reviews r JOIN projects p ON p.id=r.project_id AND p.owner_user_id=r.user_id WHERE r.id=? AND r.user_id=?').bind(id,user).first<SavedReview>();
 if(!r)throw await compactedReview(db,'module_access_role_reviews',id,user,(s,m)=>new ModuleError(s===503?'unresolved':'stale_configuration',m))??new ModuleError('not_found','Staff role review not found.');
 const {review_digest,...fields}=r;
 if(await db.prepare('SELECT 1 FROM module_access_role_applies WHERE review_id=?').bind(id).first())throw changed();
 if(r.expires_at<=Math.floor(Date.now()/1000)||await reviewDigest(fields)!==review_digest)throw changed();
 const state=await db.prepare('SELECT s.revision,i.config_revision FROM module_access_states s JOIN module_instances i ON i.id=s.instance_id WHERE s.instance_id=? AND s.project_id=?').bind(r.instance_id,r.project_id).first<{revision:number;config_revision:number}>();
 if(!state||state.revision!==r.expected_access_revision||state.config_revision!==r.config_revision)throw changed();
 return r;
}

/** `/confirm-access-role REVIEW DIGEST EXPECTED_ACCESS_REVISION` from the typed accessRoleApply control. A lost
 * acknowledgement reads the saved receipt; concurrent role changes have one database winner; a replay never re-grants. */
export async function applyAccessRoleCommand(db:D1Database,user:string,turn:string,command:string){
 if(!command.startsWith('/confirm-access-role '))return;
 const [,review,digest,revisionText,...extra]=command.split(/\s+/);
 if(extra.length||!uuid.test(review??'')||!/^[0-9a-f]{64}$/.test(digest??'')||!/^\d{1,15}$/.test(revisionText??''))throw new ModuleError('invalid_request','Choose the exact staff role review.');
 const expectedRevision=Number(revisionText),requestHash=await jsonDigest({reviewId:review,reviewDigest:digest,expectedRevision});
 const receipt=await db.prepare('SELECT a.request_hash,r.action,r.local_id,r.visitor_id FROM module_access_role_applies a JOIN module_access_role_reviews r ON r.id=a.review_id JOIN projects p ON p.id=r.project_id AND p.owner_user_id=a.user_id WHERE a.review_id=? AND a.user_id=?').bind(review,user).first<{request_hash:string;action:Action;local_id:string;visitor_id:string}>();
 if(receipt){
  if(receipt.request_hash!==requestHash)throw changed();
  return {reply:`This staff role review was already applied: visitor ${short(receipt.visitor_id)} ${receipt.action==='grant'?'was granted':'had'} the staff role${receipt.action==='grant'?'':' removed'} in the “${receipt.local_id}” module. This is a saved receipt; read the current staff list before changing it again.`,statements:[] as D1PreparedStatement[]};
 }
 const r=await pendingReview(db,user,review);
 if(r.review_digest!==digest||r.expected_access_revision!==expectedRevision)throw changed();
 const grant=r.action==='grant';
 const reviewed=await linkedReviewedReply(db,user,'module_access_role_links',review);if(!reviewed)throw changed();
 const gate=grant?featurePredicate(db,featureRequest({userId:user,projectId:r.project_id,featureId:'core.editing',operation:'confirm'})):{sql:'1',params:[] as unknown[]},guard=reviewedReplyGuard(user,reviewed);
 return {reply:grant?`Granted the staff role to visitor ${short(r.visitor_id)} in the “${r.local_id}” visitor access module. It applies from their next request; removing it stays available at any time.`
  :`Removed the staff role from visitor ${short(r.visitor_id)} in the “${r.local_id}” visitor access module. Their next request, and any change already in progress, no longer has staff access.`,
 statements:[
  db.prepare(`INSERT INTO module_access_role_applies(id,user_id,review_id,review_digest,request_hash,admitted,access_revision,created_at)
   SELECT ?,?,?,?,?,(SELECT 1 WHERE ${gate.sql}${guard.sql}),?,unixepoch() FROM chat_turns WHERE id=? AND user_id=?`)
   .bind(turn,user,review,digest,requestHash,...gate.params,...guard.params,expectedRevision+1,turn,user)
 ]};
}

/** Attach the exact pending review to the Chat turn whose saved reply described it. */
export async function accessRoleChatLinks(db:D1Database,user:string,turns:Record<string,unknown>[]){
 for(const ids of chatTurnGroups(turns)){
  const {results}=await db.prepare(`SELECT l.turn_id,l.review_id,l.reply_digest FROM module_access_role_links l JOIN chat_turns t ON t.id=l.turn_id WHERE t.user_id=? AND l.turn_id IN (${ids.map(()=>'?').join(',')})`).bind(user,...ids).all<{turn_id:string;review_id:string;reply_digest:string}>();
  for(const row of results){
   const turn=turns.find(t=>t.id===row.turn_id);
   if(!turn||turn.status!=='completed'||typeof turn.assistant_text!=='string'||await sha256(turn.assistant_text)!==row.reply_digest)continue;
   try{const r=await pendingReview(db,user,row.review_id);turn.access_role_review={id:r.id,reviewDigest:r.review_digest,expectedRevision:r.expected_access_revision,action:r.action,instanceId:r.local_id,visitorId:r.visitor_id};}
   catch(error){if(!(error instanceof ModuleError))throw error;}
  }
 }
}
/** Chat error mapping for the committing triggers. */
export function accessRoleFailure(cause:unknown){
 const text=String(cause);
 if(!/module_access_/.test(text))return null;
 if(text.includes('module_access_forbidden'))return new ModuleError('forbidden','Feature eligibility or project ownership changed. Reading and removing staff roles stay available.');
 if(text.includes('module_access_capacity'))return new ModuleError('limited','Staff role review history has reached its test capacity.');
 return changed();
}
