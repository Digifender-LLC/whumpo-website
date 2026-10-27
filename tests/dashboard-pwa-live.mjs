// Explicit opt-in (WH-119 live gap): anonymous, read-only. No sign-in, no model calls, no writes.
// Checks manifest/icons/worker headers on the live site, then service-worker scope, activation and offline recovery in Chromium.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
if(process.env.RUN_LIVE_DASHBOARD_PWA!=='1')throw Error('Set RUN_LIVE_DASHBOARD_PWA=1 for the live dashboard PWA check');
const {chromium}=createRequire(import.meta.url)(process.env.WHUMPO_PLAYWRIGHT||'@playwright/test');
const base=process.env.WHUMPO_LIVE_ORIGIN||'https://whumpo.com';
const get=async p=>{const r=await fetch(base+p,{redirect:'manual'});return {r,body:Buffer.from(await r.arrayBuffer())};};
// Manifest: status, content type, identity fields, icons.
const m=await get('/manifest.webmanifest');assert.equal(m.r.status,200);assert.equal(m.r.headers.get('content-type'),'application/manifest+json');assert.equal(m.r.headers.get('cache-control'),'no-cache');
const manifest=JSON.parse(m.body);
assert.equal(manifest.id,'/workspace');assert.equal(manifest.start_url,'/workspace');assert.equal(manifest.scope,'/workspace');assert.equal(manifest.display,'standalone');assert.equal(manifest.name,'Whumpo');
assert.deepEqual(manifest.icons.map(i=>i.sizes).sort(),['192x192','512x512']);
for(const icon of manifest.icons){const i=await get(icon.src);assert.equal(i.r.status,200,icon.src);assert.equal(i.r.headers.get('content-type'),'image/png',icon.src);assert.deepEqual([...i.body.subarray(0,4)],[0x89,0x50,0x4e,0x47],icon.src);}
// Worker: headers as declared in frontend/public/_headers.
const sw=await get('/workspace-sw.js');assert.equal(sw.r.status,200);assert.equal(sw.r.headers.get('content-type'),'text/javascript; charset=utf-8');assert.equal(sw.r.headers.get('cache-control'),'no-cache');
// Browser: service workers allowed, anonymous /workspace.
const browser=await chromium.launch({headless:true,...(process.env.WHUMPO_CHROMIUM?{executablePath:process.env.WHUMPO_CHROMIUM}:{})});
try{
 const context=await browser.newContext({serviceWorkers:'allow'}),page=await context.newPage();page.setDefaultTimeout(20000);
 const errors=[],writes=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{// The sign-in gate itself POSTs this anonymous state read on load; any other non-GET fails the run.
  if(r.method()!=='GET'&&new URL(r.url()).pathname!=='/api/auth/identity/v1/state')writes.push(r.method()+' '+r.url());});
 await page.goto(base+'/workspace');
 const reg=await page.evaluate(async()=>{const r=await navigator.serviceWorker.ready;// ready can resolve while still 'activating'
  await new Promise(done=>{const w=r.active;if(w.state==='activated')done();else w.addEventListener('statechange',()=>w.state==='activated'&&done());});return {scope:r.scope,state:r.active?.state,script:r.active?.scriptURL};});
 assert(new URL(reg.scope).pathname.endsWith('/workspace'),reg.scope);assert.equal(reg.state,'activated');assert.equal(reg.script,base+'/workspace-sw.js');
 // Offline behaviour from tests/dashboard-pwa-browser.mjs: the worker controls the page, caches four public files, and serves the branded offline page.
 await page.reload();await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 const cached=await page.evaluate(async()=>{const o={};for(const n of await caches.keys())o[n]=(await (await caches.open(n)).keys()).map(r=>new URL(r.url).pathname).sort();return o;});
 assert.equal(Object.keys(cached).length,1);const paths=Object.values(cached)[0];assert.equal(paths.length,4);assert(paths.every(p=>p.startsWith('/pwa/')||p==='/brand/whumpo-mark-96.png'),paths.join());
 await context.setOffline(true);await page.reload();await page.getByRole('heading',{name:'A little pause. We’ll be right here.'}).waitFor();
 await context.setOffline(false);await page.getByRole('button',{name:'Try again'}).click();await page.getByRole('button',{name:'Sign in with a passkey',exact:true}).waitFor();
 assert.deepEqual(writes,[]);assert.equal(errors.length,0,errors.join('\n'));
 console.log('Live PWA passed: '+base+' manifest/icons/worker headers, scope '+reg.scope+' activated, 4 public cache entries, offline page and anonymous reconnect to sign-in.');
}finally{await browser.close();}
