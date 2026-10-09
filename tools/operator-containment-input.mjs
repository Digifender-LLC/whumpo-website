import {createHash,randomBytes} from 'node:crypto';
// WH-050 F7 / runbook G3: operator-only containment of one account or project's public allowances, a separate project
// serving stop and a separate account workspace session revocation (owner decision October 8, 2026), plus reviewed
// retention cleanup (resolved records 90 days after resolution; owner decision October 8, 2026).
// Local operator CLI logic only (tools/operator-containment.mjs); never bundled into a Worker or customer endpoint.
// Enforcement lives in the current schema (admission triggers, operator_contained_projects, operator_serving_stopped and
// the revocation/retention triggers), so no request path can bypass it, and customers only ever see the existing generic
// limit, busy, unavailable or signed-out responses. Nothing here edits customer content or publications.
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const uuidV7=/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const iso=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
export const containmentScopes=Object.freeze(['backend','transition','contact','photo','build']);
/** Freeze-only scopes: no temporary allowance exists, and the build limits stay as built (WH-074). */
export const freezeOnlyScopes=Object.freeze(['build']);
/** Normal per-project allowance and the highest temporary allowance an operator may set (platform, account and fair-share ceilings never change). */
export const containmentAllowances=Object.freeze({
 backend:Object.freeze({normal:100,maximum:500,unit:'public backend calls per project per UTC day'}),
 transition:Object.freeze({normal:100,maximum:500,unit:'visitor transitions per project per UTC day'}),
 contact:Object.freeze({normal:20,maximum:100,unit:'contact submissions per project per rolling hour'}),
 photo:Object.freeze({normal:10000,maximum:50000,unit:'public photo reads per project per UTC month'}),
 build:Object.freeze({normal:1,maximum:null,unit:'active owner build jobs per project (freeze only; a freeze also cancels running and unpublished jobs)'})
});
export const maximumContainmentMs=30*86400000;
/** Resolved records (lifted or closed containment, completed revocations and cleanup receipts) are kept this long. */
export const retentionMs=90*86400000;
const cleanupLimit=500;
/** Stored cleanup receipts, checked after each cleanup's own deletions (schema operator_retention_apply). */
export const retentionReceiptLimit=10000;
/**
 * An action id (containment, session revocation or cleanup receipt) is a lowercase canonical UUIDv7 that carries its own
 * creation time; the schema admits a new one only within [now - 1 day, now + 1 minute] by the database clock, so a cleaned
 * id can never be reused. Only the schema is the boundary; `--new-id` and `newActionId` are conveniences.
 */
export const actionIdWindowMs=86400000;
export const actionIdFutureMs=60000;
/** Mints a UUIDv7 stamped `now` (milliseconds since the epoch); the remaining bits are cryptographically random. */
export function newActionId(now=Date.now()){
 if(!Number.isSafeInteger(now)||now<0||now>=2**48)throw RangeError('Action ID time out of range');
 const b=randomBytes(16);
 for(let i=0;i<6;i++)b[i]=Math.floor(now/2**(8*(5-i)))%256;
 b[6]=0x70|(b[6]&15);b[8]=0x80|(b[8]&63);
 const h=b.toString('hex');
 return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
}
/** Millisecond timestamp embedded in a UUIDv7 action id, or null when `value` is not a lowercase canonical UUIDv7. */
export function actionIdTime(value){return typeof value==='string'&&uuidV7.test(value)?Number.parseInt(value.slice(0,8)+value.slice(9,13),16):null;}
const fail=()=>{throw Error('Invalid operator containment request');};
const staleMessage='Request ID must be a new UUIDv7 minted within the last day (node tools/operator-containment.mjs --new-id); an unapplied older request needs a new ID';
const staleId=()=>{throw Error(staleMessage);};
/**
 * After the schema aborts a new revocation or cleanup receipt as invalid, say which of its checks failed, from the database's
 * own clock (a read-only query) rather than assuming the ID: this machine's clock may differ from the database's, so the ID
 * or the cutoff can pass the tool's check and fail the schema's. Only fixed text and a whole number of seconds are reported.
 */
