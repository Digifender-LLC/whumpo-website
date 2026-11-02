import {approvedPhotoSQL,photoBytesMatch} from './photo-safety';
import {publicCMSPublicationImage} from './cms-publication-media';
import {measureTraffic,trafficClass} from './site-traffic';
import {customerProject,visitorProject,projectOrigin,guestPreviewHost} from './hosts';
import {guestPreviewRequest} from './guest-previews/guest';
import {activeBackendForm} from './backend-forms';
import {backendFormScriptPolicy} from './backend-form-render';
import {publicBackend} from './backend-publication';
import {cmsIndex} from './cms-index';
import {hashToken} from './security';
import {publicDirectory} from './directory';
import {directoryPage} from './directory-page';
import {publishedHTML} from './published-html';
import {withAppointmentLink,appointmentLinkShown} from './appointment-link';
import {requireSpecificationAvailable} from './specification-safety';
import { previewHeaders } from './components';
import {reservePublicPhotoRead,StorageLimitError} from './storage-budget';
import {PublicClientLimitError,publicClientSource} from './public-admission';
import {servingStopped} from './operator-serving';
/** Project each custom-domain request was served for, so the after-response count does not repeat the hostname lookup outside its in-flight budget. */
const customDomainProject=new WeakMap<Request,string>();
/** Public serving boundary: only current published HTML and its exact photo dependencies. */
const serving = {
 async fetch(request:Request,env:Pick<Env,'DB'|'FILES'> & Partial<Pick<Env,'BACKEND_RUNTIME'>>&{APP_HOST?:Fetcher;SITE_LIMITER?:RateLimit}):Promise<Response>{
  const url=new URL(request.url),headers={...previewHeaders,'cache-control':'no-store'};
  const local=['localhost','127.0.0.1'].includes(url.hostname),project=customerProject(url.hostname);
  if(visitorProject(url.hostname))return env.APP_HOST?env.APP_HOST.fetch(request):new Response('Application unavailable',{status:503,headers});
  // WH-075 F2: per-source limit before any D1 read. Optional binding: a removed block keeps serving.
  if(!local&&env.SITE_LIMITER&&!(await env.SITE_LIMITER.limit({key:'site:'+publicClientSource(request)})).success)return new Response('Too many requests. Try again in a minute.',{status:429,headers:{...headers,'retry-after':'60'}});
  // WH-092 guest previews: one fixed host (or a local path prefix), never a project or custom domain.
  if(url.hostname===guestPreviewHost||(local&&(url.pathname==='/guest-preview'||url.pathname.startsWith('/guest-preview/'))))return env.FILES?guestPreviewRequest(request,{DB:env.DB,FILES:env.FILES},local):new Response('Preview unavailable',{status:503,headers});
  if(project)url.pathname='/s/'+project+url.pathname;
  const backend=url.pathname.match(/^\/s\/([0-9a-f-]{36})\/backend(?:\/([0-9a-f-]{36}))?$/);
  if(backend&&(local||!!project))return publicBackend(request,env.DB,env.BACKEND_RUNTIME,backend[1],backend[2]);
  if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method not allowed',{status:405,headers:{...headers,allow:'GET, HEAD'}});
  try{
   if(!(local||!!project)){
    // The NOT IN term is the predicate of the partial unique index domain_connection_hostname: without it SQLite scans every connection on every custom-domain request (tests/hot-path-query-plans.mjs).
    const mapping=await env.DB.prepare("SELECT c.project_id FROM domain_connections c JOIN projects p ON p.id=c.project_id AND p.owner_user_id=c.user_id WHERE c.hostname=? AND c.state NOT IN ('review','disconnected') AND c.state='active' AND c.serve_until>? AND c.provider_id IS NOT NULL").bind(url.hostname,new Date().toISOString()).first<{project_id:string}>();
    if(!mapping||!/^\/(?:assets\/[0-9a-f-]{36}\.jpg|directory(?:\.json)?)?$/.test(url.pathname))return new Response('Site not found',{status:404,headers});
    customDomainProject.set(request,mapping.project_id);
    url.pathname='/s/'+mapping.project_id+url.pathname;
   }
   // Operator serving stop: every page, article, directory and photo of the project, same generic response as an outage.
   const served=url.pathname.match(/^\/s\/([0-9a-f-]{36})(?:\/|$)/);
   if(served&&await servingStopped(env.DB,served[1]))return new Response('Site temporarily unavailable',{status:503,headers});
   const cmsImage=url.pathname.match(/^\/s\/([0-9a-f-]{36})\/cms\/media\/([0-9a-f-]{36})\/([0-9a-f]{64})\.jpg$/);
   if(cmsImage)return publicCMSPublicationImage(request,env.DB,env.FILES,cmsImage[1],cmsImage[2],cmsImage[3]);
   const cmsListing=url.pathname.match(/^\/s\/([0-9a-f-]{36})\/cms\/?$/);
   if(cmsListing){const html=await cmsIndex(env.DB,cmsListing[1]);return new Response(request.method==='HEAD'?null:html??'Articles not found',{status:html?200:404,headers});}
   const cms=url.pathname.match(/^\/s\/([0-9a-f-]{36})\/cms\/(posts|pages)\/([0-9A-HJKMNP-TV-Z]{26})$/);
   if(cms){const row=await env.DB.prepare("SELECT public_html,digest FROM cms_live_articles WHERE project_id=? AND collection=? AND item_id=?").bind(cms[1],cms[2],cms[3]).first<{public_html:string;digest:string}>();if(!row)return new Response('Article not found',{status:404,headers});if(await hashToken(row.public_html)!==row.digest)return new Response('Article unavailable',{status:503,headers});return new Response(request.method==='HEAD'?null:row.public_html,{headers:{...headers,'content-security-policy':headers['content-security-policy']+"; img-src 'self'"}});}
   const directory=url.pathname.match(/^\/s\/([0-9a-f-]{36})\/directory(\.json)?$/);
   if(directory){const data=await publicDirectory(env.DB,directory[1]);if(!data)return new Response('Directory not found',{status:404,headers});const json=!!directory[2],{digest,...body}=data;return new Response(request.method==='HEAD'?null:json?JSON.stringify(body):directoryPage(data),{headers:{...headers,etag:'"'+digest+'"',...(json?{'content-type':'application/json; charset=utf-8','access-control-allow-origin':'*','cross-origin-resource-policy':'cross-origin'}:{})}});}
   const asset=url.pathname.match(/^\/s\/([0-9a-f-]{36})\/assets\/([0-9a-f-]{36})\.jpg$/);
   if(asset){
    const photo=await env.DB.prepare(`SELECT s.version_id,f.object_key,f.size,f.digest FROM publications s JOIN version_photos v ON v.version_id=s.version_id JOIN project_files f ON f.id=v.file_id AND f.project_id=s.project_id WHERE s.project_id=? AND f.id=? AND f.status='ready' AND ${approvedPhotoSQL}`).bind(asset[1],asset[2]).first<{version_id:string;object_key:string;size:number;digest:string}>();
    if(!photo)return new Response('Photo not found',{status:404,headers});
    await requireSpecificationAvailable(env.DB,photo.version_id);
    await reservePublicPhotoRead(env.DB,request,asset[1]);
    const object=await env.FILES.get(photo.object_key);
    if(!object||object.size!==photo.size||object.customMetadata?.sha256!==photo.digest){await object?.body.cancel();return new Response('Photo unavailable',{status:503,headers});}
    const bytes=new Uint8Array(await object.arrayBuffer());if(!await photoBytesMatch(bytes,photo.digest))return new Response('Photo unavailable',{status:503,headers});
    return new Response(request.method==='HEAD'?null:bytes,{headers:{...headers,'content-type':'image/jpeg','content-length':String(photo.size),'content-disposition':'inline; filename="photo.jpg"','cross-origin-resource-policy':'cross-origin'}});
   }
   const match=url.pathname.match(/^\/s\/([0-9a-f-]{36})\/?$/);if(!match)return new Response('Site not found',{status:404,headers});
   const site=await env.DB.prepare(`SELECT v.id,v.html,v.component_id,EXISTS(SELECT 1 FROM contact_settings c WHERE c.project_id=s.project_id AND c.enabled=1 AND c.publication_revision=s.revision AND NOT EXISTS(SELECT 1 FROM service_client_blocked_contacts WHERE project_id=c.project_id)) AS contact_enabled,EXISTS(SELECT 1 FROM module_instances i JOIN module_activations a ON a.instance_id=i.id AND a.state='active' AND a.publication_revision=s.revision WHERE i.project_id=s.project_id AND i.kind='records' AND EXISTS(SELECT 1 FROM json_each(i.config_json,'$.forms') f WHERE json_extract(f.value,'$.id')='appointment' AND json_extract(f.value,'$.submit')='public')) AS appointment_enabled FROM publications s JOIN site_versions v ON v.id=s.version_id AND v.project_id=s.project_id WHERE s.project_id=?`).bind(match[1]).first<{id:string;html:string;component_id:string;contact_enabled:number;appointment_enabled:number}>();
   if(!site)return new Response('Site not found',{status:404,headers});
   await requireSpecificationAvailable(env.DB,site.id);
   if(site.component_id==='photo-page@1'&&!url.pathname.endsWith('/'))return new Response(null,{status:308,headers:{...headers,location:new URL(request.url).pathname+'/'}});
   const contact=site.contact_enabled===1;
   const form=await activeBackendForm(env.DB,match[1]);
   const appointment=await appointmentLinkShown(env.DB,match[1],site.appointment_enabled);
   const html=withAppointmentLink(publishedHTML(site.html,contact,match[1],form),match[1],appointment);
   const formPolicy=form?"; script-src "+await backendFormScriptPolicy()+"; connect-src "+projectOrigin(match[1])+"":'';
   const sandbox='sandbox'+(form?' allow-scripts allow-forms':'')+(contact||appointment?' allow-popups allow-popups-to-escape-sandbox':'')+';';
   return new Response(request.method==='HEAD'?null:html,{headers:{...headers,'content-security-policy':headers['content-security-policy'].replace('sandbox;',sandbox)+"; img-src 'self'"+formPolicy}});
  }catch(cause){if(cause instanceof PublicClientLimitError)return new Response('Too many photo requests from this connection today',{status:429,headers});return new Response(cause instanceof StorageLimitError?'Photo allowance temporarily exhausted':'Site temporarily unavailable',{status:503,headers});}
 }
} satisfies ExportedHandler<Pick<Env,'DB'|'FILES'> & Partial<Pick<Env,'BACKEND_RUNTIME'>>&{APP_HOST?:Fetcher;SITE_LIMITER?:RateLimit}>;

export default {
 async fetch(request:Request,env:Parameters<typeof serving.fetch>[1],ctx?:ExecutionContext):Promise<Response>{
  const response=await serving.fetch(request,env);
  if(request.method==='GET'&&response.status===200&&response.headers.get('content-type')?.startsWith('text/html')){
   const url=new URL(request.url);
   if(!visitorProject(url.hostname)&&url.hostname!==guestPreviewHost&&!url.pathname.startsWith('/guest-preview')){
    const kind=trafficClass(request),count=async()=>{
     let project=customerProject(url.hostname);
     if(!project&&['localhost','127.0.0.1'].includes(url.hostname))project=url.pathname.match(/^\/s\/([0-9a-f-]{36})(?:\/|$)/)?.[1]??null;
     project??=customDomainProject.get(request)??null;
     if(project)await measureTraffic(env.DB,project,kind);
    };
    const task=count().catch(()=>{console.warn('site.traffic.unavailable')});
    if(ctx)ctx.waitUntil(task);else await task;
   }
  }
  return response;
 }
} satisfies ExportedHandler<Parameters<typeof serving.fetch>[1]>;
