import {callCMS,type CMSBridgeConfig} from './cms-bridge';
import {cmsPreviewLimit,cmsPreviewTypes,cmsPreviewKey,cmsPreviewMagic,boundedCMSImage,cmsPreviewResponse} from './cms-media-preview-shape';
export async function nativeCMSPreview(id:string,config:CMSBridgeConfig,bucket:R2Bucket|undefined,dispatch:(request:Request)=>Promise<Response>){
 const unavailable=()=>Response.json({error:'Image preview unavailable'},{status:404,headers:{'cache-control':'no-store'}});
 if(!bucket)return unavailable();
 try{
  // Re-sign the exact native metadata request; native auth verifies it independently.
  const data=await callCMS({fetch:(request:Request)=>{const headers=new Headers(request.headers);headers.set('origin',config.origin);headers.set('x-emdash-request','1');return dispatch(new Request(request,{headers}));}} as Fetcher,config,'/_emdash/api/media/'+id,crypto.randomUUID());
  const item=data?.item;
  if(item?.id!==id||item.status!=='ready'||!cmsPreviewTypes.includes(item.mimeType)||!cmsPreviewKey.test(item.storageKey??'')||!Number.isSafeInteger(item.size)||item.size<12||item.size>cmsPreviewLimit)return unavailable();
  const object=await bucket.get(item.storageKey);
  if(!object)return unavailable();
  if(object.size!==item.size||object.httpMetadata?.contentEncoding){void object.body.cancel().catch(()=>{});return unavailable();}
  const bytes=await boundedCMSImage(object.body,AbortSignal.timeout(15000));
  if(bytes.length!==item.size||!cmsPreviewMagic(bytes,item.mimeType))return unavailable();
  return cmsPreviewResponse(bytes,item.mimeType);
 }catch{return unavailable();}
}
