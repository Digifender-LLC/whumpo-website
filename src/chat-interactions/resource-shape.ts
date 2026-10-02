import {copyJSON} from '../project-specification/v2/json';
export type ResourceCursor={id:string;name:string};
export type ResourceOption=ResourceCursor&{photo:null|{width:number;height:number;size:number}};
export type ResourcePage={version:1;interactionId:string;definitionDigest:string;fieldId:string;collection:'projects'|'photos';items:ResourceOption[];nextBefore:ResourceCursor|null};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:unknown,keys:string[])=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
const label=(v:unknown)=>typeof v==='string'&&!!v.trim()&&v.length<=100;
export const resourceCursor=(v:unknown):v is ResourceCursor=>object(v)&&exact(v,['id','name'])&&uuid(v.id)&&label(v.name);
const integer=(v:unknown,max:number)=>Number.isSafeInteger(v)&&(v as number)>0&&(v as number)<=max;
/** Closed metadata only. No object keys, image URLs, bytes or effect authority. */
export function readResourcePage(input:unknown):ResourcePage|null{
 try{
  const p=copyJSON(input,16384) as ResourcePage;
  if(!exact(p,['version','interactionId','definitionDigest','fieldId','collection','items','nextBefore'])||p.version!==1||!uuid(p.interactionId)||typeof p.definitionDigest!=='string'||!/^[a-f0-9]{64}$/.test(p.definitionDigest)||typeof p.fieldId!=='string'||!/^[a-z][a-z0-9-]{0,39}$/.test(p.fieldId)||['constructor','prototype','__proto__'].includes(p.fieldId)||!['projects','photos'].includes(p.collection)||!Array.isArray(p.items)||p.items.length>20)return null;
  if(!p.items.every(i=>exact(i,['id','name','photo'])&&uuid(i.id)&&label(i.name)&&(p.collection==='projects'?i.photo===null:exact(i.photo,['width','height','size'])&&integer(i.photo!.width,1600)&&integer(i.photo!.height,1600)&&integer(i.photo!.size,1048576)))||new Set(p.items.map(i=>i.id)).size!==p.items.length)return null;
  if(p.nextBefore!==null&&(!resourceCursor(p.nextBefore)||!p.items.length||p.items.at(-1)!.id!==p.nextBefore.id||p.items.at(-1)!.name!==p.nextBefore.name))return null;
  return p;
 }catch{return null;}
}
