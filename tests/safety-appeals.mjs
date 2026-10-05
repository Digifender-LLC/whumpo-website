import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
import {runUsageReview} from '../tools/usage-review-input.mjs';
Error.stackTraceLimit=0;
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

 // ---- Audit: identifiers only.
 const audit=await all("SELECT * FROM safety_case_audit WHERE action IN ('list_appeals','read_appeal','decide_appeal')");
 assert.ok(audit.some(x=>x.action==='read_appeal'&&x.outcome==='denied'&&x.reason==='conflict_of_interest'));assert.ok(audit.some(x=>x.action==='decide_appeal'&&x.outcome==='allowed'));
 assert.ok(!JSON.stringify(await all('SELECT * FROM safety_case_audit')).includes(APPEAL));ok();
 console.log(`Safety appeals passed (${d1?'local D1':'SQLite'}): ${checks} checks. A notice only on a confirmed finding (not on open, flag, hold or not_confirmed), one restricted generation record and one in-app support notice per finding, no reporter/report/case/reviewer detail to the owner, Chat view without model text, owner-only single appeal through Support, generic operator path refused, separation of duties in code and schema, independent reversal (even after closure) and upholding, fixed outcome text, account-less generation without delivery, identifier-only audit. No network or email.`);
}finally{globalThis.fetch=originalFetch;await fixture.close?.();}
