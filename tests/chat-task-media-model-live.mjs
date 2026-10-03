// Opt-in real Muse and synthetic local D1 only. No retry or publication.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
Error.stackTraceLimit=0;
if(process.env.RUN_LIVE_MUSE!=='1')throw Error('Set RUN_LIVE_MUSE=1 for existing Muse subscription testing');
const cases=[
 'Show a private photo uploader for my Test Garden website here in Chat. Let me choose its project first.',
 'I want to upload a photo for my Test Garden website. I will select the project; then show the upload form here.'
];
await mkdir('.secrets',{recursive:true,mode:0o700});
const directory=await mkdtemp('.secrets/task-media-model-');
const config={baseURL:'https://opencode.ai/zen/go/v1',model:'muse-spark-1.3-contributor',protocol:'responses',apiKey:(await readFile(process.env.WHUMPO_MUSE_KEY_FILE??'opencode.key','utf8')).trim()};
const m=await currentFixtureModules(['src/ai-chat.ts','src/chat-interactions/store.ts','src/chat-interactions/model-continuation.ts','src/project-specification/store.ts','src/files.ts']);
const networkFetch=globalThis.fetch;
const ai=await m.module('src/ai-chat.ts'),forms=await m.module('src/chat-interactions/store.ts'),follow=await m.module('src/chat-interactions/model-continuation.ts'),site=await m.module('src/project-specification/store.ts');
const files=await m.module('src/files.ts');
execFileSync('python3',['-c',"from PIL import Image; import sys; Image.new('RGB',(32,24),(80,120,60)).save(sys.argv[1])",directory+'/synthetic-photo.jpg']);
const photo=await readFile(directory+'/synthetic-photo.jpg');
const fixture=await databaseFixture({d1:true,r2:true}),db=fixture.db,id=()=>crypto.randomUUID(),results=[];
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

   const origin=id();
   await db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,3,?,'Choose your project.',datetime('now'),'ai','completed')").bind(origin,user,request).run();
   await db.prepare('UPDATE workspace_state SET revision=3 WHERE user_id=?').bind(user).run();
   const form=await forms.issueProjectIntake(scope,user,{originTurnId:origin,template:'project-select@1'}),submission=id();
   await forms.mutateInteraction(scope,user,{version:1,requestId:submission,interactionId:form.envelope.id,definitionDigest:form.envelope.definitionDigest,expectedAnswerRevision:0,operation:'submit',answers:{project}});
   const transport=async(...args)=>{result.calls++;assert(result.calls<=10,'Unexpected additional model dispatch');const r=await fetch(...args),body=await r.clone().json();result.transportReceipts.push({httpStatus:r.status,status:body.status??null,incomplete:body.incomplete_details??null,usage:body.usage??null,outputTypes:body.output?.map(x=>x.type)??[]});result.responses.push(body.output?.flatMap(x=>x.content??[]).find(x=>x.type==='output_text')?.text??null);return r;};
   const prepared=await follow.continueInformationTask(scope,user,submission,3,config,transport);
   assert.equal(prepared.submission.continuation.state,'succeeded');assert(result.calls<=2);
   const uploadForm=await db.prepare('SELECT id FROM chat_interactions WHERE origin_turn_id=?').bind(submission).first();
   assert(uploadForm,'Expected the requested private uploader');const handoff=await forms.readInteraction(scope,user,uploadForm.id);
   assert.equal(handoff.envelope.scope.projectId,project);assert.equal(handoff.envelope.definition.cards[0].id,'photo-upload');
   const file=id(),context={interactionId:handoff.envelope.id,definitionDigest:handoff.envelope.definitionDigest};
   await files.uploadPhoto(new Request('https://whumpo.com/api/test',{method:'PUT',headers:{'content-type':'image/jpeg','x-photo-name':'Garden upload','x-whumpo-photo-handoff':JSON.stringify(context)},body:photo}),{...fixture.env,DB:scope},user,project,file);
   assert.equal((await files.readPhotoUpload(scope,user,project,file)).photo.safetyStatus,'pending');
   const send=async(text)=>{
    const turn=id(),revision=(await db.prepare('SELECT revision FROM workspace_state WHERE user_id=?').bind(user).first()).revision,before=result.calls;
    assert.equal((await ai.sendAIChat(scope,user,turn,revision,text,config,transport)).status,200);
    const saved=await db.prepare('SELECT status,assistant_text FROM chat_turns WHERE id=?').bind(turn).first();assert.equal(saved.status,'completed');
    const progress=await db.prepare('SELECT task_id,submission_id FROM chat_task_progress WHERE turn_id=?').bind(turn).first();assert.equal(progress?.task_id,form.envelope.scope.taskId);assert.equal(progress.submission_id,submission);
    assert.equal(result.calls,before+2);await ai.sendAIChat(scope,user,turn,revision,text,config,transport);assert.equal(result.calls,before+2,'Exact replay must not call the model');
    return {turn,...saved};
   };
   result.status=await send('For that same Test Garden task, did my photo upload finish, and can it be used on the website? Just explain the status.');
   assert.equal(JSON.parse(result.responses.at(-1)).action,null);assert.match(result.status.assistant_text,/saved|uploaded|stored/i);assert.match(result.status.assistant_text,/held|safety|check|scan/i);assert.doesNotMatch(result.status.assistant_text,/published successfully|already added|now live/i);
   await forms.mutateInteraction(scope,user,{version:1,requestId:id(),interactionId:handoff.envelope.id,definitionDigest:handoff.envelope.definitionDigest,expectedAnswerRevision:0,operation:'cancel'});
   result.dismissed=await send('I closed the uploader for that same task. Did that remove the photo? Tell me its current status without opening another form.');
   assert.equal(JSON.parse(result.responses.at(-1)).action,null);assert.match(result.dismissed.assistant_text,/saved|stored|remain|still|not.{0,15}(delete|remove)|didn.t.{0,15}(delete|remove)/i);assert.match(result.dismissed.assistant_text,/held|safety|check|scan/i);
   await db.prepare("UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE user_id=? AND project_id=? AND feature_id='core.editing' AND operation='read'").bind(user,project).run();
   result.denied=await send('Check whether the photo for that same task has cleared its checks now.');
   assert.equal(JSON.parse(result.responses.at(-1)).action,null);assert.match(result.denied.assistant_text,/access|unavailable|not available|cannot|can.t|couldn.t|unable|permission|can.t confirm/i);
   assert.equal((await db.prepare('SELECT count(*) n FROM project_files WHERE project_id=?').bind(project).first()).n,1);
   assert.equal((await site.readSpecification(scope,user,project)).revision,1);assert.equal((await site.readSpecification(scope,user,other)).revision,1);
   assert.equal((await db.prepare('SELECT count(*) n FROM publications WHERE project_id IN (?,?)').bind(project,other).first()).n,0);
   result.success=true;
  }finally{console.warn=originalWarn;await db.prepare('DELETE FROM users WHERE id=?').bind(user).run();}
  console.log(JSON.stringify({request,success:result.success,calls:result.calls}));
 }
 complete=true;
}finally{
 globalThis.fetch=networkFetch;await fixture.close();
 await writeFile(directory+'/report.json',JSON.stringify({startedAt,completedAt:new Date().toISOString(),complete,results,localFixtureRemoved:true,scope:'Two frozen selected-task photo-uploader, real private R2 upload, held status, dismissed-handoff status and revoked-access conversations with real Muse and local D1. No image bytes sent to inference; no scanner or publication effects. No deployed, physical-device or general reliability claim.'},null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({directory,complete,passed:results.filter(r=>r.success).length,total:cases.length}));
}
