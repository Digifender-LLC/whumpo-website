import {visitorProject,visitorOrigin} from './hosts';
import {applicationGateway} from './app-gateway';
import {liveAppPage} from './app-pages';
import {appointmentPage,appointmentPolicy} from './appointment-page';
type VisitorEnv=Pick<Env,'DB'|'ENVIRONMENT'|'AUTH_LIMITER'|'API_LIMITER'|'BACKEND_RUNTIME'|'ASSETS'|'TURNSTILE_SECRET'|'TURNSTILE_SITE_KEY'|'FILES'>;
const policy="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'";
function secure(response:Response,csp=policy){const headers=new Headers(response.headers);headers.set('content-security-policy',csp);headers.set('cache-control','private, no-store');headers.set('x-content-type-options','nosniff');headers.set('referrer-policy','no-referrer');headers.set('cross-origin-resource-policy','same-origin');headers.set('x-frame-options','DENY');headers.set('permissions-policy','camera=(), microphone=(), geolocation=()');return new Response(response.body,{status:response.status,headers});}
export default {
 async fetch(request:Request,env:VisitorEnv):Promise<Response>{
  try{
   const url=new URL(request.url),local=String(env.ENVIRONMENT)==='local',project=visitorProject(url.hostname),origin=local?'http://localhost:8787':project?visitorOrigin(project):'';
   if(url.origin!==origin)return secure(new Response('Application host required',{status:404}));
   if(['/visitor.js','/visitor.css','/design-tokens.css','/appointment.js','/appointment.css'].includes(url.pathname)&&request.method==='GET'&&!url.search)return secure(await env.ASSETS.fetch(request));
   const page=(local?url.pathname:'/apps/'+project+url.pathname).match(/^\/apps\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/$/);
   if(page&&request.method==='GET'&&!url.search){
    if(!(await env.API_LIMITER.limit({key:'page:'+(request.headers.get('cf-connecting-ip')??'unknown')})).success)return secure(new Response('Please try again in a minute.',{status:429}));
    // An operator serving stop keeps this same static visitor client: the gateway refuses its configuration, so it
    // opens only the visitor's own sign-in, recovery, saved data, export and deletion (never the program or modules).
    if(!await liveAppPage(env.DB,page[1]))return secure(new Response('This application page is unavailable.',{status:404}));
    return secure(await env.ASSETS.fetch(new Request(origin+'/index.html')));
   }
   // WH-070 hosted standard appointment request page. This route alone relaxes the policy (Turnstile script and frame); open only
   // while the form is bound and the deployed Worker holds the Turnstile secret, otherwise one closed page that submits nothing.
   const form=(local?url.pathname:'/apps/'+project+url.pathname).match(/^\/apps\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/forms\/appointment$/);
   if(form&&request.method==='GET'&&!url.search){
    if(!(await env.API_LIMITER.limit({key:'page:'+(request.headers.get('cf-connecting-ip')??'unknown')})).success)return secure(new Response('Please try again in a minute.',{status:429}));
    const shown=await appointmentPage(env.DB,form[1],{local,secretPresent:!!env.TURNSTILE_SECRET,siteKey:env.TURNSTILE_SITE_KEY||null});
    return secure(shown.response,shown.open?appointmentPolicy:policy);
   }
   return applicationGateway(request,env);
  }catch{return secure(new Response('The application is temporarily unavailable.',{status:503}));}
 }
} satisfies ExportedHandler<VisitorEnv>;
