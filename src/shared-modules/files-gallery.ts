import {prepareSpecification} from '../project-specification/store';
import {approvedPhotoSQL,photoSafetySQL} from '../photo-safety';
import {assertWorkspace} from '../workspace-identity/admission';
import {ModuleError} from './policy';
import {currentSpecification,instanceOf,registeredInstances} from './registry';
import type {OwnerFileCollections} from './shape';

/** WH-128 published galleries. A typed owner Chat control (`galleryPageReview`), never a model action and never
 * advertised to the site agent: it prepares the existing exact private website review that sets one page's photos to the
 * newest approved photos (at most four, the `photo-page@1` bound) the owner filed into an owner collection of a registered
 * files instance. The gallery is a snapshot of exact photo ids taken at preparation; it never follows the collection live.
 * Saving is the existing recent-sign-in `specificationApply` control and going public is the existing exact publication
 * review, which (with the serving checks) still requires the current exact-digest approval of every photo (WH-013), so no
 * review is skipped or combined and no compiler, component or publication path changes. Staff and visitor module uploads
 * are never candidates (`module_file_not_published` refuses them as website photos). The
 * `project_spec_gallery_admit` trigger repeats the shape inside the commit. Deterministic: no inference or provider. */
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const local=/^[a-z][a-z0-9-]{0,39}$/;
export const galleryPhotoLimit=4;

/** `/review-collection-gallery PROJECT INSTANCE COLLECTION PAGE` from the typed galleryPageReview control. Returns the
 * existing specification review reply and statements; the reply is linked to the review so Chat shows the save control. */
export async function prepareGalleryPageCommand(db:D1Database,user:string,turn:string,command:string){
 if(!command.startsWith('/review-collection-gallery '))return;
 const [,project,instanceId,collectionId,pageId,...extra]=command.split(' ');
 if(extra.length||!uuid.test(project??'')||!local.test(instanceId??'')||!local.test(collectionId??'')||!local.test(pageId??'')||!uuid.test(turn))throw new ModuleError('invalid_request','Choose an owned project, collection and page.');
 await assertWorkspace(db,user);
 const spec=await currentSpecification(db,user,project);
 if(!spec)throw new ModuleError('not_found','This project has no saved website configuration yet. Ask Whumpo to draft the project’s private website first.');
 const row=(await registeredInstances(db,project)).find(r=>r.local_id===instanceId&&r.kind==='files');
 if(!row)throw new ModuleError('not_found','Activate this files module before using its collection on a page.');
 const instance=await instanceOf(row);
 const collection=instance.kind==='files'?instance.config.collections.find(c=>c.id===collectionId):undefined;
 if(!collection)throw new ModuleError('not_found','Collection not found.');
 if(!collection.upload.includes('owner'))throw new ModuleError('forbidden','Only an owner collection can become a website gallery.');
 const {results}=await db.prepare(`SELECT f.id,f.name FROM module_files mf JOIN project_files f ON f.id=mf.file_id AND f.project_id=mf.project_id JOIN projects p ON p.id=f.project_id
  WHERE mf.instance_id=? AND mf.project_id=? AND mf.collection_id=? AND mf.uploader_kind='owner' AND p.owner_user_id=? AND f.status='ready' AND ${approvedPhotoSQL}
  ORDER BY mf.created_at DESC,mf.file_id DESC LIMIT ?`).bind(row.id,project,collection.id,user,galleryPhotoLimit).all<{id:string;name:string}>();
 if(!results.length)throw new ModuleError('unavailable','This collection has no approved photos yet. Photos held for safety checks cannot be used on a page.');
 // The existing review owns compilation, page existence, photo ownership/clearance, safety holds, staleness, bounds and
 // the reply (BackendError on refusal). The owner's own photo name is the alt text, as for any website photo.
 return prepareSpecification(db,user,turn,{kind:'specification',operation:'change',projectId:project,expectedRevision:spec.revision,
  operations:[{type:'pages.setPhotos',pageId,photos:results.map(r=>({id:r.id,alt:r.name.trim()||'Photo'}))}]});
}

/** WH-128 owner Photos panel controls (GET /api/projects/P/module-files, workspace origin, dashboard only). Lists what the
 * owner needs to file existing photos into an owner collection with the owner `files.putBytes` route and to start the
 * typed `galleryPageReview` control: page ids, unfiled ready library photos with their exact digest, and the owner
 * collections with their owner-filed photos and safety state. Staff and visitor uploads never appear. Read-only: filing
 * and the gallery review keep their own server checks (module_file_admit, the exact specification and publication
 * reviews). No Chat history or model context. */
export async function readOwnerFileCollections(db:D1Database,user:string,project:string):Promise<OwnerFileCollections>{
 if(!uuid.test(project)||!await db.prepare('SELECT 1 FROM projects WHERE id=? AND owner_user_id=?').bind(project,user).first())throw new ModuleError('not_found','Project not found.');
 let pages:OwnerFileCollections['pages']=[];
 try{pages=(await currentSpecification(db,user,project))?.pages.slice(0,16)??[];}catch(error){if(!(error instanceof ModuleError))throw error;}
 const {results:candidates}=await db.prepare(`SELECT f.id fileId,f.digest sha256 FROM project_files f WHERE f.project_id=? AND f.status='ready' AND NOT EXISTS(SELECT 1 FROM module_files mf WHERE mf.file_id=f.id)
  ORDER BY f.created_at DESC,f.id DESC LIMIT 50`).bind(project).all<{fileId:string;sha256:string}>();
 const collections:OwnerFileCollections['collections']=[];
 for(const row of (await registeredInstances(db,project)).filter(r=>r.kind==='files'&&r.state!==null).slice(0,8)){
  const instance=await instanceOf(row);if(instance.kind!=='files')continue;
  for(const c of instance.config.collections.filter(c=>c.upload.includes('owner'))){
   const {results}=await db.prepare(`SELECT f.id fileId,${photoSafetySQL} AS safety FROM module_files mf JOIN project_files f ON f.id=mf.file_id AND f.project_id=mf.project_id
    WHERE mf.instance_id=? AND mf.project_id=? AND mf.collection_id=? AND mf.uploader_kind='owner' AND f.status='ready' ORDER BY mf.created_at DESC,mf.file_id DESC LIMIT 50`)
    .bind(row.id,project,c.id).all<{fileId:string;safety:'pending'|'approved'|'blocked'}>();
   collections.push({instanceId:row.local_id,resourceId:row.id,configRevision:row.config_revision,state:row.state as OwnerFileCollections['collections'][number]['state'],collectionId:c.id,files:results});
  }
 }
 return {pages,candidates,collections};
}
