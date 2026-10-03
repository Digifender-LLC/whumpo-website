// Explicit opt-in real inference on one disposable synthetic deployed account.
// The caller owns release/identity verification and cleanup. No website apply,
// publication, real customer content, provider consent or billing activation.
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {currentFixtureModules} from './current-modules.mjs';
export async function verifyLiveTaskMemory({db,id,browser,workspaceToken,release,allowInference=false}){
 assert.equal(allowInference,true,'Live task memory requires explicit inference opt-in');
 const modules=await currentFixtureModules(['src/chat-interactions/store.ts','src/project-specification/store.ts','src/billing.ts']);
 const store=await modules.module('src/chat-interactions/store.ts'),site=await modules.module('src/project-specification/store.ts'),billing=await modules.module('src/billing.ts');
 const scope=modules.identity.admitWorkspace(db,await modules.identity.resolveIdentity(db,{version:1,client:'web',kind:'session',token:workspaceToken}));
 const row=(sql,...params)=>db.prepare(sql).bind(...params).first();
 const project=(await row('SELECT id FROM projects WHERE owner_user_id=?',id)).id,spec=await site.readSpecification(scope,id,project),origin=crypto.randomUUID();
 const revision=(await row('SELECT revision FROM workspace_state WHERE user_id=?',id)).revision+1;
 const request='Help plan a service-area update for this website. Before preparing any change, ask me which seasons I work; that detail is missing. Wait for my answer in a later message. Keep the submitted service area for the same task. Do not prepare a review yet, save an edit or publish.';
 await scope.batch([scope.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,?,?,'Share the public service area for this synthetic test.',datetime('now'),'ai','completed')").bind(origin,id,revision,request),scope.prepare('UPDATE workspace_state SET revision=? WHERE user_id=?').bind(revision,id)]);
 const form=await store.issueInformation(scope,id,{originTurnId:origin,projectId:project,purpose:'site.services@1',fields:[{id:'area',questionId:'service-area',required:true}]}),answer='Boise and Eagle, Idaho.';
 const before=(await row('SELECT count(*) n FROM inference_calls WHERE user_id=?',id)).n;
 const app=await chromium.launch({headless:true}),started=performance.now();let stage='open-form',acceptedTurn=null;
 try{
  const context=await app.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});await context.addCookies([{name:'__Host-whumpo_session',value:workspaceToken,domain:'whumpo.com',path:'/',secure:true,httpOnly:true,sameSite:'Lax'}]);
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(20000);
  await page.goto('https://whumpo.com/workspace');const card=page.locator('[data-interaction-id="'+form.envelope.id+'"]');
  await card.locator('[data-interaction-field="area"] input').fill(answer);
  await card.getByRole('button',{name:'Save and continue',exact:true}).click();
  stage='initial-continuation';
  await card.getByText('Whumpo’s follow-up is ready in Chat. Review any preview before approving changes or publishing.',{exact:true}).waitFor({timeout:120000});
  const submitted=await store.readInteraction(scope,id,form.envelope.id),submission=submitted.submission.id;
  acceptedTurn=submission;
  const initial=await row('SELECT * FROM chat_task_progress WHERE turn_id=?',submission);assert(initial);assert.equal(initial.state,'active');assert.match(initial.questions_json,/season|time of year/i);assert(JSON.parse(initial.questions_json).length>0);
  assert.equal((await row('SELECT count(*) n FROM project_spec_proposals WHERE id=?',submission)).n,0);
  const afterInitial=(await row('SELECT count(*) n FROM inference_calls WHERE user_id=?',id)).n;assert(afterInitial>before);
  await page.reload();await card.waitFor();assert.equal((await row('SELECT count(*) n FROM inference_calls WHERE user_id=?',id)).n,afterInitial);
  stage='natural-reply';
  const content='Spring and summer, answering your question for the Test Garden task. Use my submitted service area followed by one space and the exact words "Available in spring and summer." as only the Area section text. Prepare a private review, do not apply it.';
  const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/chat'&&r.request().method()==='POST',{timeout:120000});
  await page.getByRole('textbox',{name:'Message Whumpo'}).fill(content);await page.getByRole('button',{name:'Send message',exact:true}).click();
  const chatResponse=await response;assert.equal(chatResponse.status(),200);
  // The API may return a pending receipt. Poll only that accepted request, never resend.
  const sent=JSON.parse(chatResponse.request().postData());acceptedTurn=sent.id;let turn;
  for(let attempt=0;attempt<60;attempt++){
   const current=await browser.json('/api/chat');turn=current.turns.find(t=>t.id===sent.id);
   if(turn&&turn.status!=='pending')break;
   await new Promise(resolve=>setTimeout(resolve,1000));
  }
  assert.equal(turn?.status,'completed');
  stage='verify-task-review';
  const progress=await row('SELECT * FROM chat_task_progress WHERE turn_id=?',sent.id);assert(progress);assert.equal(progress.previous_turn_id,submission);assert.equal(progress.questions_json,'[]');
  assert.equal((await row('SELECT ai_context_allowed FROM chat_turns WHERE id=?',sent.id)).ai_context_allowed,0);
  const review=await site.readSpecificationProposal(scope,id,sent.id),diff=JSON.parse(review.diff_json);assert.equal(diff.length,1);assert.equal(diff[0].before,'Our neighborhood.');assert.equal(diff[0].after,answer+' Available in spring and summer.');assert.equal(review.project_id,project);
  assert.equal((await site.readSpecification(scope,id,project)).revision,spec.revision);
  assert.equal((await row('SELECT count(*) n FROM publications WHERE project_id=?',project)).n,0);assert.equal((await billing.getBilling(scope,id)).standardAI.creditCharge,0);
  assert.equal((await row('SELECT count(*) n FROM chat_task_progress WHERE submission_id=?',submission)).n,2);
  const usage=(await db.prepare('SELECT role,status,input_tokens,output_tokens,cost_basis,estimated_micros FROM inference_calls WHERE user_id=? ORDER BY created_at,id').bind(id).all()).results;
  assert.equal(usage.filter(r=>r.role==='orchestrator').length,2);assert(usage.filter(r=>r.role==='orchestrator').every(r=>r.status==='observed'&&r.cost_basis==='subscription-shadow'));
  await browser.json('/api/chat','POST',sent);await page.reload();
  // The composer is mounted during loading too. Wait for the actual saved turn
  // before checking reload evidence or capturing the mobile conversation.
  await page.getByText(content,{exact:true}).waitFor();await page.locator('.message-content').last().scrollIntoViewIfNeeded();
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  assert.equal((await row('SELECT count(*) n FROM inference_calls WHERE user_id=?',id)).n,usage.length);
  assert.deepEqual((await store.readInteraction(scope,id,form.envelope.id)).submission.answers,{area:answer});assert.deepEqual(errors,[]);
  await page.screenshot({path:'/tmp/whumpo-live-task-memory-390.png',fullPage:true});
  const inspections=(await row('SELECT count(*) n FROM agent_inspections WHERE turn_id IN (?,?)',submission,sent.id)).n;
  return {release,at:new Date().toISOString(),mobileWidth:390,realInference:true,syntheticOnly:true,initialQuestions:JSON.parse(initial.questions_json).length,remainingQuestions:0,mainCalls:2+inspections,acknowledgmentReceipts:usage.filter(r=>r.role==='ack').length,elapsedMs:Math.round(performance.now()-started),exactOneSectionReview:true,savedWebsiteRevision:spec.revision,unchangedSavedWebsite:true,publications:0,customerCredits:0,immutableSubmittedAnswers:true,reloadAndReplayWithoutDispatch:true,taskProgressReceipts:2,usage,pageErrors:0,physicalDevice:false};
 }catch(error){
  // Capture the accepted request's safe receipt fields before the caller deletes
  // this synthetic fixture. Never retry an unknown request to obtain diagnostics.
  try{error.taskMemoryDiagnostic={release,at:new Date().toISOString(),stage,acceptedTurn,
   turns:(await db.prepare('SELECT id,status,assistant_text,ai_context_allowed,input_tokens,output_tokens FROM chat_turns WHERE user_id=? ORDER BY revision').bind(id).all()).results,
   requests:(await db.prepare('SELECT id,state,input_tokens,output_tokens FROM standard_ai_requests WHERE user_id=? ORDER BY created_at').bind(id).all()).results,
   inference:(await db.prepare('SELECT id,turn_id,role,status,input_tokens,output_tokens,cost_basis,estimated_micros FROM inference_calls WHERE user_id=? ORDER BY created_at,id').bind(id).all()).results,
   inspections:(await db.prepare('SELECT turn_id,input_tokens,output_tokens FROM agent_inspections WHERE user_id=?').bind(id).all()).results,
   progress:(await db.prepare('SELECT turn_id,previous_turn_id,state FROM chat_task_progress WHERE user_id=?').bind(id).all()).results};
  }catch{error.taskMemoryDiagnostic={release,stage,acceptedTurn,diagnosticReadFailed:true};}
  throw error;
 }finally{await app.close();}
}
