import assert from 'node:assert/strict';
import {serviceSafetyJourney} from './service-safety-journey.mjs';
import {hearOrca} from './orca-output.mjs';

/** Actual built UI/Worker/current D1. Model, Chat, profile and generated
 * dashboard outages cannot prevent the existing publication withdrawal. */
export async function siteSafetyJourney({page,context,db,state,requests,origin,activate,phase,seedWebsite}){
 phase('website safety fixture');
 const {project,version}=await seedWebsite(),read=()=>db.prepare('SELECT * FROM publications WHERE project_id=?').bind(project).first();
 const original=await read(),beforeTurns=(await db.prepare('SELECT count(*) n FROM chat_turns').first()).n;
 state.failChat=true;state.failDashboard=true;await page.reload();await page.getByRole('textbox',{name:'Message Whumpo'}).waitFor();
 await activate(page.getByRole('link',{name:'Dashboard',exact:true}).filter({visible:true}));
 await page.getByRole('alert').filter({hasText:'Couldn’t load your dashboard'}).waitFor();
 await hearOrca('dashboard outage opens website safety',()=>activate(page.getByRole('link',{name:'Site & app safety',exact:true})),[/Site & app safety/i,/heading/i]);
 await page.getByRole('article',{name:'Garden care',exact:true}).waitFor();
 const directStart=requests.length;state.failProfile=true;await page.reload();await page.getByRole('article',{name:'Garden care',exact:true}).waitFor();await page.waitForLoadState('networkidle');
 const dark=()=>page.evaluate(()=>document.documentElement.classList.contains('dark'));
 for(const [scheme,saved,expected] of [['light','dark',true],['dark','light',false]]){
  await page.emulateMedia({colorScheme:scheme});await page.evaluate(t=>localStorage.setItem('whumpo.theme',t),saved);
  await page.reload();await page.getByRole('article',{name:'Garden care',exact:true}).waitFor();await page.waitForLoadState('networkidle');
  assert.equal(await dark(),expected,`Direct safety follows saved ${saved} theme on a ${scheme} device`);
 }
 await page.emulateMedia({colorScheme:null});await page.evaluate(()=>localStorage.removeItem('whumpo.theme'));
 assert(requests.slice(directStart).filter(r=>r.path.startsWith('/api/')).every(r=>r.path.startsWith('/api/auth/identity/v1/')||r.path.startsWith('/api/workspace/site-safety')),'Direct safety never reads profile, Chat, billing or dashboard');
 phase('lost review reply recovers without a second prepare');
 state.loseSafetyPrepare=true;await activate(page.getByRole('button',{name:'Review taking website offline',exact:true}));
 await page.getByRole('heading',{name:'Awaiting confirmation: Garden care',exact:true}).waitFor();
 const review=new URL(page.url()).searchParams.get('review');assert(review);
 await activate(page.locator('summary').filter({hasText:'Review details'}));assert.match(await page.locator('details[open]').innerText(),new RegExp(version));await activate(page.locator('summary').filter({hasText:'Review details'}));
 const prepares=()=>requests.filter(r=>r.path==='/api/workspace/site-safety/reviews'&&r.method==='POST').length;
 assert.equal(prepares(),1);assert.deepEqual(await read(),original);
 await page.reload();await page.getByRole('heading',{name:'Awaiting confirmation: Garden care',exact:true}).waitFor();assert.equal(prepares(),1);
 for(const width of [360,390,1280]){
  await page.setViewportSize({width,height:844});await page.getByRole('button',{name:'Confirm taking this website offline',exact:true}).scrollIntoViewIfNeeded();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'/tmp/whumpo-site-safety-'+width+'.png',fullPage:true});
 }
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
 await page.addStyleTag({content:'html{font-size:32px!important}'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'/tmp/whumpo-site-safety-large-text.png',fullPage:true});
 await page.reload();await page.getByRole('heading',{name:'Awaiting confirmation: Garden care',exact:true}).waitFor();
 phase('failed current review read hides approval');
 await page.route('**/api/workspace/site-safety/reviews/'+review,route=>route.fulfill({status:503,json:{error:'Synthetic review outage'}}));
 await activate(page.getByRole('button',{name:'Check saved result',exact:true}));await page.getByRole('alert').filter({hasText:'Synthetic review outage'}).waitFor();assert.equal(await page.getByRole('button',{name:'Confirm taking this website offline',exact:true}).count(),0);
 await page.unroute('**/api/workspace/site-safety/reviews/'+review);await activate(page.getByRole('button',{name:'Check saved result',exact:true}));await page.getByRole('heading',{name:'Awaiting confirmation: Garden care',exact:true}).waitFor();
 phase('lost committed withdrawal reply is read back once');
 state.loseSafetyConfirm=true;
 await hearOrca('withdrawal result after lost response',()=>activate(page.getByRole('button',{name:'Confirm taking this website offline',exact:true})),[/Withdrawal applied/i,/Garden care/i]);
 await page.getByText('The website is currently offline.',{exact:true}).waitFor();
 const confirms=()=>requests.filter(r=>r.path.endsWith('/'+review+'/confirm')&&r.method==='POST').length;
 assert.equal(confirms(),1);assert.equal((await read()).version_id,null);assert.equal((await read()).revision,original.revision+1);
 assert.equal((await db.prepare('SELECT count(*) n FROM activity_events WHERE id=?').bind('publication:'+review).first()).n,1);
 await page.reload();await page.getByText('The website is currently offline.',{exact:true}).waitFor();assert.equal(confirms(),1);
 await activate(page.getByRole('link',{name:'Close review',exact:true}));await activate(page.getByRole('button',{name:'Saved withdrawals',exact:true}));
 await page.getByRole('region',{name:'Saved website withdrawals',exact:true}).getByRole('button',{name:/Garden care.*Withdrawal applied/}).waitFor();
 await activate(page.getByRole('region',{name:'Saved website withdrawals',exact:true}).getByRole('button',{name:/Garden care.*Withdrawal applied/}));await page.getByText('The website is currently offline.',{exact:true}).waitFor();assert.equal(confirms(),1);
 assert.equal((await db.prepare('SELECT count(*) n FROM chat_turns').first()).n,beforeTurns);assert.equal((await db.prepare('SELECT count(*) n FROM inference_calls').first()).n,0);
 assert.equal((await db.prepare('SELECT count(*) n FROM site_versions WHERE id=?').bind(version).first()).n,1,'Withdrawal preserves the saved version');
 const service=await serviceSafetyJourney({page,db,state,requests,origin,activate,phase,project});
 phase('late safety read after logout cannot restore a private review');
 let release;await page.route('**'+service.path,async route=>{const reply=await route.fetch();await new Promise(done=>{release=()=>route.fulfill({response:reply}).then(done).catch(done);});});
 await activate(page.getByRole('button',{name:'Check saved result',exact:true}));
 for(let i=0;!release&&i<300;i++)await new Promise(done=>setTimeout(done,20));assert(release);
 await activate(page.getByRole('button',{name:'Account help',exact:true}));await page.getByRole('dialog',{name:'Account help',exact:true}).getByRole('button',{name:'Sign out',exact:true}).waitFor();
 await activate(page.getByRole('dialog',{name:'Account help',exact:true}).getByRole('button',{name:'Sign out',exact:true}));await page.getByRole('button',{name:'Sign in with a passkey',exact:true}).waitFor();
 await release();await page.unroute('**'+service.path);await page.waitForLoadState('networkidle');assert.equal(await page.getByRole('region',{name:'Visitor app withdrawals',exact:true}).count(),0);
 state.failChat=false;state.failDashboard=false;state.failProfile=false;
 await activate(page.getByRole('button',{name:'Sign in with a passkey',exact:true}));await page.getByRole('heading',{name:'Site & app safety',exact:true}).waitFor();
 await page.goto(origin+'/workspace');await page.getByRole('textbox',{name:'Message Whumpo'}).waitFor();
 console.log('Site and app safety browser passed: signed owner, Chat/dashboard/profile outages, exact review, lost preparation/confirmation replies without automatic redispatch, read-error approval hiding, reload/list recovery, mobile/large-text/keyboard/reduced-motion checks and late private-read refusal after logout. Service receipts also cover both surfaces, invalid links and independent effects. Zero inference/provider calls.');
}
