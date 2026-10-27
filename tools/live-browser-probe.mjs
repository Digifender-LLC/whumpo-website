import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {probeTarget} from './probe-health.mjs';
// Read-only live browser probe. Opt-in via `--live <origin>`. GET only, except one same-origin POST of {"version":1} to the identity config route (public Turnstile site key): no forms, no Turnstile interaction, no /api writes,
// no cookies or storage kept (fresh context, service workers blocked), no Stripe, no account. Fails closed on any other host.
const require=createRequire(import.meta.url),{chromium}=require('@playwright/test');
const pages=[{name:'landing',path:'/'},{name:'signup-entry',path:'/workspace/?signup=true',turnstile:true}];
const viewports=[390,1280];
// The signup page's own CSP permits Turnstile; its script and frame are GET-only loads from this one host.
const allowedExternal='https://challenges.cloudflare.com';
// Both routes only read (config returns the public site key, state reads the session); anything else stays aborted.
const allowedPosts=new Set(['/api/auth/identity/v1/config','/api/auth/identity/v1/state']);
// Known, accepted block: the Stripe pricing-table script is never loaded by a read-only probe.
const knownForeign='https://js.stripe.com';
// Turnstile's own challenge POSTs: https origins only, this one host, this one path prefix.
export const isChallengePost=(method,url,origin)=>method==='POST'&&origin.startsWith('https:')&&url.origin===allowedExternal&&url.pathname.startsWith('/cdn-cgi/challenge-platform/');
const isAllowedPost=(request,url,origin)=>{
 if(request.method()!=='POST'||url.origin!==origin||!allowedPosts.has(url.pathname))return false;
 try{const b=JSON.parse(request.postData()??'');return Object.keys(b).length===1&&b.version===1;}catch{return false;}
};
export async function probeBrowser(target,{timeoutMs=15000}={}){
 const origin=probeTarget(target),checks=[],blocked=[],knownBlocked=[];
 const add=(check,path,ok,failure,extra={})=>checks.push({check,path,state:ok?'ok':'failed',...extra,...(ok?{}:{failure})});
 const browser=await chromium.launch();
 try{
  const context=await browser.newContext({serviceWorkers:'block',acceptDownloads:false});
  await context.route('**/*',route=>{
   const request=route.request(),url=new URL(request.url());
   if(!/^https?:$/.test(url.protocol))return route.continue();
   const sameOrigin=url.origin===origin,external=origin.startsWith('https:')&&url.origin===allowedExternal;
   if(isAllowedPost(request,url,origin)||isChallengePost(request.method(),url,origin))return route.continue();
   if(request.method()==='GET'&&url.origin===knownForeign){knownBlocked.push({method:'GET',url:url.origin+url.pathname,reason:'expected_foreign_host'});return route.abort();}
   if(request.method()!=='GET'||!(sameOrigin||external)){blocked.push({method:request.method(),url:url.origin+url.pathname,reason:request.method()!=='GET'?(url.pathname.startsWith('/api/')?'api_write':'non_get'):'foreign_host'});return route.abort();}
   return route.continue();
  });
  await context.addInitScript(()=>{window.__csp=[];addEventListener('securitypolicyviolation',e=>window.__csp.push(e.violatedDirective+' '+e.blockedURI));});
  for(const spec of pages){
   const page=await context.newPage(),consoleErrors=[];
   page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text().slice(0,200));});
   page.on('pageerror',e=>consoleErrors.push(String(e.message).slice(0,200)));
   for(const width of viewports){
    await page.setViewportSize({width,height:900});
    const started=Date.now();let status=null;
    try{
     const response=await page.goto(origin+spec.path,{waitUntil:'load',timeout:timeoutMs});status=response?.status()??null;
     const heading=await page.locator('h1,h2,[role=heading]').first().waitFor({state:'visible',timeout:timeoutMs}).then(()=>true,()=>false);
     add('heading_visible@'+width,spec.path,status===200&&heading,status===200?'no_visible_heading':'unexpected_status',{status,latencyMs:Date.now()-started});
     const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
     add('no_horizontal_scroll@'+width,spec.path,overflow<=0,'overflow_'+overflow+'px');
     if(spec.turnstile&&width===1280){
      const frame=await page.locator('iframe[src^="'+allowedExternal+'/"],iframe[title*="Cloudflare security challenge"]').first().waitFor({state:'attached',timeout:timeoutMs}).then(()=>true,()=>false);
      add('turnstile_iframe',spec.path,frame,'iframe_missing');
     }
    }catch(error){add('page_load@'+width,spec.path,false,error?.name==='TimeoutError'?'timeout':'unreachable',{status,latencyMs:Date.now()-started});}
   }
   const csp=await page.evaluate(()=>window.__csp).catch(()=>[]);
   add('console_errors',spec.path,!consoleErrors.length,'console_errors',{count:consoleErrors.length,sample:consoleErrors.slice(0,3)});
   add('csp_violations',spec.path,!csp.length,'csp_violations',{count:csp.length,sample:csp.slice(0,3)});
   await page.close();
  }
  const started=Date.now();
  try{
   const health=await context.request.get(origin+'/api/health',{maxRedirects:0,timeout:timeoutMs}),body=await health.json().catch(()=>null);
   add('health','/api/health',health.status()===200&&body?.status==='ok',health.status()===200?'unexpected_body':'unexpected_status',{status:health.status(),latencyMs:Date.now()-started});
  }catch{add('health','/api/health',false,'unreachable');}
  try{
   const manifest=await context.request.get(origin+'/manifest.webmanifest',{maxRedirects:0,timeout:timeoutMs}),body=await manifest.json().catch(()=>null);
   add('manifest','/manifest.webmanifest',manifest.status()===200&&body&&typeof body==='object','manifest_unreachable_or_invalid',{status:manifest.status()});
  }catch{add('manifest','/manifest.webmanifest',false,'unreachable');}
 }finally{await browser.close();}
 add('no_blocked_requests','*',!blocked.length,'blocked_requests',{count:blocked.length});
 return {target:origin,observedAt:new Date().toISOString(),checks,blocked,knownBlocked,attention:checks.some(c=>c.state!=='ok'),scope:'Read-only headless Chromium GETs of the landing and signup entry pages, plus two POSTs of {"version":1}, to /api/auth/identity/v1/config (public Turnstile site key) and /api/auth/identity/v1/state (session read), both made by the signup page; plus the Turnstile widget POSTs under https://challenges.cloudflare.com/cdn-cgi/challenge-platform/ (https targets only); every other non-GET is aborted. The js.stripe.com pricing-table script is an expected block, listed in knownBlocked and not a failure. Proves render, console/CSP cleanliness, Turnstile iframe presence, health, manifest and no horizontal scroll at 390px and 1280px. Does not sign up, enrol passkeys, solve Turnstile, call Stripe or write anything.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const args=process.argv.slice(2);
 if(args.length!==2||args[0]!=='--live'){console.error('Live browser probe is opt-in. Usage: node tools/live-browser-probe.mjs --live https://ORIGIN (http only on loopback).');process.exitCode=1;}
 else{
  try{probeTarget(args[1]);}catch{console.error('Invalid probe target: a bare https origin (http only on loopback) is required.');process.exit(1);}
  const report=await probeBrowser(args[1]);
  console.log(JSON.stringify(report,null,2));if(report.attention)process.exitCode=2;
 }
}
