import {keyboardJourney} from './helpers/keyboard-journey.mjs';
import {unzipSync,strFromU8} from 'fflate';
import {initializeFixtureKeys,fixtureKeyring,fixtureCiphertext} from './helpers/connection-keyring.mjs';
// WH-018 local synthetic acceptance only: Settings account lifecycle and the compromise review in a real browser (keyboard only) at 360, 390 and 1280px,
// plus 200% text. The real Worker over the current schema (SQLite, or actual local D1 with --d1), real signed WebAuthn from Chromium's virtual
// authenticator, and the real outbox. The ONLY provider is a recording `send_email` stand-in below; every address is under .test. No network, no live send.
import assert from 'node:assert/strict';
import {timingSafeEqual} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,sep} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {build as viteBuild} from 'vite';
import {databaseFixture} from './helpers/current-database.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.WHUMPO_PLAYWRIGHT||'@playwright/test');
const dir=await mkdtemp((process.env.TMPDIR||'/tmp')+'/whumpo-account-lifecycle-browser-'),html=`frontend/account-lifecycle-fixture-${process.pid}.html`,origin='http://localhost:8787';
let browser,server,fixture,phase='build';const originalFetch=globalThis.fetch,originalEqual=crypto.subtle.timingSafeEqual;
const errors=[],sent=[];let network=0;
try{
 await writeFile(html,'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Whumpo account lifecycle acceptance</title></head><body><div id="root"></div><script type="module" src="/@fs/'+resolve('frontend/src/main.tsx')+'"></script></body></html>');
 await viteBuild({build:{outDir:dir+'/web',rollupOptions:{input:resolve(html)}},logLevel:'error'});
 const bundled=await build({stdin:{contents:"export {default as worker} from './src/index';export {hashToken} from './src/security';export {runNotificationDelivery} from './src/notification-outbox';export {contactDelivery} from './src/contact-email';export {queueSecurityNotices} from './src/email-change/notices';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
 const {worker,hashToken,runNotificationDelivery,contactDelivery,queueSecurityNotices}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
 fixture=await databaseFixture();const db=fixture.db;
 const one=(sql,...v)=>db.prepare(sql).bind(...v).first();
 const code=crypto.randomUUID();await db.prepare("INSERT INTO invitations VALUES(?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 hour'),NULL,NULL)").bind(await hashToken(code)).run();
 crypto.subtle.timingSafeEqual=(a,b)=>timingSafeEqual(Buffer.from(a),Buffer.from(b));
 globalThis.fetch=async url=>{if(String(url)==='https://challenges.cloudflare.com/turnstile/v0/siteverify')return Response.json({success:true,hostname:'localhost',action:'register'});network++;throw Error('Unexpected external request');};
 const env={DB:db,ENVIRONMENT:'local',TURNSTILE_SITE_KEY:'synthetic-public',TURNSTILE_SECRET:'synthetic-secret',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})},
  CONTACT_NOTIFICATION_PROVIDER:'cloudflare-email',CONTACT_NOTIFICATION_REVIEW:'review-1',CONTACT_EMAIL:{send:async message=>{sent.push(message);return {messageId:'ref-'+sent.length};}}};
 const live=contactDelivery(env);assert.ok(live,'the simulated provider makes delivery active');
 const drain=async()=>{await queueSecurityNotices(db,Date.now());await runNotificationDelivery(db,live.settings,live.sender,{now:new Date(),timeoutMs:50});};
 const background=[],root=resolve(dir+'/web');
 server=createServer(async(req,res)=>{try{
  if(req.headers.host!=='localhost:8787'){res.writeHead(403).end();return;}
  const url=new URL(req.url,origin);
  if(url.pathname.startsWith('/api/')){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const response=await worker.fetch(new Request(url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})}),env,{waitUntil:p=>background.push(p)});
   const headers=Object.fromEntries(response.headers);headers['set-cookie']=response.headers.getSetCookie();res.writeHead(response.status,headers).end(Buffer.from(await response.arrayBuffer()));return;
  }
  const name=url.pathname==='/'||url.pathname.startsWith('/workspace')?html.split('/').at(-1):decodeURIComponent(url.pathname).slice(1),path=resolve(root,name);
  if(!path.startsWith(root+sep)){res.writeHead(404).end();return;}
  const bytes=await readFile(path),ext=path.split('.').at(-1);res.writeHead(200,{'content-type':{html:'text/html',js:'text/javascript',css:'text/css',png:'image/png',svg:'image/svg+xml',woff2:'font/woff2'}[ext]??'application/octet-stream','cache-control':'no-store'}).end(bytes);
 }catch{res.writeHead(500).end('Fixture error');}});
 await new Promise((done,reject)=>{server.once('error',reject);server.listen(8787,'127.0.0.1',done)});
 browser=await chromium.launch({headless:true,...(process.env.WHUMPO_CHROMIUM?{executablePath:process.env.WHUMPO_CHROMIUM}:{})});
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,permissions:['clipboard-read','clipboard-write'],acceptDownloads:true});
 await context.addInitScript(()=>{window.turnstile={render:()=> 'synthetic',remove:()=>{},reset:()=>{},getResponse:()=> 'synthetic-turnstile'};});
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 const {activate,enter}=keyboardJourney(page,true);
 const cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');
 const authenticator=async()=>(await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}})).authenticatorId;
 const owner='account-lifecycle-owner@example.test',addr=name=>`${name}-${crypto.randomUUID().slice(0,8)}@example.test`;
 // Every size the owner may use, in light and dark: no horizontal scroll, 44px controls on phones, and the same at 200% text.
 async function fit(label){
  for(const dark of [false,true])for(const [width,large] of [[360,false],[390,false],[1280,false],[360,true]]){
   await page.emulateMedia({colorScheme:dark?'dark':'light',reducedMotion:'reduce'});
   await page.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),dark);
   await page.setViewportSize({width,height:width>=1280?900:844});await page.evaluate(large=>{document.documentElement.style.fontSize=large?'200%':'';},large);
   await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
   const where=`${label}: ${width}${large?' large text':''}${dark?' dark':' light'}`;
   const over=await page.evaluate(()=>[...document.querySelectorAll('main, main *')].filter(e=>e.getBoundingClientRect().right>innerWidth+.5&&!e.closest('[aria-hidden=true]')).slice(0,4).map(e=>e.tagName+'.'+String(e.className).slice(0,40)));
   assert.deepEqual(over,[],`${where}: horizontal overflow`);
   if(width<=760){const short=await page.evaluate(()=>[...document.querySelectorAll('main button,main a[class*=inline-flex],main input:not([type=checkbox])')].filter(e=>e.getBoundingClientRect().height&&e.getBoundingClientRect().height<43.5).map(e=>(e.textContent.trim()||e.name||e.tagName).slice(0,40)));assert.deepEqual(short,[],`${where}: controls under 44px`);}
   // Text and background contrast of every visible text node's element, against its nearest painted background.
   const low=await page.evaluate(()=>{
    const parse=c=>c.match(/[\d.]+/g).map(Number),lum=([r,g,b])=>{const f=v=>{v/=255;return v<=.03928?v/12.92:((v+.055)/1.055)**2.4;};return .2126*f(r)+.7152*f(g)+.0722*f(b);};
    const bg=el=>{for(let n=el;n;n=n.parentElement){const c=parse(getComputedStyle(n).backgroundColor);if(c.length<4||c[3]>0.5)return c.slice(0,3);}return [255,255,255];};
    const out=[];for(const el of document.querySelectorAll('main p,main li,main label,main h1,main h2,main h3,main dt,main dd,main button,main span')){
     if(!el.childNodes.length||![...el.childNodes].some(n=>n.nodeType===3&&n.textContent.trim()))continue;
     const r=el.getBoundingClientRect();if(!r.width||!r.height)continue;
     const f=parse(getComputedStyle(el).color).slice(0,3),b=bg(el),l1=lum(f),l2=lum(b),ratio=(Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);
     if(ratio<4.5)out.push(el.tagName+':'+el.textContent.trim().slice(0,30)+' '+ratio.toFixed(2));}
    return out.slice(0,4);});
   assert.deepEqual(low,[],`${where}: contrast`);
   if(width===390||width===1280)await page.screenshot({path:`/tmp/whumpo-account-lifecycle-${label}-${width}${dark?'-dark':''}.png`,fullPage:true});
  }
  await page.evaluate(()=>{document.documentElement.style.fontSize='';document.documentElement.classList.remove('dark');});await page.emulateMedia({colorScheme:'light'});await page.setViewportSize({width:390,height:844});
 }
 // Signup, two passkeys, recovery kit, welcome: the same trusted path as the identity suites.
 phase='signup';
 let auth=await authenticator();
 await page.goto(origin+'/workspace?signup=true');await enter(page.getByLabel('Email',{exact:true}),owner);await enter(page.getByLabel('Invitation code'),code);await activate(page.getByRole('checkbox'));await activate(page.getByRole('button',{name:'Create my first passkey'}));
 await page.getByRole('heading',{name:'Make this account yours.'}).waitFor();
 await cdp.send('WebAuthn.removeVirtualAuthenticator',{authenticatorId:auth});auth=await authenticator();
 await enter(page.getByLabel('Name your next passkey'),'Backup provider');await activate(page.getByRole('button',{name:'Add a passkey',exact:true}));await page.getByText('Backup provider',{exact:true}).waitFor();
 await activate(page.getByRole('button',{name:'Prepare recovery kit',exact:true}));await page.getByRole('heading',{name:'Save your recovery kit'}).waitFor();
 let downloaded=page.waitForEvent('download');await activate(page.getByRole('button',{name:'Download',exact:true}));
 const oldKey=(await readFile(await (await downloaded).path(),'utf8')).match(/Recovery key:\n([a-f0-9]{64})/)[1];
 await activate(page.getByRole('button',{name:'I’ve saved my recovery kit'}));await page.getByRole('heading',{name:'Your kit is saved'}).waitFor();
 await activate(page.getByRole('button',{name:'Verify a passkey and finish setup'}));
 await enter(page.getByLabel('Your name',{exact:true}),'Email owner');await activate(page.getByRole('button',{name:'Continue',exact:true}));
 await activate(page.getByRole('button',{name:'Use this picture',exact:true}));await activate(page.getByRole('button',{name:'Skip for now',exact:true}));
 await enter(page.getByLabel('Your first idea',{exact:true}),'A website for my neighborhood landscaping business.');await activate(page.getByRole('button',{name:'Continue',exact:true}));
 await enter(page.getByLabel('Working name',{exact:true}),'Garden care');await activate(page.getByRole('button',{name:'Continue',exact:true}));
 await activate(page.getByRole('button',{name:'Skip for now',exact:true}));await activate(page.getByRole('button',{name:'Use this starting feel',exact:true}));
 await activate(page.getByRole('button',{name:'Start my project',exact:true}));await page.getByRole('textbox',{name:'Message Whumpo'}).waitFor();
 const account=(await one('SELECT id FROM users')).id;
 assert.equal((await one("SELECT count(*) n FROM identity_credentials WHERE account_id=? AND status='active'",account)).n,2);

 phase='account page';
 await page.goto(origin+'/workspace/account');
 await page.getByRole('heading',{name:'Account data and closure',level:1}).waitFor();
 await page.getByRole('heading',{name:'Close your account'}).waitFor();
 assert.equal(await page.evaluate(()=>document.activeElement?.tagName),'H1','the page moves focus to its heading');
 assert.match(await page.title(),/Account data and closure/);
 await fit('account-initial');

 phase='export';
 await activate(page.getByRole('checkbox',{name:/Include visitor datasets/}));
 await activate(page.getByRole('button',{name:'Review export',exact:true}));
 const exportReview=page.getByRole('region',{name:'Export review'});await exportReview.waitFor();
 assert.match(await exportReview.innerText(),/visitor datasets included/);assert.match(await exportReview.innerText(),/Passkeys, recovery material/);
 await fit('export-review');
 downloaded=page.waitForEvent('download');await activate(page.getByRole('button',{name:'Check passkey and download'}));
 const archive=unzipSync(new Uint8Array(await readFile(await (await downloaded).path())));
 const manifest=JSON.parse(strFromU8(archive['manifest.json']));
 assert.equal(manifest.complete,true);assert.equal(manifest.accountId,account);assert.equal(manifest.scope.visitorData,true);
 assert.ok(archive['account.json']&&archive['README.txt']);
 const text=Object.values(archive).map(strFromU8).join('\n');
 assert.ok(!text.includes(oldKey),'the recovery key is never exported');
 await page.getByText(/Your export was downloaded/).waitFor();await fit('export-done');
 assert.equal((await one("SELECT downloads FROM account_export_usage WHERE user_id=?",account)).downloads,1);

 // A credential with a provider revocation still pending (no provider is configured here), so closing pauses and the closing state can be seen.
 await initializeFixtureKeys(db);
 await db.prepare("INSERT INTO github_token_vault(id,user_id,ciphertext,expires_at,state) VALUES('token-browser',?,?,'2027-01-01','active')").bind(account,await fixtureCiphertext(fixtureKeyring(),`whumpo:github:token:${account}:token-browser`,'gho_SYNTHETIC_BROWSER')).run();
 phase='closure review';
 await activate(page.getByRole('button',{name:'Review account closure'}));
 const closureReview=page.getByRole('region',{name:'Closure review'});await closureReview.waitFor();
 const reviewText=await closureReview.innerText();
 assert.match(reviewText,/Closing starts immediately after you confirm/);assert.match(reviewText,/What remains after closure/);assert.doesNotMatch(reviewText,/hold|preserv/i);
 const closeButton=page.getByRole('button',{name:'Check passkey and close account'});
 assert.equal(await closeButton.isDisabled(),true,'confirmation needs the typed word');
 await fit('closure-review');
 await enter(page.getByLabel('Type CLOSE to confirm'),'CLOSE');assert.equal(await closeButton.isDisabled(),false);
 await activate(page.getByRole('button',{name:'Cancel',exact:true}));
 assert.equal(await one('SELECT 1 x FROM account_closures WHERE account_id=?',account),null,'cancelling the review stores nothing');
 await activate(page.getByRole('button',{name:'Review account closure'}));await closureReview.waitFor();
 await enter(page.getByLabel('Type CLOSE to confirm'),'CLOSE');
 phase='closure';
 await activate(closeButton);
 await page.getByRole('heading',{name:'Your account is closing'}).waitFor();
 assert.match(await page.getByRole('list',{name:'Closure steps'}).innerText(),/Revoke provider authorizations\s+Waiting/);
 await fit('closure-waiting');
 // Another workspace page now refuses; the person is taken to the one page that works instead of seeing a raw error.
 await page.goto(origin+'/workspace/settings');
 const notice=page.getByRole('alert').filter({hasText:'other workspace actions are paused'});await notice.waitFor({timeout:8000}).catch(async e=>{console.error('PAGE TEXT: '+(await page.locator('body').innerText()).slice(0,600));throw e;});
 for(const dark of [false,true])for(const [width,large] of [[360,false],[390,false],[1280,false],[360,true]]){
  await page.emulateMedia({colorScheme:dark?'dark':'light'});await page.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),dark);
  await page.setViewportSize({width,height:width>=1280?900:844});await page.evaluate(large=>{document.documentElement.style.fontSize=large?'200%':'';},large);
  await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  const box=await notice.boundingBox(),link=await notice.getByRole('link',{name:'Open closure status'}).boundingBox(),where=`notice ${width}${large?' large':''}${dark?' dark':''}`;
  assert.ok(box.x>=0&&box.x+box.width<=width+.5,where+': horizontal overflow');assert.ok(link.height>=43.5&&link.x+link.width<=width+.5,where+': link size or position');
 }
 await page.evaluate(()=>{document.documentElement.style.fontSize='';document.documentElement.classList.remove('dark');});await page.emulateMedia({colorScheme:'light'});await page.setViewportSize({width:390,height:844});
 await activate(notice.getByRole('link',{name:'Open closure status'}));
 await page.getByRole('heading',{name:'Your account is closing',level:2}).waitFor();
 // The provider confirms (fixture stand-in: the row leaves); continuing the closure finishes it.
 await db.prepare("DELETE FROM github_token_vault WHERE id='token-browser'").run();
 await activate(page.getByRole('button',{name:'Continue closure'}));
 await page.getByRole('heading',{name:'Your account is closed'}).waitFor();
 const steps=await page.getByRole('list',{name:'Closure steps'}).innerText();
 for(const label of ['Stop new work','Take websites offline','Finish unresolved operations','Revoke provider authorizations','Retention review','Delete account data'])assert.match(steps,new RegExp(label));
 await fit('closure-done');
 const receipt=await one('SELECT state,history FROM account_closures WHERE account_id=?',account);
 assert.equal(receipt.state,'closed');assert.equal(receipt.history,'["requested","reviewed","confirmed","quiescing","closed"]');
 assert.equal(await one('SELECT 1 x FROM users WHERE id=?',account),null);
 assert.equal((await one("SELECT count(*) n FROM account_closure_steps s JOIN account_closures c ON c.closure_id=s.closure_id WHERE c.account_id=? AND s.state='done'",account)).n,6);
 assert.equal(network,0);
 assert.equal(errors.length,0,errors.join('\n'));
 console.log(`Account lifecycle browser passed (local synthetic acceptance only, ${process.argv.includes('--d1')?'actual local D1':'SQLite'}): export review and one real ZIP download with manifest, closure review with typed confirmation and cancel, fresh-passkey confirm through to the final receipt, keyboard only at 360/390/1280 and 200% text in light and dark with contrast and 44px checks. Screen-reader (Orca) paths not run.`);
}catch(error){console.error(`Account lifecycle browser failed during ${phase}: ${error.message}`);process.exitCode=1;}
finally{globalThis.fetch=originalFetch;crypto.subtle.timingSafeEqual=originalEqual;await browser?.close();if(server){server.closeAllConnections();await new Promise(done=>server.close(done));}await fixture?.close();await rm(html,{force:true});await rm(dir,{recursive:true,force:true});}
