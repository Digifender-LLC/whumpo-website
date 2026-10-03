// Opt-in deployed acceptance on a caller-owned disposable synthetic account.
// Uses the actual Worker, browser and configured model; never publishes a site.
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from '@playwright/test';
import {currentFixtureModules} from './current-modules.mjs';

export async function verifyLiveProjectIntake({db,id,browser,workspaceToken,release,evidenceDirectory,allowInference=false}){
 assert.equal(allowInference,true);assert(evidenceDirectory.startsWith('.secrets/'));
 await mkdir(evidenceDirectory,{recursive:true,mode:0o700});
 const m=await currentFixtureModules(['src/chat-interactions/store.ts','src/feature-preview-grants.ts','src/billing.ts','src/project-specification/store.ts']);
 const store=await m.module('src/chat-interactions/store.ts'),grants=await m.module('src/feature-preview-grants.ts'),billing=await m.module('src/billing.ts'),site=await m.module('src/project-specification/store.ts');
 const scope=m.identity.admitWorkspace(db,await m.identity.resolveIdentity(db,{version:1,client:'web',kind:'session',token:workspaceToken}));
 const row=(q,...p)=>db.prepare(q).bind(...p).first(),rows=async(q,...p)=>(await db.prepare(q).bind(...p).all()).results;
 const original=(await row('SELECT id FROM projects WHERE owner_user_id=?',id)).id,steps=[],errors=[],requests=new Map();
 let phase='setup',success=false,acceptedTurn,loseContinuation=false,lostReplies=0;
 const calls=async()=>({main:(await row("SELECT count(*) n FROM inference_calls WHERE user_id=? AND role<>'ack'",id)).n,ack:(await row("SELECT count(*) n FROM inference_calls WHERE user_id=? AND role='ack'",id)).n,lookups:(await row('SELECT count(*) n FROM agent_inspections WHERE user_id=?',id)).n});
 async function grant(projectId){const now=Math.floor(Date.now()/1000);for(const operation of ['read','prepare'])await grants.issueFeaturePreviewGrant(db,{id:crypto.randomUUID(),userId:id,projectId,featureId:'core.editing',operation,purpose:'private-test-acceptance',reviewReference:'WH-110B '+release+' synthetic intake',startsAt:now,endsAt:now+1800},'test');}
 await grant(null);await grant(original);
 const seed=crypto.randomUUID(),prepared=await site.createWebsite(scope,id,seed,original,{name:'Test Garden',headline:'A greener neighborhood',description:'Private deployment verification',theme:'forest',aboutTitle:'Our work',aboutText:'Seasonal planting.',sections:[{heading:'Services',text:'Planting and care.'}],photos:[]});
 const revision=(await row('SELECT revision FROM workspace_state WHERE user_id=?',id)).revision+1;
 await scope.batch([scope.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,?,'Synthetic initial private website',?,datetime('now'),'ai','pending')").bind(seed,id,revision,prepared.reply),...prepared.statements,scope.prepare("UPDATE chat_turns SET status='completed' WHERE id=?").bind(seed),scope.prepare('UPDATE workspace_state SET revision=? WHERE user_id=?').bind(revision,id)]);
 const app=await chromium.launch({headless:true}),context=await app.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await context.addCookies([{name:'__Host-whumpo_session',value:workspaceToken,domain:'whumpo.com',path:'/',secure:true,httpOnly:true,sameSite:'Lax'}]);
 const page=await context.newPage();page.setDefaultTimeout(25000);page.on('pageerror',e=>errors.push(e.message));
 const card=f=>page.locator('[data-interaction-id="'+f.envelope.id+'"]');
 await page.route('**/api/chat/interactions/v1/continue',async route=>{
  const input=route.request().postDataJSON();requests.set(input.submissionId,input);
  const response=await route.fetch({timeout:150000,maxRetries:0});
  if(loseContinuation&&response.status()===200){loseContinuation=false;lostReplies++;await route.fulfill({status:200,contentType:'application/json',body:''});}else await route.fulfill({response});
 });
 async function settled(turnId){let turn;for(let n=0;n<130;n++){turn=await row('SELECT id,status,assistant_text FROM chat_turns WHERE id=? AND user_id=?',turnId,id);if(turn&&turn.status!=='pending')break;await new Promise(done=>setTimeout(done,1000));}assert(turn&&turn.status!=='pending','Expected terminal Chat result');return turn;}
 async function chat(name,text,verify){
  phase=name;const record={name,success:false},before=await calls();steps.push(record);assert(before.main+before.lookups<24,'Bounded real-model call ceiling');
  await page.getByRole('textbox',{name:'Message Whumpo',exact:true}).fill(text);
  const pending=page.waitForResponse(r=>r.url()==='https://whumpo.com/api/chat'&&r.request().method()==='POST',{timeout:150000});await page.getByRole('button',{name:'Send message',exact:true}).click();
  const response=await pending;assert.equal(response.status(),200);const input=response.request().postDataJSON();acceptedTurn=input.id;record.turn=await settled(input.id);assert.equal(record.turn.status,'completed','Expected completed Chat result');await verify(record.turn);
  const after=await calls();await browser.json('/api/chat','POST',input);assert.deepEqual(await calls(),after,'Chat replay dispatched inference');record.calls={before,after};record.success=true;console.log(JSON.stringify({step:name,passed:true,deployed:true}));return record.turn;
 }
 async function issued(turn,template){const f=await row('SELECT id FROM chat_interactions WHERE origin_turn_id=? AND user_id=?',turn.id,id);assert(f,'Expected maintained form');const form=await store.readInteraction(scope,id,f.id);assert.equal(form.envelope.definition.template,template);return form;}
 async function submit(name,form,verify){
  phase=name;const record={name,success:false},before=await calls();steps.push(record);
  await card(form).getByRole('button',{name:'Save and continue',exact:true}).click();
  let observed;
  for(let n=0;n<150;n++){
   // Observe one immutable submission/operation row while browser draft saving
   // may still be finishing. The full form reader correctly rejects mixed revisions.
   observed=await row('SELECT c.id,c.state FROM chat_interaction_submissions s JOIN chat_interaction_continuations c ON c.id=s.id WHERE s.interaction_id=? AND s.user_id=?',form.envelope.id,id);
   if(observed&&['succeeded','failed'].includes(observed.state))break;
   await new Promise(done=>setTimeout(done,1000));
  }
  record.continuationState=observed?.state;
  if(observed)record.turn=await settled(observed.id);
  assert.equal(record.continuationState,'succeeded','Expected successful task continuation');
  assert.equal(record.turn.status,'completed','Expected completed task result');
  const saved=await store.readInteraction(scope,id,form.envelope.id);
  await card(form).getByText('Whumpo’s follow-up is ready in Chat. Review any preview before approving changes or publishing.',{exact:true}).waitFor();
  await verify(saved);
  const after=await calls(),input=requests.get(saved.submission.id);assert(input);await browser.json('/api/chat/interactions/v1/continue','POST',input);assert.deepEqual(await calls(),after,'Continuation replay dispatched inference');
  await page.reload();await card(saved).getByText('Whumpo’s follow-up is ready in Chat.',{exact:false}).waitFor();assert.deepEqual(await calls(),after,'Reload dispatched inference');record.calls={before,after};record.success=true;console.log(JSON.stringify({step:name,passed:true,deployed:true}));return saved;
 }
 try{
  await page.goto('https://whumpo.com/workspace');let brief;
  await chat('request-new-project-brief','I want to start another website project. Please show me a short form for its working name and what I want it to do; I have not supplied those details yet. Keep my existing Test Garden project unchanged.',async turn=>{brief=await issued(turn,'project-brief@1');});
  await card(brief).locator('[data-interaction-field="name"] input').fill('Meadow Garden');
  const purpose='A simple informational gardening website about seasonal planting, with a headline and a Services section. Use only this description and the working name; do not invent addresses, contact details or prices. Use a calm green theme.';
  await card(brief).locator('[data-interaction-field="purpose"] textarea').fill(purpose);loseContinuation=true;
  const saved=await submit('create-private-project-with-lost-reply',brief,async value=>{
   const target=value.envelope.scope.taskId;
   assert.equal((await row('SELECT created_project_id FROM chat_task_progress WHERE task_id=? AND created_project_id IS NOT NULL',target)).created_project_id,target);assert.equal((await row('SELECT count(*) n FROM projects WHERE owner_user_id=?',id)).n,2);assert.equal((await site.readSpecification(scope,id,target)).revision,1);assert.equal(lostReplies,1);
  }),target=saved.envelope.scope.taskId;await grant(target);
  let correction;
  await chat('correct-created-project-brief','On the Meadow Garden project brief I just submitted, propose changing the working name to Meadow Garden Studio. Keep the same task and other answer; show me the corrected form so I can review it. Do not create another project or change the website.',async turn=>{correction=await issued(turn,'project-brief@1');assert.equal(correction.envelope.scope.taskId,target);assert.equal(correction.previousInteractionId,brief.envelope.id);});
  assert.equal(await card(correction).locator('[data-interaction-field="name"] input').inputValue(),'Meadow Garden Studio');
  await submit('prepare-same-project-name-review',correction,async value=>{
   const nameReview=await site.readSpecificationProposal(scope,id,value.submission.id);assert.equal(nameReview.project_id,target);assert.equal((await row('SELECT name FROM projects WHERE id=?',target)).name,'Meadow Garden');assert.equal((await site.readSpecification(scope,id,target)).revision,1);assert.equal((await row('SELECT count(*) n FROM projects WHERE owner_user_id=?',id)).n,2);
  });
  let selected;
  await chat('request-project-selection','I want to change a headline on one of my websites, but I have not chosen which one yet. Show me a project picker. After I choose, prepare the headline Fresh gardens for every season. Keep this separate from the Meadow Garden naming task, and do not save or publish the change.',async turn=>{selected=await issued(turn,'project-select@1');});
  await card(selected).locator('select').selectOption(original);
  const selection=await submit('prepare-selected-project-headline-review',selected,async value=>{
   const review=await site.readSpecificationProposal(scope,id,value.submission.id);assert.equal(review.project_id,original);assert.equal((await site.readSpecification(scope,id,original)).revision,1);assert.match(await(await browser.call('/api/specification-reviews/'+review.id+'/preview')).text(),/Fresh gardens for every season/);
  });
  const reviews=(await row('SELECT count(*) n FROM project_spec_proposals WHERE user_id=?',id)).n;
  await chat('resume-selected-task','Continue the headline task for Test Garden. Is that prepared change still waiting for my approval? Do not change anything or start a new task.',async turn=>{const progress=await row('SELECT task_id,submission_id FROM chat_task_progress WHERE turn_id=?',turn.id);assert.equal(progress.task_id,selected.envelope.scope.taskId);assert.equal(progress.submission_id,selection.submission.id);assert.equal((await row('SELECT count(*) n FROM project_spec_proposals WHERE user_id=?',id)).n,reviews);});
  phase='read-reload-and-mobile';const before=await calls();await page.reload();await card(selection).getByText('Whumpo’s follow-up is ready in Chat.',{exact:false}).waitFor();assert.deepEqual(await calls(),before);
  await page.locator('.chat-scroll').hover();await page.mouse.wheel(0,-1600);await page.getByRole('button',{name:'Latest messages',exact:true}).waitFor();
  for(const width of [360,390]){
   await page.setViewportSize({width,height:844});await page.evaluate(()=>new Promise(done=>requestAnimationFrame(()=>requestAnimationFrame(done))));await card(selection).getByRole('heading',{name:'Choose the project you mean',exact:true}).scrollIntoViewIfNeeded();
   await page.waitForFunction(interactionId=>{const e=document.querySelector('[data-interaction-id="'+interactionId+'"] h2'),s=document.querySelector('.chat-scroll');return e&&s&&e.getBoundingClientRect().top>=s.getBoundingClientRect().top&&e.getBoundingClientRect().bottom<=s.getBoundingClientRect().bottom;},selection.envelope.id);
   await page.waitForFunction(interactionId=>document.querySelector('[data-interaction-id="'+interactionId+'"] select')?.selectedOptions[0]?.textContent==='Test Garden',selection.envelope.id);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:evidenceDirectory+'/selected-'+width+'.png'});
  }
  assert.equal((await row('SELECT count(*) n FROM publications')).n,0);assert.equal((await row('SELECT count(*) n FROM projects WHERE owner_user_id=?',id)).n,2);assert.equal((await site.readSpecification(scope,id,target)).revision,1);assert.equal((await site.readSpecification(scope,id,original)).revision,1);assert.equal((await billing.getBilling(scope,id)).standardAI.creditCharge,0);assert.deepEqual(errors,[]);success=true;
 }finally{
  if(!success)await page.screenshot({path:evidenceDirectory+'/failure.png'}).catch(()=>{});await app.close();
  const usage=await rows('SELECT role,status,input_tokens,output_tokens,cost_basis,estimated_micros FROM inference_calls WHERE user_id=? ORDER BY created_at,id',id);
  await writeFile(evidenceDirectory+'/report.json',JSON.stringify({release,at:new Date().toISOString(),success,phase,acceptedTurn,steps,usage,calls:await calls(),lostReplies,errors,scope:'Actual deployed Worker/current D1/browser and configured Muse; synthetic signed identity and public fictional brief only. No physical device, human enrollment, publication, provider activation, real billing, CMS or scanner acceptance.'},null,2)+'\n',{flag:'wx',mode:0o600});
 }
 return {release,success,steps:steps.length,lostReplies,evidenceDirectory,realInference:true,physicalDevice:false};
}
