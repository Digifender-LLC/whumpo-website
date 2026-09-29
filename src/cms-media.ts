import {cmsConnection} from './cms-status';
import {callCMS} from './cms-bridge';
import {cmsItemId} from './cms-content-shape';
import {cmsMediaPath} from './cms-media-path';
import {CMSProjectError} from './cms-error';
const integer=(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0?v:null;
export function cmsMediaMetadata(value:unknown,page:number){
 const data=value as {items:Record<string,unknown>[];totalCount:unknown};
 if(!Array.isArray(data?.items)||data.items.length>20||integer(data.totalCount)===null)throw new CMSProjectError(502,'CMS media inventory could not be confirmed');
 const items=data.items.map(item=>{
  if(!item||typeof item.id!=='string'||!cmsItemId.test(item.id)||typeof item.filename!=='string'||typeof item.mimeType!=='string')throw new CMSProjectError(502,'CMS media inventory could not be confirmed');
  return {id:item.id,filename:item.filename.slice(0,255),mimeType:item.mimeType.slice(0,100),size:integer(item.size),width:integer(item.width),height:integer(item.height),alt:typeof item.alt==='string'?item.alt.slice(0,1000):''};
 });
 return {page,pageSize:20,total:data.totalCount as number,hasMore:page<1000&&page*20<(data.totalCount as number),limitReached:page===1000&&page*20<(data.totalCount as number),items};
}
export async function listCMSMedia(db:D1Database,user:string,project:string,page:unknown,env:Record<string,unknown>){
 const {service,config}=await cmsConnection(db,user,project,env);
 if(typeof page!=='number'||!Number.isInteger(page)||page<1||page>1000)throw new CMSProjectError(400,'Choose a media page from 1 to 1000');
 try{return {projectId:project,...cmsMediaMetadata(await callCMS(service,config,cmsMediaPath(page),crypto.randomUUID()),page)};}
 catch(error){if(error instanceof CMSProjectError)throw error;throw new CMSProjectError(503,'Media browsing is not available on this CMS connection yet');}
}
