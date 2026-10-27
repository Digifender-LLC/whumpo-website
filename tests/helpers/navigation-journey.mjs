import assert from 'node:assert/strict';

/** WH-111 navigation acceptance on the actual built UI, current Worker and D1.
 * The fixture has no inference provider configured (Chat runs in guided mode),
 * so every step here is also an inference-outage check: nothing calls a model.
 * The generated layout is synthetic: eight agent pages, some named like fixed
 * controls, are injected into the dashboard reply. */
export async function navigationJourney({page,db,state,requests,origin,activate,enter,phase}){
 const composer=()=>page.getByRole('textbox',{name:'Message Whumpo'}),bar=()=>page.getByRole('navigation',{name:'Mobile workspace'});
 const helpButton=()=>bar().getByRole('button',{name:'Help and account',exact:true}),help=()=>page.getByRole('dialog',{name:'Help and account',exact:true});
 const essentials=['Saved work','Site & app safety','Support','Account & security'];
 const count=table=>db.prepare('SELECT count(*) n FROM '+table).first().then(r=>r.n);
 const user=(await db.prepare('SELECT owner_user_id id FROM projects').first()).id,project=(await db.prepare('SELECT id FROM projects WHERE owner_user_id=?').bind(user).first()).id;
 const beforeInference=await count('inference_calls'),fits=()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
 const focused=async(locator,label)=>{for(let i=0;i<50;i++){if(await locator.evaluate(e=>e===document.activeElement))return;await new Promise(done=>setTimeout(done,20));}assert.fail(label+': focus is on '+await page.evaluate(()=>document.activeElement?.outerHTML.slice(0,200)));};
 const inView=async(locator,label,height)=>{const box=await locator.boundingBox();assert(box&&box.y>=0&&box.y+box.height<=height+0.5&&box.x>=0,label+' '+JSON.stringify(box));};
 const draft='My unsent garden idea';
 assert.equal(await composer().inputValue(),draft,'The journey starts from the saved composer draft');

 phase('synthetic generated layout cannot hide or impersonate fixed controls');
 const spoofed=['Support','Sign out','Saved work','Account & security','Help and account'],pages=[...spoofed,'Garden desk','A'.repeat(40),'Seasonal planting calendar and invoices'].map((label,n)=>({id:'tab-generated-'+n,label,view:{version:1,projectId:null,widgets:['projects'],shortcuts:[]}}));
 await page.route('**/api/workspace/dashboard',async route=>{const reply=await route.fetch();const json=await reply.json();if(reply.ok())json.layout={...json.layout,tabs:pages};await route.fulfill({response:reply,json});});
 await page.reload();await composer().waitFor();await page.waitForLoadState('networkidle');
 assert.equal(await composer().inputValue(),draft,'Reload keeps the per-tab composer draft');

 phase('Chat-first mobile bar with one Help entry; screen-reader names');
 assert.deepEqual(await bar().evaluate(nav=>[...nav.children].map(e=>e.getAttribute('aria-label')||e.textContent.trim())),['Chat','Dashboard','Your pages','Settings','Help and account']);
 const barTree=await bar().ariaSnapshot();for(const name of ['Chat','Dashboard','Your pages','Settings','Help and account'])assert.match(barTree,new RegExp('(link|button) "'+name+'"'),barTree);
 for(const control of await bar().locator('a,button').all())assert((await control.boundingBox()).height>=44,'Bottom bar targets are at least 44px');
 assert.match(await page.locator('.chat-composer').innerText(),/assistant is temporarily unavailable/,'Guided mode states inference is unavailable');

 phase('keyboard opens Help, lists every essential and returns focus');
 await activate(helpButton());await help().waitFor();
 const helpTree=await help().ariaSnapshot();
 for(const name of [...essentials,'Your profile'])assert.match(helpTree,new RegExp('link "'+name.replace(/[&]/g,'\\&')+'[^"]*"'),helpTree);
 assert.match(helpTree,/button "Sign out"/);assert.match(helpTree,/These controls work without Chat or the AI assistant/);
 for(const name of essentials){const link=help().getByRole('link',{name:new RegExp('^'+name.replace(/[&]/g,'\\&'))});await link.scrollIntoViewIfNeeded();await inView(link,name,844);}
 await page.screenshot({path:'/tmp/whumpo-navigation-help-390.png'});
 await page.keyboard.press('Escape');await help().waitFor({state:'detached'});await focused(helpButton(),'Escape returns to Help');

 phase('generated page names are marked as pages');
 await activate(bar().getByRole('button',{name:'Your pages',exact:true}));const sheet=page.getByRole('dialog',{name:'Your pages',exact:true});await sheet.waitFor();
 for(const label of spoofed){assert.equal(await sheet.getByRole('link',{name:label,exact:true}).count(),0,label+' is not presented as a fixed control');await sheet.getByRole('link',{name:label+', your page',exact:true}).waitFor();}
 await page.keyboard.press('Escape');await sheet.waitFor({state:'detached'});

 phase('dashboard and Chat outage leave the Help controls intact');
 state.failChat=true;state.failDashboard=true;await page.reload();await composer().waitFor();
 await activate(helpButton());for(const name of essentials)await help().getByRole('link',{name:new RegExp('^'+name.replace(/[&]/g,'\\&'))}).waitFor();
 await page.keyboard.press('Escape');await help().waitFor({state:'detached'});
 state.failChat=false;state.failDashboard=false;

 phase('each essential page opens by keyboard; browser return keeps the draft');
 const headings={'Saved work':'Saved work','Site & app safety':'Site & app safety','Support':'Support','Account & security':'Account security'};
 for(const name of essentials){
  await page.reload();await composer().waitFor();
  await activate(helpButton());await activate(help().getByRole('link',{name:new RegExp('^'+name.replace(/[&]/g,'\\&'))}));
  await page.getByRole('heading',{name:headings[name],exact:true}).first().waitFor();
  await page.goBack();await composer().waitFor();assert.equal(await composer().inputValue(),draft,'Returning from '+name+' keeps the composer draft');
 }

 phase('reopened Chat item, project locator and provider/checkout returns survive');
 const turn=crypto.randomUUID(),revision=(await db.prepare('SELECT revision FROM workspace_state WHERE user_id=?').bind(user).first()).revision+1;
 await db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'ai','completed')").bind(turn,user,revision,'Synthetic saved review request','Synthetic saved result.').run();
 await db.prepare('UPDATE workspace_state SET revision=? WHERE user_id=?').bind(revision,user).run();
 await page.goto(origin+'/workspace?turn='+turn);const reopened=page.locator(`[data-saved-turn-id="${turn}"]`);await reopened.waitFor();
 await activate(helpButton());await activate(help().getByRole('link',{name:/^Support/}));await page.getByRole('heading',{name:'Support',level:1}).waitFor();
 await activate(page.getByRole('link',{name:'Back to Whumpo',exact:true}));await composer().waitFor();await reopened.waitFor();
 assert.equal(new URL(page.url()).searchParams.get('turn'),null,'Back to Whumpo carries no locator; the per-tab return point reopens the item');
 await page.reload();await reopened.waitFor();assert.equal(await composer().inputValue(),draft);
 const selected=()=>page.waitForFunction(id=>document.querySelector('#workspace-content select')?.value===id,project,{timeout:15000});
 await page.goto(origin+'/workspace/photos?project='+project);await selected();
 await activate(helpButton());await activate(help().getByRole('link',{name:/^Saved work/}));await page.getByRole('heading',{name:'Saved work',level:1}).waitFor();
 await page.goBack();await page.waitForURL(url=>new URL(url).pathname==='/workspace/photos');await selected();// Browser return keeps the selected project.
 await page.goto(origin+'/workspace/?connection=github');await page.waitForURL(url=>new URL(url).pathname==='/workspace/connections');
 await page.getByText('Checking the latest connection status…',{exact:true}).waitFor();
 await page.goto(origin+'/workspace/?checkout=canceled');await page.waitForURL(url=>new URL(url).pathname==='/workspace/billing');
 await activate(bar().getByRole('link',{name:'Chat',exact:true}));await composer().waitFor();await reopened.waitFor();assert.equal(await composer().inputValue(),draft,'Provider and checkout returns keep the draft and reopened item');
 await activate(page.getByRole('button',{name:'Close saved item',exact:true}));await reopened.waitFor({state:'detached'});

 phase('fixed pages return to the page they were opened from, else Dashboard');
 const openEssential=async name=>{await activate(helpButton());await activate(help().getByRole('link',{name:new RegExp('^'+name.replace(/[&]/g,'\\&'))}));};
 const returnTo=async(label,path)=>{await activate(page.getByRole('link',{name:'Back to '+label,exact:true}));await page.waitForURL(url=>new URL(url).pathname===path);};
 await activate(bar().getByRole('link',{name:'Dashboard',exact:true}));await openEssential('Saved work');await returnTo('Dashboard','/workspace/dashboard');
 await activate(bar().getByRole('link',{name:'Settings',exact:true}));await openEssential('Site & app safety');await returnTo('Settings','/workspace/settings');
 await activate(bar().getByRole('link',{name:'Chat',exact:true}));await openEssential('Account & security');await returnTo('Whumpo','/workspace');await composer().waitFor();
 await activate(bar().getByRole('button',{name:'Your pages',exact:true}));await activate(page.getByRole('dialog',{name:'Your pages',exact:true}).getByRole('link',{name:'Garden desk',exact:true}));
 await openEssential('Saved work');await returnTo('your page','/workspace/tab-generated-5');
 for(const [path,label,target] of [['/workspace/saved-work','Dashboard','/workspace/dashboard'],['/workspace/safety','Dashboard','/workspace/dashboard'],['/workspace/security','Dashboard','/workspace/dashboard']]){await page.goto(origin+path);await returnTo(label,target);}
 await page.goto(origin+'/workspace/billing');await returnTo('Settings','/workspace/settings');
 await page.goto(origin+'/workspace/photos');await returnTo('Dashboard','/workspace/dashboard');

 phase('superseded /workspace/chat alias is not a route');
 await page.goto(origin+'/workspace/chat');await page.getByRole('heading',{name:'Page not found',exact:true}).waitFor();assert.equal(await composer().count(),0);
 await activate(page.getByRole('link',{name:'Return to Chat',exact:true}));await composer().waitFor();

 phase('real inference-outage reply: the delivery banner links to support; a refused retry keeps its link');
 await page.unroute('**/api/workspace/dashboard');
 const posts=()=>requests.filter(r=>r.method==='POST'&&r.path==='/api/chat').length,firstPost=posts();
 const sent='Synthetic delivery check';await enter(composer(),sent);await activate(page.getByRole('button',{name:'Send message',exact:true}));
 // The current Worker has no model configured: it answers 503 with its own support link.
 const banner=page.getByRole('alert').filter({hasText:'The connection dropped'});await banner.waitFor();
 const bannerHelp=banner.getByRole('link',{name:'Get help with this',exact:true});
 assert.equal(new URL(await bannerHelp.getAttribute('href'),origin).searchParams.get('ref'),'status:chat_unavailable');
 await activate(bannerHelp);await page.getByRole('heading',{name:'Support',level:1}).waitFor();
 await page.getByRole('heading',{name:'Chat is unavailable',level:3}).waitFor();assert.match(await page.getByText(/^Related to:/).innerText(),/Chat is unavailable/);
 await page.goBack();await composer().waitFor();
 // Returning re-reads the conversation, so Retry becomes available without resending anything.
 await page.getByText('Your interrupted request hasn’t been confirmed yet.',{exact:false}).waitFor();assert.equal(posts(),firstPost+1);
 let intercepted=0;
 await page.route('**/api/chat',async route=>{if(route.request().method()!=='POST')return route.fallback();intercepted++;await route.fulfill({status:429,json:{error:'Too many requests. Try again in a minute.',support:'/workspace/support?ref=status:usage_limit'}});});
 await activate(page.getByRole('button',{name:'Retry message',exact:true}));
 const refused=page.getByRole('alert').filter({hasText:'Too many requests'});await refused.waitFor();
 assert.equal(new URL(await refused.getByRole('link',{name:'Get help with this',exact:true}).getAttribute('href'),origin).searchParams.get('ref'),'status:usage_limit');
 assert.equal(await page.getByRole('button',{name:'Retry message',exact:true}).count(),0,'A refused request is not retried');
 await activate(refused.getByRole('button',{name:'Dismiss',exact:true}));await refused.waitFor({state:'detached'});await focused(composer(),'Dismiss returns to the composer');
 await page.unroute('**/api/chat');assert.equal(intercepted,1);
 assert.equal((await db.prepare('SELECT count(*) n FROM chat_turns WHERE user_text=?').bind(sent).first()).n,0,'Nothing was saved or duplicated');

 phase('200% zoom, large text and reduced motion');
 await page.setViewportSize({width:640,height:422});await composer().waitFor();assert(await fits(),'200% zoom (640px CSS width) has no horizontal scroll');
 await activate(helpButton());for(const name of essentials){const link=help().getByRole('link',{name:new RegExp('^'+name.replace(/[&]/g,'\\&'))});await link.scrollIntoViewIfNeeded();await inView(link,'zoomed '+name,422);}
 await page.screenshot({path:'/tmp/whumpo-navigation-zoom-200.png'});await page.keyboard.press('Escape');await help().waitFor({state:'detached'});
 await page.setViewportSize({width:390,height:844});const large=await page.addStyleTag({content:'html{font-size:32px!important}'});
 assert(await fits(),'Large text keeps the bar within the screen');await activate(helpButton());await help().getByRole('button',{name:'Sign out',exact:true}).scrollIntoViewIfNeeded();assert(await fits());
 await page.screenshot({path:'/tmp/whumpo-navigation-large-text.png'});await page.keyboard.press('Escape');await help().waitFor({state:'detached'});await large.evaluate(e=>e.remove());
 await page.emulateMedia({reducedMotion:'reduce'});await activate(helpButton());
 const motion=await help().evaluate(e=>{const s=getComputedStyle(e);return {animation:s.animationName,transition:s.transitionDuration};});
 assert.equal(motion.animation,'none');assert(motion.transition.split(',').every(v=>parseFloat(v)===0),JSON.stringify(motion));
 await page.keyboard.press('Escape');await help().waitFor({state:'detached'});await focused(helpButton(),'Reduced-motion close returns focus');await page.emulateMedia({reducedMotion:'no-preference'});

 phase('simulated phone keyboard keeps the composer visible and restores navigation');
 await enter(composer(),draft);
 await page.evaluate(()=>{Object.defineProperty(visualViewport,'height',{configurable:true,value:430});visualViewport.dispatchEvent(new Event('resize'));});
 await page.waitForFunction(()=>document.documentElement.classList.contains('phone-keyboard'));
 await inView(composer(),'Composer above the simulated keyboard',430);assert.equal(await bar().isVisible(),false,'The bar steps aside while typing');
 await page.screenshot({path:'/tmp/whumpo-navigation-keyboard.png'});
 await page.evaluate(()=>{delete visualViewport.height;visualViewport.dispatchEvent(new Event('resize'));});
 await page.waitForFunction(()=>!document.documentElement.classList.contains('phone-keyboard'));await helpButton().waitFor();
 assert.equal(await composer().inputValue(),draft);

 phase('desktop: essentials stay visible beside eight generated pages');
 await page.route('**/api/workspace/dashboard',async route=>{const reply=await route.fetch();const json=await reply.json();if(reply.ok())json.layout={...json.layout,tabs:pages};await route.fulfill({response:reply,json});});
 await page.setViewportSize({width:1280,height:900});await page.reload();await composer().waitFor();await page.waitForLoadState('networkidle');
 const desktop=page.getByRole('navigation',{name:'Help and account',exact:true}),workspace=page.getByRole('navigation',{name:'Workspace',exact:true});
 for(const label of spoofed)await workspace.getByRole('link',{name:label+', your page',exact:true}).waitFor();
 const desktopTree=await desktop.ariaSnapshot();for(const name of essentials)assert.match(desktopTree,new RegExp('link "'+name.replace(/[&]/g,'\\&')+'"'),desktopTree);assert.match(desktopTree,/button "Sign out"/);
 for(const name of essentials)await inView(desktop.getByRole('link',{name,exact:true}),'desktop '+name,900);
 await page.screenshot({path:'/tmp/whumpo-navigation-desktop.png'});
 const desktopLarge=await page.addStyleTag({content:'html{font-size:24px!important}'});
 for(const name of essentials)await inView(desktop.getByRole('link',{name,exact:true}),'desktop large text '+name,900);
 assert(await fits());await page.screenshot({path:'/tmp/whumpo-navigation-desktop-large.png'});await desktopLarge.evaluate(e=>e.remove());
 await page.unroute('**/api/workspace/dashboard');await page.setViewportSize({width:390,height:844});await composer().waitFor();

 phase('sign-out from Help clears device state; Back cannot reopen the private view');
 assert(await page.evaluate(()=>Object.keys(sessionStorage).some(key=>key.startsWith('whumpo.'))),'This tab holds recovery records before sign-out');
 await activate(helpButton());await activate(help().getByRole('button',{name:'Sign out',exact:true}));
 await page.getByRole('button',{name:'Sign in with a passkey',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>Object.keys(sessionStorage).filter(key=>key.startsWith('whumpo.')).length),0,'Sign-out clears drafts, locators and pending records');
 assert.equal(await page.evaluate(()=>JSON.stringify([...Object.entries(sessionStorage),...Object.entries(localStorage)]).includes('My unsent garden idea')),false,'Sign-out leaves no copy of the unsent draft in this browser');
 await page.goBack();await page.getByRole('button',{name:'Sign in with a passkey',exact:true}).waitFor();
 assert.equal(await composer().count(),0);assert.doesNotMatch(await page.locator('body').innerText(),/My unsent garden idea|Synthetic saved result/);
 await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})));await page.waitForLoadState('networkidle');assert.equal(await composer().count(),0,'A restored page needs fresh identity');
 // Back landed on an earlier history entry; signing in again opens that path with fresh reads only.
 await activate(page.getByRole('button',{name:'Sign in with a passkey',exact:true}));await bar().waitFor();
 await page.goto(origin+'/workspace');await composer().waitFor();await page.waitForLoadState('networkidle');
 assert.equal(await composer().inputValue(),'','A new sign-in starts without the earlier device draft');
 assert.equal(await page.locator(`[data-saved-turn-id="${turn}"]`).count(),0,'The earlier reopened item is not restored');
 assert.equal(await count('inference_calls'),beforeInference,'No model request during the whole journey');
}
