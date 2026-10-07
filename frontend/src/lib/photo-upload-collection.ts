import type {OwnerFileCollections} from '../../../src/shared-modules/shape';
import type {PhotoRecovery} from './photo-upload-recovery';
import {fileIntoCollectionBody,ownerCollectionsPath} from './photo-collections';

type Send=(path:string,init?:RequestInit)=>Promise<unknown>;
/** Read-only recovery. Existing owner facts prove current membership even after a lost acknowledgement, collection
 * disable or revision change. A read never files a photo, and neither a saved photo nor its safety status proves filing. */
export async function photoCollectionStatus(send:Send,upload:PhotoRecovery):Promise<'none'|'filed'|'pending'|'different'>{
 const target=upload.collection;if(!target)return 'none';
 const data=await send(ownerCollectionsPath(upload.projectId)) as OwnerFileCollections;
 if(!data||!Array.isArray(data.collections))throw Error('Photo collections need the current Whumpo response.');
 const filed=data.collections.find(c=>Array.isArray(c.files)&&c.files.some(f=>f.fileId===upload.id));
 return filed?filed.resourceId===target.resourceId&&filed.collectionId===target.collectionId?'filed':'different':'pending';
}
/** Explicit continuation of the original upload click: file the already saved owner photo using its exact digest and
 * the request id persisted before any bytes were sent. The module engine rechecks ownership, policy and configuration;
 * an exact retry replays its receipt. Never resend bytes here or replace a stale target with a freshly selected one. */
export async function finishPhotoCollection(send:Send,upload:PhotoRecovery){
 const target=upload.collection;if(!target)return;
 const body=fileIntoCollectionBody(target,{fileId:upload.id,sha256:upload.digest},target.requestId);
 const value=await send(`/projects/${upload.projectId}/modules`,{method:'POST',body:JSON.stringify(body)});
 const reply=value as {api:string;version:number;operation:string;resourceId:string;configRevision:number;requestId:string;result:{fileId:string;collectionId:string}};
 if(!reply||reply.api!==body.api||reply.version!==body.version||reply.operation!==body.operation||reply.resourceId!==body.resourceId
  ||reply.configRevision!==body.configRevision||reply.requestId!==body.requestId||reply.result?.fileId!==upload.id||reply.result?.collectionId!==target.collectionId)
  throw Error('The collection result could not be confirmed. Check the saved photo before retrying.');
 // A replayed receipt records a past filing. Removal after that filing must not be presented as current membership.
 if(await photoCollectionStatus(send,upload)!=='filed')throw Error('The photo is saved, but its collection membership changed. Open Project photos to review it.');
}
