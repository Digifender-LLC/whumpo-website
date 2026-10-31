// WH-214 visitor "Email notices" section in Chromium at 360, 390 and 1280px, light and dark, 200% text: the actual built visitor page (public-app/)
// served over the actual visitor gateway on a disposable SQLite database through Playwright request interception (no listening port, no network).
// The browser holds no credential: the fixture maps its requests to a synthetic visitor session server-side. The provider is simulated and nothing is sent;
// NOTIFICATION_CUSTOMER_CEILING_CENTS exists only inside this test's request environment. Every identity and address is synthetic.
import assert from 'node:assert/strict';
import {mkdir,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {deletionFixture} from './visitor-deletion-fixture.mjs';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.WHUMPO_PLAYWRIGHT||'@playwright/test');
const AxeBuilder=require(process.env.WHUMPO_AXE||'@axe-core/playwright').default;
const shots=process.env.WHUMPO_SHOTS||(process.env.TMPDIR||'/tmp')+'/whumpo-notifications-shots';
await mkdir(shots,{recursive:true});
const d1=process.argv.includes('--d1'),f=await deletionFixture({d1}),m=await currentSiteFixtureHandlers(),{db}=f;
const a=await f.app(),who=await f.visitor(a,'Synthetic visitor'),origin=`https://app-${a.project}.whumpo.site`;
const ADDRESS='gina.browser@example.test';
let ceiling=undefined,ip=1;const bodies=[],errors=[],sent=[];
const sender=async notice=>{sent.push({...notice});return {accepted:true,providerRef:'sim-'+sent.length};};
const deliver=async()=>{for(let i=0;i<3;i++)await m.notificationOutbox.runNotificationDelivery(db,{provider:'cloudflare-email',review:'r',sendCeiling:1000,customerCeilingCents:500},sender,{now:new Date()});};
async function serve(route){
 const req=route.request(),url=new URL(req.url());
 if(url.origin!==origin)return route.abort();
 const asset=url.pathname==='/'?'index.html':url.pathname.slice(1);
 if(['index.html','visitor.js','visitor.css','design-tokens.css'].includes(asset)){
  return route.fulfill({status:200,contentType:asset.endsWith('.js')?'text/javascript':asset.endsWith('.css')?'text/css':'text/html',body:await readFile(resolve('public-app',asset))});
 }
 const post=req.method()==='POST',headers={'content-type':'application/json','cf-connecting-ip':`198.51.100.${(ip++%200)+1}`,cookie:`__Host-whumpo-app-session-${a.project}=${who.session}`,...(post?{origin:req.headers().origin}:{})};
 const response=await m.appGateway.applicationGateway(new Request(req.url(),{method:req.method(),headers,body:post?req.postData():undefined}),{...f.env,DB:db,...(ceiling?{NOTIFICATION_CUSTOMER_CEILING_CENTS:ceiling}:{})});
 const text=await response.text();bodies.push(text);
 return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:text});
}
const browser=await chromium.launch({headless:true,...(process.env.WHUMPO_CHROMIUM?{executablePath:process.env.WHUMPO_CHROMIUM}:{})});
const page=await (await browser.newContext()).newPage();
page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});page.on('pageerror',e=>errors.push(String(e)));
await page.route('**/*',serve);
let checks=0;const check=async(name,fn)=>{try{await fn();checks++;}catch(e){console.error('FAILED:',name);throw e;}};
const axe=async label=>{const r=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();assert.deepEqual(r.violations.map(v=>[v.id,v.nodes.map(n=>n.target)]),[],'axe: '+label);};
const noScroll=async label=>assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true,'horizontal scroll: '+label);
const targets=async label=>{for(const el of await page.locator('#notify button, #notify input, #notify summary').all())if(await el.isVisible())assert((await el.boundingBox()).height>=43.5,label+' '+await el.evaluate(e=>e.id||e.tagName));};
async function open(width,{dark=false,text=false}={}){
 await page.setViewportSize({width,height:width>=1280?900:844});await page.emulateMedia({colorScheme:dark?'dark':'light',reducedMotion:'reduce'});
 await page.goto(origin+'/');await page.locator('#workspace').waitFor({state:'visible'});
 if(text)await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});
 if(!await page.locator('#notify').evaluate(e=>e.open))await page.locator('#notify summary').click();
 await page.locator('#notify-summary').filter({hasNotText:'Loading'}).waitFor();
}
const shot=(name)=>page.locator('#notify').screenshot({path:`${shots}/${name}.png`});
try{
 await check('no address yet: labelled field, inline error beside it, keyboard use',async()=>{
  await open(390);
  assert.match(await page.locator('#notify-summary').innerText(),/No address saved/);
  assert.equal(await page.getByLabel('Email address for notices').count(),1,'visible label');
  assert.equal(await page.locator('#notify-remove, #notify-send, #notify-code-form').evaluateAll(l=>l.filter(e=>e.offsetParent).length),0,'no remove, send or code control without an address');
  await page.getByLabel('Email address for notices').focus();await page.keyboard.press('Enter');
  assert.match(await page.locator('#notify-email-error').innerText(),/Enter the email address/);
  assert.equal(await page.locator('#notify-email').getAttribute('aria-invalid'),'true');
  assert.equal(await page.evaluate(()=>document.activeElement.id),'notify-email','focus stays on the field');
  await page.keyboard.type('not-an-address');await page.keyboard.press('Enter');
  await page.locator('#notify-email-error').filter({hasText:'Enter one email address.'}).waitFor();
  assert.equal(await page.locator('#notify-email-error').evaluate(e=>e.previousElementSibling.id),'notify-email','the error sits directly under its field');
  await shot('notices-error-390');await axe('error state');
 });
 await check('delivery unavailable: the page says so, offers no way to ask for a code and promises no email',async()=>{
  await page.getByLabel('Email address for notices').fill(ADDRESS);await page.keyboard.press('Enter');
  await page.locator('#notify-summary').filter({hasText:'saved but not verified'}).waitFor();
  const summary=await page.locator('#notify-summary').innerText();assert.match(summary,/g\*\*\*@e\*\*\*\.test/);assert.equal(summary.includes(ADDRESS),false,'only a hint of the address is shown');
  const note=await page.locator('#notify-delivery').innerText();assert.match(note,/cannot send verification codes yet/);assert.match(note,/no email will be sent/);
  assert.equal(await page.locator('#notify-send, #notify-code-form').evaluateAll(l=>l.filter(e=>e.offsetParent).length),0,'no send button, no code form');
  assert.equal(await page.locator('#notify-email').inputValue(),'','the typed address is cleared once saved');
  await page.locator('#notify-remove').waitFor();
  await axe('unavailable, light');
  for(const width of [360,390,1280]){await open(width);await noScroll('unavailable '+width);await targets('unavailable '+width);await shot(`notices-unavailable-${width}`);}
  await open(1280,{dark:true});await axe('unavailable, dark');await noScroll('dark 1280');await shot('notices-unavailable-dark-1280');
  await open(390,{dark:true});await noScroll('dark 390');await shot('notices-unavailable-dark-390');
  await open(360,{text:true});await noScroll('200% text at 360');await targets('200% text');await shot('notices-unavailable-360-200pct');
 });
 await check('with sending open: request a code, enter a wrong then the right one, by keyboard',async()=>{
  ceiling='500';await open(390);
  assert.equal(await page.locator('#notify-delivery').innerText().then(t=>/cannot send/.test(t)),false);
  await page.locator('#notify-send').waitFor();await targets('send open');
  await page.locator('#notify-send').focus();await page.keyboard.press('Enter');
  await page.locator('#notify-delivery').filter({hasText:'A code was requested'}).waitFor();
  assert.equal(sent.length,0,'nothing is sent until the delivery lane runs');
  await deliver();assert.equal(sent.length,1);assert.equal(sent[0].recipient,ADDRESS);
  await open(390);await page.locator('#notify-code-form').waitFor({state:'visible'});
  await page.getByLabel('Verification code').fill('AAAAAAAA');await page.keyboard.press('Enter');
  await page.locator('#notify-code-error').filter({hasText:'not valid'}).waitFor();
  assert.equal(await page.locator('#notify-code').getAttribute('aria-invalid'),'true');
  await page.getByLabel('Verification code').fill('short');await page.keyboard.press('Enter');
  await page.locator('#notify-code-error').filter({hasText:'8-character'}).waitFor();
  await shot('notices-code-390');await axe('code entry');
  await page.getByLabel('Verification code').fill(sent[0].verificationCode);await page.keyboard.press('Enter');
  await page.locator('#notify-summary').filter({hasText:'is verified'}).waitFor();
  assert.equal(await page.locator('#notify-code-form').isVisible(),false);await noScroll('verified');
  await shot('notices-verified-390');
 });
 await check('staff role: opt in and out by keyboard; hidden without the role',async()=>{
  assert.equal(await page.locator('#notify-staff').isVisible(),false,'no staff section without the role');
  const trigger=(await db.prepare("SELECT sql FROM sqlite_master WHERE name='module_access_role_insert'").first()).sql;
  await db.prepare('DROP TRIGGER module_access_role_insert').run();
  await db.prepare("INSERT INTO module_access_roles(instance_id,visitor_id,project_id,role,state,review_id,access_revision,granted_at,updated_at) SELECT access_id,id,project_id,'staff','granted',?,1,unixepoch(),unixepoch() FROM app_visitors WHERE id=?").bind(crypto.randomUUID(),who.who).run();
  await db.prepare(trigger).run();
  await open(390);
  await page.locator('#notify-staff-toggle').filter({hasText:'Receive staff notices'}).waitFor();await targets('staff');
  await page.locator('#notify-staff-toggle').focus();await page.keyboard.press('Enter');
  await page.locator('#notify-staff-text').filter({hasText:'You receive staff notices'}).waitFor();
  assert.equal((await db.prepare('SELECT count(*) n FROM staff_notification_optins').first()).n,1);
  await shot('notices-staff-390');await axe('staff, light');
  await open(1280,{dark:true});await axe('staff, dark');await noScroll('staff dark 1280');await shot('notices-staff-dark-1280');
  await page.locator('#notify-staff-toggle').click();await page.locator('#notify-staff-text').filter({hasText:'You can receive'}).waitFor();
  assert.equal((await db.prepare('SELECT count(*) n FROM staff_notification_optins').first()).n,0);
 });
 await check('removing the address withdraws everything and returns focus to the field',async()=>{
  await page.locator('#notify-remove').click();
  await page.locator('#notify-summary').filter({hasText:'No address saved'}).waitFor();
  assert.equal(await page.evaluate(()=>document.activeElement.id),'notify-email');
  assert.equal((await db.prepare('SELECT count(*) n FROM visitor_notification_addresses').first()).n,0);
 });
 await check('no response the page received carried the full address; no console errors',async()=>{
  assert.ok(bodies.length>10);
  for(const text of bodies)assert.equal(text.includes(ADDRESS),false,text);
  assert.deepEqual(errors.filter(e=>!/Failed to load resource/.test(e)),[]);
 });
 console.log(`Visitor notifications browser: ${checks} groups passed in Chromium on ${d1?'local D1':'SQLite'} at 360, 390 and 1280px, light and dark, 200% text. Screenshots in ${shots}. Simulated provider; nothing was sent.`);
}finally{await browser.close();await f.close();}
