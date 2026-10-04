// WH-050 F7 / runbook G3: operator containment of one account or project's public allowances.
// Runs on disposable SQLite by default and on actual local D1 with --d1. No network, provider or deployed resource.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {currentSiteFixtureHandlers,createFixtureWebsite,enableFixtureVisitorAccess} from './current-site-fixture.mjs';
import {authenticator} from './app-authenticator.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {runContainment,containmentInput,containmentDigest} from '../tools/operator-containment-input.mjs';
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
// Fixture-only clock move: the lift trigger forbids changing expiry, so drop and restore it around the write.
async function expire(actionId){const trigger=(await db.prepare("SELECT sql FROM sqlite_master WHERE name='operator_containment_lift'").first()).sql;await db.prepare('DROP TRIGGER operator_containment_lift').run();await db.prepare("UPDATE operator_containments SET expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 second') WHERE id=?").bind(actionId).run();await db.prepare(trigger).run();}
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
 const lifted=await runContainment(db,lift,liftPreview.applyDigest);assert.equal(lifted.containments[0].state,'lifted');assert.equal(lifted.containments[0].liftedBy,'human:second-operator');
 assert.equal((await callBackend(xb)).status,200,'Lifted project admits again');
 assert.equal((await runContainment(db,lift,liftPreview.applyDigest)).replayed,true);
 await assert.rejects(runContainment(db,{...lift,reason:'Again'}),/already lifted/);
 await assert.rejects(db.prepare("UPDATE operator_containments SET lifted_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),lift_operator_ref='human:x',lift_reason='x',lift_digest=? WHERE id=?").bind('e'.repeat(64),base.id).run(),/operator_containment_immutable/);

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
 console.log(`Operator containment passed on ${process.argv.includes('--d1')?'actual local D1':'SQLite'}: input validation, preview/apply digest mismatch, idempotent replay, project and account freeze at backend/transition/contact/photo admission triggers, lowered/raised/superseding allowances, generic customer responses with no disclosure, trigger-level bypass refusal, immutable audit with operator and reason, lift, expiry, cross-project isolation and unchanged customer data.`);
}finally{await store.close();}
