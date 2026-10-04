import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
Error.stackTraceLimit=0;
const modules=await currentFixtureModules(['src/chat-interactions/store.ts','src/chat-interactions/continuation.ts','src/project-specification/store.ts','src/chat-interactions/protocol.ts','src/index.ts','src/chat-interactions/retention.ts','src/project-specification/v2/json.ts','src/chat-interactions/history-shape.ts']);
const store=await modules.module('src/chat-interactions/store.ts'),continuation=await modules.module('src/chat-interactions/continuation.ts'),site=await modules.module('src/project-specification/store.ts');
const protocol=await modules.module('src/chat-interactions/protocol.ts'),worker=(await modules.module('src/index.ts')).default;
const retention=await modules.module('src/chat-interactions/retention.ts'),codec=await modules.module('src/project-specification/v2/json.ts');
const presentation=await modules.module('src/chat-interactions/history-shape.ts');
const fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID();let cases=0,network=0;
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{network++;throw Error('Unexpected network');};
const run=(q,...p)=>db.prepare(q).bind(...p).run(),row=(q,...p)=>db.prepare(q).bind(...p).first();
async function test(name,fn){try{await fn();cases++;}catch(e){console.error(name,String(e));throw e;}}
async function owner(){
 const authority=await workspaceFixture(db,modules.identity),user=authority.account,scope=await authority.scope(),project=id();
 await run("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')",user);
 await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Garden','Landscaping','draft',datetime('now'),datetime('now'))",project,user);
 await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.editing','prepare','private-test-acceptance','synthetic interaction fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),user,project);
 const turn=id(),prepared=await site.createWebsite(scope,user,turn,project,{name:'Garden',headline:'A greener neighborhood',description:'Care for local gardens',theme:'ocean',aboutTitle:'Our work',aboutText:'Seasonal planting.',sections:[{heading:'Services',text:'Planting and care.'}],photos:[]});
 await scope.batch([scope.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,1,'Create my website',?,datetime('now'),'ai','pending')").bind(turn,user,prepared.reply),...prepared.statements,scope.prepare("UPDATE chat_turns SET status='completed' WHERE id=?").bind(turn),scope.prepare('UPDATE workspace_state SET revision=1 WHERE user_id=?').bind(user)]);
 return {authority,user,scope,project};
}
async function origin(o){
 const turn=id();await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at) SELECT ?,user_id,revision+1,'Change my page','Please review the text.',datetime('now') FROM workspace_state WHERE user_id=?",turn,o.user);await run('UPDATE workspace_state SET revision=revision+1 WHERE user_id=?',o.user);return turn;
}
async function issue(o,database=o.scope){
 const request={originTurnId:await origin(o),projectId:o.project,contentIds:['headline','section-1-text']};
 return {request,form:await store.issueContentBrief(database,o.user,request)};
}
async function replacement(o,form){return {originTurnId:await origin(o),previousInteractionId:form.envelope.id,definitionDigest:form.envelope.definitionDigest,expectedAnswerRevision:form.answerRevision,contentIds:['headline','section-1-text']};}
const revision=o=>row('SELECT revision FROM workspace_state WHERE user_id=?',o.user).then(r=>r.revision);
const env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}},ctx={waitUntil:()=>{}};
const http=(o,path,data)=>worker.fetch(new Request('https://whumpo.com'+path,{method:data?'POST':'GET',headers:{origin:'https://whumpo.com',...(data?{'content-type':'application/json'}:{}),cookie:'__Host-whumpo_session='+o.authority.token},...(data?{body:JSON.stringify(data)}:{})}),env,ctx);
async function approve(o,submissionId){
 const review=await site.readSpecificationProposal(o.scope,o.user,submissionId),response=await http(o,'/api/chat/actions',{id:id(),revision:await revision(o),action:{type:'specificationApply',reviewId:review.id,proposalDigest:review.proposal_digest,expectedRevision:review.expected_revision}});
 assert.equal(response.status,200,await response.text());
}
const listRequest=(projectId=null,limit=20,before=null)=>({version:1,projectId,limit,before});

// Historical current-schema fixtures, with real sealed definitions and receipt hashes.
async function aged(o,definition,{createdDays=9,editedDays=8,submitted=false,unknown=false}={}){
 const originTurnId=await origin(o),conversationId=(await row('SELECT id FROM chat_conversations WHERE user_id=?',o.user))?.id??id(),taskId=id();
 await run('INSERT OR IGNORE INTO chat_conversations(id,user_id) VALUES(?,?)',conversationId,o.user);
 await run('INSERT INTO chat_interaction_tasks(id,user_id,conversation_id,project_id,origin_turn_id) VALUES(?,?,?,?,?)',taskId,o.user,conversationId,o.project,originTurnId);
 const clock=await row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now',?) createdAt,strftime('%Y-%m-%dT%H:%M:%fZ','now',?) expiresAt,strftime('%Y-%m-%dT%H:%M:%fZ','now',?) savedAt",'-'+createdDays+' days','-'+(createdDays-7)+' days','-'+editedDays+' days');
 const envelope=await protocol.sealDefinition({version:1,id:id(),scope:{accountId:o.user,actorId:o.user,conversationId,taskId,projectId:o.project,originTurnId},definition,createdAt:clock.createdAt,expiresAt:clock.expiresAt});
 await run('INSERT INTO chat_interactions(id,user_id,conversation_id,task_id,project_id,origin_turn_id,envelope_json,definition_digest,issue_hash,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',envelope.id,o.user,conversationId,taskId,o.project,originTurnId,JSON.stringify(envelope),envelope.definitionDigest,'a'.repeat(64),envelope.createdAt,envelope.expiresAt);
 const request={...mutation({envelope},submitted?'submit':'save-draft'),answers:{'field-1':'PRIVATE_DRAFT_CANARY','field-2':'PRIVATE_DETAILS_CANARY'}},{requestHash}=await protocol.validateMutation(request,envelope);
 await run('UPDATE chat_interactions SET state=?,answer_revision=1,draft_json=?,draft_saved_at=? WHERE id=?',submitted?'submitted':'open',submitted?'{}':JSON.stringify(request.answers),submitted?null:clock.savedAt,envelope.id);
 await run('INSERT INTO chat_interaction_requests(user_id,request_id,interaction_id,request_hash,operation,answer_revision,created_at) VALUES(?,?,?,?,?,1,?)',o.user,request.requestId,envelope.id,requestHash,request.operation,clock.savedAt);
 if(submitted){
  await run('INSERT INTO chat_interaction_submissions(id,user_id,interaction_id,answers_json,answers_digest,answer_revision,created_at) VALUES(?,?,?,?,?,1,?)',request.requestId,o.user,envelope.id,JSON.stringify(request.answers),await codec.jsonDigest(request.answers),clock.savedAt);
  await run('INSERT INTO chat_interaction_continuations(id) VALUES(?)',request.requestId);
  if(unknown){await run("UPDATE chat_interaction_continuations SET state='pending',started_at=? WHERE id=?",clock.savedAt,request.requestId);await run("UPDATE chat_interaction_continuations SET state='unknown' WHERE id=?",request.requestId);}
 }
 return {envelope,request,clock};
}

