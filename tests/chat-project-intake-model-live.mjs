// Explicitly opt-in: three frozen synthetic cases on the existing Muse subscription.
// No live Worker, customer data, publication or automatic retry.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';

if(process.env.RUN_LIVE_MUSE!=='1')throw Error('Set RUN_LIVE_MUSE=1 for existing Muse subscription testing');
const cases=[
 {name:'Meadow Garden',purpose:'A simple informational gardening website about seasonal planting, with a headline and a Services section. Use only this description and the working name; do not invent addresses, contact details or prices. Use a calm green theme.'},
 {name:'Blue Sprout',purpose:'An informational website explaining seasonal planting and garden care. It needs a short introduction and a Services section.'},
 {name:'Meadow Garden Studio',purpose:'An informational gardening website. Use the headline "A little greener, every season."\nInclude a Services section describing seasonal planting. Use only these facts; leave out contact details and prices.'}
];
await mkdir('.secrets',{recursive:true,mode:0o700});
const evidenceDirectory=await mkdtemp('.secrets/intake-model-cohort-');
const config={baseURL:'https://opencode.ai/zen/go/v1',model:'muse-spark-1.3-contributor',protocol:'responses',apiKey:(await readFile(process.env.WHUMPO_MUSE_KEY_FILE??'opencode.key','utf8')).trim()};
const m=await currentFixtureModules(['src/chat-interactions/store.ts','src/chat-interactions/model-continuation.ts']);
const forms=await m.module('src/chat-interactions/store.ts'),follow=await m.module('src/chat-interactions/model-continuation.ts');
const fixture=await databaseFixture({d1:true}),db=fixture.db,id=()=>crypto.randomUUID(),results=[];
const startedAt=new Date().toISOString();let complete=false;
try{
 for(const answers of cases){
  const authority=await workspaceFixture(db,m.identity),user=authority.account,scope=await authority.scope(),origin=id();
  const result={name:answers.name,success:false,responses:[],diagnostics:[],calls:0};results.push(result);
  const originalWarn=console.warn;
  console.warn=message=>{const value=JSON.parse(message);assert.equal(value.event,'ai_proposal_rejected');result.diagnostics.push(value);};
  try{
   await db.prepare("INSERT INTO workspace_state(user_id,step,revision) VALUES(?,'ready',1)").bind(user).run();
   await db.prepare("INSERT INTO feature_preview_grants VALUES(?,1,?,NULL,'core.editing','prepare','private-test-acceptance','synthetic Muse intake cohort',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)").bind(id(),user).run();
   await db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,1,?,'Complete the project brief.',datetime('now'),'ai','completed')").bind(origin,user,'I want to start another website project. Please show me a short form for its working name and what I want it to do; I have not supplied those details yet. Keep my existing Test Garden project unchanged.').run();
   const form=await forms.issueProjectIntake(scope,user,{originTurnId:origin,template:'project-brief@1'}),submission=id();
   await forms.mutateInteraction(scope,user,{version:1,requestId:submission,interactionId:form.envelope.id,definitionDigest:form.envelope.definitionDigest,expectedAnswerRevision:0,operation:'submit',answers});
   const transport=async(...args)=>{result.calls++;assert(result.calls<=1,'New-project intake may not inspect or retry');const r=await fetch(...args),body=await r.clone().json();result.responses.push(body.output?.flatMap(x=>x.content??[]).find(x=>x.type==='output_text')?.text??null);return r;};
   const start=performance.now(),saved=await follow.continueInformationTask(scope,user,submission,1,config,transport);
   result.elapsedMs=Math.round(performance.now()-start);result.state=saved.submission.continuation.state;
   result.turn=await db.prepare('SELECT status,assistant_text FROM chat_turns WHERE id=?').bind(submission).first();
   result.project=await db.prepare('SELECT name,purpose FROM projects WHERE id=? AND owner_user_id=?').bind(form.envelope.scope.taskId,user).first();
   await follow.continueInformationTask(scope,user,submission,1,config,transport);assert.equal(result.calls,1,'Replay must not dispatch');
   assert.equal((await db.prepare('SELECT count(*) n FROM publications').first()).n,0);
   if(result.state==='succeeded'){
    assert.equal(result.turn.status,'completed');assert.deepEqual(result.project,answers);
    assert.equal((await db.prepare('SELECT created_project_id FROM chat_task_progress WHERE turn_id=?').bind(submission).first()).created_project_id,form.envelope.scope.taskId);
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
