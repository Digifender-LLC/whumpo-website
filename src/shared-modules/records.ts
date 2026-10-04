import {canonicalJSON,jsonDigest,plain} from '../project-specification/v2/json';
import type {RecordField,RecordsConfig} from '../project-specification/v3/modules';
import {ModuleError,type ModulePrincipal} from './policy';
import {instanceOf,type RegistryRow} from './registry';
import type {ModuleContext,ModuleHandlers,ModuleReadHandler,ModuleWriteHandler} from './api';

/** WH-127 records and forms module (docs/shared-modules.md#records-and-forms-module-wh-127--october-4-2026-utc).
 * Deterministic handlers over `module_records` in the shared control D1: no inference, provider, network, model context
 * or Chat history. Every handler runs after the shared resolver and policy decision (api.ts) and re-applies the field
 * projection and record scope itself; the committing batch carries the engine's receipt, whose trigger repeats the
 * instance, revision, pin and principal decision, and the content-free `module_record_events` row, whose trigger checks
 * that this request's record write actually happened (create, revision compare-and-swap or removal). Submitted values
 * are returned only to principals whose decision allows those fields, and never appear in errors or receipts. */
type Schema=RecordsConfig['schemas'][number];
type RecordRow={id:string;schema_id:string;fields_revision:number;submitter_kind:'public'|'visitor'|'staff';visitor_id:string|null;values_json:string;revision:number;created_at:number;updated_at:number};
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
const localId=(v:unknown):v is string=>typeof v==='string'&&/^[a-z][a-z0-9-]{0,39}$/.test(v);
const invalid=()=>new ModuleError('invalid_request');
const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>plain(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const iso=(seconds:number)=>new Date(seconds*1000).toISOString();
const control=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const recordColumns='r.id,r.schema_id,r.fields_revision,r.submitter_kind,r.visitor_id,r.values_json,r.revision,r.created_at,r.updated_at';

function config(context:ModuleContext):RecordsConfig{
 if(context.resource.instance.kind!=='records')throw new ModuleError('not_found');
 return context.resource.instance.config;
}
/** One submitted or changed value, checked against the field's current shape (the bounded backend-form field contract:
 * text up to 300 characters, finite numbers, booleans, fixed choice values). Never echoed. */
function fieldValue(field:RecordField,value:unknown){
 if(field.type==='text'){if(typeof value!=='string'||value.length>300||control.test(value)||!field.optional&&!value.trim())throw invalid();return value;}
 if(field.type==='number'){if(typeof value!=='number'||!Number.isFinite(value))throw invalid();return value;}
 if(field.type==='boolean'){if(typeof value!=='boolean')throw invalid();return value;}
 if(field.type!=='choice'||typeof value!=='string'||!field.options.some(o=>o.value===value))throw invalid();
 return value;
}
/** `input: {values}`: every required field, optional fields may be omitted (stored as absent), no other key. Values are
 * nested so field keys never collide with the envelope's authority-key refusal. */
function submittedValues(schema:Schema,input:unknown){
 if(!exact(input,['values'])||!plain(input.values))throw invalid();
 const values=input.values,out:Record<string,unknown>={};
 if(Object.keys(values).some(k=>!schema.fields.some(f=>f.key===k)))throw invalid();
 for(const field of schema.fields){
  if(!Object.hasOwn(values,field.key)){if(field.optional)continue;throw invalid();}
  out[field.key]=fieldValue(field,values[field.key]);
 }
 return out;
}
/** Only the decision's fields, and only those present: a field added later is reported absent, never backfilled. */
function project(values:Record<string,unknown>,fields:string[]){
 return Object.fromEntries(fields.filter(k=>Object.hasOwn(values,k)).map(k=>[k,values[k]]));
}
const visitorOf=(p:ModulePrincipal)=>p.kind==='visitor'?p:null;
/** Current retention: a record is readable and kept only while inside both the window stored at submission and the
 * instance's current `retentionDays` (shortening applies at once; lengthening never revives or extends a record). */
const live=(retentionDays:number)=>({sql:'r.expires_at>unixepoch() AND r.created_at>unixepoch()-?',params:[retentionDays*86400]});
async function readRecord(db:D1Database,context:ModuleContext,schemaId:string,entryId:string){
 const visitor=visitorOf(context.principal),own=context.decision.scope==='own',window=live(config(context).retentionDays);
 if(own&&!visitor)throw new ModuleError('forbidden');
 const row=await db.prepare(`SELECT ${recordColumns} FROM module_records r WHERE r.id=? AND r.instance_id=? AND r.project_id=? AND r.schema_id=? AND ${window.sql}${own?' AND r.visitor_id=?':''}`)
  .bind(entryId,context.resource.resourceId,context.resource.projectId,schemaId,...window.params,...(own?[visitor!.visitorId]:[])).first<RecordRow>();
 // Foreign, missing, expired and other visitors' records are one generic not_found.
 if(!row)throw new ModuleError('not_found');
 return row;
}
function schemaOf(context:ModuleContext,schemaId:unknown){
 const schema=localId(schemaId)?config(context).schemas.find(s=>s.id===schemaId):undefined;
 if(!schema)throw new ModuleError('not_found');
 return schema;
}
function view(row:RecordRow,fields:string[],owner:boolean){
 return {entryId:row.id,fieldsRevision:row.fields_revision,revision:row.revision,createdAt:iso(row.created_at),updatedAt:iso(row.updated_at),submittedBy:row.submitter_kind,
  ...(owner?{visitorId:row.visitor_id}:{}),values:project(JSON.parse(row.values_json),fields)};
}
function event(db:D1Database,context:ModuleContext,entryId:string,kind:'form.accepted'|'record.updated'|'record.removed',revision:number,now:number){
 return db.prepare('INSERT INTO module_record_events(instance_id,request_id,project_id,entry_id,event,revision,created_at) VALUES(?,?,?,?,?,?,?)')
  .bind(context.resource.resourceId,context.request.requestId,context.resource.projectId,entryId,kind,revision,now);
}

/** forms.submit — visitor and staff intake through the access session, and anonymous intake on `public` forms. An
 * anonymous submission reaches this handler only after the engine ran the visitor gateway's public admission (the contact
 * form's Turnstile Siteverify and per-connection allowance); `module_record_admit` repeats the public form, live
 * publication and the contact-equivalent atomic caps inside the commit. Forms with an upload collection wait for the
 * files module (WH-128). Result: opaque entry id only. */
const submit:ModuleWriteHandler=async(db,context)=>{
 const visitor=visitorOf(context.principal);
 if(!visitor&&context.principal.kind!=='public')throw new ModuleError('forbidden');
 if(!exact(context.request.target,['formId']))throw invalid();
 const form=config(context).forms.find(f=>f.id===context.request.target!.formId);if(!form)throw new ModuleError('not_found');
 if(!visitor&&form.submit!=='public')throw new ModuleError('forbidden');
 if(form.uploadCollectionId!==null)throw new ModuleError('unavailable','Attachments for this form are not available yet.');
 const schema=schemaOf(context,form.recordId),values=submittedValues(schema,context.request.input);
 const entryId=crypto.randomUUID(),now=Math.floor(Date.now()/1000),retention=config(context).retentionDays*86400;
 const submitter=visitor?(visitor.roles.length?'staff':'visitor'):'public';
 return {statements:[
  db.prepare('INSERT INTO module_records(id,instance_id,project_id,schema_id,form_id,fields_revision,submitter_kind,visitor_id,values_json,revision,created_request_id,last_request_id,created_at,updated_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,1,?,?,?,?,?)')
   .bind(entryId,context.resource.resourceId,context.resource.projectId,schema.id,form.id,schema.fieldsRevision,submitter,visitor?.visitorId??null,canonicalJSON(values,8192),context.request.requestId,context.request.requestId,now,now,now+retention),
  event(db,context,entryId,'form.accepted',1,now)
 ],result:{accepted:true,formId:form.id,entryId}};
};

/** records.get — owner: every field of any record; staff: non-owner fields of any record; a visitor: submitter fields of
 * their own records only (policy decision `fields`/`scope`, re-applied in the query and the projection). */
const get:ModuleReadHandler=async(db,context)=>{
 if(!exact(context.request.target,['recordId','entryId'])||!uuid(context.request.target.entryId)||context.request.input!==null)throw invalid();
 const schema=schemaOf(context,context.request.target.recordId);
 return view(await readRecord(db,context,schema.id,context.request.target.entryId),context.decision.fields??[],context.principal.kind==='owner');
};

type Cursor={v:1;k:string;c:number;a:number;t:number;i:string};
const encode=(c:Cursor)=>btoa(JSON.stringify(c)).replace(/=+$/,'').replace(/\+/g,'-').replace(/\//g,'_');
function decode(value:unknown):Cursor|null{
 if(value===null)return null;
 if(typeof value!=='string'||value.length>400||!/^[A-Za-z0-9_-]+$/.test(value))throw invalid();
 try{
  const c=JSON.parse(atob(value.replace(/-/g,'+').replace(/_/g,'/')));
  if(exact(c,['v','k','c','a','t','i'])&&c.v===1&&typeof c.k==='string'&&Number.isSafeInteger(c.c)&&Number.isSafeInteger(c.a)&&Number.isSafeInteger(c.t)&&uuid(c.i))return c as Cursor;
 }catch{/* malformed */}
 throw invalid();
}
/** Opaque cursor bound to the project resource, view, principal, configRevision and access revision: after any of them
 * changes (reconfiguration, role change, revocation) the cursor is stale and the client reloads from the start. */
async function page(db:D1Database,where:{sql:string;params:unknown[]},binding:{key:string;configRevision:number;accessRevision:number},limit:number,after:unknown){
 const cursor=decode(after);
 if(cursor&&(cursor.k!==binding.key||cursor.c!==binding.configRevision||cursor.a!==binding.accessRevision))throw new ModuleError('stale_configuration');
 const {results}=await db.prepare(`SELECT ${recordColumns} FROM module_records r WHERE ${where.sql}${cursor?' AND (r.created_at<? OR r.created_at=? AND r.id<?)':''} ORDER BY r.created_at DESC,r.id DESC LIMIT ?`)
  .bind(...where.params,...(cursor?[cursor.t,cursor.t,cursor.i]:[]),limit+1).all<RecordRow>();
 const rows=results.slice(0,limit),last=rows.at(-1);
 return {rows,next:results.length>limit&&last?encode({v:1,k:binding.key,c:binding.configRevision,a:binding.accessRevision,t:last.created_at,i:last.id}):null};
}
/** records.view — a configured staff or visitor view: its fields only, `own` scope limited to the caller's records. */
const list:ModuleReadHandler=async(db,context)=>{
 const visitor=visitorOf(context.principal),t=context.request.target;
 if(!visitor||!exact(t,['viewId','cursor'])||context.request.input!==null)throw new ModuleError(visitor?'invalid_request':'forbidden');
 const v=config(context).views.find(x=>x.id===t.viewId);if(!v)throw new ModuleError('not_found');
 const own=context.decision.scope==='own',window=live(config(context).retentionDays),fields=context.decision.fields??[];
 const where={sql:`r.instance_id=? AND r.project_id=? AND r.schema_id=? AND ${window.sql}${own?' AND r.visitor_id=?':''}`,params:[context.resource.resourceId,context.resource.projectId,v.recordId,...window.params,...(own?[visitor.visitorId]:[])]};
 const key=await jsonDigest(['view',context.resource.resourceId,v.id,visitor.visitorId,visitor.sessionHash]);
 const {rows,next}=await page(db,where,{key,configRevision:context.resource.configRevision,accessRevision:visitor.accessRevision},v.limit,t.cursor);
 return {viewId:v.id,items:rows.map(r=>view(r,fields,false)),next};
};

/** records.update — owner (any field) or current staff (only `staffWrite` fields, decided from `target.changes` by the
 * policy table). Compare-and-swap on the record revision; `null` clears an optional field. */
const update:ModuleWriteHandler=async(db,context)=>{
 const t=context.request.target;
 if(!exact(t,['recordId','entryId','revision','changes'])||!uuid(t.entryId)||!Number.isSafeInteger(t.revision)||Number(t.revision)<1||!plain(t.changes)||context.request.input!==null)throw invalid();
 const schema=schemaOf(context,t.recordId),allowed=context.decision.fields??[],changes=t.changes;
 const keys=Object.keys(changes);
 if(!keys.length||keys.some(k=>!allowed.includes(k)))throw new ModuleError('forbidden');
 const row=await readRecord(db,context,schema.id,t.entryId);
 if(row.revision!==t.revision)throw new ModuleError('stale_configuration','This record changed. Reload it and try again.');
 const values=JSON.parse(row.values_json) as Record<string,unknown>;
 for(const key of keys){
  const field=schema.fields.find(f=>f.key===key);if(!field)throw new ModuleError('forbidden');
  if(changes[key]===null){if(!field.optional)throw invalid();delete values[key];}
  else values[key]=fieldValue(field,changes[key]);
 }
 const now=Math.max(Math.floor(Date.now()/1000),row.updated_at),next=row.revision+1;
 return {statements:[
  db.prepare('UPDATE module_records SET values_json=?,revision=?,last_request_id=?,updated_at=? WHERE id=? AND instance_id=? AND project_id=? AND revision=?')
   .bind(canonicalJSON(values,8192),next,context.request.requestId,now,row.id,context.resource.resourceId,context.resource.projectId,row.revision),
  event(db,context,row.id,'record.updated',next,now)
 ],result:{entryId:row.id,revision:next}};
};

/** records.remove — owner only, in every activation state. Refused while the project is inside an active safety
 * preservation hold (the `safety_hold_module_record_retained` trigger repeats this inside the commit). */
const remove:ModuleWriteHandler=async(db,context)=>{
 const t=context.request.target;
 if(context.principal.kind!=='owner')throw new ModuleError('forbidden');
 if(!exact(t,['recordId','entryId'])||!uuid(t.entryId)||context.request.input!==null)throw invalid();
 const schema=schemaOf(context,t.recordId);
 const row=await db.prepare('SELECT id,revision FROM module_records WHERE id=? AND instance_id=? AND project_id=? AND schema_id=?').bind(t.entryId,context.resource.resourceId,context.resource.projectId,schema.id).first<{id:string;revision:number}>();
 if(!row)throw new ModuleError('not_found');
 if(await db.prepare('SELECT 1 FROM safety_held_projects WHERE project_id=?').bind(context.resource.projectId).first())throw new ModuleError('unavailable','This record is retained while a safety review is open.');
 const now=Math.floor(Date.now()/1000);
 return {statements:[
  db.prepare('DELETE FROM module_records WHERE id=? AND instance_id=? AND project_id=?').bind(row.id,context.resource.resourceId,context.resource.projectId),
  event(db,context,row.id,'record.removed',row.revision,now)
 ],result:{entryId:row.id,removed:true}};
};

/** Delivered records handlers (WH-127). */
export const recordsHandlers:ModuleHandlers=Object.freeze({'forms.submit':submit,'records.get':get,'records.view':list,'records.update':update,'records.remove':remove});

/** Owner records list for the dashboard (workspace origin only): every field of one schema of one owned records instance,
 * newest first, 50 per page, in every activation state so owners keep access to collected data after disable or plan
 * loss. Never a Chat binding or model input. */
export async function readOwnerRecords(db:D1Database,user:string,project:string,resourceId:string,schemaId:string,after:string|null){
 if(!uuid(project)||!uuid(resourceId)||!localId(schemaId))throw new ModuleError('not_found');
 const row=await db.prepare(`SELECT i.id,i.project_id,i.local_id,i.kind,i.module_digest,i.schema_digest,i.config_json,i.config_digest,i.config_revision FROM module_instances i JOIN projects p ON p.id=i.project_id
  WHERE i.id=? AND i.project_id=? AND p.owner_user_id=? AND i.kind='records'`).bind(resourceId,project,user).first<RegistryRow>();
 if(!row)throw new ModuleError('not_found');
 const instance=await instanceOf(row);if(instance.kind!=='records')throw new ModuleError('not_found');
 const schema=instance.config.schemas.find(s=>s.id===schemaId);if(!schema)throw new ModuleError('not_found');
 const window=live(instance.config.retentionDays),fields=schema.fields.map(f=>f.key);
 const {rows,next}=await page(db,{sql:`r.instance_id=? AND r.project_id=? AND r.schema_id=? AND ${window.sql}`,params:[resourceId,project,schema.id,...window.params]},
  {key:await jsonDigest(['owner',resourceId,schema.id,user]),configRevision:row.config_revision,accessRevision:0},50,after);
 return {resourceId,recordId:schema.id,configRevision:row.config_revision,fields:schema.fields.map(f=>({key:f.key,label:f.label,type:f.type})),items:rows.map(r=>view(r,fields,true)),next};
}

/** Retention expiry (scheduled): records past their stored window or the instance's current `retentionDays`, in bounded
 * batches. Projects inside an active safety preservation hold are skipped; the delete trigger backs this. */
export async function cleanupModuleRecords(db:D1Database){
 await db.prepare(`DELETE FROM module_records WHERE id IN (SELECT r.id FROM module_records r JOIN module_instances i ON i.id=r.instance_id
  WHERE (r.expires_at<=unixepoch() OR r.created_at<=unixepoch()-86400*json_extract(i.config_json,'$.retentionDays'))
  AND r.project_id NOT IN (SELECT project_id FROM safety_held_projects) LIMIT 500)`).run();
}
