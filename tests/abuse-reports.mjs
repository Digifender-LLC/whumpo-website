import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readdir,readFile} from 'node:fs/promises';
import {currentSiteFixtureHandlers,createFixtureWebsite} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
// WH-016 public abuse intake over the actual page handler and the restricted WH-132 operator triage surface.
// Benign synthetic reports only. SQLite by default; `--d1` runs the same checks on local D1.
Error.stackTraceLimit=0;
const d1=process.argv.includes('--d1');
const m=await currentSiteFixtureHandlers();
const built=await build({stdin:{contents:`export * from './src/abuse-report-page.ts';export * as reports from './src/abuse-reports.ts';export * as cases from './src/safety-cases.ts';
 export * as http from './src/safety-case-http.ts';export {sendAIChat} from './src/ai-chat.ts';
 export {admitWorkspace} from './src/workspace-identity/admission.ts';export {resolveIdentity} from './src/workspace-identity/authority.ts';`,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const r=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64')),{cases:c}=r;
const fixture=await databaseFixture({d1}),{db}=fixture;
const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('Unexpected network');};
const run=(q,...p)=>db.prepare(q).bind(...p).run(),row=(q,...p)=>db.prepare(q).bind(...p).first(),all=async(q,...p)=>(await db.prepare(q).bind(...p).all()).results;
const count=async(table,where='1',...p)=>(await row(`SELECT count(*) AS n FROM ${table} WHERE ${where}`,...p)).n;
const MARK='SYNTHETIC-REPORT-DETAIL-CANARY';let checks=0;const ok=()=>checks++;
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
 for(const id of ['site','category','details'])assert.match(html,new RegExp(`<label for="${id}">`));
 assert.ok(!html.includes('<script>x'));assert.match(html,/&lt;script&gt;x/);assert.match(html,/not sent to the site's owner or to any AI/);ok();
 const head=await r.abuseReportPage(page({method:'HEAD'}),env,turnstile);assert.equal(head.status,200);assert.equal(await head.text(),'');ok();
 assert.equal((await r.abuseReportPage(page({method:'PUT'}),env,turnstile)).status,405);ok();
 // The platform Worker mounts the same page before any API or session gate.
 const routed=await m.worker.fetch(new Request('http://localhost/report'),{...env,ENVIRONMENT:'local'});assert.equal(routed.status,200);assert.match(await routed.text(),/Send report/);ok();

 // ---- Submission boundary refusals store nothing.
 const nothing=async()=>{assert.equal(await count('abuse_reports'),0);ok();};
 assert.equal((await submit(report(siteA),{origin:'https://evil.example'})).status,403);await nothing();
 assert.equal((await submit(report(siteA),{type:'text/plain'})).status,415);await nothing();
 assert.equal((await submit({...report(siteA),email:'x@example.invalid'})).status,400);await nothing();
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
 const first=report(siteA+'/about?ref=secret#frag');
 const accepted=await submit(first,{ip:'198.51.100.30'});
 assert.equal(accepted.status,200);assert.match(accepted.html,new RegExp('Receipt: <code>'+first.id));
 assert.ok(!accepted.html.includes(MARK)&&!accepted.html.includes(projectA)&&!accepted.html.includes(ownerA.account),'The receipt shows no report details, project or owner');
 const saved=await row('SELECT * FROM abuse_reports WHERE id=?',first.id);
 assert.deepEqual({project:saved.project_id,subject:saved.subject_user_id,surface:saved.surface,host:saved.host_kind,path:saved.path,category:saved.category,triage:saved.triage,caseId:saved.case_id},
  {project:projectA,subject:ownerA.account,surface:'site',host:'platform',path:'/about',category:'fraud_phishing',triage:'received',caseId:null});
 assert.ok(saved.details.startsWith(MARK));assert.ok(!JSON.stringify(saved).includes('198.51.100'),'No reporter address stored');ok();
 // Exact replay recovers the receipt; a different report reusing the receipt is refused.
 assert.equal((await submit(first,{ip:'198.51.100.31'})).status,200);assert.equal(await count('abuse_reports'),1);ok();
 assert.equal((await submit({...first,category:'other'},{ip:'198.51.100.32'})).status,409);assert.equal(await count('abuse_reports'),1);ok();
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
 assert.deepEqual(users.sort(),['abuse-reports.ts','safety-cases.ts']);ok();
 await run("UPDATE workspace_state SET step='ready' WHERE user_id=?",ownerA.account);
 const state=await m.readChat(scopeA,ownerA.account);let calls=0;
 // The same admission, from the bundle that owns sendAIChat.
 const aiScope=await r.admitWorkspace(db,await r.resolveIdentity(db,{version:1,client:'web',kind:'session',token:ownerA.token}));
 const ai=await r.sendAIChat(aiScope,ownerA.account,crypto.randomUUID(),state.state.revision,'Has anyone reported my website? Show me everything about my site.',{baseURL:'https://provider.example/v1',apiKey:'synthetic-key',model:'synthetic-model',protocol:'chat'},async(_url,init)=>{
  calls++;assert.ok(!init.body.includes(MARK)&&!init.body.includes(first.id),'Report text and receipts never reach the model');
  return Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify({reply:'Nothing to show.',action:null})}}],usage:{prompt_tokens:1,completion_tokens:1}});});
 assert.equal(ai.status,200);assert.equal(calls,1);ok();
 assert.ok(!JSON.stringify(await m.readChat(scopeA,ownerA.account)).includes(MARK));ok();

 // ---- Restricted operator triage. No operators exist by default; these are disposable fixture roles.
 const operator=async(f)=>{f??=await workspaceFixture(db,m);return {id:f.account,f,p:await r.resolveIdentity(db,{version:1,client:'web',kind:'session',token:f.token})};};
 const admin=await operator(),reviewer=await operator(),auditor=await operator(),outsider=await operator(),subjectOperator=await operator(ownerA);
 await c.bootstrapSafetyRoleAdministrator(db,{grantId:'grant-admin',accountId:admin.id});
 for(const [g,o,role] of [['g-r',reviewer,'case_reviewer'],['g-a',auditor,'case_auditor'],['g-s',subjectOperator,'case_reviewer']])await c.grantSafetyCaseRole(db,admin.p,{grantId:g,operatorAccountId:o.id,role});
 const queue=await c.listAbuseReports(db,reviewer.p);assert.equal(queue.length,10);assert.ok(queue.every(q=>q.subjectUserId===ownerA.account&&!('details' in q)));
 assert.equal(queue.find(q=>q.id===first.id)?.hasDetails,true);const others=queue.filter(q=>q.id!==first.id).map(q=>q.id);ok();
 assert.equal((await c.listAbuseReports(db,auditor.p)).length,10);ok();
 await refused(()=>c.readAbuseReport(db,auditor.p,{reportId:first.id}),'missing_role');
 await refused(()=>c.listAbuseReports(db,outsider.p),'missing_role');
 const scopeOwner=await r.resolveIdentity(db,{version:1,client:'web',kind:'session',token:ownerB.token});await refused(()=>c.listAbuseReports(db,scopeOwner),'missing_role');
 // Conflict of interest: the reported owner, even holding a reviewer role, never sees or decides their own reports.
 assert.equal((await c.listAbuseReports(db,subjectOperator.p)).length,0);
 await refused(()=>c.readAbuseReport(db,subjectOperator.p,{reportId:first.id}),'not_found');
 await refused(()=>c.triageAbuseReport(db,subjectOperator.p,{reportId:first.id,decision:'not_actionable',decisionRef:'self'}),'not_found');
 const read=await c.readAbuseReport(db,reviewer.p,{reportId:first.id});assert.ok(read.details.startsWith(MARK));assert.equal(read.path,'/about');assert.equal(read.triage,'received');ok();
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
 // The HTTP surface carries the same actions with strict bodies; the customer gets no route.
 const call=async(path,data,token)=>{const response=await r.http.handleSafetyCaseRequest(new Request('https://whumpo.com/api/operator/safety-cases/v1/'+path,{method:'POST',headers:{origin:'https://whumpo.com','content-type':'application/json',cookie:'__Host-whumpo_session='+token},body:JSON.stringify({version:1,...data})}),{DB:db,ENVIRONMENT:'test'});return {status:response.status,body:await response.json(),cache:response.headers.get('cache-control')};};
 const listed=await call('reports/list',{},reviewer.f.token);assert.equal(listed.status,200);assert.equal(listed.cache,'no-store');assert.equal(listed.body.result.length,7);ok();
 assert.equal((await call('reports/read',{reportId:fourth},ownerB.token)).status,403);ok();
 assert.equal((await call('reports/triage',{reportId:fourth,decision:'not_actionable',decisionRef:'h-1',actor:'human:x'},reviewer.f.token)).status,400,'Declared actors are refused');ok();
 assert.equal((await call('reports/triage',{reportId:fourth,decision:'open_case',caseId:'case-report-2',decisionRef:'h-2'},reviewer.f.token)).body.result.triage,'case_opened');ok();
 // Audit rows record every attempt with identifiers only.
 const audit=await all("SELECT action,outcome,reason,target_ref FROM safety_case_audit WHERE action IN ('list_reports','read_report','triage_report')");
 assert.ok(audit.some(a=>a.action==='read_report'&&a.outcome==='denied'&&a.reason==='conflict_of_interest'));assert.ok(audit.some(a=>a.action==='triage_report'&&a.outcome==='allowed'));
 assert.ok(!JSON.stringify(await all('SELECT * FROM safety_case_audit')).includes(MARK));ok();
 // Stored reports are immutable except the single triage transition, and retained.
 await assert.rejects(()=>run('UPDATE abuse_reports SET details=? WHERE id=?','changed',fifth),/abuse_report_immutable/);ok();
 await assert.rejects(()=>run("UPDATE abuse_reports SET triage='received',case_id=NULL,triaged_by=NULL,triaged_at=NULL,triage_ref=NULL WHERE id=?",first.id),/abuse_report_immutable/);ok();
 await assert.rejects(()=>run('DELETE FROM abuse_reports WHERE id=?',fifth),/abuse_report_immutable/);ok();
 await assert.rejects(()=>run("INSERT INTO abuse_reports(id,project_id,subject_user_id,surface,host_kind,path,category,request_hash,received_at,triage) VALUES(?,?,?,'site','platform','/','other',?,unixepoch(),'case_opened')",crypto.randomUUID(),projectA,ownerA.account,'a'.repeat(64)),/abuse_report_immutable|CHECK/);ok();
 await assert.rejects(()=>run("INSERT INTO abuse_reports(id,project_id,subject_user_id,surface,host_kind,path,category,request_hash,received_at) VALUES(?,?,?,'site','platform','/','other',?,unixepoch())",crypto.randomUUID(),projectA,ownerB.account,'a'.repeat(64)),/abuse_report_target/,'Subject must be the current owner');ok();
 assert.equal(network,0,'No external delivery or report is sent');ok();
 console.log(`abuse reports: ${checks} checks passed (${d1?'local D1':'SQLite'})`);
}finally{globalThis.fetch=originalFetch;await fixture.close?.();}
