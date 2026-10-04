import {hashToken} from './security';

/** WH-126 / WH-071: the visitor application (each visitor's private document and its QuickJS transitions) as one
 * `custom-function` execution resource that depends on the project's access module instance, whose visitor identities
 * it consumes. Logical references only: no owner id, storage locator, credential or document value. The module pin is
 * the exact reviewed program digest; the schema pin names the fixed per-visitor document layout. Visitor documents are
 * visitor-subject data, so export needs the visitor's own separate approval (the account export). */
export const visitorDocumentSchema='visitor-document';
export const visitorDocumentLayout='whumpo-visitor-document@1:one JSON value per visitor, at most 4096 bytes, revisioned';
export type VisitorApplicationRow={resource_id:string;project_id:string;access_id:string;program_digest:string;access_module_digest:string};
export async function visitorApplicationDescriptor(row:VisitorApplicationRow){
 return {contractVersion:1,ref:{projectId:row.project_id,resourceId:row.resource_id},kind:'custom-function',
  module:{name:'visitor-application',version:1,digest:row.program_digest},
  schema:{name:visitorDocumentSchema,version:1,digest:await hashToken(visitorDocumentLayout)},
  ownership:{data:[
   {id:'visitor-app-data',classId:'visitor-app-data',subject:'visitor',export:'separate-approval'},
   {id:'application-recovery',classId:'application-recovery',subject:'visitor',export:'excluded'}],assets:[]},
  dependencies:[{ref:{projectId:row.project_id,resourceId:row.access_id},module:{name:'module-access',version:1,digest:row.access_module_digest}}],
  lifecycle:{exportFormat:1,exportHook:'visitor-account-export-v1',deleteHook:'visitor-erasure',restoreHook:'app-recovery-point',migrateHook:'app-migration-check',portability:'platform-only'}} as const;
}
/** The registered descriptor of one project's visitor application, or null when none was authorized yet. */
export async function readVisitorApplicationResource(db:D1Database,project:string){
 const row=await db.prepare(`SELECT a.resource_id,a.project_id,a.access_id,v.digest program_digest,i.module_digest access_module_digest
  FROM app_spaces a JOIN backend_versions v ON v.id=a.version_id AND v.project_id=a.project_id JOIN module_instances i ON i.id=a.access_id AND i.project_id=a.project_id AND i.kind='access'
  WHERE a.project_id=?`).bind(project).first<VisitorApplicationRow>();
 return row?visitorApplicationDescriptor(row):null;
}
