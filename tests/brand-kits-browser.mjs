// WH-091: the built brand kit and saved section editors with real styles in Chromium at 360, 390 and 1280px, 200% text, light and dark,
// keyboard only, with axe, served under the workspace's own Content-Security-Policy (frontend/public/_headers) so the preview is
// proved to work without an inline-style exception. Connected journeys (save, apply, review, stale, foreign) run in tests/brand-kits.mjs.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm,mkdir} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,sep} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'vite';
const require=createRequire(import.meta.url),{chromium}=require(process.env.WHUMPO_PLAYWRIGHT||'@playwright/test');
const AxeBuilder=require(process.env.WHUMPO_AXE||'@axe-core/playwright').default;
const dir=await mkdtemp((process.env.TMPDIR||'/tmp')+'/whumpo-brand-browser-'),html=`frontend/brand-fixture-${process.pid}.html`,root=resolve(dir,'web');
const csp=/Content-Security-Policy: (.*)/.exec(await readFile('frontend/public/_headers','utf8'))[1].trim();
const shots=process.env.WHUMPO_SHOTS||'/tmp';await mkdir(shots,{recursive:true});
let server,browser,page,phase='build',origin;const errors=[];
try{
 await writeFile(html,'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Whumpo brand kit acceptance</title></head><body><div id="root"></div><script type="module" src="/@fs/'+resolve('tests/fixtures/brand-kits.tsx')+'"></script></body></html>');
 await build({build:{outDir:root,rollupOptions:{input:resolve(html)}},logLevel:'error'});
 server=createServer(async(req,res)=>{try{
  if(req.headers.host!==new URL(origin).host){res.writeHead(403).end();return;}
  const url=new URL(req.url,origin),name=url.pathname==='/'?html.split('/').at(-1):decodeURIComponent(url.pathname).slice(1),file=resolve(root,name);if(!file.startsWith(root+sep)){res.writeHead(404).end();return;}
  const bytes=await readFile(file),ext=file.split('.').at(-1);res.writeHead(200,{'content-type':{html:'text/html',js:'text/javascript',css:'text/css',woff2:'font/woff2'}[ext]??'application/octet-stream','cache-control':'no-store','content-security-policy':csp}).end(bytes);
 }catch{res.writeHead(404).end();}});
 await new Promise(done=>server.listen(0,'127.0.0.1',done));origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,...(process.env.WHUMPO_CHROMIUM?{executablePath:process.env.WHUMPO_CHROMIUM}:{})});
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,locale:'en-US'});page=await context.newPage();page.setDefaultTimeout(10000);
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(['error','warning'].includes(m.type()))errors.push(m.text()+' @'+m.location().url+':'+m.location().lineNumber);});
 await page.goto(origin);await page.locator('#new form').waitFor();
 const ed=id=>page.locator('#'+id),log=async id=>JSON.parse(await page.locator('#'+id+'-log').textContent()),axe=async label=>{const r=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();assert.deepEqual(r.violations.map(v=>[v.id,v.nodes.map(n=>n.target)]),[],'axe: '+label);};
 const shot=async(id,path)=>{// the workspace scrolls inside its main; open the frame up so one capture holds the whole form, then restore it
  await page.evaluate(()=>{const g=document.querySelector('.workspace-grid'),m=document.querySelector('main.workspace-main');g.style.height='auto';g.style.overflow='visible';m.style.overflow='visible';});
  await ed(id).screenshot({path});
  await page.evaluate(()=>{const g=document.querySelector('.workspace-grid'),m=document.querySelector('main.workspace-main');g.style.height='';g.style.overflow='';m.style.overflow='';});};
 const hex=(id,label)=>ed(id).getByLabel(label,{exact:true});
 const preview=(id,sel)=>ed(id).getByTestId('brand-preview').evaluate((el,s)=>{const pv=el.shadowRoot.querySelector('.pv');const target=s?pv.querySelector(s):pv;const c=getComputedStyle(target);return [c.backgroundColor,c.color,c.fontFamily,c.borderRadius];},sel);

 phase='a new kit needs a name, says so next to the button, and starts valid';
 const save=id=>ed(id).getByRole('button',{name:/^Save/});
 assert(await save('new').isDisabled());await ed('new').getByText('Give the kit a name.').waitFor();
 await ed('new').getByLabel('Kit name').fill('Harbour');assert(await save('new').isEnabled());
 assert.equal(await ed('new').getByRole('alert').count(),0,'Default colors are readable');
 phase='the contrast report is text and numbers, not color alone';
 const rows=await ed('new').locator('table tbody tr').allTextContents();assert.equal(rows.length,4);assert(rows.every(r=>/\d+\.\d\d to 1/.test(r)&&/Readable/.test(r)),rows.join('|'));
 phase='a typed color must be six hex digits; a bad value is explained and not applied';
 await hex('new','Light mode text').fill('#12');await ed('new').getByText('Use six digits after the #, like #1f2a44.').waitFor();assert.equal(await hex('new','Light mode text').getAttribute('aria-invalid'),'true');
 assert.equal((await ed('new').locator('table tbody tr').allTextContents()).length,4,'The last valid color is still in use');
 phase='unreadable colors are refused in plain words, save is blocked, and the fix is offered';
 await hex('new','Light mode text').fill('#9a9a9a');await hex('new','Light mode background').fill('#ffffff');
 const alert=ed('new').getByRole('alert');await alert.getByText('These light colors cannot be saved yet.').waitFor();
 await alert.getByText(/Text on the background is too hard to read in light mode \(contrast \d+\.\d\d to 1; at least 4\.5 to 1 is needed so people with low vision can read it\)/).waitFor();
 assert(await save('new').isDisabled());await ed('new').getByText('Fix the colors marked above.').waitFor();
 assert((await ed('new').locator('table tbody tr').allTextContents()).some(r=>/Too hard to read/.test(r)));
 await alert.getByRole('button',{name:'Fix light colors automatically'}).click();
 await alert.waitFor({state:'detached'});await ed('new').getByRole('status').filter({hasText:/Changed the text color from #9a9a9a to #[0-9a-f]{6}, which is darker/}).waitFor();
 assert(await save('new').isEnabled());assert.equal(await hex('new','Light mode background').inputValue(),'#ffffff','Only the failing color moved');
 phase='dark mode is optional; turning it on suggests a readable palette and the preview switches';
 await ed('new').getByRole('button',{name:'Dark',exact:true}).click();await ed('new').getByText('Dark colors are not set, so visitors who prefer dark mode see the light colors.').waitFor();
 await ed('new').getByLabel('Also design for dark mode').check();await hex('new','Dark mode text').waitFor();
 assert.equal(await ed('new').getByRole('alert').count(),0,'The suggested dark colors pass');
 await ed('new').getByRole('button',{name:'Dark',exact:true}).click();
 const [bg,fg]=await preview('new');assert.notEqual(bg,fg);
 await hex('new','Dark mode background').fill('#14161c');assert.equal((await preview('new'))[0],'rgb(20, 22, 28)','The preview is drawn with the dark background');
 await hex('new','Dark mode text').fill('#444444');await ed('new').getByText(/too hard to read in dark mode/).first().waitFor();assert(await save('new').isDisabled());
 await ed('new').getByRole('button',{name:'Fix dark colors automatically'}).click();assert(await save('new').isEnabled());
 phase='the preview is the real renderer: variables, fonts and corners follow the choices, under the workspace CSP';
 await ed('new').getByRole('button',{name:'Light',exact:true}).click();
 assert.equal((await preview('new'))[0],'rgb(255, 255, 255)');
 const about=await preview('new','.about');assert.equal(about[3],'12px');
 await ed('new').getByRole('radio',{name:/^Round/}).check();assert.equal((await preview('new','.about'))[3],'28px');
 await ed('new').getByRole('radio',{name:/^Editorial/}).check();assert.match((await preview('new','h1'))[2],/Georgia/);assert.equal(await page.evaluate(()=>getComputedStyle(document.querySelector('#new [data-testid=brand-preview]').shadowRoot.querySelector('.about p')).fontFamily.includes('Georgia')),true);
 assert.equal(await ed('new').getByTestId('brand-preview').getAttribute('aria-hidden'),'true','Decorative copy is hidden from screen readers');
 phase='keyboard only: arrow keys move through a radio group and Tab leaves it';
 await ed('new').getByRole('radio',{name:/^Classic/}).focus();await page.keyboard.press('ArrowDown');
 assert.equal(await page.evaluate(()=>document.activeElement?.closest('label')?.textContent?.startsWith('Modern')),true);
 await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement?.getAttribute('type')),'radio','Tab moves to the next group');
 phase='save sends exactly the chosen tokens, trimmed';
 await ed('new').getByLabel('Logo description (optional)').fill('Harbour Bakery logo');
 await save('new').click();const saved=(await log('new'))[0];
 assert.equal(saved.name,'Harbour');assert.deepEqual(Object.keys(saved.tokens).sort(),['dark','density','font','light','logoAlt','radius']);
 assert.equal(saved.tokens.font,'modern');assert.equal(saved.tokens.radius,'round');assert.equal(saved.tokens.logoAlt,'Harbour Bakery logo');assert.match(saved.tokens.light.ink,/^#[0-9a-f]{6}$/);
 phase='editing an existing kit saves a new version only after a change; a stale save shows its plain message';
 await ed('edit').getByRole('heading',{name:'Edit “Harbour” (version 3)'}).waitFor();assert(await save('edit').isDisabled());await ed('edit').getByText('Change something to save.').waitFor();
 await ed('edit').getByLabel('Kit name').fill('Harbour 2');assert.equal(await save('edit').textContent(),'Save as a new version');assert(await save('edit').isEnabled());
 await ed('stale').getByRole('alert').getByText('This brand kit changed since you opened it. Reload it and try again.').waitFor();
 phase='saved section: required fields explained, counter, style, real preview';
 assert(await save('section').isDisabled());await ed('section').getByText('Change something to save.').waitFor();await ed('section').getByLabel('Heading',{exact:true}).fill('');await ed('section').getByText('Add a heading.').waitFor();assert(await save('section').isDisabled());
 await ed('section').getByLabel('Heading',{exact:true}).fill('Hours');await ed('section').getByLabel('Text',{exact:true}).fill('x'.repeat(801));await ed('section').getByText('Shorten the text to 800 characters.').waitFor();
 await ed('section').getByLabel('Text',{exact:true}).fill('Open 7 to 3.');await ed('section').getByText('12 of 800 characters. Plain text only.').waitFor();
 await ed('section').getByRole('radio',{name:/^Quote/}).check();
 await page.waitForFunction(()=>document.querySelector('#section [data-testid=brand-preview]').shadowRoot.querySelectorAll('.feature-quote').length===1);
 phase='the dark preview of a saved kit uses its dark colors';
 assert.equal((await preview('preview-dark'))[0],'rgb(20, 22, 28)');await ed('preview-light-only').getByText('Dark colors are not set, so visitors who prefer dark mode see the light colors.').waitFor();
 phase='a typed color that is not six hex digits is explained, then the field returns to the color actually in use';
 await ed('edit').getByLabel('Light mode accent',{exact:true}).fill('#8a2');await ed('edit').getByText(/Until then the color stays #8a2c0d\./).waitFor();
 await page.keyboard.press('Tab');assert.equal(await ed('edit').getByLabel('Light mode accent',{exact:true}).inputValue(),'#8a2c0d','leaving the field restores the real color');assert.equal(await ed('edit').getByText(/Until then the color stays/).count(),0);
 phase='nothing can be fixed on a background with no readable text color: the owner color is kept, the message says so, and a near miss reads as a miss';
 await hex('new','Light mode text').fill('#777777');await hex('new','Light mode background').fill('#777777');
 await ed('new').getByRole('alert').getByRole('button',{name:'Fix light colors automatically'}).click();
 await ed('new').getByRole('status').filter({hasText:'Some pairings still cannot be read. Choose a lighter or darker background color.'}).waitFor();
 assert.equal(await hex('new','Light mode text').inputValue(),'#777777','the text color was not forced to black');assert(await save('new').isDisabled());
 await hex('new','Light mode background').fill('#ffffff');await hex('new','Light mode text').fill('#767676');await ed('new').locator('table tbody tr').first().waitFor();
 assert.match((await ed('new').locator('table tbody tr').first().textContent())??'',/4\.54 to 1/,'#767676 on white is 4.54, shown with two places');
 await hex('new','Light mode text').fill('#777777');assert.match((await ed('new').locator('table tbody tr').first().textContent())??'',/4\.47 to 1[\s\S]*Too hard to read/,'4.47 is a miss, never rounded up to 4.5');
 await hex('new','Light mode text').fill('#1f2a44');
 phase='dark suggestions say whether they are readable';
 await ed('new').getByRole('button',{name:'Suggest dark colors from my light colors'}).click();await ed('new').getByRole('status').filter({hasText:/Suggested dark colors from your light colors\./}).waitFor();
 phase='axe on the light and dark workspace';
 await axe('light');await page.evaluate(()=>document.documentElement.classList.add('dark'));await axe('dark');await page.evaluate(()=>document.documentElement.classList.remove('dark'));
 const frame=()=>page.evaluate(()=>{
  const main=document.querySelector('main.workspace-main'),bad=[];
  for(const form of document.querySelectorAll('form')){const fr=form.getBoundingClientRect();
   for(const el of form.querySelectorAll('input,button,select,textarea,th,td,label,legend,h3,h4,p,table,tr')){const r=el.getBoundingClientRect();if(r.width&&(r.left<fr.left-1||r.right>fr.right+1))bad.push([form.parentElement.id,el.tagName,(el.textContent||el.getAttribute('aria-label')||'').slice(0,30),Math.round(r.left),Math.round(r.right),Math.round(fr.left),Math.round(fr.right),getComputedStyle(el).whiteSpace,getComputedStyle(el).flexShrink,getComputedStyle(el).minWidth,getComputedStyle(el).maxWidth,Math.round(el.parentElement.getBoundingClientRect().width),getComputedStyle(el.parentElement).display].join(' '));}
   if(form.scrollWidth>form.clientWidth+1)bad.push('form scrolls sideways '+form.parentElement.id+' '+[...form.querySelectorAll('*')].filter(e=>e.getBoundingClientRect().right>fr.right+1&&e.getBoundingClientRect().width).slice(0,4).map(e=>e.tagName+'.'+String(e.className).slice(0,50)+':'+Math.round(e.getBoundingClientRect().right)).join(' | '));}
  return {bad,mainFits:main.scrollWidth<=main.clientWidth+1,pageFits:document.documentElement.scrollWidth<=innerWidth};
 });
 for(const width of [360,390,1280]){
  phase='layout at '+width+'px in the real workspace frame (not mobile emulation)';
  await page.setViewportSize({width,height:width===1280?900:800});
  const f=await frame();assert.deepEqual(f.bad,[],'inside the form at '+width);assert(f.mainFits,'main has no sideways scroll at '+width);assert(f.pageFits);
  for(const id of ['new','edit','section']){
   await ed(id).scrollIntoViewIfNeeded();
   for(const control of await ed(id).locator('input:not([type=radio]):not([type=checkbox]),button,select').all()){const box=await control.boundingBox();if(box)assert(box.height>=44,`${id} ${await control.evaluate(el=>el.outerHTML.slice(0,60))} is ${box.height}px at ${width}`);}
  }
  if(width===1280){// the preview is sticky here, so a viewport capture (top, then scrolled into the colors) shows what the owner sees
   await page.evaluate(()=>document.querySelector('#new').scrollIntoView({block:'start'}));await page.screenshot({path:`${shots}/whumpo-brand-kit-editor-${width}-top.png`});
   await page.evaluate(()=>document.querySelector('main.workspace-main').scrollBy(0,650));await page.screenshot({path:`${shots}/whumpo-brand-kit-editor-${width}-scrolled.png`});
  }else await shot('new',`${shots}/whumpo-brand-kit-editor-${width}.png`);
  await shot('section',`${shots}/whumpo-saved-section-${width}.png`);
 }
 phase='the preview sits right after the kit name and shows an about panel and a section panel without scrolling';
 await page.setViewportSize({width:1280,height:900});
 const order=await ed('new').evaluate(el=>{const all=[...el.querySelectorAll('input,section[aria-label=Preview]')];return all.map(n=>n.tagName==='SECTION'?'preview':(n.getAttribute('id')||'').includes('name')?'name':n.getAttribute('type')==='color'?'color':'other');});
 assert.deepEqual(order.slice(0,3),['name','preview','color'],'name, then preview, then the colors');
 for(const [w,h] of [[1280,900],[1024,800],[390,844]]){
  await page.setViewportSize({width:w,height:h});const box=ed('new').getByTestId('brand-preview');await box.scrollIntoViewIfNeeded();
  // What matters: the panels that show corners and spacing are inside the box without scrolling, and the box is not at its height cap, so a
  // different font's metrics (a few pixels) cannot push one out. The slack is a design margin, not a pass for a tight fit.
  const m=await box.evaluate(el=>{const r=el.getBoundingClientRect(),inside=sel=>{const n=el.shadowRoot.querySelector(sel);if(!n)return null;const b=n.getBoundingClientRect();return b.top>=r.top-1&&b.bottom<=r.bottom+1;};return {about:inside('.about'),card:inside('.feature-card'),callout:inside('.feature-callout'),scrolls:el.scrollHeight>el.clientHeight+1,spare:parseFloat(getComputedStyle(el).maxHeight)-el.scrollHeight};});
  assert.equal(m.about,true,`${w}x${h}: the about panel (corners, spacing) is fully visible`);assert.equal(m.card,true,`${w}x${h}: a card panel is fully visible`);assert.equal(m.callout,true,`${w}x${h}: a callout panel is fully visible`);
  assert.equal(m.scrolls,false,`${w}x${h}: the preview needs no scrolling`);assert(m.spare>=24,`${w}x${h}: only ${m.spare}px of room before the preview box height cap; font metrics could push a panel out`);
 }
 phase='sticky only on large tall screens: solid, at most 38dvh, and Tab never lands under it';
 const pos=async(w,h)=>{await page.setViewportSize({width:w,height:h});return ed('new').locator('.brand-sticky').evaluate(el=>{const c=getComputedStyle(el),r=el.getBoundingClientRect();return {position:c.position,bg:c.backgroundColor,h:r.height,vh:innerHeight};});};
 const big=await pos(1280,900);assert.equal(big.position,'sticky');assert.notEqual(big.bg,'rgba(0, 0, 0, 0)','a solid background');assert(big.h<=0.38*big.vh+1,`sticky preview is ${big.h}px of ${big.vh}`);
 assert.equal((await pos(1280,700)).position,'static','short screens keep it in flow');assert.equal((await pos(900,900)).position,'static','narrow screens keep it in flow');assert.equal((await pos(390,844)).position,'static','phones keep it in flow');
 for(const [w,h] of [[1280,900],[1024,800]]){
  await page.setViewportSize({width:w,height:h});
  // Force the aria-hidden scroller to overflow (a browser makes an overflowing scroller keyboard-focusable unless it has tabindex=-1).
  await page.evaluate(()=>{const b=document.querySelector('#new [data-testid=brand-preview]');b.style.setProperty('max-height','40px','important');});
  assert.equal(await page.evaluate(()=>{const b=document.querySelector('#new [data-testid=brand-preview]');return b.scrollHeight>b.clientHeight+1&&b.getAttribute('tabindex');}),'-1','the overflowing hidden scroller is taken out of the tab order');
  await ed('new').getByLabel('Kit name').focus();const seen=new Set();
  for(let i=0;i<70;i++){
   await page.keyboard.press('Tab');
   const where=await page.evaluate(()=>{
    const a=document.activeElement,s=document.querySelector('#new .brand-sticky'),form=document.querySelector('#new form');
    if(!a||!form.contains(a))return {skip:true};
    const r=a.getBoundingClientRect(),sb=s.getBoundingClientRect().bottom,inSticky=s.contains(a);
    return {tag:a.tagName,label:(a.getAttribute('aria-label')||a.textContent||a.getAttribute('type')||'').slice(0,30),hiddenAncestor:!!a.closest('[aria-hidden=true]'),inSticky,top:Math.round(r.top),bottom:Math.round(r.bottom),stickyBottom:Math.round(sb),vh:innerHeight,visible:r.bottom>0&&r.top<innerHeight};
   });
   if(where.skip)continue;seen.add(where.inSticky?'sticky':'form');
   assert.equal(where.hiddenAncestor,false,`${w}x${h}: Tab ${i} landed on a hidden element: ${JSON.stringify(where)}`);
   assert.equal(where.visible,true,`${w}x${h}: Tab ${i} landed off screen: ${JSON.stringify(where)}`);
   if(!where.inSticky)assert(where.top>=where.stickyBottom-1,`${w}x${h}: Tab ${i} landed under the sticky preview: ${JSON.stringify(where)}`);
  }
  await page.evaluate(()=>{document.querySelector('#new [data-testid=brand-preview]').style.removeProperty('max-height');});
  assert(seen.has('sticky')&&seen.has('form'),`${w}x${h}: the walk covered both the sticky preview controls and the form`);
 }
 phase='200% text in the real frame';
 for(const width of [360,1280]){
  await page.setViewportSize({width,height:width===1280?900:800});await page.evaluate(()=>{document.documentElement.style.fontSize='32px';});
  const f=await frame();assert.deepEqual(f.bad,[],'200% text inside the form at '+width);assert(f.mainFits,'main has no sideways scroll at 200% and '+width);assert(f.pageFits);
  if(width===360)await shot('new',`${shots}/whumpo-brand-kit-editor-200pct.png`);
  await page.evaluate(()=>{document.documentElement.style.fontSize='';});
 }
 phase='saved section preview shows the section itself, at the top';
 await page.setViewportSize({width:1280,height:900});
 const sec=await ed('section').getByTestId('brand-preview').evaluate(el=>{const r=el.getBoundingClientRect(),f=el.shadowRoot.querySelector('.feature'),b=f.getBoundingClientRect();return {hero:getComputedStyle(el.shadowRoot.querySelector('.hero')).display,top:b.top-r.top,fits:b.bottom<=r.bottom,text:f.textContent};});
 assert.equal(sec.hero,'none');assert(sec.top<90,'section is near the top of its preview: '+sec.top);assert(sec.fits);assert.match(sec.text,/Hours/);
 await shot('section',`${shots}/whumpo-saved-section-preview-1280.png`);
 phase='dark workspace';
 await page.setViewportSize({width:390,height:844});await page.evaluate(()=>document.documentElement.classList.add('dark'));
 assert((await frame()).mainFits);
 await shot('edit',`${shots}/whumpo-brand-kit-editor-dark.png`);
 assert.equal(errors.length,0,[...new Set(errors)].join('\n'));
 console.log('Brand kit browser passed: actual built editors at 360, 390 and 1280px, 200% text, light and dark, keyboard radio groups, axe, plain-words contrast refusal with automatic fix, real renderer preview under the workspace CSP, exact saved tokens.');
}catch(error){console.error('Brand kit browser phase:',phase);if(page)await page.screenshot({path:shots+'/whumpo-brand-kit-failure.png',fullPage:true}).catch(()=>{});throw error;}
finally{await browser?.close();if(server){server.closeAllConnections();await new Promise(done=>server.close(done));}await rm(html,{force:true});await rm(dir,{recursive:true,force:true});}
