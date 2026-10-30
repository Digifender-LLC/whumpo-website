import {hashToken} from '../security';
import {jsonDigest,plain} from '../project-specification/v2/json';
import {validateInstances,type RecordField} from '../project-specification/v3/modules';
import {assertWorkspace} from '../workspace-identity/admission';
import {ModuleError} from './policy';
import {instanceOf,type RegistryRow} from './registry';
import {fieldValue,live,page} from './records';
import {recordsExportHook} from './export-hooks';

/** WH-127 records descriptor export hook `records-export-v1` (WH-071 lifecycle; WH-077 composes it, no route serves it).
 * It serializes one schema of one records instance's `module-records` data set: the currently retained records (the
 * stored window and the instance's current `retentionDays`) with every field value, newest first, 200 per page with an
 * opaque cursor. With `visitorId` it is limited to that visitor's own submissions, the visitor-subject slice WH-077 hands
 * out only under its separate approval. The data set stays `separate-approval` in the descriptor, so this owner-run
 * serializer is never part of a default profile export. Values are returned to the owner's caller only: they never enter
 * Chat, model context, receipts, events or logs. Content-free events, request receipts and Siteverify results are not
 * exported. Deterministic: no inference, provider, network or Chat history. */
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const local=/^[a-z][a-z0-9-]{0,39}$/;
const iso=(seconds:number)=>new Date(seconds*1000).toISOString();
const pageSize=200;
type ExportField={key:string;label:string;type:RecordField['type'];optional:boolean;read:RecordField['read'];options?:{value:string;label:string}[]};
type ExportRecord={entryId:string;formId:string;fieldsRevision:number;submittedBy:'public'|'visitor'|'staff';visitorId:string|null;revision:number;createdAt:string;updatedAt:string;expiresAt:string;values:Record<string,unknown>;attachments:string[]};
export type RecordsExportOptions={recordId:string;visitorId?:string|null;after?:string|null};

/** Owner only (current workspace identity and project ownership), in every activation state and with the catalog pin
 * withdrawn or restaged; the registered descriptor must name this hook and the caller's configRevision must be current. */
export async function exportRecords(db:D1Database,user:string,project:string,resourceId:string,configRevision:number,options:RecordsExportOptions){
 await assertWorkspace(db,user);
 const subject=options.visitorId??null,after=options.after??null;
 if(!uuid.test(project)||!uuid.test(resourceId))throw new ModuleError('not_found');
 if(typeof options.recordId!=='string'||!local.test(options.recordId)||subject!==null&&(typeof subject!=='string'||!uuid.test(subject)))throw new ModuleError('invalid_request');
 const row=await db.prepare(`SELECT i.id,i.project_id,i.local_id,i.kind,i.module_digest,i.schema_digest,i.config_json,i.config_digest,i.config_revision,i.descriptor_json FROM module_instances i JOIN projects p ON p.id=i.project_id
  WHERE i.id=? AND i.project_id=? AND p.owner_user_id=?`).bind(resourceId,project,user).first<RegistryRow>();
 if(!row||row.kind!=='records')throw new ModuleError('not_found');
 if(row.config_revision!==configRevision)throw new ModuleError('stale_configuration');
 if((JSON.parse(row.descriptor_json) as {lifecycle?:{exportHook?:unknown}}).lifecycle?.exportHook!==recordsExportHook)throw new ModuleError('unavailable');
 const instance=await instanceOf(row);if(instance.kind!=='records')throw new ModuleError('not_found');
 const schema=instance.config.schemas.find(s=>s.id===options.recordId);if(!schema)throw new ModuleError('not_found');
 // A subject export names one of this project's visitor identities; another project's visitor is a generic not_found.
 if(subject&&!await db.prepare('SELECT 1 FROM app_visitors WHERE id=? AND project_id=?').bind(subject,project).first())throw new ModuleError('not_found');
 const window=live(instance.config.retentionDays);
 const where={sql:`r.instance_id=? AND r.project_id=? AND r.schema_id=? AND ${window.sql}${subject?' AND r.visitor_id=?':''}`,params:[resourceId,project,schema.id,...window.params,...(subject?[subject]:[])]};
 const {rows,next}=await page(db,where,{key:await jsonDigest(['records-export',resourceId,schema.id,user,subject??'']),configRevision:row.config_revision,accessRevision:0},pageSize,after);
 // Attachment file ids only (the bytes belong to the files module export); sorted so the digest is stable.
 const linked=new Map<string,string[]>();
 if(rows.length)for(const l of (await db.prepare(`SELECT entry_id,file_id FROM module_record_files WHERE entry_id IN (${rows.map(()=>'?').join()}) ORDER BY file_id`).bind(...rows.map(r=>r.id)).all<{entry_id:string;file_id:string}>()).results)linked.set(l.entry_id,[...linked.get(l.entry_id)??[],l.file_id]);
 const records:ExportRecord[]=rows.map(r=>({entryId:r.id,formId:r.form_id,fieldsRevision:r.fields_revision,submittedBy:r.submitter_kind,visitorId:r.visitor_id,revision:r.revision,
  createdAt:iso(r.created_at),updatedAt:iso(r.updated_at),expiresAt:iso(r.expires_at),values:JSON.parse(r.values_json) as Record<string,unknown>,attachments:linked.get(r.id)??[]}));
 const fields:ExportField[]=schema.fields.map(f=>({key:f.key,label:f.label,type:f.type,optional:f.optional,read:f.read,...(f.type==='choice'?{options:f.options.map(o=>({value:o.value,label:o.label}))}:{})}));
 return {format:'whumpo-module-records',schemaVersion:1,project:{id:project},
  instance:{resourceId,localId:row.local_id,configRevision:row.config_revision,retentionDays:instance.config.retentionDays},
  schema:{recordId:schema.id,fieldsRevision:schema.fieldsRevision,fields},subject:subject?{visitorId:subject}:null,
  records,next,recordsSha256:await hashToken(JSON.stringify(records))};
}

