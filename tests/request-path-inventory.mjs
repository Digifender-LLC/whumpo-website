import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {measure,drift,readWorkers,entryWorker,workerRuns,parseJSONC,markdown} from '../tools/request-path-inventory.mjs';
Error.stackTraceLimit=0;
// WH-073 slice 2 (measurement only): the request-path inventory derived from wrangler configuration and measured through the
// real Worker handlers is current (committed JSON and docs table), and its invariants hold: every visitor route class is a
// Worker invocation, none is cacheable, the repeat request does the same work (no in-isolate cache), and every revocation
// probe stops serving without a cacheable response. Local synthetic counts only; no delivery, cache or config change.
let checks=0;const check=async(name,fn)=>{try{await fn();checks++;}catch(error){console.error(name);throw error;}};
const cacheable=/public|s-maxage|max-age=[1-9]|immutable|stale-/i;
try{
 await check('configuration derivation follows the checked-in routes and run_worker_first',async()=>{
  const workers=await readWorkers(),uuid=crypto.randomUUID();
  assert.equal(entryWorker(workers,'https://whumpo.com/contact/'+uuid).worker,'whumpo-platform');
  assert.equal(entryWorker(workers,`https://${uuid}.whumpo.site/`).worker,'whumpo-sites');
  assert.equal(entryWorker(workers,`https://app-${uuid}.whumpo.site/visitor.js`).worker,'whumpo-sites','Visitor apps are reached only through the sites Worker');
  assert.equal(entryWorker(workers,'https://preview.whumpo.site/').worker,'whumpo-sites');
  assert.equal(entryWorker(workers,'https://whumpo.site/'),null,'The zone apex is not routed');
  assert.equal(entryWorker(workers,'https://shop.custom.example/'),null,'Custom-hostname routing is not configured');
  for(const name of ['whumpo-platform','whumpo-sites','whumpo-apps'])assert.equal(workerRuns(workers[name],'/visitor.js').runs,true,name+' runs before any asset');
  assert.equal(workers['whumpo-sites'].assets,null);assert.equal(workers['whumpo-apps'].routes.length,0);
  for(const w of Object.values(workers))assert.equal(w.cache,null,'Workers Caching is not enabled on any Worker');
  // The derivation is sensitive to the configuration, not hard-coded: altered copies change the answer.
  const altered=await readWorkers(async path=>{const text=await readFile(new URL('../'+path,import.meta.url),'utf8');if(path==='wrangler.apps.jsonc')return text.replace('"run_worker_first": true','"run_worker_first": ["/modules", "/api/*"]');if(path==='wrangler.sites.jsonc')return text.replace('"*.whumpo.site/*"','"sites.whumpo.site/*"');return text;});
  assert.equal(workerRuns(altered['whumpo-apps'],'/visitor.js').runs,'only-if-no-asset');assert.equal(workerRuns(altered['whumpo-apps'],'/modules').runs,true);
  assert.equal(entryWorker(altered,`https://${uuid}.whumpo.site/`),null);
  assert.deepEqual(parseJSONC('{"a":"//x", /* c */ "b":[1,],// d\n}'),{a:'//x',b:[1]});
 });
 const inventory=await measure();
 await check('every visitor route class is a Worker invocation; none is a direct static-asset request',async()=>{
  assert.ok(inventory.routes.length>=20);
  for(const r of inventory.routes){
   assert.equal(r.workerExecution.runs,true,r.key);assert.ok(r.firstRequest.workers.length>=1,r.key);
   for(const t of r.workerExecution.serviceBindingTargets)assert.equal(t.runs,true,r.key+' '+t.binding+' target runs before assets');
   if(r.entry.worker)assert.equal(r.firstRequest.workers[0],r.entry.worker,r.key);
  }
  const app=inventory.routes.filter(r=>r.key.startsWith('app.'));assert.ok(app.length>=3);
  for(const r of app)assert.deepEqual(r.firstRequest.workers,['whumpo-sites','whumpo-apps'],r.key+' crosses the APP_HOST service binding');
  const script=inventory.routes.find(r=>r.key==='app.script.get');assert.equal(script.firstRequest.assetsBinding,1,'The visitor script is a Worker-wrapped asset fetch');
 });
 await check('no measured response is cacheable and the repeat request does the same work',async()=>{
  for(const r of inventory.routes){
   if(r.assetsStub&&r.cacheControl===null){assert.equal(r.key,'platform.asset.get');continue;}
   assert.match(r.cacheControl,/no-store/,r.key);assert.ok(!cacheable.test(r.cacheControl),r.key+' '+r.cacheControl);assert.deepEqual(r.validators,r.key.startsWith('site.directory.')&&r.key.endsWith('.live')?['etag']:[],r.key+' (a published directory carries its snapshot digest as an ETag, still no-store)');
   assert.equal(r.repeatRequest.sameWork,true,r.key+' repeat work differs: an in-isolate cache appeared');assert.equal(r.repeatRequest.status,r.status,r.key);
  }
  assert.equal(inventory.routes.find(r=>r.key==='contact.form.get').repeatRequest.bodyIdentical,false,'Each contact form render carries a fresh message id');
  for(const key of ['site.root.get','site.photo.get','custom.root.get','custom.photo.get'])assert.equal(inventory.routes.find(r=>r.key===key).repeatRequest.bodyIdentical,true,key);
 });
 await check('the successful directory, CMS, backend form and visitor app routes are measured, not only their 404/400 forms',async()=>{
  const route=key=>inventory.routes.find(r=>r.key===key),ok=['site.directory.json.live','site.directory.html.live','site.cms.index.live','site.cms.article.get','site.root.backend-form','site.backend.post','app.page.live','app.module.access.me'];
  for(const key of ok){assert.equal(route(key).status,200,key);assert.equal(route(key).firstRequest.subrequests.length,0,key);}
  for(const key of ['site.directory.json','site.directory.html','site.cms.index'])assert.equal(route(key).status,404,key+' stays as the unpublished contrast');
  assert.equal(route('site.backend.post').firstRequest.serviceBindings.BACKEND_RUNTIME,1,'The backend form runs the customer program once');
  assert.ok(route('site.root.backend-form').revocationInputs.includes('live backend form'));
  assert.ok(route('site.cms.index.live').revocationInputs.includes('live CMS article'));
  assert.ok(route('app.page.live').revocationInputs.includes('live visitor application page'));
 });
 await check('published content reads its revocation inputs on every request',async()=>{
  const inputs=key=>inventory.routes.find(r=>r.key===key).revocationInputs;
  for(const key of ['site.root.get','site.photo.get','custom.root.get','custom.photo.get']){
   for(const signal of ['publication pointer (publish, restore, unpublish)','safety hold (content screening)','specification availability (current schema and compiler)'])assert.ok(inputs(key).includes(signal),key+' '+signal);
  }
  for(const key of ['site.photo.get','custom.photo.get'])assert.ok(inputs(key).includes('photo safety approval'),key);
  for(const key of ['custom.root.get','custom.photo.get'])assert.ok(inputs(key).includes('custom-domain mapping (active, serve_until)'),key);
  const photo=inventory.routes.find(r=>r.key==='site.photo.get').firstRequest;assert.equal(photo.r2.get,1);assert.ok(photo.d1.writes>=3,'Each public photo read records client and storage counters');
  for(const r of inventory.routes)assert.deepEqual(r.firstRequest.subrequests,r.key==='contact.form.post'?['challenges.cloudflare.com']:[],r.key);
 });
 await check('every revocation probe stops serving the dependent routes without a cacheable response',async()=>{
  const expected={'publication pointer':['root','photo','customRoot','customPhoto','contact'],'safety hold':['root','photo','customRoot','customPhoto'],'photo safety approval':['photo','customPhoto'],'custom-domain mapping':['customRoot','customPhoto']};
  assert.deepEqual(inventory.revocation.map(p=>p.signal),Object.keys(expected));
  for(const p of inventory.revocation){
   for(const [route,status] of Object.entries(p.before))assert.equal(status,200,p.signal+' '+route+' served before');
   for(const [route,after] of Object.entries(p.after)){
    assert.match(after.cacheControl,/no-store/);assert.ok(!cacheable.test(after.cacheControl));
    if(expected[p.signal].includes(route))assert.notEqual(after.status,200,p.signal+' still serves '+route);else assert.equal(after.status,200,p.signal+' unexpectedly revoked '+route);
   }
  }
 });
 await check('the committed inventory and docs table match this measurement',async()=>{
  assert.deepEqual(await drift(inventory),[]);assert.ok(markdown(inventory).split('\n').length>inventory.routes.length);
 });
 process.stdout.write(`Request-path inventory passed: ${checks} groups on ${inventory.database}; ${inventory.routes.length} visitor route classes are Worker invocations (sites, apps via APP_HOST, platform) with no cacheable response and identical repeat work (no in-isolate cache), and ${inventory.revocation.length} revocation probes (unpublish, safety hold, photo approval, custom-domain mapping) stop serving with no-store. Synthetic local counts; not Cloudflare billing, rows read/written, CPU time or latency.\n`);
}catch(error){console.error(String(error.stack||error));process.exitCode=1;}
