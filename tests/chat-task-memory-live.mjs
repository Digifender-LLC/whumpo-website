// Opt-in existing Muse subscription; synthetic local D1 and no publication.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
if(process.env.RUN_LIVE_MUSE!=='1')throw Error('Set RUN_LIVE_MUSE=1 for existing Muse subscription testing');
Error.stackTraceLimit=0;
const m=await currentFixtureModules(['src/chat-interactions/store.ts','src/chat-interactions/model-continuation.ts','src/project-specification/store.ts','src/billing.ts','src/ai-chat.ts']);
const forms=await m.module('src/chat-interactions/store.ts'),follow=await m.module('src/chat-interactions/model-continuation.ts'),site=await m.module('src/project-specification/store.ts'),billing=await m.module('src/billing.ts'),ai=await m.module('src/ai-chat.ts');
const fixture=await databaseFixture({d1:true}),db=fixture.db,id=()=>crypto.randomUUID();let calls=0,success=false,metrics;const actions=[];
const run=(q,...p)=>db.prepare(q).bind(...p).run(),row=(q,...p)=>db.prepare(q).bind(...p).first();
try{
 const authority=await workspaceFixture(db,m.identity),user=authority.account,scope=await authority.scope(),project=id(),initial=id(),origin=id();
 await run("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')",user);
 await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Example Garden','Synthetic landscaping website','draft',datetime('now'),datetime('now'))",project,user);
 await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.editing','prepare','private-test-acceptance','synthetic Muse form continuation',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),user,project);
 const created=await site.createWebsite(scope,user,initial,project,{name:'Example Garden',headline:'A greener neighborhood',description:'Garden care',theme:'forest',aboutTitle:'Our work',aboutText:'Seasonal planting.',sections:[{heading:'Services',text:'Planting and care.'},{heading:'Area',text:'Our neighborhood.'}],photos:[]});
 await scope.batch([scope.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,1,'Create my private site',?,datetime('now'),'ai','pending')").bind(initial,user,created.reply),...created.statements,scope.prepare("UPDATE chat_turns SET status='completed' WHERE id=?").bind(initial),scope.prepare('UPDATE workspace_state SET revision=1 WHERE user_id=?').bind(user)]);
 await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,2,?,'Complete the public service area.',datetime('now'),'ai','completed')",origin,user,'Help plan a service-area update for this website. Before preparing any change, ask me which seasons I work; that detail is missing. Wait for my answer in a later message. Keep the submitted service area for the same task. Do not prepare a review yet, save an edit or publish.');
 await run('UPDATE workspace_state SET revision=2 WHERE user_id=?',user);
 const form=await forms.issueInformation(scope,user,{originTurnId:origin,projectId:project,purpose:'site.services@1',fields:[{id:'area',questionId:'service-area',required:true}]}),submission=id(),answer='Boise and Eagle, Idaho.';
 await forms.mutateInteraction(scope,user,{version:1,requestId:submission,interactionId:form.envelope.id,definitionDigest:form.envelope.definitionDigest,expectedAnswerRevision:0,operation:'submit',answers:{area:answer}});
 const config={baseURL:'https://opencode.ai/zen/go/v1',model:'muse-spark-1.3-contributor',protocol:'responses',apiKey:(await readFile(process.env.WHUMPO_MUSE_KEY_FILE??'opencode.key','utf8')).trim()};
 const started=performance.now(),transport=async(...args)=>{calls++;const r=await fetch(...args);try{const j=await r.clone().json(),text=j.output?.flatMap(x=>x.content??[]).find(x=>x.type==='output_text')?.text,p=JSON.parse(text);actions.push({kind:p.action?.kind??null,operation:p.action?.operation??null,taskState:!!p.taskState});}catch{actions.push({unreadable:true});}return r;};
 const first=await follow.continueInformationTask(scope,user,submission,2,config,transport),initialCalls=calls;
 assert.equal(first.submission.continuation.state,'succeeded');assert(initialCalls>=1&&initialCalls<=2);
 const firstProgress=await row('SELECT * FROM chat_task_progress WHERE turn_id=?',submission);
 assert(firstProgress);assert.equal(firstProgress.state,'active');assert(JSON.parse(firstProgress.questions_json).length>0,'Real model must carry its follow-up question');assert.match(firstProgress.questions_json,/season|time of year/i);
 assert.equal((await row('SELECT count(*) n FROM project_spec_proposals')).n,0);
 const resumed=id(),revision=(await row('SELECT revision FROM workspace_state WHERE user_id=?',user)).revision;
 const content='Spring and summer, answering your question for the Example Garden task. Use my submitted service area followed by one space and the exact words "Available in spring and summer." as only the Area section text. Prepare a private review, do not apply it.';
 const result=await ai.sendAIChat(scope,user,resumed,revision,content,config,transport),elapsedMs=Math.round(performance.now()-started);
 const turn=await row('SELECT status,ai_context_allowed,input_tokens,output_tokens FROM chat_turns WHERE id=?',resumed),cost=await row('SELECT status,cost_basis,estimated_micros FROM inference_calls WHERE id=?',resumed);
 const saved=await row('SELECT * FROM chat_task_progress WHERE turn_id=?',resumed);
 metrics={at:new Date().toISOString(),calls,initialCalls,resumeCalls:calls-initialCalls,elapsedMs,turnStatus:turn?.status,inputTokens:turn?.input_tokens,outputTokens:turn?.output_tokens,costStatus:cost?.status,costBasis:cost?.cost_basis,estimatedMicros:cost?.estimated_micros,initialQuestions:JSON.parse(firstProgress.questions_json).length,resumedQuestions:saved?JSON.parse(saved.questions_json).length:null};
 assert.equal(result.status,200);assert.equal(turn.status,'completed');assert.equal(calls-initialCalls,2);assert.equal(turn.ai_context_allowed,0);assert(saved);assert.equal(saved.previous_turn_id,submission);assert.equal(saved.questions_json,'[]');
 const review=await site.readSpecificationProposal(scope,user,resumed),diff=JSON.parse(review.diff_json);
 assert.equal(review.project_id,project);assert.equal(diff.length,1);assert.equal(diff[0].before,'Our neighborhood.');assert.equal(diff[0].after,answer+' Available in spring and summer.');
 assert.equal((await site.readSpecification(scope,user,project)).revision,1);assert.equal((await row('SELECT count(*) n FROM publications')).n,0);assert.equal((await billing.getBilling(scope,user)).standardAI.creditCharge,0);
 const before=calls;await ai.sendAIChat(scope,user,resumed,revision,content,config,transport);assert.equal(calls,before);success=true;
}finally{
 await fixture.close();
 const evidence={...metrics,calls,actions,success,localFixtureRemoved:true,scope:'One real Muse multi-turn task sample over synthetic local D1: a structured season question, later natural reply with saved service-area answer, exact one-section edit review, preserved saved website, zero customer credits/publication and replay without another model call. Token/cost metrics describe the resumed turn; elapsed time includes both turns. No live Worker, device or broad model quality acceptance.'};
 await writeFile('.secrets/chat-task-memory-live-evidence.json',JSON.stringify(evidence,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(evidence));
}
