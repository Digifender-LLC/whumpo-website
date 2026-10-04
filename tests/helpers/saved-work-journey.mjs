import assert from 'node:assert/strict';

/** Actual built UI/Worker/current D1. The fixed Saved work page needs identity
 * only: profile, Chat and generated-dashboard outages cannot hide it. It reads
 * metadata and opens existing exact destinations without sending anything. */
export async function savedWorkJourney({page,db,state,requests,origin,activate,phase}){
 phase('saved work fixture');
 const user=(await db.prepare('SELECT owner_user_id id FROM projects').first()).id,start=(await db.prepare('SELECT revision FROM workspace_state WHERE user_id=?').bind(user).first()).revision;
 const turns=[],add=async(status,text)=>{const id=crypto.randomUUID(),revision=start+turns.length+1;turns.push(id);
  await db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'ai',?)").bind(id,user,revision,text,status==='uncertain'?'The AI response could not be confirmed. Your credits were not used, and this message will not be sent again automatically. Check your saved work before asking again.':status==='failed'?'':'Synthetic saved reply',status).run();return id;};
 const uncertain=await add('uncertain','Synthetic uncertain request'),failed=await add('failed','Synthetic failed request');
 for(let n=0;n<33;n++)await add('completed','Synthetic finished request '+n);
 await db.prepare('UPDATE workspace_state SET revision=? WHERE user_id=?').bind(start+turns.length,user).run();
 const savedTurns=async()=>(await db.prepare('SELECT count(*) n FROM chat_turns').first()).n,beforeTurns=await savedTurns(),beforeInference=(await db.prepare('SELECT count(*) n FROM inference_calls').first()).n;
 const items=page.locator('[data-saved-work-key]'),listed=()=>requests.filter(r=>r.path==='/api/workspace/saved-work'),mutations=()=>requests.filter(r=>r.path.startsWith('/api/')&&r.method!=='GET'&&!r.path.startsWith('/api/auth/identity/v1/')).length,beforeMutations=mutations();

 phase('dashboard outage opens saved work');
 state.failChat=true;state.failDashboard=true;await page.reload();await page.getByRole('textbox',{name:'Message Whumpo'}).waitFor();
 await activate(page.getByRole('link',{name:'Dashboard',exact:true}).filter({visible:true}));
 await page.getByRole('alert').filter({hasText:'Couldn’t load your dashboard'}).waitFor();
 await activate(page.getByRole('link',{name:'Saved work',exact:true}));
 await page.getByRole('heading',{name:'Saved work',level:1}).waitFor();await page.waitForFunction(()=>document.activeElement?.textContent==='Saved work');
 await items.first().waitFor();
 const directStart=requests.length;state.failProfile=true;await page.reload();await items.first().waitFor();await page.waitForLoadState('networkidle');
 assert(requests.slice(directStart).filter(r=>r.path.startsWith('/api/')).every(r=>r.path.startsWith('/api/auth/identity/v1/')||r.path==='/api/workspace/saved-work'),'Saved work never reads profile, Chat or dashboard');

 phase('open view groups truthful phases');
 assert.equal(await items.count(),2);assert.equal(await page.getByRole('heading',{name:'Chat request',level:3}).count(),1);
 const uncertainItem=page.locator(`[data-saved-work-key="chat:${uncertain}"]`),failedItem=page.locator(`[data-saved-work-key="chat:${failed}"]`);
 assert.match(await uncertainItem.innerText(),/Outcome not known yet/);assert.match(await uncertainItem.innerText(),/has not confirmed whether this finished/);assert.doesNotMatch(await uncertainItem.innerText(),/^Finished$/m);
 assert.match(await failedItem.innerText(),/Needs attention/);
 assert.equal(await page.getByRole('button',{name:'Show more',exact:true}).count(),0);

 phase('all view paginates with Show more');
 await activate(page.getByRole('button',{name:'All saved work',exact:true}));
 await page.getByRole('button',{name:'Show more',exact:true}).waitFor();assert.equal(await items.count(),30);
 assert.equal(await page.getByRole('button',{name:'All saved work',exact:true}).getAttribute('aria-pressed'),'true');
 const firstPage=await items.evaluateAll(list=>list.map(e=>e.dataset.savedWorkKey));
 await activate(page.getByRole('button',{name:'Show more',exact:true}));
 const total=(await db.prepare("SELECT count(*) n FROM chat_turns WHERE user_id=?").bind(user).first()).n;assert(total>30&&total<60);
 await page.waitForFunction(n=>document.querySelectorAll('[data-saved-work-key]').length>=n,total);
 const keys=await items.evaluateAll(list=>list.map(e=>e.dataset.savedWorkKey));assert.equal(new Set(keys).size,keys.length);assert(keys.length>=total);assert.deepEqual(keys.slice(0,30),firstPage);assert.deepEqual([...keys].sort(),keys,'Server key order is kept');
 for(const id of turns)assert(keys.includes('chat:'+id));
 await page.waitForFunction(key=>document.activeElement?.dataset?.savedWorkKey===key,keys[30]);
 assert.equal(await page.getByRole('button',{name:'Show more',exact:true}).count(),0);
 assert.equal(await page.locator('[data-saved-work-phase="uncertain"]').count(),1);

 phase('kind filter');
 await page.getByLabel('Type',{exact:true}).selectOption('photo');await page.getByText('No saved work matches this filter.',{exact:true}).waitFor();assert.equal(await items.count(),0);
 await page.getByLabel('Type',{exact:true}).selectOption('chat');await page.getByRole('button',{name:'Show more',exact:true}).waitFor();
 assert(listed().length>=6);

 phase('failed refresh hides cached rows');
 await page.route('**/api/workspace/saved-work?*',route=>route.fulfill({status:503,json:{error:'Synthetic saved-work outage'}}));
 await activate(page.getByRole('button',{name:'Check saved work again',exact:true}));
 await page.getByRole('alert').filter({hasText:'Synthetic saved-work outage'}).waitFor();assert.equal(await items.count(),0);
 await page.unroute('**/api/workspace/saved-work?*');
 await activate(page.getByRole('button',{name:'Check saved work again',exact:true}));await page.getByRole('button',{name:'Show more',exact:true}).waitFor();assert.equal(await items.count(),30);

 phase('mobile, desktop and large text');
 for(const width of [360,390,1280]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow at '+width);await page.screenshot({path:'/tmp/whumpo-saved-work-'+width+'.png',fullPage:true});}
 await page.setViewportSize({width:390,height:844});await page.emulateMedia({reducedMotion:'reduce'});
 await page.addStyleTag({content:'html{font-size:32px!important}'});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No overflow at 200% text');await page.screenshot({path:'/tmp/whumpo-saved-work-large-text.png',fullPage:true});

 phase('exact Chat message opens without sending');
 state.failChat=false;state.failDashboard=false;state.failProfile=false;await page.reload();await page.getByRole('heading',{name:'Saved work',level:1}).waitFor();await uncertainItem.waitFor();
 const turnReads=()=>requests.filter(r=>r.path==='/api/chat/turns/'+uncertain).length;
 await activate(uncertainItem.getByRole('link',{name:/^Open message in Chat/}));
 await page.waitForURL(url=>new URL(url).searchParams.get('turn')===uncertain);
 const reopened=page.getByRole('region',{name:'Reopened message',exact:true});await reopened.getByText('The AI response could not be confirmed.',{exact:false}).waitFor();
 assert.equal(await reopened.getByRole('alert').count(),0,'The current client accepts the uncertain Chat status');
 assert(turnReads()>=1);assert.equal(await savedTurns(),beforeTurns);

 phase('late saved-work read after sign-out cannot restore private rows');
 await page.goto(origin+'/workspace/saved-work');await uncertainItem.waitFor();
 let release;await page.route('**/api/workspace/saved-work?*',async route=>{const reply=await route.fetch();await new Promise(done=>{release=()=>route.fulfill({response:reply}).then(done).catch(done);});});
 await activate(page.getByRole('button',{name:'Check saved work again',exact:true}));
 for(let i=0;!release&&i<300;i++)await new Promise(done=>setTimeout(done,20));assert(release);
 await activate(page.getByRole('button',{name:'Account help',exact:true}));const help=page.getByRole('dialog',{name:'Account help',exact:true});
 await help.getByRole('link',{name:'Saved work',exact:true}).waitFor();
 await help.getByRole('button',{name:'Sign out',exact:true}).waitFor();await activate(help.getByRole('button',{name:'Sign out',exact:true}));
 await page.getByRole('button',{name:'Sign in with a passkey',exact:true}).waitFor();
 await release();await page.unroute('**/api/workspace/saved-work?*');await page.waitForLoadState('networkidle');
 assert.equal(await items.count(),0);assert.doesNotMatch(await page.locator('body').innerText(),/Synthetic|Outcome not known/);
 await activate(page.getByRole('button',{name:'Sign in with a passkey',exact:true}));await page.getByRole('heading',{name:'Saved work',level:1}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Open work',exact:true}).getAttribute('aria-pressed'),'true','Filters reset after the account session changes');
 await uncertainItem.waitFor();
 assert.equal(mutations(),beforeMutations,'Saved work sends no workspace mutation');assert.equal(await savedTurns(),beforeTurns);
 assert.equal((await db.prepare('SELECT count(*) n FROM inference_calls').first()).n,beforeInference);
 await page.goto(origin+'/workspace');await page.getByRole('textbox',{name:'Message Whumpo'}).waitFor();
 console.log('Saved work browser passed: signed owner, fixed Dashboard link during Chat/dashboard outage, direct reload with profile/Chat/dashboard outages, open/all views, kind filter, Show more pagination beyond 30 items with focus on the first new item, failed-refresh row hiding, 360/390/1280px and 200% text, exact uncertain Chat message reopened, Account help link and late read after sign-out. No mutation, inference or provider call.');
}
