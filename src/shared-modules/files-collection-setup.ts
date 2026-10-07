import {prepareSpecification} from '../project-specification/store';
import type {ModuleInstance} from '../project-specification/v3/modules';
import {assertWorkspace} from '../workspace-identity/admission';
import {ModuleError} from './policy';
import {currentSpecification,instanceOf,registeredInstances} from './registry';
import {standardFilesInstance} from './files-setup';
import type {OwnerFileCollections,SharedFileAudience} from './shape';

const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const collectionFor=(instance:ModuleInstance,audience:SharedFileAudience)=>instance.kind==='files'?instance.config.collections.find(c=>c.upload.includes(audience)):undefined;

/** Maintained audience presets. Staff files are staff-readable; visitors read only their own approved uploads. The
 * existing single access instance owns all identities and roles. No public audience, generated config or extra grant. */
export function sharedFilesInstance(audience:SharedFileAudience,accessId:string):Extract<ModuleInstance,{kind:'files'}>{
 return {...standardFilesInstance(),id:audience+'-files',dependencies:[accessId],config:{collections:[{
  id:audience+'-uploads',read:audience==='staff'?'staff':'submitter',upload:[audience],maxBytes:1048576,mediaTypes:['image/jpeg'],gallery:{audience}
 }]}};
}

/** Owner setup facts only. No visitor identity, filename, digest, count or submitted value enters these facts. */
export async function readSharedFileSetups(db:D1Database,user:string,project:string):Promise<OwnerFileCollections['sharedSetups']>{
 const audiences=['staff','visitor'] as const;
 const empty=(state:OwnerFileCollections['sharedSetups'][number]['state'])=>audiences.map(audience=>({audience,state,instanceId:null,collectionId:null}));
 try{
  const spec=await currentSpecification(db,user,project);if(!spec)return empty('website-required');
  const registered=await registeredInstances(db,project),instances=await Promise.all(registered.filter(r=>r.kind==='files').map(async row=>({row,instance:await instanceOf(row)})));
  const access=spec.instances.find(i=>i.kind==='access');
  return audiences.map((audience):OwnerFileCollections['sharedSetups'][number]=>{
   for(const {row,instance} of instances){const c=collectionFor(instance,audience);if(c)return {audience,state:(row.state??'saved') as OwnerFileCollections['sharedSetups'][number]['state'],instanceId:instance.id,collectionId:c.id};}
   const saved=spec.instances.find(i=>collectionFor(i,audience));
   if(saved)return {audience,state:'saved',instanceId:saved.id,collectionId:collectionFor(saved,audience)!.id};
   const state=!access?'access-required':audience==='staff'&&access.kind==='access'&&!access.config.roles.length?'staff-role-required':'not-configured';
   return {audience,state,instanceId:null,collectionId:null};
  });
 }catch(error){if(error instanceof ModuleError)return empty('unavailable');throw error;}
}

/** Typed filesCollectionReview only: append one fixed staff/visitor collection to the current exact specification.
 * Saving and activation retain their separate reviews. The SQL admission trigger repeats the whole preset at commit. */
export async function prepareFilesCollectionCommand(db:D1Database,user:string,turn:string,command:string){
 if(!command.startsWith('/review-shared-file-collection '))return;
 const match=/^\/review-shared-file-collection ([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}) (staff|visitor)$/.exec(command);
 if(!match||!uuid.test(turn))throw new ModuleError('invalid_request','Choose an owned project and a staff or visitor collection.');
 const project=match[1],audience=match[2] as SharedFileAudience;
 await assertWorkspace(db,user);
 const spec=await currentSpecification(db,user,project);
 if(!spec)throw new ModuleError('not_found','Draft this project’s private website before setting up file collections.');
 const access=spec.instances.find(i=>i.kind==='access');
 if(!access||access.kind!=='access')throw new ModuleError('invalid_request','Set up visitor access for this project first.');
 if(audience==='staff'&&!access.config.roles.length)throw new ModuleError('invalid_request','Set up this project’s staff role in Visitors first.');
 const instance=sharedFilesInstance(audience,access.id),registered=await registeredInstances(db,project);
 const current=[...spec.instances,...await Promise.all(registered.map(instanceOf))];
 if(current.some(i=>collectionFor(i,audience)))throw new ModuleError('invalid_request',`This project already has a ${audience} upload collection. Review its activation in Photos or the modules view.`);
 if(current.some(i=>i.id===instance.id))throw new ModuleError('invalid_request',`Another module already uses the “${instance.id}” id.`);
 const collectionId=instance.config.collections[0].id;
 if(current.some(i=>i.kind==='files'&&i.config.collections.some(c=>c.id===collectionId)))throw new ModuleError('invalid_request',`Another collection already uses the “${collectionId}” id.`);
 return prepareSpecification(db,user,turn,{kind:'specification',operation:'change',projectId:project,expectedRevision:spec.revision,operations:[{type:'modules.put',instance}]});
}
