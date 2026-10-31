import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {hearOrca} from './orca-output.mjs';

/** Continues the actually enrolled owner's welcome into real Chat handlers.
 * Only model interpretation and transport faults are synthetic. */
export async function ownerUsabilityJourney({page,context,db,env,state,origin,activate,enter,reach,phase,audit}){
 const project=await db.prepare('SELECT id,owner_user_id FROM projects').first();assert(project);
 for(const operation of ['prepare','read'])await db.prepare("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.editing',?,'private-test-acceptance','synthetic owner usability journey',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)").bind(crypto.randomUUID(),project.owner_user_id,project.id,operation).run();
 // Account-wide dashboard reads need their own exact preview grant.
 await db.prepare("INSERT INTO feature_preview_grants VALUES(?,1,?,NULL,'core.editing','read','private-test-acceptance','synthetic owner dashboard audit',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)").bind(crypto.randomUUID(),project.owner_user_id).run();
 Object.assign(env,{ENVIRONMENT:'test',AI_BASE_URL:'https://opencode.ai/zen/go/v1',AI_MODEL:'muse-spark-1.3-contributor',AI_PROTOCOL:'responses',AI_API_KEY:'synthetic-only-no-real-key'});
 const composer=()=>page.getByRole('textbox',{name:'Message Whumpo'}),navigation=()=>page.getByRole('navigation',{name:'Mobile workspace'});
 const count=async table=>(await db.prepare('SELECT count(*) n FROM '+table).first()).n;
 phase('unaccepted Chat request survives reload and exact keyboard retry');
 await page.reload();await composer().waitFor();
 state.steps.push({kind:'specification',operation:'create',projectId:project.id,config:{name:'Garden care',headline:'A greener neighborhood',description:'Friendly local landscaping.',theme:'forest',aboutTitle:'Our garden studio',aboutText:'Care for our neighbors.',sections:[],photos:[]}});
 state.stopChat=true;
 await enter(composer(),'Build a website for my landscaping business from our welcome answers.');await activate(page.getByRole('button',{name:'Send message',exact:true}));
 await page.getByRole('button',{name:'Retry message',exact:true}).waitFor();assert.equal(state.calls,0);assert.equal(await count('site_versions'),0);
 await page.reload();await page.getByRole('button',{name:'Retry conversation',exact:true}).waitFor();assert.equal(state.calls,0);assert.equal(state.posts.length,1);
 state.failChat=false;await activate(page.getByRole('button',{name:'Retry conversation',exact:true}));await page.getByText('Your interrupted request hasn’t been confirmed yet.',{exact:false}).waitFor();
 await hearOrca('first website reply after exact retry',()=>activate(page.getByRole('button',{name:'Retry message',exact:true})),[/New reply from Whumpo in Chat/i]);
 await page.getByRole('link',{name:'Open private preview',exact:true}).waitFor({timeout:60000});assert.equal(state.calls,1);assert.equal(await count('site_versions'),1);assert.equal(state.posts.length,2);assert.deepEqual(state.posts[0],state.posts[1]);
 assert.equal(await count('publications'),0);
 phase('accepted Chat response loss is reconciled without resending');
 state.steps.push({kind:'specification',operation:'change',projectId:project.id,expectedRevision:1,operations:[{type:'content.replace',contentId:'headline',text:'Thoughtful gardens, happy neighbors'}]});state.loseChat=true;
 await enter(composer(),'Change my website headline to Thoughtful gardens, happy neighbors.');await activate(page.getByRole('button',{name:'Send message',exact:true}));await page.getByRole('button',{name:'Retry message',exact:true}).waitFor();assert.equal(state.calls,2);
 await page.reload();await page.getByRole('button',{name:'Retry conversation',exact:true}).waitFor();assert.equal(state.posts.length,3);
 state.failChat=false;await activate(page.getByRole('button',{name:'Retry conversation',exact:true}));await page.getByRole('button',{name:'Save reviewed private version',exact:true}).waitFor();await page.getByRole('button',{name:'Retry message',exact:true}).waitFor({state:'detached'});assert.equal(state.posts.length,3);assert.equal(state.calls,2);assert.equal(await count('site_versions'),1);
 phase('keyboard comparison, private preview and exact private save');
 const comparison=page.locator('summary').filter({hasText:'Proposed website changes'});await activate(comparison);const details=page.locator('details[open]').filter({hasText:'Proposed website changes'});
 await details.getByText('Thoughtful gardens, happy neighbors',{exact:true}).waitFor();assert.match(await details.innerText(),/Before[\s\S]*A greener neighborhood[\s\S]*After[\s\S]*Thoughtful gardens, happy neighbors/);
 assert.match(await details.innerText(),/Publishing requires a separate review/);await audit(page,'private-review');
 for(const width of [360,390]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await details.screenshot({path:'/tmp/whumpo-owner-comparison-'+width+'.png'});}
 const previewLink=page.getByRole('link',{name:'Preview proposed website',exact:true});
 const opened=page.waitForEvent('popup');await activate(previewLink);const preview=await opened;await preview.waitForLoadState('domcontentloaded');await preview.getByRole('heading',{name:'Thoughtful gardens, happy neighbors',exact:true}).waitFor();await preview.screenshot({path:'/tmp/whumpo-owner-private-preview.png',fullPage:true});await preview.close();await page.bringToFront();
 assert.equal(await count('site_versions'),1);assert.equal(await count('publications'),0);
 await hearOrca('saved private review reply',()=>activate(page.getByRole('button',{name:'Save reviewed private version',exact:true})),[/New reply from Whumpo in Chat/i]);
 await page.getByRole('button',{name:'Save reviewed private version',exact:true}).waitFor({state:'detached'});assert.equal(await count('site_versions'),2);assert.equal(await count('publications'),0);assert.equal(state.calls,2);
 phase('Dashboard unavailable, keyboard retry and newer focus');
 await enter(composer(),'A saved idea while I check my dashboard.');state.failDashboard=true;
 await activate(navigation().getByRole('link',{name:'Dashboard',exact:true}));await page.reload();await page.getByRole('button',{name:'Retry dashboard',exact:true}).waitFor();
 await hearOrca('Dashboard read recovery',async()=>{state.failDashboard=false;await activate(page.getByRole('button',{name:'Retry dashboard',exact:true}));},[/main content/i]);
 await page.getByRole('button',{name:'Retry dashboard',exact:true}).waitFor({state:'detached'});await page.locator('#workspace-content').getByText('Garden care',{exact:true}).first().waitFor();await page.waitForFunction(()=>document.querySelector('#workspace-content')===document.activeElement);
 assert.match(await page.locator('#workspace-content').innerText(),/Garden care/);await audit(page,'dashboard-after-retry');
 state.failDashboard=true;await page.reload();await page.getByRole('button',{name:'Retry dashboard',exact:true}).waitFor();state.failDashboard=false;state.holdDashboard=true;await activate(page.getByRole('button',{name:'Retry dashboard',exact:true}));
 for(let i=0;!state.releaseDashboard&&i<300;i++)await new Promise(done=>setTimeout(done,20));assert(state.releaseDashboard);
 const chatLink=navigation().getByRole('link',{name:'Chat',exact:true});await activate(chatLink);await composer().waitFor();assert.equal(await composer().inputValue(),'A saved idea while I check my dashboard.');
 state.releaseDashboard();state.releaseDashboard=null;await page.waitForLoadState('networkidle');assert(await chatLink.evaluate(e=>e===document.activeElement),'Read recovery must not steal newer navigation focus');assert.equal(state.calls,2);
 for(const width of [360,390,1280]){await page.setViewportSize({width,height:844});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'/tmp/whumpo-owner-chat-'+width+'.png'});}
 await page.setViewportSize({width:390,height:844});await audit(page,'chat-day');
 phase('truthful unavailable billing and provider controls');
 await activate(navigation().getByRole('link',{name:'Settings',exact:true}));
 await activate(page.getByRole('link',{name:'Billing & usage',exact:true}));await page.getByRole('heading',{name:'Billing',exact:true}).waitFor();
 assert.match(await page.locator('#workspace-content').innerText(),/Checkout isn't open yet. Explore is available without a card/);
 assert.match(await page.locator('#workspace-content').innerText(),/Advanced model credit purchases are not connected/);assert.equal(await page.getByRole('button',{name:'Continue to test checkout',exact:true}).count(),0);await audit(page,'billing-unavailable');
 await activate(navigation().getByRole('link',{name:'Settings',exact:true}));await activate(page.getByRole('link',{name:'External connections',exact:true}));
 await page.getByRole('button',{name:'Authorize with GitHub',exact:true}).waitFor();
 for(const provider of ['GitHub','Cloudflare'])assert(await page.getByRole('button',{name:'Authorize with '+provider,exact:true}).isDisabled());
 assert.equal(await page.getByText('Connection setup is not available yet.',{exact:true}).count(),2);await audit(page,'connections-unavailable');
 await activate(navigation().getByRole('link',{name:'Settings',exact:true}));await activate(page.getByRole('button',{name:'Night',exact:true}));await page.waitForFunction(()=>document.documentElement.classList.contains('dark'));
 await activate(navigation().getByRole('link',{name:'Chat',exact:true}));assert.equal(await composer().inputValue(),'A saved idea while I check my dashboard.');
 await audit(page,'chat-night');await page.screenshot({path:'/tmp/whumpo-owner-chat-night.png'});
 await activate(navigation().getByRole('link',{name:'Settings',exact:true}));await activate(page.getByRole('button',{name:'Day',exact:true}));await page.waitForFunction(()=>!document.documentElement.classList.contains('dark'));await activate(navigation().getByRole('link',{name:'Chat',exact:true}));
 assert.equal(state.steps.length,0);assert.equal(state.posts.length,3);assert.equal(await count('publications'),0);
 await writeFile('.secrets/usability-owner-journey.json',JSON.stringify({at:new Date().toISOString(),modelCalls:state.calls,chatPosts:state.posts.length,versions:2,publications:0,scope:'Actual enrolled owner/current Worker/D1/built React, virtual WebAuthn; scripted model replies and synthetic network interruptions. Keyboard and optional actual Orca. No external requests.'},null,2),{mode:0o600});
}
