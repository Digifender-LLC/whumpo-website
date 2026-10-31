// Local synthetic acceptance for the signup-to-Chat journey. The real Worker over the current schema, real signed WebAuthn from
// Chromium's virtual authenticator, the production bundle and the deployed CSP from frontend/public/_headers. Turnstile is a stand-in.
// Keyboard only, at 360, 390 and 1280px in light and dark, plus reduced motion and 200% text. No network and no remote bindings.
// WHUMPO_JOURNEY_CAPTURE=<dir> also records video, screenshots and a frame-rate report for review. That mode asserts nothing extra.
import {keyboardJourney} from './helpers/keyboard-journey.mjs';
import {accessibilityAudit} from './helpers/accessibility-audit.mjs';
import assert from 'node:assert/strict';
import {timingSafeEqual} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,readdir,writeFile,rm} from 'node:fs/promises';
import {createServer} from 'node:http';
import {resolve,sep} from 'node:path';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {build as viteBuild} from 'vite';
import {databaseFixture} from './helpers/current-database.mjs';
await mkdir('.secrets',{recursive:true,mode:0o700});
const require=createRequire(import.meta.url),{chromium}=require(process.env.WHUMPO_PLAYWRIGHT||'@playwright/test');
const capture=process.env.WHUMPO_JOURNEY_CAPTURE,a11y=accessibilityAudit();
const dir=await mkdtemp((process.env.TMPDIR||'/tmp')+'/whumpo-journey-'),html=`frontend/journey-fixture-${process.pid}.html`,origin='http://localhost:8787';
let browser,server,fixture,phase='build';const originalFetch=globalThis.fetch,originalEqual=crypto.subtle.timingSafeEqual;
const csp=(await readFile('frontend/public/_headers','utf8')).match(/Content-Security-Policy: (.*)/)[1];
assert.match(csp,/style-src 'self';/,'style-src stays self');

// Runs before any page script. Records what the page cannot be trusted to report about itself.
function instrument(){
 const log=window.__journey={moves:[],violations:[],gestures:[],frames:[],long:[],shift:0};
 window.turnstile={render:()=>'synthetic',remove:()=>{},reset:()=>{},getResponse:()=>'synthetic-turnstile'};
 document.addEventListener('securitypolicyviolation',event=>log.violations.push(event.violatedDirective+' '+event.blockedURI));
 const start=document.startViewTransition?.bind(document);
 if(start)document.startViewTransition=update=>{
  const move={name:document.documentElement.dataset.journeyMove??'navigation',start:performance.now()},transition=start(update);log.moves.push(move);
  transition.finished.finally(()=>{move.end=performance.now();});return transition;
 };
 for(const name of ['create','get']){const original=navigator.credentials[name].bind(navigator.credentials);navigator.credentials[name]=(...args)=>{log.gestures.push(navigator.userActivation.isActive);return original(...args);};}
 const frame=time=>{log.frames.push(time);requestAnimationFrame(frame);};requestAnimationFrame(frame);
 try{new PerformanceObserver(list=>{for(const entry of list.getEntries())log.long.push({start:entry.startTime,duration:entry.duration});}).observe({type:'longtask',buffered:true});
  new PerformanceObserver(list=>{for(const entry of list.getEntries())if(!entry.hadRecentInput){log.shift+=entry.value;(log.shifts??=[]).push([Math.round(entry.startTime),Math.round(entry.value*1000)/1000,...entry.sources.map(source=>String(source.node?.className??source.node?.nodeName).slice(0,40)+' '+Math.round(source.previousRect.y)+'>'+Math.round(source.currentRect.y))]);}}).observe({type:'layout-shift',buffered:true});}catch{}
}
async function writeVideo(frames,path){
 const folder=await mkdtemp(dir+'/frames-');let list='';
 for(const [index,{data,time}] of frames.entries()){const name=`${folder}/${String(index).padStart(6,'0')}.jpg`;await writeFile(name,data,'base64');list+=`file '${name}'\nduration ${Math.max(.001,(frames[index+1]?.time??time+1)-time).toFixed(4)}\n`;}
 await writeFile(folder+'/list.txt',list);
 execFileSync('ffmpeg',['-y','-v','error','-f','concat','-safe','0','-i',folder+'/list.txt','-vf','fps=50,scale=trunc(iw/2)*2:trunc(ih/2)*2','-c:v','libx264','-pix_fmt','yuv420p','-crf','20','-movflags','+faststart',path]);
}
const invite=async(db,hashToken)=>{const code=crypto.randomUUID();await db.prepare("INSERT INTO invitations VALUES(?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 hour'),NULL,NULL)").bind(await hashToken(code)).run();return code;};
// Polled, not per frame: a wait that runs every frame would itself show up in the frame timings.
const settled=page=>page.waitForFunction(()=>!document.documentElement.dataset.journeyMove&&!document.getAnimations().some(animation=>animation.playState==='running'&&!animation.effect?.target?.matches?.('.skeleton,.skeleton::after')),undefined,{polling:100});

