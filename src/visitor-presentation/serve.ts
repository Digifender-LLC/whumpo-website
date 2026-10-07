import {compileProjectSpecification} from '../project-specification/compiler';
import {canonicalJSON,jsonDigest} from '../project-specification/v2/json';
import {requireSpecificationAvailable} from '../specification-safety';
import {registeredInstances,resolveResource} from '../shared-modules/registry';
import {portalDependencies} from './contract';

/** The published website snapshot owns presentation. Current module activation still owns API serving. */
export async function publishedPortal(db:D1Database,project:string){
 const read=()=>db.prepare(`SELECT p.version_id,p.revision,v.spec_json,v.spec_digest,v.lock_json,v.manifest_digest
  FROM publications p JOIN project_spec_versions v ON v.version_id=p.version_id AND v.project_id=p.project_id
  WHERE p.project_id=?`).bind(project).first<{version_id:string;revision:number;spec_json:string;spec_digest:string;lock_json:string;manifest_digest:string}>();
 const row=await read();if(!row)return null;
 await requireSpecificationAvailable(db,row.version_id);
 const compiled=await compileProjectSpecification(JSON.parse(row.spec_json),JSON.parse(row.lock_json)),p=compiled.specification.presentation;
 if(compiled.specificationDigest!==row.spec_digest||compiled.manifestDigest!==row.manifest_digest)throw Error('Portal integrity');
 if(!p||!compiled.presentation)return null;
 const registry=await registeredInstances(db,project),instances:Record<string,{resourceId:string;configRevision:number}>={};
 const dependencies=portalDependencies(p);
 for(let n=0;n<dependencies.length;n++)for(const id of compiled.specification.instances.find(i=>i.id===dependencies[n])!.dependencies)if(!dependencies.includes(id))dependencies.push(id);
 for(const localId of dependencies){
  const spec=compiled.specification.instances.find(i=>i.id===localId)!,registered=registry.find(i=>i.local_id===localId);
  if(!registered||registered.kind!==spec.kind||registered.module_digest!==spec.module.digest||registered.schema_digest!==spec.schema.digest||registered.config_digest!==await jsonDigest(spec.config))throw Error('Portal configuration changed');
  const dependencyIds=spec.dependencies.map(id=>registry.find(i=>i.local_id===id)?.id).sort();
  if(canonicalJSON(dependencyIds)!==canonicalJSON((JSON.parse(registered.dependencies_json) as string[]).sort()))throw Error('Portal dependencies changed');
  await resolveResource(db,{kind:'public',projectId:project},registered.id,registered.config_revision);
  instances[localId]={resourceId:registered.id,configRevision:registered.config_revision};
 }
 // Only configured presentation and field definitions, never record values, uploads, credentials or identity rows.
 const blocks=p.blocks.map(block=>{
  if(block.kind==='custom-card')return block;
  const i=compiled.specification.instances.find(i=>i.id===block.instanceId)!;
  if(block.kind==='form'&&i.kind==='records'){
   const form=i.config.forms.find(f=>f.id===block.targetId)!,schema=i.config.schemas.find(s=>s.id===form.recordId)!;
   const attachment=form.uploadCollectionId?compiled.specification.instances.find(v=>v.kind==='files'&&v.config.collections.some(c=>c.id===form.uploadCollectionId)):null;
   return {...block,submit:form.submit,fields:schema.fields.map(({read,...field})=>field),attachment:attachment?{instanceId:attachment.id,collectionId:form.uploadCollectionId}:null};
  }
  if(block.kind==='records'&&i.kind==='records'){
   const view=i.config.views.find(v=>v.id===block.targetId)!,schema=i.config.schemas.find(s=>s.id===view.recordId)!;
   return {...block,audience:view.audience,fields:schema.fields.filter(f=>view.fields.includes(f.key)).map(f=>({key:f.key,label:f.label}))};
  }
  if(block.kind==='gallery'&&i.kind==='files'){
   const c=i.config.collections.find(c=>c.id===block.targetId)!;
   return {...block,audience:c.gallery!.audience,upload:c.upload.filter(a=>a!=='owner')};
  }
  return block;
 });
 const current=await read();if(!current||current.version_id!==row.version_id||current.revision!==row.revision)throw Error('Portal publication changed');
 await requireSpecificationAvailable(db,row.version_id);
 return {artifact:compiled.presentation,manifest:{api:'whumpo-portal',version:1,publicationRevision:row.revision,presentation:{...p,blocks},instances}};
}
