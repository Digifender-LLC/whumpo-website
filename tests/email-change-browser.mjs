import {keyboardJourney} from './helpers/keyboard-journey.mjs';
// WH-204 local synthetic acceptance only: Settings email change and the compromise review in a real browser (keyboard only) at 360, 390 and 1280px,
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
const dir=await mkdtemp((process.env.TMPDIR||'/tmp')+'/whumpo-email-change-browser-'),html=`frontend/email-change-fixture-${process.pid}.html`,origin='http://localhost:8787';
let browser,server,fixture,phase='build';const originalFetch=globalThis.fetch,originalEqual=crypto.subtle.timingSafeEqual;
const errors=[],sent=[];let network=0;
try{
 await writeFile(html,'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Whumpo email change acceptance</title></head><body><div id="root"></div><script type="module" src="/@fs/'+resolve('frontend/src/main.tsx')+'"></script></body></html>');
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
 const owner='email-change-owner@example.test',addr=name=>`${name}-${crypto.randomUUID().slice(0,8)}@example.test`;
 // Every size the owner may use: no horizontal scroll, 44px controls on phones, and the same at 200% text.
 async function fit(label){
  for(const [width,large] of [[360,false],[390,false],[1280,false],[360,true]]){
   await page.setViewportSize({width,height:844});await page.evaluate(large=>{document.documentElement.style.fontSize=large?'200%':'';},large);
   await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
   const over=await page.evaluate(()=>[...document.querySelectorAll('#workspace-content,#workspace-content *')].filter(e=>e.getBoundingClientRect().right>innerWidth+.5&&!e.closest('[aria-hidden=true]')).slice(0,4).map(e=>e.tagName+'.'+String(e.className).slice(0,30)+' '+e.textContent.slice(0,40)+' '+getComputedStyle(e).whiteSpace+' l'+Math.round(e.getBoundingClientRect().left)+' p'+Math.round(e.parentElement.getBoundingClientRect().right)+' '+Math.round(e.getBoundingClientRect().right)).concat(document.documentElement.scrollWidth>innerWidth?['document '+document.documentElement.scrollWidth]:[]));
   assert.deepEqual(over,[],`${label}: horizontal overflow at ${width}${large?' large text':''}`);
   if(width<=760){const short=await page.evaluate(()=>[...document.querySelectorAll('main button,main summary,main input:not([type=checkbox])')].filter(e=>e.getBoundingClientRect().height&&e.getBoundingClientRect().height<43.5).map(e=>e.textContent.trim()||e.name));assert.deepEqual(short,[],`${label}: controls under 44px at ${width}`);}
  }
  await page.screenshot({path:`/tmp/whumpo-email-change-${label}.png`,fullPage:true});
  await page.evaluate(()=>{document.documentElement.style.fontSize='';});await page.setViewportSize({width:390,height:844});
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

 phase='settings email change';
 await page.goto(origin+'/workspace/settings');
 await page.getByText('Current address:').waitFor();assert.match(await page.getByText('Current address:').innerText(),new RegExp(owner));
 await page.getByText('Not verified yet').waitFor();
 const newAddress=page.getByLabel('New email address');
 const mail=to=>sent.filter(s=>s.to===to),tokenOf=to=>mail(to).at(-1).text.match(/code is ([A-Za-z0-9_-]{43})\n/)[1];
 const request=async to=>{await enter(newAddress,to);await activate(page.getByRole('button',{name:'Send confirmation'}));await page.locator('#workspace-content').getByText(/Confirmation sent\./).waitFor();await drain();await page.getByLabel('Confirmation code from the email').waitFor();};
 const first=addr('first');await request(first);
 assert.equal(mail(first).length,1,'one confirmation reached the new address through the outbox');
 assert.ok(!mail(owner).some(s=>/code is [A-Za-z0-9_-]{43}/.test(s.text)),'the old address never receives the token');
 assert.equal((await one("SELECT email FROM users WHERE id=?",account)).email,owner,'nothing changes before confirmation');
 await fit('settings-pending');
 // A wrong code is refused and changes nothing.
 await enter(page.getByLabel('Confirmation code from the email'),'x'.repeat(43));await activate(page.getByRole('button',{name:'Confirm',exact:true}));
 await page.locator('#workspace-content').getByRole('status').filter({hasText:/.+/}).last().waitFor();assert.doesNotMatch(await page.locator('#workspace-content').getByRole('status').last().innerText(),/Your email is now/);
 assert.equal((await one("SELECT email FROM users WHERE id=?",account)).email,owner);
 await enter(page.getByLabel('Confirmation code from the email'),tokenOf(first));await activate(page.getByRole('button',{name:'Confirm',exact:true}));
 await page.locator('#workspace-content').getByText('Your email is now '+first+'.').waitFor();await page.getByText('Verified',{exact:true}).waitFor();
 assert.equal((await one("SELECT email FROM users WHERE id=?",account)).email,first);
 await page.getByRole('button',{name:'Undo email change'}).waitFor();await fit('settings-undo');
 await activate(page.getByRole('button',{name:'Undo email change'}));await page.locator('#workspace-content').getByText('Your email is back to '+owner+'.').waitFor();await page.getByText('Not verified yet').waitFor();
 assert.equal((await one("SELECT email FROM users WHERE id=?",account)).email,owner);
 // Confirm again, then leave a second change waiting so the review has something to cancel.
 const second=addr('second');await request(second);await enter(page.getByLabel('Confirmation code from the email'),tokenOf(second));await activate(page.getByRole('button',{name:'Confirm',exact:true}));
 await page.locator('#workspace-content').getByText('Your email is now '+second+'.').waitFor();
 const third=addr('third');await request(third);
 assert.equal((await one("SELECT count(*) n FROM owner_email_changes WHERE account_id=? AND state='pending'",account)).n,1);

 phase='security review and emergency zero-key revocation';
 const reviewHead=name=>page.getByRole('heading',{name,exact:true});
 await activate(page.getByRole('button',{name:'Secure my account',exact:true}));await reviewHead('Choose what to keep').waitFor();
 assert.match(await page.locator('body').innerText(),/An email change is waiting for confirmation\. It will be cancelled\./);
 const boxes=page.getByRole('checkbox',{name:/Remove Passkey/});assert.equal(await boxes.count(),2);
 await activate(boxes.nth(0));await activate(boxes.nth(1));await page.getByRole('alert').filter({hasText:'every passkey'}).waitFor();await fit('review-select');
 await activate(page.getByRole('button',{name:'Continue',exact:true}));await reviewHead('Replace your recovery kit').waitFor();
 await activate(page.getByRole('button',{name:'Create new recovery kit'}));
 downloaded=page.waitForEvent('download');await activate(page.getByRole('button',{name:'Download',exact:true}));
 const newKey=(await readFile(await (await downloaded).path(),'utf8')).match(/Recovery key:\n([a-f0-9]{64})/)[1];assert.notEqual(newKey,oldKey);
 await activate(page.getByRole('button',{name:'I have saved my new recovery kit'}));await page.getByText('Saved. Continue when you are ready.').waitFor();await fit('review-kit');
 await activate(page.getByRole('button',{name:'Continue',exact:true}));await reviewHead('Confirm').waitFor();
 await activate(page.getByRole('checkbox',{name:/I understand this cannot be undone/}));await fit('review-confirm');
 await activate(page.getByRole('button',{name:'Secure my account now'}));await reviewHead('Your account is secured').waitFor();
 const doneText=await page.locator('body').innerText();
 assert.match(doneText,/signed out everywhere/);assert.match(doneText,/Passkeys removed: 2\./);assert.match(doneText,/old kit no longer works/);assert.match(doneText,/waiting email change was cancelled/);assert.match(doneText,/No passkey remains\. Use your saved recovery kit/);
 await fit('review-done');
 // Database truth, and the old session is dead.
 assert.equal((await one("SELECT count(*) n FROM identity_credentials WHERE account_id=? AND status='active'",account)).n,0);
 assert.equal((await one("SELECT state FROM owner_email_changes WHERE new_address=?",third)).state,'cancelled');
 assert.equal((await one("SELECT email FROM users WHERE id=?",account)).email,second,'the confirmed address is untouched by the review');
 assert.ok((await page.request.get(origin+'/api/account/email')).status()>=400,'the pre-review session cannot reach account controls');
 // The confirmed address is told, with no recovery key; nothing but the simulated provider carried mail.
 await drain();
 assert.ok(mail(second).length>=1,'a security notice reached the confirmed address');
 for(const message of sent){assert.ok(message.to.endsWith('@example.test'));assert.doesNotMatch(message.text+(message.html??''),new RegExp(oldKey+'|'+newKey));}
 assert.equal(network,0);
 await activate(page.getByRole('button',{name:'Continue to sign-in'}));await page.getByRole('button',{name:'Use my recovery kit'}).waitFor();
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.equal(errors.length,0,errors.join('\n'));
 console.log(`Email change browser passed (local synthetic acceptance only, ${process.argv.includes('--d1')?'actual local D1':'SQLite'}): Settings change, wrong-code refusal, confirm, undo, reconfirm, pending change cancelled by the review, emergency zero-key revocation with a new kit, dead session, keyboard only at 360/390/1280 and 200% text. Screen-reader (Orca) paths not run.`);
}catch(error){console.error(`Email change browser failed during ${phase}: ${error.message}`);process.exitCode=1;}
finally{globalThis.fetch=originalFetch;crypto.subtle.timingSafeEqual=originalEqual;await browser?.close();if(server){server.closeAllConnections();await new Promise(done=>server.close(done));}await fixture?.close();await rm(html,{force:true});await rm(dir,{recursive:true,force:true});}
