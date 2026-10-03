// Opt-in real Muse, synthetic current local D1. No retry, publication or customer data.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
Error.stackTraceLimit=0;
if(process.env.RUN_LIVE_MUSE!=='1')throw Error('Set RUN_LIVE_MUSE=1 for existing Muse subscription testing');
const cases=[
 'Continue the headline task for Test Garden. Is that prepared change still waiting for my approval? Do not change anything or start a new task.',
 'What happened with the Test Garden headline change we just prepared? Have I approved it yet? Just check its status.'
];
await mkdir('.secrets',{recursive:true,mode:0o700});
const directory=await mkdtemp('.secrets/task-resumption-model-');
const config={baseURL:'https://opencode.ai/zen/go/v1',model:'muse-spark-1.3-contributor',protocol:'responses',apiKey:(await readFile(process.env.WHUMPO_MUSE_KEY_FILE??'opencode.key','utf8')).trim()};
const m=await currentFixtureModules(['src/index.ts','src/ai-chat.ts','src/chat-interactions/store.ts','src/chat-interactions/model-continuation.ts','src/project-specification/store.ts']);
const worker=(await m.module('src/index.ts')).default,ai=await m.module('src/ai-chat.ts'),forms=await m.module('src/chat-interactions/store.ts'),follow=await m.module('src/chat-interactions/model-continuation.ts'),site=await m.module('src/project-specification/store.ts');
const fixture=await databaseFixture({d1:true}),db=fixture.db,id=()=>crypto.randomUUID(),results=[];
const startedAt=new Date().toISOString();let complete=false;
try{
 for(const request of cases){
  const authority=await workspaceFixture(db,m.identity),user=authority.account,scope=await authority.scope();
  const result={request,success:false,calls:0,responses:[],diagnostics:[]};results.push(result);
  const originalWarn=console.warn;
  console.warn=message=>{const value=JSON.parse(message);assert.equal(value.event,'ai_proposal_rejected');result.diagnostics.push(value);};
  try{
   await db.prepare("INSERT INTO workspace_state(user_id,step,revision) VALUES(?,'ready',0)").bind(user).run();
   await db.prepare("INSERT INTO feature_preview_grants VALUES(?,1,?,NULL,'core.editing','prepare','private-test-acceptance','synthetic task-resumption cohort',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)").bind(id(),user).run();
   const project=id(),other=id();
   for(const [target,name] of [[project,'Test Garden'],[other,'Meadow Garden']]){
    await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,?,'An informational gardening website','draft',datetime('now'),datetime('now'))").bind(target,user,name).run();
    for(const operation of ['read','prepare'])await db.prepare("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.editing',?,'private-test-acceptance','synthetic task-resumption cohort',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)").bind(id(),user,target,operation).run();
    const turn=id(),revision=(await db.prepare('SELECT revision FROM workspace_state WHERE user_id=?').bind(user).first()).revision+1;
    const prepared=await site.createWebsite(scope,user,turn,target,{name,headline:'A greener neighborhood',description:'Care for local gardens',theme:'forest',aboutTitle:'Our work',aboutText:'Seasonal planting.',sections:[{heading:'Services',text:'Planting and care.'}],photos:[]});
    await scope.batch([scope.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,?,'Create my private website',?,datetime('now'),'ai','pending')").bind(turn,user,revision,prepared.reply),...prepared.statements,scope.prepare("UPDATE chat_turns SET status='completed' WHERE id=?").bind(turn),scope.prepare('UPDATE workspace_state SET revision=? WHERE user_id=?').bind(revision,user)]);
   }
   const origin=id();
   await db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,3,'Change my website headline to Fresh gardens for every season. Ask me which project first. Prepare a private review only; do not save or publish.','Choose your project.',datetime('now'),'ai','completed')").bind(origin,user).run();
   await db.prepare('UPDATE workspace_state SET revision=3 WHERE user_id=?').bind(user).run();
   const form=await forms.issueProjectIntake(scope,user,{originTurnId:origin,template:'project-select@1'}),submission=id();
   await forms.mutateInteraction(scope,user,{version:1,requestId:submission,interactionId:form.envelope.id,definitionDigest:form.envelope.definitionDigest,expectedAnswerRevision:0,operation:'submit',answers:{project}});
   const transport=async(...args)=>{result.calls++;assert(result.calls<=8,'Unexpected additional model dispatch');const r=await fetch(...args),body=await r.clone().json();result.responses.push(body.output?.flatMap(x=>x.content??[]).find(x=>x.type==='output_text')?.text??null);return r;};
   const prepared=await follow.continueInformationTask(scope,user,submission,3,config,transport);
   assert.equal(prepared.submission.continuation.state,'succeeded');assert.equal(result.calls,2);
   const review=await site.readSpecificationProposal(scope,user,submission);
   assert.equal(review.project_id,project);result.preparedDiff=JSON.parse(review.diff_json);assert.equal(result.preparedDiff.length,1);assert.equal(result.preparedDiff[0].label,'Headline');assert.match(result.preparedDiff[0].after,/^Fresh gardens for every season\.?$/);
   const turn=id(),revision=(await db.prepare('SELECT revision FROM workspace_state WHERE user_id=?').bind(user).first()).revision;
   const response=await ai.sendAIChat(scope,user,turn,revision,request,config,transport);assert.equal(response.status,200);
   result.turn=await db.prepare('SELECT status,assistant_text FROM chat_turns WHERE id=?').bind(turn).first();
   assert.equal(result.turn.status,'completed');
   const progress=await db.prepare('SELECT task_id,submission_id FROM chat_task_progress WHERE turn_id=?').bind(turn).first();
   assert(progress,'Expected task lookup rather than saved-website-only status');assert.equal(progress.task_id,form.envelope.scope.taskId);assert.equal(progress.submission_id,submission);
   const routing=JSON.parse(result.responses[2]),final=JSON.parse(result.responses[3]);
   assert.equal(routing.action.operation,'resumeTask');assert.equal(final.action,null,'A status question must not prepare another change');
   assert.match(final.reply,/await|wait|pending|not.{0,20}approv|hasn.t.{0,20}approv/i);
   assert.doesNotMatch(final.reply,/no (?:prepared|pending)|has not been prepared|already approved/i);
   assert.equal((await db.prepare('SELECT count(*) n FROM project_spec_proposals WHERE user_id=?').bind(user).first()).n,1);
   assert.equal((await site.readSpecification(scope,user,project)).revision,1);assert.equal((await site.readSpecification(scope,user,other)).revision,1);
   assert.equal((await db.prepare('SELECT count(*) n FROM publications').first()).n,0);assert.equal(result.calls,4);
   await ai.sendAIChat(scope,user,turn,revision,request,config,transport);assert.equal(result.calls,4,'Replay dispatched inference');
   const reopenTurn=id(),reopenRevision=(await db.prepare('SELECT revision FROM workspace_state WHERE user_id=?').bind(user).first()).revision;
   await ai.sendAIChat(scope,user,reopenTurn,reopenRevision,'Show me that same Test Garden task’s prepared review again so I can decide whether to save it. Do not prepare a new change or save anything.',config,transport);
   result.reopened=await db.prepare('SELECT status,assistant_text FROM chat_turns WHERE id=?').bind(reopenTurn).first();assert.equal(result.reopened.status,'completed');
   const link=await db.prepare('SELECT proposal_id FROM project_spec_chat_links WHERE turn_id=?').bind(reopenTurn).first();assert.equal(link?.proposal_id,submission);assert.equal(result.calls,6);assert.equal(JSON.parse(result.responses[5]).action.operation,'review');
   const exact=await site.readSpecificationProposal(scope,user,submission),control={id:id(),revision:(await db.prepare('SELECT revision FROM workspace_state WHERE user_id=?').bind(user).first()).revision,action:{type:'specificationApply',reviewId:exact.id,proposalDigest:exact.proposal_digest,expectedRevision:exact.expected_revision}};
   const approvalResponse=await worker.fetch(new Request('https://whumpo.com/api/chat/actions',{method:'POST',headers:{origin:'https://whumpo.com',cookie:'__Host-whumpo_session='+authority.token,'content-type':'application/json'},body:JSON.stringify(control)}),{DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}},{waitUntil(){}});
   assert.equal(approvalResponse.status,200,await approvalResponse.clone().text());await approvalResponse.json();assert.equal((await site.readSpecification(scope,user,project)).revision,2);assert.equal(result.calls,6);
   const receipt=await db.prepare('SELECT id,version_id FROM project_spec_applies WHERE proposal_id=?').bind(submission).first();assert(receipt);result.receipt=receipt;
   await db.prepare('DELETE FROM project_spec_proposals WHERE id=?').bind(submission).run();
   const savedTurn=id(),savedRevision=(await db.prepare('SELECT revision FROM workspace_state WHERE user_id=?').bind(user).first()).revision,savedRequest='Did I save that Test Garden task’s headline change? Check the actual saved outcome; do not change anything or publish it.';
   await ai.sendAIChat(scope,user,savedTurn,savedRevision,savedRequest,config,transport);
   result.savedStatus=await db.prepare('SELECT status,assistant_text FROM chat_turns WHERE id=?').bind(savedTurn).first();assert.equal(result.savedStatus.status,'completed');
   const savedProgress=await db.prepare('SELECT task_id,submission_id FROM chat_task_progress WHERE turn_id=?').bind(savedTurn).first();assert.equal(savedProgress?.task_id,form.envelope.scope.taskId);assert.equal(savedProgress.submission_id,submission);
   assert.equal(JSON.parse(result.responses[7]).action,null);assert.match(result.savedStatus.assistant_text,/saved|revision 2/i);assert.doesNotMatch(result.savedStatus.assistant_text,/not (?:been )?saved|waiting for (?:your )?approval|still pending/i);
   assert.equal(result.calls,8);await ai.sendAIChat(scope,user,savedTurn,savedRevision,savedRequest,config,transport);assert.equal(result.calls,8);
   assert.equal((await site.readSpecification(scope,user,project)).revision,2);assert.equal((await site.readSpecification(scope,user,other)).revision,1);assert.equal((await db.prepare('SELECT count(*) n FROM publications').first()).n,0);

   result.success=true;
  }finally{console.warn=originalWarn;await db.prepare('DELETE FROM users WHERE id=?').bind(user).run();}
  console.log(JSON.stringify({request,success:result.success,calls:result.calls}));
 }
 complete=true;
}finally{
 await fixture.close();
 await writeFile(directory+'/report.json',JSON.stringify({startedAt,completedAt:new Date().toISOString(),complete,results,localFixtureRemoved:true,scope:'Two frozen synthetic selected-task pending-status, exact reopening, typed user save and post-cleanup receipt/status conversations on local D1 with real Muse. No deployed/browser/device or general model-reliability claim.'},null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({directory,complete,passed:results.filter(r=>r.success).length,total:cases.length}));
}