/** One full journey. checks turns on the one-off failure, interruption and timing cases. */
async function walk(page,cdp,{db,hashToken,width,label,reduced=false,large=false,checks=false,axe=false,landing=false}){
 const {activate,enter}=keyboardJourney(page,true),code=await invite(db,hashToken),email=`journey-${label}@example.test`;
 const authenticator=async()=>(await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}})).authenticatorId;
 const button=name=>page.getByRole('button',{name,exact:true});
 let shots=0;
 async function fit(step){
  phase=`${label}: ${step}`;await settled(page);
  if(large)await page.evaluate(()=>{document.documentElement.style.fontSize='200%';});
  await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'horizontal scroll');
  assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('.journey-step>*')].filter(element=>getComputedStyle(element).opacity!=='1').length),0,'a step element was left hidden');
  if(width<=760){const short=await page.evaluate(()=>[...document.querySelectorAll('main button,main summary,main input:not([type=checkbox]):not([type=radio])')].filter(element=>{const height=element.getBoundingClientRect().height;return height&&height<43.5&&!element.matches('.sr-only');}).map(element=>element.textContent.trim()||element.name));assert.deepEqual(short,[],'controls under 44px');}
  if(axe)await a11y.check(page,`journey ${label} ${step}`);
  if(capture)await page.screenshot({path:`${capture}/${label}-${String(++shots).padStart(2,'0')}-${step}.png`});
  if(large)await page.evaluate(()=>{document.documentElement.style.fontSize='';});
 }
 const focused=text=>page.waitForFunction(value=>document.activeElement?.textContent===value,text,{polling:50});
 const rail=text=>page.locator('.journey-rail [role=status]').filter({hasText:text}).waitFor();
 const pause=()=>capture?page.waitForTimeout(650):undefined;
 const answer=async(field,value)=>{if(!capture)return enter(field,value);await field.focus();await page.keyboard.press('Control+A');await page.keyboard.press('Delete');for(const character of value){await page.keyboard.type(character);await page.waitForTimeout(28);}};

 let auth=await authenticator();
 if(landing){
  await page.goto(origin+'/');await page.getByRole('link',{name:'Start with an invite',exact:true}).first().waitFor();await pause();await activate(page.getByRole('link',{name:'Start with an invite',exact:true}).first());
  await page.getByRole('heading',{name:'A little hello. A big beginning.'}).waitFor();assert.equal(await page.evaluate(()=>window.__journey.moves.filter(move=>move.name==='navigation').length),1,'Signup is reached by a transition');
 }else await page.goto(origin+'/workspace?signup=true');
 await focused('A little hello. A big beginning.');await rail('Step 1 of 6: Account');await fit('signup');await pause();
 await answer(page.getByLabel('Email',{exact:true}),email);await answer(page.getByLabel('Invitation code'),code);await activate(page.getByRole('checkbox'));await pause();
 await activate(button('Create my first passkey'));
 await focused('Make this account yours.');await rail('Step 2 of 6: Passkeys');await page.getByText('First passkey',{exact:true}).waitFor();await fit('first-passkey');await pause();
 await cdp.send('WebAuthn.removeVirtualAuthenticator',{authenticatorId:auth});auth=await authenticator();
 await answer(page.getByLabel('Name your next passkey'),'Backup provider');
 if(checks){
  phase=`${label}: cancelled ceremony`;
  await page.evaluate(()=>{const create=navigator.credentials.create;navigator.credentials.create=async()=>{navigator.credentials.create=create;throw new DOMException('Cancelled by fixture','NotAllowedError');};});
  await activate(button('Add a passkey'));await page.getByRole('alert').filter({hasText:'The passkey step was not completed'}).waitFor();await settled(page);
  assert.equal(await page.getByText('Backup provider',{exact:true}).count(),0,'A cancelled ceremony must not fill the keyring');await rail('Step 2 of 6: Passkeys');
 }
 await activate(button('Add a passkey'));
 await focused('Your private backup');await page.getByText('Backup provider',{exact:true}).waitFor();await rail('Step 3 of 6: Recovery kit');await page.getByText('this recovery kit is how you get back in').waitFor();await fit('second-passkey');await pause();
 await activate(button('Prepare recovery kit'));await focused('Save your recovery kit');
 await settled(page);assert(await page.evaluate(()=>{const top=document.getElementById('kit-heading').getBoundingClientRect().top,saved=[...document.querySelectorAll('button')].find(element=>element.textContent==='Download').getBoundingClientRect();return top>=0&&saved.bottom<=innerHeight;}),'The kit heading and its first action are on screen '+await page.evaluate(()=>JSON.stringify([scrollY,document.getElementById('kit-heading').getBoundingClientRect().top,[...document.querySelectorAll('button')].find(element=>element.textContent==='Download').getBoundingClientRect().bottom,innerHeight])));
 await page.getByText('Keep it private and separate from your passkeys.').waitFor();await fit('recovery-kit');
 if(checks){
  // Nothing hurries a person past the kit: no timer, no auto-advance, and the one confirmation stays theirs.
  await page.waitForTimeout(2500);await focused('Save your recovery kit');assert.equal(await page.getByRole('heading',{name:'Your kit is saved'}).count(),0);assert.equal(await page.getByRole('button',{name:'Copy',exact:true}).isEnabled(),true);
 }
 const downloaded=page.waitForEvent('download');await activate(button('Download'));const kit=await readFile(await (await downloaded).path(),'utf8'),key=kit.match(/Recovery key:\n([a-f0-9]{64})/)[1];await pause();
 await activate(button('I’ve saved my recovery kit'));await focused('Your kit is saved');await fit('recovery-kit-saved');
 assert(!(await page.locator('body').innerText()).includes(key),'The key leaves the page once saved');await pause();
 await activate(button('Verify a passkey and finish setup'));
 await focused('Hi, I’m Whumpo. What should I call you?');await rail('Step 4 of 6: About you');await fit('name');await pause();
 await answer(page.getByLabel('Your name',{exact:true}),'Maya');assert.equal(await page.locator('.journey-caption').innerText(),'Hi, Maya.');await pause();
 await activate(button('Continue'));await focused('Nice to meet you, Maya. Pick a face for your space.');await fit('picture');await pause();
 await activate(button('Use this picture'));await focused('Anything you’d like me to know about you?');await fit('bio');await pause();
 await activate(page.locator('summary').filter({hasText:'Optional privacy choices'}));assert.equal(await page.getByRole('checkbox',{name:/personalize/}).isChecked(),false);assert.equal(await page.getByRole('checkbox',{name:/content-free/}).isChecked(),false);
 await activate(button('Skip for now'));await focused('What would you like us to make first?');await rail('Step 5 of 6: Your first idea');
 const sketch=page.locator('.journey-sketch');assert.match(await sketch.innerText(),/Sketch from your answers/);await fit('idea');await pause();
 const idea='A website for my neighborhood bakery where people can see the menu.';
 await answer(page.getByLabel('Your first idea',{exact:true}),idea.slice(0,9));assert.match(await sketch.innerText(),/A website/,'The sketch follows each keystroke');await answer(page.getByLabel('Your first idea',{exact:true}),idea);await pause();
 if(checks){
  phase=`${label}: failed and slow saves`;
  await page.route('**/api/onboarding',route=>route.request().method()==='PUT'?route.fulfill({status:503,contentType:'application/json',body:'{"error":"Synthetic interruption"}'}):route.fallback(),{times:1});
  await activate(button('Continue'));await page.getByRole('alert').filter({hasText:'Your answer is still here.'}).waitFor();await settled(page);
  assert.equal(await page.getByRole('heading',{name:'What would you like us to make first?'}).count(),1);assert.equal(await page.getByLabel('Your first idea',{exact:true}).inputValue(),idea);
  let release;await page.route('**/api/onboarding',async route=>{if(route.request().method()==='PUT')await new Promise(done=>{release=done;});await route.fallback();},{times:1});
  await page.getByRole('button',{name:'Continue',exact:true}).focus();await page.keyboard.press('Enter');await page.getByRole('button',{name:'Saving…'}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.journeyMove),undefined,'Nothing animates ahead of the saved reply');assert.equal(await page.getByRole('heading',{name:'What would you like us to make first?'}).count(),1);
  release();
 }else await activate(button('Continue'));
 await focused('What shall we call your project?');await fit('project-name');await pause();
 if(checks&&!reduced){
  phase=`${label}: input during a transition`;
  await activate(page.getByRole('button',{name:'Previous welcome question'}));await focused('What would you like us to make first?');
  const move=await page.evaluate(()=>document.documentElement.dataset.journeyMove);assert.equal(move,'back','Going back reads as back');await settled(page);
  await activate(button('Continue'));await focused('What shall we call your project?');
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.journeyMove),'forward','This check must land during the transition');
  await page.getByLabel('Working name',{exact:true}).click();await page.keyboard.insertText('Copper Oven');assert.equal(await page.getByLabel('Working name',{exact:true}).inputValue(),'Copper Oven','Typing mid-transition is not lost');await settled(page);
 }else await answer(page.getByLabel('Working name',{exact:true}),'Copper Oven');
 assert.match(await sketch.locator('.journey-sketch-title').innerText(),/Copper Oven/);await pause();
 await activate(button('Continue'));await focused('Who are you making this for?');await fit('audience');await pause();
 await answer(page.getByLabel(/Who it/),'Neighbors who love fresh bread');assert.match(await sketch.innerText(),/Made for Neighbors who love fresh bread/);await pause();
 await activate(button('Continue'));await focused('What should it feel like?');
 if(checks&&!reduced){
  phase=`${label}: interrupted transition`;
  await page.evaluate(()=>document.querySelector('[aria-label="Previous welcome question"]').click());await focused('Who are you making this for?');await settled(page);await activate(button('Continue'));await focused('What should it feel like?');
 }
 await fit('style');await pause();
 await activate(page.getByRole('radio',{name:'Warm & cozy'}));await page.waitForFunction(()=>document.querySelector('.journey-sketch')?.dataset.feel==='clay');assert.equal(await page.getByRole('radio',{name:'Warm & cozy'}).isChecked(),true);
 assert.equal(await sketch.evaluate(element=>getComputedStyle(element).backgroundColor),'rgb(252, 245, 237)','The sketch shows the real clay paper');await fit('style-chosen');await pause();
 await activate(button('Use this starting feel'));await focused('Shall we start your first project?');await rail('Step 6 of 6: Ready to begin');await fit('review');
 assert.match(await page.locator('body').innerText(),/Checkout isn.t open yet/);await pause();
 await activate(button('Start my project'));
 phase=`${label}: arrival`;await page.getByRole('textbox',{name:'Message Whumpo'}).waitFor();await focused('Copper Oven');
 const card=page.getByRole('region',{name:'Start your first draft'});await card.waitFor();assert.equal(await card.getAttribute('data-feel'),'clay');await settled(page);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);if(capture)await page.screenshot({path:`${capture}/${label}-${String(++shots).padStart(2,'0')}-chat.png`});await pause();
 const log=await page.evaluate(()=>{const {frames,...rest}=window.__journey;return {...rest,frames:rest.moves.map(move=>{const moved=frames.filter(time=>time>=move.start&&time<=(move.end??move.start)+450),gaps=moved.slice(1).map((time,index)=>time-moved[index]);return {...move,count:moved.length,worst:Math.round(Math.max(0,...gaps)),over34:gaps.filter(gap=>gap>34).length,fps:gaps.length?Math.round(1000*gaps.length/(moved.at(-1)-moved[0])):0,long:rest.long.filter(task=>task.start>=move.start&&task.start<=(move.end??move.start)+450).reduce((sum,task)=>sum+task.duration,0)};})};});
 assert.deepEqual(log.violations,[],'CSP refused something');
 assert.equal(log.gestures.length,log.gestures.filter(Boolean).length,'Every passkey prompt came from a user gesture');assert(log.gestures.length>=3);
 if(reduced)assert.equal(log.moves.length,0,'Reduced motion commits without a transition');else assert(log.moves.length>=12,`moves: ${log.moves.length}`);
 if(!reduced)assert(log.moves.some(move=>move.name==='arrive'),'Chat is reached by the arrival move');
 if(!large&&!process.env.WHUMPO_JOURNEY_THROTTLE)assert(log.shift<.1,`Layout shift ${log.shift} ${JSON.stringify(log.shifts)}`); // The large-text pass resizes the root itself, and throttling pushes commits past the input window.
 return log;
}

