// WH-004 slice 12 regression: the whumpo-sites Worker hands every visitor-application host (app-<uuid>.whumpo.site)
// to the APP_HOST service binding and serves none of the project's public content there, through the sites Worker's
// real default export (src/site-host.ts). Local SQLite (default) or local D1 (`--d1`); synthetic accounts, a counting
// runtime stub, no network.
// Closes the item "the site-host → APP_HOST forwarding" listed under "Still open (slice 2)" in docs/boundary-audit.md,
// recorded on docs/boundary-audit.json family "site-host-dispatch", cell "tenant". Rationale: the cells still marked
// gap/unverified are either control gaps (not enforced, so no add-only test can evidence them), owner-deferred CMS
// cells, or covered by open PR #325; of the two residuals earlier slices named, this is the dispatch that keeps a
// project's published site (which may run backend-form scripts) off the origin that holds its visitors' sessions.
// Asserted:
//   1. Forwarding: GET, HEAD, POST (cookie and body) and PUT on the visitor host reach APP_HOST as the very same Request
//      object (no rewritten URL, method, header or body) and its response is returned unchanged. No backend runtime
//      call and no site traffic is recorded for those requests, even for a forwarded 200 text/html response.
//   2. Real apps Worker behind the binding: the forwarded shell request is answered by src/app-host.ts (404, no live
//      application page), never by the project's published site.
//   3. Fail closed: with no APP_HOST binding, every visitor-host path (site root, /s/<id>/, assets, CMS, directory,
//      backend, any method) is a 503 that carries no site HTML, reaches no runtime and records no traffic.
// Negative controls, each differing only in the host: the same project's own host serves its published site (200) and
// counts traffic without touching APP_HOST; the local alias, the guest-preview host and look-alike hosts
// (suffixed, prefixed, nested, another domain, a malformed id) are never forwarded.
// Not covered: the live service binding and routes in wrangler.sites.jsonc / wrangler.apps.jsonc (R10). Standalone (R7).
import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers,createFixtureProject} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
Error.stackTraceLimit=0;
const d1=process.argv.includes('--d1');
const m=await currentSiteFixtureHandlers(),store=d1?await databaseFixture({d1:true}):await databaseFixture(),{db}=store;
const id=()=>crypto.randomUUID(),scopes=new Map(),scope=u=>scopes.get(u);
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('No network is allowed');};
let runtimeCalls=0;const runtime={fetch:async()=>{runtimeCalls++;return Response.json({ok:true});}};
async function account(){const a=await workspaceFixture(db,m);scopes.set(a.account,await a.scope());return a.account;}
async function chat(user,content){const state=await m.readChat(scope(user),user);const sent=await m.sendChat(scope(user),user,{id:id(),content,revision:state.state.revision});assert.equal(sent.status,200,content);return sent;}
async function publishSite(user,name){
 const site=await createFixtureProject(scope(user),user,name,'A synthetic '+name+' website.'),review=id();
 const state=await m.readChat(scope(user),user);await m.sendChat(scope(user),user,{content:'/publish '+site.version,id:review,revision:state.state.revision});
 await chat(user,'/confirm '+review);
 assert.equal((await db.prepare('SELECT version_id FROM publications WHERE project_id=?').bind(site.project).first())?.version_id,site.version,name+' is published');
 return site;
}
const traffic=async project=>Number((await db.prepare('SELECT coalesce(sum(requests),0) n FROM site_traffic_daily WHERE project_id=?').bind(project).first()).n)+Number((await db.prepare('SELECT coalesce(sum(excluded_requests),0) n FROM site_traffic_quality WHERE project_id=?').bind(project).first()).n);
/** A recording APP_HOST: keeps every Request it receives and answers with a distinctive response. */
function recordingAppHost(respond=()=>new Response('apps-worker-reply',{status:299,headers:{'content-type':'text/html; charset=utf-8','x-apps-worker':'1'}})){
 const seen=[];return {seen,fetch:async request=>{seen.push(request);return respond(request);}};
}
const request=(url,init={})=>new Request(url,{...init,headers:{'cf-connecting-ip':'198.51.100.41',...(init.headers??{})}});

