import {fixtureKeyring,initializeFixtureKeys,fixtureCiphertext} from './helpers/connection-keyring.mjs';
// Opt-in real Muse and synthetic local D1 only. No retry or publication.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
Error.stackTraceLimit=0;
if(process.env.RUN_LIVE_MUSE!=='1')throw Error('Set RUN_LIVE_MUSE=1 for existing Muse subscription testing');
const cases=[
 {provider:'github',request:'For my Test Garden website task, show the GitHub connection controls here in Chat. I will select the project first, then decide whether to authorize.'},
 {provider:'cloudflare',request:'Let me choose Test Garden, then offer the Cloudflare connection controls for that website task here in Chat. Do not authorize anything for me.'}
];
await mkdir('.secrets',{recursive:true,mode:0o700});
const directory=await mkdtemp('.secrets/task-consent-model-');
const config={baseURL:'https://opencode.ai/zen/go/v1',model:'muse-spark-1.3-contributor',protocol:'responses',apiKey:(await readFile(process.env.WHUMPO_MUSE_KEY_FILE??'opencode.key','utf8')).trim()};
const m=await currentFixtureModules(['src/ai-chat.ts','src/chat-interactions/store.ts','src/chat-interactions/model-continuation.ts','src/project-specification/store.ts']);
const networkFetch=globalThis.fetch;
const ai=await m.module('src/ai-chat.ts'),forms=await m.module('src/chat-interactions/store.ts'),follow=await m.module('src/chat-interactions/model-continuation.ts'),site=await m.module('src/project-specification/store.ts');
const fixture=await databaseFixture({d1:true}),db=fixture.db,id=()=>crypto.randomUUID(),results=[];
const startedAt=new Date().toISOString();let complete=false;
try{
 const key=fixtureKeyring();await initializeFixtureKeys(db,key);
 const connections={github:{key,clientId:'synthetic-client',clientSecret:'PRIVATE_SYNTHETIC_CONFIG',appId:1,slug:'synthetic'},config:{key,clientId:'synthetic-client',clientSecret:'PRIVATE_SYNTHETIC_CONFIG'}};
 for(const {request,provider} of cases){
  const authority=await workspaceFixture(db,m.identity),user=authority.account,scope=await authority.scope();
  const result={request,provider,success:false,calls:0,responses:[],transportReceipts:[],diagnostics:[]};results.push(result);
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
   const issued=await db.prepare('SELECT id FROM chat_interactions WHERE origin_turn_id=?').bind(submission).first();
   assert(issued,'Expected the requested connection controls');const handoff=await forms.readInteraction(scope,user,issued.id);
   assert.equal(handoff.envelope.scope.projectId,project);assert.equal(handoff.envelope.definition.cards[0].id,'connection-consent');assert.equal(handoff.envelope.definition.cards[0].binding,'connection.'+provider+'@1');
   const before=result.calls;await follow.continueInformationTask(scope,user,submission,3,config,transport);assert.equal(result.calls,before,'Exact replay must not call the model');
   // Synthetic saved authorization, never a real OAuth/provider mutation.
   const token=id(),expires=new Date(Date.now()+3600000).toISOString(),cipher=await fixtureCiphertext(key,`whumpo:${provider}:token:${user}:${token}`,'PRIVATE_SYNTHETIC_TOKEN');
   if(provider==='github'){
    await db.prepare("INSERT INTO github_token_vault VALUES(?,?,?,?,'active')").bind(token,user,cipher,expires).run();
    await db.prepare('INSERT INTO github_connections VALUES(?,?,?,?,?)').bind(user,'123','PRIVATE_SYNTHETIC_LOGIN',token,new Date().toISOString()).run();
   }else await db.prepare("INSERT INTO cloudflare_token_vault(id,user_id,ciphertext,expires_at,created_at,state) VALUES(?,?,?,?,?,'active')").bind(token,user,cipher,expires,new Date().toISOString()).run();
   const statusId=id(),revision=(await db.prepare('SELECT revision FROM workspace_state WHERE user_id=?').bind(user).first()).revision;
   const statusRequest=`For that same Test Garden task, what is the saved ${provider==='github'?'GitHub':'Cloudflare'} connection status now? Check it here; do not connect, disconnect, or change my website.`;
   const status=await ai.sendAIChat(scope,user,statusId,revision,statusRequest,config,transport,connections);assert.equal(status.status,200);
   const savedStatus=await db.prepare('SELECT status,assistant_text,ai_context_allowed FROM chat_turns WHERE id=?').bind(statusId).first();
   assert.equal(savedStatus.status,'completed');assert.match(savedStatus.assistant_text,new RegExp((provider==='github'?'GitHub':'Cloudflare')+': connected'));assert.match(savedStatus.assistant_text,/particular authorization attempt/);assert.doesNotMatch(savedStatus.assistant_text,/PRIVATE_SYNTHETIC/);assert.equal(savedStatus.ai_context_allowed,0);
   assert.equal((await db.prepare('SELECT task_id FROM chat_task_progress WHERE turn_id=?').bind(statusId).first()).task_id,form.envelope.scope.taskId);
   assert.equal(result.calls-before,2,'One routing and one terminal tool choice, no extra status inference');
   const afterStatus=result.calls;await ai.sendAIChat(scope,user,statusId,revision,statusRequest,config,transport,connections);assert.equal(result.calls,afterStatus);
   result.statusReply=savedStatus.assistant_text;result.statusRequest=statusRequest;
   assert.equal(await db.prepare('SELECT 1 FROM '+provider+'_oauth_states WHERE user_id=?').bind(user).first(),null);
   assert.equal(await db.prepare('SELECT 1 FROM connection_oauth_exchanges WHERE user_id=?').bind(user).first(),null);
   assert.equal((await site.readSpecification(scope,user,project)).revision,1);assert.equal((await site.readSpecification(scope,user,other)).revision,1);
   assert.equal((await db.prepare('SELECT count(*) n FROM publications WHERE project_id IN (?,?)').bind(project,other).first()).n,0);
   result.success=true;
  }finally{console.warn=originalWarn;await db.prepare('DELETE FROM users WHERE id=?').bind(user).run();}
  console.log(JSON.stringify({request,success:result.success,calls:result.calls}));
 }
 complete=true;
}finally{
 globalThis.fetch=networkFetch;await fixture.close();
 await writeFile(directory+'/report.json',JSON.stringify({startedAt,completedAt:new Date().toISOString(),complete,results,localFixtureRemoved:true,scope:'Two frozen selected-task GitHub/Cloudflare handoff and saved-status conversations with real Muse and local D1. Synthetic authorization metadata only; exact task routing and terminal server reply, no extra status inference, automatic OAuth start, exchange or publication, unchanged unrelated website and no replay inference. No provider, deployed, physical-device or general reliability acceptance.'},null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({directory,complete,passed:results.filter(r=>r.success).length,total:cases.length}));
}