async function refuseInvalid(db,input,now,cutoff){
 const read=await db.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS now").first().catch(()=>null),dbNow=read?Date.parse(read.now):Number.NaN;
 if(!Number.isFinite(dbNow))throw Error('Request refused by the database request checks; read status and preview again');
 const skew=Math.abs(dbNow-now),note=skew>30000?` This machine's clock differs from the database clock by about ${Math.round(skew/1000)} seconds; correct it first.`:'';
 const at=actionIdTime(input.id);
 if(at===null||at<dbNow-actionIdWindowMs||at>dbNow+actionIdFutureMs)throw Error(staleMessage+note);
 if(cutoff!==undefined&&Date.parse(cutoff)>dbNow-retentionMs)throw Error('Cleanup cutoff must be at least 90 days in the past by the database clock; choose an earlier cutoff.'+note);
 throw Error('Request refused by the database request checks; read status and preview again'+note);
}
function keys(value,allowed,required=allowed){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k))||required.some(k=>!Object.hasOwn(value,k)))fail();}
function id(value){if(typeof value!=='string'||!uuid.test(value))fail();return value;}
function actionId(value){if(actionIdTime(value)===null)fail();return value;}
/** A request that matches no stored record must carry an id minted inside the window (the schema enforces the same by its own clock). */
function fresh(value,now){const at=actionIdTime(value);if(at===null||at<now-actionIdWindowMs||at>now+actionIdFutureMs)staleId();}
function operator(value){if(typeof value!=='string'||!/^[A-Za-z0-9_.:@-]{1,128}$/.test(value))fail();return value;}
function reason(value){if(typeof value!=='string'||!value.trim()||value.trim().length>500||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))fail();return value.trim();}
function time(value){if(typeof value!=='string'||!iso.test(value)||!Number.isFinite(Date.parse(value))||new Date(Date.parse(value)).toISOString()!==value)fail();return value;}
function subject(value){keys(value,['kind','id']);if(!['account','project'].includes(value.kind))fail();return {kind:value.kind,id:id(value.id)};}
export function containmentInput(raw){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>8192)fail();
 const v=JSON.parse(raw);if(!v||typeof v!=='object'||Array.isArray(v))fail();
 if(v.action==='status'){keys(v,['action','subject']);return {action:'status',subject:subject(v.subject)};}
 if(v.action==='contain'){
  keys(v,['action','id','subject','scopes','expiresAt','operator','reason']);
  const target=subject(v.subject);
  if(!v.scopes||typeof v.scopes!=='object'||Array.isArray(v.scopes)||!Object.keys(v.scopes).length||Object.keys(v.scopes).some(k=>!containmentScopes.includes(k)))fail();
  // Canonical order so the digest does not depend on JSON key order.
  const scopes={};
  for(const scope of containmentScopes){
   if(!Object.hasOwn(v.scopes,scope))continue;
   const effect=v.scopes[scope];
   if(effect==='freeze')scopes[scope]='freeze';
   else if(target.kind==='project'&&!freezeOnlyScopes.includes(scope)&&Number.isSafeInteger(effect)&&effect>=0&&effect<=containmentAllowances[scope].maximum&&effect!==containmentAllowances[scope].normal)scopes[scope]=effect;
   else fail();
  }
  return {action:'contain',id:actionId(v.id),subject:target,scopes,expiresAt:time(v.expiresAt),operator:operator(v.operator),reason:reason(v.reason)};
 }
 if(v.action==='stop-serving'){keys(v,['action','id','project','expiresAt','operator','reason']);return {action:'stop-serving',id:actionId(v.id),project:id(v.project),expiresAt:time(v.expiresAt),operator:operator(v.operator),reason:reason(v.reason)};}
 if(v.action==='revoke-sessions'){keys(v,['action','id','account','operator','reason']);return {action:'revoke-sessions',id:actionId(v.id),account:id(v.account),operator:operator(v.operator),reason:reason(v.reason)};}
 if(v.action==='lift'||v.action==='close'){keys(v,['action','id','operator','reason']);return {action:v.action,id:actionId(v.id),operator:operator(v.operator),reason:reason(v.reason)};}
 if(v.action==='cleanup'){keys(v,['action','id','before','operator']);return {action:'cleanup',id:actionId(v.id),before:time(v.before),operator:operator(v.operator)};}
 fail();
}
export function containmentDigest(input){return createHash('sha256').update(JSON.stringify({version:1,policy:'operator-containment-v1',input})).digest('hex');}
/** Binds the exact reviewed target state as well as the request, so any change between preview and apply is refused. */
export function reviewDigest(input,state){return createHash('sha256').update(JSON.stringify({version:1,policy:'operator-controls-v1',input,state})).digest('hex');}