function mutation(form,operation='submit',revision=0){return {version:1,requestId:id(),interactionId:form.envelope.id,definitionDigest:form.envelope.definitionDigest,expectedAnswerRevision:revision,operation,...(operation==='cancel'?{}:{answers:{'field-1':'Gardens, cared for.','field-2':'Seasonal care and planting.'}})};}
const denies=(fn,status=409)=>assert.rejects(fn,e=>e.status===status);
try{
 await test('account deletion retains pending or unknown continuation custody until explicit reconciliation',async()=>{
  for(const mode of ['pending','unknown']){
   const c=await owner(),{form}=await issue(c),request=mutation(form);await store.mutateInteraction(c.scope,c.user,request);
   let interrupted=false;
   const scope=await c.authority.scope(interceptDatabase(db,mode==='pending'?/^UPDATE chat_interaction_continuations SET state='pending'/:/^INSERT INTO project_spec_proposals/,
    async()=>{if(mode==='unknown'){interrupted=true;throw Error('Unconfirmed local write');}},
    async()=>{if(mode==='pending'&&!interrupted){interrupted=true;throw Error('Lost claim response');}}));
   const held=await continuation.continueContentBrief(scope,c.user,request.requestId,await revision(c));assert(interrupted);assert.equal(held.submission.continuation.state,mode);
   await assert.rejects(()=>run('DELETE FROM users WHERE id=?',c.user),/chat_interaction_receipt_retained/);
   assert(await row('SELECT account_id FROM identity_accounts WHERE account_id=?',c.user));
   const retained=await store.readInteraction(c.scope,c.user,form.envelope.id);assert.deepEqual(retained.submission,held.submission);
   assert.equal((await store.readInteractionReceipt(c.scope,c.user,request.requestId)).requestId,request.requestId);
   const unrelated=await owner();await run('DELETE FROM users WHERE id=?',unrelated.user);assert.equal(await row('SELECT id FROM users WHERE id=?',unrelated.user),null);
   const resolved=await continuation.reconcileContentBrief(c.scope,c.user,request.requestId);assert.equal(resolved.submission.continuation.state,'failed');
   await run('DELETE FROM users WHERE id=?',c.user);assert.equal(await row('SELECT id FROM chat_interactions WHERE id=?',form.envelope.id),null);
   assert.equal(await row('SELECT request_id FROM chat_interaction_requests WHERE user_id=?',c.user),null);
   assert.equal(await row('SELECT id FROM chat_interaction_continuations WHERE id=?',request.requestId),null);
   await assert.rejects(()=>store.readInteraction(c.scope,c.user,form.envelope.id));
  }
 });
 const a=await owner(),b=await owner(),first=await issue(a);let saved;
 await test('server-owned defaults, target limits and idempotent issuance',async()=>{
  assert.equal(first.form.projectName,'Garden');
  const e=first.form.envelope;assert.equal(e.scope.accountId,a.user);assert.equal(e.scope.projectId,a.project);assert.equal(e.definition.fields[0].constraints.maxLength,160);assert.equal(e.definition.fields[1].constraints.maxLength,800);assert.equal(e.definition.fields[0].default.value,'A greener neighborhood');
  assert.equal((await store.issueContentBrief(a.scope,a.user,first.request)).envelope.id,e.id);
  await denies(()=>store.issueContentBrief(a.scope,a.user,{...first.request,contentIds:['about-text']}));
  await denies(()=>store.readInteraction(b.scope,b.user,e.id),404);await assert.rejects(()=>store.readInteraction(db,a.user,e.id),e=>e.code==='proof_required');
 });
 await test('draft revision survives readback; invalid and stale edits cannot replace it',async()=>{
  const draft=mutation(first.form,'save-draft');draft.answers={'field-1':''};await store.mutateInteraction(a.scope,a.user,draft);
  const reloaded=await store.readInteraction(a.scope,a.user,first.form.envelope.id);assert.equal(reloaded.answerRevision,1);assert.deepEqual(reloaded.draft,{'field-1':''});
  await denies(()=>store.mutateInteraction(a.scope,a.user,mutation(first.form)));
  await assert.rejects(()=>store.mutateInteraction(a.scope,a.user,{...mutation(first.form,'submit',1),answers:{'field-1':''}}),e=>e.code==='TEXT'&&e.fieldId==='field-1');
  assert.deepEqual((await store.readInteraction(a.scope,a.user,first.form.envelope.id)).draft,{'field-1':''});
 });
 await test('lost submission response recovers one immutable snapshot and continuation',async()=>{
  const request=mutation(first.form,'submit',1);let lost=false;
  const lossy=await a.authority.scope(interceptDatabase(db,/^INSERT INTO chat_interaction_submissions/,async()=>{},async()=>{if(!lost){lost=true;throw Error('Lost response after commit');}}));
  saved=await store.mutateInteraction(lossy,a.user,request);assert(lost);assert.deepEqual(await store.mutateInteraction(a.scope,a.user,request),saved);
  const after=await store.readInteraction(a.scope,a.user,first.form.envelope.id);assert.equal(after.submission.id,request.requestId);assert.equal(after.submission.continuation.state,'not-started');assert.equal(after.draft,null);assert.deepEqual(after.submission.answers,request.answers);
  await denies(()=>store.mutateInteraction(a.scope,a.user,{...request,answers:{...request.answers,'field-1':'Different'}}));
  await assert.rejects(()=>run("UPDATE chat_interaction_submissions SET answers_json='{}' WHERE id=?",request.requestId),/chat_interaction_immutable/);
 });
 await test('actual domain preview preparation, exact review link and lost response replay',async()=>{
  const revision=(await row('SELECT revision FROM workspace_state WHERE user_id=?',a.user)).revision;let lost=false;
  const lossy=await a.authority.scope(interceptDatabase(db,/^INSERT INTO project_spec_proposals/,async()=>{},async()=>{if(!lost){lost=true;throw Error('Lost preview response');}}));
  const result=await continuation.continueContentBrief(lossy,a.user,saved.requestId,revision);assert(lost);assert.equal(result.submission.continuation.state,'succeeded');
  assert.equal((await continuation.continueContentBrief(a.scope,a.user,saved.requestId,revision)).submission.continuation.resultTurnId,saved.requestId);
  const review=await site.readSpecificationProposal(a.scope,a.user,saved.requestId);assert.equal(review.expected_revision,1);assert.match(await(await site.specificationPreview(a.scope,a.user,saved.requestId)).text(),/Gardens, cared for/);
  const turn=await row('SELECT * FROM chat_turns WHERE id=?',saved.requestId);await site.specificationChatLinks(a.scope,a.user,[turn]);assert.equal(turn.specification_review.id,review.id);
  assert.equal((await site.readSpecification(a.scope,a.user,a.project)).revision,1);assert.equal((await row('SELECT count(*) n FROM project_spec_applies WHERE project_id=?',a.project)).n,0);assert.equal((await row('SELECT version_id FROM publications WHERE project_id=?',a.project))?.version_id??null,null);
 });
 await test('a guided Chat turn without an exact submitted continuation cannot create a proposal',async()=>{
  const turn=id(),revision=(await row('SELECT revision FROM workspace_state WHERE user_id=?',a.user)).revision;
  const prepared=await site.prepareSpecification(a.scope,a.user,turn,{kind:'specification',operation:'change',projectId:a.project,expectedRevision:1,operations:[{type:'content.replace',contentId:'headline',text:'Unadmitted proposal'}]});
  await assert.rejects(()=>a.scope.batch([a.scope.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,?,'Unadmitted',?,datetime('now'),'guided','pending')").bind(turn,a.user,revision+1,prepared.reply),...prepared.statements]),/specification_changed/);
  assert.equal(await row('SELECT id FROM chat_turns WHERE id=?',turn),null);
 });
 await test('submit versus cancel and concurrent draft CAS have only one winner',async()=>{
  for(const operations of [['submit','cancel'],['save-draft','save-draft']]){
   const {form}=await issue(a),requests=operations.map(op=>mutation(form,op));
   const results=await Promise.allSettled(requests.map(r=>store.mutateInteraction(a.scope,a.user,r)));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.status===409).length,1);
   assert.equal((await row('SELECT answer_revision FROM chat_interactions WHERE id=?',form.envelope.id)).answer_revision,1);
   if(operations[0]==='save-draft')await store.mutateInteraction(a.scope,a.user,mutation(form,'cancel',1));
  }
 });
 await test('two identical submissions race to the same immutable receipt',async()=>{
  const {form}=await issue(a),request=mutation(form);const results=await Promise.all([store.mutateInteraction(a.scope,a.user,request),store.mutateInteraction(a.scope,a.user,request)]);
  assert.deepEqual(results[0],results[1]);assert.equal((await row('SELECT count(*) n FROM chat_interaction_submissions WHERE interaction_id=?',form.envelope.id)).n,1);assert.equal((await row('SELECT count(*) n FROM chat_interaction_continuations WHERE id=?',request.requestId)).n,1);
 });
 await test('eligibility revocation between validation and commit rolls back all rows',async()=>{
  const c=await owner(),{form}=await issue(c),request=mutation(form);let revoked=false;
  const scope=await c.authority.scope(interceptDatabase(db,/^UPDATE chat_interactions SET answer_revision/,async()=>{if(!revoked){revoked=true;await run('UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE user_id=?',c.user);}}));
  await denies(()=>store.mutateInteraction(scope,c.user,request));assert(revoked);assert.equal((await store.readInteraction(c.scope,c.user,form.envelope.id)).answerRevision,0);assert.equal(await row('SELECT id FROM chat_interaction_submissions WHERE id=?',request.requestId),null);
  assert.equal((await store.mutateInteraction(c.scope,c.user,mutation(form,'cancel'))).operation,'cancel');
 });
 await test('session revocation at commit refuses both writes and later readback',async()=>{
  const c=await owner(),{form}=await issue(c),request=mutation(form);let revoked=false;
  const scope=await c.authority.scope(interceptDatabase(db,/^UPDATE chat_interactions SET answer_revision/,async()=>{if(!revoked){revoked=true;await c.authority.revoke();}}));
  await assert.rejects(()=>store.mutateInteraction(scope,c.user,request),e=>['identity_changed','proof_required'].includes(e.code));assert.equal((await row('SELECT answer_revision FROM chat_interactions WHERE id=?',form.envelope.id)).answer_revision,0);
  await assert.rejects(()=>store.readInteraction(c.scope,c.user,form.envelope.id),e=>['identity_changed','proof_required'].includes(e.code));
 });
 await test('failed continuation preserves answers and cannot automatically retry',async()=>{
  const {form}=await issue(b),request=mutation(form);await store.mutateInteraction(b.scope,b.user,request);
  const result=await continuation.continueContentBrief(b.scope,b.user,request.requestId,0);assert.equal(result.submission.continuation.state,'failed');assert.deepEqual(result.submission.answers,request.answers);
  const revision=(await row('SELECT revision FROM workspace_state WHERE user_id=?',b.user)).revision;
  assert.equal((await continuation.continueContentBrief(b.scope,b.user,request.requestId,revision)).submission.continuation.state,'failed');assert.equal(await row('SELECT id FROM project_spec_proposals WHERE id=?',request.requestId),null);
 });
 await test('unknown write outcome retains identity and never reports completion',async()=>{
  const {form}=await issue(b),request=mutation(form);await store.mutateInteraction(b.scope,b.user,request);
  const scope=await b.authority.scope(interceptDatabase(db,/^INSERT INTO project_spec_proposals/,async()=>{throw Error('Unavailable result transport');}));
  const revision=(await row('SELECT revision FROM workspace_state WHERE user_id=?',b.user)).revision;
  const result=await continuation.continueContentBrief(scope,b.user,request.requestId,revision);assert.equal(result.submission.continuation.state,'unknown');assert.deepEqual(result.submission.answers,request.answers);
  assert.equal((await continuation.continueContentBrief(b.scope,b.user,request.requestId,revision)).submission.continuation.state,'unknown');assert.equal(await row('SELECT id FROM project_spec_proposals WHERE id=?',request.requestId),null);
  await assert.rejects(()=>run('DELETE FROM projects WHERE id=?',b.project),/chat_interaction_receipt_retained/);assert.equal((await store.readInteraction(b.scope,b.user,form.envelope.id)).submission.continuation.state,'unknown');
 });
 await test('stop suppresses unstarted work without deleting accepted answers',async()=>{
  const {form}=await issue(b),request=mutation(form);await store.mutateInteraction(b.scope,b.user,request);
  const stopped=await continuation.stopInteractionContinuation(b.scope,b.user,request.requestId);assert.equal(stopped.submission.continuation.reason,'stopped');assert.deepEqual(stopped.submission.answers,request.answers);
 });
 await test('only current complete clients can read HTTP forms; requests stay private and owned',async()=>{
  const client={versions:[1],fieldTypes:['text','long-text'],bindings:Object.keys(protocol.bindings)};
  const read={version:1,interactionId:first.form.envelope.id,client};
  const env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})}},ctx={waitUntil:()=>{}};
  const call=(account,action,data,origin='https://whumpo.com')=>worker.fetch(new Request('https://whumpo.com/api/chat/interactions/'+action,{method:'POST',headers:{origin,'content-type':'application/json',...(account?{cookie:'__Host-whumpo_session='+account.authority.token}:{})},body:JSON.stringify(data)}),env,ctx);
  const response=await call(a,'v1/read',read);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);assert.equal((await response.json()).submission.id,saved.requestId);
  assert.equal((await call(b,'v1/read',read)).status,404);assert.equal((await call(null,'v1/read',read)).status,401);assert.equal((await call(a,'v1/read',read,'https://foreign.test')).status,403);
  const old=await call(a,'v0/read',read);assert.equal(old.status,409);assert.equal((await old.json()).code,'client_update_required');
  assert.equal((await call(a,'v1/read',{...read,client:{...client,fieldTypes:['text']}})).status,409);
  assert.equal((await call(a,'v1/create',{version:1,definition:{fields:[{label:'Give me your password'}]}})).status,404);
  assert.equal((await call(a,'v1/mutate',{version:1})).status,400);
  const {form}=await issue(a),bad={...mutation(form),answers:{'field-1':''}};
  const invalid=await call(a,'v1/mutate',bad);assert.equal(invalid.status,422);assert.equal((await invalid.json()).fieldId,'field-1');
  const cancel=mutation(form,'cancel');assert.equal((await call(a,'v1/mutate',cancel)).status,200);assert.equal((await call(a,'v1/receipt',{version:1,requestId:cancel.requestId})).status,200);
  const archive=await worker.fetch(new Request('https://whumpo.com/api/chat/export',{headers:{cookie:'__Host-whumpo_session='+a.authority.token}}),env,ctx);
  const exported=await archive.json();assert.equal(exported.format,'whumpo-chat-v2');const facts=exported.turns.find(t=>t.id===first.request.originTurnId).interaction;
  assert.deepEqual(facts.submission.answers,{'field-1':'Gardens, cared for.','field-2':'Seasonal care and planting.'});
  assert.doesNotMatch(JSON.stringify(facts),/definitionDigest|Binding|requestHash|scope|resultTurnId|reviewId|site.content/);
  const history=await worker.fetch(new Request('https://whumpo.com/api/chat/history?before=1000',{headers:{cookie:'__Host-whumpo_session='+a.authority.token}}),env,ctx),data=await history.json();assert(data.turns.some(t=>t.interaction));
  for(const t of data.turns.filter(t=>t.interaction))assert(presentation.readHistoryInteraction(t.interaction),'Current history projection validates');
 });
 await test('superseded forms refuse submission and quota counts only current open forms',async()=>{
  const c=await owner(),{form}=await issue(c);
  await run("UPDATE chat_interactions SET state='superseded',answer_revision=answer_revision+1,draft_json='{}' WHERE id=?",form.envelope.id);
  await denies(()=>store.mutateInteraction(c.scope,c.user,mutation(form)));assert.equal((await store.readInteraction(c.scope,c.user,form.envelope.id)).state,'superseded');
  for(let n=0;n<5;n++)await issue(c);
  await denies(()=>issue(c));assert.equal((await row("SELECT count(*) n FROM chat_interactions WHERE user_id=? AND state='open'",c.user)).n,5);
 });
 await test('expired current definitions remain readable but cannot submit or reopen',async()=>{
  const c=await owner(),scope=structuredClone(first.form.envelope.scope);scope.accountId=c.user;scope.actorId=c.user;scope.projectId=c.project;scope.conversationId=id();scope.taskId=id();scope.originTurnId=await origin(c);
  await run('INSERT INTO chat_conversations(id,user_id) VALUES(?,?)',scope.conversationId,c.user);
  await run('INSERT INTO chat_interaction_tasks(id,user_id,conversation_id,project_id,origin_turn_id) VALUES(?,?,?,?,?)',scope.taskId,c.user,scope.conversationId,c.project,scope.originTurnId);
  const clock=await row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days') createdAt,strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day') expiresAt");
  const envelope=await protocol.sealDefinition({version:1,id:id(),scope,definition:first.form.envelope.definition,...clock});
  await run('INSERT INTO chat_interactions(id,user_id,conversation_id,task_id,project_id,origin_turn_id,envelope_json,definition_digest,issue_hash,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',envelope.id,c.user,scope.conversationId,scope.taskId,c.project,scope.originTurnId,JSON.stringify(envelope),envelope.definitionDigest,'a'.repeat(64),envelope.createdAt,envelope.expiresAt);
  assert.equal((await store.readInteraction(c.scope,c.user,envelope.id)).state,'expired');await denies(()=>store.mutateInteraction(c.scope,c.user,mutation({envelope})));
  await assert.rejects(()=>run("UPDATE chat_interactions SET expires_at='2099-01-01T00:00:00.000Z',answer_revision=1 WHERE id=?",envelope.id),/chat_interaction_changed/);
  assert.deepEqual((await store.listInteractions(c.scope,c.user,listRequest())).items,[]);
  const next=await store.replaceContentBrief(c.scope,c.user,await replacement(c,await store.readInteraction(c.scope,c.user,envelope.id)));assert.equal(next.previousInteractionId,envelope.id);assert.equal(next.state,'open');assert.notEqual(next.envelope.definitionDigest,envelope.definitionDigest);
 });
 await test('deleting project content leaves request identities; direct receipt deletion is refused',async()=>{
  const c=await owner(),{form}=await issue(c),request=mutation(form);await store.mutateInteraction(c.scope,c.user,request);
  await assert.rejects(()=>run('DELETE FROM chat_interaction_requests WHERE user_id=? AND request_id=?',c.user,request.requestId),/chat_interaction_receipt_retained/);
  await run('DELETE FROM projects WHERE id=?',c.project);
  assert.equal(await row('SELECT id FROM chat_interactions WHERE id=?',form.envelope.id),null);assert.equal(await row('SELECT id FROM chat_interaction_submissions WHERE id=?',request.requestId),null);
  assert.equal((await row('SELECT request_id FROM chat_interaction_requests WHERE user_id=? AND request_id=?',c.user,request.requestId)).request_id,request.requestId);
  await denies(()=>store.readInteractionReceipt(c.scope,c.user,request.requestId),404);
 });
 await test('replacement keeps the task, copies edits by content ID and preserves the old snapshot',async()=>{
  const c=await owner(),{form}=await issue(c),draft=mutation(form,'save-draft');draft.answers={'field-1':'My corrected headline','field-2':''};await store.mutateInteraction(c.scope,c.user,draft);
  const before=await store.readInteraction(c.scope,c.user,form.envelope.id),request=await replacement(c,before);request.contentIds.reverse();
  const next=await store.replaceContentBrief(c.scope,c.user,request),old=await store.readInteraction(c.scope,c.user,form.envelope.id);
  assert.equal(next.previousInteractionId,form.envelope.id);assert.equal(old.replacementInteractionId,next.envelope.id);assert.equal(next.envelope.scope.taskId,form.envelope.scope.taskId);assert.equal(next.answerRevision,0);assert.equal(next.submission,null);
  assert.equal(old.state,'superseded');assert.deepEqual(old.draft,draft.answers);assert.deepEqual(next.envelope.definition.fields[0].default,{value:'',provenance:'user'});assert.deepEqual(next.envelope.definition.fields[1].default,{value:'My corrected headline',provenance:'user'});
  assert.equal((await row('SELECT revision FROM chat_interaction_tasks WHERE id=?',form.envelope.scope.taskId)).revision,1);
  await denies(()=>store.mutateInteraction(c.scope,c.user,mutation(form,'submit',before.answerRevision)));
  await assert.rejects(()=>store.mutateInteraction(c.scope,c.user,{...mutation(next),answers:{}}),e=>e.code==='REQUIRED');
  assert.equal((await store.readInteractionReceipt(c.scope,c.user,draft.requestId)).answerRevision,1);
 });
 await test('lost replacement response and same-origin replay return exactly one successor',async()=>{
  const c=await owner(),{form}=await issue(c),request=await replacement(c,form);let lost=false;
  const lossy=await c.authority.scope(interceptDatabase(db,/^INSERT INTO chat_interactions\(/,async()=>{},async()=>{if(!lost){lost=true;throw Error('Lost replacement response');}}));
  const next=await store.replaceContentBrief(lossy,c.user,request);assert(lost);assert.equal((await store.replaceContentBrief(c.scope,c.user,request)).envelope.id,next.envelope.id);
  assert.equal((await row('SELECT count(*) n FROM chat_interactions WHERE previous_interaction_id=?',form.envelope.id)).n,1);
  await denies(()=>store.replaceContentBrief(c.scope,c.user,{...request,contentIds:['about-text']}));
  await denies(()=>store.replaceContentBrief(b.scope,b.user,request),404);
 });
 await test('untouched correction chains preserve edited and omitted answers by content ID',async()=>{
  const c=await owner(),{form}=await issue(c);await store.mutateInteraction(c.scope,c.user,{...mutation(form,'save-draft'),answers:{'field-1':'EXPLICIT_CHAIN_ANSWER'}});const before=await store.readInteraction(c.scope,c.user,form.envelope.id);
  const second=await store.replaceContentBrief(c.scope,c.user,{...await replacement(c,before),contentIds:['section-1-text','headline']});assert.deepEqual(second.envelope.definition.fields[1].default,{value:'EXPLICIT_CHAIN_ANSWER',provenance:'user'});assert.deepEqual(second.envelope.definition.fields[0].default,{value:'',provenance:'user'});
  const third=await store.replaceContentBrief(c.scope,c.user,{...await replacement(c,second),contentIds:['headline','section-1-text','about-text']});assert.deepEqual(third.envelope.definition.fields[0].default,{value:'EXPLICIT_CHAIN_ANSWER',provenance:'user'});assert.deepEqual(third.envelope.definition.fields[1].default,{value:'',provenance:'user'});assert.equal(third.envelope.definition.fields[2].default.provenance,'saved');assert.equal(third.envelope.scope.taskId,form.envelope.scope.taskId);
 });
 await test('empty draft snapshots and cleared content survive corrections and explicit export',async()=>{
  const c=await owner(),{form}=await issue(c);assert.equal(form.draft,null);
  await store.mutateInteraction(c.scope,c.user,mutation(form,'save-draft'));
  const saved=await store.readInteraction(c.scope,c.user,form.envelope.id),next=await store.replaceContentBrief(c.scope,c.user,await replacement(c,saved));
  await store.mutateInteraction(c.scope,c.user,{...mutation(next,'save-draft'),answers:{}});
  let cleared=await store.readInteraction(c.scope,c.user,next.envelope.id);assert.deepEqual(cleared.draft,{});
  const exported=await(await http(c,'/api/chat/export')).json(),record=exported.turns.find(t=>t.id===next.envelope.scope.originTurnId).interaction;
  assert.deepEqual(record.draft.answers,{});assert(record.draft.savedAt);
  for(let n=0;n<2;n++){
   cleared=await store.replaceContentBrief(c.scope,c.user,await replacement(c,cleared));
   assert(cleared.envelope.definition.fields.every(f=>f.default.value===''&&f.default.provenance==='user'));
   await assert.rejects(()=>store.mutateInteraction(c.scope,c.user,{...mutation(cleared),answers:{'field-1':'','field-2':''}}),e=>e.code==='TEXT');
  }
  assert.deepEqual((await store.readInteraction(c.scope,c.user,form.envelope.id)).draft,saved.draft);
 });
 await test('competing replacements and replacement versus draft each have one winner',async()=>{
  for(const competingDraft of [false,true]){
   const c=await owner(),{form}=await issue(c),first=await replacement(c,form),second=competingDraft?mutation(form,'save-draft'):await replacement(c,form);
   const results=await Promise.allSettled([store.replaceContentBrief(c.scope,c.user,first),competingDraft?store.mutateInteraction(c.scope,c.user,second):store.replaceContentBrief(c.scope,c.user,second)]);
   assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.status===409).length,1);
  }
 });
 await test('replacing submitted answers stops only unstarted continuation and retains its receipt',async()=>{
  const c=await owner(),{form}=await issue(c),submit=mutation(form);await store.mutateInteraction(c.scope,c.user,submit);const before=await store.readInteraction(c.scope,c.user,form.envelope.id);
  const next=await store.replaceContentBrief(c.scope,c.user,await replacement(c,before)),old=await store.readInteraction(c.scope,c.user,form.envelope.id);
  assert.equal(old.state,'submitted');assert.equal(old.answerRevision,1);assert.deepEqual(old.submission.answers,submit.answers);assert.equal(old.submission.continuation.reason,'stopped');assert.equal(next.envelope.definition.fields[0].default.provenance,'user');
  assert.equal((await continuation.continueContentBrief(c.scope,c.user,submit.requestId,await revision(c))).submission.continuation.state,'failed');assert.equal(await row('SELECT id FROM project_spec_proposals WHERE id=?',submit.requestId),null);
 });
 await test('lost continuation claim is recoverable without calling the compiler or retrying work',async()=>{
  const c=await owner(),{form}=await issue(c),submit=mutation(form);await store.mutateInteraction(c.scope,c.user,submit);let dropped=false;
  const lossy=await c.authority.scope(interceptDatabase(db,/^UPDATE chat_interaction_continuations SET state='pending'/,async()=>{},async()=>{if(!dropped){dropped=true;throw Error('Claim acknowledgement lost');}}));
  const held=await continuation.continueContentBrief(lossy,c.user,submit.requestId,await revision(c));assert(dropped);assert.equal(held.submission.continuation.state,'pending');
  await denies(async()=>store.replaceContentBrief(c.scope,c.user,await replacement(c,held)));
  await denies(()=>continuation.reconcileContentBrief(b.scope,b.user,submit.requestId),404);
  await run('UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE user_id=?',c.user);
  const recovered=await continuation.reconcileContentBrief(c.scope,c.user,submit.requestId);assert.equal(recovered.submission.continuation.state,'failed');assert.equal(recovered.submission.continuation.reason,'unavailable');assert.deepEqual(recovered.submission.answers,submit.answers);
  assert.equal((await continuation.reconcileContentBrief(c.scope,c.user,submit.requestId)).submission.continuation.state,'failed');assert.equal(await row('SELECT id FROM chat_turns WHERE id=?',submit.requestId),null);
 });
 await test('explicit reconciliation fences an in-flight prepared transaction before it commits',async()=>{
  const c=await owner(),{form}=await issue(c),submit=mutation(form);await store.mutateInteraction(c.scope,c.user,submit);let interrupted=false;
  const paused=await c.authority.scope(interceptDatabase(db,/^INSERT INTO project_spec_proposals/,async()=>{interrupted=true;assert.equal((await continuation.reconcileContentBrief(c.scope,c.user,submit.requestId)).submission.continuation.state,'failed');}));
  const result=await continuation.continueContentBrief(paused,c.user,submit.requestId,await revision(c));assert(interrupted);assert.equal(result.submission.continuation.state,'failed');assert.deepEqual(result.submission.answers,submit.answers);
  assert.equal(await row('SELECT id FROM project_spec_proposals WHERE id=?',submit.requestId),null);assert.equal(await row('SELECT id FROM chat_turns WHERE id=?',submit.requestId),null);
  assert.equal((await continuation.continueContentBrief(c.scope,c.user,submit.requestId,await revision(c))).submission.continuation.state,'failed');
 });
 await test('reconcile resolves an unknown local outcome but never mistakes conflicting rows for success',async()=>{
  const c=await owner(),{form}=await issue(c),submit=mutation(form);await store.mutateInteraction(c.scope,c.user,submit);
  const failed=await c.authority.scope(interceptDatabase(db,/^INSERT INTO project_spec_proposals/,async()=>{throw Error('Unavailable commit');}));
  assert.equal((await continuation.continueContentBrief(failed,c.user,submit.requestId,await revision(c))).submission.continuation.state,'unknown');
  await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at) SELECT ?,user_id,revision+1,'Unrelated','Unrelated',datetime('now') FROM workspace_state WHERE user_id=?",submit.requestId,c.user);
  await denies(()=>continuation.reconcileContentBrief(c.scope,c.user,submit.requestId));assert.equal((await store.readInteraction(c.scope,c.user,form.envelope.id)).submission.continuation.state,'unknown');
  await run('DELETE FROM chat_turns WHERE id=?',submit.requestId);
  const recovered=await continuation.reconcileContentBrief(c.scope,c.user,submit.requestId);assert.equal(recovered.submission.continuation.state,'failed');assert.deepEqual(recovered.submission.answers,submit.answers);
  const next=await store.replaceContentBrief(c.scope,c.user,await replacement(c,recovered));assert.equal(next.previousInteractionId,form.envelope.id);
 });
 await test('successful continuation readback remains truthful even if its preview later expires',async()=>{
  const c=await owner(),{form}=await issue(c),submit=mutation(form);await store.mutateInteraction(c.scope,c.user,submit);
  const prepared=await continuation.continueContentBrief(c.scope,c.user,submit.requestId,await revision(c));assert.equal(prepared.submission.continuation.state,'succeeded');
  await run('DELETE FROM project_spec_proposals WHERE id=?',submit.requestId);
  const recovered=await continuation.reconcileContentBrief(c.scope,c.user,submit.requestId);assert.equal(recovered.submission.continuation.state,'succeeded');assert.equal(recovered.submission.continuation.resultTurnId,submit.requestId);
  await denies(()=>site.readSpecificationProposal(c.scope,c.user,submit.requestId),404);
 });
 await test('correction uses the newly saved revision and preserves the complete earlier draft',async()=>{
  const c=await owner(),{form}=await issue(c),draft={...mutation(form,'save-draft'),answers:{'field-1':'Keep my explicit edit'}};await store.mutateInteraction(c.scope,c.user,draft);
  const other=await issue(c),submit=mutation(other.form);await store.mutateInteraction(c.scope,c.user,submit);const firstPreview=await continuation.continueContentBrief(c.scope,c.user,submit.requestId,await revision(c));assert.equal(firstPreview.submission.continuation.state,'succeeded','first preview');await approve(c,submit.requestId);
  assert.equal((await site.readSpecification(c.scope,c.user,c.project)).revision,2);
  const previous=await store.readInteraction(c.scope,c.user,form.envelope.id),next=await store.replaceContentBrief(c.scope,c.user,await replacement(c,previous));
  assert(next.envelope.definition.fields.every(f=>f.source.revision===2));assert.deepEqual(next.envelope.definition.fields[0].default,{value:'Keep my explicit edit',provenance:'user'});assert.deepEqual(next.envelope.definition.fields[1].default,{value:'',provenance:'user'});
  const answers={...mutation(next),answers:{'field-1':'Keep my explicit edit','field-2':'A new seasonal service'}};await store.mutateInteraction(c.scope,c.user,answers);const nextPreview=await continuation.continueContentBrief(c.scope,c.user,answers.requestId,await revision(c));assert.equal(nextPreview.submission.continuation.state,'succeeded','replacement preview '+JSON.stringify(nextPreview.submission.continuation));assert.equal((await site.readSpecificationProposal(c.scope,c.user,answers.requestId)).expected_revision,2);
  assert.equal((await site.readSpecification(c.scope,c.user,c.project)).revision,2);assert.equal(await row('SELECT version_id FROM publications WHERE project_id=?',c.project),null);
 });
 await test('a website save racing replacement leaves the original draft and task intact',async()=>{
  const c=await owner(),{form}=await issue(c),other=await issue(c),submit=mutation(other.form);await store.mutateInteraction(c.scope,c.user,submit);await continuation.continueContentBrief(c.scope,c.user,submit.requestId,await revision(c));
  const request=await replacement(c,form);let changed=false;
  const scope=await c.authority.scope(interceptDatabase(db,/^INSERT INTO chat_interactions\(/,async()=>{if(!changed){changed=true;await approve(c,submit.requestId);}}));
  await denies(()=>store.replaceContentBrief(scope,c.user,request));assert(changed);assert.equal((await site.readSpecification(c.scope,c.user,c.project)).revision,2);
  const old=await store.readInteraction(c.scope,c.user,form.envelope.id);assert.equal(old.state,'open');assert.equal(old.replacementInteractionId,null);assert.equal((await row('SELECT revision FROM chat_interaction_tasks WHERE id=?',old.envelope.scope.taskId)).revision,0);
 });
 await test('replacement and continuation claim cannot both admit work for the old form',async()=>{
  const c=await owner(),{form}=await issue(c),submit=mutation(form);await store.mutateInteraction(c.scope,c.user,submit);
  const previous=await store.readInteraction(c.scope,c.user,form.envelope.id),request=await replacement(c,previous);let claimed=false;
  const claim=await c.authority.scope(interceptDatabase(db,/^UPDATE chat_interaction_continuations SET state='pending'/,async()=>{},async()=>{claimed=true;throw Error('Claim response lost');}));
  const replacing=await c.authority.scope(interceptDatabase(db,/^INSERT INTO chat_interactions\(/,async()=>{assert.equal((await continuation.continueContentBrief(claim,c.user,submit.requestId,await revision(c))).submission.continuation.state,'pending');}));
  await denies(()=>store.replaceContentBrief(replacing,c.user,request));assert(claimed);assert.equal((await store.readInteraction(c.scope,c.user,form.envelope.id)).replacementInteractionId,null);
  await continuation.reconcileContentBrief(c.scope,c.user,submit.requestId);
  assert.equal((await store.replaceContentBrief(c.scope,c.user,request)).previousInteractionId,form.envelope.id);
 });
 await test('replacement admission rolls back all changes after late feature or session revocation',async()=>{
  for(const identity of [false,true]){
   const c=await owner(),{form}=await issue(c),request=await replacement(c,form);let revoked=false;
   const scope=await c.authority.scope(interceptDatabase(db,/^INSERT INTO chat_interactions\(/,async()=>{revoked=true;if(identity)await c.authority.revoke();else await run('UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE user_id=?',c.user);}));
   await assert.rejects(()=>store.replaceContentBrief(scope,c.user,request),e=>identity?['identity_changed','proof_required'].includes(e.code):e.status===409);assert(revoked);
   assert.equal((await row('SELECT state FROM chat_interactions WHERE id=?',form.envelope.id)).state,'open');assert.equal(await row('SELECT id FROM chat_interactions WHERE previous_interaction_id=?',form.envelope.id),null);assert.equal((await row('SELECT revision FROM chat_interaction_tasks WHERE id=?',form.envelope.scope.taskId)).revision,0);
  }
 });
 await test('resume index pages through current task references without exposing answers or granting authority',async()=>{
  const c=await owner(),original=await issue(c),next=await store.replaceContentBrief(c.scope,c.user,await replacement(c,original.form));
  await store.mutateInteraction(c.scope,c.user,mutation(next,'save-draft'));
  const outstanding=await issue(c),submit=mutation(outstanding.form);await store.mutateInteraction(c.scope,c.user,submit);
  const canceled=await issue(c);await store.mutateInteraction(c.scope,c.user,mutation(canceled.form,'cancel'));
  const firstPage=await store.listInteractions(c.scope,c.user,listRequest(c.project,1));assert(firstPage.nextBefore);
  const secondPage=await store.listInteractions(c.scope,c.user,listRequest(c.project,1,firstPage.nextBefore));assert.equal(secondPage.nextBefore,null);
  const items=[...firstPage.items,...secondPage.items];assert.deepEqual(new Set(items.map(i=>i.interactionId)),new Set([next.envelope.id,outstanding.form.envelope.id]));assert.equal(items.find(i=>i.interactionId===next.envelope.id).hasDraft,true);assert.equal(items.find(i=>i.interactionId===next.envelope.id).task.revision,1);assert.equal(items.find(i=>i.interactionId===outstanding.form.envelope.id).continuation.state,'not-started');
  assert.doesNotMatch(JSON.stringify(items),/Gardens|planting|answers|definitionDigest|Binding|source|requestHash/);
  const before=await revision(c);await run('UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE user_id=?',c.user);assert.equal((await store.listInteractions(c.scope,c.user,listRequest())).items.length,2);assert.equal(await revision(c),before);
  await denies(()=>store.listInteractions(b.scope,b.user,listRequest(c.project)),404);
  const exported=await (await http(c,'/api/chat/export')).json(),old=exported.turns.find(t=>t.id===original.request.originTurnId).interaction,replacementFacts=exported.turns.find(t=>t.id===next.envelope.scope.originTurnId).interaction;
  assert.equal(old.id,original.form.envelope.id);assert.equal(old.replacementInteractionId,next.envelope.id);assert.equal(replacementFacts.previousInteractionId,old.id);assert.doesNotMatch(JSON.stringify([old,replacementFacts]),/definitionDigest|Binding|scope|requestHash|reviewId/);
  await c.authority.revoke();await assert.rejects(()=>store.listInteractions(c.scope,c.user,listRequest()),e=>['identity_changed','proof_required'].includes(e.code));
 });
 await test('HTTP resume and explicit reconciliation remain owned, strict and read-only unless requested',async()=>{
  const c=await owner(),{form}=await issue(c),submit=mutation(form);await store.mutateInteraction(c.scope,c.user,submit);
  const failed=await c.authority.scope(interceptDatabase(db,/^INSERT INTO project_spec_proposals/,async()=>{throw Error('Commit interrupted');}));await continuation.continueContentBrief(failed,c.user,submit.requestId,await revision(c));
  const path='/api/chat/interactions/v1/',listing=await http(c,path+'list',listRequest());assert.equal(listing.status,200);assert.match(listing.headers.get('cache-control'),/no-store/);assert.equal((await listing.json()).items[0].continuation.state,'unknown');
  assert.equal((await store.readInteraction(c.scope,c.user,form.envelope.id)).submission.continuation.state,'unknown');
  assert.equal((await http(c,path+'list',{...listRequest(),limit:21})).status,400);assert.equal((await http(c,path+'list',{...listRequest(),before:{createdAt:'2026-02-31T00:00:00.000Z',interactionId:id()}})).status,400);assert.equal((await http(c,path+'list',{...listRequest(),version:0})).status,409);
  const request={version:1,submissionId:submit.requestId};assert.equal((await http(b,path+'reconcile',request)).status,404);assert.equal((await http(c,path+'reconcile',{...request,retry:true})).status,400);
  const response=await http(c,path+'reconcile',request);assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);assert.deepEqual(Object.keys(await response.json()).sort(),['continuation','submissionId','version']);
  assert.deepEqual((await (await http(c,path+'list',listRequest())).json()).items,[]);assert.deepEqual((await store.readInteraction(c.scope,c.user,form.envelope.id)).submission.answers,submit.answers);
 });
 await test('project removal clears a replacement chain and readbacks but preserves request replay tombstones',async()=>{
  const c=await owner(),{form}=await issue(c),submit=mutation(form);await store.mutateInteraction(c.scope,c.user,submit);
  assert.equal((await http(c,'/api/projects',{name:'Another garden',purpose:'Keep the fixture workspace available after project removal'})).status,201);
  const next=await store.replaceContentBrief(c.scope,c.user,await replacement(c,await store.readInteraction(c.scope,c.user,form.envelope.id))),draft=mutation(next,'save-draft');await store.mutateInteraction(c.scope,c.user,draft);
  await run('DELETE FROM projects WHERE id=?',c.project);
  assert.equal((await row('SELECT count(*) n FROM chat_interactions WHERE user_id=?',c.user)).n,0);assert.equal((await row('SELECT count(*) n FROM chat_interaction_tasks WHERE user_id=?',c.user)).n,0);
  assert.equal((await row('SELECT count(*) n FROM chat_interaction_requests WHERE user_id=?',c.user)).n,2);assert.deepEqual((await store.listInteractions(c.scope,c.user,listRequest())).items,[]);
  await denies(()=>store.readInteraction(c.scope,c.user,next.envelope.id),404);await denies(()=>store.readInteractionReceipt(c.scope,c.user,submit.requestId),404);
  assert((await (await http(c,'/api/chat/export')).json()).turns.every(t=>!t.interaction));
 });
 await test('explicit cancel removes copied defaults and draft payload while exact receipts still replay',async()=>{
  const c=await owner(),{form}=await issue(c),draft=mutation(form,'save-draft');await store.mutateInteraction(c.scope,c.user,draft);const cancel=mutation(form,'cancel',1),receipt=await store.mutateInteraction(c.scope,c.user,cancel);
  const removed=await row('SELECT envelope_json,draft_json,removed_at,removal_reason FROM chat_interactions WHERE id=?',form.envelope.id);assert.equal(removed.envelope_json,null);assert.equal(removed.draft_json,'{}');assert(removed.removed_at);assert.equal(removed.removal_reason,'discarded');
  await denies(()=>store.readInteraction(c.scope,c.user,form.envelope.id),410);assert.deepEqual(await store.mutateInteraction(c.scope,c.user,cancel),receipt);assert.equal((await store.mutateInteraction(c.scope,c.user,draft)).requestId,draft.requestId);
  await denies(()=>store.mutateInteraction(c.scope,c.user,{...draft,answers:{'field-1':'Changed replay'}}));await denies(()=>store.mutateInteraction(c.scope,c.user,mutation(form)),410);
  const facts=(await (await http(c,'/api/chat/export')).json()).turns.find(t=>t.id===form.envelope.scope.originTurnId).interaction;assert.equal(facts.state,'removed');assert.equal(facts.removal.reason,'discarded');assert.doesNotMatch(JSON.stringify(facts),/headline|Gardens|fields|default|answers/);
 });
 await test('inactive drafts are hidden before cleanup; latest edits and accepted snapshots have separate retention',async()=>{
  const c=await owner(),{form}=await issue(c),definition=structuredClone(form.envelope.definition);definition.fields[0].default={value:'PRIVATE_DEFAULT_CANARY',provenance:'user'};
  const old=await aged(c,definition),recent=await aged(c,definition,{createdDays:8,editedDays:2}),accepted=await aged(c,definition,{submitted:true,unknown:true});
  const {maintenanceReport}=await import('../tools/report-maintenance.mjs'),report=await maintenanceReport(db),backlog=report.backlogs.find(q=>q.queue==='chat_drafts');assert.equal(backlog.count,1);assert.equal(backlog.state,'attention');assert.doesNotMatch(JSON.stringify(report),/PRIVATE_|PRIVATE_DEFAULT_CANARY/);
  await denies(()=>store.readInteraction(c.scope,c.user,old.envelope.id),410);await denies(()=>store.readInteraction(b.scope,b.user,old.envelope.id),404);
  assert.equal((await store.readInteraction(c.scope,c.user,recent.envelope.id)).state,'expired');assert.equal((await store.readInteraction(c.scope,c.user,accepted.envelope.id)).submission.continuation.state,'unknown');
  const archive=await (await http(c,'/api/chat/export')).json(),oldFacts=archive.turns.find(t=>t.id===old.envelope.scope.originTurnId).interaction,recentFacts=archive.turns.find(t=>t.id===recent.envelope.scope.originTurnId).interaction;
  assert.equal(oldFacts.state,'removed');assert.equal(oldFacts.removal.completedAt,null);assert.doesNotMatch(JSON.stringify(oldFacts),/PRIVATE_|answers|fields/);
  assert.deepEqual(recentFacts.draft.answers,recent.request.answers);assert.equal(recentFacts.draft.answerRevision,1);assert.equal(recentFacts.draft.savedAt,recent.clock.savedAt);assert(recentFacts.observedAt);
  const history=await (await http(c,'/api/chat/history?before=10000')).json();assert.equal(history.turns.find(t=>t.id===recent.envelope.scope.originTurnId).interaction.draft,undefined);
  assert.equal((await retention.cleanupInteractionDrafts(db)).removed,1);assert.equal((await retention.cleanupInteractionDrafts(db)).removed,0);
  const erased=await row('SELECT envelope_json,draft_json,removed_at,removal_reason FROM chat_interactions WHERE id=?',old.envelope.id);assert.equal(erased.envelope_json,null);assert.equal(erased.draft_json,'{}');assert(erased.removed_at);assert.equal(erased.removal_reason,'inactive');
  assert.equal((await store.mutateInteraction(c.scope,c.user,old.request)).requestId,old.request.requestId);await denies(()=>store.mutateInteraction(c.scope,c.user,{...old.request,answers:{'field-1':'Different'}}));
  assert.deepEqual((await store.readInteraction(c.scope,c.user,accepted.envelope.id)).submission.answers,accepted.request.answers);assert.equal((await store.readInteraction(c.scope,c.user,accepted.envelope.id)).submission.continuation.state,'unknown');
  await assert.rejects(()=>run("UPDATE chat_interactions SET envelope_json=NULL,draft_json='{}',draft_saved_at=NULL,removed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),removal_reason='inactive',answer_revision=answer_revision+1 WHERE id=?",recent.envelope.id),/chat_interaction_changed/);
  await assert.rejects(()=>run("UPDATE chat_interactions SET envelope_json=NULL,draft_json='{}',draft_saved_at=NULL,removed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),removal_reason='inactive',answer_revision=answer_revision+1 WHERE id=?",accepted.envelope.id),/chat_interaction_changed/);
 });
 await test('scheduled cleanup reports failures and removes only eligible form payloads on retry',async()=>{
  const c=await owner(),{form}=await issue(c),old=await aged(c,form.envelope.definition);let failed=true;
  const interrupted=interceptDatabase(db,/^UPDATE chat_interactions SET envelope_json=NULL/,async()=>{if(failed)throw Error('PRIVATE_MAINTENANCE_CANARY');});
  await assert.rejects(()=>worker.scheduled({cron:'47 * * * *'},{...env,DB:interrupted}),/Scheduled maintenance or telemetry failed/);assert.equal((await row("SELECT status FROM maintenance_health WHERE job='chat_drafts'")).status,'failed');assert.notEqual((await row('SELECT envelope_json FROM chat_interactions WHERE id=?',old.envelope.id)).envelope_json,null);
  failed=false;await worker.scheduled({cron:'47 * * * *'},{...env,DB:interrupted});assert.equal((await row("SELECT status FROM maintenance_health WHERE job='chat_drafts'")).status,'completed');assert.equal((await row('SELECT envelope_json FROM chat_interactions WHERE id=?',old.envelope.id)).envelope_json,null);
  assert.equal((await store.readInteraction(c.scope,c.user,form.envelope.id)).state,'open');
 });
 await test('a correction receipt remains readable when its predecessor payload later expires',async()=>{
  const c=await owner(),{form}=await issue(c),old=await aged(c,form.envelope.definition),originTurnId=await origin(c);
  const request={originTurnId,previousInteractionId:old.envelope.id,definitionDigest:old.envelope.definitionDigest,expectedAnswerRevision:1,contentIds:['headline','section-1-text']};
  const clock=await row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now','-2 days') createdAt,strftime('%Y-%m-%dT%H:%M:%fZ','now','+5 days') expiresAt");
  const envelope=await protocol.sealDefinition({version:1,id:id(),scope:{...old.envelope.scope,originTurnId},definition:old.envelope.definition,...clock}),hash=await codec.jsonDigest({originTurnId,projectId:c.project,contentIds:request.contentIds,replacement:request});
  // A current-schema historical successor issued while the parent was retained.
  await run("UPDATE chat_interactions SET state='superseded',answer_revision=answer_revision+1 WHERE id=?",old.envelope.id);
  await run('UPDATE chat_interaction_tasks SET revision=1 WHERE id=?',old.envelope.scope.taskId);
  await run('INSERT INTO chat_interactions(id,user_id,conversation_id,task_id,project_id,origin_turn_id,previous_interaction_id,envelope_json,definition_digest,issue_hash,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',envelope.id,c.user,envelope.scope.conversationId,envelope.scope.taskId,c.project,originTurnId,old.envelope.id,JSON.stringify(envelope),envelope.definitionDigest,hash,envelope.createdAt,envelope.expiresAt);
  await retention.cleanupInteractionDrafts(db);assert.equal((await row('SELECT envelope_json FROM chat_interactions WHERE id=?',old.envelope.id)).envelope_json,null);
  assert.equal((await store.replaceContentBrief(c.scope,c.user,request)).envelope.id,envelope.id);
  await denies(()=>store.replaceContentBrief(c.scope,c.user,{...request,contentIds:['about-text']}));await denies(()=>store.replaceContentBrief(b.scope,b.user,request),404);
 });
 await test('inactive-draft expiry under a preservation hold keeps a restricted copy and stays invisible to the owner',async()=>{
  const c=await owner(),{form}=await issue(c),held=await aged(c,form.envelope.definition),free=await owner(),{form:freeForm}=await issue(free),unheld=await aged(free,freeForm.envelope.definition);
  const caseId='case-'+id().slice(0,8),holdId='hold-'+id().slice(0,8);
  await run("INSERT INTO safety_cases(id,subject_user_id,intake_ref,opened_by,opened_at) VALUES(?,?,'intake-1','human:reviewer',unixepoch())",caseId,c.user);
  await run("INSERT INTO safety_preservation_holds(id,case_id,subject_user_id,scope,project_id,legal_basis_ref,approved_by,placed_at,review_due_at) VALUES(?,?,?,'project',?,'basis-1','human:approver',unixepoch(),unixepoch()+86400)",holdId,caseId,c.user,c.project);
  const before=(await row('SELECT count(*) n FROM safety_preserved_records')).n;
  await retention.cleanupInteractionDrafts(db);
  for(const draft of [held,unheld])assert.equal((await row('SELECT envelope_json FROM chat_interactions WHERE id=?',draft.envelope.id)).envelope_json,null);
  const kept=await row('SELECT hold_id,project_id,source,source_id,payload_json FROM safety_preserved_records WHERE source_id=?',held.envelope.id);
  assert.deepEqual([kept.hold_id,kept.project_id,kept.source],[holdId,c.project,'chat_interaction_draft']);assert.equal(JSON.parse(kept.payload_json).envelope.id,held.envelope.id);
  assert.equal((await row('SELECT count(*) n FROM safety_preserved_records WHERE source_id=?',unheld.envelope.id)).n,0);assert.equal((await row('SELECT count(*) n FROM safety_preserved_records')).n,before+1);
  await denies(()=>store.readInteraction(c.scope,c.user,held.envelope.id),410); // the owner sees the ordinary expiry
  await assert.rejects(()=>run('DELETE FROM safety_preserved_records WHERE source_id=?',held.envelope.id),/safety_preservation_hold/);
  await run("UPDATE safety_preservation_holds SET released_at=unixepoch(),released_by='human:approver',release_ref='release-1' WHERE id=?",holdId);
  assert.equal((await row('SELECT count(*) n FROM safety_preserved_records WHERE source_id=?',held.envelope.id)).n,0);
 });
 assert.equal(network,0);assert.equal((await row('SELECT count(*) n FROM chat_interaction_checks')).n,0);assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 await test('history omits copied draft defaults while export and fresh owned reads retain them',async()=>{
  const c=await owner(),{form}=await issue(c),draft={...mutation(form,'save-draft'),answers:{'field-1':'UNSUBMITTED_HISTORY_CANARY'}};
  await store.mutateInteraction(c.scope,c.user,draft);const current=await store.readInteraction(c.scope,c.user,form.envelope.id);
  const next=await store.replaceContentBrief(c.scope,c.user,await replacement(c,current));
  const history=await(await http(c,'/api/chat/history?before=10000')).json();assert.doesNotMatch(JSON.stringify(history),/UNSUBMITTED_HISTORY_CANARY|"default":|definitionDigest|submitBinding/);
  const record=history.turns.find(t=>t.id===next.envelope.scope.originTurnId).interaction;assert(presentation.readHistoryInteraction(record));assert.equal(record.fields[0].defaultProvenance,'user');
  const archive=await(await http(c,'/api/chat/export')).json();assert.match(JSON.stringify(archive),/UNSUBMITTED_HISTORY_CANARY/);
  const list=await store.listInteractions(c.scope,c.user,listRequest());assert(presentation.readInteractionIndex(list));assert.equal(list.items[0].projectName,'Garden');assert.doesNotMatch(JSON.stringify(list),/UNSUBMITTED_HISTORY_CANARY|default|answers/);
  await run("UPDATE projects SET name='Garden renewed' WHERE id=?",c.project);assert.equal((await store.readInteraction(c.scope,c.user,next.envelope.id)).projectName,'Garden renewed');
  await store.mutateInteraction(c.scope,c.user,mutation(next,'cancel'));
  const removed=(await(await http(c,'/api/chat/history?before=10000')).json()).turns.find(t=>t.id===next.envelope.scope.originTurnId).interaction;assert.equal(removed.state,'removed');assert(presentation.readHistoryInteraction(removed));
 });
 console.log(`Chat interaction storage: ${cases} scenarios passed (${process.argv.includes('--d1')?'local D1':'SQLite'}), actual compiler/review handlers, zero inference/network calls. Authenticated HTTP/history/export checked; no UI/deployment acceptance claimed.`);
}catch(error){console.error(error);process.exitCode=1;}finally{globalThis.fetch=originalFetch;await fixture.close();}
