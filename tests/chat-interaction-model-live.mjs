// Opt-in existing Muse subscription; synthetic local D1 and no publication.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
if(process.env.RUN_LIVE_MUSE!=='1')throw Error('Set RUN_LIVE_MUSE=1 for existing Muse subscription testing');
Error.stackTraceLimit=0;
const m=await currentFixtureModules(['src/chat-interactions/store.ts','src/chat-interactions/model-continuation.ts','src/project-specification/store.ts','src/billing.ts']);
const forms=await m.module('src/chat-interactions/store.ts'),follow=await m.module('src/chat-interactions/model-continuation.ts'),site=await m.module('src/project-specification/store.ts'),billing=await m.module('src/billing.ts');
const fixture=await databaseFixture({d1:true}),db=fixture.db,id=()=>crypto.randomUUID();let calls=0,success=false,metrics;
const run=(q,...p)=>db.prepare(q).bind(...p).run(),row=(q,...p)=>db.prepare(q).bind(...p).first();
try{
 const authority=await workspaceFixture(db,m.identity),user=authority.account,scope=await authority.scope(),project=id(),initial=id(),origin=id();
 await run("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')",user);
 await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Example Garden','Synthetic landscaping website','draft',datetime('now'),datetime('now'))",project,user);
 await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.editing','prepare','private-test-acceptance','synthetic Muse form continuation',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),user,project);
 const created=await site.createWebsite(scope,user,initial,project,{name:'Example Garden',headline:'A greener neighborhood',description:'Garden care',theme:'forest',aboutTitle:'Our work',aboutText:'Seasonal planting.',sections:[{heading:'Services',text:'Planting and care.'},{heading:'Area',text:'Our neighborhood.'}],photos:[]});
 await scope.batch([scope.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,1,'Create my private site',?,datetime('now'),'ai','pending')").bind(initial,user,created.reply),...created.statements,scope.prepare("UPDATE chat_turns SET status='completed' WHERE id=?").bind(initial),scope.prepare('UPDATE workspace_state SET revision=1 WHERE user_id=?').bind(user)]);
 await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,2,?,'Complete the public service area.',datetime('now'),'ai','completed')",origin,user,'Replace only the Area section text of my existing website with the exact service-area answer I submit in this form. Inspect the saved website first, preserve everything else and prepare a private review. Do not save the edit or publish.');
 await run('UPDATE workspace_state SET revision=2 WHERE user_id=?',user);
 const form=await forms.issueInformation(scope,user,{originTurnId:origin,projectId:project,purpose:'site.services@1',fields:[{id:'area',questionId:'service-area',required:true}]}),submission=id(),answer='Boise and Eagle, Idaho.';
 await forms.mutateInteraction(scope,user,{version:1,requestId:submission,interactionId:form.envelope.id,definitionDigest:form.envelope.definitionDigest,expectedAnswerRevision:0,operation:'submit',answers:{area:answer}});
 const config={baseURL:'https://opencode.ai/zen/go/v1',model:'muse-spark-1.3-contributor',protocol:'responses',apiKey:(await readFile(process.env.WHUMPO_MUSE_KEY_FILE??'opencode.key','utf8')).trim()};
 const started=performance.now(),transport=(...args)=>{calls++;return fetch(...args);};
 const result=await follow.continueInformationTask(scope,user,submission,2,config,transport),elapsedMs=Math.round(performance.now()-started);
 const turn=await row('SELECT status,ai_context_allowed,input_tokens,output_tokens FROM chat_turns WHERE id=?',submission),cost=await row('SELECT status,cost_basis,estimated_micros FROM inference_calls WHERE id=?',submission);
 metrics={at:new Date().toISOString(),calls,elapsedMs,continuation:result.submission.continuation.state,turnStatus:turn?.status,inputTokens:turn?.input_tokens,outputTokens:turn?.output_tokens,costStatus:cost?.status,costBasis:cost?.cost_basis,estimatedMicros:cost?.estimated_micros};
 assert.equal(result.submission.continuation.state,'succeeded');assert.equal(calls,2);assert.equal(turn.ai_context_allowed,0);
 const review=await site.readSpecificationProposal(scope,user,submission),diff=JSON.parse(review.diff_json);
 assert.equal(review.project_id,project);assert.equal(diff.length,1);assert.equal(diff[0].before,'Our neighborhood.');assert.equal(diff[0].after,answer);
 assert.equal((await site.readSpecification(scope,user,project)).revision,1);assert.equal((await row('SELECT count(*) n FROM publications')).n,0);assert.equal((await billing.getBilling(scope,user)).standardAI.creditCharge,0);
 await follow.continueInformationTask(scope,user,submission,2,config,transport);assert.equal(calls,2);success=true;
}finally{
 await fixture.close();
 const evidence={...metrics,success,localFixtureRemoved:true,scope:'One real Muse task-continuation sample over synthetic local D1: exact service-area edit review, preserved saved website, zero customer credits/publication, replay without another model call. No live Worker, device or broad model quality acceptance.'};
 await writeFile('.secrets/chat-model-live-evidence.json',JSON.stringify(evidence,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(evidence));
}
