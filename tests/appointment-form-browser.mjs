// WH-070 standard appointment form in Chromium at 360, 390 and 1280px: the owner setup card (actual built component), then the
// hosted /forms/appointment page served by the actual application-host Worker over the complete current schema (disposable SQLite),
// through Playwright request interception (no listening port, no network). Owner setup runs through its real reviews to a bound
// form. Turnstile: the Cloudflare script is replaced by a stub widget in the browser and Siteverify is stubbed in the Worker; this is a
// local fixture only and nothing here is run against the deployed site. Every identity and value is synthetic.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'vite';
import {currentSiteFixtureHandlers,createFixtureProject} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.WHUMPO_PLAYWRIGHT||'@playwright/test');
const AxeBuilder=require(process.env.WHUMPO_AXE||'@axe-core/playwright').default;
const shots=process.env.WHUMPO_SHOTS||(process.env.TMPDIR||'/tmp')+'/whumpo-appointment-shots';
await mkdir(shots,{recursive:true});
const m=await currentSiteFixtureHandlers(),fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID();
const row=(q,...p)=>db.prepare(q).bind(...p).first(),run=(q,...p)=>db.prepare(q).bind(...p).run();
const SITE_KEY='0x4AAAAAAFIoE2toIv5N36J5';
let verdict=null,siteverifyCalls=0;
globalThis.fetch=async(input,init)=>{
 if(String(input?.url??input)==='https://challenges.cloudflare.com/turnstile/v0/siteverify'){siteverifyCalls++;return Response.json(verdict(new URLSearchParams(init.body)));}
 throw Error('No network or inference is available');
};
const runtime={fetch:async()=>Response.json({ok:true,value:{state:{},result:{}}})};
const env={DB:db,AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})},BACKEND_RUNTIME:runtime};
const assets={fetch:async request=>{const name=new URL(request.url).pathname.slice(1);try{return new Response(await readFile(resolve('public-app',name)),{headers:{'content-type':name.endsWith('.js')?'text/javascript':'text/css'}});}catch{return new Response('missing',{status:404});}}};
const config={secret:true};
let ip=1,hold=null,posts=[];
const dir=await mkdtemp((process.env.TMPDIR||'/tmp')+'/whumpo-appointment-browser-'),html=`frontend/appointment-fixture-${process.pid}.html`,root=resolve(dir,'web');
let browser,page,phase='setup';const errors=[],csp=[];

async function owner(){
 const actor=await workspaceFixture(db,m),scope=await actor.scope(),user=actor.account;
 const site=await createFixtureProject(scope,user,'Garden Salon',"Haircuts and colour");
 for(const feature of ['core.editing','core.forms'])for(const operation of ['prepare','confirm'])
  await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,?,?,'private-test-acceptance','synthetic WH-070 browser fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),user,site.project,feature,operation);
 return {...actor,scope,user,...site};
}
const o=await owner();
const revision=async()=>(await m.readChat(o.scope,o.user)).state.revision;
async function control(action){const turn=id();return {id:turn,...await m.sendChatControl(o.scope,o.user,{id:turn,revision:await revision(),action})};}
async function chat(content){const turn=id();return {turn,result:await m.sendChat(o.scope,o.user,{id:turn,revision:await revision(),content})};}
async function activation(action='activate'){
 const r=await control({type:'moduleActivationReview',projectId:o.project,instanceId:'appointments',action});assert.equal(r.status,200,r.error);
 const saved=await row('SELECT * FROM module_activation_reviews WHERE id=?',r.id);
 assert.equal((await control({type:'moduleActivationApply',reviewId:saved.id,reviewDigest:saved.review_digest,expectedRevision:saved.expected_activation_revision})).status,200);
}
async function ownerGet(path){const r=await m.worker.fetch(new Request('https://whumpo.com'+path,{headers:{cookie:`__Host-whumpo_session=${o.token}`,origin:'https://whumpo.com'}}),{...(fixture.env??{}),...env,ENVIRONMENT:'test'},{waitUntil(){}});return r.json();}
const deployedURL=`https://app-${o.project}.whumpo.site/forms/appointment`,localURL=`http://localhost:8787/apps/${o.project}/forms/appointment`;

