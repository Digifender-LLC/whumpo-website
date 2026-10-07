import {moduleCatalog} from '../project-specification/catalog';
import {prepareSpecification} from '../project-specification/store';
import {jsonDigest} from '../project-specification/v2/json';
import type {ModuleInstance} from '../project-specification/v3/modules';
import {assertWorkspace} from '../workspace-identity/admission';
import {ModuleError} from './policy';
import {catalogState,currentSpecification,registeredInstances,type RegistryRow} from './registry';
import type {RecordsSetupFacts} from './shape';

/** Owner-only maintained enquiry preset. The control selects logical configuration ids, never submitted values.
 * Save and activation use their ordinary exact reviews; this helper grants no role and publishes no page. */
export const standardRecordsInstanceId='visitor-enquiries';
export type EnquiryAttachment={instanceId:string;collectionId:string};
export function standardRecordsInstance(access:string,attachment:EnquiryAttachment|null):Extract<ModuleInstance,{kind:'records'}>{
 const entry=moduleCatalog.find(x=>x.kind==='records');
 if(!entry||entry.state!=='available')throw new ModuleError('unavailable','The records module is not available right now.');
 return {id:standardRecordsInstanceId,kind:'records',module:{...entry.module},schema:{...entry.schema},dependencies:[access,...(attachment?[attachment.instanceId]:[])],config:{retentionDays:90,
  schemas:[{id:'enquiry',fieldsRevision:1,fields:[{key:'name',label:'Name',type:'text',optional:false,read:'submitter'},{key:'message',label:'Message',type:'text',optional:false,read:'submitter'}],staffWrite:[]}],
  forms:[{id:'enquiry',recordId:'enquiry',submit:'visitor',uploadCollectionId:attachment?.collectionId??null}],
  views:[{id:'mine',recordId:'enquiry',audience:'visitor',scope:'own',fields:['name','message'],limit:25}]}};
}
async function current(row:RegistryRow|undefined,saved:ModuleInstance){
 return !!row&&row.kind===saved.kind&&row.state==='active'&&row.module_digest===saved.module.digest&&row.schema_digest===saved.schema.digest
  &&catalogState(saved.kind,row.module_digest,row.schema_digest)==='available'&&row.config_digest===await jsonDigest(saved.config);
}
async function setupContext(db:D1Database,user:string,project:string){
 const spec=await currentSpecification(db,user,project),rows=await registeredInstances(db,project);
 const access=spec?.instances.find(i=>i.kind==='access'),registeredAccess=rows.find(r=>r.local_id===access?.id);
 const accessReady=!!access&&await current(registeredAccess,access);
 const attachmentCollections:EnquiryAttachment[]=[];
 if(spec&&accessReady&&access&&registeredAccess)for(const saved of spec.instances){
  if(saved.kind!=='files'||saved.dependencies.length!==1||saved.dependencies[0]!==access.id)continue;
  const row=rows.find(r=>r.local_id===saved.id);
  if(!await current(row,saved)||!row||row.dependencies_json!==JSON.stringify([registeredAccess.id]))continue;
  for(const collection of saved.config.collections)if(collection.read==='submitter'&&collection.upload.includes('visitor'))attachmentCollections.push({instanceId:saved.id,collectionId:collection.id});
 }
 return {spec,rows,access,accessReady,attachmentCollections};
}
/** Counts binding and private panel share setup ids/states only. No file, record or visitor identifiers are included. */
export async function readRecordsSetup(db:D1Database,user:string,project:string):Promise<RecordsSetupFacts>{
 try{
  const {spec,rows,accessReady,attachmentCollections}=await setupContext(db,user,project);
  if(!spec)return {state:'website-required',instanceId:null,attachmentCollections:[]};
  const saved=spec.instances.find(i=>i.id===standardRecordsInstanceId),registered=rows.find(r=>r.local_id===standardRecordsInstanceId);
  if(saved?.kind==='records')return {state:registered?.kind==='records'&&registered.config_digest===await jsonDigest(saved.config)?'registered':'saved',instanceId:saved.id,attachmentCollections:[]};
  if(saved||registered)return {state:'unavailable',instanceId:null,attachmentCollections:[]};
  return {state:accessReady?'not-configured':'access-required',instanceId:null,attachmentCollections};
 }catch(error){if(error instanceof ModuleError)return {state:'unavailable',instanceId:null,attachmentCollections:[]};throw error;}
}
export async function prepareRecordsModuleCommand(db:D1Database,user:string,turn:string,command:string){
 if(!command.startsWith('/review-enquiry-setup '))return;
 const m=/^\/review-enquiry-setup ([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}) (none|[a-z][a-z0-9-]{0,39} [a-z][a-z0-9-]{0,39})$/.exec(command);
 if(!m||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(turn))throw new ModuleError('invalid_request','Choose an owned project and an available attachment collection.');
 await assertWorkspace(db,user);
 const project=m[1],{spec,rows,access,accessReady,attachmentCollections}=await setupContext(db,user,project);
 if(!spec)throw new ModuleError('not_found','Save a private website configuration before setting up enquiries.');
 if(spec.instances.some(i=>i.id===standardRecordsInstanceId)||rows.some(r=>r.local_id===standardRecordsInstanceId))throw new ModuleError('invalid_request','The visitor enquiry module is already configured. Review its saved activation from Form records.');
 if(!accessReady||!access)throw new ModuleError('unavailable','Set up and activate the current visitor access configuration before setting up enquiries.');
 const selected=m[2]==='none'?null:m[2].split(' '),attachment=selected?attachmentCollections.find(c=>c.instanceId===selected[0]&&c.collectionId===selected[1]):null;
 if(selected&&!attachment)throw new ModuleError('unavailable','Choose a current active visitor upload collection from this project, or continue without attachments.');
 return prepareSpecification(db,user,turn,{kind:'specification',operation:'change',projectId:project,expectedRevision:spec.revision,operations:[{type:'modules.put',instance:standardRecordsInstance(access.id,attachment??null)}]});
}