/** Import validation for `whumpo-module-records` v1: exact wrapper, the embedded schema checked by the current records
 * field validator, every record's shape, submitter identity, ordering and dates, each value against its field, required
 * fields present, subject scope and the records SHA-256. It validates only; nothing imports records (a restore re-admits
 * through the current schema and handlers, never by replaying rows). */
export async function validateRecordsExport(value:unknown){
 const fail=():never=>{throw new ModuleError('invalid_request','This is not a current Whumpo records export.');};
 const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>plain(v)&&Object.keys(v).sort().join()===[...keys].sort().join();
 const count=(v:unknown)=>Number.isSafeInteger(v)&&(v as number)>=1;
 const time=(v:unknown)=>typeof v==='string'&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString()===v;
 if(!exact(value,['format','schemaVersion','project','instance','schema','subject','records','next','recordsSha256'])||value.format!=='whumpo-module-records'||value.schemaVersion!==1)return fail();
 const {project,instance,schema,subject,records}=value;
 if(!exact(project,['id'])||typeof project.id!=='string'||!uuid.test(project.id))return fail();
 if(!exact(instance,['resourceId','localId','configRevision','retentionDays'])||typeof instance.resourceId!=='string'||!uuid.test(instance.resourceId)
  ||typeof instance.localId!=='string'||!local.test(instance.localId)||!count(instance.configRevision)||![30,90,365].includes(instance.retentionDays as number))return fail();
 if(!exact(schema,['recordId','fieldsRevision','fields'])||typeof schema.recordId!=='string'||!local.test(schema.recordId)||!count(schema.fieldsRevision)||!Array.isArray(schema.fields))return fail();
 const fields=schema.fields as RecordField[];
 for(const f of fields)if(!plain(f)||!['owner','staff','submitter'].includes(f.read as string))return fail();
 try{
  // The current field validator (keys, labels, types, choice options and bounds); audiences are checked above, so the
  // probe instance needs no access dependency.
  validateInstances([{id:'export',kind:'records',module:{name:'module-records',version:1,digest:'0'.repeat(64)},schema:{name:'records-data',version:1,digest:'0'.repeat(64)},dependencies:[],
   config:{retentionDays:instance.retentionDays,schemas:[{id:schema.recordId,fieldsRevision:schema.fieldsRevision,fields:fields.map(f=>({...f,read:'owner'})),staffWrite:[]}],forms:[],views:[]}}]);
 }catch{return fail();}
 if(subject!==null&&(!exact(subject,['visitorId'])||typeof subject.visitorId!=='string'||!uuid.test(subject.visitorId)))return fail();
 if(!Array.isArray(records)||records.length>pageSize)return fail();
 if(value.next!==null&&(typeof value.next!=='string'||value.next.length>400||!/^[A-Za-z0-9_-]+$/.test(value.next)))return fail();
 const seen=new Set<string>();let previous:string|null=null;
 for(const r of records as unknown[]){
  if(!exact(r,['entryId','formId','fieldsRevision','submittedBy','visitorId','revision','createdAt','updatedAt','expiresAt','values','attachments'])||typeof r.entryId!=='string'||!uuid.test(r.entryId)||seen.has(r.entryId)
   ||typeof r.formId!=='string'||!local.test(r.formId)||!count(r.fieldsRevision)||(r.fieldsRevision as number)>(schema.fieldsRevision as number)||!count(r.revision)
   ||!['public','visitor','staff'].includes(r.submittedBy as string)||(r.submittedBy==='public')!==(r.visitorId===null)||r.visitorId!==null&&(typeof r.visitorId!=='string'||!uuid.test(r.visitorId))
   ||subject!==null&&r.visitorId!==subject.visitorId||!time(r.createdAt)||!time(r.updatedAt)||!time(r.expiresAt)
   ||String(r.updatedAt)<String(r.createdAt)||Date.parse(String(r.expiresAt))<=Date.parse(String(r.createdAt))||Date.parse(String(r.expiresAt))-Date.parse(String(r.createdAt))>365*86400000
   ||previous!==null&&String(r.createdAt)>previous||!plain(r.values)||!Array.isArray(r.attachments)||r.attachments.length>4||new Set(r.attachments).size!==r.attachments.length||!r.attachments.every(a=>typeof a==='string'&&uuid.test(a)))return fail();
  seen.add(r.entryId);previous=String(r.createdAt);
  const values=r.values;
  if(Object.keys(values).some(k=>!fields.some(f=>f.key===k)))return fail();
  for(const f of fields){
   if(!Object.hasOwn(values,f.key)){if(f.optional)continue;return fail();}
   try{fieldValue(f,values[f.key]);}catch{return fail();}
  }
 }
 if(typeof value.recordsSha256!=='string'||await hashToken(JSON.stringify(records))!==value.recordsSha256)return fail();
 return {projectId:project.id,resourceId:instance.resourceId,recordId:schema.recordId,subject:subject===null?null:subject.visitorId as string,records:records as ExportRecord[],next:value.next as string|null};
}