/** Serves the stub Turnstile script and the actual application-host Worker for the two origins; nothing else is reachable. */
async function serve(route){
 const req=route.request(),url=new URL(req.url());
 if(url.hostname==='challenges.cloudflare.com'){
  return route.fulfill({status:200,contentType:'text/javascript',body:"window.turnstile={render(s,o){window.__ts={o,resets:0,n:0};setTimeout(()=>o.callback('stub-token'),30);return 'w';},reset(){window.__ts.resets++;setTimeout(()=>window.__ts.o.callback('stub-token'),30);}};"});
 }
 const local=url.origin==='http://localhost:8787';
 if(!local&&url.hostname!==`app-${o.project}.whumpo.site`)return route.abort();
 const headers=new Headers(req.headers());headers.set('cf-connecting-ip',`192.0.2.${(ip++%250)+1}`);
 const body=req.postData(),isPost=req.method()==='POST';
 if(isPost){posts.push(JSON.parse(body));if(hold)await hold;}
 const response=await m.appHost.fetch(new Request(req.url(),{method:req.method(),headers,body:isPost?body:undefined}),
  local?{...env,ENVIRONMENT:'local',ASSETS:assets}:{...env,ENVIRONMENT:'test',ASSETS:assets,TURNSTILE_SECRET:config.secret?'secret':undefined,TURNSTILE_SITE_KEY:SITE_KEY});
 return route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
}
async function open(url,width=390,{dark=false}={}){
 await page.setViewportSize({width,height:width>=1280?900:844});await page.emulateMedia({colorScheme:dark?'dark':'light',reducedMotion:'reduce'});
 await page.goto(url);await page.locator('h1').first().waitFor();
}
const noScroll=async label=>assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal scroll: '+label);
async function axe(label){const r=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();assert.deepEqual(r.violations.map(v=>[v.id,v.nodes.map(n=>n.target)]),[],'axe: '+label);}
const closed=async label=>{
 await page.getByRole('heading',{name:'This form isn’t open yet',level:1}).waitFor();
 assert.equal(await page.locator('form,button,input,textarea,select,#widget').count(),0,'Closed: no form, no submit, no widget ('+label+')');
 assert.equal(await page.getByText('Garden Salon').count(),0,'Closed: nothing about the business');
};
const heights=async(selector,min,label)=>{for(const el of await page.locator(selector).all())if(await el.isVisible())assert((await el.boundingBox()).height>=min-0.5,label+' '+selector);};

