// WH-050 F7 / runbook G3: operator containment of one account or project's public allowances.
// Runs on disposable SQLite by default and on actual local D1 with --d1. No network, provider or deployed resource.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {currentSiteFixtureHandlers,createFixtureWebsite,enableFixtureVisitorAccess} from './current-site-fixture.mjs';
import {authenticator} from './app-authenticator.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
import {runContainment,containmentInput,containmentDigest,retentionMs} from '../tools/operator-containment-input.mjs';
const m=await currentSiteFixtureHandlers(),store=await databaseFixture(),db=store.db,scopes=new Map(),scope=user=>scopes.get(user);
const bundle=await build({stdin:{contents:"export * from './src/storage-budget';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const storage=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const {saveBackend,testBackend}=m.backend,{prepareBackendPublication:prepare,confirmBackendPublication:confirm}=m.backendPublication,{appData:data,appAuth:auth}=m,{prepareApplication,confirmApplication}=m.appActivation;
const {readChat,sendChat,contactPage}=m,{activeContact,saveContact}=m.contacts;
const id=()=>crypto.randomUUID(),now=()=>new Date().toISOString(),hours=n=>new Date(Date.now()+n*3600000).toISOString();
const service={fetch:async(_url,init)=>{const body=JSON.parse(init.body);if(body.input&&body.input.state)return Response.json({ok:true,value:{state:body.input.input,result:'saved'}});return Response.json({ok:true,value:1});}};
const OPERATOR='human:PRIVATE-OPERATOR-CANARY',REASON='PRIVATE-REASON-CANARY abusive public traffic';
async function user(){const u=id(),authority=await workspaceFixture(db,m,u);scopes.set(u,await authority.scope());await readChat(scopes.get(u),u);return u;}
async function project(owner){const p=id();await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Containment fixture','Testing','draft',?,?)").bind(p,owner,now(),now()).run();return {user:owner,project:p};}
async function backendProject(owner){const a=await project(owner),v=id(),r=id(),rid=id();await saveBackend(scope(owner),owner,a.project,v,'export default x=>x');await testBackend(scope(owner),service,owner,a.project,v,r,1);await prepare(scope(owner),owner,a.project,rid,'publish',v,r);await confirm(scope(owner),owner,rid);return a;}
async function appProject(owner){const a=await project(owner),version=id(),test=id(),review=id();await saveBackend(scope(owner),owner,a.project,version,'export default ({state,input})=>({state:input,result:"saved"})');await testBackend(scope(owner),service,owner,a.project,version,test,{state:{},input:{}});await enableFixtureVisitorAccess(scope(owner),owner,a.project);await prepareApplication(scope(owner),owner,a.project,review,'enable',version,test);await confirmApplication(scope(owner),owner,review);
 const invite=await auth.createAppInvitation(scope(owner),owner,a.project),opt=await auth.appPasskeyOptions(db,a.project,'signup',false,invite.code),key=authenticator(),result=await auth.appPasskeyVerify(db,a.project,'signup',opt.challengeToken,key.registration(opt.options),false);
 a.visitor={session:result.session,revision:0};return a;}
async function chat(owner,content){const state=await readChat(scope(owner),owner),input={id:id(),revision:state.state.revision,content};return {id:input.id,result:await sendChat(scope(owner),owner,input)};}
async function siteProject(owner){const a=await project(owner),v=await createFixtureWebsite(scope(owner),owner,a.project,{name:'Garden',headline:'Garden',description:'Testing',theme:'ocean',aboutTitle:'About',aboutText:'Testing',sections:[],photos:[]});
 const pub=await chat(owner,'/publish '+v);assert.equal((await chat(owner,'/confirm '+pub.id)).result.status,200);
 const on=await chat(owner,'/contact-on '+a.project);assert.equal((await chat(owner,'/confirm-contact '+on.id)).result.status,200);a.revision=(await activeContact(db,a.project)).revision;return a;}
let ipCounter=0;const ip=()=>{ipCounter++;return `198.51.${(ipCounter>>8)&255}.${ipCounter&255}`;};
const callBackend=a=>m.host.fetch(new Request(`https://${a.project}.whumpo.site/backend`,{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':ip()},body:'{"a":1}'}),{DB:db,BACKEND_RUNTIME:service});
const transition=async a=>{try{const r=await data.transitionAppData(db,service,a.visitor.session,a.project,id(),a.visitor.revision,{note:'x'});if(r.state==='complete')a.visitor.revision++;return {status:200,state:r.state};}catch(e){return {status:e.status,message:e.message};}};
const contactEnv={DB:db,ENVIRONMENT:'local',API_LIMITER:{limit:async()=>({success:true})}};
const postContact=a=>contactPage(new Request('https://whumpo.com/contact/'+a.project,{method:'POST',headers:{origin:'https://whumpo.com','cf-connecting-ip':ip()},body:new URLSearchParams({id:id(),name:'Visitor',email:'visitor@example.com',message:'Synthetic message',revision:String(a.revision)})}),contactEnv,a.project);
const photo=a=>storage.reservePublicPhotoRead(db,new Request('https://x.invalid/',{headers:{'cf-connecting-ip':ip()}}),a.project).then(()=>({ok:true}),e=>({ok:false,status:e.status,message:e.message}));
const count=async table=>(await db.prepare(`SELECT count(*) n FROM ${table}`).first()).n;
const customerTables=['projects','backend_versions','backend_publications','app_spaces','app_visitors','app_documents','app_sessions','contact_submissions','contact_settings','publications','site_versions','project_files','identity_sessions'];
const snapshot=async()=>Object.fromEntries(await Promise.all(customerTables.map(async t=>[t,await count(t)])));
const containments=async()=>(await db.prepare('SELECT count(*) n FROM operator_containments').first()).n;
const disclosed=text=>['PRIVATE-','human:','operator','contain'].filter(marker=>text.toLowerCase().includes(marker.toLowerCase()));
// Fixture-only clock move: the resolution trigger forbids changing times, so drop and restore it around one write.
async function rewrite(name,sql,...values){const trigger=(await db.prepare('SELECT sql FROM sqlite_master WHERE name=?').bind(name).first()).sql;await db.prepare('DROP TRIGGER '+name).run();try{await db.prepare(sql).bind(...values).run();}finally{await db.prepare(trigger).run();}}
const expire=actionId=>rewrite('operator_containment_resolve',"UPDATE operator_containments SET expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 second') WHERE id=?",actionId);
try{
 const x=await user(),y=await user();
 const xb=await backendProject(x),xa=await appProject(x),xs=await siteProject(x),yb=await backendProject(y),ya=await appProject(y),ys=await siteProject(y);
 // Every path admits normally before containment.
 for(const a of [xb,yb])assert.equal((await callBackend(a)).status,200);
 for(const a of [xa,ya])assert.equal((await transition(a)).state,'complete');
 for(const a of [xs,ys]){assert.equal((await postContact(a)).status,200);assert.equal((await photo(a)).ok,true);}

 // Input validation happens before any database access.
 const base={action:'contain',id:id(),subject:{kind:'project',id:xb.project},scopes:{backend:'freeze'},expiresAt:hours(2),operator:OPERATOR,reason:REASON};
 for(const bad of [{...base,scopes:{}},{...base,scopes:{backend:'stop'}},{...base,scopes:{ai:'freeze'}},{...base,scopes:{backend:100}},{...base,scopes:{backend:501}},{...base,scopes:{backend:-1}},{...base,subject:{kind:'account',id:x},scopes:{backend:5}},
  {...base,expiresAt:'tomorrow'},{...base,expiresAt:'2026-01-01T00:00:00Z'},{...base,operator:'has space'},{...base,reason:' '},{...base,reason:'x'.repeat(501)},{...base,extra:1},{...base,subject:{kind:'site',id:xb.project}},{action:'delete',id:id()}])
  assert.throws(()=>containmentInput(JSON.stringify(bad)),/Invalid operator containment request/,JSON.stringify(bad).slice(0,80));
 assert.equal(containmentDigest(containmentInput(JSON.stringify({...base,scopes:{photo:5,backend:'freeze'}}))),containmentDigest(containmentInput(JSON.stringify({...base,scopes:{backend:'freeze',photo:5}}))),'Digest is independent of key order');
 await assert.rejects(runContainment(db,{...base,expiresAt:hours(-1)}),/Expiry/);await assert.rejects(runContainment(db,{...base,expiresAt:hours(24*31)}),/Expiry/);
 await assert.rejects(runContainment(db,{...base,subject:{kind:'project',id:id()}}),/Subject not found/);

 // Preview writes nothing; apply requires the exact preview digest.
 const before=await snapshot();
 const preview=await runContainment(db,base);assert.equal(preview.preview,true);assert.equal(await containments(),0);
 assert.equal(preview.usage.projects[0].backend.used,1);assert.equal(preview.usage.projects[0].backend.allowance,100);assert.deepEqual(preview.effects.backend,{effect:'freeze',normal:100,unit:'public backend calls per project per UTC day'});
 await assert.rejects(runContainment(db,base,'0'.repeat(64)),/Preview this exact request/);
 await assert.rejects(runContainment(db,{...base,reason:'Different reason'},preview.applyDigest),/Preview this exact request/);
 await assert.rejects(runContainment(db,{action:'status',subject:base.subject},preview.applyDigest),/Preview this exact request/,'Reads have no digest');
 assert.equal(await containments(),0,'Digest mismatches write nothing');
 const applied=await runContainment(db,base,preview.applyDigest);assert.equal(applied.applied,true);assert.equal(applied.containments.length,1);
 assert.deepEqual({...applied.containments[0],createdAt:undefined},{id:base.id,scope:'backend',subject:base.subject,effect:'freeze',operator:OPERATOR,reason:REASON,createdAt:undefined,expiresAt:base.expiresAt,state:'active'});
 assert.equal((await runContainment(db,base,preview.applyDigest)).replayed,true,'Exact replay is idempotent');
 await assert.rejects(runContainment(db,{...base,scopes:{photo:'freeze'}}),/already used/,'An action ID cannot be reused for a different request');

 // Project freeze at the backend admission trigger: identical generic response to an exhausted allowance; other tenants unaffected.
 const frozen=await callBackend(xb);assert.equal(frozen.status,429);const frozenBody=await frozen.text();assert.deepEqual(JSON.parse(frozenBody),{ok:false,error:'allowance_or_publication_unavailable'});assert.deepEqual(disclosed(frozenBody),[]);
 assert.equal((await callBackend(yb)).status,200,'Another tenant keeps its allowance');
 const usedX=(await db.prepare('SELECT calls FROM backend_public_usage WHERE project_id=?').bind(xb.project).first()).calls;assert.equal(usedX,1,'Refusals are not charged');
 // Lowered allowance: y's backend may make one more call today, then gets the same response as the frozen project.
 const lower={action:'contain',id:id(),subject:{kind:'project',id:yb.project},scopes:{backend:2},expiresAt:hours(1),operator:OPERATOR,reason:REASON};
 await runContainment(db,lower,(await runContainment(db,lower)).applyDigest);
 assert.equal((await callBackend(yb)).status,429,'y already used 2 of a lowered allowance of 2');
 const exhaustedBody=await (await callBackend(yb)).text();assert.equal(exhaustedBody,frozenBody,'Frozen and exhausted projects are indistinguishable to customers');
 // The freeze cannot be bypassed by writing the counter directly.
 await assert.rejects(db.prepare("INSERT INTO backend_public_usage(project_id,day,calls,publication_id) VALUES(?,strftime('%Y-%m-%d','now'),1,(SELECT review_id FROM backend_publications WHERE project_id=?)) ON CONFLICT(project_id) DO UPDATE SET calls=calls+1").bind(xb.project,xb.project).run(),/backend_public_quota/);

 // Account freeze covers every project the account owns, at each remaining admission trigger.
 const account={action:'contain',id:id(),subject:{kind:'account',id:x},scopes:{transition:'freeze',contact:'freeze',photo:'freeze'},expiresAt:hours(3),operator:OPERATOR,reason:REASON};
 const accountPreview=await runContainment(db,account);assert.deepEqual(accountPreview.subject.projects.sort(),[xb.project,xa.project,xs.project].sort());
 assert.equal((await runContainment(db,account,accountPreview.applyDigest)).containments.length,3);
 const t=await transition(xa);assert.equal(t.status,409);assert.equal(t.message,'Application changed or execution allowance reached');assert.deepEqual(disclosed(t.message),[]);
 assert.equal((await transition(ya)).state,'complete');
 const c=await postContact(xs);assert.equal(c.status,429);const contactText=await c.text();assert.match(contactText,/This inbox is temporarily full/);assert.deepEqual(disclosed(contactText),[]);
 assert.equal((await postContact(ys)).status,200);
 const p=await photo(xs);assert.deepEqual(p,{ok:false,status:503,message:'This site’s monthly photo allowance has been reached. Please try again after the monthly reset.'});
 assert.equal((await photo(ys)).ok,true);
 // Direct counter writes are refused too.
 await assert.rejects(saveContact(db,xs.project,xs.revision,{id:id(),name:'V',email:'v@example.com',message:'direct'}),e=>e.status===429);
 await assert.rejects(db.prepare("INSERT INTO storage_project_usage(project_id,period,read_ops) VALUES(?,strftime('%Y-%m','now'),1) ON CONFLICT(project_id,period) DO UPDATE SET read_ops=read_ops+1").bind(xs.project).run(),/storage_project_quota/);
 // Owner workspace actions are untouched: the contained owner can still run an owner backend test.
 assert.equal((await testBackend(scope(x),service,x,xb.project,(await db.prepare('SELECT version_id FROM backend_publications WHERE project_id=?').bind(xb.project).first()).version_id,id(),1)).state,'complete');

 // Raised temporary allowance (project only): contact hourly 20 -> 25; platform/account/fair-share ceilings unchanged.
 const raise={action:'contain',id:id(),subject:{kind:'project',id:ys.project},scopes:{contact:25,photo:10002},expiresAt:hours(1),operator:OPERATOR,reason:REASON};
 await runContainment(db,raise,(await runContainment(db,raise)).applyDigest);
 const hourly=async()=>(await db.prepare("SELECT count(*) n FROM contact_receipts WHERE project_id=? AND created_at>strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 hour')").bind(ys.project).first()).n;
 while(await hourly()<25)await saveContact(db,ys.project,ys.revision,{id:id(),name:'V',email:'v@example.com',message:'raised'});
 await assert.rejects(saveContact(db,ys.project,ys.revision,{id:id(),name:'V',email:'v@example.com',message:'over'}),e=>e.status===429);
 // Photo budget raised above the normal 10,000 (seeded via the fixture-only trigger drop used by public-fairness).
 const trigger=(await db.prepare("SELECT sql FROM sqlite_master WHERE name='storage_project_usage_update'").first()).sql;
 await db.prepare('DROP TRIGGER storage_project_usage_update').run();await db.prepare('UPDATE storage_project_usage SET read_ops=10000 WHERE project_id=?').bind(ys.project).run();await db.prepare(trigger).run();
 assert.equal((await photo(ys)).ok,true);assert.equal((await photo(ys)).ok,true);assert.equal((await photo(ys)).ok,false,'Raised allowance is still a ceiling');
 // A later action supersedes an earlier allowance for the same project and scope (latest wins; any freeze wins over all).
 const later={action:'contain',id:id(),subject:{kind:'project',id:ys.project},scopes:{photo:50000},expiresAt:hours(1),operator:OPERATOR,reason:REASON};
 await runContainment(db,later,(await runContainment(db,later)).applyDigest);assert.equal((await photo(ys)).ok,true);
 const status=await runContainment(db,{action:'status',subject:{kind:'project',id:ys.project}});
 assert.equal(status.usage.projects[0].photo.allowance,50000);assert.equal(status.usage.projects[0].contact.allowance,25);assert.equal(status.containments.length,3);
 // Schema rejects allowances above the maximum, allowances on accounts, long or past expiry and missing subjects.
 const row=(o={})=>db.prepare("INSERT INTO operator_containments(id,scope,subject_kind,subject_id,allowance,operator_ref,reason,request_digest,expires_at) VALUES(?,?,?,?,?,?,?,?,?)").bind(o.id??id(),o.scope??'backend',o.kind??'project',o.subject??xb.project,o.allowance??null,'human:test','reason','f'.repeat(64),o.expires??hours(1)).run();
 await assert.rejects(row({allowance:501}),/CHECK/);await assert.rejects(row({kind:'account',subject:x,allowance:5}),/CHECK/);
 await assert.rejects(row({expires:hours(24*31)}),/operator_containment_invalid/);await assert.rejects(row({expires:hours(-1)}),/operator_containment_invalid/);await assert.rejects(row({subject:id()}),/operator_containment_invalid/);
 await assert.rejects(row({id:base.id,scope:'photo'}),/operator_containment_invalid/,'A second scope cannot be attached to an existing action with another digest');

 // Audit rows are immutable and never deleted; customer data is unchanged by every action.
 await assert.rejects(db.prepare("UPDATE operator_containments SET reason='edited' WHERE id=?").bind(base.id).run(),/operator_containment_immutable/);
 await assert.rejects(db.prepare("UPDATE operator_containments SET expires_at=? WHERE id=?").bind(hours(5),base.id).run(),/operator_containment_immutable/);
 await assert.rejects(db.prepare('DELETE FROM operator_containments WHERE id=?').bind(base.id).run(),/operator_containment_immutable/);

 // Lift: preview, exact digest, immediate restoration, idempotent replay, single lift only.
 const lift={action:'lift',id:base.id,operator:'human:second-operator',reason:'Traffic reviewed as legitimate'};
 const liftPreview=await runContainment(db,lift);assert.equal(liftPreview.preview,true);assert.equal((await callBackend(xb)).status,429,'Preview does not lift');
 await assert.rejects(runContainment(db,{...lift,reason:'Other'},liftPreview.applyDigest),/Preview this exact request/);
 const lifted=await runContainment(db,lift,liftPreview.applyDigest);assert.equal(lifted.containments[0].state,'lifted');assert.equal(lifted.containments[0].resolvedBy,'human:second-operator');
 assert.equal((await callBackend(xb)).status,200,'Lifted project admits again');
 assert.equal((await runContainment(db,lift,liftPreview.applyDigest)).replayed,true);
 await assert.rejects(runContainment(db,{...lift,reason:'Again'}),/already resolved/);
 await assert.rejects(db.prepare("UPDATE operator_containments SET resolution='lifted',resolved_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),resolved_by='human:x',resolution_reason='x',resolution_digest=? WHERE id=?").bind('e'.repeat(64),base.id).run(),/operator_containment_immutable/);

 // Expiry: the account freeze stops applying at expires_at without any write by the operator.
 await expire(account.id);
 assert.equal((await transition(xa)).state,'complete');assert.equal((await postContact(xs)).status,200);assert.equal((await photo(xs)).ok,true);
 const history=await runContainment(db,{action:'status',subject:{kind:'account',id:x}});
 assert.deepEqual(history.containments.filter(r=>r.id===account.id).map(r=>r.state),['expired','expired','expired']);
 assert.ok(history.containments.every(r=>r.operator&&r.reason),'Every action keeps its operator reference and reason');
 assert.deepEqual(history.containments.filter(r=>r.id===base.id).map(r=>r.state),['lifted'],'Account status includes its projects\' actions');assert.equal(history.containments.length,4);
 const projectHistory=await runContainment(db,{action:'status',subject:{kind:'project',id:xb.project}});
 assert.deepEqual(projectHistory.containments.map(r=>r.state).sort(),['expired','expired','expired','lifted']);

 // Cross-project isolation: y's own containments never touched x, and nothing customer-owned changed.
 assert.equal(projectHistory.containments.some(r=>r.subject.id===yb.project||r.subject.id===ys.project||r.subject.id===y),false);
 const after=await snapshot();for(const table of customerTables)if(!['contact_submissions'].includes(table))assert.equal(after[table],before[table],table);
 assert.ok(after.contact_submissions>=before.contact_submissions,'Containment never removes stored messages');
 assert.equal(await containments(),8,'1 project freeze + 1 lowered + 3 account scopes + 2 raised + 1 superseding');

 // ---- Owner decision October 8, 2026: explicit resolution. Expiry is not resolution; a reviewed close records it.
 const closeAccount={action:'close',id:account.id,operator:'human:second-operator',reason:'Expired account freeze reviewed'};
 await assert.rejects(runContainment(db,{...closeAccount,action:'lift'}),/already expired; record a reviewed close/);
 await assert.rejects(runContainment(db,{action:'close',id:lower.id,operator:OPERATOR,reason:REASON}),/still active; lift it/);
 const closePreview=await runContainment(db,closeAccount);assert.equal(closePreview.preview,true);
 const closed=await runContainment(db,closeAccount,closePreview.applyDigest);assert.deepEqual(closed.containments.map(r=>r.state),['closed','closed','closed']);
 assert.equal((await runContainment(db,closeAccount,closePreview.applyDigest)).replayed,true);
 assert.ok(closed.containments.every(r=>Date.parse(r.retainedUntil)-Date.parse(r.resolvedAt)===retentionMs));
 // The schema refuses a resolution that contradicts expiry: 'lifted' after expiry, 'closed' while active.
 await assert.rejects(db.prepare("UPDATE operator_containments SET resolution='closed',resolved_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),resolved_by='human:x',resolution_reason='x',resolution_digest=? WHERE id=?").bind('e'.repeat(64),lower.id).run(),/operator_containment_immutable/);

 // ---- Owner decision October 8, 2026: separate project serving stop with exact review and audit receipt.
 const assets={fetch:async()=>new Response('<!doctype html><title>visitor</title>',{headers:{'content-type':'text/html'}})};
 const appEnv={DB:db,ENVIRONMENT:'local',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})},BACKEND_RUNTIME:service,ASSETS:assets};
 const sitePage=(a,path='/')=>m.host.fetch(new Request(`https://${a.project}.whumpo.site${path}`),{DB:db});
 const contactForm=a=>contactPage(new Request('https://whumpo.com/contact/'+a.project),contactEnv,a.project);
 const appPage=a=>m.appHost.fetch(new Request(`http://localhost:8787/apps/${a.project}/`),appEnv);
 const app=(a,path,init={})=>m.appGateway.applicationGateway(new Request(`http://localhost:8787/apps/${a.project}/${path}`,{...init,headers:{origin:'http://localhost:8787',cookie:`local-whumpo-app-session-${a.project}=${a.visitor?.session??''}`,...(init.body?{'content-type':'application/json'}:{}),...init.headers}}),appEnv);
 const publishBackend=async a=>{const v=id(),r=id(),rid=id();await saveBackend(scope(a.user),a.user,a.project,v,'export default x=>x');await testBackend(scope(a.user),service,a.user,a.project,v,r,1);await prepare(scope(a.user),a.user,a.project,rid,'publish',v,r);await confirm(scope(a.user),a.user,rid);};
 const stop=a=>({action:'stop-serving',id:id(),project:a.project,expiresAt:hours(2),operator:OPERATOR,reason:REASON});
 for(const a of [xa,ya]){const pageId=id();await m.appPages.prepareAppPage(scope(a.user),a.user,a.project,pageId,{title:'Journal',description:'Test',buttonLabel:'Save',fields:[{key:'note',label:'Note',type:'text'}]});await m.appPages.confirmAppPage(scope(a.user),a.user,pageId);}
 // Everything serves before the stop.
 assert.equal((await sitePage(xs)).status,200);assert.equal((await contactForm(xs)).status,200);assert.equal((await appPage(xa)).status,200);
 assert.equal((await app(xa,'config')).status,200);assert.equal((await callBackend(xb)).status,200);
 // Serving is its own action: never through `contain`, never for an account, never combined with another scope.
 for(const bad of [{...base,id:id(),scopes:{serving:'freeze'}},{...stop(xs),project:'not-a-uuid'},{...stop(xs),subject:{kind:'account',id:x}},{...stop(xs),scopes:{backend:'freeze'}}])
  assert.throws(()=>containmentInput(JSON.stringify(bad)),/Invalid operator containment request/);
 await assert.rejects(row({kind:'account',subject:x,scope:'serving'}),/CHECK/);await assert.rejects(row({scope:'serving',allowance:1}),/CHECK/);
 const mixed=id();await row({id:mixed,scope:'backend',subject:xs.project});await assert.rejects(row({id:mixed,scope:'serving',subject:xs.project}),/operator_containment_invalid/,'A serving stop cannot share an action with another scope');
 await rewrite('operator_containment_retained','DELETE FROM operator_containments WHERE id=?',mixed);
 // The review binds the exact project state: a publication change after preview makes the digest stale (JS recheck)...
 const staleStop=stop(xb),stalePreview=await runContainment(db,staleStop);assert.equal(await containments(),8);
 assert.deepEqual(Object.keys(stalePreview.state.revisions),['site','backend','app']);
 await publishBackend(xb);
 await assert.rejects(runContainment(db,staleStop,stalePreview.applyDigest),/Review is stale/);
 // ...and a change racing the apply is refused by the same statement that would insert the stop.
 const racePreview=await runContainment(db,staleStop);
 const racing=interceptDatabase(db,/INSERT INTO operator_containments[\s\S]*'serving'/,()=>publishBackend(xb));
 await assert.rejects(runContainment(racing,staleStop,racePreview.applyDigest),/Review is stale; the project changed/);
 assert.equal(await containments(),8,'Stale reviews write nothing');
 const before2=await snapshot(),publication=async a=>JSON.stringify(await db.prepare('SELECT (SELECT revision||version_id FROM publications WHERE project_id=?1) s,(SELECT revision||review_id FROM backend_publications WHERE project_id=?1) b,(SELECT revision||enabled||version_id FROM app_spaces WHERE project_id=?1) a').bind(a.project).first());
 const published=Object.fromEntries(await Promise.all([xs,xa,xb].map(async a=>[a.project,await publication(a)])));
 const stops={};
 for(const a of [xs,xa,xb]){const s=stop(a),p=await runContainment(db,s);assert.equal(p.preview,true);await assert.rejects(runContainment(db,s,containmentDigest(s)),/stale or differs/,'The input-only digest is not a review');
  const applied=await runContainment(db,s,p.applyDigest);assert.deepEqual(applied.containments.map(r=>[r.scope,r.effect,r.state]),[['serving','stop','active']]);stops[a.project]={s,digest:p.applyDigest};
  assert.equal((await runContainment(db,s,p.applyDigest)).replayed,true,'Exact replay is idempotent');assert.equal((await runContainment(db,s)).alreadyApplied,true);
  await assert.rejects(runContainment(db,{...s,reason:'Other'}),/already used/);}
 // One active stop per project.
 await assert.rejects(runContainment(db,stop(xs)),/already stopped/);await assert.rejects(row({scope:'serving',subject:xs.project}),/operator_containment_invalid/);
 // Site host: pages, assets, CMS listing and directory answer like an outage; no stop, operator or reason is disclosed.
 for(const path of ['/','/assets/'+id()+'.jpg','/cms','/directory','/directory.json']){const r=await sitePage(xs,path);assert.equal(r.status,503,path);const text=await r.text();assert.equal(text,'Site temporarily unavailable');assert.deepEqual(disclosed(text),[]);}
 const contactStopped=await contactForm(xs);assert.equal(contactStopped.status,404);assert.match(await contactStopped.text(),/This contact form is unavailable/);
 assert.equal((await postContact(xs)).status,404);
 await assert.rejects(saveContact(db,xs.project,xs.revision,{id:id(),name:'V',email:'v@example.com',message:'direct'}),e=>e.status===429,'Direct intake is refused in SQL');
 assert.deepEqual(await photo(xs),{ok:false,status:503,message:'This site’s monthly photo allowance has been reached. Please try again after the monthly reset.'});
 // Public backend: refused by the admission trigger with the generic body.
 const stoppedBackend=await callBackend(xb);assert.equal(stoppedBackend.status,429);assert.equal(await stoppedBackend.text(),frozenBody);
 // Visitor application: page, configuration, execution, modules and new signups are refused like an application without a live page.
 assert.equal((await appPage(xa)).status,404);
 for(const [path,init] of [['config'],['data'],['data',{method:'POST',body:'{}'}],['modules',{method:'POST',body:'{}'}],['auth/signup/options',{method:'POST',body:'{}'}]]){const r=await app(xa,path,init);assert.equal(r.status,404,path);assert.deepEqual(await r.json(),{error:'Application page unavailable'});}
 assert.equal((await transition(xa)).status,409);
 // Existing visitors keep their own data: export and the deletion review still work; data is untouched.
 const exported=await app(xa,'export');assert.equal(exported.status,200,await exported.clone().text());
 assert.equal((await app(xa,'account/deletion-review',{method:'POST',body:'{}'})).status,200);
 // Other tenants keep serving; the owner workspace is unchanged (owner backend test, owner contact inbox).
 assert.equal((await sitePage(ys)).status,200);assert.equal((await contactForm(ys)).status,200);assert.equal((await appPage(ya)).status,200);assert.equal((await app(ya,'config')).status,200);
 assert.equal((await runContainment(db,{action:'status',subject:{kind:'account',id:y}})).usage.projects.some(p=>p.serving.stopped),false,'No other tenant project is stopped');
 assert.equal((await testBackend(scope(x),service,x,xb.project,(await db.prepare('SELECT version_id FROM backend_publications WHERE project_id=?').bind(xb.project).first()).version_id,id(),1)).state,'complete');
 const inbox=await m.contacts.contactInbox(scope(x),x,xs.project);assert.equal(inbox.project.id,xs.project);assert.ok(inbox.messages.length>0,'The owner still reads stored messages');
 // Nothing was unpublished, edited or deleted.
 for(const a of [xs,xa,xb])assert.equal(await publication(a),published[a.project],'Publications are unchanged');
 const after2=await snapshot();for(const table of customerTables)assert.equal(after2[table],before2[table],table);
 // Lift restores the same publications immediately.
 const liftSite={action:'lift',id:stops[xs.project].s.id,operator:'human:second-operator',reason:'Reviewed'};
 await runContainment(db,liftSite,(await runContainment(db,liftSite)).applyDigest);
 assert.equal((await sitePage(xs)).status,200);assert.equal((await contactForm(xs)).status,200);assert.equal((await photo(xs)).ok,true);
 // An expired stop stops applying, but stays unresolved and retained until a reviewed close.
 await expire(stops[xa.project].s.id);assert.equal((await appPage(xa)).status,200);assert.equal((await app(xa,'config')).status,200);
 assert.equal((await runContainment(db,{action:'status',subject:{kind:'project',id:xa.project}})).containments.find(r=>r.id===stops[xa.project].s.id).state,'expired');
 await assert.rejects(db.prepare('DELETE FROM operator_containments WHERE id=?').bind(stops[xa.project].s.id).run(),/operator_containment_immutable/,'Expired but unresolved is never deletable');
 assert.equal((await runContainment(db,{action:'status',subject:{kind:'project',id:xb.project}})).usage.projects[0].serving.stopped,true);

 // ---- Owner decision October 8, 2026: resolved records are retained 90 days after resolution; then reviewed cleanup.
 const N=Date.now(),cutoff=new Date(N-retentionMs).toISOString(),at=ms=>new Date(ms).toISOString();
 // Fixture-only backdating of one resolved action: creation, expiry and resolution stay consistent with real history.
 const oldAction=async(a,resolvedMs,resolution='lifted')=>{const c={action:'contain',id:id(),subject:{kind:'project',id:a.project},scopes:{photo:'freeze'},expiresAt:hours(1),operator:OPERATOR,reason:REASON};await runContainment(db,c,(await runContainment(db,c)).applyDigest);
  await rewrite('operator_containment_resolve',"UPDATE operator_containments SET created_at=?,expires_at=?,resolution=?,resolved_at=?,resolved_by='human:old',resolution_reason='old',resolution_digest=? WHERE id=?",at(resolvedMs-3600000),at(resolution==='lifted'?resolvedMs+3600000:resolvedMs-60000),resolution,at(resolvedMs),'d'.repeat(64),c.id);return c;};
 const z=await user(),pB1=await project(z),pB2=await project(z),pH=await project(y),pE=await project(z);
 const b1=await oldAction(pB1,Date.parse(cutoff)),b2=await oldAction(pB2,Date.parse(cutoff)+1),held=await oldAction(pH,N-200*86400000,'closed');
 const e=stop(pE);await runContainment(db,e,(await runContainment(db,e)).applyDigest);
 await rewrite('operator_containment_resolve','UPDATE operator_containments SET created_at=?,expires_at=? WHERE id=?',at(N-200*86400000),at(N-171*86400000),e.id);
 const hold=async(subjectUser,projectId,holdId)=>{await db.prepare("INSERT OR IGNORE INTO safety_cases(id,subject_user_id,intake_ref,opened_by,opened_at,retention_due_at) VALUES(?,?,'intake-1','human:reviewer',unixepoch(),unixepoch()+31536000)").bind('case-'+holdId,subjectUser).run();
  await db.prepare("INSERT INTO safety_preservation_holds(id,case_id,subject_user_id,scope,project_id,legal_basis_ref,approved_by,placed_at,review_due_at) VALUES(?,?,?,'project',?,'basis-1','human:approver',unixepoch(),unixepoch()+86400)").bind(holdId,'case-'+holdId,subjectUser,projectId).run();};
 const release=holdId=>db.prepare("UPDATE safety_preservation_holds SET released_at=unixepoch(),released_by='human:approver',release_ref='release-1' WHERE id=?").bind(holdId).run();
 await hold(y,pH.project,'hold-wh050-h');
 // Trigger boundary against the database clock: 60 seconds inside retention, held and unresolved rows refuse; 1 second past deletes.
 const inside=await oldAction(pB2,Date.now()-retentionMs+60000),outside=await oldAction(pB2,Date.now()-retentionMs-1000);
 for(const r of [inside,held,e])await assert.rejects(db.prepare('DELETE FROM operator_containments WHERE id=?').bind(r.id).run(),/operator_containment_immutable/);
 assert.equal((await db.prepare('DELETE FROM operator_containments WHERE id=?').bind(outside.id).run()).meta.changes,1);
 // Precise tool boundary at an injected instant: resolved exactly at the cutoff is eligible; 1 ms later is not.
 const cleanup={action:'cleanup',id:id(),before:cutoff,operator:OPERATOR};
 await assert.rejects(runContainment(db,{...cleanup,before:at(Date.parse(cutoff)+1)},undefined,N),/at least 90 days/);
 const cp=await runContainment(db,cleanup,undefined,N);
 assert.deepEqual(cp.delete,{containments:1,revocations:0,receipts:0});assert.ok(cp.retained.expiredAwaitingClose>=2&&cp.retained.heldBySafety===1&&cp.retained.active>=1,JSON.stringify(cp.retained));
 // A hold placed while the cleanup applies aborts the whole statement: nothing deleted, no receipt.
 const race=interceptDatabase(db,/INSERT INTO operator_retention_receipts/,()=>hold(z,pB1.project,'hold-wh050-race'));
 await assert.rejects(runContainment(race,cleanup,cp.applyDigest,N),/Cleanup refused/);
 assert.equal((await db.prepare('SELECT count(*) n FROM operator_containments WHERE id=?').bind(b1.id).first()).n,1);assert.equal((await db.prepare('SELECT count(*) n FROM operator_retention_receipts').first()).n,0);
 await assert.rejects(runContainment(db,cleanup,cp.applyDigest,N),/Nothing is eligible/,'The held record leaves the reviewed set');
 await release('hold-wh050-race');
 const cleaned=await runContainment(db,cleanup,cp.applyDigest,N);assert.deepEqual(cleaned.receipt.deleted,{containments:1,revocations:0,receipts:0});
 assert.equal((await db.prepare('SELECT count(*) n FROM operator_containments WHERE id=?').bind(b1.id).first()).n,0);
 for(const r of [b2,held,e,inside])assert.equal((await db.prepare('SELECT count(*) n FROM operator_containments WHERE id=?').bind(r.id).first()).n>0,true,'Within retention, held and unresolved records stay');
 assert.equal((await runContainment(db,cleanup,cp.applyDigest,N)).replayed,true,'Exact replay returns the receipt');
 await assert.rejects(runContainment(db,{...cleanup,before:at(Date.parse(cutoff)-1)},undefined,N),/already used/);
 await assert.rejects(db.prepare("UPDATE operator_retention_receipts SET operator_ref='human:x' WHERE id=?").bind(cleanup.id).run(),/operator_retention_immutable/);
 await assert.rejects(db.prepare('DELETE FROM operator_retention_receipts WHERE id=?').bind(cleanup.id).run(),/operator_retention_immutable/);
 await assert.rejects(db.prepare("INSERT INTO operator_retention_receipts(id,cutoff,containments,revocations,receipts,operator_ref,request_digest,review_digest) VALUES(?,strftime('%Y-%m-%dT%H:%M:%fZ','now','-90 days','+60 seconds'),?,'[]','[]','human:x',?,?)").bind(id(),JSON.stringify([b2.id+':photo']),'a'.repeat(64),'b'.repeat(64)).run(),/operator_retention_invalid/,'A cutoff under 90 days is refused by the schema');
 await assert.rejects(db.prepare("INSERT INTO operator_retention_receipts(id,cutoff,containments,revocations,receipts,operator_ref,request_digest,review_digest) VALUES(?,?,?,'[]','[]','human:x',?,?)").bind(id(),cutoff,JSON.stringify([inside.id+':photo']),'a'.repeat(64),'b'.repeat(64)).run(),/operator_retention_stale/,'A record resolved after the cutoff cannot be listed');
 await assert.rejects(db.prepare("INSERT INTO operator_retention_receipts(id,cutoff,containments,revocations,receipts,operator_ref,request_digest,review_digest) VALUES(?,?,?,'[]','[]','human:x',?,?)").bind(id(),cutoff,JSON.stringify([held.id+':photo']),'a'.repeat(64),'b'.repeat(64)).run(),/operator_containment_immutable/,'A held record cannot be deleted even when listed');
 // Replay of the deleted action cannot revive it: its expiry is necessarily past (expiry <= creation + 30 days < resolution + 90 days).
 await assert.rejects(runContainment(db,{...b1,expiresAt:at(Date.parse(cutoff)+3600000)}),/Expiry must be in the future/);
 await assert.rejects(row({id:b1.id,scope:'photo',subject:pB1.project,expires:at(Date.parse(cutoff)+3600000)}),/operator_containment_invalid/);
 // A later cleanup sees 1 ms more history; a hold placed after its preview removes the record from cleanup.
 const later2={action:'cleanup',id:id(),before:at(Date.parse(cutoff)+1),operator:OPERATOR},lp=await runContainment(db,later2,undefined,N+1000);
 assert.deepEqual(lp.delete,{containments:1,revocations:0,receipts:0});
 await hold(z,pB2.project,'hold-wh050-b2');await assert.rejects(runContainment(db,later2,lp.applyDigest,N+1000),/Nothing is eligible/);
 assert.equal((await db.prepare('SELECT count(*) n FROM operator_containments WHERE id=?').bind(b2.id).first()).n,1);
 // A closed expired serving stop becomes eligible only 90 days after its close.
 const closeE={action:'close',id:e.id,operator:OPERATOR,reason:'Expired serving stop reviewed'};await runContainment(db,closeE,(await runContainment(db,closeE)).applyDigest);
 assert.equal((await runContainment(db,{action:'cleanup',id:id(),before:cutoff,operator:OPERATOR},undefined,N)).delete.containments,0);
 console.log(`Operator containment passed on ${process.argv.includes('--d1')?'actual local D1':'SQLite'}: input validation, preview/apply digest mismatch, idempotent replay, project and account freeze at backend/transition/contact/photo admission triggers, lowered/raised/superseding allowances, generic customer responses with no disclosure, trigger-level bypass refusal, immutable audit with operator and reason, lift, expiry, explicit close, separate serving stop (site/asset/CMS/directory/contact/photo/backend/app/module/signup refused, visitor export and deletion kept, exact state review with stale and racing refusal, one active stop, lift and expiry), 90-day retention cleanup (exact cutoff boundary, unresolved/held/within-retention kept, racing hold atomicity, replay and no revival), cross-project isolation and unchanged customer data and publications.`);
}finally{await store.close();}
