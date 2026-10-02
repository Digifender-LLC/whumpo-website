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
import {databaseFixture} from './helpers/current-database.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';
import {fixtureKeyring} from './helpers/connection-keyring.mjs';
const grantJourney=process.argv.includes('--github-grant');let providerCalls=0,modelCalls=0;
const require=createRequire(import.meta.url),{chromium}=require(process.env.WHUMPO_PLAYWRIGHT||'@playwright/test');
const dir=await mkdtemp('/tmp/whumpo-identity-browser-'),html=`frontend/identity-fixture-${process.pid}.html`,origin='http://localhost:8787';
let browser,server,fixture,page,phase='build';const originalFetch=globalThis.fetch,originalEqual=crypto.subtle.timingSafeEqual;
const requests=[],errors=[];let loseSecureReply=false;
try{
 await writeFile(html,'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Whumpo identity acceptance</title></head><body><div id="root"></div><script type="module" src="/@fs/'+resolve('frontend/src/main.tsx')+'"></script></body></html>');
 await viteBuild({build:{outDir:dir+'/web',rollupOptions:{input:resolve(html)}},logLevel:'error'});
 const bundled=await build({stdin:{contents:"export {default as worker} from './src/index';export {hashToken} from './src/security';export {admitWorkspace} from './src/workspace-identity/admission';export {resolveIdentity} from './src/workspace-identity/authority';export {sendConversation,readChat} from './src/chat';export {startGitHub,finishGitHub} from './src/github-connection';export {initializeConnectionKeys} from './src/connection-rotation';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
 const {worker,hashToken,admitWorkspace,resolveIdentity,sendConversation,readChat,startGitHub,finishGitHub,initializeConnectionKeys}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
 fixture=await databaseFixture({allowedArguments:['--github-grant']});const db=fixture.db;
 const code=crypto.randomUUID();await db.prepare("INSERT INTO invitations VALUES(?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 hour'),NULL,NULL)").bind(await hashToken(code)).run();
 crypto.subtle.timingSafeEqual=(a,b)=>timingSafeEqual(Buffer.from(a),Buffer.from(b));
 globalThis.fetch=async(url,...args)=>{if(grantJourney&&String(url)==='https://opencode.ai/zen/go/v1/responses'){modelCalls++;return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'Prepared.',action:{kind:'githubAccess',operation:'review'}})}]}],usage:{input_tokens:200,output_tokens:80}});}if(grantJourney&&String(url)==='https://api.github.com/applications/browser-grant/grant'){providerCalls++;return new Response(null,{status:204});}if(String(url)==='https://challenges.cloudflare.com/turnstile/v0/siteverify')return Response.json({success:true,hostname:'localhost',action:'register'});throw Error('Unexpected external request');};
 const env={DB:db,ENVIRONMENT:'local',TURNSTILE_SITE_KEY:'synthetic-public',TURNSTILE_SECRET:'synthetic-secret',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})}};
 const root=resolve(dir+'/web');
 server=createServer(async(req,res)=>{try{
  if(req.headers.host!=='localhost:8787'){res.writeHead(403).end();return;}
  const url=new URL(req.url,origin);requests.push({path:url.pathname,method:req.method});
  if(url.pathname.startsWith('/api/')){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const response=await worker.fetch(new Request(url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})}),env,{waitUntil:()=>{}});
   if(!response){res.writeHead(404).end();return;}
   if(loseSecureReply&&url.pathname.endsWith('/recovery/secure')&&response.status===200){loseSecureReply=false;res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end();return;}
   const headers=Object.fromEntries(response.headers);headers['set-cookie']=response.headers.getSetCookie();res.writeHead(response.status,headers).end(Buffer.from(await response.arrayBuffer()));return;
  }
  const name=url.pathname==='/'||url.pathname.startsWith('/workspace')?html.split('/').at(-1):decodeURIComponent(url.pathname).slice(1),path=resolve(root,name);
  if(!path.startsWith(root+sep)){res.writeHead(404).end();return;}
  const bytes=await readFile(path),ext=path.split('.').at(-1);res.writeHead(200,{'content-type':{html:'text/html',js:'text/javascript',css:'text/css',png:'image/png',svg:'image/svg+xml',woff2:'font/woff2'}[ext]??'application/octet-stream','cache-control':'no-store'}).end(bytes);
 }catch{res.writeHead(500).end('Fixture error');}});
 await new Promise((done,reject)=>{server.once('error',reject);server.listen(8787,'127.0.0.1',done)});
 phase='browser signup';
 browser=await chromium.launch({headless:true,...(process.env.WHUMPO_CHROMIUM?{executablePath:process.env.WHUMPO_CHROMIUM}:{})});
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,permissions:['clipboard-read','clipboard-write'],acceptDownloads:true});
 await context.addInitScript(()=>{
  window.turnstile={render:()=> 'synthetic',remove:()=>{},reset:()=>{},getResponse:()=> 'synthetic-turnstile'};
  const append=Element.prototype.append;Element.prototype.append=function(...nodes){const result=append.apply(this,nodes);for(const node of nodes)if(node instanceof HTMLIFrameElement&&node.title==='Recovery kit print view')node.contentWindow.print=()=>{window.__printedKit=node.contentDocument.body.textContent;node.contentWindow.dispatchEvent(new Event('afterprint'));};return result;};
 });
 page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 const cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');
 async function authenticator(){return (await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}})).authenticatorId}
 let auth=await authenticator();
 await page.goto(origin+'/workspace?signup=true');await page.getByLabel('Email',{exact:true}).fill('browser-identity@example.invalid');await page.getByLabel('Invitation code').fill(code);await page.getByRole('checkbox').check();await page.getByRole('button',{name:'Create my first passkey'}).click();
 await page.getByRole('heading',{name:'Make this account yours.'}).waitFor();assert.equal(await page.getByLabel('Your name',{exact:true}).count(),0);
 assert.equal((await context.cookies()).filter(c=>c.name.includes('whumpo_session')).length,0);
 assert.equal((await cdp.send('WebAuthn.getCredentials',{authenticatorId:auth})).credentials.length,1);
 await cdp.send('WebAuthn.removeVirtualAuthenticator',{authenticatorId:auth});auth=await authenticator();
 await page.getByLabel('Name your next passkey').fill('Backup provider');
 // Only the cancelled browser prompt is synthetic; successful registrations/assertions use Chromium's authenticator.
 await page.evaluate(()=>{const create=navigator.credentials.create.bind(navigator.credentials);navigator.credentials.create=async(...args)=>{navigator.credentials.create=create;throw new DOMException('Cancelled by fixture','NotAllowedError');};});
 await page.getByRole('button',{name:'Add a passkey',exact:true}).click();await page.getByRole('alert').filter({hasText:'The passkey step was not completed'}).waitFor();assert.equal((await db.prepare('SELECT count(*) n FROM identity_credentials').first()).n,1);
 await page.reload();await page.getByLabel('Name your next passkey').fill('Backup provider');await page.getByRole('button',{name:'Add a passkey',exact:true}).click();await page.getByText('Backup provider',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Prepare recovery kit',exact:true}).click();await page.getByRole('heading',{name:'Save your recovery kit'}).waitFor();
 const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Download',exact:true}).click();const download=await downloaded;assert.equal(download.suggestedFilename(),'whumpo-recovery-kit.txt');const kit=await readFile(await download.path(),'utf8'),key=kit.match(/Recovery key:\n([a-f0-9]{64})/)[1];
 await page.getByRole('button',{name:'Copy',exact:true}).click();assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),kit);
 await page.getByRole('button',{name:'Print / PDF',exact:true}).click();assert.equal(await page.evaluate(()=>window.__printedKit),kit);assert.equal(await page.locator('iframe').count(),0);
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));await page.getByRole('button',{name:'Copy',exact:true}).waitFor({state:'detached'});
 await page.getByRole('button',{name:'I’ve saved my recovery kit'}).click();await page.getByRole('heading',{name:'Your kit is saved'}).waitFor();
 assert(!(await page.locator('body').innerText()).includes(key));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert(requests.filter(r=>r.path.startsWith('/api/')).every(r=>r.path.startsWith('/api/auth/identity/v1/')));
 await page.reload();await page.getByRole('heading',{name:'Your kit is saved'}).waitFor();await page.getByRole('button',{name:'Verify a passkey and finish setup'}).click();await page.getByLabel('Your name',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);assert.equal(await page.evaluate(()=>document.cookie),'');
 const cookies=await context.cookies();assert.equal(cookies.filter(c=>c.name==='__Host-whumpo_session').length,1);assert(cookies.every(c=>c.secure&&c.httpOnly&&c.sameSite===(c.name==='__Host-whumpo_session'?'Lax':'Strict')));
 phase='first-project welcome';
 assert.equal(await page.getByRole('navigation',{name:'Workspace',exact:true}).count(),0);
 await page.getByLabel('Your name',{exact:true}).fill('Garden owner');await page.getByRole('button',{name:'Continue',exact:true}).click();
 await page.getByRole('button',{name:'Use this picture',exact:true}).click();await page.getByRole('button',{name:'Skip for now',exact:true}).click();
 await page.getByLabel('Your first idea',{exact:true}).fill('A website for my neighborhood landscaping business.');await page.getByRole('button',{name:'Continue',exact:true}).click();
 await page.getByLabel('Working name',{exact:true}).fill('Garden care');await page.getByRole('button',{name:'Continue',exact:true}).click();
 await page.getByRole('button',{name:'Skip for now',exact:true}).click();await page.getByRole('button',{name:'Use this starting feel',exact:true}).click();
 assert(!requests.some(r=>r.path==='/api/chat'||r.path==='/api/workspace/dashboard'));
 await page.getByRole('button',{name:'Start my project',exact:true}).click();await page.getByRole('textbox',{name:'Message Whumpo'}).waitFor();
 assert.equal((await db.prepare('SELECT count(*) n FROM projects').first()).n,1);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 // A saved draft survives an ordinary reload of the current session.
 await page.getByRole('textbox',{name:'Message Whumpo'}).fill('My unsent garden idea');await page.reload();await page.getByRole('textbox',{name:'Message Whumpo'}).waitFor();assert.equal(await page.getByRole('textbox',{name:'Message Whumpo'}).inputValue(),'My unsent garden idea');
 await page.waitForFunction(()=>!document.querySelector('button[aria-label="Send message"]')?.disabled);await page.waitForLoadState('networkidle');
 await page.waitForFunction(()=>[...document.images].every(image=>image.complete&&image.naturalWidth>0));
 await page.screenshot({path:'/tmp/whumpo-current-workspace-mobile.png',fullPage:true});
 if(grantJourney){
  phase='GitHub review in current mobile workspace';
  const key=fixtureKeyring(),config={clientId:'browser-grant',clientSecret:'SYNTHETIC_APP_SECRET',appId:1,slug:'fixture',key};
  Object.assign(env,{GITHUB_CLIENT_ID:config.clientId,GITHUB_CLIENT_SECRET:config.clientSecret,GITHUB_APP_ID:'1',GITHUB_APP_SLUG:'fixture',CONNECTION_ENCRYPTION_KEYRING:key});
  await initializeConnectionKeys(db,key,'browser-synthetic');
  const token=(await context.cookies()).find(c=>c.name==='__Host-whumpo_session').value,principal=await resolveIdentity(db,{version:1,client:'web',kind:'session',token}),scope=admitWorkspace(db,principal),user=principal.accountId;
  await paidPlan(db,user,'business');const start=await startGitHub(scope,user,config);
  await finishGitHub(scope,user,new URL(start.url).searchParams.get('state'),'synthetic-code',config,async url=>url.endsWith('/access_token')?Response.json({access_token:'ghu_BROWSER_ONLY',expires_in:3600,refresh_token:'ghr_BROWSER_ONLY',refresh_token_expires_in:15897600}):Response.json({id:123,login:'gardener'}));
  const prepare=async()=>{const request={id:crypto.randomUUID(),revision:(await readChat(scope,user)).state.revision,content:'Please review removing all GitHub app access.'};await sendConversation(scope,user,request,{baseURL:'https://opencode.ai/zen/go/v1',apiKey:'synthetic',model:'muse-spark-1.3-contributor',protocol:'responses'},{github:config});await page.reload();await page.getByRole('button',{name:'Revoke all GitHub app access',exact:true}).waitFor();return request.id;};
  const first=await prepare();assert.equal(providerCalls,0);
  const card=page.getByRole('region',{name:'GitHub access review'}).last();await card.scrollIntoViewIfNeeded();
  assert.match(await card.innerText(),/authorizations outside this workspace/);assert.doesNotMatch(await page.locator('body').innerText(),/ghu_BROWSER_ONLY|ghr_BROWSER_ONLY|SYNTHETIC_APP_SECRET/);
  const button=card.getByRole('button',{name:'Revoke all GitHub app access'});assert.ok((await button.boundingBox()).height>=44);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:'/tmp/whumpo-github-grant-mobile.png',fullPage:true});
  await page.evaluate(()=>{const get=navigator.credentials.get.bind(navigator.credentials);navigator.credentials.get=async(...args)=>{navigator.credentials.get=get;throw new DOMException('Cancelled','NotAllowedError');};});
  await button.click();await card.getByRole('alert').filter({hasText:'passkey step was not completed'}).waitFor();assert.equal(providerCalls,0);assert.equal((await db.prepare('SELECT state FROM github_grant_revocations WHERE id=?').bind(first).first()).state,'review');
  await card.getByRole('button',{name:'Cancel review',exact:true}).click();await card.getByText('This review made no request to GitHub.').waitFor();assert.equal(providerCalls,0);
  const second=await prepare();
  await page.goto(origin+'/workspace/connections');await page.getByRole('heading',{name:'Access removal reviews'}).waitFor();await page.getByRole('button',{name:'Revoke all GitHub app access',exact:true}).waitFor();assert.equal(modelCalls,2,'Opening saved reviews must not invoke the model');
  const beforeProof=requests.filter(r=>r.path.endsWith('/reauth/verify')).length;
  await page.getByRole('button',{name:'Revoke all GitHub app access',exact:true}).click();await page.getByRole('region',{name:'GitHub access review'}).filter({hasText:'Access removal confirmed'}).first().waitFor();
  assert.equal(providerCalls,1);assert.equal(modelCalls,2);assert.equal((await db.prepare('SELECT state FROM github_grant_revocations WHERE id=?').bind(second).first()).state,'revoked');assert.equal(requests.filter(r=>r.path.endsWith('/reauth/verify')).length,beforeProof+1);
  await page.reload();await page.getByRole('region',{name:'GitHub access review'}).filter({hasText:'Access removal confirmed'}).first().waitFor();assert.equal(await page.getByRole('button',{name:'Revoke all GitHub app access',exact:true}).count(),0);assert.equal(providerCalls,1);
  await page.setViewportSize({width:1280,height:900});await page.getByRole('region',{name:'GitHub access review'}).last().scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/whumpo-github-grant-desktop.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 }
 const savedTurns=(await db.prepare('SELECT count(*) n FROM chat_turns').first()).n;
 phase='live workspace revocation';
 await db.prepare('DELETE FROM identity_sessions').run();
 await page.getByRole('textbox',{name:'Message Whumpo'}).fill('Please make a gardening website.');await page.getByRole('button',{name:'Send message',exact:true}).click();
 await page.getByRole('button',{name:'Sign in with a passkey',exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:'Message Whumpo'}).count(),0);
 assert.equal((await db.prepare('SELECT count(*) n FROM chat_turns').first()).n,savedTurns,'Revoked request must not create a Chat turn');
 assert.equal(await page.evaluate(()=>document.cookie),'');
 assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
 assert.equal(errors.length,0,errors.join('\n'));
 if(grantJourney)console.log(JSON.stringify({suite:'github-grant-browser',modelCalls,providerCalls,realPasskeyConfirmation:true,liveProviderAccess:false}));
 console.log('Current workspace browser passed: real mobile entry, two Chromium passkeys, recovery kit, identity-before-profile gate, first-project welcome, draft reload and immediate workspace closure on session revocation. No live provider requests.');
}catch(error){console.error(`Current workspace browser failed during ${phase}: ${error.message}`);console.error('Browser errors:',errors);if(page)console.error('Page:',page.url(),(await page.locator('body').innerText().catch(()=>'' )).replace(/[a-f0-9]{64}/g,'[redacted]').slice(0,1500));console.error('API paths:',requests.filter(r=>r.path.startsWith('/api/')));process.exitCode=1;}
finally{globalThis.fetch=originalFetch;crypto.subtle.timingSafeEqual=originalEqual;await browser?.close();if(server){server.closeAllConnections();await new Promise(done=>server.close(done));}await fixture?.close();await rm(html,{force:true});await rm(dir,{recursive:true,force:true});}
