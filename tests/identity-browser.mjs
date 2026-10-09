import {keyboardJourney} from './helpers/keyboard-journey.mjs';
import {hearOrca} from './helpers/orca-output.mjs';
// Opt-in mobile browser acceptance with real signed WebAuthn and actual current HTTP/D1.
// Turnstile is synthetic. No remote bindings, active platform schema, inference or provider calls.
import assert from 'node:assert/strict';
import {timingSafeEqual} from 'node:crypto';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,sep} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {build as viteBuild} from 'vite';
import {identityDatabase} from './helpers/identity-database.mjs';
const require=createRequire(import.meta.url),{chromium}=require(process.env.WHUMPO_PLAYWRIGHT||'@playwright/test');
const dir=await mkdtemp((process.env.TMPDIR||'/tmp')+'/whumpo-identity-browser-'),html=`frontend/identity-fixture-${process.pid}.html`,origin='http://localhost:8787';
let browser,server,fixture,phase='build';const originalFetch=globalThis.fetch,originalEqual=crypto.subtle.timingSafeEqual;
const requests=[],errors=[];let loseSecureReply=false;
try{
 await writeFile(html,'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Whumpo identity acceptance</title></head><body><div id="root"></div><script type="module" src="/@fs/'+resolve('tests/fixtures/identity-browser.tsx')+'"></script></body></html>');
 await viteBuild({build:{outDir:dir+'/web',rollupOptions:{input:resolve(html)}},logLevel:'error'});
 const bundled=await build({stdin:{contents:"export * from './src/workspace-identity/http';export {hashToken} from './src/security';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
 const {handleIdentityRequest,hashToken}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
 fixture=await identityDatabase();const db=fixture.db;
 const code=crypto.randomUUID();await db.prepare("INSERT INTO invitations VALUES(?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 hour'),NULL,NULL)").bind(await hashToken(code)).run();
 crypto.subtle.timingSafeEqual=(a,b)=>timingSafeEqual(Buffer.from(a),Buffer.from(b));
 globalThis.fetch=async(url,...args)=>{if(String(url)==='https://challenges.cloudflare.com/turnstile/v0/siteverify')return Response.json({success:true,hostname:'localhost',action:'register'});throw Error('Unexpected external request');};
 const env={DB:db,ENVIRONMENT:'local',TURNSTILE_SITE_KEY:'synthetic-public',TURNSTILE_SECRET:'synthetic-secret',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})}};
 const root=resolve(dir+'/web');
 server=createServer(async(req,res)=>{try{
  if(req.headers.host!=='localhost:8787'){res.writeHead(403).end();return;}
  const url=new URL(req.url,origin);requests.push({path:url.pathname,method:req.method});
  if(url.pathname.startsWith('/api/')){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const response=await handleIdentityRequest(new Request(url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})}),env);
   if(!response){res.writeHead(404).end();return;}
   if(loseSecureReply&&url.pathname.endsWith('/recovery/secure')&&response.status===200){loseSecureReply=false;res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end();return;}
   const headers=Object.fromEntries(response.headers);headers['set-cookie']=response.headers.getSetCookie();res.writeHead(response.status,headers).end(Buffer.from(await response.arrayBuffer()));return;
  }
  const name=url.pathname==='/'||url.pathname.startsWith('/workspace')?html.split('/').at(-1):decodeURIComponent(url.pathname).slice(1),path=resolve(root,name);
  if(!path.startsWith(root+sep)){res.writeHead(404).end();return;}
  const bytes=await readFile(path),ext=path.split('.').at(-1);res.writeHead(200,{'content-type':{html:'text/html',js:'text/javascript',css:'text/css',png:'image/png',woff2:'font/woff2'}[ext]??'application/octet-stream','cache-control':'no-store'}).end(bytes);
 }catch{res.writeHead(500).end('Fixture error');}});
 await new Promise((done,reject)=>{server.once('error',reject);server.listen(8787,'127.0.0.1',done)});
 phase='browser signup';
 browser=await chromium.launch({headless:!process.env.WHUMPO_ORCA_LOG,...(process.env.WHUMPO_ORCA_LOG?{args:['--force-renderer-accessibility','--ozone-platform=x11']} : {}),...(process.env.WHUMPO_CHROMIUM?{executablePath:process.env.WHUMPO_CHROMIUM}:{})});
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,permissions:['clipboard-read','clipboard-write'],acceptDownloads:true});
 await context.addInitScript(()=>{
  window.turnstile={render:()=> 'synthetic',remove:()=>{},reset:()=>{},getResponse:()=> 'synthetic-turnstile'};
  const append=Element.prototype.append;Element.prototype.append=function(...nodes){const result=append.apply(this,nodes);for(const node of nodes)if(node instanceof HTMLIFrameElement&&node.title==='Recovery kit print view')node.contentWindow.print=()=>{window.__printedKit=node.contentDocument.body.textContent;node.contentWindow.dispatchEvent(new Event('afterprint'));};return result;};
 });
 const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 const {activate,enter}=keyboardJourney(page,!!process.env.WHUMPO_ORCA_LOG);
 const cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');
 async function authenticator(){return (await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}})).authenticatorId}
 let auth=await authenticator();
 await page.goto(origin+'/?signup=1');await enter(page.getByLabel('Email',{exact:true}),'browser-identity@example.invalid');await enter(page.getByLabel('Invitation code'),code);await activate(page.getByRole('checkbox'));await activate(page.getByRole('button',{name:'Create my first passkey'}));
 await page.getByRole('heading',{name:'Make this account yours.'}).waitFor();assert.equal(await page.getByRole('heading',{name:'Workspace admission reached'}).count(),0);
 assert.equal((await context.cookies()).filter(c=>c.name.includes('whumpo_session')).length,0);
 assert.equal((await cdp.send('WebAuthn.getCredentials',{authenticatorId:auth})).credentials.length,1);
 await cdp.send('WebAuthn.removeVirtualAuthenticator',{authenticatorId:auth});auth=await authenticator();
 await enter(page.getByLabel('Name your next passkey'),'Backup provider');
 // Only the cancelled browser prompt is synthetic; successful registrations/assertions use Chromium's authenticator.
 await page.evaluate(()=>{const create=navigator.credentials.create.bind(navigator.credentials);navigator.credentials.create=async(...args)=>{navigator.credentials.create=create;throw new DOMException('Cancelled by fixture','NotAllowedError');};});
 await activate(page.getByRole('button',{name:'Add a passkey',exact:true}));await page.getByRole('alert').filter({hasText:'The passkey step was not completed'}).waitFor();assert.equal((await db.prepare('SELECT count(*) n FROM identity_credentials').first()).n,1);
 await page.reload();await enter(page.getByLabel('Name your next passkey'),'Backup provider');await activate(page.getByRole('button',{name:'Add a passkey',exact:true}));await page.getByText('Backup provider',{exact:true}).waitFor();
 await activate(page.getByRole('button',{name:'Prepare recovery kit',exact:true}));await page.getByRole('heading',{name:'Save your recovery kit'}).waitFor();
 const downloaded=page.waitForEvent('download');await activate(page.getByRole('button',{name:'Download',exact:true}));const download=await downloaded;assert.equal(download.suggestedFilename(),'whumpo-recovery-kit.txt');const kit=await readFile(await download.path(),'utf8'),key=kit.match(/Recovery key:\n([a-f0-9]{64})/)[1];
 await activate(page.getByRole('button',{name:'Copy',exact:true}));assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),kit);
 await activate(page.getByRole('button',{name:'Print / PDF',exact:true}));assert.equal(await page.evaluate(()=>window.__printedKit),kit);assert.equal(await page.locator('iframe').count(),0);
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));await page.getByRole('button',{name:'Copy',exact:true}).waitFor({state:'detached'});
 await activate(page.getByRole('button',{name:'I’ve saved my recovery kit'}));await page.getByRole('heading',{name:'Your kit is saved'}).waitFor();
 assert(!(await page.locator('body').innerText()).includes(key));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:dir+'/mobile-enrollment.png',fullPage:true});
 await page.reload();await page.getByRole('heading',{name:'Your kit is saved'}).waitFor();await activate(page.getByRole('button',{name:'Verify a passkey and finish setup'}));await page.getByRole('heading',{name:'Workspace admission reached'}).waitFor();
 assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);assert.equal(await page.evaluate(()=>document.cookie),'');
 const cookies=await context.cookies();assert.equal(cookies.filter(c=>c.name==='__Host-whumpo_session').length,1);assert(cookies.every(c=>c.secure&&c.httpOnly&&c.sameSite===(c.name==='__Host-whumpo_session'?'Lax':'Strict')));
 phase='lost-reply recovery';
 await activate(page.getByRole('button',{name:'Sign out',exact:true}));await activate(page.getByRole('button',{name:'Use my recovery kit'}));await enter(page.getByLabel('Email',{exact:true}),'browser-identity@example.invalid');await enter(page.getByLabel('Recovery key',{exact:true}),key);await hearOrca('enter restricted account recovery',()=>activate(page.getByRole('button',{name:'Start account recovery'})),[/Recover your account/i,/heading/i]);
 await activate(page.getByRole('radio',{name:'Some passkeys'}));await activate(page.getByRole('checkbox',{name:'First passkey'}));await hearOrca('review exact lost passkeys',()=>activate(page.getByRole('button',{name:'Review these passkeys'})),[/Review before securing/i,/heading/i]);await activate(page.getByRole('button',{name:'Prepare recovery kit',exact:true}));await page.getByRole('heading',{name:'Save your recovery kit'}).waitFor();
 const newDownload=page.waitForEvent('download');await activate(page.getByRole('button',{name:'Download',exact:true}));const replacement=await readFile(await (await newDownload).path(),'utf8'),newKey=replacement.match(/Recovery key:\n([a-f0-9]{64})/)[1];await activate(page.getByRole('button',{name:'I’ve saved my recovery kit'}));
 await hearOrca('open secure recovery confirmation',()=>activate(page.getByRole('button',{name:'Secure my account',exact:true})),[/Secure your account now/i,/heading/i]);loseSecureReply=true;await hearOrca('lost secure response remains uncertain',()=>activate(page.getByRole('button',{name:'Confirm and secure'})),[/could not confirm the result/i]);await page.getByRole('alert').filter({hasText:'could not confirm the result'}).waitFor();
 assert.equal(await page.getByRole('heading',{name:'Workspace admission reached'}).count(),0);
 const secureCalls=requests.filter(r=>r.path.endsWith('/recovery/secure')).length;await activate(page.getByRole('button',{name:'Confirm and secure'}));await page.getByRole('alert').filter({hasText:'Check saved progress before continuing'}).waitFor();assert.equal(requests.filter(r=>r.path.endsWith('/recovery/secure')).length,secureCalls);
 await context.clearCookies();await page.goto(origin+'/');await activate(page.getByRole('button',{name:'Use my recovery kit'}));await enter(page.getByLabel('Email',{exact:true}),'browser-identity@example.invalid');await enter(page.getByLabel('Recovery key',{exact:true}),newKey);await activate(page.getByRole('button',{name:'Start account recovery'}));await page.getByRole('heading',{name:'Saved recovery review'}).waitFor();
 assert.equal(await page.getByText('First passkey',{exact:true}).count(),0);assert.equal(await page.getByText('Backup provider',{exact:true}).count(),1);assert.equal(await page.getByRole('button',{name:'Verify a replacement and finish recovery'}).count(),0);
 await cdp.send('WebAuthn.removeVirtualAuthenticator',{authenticatorId:auth});auth=await authenticator();
 await enter(page.getByLabel('Name your next passkey'),'Replacement phone');await activate(page.getByRole('button',{name:'Add a passkey',exact:true}));await page.getByRole('button',{name:'Verify a replacement and finish recovery'}).waitFor();
 await page.screenshot({path:dir+'/mobile-recovery.png',fullPage:true});await activate(page.getByRole('button',{name:'Verify a replacement and finish recovery'}));await page.getByRole('heading',{name:'Workspace admission reached'}).waitFor();
 phase='removal and stale passkey';
 await activate(page.getByRole('listitem').filter({hasText:'Backup provider'}).getByRole('button',{name:'Remove',exact:true}));await activate(page.getByRole('button',{name:'Verify and remove'}));await page.getByRole('button',{name:'Sign in with a passkey',exact:true}).waitFor();
 await activate(page.getByRole('button',{name:'Sign in with a passkey',exact:true}));await page.getByRole('heading',{name:'Workspace admission reached'}).waitFor();
 assert.equal(await page.getByText('Backup provider',{exact:true}).count(),0);assert.equal(await page.getByText('Replacement phone',{exact:true}).count(),1);
 await page.setViewportSize({width:1280,height:900});await page.screenshot({path:dir+'/desktop-security.png',fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
 assert.equal((await db.prepare("SELECT count(*) n FROM identity_credentials WHERE name='First passkey'").first()).n,0);
 assert.equal(errors.length,0,errors.join('\n'));assert(requests.filter(r=>r.path.startsWith('/api/')).every(r=>r.path.startsWith('/api/auth/identity/v1/')));
 console.log(`Identity browser passed: mobile signup, two real passkeys, kit download/copy/print, reload/resume, lost secure reply, partial recovery, replacement proof, removal, private cookies and no persistent browser data (${process.argv.includes('--d1')?'local D1':'SQLite'}).`);
 // Synthetic-only visual artifacts are kept for human inspection; downloaded kits and profile are deleted.
 for(const file of ['mobile-enrollment.png','mobile-recovery.png','desktop-security.png'])await writeFile('/tmp/whumpo-identity-'+file,await readFile(dir+'/'+file));
}catch(error){console.error(`Identity browser failed during ${phase}: ${error.message}`);process.exitCode=1;}
finally{globalThis.fetch=originalFetch;crypto.subtle.timingSafeEqual=originalEqual;await browser?.close();if(server){server.closeAllConnections();await new Promise(done=>server.close(done));}await fixture?.close();await rm(html,{force:true});await rm(dir,{recursive:true,force:true});}
