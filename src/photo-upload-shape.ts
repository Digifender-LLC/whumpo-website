/** Metadata receipt only. No object key, image bytes, URL or safety authority. */
export type PhotoHandoff={interactionId:string;definitionDigest:string};
export type PhotoUpload={id:string;projectId:string;name:string;digest:string;size:number;width:number;height:number;handoff:PhotoHandoff|null};
export type PhotoUploadStatus={version:1;photo:(PhotoUpload&{status:'pending'|'ready';safetyStatus:'pending'|'approved'|'blocked'})|null;closedHandoff:PhotoHandoff|null};
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
export function validPhotoHandoff(v:unknown):v is PhotoHandoff|null{
 return v===null||object(v)&&Object.keys(v).sort().join(',')==='definitionDigest,interactionId'&&uuid(v.interactionId)&&typeof v.definitionDigest==='string'&&/^[a-f0-9]{64}$/.test(v.definitionDigest);
}
export function validPhotoUpload(value:unknown):value is PhotoUpload{
 if(!object(value)||Object.keys(value).sort().join(',')!=='digest,handoff,height,id,name,projectId,size,width'||!validPhotoHandoff(value.handoff))return false;
 return uuid(value.id)&&uuid(value.projectId)&&typeof value.name==='string'&&value.name===value.name.trim()&&value.name.length>0&&value.name.length<=100&&!/[\x00-\x1f\x7f/\\]/.test(value.name)&&typeof value.digest==='string'&&/^[a-f0-9]{64}$/.test(value.digest)&&['size','width','height'].every(k=>Number.isSafeInteger(value[k])&&Number(value[k])>=1&&Number(value[k])<=(k==='size'?1048576:1600));
}
export function readPhotoUploadStatus(value:unknown):PhotoUploadStatus|null{
 if(!object(value)||Object.keys(value).sort().join(',')!=='closedHandoff,photo,version'||value.version!==1||!validPhotoHandoff(value.closedHandoff))return null;
 if(value.photo===null)return {version:1,photo:null,closedHandoff:value.closedHandoff};
 if(value.closedHandoff!==null)return null;
 if(!object(value.photo))return null;
 const {status,safetyStatus,...photo}=value.photo;
 if(!validPhotoUpload(photo)||typeof status!=='string'||!['pending','ready'].includes(status)||typeof safetyStatus!=='string'||!['pending','approved','blocked'].includes(safetyStatus))return null;
 return value as PhotoUploadStatus;
}
export function samePhotoUpload(a:PhotoUpload,b:PhotoUpload){return (['id','projectId','name','digest','size','width','height'] as const).every(k=>a[k]===b[k])&&a.handoff?.interactionId===b.handoff?.interactionId&&a.handoff?.definitionDigest===b.handoff?.definitionDigest;}
