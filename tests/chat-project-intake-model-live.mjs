// Explicitly opt-in: frozen synthetic cohorts on the existing Muse subscription.
// No live Worker, customer data, publication or automatic retry.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';

if(process.env.RUN_LIVE_MUSE!=='1')throw Error('Set RUN_LIVE_MUSE=1 for existing Muse subscription testing');
const websiteCases=[
 {name:'Meadow Garden',purpose:'A simple informational gardening website about seasonal planting, with a headline and a Services section. Use only this description and the working name; do not invent addresses, contact details or prices. Use a calm green theme.'},
 {name:'Blue Sprout',purpose:'An informational website explaining seasonal planting and garden care. It needs a short introduction and a Services section.'},
 {name:'Meadow Garden Studio',purpose:'An informational gardening website. Use the headline "A little greener, every season."\nInclude a Services section describing seasonal planting. Use only these facts; leave out contact details and prices.'}
];
const unsupportedCases=[
 {name:'Garden Video Workshop',purpose:'A video processing server for my own garden recordings, running FFmpeg jobs with a file upload queue. I need working background video conversion, not an informational website.',request:'I want another project for processing my own garden videos. Ask for its name and purpose before choosing an implementation.',expectProject:false},
 {name:'Garden Inventory',purpose:'A private inventory application with staff logins, SQL records and authenticated stock changes. I need that functional application, not a public informational website.',request:'I want a private inventory application. Ask for its name and purpose before choosing an implementation.',expectProject:false}
];
const correctionOnly=process.argv.includes('--correction-only');
const cases=process.argv.includes('--unsupported-only')?unsupportedCases:correctionOnly?websiteCases.slice(0,1):websiteCases;
await mkdir('.secrets',{recursive:true,mode:0o700});
const evidenceDirectory=await mkdtemp('.secrets/intake-model-cohort-');
const config={baseURL:'https://opencode.ai/zen/go/v1',model:'muse-spark-1.3-contributor',protocol:'responses',apiKey:(await readFile(process.env.WHUMPO_MUSE_KEY_FILE??'opencode.key','utf8')).trim()};
const m=await currentFixtureModules(['src/ai-chat.ts','src/chat-interactions/store.ts','src/chat-interactions/model-continuation.ts','src/project-specification/store.ts']);
const ai=await m.module('src/ai-chat.ts'),forms=await m.module('src/chat-interactions/store.ts'),follow=await m.module('src/chat-interactions/model-continuation.ts'),site=await m.module('src/project-specification/store.ts');
const fixture=await databaseFixture({d1:true,allowedArguments:['--unsupported-only','--correction-only']}),db=fixture.db,id=()=>crypto.randomUUID(),results=[];
const startedAt=new Date().toISOString();let complete=false;
try{
 for(const sample of cases){
  const answers={name:sample.name,purpose:sample.purpose},expectProject=sample.expectProject!==false;
  const authority=await workspaceFixture(db,m.identity),user=authority.account,scope=await authority.scope(),origin=id();
  const result={name:answers.name,expectProject,success:false,responses:[],diagnostics:[],calls:0};results.push(result);
  const originalWarn=console.warn;
  console.warn=message=>{const value=JSON.parse(message);assert.equal(value.event,'ai_proposal_rejected');result.diagnostics.push(value);};
  try{
   await db.prepare("INSERT INTO workspace_state(user_id,step,revision) VALUES(?,'ready',1)").bind(user).run();
   await db.prepare("INSERT INTO feature_preview_grants VALUES(?,1,?,NULL,'core.editing','prepare','private-test-acceptance','synthetic Muse intake cohort',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)").bind(id(),user).run();
   await db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,1,?,'Complete the project brief.',datetime('now'),'ai','completed')").bind(origin,user,sample.request??'I want to start another website project. Please show me a short form for its working name and what I want it to do; I have not supplied those details yet. Keep my existing Test Garden project unchanged.').run();
   const form=await forms.issueProjectIntake(scope,user,{originTurnId:origin,template:'project-brief@1'}),submission=id();
   await forms.mutateInteraction(scope,user,{version:1,requestId:submission,interactionId:form.envelope.id,definitionDigest:form.envelope.definitionDigest,expectedAnswerRevision:0,operation:'submit',answers});
   const transport=async(...args)=>{result.calls++;assert(result.calls<=(correctionOnly?5:1),'Unexpected additional model dispatch');const r=await fetch(...args),body=await r.clone().json();result.responses.push(body.output?.flatMap(x=>x.content??[]).find(x=>x.type==='output_text')?.text??null);return r;};
   const start=performance.now(),saved=await follow.continueInformationTask(scope,user,submission,1,config,transport);
   result.elapsedMs=Math.round(performance.now()-start);result.state=saved.submission.continuation.state;
   result.turn=await db.prepare('SELECT status,assistant_text FROM chat_turns WHERE id=?').bind(submission).first();
   result.project=await db.prepare('SELECT name,purpose FROM projects WHERE id=? AND owner_user_id=?').bind(form.envelope.scope.taskId,user).first();
   await follow.continueInformationTask(scope,user,submission,1,config,transport);assert.equal(result.calls,1,'Replay must not dispatch');
   assert.equal((await db.prepare('SELECT count(*) n FROM publications').first()).n,0);
   if(result.state==='succeeded'){
    assert.equal(result.turn.status,'completed');
    const progress=await db.prepare('SELECT created_project_id FROM chat_task_progress WHERE turn_id=?').bind(submission).first();
    if(expectProject){assert.deepEqual(result.project,answers);assert.equal(progress.created_project_id,form.envelope.scope.taskId);}
    else{assert.equal(result.project,null);assert.equal(progress.created_project_id,null);assert.equal((await db.prepare('SELECT count(*) n FROM project_spec_proposals WHERE user_id=?').bind(user).first()).n,0);}
    if(correctionOnly){
     const target=form.envelope.scope.taskId,correctionTurn=id(),correctedName='Meadow Garden Studio';
     for(const operation of ['read','prepare'])await db.prepare("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.editing',?,'private-test-acceptance','synthetic correction cohort',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)").bind(id(),user,target,operation).run();
     const request='On the Meadow Garden project brief I just submitted, propose changing the working name to Meadow Garden Studio. Keep the same task and other answer; show me the corrected form so I can review it. Do not create another project or change the website.';
     const rev=(await db.prepare('SELECT revision FROM workspace_state WHERE user_id=?').bind(user).first()).revision;
     await ai.sendAIChat(scope,user,correctionTurn,rev,request,config,transport);
     result.formCorrection=await db.prepare('SELECT status,assistant_text FROM chat_turns WHERE id=?').bind(correctionTurn).first();
     const issued=await db.prepare('SELECT id FROM chat_interactions WHERE origin_turn_id=? AND user_id=?').bind(correctionTurn,user).first();assert(issued,'Expected an actual corrected form from natural-language routing');
     const replacement=await forms.readInteraction(scope,user,issued.id),nextSubmission=id();
     assert.equal(replacement.previousInteractionId,form.envelope.id);assert.equal(replacement.envelope.scope.taskId,target);assert.equal(replacement.submission,null);
     assert.deepEqual(replacement.envelope.definition.fields.map(f=>f.default),[{value:correctedName,provenance:'suggested'},{value:answers.purpose,provenance:'user'}]);
     assert.equal(result.calls,3);await ai.sendAIChat(scope,user,correctionTurn,rev,request,config,transport);assert.equal(result.calls,3);
     await forms.mutateInteraction(scope,user,{version:1,requestId:nextSubmission,interactionId:replacement.envelope.id,definitionDigest:replacement.envelope.definitionDigest,expectedAnswerRevision:0,operation:'submit',answers:{...answers,name:correctedName}});
     const corrected=await follow.continueInformationTask(scope,user,nextSubmission,3,config,transport);
     result.correction={state:corrected.submission.continuation.state,turn:await db.prepare('SELECT status,assistant_text FROM chat_turns WHERE id=?').bind(nextSubmission).first()};
     assert.equal(result.correction.state,'succeeded');
     const review=await site.readSpecificationProposal(scope,user,nextSubmission);
     assert.equal(review.project_id,target);assert(JSON.parse(review.diff_json).some(d=>d.before===answers.name&&d.after===correctedName));
     assert.equal((await site.readSpecification(scope,user,target)).revision,1);assert.equal((await db.prepare('SELECT name FROM projects WHERE id=?').bind(target).first()).name,answers.name);
     assert.equal((await db.prepare('SELECT count(*) n FROM projects WHERE owner_user_id=?').bind(user).first()).n,1);assert.equal((await db.prepare('SELECT count(*) n FROM publications').first()).n,0);
     const calls=result.calls;await follow.continueInformationTask(scope,user,nextSubmission,3,config,transport);assert.equal(result.calls,calls);assert.equal(calls,5);
    }
    result.success=true;
   }else assert.equal(result.project,null,'Rejected creation must not save a project');
  }finally{
   console.warn=originalWarn;
   await db.prepare('DELETE FROM users WHERE id=?').bind(user).run();
  }
  console.log(JSON.stringify({case:answers.name,success:result.success,state:result.state,calls:result.calls,reasons:result.diagnostics.map(d=>d.reason)}));
 }
 complete=true;
}finally{
 await fixture.close();
 await writeFile(evidenceDirectory+'/report.json',JSON.stringify({startedAt,completedAt:new Date().toISOString(),complete,results,localFixtureRemoved:true,scope:'Frozen synthetic local D1 intake cohort using real Muse; exact no-redispatch replay and no publication. Not deployed/browser/device or broad reliability acceptance.'},null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({evidenceDirectory,complete,passed:results.filter(r=>r.success).length,total:cases.length}));
}
assert(results.every(r=>r.success),'Intake cohort has failures; preserve the report and diagnose before any new cohort');
