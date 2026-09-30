import {publicCMSPublicationImage} from './cms-publication-media';
import {recordTraffic} from './site-traffic';
import {customerProject,visitorProject,projectOrigin} from './hosts';
import {activeBackendForm} from './backend-forms';
import {backendFormScriptPolicy} from './backend-form-render';
import {publicBackend} from './backend-publication';
import {cmsIndex} from './cms-index';
import {hashToken} from './security';
import {publicDirectory} from './directory';
import {directoryPage} from './directory-page';
import {publishedHTML} from './published-html';
import { previewHeaders } from './components';
import {reserveStorage,StorageLimitError} from './storage-budget';
/** Public serving boundary: only current published HTML and its exact photo dependencies. */
const serving = {
 async fetch(request:Request,env:Pick<Env,'DB'|'FILES'> & Partial<Pick<Env,'BACKEND_RUNTIME'>>&{APP_HOST?:Fetcher}):Promise<Response>{
  const url=new URL(request.url),headers={...previewHeaders,'cache-control':'no-store'};
  const local=['localhost','127.0.0.1'].includes(url.hostname),project=customerProject(url.hostname);
  if(visitorProject(url.hostname))return env.APP_HOST?env.APP_HOST.fetch(request):new Response('Application unavailable',{status:503,headers});
  if(project)url.pathname='/s/'+project+url.pathname;
  const backend=url.pathname.match(/^\/s\/([0-9a-f-]{36})\/backend(?:\/([0-9a-f-]{36}))?$/);
  if(backend&&(local||!!project))return publicBackend(request,env.DB,env.BACKEND_RUNTIME,backend[1],backend[2]);
  if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method not allowed',{status:405,headers:{...headers,allow:'GET, HEAD'}});
  try{
   if(!(local||!!project)){
    const mapping=await env.DB.prepare("SELECT c.project_id FROM domain_connections c JOIN projects p ON p.id=c.project_id AND p.owner_user_id=c.user_id WHERE c.hostname=? AND c.state='active' AND c.serve_until>? AND c.provider_id IS NOT NULL").bind(url.hostname,new Date().toISOString()).first<{project_id:string}>();
    if(!mapping||!/^\/(?:assets\/[0-9a-f-]{36}\.jpg)?$/.test(url.pathname))return new Response('Site not found',{status:404,headers});
    url.pathname='/s/'+mapping.project_id+url.pathname;
   }
   const cmsImage=url.pathname.match(/^\/s\/([0-9a-f-]{36})\/cms\/media\/([0-9a-f-]{36})\/([0-9a-f]{64})\.jpg$/);
   if(cmsImage)return publicCMSPublicationImage(request,env.DB,env.FILES,cmsImage[1],cmsImage[2],cmsImage[3]);
   const cmsListing=url.pathname.match(/^\/s\/([0-9a-f-]{36})\/cms\/?$/);
   if(cmsListing){const html=await cmsIndex(env.DB,cmsListing[1]);return new Response(request.method==='HEAD'?null:html??'Articles not found',{status:html?200:404,headers});}
   const cms=url.pathname.match(/^\/s\/([0-9a-f-]{36})\/cms\/(posts|pages)\/([0-9A-HJKMNP-TV-Z]{26})$/);
   if(cms){const row=await env.DB.prepare("SELECT public_html,digest FROM cms_live_articles WHERE project_id=? AND collection=? AND item_id=?").bind(cms[1],cms[2],cms[3]).first<{public_html:string;digest:string}>();if(!row)return new Response('Article not found',{status:404,headers});if(await hashToken(row.public_html)!==row.digest)return new Response('Article unavailable',{status:503,headers});return new Response(request.method==='HEAD'?null:row.public_html,{headers:{...headers,'content-security-policy':headers['content-security-policy']+"; img-src 'self'"}});}
   const directory=url.pathname.match(/^\/s\/([0-9a-f-]{36})\/directory(\.json)?$/);
   if(directory){const data=await publicDirectory(env.DB,directory[1]);if(!data)return new Response('Directory not found',{status:404,headers});const json=!!directory[2];return new Response(request.method==='HEAD'?null:json?JSON.stringify(data):directoryPage(data),{headers:{...headers,...(json?{'content-type':'application/json; charset=utf-8','access-control-allow-origin':'*','cross-origin-resource-policy':'cross-origin'}:{})}});}
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
   const site=await env.DB.prepare('SELECT v.html,v.component_id,EXISTS(SELECT 1 FROM contact_settings c WHERE c.project_id=s.project_id AND c.enabled=1 AND c.publication_revision=s.revision) AS contact_enabled FROM publications s JOIN site_versions v ON v.id=s.version_id AND v.project_id=s.project_id WHERE s.project_id=?').bind(match[1]).first<{html:string;component_id:string;contact_enabled:number}>();
   if(!site)return new Response('Site not found',{status:404,headers});
   if(site.component_id==='photo-page@1'&&!url.pathname.endsWith('/'))return new Response(null,{status:308,headers:{...headers,location:new URL(request.url).pathname+'/'}});
   const contact=site.contact_enabled===1;
   const form=await activeBackendForm(env.DB,match[1]);
   const html=publishedHTML(site.html,contact,match[1],form);
   const formPolicy=form?"; script-src "+await backendFormScriptPolicy()+"; connect-src "+projectOrigin(match[1])+"":'';
   const sandbox='sandbox'+(form?' allow-scripts allow-forms':'')+(contact?' allow-popups allow-popups-to-escape-sandbox':'')+';';
   return new Response(request.method==='HEAD'?null:html,{headers:{...headers,'content-security-policy':headers['content-security-policy'].replace('sandbox;',sandbox)+"; img-src 'self'"+formPolicy}});
  }catch(cause){return new Response(cause instanceof StorageLimitError?'Photo allowance temporarily exhausted':'Site temporarily unavailable',{status:503,headers});}
 }
} satisfies ExportedHandler<Pick<Env,'DB'|'FILES'> & Partial<Pick<Env,'BACKEND_RUNTIME'>>&{APP_HOST?:Fetcher}>;

export default {
 async fetch(request:Request,env:Parameters<typeof serving.fetch>[1],ctx?:ExecutionContext):Promise<Response>{
  const response=await serving.fetch(request,env);
  if(request.method==='GET'&&response.status===200&&response.headers.get('content-type')?.startsWith('text/html')){
   const url=new URL(request.url);
   if(!visitorProject(url.hostname)){
    const count=async()=>{
     let project=customerProject(url.hostname);
     if(!project&&['localhost','127.0.0.1'].includes(url.hostname))project=url.pathname.match(/^\/s\/([0-9a-f-]{36})(?:\/|$)/)?.[1]??null;
     if(!project){const mapping=await env.DB.prepare("SELECT project_id FROM domain_connections WHERE hostname=? AND state='active' AND serve_until>? AND provider_id IS NOT NULL").bind(url.hostname,new Date().toISOString()).first<{project_id:string}>();project=mapping?.project_id??null;}
     if(project)await recordTraffic(env.DB,project);
    };
    const task=count().catch(()=>{console.warn('site.traffic.unavailable')});
    if(ctx)ctx.waitUntil(task);else await task;
   }
  }
  return response;
 }
} satisfies ExportedHandler<Parameters<typeof serving.fetch>[1]>;
