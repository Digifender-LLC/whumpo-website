import {createFixtureProject,currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
Error.stackTraceLimit=0;
// WH-037: publication, DNS/TLS, form and traffic diagnostics plus measurement quality, through the shared view registry.
// Synthetic only: no network, provider, model or visitor data. Disposable SQLite (or local D1 with --d1).
const m=await currentSiteFixtureHandlers(),{sendChat,readChat,host,checkHealth,readTraffic,cleanupTraffic,measureTraffic,trafficClass,pendingMeasurementGaps,MAX_IN_FLIGHT,siteDiagnostics}=m;
const fixture=await databaseFixture({d1:process.argv.includes('--d1')}),db=fixture.db,scopes=new Map(),scope=user=>scopes.get(user);
const id=()=>crypto.randomUUID(),row=(q,...p)=>db.prepare(q).bind(...p).first(),rows=async(q,...p)=>(await db.prepare(q).bind(...p).all()).results,run=(q,...p)=>db.prepare(q).bind(...p).run();
let cases=0;const check=async(label,fn)=>{try{await fn();cases++;}catch(error){console.error(label);throw error;}};
const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('No network, provider or model call is allowed');};
const logs=[],originalWarn=console.warn;console.warn=(...a)=>{logs.push(a.join(' '));};
async function chat(user,content){const state=await readChat(scope(user),user),turn=id(),result=await sendChat(scope(user),user,{content,id:turn,revision:state.state.revision});assert.equal(result.status,200,JSON.stringify(result));return turn;}
async function owner(live=true,name='Garden'){const a=await workspaceFixture(db,m),user=a.account;scopes.set(user,await a.scope());const site=await createFixtureProject(scope(user),user,name,'A synthetic '+name+' website.');if(live){const review=await chat(user,'/publish '+site.version);await chat(user,'/confirm '+review);}return {user,...site};}
const url=project=>'https://'+project+'.whumpo.site/';
const served=(project,agent,env={DB:db},ctx)=>host.fetch(new Request(url(project),{headers:agent?{'user-agent':agent}:{}}),env,ctx);
const transport=async(u,init)=>{assert.equal(init.headers['user-agent'],'whumpo-site-check/1');return host.fetch(new Request(u,init),{DB:db,FILES:{get:async()=>null,head:async()=>null}});};
const read=(o,project=o.project,now)=>siteDiagnostics.readSiteDiagnostics(scope(o.user),o.user,project,now);
const view=(o,project=o.project)=>m.readViewBinding(scope(o.user),o.user,'site-health',project);
const finding=(facts,code)=>facts.items[0].findings.find(f=>f.code===code);
const ago=ms=>new Date(Date.now()-ms).toISOString();
try{
 const a=await owner(),b=await owner(false,'Foreign'),c=await owner(false,'Draft');
 await run("INSERT INTO feature_preview_grants VALUES(?,1,?,NULL,'core.insights','read','private-test-acceptance','synthetic traffic reader',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),a.user);
 await check('registry: one set of bindings over the existing handlers, read-only view, no model action',()=>{
  const registered=siteDiagnostics.siteHealthBindings,domain={...siteDiagnostics,checkHealth:m.checkHealth,listHealth:m.listHealth};
  assert.deepEqual(Object.keys(registered).sort(),['project.site-health@1','site-health.check@1','site-health.report@1']);
  for(const [key,binding] of Object.entries(registered))assert.equal(typeof domain[binding.handler],'function',key);
  assert.equal(m.interactionBindings['project.site-health@1'].handler,'readViewBinding');assert.equal(m.interactionBindings['project.site-health@1'].mode,'read');
  for(const key of Object.keys(m.interactionBindings))assert.doesNotMatch(key,/site-health\.check/);
  assert.equal(registered['site-health.check@1'].modelContext,'never from this surface');
  const prompt=m.agentPrompt({});assert.match(prompt,/site-health/);
  assert.equal(m.chatControl({type:'shortcut',kind:'checkWebsite',projectId:a.project}).command,'/check-site '+a.project);
  assert.equal(m.chatControl({type:'shortcut',kind:'health',projectId:a.project}).command,'/health '+a.project);
 });
 await check('publication, version and evidence timestamps are visible; unpublished and never-checked are distinguished',async()=>{
  let facts=await read(a);const p=facts.items[0];
  assert.equal(p.publication.state,'published');assert.equal(p.publication.versionId,a.version);assert.equal(p.publication.revision,1);assert.ok(Date.parse(p.publication.evidenceAt));
  assert.equal(p.health.status,'not_checked');assert.equal(finding(facts,'health.not_checked').action.command,'/check-site '+a.project);
  facts=await read(c);assert.equal(facts.items[0].publication.state,'unpublished');assert.equal(facts.items[0].health.status,'unpublished');assert.equal(facts.items[0].findings.filter(f=>f.area==='health').length,0);
  const shared=await view(a);assert.equal(shared.status,'ready');assert.equal(shared.binding,'project.site-health@1');assert.ok(m.readViewComponentData(shared));
  await checkHealth(scope(a.user),a.user,a.project,transport);facts=await read(a);
  assert.equal(facts.items[0].health.status,'healthy');assert.ok(Date.parse(facts.items[0].health.evidenceAt));assert.equal(finding(facts,'health.healthy').severity,'ok');
 });
 await check('failed, changed, interrupted and stale checks are separate states with an exact next action',async()=>{
  await run("UPDATE site_health_checks SET started_at=? WHERE project_id=?",ago(400000),a.project);
  await checkHealth(scope(a.user),a.user,a.project,async()=>new Response('Missing',{status:404}));
  let facts=await read(a);assert.equal(facts.items[0].health.status,'unhealthy');assert.match(finding(facts,'health.unhealthy').message,/did not return an HTML success response.*Nothing was rolled back/);assert.equal(finding(facts,'health.unhealthy').action.command,'/check-site '+a.project);
  await run("UPDATE site_health_checks SET state='checking',finished_at=NULL,started_at=? WHERE project_id=?",ago(120000),a.project);facts=await read(a);assert.equal(facts.items[0].health.status,'interrupted');
  await run("UPDATE site_health_checks SET state='healthy',started_at=?,finished_at=? WHERE project_id=?",ago(8*3600000),ago(8*3600000),a.project);facts=await read(a);assert.equal(facts.items[0].health.status,'stale');assert.equal(finding(facts,'health.stale').severity,'attention');
  await run('UPDATE publications SET revision=revision+1 WHERE project_id=?',a.project);facts=await read(a);assert.equal(facts.items[0].health.status,'changed');assert.equal(facts.items[0].health.detail,null);
  await run('UPDATE publications SET revision=revision-1 WHERE project_id=?',a.project);await run("UPDATE site_health_checks SET started_at=?,finished_at=? WHERE project_id=?",ago(400000),ago(400000),a.project);await checkHealth(scope(a.user),a.user,a.project,transport);
 });
 await check('DNS and TLS states come from saved records with sanitized provider text and bounded fixed commands',async()=>{
  let facts=await read(a);assert.equal(facts.items[0].domain.state,'none');assert.equal(finding(facts,'domain.none').severity,'info');
  const claim=id();await run("INSERT INTO domain_claims(id,project_id,hostname,token,expires_at,created_at) VALUES(?,?,?,?,?,?)",claim,a.project,'www.example.test','PROOF_TOKEN_CANARY',ago(-86400000),ago(1000));
  facts=await read(a);assert.equal(facts.items[0].domain.state,'awaiting_dns');assert.equal(finding(facts,'domain.awaiting_dns').action.command,'/verify-domain '+claim);assert.ok(!JSON.stringify(facts).includes('PROOF_TOKEN_CANARY'));
  await run("UPDATE domain_claims SET verified_at=? WHERE id=?",ago(500),claim);assert.equal((await read(a)).items[0].domain.state,'ownership_verified');
  const connection=id();await run("INSERT INTO domain_connections(id,user_id,claim_id,project_id,hostname,zone_id,target,proof_hash,state,detail,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,'review','PROVIDER_DETAIL_CANARY',?,?)",connection,a.user,claim,a.project,'www.example.test','8d46ee4e394514402479acf16579f7b5','hosting.whumpo.site','p',ago(2000),ago(-86400000));
  await run("UPDATE domain_connections SET state='provisioning',provider_id=?,provider_status='pending',ssl_status='pending_validation',checked_at=? WHERE id=?",id(),ago(1000),connection);
  facts=await read(a);assert.equal(facts.items[0].domain.state,'provisioning');assert.equal(facts.items[0].domain.certificateStatus,'pending_validation');assert.equal(facts.items[0].domain.hostname,'www.example.test');assert.ok(Date.parse(facts.items[0].domain.evidenceAt));
  assert.equal(finding(facts,'domain.provisioning').action.command,'/check-hosting '+connection);assert.ok(!JSON.stringify(facts).includes('PROVIDER_DETAIL_CANARY'));
  await run("UPDATE domain_connections SET provider_status='<script>x</script>',ssl_status='A'||char(10)||'B' WHERE id=?",connection);facts=await read(a);assert.equal(facts.items[0].domain.providerStatus,'');assert.equal(facts.items[0].domain.certificateStatus,'');
  await run("UPDATE domain_connections SET state='active',provider_status='active',ssl_status='active',serve_until=? WHERE id=?",ago(-3600000),connection);facts=await read(a);assert.equal(facts.items[0].domain.state,'active');assert.equal(finding(facts,'domain.active').severity,'ok');
  await run("UPDATE domain_connections SET serve_until=? WHERE id=?",ago(1000),connection);facts=await read(a);assert.equal(facts.items[0].domain.state,'needs_check');assert.equal(finding(facts,'domain.needs_check').severity,'attention');
  await run("UPDATE domain_connections SET state='uncertain' WHERE id=?",connection);assert.equal(finding(await read(a),'domain.uncertain').action.command,'/check-hosting '+connection);
  const expired=id();await run("INSERT INTO domain_claims(id,project_id,hostname,token,expires_at,created_at) VALUES(?,?,?,?,?,?)",expired,c.project,'old.example.test','T',ago(1000),ago(5000));
  facts=await read(c);assert.equal(facts.items[0].domain.state,'proof_expired');assert.equal(finding(facts,'domain.proof_expired').action.command,'/domains');
 });
 await check('form and contact states never expose submission content',async()=>{
  const canary='FORM_BODY_CANARY_'+id();
  await run('INSERT INTO contact_settings(project_id,revision,enabled,publication_revision) SELECT project_id,1,1,revision FROM publications WHERE project_id=?',a.project);
  await run("INSERT INTO contact_submissions(id,project_id,settings_revision,request_hash,name,email,message,created_at,expires_at) VALUES(?,?,1,'h',?,?,?,?,?)",id(),a.project,canary,canary+'@example.invalid',canary,ago(1000),ago(-86400000));
  await run("INSERT INTO contact_submissions(id,project_id,settings_revision,request_hash,name,email,message,created_at,expires_at) VALUES(?,?,1,'h2','x','x@example.invalid','expired',?,?)",id(),a.project,ago(9e8),ago(1000));
  await run('UPDATE contact_settings SET publication_revision=0 WHERE project_id=?',a.project);
  const facts=await read(a);assert.equal(facts.items[0].form.contact,'needs_republish');assert.equal(facts.items[0].form.submissionsRetained,1);assert.equal(finding(facts,'form.contact_needs_republish').severity,'attention');
  assert.ok(!JSON.stringify(facts).includes(canary));assert.ok(!JSON.stringify(await view(a)).includes(canary));
  await run('UPDATE contact_settings SET publication_revision=(SELECT revision FROM publications WHERE project_id=?) WHERE project_id=?',a.project,a.project);assert.equal((await read(a)).items[0].form.contact,'live');
  await run('DELETE FROM contact_submissions WHERE project_id=?',a.project);await run('DELETE FROM contact_settings WHERE project_id=?',a.project);
 });
 await check('analytics are owner-scoped: another account sees nothing of this project, scoped or account-wide',async()=>{
  await Promise.all([served(a.project,'Mozilla/5.0'),served(a.project,'Mozilla/5.0')]);
  const foreignAll=await read(b,null),foreignScoped=await view(b,a.project),mine=JSON.stringify(await read(a));
  assert.deepEqual(foreignAll.items.map(p=>p.projectId),[b.project,]);assert.equal(foreignScoped.status,'unavailable');assert.equal(foreignScoped.data,null);
  assert.ok(!JSON.stringify(foreignAll).includes(a.project)&&!JSON.stringify(foreignAll).includes(a.version));
  assert.deepEqual((await read(b,a.project)).items,[]);assert.deepEqual((await readTraffic(scope(b.user),b.user,a.project)).rows,[]);assert.deepEqual((await readTraffic(scope(b.user),b.user,a.project)).telemetry.projects,[]);
  assert.ok(mine.includes(a.project));
  await assert.rejects(siteDiagnostics.readSiteDiagnostics(scope(a.user),a.user,'not-a-project'),{status:400});
 });
 await check('bot and platform-check exclusions are aggregate-only; counted requests exclude them',async()=>{
  const baseline=await readTraffic(scope(a.user),a.user),before=baseline.rows.reduce((n,r)=>n+r.requests,0),excluded0=baseline.telemetry.projects.find(p=>p.projectId===a.project).excludedRequests;
  const agents=['Googlebot/2.1 (+http://www.google.com/bot.html)','Mozilla/5.0 (compatible; AhrefsBot/7.0)','curl/8.4.0','whumpo-site-check/1','Lighthouse'];
  for(const agent of agents)assert.equal((await served(a.project,agent)).status,200);
  assert.equal(trafficClass(new Request(url(a.project),{headers:{'user-agent':'Mozilla/5.0 (Macintosh) Safari/605.1'}})),'counted');
  assert.equal(trafficClass(new Request(url(a.project))),'counted');
  const t=await readTraffic(scope(a.user),a.user),mineT=t.telemetry.projects.find(p=>p.projectId===a.project);
  assert.equal(t.rows.reduce((n,r)=>n+r.requests,0),before);assert.equal(mineT.excludedRequests,excluded0+agents.length);assert.equal(mineT.missedMeasurements,0);
  const columns=(await rows('PRAGMA table_info(site_traffic_quality)')).map(r=>r.name);assert.deepEqual(columns,['project_id','day','excluded_requests','missed_measurements','updated_at']);
  const dump=JSON.stringify([...await rows('SELECT * FROM site_traffic_quality'),...await rows('SELECT * FROM site_traffic_daily')]);for(const agent of agents)assert.ok(!dump.includes(agent.slice(0,9)));
  // The platform health check uses the public path and is therefore excluded, not counted as a visit.
  await run("UPDATE site_health_checks SET started_at=?,finished_at=? WHERE project_id=?",ago(400000),ago(400000),a.project);const q0=(await readTraffic(scope(a.user),a.user)).telemetry.projects.find(p=>p.projectId===a.project).excludedRequests;
  await checkHealth(scope(a.user),a.user,a.project,transport);const after=await readTraffic(scope(a.user),a.user);assert.equal(after.rows.reduce((n,r)=>n+r.requests,0),before);assert.equal(after.telemetry.projects.find(p=>p.projectId===a.project).excludedRequests,q0+1);
  // Errors and non-HTML are never counted or classified.
  for(const [path,method] of [['missing','GET'],['','HEAD']])await host.fetch(new Request(url(a.project)+path,{method,headers:{'user-agent':'Googlebot'}}),{DB:db});
  assert.equal((await readTraffic(scope(a.user),a.user)).telemetry.projects.find(p=>p.projectId===a.project).excludedRequests,q0+1);
 });
 await check('failed telemetry is disclosed as a lower bound, then late data is flushed once measurement recovers',async()=>{
  const start=pendingMeasurementGaps();let failing=true;
  const flaky={prepare(sql){if(failing&&/^INSERT INTO site_traffic_(daily|quality)/.test(sql))throw Error('synthetic telemetry failure');return db.prepare(sql);}};
  for(let i=0;i<3;i++)assert.equal((await served(a.project,'Mozilla/5.0',{DB:flaky})).status,200);
  assert.equal(pendingMeasurementGaps(),start+3);assert.equal((await readTraffic(scope(a.user),a.user)).telemetry.projects.find(p=>p.projectId===a.project).missedMeasurements,0);
  failing=false;await served(a.project,'Mozilla/5.0',{DB:flaky});
  let t=await readTraffic(scope(a.user),a.user),mine=t.telemetry.projects.find(p=>p.projectId===a.project);assert.equal(mine.missedMeasurements,3+start);assert.equal(mine.state,'delayed');assert.equal(pendingMeasurementGaps(),0);
  const facts=await read(a);assert.equal(facts.items[0].traffic.state,'delayed');assert.match(finding(facts,'traffic.delayed').message,/lower bound/);assert.equal(finding(facts,'traffic.delayed').action.command,'/traffic');
  // The same gap is plainly "gaps" (not late) after the delayed window, and expires out of the 30 day window.
  assert.equal((await readTraffic(scope(a.user),a.user,null,new Date(Date.now()+3*3600000))).telemetry.projects.find(p=>p.projectId===a.project).state,'gaps');
  assert.equal((await readTraffic(scope(a.user),a.user,null,new Date(Date.now()+31*86400000))).telemetry.projects.find(p=>p.projectId===a.project).missedMeasurements,0);
  await run('DELETE FROM site_traffic_quality WHERE project_id=? AND missed_measurements>0',a.project);await run('UPDATE site_traffic_quality SET missed_measurements=0 WHERE project_id=?',a.project);
 });
 await check('measurement overhead is budgeted: serving never waits, in-flight work is capped and shed work is disclosed',async()=>{
  let release;const gate=new Promise(r=>{release=r;});let writes=0;
  const slow={prepare(sql){const s=db.prepare(sql);if(!/^INSERT INTO site_traffic_daily/.test(sql))return s;return {bind:(...p)=>({run:async()=>{writes++;await gate;return s.bind(...p).run();}})};}};
  const tasks=[],ctx={waitUntil:p=>tasks.push(p)},t0=Date.now();
  const responses=await Promise.all(Array.from({length:MAX_IN_FLIGHT+8},()=>served(a.project,'Mozilla/5.0',{DB:slow},ctx)));
  assert.ok(responses.every(r=>r.status===200));assert.equal(tasks.length,MAX_IN_FLIGHT+8);assert.ok(Date.now()-t0<5000);
  assert.equal(writes,MAX_IN_FLIGHT,'at most the budgeted measurements are in flight');assert.equal(pendingMeasurementGaps(),8);
  release();await Promise.all(tasks);
  const mine=(await readTraffic(scope(a.user),a.user)).telemetry.projects.find(p=>p.projectId===a.project);
  await measureTraffic(db,a.project,'excluded');await measureTraffic(db,a.project,'excluded');
  assert.equal(pendingMeasurementGaps(),0);assert.ok(mine.missedMeasurements<=8);
  assert.equal((await readTraffic(scope(a.user),a.user)).telemetry.projects.find(p=>p.projectId===a.project).missedMeasurements,8);
  await run('UPDATE site_traffic_quality SET missed_measurements=0 WHERE project_id=?',a.project);
 });
 await check('missing, partial and unpublished telemetry are never read as a site fault or as zero visitors',async()=>{
  const now=new Date();let t=await readTraffic(scope(c.user),c.user,null,now);assert.equal(t.telemetry.projects[0].state,'not_published');
  const enabled=(await row('SELECT enabled_at FROM site_traffic_metadata WHERE id=1')).enabled_at;
  await run("UPDATE site_traffic_metadata SET enabled_at=? WHERE id=1",ago(2*86400000));
  let facts=await read(a);assert.equal(facts.items[0].traffic.state,'partial');assert.equal((await readTraffic(scope(a.user),a.user)).telemetry.coveredFrom,ago(2*86400000).slice(0,10));
  await run("UPDATE site_traffic_metadata SET enabled_at=? WHERE id=1",ago(40*86400000));facts=await read(a);assert.equal(facts.items[0].traffic.state,'complete');
  // Healthy page, complete telemetry and zero counted requests is the only quiet case that implies no visitors.
  await run('DELETE FROM site_traffic_daily WHERE project_id=?',a.project);await run('DELETE FROM site_traffic_quality WHERE project_id=?',a.project);
  await run("UPDATE site_health_checks SET started_at=?,finished_at=?,state='healthy' WHERE project_id=?",ago(1000),ago(500),a.project);
  facts=await read(a);assert.ok(finding(facts,'traffic.healthy_but_quiet'));
  await run("INSERT INTO site_traffic_quality(project_id,day,excluded_requests,missed_measurements,updated_at) VALUES(?,date('now','-3 days'),0,2,?)",a.project,ago(86400000));
  facts=await read(a);assert.equal(facts.items[0].traffic.state,'gaps');assert.equal(finding(facts,'traffic.healthy_but_quiet'),undefined);assert.match(finding(facts,'traffic.gaps').message,/does not show that nobody visited/);
  await run("DELETE FROM site_traffic_metadata WHERE id=1");facts=await read(a);assert.equal(facts.items[0].traffic.state,'unavailable');assert.equal((await view(a)).status,'ready','diagnostics stay readable and say measurement is unavailable');assert.equal((await m.readViewBinding(scope(a.user),a.user,'traffic',null)).status,'unavailable');
  await run('INSERT INTO site_traffic_metadata(id,enabled_at) VALUES(1,?)',enabled);await run('DELETE FROM site_traffic_quality WHERE project_id=?',a.project);
 });
 await check('shared client validator accepts exact facts and rejects widened, foreign or non-allowlisted content',async()=>{
  const ok=await view(a);assert.equal(ok.status,'ready');const good=m.readViewComponentData(ok);assert.ok(good);
  const mutate=fn=>{const copy=structuredClone(ok);fn(copy);return m.readViewComponentData(copy);};
  assert.equal(mutate(v=>{v.data.items[0].findings[0].action={label:'Run',command:'/unpublish '+a.project};}),null);
  assert.equal(mutate(v=>{v.data.items[0].findings.push({area:'form',code:'form.x',severity:'info',message:'x',action:{label:'Check',command:'/check-site '+id()}});}),null);
  assert.equal(mutate(v=>{v.data.items[0].visitorAddress='203.0.113.5';}),null);
  assert.equal(mutate(v=>{v.data.items[0].traffic.state='great';}),null);
  assert.equal(mutate(v=>{v.projectId=b.project;}),null);
  const t=structuredClone(await m.readViewBinding(scope(a.user),a.user,'traffic',null));assert.equal(t.status,'ready');assert.ok(m.readViewComponentData(t));t.data.telemetry.extra=1;assert.equal(m.readViewComponentData(t),null);
    assert.doesNotMatch(JSON.stringify(ok),/user-agent|cookie|203\.0\.113|authorization|token/i);
 });
 await check('maintenance retention drops quality rows older than the 30 day window (held-project retention is covered by safety-case-operations)',async()=>{
  const old="date('now','-60 days')";for(const p of [a.project,b.project])await run(`INSERT INTO site_traffic_quality(project_id,day,excluded_requests,missed_measurements,updated_at) VALUES(?,${old},1,1,?)`,p,ago(1000));
  await cleanupTraffic(db);assert.equal((await rows(`SELECT 1 FROM site_traffic_quality WHERE day=${old}`)).length,0);
 });
 assert.equal(network,0);assert.ok(logs.every(l=>!/203\.0\.113|Googlebot|FORM_BODY/.test(l)));
 console.warn=originalWarn;globalThis.fetch=originalFetch;
 console.log(`Site diagnostics passed: ${cases} groups. Registered read/action bindings, publication/DNS/TLS/form/traffic separation, evidence timestamps, failed/stale/interrupted checks, owner isolation, bot/check exclusions, missing/late/partial telemetry, bounded non-blocking measurement and closed command validation.`);
}finally{console.warn=originalWarn;globalThis.fetch=originalFetch;await fixture.close();}
