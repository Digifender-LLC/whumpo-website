import {plain} from '../project-specification/v2/json';
import {approvedPhotoSQL} from '../photo-safety';
import {ModuleError,decideModule,type ModulePrincipal} from './policy';
import {instanceOf,resolveResource,type RegistryRow} from './registry';
import type {ModuleContext} from './api';

/** Attachment references are immutable record data. Bytes and their safety/lifecycle authority stay with files.
 * A reference grants no read permission: every response intersects record access with the current files policy. */
export type RecordAttachment={fileId:string;resourceId:string;collectionId:string;sha256:string};
export type RecordAttachmentView=RecordAttachment&{configRevision:number};
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
export async function prepareRecordAttachments(db:D1Database,context:ModuleContext,collectionId:string|null,input:Record<string,unknown>){
 if(collectionId===null){if(Object.hasOwn(input,'attachments'))throw new ModuleError('invalid_request');return [] as RecordAttachment[];}
 const principal=context.principal;
 if(principal.kind!=='visitor')throw new ModuleError('forbidden');
 const sent=input.attachments;
 if(!Array.isArray(sent)||sent.length>4||sent.some(a=>!plain(a)||Object.keys(a).length!==1||!uuid(a.fileId))
  ||new Set(sent.map(a=>a.fileId)).size!==sent.length)throw new ModuleError('invalid_request');
 const references:RecordAttachment[]=[];
 for(const item of sent){
  const row=await db.prepare(`SELECT mf.file_id,mf.instance_id,mf.collection_id,f.digest,i.config_revision FROM module_files mf
   JOIN project_files f ON f.id=mf.file_id AND f.project_id=mf.project_id JOIN module_instances i ON i.id=mf.instance_id AND i.project_id=mf.project_id
   JOIN module_instances records ON records.id=? AND records.project_id=mf.project_id
   WHERE mf.file_id=? AND mf.project_id=? AND mf.collection_id=? AND mf.visitor_id=? AND mf.uploader_kind!='owner'
   AND mf.instance_id IN (SELECT value FROM json_each(records.dependencies_json)) AND f.status='ready' AND ${approvedPhotoSQL}`)
   .bind(context.resource.resourceId,item.fileId,context.resource.projectId,collectionId,principal.visitorId)
   .first<{file_id:string;instance_id:string;collection_id:string;digest:string;config_revision:number}>();
  // Missing, held, foreign, and another submitter's upload have the same response, without echoing an identifier.
  if(!row)throw new ModuleError('not_found');
  const files=await resolveResource(db,principal,row.instance_id,row.config_revision);
  if(decideModule(principal,files.instance,'files.putBytes',{collectionId}).decision!=='allow')throw new ModuleError('forbidden');
  references.push({fileId:row.file_id,resourceId:row.instance_id,collectionId:row.collection_id,sha256:row.digest});
 }
 return references;
}

/** Owner export is allowed after disable/catalog withdrawal; ordinary visitor reads additionally resolve the active
 * files instance and dependencies. No R2 locator, upload name or inaccessible file identifier leaves this helper. */
export async function readRecordAttachments(db:D1Database,principal:ModulePrincipal,serialized:string):Promise<RecordAttachmentView[]>{
 const references=JSON.parse(serialized) as RecordAttachment[],out:RecordAttachmentView[]=[];
 for(const ref of references){
  const row=await db.prepare(`SELECT i.* FROM module_files mf JOIN project_files f ON f.id=mf.file_id AND f.project_id=mf.project_id
   JOIN module_instances i ON i.id=mf.instance_id AND i.project_id=mf.project_id JOIN projects p ON p.id=mf.project_id
   WHERE mf.file_id=? AND mf.instance_id=? AND mf.collection_id=? AND mf.project_id=? AND f.digest=? AND f.status='ready'
   AND ${approvedPhotoSQL}${principal.kind==='owner'?' AND p.owner_user_id=?':principal.kind==='visitor'&&!principal.roles.length?' AND mf.visitor_id=?':''}`)
   .bind(ref.fileId,ref.resourceId,ref.collectionId,principal.projectId,ref.sha256,...(principal.kind==='owner'?[principal.userId]:principal.kind==='visitor'&&!principal.roles.length?[principal.visitorId]:[])).first<RegistryRow>();
  if(!row)continue;
  try{
   const instance=principal.kind==='owner'?await instanceOf(row):(await resolveResource(db,principal,ref.resourceId,row.config_revision)).instance;
   if(decideModule(principal,instance,'files.read',{collectionId:ref.collectionId,fileId:ref.fileId}).decision==='allow')out.push({...ref,configRevision:row.config_revision});
  }catch(error){if(!(error instanceof ModuleError))throw error;}
 }
 return out;
}
