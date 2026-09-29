import { previewHeaders } from './components';
import {reserveStorage,StorageLimitError} from './storage-budget';
/** Public serving boundary: only current published HTML and its exact photo dependencies. */
export default {
 async fetch(request:Request,env:Pick<Env,'DB'|'FILES'>):Promise<Response>{
  const url=new URL(request.url),headers={...previewHeaders,'cache-control':'no-store'};
  if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method not allowed',{status:405,headers:{...headers,allow:'GET, HEAD'}});
  try{
   const asset=url.pathname.match(/^\/s\/([0-9a-f-]{36})\/assets\/([0-9a-f-]{36})\.jpg$/);
   if(asset){
    const photo=await env.DB.prepare("SELECT f.object_key,f.size,f.digest FROM publications s JOIN version_photos v ON v.version_id=s.version_id JOIN project_files f ON f.id=v.file_id AND f.project_id=s.project_id WHERE s.project_id=? AND f.id=? AND f.status='ready'").bind(asset[1],asset[2]).first<{object_key:string;size:number;digest:string}>();
    if(!photo)return new Response('Photo not found',{status:404,headers});
    await reserveStorage(env.DB,'read');
    const object=await env.FILES.get(photo.object_key);
    if(!object||object.size!==photo.size||object.customMetadata?.sha256!==photo.digest){await object?.body.cancel();return new Response('Photo unavailable',{status:503,headers});}
    if(request.method==='HEAD')await object.body.cancel();
    return new Response(request.method==='HEAD'?null:object.body,{headers:{...headers,'content-type':'image/jpeg','content-length':String(photo.size),'content-disposition':'inline; filename="photo.jpg"','cross-origin-resource-policy':'cross-origin'}});
   }
   const match=url.pathname.match(/^\/s\/([0-9a-f-]{36})\/?$/);if(!match)return new Response('Site not found',{status:404,headers});
   const site=await env.DB.prepare('SELECT v.html,v.component_id FROM publications s JOIN site_versions v ON v.id=s.version_id AND v.project_id=s.project_id WHERE s.project_id=?').bind(match[1]).first<{html:string;component_id:string}>();
   if(!site)return new Response('Site not found',{status:404,headers});
   if(site.component_id==='photo-page@1'&&!url.pathname.endsWith('/'))return new Response(null,{status:308,headers:{...headers,location:url.pathname+'/'}});
   return new Response(request.method==='HEAD'?null:site.html,{headers:{...headers,'content-security-policy':headers['content-security-policy']+"; img-src 'self'"}});
  }catch(cause){return new Response(cause instanceof StorageLimitError?'Photo allowance temporarily exhausted':'Site temporarily unavailable',{status:503,headers});}
 }
} satisfies ExportedHandler<Pick<Env,'DB'|'FILES'>>;