const today="strftime('%Y-%m-%d','now')";
async function readSubject(db,target){
 if(target.kind==='account'){
  const account=await db.prepare('SELECT id FROM users WHERE id=?').bind(target.id).first();
  if(!account)return null;
  const {results}=await db.prepare('SELECT id FROM projects WHERE owner_user_id=? ORDER BY id').bind(target.id).all();
  return {kind:'account',id:target.id,projects:results.map(r=>r.id)};
 }
 const project=await db.prepare('SELECT id,owner_user_id FROM projects WHERE id=?').bind(target.id).first();
 return project?{kind:'project',id:target.id,account:project.owner_user_id,projects:[project.id]}:null;
}
/** Usage counters only (no content); bounded to the subject's projects. */
async function usage(db,projects){
 const rows=[];
 for(const project of projects.slice(0,100)){
  const row=await db.prepare(`SELECT
   coalesce((SELECT calls FROM backend_public_usage WHERE project_id=?1 AND day=${today}),0) AS backend,
   coalesce((SELECT attempts FROM app_daily_usage WHERE project_id=?1 AND day=${today}),0) AS transition,
   (SELECT count(*) FROM contact_receipts WHERE project_id=?1 AND created_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')) AS contact,
   coalesce((SELECT read_ops FROM storage_project_usage WHERE project_id=?1 AND period=strftime('%Y-%m','now')),0) AS photo,
   (SELECT count(*) FROM build_jobs WHERE project_id=?1 AND (state='running' OR cleanup<>'released')) AS build,
   EXISTS(SELECT 1 FROM operator_serving_stopped WHERE project_id=?1) AS serving`).bind(project).first();
  const effective={};
  for(const scope of containmentScopes){
   const active=await db.prepare('SELECT coalesce(allowance,0) AS allowance FROM operator_contained_projects WHERE project_id=? AND scope=? ORDER BY allowance IS NULL DESC,created_at DESC,id DESC LIMIT 1').bind(project,scope).first();
   effective[scope]={used:row[scope],allowance:active?active.allowance:containmentAllowances[scope].normal,contained:!!active};
  }
  rows.push({project,...effective,serving:{stopped:row.serving===1}});
 }
 return {projects:rows,truncated:projects.length>100};
}
const columns='id,scope,subject_kind,subject_id,allowance,operator_ref,reason,request_digest,created_at,expires_at,resolution,resolved_at,resolved_by,resolution_reason,resolution_digest';
/** `expired` is not resolution: it stays retained until an operator records `close` (owner decision October 8, 2026). */
const state=(r,now)=>r.resolution??(Date.parse(r.expires_at)<=now?'expired':'active');
const record=(r,now=Date.now())=>({id:r.id,scope:r.scope,subject:{kind:r.subject_kind,id:r.subject_id},effect:r.allowance===null?(r.scope==='serving'?'stop':'freeze'):r.allowance,operator:r.operator_ref,reason:r.reason,createdAt:r.created_at,expiresAt:r.expires_at,
 state:state(r,now),...(r.resolved_at?{resolvedAt:r.resolved_at,resolvedBy:r.resolved_by,resolutionReason:r.resolution_reason,retainedUntil:new Date(Date.parse(r.resolved_at)+retentionMs).toISOString()}:{})});
