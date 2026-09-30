import {signCMSRequest} from './cms-bridge';
import {cmsConnection} from './cms-status';
import {CMSProjectError} from './cms-error';
import {cmsItemId} from './cms-content-shape';
import {cmsPreviewTypes,cmsPreviewMagic,boundedCMSImage,cmsPreviewResponse} from './cms-media-preview-shape';

export async function readCMSMediaPreview(db:D1Database,user:string,project:string,id:string,env:Record<string,unknown>){
 const {service,config}=await cmsConnection(db,user,project,env);
 if(!cmsItemId.test(id))throw new CMSProjectError(400,'Choose a valid media item');
 const controller=new AbortController(),signal=controller.signal;
 let timer:ReturnType<typeof setTimeout>;
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('Preview timed out'));},20000);});
 try{
  const request=await signCMSRequest(config,'/_emdash/api/whumpo/media/'+id+'/preview',crypto.randomUUID());
  const response=await Promise.race([service.fetch(new Request(request,{signal,redirect:'manual'})),deadline]);
  const type=response.headers.get('content-type')??'';
  if(response.status!==200||!response.body||!cmsPreviewTypes.includes(type)||response.headers.has('content-encoding')){void response.body?.cancel().catch(()=>{});throw Error('Preview unavailable');}
  const bytes=await boundedCMSImage(response.body,signal);
  if(!cmsPreviewMagic(bytes,type))throw Error('Invalid preview');
  // Do not forward any native cookies, caching, redirect or object metadata headers.
  return cmsPreviewResponse(bytes,type);
 }catch{throw new CMSProjectError(503,'This image cannot be previewed. The CMS may need an update, or the file may use an unsupported format or exceed 5 MB.');}finally{clearTimeout(timer!);}
}
