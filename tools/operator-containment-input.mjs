import {createHash} from 'node:crypto';
// WH-050 F7 / runbook G3: operator-only containment of one account or project's public allowances.
// Local operator CLI logic only (tools/operator-containment.mjs); never bundled into a Worker or customer endpoint.
// Enforcement lives in the public admission triggers (schema/platform.sql, operator_contained_projects), so no
// request path can bypass it, and customers only ever see the existing generic limit/busy responses.
// Nothing here deletes or edits customer data: an action inserts audit rows, a lift marks them lifted, rows expire.
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const iso=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
export const containmentScopes=Object.freeze(['backend','transition','contact','photo']);
/** Normal per-project allowance and the highest temporary allowance an operator may set (platform, account and fair-share ceilings never change). */
export const containmentAllowances=Object.freeze({
 backend:Object.freeze({normal:100,maximum:500,unit:'public backend calls per project per UTC day'}),
 transition:Object.freeze({normal:100,maximum:500,unit:'visitor transitions per project per UTC day'}),
 contact:Object.freeze({normal:20,maximum:100,unit:'contact submissions per project per rolling hour'}),
 photo:Object.freeze({normal:10000,maximum:50000,unit:'public photo reads per project per UTC month'})
});
export const maximumContainmentMs=30*86400000;
const fail=()=>{throw Error('Invalid operator containment request');};
function keys(value,allowed,required=allowed){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k))||required.some(k=>!Object.hasOwn(value,k)))fail();}
function id(value){if(typeof value!=='string'||!uuid.test(value))fail();return value;}
function operator(value){if(typeof value!=='string'||!/^[A-Za-z0-9_.:@-]{1,128}$/.test(value))fail();return value;}
function reason(value){if(typeof value!=='string'||!value.trim()||value.trim().length>500||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))fail();return value.trim();}
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
   else if(target.kind==='project'&&Number.isSafeInteger(effect)&&effect>=0&&effect<=containmentAllowances[scope].maximum&&effect!==containmentAllowances[scope].normal)scopes[scope]=effect;
   else fail();
  }
  if(typeof v.expiresAt!=='string'||!iso.test(v.expiresAt)||!Number.isFinite(Date.parse(v.expiresAt))||new Date(Date.parse(v.expiresAt)).toISOString()!==v.expiresAt)fail();
  return {action:'contain',id:id(v.id),subject:target,scopes,expiresAt:v.expiresAt,operator:operator(v.operator),reason:reason(v.reason)};
 }
 if(v.action==='lift'){keys(v,['action','id','operator','reason']);return {action:'lift',id:id(v.id),operator:operator(v.operator),reason:reason(v.reason)};}
 fail();
}
export function containmentDigest(input){return createHash('sha256').update(JSON.stringify({version:1,policy:'operator-containment-v1',input})).digest('hex');}

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
   coalesce((SELECT read_ops FROM storage_project_usage WHERE project_id=?1 AND period=strftime('%Y-%m','now')),0) AS photo`).bind(project).first();
  const effective={};
  for(const scope of containmentScopes){
   const active=await db.prepare('SELECT coalesce(allowance,0) AS allowance FROM operator_contained_projects WHERE project_id=? AND scope=? ORDER BY allowance IS NULL DESC,created_at DESC,id DESC LIMIT 1').bind(project,scope).first();
   effective[scope]={used:row[scope],allowance:active?active.allowance:containmentAllowances[scope].normal,contained:!!active};
  }
  rows.push({project,...effective});
 }
 return {projects:rows,truncated:projects.length>100};
}
const columns='id,scope,subject_kind,subject_id,allowance,operator_ref,reason,request_digest,created_at,expires_at,lifted_at,lift_operator_ref,lift_reason,lift_digest';
const record=r=>({id:r.id,scope:r.scope,subject:{kind:r.subject_kind,id:r.subject_id},effect:r.allowance===null?'freeze':r.allowance,operator:r.operator_ref,reason:r.reason,createdAt:r.created_at,expiresAt:r.expires_at,
 state:r.lifted_at?'lifted':Date.parse(r.expires_at)<=Date.now()?'expired':'active',...(r.lifted_at?{liftedAt:r.lifted_at,liftedBy:r.lift_operator_ref,liftReason:r.lift_reason}:{})});
async function history(db,target){
 // A project shows its own and its owner's account actions; an account shows its own and its projects' actions.
 const account=target.kind==='account'?target.id:target.account;
 const {results}=await db.prepare(`SELECT ${columns} FROM operator_containments WHERE (subject_kind='account' AND subject_id=?1) OR (subject_kind='project' AND (subject_id=?2 OR (?3 AND subject_id IN (SELECT id FROM projects WHERE owner_user_id=?1)))) ORDER BY created_at DESC,id,scope LIMIT 200`).bind(account,target.id,target.kind==='account'?1:0).all();
 return results.map(record);
}
async function action(db,actionId){
 const {results}=await db.prepare(`SELECT ${columns} FROM operator_containments WHERE id=? ORDER BY scope`).bind(actionId).all();
 return results;
}
const notice='Operator-only. Customers see only the existing generic limit or busy responses; no containment, operator or reason is disclosed. Standard owner AI, workspace sessions, owner test runs, site HTML and stored data are unchanged. Nothing is deleted.';

export async function runContainment(db,input,apply,now=Date.now()){
 // Validate even when called outside the CLI, before any database access.
 input=containmentInput(JSON.stringify(input));
 const digest=containmentDigest(input),mutation=input.action!=='status';
 if(apply!==undefined&&(!mutation||apply!==digest))throw Error('Preview this exact request before applying it');
 if(input.action==='status'){
  const target=await readSubject(db,input.subject);if(!target)throw Error('Subject not found');
  return {subject:target,containments:await history(db,target),usage:await usage(db,target.projects),notice};
 }
 if(input.action==='contain'){
  const existing=await action(db,input.id);
  if(existing.length){
   if(existing.some(r=>r.request_digest!==digest))throw Error('Containment ID already used for a different request');
   if(apply!==undefined)return {applied:true,replayed:true,containments:existing.map(record)};
  }
  const target=await readSubject(db,input.subject);if(!target)throw Error('Subject not found');
  const expires=Date.parse(input.expiresAt);
  if(!existing.length&&(expires<=now||expires>now+maximumContainmentMs))throw Error('Expiry must be in the future and at most 30 days away');
  if(apply===undefined)return {preview:true,request:input,subject:target,current:await history(db,target),usage:await usage(db,target.projects),
   effects:Object.fromEntries(Object.entries(input.scopes).map(([scope,effect])=>[scope,{effect,normal:containmentAllowances[scope].normal,unit:containmentAllowances[scope].unit}])),
   applyDigest:digest,notice:notice+' Expires automatically at expiresAt; lift earlier with a reviewed lift request.'};
  const scopes=Object.entries(input.scopes);
  await db.batch(scopes.map(([scope,effect])=>db.prepare(`INSERT INTO operator_containments(id,scope,subject_kind,subject_id,allowance,operator_ref,reason,request_digest,expires_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id,scope) DO NOTHING`)
   .bind(input.id,scope,input.subject.kind,input.subject.id,effect==='freeze'?null:effect,input.operator,input.reason,digest,input.expiresAt)));
  const saved=await action(db,input.id);
  if(saved.length!==scopes.length||saved.some(r=>r.request_digest!==digest))throw Error('Containment outcome uncertain; read status and retry the same request');
  return {applied:true,replayed:false,containments:saved.map(record)};
 }
 const rows=await action(db,input.id);if(!rows.length)throw Error('Containment not found');
 if(rows.every(r=>r.lift_digest===digest))return apply===undefined?{preview:false,alreadyLifted:true,containments:rows.map(record)}:{applied:true,replayed:true,containments:rows.map(record)};
 if(rows.some(r=>r.lifted_at!==null))throw Error('Containment already lifted by a different request');
 if(apply===undefined)return {preview:true,request:input,containments:rows.map(record),applyDigest:digest,notice:'Lifting restores the normal allowances immediately. Usage already counted today stays counted.'};
 await db.prepare("UPDATE operator_containments SET lifted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),lift_operator_ref=?,lift_reason=?,lift_digest=? WHERE id=? AND lifted_at IS NULL").bind(input.operator,input.reason,digest,input.id).run();
 const saved=await action(db,input.id);
 if(!saved.every(r=>r.lift_digest===digest))throw Error('Lift outcome uncertain; read status and retry the same request');
 return {applied:true,replayed:false,containments:saved.map(record)};
}
