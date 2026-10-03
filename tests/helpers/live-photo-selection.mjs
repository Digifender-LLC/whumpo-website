// Explicit opt-in caller owns disposable synthetic identity and final account cleanup.
// Synthetic metadata only: no image bytes, scanner, model or customer publication.
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {currentFixtureModules} from './current-modules.mjs';
export async function verifyLivePhotoSelection({db,id,browser,workspaceToken}){
 const modules=await currentFixtureModules(['src/chat-interactions/store.ts']);
 const store=await modules.module('src/chat-interactions/store.ts');
 const scope=modules.identity.admitWorkspace(db,await modules.identity.resolveIdentity(db,{version:1,client:'web',kind:'session',token:workspaceToken}));
 const project=(await db.prepare('SELECT id FROM projects WHERE owner_user_id=?').bind(id).first()).id;
 const run=(sql,...params)=>db.prepare(sql).bind(...params).run(),files=[];
 const client={versions:[1],fieldTypes:['resource'],bindings:['answer.value@1','interaction.answers@1','agent.task-continue@1','owned.photos@1']};
 const path='/api/chat/interactions/v1/',read=interactionId=>browser.json(path+'read','POST',{version:1,interactionId,client});
 let app;
 try{
  for(const [name,approved]of [['Synthetic garden view',true],['Synthetic path view',true],['Held metadata canary',false]]){
   const file=crypto.randomUUID();files.push(file);
   await run("INSERT INTO project_files(id,project_id,name,object_key,digest,size,width,height,status,created_at) VALUES(?,?,?,?,?,1024,640,480,'ready',datetime('now'))",file,project,name,'synthetic-no-object/'+file,'a'.repeat(64));
   if(approved)await run("UPDATE project_photo_safety SET state='approved',csam_check='clear',sexual_check='clear',scanner_reference='synthetic-no-bytes-no-detector',expires_at=? WHERE file_id=?",new Date(Date.now()+600000).toISOString(),file);
  }
  const turn=crypto.randomUUID(),revision=(await db.prepare('SELECT revision FROM workspace_state WHERE user_id=?').bind(id).first()).revision+1;
  await scope.batch([scope.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,?,'Plan with selected synthetic photos','Choose existing project photos.',datetime('now'),'ai','completed')").bind(turn,id,revision),scope.prepare('UPDATE workspace_state SET revision=? WHERE user_id=?').bind(revision,id)]);
  const form=await store.issueInformation(scope,id,{originTurnId:turn,projectId:project,purpose:'site.presentation@1',fields:[{id:'photos',questionId:'gallery-photos',required:true}]});
  assert.equal((await browser.call(path+'read','POST',{version:1,interactionId:form.envelope.id,client:{...client,bindings:client.bindings.filter(b=>b!=='owned.photos@1')}})).status,409);
  app=await chromium.launch({headless:true});const context=await app.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  await context.addCookies([{name:'__Host-whumpo_session',value:workspaceToken,domain:'whumpo.com',path:'/',secure:true,httpOnly:true,sameSite:'Lax'}]);
  const page=await context.newPage(),errors=[],byteRequests=[];page.setDefaultTimeout(30000);page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/\/api\/photos\/|\/files\/[^/]+\/content/.test(r.url()))byteRequests.push(r.url());});
  await page.goto('https://whumpo.com/workspace');
  const card=page.locator('[data-interaction-id="'+form.envelope.id+'"]'),choice=name=>card.getByRole('checkbox',{name:new RegExp(name)});
  await choice('Synthetic garden view').waitFor();assert.equal(await card.getByRole('checkbox').count(),2);assert.equal(await card.getByText('Held metadata canary').count(),0);
  await choice('Synthetic garden view').check();await Promise.all([page.waitForResponse(r=>r.url().endsWith(path+'mutate')&&r.status()===200),card.getByRole('button',{name:'Save draft',exact:true}).click()]);
  await card.getByText('Draft saved.',{exact:true}).waitFor();
  assert.deepEqual((await read(form.envelope.id)).draft,{photos:[files[0]]});
  await page.reload();await choice('Synthetic garden view').waitFor();assert(await choice('Synthetic garden view').isChecked());
  await run("UPDATE project_photo_safety SET state='blocked' WHERE file_id=?",files[0]);await card.getByRole('button',{name:'Check photos',exact:true}).click();
  await card.getByText('1 saved selection is not in this list.',{exact:false}).waitFor();assert(await card.getByRole('button',{name:'Save draft',exact:true}).isDisabled());assert.equal(await choice('Synthetic garden view').count(),0);
  await card.getByRole('button',{name:'Clear selection',exact:true}).click();await choice('Synthetic path view').check();
  await page.route('**/api/chat/interactions/v1/continue',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic photo probe pauses inference.',code:'continuation_unavailable'})}));
  await card.getByRole('button',{name:'Save and continue',exact:true}).click();await card.getByText('Synthetic photo probe pauses inference.',{exact:true}).waitFor();
  const saved=await read(form.envelope.id);assert.deepEqual(saved.submission.answers,{photos:[files[1]]});assert.equal(saved.submission.continuation.state,'not-started');
  await browser.json(path+'stop','POST',{version:1,submissionId:saved.submission.id});
  await card.getByRole('heading',{name:'Your website direction',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/whumpo-live-photo-selection-390.png'});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);assert.deepEqual(byteRequests,[]);
  return {mobileWidth:390,currentBindingRequired:true,approvedMetadataOnly:true,draftReload:true,revokedSelectionRefused:true,explicitReselection:true,submittedOnlySelectedIds:true,continuationIntercepted:true,imageBytesRequested:0,inference:false,physicalDevice:false};
 }finally{if(app)await app.close();for(const file of files)await run('DELETE FROM project_files WHERE id=? AND project_id=?',file,project);}
}
