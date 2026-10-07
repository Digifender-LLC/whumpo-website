import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readdir,readFile,mkdtemp,rm} from 'node:fs/promises';
import {backup,DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {sqliteD1Adapter} from './sqlite-d1.mjs';
import {currentSiteFixtureHandlers,createFixtureWebsite} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
// WH-016 public abuse intake over the actual page handler and the restricted WH-132 operator triage surface.
// Benign synthetic reports only. SQLite by default; `--d1` runs the same checks on local D1.
Error.stackTraceLimit=0;
const d1=process.argv.includes('--d1');
const m=await currentSiteFixtureHandlers();
const built=await build({stdin:{contents:`export * from './src/abuse-report-page.ts';export * as reports from './src/abuse-reports.ts';export * as cases from './src/safety-cases.ts';
 export * as http from './src/safety-case-http.ts';export {sendAIChat} from './src/ai-chat.ts';export * as suppression from './src/restore-suppression.ts';
 export {admitWorkspace} from './src/workspace-identity/admission.ts';export {resolveIdentity} from './src/workspace-identity/authority.ts';`,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const r=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64')),{cases:c}=r;
const fixture=await databaseFixture({d1}),{db}=fixture;
const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('Unexpected network');};
const run=(q,...p)=>db.prepare(q).bind(...p).run(),row=(q,...p)=>db.prepare(q).bind(...p).first(),all=async(q,...p)=>(await db.prepare(q).bind(...p).all()).results;
const count=async(table,where='1',...p)=>(await row(`SELECT count(*) AS n FROM ${table} WHERE ${where}`,...p)).n;
const MARK='SYNTHETIC-REPORT-DETAIL-CANARY';let checks=0;const ok=()=>checks++;
// The optional reporter email (owner decision October 4, 2026). Its domain is lower-cased on intake.
const EMAIL_INPUT='reporter.canary+wh016@Example.ORG',EMAIL='reporter.canary+wh016@example.org';
const logs=[],consoleMethods=['log','info','warn','error','debug'],originalConsole=Object.fromEntries(consoleMethods.map(k=>[k,console[k]]));
for(const k of consoleMethods)console[k]=(...args)=>{logs.push(args.map(String).join(' '));if(k==='log')originalConsole.log(...args);};
const refused=async(fn,reason)=>{await assert.rejects(fn,e=>e instanceof c.SafetyCaseError&&e.reason===reason,reason);ok();};
let allow=true;const limiter={limit:async()=>({success:allow})};
const env={DB:db,ENVIRONMENT:'test',TURNSTILE_SECRET:'fixture-secret',TURNSTILE_SITE_KEY:'fixture-site-key',API_LIMITER:limiter};
let verdict='verified',siteverify=0;
const turnstile=async(url,init)=>{siteverify++;assert.equal(url,'https://challenges.cloudflare.com/turnstile/v0/siteverify');assert.equal(init.redirect,'manual');
 if(verdict==='unavailable')return new Response('no',{status:500});
 return Response.json({success:verdict==='verified',hostname:'whumpo.com',action:'abuse_report',cdata:'abuse-report'});};
const page=(init={},query='')=>new Request('https://whumpo.com/report'+query,init);
const form=(data,{origin='https://whumpo.com',ip='198.51.100.7',type='application/x-www-form-urlencoded'}={})=>page({method:'POST',headers:{origin,'content-type':type,'cf-connecting-ip':ip},body:typeof data==='string'?data:new URLSearchParams(data)});
const submit=async(data,options,e=env)=>{const response=await r.abuseReportPage(form(data,options),e,turnstile);return {status:response.status,html:await response.text(),headers:response.headers};};
const report=(site,extra={})=>({id:crypto.randomUUID(),site,category:'fraud_phishing',details:MARK+' fake bank login on the contact page','cf-turnstile-response':'fixture-token',...extra});
try{
 // ---- Owners: A publishes a website; B has an unpublished project.
 const ownerA=await workspaceFixture(db,m),ownerB=await workspaceFixture(db,m),scopeA=await ownerA.scope(),scopeB=await ownerB.scope();
 const projectA=crypto.randomUUID(),projectB=crypto.randomUUID(),now=new Date().toISOString();
 for(const [p,u] of [[projectA,ownerA.account],[projectB,ownerB.account]])await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Garden fixture','Testing','draft',?,?)",p,u,now,now);
 await m.readChat(scopeA,ownerA.account);await m.readChat(scopeB,ownerB.account);
 const version=await createFixtureWebsite(scopeA,ownerA.account,projectA,{name:'Garden',headline:'Garden',description:'Testing',theme:'ocean',aboutTitle:'About',aboutText:'Testing',sections:[],photos:[]},m);
 const chat=async(content)=>{const state=await m.readChat(scopeA,ownerA.account),input={id:crypto.randomUUID(),revision:state.state.revision,content};return {id:input.id,result:await m.sendChat(scopeA,ownerA.account,input)};};
 const review=await chat('/publish '+version);assert.equal((await chat('/confirm '+review.id)).result.status,200);
 assert.ok(await row('SELECT 1 FROM publications WHERE project_id=? AND version_id IS NOT NULL',projectA));
 const siteA=`https://${projectA}.whumpo.site`;

 // ---- The public form: no session, no Chat, no AI; strict headers; accessible labels; escaped prefill.
 const get=await r.abuseReportPage(page({},'?site='+encodeURIComponent('<script>x</script>')),env,turnstile),html=await get.text();
 assert.equal(get.status,200);assert.equal(get.headers.get('cache-control'),'no-store');assert.match(get.headers.get('content-security-policy'),/frame-ancestors 'none'/);
 assert.match(html,/data-action="abuse_report"/);assert.match(html,/data-cdata="abuse-report"/);
 for(const id of ['site','category','details','email'])assert.match(html,new RegExp(`<label for="${id}">`));
 // The email field is plainly optional and says why it exists, who sees it and that nothing is sent automatically.
 assert.match(html,/<label for="email">Your email \(optional\)<\/label>/);assert.match(html,/type="email"[^>]*maxlength="254"/);assert.doesNotMatch(html,/id="email"[^>]*required/);
 assert.match(html,/contact you about this report/);assert.match(html,/never shown to the site's owner or given to any AI/);assert.match(html,/deleted with your report/);assert.match(html,/does not email you automatically/);ok();
 assert.ok(!html.includes('<script>x'));assert.match(html,/&lt;script&gt;x/);assert.match(html,/not sent to the site's owner or to any AI/);ok();
 const head=await r.abuseReportPage(page({method:'HEAD'}),env,turnstile);assert.equal(head.status,200);assert.equal(await head.text(),'');ok();
 assert.equal((await r.abuseReportPage(page({method:'PUT'}),env,turnstile)).status,405);ok();
 // The platform Worker mounts the same page before any API or session gate.
 const routed=await m.worker.fetch(new Request('http://localhost/report'),{...env,ENVIRONMENT:'local'});assert.equal(routed.status,200);assert.match(await routed.text(),/Send report/);ok();

 // ---- Submission boundary refusals store nothing.
 const nothing=async()=>{assert.equal(await count('abuse_reports'),0);ok();};
 assert.equal((await submit(report(siteA),{origin:'https://evil.example'})).status,403);await nothing();
 assert.equal((await submit(report(siteA),{type:'text/plain'})).status,415);await nothing();
 assert.equal((await submit({...report(siteA),contact:'x@example.invalid'})).status,400);await nothing();
 // Invalid or oversized optional emails are refused before anything is stored or verified.
 for(const email of ['not-an-email','a@b','two@@example.org','x@example.org\nBcc: y@example.org','<x@example.org>','x@exa mple.org','x'.repeat(250)+'@example.org']){
  const spent=siteverify;assert.equal((await submit({...report(siteA),email})).status,400,String(email));assert.equal(siteverify,spent);await nothing();}
 assert.equal((await submit(new URLSearchParams(report(siteA)).toString()+'&email=a%40example.org&email=b%40example.org')).status,400);await nothing();
 assert.equal((await submit(new URLSearchParams(report(siteA)).toString()+'&site=x')).status,400);await nothing();
 assert.equal((await submit({...report(siteA),details:'x'.repeat(17000)})).status,413);await nothing();
 assert.equal((await submit({...report(siteA),details:'x'.repeat(1001)})).status,400);await nothing();
 assert.equal((await submit({...report(siteA),category:'immoral'})).status,400);await nothing();
 assert.equal((await submit(report(siteA),{},{...env,TURNSTILE_SECRET:undefined})).status,503);await nothing();
 allow=false;assert.equal((await submit(report(siteA))).status,429);allow=true;await nothing();
 assert.equal((await submit(report('https://unknown.example/page'))).status,404);await nothing();
 assert.equal((await submit(report(`https://${projectB}.whumpo.site/`))).status,404,'Unpublished projects are not reportable here');await nothing();
 assert.equal((await submit(report(`https://app-${projectA}.whumpo.site/`))).status,404,'No enabled application');await nothing();
 const before=siteverify;
 verdict='failed';assert.equal((await submit(report(siteA),{ip:'198.51.100.20'})).status,400);await nothing();
 verdict='unavailable';assert.equal((await submit(report(siteA),{ip:'198.51.100.21'})).status,503);await nothing();
 verdict='verified';assert.equal(siteverify,before+2);
 assert.equal((await submit({...report(siteA),'cf-turnstile-response':''},{ip:'198.51.100.22'})).status,400);await nothing();

 // ---- A verified report: bound to the serving project and owner, path only, receipt without case details.
 const first=report(siteA+'/about?ref=secret#frag',{email:'  '+EMAIL_INPUT+' '});
 const accepted=await submit(first,{ip:'198.51.100.30'});
 assert.equal(accepted.status,200);assert.match(accepted.html,new RegExp('Receipt: <code>'+first.id));
 assert.ok(!accepted.html.includes(MARK)&&!accepted.html.includes(projectA)&&!accepted.html.includes(ownerA.account),'The receipt shows no report details, project or owner');
 assert.ok(!accepted.html.toLowerCase().includes(EMAIL),'The receipt does not echo the email');assert.match(accepted.html,/may contact you about this report\. Nothing is sent automatically/);ok();
 const saved=await row('SELECT * FROM abuse_reports WHERE id=?',first.id);
 assert.deepEqual({project:saved.project_id,subject:saved.subject_user_id,surface:saved.surface,host:saved.host_kind,path:saved.path,category:saved.category,triage:saved.triage,caseId:saved.case_id},
  {project:projectA,subject:ownerA.account,surface:'site',host:'platform',path:'/about',category:'fraud_phishing',triage:'received',caseId:null});
 assert.ok(saved.details.startsWith(MARK));assert.ok(!JSON.stringify(saved).includes('198.51.100'),'No reporter IP stored');ok();
 assert.equal(saved.reporter_email,EMAIL,'Optional email stored trimmed with a lower-cased domain');assert.ok(!saved.request_hash.includes(EMAIL));ok();
 // A blank email stores none.
 for(const email of [undefined,null,'','   '])assert.equal(r.reports.abuseReportInput({id:crypto.randomUUID(),category:'other',details:null,email}).email,null);ok();
 // Exact replay recovers the receipt; a different report reusing the receipt is refused.
 assert.equal((await submit(first,{ip:'198.51.100.31'})).status,200);assert.equal(await count('abuse_reports'),1);ok();
 assert.equal((await submit({...first,category:'other'},{ip:'198.51.100.32'})).status,409);assert.equal(await count('abuse_reports'),1);ok();
 assert.equal((await submit({...first,email:'someone.else@example.org'},{ip:'198.51.100.34'})).status,409,'A different email under the same receipt is a different report');assert.equal(await count('abuse_reports'),1);ok();
 // Reporting is not a violation: intake writes no risk evidence, screening requirement, case or hold.
 for(const table of ['content_risk_evidence','content_screening_decisions','safety_cases','safety_preservation_holds'])assert.equal(await count(table),0,table);ok();
 // The site keeps serving; a report changes nothing for the owner.
 assert.equal((await m.host.fetch(new Request(siteA+'/'),fixture.env??{DB:db})).status,200);ok();

 // ---- Per-connection allowance: three reports about one project per connection per UTC day, counted before verification.
 const ip='203.0.113.50';
 for(let i=0;i<3;i++)assert.equal((await submit(report(siteA,{category:'spam_abuse'}),{ip})).status,200);
 const spent=siteverify;assert.equal((await submit(report(siteA),{ip})).status,429);assert.equal(siteverify,spent,'Refused before Turnstile');ok();
 assert.equal((await submit(report(siteA),{ip:'203.0.113.51'})).status,200,'Another connection can still report');ok();
 assert.equal(await count('abuse_reports','project_id=?',projectA),5);
 // ---- Atomic project rate: concurrent reports cannot exceed ten an hour for one project.
 const target=await r.reports.resolveAbuseReportTarget(db,siteA);
 const burst=await Promise.allSettled(Array.from({length:12},()=>r.reports.saveAbuseReport(db,target,r.reports.abuseReportInput({id:crypto.randomUUID(),category:'other',details:null}))));
 assert.equal(burst.filter(x=>x.status==='fulfilled').length,5);assert.ok(burst.filter(x=>x.status==='rejected').every(x=>x.reason.status===429));
 assert.equal(await count('abuse_reports','project_id=?',projectA),10);ok();
 assert.equal((await submit(report(siteA),{ip:'203.0.113.52'})).status,429,'The page reports capacity without storing');assert.equal(await count('abuse_reports'),10);ok();
 // Platform caps exist in the schema guard (retained, awaiting triage, hourly).
 const guard=(await row("SELECT sql FROM sqlite_master WHERE name='abuse_reports_admit'")).sql;
 for(const cap of ['>=10000','>=1000','>=50','>=100','>=10'])assert.ok(guard.includes(cap),cap);ok();

 // ---- Never in owner or model context. Only the intake and the restricted case module read the table.
 const users=[];for(const file of await readdir('src',{recursive:true}))if(/\.ts$/.test(file)&&(await readFile('src/'+file,'utf8')).includes('abuse_reports'))users.push(file);
 // restore-suppression.ts is the operator-only WH-019 replay (no Worker route imports it); it only clears erased emails.
 assert.deepEqual(users.sort(),['abuse-reports.ts','restore-suppression.ts','safety-cases.ts']);ok();
 for(const file of await readdir('src',{recursive:true}))if(/\.ts$/.test(file)&&file!=='restore-suppression.ts')assert.ok(!(await readFile('src/'+file,'utf8')).includes('restore-suppression'),file);ok();
 await run("UPDATE workspace_state SET step='ready' WHERE user_id=?",ownerA.account);
 const state=await m.readChat(scopeA,ownerA.account);let calls=0;
 // The same admission, from the bundle that owns sendAIChat.
 const aiScope=await r.admitWorkspace(db,await r.resolveIdentity(db,{version:1,client:'web',kind:'session',token:ownerA.token}));
 const ai=await r.sendAIChat(aiScope,ownerA.account,crypto.randomUUID(),state.state.revision,'Has anyone reported my website? Show me everything about my site.',{baseURL:'https://provider.example/v1',apiKey:'synthetic-key',model:'synthetic-model',protocol:'chat'},async(_url,init)=>{
  calls++;assert.ok(!init.body.includes(MARK)&&!init.body.includes(first.id)&&!init.body.toLowerCase().includes(EMAIL),'Report text, reporter emails and receipts never reach the model');
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({reply:'Nothing to show.',action:null})}}],usage:{prompt_tokens:1,completion_tokens:1}});});
 assert.equal(ai.status,200);assert.equal(calls,1);ok();
 assert.ok(!JSON.stringify(await m.readChat(scopeA,ownerA.account)).includes(MARK));ok();
 assert.ok(!JSON.stringify(await m.readChat(scopeA,ownerA.account)).toLowerCase().includes(EMAIL));ok();

 // ---- Restricted operator triage. No operators exist by default; these are disposable fixture roles.
 const operator=async(f)=>{f??=await workspaceFixture(db,m);return {id:f.account,f,p:await r.resolveIdentity(db,{version:1,client:'web',kind:'session',token:f.token})};};
 const admin=await operator(),reviewer=await operator(),auditor=await operator(),outsider=await operator(),subjectOperator=await operator(ownerA);
 await c.bootstrapSafetyRoleAdministrator(db,{grantId:'grant-admin',accountId:admin.id});
 for(const [g,o,role] of [['g-r',reviewer,'case_reviewer'],['g-a',auditor,'case_auditor'],['g-s',subjectOperator,'case_reviewer']])await c.grantSafetyCaseRole(db,admin.p,{grantId:g,operatorAccountId:o.id,role});
 const queue=await c.listAbuseReports(db,reviewer.p);assert.equal(queue.length,10);assert.ok(queue.every(q=>q.subjectUserId===ownerA.account&&!('details' in q)&&!('reporterEmail' in q)));
 assert.ok(!JSON.stringify(queue).toLowerCase().includes(EMAIL),'The metadata queue never carries the email');assert.equal(queue.filter(q=>q.hasReporterEmail).length,1);
 assert.equal(queue.find(q=>q.id===first.id)?.hasDetails,true);assert.equal(queue.find(q=>q.id===first.id)?.hasReporterEmail,true);const others=queue.filter(q=>q.id!==first.id).map(q=>q.id);ok();
 assert.equal((await c.listAbuseReports(db,auditor.p)).length,10);ok();
 await refused(()=>c.readAbuseReport(db,auditor.p,{reportId:first.id}),'missing_role');
 await refused(()=>c.listAbuseReports(db,outsider.p),'missing_role');
 const scopeOwner=await r.resolveIdentity(db,{version:1,client:'web',kind:'session',token:ownerB.token});await refused(()=>c.listAbuseReports(db,scopeOwner),'missing_role');
 // Conflict of interest: the reported owner, even holding a reviewer role, never sees or decides their own reports.
 assert.equal((await c.listAbuseReports(db,subjectOperator.p)).length,0);
 await refused(()=>c.readAbuseReport(db,subjectOperator.p,{reportId:first.id}),'not_found');
 await refused(()=>c.triageAbuseReport(db,subjectOperator.p,{reportId:first.id,decision:'not_actionable',decisionRef:'self'}),'not_found');
 const read=await c.readAbuseReport(db,reviewer.p,{reportId:first.id});assert.ok(read.details.startsWith(MARK));assert.equal(read.reporterEmail,EMAIL,'Only the reviewer read returns the email');assert.equal(read.path,'/about');assert.equal(read.triage,'received');ok();
 await refused(()=>c.readAbuseReport(db,reviewer.p,{reportId:crypto.randomUUID()}),'not_found');
 await refused(()=>c.readAbuseReport(db,reviewer.p,{reportId:'not-a-report'}),'invalid_input');
 // Open a case from the report: always an uncertain flag, intake reference names the report, in one transaction.
 const opened=await c.triageAbuseReport(db,reviewer.p,{reportId:first.id,decision:'open_case',caseId:'case-report-1',decisionRef:'triage-1'});
 assert.deepEqual(opened,{reportId:first.id,triage:'case_opened',caseId:'case-report-1'});
 const kase=await c.readSafetyCase(db,reviewer.p,{caseId:'case-report-1'});
 assert.equal(kase.subjectUserId,ownerA.account);assert.equal(kase.intakeRef,'abuse-report:'+first.id);assert.equal(kase.currentFinding,'uncertain_flag');assert.equal(kase.findings.length,1);ok();
 assert.deepEqual(await c.triageAbuseReport(db,reviewer.p,{reportId:first.id,decision:'open_case',caseId:'case-report-1',decisionRef:'triage-1'}),opened,'Exact retry is idempotent');ok();
 await refused(()=>c.triageAbuseReport(db,reviewer.p,{reportId:first.id,decision:'not_actionable',decisionRef:'triage-2'}),'conflict');
 const [second,third,fourth,,fifth]=others;
 assert.equal((await c.triageAbuseReport(db,reviewer.p,{reportId:second,decision:'link_case',caseId:'case-report-1',decisionRef:'triage-3'})).triage,'case_linked');ok();
 await refused(()=>c.triageAbuseReport(db,reviewer.p,{reportId:third,decision:'link_case',caseId:'missing-case',decisionRef:'triage-4'}),'not_found');
 // A case about a different subject cannot absorb this report.
 await c.openSafetyCase(db,reviewer.p,{caseId:'case-other',subjectUserId:ownerB.account,intakeRef:'manual-1'});
 await refused(()=>c.triageAbuseReport(db,reviewer.p,{reportId:third,decision:'link_case',caseId:'case-other',decisionRef:'triage-5'}),'conflict');
 await refused(()=>c.triageAbuseReport(db,reviewer.p,{reportId:third,decision:'not_actionable',caseId:'case-other',decisionRef:'triage-6'}),'invalid_input');
 await refused(()=>c.triageAbuseReport(db,auditor.p,{reportId:third,decision:'not_actionable',decisionRef:'triage-7'}),'missing_role');
 assert.equal((await c.triageAbuseReport(db,reviewer.p,{reportId:third,decision:'not_actionable',decisionRef:'triage-8'})).triage,'not_actionable');ok();
 assert.equal((await c.listAbuseReports(db,reviewer.p)).length,7);ok();
 // A report never becomes a finding by itself: the case stays uncertain until a separate reviewer decision.
 assert.equal((await c.readSafetyCase(db,reviewer.p,{caseId:'case-report-1'})).findings.length,1);ok();
 // WH-016 owner notice: only a confirmed finding notifies the reported owner, through their Support channel, without the
 // reporter's identity, email, receipt or report text (tests/safety-appeals.mjs covers notices and appeals in depth).
 assert.equal(await count('usage_review_requests',"user_id=? AND kind='safety_notice'",ownerA.account),0,'Opening a case from a report sends no notice');
 const reviewer2=await operator();await c.grantSafetyCaseRole(db,admin.p,{grantId:'g-r2',operatorAccountId:reviewer2.id,role:'case_reviewer'});
 await c.recordSafetyCaseFinding(db,reviewer2.p,{caseId:'case-report-1',finding:'confirmed_policy_finding',decisionRef:'confirm-report-1'});
 const support=await m.worker.fetch(new Request('https://whumpo.com/api/support/v1',{headers:{cookie:'__Host-whumpo_session='+ownerA.token}}),{...env,ENVIRONMENT:'test',AUTH_LIMITER:limiter});
 assert.equal(support.status,200);const supportText=await support.text(),noticeRows=JSON.parse(supportText).requests.filter(x=>x.kind==='safety_notice');
 assert.equal(noticeRows.length,1);for(const secret of [MARK,first.id,EMAIL,'case-report-1',reviewer2.id,reviewer.id,'abuse-report','/about'])assert.ok(!supportText.toLowerCase().includes(secret.toLowerCase()),secret);ok();
 // The HTTP surface carries the same actions with strict bodies; the customer gets no route.
 const call=async(path,data,token)=>{const response=await r.http.handleSafetyCaseRequest(new Request('https://whumpo.com/api/operator/safety-cases/v1/'+path,{method:'POST',headers:{origin:'https://whumpo.com','content-type':'application/json',cookie:'__Host-whumpo_session='+token},body:JSON.stringify({version:1,...data})}),{DB:db,ENVIRONMENT:'test'});return {status:response.status,body:await response.json(),cache:response.headers.get('cache-control')};};
 const listed=await call('reports/list',{},reviewer.f.token);assert.equal(listed.status,200);assert.equal(listed.cache,'no-store');assert.equal(listed.body.result.length,7);ok();
 assert.equal((await call('reports/read',{reportId:fourth},ownerB.token)).status,403);ok();
 assert.equal((await call('reports/triage',{reportId:fourth,decision:'not_actionable',decisionRef:'h-1',actor:'human:x'},reviewer.f.token)).status,400,'Declared actors are refused');ok();
 assert.equal((await call('reports/triage',{reportId:fourth,decision:'open_case',caseId:'case-report-2',decisionRef:'h-2'},reviewer.f.token)).body.result.triage,'case_opened');ok();
 // Audit rows record every attempt with identifiers only.
 const audit=await all("SELECT action,outcome,reason,target_ref FROM safety_case_audit WHERE action IN ('list_reports','read_report','triage_report')");
 assert.ok(audit.some(a=>a.action==='read_report'&&a.outcome==='denied'&&a.reason==='conflict_of_interest'));assert.ok(audit.some(a=>a.action==='triage_report'&&a.outcome==='allowed'));
 assert.ok(!JSON.stringify(await all('SELECT * FROM safety_case_audit')).includes(MARK));assert.ok(!JSON.stringify(await all('SELECT * FROM safety_case_audit')).toLowerCase().includes(EMAIL));ok();
 // Stored reports are immutable except the single triage transition, and retained.
 await assert.rejects(()=>run('UPDATE abuse_reports SET details=? WHERE id=?','changed',fifth),/abuse_report_immutable/);ok();
 await assert.rejects(()=>run("UPDATE abuse_reports SET triage='received',case_id=NULL,triaged_by=NULL,triaged_at=NULL,triage_ref=NULL WHERE id=?",first.id),/abuse_report_immutable/);ok();
 await assert.rejects(()=>run('DELETE FROM abuse_reports WHERE id=?',fifth),/abuse_report_immutable/);ok();
 await assert.rejects(()=>run("INSERT INTO abuse_reports(id,project_id,subject_user_id,surface,host_kind,path,category,request_hash,received_at,triage) VALUES(?,?,?,'site','platform','/','other',?,unixepoch(),'case_opened')",crypto.randomUUID(),projectA,ownerA.account,'a'.repeat(64)),/abuse_report_immutable|CHECK/);ok();
 await assert.rejects(()=>run("INSERT INTO abuse_reports(id,project_id,subject_user_id,surface,host_kind,path,category,request_hash,received_at) VALUES(?,?,?,'site','platform','/','other',?,unixepoch())",crypto.randomUUID(),projectA,ownerB.account,'a'.repeat(64)),/abuse_report_target/,'Subject must be the current owner');ok();
 // ---- Erasing the optional reporter email: audited, case reviewer only, blocked while a hold covers the report, restore-safe.
 const keeper=await operator();await c.grantSafetyCaseRole(db,admin.p,{grantId:'g-k',operatorAccountId:keeper.id,role:'preservation_approver'});
 let directory=null,candidateSQL=null;
 if(fixture.sql){directory=await mkdtemp('/tmp/whumpo-abuse-contact-');await backup(fixture.sql,join(directory,'before.sqlite'));await backup(fixture.sql,join(directory,'before-retention.sqlite'));}
 await refused(()=>c.eraseAbuseReportContact(db,auditor.p,{reportId:first.id}),'missing_role');
 await refused(()=>c.eraseAbuseReportContact(db,subjectOperator.p,{reportId:first.id}),'not_found');
 await refused(()=>c.eraseAbuseReportContact(db,reviewer.p,{reportId:'nope'}),'invalid_input');
 assert.equal((await call('reports/erase-contact',{reportId:first.id},ownerB.token)).status,403,'No customer route');ok();
 // A hold on another subject does not block; a hold on the report's case (or its subject) does.
 await c.placePreservationHold(db,keeper.p,{holdId:'hold-other',caseId:'case-other',legalBasisRef:'basis-1',reviewDays:30});
 await c.placePreservationHold(db,keeper.p,{holdId:'hold-report',caseId:'case-report-1',legalBasisRef:'basis-2',reviewDays:30});
 await refused(()=>c.eraseAbuseReportContact(db,reviewer.p,{reportId:first.id}),'active_hold');
 await assert.rejects(()=>run('UPDATE abuse_reports SET reporter_email=NULL WHERE id=?',first.id),/safety_preservation_hold/);
 assert.equal((await row('SELECT reporter_email FROM abuse_reports WHERE id=?',first.id)).reporter_email,EMAIL);ok();
 await c.releasePreservationHold(db,keeper.p,{holdId:'hold-report',caseId:'case-report-1',releaseRef:'release-1'});
 assert.deepEqual(await c.eraseAbuseReportContact(db,reviewer.p,{reportId:first.id}),{reportId:first.id,reporterEmail:null});ok();
 assert.equal((await c.readAbuseReport(db,reviewer.p,{reportId:first.id})).reporterEmail,null);assert.equal((await row('SELECT triage,case_id FROM abuse_reports WHERE id=?',first.id)).case_id,'case-report-1','Only the email is cleared');ok();
 assert.deepEqual(await c.eraseAbuseReportContact(db,reviewer.p,{reportId:first.id}),{reportId:first.id,reporterEmail:null},'Exact retry succeeds');ok();
 assert.equal((await call('reports/erase-contact',{reportId:fifth},reviewer.f.token)).status,200,'A report without an email erases nothing');ok();
 const ledgerRows=await all("SELECT kind,subject_id,effect FROM restore_suppressions WHERE kind='report_contact'");
 assert.deepEqual(ledgerRows.map(x=>[x.kind,x.subject_id,x.effect]),[['report_contact',first.id,'deleted']],'Only the erased report is recorded, by identifier');ok();
 assert.ok(!JSON.stringify(await all('SELECT * FROM restore_suppressions')).toLowerCase().includes(EMAIL));ok();
 // An erased email cannot be written back; the ledger also guards re-inserts and whole-database restores (below).
 await assert.rejects(()=>run('UPDATE abuse_reports SET reporter_email=? WHERE id=?',EMAIL,first.id),/abuse_report_immutable/);ok();
 assert.ok((await all("SELECT action,outcome,reason FROM safety_case_audit WHERE action='erase_report_contact'")).some(a=>a.outcome==='rejected'&&a.reason==='active_hold'));ok();
 if(fixture.sql){
  // An older whole-database backup still holds the address; the WH-019 replay clears it before the candidate serves.
  candidateSQL=new DatabaseSync(join(directory,'before.sqlite'));candidateSQL.exec('PRAGMA foreign_keys=ON');const candidate=sqliteD1Adapter(candidateSQL);
  assert.equal((await candidate.prepare('SELECT reporter_email FROM abuse_reports WHERE id=?').bind(first.id).first()).reporter_email,EMAIL);
  const current=await r.suppression.captureRestoreSuppressions(db);let gate=await r.suppression.checkRestoreSuppressions(candidate,current);
  assert.equal(gate.clear,false);assert.equal(gate.pending.report_contact,1);
  const replay=await r.suppression.replayRestoreSuppressions(candidate,current);assert.equal(replay.applied.reportContactsErased,1);
  assert.ok(Object.values((await r.suppression.replayRestoreSuppressions(candidate,current)).applied).every(n=>n===0),'A duplicate replay changes nothing');
  gate=await r.suppression.checkRestoreSuppressions(candidate,current);assert.equal(gate.clear,true);
  assert.equal((await candidate.prepare('SELECT reporter_email FROM abuse_reports WHERE id=?').bind(first.id).first()).reporter_email,null);ok();
  candidateSQL.close();
 }
 // ---- Retention (owner decision October 4, 2026): untriaged reports are kept; reports not linked to a case go 365 days
 // after triage; linked reports follow their case's operator-released retention and are never deleted under a hold.
 assert.equal(r.reports.abuseReportRetentionDays,365);
 /** Simulated passage of time: lift the named immutability guards for one statement and restore the exact schema. */
 const lifted=async(names,fn)=>{const guards=await all(`SELECT name,sql FROM sqlite_master WHERE type='trigger' AND name IN (${names.map(()=>'?').join(',')})`,...names);
  assert.equal(guards.length,names.length);for(const g of guards)await run(`DROP TRIGGER ${g.name}`);try{await fn();}finally{for(const g of guards)await run(g.sql);}};
 const ageReports=(days,where='1')=>lifted(['abuse_reports_update'],()=>run(`UPDATE abuse_reports SET received_at=received_at-?,triaged_at=triaged_at-? WHERE ${where}`,days*86400,days*86400));
 const ageCase=(caseId,days=400)=>lifted(['safety_cases_update','safety_cases_close_held'],()=>run('UPDATE safety_cases SET opened_at=opened_at-?,retention_due_at=retention_due_at-? WHERE id=?',days*86400,days*86400,caseId));
 const present=async id=>!!(await row('SELECT 1 AS x FROM abuse_reports WHERE id=?',id));
 const scheduled=async()=>{await m.worker.scheduled({cron:'17 3 * * *'},{DB:db,FILES:{list:async()=>({objects:[],truncated:false}),delete:async()=>assert.fail('No photo cleanup here')}});
  assert.equal((await row("SELECT status FROM maintenance_health WHERE job='contacts'")).status,'completed');};
 const untriaged=await count('abuse_reports',"triage='received'"),total=await count('abuse_reports');
 // Nothing is due yet: a fresh triage is kept, and the real scheduler deletes nothing.
 await scheduled();assert.equal(await count('abuse_reports'),total);ok();
 await assert.rejects(()=>run('DELETE FROM abuse_reports WHERE id=?',third),/abuse_report_immutable/);ok();
 // 364 days after triage: still kept.
 await ageReports(364);assert.equal(await r.reports.cleanupAbuseReports(db),0);assert.ok(await present(third));ok();
 await ageReports(2);
 // A hold on the subject (here through another case about the same owner) blocks the due deletion: skipped and refused.
 await c.placePreservationHold(db,keeper.p,{holdId:'hold-subject',caseId:'case-report-2',legalBasisRef:'basis-3',reviewDays:30});
 assert.equal(await r.reports.cleanupAbuseReports(db),0);await assert.rejects(()=>run('DELETE FROM abuse_reports WHERE id=?',third),/safety_preservation_hold/);assert.ok(await present(third));ok();
 await c.releasePreservationHold(db,keeper.p,{holdId:'hold-subject',caseId:'case-report-2',releaseRef:'release-2'});
 // Released: the not-linked report goes; linked reports (case retention not released) and untriaged reports stay.
 await scheduled();assert.ok(!await present(third));assert.ok(await present(first.id)&&await present(second)&&await present(fourth));
 assert.equal(await count('abuse_reports',"triage='received'"),untriaged,'Untriaged reports are kept however old');assert.equal(await count('abuse_reports'),total-1);ok();
 assert.deepEqual((await all("SELECT subject_id FROM restore_suppressions WHERE kind='abuse_report'")).map(x=>x.subject_id),[third],'The deletion is recorded by identifier');ok();
 await assert.rejects(()=>run("INSERT INTO abuse_reports(id,project_id,subject_user_id,surface,host_kind,path,category,request_hash,received_at) VALUES(?,?,?,'site','platform','/','other',?,unixepoch())",third,projectA,ownerA.account,'a'.repeat(64)),/restore_suppressed/,'A deleted report cannot be logically restored');ok();
 // A report linked to a case only today stays even after that case's retention is released (one-year minimum after triage).
 const recent=(await c.listAbuseReports(db,reviewer.p))[0].id;
 await c.triageAbuseReport(db,reviewer.p,{reportId:recent,decision:'link_case',caseId:'case-report-2',decisionRef:'triage-recent'});
 // Linked reports wait for the operator-reviewed release of their case's retention, which needs a closed, due case.
 for(const caseId of ['case-report-1','case-report-2'])await c.closeSafetyCase(db,reviewer.p,{caseId,closeRef:'close-'+caseId});
 assert.equal(await r.reports.cleanupAbuseReports(db),0,'Closed but not released: kept');ok();
 for(const caseId of ['case-report-1','case-report-2']){
  await ageCase(caseId);
  const preview=await c.previewSafetyRetentionDecision(db,keeper.p,{caseId,decision:'release',decisionRef:'ret-'+caseId});
  await c.applySafetyRetentionDecision(db,keeper.p,{caseId,decision:'release',decisionRef:'ret-'+caseId,reviewSha256:preview.reviewSha256});
  if(caseId==='case-report-1'){
   // After its case is released, a hold on the subject from any other case still keeps the linked reports.
   await c.openSafetyCase(db,reviewer.p,{caseId:'case-late',subjectUserId:ownerA.account,intakeRef:'manual-late'});
   await c.placePreservationHold(db,keeper.p,{holdId:'hold-late',caseId:'case-late',legalBasisRef:'basis-4',reviewDays:30});
   assert.equal(await r.reports.cleanupAbuseReports(db),0);await assert.rejects(()=>run('DELETE FROM abuse_reports WHERE id=?',first.id),/safety_preservation_hold/);assert.ok(await present(first.id));ok();
   await c.releasePreservationHold(db,keeper.p,{holdId:'hold-late',caseId:'case-late',releaseRef:'release-3'});
  }
 }
 assert.equal(await r.reports.cleanupAbuseReports(db),3);
 assert.ok(!await present(first.id)&&!await present(second)&&!await present(fourth),'Linked reports follow the released case');assert.ok(await present(recent),'Triaged less than a year ago: kept');ok();
 await assert.rejects(()=>run('DELETE FROM abuse_reports WHERE id=?',recent),/abuse_report_immutable/);ok();
 assert.equal(await count('abuse_reports',"triage='received'"),untriaged-1);ok();
 // Cases, findings and audit rows stay (identifiers only); only the reports and their optional emails are gone.
 assert.equal(await count('safety_cases',"id IN ('case-report-1','case-report-2')"),2);ok();
 if(fixture.sql){
  // An older whole-database backup still has the deleted reports; the WH-019 replay removes them before it serves.
  candidateSQL=new DatabaseSync(join(directory,'before-retention.sqlite'));candidateSQL.exec('PRAGMA foreign_keys=ON');const candidate=sqliteD1Adapter(candidateSQL);
  const current=await r.suppression.captureRestoreSuppressions(db);let gate=await r.suppression.checkRestoreSuppressions(candidate,current);
  assert.equal(gate.pending.abuse_report,4);
  const replay=await r.suppression.replayRestoreSuppressions(candidate,current);assert.equal(replay.applied.reportsRemoved,4);
  gate=await r.suppression.checkRestoreSuppressions(candidate,current);assert.equal(gate.clear,true);
  assert.equal((await candidate.prepare('SELECT count(*) AS n FROM abuse_reports').first()).n,total-4);ok();
  candidateSQL.close();
 }
 if(directory)await rm(directory,{recursive:true,force:true});
 assert.equal(network,0,'No external delivery or report is sent');ok();
 assert.ok(!logs.some(l=>l.toLowerCase().includes(EMAIL)||l.includes(MARK)),'Nothing submitted is logged');ok();
 console.log(`abuse reports: ${checks} checks passed (${d1?'local D1':'SQLite'})`);
}finally{globalThis.fetch=originalFetch;for(const k of consoleMethods)console[k]=originalConsole[k];await fixture.close?.();}
