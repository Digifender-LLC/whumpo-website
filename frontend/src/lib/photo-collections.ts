import type {OwnerFileCollections} from '../../../src/shared-modules/shape';
import type {ChatControl} from '../../../src/chat-controls';

/** WH-128 owner Photos panel client (docs/shared-modules.md#owner-photos-panel-controls-wh-128--october-4-2026-utc).
 * "Add to collection" sends the existing owner `files.putBytes` module request (an existing photo by id and exact digest)
 * to the workspace module route; "Prepare gallery page" only builds the typed `galleryPageReview` Chat control, whose
 * reply is the existing exact specification review. No new authority: the server decides every request. */
export type OwnerCollection=OwnerFileCollections['collections'][number];
export type CollectionCandidate=OwnerFileCollections['candidates'][number];
type Send=(path:string,init:RequestInit)=>Promise<unknown>;

export const ownerCollectionsPath=(project:string)=>`/projects/${project}/module-files`;
export const collectionKey=(c:Pick<OwnerCollection,'instanceId'|'collectionId'>)=>c.instanceId+'/'+c.collectionId;
export const collectionLabel=(c:Pick<OwnerCollection,'instanceId'|'collectionId'>)=>c.instanceId+' · '+c.collectionId;
/** Owner filing needs an active files instance (module_file_admit repeats it inside the commit). */
export const fileableCollections=(d:OwnerFileCollections|undefined)=>(d?.collections??[]).filter(c=>c.state==='active');
/** Where a photo is filed, if anywhere (a photo belongs to at most one collection). */
export const collectionOf=(d:OwnerFileCollections|undefined,fileId:string)=>(d?.collections??[]).find(c=>c.files.some(f=>f.fileId===fileId));
export const candidateOf=(d:OwnerFileCollections|undefined,fileId:string)=>(d?.candidates??[]).find(c=>c.fileId===fileId);
/** A gallery needs a saved page and at least one approved owner-filed photo; held photos are never candidates. */
export const galleryReady=(c:OwnerCollection,pages:OwnerFileCollections['pages'])=>pages.length>0&&c.files.some(f=>f.safety==='approved');

export function fileIntoCollectionBody(c:OwnerCollection,candidate:CollectionCandidate,requestId:string){
 return {api:'whumpo-modules',version:1,operation:'files.putBytes',resourceId:c.resourceId,configRevision:c.configRevision,requestId,target:{collectionId:c.collectionId},input:{fileId:candidate.fileId,sha256:candidate.sha256}};
}
export function galleryReviewAction(projectId:string,c:Pick<OwnerCollection,'instanceId'|'collectionId'>,pageId:string):ChatControl{
 return {type:'galleryPageReview',projectId,instanceId:c.instanceId,collectionId:c.collectionId,pageId};
}

/** Files photos into collections, reusing one request id per photo and collection until a result is confirmed, so a
 * lost acknowledgement replays the module receipt instead of filing twice. */
export function collectionFiler(send:Send){
 const pending=new Map<string,string>();
 return async function file(project:string,c:OwnerCollection,candidate:CollectionCandidate){
  const key=c.resourceId+'/'+c.collectionId+'/'+candidate.fileId,requestId=pending.get(key)??crypto.randomUUID();pending.set(key,requestId);
  const result=await send(`/projects/${project}/modules`,{method:'POST',body:JSON.stringify(fileIntoCollectionBody(c,candidate,requestId))});
  pending.delete(key);return result;
 };
}