try{
 await writeFile(html,'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover,interactive-widget=resizes-content"><title>Whumpo journey</title></head><body><div id="root"></div><script type="module" src="/@fs/'+resolve('frontend/src/main.tsx')+'"></script></body></html>');
 await viteBuild({build:{outDir:dir+'/web',rollupOptions:{input:resolve(html)}},logLevel:'error'});
 phase='bundle boundaries';
 const assets=await readdir(dir+'/web/assets'),styleSheets=await Promise.all(assets.filter(name=>name.endsWith('.css')).map(async name=>[name,await readFile(`${dir}/web/assets/${name}`,'utf8')]));
 const page0=await readFile(`${dir}/web/${html.split('/').at(-1)}`,'utf8'),entrySheets=styleSheets.filter(([name])=>page0.includes(name));
 assert(entrySheets.length&&entrySheets.every(([,text])=>!text.includes('journey-step')),'The landing stylesheet carries no journey styles');
 assert(styleSheets.some(([,text])=>text.includes('journey-step')),'Journey styles load with the workspace chunk');
 phase='palette';
 const palettes=(await readFile('src/components.ts','utf8')).match(/const palette = (\{.*?\})\[config\.theme\]/)[1],journeyStyle=await readFile('frontend/src/journey/journey.css','utf8');
 for(const [feel,ink,tint,paper] of [...palettes.matchAll(/(\w+):\['(#\w+)','(#\w+)','(#\w+)'\]/g)].map(match=>match.slice(1)))assert(journeyStyle.includes(`--sketch-ink:${ink};--sketch-tint:${tint};--sketch-paper:${paper}`),`The sketch palette for ${feel} matches the first draft`);
 const bundled=await build({stdin:{contents:"export {default as worker} from './src/index';export {hashToken} from './src/security';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
 const {worker,hashToken}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
 fixture=await databaseFixture();const db=fixture.db;
 crypto.subtle.timingSafeEqual=(a,b)=>timingSafeEqual(Buffer.from(a),Buffer.from(b));
 globalThis.fetch=async url=>{if(String(url)==='https://challenges.cloudflare.com/turnstile/v0/siteverify')return Response.json({success:true,hostname:'localhost',action:'register'});throw Error('Unexpected external request');};
 const env={DB:db,ENVIRONMENT:'local',TURNSTILE_SITE_KEY:'synthetic-public',TURNSTILE_SECRET:'synthetic-secret',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})}};
 const background=[],root=resolve(dir+'/web');
 server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,origin);
  if(url.pathname.startsWith('/api/')){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const response=await worker.fetch(new Request(url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})}),env,{waitUntil:p=>background.push(p)});
   const headers=Object.fromEntries(response.headers);headers['set-cookie']=response.headers.getSetCookie();res.writeHead(response.status,headers).end(Buffer.from(await response.arrayBuffer()));return;
  }
  const document=url.pathname==='/'||url.pathname==='/workspace'||url.pathname.startsWith('/workspace/'),name=document?html.split('/').at(-1):decodeURIComponent(url.pathname).slice(1),path=resolve(root,name);
  if(!path.startsWith(root+sep)){res.writeHead(404).end();return;}
  const bytes=await readFile(path),ext=path.split('.').at(-1);res.writeHead(200,{'content-type':{html:'text/html',js:'text/javascript',css:'text/css',png:'image/png',svg:'image/svg+xml',webp:'image/webp',woff2:'font/woff2'}[ext]??'application/octet-stream','cache-control':'no-store','content-security-policy':csp}).end(bytes);
 }catch{res.writeHead(404).end();}});
 await new Promise((done,reject)=>{server.once('error',reject);server.listen(8787,'127.0.0.1',done)});
 browser=await chromium.launch({headless:true,...(process.env.WHUMPO_CHROMIUM?{executablePath:process.env.WHUMPO_CHROMIUM}:{})});
 const scenarios=capture?[{label:'phone',width:390,landing:true},{label:'desktop',width:1280,height:800,landing:true},{label:'phone-dark',width:390,dark:true},{label:'phone-reduced',width:390,reduced:true},{label:'phone-large-text',width:390,large:true}]
 :[{label:'390-light',width:390,checks:true,axe:true,landing:true},{label:'390-dark',width:390,dark:true,axe:true},{label:'360-light',width:360},{label:'360-dark',width:360,dark:true},{label:'1280-light',width:1280,height:800,checks:true,axe:true,landing:true},{label:'1280-dark',width:1280,height:800,dark:true,axe:true},{label:'390-reduced',width:390,reduced:true,checks:true},{label:'390-large-text',width:390,large:true}];
 const report={};
 // Returning people share the frame: sign-in and recovery entry fit, move by keyboard and stay inside the CSP too.
 phase='sign-in and recovery entry';
 const entry=await browser.newContext({viewport:{width:360,height:740},isMobile:true,hasTouch:true,serviceWorkers:'block'});await entry.addInitScript(instrument);
 {const page=await entry.newPage();page.setDefaultTimeout(15000);const {activate}=keyboardJourney(page,true);
  await page.goto(origin+'/workspace');await page.getByRole('heading',{name:'Welcome back.'}).waitFor();await activate(page.getByRole('button',{name:'Use my recovery kit',exact:true}));
  await page.getByRole('heading',{name:'Let’s recover your account.'}).waitFor();await page.getByLabel('Recovery key').waitFor();await settled(page);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  if(capture)await page.screenshot({path:capture+'/recovery-entry.png'});
  await activate(page.getByRole('button',{name:'Sign in with a saved passkey',exact:true}));await page.getByRole('heading',{name:'Welcome back.'}).waitFor();await settled(page);
  if(capture)await page.screenshot({path:capture+'/sign-in.png'});
  assert.deepEqual(await page.evaluate(()=>window.__journey.violations),[]);await entry.close();}
 for(const scenario of scenarios.filter(item=>!process.env.WHUMPO_JOURNEY_ONLY||item.label===process.env.WHUMPO_JOURNEY_ONLY)){
  const {label,width,height=844,dark=false,reduced=false}=scenario,phone=width<=760;phase=label;
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:capture?2:1,isMobile:phone,hasTouch:phone,serviceWorkers:'block',acceptDownloads:true,colorScheme:dark?'dark':'light',reducedMotion:reduced?'reduce':'no-preference',});
  await context.addInitScript(instrument);
  const page=await context.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(/Content Security Policy|Refused to/.test(message.text()))errors.push(message.text());});
  const cdp=await context.newCDPSession(page),frames=[];await cdp.send('WebAuthn.enable');
  if(capture){cdp.on('Page.screencastFrame',({data,metadata,sessionId})=>{frames.push({data,time:metadata.timestamp});void cdp.send('Page.screencastFrameAck',{sessionId}).catch(()=>{});});await cdp.send('Page.startScreencast',{format:'jpeg',quality:92,everyNthFrame:1,maxWidth:width*2,maxHeight:height*2});}
  if(process.env.WHUMPO_JOURNEY_THROTTLE)await cdp.send('Emulation.setCPUThrottlingRate',{rate:Number(process.env.WHUMPO_JOURNEY_THROTTLE)});
  const log=await walk(page,cdp,{db,hashToken,...scenario});report[label]=log.frames.map(({name,start,end,fps,worst,over34,long})=>({name,ms:Math.round(end-start),fps,worst,over34,long:Math.round(long)}));report[label+':shift']=log.shift;
  assert.deepEqual(errors,[]);
  await context.close();if(capture)await writeVideo(frames,`${capture}/${label}.mp4`);
  console.log(`Journey passed: ${label}`);
 }
 if(process.env.WHUMPO_JOURNEY_REPORT)await writeFile(process.env.WHUMPO_JOURNEY_REPORT,JSON.stringify(report,null,1));
 if(!capture)a11y.finish();
 console.log('Onboarding journey passed: signup to Chat by keyboard at 360, 390 and 1280px, light and dark, reduced motion and 200% text, under the deployed CSP, with real passkeys, a real saved kit, focus on every step and no animation ahead of a saved reply.');
}catch(error){console.error(`Failed at ${phase}`);throw error;}
finally{await browser?.close();await new Promise(done=>server?server.close(done):done());await fixture?.close?.();globalThis.fetch=originalFetch;crypto.subtle.timingSafeEqual=originalEqual;await rm(html,{force:true});await rm(dir,{recursive:true,force:true});}
