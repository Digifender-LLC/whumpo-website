import {assertWorkspace} from '../workspace-identity/admission';
import {approvedPhotoSQL} from '../photo-safety';
import {InteractionError} from './protocol';
import type {Answers,Definition,Field} from './types';

export const photoField=(field:Field)=>field.type==='resource'&&field.constraints.collection==='photos';
type SelectedPhoto={id:string;project_id:string;name:string;width:number;height:number;digest:string};
/** Resolves only explicitly selected IDs. No bytes, URLs, keys or unselected
 * inventory enter form answers or model context. Each consumer carries guards
 * through its final dispatch/commit, not just this preflight read. */
export async function readSelectedPhotos(db:D1Database,user:string,projectId:string|null,definition:Definition,answers:Answers){
 const photos:SelectedPhoto[]=[];
 for(const field of definition.fields.filter(photoField)){
  if(!Object.hasOwn(answers,field.id))continue;
  const values=answers[field.id];
  if(!projectId||!Array.isArray(values)||values.length>5)throw new InteractionError('RESOURCE_UNAVAILABLE',field.id);
  for(const id of values){
   const photo=await db.prepare(`SELECT f.id,f.project_id,f.name,f.width,f.height,f.digest
    FROM project_files f JOIN projects p ON p.id=f.project_id
    WHERE f.id=? AND f.project_id=? AND p.owner_user_id=? AND f.status='ready' AND ${approvedPhotoSQL}`).bind(id,projectId,user).first<SelectedPhoto>();
   if(!photo)throw new InteractionError('RESOURCE_UNAVAILABLE',field.id);
   if(!photos.some(p=>p.id===photo.id))photos.push(photo);
  }
 }
 if(photos.length)await assertWorkspace(db,user);
 return photos;
}
export function selectedPhotoGuards(db:D1Database,user:string,photos:SelectedPhoto[]){
 return photos.map(photo=>db.prepare(`INSERT INTO chat_interaction_checks(denied) SELECT 1 WHERE NOT EXISTS(
  SELECT 1 FROM project_files f JOIN projects p ON p.id=f.project_id
  WHERE f.id=? AND f.project_id=? AND p.owner_user_id=? AND f.digest=? AND f.status='ready' AND ${approvedPhotoSQL})`).bind(photo.id,photo.project_id,user,photo.digest));
}
export const photoContext=(photos:SelectedPhoto[])=>photos.map(p=>({id:p.id,project_id:p.project_id,name:p.name,width:p.width,height:p.height}));
