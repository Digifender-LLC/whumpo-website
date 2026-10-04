// WH-092 guest page smoke in Chromium (WH-152 keeps full device/owner-surface acceptance).
// The actual sites handler serves the local /guest-preview/ routes from a disposable SQLite
// database. Synthetic owner and site only; no network beyond loopback, model or provider.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {currentSiteFixtureHandlers,createFixtureProject} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.WHUMPO_PLAYWRIGHT||'@playwright/test');
const m=await currentSiteFixtureHandlers(),fixture=await databaseFixture(),{db}=fixture;
const files={get:async()=>{throw Error('No private object is read for this site-page fixture');}};
let server,browser,origin,phase='setup';const errors=[],paths=[];
try{
 const actor=await workspaceFixture(db,m),scope=await actor.scope();await paidPlan(db,actor.account,'personal');
 const site=await createFixtureProject(scope,actor.account,'Browser garden','Neighborhood garden care');
 server=createServer(async(req,res)=>{try{
  paths.push(req.url);const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const headers=new Headers();for(const [k,v] of Object.entries(req.headers))if(typeof v==='string')headers.set(k,v);
  const response=await m.host.fetch(new Request(origin+req.url,{method:req.method,headers,...(chunks.length?{body:Buffer.concat(chunks)}:{})}),{DB:db,FILES:files});
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(500).end();}});
 await new Promise(done=>server.listen(0,'127.0.0.1',done));origin='http://127.0.0.1:'+server.address().port;
 const issued=await m.guestPreviews.createGuestPreview(scope,actor.account,site.project,{id:crypto.randomUUID(),versionId:site.version,expiresInHours:2,feedback:true},origin+'/guest-preview/');
 browser=await chromium.launch({headless:true,...(process.env.WHUMPO_CHROMIUM?{executablePath:process.env.WHUMPO_CHROMIUM}:{})});
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,locale:'en-US'});
 const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));page.on('console',msg=>{if(msg.type()==='error')errors.push(msg.text());});
 phase='preview opens in the sandboxed frame';
 await page.goto(issued.url);
 const frame=page.frameLocator('#preview');await frame.getByRole('heading',{name:'Browser garden'}).first().waitFor();
 assert.match(await page.locator('#expiry').textContent(),/^Available until /);
 assert.equal(await page.locator('#preview').getAttribute('sandbox'),'');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'No horizontal overflow at 390px');
 assert.ok(!paths.some(p=>p.includes(issued.token)),'The token never appears in a request path or query');
 phase='keyboard comment';
 await page.locator('#guest-name').focus();await page.keyboard.type('Sam');await page.keyboard.press('Tab');
 assert.equal(await page.evaluate(()=>document.activeElement?.id),'guest-comment');
 await page.keyboard.type('Please make the heading larger.');await page.keyboard.press('Tab');
 assert.equal(await page.evaluate(()=>document.activeElement?.id),'send');await page.keyboard.press('Enter');
 await page.getByText('Thank you. Your comment was sent to the owner.').waitFor();
 const listed=await m.guestPreviews.listGuestFeedback(scope,actor.account,issued.link.id);
 assert.deepEqual(listed.feedback.map(f=>[f.displayName,f.text]),[['Sam','Please make the heading larger.']]);
 assert.deepEqual(errors,[]);
 phase='revocation ends access on reload';
 await m.guestPreviews.revokeGuestPreview(scope,actor.account,issued.link.id);
 await page.reload();await page.getByText('This preview link is unavailable.',{exact:false}).waitFor();
 assert.equal(await page.locator('#preview').isHidden(),true);assert.equal(await page.locator('#feedback').isHidden(),true);
 // The revoked link's status request is an expected 404 resource error; nothing else.
 assert.ok(errors.every(e=>/status of 404/.test(e)),errors.join('\n'));
 console.log('Guest preview browser smoke passed (Chromium 390x844, local sites handler): sandboxed exact preview, fragment-only token, keyboard comment, revocation on reload, no overflow or page errors. Full device and owner-surface acceptance remains WH-152.');
}catch(error){console.error(phase,String(error.stack||error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundled module>'));process.exitCode=1;}
finally{await browser?.close();server?.close();await fixture.close();}
