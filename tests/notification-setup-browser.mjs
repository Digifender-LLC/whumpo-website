// Built workspace card + real styles in Chromium at 360, 390 and 1280px. No server, provider, inference or physical-device acceptance.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,sep} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'vite';
const {chromium}=createRequire(import.meta.url)(process.env.WHUMPO_PLAYWRIGHT||'@playwright/test');
const dir=await mkdtemp((process.env.TMPDIR||'/tmp')+'/whumpo-notices-browser-'),html=`frontend/notices-fixture-${process.pid}.html`,root=resolve(dir,'web');
let server,browser,page,phase='build',origin;const errors=[],requests=[];
try{
 await writeFile(html,'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Whumpo notice setup acceptance</title></head><body><div id="root"></div><script type="module" src="/@fs/'+resolve('tests/fixtures/notification-setup.tsx')+'"></script></body></html>');
 await build({build:{outDir:root,rollupOptions:{input:resolve(html)}},logLevel:'error'});
 server=createServer(async(req,res)=>{try{
  if(req.headers.host!==new URL(origin).host){res.writeHead(403).end();return;}requests.push(req.url);
  const url=new URL(req.url,origin),name=url.pathname==='/'?html.split('/').at(-1):decodeURIComponent(url.pathname).slice(1),file=resolve(root,name);if(!file.startsWith(root+sep)){res.writeHead(404).end();return;}
  const bytes=await readFile(file),ext=file.split('.').at(-1);res.writeHead(200,{'content-type':{html:'text/html',js:'text/javascript',css:'text/css',woff2:'font/woff2'}[ext]??'application/octet-stream','cache-control':'no-store'}).end(bytes);
 }catch{res.writeHead(404).end();}});
 await new Promise(done=>server.listen(0,'127.0.0.1',done));origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,...(process.env.WHUMPO_CHROMIUM?{executablePath:process.env.WHUMPO_CHROMIUM}:{})});
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,locale:'en-US'});page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);await page.locator('#fresh section').waitFor();
 const card=id=>page.locator('#'+id+' section'),review=id=>card(id).getByRole('button',{name:'Review in Chat',exact:true}),box=(id,i)=>card(id).getByRole('checkbox').nth(i);
 phase='status says plainly that nothing is sending';
 await card('fresh').getByRole('status').filter({hasText:'Not sending yet. Whumpo has not set its monthly spending limit'}).waitFor();
 await card('fresh').getByRole('status').filter({hasText:'No settings saved yet.'}).waitFor();
 await card('saved').getByRole('status').filter({hasText:'Not sending yet. Whumpo has not turned on email delivery. Saved settings: revision 2. Emails for this form so far: 3 sent, 1 waiting, 4 not sent.'}).waitFor();
 await card('anonymous').getByRole('status').filter({hasText:'Sending is on for this form.'}).waitFor();
 await card('quiet').getByRole('status').filter({hasText:'All appointment emails are turned off for this form.'}).waitFor();
 await card('nobody').getByRole('status').filter({hasText:'no notification address is verified'}).waitFor();
 assert(await card('fresh').getByRole('status').filter({hasText:'not queued or sent'}).count(),'The unset-limit copy says nothing is queued');
 phase='saved settings are shown and the anonymous form cannot send receipts';
 assert(await box('saved',0).isChecked());assert(!await box('saved',1).isChecked());assert(await box('saved',2).isChecked());
 assert.equal(await card('saved').getByLabel('Business name shown in the emails').inputValue(),'Garden Salon');
 assert(await box('anonymous',2).isDisabled());assert(!await box('anonymous',2).isChecked(),'A receipt saved before the form went public is shown off, not as a checked disabled trap');
 await card('anonymous').getByRole('note').filter({hasText:'turns the receipt off'}).waitFor();assert(await review('anonymous').isEnabled(),'The review can still be requested from a form made public');
 phase='keyboard only: labelled checkboxes, a plain name, and a review button that stays disabled until the name is valid';
 assert(await review('fresh').isDisabled(),'No name, no review');
 assert(await box('fresh',0).isChecked(),'The owner notice starts on');
 await box('fresh',0).focus();await page.keyboard.press('Space');assert(!await box('fresh',0).isChecked());await page.keyboard.press('Space');assert(await box('fresh',0).isChecked());
 await page.keyboard.press('Tab');await page.keyboard.press('Space');assert(await box('fresh',1).isChecked());
 await page.keyboard.press('Tab');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('autocomplete')),'organization','Tab reaches the business name field');
 await page.keyboard.type('Garden <b>');assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-invalid')),'true');assert(await review('fresh').isDisabled());
 await card('fresh').getByText('Use letters, numbers, spaces').waitFor();
 await page.keyboard.press('Control+A');await page.keyboard.type('evil.xyz');await card('fresh').getByText('Leave out links, domain names and email addresses.').waitFor();assert(await review('fresh').isDisabled());
 await page.keyboard.press('Control+A');await page.keyboard.type('Peluquería Ñandú');assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-invalid')),'false','Accented names are accepted, as on the model path');assert(await review('fresh').isEnabled());
 await page.keyboard.press('Control+A');await page.keyboard.type('Garden Salon');assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('aria-invalid')),'false');assert(await review('fresh').isEnabled());
 await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'Review in Chat','Focus order ends at the review button');
 for(const width of [360,390,1280]){
  phase='layout at '+width+'px';
  await page.setViewportSize({width,height:width===1280?900:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal scroll at '+width);
  for(const id of ['fresh','saved','anonymous','quiet','nobody']){
   await card(id).scrollIntoViewIfNeeded();
   for(const label of await card(id).locator('label').filter({has:page.locator('input[type=checkbox]')}).all())assert((await label.boundingBox()).height>=44,'Touch target at '+width);
   const b=await card(id).boundingBox();assert(b.x>=0&&b.x+b.width<=width,'Card inside the viewport at '+width);
   assert((await review(id).boundingBox()).height>=44);
  }
  await card('saved').screenshot({path:'/tmp/whumpo-notice-setup-'+width+'.png'});
 }
 assert.equal(errors.length,0,errors.join('\n'));assert(!requests.some(path=>path.startsWith('/api/')));
 console.log('Notice setup browser passed: actual built card at 360, 390 and 1280px; plain not-sending-yet status for an unset spending limit, inactive delivery and active delivery; saved settings; anonymous form cannot send receipts; keyboard-only checkboxes, name validation and review button; no horizontal scroll, 44px targets, no server request.');
}catch(error){console.error('Notice setup browser phase:',phase);if(page)await page.screenshot({path:'/tmp/whumpo-notice-setup-failure.png',fullPage:true}).catch(()=>{});throw error;}
finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(done=>server.close(done));}await rm(html,{force:true});await rm(dir,{recursive:true,force:true});}
