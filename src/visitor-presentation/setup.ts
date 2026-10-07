import {readSpecification,prepareSpecification} from '../project-specification/store';
import {registeredInstances} from '../shared-modules/registry';
import {ModuleError} from '../shared-modules/policy';
import {assertWorkspace} from '../workspace-identity/admission';
import {canonicalJSON} from '../project-specification/v2/json';
import {validatePresentation,type PortalPresentation,type PortalBlock} from './contract';
import type {ProjectSpecification} from '../project-specification/v3/types';

/** Owner-authored configuration only. No visitor values, identities or file metadata. */
export async function portalSetup(db:D1Database,user:string,project:string){
 const saved=await readSpecification(db,user,project),spec=saved.specification as ProjectSpecification|null;
 if(!spec)return {state:'website-required' as const,presentation:null};
 const access=spec.instances.find(i=>i.kind==='access');
 if(!access)return {state:'access-required' as const,presentation:null};
 const registry=await registeredInstances(db,project);
 if(!registry.some(i=>i.local_id===access.id&&i.state==='active'))return {state:'access-required' as const,presentation:null};
 const blocks:PortalBlock[]=[];
 for(const i of spec.instances){
  if(i.kind==='records'){
   for(const form of i.config.forms.filter(f=>f.submit!=='public'))blocks.push({id:'form-'+blocks.length,kind:'form',instanceId:i.id,targetId:form.id,title:form.submit==='staff'?'Staff submission':'Send an enquiry'});
   for(const view of i.config.views)blocks.push({id:'records-'+blocks.length,kind:'records',instanceId:i.id,targetId:view.id,title:view.audience==='staff'?'Staff records':'Your submissions'});
  }
  if(i.kind==='files')for(const c of i.config.collections.filter(c=>c.gallery))blocks.push({id:'gallery-'+blocks.length,kind:'gallery',instanceId:i.id,targetId:c.id,title:c.gallery!.audience==='staff'?'Staff photos':'Your photos'});
  if(i.kind==='content')for(const c of i.config.collections)blocks.push({id:'directory-'+blocks.length,kind:'directory',instanceId:i.id,targetId:c.id,title:'Directory'});
 }
 if(!spec.presentation&&!blocks.length)return {state:'modules-required' as const,presentation:null};
 const presentation=spec.presentation??{version:1,template:'module-portal@1',layout:'studio',title:spec.name,introduction:'A place to share updates and keep track of your information.',accessInstanceId:access.id,blocks:blocks.slice(0,7)} as PortalPresentation;
 return {state:spec.presentation?'saved' as const:'ready' as const,presentation,versionId:spec.presentation?saved.versionId:null};
}
/** Entire exact presentation is the review payload; backend instance definitions cannot change through this control. */
export async function preparePortalReview(db:D1Database,user:string,turn:string,project:string,input:PortalPresentation){
 await assertWorkspace(db,user);
 const saved=await readSpecification(db,user,project),spec=saved.specification as ProjectSpecification|null;
 if(!spec)throw new ModuleError('unavailable','Draft the private website first.');
 const presentation=validatePresentation(input,spec.instances);
 if(canonicalJSON(presentation,12000)===canonicalJSON(spec.presentation??null,12000))throw new ModuleError('invalid_request','Choose a portal change before preparing a review.');
 return prepareSpecification(db,user,turn,{kind:'specification',operation:'change',projectId:project,expectedRevision:saved.revision,operations:[{type:'presentation.set',presentation}]});
}
