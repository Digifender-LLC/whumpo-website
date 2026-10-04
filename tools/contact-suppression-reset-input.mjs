import {createHash} from 'node:crypto';
// WH-036 operator-reviewed reset of one permanent contact-notice suppression (owner decision, October 4, 2026, issue #146).
// Local operator CLI logic only (tools/contact-suppression-reset.mjs); never bundled into a Worker or customer endpoint.
// The database enforces the boundary: a reset must name the exact current suppression (contact_suppression_reset_insert),
// its audit row is immutable, and the suppressed destination it removes is refused inside a safety preservation hold.
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const iso=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const fail=()=>{throw Error('Invalid contact suppression reset request');};
function keys(value,allowed){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k))||allowed.some(k=>!Object.hasOwn(value,k)))fail();}
function id(value){if(typeof value!=='string'||!uuid.test(value))fail();return value;}
function address(value){if(typeof value!=='string')fail();const v=value.trim().toLowerCase();if(v.length<3||v.length>254||!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(v))fail();return v;}
function operator(value){if(typeof value!=='string'||!/^[A-Za-z0-9_.:@-]{1,128}$/.test(value))fail();return value;}
function reason(value){if(typeof value!=='string'||!value.trim()||value.trim().length>500||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))fail();return value.trim();}
export function suppressionResetInput(raw){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>8192)fail();
 const v=JSON.parse(raw);if(!v||typeof v!=='object'||Array.isArray(v))fail();
 if(v.action==='status'){keys(v,['action','account','address']);return {action:'status',account:id(v.account),address:address(v.address)};}
 if(v.action==='reset'){
  keys(v,['action','id','account','address','suppressedAt','operator','reason']);
  if(typeof v.suppressedAt!=='string'||!iso.test(v.suppressedAt)||!Number.isFinite(Date.parse(v.suppressedAt)))fail();
  return {action:'reset',id:id(v.id),account:id(v.account),address:address(v.address),suppressedAt:v.suppressedAt,operator:operator(v.operator),reason:reason(v.reason)};
 }
 fail();
}
export function suppressionResetDigest(input){return createHash('sha256').update(JSON.stringify({version:1,policy:'contact-suppression-reset-v1',input})).digest('hex');}
const notice='Operator-only. A reset removes this one Whumpo suppression and the final-suppressed notification address for the account\'s projects; nothing is sent and nothing is re-verified. The owner must set the address again and verify a new code before any notice. It does not change the provider: also confirm the address is absent from the Cloudflare Email Service suppression list (Email Sending → Suppressions) or the next send is refused and suppresses it again. Reset only after the recipient has opted in again.';
async function status(db,account,addr){
 const suppression=await db.prepare('SELECT reason,created_at FROM contact_notification_suppressions WHERE user_id=? AND address=?').bind(account,addr).first();
 const {results:destinations}=await db.prepare('SELECT project_id,state,EXISTS(SELECT 1 FROM safety_held_projects h WHERE h.project_id=d.project_id) AS held FROM contact_notification_destinations d WHERE user_id=? AND address=? ORDER BY project_id').bind(account,addr).all();
 const {results:resets}=await db.prepare('SELECT id,suppression_reason,suppressed_at,operator_ref,reason,created_at FROM contact_notification_suppression_resets WHERE user_id=? AND address=? ORDER BY created_at DESC,id LIMIT 50').bind(account,addr).all();
 return {account,address:addr,suppression:suppression?{reason:suppression.reason,suppressedAt:suppression.created_at}:null,destinations:destinations.map(d=>({project:d.project_id,state:d.state,held:!!d.held})),resets:resets.map(r=>({id:r.id,reason:r.suppression_reason,suppressedAt:r.suppressed_at,operator:r.operator_ref,note:r.reason,createdAt:r.created_at}))};
}
export async function runSuppressionReset(db,input,apply){
 // Validate even when called outside the CLI, before any database access.
 input=suppressionResetInput(JSON.stringify(input));
 const digest=suppressionResetDigest(input);
 if(apply!==undefined&&(input.action!=='reset'||apply!==digest))throw Error('Preview this exact request before applying it');
 if(input.action==='status')return {...await status(db,input.account,input.address),notice};
 const existing=await db.prepare('SELECT request_digest FROM contact_notification_suppression_resets WHERE id=?').bind(input.id).first();
 if(existing){if(existing.request_digest!==digest)throw Error('Reset ID already used for a different request');return apply===undefined?{preview:false,alreadyApplied:true,...await status(db,input.account,input.address)}:{applied:true,replayed:true,...await status(db,input.account,input.address)};}
 const current=await status(db,input.account,input.address);
 if(!current.suppression||current.suppression.suppressedAt!==input.suppressedAt)throw Error('Suppression not found or changed; read status again');
 if(current.destinations.some(d=>d.held&&d.state==='suppressed'))throw Error('A safety preservation hold covers a project using this address; the reset is refused while held');
 if(apply===undefined)return {preview:true,request:input,current,applyDigest:digest,notice};
 try{await db.prepare('INSERT INTO contact_notification_suppression_resets(id,user_id,address,suppression_reason,suppressed_at,operator_ref,reason,request_digest) VALUES(?,?,?,?,?,?,?,?)').bind(input.id,input.account,input.address,current.suppression.reason,input.suppressedAt,input.operator,input.reason,digest).run();}
 catch(cause){if(String(cause).includes('safety_preservation_hold'))throw Error('A safety preservation hold covers a project using this address; the reset is refused while held');if(String(cause).includes('contact_suppression_reset_stale'))throw Error('Suppression not found or changed; read status again');throw cause;}
 const saved=await db.prepare('SELECT request_digest FROM contact_notification_suppression_resets WHERE id=?').bind(input.id).first();
 if(saved?.request_digest!==digest)throw Error('Reset outcome uncertain; read status and retry the same request');
 return {applied:true,replayed:false,...await status(db,input.account,input.address)};
}
