import {siteSafetyJourney} from './helpers/site-safety-journey.mjs';
import {savedWorkJourney} from './helpers/saved-work-journey.mjs';
import {crossTabIdentityJourney} from './helpers/cross-tab-identity-journey.mjs';
import {accountHelpJourney} from './helpers/account-help-journey.mjs';
import {accessibilityAudit} from './helpers/accessibility-audit.mjs';
import {ownerUsabilityJourney} from './helpers/owner-usability-journey.mjs';
import {keyboardJourney} from './helpers/keyboard-journey.mjs';
import {hearOrca} from './helpers/orca-output.mjs';
// Opt-in mobile browser acceptance with real signed WebAuthn and actual current HTTP/D1.
// Turnstile is synthetic. No remote bindings or external inference/provider calls; isolated current schema only.
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
const accessibility=process.argv.includes('--accessibility'),accountHelp=process.argv.includes('--account-help'),a11y=accessibilityAudit();
const siteSafety=process.argv.includes('--site-safety'),savedWork=process.argv.includes('--saved-work');
const grantJourney=process.argv.includes('--github-grant'),crossTab=process.argv.includes('--cross-tab');
if([accessibility,grantJourney,crossTab,accountHelp,siteSafety,savedWork].filter(Boolean).length>1)throw Error('Run the owner accessibility and GitHub grant journeys separately.');
let providerCalls=0,modelCalls=0;
const require=createRequire(import.meta.url),{chromium}=require(process.env.WHUMPO_PLAYWRIGHT||'@playwright/test');
const dir=await mkdtemp('/tmp/whumpo-identity-browser-'),html=`frontend/identity-fixture-${process.pid}.html`,origin='http://localhost:8787';
let browser,server,fixture,page,phase='build';const originalFetch=globalThis.fetch,originalEqual=crypto.subtle.timingSafeEqual;
const audit={steps:[],calls:0,posts:[],failChat:false,failDashboard:false,loseChat:false,stopChat:false,holdDashboard:false,releaseDashboard:null},background=[];
const requests=[],errors=[];let loseSecureReply=false,holdAddReply=false,releaseAddReply=null,holdWelcomeReply=false,releaseWelcomeReply=null;
try{
 await writeFile(html,'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Whumpo identity acceptance</title></head><body><div id="root"></div><script type="module" src="/@fs/'+resolve('frontend/src/main.tsx')+'"></script>'+(crossTab?'<script type="module">import {queryClient} from "/@fs/'+resolve('frontend/src/lib/api.ts')+'";import {identityCeremony} from "/@fs/'+resolve('frontend/src/lib/identity.ts')+'";window.identityFixtureQueryKeys=()=>queryClient.getQueryCache().getAll().map(q=>q.queryKey);window.identityFixtureLogin=()=>identityCeremony("login");</script>':'')+'</body></html>');
 await viteBuild({build:{outDir:dir+'/web',rollupOptions:{input:resolve(html)}},logLevel:'error'});
 const bundled=await build({stdin:{contents:"export {saveBackend,testBackend} from './src/backend-versions';export {prepareBackendPublication,confirmBackendPublication} from './src/backend-publication';export {prepareApplication,confirmApplication} from './src/app-activation';export {prepareAppPage,confirmAppPage} from './src/app-pages';export {createWebsite} from './src/project-specification/store';export {publicationCommand} from './src/publications';export {default as worker} from './src/index';export {hashToken} from './src/security';export {admitWorkspace} from './src/workspace-identity/admission';export {resolveIdentity} from './src/workspace-identity/authority';export {sendConversation,readChat} from './src/chat';export {startGitHub,finishGitHub} from './src/github-connection';export {initializeConnectionKeys} from './src/connection-rotation';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
 const {saveBackend,testBackend,prepareBackendPublication,confirmBackendPublication,prepareApplication,confirmApplication,prepareAppPage,confirmAppPage,createWebsite,publicationCommand,worker,hashToken,admitWorkspace,resolveIdentity,sendConversation,readChat,startGitHub,finishGitHub,initializeConnectionKeys}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
 fixture=await databaseFixture({allowedArguments:['--github-grant','--accessibility','--account-help','--cross-tab','--site-safety','--saved-work']});const db=fixture.db;
 const code=crypto.randomUUID();await db.prepare("INSERT INTO invitations VALUES(?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 hour'),NULL,NULL)").bind(await hashToken(code)).run();
 crypto.subtle.timingSafeEqual=(a,b)=>timingSafeEqual(Buffer.from(a),Buffer.from(b));
 globalThis.fetch=async(url,...args)=>{if(accessibility&&String(url)==='https://opencode.ai/zen/go/v1/responses'){const body=JSON.parse(args[0].body),ack=body.max_output_tokens===256;if(!ack){audit.calls++;assert(audit.steps.length,'Unexpected inference request');}return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(ack?{intent:'editing'}:{reply:'Scripted owner request prepared.',action:audit.steps.shift()})}]}],usage:{input_tokens:100,output_tokens:100}});}if(grantJourney&&String(url)==='https://opencode.ai/zen/go/v1/responses'){modelCalls++;return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'Prepared.',action:{kind:'githubAccess',operation:'review'}})}]}],usage:{input_tokens:200,output_tokens:80}});}if(grantJourney&&String(url)==='https://api.github.com/applications/browser-grant/grant'){providerCalls++;return new Response(null,{status:204});}if(String(url)==='https://challenges.cloudflare.com/turnstile/v0/siteverify')return Response.json({success:true,hostname:'localhost',action:'register'});throw Error('Unexpected external request');};
 const env={DB:db,ENVIRONMENT:'local',TURNSTILE_SITE_KEY:'synthetic-public',TURNSTILE_SECRET:'synthetic-secret',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})}};
 const root=resolve(dir+'/web');
 server=createServer(async(req,res)=>{try{
  if(req.headers.host!=='localhost:8787'){res.writeHead(403).end();return;}
  const url=new URL(req.url,origin);requests.push({path:url.pathname,method:req.method});
  if(url.pathname.startsWith('/api/')){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const body=Buffer.concat(chunks);
   if(req.method==='POST'&&url.pathname==='/api/chat'){audit.posts.push(JSON.parse(body));if(audit.stopChat){audit.stopChat=false;audit.failChat=true;res.writeHead(503,{'content-type':'application/json'}).end(JSON.stringify({error:'Synthetic send interruption'}));return;}}
   if(req.method==='GET'&&(audit.failChat&&url.pathname==='/api/chat'||audit.failDashboard&&url.pathname==='/api/workspace/dashboard'||audit.failProfile&&url.pathname==='/api/profile'||audit.failWelcome&&url.pathname==='/api/onboarding')){res.writeHead(503,{'content-type':'application/json'}).end(JSON.stringify({error:'Synthetic read interruption'}));return;}
   const identity=url.pathname.startsWith('/api/auth/identity/v1/'),canonical=env.ENVIRONMENT==='test'&&!identity;
   const target=canonical?new URL(url.pathname+url.search,'https://whumpo.com'):url;
   const requestHeaders=canonical?{...req.headers,host:'whumpo.com',...(req.headers.origin?{origin:'https://whumpo.com'}:{})}:req.headers;
   const response=await worker.fetch(new Request(target,{method:req.method,headers:requestHeaders,...(['GET','HEAD'].includes(req.method)?{}:{body})}),identity?{...env,ENVIRONMENT:'local'}:env,{waitUntil:p=>background.push(p)});
   if(req.method==='POST'&&response.status===200&&/^\/api\/workspace\/(site|service)-safety\/reviews/.test(url.pathname)&&(audit.loseSafetyPrepare&&!url.pathname.endsWith('/confirm')||audit.loseSafetyConfirm&&url.pathname.endsWith('/confirm'))){audit.loseSafetyPrepare=false;audit.loseSafetyConfirm=false;res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end();return;}
   if(audit.loseChat&&url.pathname==='/api/chat'&&req.method==='POST'&&response.status===200){audit.loseChat=false;audit.failChat=true;res.writeHead(200,{'content-type':'application/json'}).end();return;}
   if(audit.holdDashboard&&url.pathname==='/api/workspace/dashboard'&&response.status===200){audit.holdDashboard=false;await new Promise(done=>{audit.releaseDashboard=done;});}
   if(!response){res.writeHead(404).end();return;}
   if(audit.holdProfile&&url.pathname==='/api/profile'&&req.method==='GET'&&response.status===200){audit.holdProfile=false;await new Promise(done=>{audit.releaseProfile=done;});}
   if(audit.holdReauth&&url.pathname.endsWith('/reauth/verify')&&response.status===200){audit.holdReauth=false;await new Promise(done=>{audit.releaseReauth=done;});}
   if(holdWelcomeReply&&url.pathname==='/api/onboarding'&&req.method==='PUT'&&response.status===200){holdWelcomeReply=false;await new Promise(done=>{releaseWelcomeReply=done;});}
   if(holdAddReply&&url.pathname.endsWith('/add/verify')&&response.status===200){holdAddReply=false;await new Promise(done=>{releaseAddReply=done;});}
   if(loseSecureReply&&url.pathname.endsWith('/recovery/secure')&&response.status===200){loseSecureReply=false;res.writeHead(200,{'content-type':'application/json','cache-control':'no-store'}).end();return;}
   const headers=Object.fromEntries(response.headers);headers['set-cookie']=response.headers.getSetCookie();res.writeHead(response.status,headers).end(Buffer.from(await response.arrayBuffer()));return;
  }
  const name=url.pathname==='/'||url.pathname.startsWith('/workspace')?html.split('/').at(-1):decodeURIComponent(url.pathname).slice(1),path=resolve(root,name);
  if(!path.startsWith(root+sep)){res.writeHead(404).end();return;}
  const bytes=await readFile(path),ext=path.split('.').at(-1);res.writeHead(200,{'content-type':{html:'text/html',js:'text/javascript',css:'text/css',png:'image/png',svg:'image/svg+xml',woff2:'font/woff2'}[ext]??'application/octet-stream','cache-control':'no-store'}).end(bytes);
 }catch{res.writeHead(500).end('Fixture error');}});
 await new Promise((done,reject)=>{server.once('error',reject);server.listen(8787,'127.0.0.1',done)});
 phase='browser signup';
 browser=await chromium.launch({headless:!process.env.WHUMPO_ORCA_LOG,...(process.env.WHUMPO_ORCA_LOG?{args:['--force-renderer-accessibility','--ozone-platform=x11']} : {}),...(process.env.WHUMPO_CHROMIUM?{executablePath:process.env.WHUMPO_CHROMIUM}:{})});
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2,isMobile:true,hasTouch:true,permissions:['clipboard-read','clipboard-write'],acceptDownloads:true});
 await context.addInitScript(()=>{
  window.turnstile={render:()=> 'synthetic',remove:()=>{},reset:()=>{},getResponse:()=> 'synthetic-turnstile'};
  const append=Element.prototype.append;Element.prototype.append=function(...nodes){const result=append.apply(this,nodes);for(const node of nodes)if(node instanceof HTMLIFrameElement&&node.title==='Recovery kit print view')node.contentWindow.print=()=>{window.__printedKit=node.contentDocument.body.textContent;node.contentWindow.dispatchEvent(new Event('afterprint'));};return result;};
 });
 page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
 const {reach,activate,enter}=keyboardJourney(page,accessibility||accountHelp||crossTab||siteSafety||savedWork);
 async function focusHeading(text){if(accessibility||crossTab){await page.getByRole('heading',{name:text,exact:true}).waitFor();await page.waitForFunction(t=>document.activeElement?.textContent===t,text);}}
 const cdp=await context.newCDPSession(page);await cdp.send('WebAuthn.enable');
 async function authenticator(){return (await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}})).authenticatorId}
 let auth=await authenticator();
 if(accessibility){
  phase='landing keyboard entry';
  await page.route('**/stripe-pricing.json',route=>route.fulfill({json:{}}));
  await page.goto(origin+'/');await page.getByText('Plans are coming soon',{exact:true}).waitFor();
  const observations={mainLandmarks:await page.getByRole('main').count(),skipLinks:await page.getByRole('link',{name:'Skip to content',exact:true}).count(),cmsCopy:await page.getByText('A place for your words',{exact:true}).locator('..').innerText(),smallAccent:await page.locator('#how p').first().evaluate(e=>({text:e.textContent,color:getComputedStyle(e).color,fontSize:getComputedStyle(e).fontSize,background:getComputedStyle(e.closest('.landing')).backgroundColor}))};
  for(const width of [360,390,1280]){await page.setViewportSize({width,height:844});await page.screenshot({path:'/tmp/whumpo-landing-audit-'+width+'.png',fullPage:true});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));}
  await writeFile('.secrets/usability-landing-observations.json',JSON.stringify(observations,null,2));
  assert.equal(observations.mainLandmarks,1);assert.equal(observations.skipLinks,1);assert.match(observations.cmsCopy,/not available in this preview/);
  const luminance=rgb=>rgb.match(/\d+/g).slice(0,3).map(Number).map(n=>n/255).map(n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4).reduce((v,n,i)=>v+n*[.2126,.7152,.0722][i],0);
  const ratio=(luminance(observations.smallAccent.background)+.05)/(luminance(observations.smallAccent.color)+.05);assert(ratio>=4.5,'Small landing text contrast '+ratio);
  await a11y.check(page,'landing-unavailable-pricing');
  await activate(page.getByRole('link',{name:'Skip to content',exact:true}));assert(await page.getByRole('main').evaluate(e=>e===document.activeElement));

  await page.setViewportSize({width:390,height:844});
  await hearOrca('landing enters invited signup',()=>activate(page.getByRole('link',{name:'Meet Whumpo',exact:true})),[/A little hello/i,/heading/i]);
 }else await page.goto(origin+'/workspace?signup=true');await a11y.check(page,'invited-signup');await enter(page.getByLabel('Email',{exact:true}),'browser-identity@example.invalid');await enter(page.getByLabel('Invitation code'),code);await activate(page.getByRole('checkbox'));await hearOrca('first passkey enters saved setup',()=>activate(page.getByRole('button',{name:'Create my first passkey'})),[/Make this account yours/i,/heading/i]);
 await page.getByRole('heading',{name:'Make this account yours.'}).waitFor();assert.equal(await page.getByLabel('Your name',{exact:true}).count(),0);
 await focusHeading('Make this account yours.');
 assert.equal((await context.cookies()).filter(c=>c.name.includes('whumpo_session')).length,0);
 assert.equal((await cdp.send('WebAuthn.getCredentials',{authenticatorId:auth})).credentials.length,1);
 await cdp.send('WebAuthn.removeVirtualAuthenticator',{authenticatorId:auth});auth=await authenticator();
 await enter(page.getByLabel('Name your next passkey'),'Backup provider');
 // Only the cancelled browser prompt is synthetic; successful registrations/assertions use Chromium's authenticator.
 await page.evaluate(()=>{const create=navigator.credentials.create.bind(navigator.credentials);navigator.credentials.create=async(...args)=>{navigator.credentials.create=create;throw new DOMException('Cancelled by fixture','NotAllowedError');};});
 await hearOrca('cancelled second passkey preserves progress',()=>activate(page.getByRole('button',{name:'Add a passkey',exact:true})),[/passkey step was not completed/i,/saved progress is unchanged/i]);await page.getByRole('alert').filter({hasText:'The passkey step was not completed'}).waitFor();assert.equal((await db.prepare('SELECT count(*) n FROM identity_credentials').first()).n,1);
 await page.reload();await enter(page.getByLabel('Name your next passkey'),'Backup provider');
 if(accessibility){
  holdAddReply=true;await activate(page.getByRole('button',{name:'Add a passkey',exact:true}));
  for(let n=0;!releaseAddReply&&n<300;n++)await new Promise(done=>setTimeout(done,20));assert(releaseAddReply);
  const help=page.locator('summary').filter({hasText:'Passkeys and recovery help'});await activate(help);assert.match(await page.locator('details[open]').innerText(),/No hardware purchase is required/);assert.match(await page.locator('details[open]').innerText(),/sign in with a saved passkey to resume/);
  releaseAddReply();releaseAddReply=null;await page.getByText('Backup provider',{exact:true}).waitFor();await page.waitForLoadState('networkidle');assert(await help.evaluate(e=>e===document.activeElement),'Late saved key must not steal newer focus');
 }else await activate(page.getByRole('button',{name:'Add a passkey',exact:true}));
 await page.getByText('Backup provider',{exact:true}).waitFor();
 await hearOrca('prepared recovery kit heading',()=>activate(page.getByRole('button',{name:'Prepare recovery kit',exact:true})),[/Save your recovery kit/i,/heading/i]);await focusHeading('Save your recovery kit');await page.getByRole('heading',{name:'Save your recovery kit'}).waitFor();
 const downloaded=page.waitForEvent('download');await activate(page.getByRole('button',{name:'Download',exact:true}));const download=await downloaded;assert.equal(download.suggestedFilename(),'whumpo-recovery-kit.txt');const kit=await readFile(await download.path(),'utf8'),key=kit.match(/Recovery key:\n([a-f0-9]{64})/)[1];
 await activate(page.getByRole('button',{name:'Copy',exact:true}));assert.equal(await page.evaluate(()=>navigator.clipboard.readText()),kit);
 await activate(page.getByRole('button',{name:'Print / PDF',exact:true}));assert.equal(await page.evaluate(()=>window.__printedKit),kit);assert.equal(await page.locator('iframe').count(),0);
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})));await page.getByRole('button',{name:'Copy',exact:true}).waitFor({state:'detached'});
 await hearOrca('saved kit heading',()=>activate(page.getByRole('button',{name:'I’ve saved my recovery kit'})),[/Your kit is saved/i,/heading/i]);await focusHeading('Your kit is saved');await page.getByRole('heading',{name:'Your kit is saved'}).waitFor();
 assert(!(await page.locator('body').innerText()).includes(key));assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert(requests.filter(r=>r.path.startsWith('/api/')).every(r=>r.path.startsWith('/api/auth/identity/v1/')));
 await page.reload();await page.getByRole('heading',{name:'Your kit is saved'}).waitFor();await hearOrca('setup enters first welcome question',()=>activate(page.getByRole('button',{name:'Verify a passkey and finish setup'})),[/What should I call you/i,/heading/i]);await page.getByLabel('Your name',{exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);assert.equal(await page.evaluate(()=>document.cookie),'');
 const cookies=await context.cookies();assert.equal(cookies.filter(c=>c.name==='__Host-whumpo_session').length,1);assert(cookies.every(c=>c.secure&&c.httpOnly&&c.sameSite===(c.name==='__Host-whumpo_session'?'Lax':'Strict')));
 if(accountHelp)await accountHelpJourney({page,context,db,state:audit,requests,origin,activate,enter,phase:value=>{phase=value;},holdWelcomeSave:()=>{holdWelcomeReply=true;return {pending:()=>!!releaseWelcomeReply,release:()=>{releaseWelcomeReply?.();releaseWelcomeReply=null;}};}});
 phase='first-project welcome';
 assert.equal(await page.getByRole('navigation',{name:'Workspace',exact:true}).count(),0);
 await enter(page.getByLabel('Your name',{exact:true}),'Garden owner');await hearOrca('welcome picture question',()=>activate(page.getByRole('button',{name:'Continue',exact:true})),[/Pick a face for your space/i,/heading/i]);
 if(accessibility){
  await page.getByRole('button',{name:'Use this picture',exact:true}).waitFor();await a11y.check(page,'welcome-picture');
  phase='late welcome reply keeps newer focus';holdWelcomeReply=true;
  await activate(page.getByRole('button',{name:'Use this picture',exact:true}));
  for(let n=0;!releaseWelcomeReply&&n<300;n++)await new Promise(done=>setTimeout(done,20));assert(releaseWelcomeReply);
  const brand=page.getByRole('link',{name:'Whumpo home',exact:true});await reach(brand);
  releaseWelcomeReply();releaseWelcomeReply=null;await page.getByRole('heading',{name:'Anything you’d like me to know about you?',exact:true}).waitFor();await page.waitForLoadState('networkidle');assert(await brand.evaluate(e=>e===document.activeElement),'A late welcome save must not move focus away from the owner’s new position');
 }else await activate(page.getByRole('button',{name:'Use this picture',exact:true}));
 await activate(page.getByRole('button',{name:'Skip for now',exact:true}));
 await enter(page.getByLabel('Your first idea',{exact:true}),'A website for my neighborhood landscaping business.');await activate(page.getByRole('button',{name:'Continue',exact:true}));
 await enter(page.getByLabel('Working name',{exact:true}),'Garden care');await activate(page.getByRole('button',{name:'Continue',exact:true}));
 await activate(page.getByRole('button',{name:'Skip for now',exact:true}));await activate(page.getByRole('button',{name:'Use this starting feel',exact:true}));
 assert(!requests.some(r=>r.path==='/api/chat'||r.path==='/api/workspace/dashboard'));
 await activate(page.getByRole('button',{name:'Start my project',exact:true}));await page.getByRole('textbox',{name:'Message Whumpo'}).waitFor();
 assert.equal((await db.prepare('SELECT count(*) n FROM projects').first()).n,1);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 // A saved draft survives an ordinary reload of the current session.
 await enter(page.getByRole('textbox',{name:'Message Whumpo'}),'My unsent garden idea');await page.reload();await page.getByRole('textbox',{name:'Message Whumpo'}).waitFor();assert.equal(await page.getByRole('textbox',{name:'Message Whumpo'}).inputValue(),'My unsent garden idea');
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
  await activate(page.getByRole('button',{name:'Revoke all GitHub app access',exact:true}));await page.getByRole('region',{name:'GitHub access review'}).filter({hasText:'Access removal confirmed'}).first().waitFor();
  assert.equal(providerCalls,1);assert.equal(modelCalls,2);assert.equal((await db.prepare('SELECT state FROM github_grant_revocations WHERE id=?').bind(second).first()).state,'revoked');assert.equal(requests.filter(r=>r.path.endsWith('/reauth/verify')).length,beforeProof+1);
  await page.reload();await page.getByRole('region',{name:'GitHub access review'}).filter({hasText:'Access removal confirmed'}).first().waitFor();assert.equal(await page.getByRole('button',{name:'Revoke all GitHub app access',exact:true}).count(),0);assert.equal(providerCalls,1);
  await page.setViewportSize({width:1280,height:900});await page.getByRole('region',{name:'GitHub access review'}).last().scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/whumpo-github-grant-desktop.png',fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 }
 if(siteSafety)await siteSafetyJourney({page,context,db,origin,requests,state:audit,activate,phase:value=>{phase=value;},seedWebsite:async()=>{
  const token=(await context.cookies()).find(c=>c.name==='__Host-whumpo_session').value,principal=await resolveIdentity(db,{version:1,client:'web',kind:'session',token}),scope=admitWorkspace(db,principal),user=principal.accountId;
  const project=(await db.prepare('SELECT id FROM projects WHERE owner_user_id=?').bind(user).first()).id;
  async function command(prepare){const id=crypto.randomUUID(),revision=(await db.prepare('SELECT revision FROM workspace_state WHERE user_id=?').bind(user).first()).revision+1,r=await prepare(id);await scope.batch([scope.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,?,'Synthetic website setup',?,datetime('now'),'ai','pending')").bind(id,user,revision,r.reply),...r.statements,scope.prepare("UPDATE chat_turns SET status='completed' WHERE id=?").bind(id),scope.prepare('UPDATE workspace_state SET revision=? WHERE user_id=?').bind(revision,user)]);return id;}
  const version=await command(id=>createWebsite(scope,user,id,project,{name:'Garden care',headline:'Gardens',description:'Garden care',theme:'ocean',aboutTitle:'About',aboutText:'Synthetic garden',sections:[],photos:[]})),review=await command(id=>publicationCommand(scope,user,id,'/publish '+version));await command(id=>publicationCommand(scope,user,id,'/confirm '+review));
  const backendVersion=crypto.randomUUID(),test=crypto.randomUUID(),endpoint=crypto.randomUUID(),app=crypto.randomUUID(),appPage=crypto.randomUUID();
  await saveBackend(scope,user,project,backendVersion,'export default ({state,input})=>({state:input,result:state})');
  await testBackend(scope,{fetch:async()=>Response.json({ok:true,value:{state:{},result:{}}})},user,project,backendVersion,test,{state:{},input:{}});
  await prepareBackendPublication(scope,user,project,endpoint,'publish',backendVersion,test);await confirmBackendPublication(scope,user,endpoint);
  await prepareApplication(scope,user,project,app,'enable',backendVersion,test);await confirmApplication(scope,user,app);
  await prepareAppPage(scope,user,project,appPage,{title:'Garden notebook',description:'Synthetic notes',buttonLabel:'Save',fields:[{key:'note',label:'Note',type:'text'}]});await confirmAppPage(scope,user,appPage);
  return {project,version};
 }});
 if(savedWork)await savedWorkJourney({page,db,origin,requests,state:audit,activate,phase:value=>{phase=value;}});
 if(crossTab)await crossTabIdentityJourney({page,context,db,origin,requests,cdp,auth,state:audit,phase:value=>{phase=value;}});
 if(accessibility)await ownerUsabilityJourney({page,context,db,env,state:audit,origin,activate,enter,reach,phase:value=>{phase=value;},audit:a11y.check});
 if(accountHelp){await page.goto(origin+'/workspace/settings');await activate(page.getByRole('button',{name:'Account help',exact:true}));await page.getByRole('dialog',{name:'Account help',exact:true}).getByRole('heading',{name:'Account security',exact:true}).waitFor();await page.getByRole('dialog',{name:'Account help',exact:true}).getByRole('button',{name:'Close',exact:true}).click();await page.goto(origin+'/workspace');await page.getByRole('textbox',{name:'Message Whumpo'}).waitFor();}
 await page.bringToFront();await page.waitForLoadState('networkidle');
 const savedTurns=(await db.prepare('SELECT count(*) n FROM chat_turns').first()).n;
 phase='live workspace revocation';
 await enter(page.getByRole('textbox',{name:'Message Whumpo'}),'Please make a gardening website.');await reach(page.getByRole('button',{name:'Send message',exact:true}));
 await db.prepare('DELETE FROM identity_sessions').run();
 // Access can close from a foreground/read check before the keystroke arrives.
 // Both that early closure and server refusal of the send must create no turn.
 await page.keyboard.press('Enter');
 await page.getByRole('button',{name:'Sign in with a passkey',exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:'Message Whumpo'}).count(),0);
 assert.equal((await db.prepare('SELECT count(*) n FROM chat_turns').first()).n,savedTurns,'Revoked request must not create a Chat turn');
 assert.equal(await page.evaluate(()=>document.cookie),'');
 assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
 assert.equal(errors.length,0,errors.join('\n'));a11y.finish();
 if(accountHelp)console.log('Account help journey passed: signed enrollment, unsaved welcome answer and keyboard dialog return, profile/welcome failures, independent security route/reload, sign-out during held profile read and committed welcome save with late-response fencing, fresh sign-in and first-project admission, settings access and revoked-session clearing. Zero external inference/provider calls; physical devices and human support remain unaccepted.');
 if(grantJourney)console.log(JSON.stringify({suite:'github-grant-browser',modelCalls,providerCalls,realPasskeyConfirmation:true,liveProviderAccess:false}));
 if(accessibility)console.log('Owner usability journey passed: keyboard draft/retry, private comparison/preview/save, Dashboard outage and newer focus, unavailable billing/connections, 360/390/1280px and night mode.');
 console.log('Current workspace browser passed: real mobile entry, two Chromium passkeys, recovery kit, identity-before-profile gate, first-project welcome, draft reload and immediate workspace closure on session revocation. No live provider requests.');
}catch(error){console.error(`Current workspace browser failed during ${phase}: ${error.message}`);console.error('Browser errors:',errors);if(page)console.error('Page:',page.url(),(await page.locator('body').innerText().catch(()=>'' )).replace(/[a-f0-9]{64}/g,'[redacted]').slice(0,1500));console.error('API paths:',requests.filter(r=>r.path.startsWith('/api/')));process.exitCode=1;}
finally{audit.releaseDashboard?.();audit.releaseProfile?.();audit.releaseReauth?.();releaseWelcomeReply?.();releaseAddReply?.();globalThis.fetch=originalFetch;crypto.subtle.timingSafeEqual=originalEqual;await browser?.close();if(server){server.closeAllConnections();await new Promise(done=>server.close(done));}await Promise.allSettled(background);await fixture?.close();await rm(html,{force:true});await rm(dir,{recursive:true,force:true});}
