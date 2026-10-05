import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
import {runUsageReview} from '../tools/usage-review-input.mjs';
Error.stackTraceLimit=process.env.TRACE?20:0;
// WH-016 owner notice and independent appeal (owner decision October 4, 2026, issue #172) over the actual Worker (Support
// API, Chat orchestration and the Chat support view), the restricted safety-case module and the operator HTTP surface.
// Synthetic placeholders and scripted inference only; no network, provider, email or real case. SQLite by default;
// `--d1` runs the same checks on local D1.
const d1=process.argv.includes('--d1');
const modules=await currentFixtureModules(['src/index.ts','src/safety-cases.ts','src/usage-review-requests.ts','src/support-shape.ts']);
const worker=(await modules.module('src/index.ts')).default,c=await modules.module('src/safety-cases.ts'),service=await modules.module('src/usage-review-requests.ts'),shape=await modules.module('src/support-shape.ts');
const fixture=await databaseFixture({d1}),{db}=fixture,id=()=>crypto.randomUUID();
const run=(q,...p)=>db.prepare(q).bind(...p).run(),row=(q,...p)=>db.prepare(q).bind(...p).first(),all=async(q,...p)=>(await db.prepare(q).bind(...p).all()).results;
const count=async(table,where='1',...p)=>(await row(`SELECT count(*) AS n FROM ${table} WHERE ${where}`,...p)).n;
const config={baseURL:'https://opencode.ai/zen/go/v1',model:'muse-spark-1.3-contributor',apiKey:'synthetic-only',protocol:'responses'};
const env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})},AI_BASE_URL:config.baseURL,AI_MODEL:config.model,AI_PROTOCOL:config.protocol,AI_API_KEY:config.apiKey};
const APPEAL='SYNTHETIC-APPEAL-STATEMENT-CANARY';
let queue=[],mainCalls=0,checks=0;const ok=()=>checks++,originalFetch=globalThis.fetch;
const response=action=>Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify({reply:'Scripted reply.',action})}]}],usage:{input_tokens:100,output_tokens:200}});
globalThis.fetch=async(url,init)=>{
 assert.equal(String(url),config.baseURL+'/responses','Unexpected external request');
 const request=JSON.parse(init.body);
 if(request.max_output_tokens===256)return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:'{"intent":"editing"}'}]}],usage:{input_tokens:10,output_tokens:10}});
 mainCalls++;assert(queue.length,'Unexpected extra inference');const step=queue.shift(),value=typeof step==='function'?await step(request):step;return value instanceof Response?value:response(value);
};
const http=(token,path,data)=>worker.fetch(new Request('https://whumpo.com'+path,{method:data?'POST':'GET',headers:{origin:'https://whumpo.com',cookie:'__Host-whumpo_session='+token,...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})}),env,{waitUntil(){}});
async function json(o,path,data,status=200){const r=await http(o.authority.token,path,data);assert.equal(r.status,status,await r.clone().text());return r.json();}
const refused=async(fn,reason)=>{await assert.rejects(fn,e=>e instanceof c.SafetyCaseError&&e.reason===reason,reason);ok();};
async function owner(){
 const authority=await workspaceFixture(db,modules.identity),user=authority.account;
 await run("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')",user);
 await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Garden','Landscaping','draft',datetime('now'),datetime('now'))",id(),user);
 await run("INSERT INTO feature_preview_grants VALUES(?,1,?,NULL,'core.editing','prepare','private-test-acceptance','synthetic appeal fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),user);
 return {authority,user,p:await modules.identity.resolveIdentity(db,{version:1,client:'web',kind:'session',token:authority.token})};
}
const operator=async(o)=>{const authority=o?o.authority:await workspaceFixture(db,modules.identity);return {id:authority.account,authority,p:await modules.identity.resolveIdentity(db,{version:1,client:'web',kind:'session',token:authority.token})};};
const revision=async o=>(await row('SELECT revision FROM workspace_state WHERE user_id=?',o.user)).revision;
async function chat(o,content,steps){queue=steps;const input={id:id(),revision:await revision(o),content},before=mainCalls,data=await json(o,'/api/chat',input);assert.equal(queue.length,0,'Every scripted step was used');return {calls:mainCalls-before,turn:data.turns.find(t=>t.id===input.id)};}
const client={versions:[1],fieldTypes:['text','long-text'],bindings:['answer.value@1','support.request@1','support.requests@1']};
const overview=o=>json(o,'/api/support/v1');
const appeal=(o,notice,statement=APPEAL,extra={})=>json(o,'/api/support/v1/requests',{version:1,id:extra.id??id(),kind:'safety_appeal',statement,reference:'safety_notice:'+notice,...(extra.body??{})},extra.status??200);
const operatorCall=async(token,path,data)=>{const r=await http(token,'/api/operator/safety-cases/v1/'+path,{version:1,...data});return {status:r.status,body:await r.json()};};
try{
 const a=await owner(),b=await owner();
 const admin=await operator(),actor=await operator(),independent=await operator(),auditor=await operator(),keeper=await operator(),outsider=await operator(),subjectOperator=await operator(a);
 await c.bootstrapSafetyRoleAdministrator(db,{grantId:'grant-admin',accountId:admin.id});
 for(const [g,o,role] of [['g-actor',actor,'case_reviewer'],['g-independent',independent,'case_reviewer'],['g-auditor',auditor,'case_auditor'],['g-keeper',keeper,'preservation_approver'],['g-subject',subjectOperator,'case_reviewer']])
  await c.grantSafetyCaseRole(db,admin.p,{grantId:g,operatorAccountId:o.id,role});
 const notices=async o=>(await overview(o)).requests.filter(r=>r.kind==='safety_notice');

 // ---- "Action taken" is a confirmed policy finding. Opening a case, an uncertain flag, a hold and a not_confirmed
 // decision never notify the owner.
 await c.openSafetyCase(db,actor.p,{caseId:'case-n1',subjectUserId:a.user,intakeRef:'abuse-report:synthetic-1'});
 await c.placePreservationHold(db,keeper.p,{holdId:'hold-n1',caseId:'case-n1',legalBasisRef:'basis-n1',reviewDays:30});
 await c.recordSafetyCaseFinding(db,actor.p,{caseId:'case-n1',finding:'not_confirmed',decisionRef:'decision-n1-a'});
 assert.equal(await count('safety_action_notices'),0);assert.deepEqual(await notices(a),[]);assert.equal(await count('usage_review_requests',"kind='safety_notice'"),0);ok();
 // The confirmed finding issues exactly one restricted notice (generation) and one in-app notice (delivery) in its transaction.
 await c.recordSafetyCaseFinding(db,actor.p,{caseId:'case-n1',finding:'confirmed_policy_finding',decisionRef:'decision-n1-b'});
 await c.recordSafetyCaseFinding(db,actor.p,{caseId:'case-n1',finding:'confirmed_policy_finding',decisionRef:'decision-n1-b'});
 const generated=await all('SELECT * FROM safety_action_notices');assert.equal(generated.length,1,'An exact retry issues no second notice');
 const n1=generated[0];assert.deepEqual([n1.case_id,n1.finding_seq,n1.subject_user_id,n1.acted_by],['case-n1',3,a.user,'human:'+actor.id]);assert.match(n1.id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);ok();
 const [shown]=await notices(a);assert.equal(shown.id,n1.id);assert.equal(shown.state,'answered');assert.equal(shown.read.state,'unread');assert.equal(shown.delivery.state,'none','Saved in Whumpo; no external delivery is configured');
 assert.equal(shown.statement,'Safety review notice');assert.match(shown.publicResponse,/confirmed that content in your Whumpo account breaks the Acceptable Use Policy/);assert.match(shown.publicResponse,/does not say who reported anything or what they wrote/);assert.match(shown.publicResponse,/Appeal this decision/);assert.match(shown.publicResponse,/did not make this decision/);ok();
 // The owner sees no reporter, report, case, intake, hold or reviewer detail.
 const visible=JSON.stringify(await overview(a));for(const secret of ['case-n1','synthetic-1','abuse-report','hold-n1','basis-n1','decision-n1',actor.id,keeper.id,'human:'])assert.ok(!visible.includes(secret),secret);ok();
 assert.deepEqual(await notices(b),[],'Another owner sees nothing');assert.equal((await json(b,'/api/support/v1/requests/'+n1.id,undefined,404)).error!==undefined,true);ok();
 // Read receipts work like any saved response; the restricted generation record is unchanged by them.
 await json(a,'/api/support/v1/requests/'+n1.id+'/read',{version:1});assert.equal((await json(a,'/api/support/v1/requests/'+n1.id)).request.read.state,'read');ok();
 // Notices are immutable and cannot be forged by an owner or by a direct insert.
 await json(a,'/api/support/v1/requests',{version:1,id:id(),kind:'safety_notice',statement:'forged'},400);
 await assert.rejects(()=>run("INSERT INTO usage_review_requests(id,user_id,statement,kind,source,state,public_response,answered_by,answered_at) VALUES(?,?,'x','safety_notice','safety','answered','x','safety_review',strftime('%Y-%m-%dT%H:%M:%fZ','now'))",id(),a.user),/usage_review_initial/);
 await assert.rejects(()=>run("INSERT INTO safety_action_notices(id,case_id,finding_seq,subject_user_id,acted_by,issued_at) VALUES(?,'case-n1',2,?,?,unixepoch())",id(),a.user,'human:'+actor.id),/safety_case_immutable|UNIQUE/);
 await assert.rejects(()=>run('UPDATE safety_action_notices SET acted_by=? WHERE id=?','human:'+independent.id,n1.id),/safety_case_immutable/);
 await assert.rejects(()=>run('DELETE FROM safety_action_notices WHERE id=?',n1.id),/safety_case_immutable/);ok();

 // ---- Chat: the owner reads the notice in the Chat support view; its text never enters model context.
 let viewTurn;
 const looked=await chat(a,'Did Whumpo send me a safety notice?',[
  body=>{const text=JSON.stringify(body);assert.doesNotMatch(text,/Acceptable Use Policy \(https|case-n1|human:/,'Context carries no notice text');return {kind:'interaction',operation:'readSupport',requestId:n1.id};},
  body=>{const text=JSON.stringify(body);assert.match(text,/textAvailableToModel/);assert.doesNotMatch(text,/confirmed that content|case-n1|human:/,'An exact lookup returns metadata only');return {kind:'interaction',operation:'showSupport'};}]);
 assert.equal(looked.calls,2);viewTurn=looked.turn.interaction_id;assert.ok(viewTurn);ok();
 const view=await json(a,'/api/chat/interactions/v1/read',{version:1,interactionId:viewTurn,client});
 const card=await json(a,'/api/chat/interactions/v1/card',{version:1,interactionId:view.envelope.id,definitionDigest:view.envelope.definitionDigest,cardId:'support-requests'});
 assert.ok(shape.readSupportRequestsCard(card),'The shared reader accepts notice rows');const inCard=card.data.requests.find(r=>r.id===n1.id);
 assert.equal(inCard.kind,'safety_notice');assert.match(inCard.publicResponse,/Acceptable Use Policy/);assert.ok(!JSON.stringify(card).includes('case-n1'));ok();
 await json(b,'/api/chat/interactions/v1/card',{version:1,interactionId:view.envelope.id,definitionDigest:view.envelope.definitionDigest,cardId:'support-requests'},404);ok();

 // ---- Appeal through the support channel: the owner's own notice, once.
 await json(a,'/api/support/v1/requests',{version:1,id:id(),kind:'safety_appeal',statement:'x'},400);
 await json(a,'/api/support/v1/requests',{version:1,id:id(),kind:'help',statement:'x',reference:'safety_notice:'+n1.id},400);
 await appeal(b,n1.id,'foreign',{status:404});ok();
 await appeal(a,id(),'unknown',{status:404});ok();
 const appealId=id(),filed=await appeal(a,n1.id,APPEAL,{id:appealId});assert.equal(filed.request.kind,'safety_appeal');assert.equal(filed.request.state,'open');assert.equal(filed.request.reference,'safety_notice:'+n1.id);ok();
 assert.equal((await appeal(a,n1.id,APPEAL,{id:appealId})).replayed,true,'Exact replay');ok();
 await appeal(a,n1.id,'second appeal',{status:409});assert.equal(await count('usage_review_requests',"kind='safety_appeal'"),1);ok();
 await assert.rejects(()=>run("INSERT INTO usage_review_requests(id,user_id,statement,kind,source,reference) VALUES(?,?,'x','safety_appeal','support',?)",id(),b.user,'safety_notice:'+n1.id),/usage_review_initial|UNIQUE/);ok();
 // Appeal text stays out of model context like usage-review text.
 await chat(a,'What did I write in my appeal?',[body=>{assert.doesNotMatch(JSON.stringify(body),new RegExp(APPEAL));return {kind:'interaction',operation:'readSupport',requestId:appealId};},
  body=>{assert.doesNotMatch(JSON.stringify(body),new RegExp(APPEAL),'Appeal text is never returned to the model');return null;}]);ok();
 // The ordinary support operator tool cannot answer or even queue appeals or notices.
 assert.ok(!(await service.listSupportQueue(db,'open')).some(r=>r.id===appealId));assert.ok(!(await service.listSupportQueue(db,'answered')).some(r=>r.id===n1.id));ok();
 const answer={action:'answer',account:a.user,id:appealId,response:'Generic operator answer',operator:'support-operator'};
 const preview=await runUsageReview(service,db,answer);await assert.rejects(()=>runUsageReview(service,db,answer,preview.applyDigest),/restricted safety review surface/);ok();
 await assert.rejects(()=>run("UPDATE usage_review_requests SET state='answered',public_response='x',answered_by='safety_review',answered_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",appealId),/usage_review_immutable/,'No answer without a recorded independent decision');
 await assert.rejects(()=>run("UPDATE usage_review_requests SET state='answered',public_response='x',answered_by='someone',answered_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",appealId),/usage_review_immutable/);ok();

 // ---- Restricted appeal queue: identifiers only, never the subject's own appeals, marked for the acting reviewer.
 const listed=await c.listSafetyAppeals(db,actor.p);assert.deepEqual(listed.map(x=>[x.appealId,x.noticeId,x.caseId,x.subjectUserId,x.actedByYou]),[[appealId,n1.id,'case-n1',a.user,true]]);
 assert.ok(!JSON.stringify(listed).includes(APPEAL));ok();
 assert.equal((await c.listSafetyAppeals(db,independent.p))[0].actedByYou,false);assert.equal((await c.listSafetyAppeals(db,auditor.p)).length,1);ok();
 await refused(()=>c.listSafetyAppeals(db,outsider.p),'missing_role');await refused(()=>c.listSafetyAppeals(db,b.p),'missing_role');
 assert.deepEqual(await c.listSafetyAppeals(db,subjectOperator.p),[],'The subject never sees their own appeal in the queue');ok();
 await refused(()=>c.readSafetyAppeal(db,subjectOperator.p,{appealId}),'not_found');await refused(()=>c.readSafetyAppeal(db,auditor.p,{appealId}),'missing_role');
 const read=await c.readSafetyAppeal(db,independent.p,{appealId});assert.equal(read.statement,APPEAL);assert.equal(read.currentFinding,'confirmed_policy_finding');assert.equal(read.actedByYou,false);assert.equal(read.decision,null);ok();

 // ---- Separation of duties: the reviewer who recorded the finding cannot decide the appeal, in code or in the schema.
 await refused(()=>c.decideSafetyAppeal(db,actor.p,{appealId,decision:'upheld',decisionRef:'appeal-self'}),'conflict');
 await refused(()=>c.decideSafetyAppeal(db,subjectOperator.p,{appealId,decision:'reversed',decisionRef:'appeal-subject'}),'not_found');
 await refused(()=>c.decideSafetyAppeal(db,auditor.p,{appealId,decision:'upheld',decisionRef:'appeal-auditor'}),'missing_role');
 await refused(()=>c.decideSafetyAppeal(db,independent.p,{appealId,decision:'dismissed',decisionRef:'appeal-bad'}),'invalid_input');
 for(const by of ['human:'+actor.id,'human:'+a.user,'human:'+keeper.id])
  await assert.rejects(()=>run("INSERT INTO safety_appeal_decisions(appeal_id,notice_id,case_id,decision,decision_ref,decided_by,decided_at) VALUES(?,?,'case-n1','upheld','raw',?,unixepoch())",appealId,n1.id,by),/safety_appeal_independence/,by);ok();
 assert.equal(await count('safety_appeal_decisions'),0);assert.equal((await json(a,'/api/support/v1/requests/'+appealId)).request.state,'open');ok();
 assert.ok((await all("SELECT outcome,reason FROM safety_case_audit WHERE action='decide_appeal'")).some(x=>x.outcome==='rejected'&&x.reason==='conflict'));ok();

 // ---- An independent reviewer reverses the decision after the case closed: the correction is appended, the owner reads the outcome.
 await c.releasePreservationHold(db,keeper.p,{holdId:'hold-n1',caseId:'case-n1',releaseRef:'release-n1'});
 await c.closeSafetyCase(db,actor.p,{caseId:'case-n1',closeRef:'close-n1'});
 await refused(()=>c.recordSafetyCaseFinding(db,independent.p,{caseId:'case-n1',finding:'not_confirmed',decisionRef:'late-correction'}),'case_closed');
 // Over HTTP, with the usual strict body (declared actors refused).
 assert.equal((await operatorCall(independent.authority.token,'appeals/decide',{appealId,decision:'reversed',decisionRef:'appeal-n1',actor:'human:x'})).status,400);ok();
 const decided=await operatorCall(independent.authority.token,'appeals/decide',{appealId,decision:'reversed',decisionRef:'appeal-n1'});assert.equal(decided.status,200,JSON.stringify(decided.body));assert.deepEqual(decided.body.result,{appealId,decision:'reversed',answered:true});ok();
 const findings=await all("SELECT seq,finding,reviewer_ref,decision_ref FROM safety_case_findings WHERE case_id='case-n1' ORDER BY seq");
 assert.deepEqual({...findings.at(-1)},{seq:4,finding:'not_confirmed',reviewer_ref:'human:'+independent.id,decision_ref:'appeal-n1'});ok();
 assert.deepEqual(await c.decideSafetyAppeal(db,independent.p,{appealId,decision:'reversed',decisionRef:'appeal-n1'}),{appealId,decision:'reversed',answered:true},'Exact retry');
 await refused(()=>c.decideSafetyAppeal(db,independent.p,{appealId,decision:'upheld',decisionRef:'appeal-n1-again'}),'conflict');
 assert.equal(await count('safety_case_findings',"case_id='case-n1'"),4);ok();
 const answered=(await json(a,'/api/support/v1/requests/'+appealId)).request;assert.equal(answered.state,'answered');assert.equal(answered.publicResponse,c.safetyAppealResponses.reversed);assert.equal(answered.read.state,'unread');
 const ownerView=JSON.stringify(await overview(a));for(const secret of [independent.id,actor.id,'appeal-n1','case-n1','human:'])assert.ok(!ownerView.includes(secret),secret);ok();
 const decision=await row('SELECT * FROM safety_appeal_decisions WHERE appeal_id=?',appealId);assert.deepEqual([decision.notice_id,decision.case_id,decision.decision,decision.decided_by],[n1.id,'case-n1','reversed','human:'+independent.id]);
 assert.equal((await row('SELECT answered_by FROM usage_review_requests WHERE id=?',appealId)).answered_by,'safety_review','The owner row never names the reviewer');ok();
 await assert.rejects(()=>run("UPDATE safety_appeal_decisions SET decision='upheld' WHERE appeal_id=?",appealId),/safety_case_immutable/);await assert.rejects(()=>run('DELETE FROM safety_appeal_decisions WHERE appeal_id=?',appealId),/safety_case_immutable/);ok();
 assert.deepEqual(await c.listSafetyAppeals(db,independent.p),[],'Decided appeals leave the queue');ok();

 // ---- A second action by the other reviewer: now the first reviewer is the independent one and may uphold it.
 await c.openSafetyCase(db,independent.p,{caseId:'case-n2',subjectUserId:a.user,intakeRef:'manual-n2'});
 await c.recordSafetyCaseFinding(db,independent.p,{caseId:'case-n2',finding:'confirmed_policy_finding',decisionRef:'decision-n2'});
 const n2=await row("SELECT * FROM safety_action_notices WHERE case_id='case-n2'");assert.equal(n2.acted_by,'human:'+independent.id);assert.equal((await notices(a)).length,2);ok();
 const appeal2=id();await appeal(a,n2.id,APPEAL+'-2',{id:appeal2});
 await refused(()=>c.decideSafetyAppeal(db,independent.p,{appealId:appeal2,decision:'reversed',decisionRef:'appeal-n2-self'}),'conflict');
 await c.decideSafetyAppeal(db,actor.p,{appealId:appeal2,decision:'upheld',decisionRef:'appeal-n2'});
 assert.equal((await row("SELECT finding FROM safety_case_findings WHERE case_id='case-n2' ORDER BY seq DESC LIMIT 1")).finding,'confirmed_policy_finding','Upholding changes no finding');
 assert.equal((await json(a,'/api/support/v1/requests/'+appeal2)).request.publicResponse,c.safetyAppealResponses.upheld);ok();
 // An appeal is never refused for support-history capacity (it is bounded by its notice); ordinary requests still are.
 const used=await count('usage_review_requests','user_id=?',a.user);
 for(let i=used;i<200;i++){const filler=id();await run("INSERT INTO usage_review_requests(id,user_id,statement,kind,source) VALUES(?,?,'filler','help','support')",filler,a.user);
  await run("UPDATE usage_review_requests SET state='answered',public_response='filler',answered_by='fixture',answered_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?",filler);}
 await json(a,'/api/support/v1/requests',{version:1,id:id(),kind:'help',statement:'over capacity'},409);
 await c.openSafetyCase(db,actor.p,{caseId:'case-n3',subjectUserId:a.user,intakeRef:'manual-n3'});
 await c.recordSafetyCaseFinding(db,actor.p,{caseId:'case-n3',finding:'confirmed_policy_finding',decisionRef:'decision-n3'});
 const n3=await row("SELECT id FROM safety_action_notices WHERE case_id='case-n3'");assert.equal(await count('usage_review_requests','id=?',n3.id),1,'The notice is delivered beyond the capacity bound');
 assert.equal((await appeal(a,n3.id,APPEAL+'-3')).request.state,'open');ok();

 // ---- A subject whose account was deleted after the case opened: the notice is still generated (restricted), and nothing is delivered.
 const gone=await owner();await c.openSafetyCase(db,actor.p,{caseId:'case-ghost',subjectUserId:gone.user,intakeRef:'manual-ghost'});
 await run('DELETE FROM users WHERE id=?',gone.user);
 await c.recordSafetyCaseFinding(db,actor.p,{caseId:'case-ghost',finding:'confirmed_policy_finding',decisionRef:'decision-ghost'});
 const ghost=await row("SELECT id FROM safety_action_notices WHERE case_id='case-ghost'");assert.ok(ghost);assert.equal(await count('usage_review_requests','id=?',ghost.id),0,'Generation is distinct from delivery');ok();
 // Deleting an account never removes the restricted generation and decision records.
 await run('DELETE FROM users WHERE id=?',b.user);
 assert.equal(await count('safety_action_notices'),4);assert.equal(await count('safety_appeal_decisions'),2);ok();

 // ---- Notice delay under legal process (owner decision October 5, 2026): marked by a preservation approver who is not the
 // case subject; while marked, generation is recorded and nothing is delivered; lifting (a separate audited action) delivers.
 const d=await owner(),subjectKeeper=await operator(d),REASON='SYNTHETIC-LEGAL-PROCESS-REASON-CANARY';
 await c.grantSafetyCaseRole(db,admin.p,{grantId:'g-subject-keeper',operatorAccountId:subjectKeeper.id,role:'preservation_approver'});
 await c.openSafetyCase(db,actor.p,{caseId:'case-d1',subjectUserId:d.user,intakeRef:'manual-d1'});
 const place=(by,extra={})=>c.placeSafetyNoticeDelay(db,by.p,{delayId:'delay-d1',caseId:'case-d1',reason:REASON,...extra});
 // Role, separation and input checks (code and schema).
 await refused(()=>place(actor),'missing_role');await refused(()=>place(auditor),'missing_role');await refused(()=>place(outsider),'missing_role');await refused(()=>place(admin),'missing_role');
 await refused(()=>place(subjectKeeper),'not_found');
 for(const reason of ['','x'.repeat(501),'bad\u0000reason','bad\nreason',7])await refused(()=>place(keeper,{reason}),'invalid_input');
 await refused(()=>place(keeper,{delayId:'bad id'}),'invalid_input');await refused(()=>c.placeSafetyNoticeDelay(db,keeper.p,{delayId:'delay-none',caseId:'case-missing',reason:REASON}),'not_found');
 assert.equal(await count('safety_notice_delays'),0);ok();
 for(const by of ['human:'+actor.id,'human:'+d.user,'human:'+auditor.id])await assert.rejects(()=>run("INSERT INTO safety_notice_delays(id,case_id,reason,placed_by,placed_at) VALUES('raw','case-d1','r',?,unixepoch())",by),/safety_notice_delay/,by);
 await assert.rejects(()=>run("INSERT INTO safety_notice_delays(id,case_id,reason,placed_by,placed_at) VALUES('raw','case-d1','',?,unixepoch())",'human:'+keeper.id),/CHECK/);ok();
 // Over HTTP: strict body, declared actors refused, restricted role required.
 assert.equal((await operatorCall(keeper.authority.token,'notice-delays/place',{delayId:'delay-d1',caseId:'case-d1',reason:REASON,actor:'human:x'})).status,400);
 assert.equal((await operatorCall(actor.authority.token,'notice-delays/place',{delayId:'delay-d1',caseId:'case-d1',reason:REASON})).status,403);
 assert.equal((await operatorCall(subjectKeeper.authority.token,'notice-delays/place',{delayId:'delay-d1',caseId:'case-d1',reason:REASON})).status,404);ok();
 const placed=await operatorCall(keeper.authority.token,'notice-delays/place',{delayId:'delay-d1',caseId:'case-d1',reason:REASON});assert.equal(placed.status,200,JSON.stringify(placed.body));assert.deepEqual(placed.body.result,{delayId:'delay-d1',caseId:'case-d1',active:true});
 assert.ok(!JSON.stringify(placed.body).includes(REASON),'The write response never echoes the reason');ok();
 assert.deepEqual(await place(keeper),{delayId:'delay-d1',caseId:'case-d1',active:true},'Exact retry');
 await refused(()=>place(keeper,{reason:'a different reason'}),'conflict');await refused(()=>place(keeper,{delayId:'delay-d1b'}),'conflict');
 assert.equal(await count('safety_notice_delays'),1,'One active mark per case');ok();
 // While marked: the confirmed finding records its restricted notice but delivers nothing; the owner sees and learns nothing.
 await c.recordSafetyCaseFinding(db,actor.p,{caseId:'case-d1',finding:'confirmed_policy_finding',decisionRef:'decision-d1'});
 const nd=await row("SELECT * FROM safety_action_notices WHERE case_id='case-d1'");assert.ok(nd,'Generation is still recorded');assert.equal(nd.acted_by,'human:'+actor.id);
 assert.equal(await count('usage_review_requests','id=?',nd.id),0,'No delivery while delayed');assert.deepEqual(await notices(d),[]);ok();
 assert.deepEqual((await overview(d)).requests,[]);const hidden=JSON.stringify(await overview(d));for(const secret of [REASON,'delay-d1','case-d1','legal','human:'])assert.ok(!hidden.toLowerCase().includes(secret.toLowerCase()),secret);ok();
 await json(d,'/api/support/v1/requests/'+nd.id,undefined,404);await appeal(d,nd.id,'too early',{status:404});ok();
 // The schema itself refuses delivery while delayed, even by a direct insert.
 await assert.rejects(()=>run("INSERT INTO usage_review_requests(id,user_id,statement,kind,source,state,public_response,answered_by,answered_at) VALUES(?,?,'Safety review notice','safety_notice','safety','answered','x','safety_review',strftime('%Y-%m-%dT%H:%M:%fZ','now'))",nd.id,d.user),/usage_review_initial/);
 assert.equal(await count('usage_review_requests','id=?',nd.id),0);ok();
 // The reason never reaches the model: Chat context and the agent's support read carry nothing of it.
 await chat(d,'Did Whumpo send me a notice?',[body=>{const text=JSON.stringify(body);assert.ok(!text.includes(REASON)&&!text.includes('delay-d1')&&!text.includes('case-d1'));return {kind:'interaction',operation:'readSupport',requestId:null};},
  body=>{const text=JSON.stringify(body);assert.ok(!text.includes(REASON)&&!text.includes('safety_notice'),'Nothing delivered, nothing to read');return null;}]);ok();
 // Restricted reads: the reason is visible only in the restricted case read; the audit and owner surfaces never carry it.
 const viewed=await c.readSafetyCase(db,auditor.p,{caseId:'case-d1'});assert.deepEqual(viewed.noticeDelays.map(x=>[x.id,x.reason,x.placedBy,x.active,x.liftedAt]),[['delay-d1',REASON,'human:'+keeper.id,true,null]]);ok();
 assert.ok(!JSON.stringify(await all('SELECT * FROM safety_case_audit')).includes(REASON));
 assert.deepEqual((await all("SELECT outcome,reason FROM safety_case_audit WHERE action='place_notice_delay' AND outcome='allowed'")).map(x=>x.reason),['ok','ok'],'Audited placements (the HTTP call and its exact retry) with identifiers only');ok();
 // The delay row is immutable except for one lift.
 await assert.rejects(()=>run("UPDATE safety_notice_delays SET reason='changed' WHERE id='delay-d1'"),/safety_case_immutable/);await assert.rejects(()=>run('DELETE FROM safety_notice_delays'),/safety_case_immutable/);
 await assert.rejects(()=>run("UPDATE safety_notice_delays SET lifted_by=?,lifted_at=unixepoch(),lift_ref='raw' WHERE id='delay-d1'",'human:'+actor.id),/safety_notice_delay/,'A lift needs the restricted role');
 await assert.rejects(()=>run("UPDATE safety_notice_delays SET lifted_by=?,lifted_at=unixepoch(),lift_ref='raw' WHERE id='delay-d1'",'human:'+d.user),/safety_notice_delay/,'The subject cannot lift');ok();
 assert.equal(await count('usage_review_requests','id=?',nd.id),0);
 // Lifting is separate, role-gated, audited and idempotent; it delivers the fixed notice then.
 const lift=(by,extra={})=>c.liftSafetyNoticeDelay(db,by.p,{delayId:'delay-d1',caseId:'case-d1',liftRef:'lift-d1',...extra});
 await refused(()=>lift(actor),'missing_role');await refused(()=>lift(subjectKeeper),'not_found');await refused(()=>lift(keeper,{liftRef:'bad ref'}),'invalid_input');await refused(()=>lift(keeper,{delayId:'delay-unknown'}),'not_found');
 assert.equal(await count('usage_review_requests','id=?',nd.id),0);ok();
 assert.equal((await operatorCall(actor.authority.token,'notice-delays/lift',{delayId:'delay-d1',caseId:'case-d1',liftRef:'lift-d1'})).status,403);
 const lifted=await operatorCall(keeper.authority.token,'notice-delays/lift',{delayId:'delay-d1',caseId:'case-d1',liftRef:'lift-d1'});assert.equal(lifted.status,200,JSON.stringify(lifted.body));assert.deepEqual(lifted.body.result,{delayId:'delay-d1',caseId:'case-d1',active:false});ok();
 const [delivered]=await notices(d);assert.equal(delivered.id,nd.id);assert.equal(delivered.read.state,'unread');assert.match(delivered.publicResponse,/confirmed that content in your Whumpo account breaks the Acceptable Use Policy/);
 assert.equal(delivered.publicResponse,(await notices(a))[0].publicResponse,'The delayed notice carries the same fixed text');
 const shownToD=JSON.stringify(await overview(d));for(const secret of [REASON,'delay-d1','lift-d1','case-d1','human:',keeper.id,actor.id])assert.ok(!shownToD.includes(secret),secret);ok();
 assert.deepEqual(await lift(keeper),{delayId:'delay-d1',caseId:'case-d1',active:false},'Exact lift retry');await refused(()=>lift(keeper,{liftRef:'lift-other'}),'conflict');
 assert.equal(await count('usage_review_requests','id=?',nd.id),1,'Delivered once');ok();
 assert.ok((await all("SELECT reason FROM safety_case_audit WHERE action='lift_notice_delay' AND outcome='allowed'")).length>=2);
 assert.equal((await c.readSafetyCase(db,auditor.p,{caseId:'case-d1'})).noticeDelays[0].active,false);ok();
 // After delivery the owner appeals normally.
 assert.equal((await appeal(d,nd.id,APPEAL+'-d1')).request.state,'open');ok();
 // A lifted case takes a new mark; a new finding then delays again.
 await c.placeSafetyNoticeDelay(db,keeper.p,{delayId:'delay-d1-second',caseId:'case-d1',reason:REASON});
 await c.recordSafetyCaseFinding(db,actor.p,{caseId:'case-d1',finding:'not_confirmed',decisionRef:'decision-d1-nc'});
 await c.recordSafetyCaseFinding(db,actor.p,{caseId:'case-d1',finding:'confirmed_policy_finding',decisionRef:'decision-d1-again'});
 const nd2=await row("SELECT id FROM safety_action_notices WHERE case_id='case-d1' AND finding_seq=4");assert.equal(await count('usage_review_requests','id=?',nd2.id),0,'The second mark delays the second notice');
 // A withdrawn finding is never delivered on lift.
 await c.recordSafetyCaseFinding(db,independent.p,{caseId:'case-d1',finding:'not_confirmed',decisionRef:'decision-d1-withdrawn'});
 await c.liftSafetyNoticeDelay(db,keeper.p,{delayId:'delay-d1-second',caseId:'case-d1',liftRef:'lift-d1-second'});
 assert.equal(await count('usage_review_requests','id=?',nd2.id),0,'A notice for a withdrawn finding stays undelivered');ok();
 // A deleted account gets generation and no delivery on lift.
 const dead=await owner();await c.openSafetyCase(db,actor.p,{caseId:'case-dead',subjectUserId:dead.user,intakeRef:'manual-dead'});
 await c.placeSafetyNoticeDelay(db,keeper.p,{delayId:'delay-dead',caseId:'case-dead',reason:REASON});
 await c.recordSafetyCaseFinding(db,actor.p,{caseId:'case-dead',finding:'confirmed_policy_finding',decisionRef:'decision-dead'});
 await run('DELETE FROM users WHERE id=?',dead.user);await c.liftSafetyNoticeDelay(db,keeper.p,{delayId:'delay-dead',caseId:'case-dead',liftRef:'lift-dead'});
 assert.equal(await count('safety_action_notices',"case_id='case-dead'"),1);assert.equal(await count('usage_review_requests',"kind='safety_notice' AND user_id=?",dead.user),0);ok();
 // Without any mark nothing changes: the ordinary path still delivers in the finding's transaction (checked above for case-n1).
 // A mark on a case never delays another case.
 await c.openSafetyCase(db,actor.p,{caseId:'case-d2',subjectUserId:d.user,intakeRef:'manual-d2'});await c.openSafetyCase(db,actor.p,{caseId:'case-d3',subjectUserId:d.user,intakeRef:'manual-d3'});
 await c.placeSafetyNoticeDelay(db,keeper.p,{delayId:'delay-d2',caseId:'case-d2',reason:REASON});
 await c.recordSafetyCaseFinding(db,actor.p,{caseId:'case-d3',finding:'confirmed_policy_finding',decisionRef:'decision-d3'});
 assert.equal(await count('usage_review_requests',"kind='safety_notice' AND user_id=?",d.user),2,'case-d3 delivers while case-d2 is delayed');ok();

 // ---- Audit: identifiers only.
 const audit=await all("SELECT * FROM safety_case_audit WHERE action IN ('list_appeals','read_appeal','decide_appeal')");
 assert.ok(audit.some(x=>x.action==='read_appeal'&&x.outcome==='denied'&&x.reason==='conflict_of_interest'));assert.ok(audit.some(x=>x.action==='decide_appeal'&&x.outcome==='allowed'));
 assert.ok(!JSON.stringify(await all('SELECT * FROM safety_case_audit')).includes(APPEAL));ok();
 console.log(`Safety appeals passed (${d1?'local D1':'SQLite'}): ${checks} checks. A notice only on a confirmed finding (not on open, flag, hold or not_confirmed), one restricted generation record and one in-app support notice per finding, no reporter/report/case/reviewer detail to the owner, Chat view without model text, owner-only single appeal through Support, generic operator path refused, separation of duties in code and schema, independent reversal (even after closure) and upholding, fixed outcome text, account-less generation without delivery, notice delay under legal process (role and subject separation, no delivery while marked, separate lift delivers, reason kept from owner, model and audit), identifier-only audit. No network or email.`);
}finally{globalThis.fetch=originalFetch;await fixture.close?.();}
