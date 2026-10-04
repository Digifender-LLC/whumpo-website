// Explicitly opted-in deployed inference, on a disposable synthetic account only.
// Caller verifies the pinned release, owns the account and removes every fixture.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {currentFixtureModules} from './current-modules.mjs';
export async function verifyLiveWorkspaceViews({db,id,browser,workspaceToken,release,evidenceDirectory,allowInference=false}){
 assert.equal(allowInference,true,'Deployed workspace lifecycle requires explicit inference opt-in');
 assert(evidenceDirectory.startsWith('.secrets/'));
 await mkdir(evidenceDirectory,{recursive:true,mode:0o700});
 const m=await currentFixtureModules(['src/chat-interactions/store.ts','src/feature-preview-grants.ts','src/billing.ts','src/project-specification/store.ts']);
 const store=await m.module('src/chat-interactions/store.ts'),grants=await m.module('src/feature-preview-grants.ts'),billing=await m.module('src/billing.ts'),site=await m.module('src/project-specification/store.ts');
 const scope=m.identity.admitWorkspace(db,await m.identity.resolveIdentity(db,{version:1,client:'web',kind:'session',token:workspaceToken}));
 const row=(sql,...params)=>db.prepare(sql).bind(...params).first(),rows=async(sql,...params)=>(await db.prepare(sql).bind(...params).all()).results;
 const project=(await row('SELECT id FROM projects WHERE owner_user_id=?',id)).id;
 await db.prepare("UPDATE projects SET name='Meadow Garden' WHERE id=? AND owner_user_id=?").bind(project,id).run();
 const now=Math.floor(Date.now()/1000);
 for(const projectId of [null,project])for(const operation of ['read','prepare'])await grants.issueFeaturePreviewGrant(db,{id:crypto.randomUUID(),userId:id,projectId,featureId:'core.editing',operation,purpose:'private-test-acceptance',reviewReference:'WH-109 '+release+' synthetic views',startsAt:now,endsAt:now+1800},'test');
 const view=widgets=>({version:1,projectId:project,widgets,shortcuts:[]});
 const current=()=>browser.json('/api/workspace/views/v1/layout');
 const calls=async()=>({receipts:(await row('SELECT count(*) n FROM inference_calls WHERE user_id=?',id)).n,lookups:(await row('SELECT count(*) n FROM agent_inspections WHERE user_id=?',id)).n});
 const assertView=(actual,widgets)=>assert.deepEqual({...actual,widgets:[...actual.widgets].sort()},{...view(widgets),widgets:[...widgets].sort()});
 assert.equal((await current()).revision,0,'Requires a fresh synthetic layout');
 await browser.json('/api/workspace/views/v1/mutate','POST',{version:1,requestId:crypto.randomUUID(),expectedRevision:0,operation:'createPage',page:{id:'tab-kept',label:'Keep this page',view:view(['storage'])}});
 const originalLayout=(await current()).layout,steps=[],errors=[];
 let temporary,originalTemporary,savedPage,phase='start',acceptedTurn,success=false;
 const app=await chromium.launch({headless:true});
 const context=await app.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await context.addCookies([{name:'__Host-whumpo_session',value:workspaceToken,domain:'whumpo.com',path:'/',secure:true,httpOnly:true,sameSite:'Lax'}]);
 const page=await context.newPage();page.setDefaultTimeout(25000);page.on('pageerror',e=>errors.push(e.message));
 const currentTemporary=()=>store.readInteraction(scope,id,temporary);
 async function chat(name,text,verify){
  phase=name;const record={name,success:false},before=await calls();steps.push(record);
  assert(before.receipts+before.lookups<28,'Bounded lifecycle call ceiling');
  await page.getByRole('link',{name:'Chat',exact:true}).click();
  await page.getByRole('textbox',{name:'Message Whumpo',exact:true}).fill(text);
  const responsePromise=page.waitForResponse(r=>r.url()==='https://whumpo.com/api/chat'&&r.request().method()==='POST',{timeout:150000});
  await page.getByRole('button',{name:'Send message',exact:true}).click();
  const response=await responsePromise;assert.equal(response.status(),200);
  const input=response.request().postDataJSON();acceptedTurn=input.id;let turn;
  for(let n=0;n<130;n++){turn=await row('SELECT id,status,assistant_text FROM chat_turns WHERE id=? AND user_id=?',input.id,id);if(turn&&turn.status!=='pending')break;await new Promise(done=>setTimeout(done,1000));}
  record.turn=turn;assert.equal(turn?.status,'completed');await verify(turn);
  const after=await calls();await browser.json('/api/chat','POST',input);assert.deepEqual(await calls(),after,'Exact replay dispatched inference');
  assert.deepEqual((await current()).layout.tabs.find(t=>t.id==='tab-kept'),originalLayout.tabs[0]);
  record.receipts=after.receipts-before.receipts;record.lookups=after.lookups-before.lookups;record.success=true;
  console.log(JSON.stringify({step:name,passed:true,deployed:true}));
 }
 async function openPage(name){await page.getByRole('button',{name:'Your pages',exact:true}).click();await page.getByRole('dialog').getByRole('link',{name,exact:true}).click();}
 try{
  await page.goto('https://whumpo.com/workspace');
  await chat('temporary','Show me just the project status and recent activity for Meadow Garden here in Chat. Do not add a sidebar page or change my dashboard.',async turn=>{
   temporary=(await row('SELECT id FROM chat_interactions WHERE origin_turn_id=?',turn.id)).id;originalTemporary=temporary;assertView((await currentTemporary()).envelope.definition.workspaceView,['projects','activity']);assert.deepEqual((await current()).layout,originalLayout);
  });
  await chat('correct-temporary','Change that Chat overview to show just project status and page requests instead of recent activity. Keep it in Chat.',async turn=>{
   temporary=(await row('SELECT id FROM chat_interactions WHERE origin_turn_id=?',turn.id)).id;assertView((await currentTemporary()).envelope.definition.workspaceView,['projects','traffic']);assert.equal((await store.readInteraction(scope,id,originalTemporary)).state,'superseded');
  });
  await chat('save-view','Save this same corrected overview as a sidebar page called Garden desk. Keep my dashboard and Keep this page unchanged.',async()=>{
   const state=await current();savedPage=state.layout.tabs.find(t=>t.label==='Garden desk');assert(savedPage);assert.deepEqual(savedPage.view,(await currentTemporary()).envelope.definition.workspaceView);assert.deepEqual(state.layout.dashboard,originalLayout.dashboard);
  });
  const saved=()=>page.locator('[data-view-component="projects"]');
  await openPage('Garden desk');await saved().getByText('Meadow Garden',{exact:true}).waitFor();assert.equal(await page.getByRole('textbox',{name:'Message Whumpo'}).count(),0);
  const reads=await calls();const refreshed=page.waitForResponse(r=>r.url()==='https://whumpo.com/api/workspace/views/v1/component'&&r.request().postDataJSON()?.kind==='projects');await saved().getByRole('button',{name:'Refresh projects',exact:true}).click();assert.equal((await refreshed).status(),200);await saved().getByText('Meadow Garden',{exact:true}).waitFor();assert.deepEqual(await calls(),reads);
  await page.getByText('This information is not available with your current access.',{exact:true}).waitFor();
  for(const width of [360,390]){await page.setViewportSize({width,height:844});await saved().getByText('Meadow Garden',{exact:true}).waitFor();await page.waitForFunction(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent==='Your pages');const r=b?.getBoundingClientRect();return r&&r.top>=0&&r.bottom<=innerHeight});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:evidenceDirectory+'/saved-'+width+'.png'});}
  await chat('update-view','Add recent activity to Garden desk, keeping its existing project status and page requests. Leave all my other pages and my dashboard as they are.',async()=>{
   savedPage=(await current()).layout.tabs.find(t=>t.id===savedPage.id);assertView(savedPage.view,['projects','traffic','activity']);assert.deepEqual((await current()).layout.dashboard,originalLayout.dashboard);
  });
  await chat('rename-view','Rename Garden desk to Garden pulse. Do not change its contents or any other page.',async()=>{
   const next=(await current()).layout.tabs.find(t=>t.id===savedPage.id);assert.equal(next.label,'Garden pulse');assert.deepEqual(next.view,savedPage.view);savedPage=next;
  });
  await chat('dashboard','Show only projects and recent activity on my main Dashboard. Keep Garden pulse and Keep this page unchanged.',async()=>{
   const state=await current();assert.deepEqual({...state.layout.dashboard,widgets:[...state.layout.dashboard.widgets].sort()},{version:1,projectId:null,widgets:['activity','projects'],shortcuts:[]});assert.deepEqual(state.layout.tabs.find(t=>t.id===savedPage.id),savedPage);
  });
  const dashboard=(await current()).layout.dashboard;
  await chat('remove-view','Remove Garden pulse from my sidebar. Keep its project and my other page and Dashboard.',async()=>{
   assert(!(await current()).layout.tabs.some(t=>t.id===savedPage.id));assert(await row('SELECT id FROM projects WHERE id=?',project));assert.deepEqual((await current()).layout.dashboard,dashboard);
  });
  await chat('undo-removal','Undo that removal so Garden pulse is back with the same contents. Leave the rest alone.',async()=>{
   const state=await current();assert.deepEqual(state.layout.tabs.find(t=>t.id===savedPage.id),savedPage);assert.deepEqual(state.layout.dashboard,dashboard);
  });
  phase='dismiss-read-reload';const before=await calls(),temp=()=>page.locator('[data-interaction-id="'+temporary+'"]');
  await temp().getByRole('button',{name:'Dismiss view',exact:true}).click();await temp().getByText('This Chat item is no longer available.',{exact:false}).waitFor();
  await openPage('Garden pulse');await saved().getByText('Meadow Garden',{exact:true}).waitFor();await page.reload();await saved().getByText('Meadow Garden',{exact:true}).waitFor();
  await page.getByRole('link',{name:'Chat',exact:true}).click();await temp().getByText('This Chat item is no longer available.',{exact:false}).waitFor();
  await page.getByRole('link',{name:'Settings',exact:true}).click();await page.getByRole('heading',{name:'Settings',exact:true}).waitFor();await page.getByRole('button',{name:'Help and account',exact:true}).click();await page.getByRole('dialog',{name:'Help and account'}).getByRole('link',{name:'Your profile',exact:true}).click();await page.getByRole('heading',{name:'Your profile',exact:true}).waitFor();
  assert.deepEqual(await calls(),before);assert.equal((await row('SELECT count(*) n FROM workspace_layout_receipts WHERE user_id=?',id)).n,7);
  for(const table of ['publications','site_versions','project_spec_proposals'])assert.equal((await row('SELECT count(*) n FROM '+table)).n,0);
  assert.equal((await row("SELECT count(*) n FROM standard_ai_requests WHERE user_id=? AND state<>'completed'",id)).n,0);
  assert.equal((await billing.getBilling(scope,id)).standardAI.creditCharge,0);assert.deepEqual(errors,[]);
  phase='shared-review-components';const reviewCalls=await calls();
  async function commitPrepared(turn,prepared,text){
   const revision=(await row('SELECT revision FROM workspace_state WHERE user_id=?',id)).revision+1;
   await scope.batch([scope.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,?,?,?,datetime('now'),'ai','pending')").bind(turn,id,revision,text,prepared.reply),...prepared.statements,scope.prepare("UPDATE chat_turns SET status='completed' WHERE id=?").bind(turn),scope.prepare('UPDATE workspace_state SET revision=? WHERE user_id=?').bind(revision,id)]);
  }
  const created=crypto.randomUUID();await commitPrepared(created,await site.createWebsite(scope,id,created,project,{name:'Meadow Garden',headline:'Synthetic garden',description:'Private deployed review verification',theme:'ocean',aboutTitle:'Our work',aboutText:'Seasonal planting.',sections:[],photos:[]}), 'Synthetic review fixture: create a private website');
  const review=crypto.randomUUID();await commitPrepared(review,await site.prepareSpecification(scope,id,review,{kind:'specification',operation:'change',projectId:project,expectedRevision:1,operations:[{type:'content.replace',contentId:'headline',text:'Garden together'}]}),'Synthetic review fixture: prepare a headline change');
  const reviewView=view(['reviews']);await browser.json('/api/workspace/views/v1/mutate','POST',{version:1,requestId:crypto.randomUUID(),expectedRevision:(await current()).revision,operation:'createPage',page:{id:'tab-review-proof',label:'Website reviews',view:reviewView}});
  const viewTurn=crypto.randomUUID(),viewRevision=(await row('SELECT revision FROM workspace_state WHERE user_id=?',id)).revision+1;
  await scope.batch([scope.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,?,'Synthetic review fixture: show exact reviews','Pending',datetime('now'),'ai','pending')").bind(viewTurn,id,viewRevision),scope.prepare('UPDATE workspace_state SET revision=? WHERE user_id=?').bind(viewRevision,id)]);
  const plan=await store.prepareWorkspaceView(scope,id,{originTurnId:viewTurn,view:reviewView});await scope.batch([...plan.statements,scope.prepare("UPDATE chat_turns SET status='completed',assistant_text='Synthetic exact website review.' WHERE id=?").bind(viewTurn)]);
  await page.reload();await openPage('Website reviews');const reviews=()=>page.locator('[data-view-component="reviews"]');
  await reviews().getByText('Meadow Garden',{exact:true}).waitFor();await reviews().locator('summary').focus();await page.keyboard.press('Enter');await reviews().getByText('Garden together',{exact:true}).waitFor();const comparison=await reviews().locator('ol').innerText();
  for(const width of [360,390]){await page.setViewportSize({width,height:844});await reviews().locator('h4').evaluate(el=>el.scrollIntoView({block:'start'}));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:evidenceDirectory+'/reviews-'+width+'.png'});}
  await page.getByRole('link',{name:'Chat',exact:true}).click();const chatReviews=()=>page.locator('[data-interaction-id="'+plan.interactionId+'"]').locator('[data-view-component="reviews"]');
  await chatReviews().getByText('Meadow Garden',{exact:true}).waitFor();await chatReviews().locator('summary').focus();await page.keyboard.press('Enter');await chatReviews().getByText('Garden together',{exact:true}).waitFor();assert.equal(await chatReviews().locator('ol').innerText(),comparison);
  await db.prepare("UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE user_id=? AND project_id=? AND feature_id='core.editing' AND operation='read'").bind(id,project).run();
  await chatReviews().getByRole('button',{name:'Refresh website reviews',exact:true}).click();await chatReviews().getByText('This information is not available with your current access.',{exact:true}).waitFor();assert.equal(await chatReviews().getByText('Garden together',{exact:true}).count(),0);
  await openPage('Website reviews');await reviews().getByText('This information is not available with your current access.',{exact:true}).waitFor();assert.equal(await reviews().getByText('Garden together',{exact:true}).count(),0);
  assert.deepEqual(await calls(),reviewCalls);assert.equal((await site.readSpecification(scope,id,project)).revision,1);assert.equal((await row('SELECT count(*) n FROM publications')).n,0);assert.deepEqual(errors,[]);success=true;
 }finally{
  if(!success)await page.screenshot({path:evidenceDirectory+'/failure.png'}).catch(()=>{});
  await app.close();
  const usage=await rows('SELECT role,status,input_tokens,output_tokens,cost_basis,estimated_micros FROM inference_calls WHERE user_id=? ORDER BY created_at,id',id);
  const report={release,at:new Date().toISOString(),success,phase,acceptedTurn,steps,usage,calls:await calls(),errors,scope:'Actual whumpo.com Worker/assets and D1 with synthetic signed identity, real Muse and 360/390px Chromium. No physical device, human enrollment, publication, billing, CMS or scanner acceptance.'};
  await writeFile(evidenceDirectory+'/report.json',JSON.stringify(report,null,2)+'\n',{mode:0o600,flag:'wx'});
 }
 return {release,success,steps:steps.length,evidenceDirectory,realInference:true,physicalDevice:false};
}
