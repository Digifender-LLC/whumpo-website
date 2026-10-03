// Opt-in Chromium acceptance. Builds current frontend assets in a disposable directory.
// Disposable real D1 + actual platform handlers; no model/provider configuration or remote bindings.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,sep} from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {build as viteBuild} from 'vite';
import {buildPwa} from '../tools/build-pwa.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.WHUMPO_PLAYWRIGHT||'@playwright/test');
const dir=await mkdtemp('/tmp/whumpo-pwa-browser-'),root=resolve(dir,'web'),origin='http://localhost:8787';let fixture,server,browser;
const requests=[],errors=[];let workerRevision=0;
try{
 await viteBuild({build:{outDir:root},logLevel:'error'});await buildPwa(pathToFileURL(root+'/'));
 await mkdir('.secrets',{recursive:true});
 const m=await currentSiteFixtureHandlers(),{worker:platform}=m;
 fixture=await databaseFixture({d1:true,r2:true});
 const db=fixture.db,owner=await workspaceFixture(db,m),token=owner.token;
 const env={...fixture.env,ENVIRONMENT:'local',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}};
 const ctx={waitUntil(){throw Error('No inference expected');}};
 const call=(path,method,body)=>platform.fetch(new Request(origin+path,{method,headers:{origin,cookie:'__Host-whumpo_session='+token,'content-type':'application/json'},body:JSON.stringify(body)}),env,ctx);
 assert.equal((await call('/api/profile','PATCH',{revision:0,name:'PWA tester',avatar_id:'sun'})).status,200);
 assert.equal((await call('/api/onboarding','PUT',{revision:0,stage:'review',prompt:'review',project_name:'Synthetic Garden',idea:'A fictional gardening project',audience:'Neighbors',preferred_theme:'forest'})).status,200);
 assert.equal((await call('/api/onboarding/complete','POST',{revision:1})).status,200);
 server=createServer(async(req,res)=>{try{
  if(req.headers.host!=='localhost:8787'){res.writeHead(403).end();return;}
  const url=new URL(req.url,origin);requests.push({path:url.pathname,method:req.method});
  if(url.pathname==='/_acceptance/start'){res.writeHead(302,{'set-cookie':'__Host-whumpo_session='+token+'; Secure; HttpOnly; SameSite=Lax; Path=/','location':'/workspace/settings'}).end();return;}
  if(url.pathname.startsWith('/api/')){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const response=await platform.fetch(new Request(url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})}),env,ctx);
   for(const cookie of response.headers.getSetCookie())res.appendHeader('set-cookie',cookie);res.writeHead(response.status,Object.fromEntries([...response.headers].filter(([name])=>name!=='set-cookie')));res.end(Buffer.from(await response.arrayBuffer()));return;
  }
  // Mirror Cloudflare's HTML canonicalization so redirect-sensitive worker install is exercised.
  if(url.pathname==='/pwa/offline.html'){res.writeHead(307,{location:'/pwa/offline'}).end();return;}
  const name=url.pathname==='/pwa/offline'?'pwa/offline.html':url.pathname==='/'||url.pathname==='/workspace'||url.pathname.startsWith('/workspace/')?'index.html':decodeURIComponent(url.pathname).slice(1),path=resolve(root,name);
  if(!path.startsWith(root+sep)){res.writeHead(404).end();return;}
  let bytes=await readFile(path);if(name==='workspace-sw.js')bytes=Buffer.concat([bytes,Buffer.from(`\n// Synthetic worker update ${workerRevision}\n`)]);
  const ext=path.split('.').at(-1);res.writeHead(200,{'content-type':{html:'text/html',js:'text/javascript',css:'text/css',svg:'image/svg+xml',png:'image/png',woff2:'font/woff2',webmanifest:'application/manifest+json'}[ext]??'application/octet-stream','cache-control':'no-cache'}).end(bytes);
 }catch{res.writeHead(500).end('Local fixture failed');}});
 await new Promise((done,reject)=>{server.once('error',reject);server.listen(8787,'127.0.0.1',done)});
 // A temporary persistent profile is required: Chromium forbids installation in incognito contexts.
 const context=await chromium.launchPersistentContext(dir+'/browser',{headless:true,viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,...(process.env.WHUMPO_CHROMIUM?{executablePath:process.env.WHUMPO_CHROMIUM}:{})});browser=context;
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/_acceptance/start');await page.getByText('Whumpo, a tap away',{exact:true}).waitFor();
 await page.waitForFunction(()=>!!navigator.serviceWorker.controller,{},{timeout:15000});
 const cdp=await context.newCDPSession(page);const manifest=await cdp.send('Page.getAppManifest'),installability=await cdp.send('Page.getInstallabilityErrors');
 assert.equal(manifest.url,origin+'/manifest.webmanifest');assert.equal(manifest.errors.length,0);assert.equal(installability.installabilityErrors.length,0,JSON.stringify(installability));
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.getByRole('button',{name:'Night',exact:true}).click();await page.waitForFunction(()=>document.querySelector('meta[name="theme-color"]')?.content==='#0b172a');
 await page.getByRole('button',{name:'Day',exact:true}).click();await page.waitForFunction(()=>document.querySelector('meta[name="theme-color"]')?.content==='#F8FAFC');
 const cacheRows=()=>page.evaluate(async()=>{const result={};for(const name of await caches.keys())result[name]=(await (await caches.open(name)).keys()).map(r=>new URL(r.url).pathname).sort();return result;});
 const cached=await cacheRows();assert.equal(Object.keys(cached).length,1);assert.equal(Object.values(cached)[0].length,4);assert(Object.values(cached)[0].every(p=>p.startsWith('/pwa/')||p==='/brand/whumpo-mark-96.png'));
 // Exercise explicit install UI without installing an OS app in this fixture.
 await page.evaluate(()=>{const event=new Event('beforeinstallprompt',{cancelable:true});Object.assign(event,{prompt:async()=>{},userChoice:Promise.resolve({outcome:'dismissed'})});window.dispatchEvent(event);});
 await page.getByRole('button',{name:'Add Whumpo to your device'}).click();await page.getByRole('status').filter({hasText:'You can add Whumpo later'}).waitFor();
 await page.screenshot({path:'.secrets/pwa-settings-mobile.png',fullPage:true});
 await context.setOffline(true);await page.reload();await page.getByRole('heading',{name:'A little pause. We’ll be right here.'}).waitFor();
 await page.screenshot({path:'.secrets/pwa-offline-mobile.png',fullPage:true});
 await context.setOffline(false);await page.getByRole('button',{name:'Try again'}).click();await page.getByText('Whumpo, a tap away',{exact:true}).waitFor();
 // Changing the active worker must not reload a document or erase a composing draft.
 await page.getByRole('link',{name:'Chat',exact:true}).click();await page.getByRole('textbox',{name:'Message Whumpo'}).fill('Synthetic unsent garden note');
 await page.evaluate(()=>{window.__pwaDocument='preserved';});workerRevision++;
 await page.evaluate(async()=>{const registration=await navigator.serviceWorker.ready;const changed=new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));await registration.update();await changed;});
 assert.equal(await page.evaluate(()=>window.__pwaDocument),'preserved');assert.equal(await page.getByRole('textbox',{name:'Message Whumpo'}).inputValue(),'Synthetic unsent garden note');
 assert.deepEqual(await cacheRows(),cached);
 // Installation/offline screens never confer identity after server-side revocation.
 const turns=(await db.prepare('SELECT count(*) n FROM chat_turns').first()).n;
 await owner.revoke();await context.setOffline(true);await page.reload();await page.getByRole('heading',{name:'A little pause. We’ll be right here.'}).waitFor();
 await context.setOffline(false);await page.getByRole('button',{name:'Try again'}).click();await page.getByRole('button',{name:'Sign in with a passkey',exact:true}).waitFor();
 assert.equal(await page.getByRole('textbox',{name:'Message Whumpo'}).count(),0);
 assert.equal((await db.prepare('SELECT count(*) n FROM chat_turns').first()).n,turns);
 assert.deepEqual(await cacheRows(),cached);assert.equal(errors.length,0,errors.join('\n'));
 for(const table of ['inference_calls','publications','stripe_paid_invoices'])assert.equal((await db.prepare('SELECT COUNT(*) n FROM '+table).first()).n,0);
 await writeFile('.secrets/pwa-browser.json',JSON.stringify({checkedAt:new Date().toISOString(),manifestErrors:manifest.errors,installabilityErrors:installability.installabilityErrors,caches:cached,mobileWidth:390,offlineRecovery:true,updatePreservesDraft:true,revokedOfflineReconnectRefused:true,pageErrors:errors,apiRequests:requests.filter(r=>r.path.startsWith('/api/')),scope:'Disposable Chromium/D1, no physical-device or OS-install acceptance'},null,2),{mode:0o600});
 console.log('PWA browser passed: valid/installable manifest, active worker, mobile Settings, explicit install dismissal, offline/reconnect, public-only cache update preserving unsent draft and revoked-identity refusal after offline reconnect.');
}finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(done=>server.close(done));}await fixture?.close();await rm(dir,{recursive:true,force:true});}
