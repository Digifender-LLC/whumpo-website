// Opt-in Chromium acceptance. Requires built dist, Playwright and a local browser executable.
// Disposable real D1 + actual platform handlers; no model/provider configuration or remote bindings.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {resolve,sep} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import wrangler from 'wrangler';
const require=createRequire(import.meta.url),{chromium}=require(process.env.WHUMPO_PLAYWRIGHT||'playwright');
const dir=await mkdtemp('/tmp/whumpo-pwa-browser-'),root=resolve('dist'),origin='http://localhost:8185';let proxy,server,browser;
const requests=[],errors=[];let workerRevision=0;
try{
 const b=await build({stdin:{contents:"export {default as platform} from './src/index';export {hashToken} from './src/security';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
 const {platform,hashToken}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','tellumo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
 proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});
 const db=proxy.env.DB,user=crypto.randomUUID(),now=new Date().toISOString(),token='e'.repeat(64);
 await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(user,'pwa@example.test',now).run();
 await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await hashToken(token),user,new Date(Date.now()+3600000).toISOString(),now).run();
 const env={...proxy.env,ENVIRONMENT:'local',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}};
 const ctx={waitUntil(){throw Error('No inference expected');}};
 const call=(path,method,body)=>platform.fetch(new Request(origin+path,{method,headers:{origin,cookie:'tellumo_session='+token,'content-type':'application/json'},body:JSON.stringify(body)}),env,ctx);
 assert.equal((await call('/api/profile','PATCH',{revision:0,name:'PWA tester',avatar_id:'sun'})).status,200);
 assert.equal((await call('/api/onboarding','PUT',{revision:0,stage:'review',project_name:'Synthetic Garden',idea:'A fictional gardening project',audience:'Neighbors',preferred_theme:'forest'})).status,200);
 assert.equal((await call('/api/onboarding/complete','POST',{revision:1})).status,200);
 server=createServer(async(req,res)=>{try{
  if(req.headers.host!=='localhost:8185'){res.writeHead(403).end();return;}
  const url=new URL(req.url,origin);requests.push({path:url.pathname,method:req.method});
  if(url.pathname.startsWith('/api/')){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const response=await platform.fetch(new Request(url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})}),env,ctx);
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));return;
  }
  const name=url.pathname==='/'||url.pathname==='/workspace'||url.pathname.startsWith('/workspace/')?'index.html':decodeURIComponent(url.pathname).slice(1),path=resolve(root,name);
  if(!path.startsWith(root+sep)){res.writeHead(404).end();return;}
  let bytes=await readFile(path);if(name==='workspace-sw.js')bytes=Buffer.concat([bytes,Buffer.from(`\n// Synthetic worker update ${workerRevision}\n`)]);
  const ext=path.split('.').at(-1);res.writeHead(200,{'content-type':{html:'text/html',js:'text/javascript',css:'text/css',svg:'image/svg+xml',png:'image/png',woff2:'font/woff2',webmanifest:'application/manifest+json'}[ext]??'application/octet-stream','cache-control':'no-cache'}).end(bytes);
 }catch{res.writeHead(500).end('Local fixture failed');}});
 await new Promise((done,reject)=>{server.once('error',reject);server.listen(8185,'127.0.0.1',done)});
 // A temporary persistent profile is required: Chromium forbids installation in incognito contexts.
 const context=await chromium.launchPersistentContext(dir+'/browser',{headless:true,viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,...(process.env.WHUMPO_CHROMIUM?{executablePath:process.env.WHUMPO_CHROMIUM}:{})});browser=context;
 await context.addCookies([{name:'tellumo_session',value:token,url:origin,httpOnly:true,sameSite:'Lax'}]);
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin+'/workspace/settings');await page.getByText('Whumpo, a tap away',{exact:true}).waitFor();
 await page.evaluate(()=>navigator.serviceWorker.ready);await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
 const cdp=await context.newCDPSession(page);const manifest=await cdp.send('Page.getAppManifest'),installability=await cdp.send('Page.getInstallabilityErrors');
 assert.equal(manifest.url,origin+'/manifest.webmanifest');assert.equal(manifest.errors.length,0);assert.equal(installability.installabilityErrors.length,0,JSON.stringify(installability));
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await page.getByRole('button',{name:'Night',exact:true}).click();await page.waitForFunction(()=>document.querySelector('meta[name="theme-color"]')?.content==='#0b172a');
 await page.getByRole('button',{name:'Day',exact:true}).click();await page.waitForFunction(()=>document.querySelector('meta[name="theme-color"]')?.content==='#F8FAFC');
 const cacheRows=()=>page.evaluate(async()=>{const result={};for(const name of await caches.keys())result[name]=(await (await caches.open(name)).keys()).map(r=>new URL(r.url).pathname);return result;});
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
 assert.deepEqual(await cacheRows(),cached);assert.equal(errors.length,0,errors.join('\n'));
 for(const table of ['inference_calls','publications','usage_operations','stripe_paid_invoices'])assert.equal((await db.prepare('SELECT COUNT(*) n FROM '+table).first()).n,0);
 await writeFile('.secrets/pwa-browser.json',JSON.stringify({checkedAt:new Date().toISOString(),manifestErrors:manifest.errors,installabilityErrors:installability.installabilityErrors,caches:cached,mobileWidth:390,offlineRecovery:true,updatePreservesDraft:true,pageErrors:errors,apiRequests:requests.filter(r=>r.path.startsWith('/api/')),scope:'Disposable Chromium/D1, no physical-device or OS-install acceptance'},null,2),{mode:0o600});
 console.log('PWA browser passed: valid/installable manifest, active worker, mobile Settings, explicit install dismissal, offline/reconnect, public-only cache and update preserving unsent draft.');
}finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(done=>server.close(done));}await proxy?.dispose();await rm(dir,{recursive:true,force:true});}