const revocationColumns='id,account_id,auth_epoch,credential_revision,sessions,operator_ref,reason,request_digest,review_digest,created_at';
const revocation=r=>({id:r.id,account:r.account_id,authEpoch:r.auth_epoch,credentialRevision:r.credential_revision,revokedSessions:JSON.parse(r.sessions).length,operator:r.operator_ref,reason:r.reason,createdAt:r.created_at,state:'completed',retainedUntil:new Date(Date.parse(r.created_at)+retentionMs).toISOString()});
async function history(db,target,now){
 // A project shows its own and its owner's account actions; an account shows its own and its projects' actions.
 const account=target.kind==='account'?target.id:target.account;
 const {results}=await db.prepare(`SELECT ${columns} FROM operator_containments WHERE (subject_kind='account' AND subject_id=?1) OR (subject_kind='project' AND (subject_id=?2 OR (?3 AND subject_id IN (SELECT id FROM projects WHERE owner_user_id=?1)))) ORDER BY created_at DESC,id,scope LIMIT 200`).bind(account,target.id,target.kind==='account'?1:0).all();
 return results.map(r=>record(r,now));
}
async function revocations(db,account){
 const {results}=await db.prepare(`SELECT ${revocationColumns} FROM operator_session_revocations WHERE account_id=? ORDER BY created_at DESC,id LIMIT 100`).bind(account).all();
 return results.map(revocation);
}
async function action(db,actionId){
 const {results}=await db.prepare(`SELECT ${columns} FROM operator_containments WHERE id=? ORDER BY scope`).bind(actionId).all();
 return results;
}
const notice='Operator-only. Customers see only the existing generic limit or busy responses; no containment, operator or reason is disclosed. Standard owner AI, workspace sessions, owner test runs, site HTML and stored data are unchanged. Nothing is deleted. A build freeze also cancels running and unpublished build jobs in scope (a test already sent is not recalled; saved drafts stay).';
const servingNotice='Operator-only serving stop for this one project. Public site pages, CMS articles and images, directory pages, photos, custom domains, guest previews, the contact form, the public backend, visitor application pages, configuration, modules, new visitor signups and visitor execution answer with their existing generic unavailable, limit or busy responses. Nothing is unpublished or edited: publications, reviewed versions, stored messages, visitor accounts and documents, files and safety holds stay as they are. The owner workspace (Chat, previews, exports, recovery) is unchanged, and existing visitors can still sign in, recover, export and delete their own application data. Expires automatically at expiresAt; lift earlier with a reviewed lift request. An expired stop stays retained until a reviewed close.';
const revocationNotice='Operator-only revocation of every listed workspace session for this account, applied atomically with this receipt like server-side sign-out. The owner then sees the ordinary signed-out state and can sign in again with a current passkey or recover with the recovery kit. Passkeys, the recovery kit, identity epoch, pending enrollment or recovery, projects, publications and all customer and visitor data are unchanged. Nothing is disclosed to the customer.';

