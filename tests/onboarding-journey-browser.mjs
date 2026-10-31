// Local synthetic acceptance for the signup-to-Chat journey. The real Worker over the current schema, real signed WebAuthn from
// Chromium's virtual authenticator, the production bundle and the deployed CSP from frontend/public/_headers. Turnstile is a stand-in.
// Keyboard only, at 360, 390 and 1280px in light and dark, plus a short screen, reduced motion and 200% text. No network and no remote bindings.
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
 const log=window.__journey={moves:[],violations:[],gestures:[],frames:[],long:[],shift:0,entrances:[],morphs:[]};
 window.turnstile={render:()=>'synthetic',remove:()=>{},reset:()=>{},getResponse:()=>'synthetic-turnstile'};
 document.addEventListener('securitypolicyviolation',event=>log.violations.push(event.violatedDirective+' '+event.blockedURI));
 const start=document.startViewTransition?.bind(document);
 if(start)document.startViewTransition=update=>{
  const move={name:document.documentElement.dataset.journeyMove??'navigation',start:performance.now()},transition=start(update);log.moves.push(move);
  // A test sets log.hold to keep a transition open, so input during one is checked without racing its length.
  if(log.hold)transition.ready.then(()=>document.documentElement.animate({opacity:[1,1]},{duration:log.hold,pseudoElement:'::view-transition'})).catch(()=>{});
  transition.ready.then(()=>{move.ready=true;}).catch(()=>{});
  transition.finished.finally(()=>{move.end=performance.now();});return transition;
 };
 const animate=Element.prototype.animate;
 Element.prototype.animate=function(keyframes,options){
  if(this.parentElement?.matches('.journey-step'))log.entrances.push({keyframes:JSON.stringify(keyframes),duration:options?.duration,easing:options?.easing});
  if(options?.pseudoElement?.startsWith('::view-transition-group'))log.morphs.push({duration:options.duration,easing:options.easing});
  return animate.call(this,keyframes,options);
 };
 // Sees every commit, including one no frame ever paints. Armed only around the kit, because reading the page text is not free.
 new MutationObserver(()=>{
  if(!log.watch)return;const text=document.body?.textContent??'';
  if(text.includes('can’t be shown again')||text.includes('Prepare a new kit'))log.watch.push('the kit text is missing');
  else if(document.getElementById('kit-heading')?.textContent==='Your kit is saved'&&text.includes('Show private recovery key'))log.watch.push('the key is still here after saving');
 }).observe(document,{subtree:true,childList:true,characterData:true});
 for(const name of ['create','get']){const original=navigator.credentials[name].bind(navigator.credentials);navigator.credentials[name]=(...args)=>{log.gestures.push(navigator.userActivation.isActive);return original(...args);};}
 const frame=time=>{log.frames.push(time);requestAnimationFrame(frame);};requestAnimationFrame(frame);
 try{new PerformanceObserver(list=>{for(const entry of list.getEntries())log.long.push({start:entry.startTime,duration:entry.duration});}).observe({type:'longtask',buffered:true});
  new PerformanceObserver(list=>{for(const entry of list.getEntries())if(!entry.hadRecentInput){log.shift+=entry.value;(log.shifts??=[]).push([Math.round(entry.startTime),Math.round(entry.value*1000)/1000,...entry.sources.map(source=>String(source.node?.className??source.node?.nodeName).slice(0,40)+' '+Math.round(source.previousRect.y)+'>'+Math.round(source.currentRect.y))]);}}).observe({type:'layout-shift',buffered:true});}catch{}
}
function rootStyle([property,value]){const set=()=>{if(document.documentElement)document.documentElement.style[property]=value;};set();document.addEventListener('readystatechange',set);}
async function writeVideo(frames,path){
 const folder=await mkdtemp(dir+'/frames-');let list='';
 for(const [index,{data,time}] of frames.entries()){const name=`${folder}/${String(index).padStart(6,'0')}.jpg`;await writeFile(name,data,'base64');list+=`file '${name}'\nduration ${Math.max(.001,(frames[index+1]?.time??time+1)-time).toFixed(4)}\n`;}
 await writeFile(folder+'/list.txt',list);
 execFileSync('ffmpeg',['-y','-v','error','-f','concat','-safe','0','-i',folder+'/list.txt','-vf','fps=50,scale=trunc(iw/2)*2:trunc(ih/2)*2','-c:v','libx264','-preset','slow','-tune','animation','-pix_fmt','yuv420p','-crf','14','-movflags','+faststart',path]);
 await rm(folder,{recursive:true,force:true}); // /tmp is a small shared tmpfs and each pass writes thousands of frames.
}
const invite=async(db,hashToken)=>{const code=crypto.randomUUID();await db.prepare("INSERT INTO invitations VALUES(?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 hour'),NULL,NULL)").bind(await hashToken(code)).run();return code;};
// Polled, not per frame: a wait that runs every frame would itself show up in the frame timings.
const settled=page=>page.waitForFunction(()=>!document.documentElement.dataset.journeyMove&&!document.getAnimations().some(animation=>animation.playState==='running'&&!animation.effect?.target?.matches?.('.skeleton,.skeleton::after')),undefined,{polling:100});

