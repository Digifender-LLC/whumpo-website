import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
Error.stackTraceLimit=0;
const modules=await currentFixtureModules(['src/chat-interactions/store.ts','src/chat-interactions/continuation.ts','src/project-specification/store.ts','src/chat-interactions/protocol.ts','src/index.ts']);
const store=await modules.module('src/chat-interactions/store.ts'),continuation=await modules.module('src/chat-interactions/continuation.ts'),site=await modules.module('src/project-specification/store.ts');
const protocol=await modules.module('src/chat-interactions/protocol.ts'),worker=(await modules.module('src/index.ts')).default;
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
async function issue(o,database=o.scope){
 const origin=id();await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at) SELECT ?,user_id,revision+1,'Change my page','Please review the text.',datetime('now') FROM workspace_state WHERE user_id=?",origin,o.user);await run('UPDATE workspace_state SET revision=revision+1 WHERE user_id=?',o.user);
 const request={originTurnId:origin,projectId:o.project,contentIds:['headline','section-1-text']};
 return {request,form:await store.issueContentBrief(database,o.user,request)};
}
function mutation(form,operation='submit',revision=0){return {version:1,requestId:id(),interactionId:form.envelope.id,definitionDigest:form.envelope.definitionDigest,expectedAnswerRevision:revision,operation,...(operation==='cancel'?{}:{answers:{'field-1':'Gardens, cared for.','field-2':'Seasonal care and planting.'}})};}
const denies=(fn,status=409)=>assert.rejects(fn,e=>e.status===status);
try{
 const a=await owner(),b=await owner(),first=await issue(a);let saved;
 await test('server-owned defaults, target limits and idempotent issuance',async()=>{
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
  const after=await store.readInteraction(a.scope,a.user,first.form.envelope.id);assert.equal(after.submission.id,request.requestId);assert.equal(after.submission.continuation.state,'not-started');assert.deepEqual(after.draft,{});assert.deepEqual(after.submission.answers,request.answers);
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
   assert.equal((await store.readInteraction(a.scope,a.user,form.envelope.id)).answerRevision,1);
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
  const history=await worker.fetch(new Request('https://whumpo.com/api/chat/history?before=1000',{headers:{cookie:'__Host-whumpo_session='+a.authority.token}}),env,ctx);assert((await history.json()).turns.some(t=>t.interaction));
 });
 await test('superseded forms refuse submission and quota counts only current open forms',async()=>{
  const c=await owner(),{form}=await issue(c);
  await run("UPDATE chat_interactions SET state='superseded',answer_revision=answer_revision+1,draft_json='{}' WHERE id=?",form.envelope.id);
  await denies(()=>store.mutateInteraction(c.scope,c.user,mutation(form)));assert.equal((await store.readInteraction(c.scope,c.user,form.envelope.id)).state,'superseded');
  for(let n=0;n<5;n++)await issue(c);
  await denies(()=>issue(c));assert.equal((await row("SELECT count(*) n FROM chat_interactions WHERE user_id=? AND state='open'",c.user)).n,5);
 });
 await test('expired current definitions remain readable but cannot submit or reopen',async()=>{
  const c=await owner(),scope=structuredClone(first.form.envelope.scope);scope.accountId=c.user;scope.actorId=c.user;scope.projectId=c.project;scope.conversationId=id();scope.taskId=id();scope.originTurnId=id();
  await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at) VALUES(?,?,2,'Past brief','Past brief',datetime('now'))",scope.originTurnId,c.user);
  await run('INSERT INTO chat_conversations(id,user_id) VALUES(?,?)',scope.conversationId,c.user);
  await run('INSERT INTO chat_interaction_tasks(id,user_id,conversation_id,project_id,origin_turn_id) VALUES(?,?,?,?,?)',scope.taskId,c.user,scope.conversationId,c.project,scope.originTurnId);
  const envelope=await protocol.sealDefinition({version:1,id:id(),scope,definition:first.form.envelope.definition,createdAt:'2020-01-01T00:00:00.000Z',expiresAt:'2020-01-08T00:00:00.000Z'});
  await run('INSERT INTO chat_interactions(id,user_id,conversation_id,task_id,project_id,origin_turn_id,envelope_json,definition_digest,issue_hash,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',envelope.id,c.user,scope.conversationId,scope.taskId,c.project,scope.originTurnId,JSON.stringify(envelope),envelope.definitionDigest,'a'.repeat(64),envelope.createdAt,envelope.expiresAt);
  assert.equal((await store.readInteraction(c.scope,c.user,envelope.id)).state,'expired');await denies(()=>store.mutateInteraction(c.scope,c.user,mutation({envelope})));
  await assert.rejects(()=>run("UPDATE chat_interactions SET expires_at='2099-01-01T00:00:00.000Z',answer_revision=1 WHERE id=?",envelope.id),/chat_interaction_changed/);
 });
 await test('deleting project content leaves request identities; direct receipt deletion is refused',async()=>{
  const c=await owner(),{form}=await issue(c),request=mutation(form);await store.mutateInteraction(c.scope,c.user,request);
  await assert.rejects(()=>run('DELETE FROM chat_interaction_requests WHERE user_id=? AND request_id=?',c.user,request.requestId),/chat_interaction_receipt_retained/);
  await run('DELETE FROM projects WHERE id=?',c.project);
  assert.equal(await row('SELECT id FROM chat_interactions WHERE id=?',form.envelope.id),null);assert.equal(await row('SELECT id FROM chat_interaction_submissions WHERE id=?',request.requestId),null);
  assert.equal((await row('SELECT request_id FROM chat_interaction_requests WHERE user_id=? AND request_id=?',c.user,request.requestId)).request_id,request.requestId);
  await denies(()=>store.readInteractionReceipt(c.scope,c.user,request.requestId),404);
 });
 assert.equal(network,0);assert.equal((await row('SELECT count(*) n FROM chat_interaction_checks')).n,0);assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 console.log(`Chat interaction storage: ${cases} scenarios passed (${process.argv.includes('--d1')?'local D1':'SQLite'}), actual compiler/review handlers, zero inference/network calls. Authenticated HTTP/history/export checked; no UI/deployment acceptance claimed.`);
}catch(error){console.error(error);process.exitCode=1;}finally{globalThis.fetch=originalFetch;await fixture.close();}
