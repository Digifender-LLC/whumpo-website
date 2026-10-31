// Built workspace card + real styles in Chromium at 360, 390 and 1280px. No server, provider, inference or physical-device acceptance.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,sep} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'vite';
const {chromium}=createRequire(import.meta.url)(process.env.WHUMPO_PLAYWRIGHT||'@playwright/test');
const dir=await mkdtemp((process.env.TMPDIR||'/tmp')+'/whumpo-note-browser-'),html=`frontend/note-fixture-${process.pid}.html`,root=resolve(dir,'web');
let server,browser,page,phase='build',origin;const errors=[],requests=[];
try{
 await writeFile(html,'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Whumpo public form note acceptance</title></head><body><div id="root"></div><script type="module" src="/@fs/'+resolve('tests/fixtures/public-form-note.tsx')+'"></script></body></html>');
 await build({build:{outDir:root,rollupOptions:{input:resolve(html)}},logLevel:'error'});
 server=createServer(async(req,res)=>{try{
  if(req.headers.host!==new URL(origin).host){res.writeHead(403).end();return;}requests.push(req.url);
  const url=new URL(req.url,origin),name=url.pathname==='/'?html.split('/').at(-1):decodeURIComponent(url.pathname).slice(1),file=resolve(root,name);if(!file.startsWith(root+sep)){res.writeHead(404).end();return;}
  const bytes=await readFile(file),ext=file.split('.').at(-1);res.writeHead(200,{'content-type':{html:'text/html',js:'text/javascript',css:'text/css',woff2:'font/woff2'}[ext]??'application/octet-stream','cache-control':'no-store'}).end(bytes);
 }catch{res.writeHead(404).end();}});
 await new Promise(done=>server.listen(0,'127.0.0.1',done));origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,...(process.env.WHUMPO_CHROMIUM?{executablePath:process.env.WHUMPO_CHROMIUM}:{})});
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,locale:'en-US'});page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);await page.locator('#bound p').waitFor();
 phase='each state says plainly whether the form is open and why not';
 const say=(id,text)=>page.locator('#'+id+' p').filter({hasText:text}).waitFor();
 await say('bound','Bound to the live website version.');await say('inactive','Anonymous submissions are closed: this module is not active.');
 await say('unavailable','a module this form depends on is off');await say('unpublished','Anonymous submissions are closed: the website is not published.');assert.equal(await page.locator('[role=status]').count(),0,'Static text, not a live region');assert(!(await page.locator('#bound').innerText()).match(/open to|can submit/i),'bound makes no claim that visitors can submit');await say('stale','the website changed after this module was activated');
 assert.equal(await page.locator('#none *').count(),0,'No public form, no line');
 for(const width of [360,390,1280]){
  phase='layout at '+width+'px';await page.setViewportSize({width,height:width===1280?900:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal scroll at '+width);
  for(const id of ['bound','inactive','unavailable','unpublished','stale']){const b=await page.locator('#'+id+' p').boundingBox();assert(b.x>=0&&b.x+b.width<=width,id+' inside the viewport at '+width);}
 }
 assert.equal(errors.length,0,errors.join('\n'));assert(!requests.some(path=>path.startsWith('/api/')));
 console.log('Public form note browser passed: built component at 360, 390 and 1280px; bound, inactive, unavailable, unpublished and stale states with reasons; no line without a public form; no horizontal scroll; no server request.');
}catch(error){console.error('Public form note browser phase:',phase);throw error;}
finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(done=>server.close(done));}await rm(html,{force:true});await rm(dir,{recursive:true,force:true});}
