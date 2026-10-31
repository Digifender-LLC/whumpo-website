// WH-093: the built lead editor and filters from the records panel with real styles in Chromium at 360, 390 and 1280px, 200% text, light and dark. The connected inbox -> stage -> note -> due date journey runs through the real list and module routes in tests/module-record-leads.mjs. No server, provider, inference or physical-device acceptance.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,sep} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'vite';
const {chromium}=createRequire(import.meta.url)(process.env.WHUMPO_PLAYWRIGHT||'@playwright/test');
const dir=await mkdtemp((process.env.TMPDIR||'/tmp')+'/whumpo-leads-browser-'),html=`frontend/leads-fixture-${process.pid}.html`,root=resolve(dir,'web');
let server,browser,page,phase='build',origin;const errors=[],requests=[];
try{
 await writeFile(html,'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Whumpo record leads acceptance</title></head><body><div id="root"></div><script type="module" src="/@fs/'+resolve('tests/fixtures/record-leads.tsx')+'"></script></body></html>');
 await build({build:{outDir:root,rollupOptions:{input:resolve(html)}},logLevel:'error'});
 server=createServer(async(req,res)=>{try{
  if(req.headers.host!==new URL(origin).host){res.writeHead(403).end();return;}requests.push(req.url);
  const url=new URL(req.url,origin),name=url.pathname==='/'?html.split('/').at(-1):decodeURIComponent(url.pathname).slice(1),file=resolve(root,name);if(!file.startsWith(root+sep)){res.writeHead(404).end();return;}
  const bytes=await readFile(file),ext=file.split('.').at(-1);res.writeHead(200,{'content-type':{html:'text/html',js:'text/javascript',css:'text/css',woff2:'font/woff2'}[ext]??'application/octet-stream','cache-control':'no-store'}).end(bytes);
 }catch{res.writeHead(404).end();}});
 await new Promise(done=>server.listen(0,'127.0.0.1',done));origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,...(process.env.WHUMPO_CHROMIUM?{executablePath:process.env.WHUMPO_CHROMIUM}:{})});
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,locale:'en-US'});page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 const shots=process.env.WHUMPO_SHOTS||'/tmp';
 await page.goto(origin);await page.locator('#fresh fieldset').waitFor();
 const ed=id=>page.locator('#'+id),stage=id=>ed(id).getByLabel('Stage',{exact:true}),date=id=>ed(id).getByLabel('Follow-up date',{exact:true}),note=id=>ed(id).getByLabel('Private note',{exact:true}),save=id=>ed(id).getByRole('button',{name:'Save lead',exact:true}),log=async id=>JSON.parse(await ed(id+'-log').textContent());
 phase='labelled controls, the empty lead reads as New, and saving needs a change';
 await ed('fresh').getByText('Saved stage: New').waitFor();
 assert(await save('fresh').isDisabled());await ed('fresh').getByText('Change something to save.').waitFor();
 assert.equal(await stage('fresh').inputValue(),'new');assert.equal(await date('fresh').getAttribute('type'),'date');
 await ed('fresh').getByText('0 of 2,000 characters. Only you can see this.').waitFor();
 phase='keyboard only: stage, date, note, save, in that order';
 await stage('fresh').focus();await page.keyboard.type('Contacted');assert.equal(await stage('fresh').inputValue(),'contacted');
 await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('type')),'date','Tab moves from stage to the date');
 await date('fresh').fill('2026-11-05');await page.keyboard.press('Tab');await page.keyboard.press('Tab');
 assert.equal(await page.evaluate(()=>document.activeElement?.tagName),'TEXTAREA','Clear date sits between the date and the note');
 await page.keyboard.type('Call Tuesday');await ed('fresh').getByText('12 of 2,000 characters. Only you can see this.').waitFor();
 await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'Save lead');assert(await save('fresh').isEnabled());
 await page.keyboard.press('Enter');await ed('fresh').getByRole('status').filter({hasText:'Lead saved.'}).waitFor();
 assert.deepEqual(await log('fresh'),[{stage:'contacted',note:'Call Tuesday',dueDate:'2026-11-05'}],'Only the changed fields are sent');
 assert.equal(await note('fresh').inputValue(),'Call Tuesday');assert(await save('fresh').isDisabled());
 phase='a note over the limit is explained next to the field and cannot be saved';
 await note('fresh').fill('x'.repeat(2001));
 assert.equal(await note('fresh').getAttribute('aria-invalid'),'true');await ed('fresh').getByText('This note is 1 characters too long. Keep it to 2,000.').waitFor();
 assert(await save('fresh').isDisabled());await ed('fresh').getByText('Shorten the note to save.').waitFor();
 assert.match(await note('fresh').getAttribute('aria-describedby'),/note-help/);
 await note('fresh').fill('x'.repeat(2000));assert(await save('fresh').isEnabled());
 phase='overdue is text, computed from the owner date, and a closed lead is never overdue';
 await ed('late').getByText('Saved stage: Contacted · Overdue · Follow up 2026-10-20').waitFor();
 assert.equal(await ed('closed').getByText('Overdue').count(),0);await ed('closed').getByText('Saved stage: Won').waitFor();
 assert.equal(await page.locator('#overdue-rule').textContent(),'true,false,false,false');
 await date('late').fill('2026-12-01');await stage('late').selectOption('won');await ed('late').getByText('Saved stage: Contacted · Overdue · Follow up 2026-10-20').waitFor();assert.equal(await ed('late').getByText('Overdue').count(),1,'An unsaved draft is never shown as the saved state');
 await ed('late').getByRole('button',{name:'Clear date'}).click();assert.equal(await date('late').inputValue(),'');await ed('late').getByText('Overdue').waitFor();assert.equal(await ed('late').getByRole('button',{name:'Clear date'}).count(),0);
 phase='a stale save shows a plain conflict message and reloads without overwriting';
 await note('conflict').fill('Mine');await save('conflict').click();
 const alert=ed('conflict').getByRole('alert');await alert.getByText('This lead changed in another window, or the module was updated.').waitFor();
 assert.equal(await save('conflict').count(),0,'No save button while the conflict is open');
 await alert.getByRole('button',{name:'Reload lead'}).click();await ed('conflict').getByRole('alert').waitFor({state:'detached'});assert.equal(await note('conflict').inputValue(),'Mine','A reload keeps the unsaved draft for the owner to decide');assert(await save('conflict').isEnabled(),'Save is back after the reload');
 phase='a conflict that does not change the lead revision (module changed) also clears on reload';
 await note('config').fill('Draft');await save('config').click();await ed('config').getByRole('alert').getByText('This lead changed in another window').waitFor();
 await ed('config').getByRole('button',{name:'Reload lead'}).click();await ed('config').getByRole('alert').waitFor({state:'detached'});assert.equal(await note('config').inputValue(),'Draft');assert(await save('config').isVisible());
 phase='another failure is shown in place and the edit is kept';
 await note('down').fill('Kept');await save('down').click();await ed('down').getByRole('alert').filter({hasText:'This request could not finish.'}).waitFor();assert.equal(await note('down').inputValue(),'Kept');assert(await save('down').isEnabled());
 phase='without Business the lead is readable, disabled and says why';
 assert(await stage('plan').isDisabled());for(const control of [date('plan'),note('plan')]){assert.equal(await control.getAttribute('readonly'),'','Read-only, not disabled');assert(await control.isEnabled());await control.focus();assert(await control.evaluate(el=>el===document.activeElement),'Focusable');}
 await ed('plan').getByText('Changing leads needs the Business plan. You can still read and export what you saved.').waitFor();
 assert.equal(await save('plan').count(),0);assert.equal(await note('plan').inputValue(),'Kept for reading.');assert.equal(await stage('plan').inputValue(),'qualified');
 phase='filters have visible labels, a clear route back, and keyboard operation';
 const f=page.locator('#filters'),state=()=>page.locator('#filter-state').textContent();
 assert.equal(await state(),'all|any');assert.equal(await f.getByRole('button',{name:'Clear filters'}).count(),0);
 await f.getByLabel('Stage',{exact:true}).selectOption('won');await f.getByLabel('Follow-up date',{exact:true}).selectOption('overdue');
 assert.equal(await state(),'won|overdue');await f.getByRole('button',{name:'Clear filters'}).focus();await page.keyboard.press('Enter');
 assert.equal(await state(),'all|any');assert.equal(await f.getByRole('button',{name:'Clear filters'}).count(),0);
 phase='conversion summary: honest sentence, text counts, partial, empty, plan and unavailable states';
 const cv=id=>page.locator('#'+id);
 await cv('conv-ok').getByText('3 of 12 records submitted in the last 30 days are now Won (25%).').waitFor();
 await cv('conv-ok').getByRole('heading',{name:'Conversions, last 30 days'}).waitFor();
 assert.equal((await cv('conv-ok').locator('dt').allTextContents()).join(','),'New,Contacted,Qualified,Won,Lost');assert.equal((await cv('conv-ok').locator('dd').allTextContents()).join(','),'5,2,2,3,0');
 await cv('conv-ok').getByText('Whumpo does not keep past stages, so a figure can fall').waitFor();await cv('conv-ok').getByText('not a count of visitors').waitFor();
 assert.equal(await cv('conv-ok').getByText('Partial period').count(),0);
 await cv('conv-partial').getByText('Partial period: this form has only been collecting since 2026-10-25').waitFor();await cv('conv-partial').getByText('0 of 1 record submitted in the last 30 days are now Won (0%).').waitFor();
 await cv('conv-empty').getByText('No records were submitted in the last 30 days.').waitFor();assert.equal(await cv('conv-empty').getByText('%').count(),0,'No rate without a denominator');
 await cv('conv-plan').getByText('needs the Business plan').waitFor();
 await cv('conv-fail').getByRole('alert').getByText('unavailable').waitFor();assert.equal(await cv('conv-fail').getByText('0 of').count(),0,'A failure is never shown as zero');
 const widths=[360,390,1280];
 for(const width of widths){
  phase='layout at '+width+'px';
  await page.setViewportSize({width,height:width===1280?900:844});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal scroll at '+width);
  for(const id of ['fresh','late','conflict','config','plan']){
   await ed(id).scrollIntoViewIfNeeded();const b=await ed(id).locator('fieldset').boundingBox();assert(b.x>=0&&b.x+b.width<=width,id+' inside the viewport at '+width);
   for(const control of await ed(id).locator('select,input,button,textarea').all()){const box=await control.boundingBox();if(box)assert(box.height>=44||await control.evaluate(el=>el.tagName==='TEXTAREA'),`${id} target ${await control.evaluate(el=>el.tagName)} is ${box.height}px at ${width}`);}
  }
  const fb=await f.boundingBox();assert(fb.x>=0&&fb.x+fb.width<=width);for(const control of await f.locator('select,button').all()){const box=await control.boundingBox();if(box)assert(box.height>=44);}
  await ed('late').screenshot({path:`${shots}/whumpo-record-leads-${width}.png`});
  for(const id of ['conv-ok','conv-partial','conv-empty','conv-plan','conv-fail']){await cv(id).scrollIntoViewIfNeeded();const b=await cv(id).boundingBox();assert(b.x>=0&&b.x+b.width<=width,id+' inside the viewport at '+width);}
  await cv('conv-ok').screenshot({path:`${shots}/whumpo-conversions-${width}.png`});
 }
 phase='200% text';
 await page.setViewportSize({width:360,height:844});await page.evaluate(()=>{document.documentElement.style.fontSize='32px';});
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal scroll at 200% text');
 await ed('late').screenshot({path:`${shots}/whumpo-record-leads-200pct.png`});await cv('conv-partial').screenshot({path:`${shots}/whumpo-conversions-200pct.png`});await page.evaluate(()=>{document.documentElement.style.fontSize='';});
 phase='dark theme';
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.classList.add('dark'));
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 const dark=await ed('late').locator('fieldset').evaluate(el=>{const s=getComputedStyle(el);return [s.color,s.backgroundColor];});assert.notEqual(dark[0],dark[1]);
 await ed('late').screenshot({path:`${shots}/whumpo-record-leads-dark.png`});await cv('conv-ok').screenshot({path:`${shots}/whumpo-conversions-dark.png`});
 assert.equal(errors.length,0,errors.join('\n'));assert(!requests.some(path=>path.startsWith('/api/')));
 console.log('Record leads browser passed: actual built editor and filters at 360, 390 and 1280px, 200% text and dark; labelled stage, date and note; keyboard-only order and save of changed fields only; note limit explained beside the field; overdue as text from the owner date and never for won or lost; plain stale-save conflict with reload; read-only without Business; filters with a clear route; no horizontal scroll; 44px targets.');
}catch(error){console.error('Record leads browser phase:',phase);if(page)await page.screenshot({path:(process.env.WHUMPO_SHOTS||'/tmp')+'/whumpo-record-leads-failure.png',fullPage:true}).catch(()=>{});throw error;}
finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(done=>server.close(done));}await rm(html,{force:true});await rm(dir,{recursive:true,force:true});}
