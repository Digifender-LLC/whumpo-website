// Opt-in real Muse and synthetic local D1 only. No retry or remote publication.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
Error.stackTraceLimit=0;
if(process.env.RUN_LIVE_MUSE!=='1')throw Error('Set RUN_LIVE_MUSE=1 for existing Muse subscription testing');
const cases=[
 'Prepare a review to publish the latest saved Test Garden website. Ask me to select its project first. I will confirm the exact publication separately.',
 'I want the current private Test Garden site to go live. Let me choose the project, then prepare its publication review for my separate approval.'
];
await mkdir('.secrets',{recursive:true,mode:0o700});
const directory=await mkdtemp('.secrets/task-publication-model-');
const config={baseURL:'https://opencode.ai/zen/go/v1',model:'muse-spark-1.3-contributor',protocol:'responses',apiKey:(await readFile(process.env.WHUMPO_MUSE_KEY_FILE??'opencode.key','utf8')).trim()};
const m=await currentFixtureModules(['src/index.ts','src/ai-chat.ts','src/chat-interactions/store.ts','src/chat-interactions/model-continuation.ts','src/project-specification/store.ts','src/site-host.ts']);
const host=(await m.module('src/site-host.ts')).default,networkFetch=globalThis.fetch;let fixtureHost=null;
const worker=(await m.module('src/index.ts')).default,ai=await m.module('src/ai-chat.ts'),forms=await m.module('src/chat-interactions/store.ts'),follow=await m.module('src/chat-interactions/model-continuation.ts'),site=await m.module('src/project-specification/store.ts');
const fixture=await databaseFixture({d1:true}),db=fixture.db,id=()=>crypto.randomUUID(),results=[];
const startedAt=new Date().toISOString();let complete=false;
globalThis.fetch=async(input,init)=>{if(fixtureHost&&String(input)==='https://'+fixtureHost+'.whumpo.site/')return host.fetch(new Request(input,init),{DB:db});return networkFetch(input,init);};
try{
 for(const request of cases){
  const authority=await workspaceFixture(db,m.identity),user=authority.account,scope=await authority.scope();
  const result={request,success:false,calls:0,responses:[],diagnostics:[]};results.push(result);
  const originalWarn=console.warn;
  console.warn=message=>{const value=JSON.parse(message);assert.equal(value.event,'ai_proposal_rejected');result.diagnostics.push(value);};
  try{
   await db.prepare("INSERT INTO workspace_state(user_id,step,revision) VALUES(?,'ready',0)").bind(user).run();
   await db.prepare("INSERT INTO feature_preview_grants VALUES(?,1,?,NULL,'core.editing','prepare','private-test-acceptance','synthetic task-resumption cohort',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)").bind(id(),user).run();
   const project=id(),other=id();fixtureHost=project;
   for(const [target,name] of [[project,'Test Garden'],[other,'Meadow Garden']]){
    await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,?,'An informational gardening website','draft',datetime('now'),datetime('now'))").bind(target,user,name).run();
    for(const operation of ['read','prepare'])await db.prepare("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.editing',?,'private-test-acceptance','synthetic task-resumption cohort',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)").bind(id(),user,target,operation).run();
    const turn=id(),revision=(await db.prepare('SELECT revision FROM workspace_state WHERE user_id=?').bind(user).first()).revision+1;
    const prepared=await site.createWebsite(scope,user,turn,target,{name,headline:'A greener neighborhood',description:'Care for local gardens',theme:'forest',aboutTitle:'Our work',aboutText:'Seasonal planting.',sections:[{heading:'Services',text:'Planting and care.'}],photos:[]});
    await scope.batch([scope.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,?,'Create my private website',?,datetime('now'),'ai','pending')").bind(turn,user,revision,prepared.reply),...prepared.statements,scope.prepare("UPDATE chat_turns SET status='completed' WHERE id=?").bind(turn),scope.prepare('UPDATE workspace_state SET revision=? WHERE user_id=?').bind(revision,user)]);
   }

   for(const operation of ['read','prepare'])await db.prepare("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.publication',?,'private-test-acceptance','synthetic publication cohort',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)").bind(id(),user,project,operation).run();
   const origin=id();
   await db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,3,?,'Choose your project.',datetime('now'),'ai','completed')").bind(origin,user,request).run();
   await db.prepare('UPDATE workspace_state SET revision=3 WHERE user_id=?').bind(user).run();
   const form=await forms.issueProjectIntake(scope,user,{originTurnId:origin,template:'project-select@1'}),submission=id();
   await forms.mutateInteraction(scope,user,{version:1,requestId:submission,interactionId:form.envelope.id,definitionDigest:form.envelope.definitionDigest,expectedAnswerRevision:0,operation:'submit',answers:{project}});
   const transport=async(...args)=>{result.calls++;assert(result.calls<=10,'Unexpected additional model dispatch');const r=await fetch(...args),body=await r.clone().json();result.responses.push(body.output?.flatMap(x=>x.content??[]).find(x=>x.type==='output_text')?.text??null);return r;};
   const prepared=await follow.continueInformationTask(scope,user,submission,3,config,transport);
   assert.equal(prepared.submission.continuation.state,'succeeded');assert(result.calls<=2);
   const review=await db.prepare('SELECT * FROM publication_actions WHERE id=?').bind(submission).first(),version=(await site.readSpecification(scope,user,project)).versionId;
   assert(review,'Expected an exact publication review');assert.equal(review.project_id,project);assert.equal(review.version_id,version);assert.equal(review.kind,'publish');assert.equal(review.status,'pending');
   const pub=()=>db.prepare('SELECT version_id,revision FROM publications WHERE project_id=?').bind(project).first();assert.equal((await pub()).version_id,null);
   const send=async(text)=>{
    const turn=id(),revision=(await db.prepare('SELECT revision FROM workspace_state WHERE user_id=?').bind(user).first()).revision,before=result.calls;
    assert.equal((await ai.sendAIChat(scope,user,turn,revision,text,config,transport)).status,200);
    const saved=await db.prepare('SELECT status,assistant_text FROM chat_turns WHERE id=?').bind(turn).first();assert.equal(saved.status,'completed');
    const progress=await db.prepare('SELECT task_id,submission_id FROM chat_task_progress WHERE turn_id=?').bind(turn).first();assert.equal(progress?.task_id,form.envelope.scope.taskId);assert.equal(progress.submission_id,submission);
    assert.equal(result.calls,before+2);await ai.sendAIChat(scope,user,turn,revision,text,config,transport);assert.equal(result.calls,before+2,'Exact replay must not call the model');
    return {turn,...saved};
   };
   result.reopened=await send('Show that same Test Garden task’s pending publication review again. Do not prepare a new review or publish anything.');
   assert.equal((await db.prepare('SELECT review_id FROM publication_chat_links WHERE turn_id=?').bind(result.reopened.turn).first())?.review_id,submission);
   result.pending=await send('Has the publication from that task been approved yet? Check its actual status without changing anything.');
   assert.equal(JSON.parse(result.responses.at(-1)).action,null);assert.match(result.pending.assistant_text,/await|wait|pending|not.{0,25}approv|hasn.t.{0,25}approv/i);
   assert.equal((await db.prepare('SELECT count(*) n FROM publication_actions WHERE user_id=?').bind(user).first()).n,1);assert.equal((await pub()).version_id,null);
   const control={id:id(),revision:(await db.prepare('SELECT revision FROM workspace_state WHERE user_id=?').bind(user).first()).revision,action:{type:'confirm',kind:'site',reviewId:submission}};
   const response=await worker.fetch(new Request('https://whumpo.com/api/chat/actions',{method:'POST',headers:{origin:'https://whumpo.com',cookie:'__Host-whumpo_session='+authority.token,'content-type':'application/json'},body:JSON.stringify(control)}),{DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}},{waitUntil(){}});
   assert.equal(response.status,200,await response.clone().text());assert.equal((await pub()).version_id,version);
   result.applied=await send('Did that same task’s publication finish? Check the recorded result; do not change or republish anything.');
   assert.equal(JSON.parse(result.responses.at(-1)).action,null);assert.match(result.applied.assistant_text,/publish|public|live/i);assert.doesNotMatch(result.applied.assistant_text,/waiting for (?:your )?approval|still pending|not (?:been )?published/i);
   assert.equal((await site.readSpecification(scope,user,project)).revision,1);assert.equal((await site.readSpecification(scope,user,other)).revision,1);assert.equal((await pub()).revision,1);
   assert.equal((await db.prepare('SELECT count(*) n FROM publications WHERE project_id=?').bind(other).first()).n,0);
   result.success=true;
  }finally{console.warn=originalWarn;await db.prepare('DELETE FROM users WHERE id=?').bind(user).run();}
  console.log(JSON.stringify({request,success:result.success,calls:result.calls}));
 }
 complete=true;
}finally{
 globalThis.fetch=networkFetch;await fixture.close();
 await writeFile(directory+'/report.json',JSON.stringify({startedAt,completedAt:new Date().toISOString(),complete,results,localFixtureRemoved:true,scope:'Two frozen selected-task publication preparation, exact reopening, pending status, typed user confirmation and applied-status conversations with real Muse and local D1. Publication exists only in the synthetic local database. No deployed, physical-device or general reliability claim.'},null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({directory,complete,passed:results.filter(r=>r.success).length,total:cases.length}));
}
