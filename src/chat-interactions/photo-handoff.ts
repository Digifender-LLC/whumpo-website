import {FileError} from '../photo-format';
import {validPhotoHandoff,type PhotoHandoff} from '../photo-upload-shape';
import {assertFeature,featurePredicate} from '../feature-admission';
import {interactionGuard,readInteraction,InteractionStoreError} from './store';
import {isPhotoIntakeDefinition} from './maintained';

/** Current upload protocol: explicit null means the direct project uploader. */
export function parsePhotoHandoff(header:string|null):PhotoHandoff|null{
 try{
  if(header===null||header.length>512)throw Error();
  const value:unknown=JSON.parse(header);
  if(!validPhotoHandoff(value))throw Error();
  return value===null?null:{interactionId:value.interactionId,definitionDigest:value.definitionDigest};
 }catch{throw new FileError(400,'The photo upload needs its current Chat handoff or an explicit direct-upload context.');}
}

/** A reserved upload keeps its original handoff even after dismissal/expiry.
 * New reservations must use the exact currently open maintained uploader. */
export async function admitPhotoHandoff(db:D1Database,user:string,project:string,handoff:PhotoHandoff|null,reserved:boolean){
 if(!handoff)return;
 await assertFeature(db,{userId:user,projectId:project,featureId:'core.editing',operation:'prepare'});
 if(reserved)return;
 try{
  const form=await readInteraction(db,user,handoff.interactionId);
  if(form.envelope.scope.projectId!==project||form.envelope.definitionDigest!==handoff.definitionDigest||form.state!=='open'||form.replacementInteractionId||!isPhotoIntakeDefinition(form.envelope.definition))throw new InteractionStoreError(409,'interaction_changed');
 }catch(e){if(e instanceof InteractionStoreError)throw new FileError(409,'This Chat uploader is no longer available for a new photo. Ask Whumpo for another uploader.');throw e;}
}

/** Ownership is checked for every path. The Chat adapter additionally retains
 * its current feature admission through reservation and storage confirmation. */
export function photoUploadGuards(db:D1Database,user:string,project:string,handoff:PhotoHandoff|null){
 const guards=[interactionGuard(db,'EXISTS(SELECT 1 FROM projects WHERE id=? AND owner_user_id=?)',[project,user])];
 if(handoff){const gate=featurePredicate(db,{userId:user,projectId:project,featureId:'core.editing',operation:'prepare'});guards.push(interactionGuard(db,gate.sql,gate.params));}
 return guards;
}

/** Closure is a monotonic server fact. Once closed, the insert trigger refuses
 * any later reservation for this handoff. Missing readback alone is not proof. */
export async function closedPhotoHandoff(db:D1Database,user:string,project:string,handoff:PhotoHandoff|null){
 if(!handoff)return null;
 const closed=await db.prepare(`SELECT 1 FROM chat_interactions i JOIN projects p ON p.id=i.project_id AND p.owner_user_id=i.user_id
  WHERE i.id=? AND i.user_id=? AND i.project_id=? AND i.definition_digest=?
   AND (i.state!='open' OR i.removed_at IS NOT NULL OR i.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')
    OR EXISTS(SELECT 1 FROM chat_interactions child WHERE child.previous_interaction_id=i.id))`).bind(handoff.interactionId,user,project,handoff.definitionDigest).first();
 return closed?handoff:null;
}