let failed=false;
try{
 const owner=await account(),a=await publishSite(owner,'Visitor meadow');
 const visitorHost=`https://app-${a.project}.whumpo.site`,projectHost=`https://${a.project}.whumpo.site`;
 const siteHTML=await (await m.host.fetch(request(projectHost+'/'),{DB:db,BACKEND_RUNTIME:runtime})).text();
 assert.ok(siteHTML.length>200&&/<html/i.test(siteHTML),'positive control: the project host serves the published site');
 const marker=siteHTML.match(/<title>[^<]+<\/title>/i)?.[0]??siteHTML.slice(0,120);

 // 1. Forwarding: the identical Request reaches APP_HOST and its response comes back unchanged.
 const apps=recordingAppHost(),env={DB:db,BACKEND_RUNTIME:runtime,APP_HOST:apps};
 const forwarded=[
  request(visitorHost+'/'),
  request(visitorHost+'/apps/'+a.project+'/',{method:'HEAD'}),
  request(visitorHost+'/visitor.js'),
  request(visitorHost+'/apps/'+a.project+'/auth/login/options',{method:'POST',headers:{origin:visitorHost,cookie:'__Host-whumpo_app_'+a.project.replaceAll('-','')+'=synthetic','content-type':'application/json'},body:'{"synthetic":true}'}),
  request(visitorHost+'/backend',{method:'POST',headers:{'content-type':'application/json'},body:'{"n":1}'}),
  request(visitorHost+'/s/'+a.project+'/',{method:'PUT',body:'x'}),
 ];
 const trafficBefore=await traffic(a.project);runtimeCalls=0;
 for(const [i,sent] of forwarded.entries()){
  const response=await m.host.fetch(sent,env);
  assert.equal(apps.seen.length,i+1,sent.method+' '+sent.url+' reached APP_HOST');
  assert.equal(apps.seen[i],sent,sent.method+' '+sent.url+' is forwarded as the same Request object');
  assert.equal(response.status,299,sent.url);assert.equal(response.headers.get('x-apps-worker'),'1',sent.url);
  assert.equal(await response.text(),'apps-worker-reply',sent.url+' returns the apps Worker reply unchanged');
 }
 assert.equal(apps.seen[3].headers.get('cookie')?.startsWith('__Host-whumpo_app_'),true,'the visitor cookie is forwarded');
 assert.equal(await apps.seen[3].text(),'{"synthetic":true}','the POST body is forwarded intact');
 assert.equal(runtimeCalls,0,'a forwarded /backend POST never reaches the backend runtime');
 assert.equal(await traffic(a.project),trafficBefore,'a forwarded 200 text/html response records no site traffic');

 // 2. The real apps Worker behind the binding answers the forwarded shell; the published site is not served.
 let assets=0;
 const appEnv={DB:db,ENVIRONMENT:'production',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})},ASSETS:{fetch:async()=>{assets++;return new Response('visitor-asset');}},BACKEND_RUNTIME:runtime};
 const chained=recordingAppHost(forwardedRequest=>m.appHost.fetch(forwardedRequest,appEnv));
 const shell=await m.host.fetch(request(visitorHost+'/'),{DB:db,BACKEND_RUNTIME:runtime,APP_HOST:chained});
 const shellText=await shell.text();
 assert.equal(chained.seen.length,1);assert.equal(shell.status,404,'no live application page on the visitor host');
 assert.equal(shellText,'This application page is unavailable.','answered by src/app-host.ts');
 assert.ok(!shellText.includes(marker),'the published site is not served on the visitor host');
 assert.equal(shell.headers.get('x-frame-options'),'DENY','the apps Worker security headers apply');
 assert.equal(await (await m.host.fetch(request(visitorHost+'/visitor.js'),{DB:db,APP_HOST:chained})).text(),'visitor-asset','visitor assets come from the apps Worker');
 assert.equal(assets,1);

 // 3. Fail closed without the binding: no site content, runtime call or traffic on the visitor host.
 const unbound={DB:db,BACKEND_RUNTIME:runtime},before=await traffic(a.project);runtimeCalls=0;
 for(const [path,method] of [['/','GET'],['/','HEAD'],['/s/'+a.project+'/','GET'],['/assets/'+id()+'.jpg','GET'],['/cms/','GET'],['/directory.json','GET'],['/backend','POST'],['/apps/'+a.project+'/data','POST']]){
  const response=await m.host.fetch(request(visitorHost+path,{method,...(method==='POST'?{body:'{}'}:{})}),unbound),text=await response.text();
  assert.equal(response.status,503,method+' '+path);
  if(method!=='HEAD')assert.equal(text,'Application unavailable',method+' '+path);
  assert.ok(!text.includes(marker),method+' '+path+' serves no site HTML');
 }
 assert.equal(runtimeCalls,0,'no unbound visitor-host request reaches the runtime');
 assert.equal(await traffic(a.project),before,'no unbound visitor-host request records traffic');

 // Negative controls: the same project on its own host, the local alias, the guest-preview host and look-alikes.
 const control=recordingAppHost(),controlEnv={DB:db,BACKEND_RUNTIME:runtime,APP_HOST:control},counted=await traffic(a.project);
 const own=await m.host.fetch(request(projectHost+'/'),controlEnv);
 assert.equal(own.status,200,'the project host serves the published site');assert.ok((await own.text()).includes(marker));
 assert.equal(await traffic(a.project),counted+1,'the project host counts its traffic (the measurement is live)');
 assert.equal((await m.host.fetch(request(`http://localhost/s/${a.project}/`),controlEnv)).status,200,'the local alias serves the site');
 await m.host.fetch(request('https://preview.whumpo.site/'),controlEnv);
 for(const host of [`app-${a.project}.whumpo.site.evil.example`,`xapp-${a.project}.whumpo.site`,`sub.app-${a.project}.whumpo.site`,`app-${a.project}.whumpo.com`,`app-${a.project}x.whumpo.site`,`app-${a.project.slice(0,-1)}.whumpo.site`])
  assert.equal((await m.host.fetch(request(`https://${host}/`),controlEnv)).status,404,host+' is not a visitor host');
 assert.equal(control.seen.length,0,'no control request reached APP_HOST');
 console.log(`Apps-host forwarding passed (${d1?'local D1':'SQLite'}): visitor-host requests reach APP_HOST as the same Request and return its reply, the real apps Worker answers them, and without the binding they fail closed (503, no site content, runtime call or traffic); project, local, preview and look-alike hosts are not forwarded.`);
}catch(error){failed=true;console.error(error);}
finally{globalThis.fetch=originalFetch;await store.close?.();}
process.exit(failed?1:0);
