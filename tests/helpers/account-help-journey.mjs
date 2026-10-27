import assert from 'node:assert/strict';
import {hearOrca} from './orca-output.mjs';

/** Same built UI, signed current identity and Worker as the owner journey.
 * Deliberate failures affect only profile/welcome; identity remains available. */
export async function accountHelpJourney({page,context,db,state,requests,origin,activate,enter,phase,holdWelcomeSave}){
 const help=()=>page.getByRole('button',{name:'Account help',exact:true});
 const dialog=()=>page.getByRole('dialog',{name:'Account help',exact:true});
 async function open(){await activate(help());await dialog().waitFor();await page.waitForFunction(()=>document.activeElement?.textContent==='Account help');}
 async function close(){await activate(dialog().getByRole('button',{name:'Close',exact:true}));await dialog().waitFor({state:'detached'});await page.waitForFunction(()=>document.activeElement?.textContent?.trim()==='Account help');assert(await help().evaluate(e=>e===document.activeElement));}
 phase('account help retains welcome draft');
 const draft='Unsubmitted welcome name';await enter(page.getByLabel('Your name',{exact:true}),draft);
 await hearOrca('account help opens during welcome',open,[/Account help/i,/Manage your passkeys/i,/heading/i]);
 assert.match(await dialog().innerText(),/Support works without Chat\. We reply on business days\./);
 await dialog().getByRole('heading',{name:'Account security',exact:true}).waitFor();
 const before=requests.length;await activate(dialog().getByRole('button',{name:'Check saved progress',exact:true}));
 await page.waitForLoadState('networkidle');
 assert(requests.slice(before).every(r=>r.path.startsWith('/api/auth/identity/v1/')),'Account help reads only the current identity');
 for(const width of [360,390,1280]){
  await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));
  await dialog().evaluate(element=>Promise.all(element.getAnimations().map(animation=>animation.finished.catch(()=>{}))));
  const box=await dialog().boundingBox();await page.screenshot({path:'/tmp/whumpo-account-help-geometry-'+width+'.png'});assert(box.x>=-.5&&box.x+box.width<=width+.5&&box.y>=-.5&&box.y+box.height<=844.5,JSON.stringify({width,box,viewport:await page.evaluate(()=>({width:innerWidth,height:innerHeight,scale:visualViewport.scale}))}));
  await dialog().getByRole('button',{name:'Sign out',exact:true}).scrollIntoViewIfNeeded();
  const closeBox=await dialog().getByRole('button',{name:'Close',exact:true}).boundingBox();assert(closeBox.y>=0&&closeBox.y+closeBox.height<=844,'Close remains visible while the security controls scroll');
  await page.screenshot({path:'/tmp/whumpo-account-help-'+width+'.png'});
 }
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
 const keyName=dialog().getByLabel('Name your next passkey');await enter(keyName,'Unsubmitted key label');
 await page.evaluate(()=>{Object.defineProperty(visualViewport,'height',{configurable:true,value:430});visualViewport.dispatchEvent(new Event('resize'));});
 await page.waitForFunction(()=>document.documentElement.classList.contains('phone-keyboard'));
 await keyName.scrollIntoViewIfNeeded();const fieldBox=await keyName.boundingBox(),closeBox=await dialog().getByRole('button',{name:'Close',exact:true}).boundingBox();
 assert(fieldBox.y>=0&&fieldBox.y+fieldBox.height<=430,'Passkey name stays reachable above the simulated keyboard');assert(closeBox.y>=0&&closeBox.y+closeBox.height<=430,'Close stays above the simulated keyboard');
 await page.screenshot({path:'/tmp/whumpo-account-help-keyboard.png'});
 await page.evaluate(()=>{delete visualViewport.height;visualViewport.dispatchEvent(new Event('resize'));});
 await enter(keyName,'');
 await hearOrca('account help closes to welcome control',close,[/Account help/i,/button/i]);
 assert.equal(await page.getByLabel('Your name',{exact:true}).inputValue(),draft);
 await page.emulateMedia({reducedMotion:'no-preference'});

 phase('profile outage still exposes account help');
 state.failProfile=true;await page.reload();await page.getByRole('heading',{name:'Couldn’t open your workspace'}).waitFor();
 await open();await dialog().getByRole('button',{name:'Sign out',exact:true}).waitFor();await close();
 phase('direct account security bypasses profile and welcome');
 const directStart=requests.length;await page.goto(origin+'/workspace/security');await page.getByRole('heading',{name:'Account security',exact:true}).waitFor();
 await page.waitForLoadState('networkidle');assert(requests.slice(directStart).filter(r=>r.path.startsWith('/api/')).every(r=>r.path.startsWith('/api/auth/identity/v1/')));
 assert.equal(await page.getByRole('textbox',{name:'Message Whumpo'}).count(),0);assert.equal(await page.getByLabel('Your name',{exact:true}).count(),0);
 await page.reload();await page.getByRole('heading',{name:'Account security',exact:true}).waitFor();
 phase('finishing a profile read preserves open account help');
 state.failProfile=false;state.holdProfile=true;await activate(page.getByRole('link',{name:'Back to Dashboard',exact:true}));await page.getByLabel('Opening your workspace').waitFor();await open();
 await enter(dialog().getByLabel('Name your next passkey'),'Keep this unsubmitted label');
 for(let i=0;!state.releaseProfile&&i<300;i++)await new Promise(done=>setTimeout(done,20));assert(state.releaseProfile);state.releaseProfile();state.releaseProfile=null;
 await page.waitForLoadState('networkidle');assert.equal(await dialog().getByLabel('Name your next passkey').inputValue(),'Keep this unsubmitted label');await close();
 await page.getByLabel('Your name',{exact:true}).waitFor();
 state.failWelcome=true;await page.reload();
 await page.getByRole('heading',{name:'Let’s pick up where you left off.'}).waitFor();await open();await close();

 phase('sign out during pending profile read fences its late result');
 state.failWelcome=false;state.holdProfile=true;await page.reload();
 await page.getByLabel('Opening your workspace').waitFor();await open();
 for(let i=0;!state.releaseProfile&&i<300;i++)await new Promise(done=>setTimeout(done,20));assert(state.releaseProfile);
 await activate(dialog().getByRole('button',{name:'Sign out',exact:true}));await page.getByRole('button',{name:'Sign in with a passkey',exact:true}).waitFor();
 state.releaseProfile();state.releaseProfile=null;await page.waitForLoadState('networkidle');
 assert.equal(await page.getByRole('textbox',{name:'Message Whumpo'}).count(),0);assert.equal(await page.getByLabel('Your name',{exact:true}).count(),0);
 assert.equal((await db.prepare('SELECT count(*) n FROM identity_sessions').first()).n,0);
 assert.equal((await context.cookies()).filter(c=>c.name==='__Host-whumpo_session').length,0);
 assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
 await activate(page.getByRole('button',{name:'Sign in with a passkey',exact:true}));await page.getByLabel('Your name',{exact:true}).waitFor();
 assert.equal(await page.getByLabel('Your name',{exact:true}).inputValue(),'','Unsubmitted name was never saved');
 phase('account help signs out while a welcome save is waiting');
 await enter(page.getByLabel('Your name',{exact:true}),'Garden owner');const held=holdWelcomeSave();
 await activate(page.getByRole('button',{name:'Continue',exact:true}));
 for(let i=0;!held.pending()&&i<300;i++)await new Promise(done=>setTimeout(done,20));assert(held.pending());
 await open();await activate(dialog().getByRole('button',{name:'Sign out',exact:true}));await page.getByRole('button',{name:'Sign in with a passkey',exact:true}).waitFor();
 held.release();await page.waitForLoadState('networkidle');
 assert.equal(await page.getByLabel('Your name',{exact:true}).count(),0);assert.equal(await page.getByRole('textbox',{name:'Message Whumpo'}).count(),0);
 assert.equal(await page.evaluate(()=>localStorage.length+sessionStorage.length),0);
 await activate(page.getByRole('button',{name:'Sign in with a passkey',exact:true}));await page.getByRole('heading',{name:'Nice to meet you, Garden owner. Pick a face for your space.',exact:true}).waitFor();
 await activate(page.getByRole('button',{name:'Previous welcome question',exact:true}));await page.getByLabel('Your name',{exact:true}).waitFor();
 assert.equal(await page.getByLabel('Your name',{exact:true}).inputValue(),'Garden owner','The confirmed earlier save remains available only after signing in again');
 assert(!requests.some(r=>r.path==='/api/chat'||r.path==='/api/workspace/dashboard'),'Help cannot bypass first-project admission or invoke Chat');
}
