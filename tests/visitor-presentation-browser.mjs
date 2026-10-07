import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {buildPortalClient} from '../tools/check-specification-compiler.mjs';
import {portalFixture} from './helpers/portal-fixture.mjs';
Error.stackTraceLimit=0;
const {chromium}=createRequire(import.meta.url)(process.env.WHUMPO_PLAYWRIGHT||'@playwright/test');
await writeFile('public-app/module-portal.js',(await buildPortalClient()).outputFiles[0].contents);
const f=await portalFixture({d1:process.argv.includes('--d1')}),dir=await mkdtemp('/tmp/whumpo-portal-browser-'),errors=[],sent=[];
let server,browser,page,phase='fixtures',loseSubmission=true,loseLogout=true,skipLogout=true,logoutRequests=0,network=0;const originalFetch=globalThis.fetch;
try{
 const a=await f.owner('Neighbourhood studio'),b=await f.owner('Other studio');await f.publish(a,await f.configure(a));await f.publish(b,await f.configure(b));
 const invite=await f.m.appAuth.createAppInvitation(a.scope,a.user,a.project);
 const env={...f.env,ENVIRONMENT:'local'},origin='http://localhost:8787';
 globalThis.fetch=async()=>{network++;throw Error('No external network or inference');};
 server=createServer(async(req,res)=>{try{
  if(req.headers.host!=='localhost:8787'){res.writeHead(403).end();return;}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks),url=origin+req.url;
  const payload=body.length&&req.headers['content-type']?.includes('application/json')?JSON.parse(body):null;
  if(payload?.api==='whumpo-modules')sent.push(payload);
  if(req.url.endsWith('/auth/logout')){logoutRequests++;if(skipLogout){skipLogout=false;res.writeHead(503,{'content-type':'application/json'}).end('{}');return;}}
  const response=await f.m.appHost.fetch(new Request(url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body})}),env);
  if(loseSubmission&&payload?.operation==='forms.submit'&&response.status===200){loseSubmission=false;res.writeHead(200,{'content-type':'application/json'}).end();return;}
  if(req.url.endsWith('/auth/logout')){if(loseLogout&&response.status===200){loseLogout=false;res.writeHead(200,{'content-type':'application/json'}).end();return;}}
  const headers=Object.fromEntries(response.headers);headers['set-cookie']=response.headers.getSetCookie();res.writeHead(response.status,headers).end(Buffer.from(await response.arrayBuffer()));
 }catch(e){errors.push(e.message);res.writeHead(500).end('Fixture failure');}});
 await new Promise((done,reject)=>{server.once('error',reject);server.listen(8787,'127.0.0.1',done);});
 browser=await chromium.launch({headless:true,...(process.env.WHUMPO_CHROMIUM?{executablePath:process.env.WHUMPO_CHROMIUM}:{})});
 const context=await browser.newContext({viewport:{width:390,height:844}});page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 page.on('console',message=>{if(message.type()==='error'&&/Content Security Policy|Refused to/.test(message.text()))errors.push(message.text());});
 const cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
 const route=origin+'/apps/'+a.project+'/portal';
 phase='served invitation sign-in';await page.goto(route);await page.getByRole('button',{name:'Sign in with a passkey',exact:true}).waitFor();
 await page.getByText('Join with an invitation',{exact:true}).click();await page.getByLabel('Invitation code',{exact:true}).fill(invite.code);await page.getByRole('button',{name:'Join with a passkey',exact:true}).click();
 await page.getByRole('button',{name:'I’ve saved my code',exact:true}).waitFor();assert((await page.getByLabel('Save your recovery code',{exact:true}).inputValue()).length>20);await page.getByRole('button',{name:'I’ve saved my code',exact:true}).click();
 const form=page.getByRole('region',{name:'Send an enquiry',exact:true}),records=page.getByRole('region',{name:'Your submissions',exact:true}),gallery=page.getByRole('region',{name:'Your photos',exact:true});
 await form.getByLabel('Name',{exact:true}).waitFor();
 const fill=async(name='A synthetic visitor')=>{await form.getByLabel('Name',{exact:true}).fill(name);await form.getByLabel('Message',{exact:true}).fill('Please call about the garden <script>hello</script>.');await form.getByLabel('Private note for the owner',{exact:true}).fill('Private owner-only value');};
 phase='lost response, reload, exact retry';await fill();await form.getByRole('button',{name:'Send submission',exact:true}).click();await page.waitForFunction(()=>!!sessionStorage.getItem('whumpo-portal-request:'+location.pathname.replace(/\/portal$/,'')));
 await page.waitForFunction(()=>document.querySelector('#portal-status').textContent.length>0);assert.equal((await f.row('SELECT count(*) n FROM module_records WHERE project_id=?',a.project)).n,1);
 await page.reload();await form.getByLabel('Name',{exact:true}).waitFor();await fill('Changed input');await form.getByRole('button',{name:'Retry this exact submission',exact:true}).click();await page.getByText('A different request is waiting for confirmation. Retry its exact original fields or photo first.',{exact:true}).waitFor();
 assert.equal(sent.filter(r=>r.operation==='forms.submit').length,1);await fill();await form.getByRole('button',{name:'Retry this exact submission',exact:true}).click();await page.getByText('Your submission is saved.',{exact:true}).waitFor();await records.getByText('A synthetic visitor',{exact:true}).waitFor();assert.equal((await f.row('SELECT count(*) n FROM module_records WHERE project_id=?',a.project)).n,1);assert.equal(new Set(sent.filter(r=>r.operation==='forms.submit').map(r=>r.requestId)).size,1);assert(!(await records.textContent()).includes('Private owner-only value'));assert.equal(await page.locator('script:not([src])').count(),0);
 phase='held photo and approved attachment';execFileSync('python3',['-c',"from PIL import Image; import sys; Image.new('RGB',(64,48),(54,116,92)).save(sys.argv[1])",dir+'/photo.jpg']);
 await gallery.getByLabel('Add a JPEG photo (up to 1 MiB)',{exact:true}).setInputFiles(dir+'/photo.jpg');await gallery.getByRole('button',{name:'Upload photo',exact:true}).click();await page.getByText('Your photo is saved and waiting for safety review. It cannot appear or be attached yet.',{exact:true}).waitFor();assert.equal(await gallery.getByRole('img').count(),0);
 const photo=await f.row('SELECT file_id FROM module_files WHERE project_id=?',a.project);await f.run("UPDATE project_photo_safety SET state='approved',csam_check='clear',sexual_check='clear',scanner_reference='synthetic-browser-only',expires_at=? WHERE file_id=?",new Date(Date.now()+3600000).toISOString(),photo.file_id);
 await page.getByRole('button',{name:'Refresh information',exact:true}).click();await gallery.getByRole('img',{name:'Approved photo 1',exact:true}).waitFor();await fill('Attachment visitor');await form.getByLabel('Photo 1',{exact:true}).check();await form.getByRole('button',{name:'Send submission',exact:true}).click();await records.getByText('Attachment visitor',{exact:true}).waitFor();assert.equal((await f.row("SELECT sum(json_array_length(attachments_json)) n FROM module_records WHERE project_id=?",a.project)).n,1);
 phase='bounded retry expiry and stop reminder';
 await page.evaluate(()=>sessionStorage.setItem('whumpo-portal-request:'+location.pathname.replace(/\/portal$/,''),JSON.stringify({version:1,id:crypto.randomUUID(),digest:'a'.repeat(64),blockId:'enquiry',createdAt:Date.now()-86400001})));
 await page.reload();await form.getByLabel('Name',{exact:true}).waitFor();await fill();const sentBefore=sent.filter(r=>r.operation==='forms.submit').length;
 await form.getByRole('button',{name:'Retry this exact submission',exact:true}).click();await page.getByText('This retry record expired. Check your saved information and stop retrying before starting another request.',{exact:true}).waitFor();assert.equal(sent.filter(r=>r.operation==='forms.submit').length,sentBefore);
 await page.getByRole('button',{name:'Stop retrying this request',exact:true}).click();await page.getByText('The browser reminder is cleared. An already sent request may still finish; check your saved information before sending a new change.',{exact:true}).waitFor();assert.equal(sent.filter(r=>r.operation==='forms.submit').length,sentBefore);
 phase='three layouts, accessibility and same API refusals';
 for(const layout of ['studio','journal','desk']){
  if(layout!=='studio')await f.publish(a,await f.configure(a,f.presentation(layout)));await page.goto(route);await form.getByLabel('Name',{exact:true}).waitFor();await gallery.getByRole('img').waitFor();
  assert.equal(await page.locator('body').getAttribute('data-layout'),layout);
  for(const width of [360,390,1280]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));for(const button of await page.getByRole('button').all()){if(await button.isVisible())assert((await button.boundingBox()).height>=44);}await page.screenshot({path:`/tmp/whumpo-portal-${layout}-${width}.png`,fullPage:true});}
  await page.keyboard.press('Control+Home');await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.textContent),'Skip to content');await page.keyboard.press('Enter');await page.waitForFunction(()=>location.hash==='#main');assert.equal(new URL(page.url()).hash,'#main');
  const checks=await page.evaluate(async({project,foreign})=>{const base='/apps/'+project,manifest=await (await fetch(base+'/portal/config')).json(),r=manifest.instances.enquiries;
   const call=async(path,body)=>{const response=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return response.status;};
   const body={api:'whumpo-modules',version:1,operation:'records.view',resourceId:r.resourceId,configRevision:r.configRevision,requestId:null,target:{viewId:'desk',cursor:null},input:null};
   return [await call(base+'/modules',body),await call('/apps/'+foreign+'/modules',body),await call(base+'/modules',{...body,target:{viewId:'mine',cursor:null},configRevision:99})];
  },{project:a.project,foreign:b.project});assert.deepEqual(checks,[403,404,409]);
 }
 phase='lost sign-out response clears values, explicit retry, passkey sign-in and current revocation';await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByText('Your private information is hidden. Sign-out could not be confirmed. Retry sign-out.',{exact:true}).waitFor();assert(!(await page.locator('body').textContent()).includes('Attachment visitor'));assert.equal(await page.locator('[data-content] img').count(),0);assert.equal(await page.getByLabel('Save your recovery code',{exact:true}).inputValue(),'');assert.equal(logoutRequests,1);
 await page.reload();await page.getByRole('button',{name:'Retry sign-out',exact:true}).waitFor();assert(!(await page.locator('body').textContent()).includes('Attachment visitor'));assert.equal(logoutRequests,1);
 await page.getByRole('button',{name:'Retry sign-out',exact:true}).click();await page.getByText('Your private information is hidden. Sign-out could not be confirmed. Retry sign-out.',{exact:true}).waitFor();assert.equal(logoutRequests,2);assert(!(await page.locator('body').textContent()).includes('Attachment visitor'));
 await page.reload();await page.getByRole('button',{name:'Retry sign-out',exact:true}).waitFor();assert.equal(logoutRequests,2);
 await page.getByRole('button',{name:'Retry sign-out',exact:true}).click();await page.getByText('You’re signed out.',{exact:true}).waitFor();assert.equal(logoutRequests,3);
 await page.getByRole('button',{name:'Sign in with a passkey',exact:true}).click();await records.getByText('Attachment visitor',{exact:true}).waitFor();
 await f.activate(a,'photos','disable');await page.reload();assert.equal(await page.locator('body').textContent(),'The application is temporarily unavailable.');
 assert.equal(network,0);assert.deepEqual(errors,[]);console.log('Served visitor portal browser passed: real invitation/passkey flow, lost-response reload/exact retry, own records/field privacy, held-photo approval fixture/attachment, three layouts at360/390/1280, keyboard/touch targets, direct tenant/staff/stale denials, sign-out/sign-in and disable; zero provider/inference.');
}catch(e){console.error('Portal browser phase: '+phase);if(page)console.error((await page.locator('body').textContent()).slice(0,5000));throw e;}finally{globalThis.fetch=originalFetch;if(browser)await browser.close();if(server)await new Promise(done=>server.close(done));await f.fixture.close();await rm(dir,{recursive:true,force:true});}
