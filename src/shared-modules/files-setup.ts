import {moduleCatalog} from '../project-specification/catalog';
import {prepareSpecification} from '../project-specification/store';
import type {ModuleInstance} from '../project-specification/v3/modules';
import {assertWorkspace} from '../workspace-identity/admission';
import {ModuleError} from './policy';
import {currentSpecification,instanceOf,registeredInstances} from './registry';
import type {OwnerFileCollections} from './shape';

/** WH-128 owner photo collection setup (docs/shared-modules.md#owner-photo-collection-setup-wh-128--october-4-2026-utc).
 * A typed owner Chat control (`filesModuleReview`), never a model action and never advertised to the site agent: it
 * prepares the exact private website review that appends the project's one standard files instance, using the existing
 * specification review (`prepareSpecification`). Saving it is the existing recent-sign-in `specificationApply` control
 * and activation is the existing exact `moduleActivationReview`/`moduleActivationApply` pair, so no review is skipped or
 * combined. The configuration is fixed and minimal: local id `photos`, the current catalog pin, no dependencies and one
 * owner-only collection `library` (owner read, owner upload, the 1 MiB photo bound, JPEG, no gallery), so no staff or
 * visitor can upload or read and no access instance is needed. The `project_spec_files_setup_admit` trigger repeats that
 * shape inside the commit. Deterministic: no inference or provider. */
export const standardFilesInstanceId='photos';
export const standardFilesCollectionId='library';
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;

export function standardFilesInstance():Extract<ModuleInstance,{kind:'files'}>{
 const entry=moduleCatalog.find(x=>x.kind==='files');
 if(!entry||entry.state!=='available')throw new ModuleError('unavailable','The photo collection module is not available right now.');
 return {id:standardFilesInstanceId,kind:'files',module:{...entry.module},schema:{...entry.schema},dependencies:[],
  config:{collections:[{id:standardFilesCollectionId,read:'owner',upload:['owner'],maxBytes:1048576,mediaTypes:['image/jpeg'],gallery:null}]}};
}
const ownerCollection=(i:ModuleInstance)=>i.kind==='files'&&i.config.collections.some(c=>c.upload.includes('owner'));

/** Owner metadata for the Photos panel: which step of photo collection setup comes next. Ids and states only. */
export async function readFilesSetup(db:D1Database,user:string,project:string):Promise<OwnerFileCollections['setup']>{
 for(const row of (await registeredInstances(db,project)).filter(r=>r.kind==='files'))
  if(ownerCollection(await instanceOf(row)))return {state:'registered',instanceId:row.local_id};
 let spec;try{spec=await currentSpecification(db,user,project);}catch(error){if(error instanceof ModuleError)return {state:'unavailable',instanceId:null};throw error;}
 if(!spec)return {state:'website-required',instanceId:null};
 const saved=spec.instances.find(ownerCollection);
 return saved?{state:'saved',instanceId:saved.id}:{state:'not-configured',instanceId:null};
}

/** `/review-photo-collection-setup PROJECT` from the typed filesModuleReview control. Returns the existing specification
 * review reply and statements; the reply is linked to the review so Chat shows the exact save control. */
export async function prepareFilesModuleCommand(db:D1Database,user:string,turn:string,command:string){
 if(!command.startsWith('/review-photo-collection-setup '))return;
 const m=/^\/review-photo-collection-setup ([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})$/.exec(command);
 if(!m||!uuid.test(turn))throw new ModuleError('invalid_request','Choose an owned project.');
 const project=m[1];
 await assertWorkspace(db,user);
 const spec=await currentSpecification(db,user,project);
 if(!spec)throw new ModuleError('not_found','This project has no saved website configuration yet. Photo collections are saved in it, so ask Whumpo to draft the project’s private website first.');
 const registered=await registeredInstances(db,project);
 for(const row of registered.filter(r=>r.kind==='files'))if(ownerCollection(await instanceOf(row)))throw new ModuleError('invalid_request','This project already has a photo collection. Review its activation from Photos or the modules view.');
 if(spec.instances.some(ownerCollection))throw new ModuleError('invalid_request','This project already has a photo collection. Review its activation from Photos or the modules view.');
 if(spec.instances.some(i=>i.id===standardFilesInstanceId)||registered.some(r=>r.local_id===standardFilesInstanceId))throw new ModuleError('invalid_request','Another module already uses the “photos” id in this website configuration.');
 if(spec.instances.some(i=>i.kind==='files'&&i.config.collections.some(c=>c.id===standardFilesCollectionId)))throw new ModuleError('invalid_request','Another collection already uses the “library” id in this website configuration.');
 // The existing review owns compilation, safety holds, staleness, bounds and the reply (BackendError on refusal).
 return prepareSpecification(db,user,turn,{kind:'specification',operation:'change',projectId:project,expectedRevision:spec.revision,operations:[{type:'modules.put',instance:standardFilesInstance()}]});
}