async function servingState(db,input,now){
 const project=await db.prepare(`SELECT p.id,p.owner_user_id,
  (SELECT revision FROM publications WHERE project_id=p.id) AS site,
  (SELECT revision FROM backend_publications WHERE project_id=p.id) AS backend,
  (SELECT revision FROM app_spaces WHERE project_id=p.id) AS app FROM projects p WHERE p.id=?`).bind(input.project).first();
 if(!project)return null;
 const {results}=await db.prepare("SELECT id FROM operator_containments WHERE scope='serving' AND subject_id=? AND id<>? AND resolved_at IS NULL AND expires_at>? ORDER BY id").bind(input.project,input.id,new Date(now).toISOString()).all();
 return {project:project.id,account:project.owner_user_id,revisions:{site:project.site??null,backend:project.backend??null,app:project.app??null},activeStops:results.map(r=>r.id)};
}
async function identityState(db,account){
 const row=await db.prepare('SELECT account_id,stage,auth_epoch,credential_revision,kit_generation FROM identity_accounts WHERE account_id=?').bind(account).first();
 if(!row)return null;
 const sessions=(await db.prepare('SELECT json_group_array(id) AS ids FROM (SELECT id FROM identity_sessions WHERE account_id=? ORDER BY id)').bind(account).first()).ids;
 const preserved=await db.prepare(`SELECT (SELECT count(*) FROM identity_credentials WHERE account_id=?1 AND status='active') AS passkeys,(SELECT count(*) FROM identity_grants WHERE account_id=?1) AS grants`).bind(account).first();
 return {review:{account,stage:row.stage,authEpoch:row.auth_epoch,credentialRevision:row.credential_revision,sessions},preserved:{passkeys:preserved.passkeys,pendingEnrollmentOrRecoveryGrants:preserved.grants,kitGeneration:row.kit_generation}};
}
const held=(subjectColumn)=>`EXISTS(SELECT 1 FROM safety_preservation_holds h WHERE h.released_at IS NULL AND (h.subject_user_id=${subjectColumn} OR h.project_id=${subjectColumn} OR h.subject_user_id=(SELECT owner_user_id FROM projects WHERE id=${subjectColumn})))`;
async function cleanupState(db,cutoff,now){
 const nowIso=new Date(now).toISOString();
 const keysOf=async(sql,...values)=>(await db.prepare(sql).bind(...values).all()).results.map(r=>r.k);
 const candidates={
  containments:await keysOf(`SELECT id||':'||scope AS k FROM operator_containments WHERE resolved_at IS NOT NULL AND resolved_at<=? AND NOT ${held('subject_id')} ORDER BY resolved_at,id,scope LIMIT ${cleanupLimit}`,cutoff),
  revocations:await keysOf(`SELECT id AS k FROM operator_session_revocations WHERE created_at<=? AND NOT EXISTS(SELECT 1 FROM safety_preservation_holds WHERE released_at IS NULL AND subject_user_id=account_id) ORDER BY created_at,id LIMIT ${cleanupLimit}`,cutoff),
  receipts:await keysOf(`SELECT id AS k FROM operator_retention_receipts WHERE created_at<=? ORDER BY created_at,id LIMIT ${cleanupLimit}`,cutoff)
 };
 // Counts only: what this cutoff keeps, so unresolved records are visible rather than silently aged out.
 const retained=await db.prepare(`SELECT
  (SELECT count(*) FROM operator_containments WHERE resolved_at IS NULL AND expires_at>?1) AS active,
  (SELECT count(*) FROM operator_containments WHERE resolved_at IS NULL AND expires_at<=?1) AS expiredAwaitingClose,
  (SELECT count(*) FROM operator_containments WHERE resolved_at IS NOT NULL AND resolved_at>?2) AS resolvedWithinRetention,
  (SELECT count(*) FROM operator_containments WHERE resolved_at IS NOT NULL AND resolved_at<=?2 AND ${held('subject_id')}) AS heldBySafety,
  (SELECT count(*) FROM operator_session_revocations WHERE created_at>?2 OR EXISTS(SELECT 1 FROM safety_preservation_holds WHERE released_at IS NULL AND subject_user_id=account_id)) AS revocationsRetained,
  (SELECT count(*) FROM operator_retention_receipts) AS receiptsStored`).bind(nowIso,cutoff).first();
 // A cleanup adds one receipt and removes its listed old receipts; the schema refuses a result above the limit.
 const {receiptsStored,...kept}=retained;
 return {candidates,retained:kept,receiptCapacity:{stored:receiptsStored,limit:retentionReceiptLimit,afterCleanup:receiptsStored+1-candidates.receipts.length}};
}

