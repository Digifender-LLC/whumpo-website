// Opt-in real Muse and synthetic local D1 only. No retry or publication.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
Error.stackTraceLimit=0;
if(process.env.RUN_LIVE_MUSE!=='1')throw Error('Set RUN_LIVE_MUSE=1 for existing Muse subscription testing');
const cases=[
 'Show the status and page requests for my Test Garden website here in Chat. Let me choose its project first.',
 'Put an overview of my Test Garden website and its traffic in this conversation. I will select the project.'
];
await mkdir('.secrets',{recursive:true,mode:0o700});
const directory=await mkdtemp('.secrets/task-observations-model-');
const config={baseURL:'https://opencode.ai/zen/go/v1',model:'muse-spark-1.3-contributor',protocol:'responses',apiKey:(await readFile(process.env.WHUMPO_MUSE_KEY_FILE??'opencode.key','utf8')).trim()};
const m=await currentFixtureModules(['src/ai-chat.ts','src/chat-interactions/store.ts','src/chat-interactions/model-continuation.ts','src/project-specification/store.ts']);
const networkFetch=globalThis.fetch;
const ai=await m.module('src/ai-chat.ts'),forms=await m.module('src/chat-interactions/store.ts'),follow=await m.module('src/chat-interactions/model-continuation.ts'),site=await m.module('src/project-specification/store.ts');
const fixture=await databaseFixture({d1:true}),db=fixture.db,id=()=>crypto.randomUUID(),results=[];
const startedAt=new Date().toISOString();let complete=false;
try{
 for(const request of cases){
  const authority=await workspaceFixture(db,m.identity),user=authority.account,scope=await authority.scope();
  const result={request,success:false,calls:0,responses:[],transportReceipts:[],diagnostics:[]};results.push(result);
  const originalWarn=console.warn;
  console.warn=message=>{const value=JSON.parse(message);assert(['ai_proposal_rejected','ai_request_failed'].includes(value.event));result.diagnostics.push(value);};
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

   await db.prepare("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.insights','read','private-test-acceptance','synthetic observations cohort',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)").bind(id(),user,project).run();
   await db.prepare("INSERT INTO site_traffic_daily VALUES(?,date('now'),7)").bind(project).run();
   await db.prepare("INSERT INTO site_traffic_daily VALUES(?,date('now'),999)").bind(other).run();
   const origin=id();
   await db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,3,?,'Choose your project.',datetime('now'),'ai','completed')").bind(origin,user,request).run();
   await db.prepare('UPDATE workspace_state SET revision=3 WHERE user_id=?').bind(user).run();
   const form=await forms.issueProjectIntake(scope,user,{originTurnId:origin,template:'project-select@1'}),submission=id();
   await forms.mutateInteraction(scope,user,{version:1,requestId:submission,interactionId:form.envelope.id,definitionDigest:form.envelope.definitionDigest,expectedAnswerRevision:0,operation:'submit',answers:{project}});
   const transport=async(...args)=>{result.calls++;assert(result.calls<=10,'Unexpected additional model dispatch');const r=await fetch(...args),body=await r.clone().json();result.transportReceipts.push({httpStatus:r.status,status:body.status??null,incomplete:body.incomplete_details??null,usage:body.usage??null,outputTypes:body.output?.map(x=>x.type)??[]});result.responses.push(body.output?.flatMap(x=>x.content??[]).find(x=>x.type==='output_text')?.text??null);return r;};
   const prepared=await follow.continueInformationTask(scope,user,submission,3,config,transport);
   assert.equal(prepared.submission.continuation.state,'succeeded');assert(result.calls<=2);
   const view=await db.prepare("SELECT envelope_json FROM chat_interactions WHERE origin_turn_id=?").bind(submission).first();
   assert(view,'Expected the requested inline overview');const definition=JSON.parse(view.envelope_json).definition;
   assert.equal(definition.kind,'view');assert.equal(definition.workspaceView.projectId,project);assert.deepEqual([...definition.workspaceView.widgets].sort(),['projects','traffic']);assert.deepEqual(definition.workspaceView.shortcuts,[]);
   const send=async(text)=>{
    const turn=id(),revision=(await db.prepare('SELECT revision FROM workspace_state WHERE user_id=?').bind(user).first()).revision,before=result.calls;
    assert.equal((await ai.sendAIChat(scope,user,turn,revision,text,config,transport)).status,200);
    const saved=await db.prepare('SELECT status,assistant_text FROM chat_turns WHERE id=?').bind(turn).first();assert.equal(saved.status,'completed');
    const progress=await db.prepare('SELECT task_id,submission_id FROM chat_task_progress WHERE turn_id=?').bind(turn).first();assert.equal(progress?.task_id,form.envelope.scope.taskId);assert.equal(progress.submission_id,submission);
    assert.equal(result.calls,before+2);await ai.sendAIChat(scope,user,turn,revision,text,config,transport);assert.equal(result.calls,before+2,'Exact replay must not call the model');
    return {turn,...saved};
   };
   result.status=await send('For that same Test Garden task, is the website public and how many page requests are recorded? Just explain it; do not change anything.');
   assert.equal(JSON.parse(result.responses.at(-1)).action,null);assert.match(result.status.assistant_text,/7/);assert.match(result.status.assistant_text,/private|unpublished|not.{0,25}(public|publish|live)/i);assert.doesNotMatch(result.status.assistant_text,/999/);
   await db.prepare("UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE user_id=? AND feature_id='core.insights'").bind(user).run();
   result.denied=await send('Check the current page requests for that same task again and tell me the count.');
   assert.equal(JSON.parse(result.responses.at(-1)).action,null);assert.match(result.denied.assistant_text,/access|unavailable|not available|cannot|can.t|couldn.t|unable|permission/i);assert.doesNotMatch(result.denied.assistant_text,/\b(?:7|999)\b/);
   assert.equal((await site.readSpecification(scope,user,project)).revision,1);assert.equal((await site.readSpecification(scope,user,other)).revision,1);
   assert.equal((await db.prepare('SELECT count(*) n FROM publications WHERE project_id IN (?,?)').bind(project,other).first()).n,0);
   result.success=true;
  }finally{console.warn=originalWarn;await db.prepare('DELETE FROM users WHERE id=?').bind(user).run();}
  console.log(JSON.stringify({request,success:result.success,calls:result.calls}));
 }
 complete=true;
}finally{
 globalThis.fetch=networkFetch;await fixture.close();
 await writeFile(directory+'/report.json',JSON.stringify({startedAt,completedAt:new Date().toISOString(),complete,results,localFixtureRemoved:true,scope:'Two frozen selected-task project/traffic overview, plain-language status and revoked-access conversations with real Muse and local D1. No publication effects. No deployed, physical-device or general reliability claim.'},null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({directory,complete,passed:results.filter(r=>r.success).length,total:cases.length}));
}
