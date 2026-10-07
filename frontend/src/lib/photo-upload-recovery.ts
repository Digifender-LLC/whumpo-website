import {samePhotoUpload,validPhotoUpload,type PhotoUpload} from '../../../src/photo-upload-shape';
export const photoRecoveryKey='whumpo.photo-upload-recovery';
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
/** Client intent only. The existing photo and module routes decide every write. */
export type PhotoCollectionTarget={resourceId:string;configRevision:number;collectionId:string;requestId:string};
export type PhotoRecovery=PhotoUpload&{collection:PhotoCollectionTarget|null};
type Record={version:2;owner:string;uploads:PhotoRecovery[]};
const uuid=(s:unknown)=>typeof s==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(s);
export function validPhotoCollectionTarget(v:unknown):v is PhotoCollectionTarget|null{
 if(v===null)return true;
 if(!v||typeof v!=='object'||Array.isArray(v))return false;
 const c=v as PhotoCollectionTarget;
 return Object.keys(c).sort().join(',')==='collectionId,configRevision,requestId,resourceId'&&uuid(c.resourceId)&&uuid(c.requestId)
  &&Number.isSafeInteger(c.configRevision)&&c.configRevision>0&&typeof c.collectionId==='string'&&/^[a-z][a-z0-9-]{0,39}$/.test(c.collectionId);
}
function validRecovery(value:unknown):value is PhotoRecovery{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const {collection,...photo}=value as PhotoRecovery;
 return validPhotoUpload(photo)&&validPhotoCollectionTarget(collection);
}
const sameRecovery=(a:PhotoRecovery,b:PhotoRecovery)=>samePhotoUpload(a,b)&&(['resourceId','configRevision','collectionId','requestId'] as const).every(k=>a.collection?.[k]===b.collection?.[k]);
/** Attempted requests have no draft TTL. Bytes never enter browser storage. */
function read(store:Store,owner:string):Record{
 if(!uuid(owner))throw Error('Photo recovery needs your current account.');
 const raw=store.getItem(photoRecoveryKey);if(!raw)return {version:2,owner,uploads:[]};
 let v:Record;try{v=JSON.parse(raw);}catch{throw Error('Photo recovery could not be read. Keep this tab open.');}
 if(raw.length>80000||!v||Object.keys(v).sort().join(',')!=='owner,uploads,version'||v.version!==2||!uuid(v.owner)||!Array.isArray(v.uploads)||v.uploads.length>50||v.uploads.some(u=>!validRecovery(u))||new Set(v.uploads.map(u=>u.projectId)).size!==v.uploads.length)throw Error('Photo recovery needs the current Whumpo format.');
 if(v.owner!==owner){store.removeItem(photoRecoveryKey);return {version:2,owner,uploads:[]};}return v;
}
export function preparePhotoRecovery(store:Store,owner:string){read(store,owner);}
export function listPhotoRecovery(store:Store,owner:string){return read(store,owner).uploads;}
export function readPhotoRecovery(store:Store,owner:string,project:string){return read(store,owner).uploads.find(u=>u.projectId===project)??null;}
export function writePhotoRecovery(store:Store,owner:string,upload:PhotoRecovery){
 if(!validRecovery(upload))throw Error('Invalid photo recovery details.');
 const v=read(store,owner),existing=v.uploads.find(u=>u.projectId===upload.projectId);
 if(existing&&!sameRecovery(existing,upload))throw Error('An earlier photo upload still needs confirmation.');
 if(!existing)v.uploads.push(upload);if(v.uploads.length>50)throw Error('Too many unconfirmed uploads.');
 store.setItem(photoRecoveryKey,JSON.stringify(v));
}
export function resolvePhotoRecovery(store:Store,owner:string,upload:PhotoRecovery){
 const v=read(store,owner),existing=v.uploads.find(u=>u.projectId===upload.projectId&&u.id===upload.id);
 if(existing&&!sameRecovery(existing,upload))throw Error('The upload details changed before confirmation.');
 v.uploads=v.uploads.filter(u=>u.projectId!==upload.projectId||u.id!==upload.id);
 if(v.uploads.length)store.setItem(photoRecoveryKey,JSON.stringify(v));else store.removeItem(photoRecoveryKey);
}
export function clearPhotoRecovery(){try{sessionStorage.removeItem(photoRecoveryKey);}catch{/* Browser storage can be unavailable. */}}
