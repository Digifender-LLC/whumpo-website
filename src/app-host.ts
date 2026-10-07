import {compilerArtifacts} from './project-specification/compiler-artifacts.generated';
import {sha256} from './project-specification/v2/json';
import {publishedPortal} from './visitor-presentation/serve';
import {visitorProject,visitorOrigin} from './hosts';
import {applicationGateway} from './app-gateway';
import {liveAppPage} from './app-pages';
type VisitorEnv=Pick<Env,'DB'|'ENVIRONMENT'|'AUTH_LIMITER'|'API_LIMITER'|'BACKEND_RUNTIME'|'ASSETS'|'TURNSTILE_SECRET'|'FILES'>;
const policy="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'";
function secure(response:Response,styleDigest?:string){const headers=new Headers(response.headers);headers.set('content-security-policy',styleDigest?policy.replace("style-src 'self'","style-src 'self' 'sha256-"+btoa(String.fromCharCode(...styleDigest.match(/../g)!.map(n=>parseInt(n,16))))+"'").replace("img-src 'self'","img-src 'self' blob:"):policy);headers.set('cache-control','private, no-store');headers.set('x-content-type-options','nosniff');headers.set('referrer-policy','no-referrer');headers.set('cross-origin-resource-policy','same-origin');headers.set('x-frame-options','DENY');headers.set('permissions-policy','camera=(), microphone=(), geolocation=()');return new Response(response.body,{status:response.status,headers});}
export default {
 async fetch(request:Request,env:VisitorEnv):Promise<Response>{
  try{
   const url=new URL(request.url),local=String(env.ENVIRONMENT)==='local',project=visitorProject(url.hostname),origin=local?'http://localhost:8787':project?visitorOrigin(project):'';
   if(url.origin!==origin)return secure(new Response('Application host required',{status:404}));
   if(url.pathname==='/module-portal.js'&&request.method==='GET'&&!url.search){const response=await env.ASSETS.fetch(request),source=await response.text();if(!response.ok||new TextEncoder().encode(source).length!==compilerArtifacts.portalClient.bytes||await sha256(source)!==compilerArtifacts.portalClient.digest)return secure(new Response('Portal client unavailable',{status:503}));return secure(new Response(source,{headers:{'content-type':'text/javascript; charset=utf-8'}}));}
   if(['/visitor.js','/visitor.css'].includes(url.pathname)&&request.method==='GET'&&!url.search)return secure(await env.ASSETS.fetch(request));
   const portal=(local?url.pathname:'/apps/'+project+url.pathname).match(/^\/apps\/([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12})\/portal$/);
   if(portal&&request.method==='GET'&&!url.search){
    if(!(await env.API_LIMITER.limit({key:'portal:'+(request.headers.get('cf-connecting-ip')??'unknown')})).success)return secure(new Response('Please try again in a minute.',{status:429}));
    const saved=await publishedPortal(env.DB,portal[1]);
    if(!saved)return secure(new Response('This portal is unavailable.',{status:404}));
    return secure(new Response(saved.artifact.html,{headers:{'content-type':'text/html; charset=utf-8'}}),saved.artifact.styleDigest);
   }
   const page=(local?url.pathname:'/apps/'+project+url.pathname).match(/^\/apps\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/$/);
   if(page&&request.method==='GET'&&!url.search){
    if(!(await env.API_LIMITER.limit({key:'page:'+(request.headers.get('cf-connecting-ip')??'unknown')})).success)return secure(new Response('Please try again in a minute.',{status:429}));
    if(!await liveAppPage(env.DB,page[1]))return secure(new Response('This application page is unavailable.',{status:404}));
    return secure(await env.ASSETS.fetch(new Request(origin+'/index.html')));
   }
   return applicationGateway(request,env);
  }catch{return secure(new Response('The application is temporarily unavailable.',{status:503}));}
 }
} satisfies ExportedHandler<VisitorEnv>;