export async function runContainment(db,input,apply,now=Date.now()){
 // Validate even when called outside the CLI, before any database access.
 input=containmentInput(JSON.stringify(input));
 const digest=containmentDigest(input),mutation=input.action!=='status';
 if(apply!==undefined&&(!mutation||typeof apply!=='string'||!/^[0-9a-f]{64}$/.test(apply)))throw Error('Preview this exact request before applying it');
 if(input.action==='status'){
  const target=await readSubject(db,input.subject);if(!target)throw Error('Subject not found');
  return {subject:target,containments:await history(db,target,now),sessionRevocations:await revocations(db,target.kind==='account'?target.id:target.account),usage:await usage(db,target.projects),notice};
 }
 if(input.action==='contain'){
  if(apply!==undefined&&apply!==digest)throw Error('Preview this exact request before applying it');
  const existing=await action(db,input.id);
  if(existing.length){
   if(existing.some(r=>r.request_digest!==digest))throw Error('Containment ID already used for a different request');
   if(apply!==undefined)return {applied:true,replayed:true,containments:existing.map(r=>record(r,now))};
  }
  if(!existing.length)fresh(input.id,now);
  const target=await readSubject(db,input.subject);if(!target)throw Error('Subject not found');
  const expires=Date.parse(input.expiresAt);
  if(!existing.length&&(expires<=now||expires>now+maximumContainmentMs))throw Error('Expiry must be in the future and at most 30 days away');
  if(apply===undefined)return {preview:true,request:input,subject:target,current:await history(db,target,now),usage:await usage(db,target.projects),
   effects:Object.fromEntries(Object.entries(input.scopes).map(([scope,effect])=>[scope,{effect,normal:containmentAllowances[scope].normal,unit:containmentAllowances[scope].unit}])),
   applyDigest:digest,notice:notice+' Expires automatically at expiresAt; lift earlier with a reviewed lift request. An expired action stays retained until a reviewed close.'};
  const scopes=Object.entries(input.scopes);
  await db.batch(scopes.map(([scope,effect])=>db.prepare(`INSERT INTO operator_containments(id,scope,subject_kind,subject_id,allowance,operator_ref,reason,request_digest,expires_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id,scope) DO NOTHING`)
   .bind(input.id,scope,input.subject.kind,input.subject.id,effect==='freeze'?null:effect,input.operator,input.reason,digest,input.expiresAt)));
  const saved=await action(db,input.id);
  if(saved.length!==scopes.length||saved.some(r=>r.request_digest!==digest))throw Error('Containment outcome uncertain; read status and retry the same request within one day');
  return {applied:true,replayed:false,containments:saved.map(r=>record(r,now))};
 }
 if(input.action==='stop-serving'){
  // The stored request_digest of a serving stop is its review digest (request plus exact reviewed project state).
  const existing=await action(db,input.id);
  if(existing.length){
   const [r]=existing;
   if(existing.length!==1||r.scope!=='serving'||r.subject_id!==input.project||r.expires_at!==input.expiresAt||r.operator_ref!==input.operator||r.reason!==input.reason)throw Error('Containment ID already used for a different request');
   if(apply===undefined)return {preview:false,alreadyApplied:true,containments:[record(r,now)]};
   if(apply!==r.request_digest)throw Error('Preview this exact request before applying it');
   return {applied:true,replayed:true,containments:[record(r,now)]};
  }
  fresh(input.id,now);
  const current=await servingState(db,input,now);if(!current)throw Error('Subject not found');
  const expires=Date.parse(input.expiresAt);
  if(expires<=now||expires>now+maximumContainmentMs)throw Error('Expiry must be in the future and at most 30 days away');
  if(current.activeStops.length)throw Error('Project serving is already stopped by an active action');
  const review=reviewDigest(input,current);
  if(apply===undefined)return {preview:true,request:input,state:current,current:await history(db,{kind:'project',id:current.project,account:current.account},now),applyDigest:review,notice:servingNotice};
  if(apply!==review)throw Error('Review is stale or differs; preview this exact request again');
  const r=current.revisions;
  const {results}=await db.prepare(`INSERT INTO operator_containments(id,scope,subject_kind,subject_id,allowance,operator_ref,reason,request_digest,expires_at)
   SELECT ?1,'serving','project',p.id,NULL,?2,?3,?4,?5 FROM projects p WHERE p.id=?6 AND p.owner_user_id=?7
    AND coalesce((SELECT revision FROM publications WHERE project_id=p.id),-1)=?8 AND coalesce((SELECT revision FROM backend_publications WHERE project_id=p.id),-1)=?9
    AND coalesce((SELECT revision FROM app_spaces WHERE project_id=p.id),-1)=?10 ON CONFLICT(id,scope) DO NOTHING RETURNING id`)
   .bind(input.id,input.operator,input.reason,review,input.expiresAt,current.project,current.account,r.site??-1,r.backend??-1,r.app??-1).all();
  const saved=await action(db,input.id);
  if(!saved.length&&!results.length)throw Error('Review is stale; the project changed after preview. Preview again');
  if(saved.length!==1||saved[0].request_digest!==review)throw Error('Serving stop outcome uncertain; read status and retry the same request within one day');
  return {applied:true,replayed:false,containments:saved.map(row=>record(row,now))};
 }
 if(input.action==='revoke-sessions'){
  const existing=await db.prepare(`SELECT ${revocationColumns} FROM operator_session_revocations WHERE id=?`).bind(input.id).first();
  if(existing){
   if(existing.request_digest!==digest)throw Error('Revocation ID already used for a different request');
   if(apply===undefined)return {preview:false,alreadyApplied:true,revocation:revocation(existing)};
   if(apply!==existing.review_digest)throw Error('Preview this exact request before applying it');
   return {applied:true,replayed:true,revocation:revocation(existing)};
  }
  fresh(input.id,now);
  const current=await identityState(db,input.account);if(!current)throw Error('Subject not found');
  if(!JSON.parse(current.review.sessions).length)throw Error('No workspace sessions to revoke');
  const review=reviewDigest(input,current.review);
  if(apply===undefined)return {preview:true,request:input,state:{...current.review,sessions:JSON.parse(current.review.sessions).length},preserved:current.preserved,
   history:await revocations(db,input.account),applyDigest:review,notice:revocationNotice};
  if(apply!==review)throw Error('Review is stale or differs; preview this exact request again');
  try{
   await db.prepare('INSERT INTO operator_session_revocations(id,account_id,auth_epoch,credential_revision,sessions,operator_ref,reason,request_digest,review_digest) VALUES(?,?,?,?,?,?,?,?,?)')
    .bind(input.id,input.account,current.review.authEpoch,current.review.credentialRevision,current.review.sessions,input.operator,input.reason,digest,review).run();
  }catch(error){
   const saved=await db.prepare(`SELECT ${revocationColumns} FROM operator_session_revocations WHERE id=?`).bind(input.id).first();
   if(saved&&saved.review_digest===review)return {applied:true,replayed:true,revocation:revocation(saved)};
   if(/operator_revocation_stale/.test(String(error?.message)))throw Error('Review is stale; account sessions or passkeys changed after preview. Preview again');
   if(/operator_revocation_invalid/.test(String(error?.message)))await refuseInvalid(db,input,now);
   throw Error('Revocation outcome uncertain; read status and retry the same request within one day');
  }
  const saved=await db.prepare(`SELECT ${revocationColumns} FROM operator_session_revocations WHERE id=?`).bind(input.id).first();
  if(!saved||saved.review_digest!==review)throw Error('Revocation outcome uncertain; read status and retry the same request within one day');
  return {applied:true,replayed:false,revocation:revocation(saved)};
 }
 if(input.action==='cleanup'){
  const existing=await db.prepare('SELECT id,cutoff,containments,revocations,receipts,operator_ref,request_digest,review_digest,created_at FROM operator_retention_receipts WHERE id=?').bind(input.id).first();
  const receipt=r=>({id:r.id,cutoff:r.cutoff,deleted:{containments:JSON.parse(r.containments).length,revocations:JSON.parse(r.revocations).length,receipts:JSON.parse(r.receipts).length},operator:r.operator_ref,createdAt:r.created_at});
  if(existing){
   if(existing.request_digest!==digest)throw Error('Cleanup ID already used for a different request');
   if(apply===undefined)return {preview:false,alreadyApplied:true,receipt:receipt(existing)};
   if(apply!==existing.review_digest)throw Error('Preview this exact request before applying it');
   return {applied:true,replayed:true,receipt:receipt(existing)};
  }
  fresh(input.id,now);
  if(Date.parse(input.before)>now-retentionMs)throw Error('Cleanup cutoff must be at least 90 days in the past');
  const current=await cleanupState(db,input.before,now),c=current.candidates;
  const review=reviewDigest(input,c),total=c.containments.length+c.revocations.length+c.receipts.length;
  const full=current.receiptCapacity.afterCleanup>retentionReceiptLimit;
  if(apply===undefined)return {preview:true,request:input,delete:{containments:c.containments.length,revocations:c.revocations.length,receipts:c.receipts.length},retained:current.retained,receiptCapacity:current.receiptCapacity,
   applyDigest:total&&!full?review:null,notice:'Deletes only records resolved (lifted or closed), completed or receipted at or before the cutoff, which must be at least 90 days ago, outside any safety hold. Active, expired-but-unclosed and held records are kept; close an expired action first. At most 500 of each kind per run. Each cleanup adds one receipt; at most 10000 receipts may remain after its deletions, so a full store needs at least one listed cleanup receipt over 90 days old.'};
  if(!total)throw Error('Nothing is eligible for cleanup');
  if(full)throw Error('Cleanup receipt storage is full and no cleanup receipt is old enough to remove; nothing was deleted');
  if(apply!==review)throw Error('Review is stale or differs; preview this exact request again');
  try{
   await db.prepare('INSERT INTO operator_retention_receipts(id,cutoff,containments,revocations,receipts,operator_ref,request_digest,review_digest) VALUES(?,?,?,?,?,?,?,?)')
    .bind(input.id,input.before,JSON.stringify(c.containments),JSON.stringify(c.revocations),JSON.stringify(c.receipts),input.operator,digest,review).run();
  }catch(error){
   const saved=await db.prepare('SELECT id,cutoff,containments,revocations,receipts,operator_ref,request_digest,review_digest,created_at FROM operator_retention_receipts WHERE id=?').bind(input.id).first();
   if(saved&&saved.review_digest===review)return {applied:true,replayed:true,receipt:receipt(saved)};
   if(/operator_retention_capacity/.test(String(error?.message)))throw Error('Cleanup receipt storage is full and no cleanup receipt is old enough to remove; nothing was deleted');
   if(/operator_retention_invalid/.test(String(error?.message)))await refuseInvalid(db,input,now,input.before);
   throw Error('Cleanup refused: a listed record changed, was removed or entered a safety hold. Preview again');
  }
  const saved=await db.prepare('SELECT id,cutoff,containments,revocations,receipts,operator_ref,request_digest,review_digest,created_at FROM operator_retention_receipts WHERE id=?').bind(input.id).first();
  if(!saved||saved.review_digest!==review)throw Error('Cleanup outcome uncertain; read status and retry the same request within one day');
  return {applied:true,replayed:false,receipt:receipt(saved)};
 }
 // lift (still active) or close (already expired): the single explicit resolution of every row of one action.
 if(apply!==undefined&&apply!==digest)throw Error('Preview this exact request before applying it');
 const rows=await action(db,input.id);if(!rows.length)throw Error('Containment not found');
 const resolution=input.action==='lift'?'lifted':'closed';
 if(rows.every(r=>r.resolution_digest===digest))return apply===undefined?{preview:false,alreadyResolved:true,containments:rows.map(r=>record(r,now))}:{applied:true,replayed:true,containments:rows.map(r=>record(r,now))};
 if(rows.some(r=>r.resolved_at!==null))throw Error('Containment already resolved by a different request');
 const expired=Date.parse(rows[0].expires_at)<=now;
 if(resolution==='lifted'&&expired)throw Error('Containment already expired; record a reviewed close instead');
 if(resolution==='closed'&&!expired)throw Error('Containment is still active; lift it instead');
 if(apply===undefined)return {preview:true,request:input,containments:rows.map(r=>record(r,now)),applyDigest:digest,
  notice:resolution==='lifted'?'Lifting restores the normal allowances and serving immediately. Usage already counted today stays counted, and build jobs cancelled by a freeze stay cancelled. The record is then retained for 90 days.':'Closing records that this expired action is resolved; it has no effect on customers. The record is then retained for 90 days.'};
 await db.prepare(`UPDATE operator_containments SET resolution=?,resolved_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),resolved_by=?,resolution_reason=?,resolution_digest=? WHERE id=? AND resolved_at IS NULL AND ${resolution==='lifted'?'expires_at>':'expires_at<='}strftime('%Y-%m-%dT%H:%M:%fZ','now')`)
  .bind(resolution,input.operator,input.reason,digest,input.id).run();
 const saved=await action(db,input.id);
 if(!saved.every(r=>r.resolution_digest===digest))throw Error(resolution==='lifted'?'Lift outcome uncertain; read status and retry the same request':'Close outcome uncertain; read status and retry the same request');
 return {applied:true,replayed:false,containments:saved.map(r=>record(r,now))};
}