/** One full journey. checks turns on the one-off failure, interruption and timing cases. */
async function walk(page,cdp,{db,hashToken,width,height=844,label,reduced=false,large=false,checks=false,landing=false,keyboard=false,hold=false,pages,kitSaves}){
 const {activate,enter}=keyboardJourney(page,true),code=await invite(db,hashToken),email=`journey-${label}@example.test`;
 const authenticator=async()=>(await cdp.send('WebAuthn.addVirtualAuthenticator',{options:{protocol:'ctap2',transport:'internal',hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}})).authenticatorId;
 const button=name=>page.getByRole('button',{name,exact:true});
 let shots=0,pinned=0;
 async function fit(step){
  phase=`${label}: ${step}`;await settled(page);
  await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'horizontal scroll');
  assert.deepEqual(await page.evaluate(()=>[...document.querySelectorAll('.journey-step>*')].filter(element=>getComputedStyle(element).opacity!=='1').length),0,'a step element was left hidden');
  assert.equal(await page.locator('.journey-rail [role=status],.journey-rail [aria-live]').count(),0,'The focused heading announces the step, so the rail must not repeat it');
  if(width<=760){const short=await page.evaluate(()=>[...document.querySelectorAll('main button,main summary,main input:not([type=checkbox]):not([type=radio])')].filter(element=>{const height=element.getBoundingClientRect().height;return height&&height<43.5&&!element.matches('.sr-only');}).map(element=>element.textContent.trim()||element.name));assert.deepEqual(short,[],'controls under 44px');}
  // The pinned action, wherever the page is taller than the screen. At 200% text the signup form starts below the fold, and a sticky button cannot leave its form.
  if(width<=760){const pin=await page.evaluate(selector=>{const action=document.querySelector(selector);return action&&matchMedia('(min-height:40em)').matches?{bottom:action.getBoundingClientRect().bottom,screen:innerHeight,tall:document.documentElement.scrollHeight>innerHeight}:null;},large?'.journey-actions button[type=submit]':'.journey-actions button[type=submit],.journey-submit button');if(pin){assert(pin.bottom<=pin.screen,`The next action is pinned on screen: ${JSON.stringify(pin)}`);pinned+=pin.tall?1:0;}}
  if(!capture)await a11y.check(page,`journey ${label} ${step}`);
  if(capture)await page.screenshot({path:`${capture}/${label}-${String(++shots).padStart(2,'0')}-${step}.png`});
 }
 const focused=text=>page.waitForFunction(value=>document.activeElement?.textContent===value,text,{polling:50});
 const rail=text=>page.locator('.journey-rail p').filter({hasText:text}).waitFor();
 const lastMove=()=>page.evaluate(()=>{const move=window.__journey.moves.at(-1);return {name:move?.name,running:!!move&&move.end===undefined,count:window.__journey.moves.length};});
 const line=slot=>page.locator(`.journey-sketch [data-slot=${slot}]`);
 // The promise stays visible wherever it applies: every question up to the review.
 const promised=async(saving='answers save when you continue')=>assert.equal(await page.locator('.journey-note').innerText(),`No AI usage · ${saving}`);
 const lastEntrance=()=>page.evaluate(()=>window.__journey.entrances.at(-1).keyframes);
 const watchKit=()=>page.evaluate(()=>{window.__journey.watch=[];});
 const kitHeld=moment=>page.evaluate(()=>window.__journey.watch).then(wrong=>{assert.deepEqual(wrong,[],`No commit may show the wrong kit state ${moment}`);});
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
 await watchKit();if(hold)await page.clock.install();
 await activate(button('Prepare recovery kit'));await focused('Save your recovery kit');
 await settled(page);assert(await page.evaluate(()=>{const top=document.getElementById('kit-heading').getBoundingClientRect().top,saved=[...document.querySelectorAll('button')].find(element=>element.textContent==='Download').getBoundingClientRect();return top>=0&&saved.bottom<=innerHeight;}),'The kit heading and its first action are on screen '+await page.evaluate(()=>JSON.stringify([scrollY,document.getElementById('kit-heading').getBoundingClientRect().top,[...document.querySelectorAll('button')].find(element=>element.textContent==='Download').getBoundingClientRect().bottom,innerHeight])));
 await page.getByText('Keep it private and separate from your passkeys.').waitFor();await page.getByText('Ready for you to save').waitFor();await fit('recovery-kit');await kitHeld('while it is prepared');
 if(hold){
  // Ten minutes pass in one call. Any timer, interval or frame loop that would save the kit or leave this step fires now.
  phase=`${label}: nothing moves past the kit`;
  await page.clock.fastForward('10:00');await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  assert.equal(await page.getByRole('button',{name:'I’ve saved my recovery kit',exact:true,disabled:false}).count(),1,'Nothing started saving the kit or left the step');assert.equal(await page.getByRole('status').filter({hasText:'One moment'}).count(),0);
  await focused('Save your recovery kit');await page.getByText('Ready for you to save').waitFor();assert.equal(kitSaves.count,0,'The kit stays unsaved until the person confirms it');
  return null;
 }
 if(checks){
  // A reload discards the text: the checklist must not keep promising a kit the page can no longer show.
  await page.reload();await page.getByText('Prepare a new kit',{exact:true}).waitFor();await page.getByText('This unsaved kit can’t be shown again').waitFor();
  await activate(button('Prepare a different kit'));await page.getByText('Ready for you to save').waitFor();await button('Download').waitFor();await settled(page);
 }
 const downloaded=page.waitForEvent('download');await activate(button('Download'));const kit=await readFile(await (await downloaded).path(),'utf8'),key=kit.match(/Recovery key:\n([a-f0-9]{64})/)[1];await pause();
 // Nothing hurries a person past the kit: only their own confirmation saves it, whatever else they do first.
 assert.equal(kitSaves.count,0,'The kit was marked saved without the person confirming it');assert.equal(await button('I’ve saved my recovery kit').isEnabled(),true);
 await watchKit();await activate(button('I’ve saved my recovery kit'));await focused('Your kit is saved');assert.equal(kitSaves.count,1);await page.getByText('Marked as saved',{exact:true}).waitFor();await fit('recovery-kit-saved');await kitHeld('just after it is saved');
 assert(!(await page.locator('body').innerText()).includes(key),'The key leaves the page once saved');await pause();
 await activate(button('Verify a passkey and finish setup'));
 await focused('Hi, I’m Whumpo. What should I call you?');await rail('Step 4 of 6: About you');await promised();
 assert.equal(await page.getByText('Hi there.',{exact:true}).count(),0);
 assert.equal(await page.locator('.journey-sketch [data-slot]').count(),await page.locator('.journey-sketch [data-slot][dir=auto]').count(),'Sketch text follows the direction of what was typed');
 await fit('name');
 if(!large){const top=await page.locator('.journey-question').evaluate(element=>element.getBoundingClientRect().top);assert(top<=(width<=760?250:180),`The question starts near the top: ${top}`);}
 await pause();
 await answer(page.getByLabel('Your name',{exact:true}),'Maya');assert.equal(await line('greeting').innerText(),'Hi, I’m Maya.','The first answer builds the sketch');await pause();
 await activate(button('Continue'));await focused('Nice to meet you, Maya. Pick a face for your space.');await promised('your picture saves when you choose it');await fit('picture');await pause();
 await activate(page.getByRole('button',{name:'Choose Sunshine'}));await page.waitForFunction(()=>document.querySelector('.journey-sketch-greeting img')?.src.endsWith('sun.svg'));await pause();
 await activate(button('Use this picture'));await focused('Anything you’d like me to know about you?');await promised();
 // The privacy position is readable with the choices closed.
 const privacy=page.locator('summary').filter({hasText:'Name and bio kept out of AI context'});await privacy.waitFor();await fit('bio');await pause();
 await activate(privacy);assert.equal(await page.getByRole('checkbox',{name:/personalize/}).isChecked(),false);assert.equal(await page.getByRole('checkbox',{name:/content-free/}).isChecked(),false);
 await activate(button('Skip for now'));await focused('What would you like us to make first?');await rail('Step 5 of 6: Your first idea');await promised();
 const sketch=page.locator('.journey-sketch');assert.match(await sketch.innerText(),/Sketch from your answers/);await fit('idea');
 if(width<=760&&!large){
  const chips=await page.locator('.journey-chips').evaluate(element=>{element.scrollIntoView({block:'nearest',behavior:'instant'});const box=element.getBoundingClientRect();return {bottom:box.bottom,bar:document.querySelector('.journey-actions').getBoundingClientRect().top,height:box.height,row:getComputedStyle(element).overflowX};});
  assert(chips.height<70&&chips.row==='auto'&&chips.bottom<=chips.bar,`Suggestions form one scrolling row clear of the pinned bar: ${JSON.stringify(chips)}`);
 }
 await pause();
 const idea='A website for my neighborhood bakery where people can see the menu.';
 await answer(page.getByLabel('Your first idea',{exact:true}),idea.slice(0,9));assert.equal(await line('headline').innerText(),'A website','The sketch follows each keystroke');
 if(keyboard){
  // A phone keyboard: the visual viewport shrinks while a field is focused. The sketch folds to the line being written.
  phase=`${label}: keyboard`;
  await page.getByLabel('Your first idea',{exact:true}).focus();await page.setViewportSize({width,height:height-340});await page.waitForFunction(()=>document.documentElement.classList.contains('phone-keyboard'));
  const open=await page.evaluate(()=>({sketch:document.querySelector('.journey-sketch').getBoundingClientRect().height,button:document.querySelector('.journey-actions button[type=submit]').getBoundingClientRect().bottom,field:document.getElementById('welcome-idea').getBoundingClientRect().bottom,bar:document.querySelector('.journey-actions').getBoundingClientRect().top,height:innerHeight,line:document.querySelector('[data-slot=headline]').getClientRects().length}));
  assert(open.sketch<=44&&open.line>0&&open.button<=open.height&&open.field<=open.bar,`Keyboard layout ${JSON.stringify(open)}`);if(capture)await page.screenshot({path:`${capture}/${label}-keyboard.png`});
  await page.setViewportSize({width,height});await page.waitForFunction(()=>!document.documentElement.classList.contains('phone-keyboard'));
 }
 await answer(page.getByLabel('Your first idea',{exact:true}),idea);assert.equal(await line('headline').innerText(),idea);await pause();
 if(checks){
  phase=`${label}: failed and slow saves`;
  await page.route('**/api/onboarding',route=>route.request().method()==='PUT'?route.fulfill({status:503,contentType:'application/json',body:'{"error":"Synthetic interruption"}'}):route.fallback(),{times:1});
  await activate(button('Continue'));await page.getByRole('alert').filter({hasText:'Your answer is still here.'}).waitFor();await settled(page);
  assert.equal(await page.getByRole('heading',{name:'What would you like us to make first?'}).count(),1);assert.equal(await page.getByLabel('Your first idea',{exact:true}).inputValue(),idea);
  let release,arrived;const reached=new Promise(done=>{arrived=done;});
  await page.route('**/api/onboarding',async route=>{if(route.request().method()==='PUT'){const held=new Promise(done=>{release=done;});arrived();await held;}await route.fallback();},{times:1});
  const movesBefore=(await lastMove()).count;
  await button('Continue').focus();await page.keyboard.press('Enter');await reached;await page.getByRole('button',{name:'Saving…'}).waitFor();
  assert.equal((await lastMove()).count,movesBefore,'Nothing animates ahead of the saved reply');assert.equal(await page.getByRole('heading',{name:'What would you like us to make first?'}).count(),1);
  release();
 }else await activate(button('Continue'));
 await focused('What shall we call your project?');await promised();await fit('project-name');await pause();
 if(checks&&!reduced){
  phase=`${label}: input during a transition`;
  await activate(page.getByRole('button',{name:'Previous welcome question'}));await focused('What would you like us to make first?');assert.equal((await lastMove()).name,'back','Going back reads as back');assert.match(await lastEntrance(),/translateY\(-\d/,'Going back falls');await settled(page);
  await page.evaluate(()=>{window.__journey.hold=1500;});
  await activate(button('Continue'));await focused('What shall we call your project?');await page.evaluate(()=>{window.__journey.hold=0;});assert.match(await lastEntrance(),/translateY\(\d/,'Going forward rises');
  // The browser pauses rendering and hit testing for the frame or two between its two captures, while the new step is not yet on screen.
  await page.waitForFunction(()=>window.__journey.moves.at(-1).ready,undefined,{polling:20});
  const spot=await page.evaluate(()=>{const box=document.getElementById('welcome-project').getBoundingClientRect(),action=document.querySelector('.journey-actions button[type=submit]').getBoundingClientRect();return {x:box.x+24,y:box.y+box.height/2,hit:document.elementFromPoint(box.x+24,box.y+box.height/2)?.id,action:!!document.elementFromPoint(action.x+action.width/2,action.y+action.height/2)?.closest('button[type=submit]')};});
  assert.deepEqual(await lastMove().then(({name,running})=>[name,running]),['forward',true],'This check must land during the transition');assert.equal(spot.hit,'welcome-project','The field takes pointer input during a transition');assert.equal(spot.action,true,'So does the next action');
  await page.mouse.click(spot.x,spot.y);await page.keyboard.insertText('Copper Oven');assert.equal(await page.getByLabel('Working name',{exact:true}).inputValue(),'Copper Oven','A click and typing during a transition reach the page');await settled(page);
 }else await answer(page.getByLabel('Working name',{exact:true}),'Copper Oven');
 assert.equal(await line('brand').innerText(),'Copper Oven');await pause();
 await activate(button('Continue'));await focused('Who are you making this for?');await promised();await fit('audience');await pause();
 await answer(page.getByLabel(/Who it/),'Neighbors who love fresh bread');assert.equal(await line('tagline').innerText(),'Made for Neighbors who love fresh bread');await pause();
 if(checks&&!reduced)await page.evaluate(()=>{window.__journey.hold=1500;});
 await activate(button('Continue'));await focused('What should it feel like?');await promised();
 if(checks&&!reduced){
  phase=`${label}: interrupted transition`;
  await page.evaluate(()=>{window.__journey.hold=0;});assert.equal((await lastMove()).running,true,'This check must land during the transition');
  await page.evaluate(()=>document.querySelector('[aria-label="Previous welcome question"]').click());await focused('Who are you making this for?');await settled(page);await activate(button('Continue'));await focused('What should it feel like?');
 }
 await fit('style');await pause();
 await activate(page.getByRole('radio',{name:'Warm & cozy'}));await page.waitForFunction(()=>document.querySelector('.journey-sketch')?.dataset.feel==='clay');assert.equal(await page.getByRole('radio',{name:'Warm & cozy'}).isChecked(),true);
 assert.equal(await sketch.evaluate(element=>getComputedStyle(element).backgroundColor),'rgb(252, 245, 237)','The sketch shows the real clay paper');await fit('style-chosen');await pause();
 await activate(button('Use this starting feel'));await focused('Shall we start your first project?');await rail('Step 6 of 6: Ready to begin');await fit('review');
 // The moment: the sketch, one action, and details only on request.
 assert.equal(await page.locator('.journey-note').innerText(),'Private to start. Nothing is bought or published.');
 assert.equal(await page.locator('.journey-step button:visible').count(),0,'Start is the only thing to press until details are opened');assert.equal(await page.getByRole('button',{name:/Edit /}).count(),0);
 assert(await button('Start my project').evaluate(element=>element.getBoundingClientRect().bottom<=innerHeight),'Start is on screen');
 assert(!pages.has('/api/billing/subscription'),'Billing is out of the flow');await pause();
 await activate(page.locator('summary').filter({hasText:'Check details'}));await page.getByText('No domain, paid service, or publication is created. You start on Explore, with no card, and billing is in Settings.').waitFor();await page.getByText('Name and bio kept out of AI context').waitFor();await fit('review-details');
 if(checks){
  phase=`${label}: edit from review`;
  await activate(page.getByRole('button',{name:'Edit project name'}));await focused('What shall we call your project?');await enter(page.getByLabel('Working name',{exact:true}),'Copper Oven Bakery');await activate(button('Save and review'));
  await focused('Shall we start your first project?');await page.getByRole('button',{name:'Edit project name'}).waitFor();assert.equal(await line('brand').innerText(),'Copper Oven Bakery');
  await activate(page.getByRole('button',{name:'Edit project name'}));await focused('What shall we call your project?');await enter(page.getByLabel('Working name',{exact:true}),'Copper Oven');await activate(button('Save and review'));await focused('Shall we start your first project?');
 }
 await pause();
 await activate(button('Start my project'));
 phase=`${label}: arrival`;await page.getByRole('textbox',{name:'Message Whumpo'}).waitFor();await focused('Copper Oven');
 const card=page.getByRole('region',{name:'Start your first draft'});await card.waitFor();assert.equal(await card.getAttribute('data-feel'),'clay');await settled(page);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);if(capture)await page.screenshot({path:`${capture}/${label}-${String(++shots).padStart(2,'0')}-chat.png`});await pause();
 const log=await page.evaluate(()=>{const {frames,...rest}=window.__journey;return {...rest,frames:rest.moves.map(move=>{const moved=frames.filter(time=>time>=move.start&&time<=(move.end??move.start)+450),gaps=moved.slice(1).map((time,index)=>time-moved[index]);return {...move,count:moved.length,worst:Math.round(Math.max(0,...gaps)),over34:gaps.filter(gap=>gap>34).length,fps:gaps.length?Math.round(1000*gaps.length/(moved.at(-1)-moved[0])):0,long:rest.long.filter(task=>task.start>=move.start&&task.start<=(move.end??move.start)+450).reduce((sum,task)=>sum+task.duration,0)};})};});
 assert.deepEqual(log.violations,[],'CSP refused something');
 assert.equal(log.gestures.length,log.gestures.filter(Boolean).length,'Every passkey prompt came from a user gesture');assert(log.gestures.length>=(checks?1:3)); // A checks pass reloads mid-setup, which restarts this log.
 if(reduced)assert.equal(log.moves.length,0,'Reduced motion commits without a transition');else assert(log.moves.length>=12,`moves: ${log.moves.length}`);
 if(!reduced)assert(log.moves.some(move=>move.name==='arrive'),'Chat is reached by the arrival move');
 // Web Animations cannot read the motion tokens, so motion.ts copies them. These hold the copies to the tokens.
 const [fast,slow,ease,standard]=await page.evaluate(()=>{const style=getComputedStyle(document.documentElement),ms=value=>value.endsWith('ms')?parseFloat(value):parseFloat(value)*1000;return [ms(style.getPropertyValue('--duration-fast').trim()),ms(style.getPropertyValue('--duration-slow').trim()),style.getPropertyValue('--ease-enter').trim(),style.getPropertyValue('--ease-standard').trim()];}); // The CSS minifier writes 400ms as .4s.
 assert(log.entrances.length>=8,`entrances: ${log.entrances.length}`);
 if(reduced)assert(log.entrances.every(item=>item.keyframes==='{"opacity":[0,1]}'&&item.duration===fast),'Reduced motion fades each step in and moves nothing');
 else{assert(log.entrances.every(item=>item.duration===slow&&item.easing===ease),'Entrances use the motion tokens');assert(log.morphs.length>=3&&log.morphs.every(item=>item.duration===slow&&item.easing===standard),`Morphs use the motion tokens: ${log.morphs.length}`);}
 if(height<=640)assert(pinned>=3,`The short viewport must really scroll past the pinned action: ${pinned}`);
 if(!process.env.WHUMPO_JOURNEY_THROTTLE&&!capture)assert(log.shift<.1,`Layout shift ${log.shift} ${JSON.stringify(log.shifts)}`); // Throttling and capture pauses push commits past the browser's recent-input window.
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
 const background=[],root=resolve(dir+'/web'),pages=new Set(),kitSaves={count:0},served={};
 server=createServer(async(req,res)=>{try{
  const url=new URL(req.url,origin);
  pages.add(url.pathname);if(url.pathname.endsWith('/kit/save'))kitSaves.count++;
  if(url.pathname.startsWith('/api/')){
   const chunks=[];for await(const chunk of req)chunks.push(chunk);
   const response=await worker.fetch(new Request(url,{method:req.method,headers:req.headers,...(['GET','HEAD'].includes(req.method)?{}:{body:Buffer.concat(chunks)})}),env,{waitUntil:p=>background.push(p)});
   const headers=Object.fromEntries(response.headers);headers['set-cookie']=response.headers.getSetCookie();res.writeHead(response.status,headers).end(Buffer.from(await response.arrayBuffer()));return;
  }
  const document=url.pathname==='/'||url.pathname==='/workspace'||url.pathname.startsWith('/workspace/'),name=document?html.split('/').at(-1):decodeURIComponent(url.pathname).slice(1),path=resolve(root,name);
  if(!path.startsWith(root+sep)){res.writeHead(404).end();return;}
  const file=await readFile(path),ext=path.split('.').at(-1),bytes=document&&served.layout?file.toString().replace('width=device-width,initial-scale=1',`width=${served.layout}`):file;res.writeHead(200,{'content-type':{html:'text/html',js:'text/javascript',css:'text/css',png:'image/png',svg:'image/svg+xml',webp:'image/webp',woff2:'font/woff2'}[ext]??'application/octet-stream','cache-control':'no-store','content-security-policy':csp}).end(bytes);
 }catch{res.writeHead(404).end();}});
 await new Promise((done,reject)=>{server.once('error',reject);server.listen(8787,'127.0.0.1',done)});
 browser=await chromium.launch({headless:true,...(process.env.WHUMPO_CHROMIUM?{executablePath:process.env.WHUMPO_CHROMIUM}:{})});
 // Screencasts never exceed the viewport's own pixels, so the sharp phone passes use a 636px viewport with a 390px layout, as a high-density phone does.
 const sharp={width:636,height:1376,layout:390},scenarios=capture?[{label:'phone',...sharp,landing:true},{label:'desktop',width:1280,height:800,landing:true},{label:'phone-dark',...sharp,dark:true},{label:'phone-reduced',...sharp,reduced:true},{label:'phone-large-text',width:390,large:true},{label:'phone-keyboard',width:390,keyboard:true}]
 :[{label:'kit-hold',width:390,hold:true},{label:'390-light',width:390,checks:true,landing:true,keyboard:true},{label:'390-dark',width:390,dark:true},{label:'360-light',width:360},{label:'360-dark',width:360,dark:true},{label:'360-short',width:360,height:640},{label:'1280-light',width:1280,height:800,checks:true,landing:true},{label:'1280-dark',width:1280,height:800,dark:true},{label:'390-reduced',width:390,reduced:true,checks:true},{label:'390-large-text',width:390,large:true}];
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
 for(const scenario of scenarios.filter(item=>item.hold||!process.env.WHUMPO_JOURNEY_ONLY||item.label===process.env.WHUMPO_JOURNEY_ONLY)){
  const {label,width,height=844,dark=false,reduced=false,large=false,layout}=scenario,phone=width<=760;phase=label;served.layout=layout;kitSaves.count=0;pages.clear();
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:capture&&!layout?2:1,isMobile:phone,hasTouch:phone,serviceWorkers:'block',acceptDownloads:true,colorScheme:dark?'dark':'light',reducedMotion:reduced?'reduce':'no-preference',});
  await context.addInitScript(instrument);
  if(large)await context.addInitScript(rootStyle,['fontSize','200%']);
  const page=await context.newPage();page.setDefaultTimeout(15000);const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(/Content Security Policy|Refused to/.test(message.text()))errors.push(message.text());});
  const cdp=await context.newCDPSession(page),frames=[];await cdp.send('WebAuthn.enable');
  if(capture){cdp.on('Page.screencastFrame',({data,metadata,sessionId})=>{frames.push({data,time:metadata.timestamp});void cdp.send('Page.screencastFrameAck',{sessionId}).catch(()=>{});});await cdp.send('Page.startScreencast',{format:'jpeg',quality:92,everyNthFrame:1,maxWidth:width*2,maxHeight:height*2});}
  if(process.env.WHUMPO_JOURNEY_THROTTLE)await cdp.send('Emulation.setCPUThrottlingRate',{rate:Number(process.env.WHUMPO_JOURNEY_THROTTLE)});
  const log=await walk(page,cdp,{db,hashToken,pages,kitSaves,height,...scenario});if(log)report[label]=log.frames.map(({name,start,end,fps,worst,over34,long})=>({name,ms:Math.round(end-start),fps,worst,over34,long:Math.round(long)}));if(log)report[label+':shift']=log.shift;
  assert.deepEqual(errors,[]);
  await context.close();if(capture)await writeVideo(frames,`${capture}/${label}.mp4`);
  console.log(`Journey passed: ${label}`);
 }
 if(process.env.WHUMPO_JOURNEY_REPORT)await writeFile(process.env.WHUMPO_JOURNEY_REPORT,JSON.stringify(report,null,1));
 if(!capture)a11y.finish();
 console.log('Onboarding journey passed: signup to Chat by keyboard at 360, 390 and 1280px, light and dark, a short screen, reduced motion and 200% text, under the deployed CSP, with real passkeys, a real saved kit, focus on every step and no animation ahead of a saved reply.');
}catch(error){console.error(`Failed at ${phase}`);throw error;}
finally{await browser?.close();await new Promise(done=>server?server.close(done):done());await fixture?.close?.();globalThis.fetch=originalFetch;crypto.subtle.timingSafeEqual=originalEqual;await rm(html,{force:true});await rm(dir,{recursive:true,force:true});}
