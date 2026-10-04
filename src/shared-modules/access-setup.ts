import {moduleCatalog} from '../project-specification/catalog';
import {prepareSpecification} from '../project-specification/store';
import type {ModuleInstance} from '../project-specification/v3/modules';
import {assertWorkspace} from '../workspace-identity/admission';
import {ModuleError} from './policy';
import {currentSpecification,registeredInstances} from './registry';

/** WH-126 owner visitor access setup. A typed owner Chat control (`accessModuleReview`), never a model action and
 * never advertised to the site agent: it prepares the exact private website review that appends the project's one
 * standard access instance, using the existing specification review (`prepareSpecification`). Saving it is the
 * existing recent-sign-in `specificationApply` control and activation is the existing exact
 * `moduleActivationReview`/`moduleActivationApply` pair, so no review is skipped or combined. The configuration is
 * fixed and minimal: local id `visitors`, the current catalog pin, no dependencies, no staff role and invitation-only
 * enrollment. The `project_spec_access_setup_admit` trigger repeats that shape inside the commit. */
export const standardAccessInstanceId='visitors';
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;

export function standardAccessInstance():Extract<ModuleInstance,{kind:'access'}>{
 const entry=moduleCatalog.find(x=>x.kind==='access');
 if(!entry||entry.state!=='available')throw new ModuleError('unavailable','The visitor access module is not available right now.');
 return {id:standardAccessInstanceId,kind:'access',module:{...entry.module},schema:{...entry.schema},dependencies:[],config:{roles:[],enrollment:'invitation'}};
}

/** Owner metadata for the Visitors panel: which step of visitor access setup comes next. Ids and states only. */
export async function readAccessSetup(db:D1Database,user:string,project:string){
 const registered=(await registeredInstances(db,project)).find(r=>r.kind==='access');
 if(registered)return {state:'registered' as const,instanceId:registered.local_id};
 let spec;try{spec=await currentSpecification(db,user,project);}catch(error){if(error instanceof ModuleError)return {state:'unavailable' as const,instanceId:null};throw error;}
 if(!spec)return {state:'website-required' as const,instanceId:null};
 const saved=spec.instances.find(i=>i.kind==='access');
 return saved?{state:'saved' as const,instanceId:saved.id}:{state:'not-configured' as const,instanceId:null};
}

/** `/review-visitor-access-setup PROJECT` from the typed accessModuleReview control. Returns the existing specification
 * review reply and statements; the reply is linked to the review so Chat shows the exact save control. */
export async function prepareAccessModuleCommand(db:D1Database,user:string,turn:string,command:string){
 if(!command.startsWith('/review-visitor-access-setup '))return;
 const m=/^\/review-visitor-access-setup ([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/.exec(command);
 if(!m||!uuid.test(turn))throw new ModuleError('invalid_request','Choose an owned project.');
 const project=m[1];
 await assertWorkspace(db,user);
 const spec=await currentSpecification(db,user,project);
 if(!spec)throw new ModuleError('not_found','This project has no saved website configuration yet. Visitor access is saved in it, so ask Whumpo to draft the project’s private website first.');
 if((await registeredInstances(db,project)).some(r=>r.kind==='access')||spec.instances.some(i=>i.kind==='access'))throw new ModuleError('invalid_request','This project already has a visitor access module. Review its activation from Visitor access or the modules view.');
 if(spec.instances.some(i=>i.id===standardAccessInstanceId))throw new ModuleError('invalid_request','Another module already uses the “visitors” id in this website configuration.');
 // The existing review owns compilation, safety holds, staleness, bounds and the reply (BackendError on refusal).
 return prepareSpecification(db,user,turn,{kind:'specification',operation:'change',projectId:project,expectedRevision:spec.revision,operations:[{type:'modules.put',instance:standardAccessInstance()}]});
}
