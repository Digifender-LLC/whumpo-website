import {prepareSpecification} from '../project-specification/store';
import {approvedPhotoSQL} from '../photo-safety';
import {assertWorkspace} from '../workspace-identity/admission';
import {ModuleError} from './policy';
import {currentSpecification,instanceOf,registeredInstances} from './registry';

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
