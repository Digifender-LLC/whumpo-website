// WH-152 accountless guest preview journey in real Chromium, desktop keyboard and 390x844 mobile.
// The built owner client (the real WH-151 `guest-previews` panel on a saved workspace page) talks to the actual
// platform Worker; the guest talks to the actual sites handler. Both share one disposable local D1 + R2 database
// with a synthetic, explicitly approved private photo. Synthetic owner and site; loopback only, no model or provider.
// The owner Worker issues local links under http://localhost:8788/guest-preview/, so the guest server binds there.
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createServer} from 'node:http';
import {resolve,sep} from 'node:path';
import {createRequire} from 'node:module';
import {build as viteBuild} from 'vite';
import {currentSiteFixtureHandlers,createFixtureProject,changeFixtureWebsite} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';
import {keyboardJourney} from './helpers/keyboard-journey.mjs';
const {chromium}=createRequire(import.meta.url)(process.env.WHUMPO_PLAYWRIGHT||'@playwright/test');
const logs=[];for(const level of ['log','info','warn','error','debug']){const original=console[level].bind(console);console[level]=(...a)=>{logs.push(a.map(String).join(' '));if(level==='error')original(...a);};}
const dir=await mkdtemp((process.env.TMPDIR||'/tmp')+'/whumpo-guest-journey-'),html=`frontend/guest-owner-fixture-${process.pid}.html`,id=()=>crypto.randomUUID();
const m=await currentSiteFixtureHandlers(),fixture=await databaseFixture({d1:true,r2:true}),{db,env}=fixture;
const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('No external request allowed');};
let ownerServer,guestServer,browser,phase='setup';
const ownerOrigin='http://localhost:8787',guestOrigin='http://localhost:8788',errors=[],guestSeen=[],ownerSeen=[];
const row=(q,...p)=>db.prepare(q).bind(...p).first();
const nameOf=()=>{const e=document.activeElement;return e?(e.getAttribute('aria-label')||[...(e.labels||[])].map(l=>l.textContent.trim()).join(' ')||e.textContent.trim()||e.tagName):'';};
/** No horizontal page overflow and no control outside the viewport (reflow / large-text check). */
async function fits(page,label){
 const r=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth,out:[...document.querySelectorAll('button,input,select,textarea,a')].filter(e=>{const b=e.getBoundingClientRect();return b.width>0&&(b.right>innerWidth+1||b.left<-1);}).map(e=>{const b=e.getBoundingClientRect();return (e.getAttribute('aria-label')||e.id||e.textContent).trim().slice(0,40)+' ['+Math.round(b.left)+'..'+Math.round(b.right)+' of '+innerWidth+']';})}));
 assert.ok(r.scroll<=r.width,`${label}: horizontal overflow ${r.scroll}>${r.width}`);assert.deepEqual(r.out,[],`${label}: controls outside the viewport`);
}
// Emulates a 200% browser text size through CSSOM (the guest CSP forbids injected style elements).
const largeText=page=>page.evaluate(()=>document.documentElement.style.setProperty('font-size','200%','important'));
try{
 const actor=await workspaceFixture(db,m),scope=await actor.scope(),user=actor.account;await paidPlan(db,user,'personal');
 // Synthetic approved private photo: the owner and the guest both see the digest-verified bytes inlined.
 execFileSync('python3',['-c',"from PIL import Image; import sys; Image.new('RGB',(32,24),(60,110,80)).save(sys.argv[1])",dir+'/photo.jpg']);
 const site=await createFixtureProject(scope,user,'Journey garden','Neighborhood garden care'),photo=id();
 await m.uploadPhoto(new Request('https://whumpo.com/',{method:'PUT',headers:{'content-type':'image/jpeg','x-whumpo-photo-handoff':'null','x-photo-name':'Garden'},body:new Uint8Array(await readFile(dir+'/photo.jpg'))}),{...env,DB:scope},user,site.project,photo);
 await db.prepare("UPDATE project_photo_safety SET state='approved',csam_check='clear',sexual_check='clear',scanner_reference='synthetic',expires_at=? WHERE file_id=?").bind(new Date(Date.now()+3600000).toISOString(),photo).run();
 const version=await changeFixtureWebsite(scope,user,site.project,[{type:'pages.setPhotos',pageId:'home',photos:[{id:photo,alt:'Garden bed in spring'}]}]);
 // A second, unrelated link proves every control is named for its own link and acts only on it.
 const other=await m.guestPreviews.createGuestPreview(scope,user,site.project,{id:id(),versionId:version,expiresInHours:48,feedback:false,label:'Print shop copy'},guestOrigin+'/guest-preview/');
 await db.prepare("INSERT OR IGNORE INTO workspace_state(user_id,step) VALUES(?,'ready')").bind(user).run();
 await m.mutateLayout(scope,user,{version:1,requestId:id(),expectedRevision:0,operation:'createPage',page:{id:'tab-previews',label:'Guest previews',view:{version:1,projectId:site.project,widgets:['guest-previews'],shortcuts:[]}}});

 phase='build the real client';
 await writeFile(html,'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Whumpo guest preview acceptance</title></head><body><div id="root"></div><script type="module" src="/@fs/'+resolve('frontend/src/main.tsx')+'"></script><script type="module">import {queryClient} from "/@fs/'+resolve('frontend/src/lib/api.ts')+'";window.fixtureCache=()=>JSON.stringify([...queryClient.getQueryCache().getAll().map(q=>q.state.data),...queryClient.getMutationCache().getAll().map(q=>[q.state.variables,q.state.data])]);</script></body></html>');
 await viteBuild({build:{outDir:dir+'/web',rollupOptions:{input:resolve(html)}},logLevel:'error'});
 const root=resolve(dir+'/web'),ownerEnv={...env,ENVIRONMENT:'local',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}};
 ownerServer=createServer(async(req,res)=>{try{
  const url=new URL(req.url,ownerOrigin);if(req.headers.host!==new URL(ownerOrigin).host){res.writeHead(403).end();return;}
  if(url.pathname==='/_fixture/start'){res.writeHead(302,{'set-cookie':'__Host-whumpo_session='+actor.token+'; Secure; HttpOnly; SameSite=Lax; Path=/',location:'/workspace/tab-previews'}).end();return;}
  if(url.pathname.startsWith('/api/')){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);const body=Buffer.concat(chunks);
   const response=await m.worker.fetch(new Request(url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body})}),ownerEnv,{waitUntil(){}}),bytes=Buffer.from(await response.arrayBuffer());
   ownerSeen.push({url:req.url,method:req.method,request:body.toString(),response:bytes.toString(),status:response.status});
   for(const value of response.headers.getSetCookie())res.appendHeader('set-cookie',value);
   res.writeHead(response.status,Object.fromEntries([...response.headers].filter(([k])=>k!=='set-cookie')));res.end(bytes);return;
  }
  const name=url.pathname.startsWith('/workspace')||url.pathname==='/'?html.split('/').at(-1):decodeURIComponent(url.pathname).slice(1),path=resolve(root,name);if(!path.startsWith(root+sep)){res.writeHead(404).end();return;}
  const bytes=await readFile(path),ext=path.split('.').at(-1);res.writeHead(200,{'content-type':{html:'text/html',js:'text/javascript',css:'text/css',svg:'image/svg+xml',woff2:'font/woff2'}[ext]??'application/octet-stream','cache-control':'no-store'}).end(bytes);
 }catch{if(!res.headersSent)res.writeHead(500);res.end('Owner fixture failed');}});
 guestServer=createServer(async(req,res)=>{try{
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const headers=new Headers();for(const [k,v] of Object.entries(req.headers))if(typeof v==='string')headers.set(k,v);
  const response=await m.host.fetch(new Request(guestOrigin+req.url,{method:req.method,headers,...(chunks.length?{body:Buffer.concat(chunks)}:{})}),env);
  guestSeen.push({path:req.url,method:req.method,cookie:req.headers.cookie??null,status:response.status,setCookie:response.headers.getSetCookie()});
  res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
 }catch{res.writeHead(500).end();}});
 await Promise.all([[ownerServer,8787],[guestServer,8788]].map(([s,port])=>new Promise((done,reject)=>{s.once('error',reject);s.listen(port,'127.0.0.1',done);})));
 browser=await chromium.launch({headless:true,...(process.env.WHUMPO_CHROMIUM?{executablePath:process.env.WHUMPO_CHROMIUM}:{})});

 async function journey(profile,{viewport,mobile,dismiss}){
  const tag=profile.toUpperCase()+'-'+id().slice(0,6),label=profile+' review '+tag,said='Please make the heading larger. '+tag,guestName='Sam '+tag;
  const device={viewport,locale:'en-US',...(mobile?{isMobile:true,hasTouch:true,deviceScaleFactor:2}:{})};
  const ownerContext=await browser.newContext({...device,permissions:['clipboard-read','clipboard-write'],serviceWorkers:'block'}),guestContext=await browser.newContext(device);
  const o=await ownerContext.newPage(),g=await guestContext.newPage();
  for(const p of [o,g]){p.setDefaultTimeout(15000);p.on('pageerror',e=>errors.push(profile+': '+e.message));p.on('console',msg=>{if(msg.type()==='error')errors.push(profile+': '+msg.text());});}
  const kb=keyboardJourney(o),panel=o.locator('[data-view-component="guest-previews"]'),item=name=>panel.getByRole('listitem').filter({hasText:name});
  const focused=async where=>assert.ok(await o.evaluate(()=>!!document.activeElement&&document.activeElement!==document.body&&!!document.activeElement.closest('[data-guest-previews]')),profile+': focus stays inside the panel '+where);
  const ready=()=>panel.getByText('Create a link for one saved version').waitFor();

  phase=profile+': owner opens the saved page';
  await o.goto(ownerOrigin+'/_fixture/start');await ready();
  await item('Print shop copy').waitFor();assert.equal(await item('Print shop copy').getByText('Comments off',{exact:false}).count(),1);
  phase=profile+': form focus order and accessible names';
  await o.locator('#guest-version').focus();const order=[await o.evaluate(nameOf)];
  for(let i=0;i<4;i++){await o.keyboard.press('Tab');order.push(await o.evaluate(nameOf));}
  assert.deepEqual(order,['Saved version','Link lasts (1–168 hours)','Guests may leave comments','Label for you (optional)','Review link details']);
  for(const name of ['Saved version','Link lasts (1–168 hours)','Guests may leave comments','Label for you (optional)'])assert.equal(await panel.getByLabel(name,{exact:true}).count(),1,name);
  // Two links, so the accessible name of each action must identify its own link.
  const names=await panel.getByRole('button').evaluateAll(list=>list.map(b=>b.getAttribute('aria-label')||b.textContent.trim()));
  for(const prefix of ['Revoke link','Delete'])assert.equal(new Set(names.filter(n=>n.startsWith(prefix))).size,names.filter(n=>n.startsWith(prefix)).length,prefix+' buttons need distinct names: '+names);
  assert.ok(names.some(n=>/^Revoke link/.test(n)&&n.includes('Print shop copy')),'Revoke is named for its link: '+names);

  phase=profile+': prepare shows the exact readout and writes nothing';
  const before=(await row('SELECT count(*) n FROM guest_preview_links')).n;
  await kb.enter(o.getByLabel('Label for you (optional)'),label);await kb.enter(o.getByLabel('Link lasts (1–168 hours)'),'2');
  await kb.activate(o.getByRole('button',{name:'Review link details'}));
  const confirm=panel.getByRole('region',{name:'Confirm guest link'});await confirm.waitFor();
  const readout=await confirm.innerText();for(const text of ['Journey garden','2 hour(s) after you confirm','Allowed'])assert.ok(readout.includes(text),readout);
  assert.equal((await row('SELECT count(*) n FROM guest_preview_links')).n,before);
  await focused('after review');
  if(mobile)for(const b of await panel.getByRole('button').all())if(await b.isVisible())assert.ok((await b.boundingBox()).height>=44,'44px touch target: '+await b.innerText());
  await largeText(o);await fits(o,profile+' owner readout at 200% text');
  if(mobile){await o.setViewportSize({width:320,height:568});await fits(o,profile+' owner readout at 320px');await o.setViewportSize(viewport);}
  await o.reload();await ready();assert.equal(await panel.getByRole('region',{name:'Confirm guest link'}).count(),0,'The readout is not kept across reload');
  await kb.enter(o.getByLabel('Label for you (optional)'),label);await kb.enter(o.getByLabel('Link lasts (1–168 hours)'),'2');await kb.activate(o.getByRole('button',{name:'Review link details'}));await confirm.waitFor();
  phase=profile+': cancel keeps focus and writes nothing';
  await kb.activate(confirm.getByRole('button',{name:'Cancel'}));await confirm.waitFor({state:'detached'});await focused('after cancel');assert.equal((await row('SELECT count(*) n FROM guest_preview_links')).n,before);
  await kb.activate(o.getByRole('button',{name:'Review link details'}));await confirm.waitFor();

  phase=profile+': confirm issues the link, shown once';
  await kb.activate(confirm.getByRole('button',{name:'Confirm and create link'}));
  const shown=panel.getByRole('region',{name:'New guest link'});await shown.waitFor();await focused('after issue');
  const url=await shown.getByLabel('Guest preview link').inputValue(),token=url.split('#')[1];
  assert.match(url,/^http:\/\/localhost:8788\/guest-preview\/#[A-Za-z0-9_-]{43}$/);
  assert.equal(await shown.getByRole('button').count(),2);
  await kb.activate(shown.getByRole('button',{name:'Copy link'}));
  await o.waitForFunction(async u=>(await navigator.clipboard.readText())===u,url);
  const stored=await row('SELECT * FROM guest_preview_links WHERE label=?',label);assert.ok(stored,'link row');assert.ok(!JSON.stringify(stored).includes(token),'only a hash is stored');
  assert.equal(ownerSeen.filter(r=>r.response.includes(token)).length,1,'the token appears in exactly one owner response (issuance)');
  assert.ok(ownerSeen.every(r=>!r.url.includes(token)&&!r.request.includes(token)),'no owner request carries the token');

  phase=profile+': guest opens the link and previews it';
  const seen=[];g.on('response',r=>{const u=new URL(r.url());if(u.origin===guestOrigin)seen.push({path:u.pathname,headers:r.headers()});});
  await g.goto(url);const frame=g.frameLocator('#preview');await frame.getByRole('heading',{name:'Journey garden'}).first().waitFor();
  assert.match(await g.locator('#expiry').textContent(),/^Available until /);
  assert.equal(await g.locator('#preview').getAttribute('sandbox'),'');assert.equal(await g.locator('#preview').getAttribute('title'),'Website preview');
  const img=frame.getByRole('img',{name:'Garden bed in spring'});await img.waitFor();
  assert.ok(await img.evaluate(i=>i.complete&&i.naturalWidth===32&&i.src.startsWith('data:image/jpeg;base64,')),'approved private photo is inlined and decodes');
  await g.getByRole('heading',{name:'Private website preview',level:1}).waitFor();await g.getByRole('heading',{name:'Send a comment to the owner',level:2}).waitFor();
  assert.equal(await g.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true,'No horizontal overflow');
  phase=profile+': guest keyboard order, names and comment';
  await g.evaluate(()=>{document.activeElement?.blur();});const guestOrder=[];
  for(let i=0;i<6;i++){await g.keyboard.press('Tab');const name=await g.evaluate(nameOf);if(name!=='IFRAME'&&name!=='Website preview')guestOrder.push(name);if(name==='Send comment')break;}
  assert.deepEqual(guestOrder,['Your name (optional, not verified)','Comment','Send comment']);
  assert.equal(await g.getByRole('status').count(),2,'link status and comment status are live regions');
  await g.locator('#guest-name').focus();await g.keyboard.type(guestName);await g.keyboard.press('Tab');assert.equal(await g.evaluate(()=>document.activeElement.id),'guest-comment');
  await g.keyboard.type(said);await g.keyboard.press('Tab');assert.equal(await g.evaluate(()=>document.activeElement.id),'send');await g.keyboard.press('Enter');
  await g.getByText('Thank you. Your comment was sent to the owner.').waitFor();
  assert.deepEqual((await m.guestPreviews.listGuestFeedback(scope,user,stored.id)).feedback.map(f=>[f.displayName,f.text]),[[guestName,said]]);
  phase=profile+': guest large text and reflow';
  await largeText(g);await fits(g,profile+' guest at 200% text');
  assert.ok(await g.evaluate(()=>parseFloat(getComputedStyle(document.body).fontSize)>=32),'Guest text follows the browser text size');
  if(mobile){await g.setViewportSize({width:320,height:568});await fits(g,profile+' guest at 320px');await g.setViewportSize(viewport);}
  phase=profile+': guest headers, cookies and storage';
  const doc=seen.find(r=>r.path==='/guest-preview/'),view=seen.find(r=>r.path==='/guest-preview/view');
  for(const r of [doc,view,...seen.filter(r=>r.path.startsWith('/guest-preview/api/'))]){assert.ok(r,'response seen');assert.match(r.headers['cache-control'],/no-store/);assert.match(r.headers['x-robots-tag'],/noindex/);assert.equal(r.headers['set-cookie'],undefined);}
  for(const r of [doc,view])assert.ok(r.headers['content-security-policy']);
  assert.match(doc.headers['content-security-policy'],/frame-ancestors 'none'/);assert.match(view.headers['content-security-policy'],/sandbox/);assert.match(view.headers['content-security-policy'],/img-src data:/);
  assert.deepEqual(await guestContext.cookies(),[],'The guest holds no cookie');
  assert.deepEqual(await g.evaluate(async()=>({cookie:document.cookie,local:localStorage.length,session:sessionStorage.length,idb:(await indexedDB.databases()).length})),{cookie:'',local:0,session:0,idb:0});
  assert.ok(guestSeen.every(r=>r.cookie===null&&r.setCookie.length===0),'No guest request carried a cookie and no response set one');
  assert.ok(guestSeen.every(r=>!r.path.includes(token)),'The token is never in a guest request path or query');

  phase=profile+': the token is gone once dismissed or left';
  if(dismiss){await kb.activate(shown.getByRole('button',{name:'I have copied it'}));await shown.waitFor({state:'detached'});await focused('after dismissal');}
  else{await o.getByRole('link',{name:'Dashboard',exact:true}).filter({visible:true}).first().click();await panel.waitFor({state:'detached'});await o.goBack();await ready();await shown.waitFor({state:'detached'});}
  const leaks=async where=>{
   assert.ok(!(await o.content()).includes(token),where+': token in the owner DOM');assert.ok(!o.url().includes(token));assert.ok(!(await o.evaluate(()=>window.fixtureCache())).includes(token),where+': token in the client cache');
   assert.ok(!(await o.evaluate(()=>JSON.stringify([{...localStorage},{...sessionStorage}]))).includes(token),where+': token in browser storage');
   assert.ok(!JSON.stringify(await ownerContext.cookies()).includes(token),where+': token in a cookie');
  };
  await leaks('after dismissal');await o.reload();await ready();await leaks('after reload');
  assert.equal(await panel.getByRole('region',{name:'New guest link'}).count(),0);assert.equal(await panel.getByLabel('Guest preview link').count(),0);
  assert.deepEqual((await ownerContext.cookies()).map(c=>c.name),['__Host-whumpo_session'],'The owner holds only the workspace session cookie');

  phase=profile+': owner reads, resolves and reviews the comment';
  const mine=item(label);await mine.getByText('1 comment(s), 1 open',{exact:false}).waitFor();await mine.getByText('Active',{exact:false}).waitFor();
  assert.equal(await mine.getByText(said).count(),0,'Comment text is hidden until requested');
  await kb.activate(mine.getByRole('button',{name:/^Show comments/}));await mine.getByText(said,{exact:true}).waitFor();
  await mine.getByText(guestName+' (not verified)',{exact:false}).waitFor();assert.equal(await mine.locator('script,img,a').count(),0,'Comment text is plain text');
  await largeText(o);await fits(o,profile+' owner comments at 200% text');
  await kb.activate(mine.getByRole('button',{name:/^Mark resolved/}));await mine.getByText('1 comment(s), 0 open',{exact:false}).waitFor();await mine.getByText('Resolved',{exact:false}).first().waitFor();await focused('after resolve');
  assert.notEqual((await row('SELECT resolved_at FROM guest_preview_feedback WHERE link_id=?',stored.id)).resolved_at,null);
  await kb.activate(mine.getByRole('button',{name:/^Reopen/}));await mine.getByText('1 comment(s), 1 open',{exact:false}).waitFor();
  await kb.activate(mine.getByRole('button',{name:'Hide comments'}));await mine.getByText(said).waitFor({state:'detached'});await focused('after hiding comments');

  phase=profile+': owner revokes; the guest link stops working';
  await kb.activate(mine.getByRole('button',{name:/^Revoke link/}));await mine.getByText('Revoked',{exact:false}).waitFor();await focused('after revoke');
  assert.equal(await mine.getByRole('button',{name:/^Revoke link/}).count(),0);
  assert.equal((await row('SELECT count(*) n FROM guest_preview_links WHERE id=? AND revoked_at IS NOT NULL',other.link.id)).n,0,'The other link is untouched');await item('Print shop copy').getByText('Active',{exact:false}).waitFor();
  await g.locator('#guest-comment').fill('Late comment '+tag);await g.getByRole('button',{name:'Send comment'}).click();await g.getByText('This preview link no longer accepts comments.').waitFor();
  assert.equal((await row('SELECT count(*) n FROM guest_preview_feedback WHERE link_id=?',stored.id)).n,1,'No comment after revocation');
  await g.reload();await g.getByText('This preview link is unavailable.',{exact:false}).waitFor();assert.equal(await g.locator('#preview').isHidden(),true);assert.equal(await g.locator('#feedback').isHidden(),true);
  assert.equal((await guestContext.request.post(guestOrigin+'/guest-preview/api/link',{data:{token},headers:{origin:guestOrigin}})).status(),404);
  assert.equal((await guestContext.request.post(guestOrigin+'/guest-preview/view',{form:{token},headers:{origin:guestOrigin}})).status(),404);

  phase=profile+': two-step delete';
  await kb.activate(mine.getByRole('button',{name:/^Delete…/}));const sure=mine.getByRole('button',{name:/^Confirm: delete link and 1 comment\(s\)/});await sure.waitFor();
  await kb.activate(mine.getByRole('button',{name:'Keep'}));await sure.waitFor({state:'detached'});await focused('after keep');assert.equal((await row('SELECT count(*) n FROM guest_preview_links WHERE id=?',stored.id)).n,1);
  await kb.activate(mine.getByRole('button',{name:/^Delete…/}));await kb.activate(sure);await mine.waitFor({state:'detached'});await focused('after delete');
  assert.deepEqual([(await row('SELECT count(*) n FROM guest_preview_links WHERE id=?',stored.id)).n,(await row('SELECT count(*) n FROM guest_preview_feedback WHERE link_id=?',stored.id)).n],[0,0]);
  await item('Print shop copy').getByText('Active',{exact:false}).waitFor();
  await ownerContext.close();await guestContext.close();
 }
 await journey('desktop',{viewport:{width:1280,height:800},mobile:false,dismiss:true});
 await journey('mobile',{viewport:{width:390,height:844},mobile:true,dismiss:false});

 phase='no network, logs or database leak';
 assert.equal(network,0);assert.deepEqual(errors.filter(e=>!/status of 404/.test(e)),[],errors.join('\n'));
 assert.equal((await db.prepare('SELECT count(*) n FROM guest_preview_feedback').first()).n,0,'All journey comments were deleted by their owner');
 const all=logs.join('\n');assert.doesNotMatch(all,/Please make the heading larger|Sam (DESKTOP|MOBILE)|[A-Za-z0-9_-]{43}/,'Worker logs hold no token or guest text');
 assert.ok(guestSeen.every(r=>!/Please|Sam/.test(r.path)),'No guest text in request paths');
 process.stdout.write('Guest preview journey passed (Chromium, desktop 1280x800 keyboard and mobile 390x844, real owner panel + platform Worker + sites handler, local D1/R2): owner prepare/confirm/revoke/resolve/delete, one-time link, accountless sandboxed preview with approved private photo, keyboard comment, no cookie or stored/logged token, large text and reflow.'+'\n');
}catch(error){console.error(phase,String(error.stack||error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundled module>'));process.exitCode=1;}
finally{globalThis.fetch=originalFetch;await browser?.close();for(const s of [ownerServer,guestServer])if(s){s.closeAllConnections();await new Promise(done=>s.close(done));}await fixture.close();await rm(dir,{recursive:true,force:true});await rm(html,{force:true});}