try{
 // ---------- Owner setup card: the actual built component ----------
 phase='owner card';
 await writeFile(html,'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Whumpo appointment setup acceptance</title></head><body><div id="root"></div><script type="module" src="/@fs/'+resolve('tests/fixtures/appointment-setup.tsx')+'"></script></body></html>');
 await build({build:{outDir:root,rollupOptions:{input:resolve(html)}},logLevel:'error'});
 browser=await chromium.launch({headless:true,...(process.env.WHUMPO_CHROMIUM?{executablePath:process.env.WHUMPO_CHROMIUM}:{})});
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,locale:'en-US'});
 page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 page.on('console',e=>{if(/Content Security Policy|violates/i.test(e.text()))csp.push(e.text());});
 const ownerRequests=[];
 await context.route('http://owner.test/**',async route=>{
  const url=new URL(route.request().url());ownerRequests.push(url.pathname);
  const name=url.pathname==='/'?html.split('/').at(-1):decodeURIComponent(url.pathname).slice(1),file=resolve(root,name);
  if(!file.startsWith(root+sep))return route.fulfill({status:404});
  try{const ext=file.split('.').at(-1);return route.fulfill({status:200,contentType:{html:'text/html',js:'text/javascript',css:'text/css',woff2:'font/woff2'}[ext]??'application/octet-stream',body:await readFile(file)});}catch{return route.fulfill({status:404});}
 });
 await page.goto('http://owner.test/');await page.locator('#bound section').waitFor();
 const card=name=>page.locator('#'+name+' section'),button=name=>card(name).getByRole('button');
 assert.equal(await page.getByText('Ask Whumpo in Chat to add a form').count(),0,'The false copy is gone');
 await card('website').getByText('draft your private website first').waitFor();assert.equal(await button('website').count(),0);
 await card('fresh').getByText('Nothing is saved or published until you confirm it.').waitFor();
 assert.equal(await button('fresh').count(),1);await button('fresh').getByText('Add an appointment form',{exact:true}).waitFor();
 await card('saved').getByText('saved in your private website but is not on yet').waitFor();await button('saved').getByText('Review activating the form').waitFor();
 await card('off').getByText('saved but turned off').waitFor();
 await card('unpublished').getByText('your website is not published').waitFor();
 await card('stale').getByText('Your website changed after the form was turned on').waitFor();
 await card('bound').getByText('The form sends no email by itself.').waitFor();
 const link=card('bound').getByRole('link');assert.equal(await link.getAttribute('href'),'https://app-11111111-1111-4111-8111-111111111111.whumpo.site/forms/appointment');assert.equal(await link.getAttribute('rel'),'noopener noreferrer');
 assert.equal(await button('bound').count(),0,'A bound form offers no further step');
 assert.equal(await card('fresh').getByRole('listitem').filter({hasText:'Next'}).count(),1,'Exactly one next step, said in words');
 phase='owner card keyboard';
 await button('fresh').focus();assert.equal(await page.evaluate(()=>document.activeElement?.textContent),'Add an appointment form');
 await link.focus();assert.equal(await page.evaluate(()=>document.activeElement?.tagName),'A');
 for(const width of [360,390,1280]){
  phase='owner card layout at '+width;await page.setViewportSize({width,height:width===1280?900:844});await noScroll('owner card '+width);
  for(const name of ['website','fresh','saved','off','unpublished','stale','bound']){
   const b=await card(name).boundingBox();assert(b.x>=0&&b.x+b.width<=width,name+' inside the viewport at '+width);
   for(const btn of await button(name).all())assert((await btn.boundingBox()).height>=44,'44px button '+name);
  }
  await card('fresh').screenshot({path:`${shots}/owner-card-fresh-${width}.png`});await card('bound').screenshot({path:`${shots}/owner-card-bound-${width}.png`});
 }
 await page.emulateMedia({colorScheme:'dark'});await card('bound').screenshot({path:`${shots}/owner-card-bound-dark.png`});await page.emulateMedia({colorScheme:'light'});
 assert.deepEqual(ownerRequests.filter(p=>p.startsWith('/api/')),[],'The card makes no server request on its own');
 await context.close();

 // ---------- Owner setup through real reviews, then the hosted page ----------
 phase='setup';
 const mobile={viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,locale:'en-US'};
 const visitor=await browser.newContext(mobile);
 page=await visitor.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
 page.on('console',e=>{if(/Content Security Policy|violates/i.test(e.text()))csp.push(e.text());});
 await visitor.route('**/*',serve);
 phase='closed before setup';
 await open(deployedURL);await closed('not configured');await axe('closed page');
 await page.screenshot({path:`${shots}/hosted-closed-390.png`,fullPage:true});
 const prepared=await control({type:'appointmentFormReview',projectId:o.project});assert.equal(prepared.status,200,prepared.error);
 const proposal=await row('SELECT * FROM project_spec_proposals WHERE id=?',prepared.id);
 assert.equal((await control({type:'specificationApply',reviewId:proposal.id,proposalDigest:proposal.proposal_digest,expectedRevision:proposal.expected_revision})).status,200);
 await open(deployedURL);await closed('saved only');
 const head=await row('SELECT version_id FROM project_spec_heads WHERE project_id=?',o.project),review=await chat('/publish '+head.version_id);assert.equal((await chat('/confirm '+review.turn)).result.status,200);
 await open(deployedURL);await closed('published, form not on');
 await activation();
 assert.equal((await ownerGet(`/api/projects/${o.project}/module-records`)).appointment.publicForm,'bound');

 // ---------- Hosted page, deployed mode with the Turnstile secret present and a stub widget ----------
 phase='open page layout';
 const form=page.locator('#form');
 for(const width of [360,390,1280]){
  await open(deployedURL,width);await page.getByRole('heading',{name:'Request an appointment',level:1}).waitFor();
  await noScroll('hosted '+width);
  for(const label of ['Your name','Email or phone']){const f=page.getByLabel(label,{exact:true});assert(await f.isVisible(),label+' has a visible label');}
  assert.equal(await page.getByRole('group',{name:'What do you need?'}).count(),1);assert.equal(await page.getByRole('group',{name:'Preferred day'}).count(),1);
  await page.getByLabel('Anything we should know? (optional)').waitFor();
  await heights('input[type=text],textarea',44,'field '+width);await heights('label.choice',44,'choice '+width);await heights('#send',44,'send '+width);
  const b=await form.boundingBox();assert(b.x>=0&&b.x+b.width<=width,'Form inside the viewport at '+width);
  await page.screenshot({path:`${shots}/hosted-open-${width}.png`,fullPage:true});
 }
 phase='dark and 200% text';
 await open(deployedURL,390,{dark:true});assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(11, 24, 48)','Dark surface token');await axe('open page, dark');await page.screenshot({path:`${shots}/hosted-open-dark-390.png`,fullPage:true});
 await open(deployedURL,1280,{dark:true});await page.screenshot({path:`${shots}/hosted-open-dark-1280.png`,fullPage:true});
 await open(deployedURL,360);await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});await noScroll('200% text at 360');
 await heights('#send',44,'200%');await page.screenshot({path:`${shots}/hosted-open-360-200pct.png`,fullPage:true});
 await open(deployedURL,390);await axe('open page, light');

 phase='validation';
 posts=[];
 await page.locator('#send').click();
 await page.locator('#summary').filter({hasText:'4 answers need attention.'}).waitFor();
 assert.equal(await page.evaluate(()=>document.activeElement?.id),'f-name','Focus moves to the first problem');
 assert.equal(await page.locator('#e-name').textContent(),'This is needed.');assert.equal(await page.locator('#e-service').textContent(),'Choose one.');
 assert.equal(await page.locator('#f-name').getAttribute('aria-invalid'),'true');
 assert(await page.evaluate(()=>{const i=document.getElementById('f-name'),e=document.getElementById('e-name');return i.nextElementSibling===e&&i.getAttribute('aria-describedby')==='e-name';}),'Error sits right after its field and is its description');
 await page.screenshot({path:`${shots}/hosted-errors-390.png`,fullPage:true});await axe('validation errors');
 assert.equal(posts.length,0,'Nothing is sent while answers are missing');
 await page.keyboard.type('Ada Lovelace');assert.equal(await page.locator('#e-name').isHidden(),true,'The message goes as soon as the answer is fixed');

 phase='keyboard-only submission with loading and success';
 await page.keyboard.press('Tab');await page.keyboard.type('ada@example.test');
 await page.keyboard.press('Tab');await page.keyboard.press('ArrowRight');assert.equal(await page.getByLabel('Follow-up').isChecked(),true);
 await page.keyboard.press('Tab');await page.keyboard.press('Space');await page.keyboard.press('ArrowRight');assert.equal(await page.getByLabel('A weekend day').isChecked(),true);
 await page.keyboard.press('Tab');await page.keyboard.type('Ground floor please');
 await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement?.id),'send','Focus order ends at the send button');
 let release;hold=new Promise(r=>{release=r;});
 const resource=await row("SELECT i.id,i.config_revision FROM module_instances i WHERE i.project_id=? AND i.local_id='appointments'",o.project);
 verdict=()=>({success:true,hostname:new URL(deployedURL).hostname,action:'module-form',cdata:resource.id});
 await page.keyboard.press('Enter');
 await page.locator('#send').filter({hasText:'Sending…'}).waitFor();
 assert.equal(await form.getAttribute('aria-busy'),'true');assert.equal(await page.locator('#send').getAttribute('aria-disabled'),'true');
 await page.locator('#progress').filter({hasText:'Sending your request…'}).waitFor();
 await page.keyboard.press('Enter');await page.screenshot({path:`${shots}/hosted-sending-390.png`,fullPage:true});
 assert.equal(posts.length,1,'A second press while sending sends nothing more');
 release();hold=null;
 await page.locator('#done').waitFor({state:'visible'});
 assert.equal(await page.evaluate(()=>document.activeElement?.id),'done','Focus moves to the confirmation');
 await page.getByRole('heading',{name:'Request sent'}).waitFor();await page.getByText('Nothing is booked yet, and this page does not send you an email.').waitFor();
 assert.equal(await page.getByText(/confirmed|we will email you/i).count(),0);assert.equal(await form.isHidden(),true);
 await page.screenshot({path:`${shots}/hosted-success-390.png`,fullPage:true});await axe('success');
 assert.deepEqual(posts[0].target,{formId:'appointment'});assert.equal(posts[0].operation,'forms.submit');assert.equal(posts[0].resourceId,resource.id);
 assert.deepEqual(posts[0].input.values,{name:'Ada Lovelace',contact:'ada@example.test',service:'follow-up',day:'weekend',note:'Ground floor please'});
 assert.equal(siteverifyCalls,1);
 const listed=await ownerGet(`/api/projects/${o.project}/module-records/${resource.id}/appointment`);
 assert.deepEqual(listed.items.map(i=>[i.submittedBy,i.values.name,i.values.contact,i.values.service,i.values.day,i.values.note]),[['public','Ada Lovelace','ada@example.test','follow-up','weekend','Ground floor please']],'The request is in the owner records list');
 assert.equal((await ownerGet(`/api/projects/${o.project}/module-records`)).items[0].schemas[0].records.public,1);
 assert.equal(await page.locator('#reference').textContent(),listed.items[0].entryId.slice(0,8).toUpperCase(),'The on-page reference is the one the owner sees');
 await page.getByRole('button',{name:'Send another request'}).click();
 await page.locator('#f-name').waitFor({state:'visible'});assert.equal(await page.evaluate(()=>document.activeElement?.id),'f-name');assert.equal(await page.locator('#f-name').inputValue(),'');

 phase='failed check keeps the answers and can be retried';
 await page.locator('#f-name').fill('Grace Hopper');await page.locator('#f-contact').fill('555 0100');
 await page.getByLabel('First visit').check();await page.getByLabel('Any day').check();
 verdict=()=>({success:false});posts=[];
 await page.locator('#send').click();
 await page.locator('#summary').filter({hasText:'The security check didn’t pass. Please try it again.'}).waitFor();
 assert.equal(await page.locator('#f-name').inputValue(),'Grace Hopper','Answers are kept');assert.equal(await page.locator('#send').textContent(),'Send request');
 assert.equal(await page.evaluate(()=>window.__ts.resets),2,'The widget is reset for a fresh token');
 await page.screenshot({path:`${shots}/hosted-check-failed-390.png`,fullPage:true});
 verdict=()=>({success:true,hostname:new URL(deployedURL).hostname,action:'module-form',cdata:resource.id});
 await page.waitForTimeout(100);await page.locator('#send').click();await page.locator('#done').waitFor({state:'visible'});
 assert.equal(posts.length,2);assert.equal(posts[0].requestId,posts[1].requestId,'The same request id is reused for the same answers');
 assert.equal((await ownerGet(`/api/projects/${o.project}/module-records`)).items[0].schemas[0].records.public,2);

 phase='the form closes while the page is open';
 await open(deployedURL,390);await page.locator('#f-name').fill('Late Visitor');await page.locator('#f-contact').fill('x@example.test');await page.getByLabel('Something else').check();await page.getByLabel('Any day').check();
 await activation('disable');posts=[];
 await page.waitForTimeout(100);await page.locator('#send').click();
 await page.locator('#summary').filter({hasText:'This form isn’t open right now. Please try again later.'}).waitFor();
 assert.equal(await page.locator('#f-name').inputValue(),'Late Visitor');
 await open(deployedURL);await closed('disabled');await activation();

 phase='no secret on the deployed host';
 config.secret=false;await open(deployedURL);await closed('no Turnstile secret');await axe('closed, no secret');
 const before=(await ownerGet(`/api/projects/${o.project}/module-records`)).items[0].schemas[0].records.public;
 assert.equal(await page.locator('script[src*="challenges"]').count(),0);
 config.secret=true;

 phase='local environment skips Turnstile by design';
 await open(localURL,390);assert.equal(await page.locator('#widget').count(),0);assert.equal(await page.locator('#e-check').count(),0);
 await page.locator('#f-name').fill('Local Tester');await page.locator('#f-contact').fill('local@example.test');await page.getByLabel('First visit').check();await page.getByLabel('A weekday').check();
 const calls=siteverifyCalls;await page.locator('#send').click();await page.locator('#done').waitFor({state:'visible'});assert.equal(siteverifyCalls,calls,'No Siteverify in a local environment');
 assert.equal((await ownerGet(`/api/projects/${o.project}/module-records`)).items[0].schemas[0].records.public,before+1);

 phase='published site link';
 const site=await m.host.fetch(new Request(`http://localhost/s/${o.project}/`),{...env,FILES:null},{waitUntil(){}}),siteText=await site.text();
 assert.ok(siteText.includes(`href="${deployedURL}"`)&&siteText.includes('Request an appointment ↗'));

 assert.deepEqual(errors,[]);assert.deepEqual(csp,[],'No Content-Security-Policy violation on any page');
 console.log(`Appointment form browser passed: owner card (false copy gone, steps, one next button, link only when bound) and the hosted page at 360, 390 and 1280px, light and dark, 200% text; closed (no form, no submit) when not configured, saved, not on, disabled and without the Turnstile secret; validation errors beside fields; keyboard-only submit with loading and success states; failed check keeps answers and reuses the request id; owner list receives requests; local skips Turnstile; no CSP violation; axe clean. Screenshots: ${shots}`);
}catch(error){console.error('Appointment form browser phase:',phase);if(page)await page.screenshot({path:`${shots}/failure.png`,fullPage:true}).catch(()=>{});throw error;}
finally{await browser?.close();await fixture.close();await rm(html,{force:true});await rm(dir,{recursive:true,force:true});}
