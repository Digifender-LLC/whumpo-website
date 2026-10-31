import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {unzipSync,strFromU8} from 'fflate';
import {currentSiteFixtureHandlers,createFixtureProject,configureFixtureModules} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';
import {initializeFixtureKeys,fixtureKeyring,fixtureCiphertext} from './helpers/connection-keyring.mjs';
import {accountClosureInventory} from '../tools/account-closure-inventory.mjs';
import {maintenanceReport} from '../tools/report-maintenance.mjs';
Error.stackTraceLimit=0;
// WH-018 reviewed account export and resumable account closure through the actual platform Worker routes, against the
// complete current schema in disposable SQLite, or local D1 with --d1. Every identity, photo, token and record is
// synthetic. No provider, model or network is used; private object storage is an in-memory stand-in.
const logs=[],consoleMethods=['log','info','warn','error','debug'],originals=Object.fromEntries(consoleMethods.map(k=>[k,console[k]]));
for(const k of consoleMethods)console[k]=(...args)=>{logs.push(args.map(String).join(' '));};
const say=text=>process.stdout.write(text+'\n');
const m=await currentSiteFixtureHandlers(),fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID();
const originalFetch=globalThis.fetch;let network=0;
// The only outside call the closure may make is GitHub token revocation, answered by this stand-in (503 until a test flips it to 204).
const provider={github:503,calls:[]};
globalThis.fetch=async(url,init)=>{const u=String(url);if(u.startsWith('https://api.github.com/applications/closure-client/')&&init?.method==='DELETE'){provider.calls.push(u);return new Response(null,{status:provider.github});}network++;throw Error('No network is allowed');};
const ghConfig={clientId:'closure-client',clientSecret:'synthetic-secret',appId:123,slug:'fixture',key:fixtureKeyring()};
const objects=new Map(),FILES={
 get:async key=>{const bytes=objects.get(key);return bytes?{size:bytes.length,arrayBuffer:async()=>bytes.slice().buffer,body:{cancel:async()=>{}}}:null;},
 head:async key=>objects.has(key)?{size:objects.get(key).length}:null,put:async()=>assert.fail('No upload in this suite'),delete:async key=>{objects.delete(key);},list:async()=>({objects:[],truncated:false}),
};
let failNext=null,failAccount=null;const batchHooks=[];const intercepted=interceptDatabase(db,/./,async()=>{},async()=>{});
// Interruption hook: throw once on the next statement/batch whose SQL matches the armed pattern (a lost worker or response).
// failAccount makes every statement bound to that account fail (one broken closure among several in a maintenance pass).
const armedDB={prepare:q=>{const s=intercepted.prepare(q);
 const wrap=(st,v=[])=>{const guard=fn=>async(...a)=>{if(failNext&&failNext.test(q)){failNext=null;throw Error('synthetic interruption');}if(failAccount&&v.includes(failAccount))throw Error('synthetic closure failure');return fn(...a);};
  return {bind:(...n)=>wrap(st.bind(...n),n),first:guard(st.first),all:guard(st.all),run:guard(st.run),__q:q,__s:st,__v:v};};
 return wrap(s);},
 batch:async list=>{const hook=batchHooks.findIndex(h=>list.some(q=>h.re.test(q.__q)));if(hook>=0){const [h]=batchHooks.splice(hook,1);await h.fn();}if(failNext&&list.some(s=>failNext.test(s.__q))){failNext=null;throw Error('synthetic interruption');}if(failAccount&&list.some(s=>s.__v.includes(failAccount)))throw Error('synthetic closure failure');return intercepted.batch(list.map(s=>s.__s));}};
const env={DB:armedDB,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},FILES,GITHUB_CLIENT_ID:ghConfig.clientId,GITHUB_CLIENT_SECRET:ghConfig.clientSecret,GITHUB_APP_ID:'123',GITHUB_APP_SLUG:'fixture',CONNECTION_ENCRYPTION_KEYRING:ghConfig.key};
const row=(q,...p)=>db.prepare(q).bind(...p).first(),rows=async(q,...p)=>(await db.prepare(q).bind(...p).all()).results,run=(q,...p)=>db.prepare(q).bind(...p).run();
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(error){originals.error(name);throw error;}};
const base='https://whumpo.com';
const call=(actor,path,data,method='POST')=>m.worker.fetch(new Request(base+'/api'+path,{method,headers:{origin:base,cookie:'__Host-whumpo_session='+actor.token,...(data===undefined?{}:{'content-type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})}),env,{waitUntil:()=>{}});
const account=(actor,action,data={})=>call(actor,'/account/v1/'+action,{version:1,...data});
const ok=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
const refused=async(response,status,code)=>{const body=await response.json();assert.equal(response.status,status,JSON.stringify(body));assert.equal(body.code,code);return body;};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const pins=kind=>{const e=m.moduleCatalog.find(x=>x.kind===kind);return {module:{...e.module},schema:{...e.schema}};};
const enquiries={id:'enquiries',kind:'records',...pins('records'),dependencies:[],config:{retentionDays:90,schemas:[{id:'enquiry',fieldsRevision:1,fields:[{key:'message',label:'Message',type:'text',optional:false,read:'owner'}],staffWrite:[]}],forms:[{id:'ask',recordId:'enquiry',submit:'public',uploadCollectionId:null}],views:[]}};
const marker='ACCOUNT-PRIVATE-'+id().slice(0,8).toUpperCase();
async function owner(proofOffset=-5){
 const actor=await workspaceFixture(db,m,id(),proofOffset),scope=await actor.scope();
 const site=await createFixtureProject(scope,actor.account,'Garden studio '+marker+' '+id().slice(0,6),'Neighborhood garden care');
 return {...actor,scope,user:actor.account,...site};
}
async function photo(o,approved){
 const file=id(),bytes=new Uint8Array([0xff,0xd8,0xff,...Buffer.from(file)]),key=`photos/${o.project}/${file}.jpg`;objects.set(key,bytes);
 await run("INSERT INTO project_files(id,project_id,name,object_key,digest,size,width,height,status,created_at) VALUES(?,?,?,?,?,?,10,10,'ready',strftime('%Y-%m-%dT%H:%M:%fZ','now'))",file,o.project,'garden-'+marker+'.jpg',key,sha(bytes),bytes.length);
 if(approved)await run("UPDATE project_photo_safety SET state='approved',csam_check='clear',sexual_check='clear',scanner_reference='synthetic-clearance',expires_at=? WHERE file_id=?",new Date(Date.now()+3600000).toISOString(),file);
 return {file,bytes,key};
}
async function exportArchive(o,visitorData=false){
 const prepared=(await ok(await account(o,'export/prepare',{requestId:id(),visitorData}))).review;
 const response=await account(o,'export/download',{reviewId:prepared.id,reviewDigest:prepared.digest});
 assert.equal(response.status,200,response.status===200?'':await response.clone().text());
 assert.equal(response.headers.get('cache-control'),'private, no-store');assert.equal(response.headers.get('content-type'),'application/zip');
 const bytes=new Uint8Array(await response.arrayBuffer());
 return {prepared,bytes,files:unzipSync(bytes)};
}
async function closureReview(o){return (await ok(await account(o,'closure/prepare',{requestId:id()}))).review;}
const confirm=(o,review,extra={})=>account(o,'closure/confirm',{reviewId:review.id,reviewDigest:review.digest,confirmation:'close-account',...extra});
const steps=status=>Object.fromEntries(status.closure.steps.map(s=>[s.step,s.state]));

try{
 await initializeFixtureKeys(db);
 const a=await owner(),b=await owner();
 const approvedA=await photo(a,true),pendingA=await photo(a,false),photoB=await photo(b,true);
 for(const feature of ['core.editing','core.forms'])for(const operation of ['prepare','confirm'])
  await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,?,?,'private-test-acceptance','synthetic WH-018 fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),a.user,a.project,feature,operation);
 await configureFixtureModules(a.scope,a.user,a.project,[enquiries]);
 {const revision=async()=>(await m.readChat(a.scope,a.user)).state.revision,turn=id();
  const r=await m.sendChatControl(a.scope,a.user,{id:turn,revision:await revision(),action:{type:'moduleActivationReview',projectId:a.project,instanceId:'enquiries',action:'activate'}});assert.equal(r.status,200,r.error);
  const saved=await row('SELECT * FROM module_activation_reviews WHERE id=?',turn);
  const applied=await m.sendChatControl(a.scope,a.user,{id:id(),revision:await revision(),action:{type:'moduleActivationApply',reviewId:saved.id,reviewDigest:saved.review_digest,expectedRevision:saved.expected_activation_revision}});assert.equal(applied.status,200,applied.error);}
 const tokenSecret='gho_SYNTHETIC_'+marker,ciphertext=await fixtureCiphertext(fixtureKeyring(),`whumpo:github:token:${a.user}:token-a`,tokenSecret);
 // A real connection with refresh custody, made through the connection code (its grant must be revoked through the reviewed route before closing).
 const realAccess='ghu_SYNTHETIC_'+id().replaceAll('-','');
 await run("INSERT INTO feature_preview_grants VALUES(?,1,?,NULL,'connections.github','connect','private-test-acceptance','synthetic WH-018 fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),a.user);
 {const start=await m.githubConnection.startGitHub(a.scope,a.user,ghConfig);
  await m.githubConnection.finishGitHub(a.scope,a.user,new URL(start.url).searchParams.get('state'),'synthetic-code',ghConfig,async url=>{
   if(url.endsWith('/access_token'))return Response.json({access_token:realAccess,expires_in:3600,refresh_token:'ghr_SYNTHETIC_'+id().replaceAll('-',''),refresh_token_expires_in:15897600});
   if(url.endsWith('/user'))return Response.json({id:4242,login:'closure-fixture'});
   if(url.endsWith('/token'))return new Response(null,{status:204});
   assert.fail('Unexpected provider call');
  });}
 // Standard AI work in flight at confirmation: one request that never reached the model, and one uncertain for two days (past the 24 hour window).
 const aged=hours=>new Date(Date.now()-hours*3600000).toISOString(),turnFor=async(user,revision,state,created,updated)=>{
  const turn=id();await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,?,'synthetic','',?,'ai','pending')",turn,user,revision,created);
  await run("INSERT INTO standard_ai_requests(id,user_id,request_hash,created_at,updated_at) VALUES(?,?,?,?,?)",turn,user,id().replaceAll('-','')+id().replaceAll('-','').slice(0,32),created,created);
  if(state!=='reserved')await run("UPDATE standard_ai_requests SET state='dispatched',updated_at=? WHERE id=?",created,turn);
  if(state==='uncertain')await run("UPDATE standard_ai_requests SET state='uncertain',updated_at=? WHERE id=?",updated,turn);
  return turn;};
 let neverSent,oldUncertain;
 const publish=await run('INSERT INTO publications(project_id,revision,version_id) SELECT id,1,(SELECT version_id FROM project_spec_heads WHERE project_id=projects.id) FROM projects WHERE id=?',a.project);assert.equal(publish.meta.changes,1);

 await check('owner export: exact fresh review, composed serializers, approved media only, no secrets or other tenants',async()=>{
  const {prepared,files}=await exportArchive(a);
  assert.equal(prepared.format,'whumpo-account-export-v1');assert.equal(prepared.visitorData,false);assert.equal(prepared.projects,1);
  const manifest=JSON.parse(strFromU8(files['manifest.json']));
  assert.equal(manifest.complete,true);assert.equal(manifest.accountId,a.user);assert.deepEqual(manifest.projects,[a.project]);
  const names=Object.keys(files).sort();
  for(const name of ['README.txt','account.json','usage.json','connections.json','chat/transcript.json',`projects/${a.project}/project.json`,`projects/${a.project}/specification.json`,`projects/${a.project}/photos/${approvedA.file}.jpg`,`projects/${a.project}/photos.json`])assert.ok(names.includes(name),name);
  assert.ok(!names.includes(`projects/${a.project}/photos/${pendingA.file}.jpg`),'Unapproved media is never exported');
  assert.deepEqual([...files[`projects/${a.project}/photos/${approvedA.file}.jpg`]],[...approvedA.bytes]);
  // Manifest digests cover every delivered section and only those.
  assert.deepEqual(manifest.files.map(f=>f.path).sort(),names.filter(n=>n!=='manifest.json'));
  for(const f of manifest.files){assert.equal(f.sha256,sha(files[f.path]),f.path);assert.equal(f.bytes,files[f.path].length);}
  assert.ok(manifest.omissions.some(o=>o.section===`projects/${a.project}/photos`&&o.count===1&&o.reason==='not-currently-approved'));
  assert.ok(manifest.omissions.some(o=>o.section===`projects/${a.project}/modules/enquiries/`&&o.reason==='visitor-dataset-not-requested'));
  for(const kind of ['credentials','safety-restricted'])assert.ok(manifest.omissions.some(o=>o.section===kind&&o.reason==='never-exported'));
  const text=Object.values(files).map(strFromU8).join('\n');
  assert.equal(JSON.parse(strFromU8(files['connections.json'])).github.connected,true);
  for(const secret of [tokenSecret,ciphertext,realAccess,a.token,b.token,b.user,b.project,approvedA.key,photoB.file,'object_key','token_hash','ciphertext',a.credential,a.authority])assert.ok(!text.includes(secret),'Export leaked '+secret.slice(0,24));
  assert.ok(text.includes(marker),'Owner project content is included');
  // Visitor datasets only with the explicit separate scope, through the records serializer.
  const visitor=await exportArchive(a,true),vm=JSON.parse(strFromU8(visitor.files['manifest.json']));
  assert.equal(vm.scope.visitorData,true);const records=JSON.parse(strFromU8(visitor.files[`projects/${a.project}/modules/enquiries/records-enquiry.json`]));
  assert.equal(records.pages[0].format,'whumpo-module-records');assert.ok(!vm.omissions.some(o=>o.reason==='visitor-dataset-not-requested'));
 });

 await check('export review is exact, owner-bound, fresh-passkey gated and refuses a changed binding',async()=>{
  const prepared=(await ok(await account(a,'export/prepare',{requestId:id(),visitorData:false}))).review;
  await refused(await account(b,'export/download',{reviewId:prepared.id,reviewDigest:prepared.digest}),409,'stale_review');
  await refused(await account(a,'export/download',{reviewId:prepared.id,reviewDigest:'0'.repeat(64)}),409,'stale_review');
  await refused(await account(a,'export/prepare',{requestId:prepared.id,visitorData:true}),409,'request_conflict');
  const replay=(await ok(await account(a,'export/prepare',{requestId:prepared.id,visitorData:false}))).review;assert.equal(replay.digest,prepared.digest);
  const stale=await owner(-3600),staleReview=(await ok(await account(stale,'export/prepare',{requestId:id(),visitorData:false}))).review;
  await refused(await account(stale,'export/download',{reviewId:staleReview.id,reviewDigest:staleReview.digest}),401,'proof_required');
  await createFixtureProject(a.scope,a.user,'Another '+marker,'Second project');
  await refused(await account(a,'export/download',{reviewId:prepared.id,reviewDigest:prepared.digest}),409,'stale_review');
  for(const bad of [{version:2,requestId:id(),visitorData:false},{version:1,requestId:'x',visitorData:false},{version:1,requestId:id(),visitorData:'yes'},{version:1,requestId:id(),visitorData:false,extra:1}])
   await refused(await call(a,'/account/v1/export/prepare',bad),400,'invalid_request');
  assert.equal((await call(a,'/account/v1/export/prepare',undefined,'GET')).status,404);
  const cross=await m.worker.fetch(new Request(base+'/api/account/v1/closure/status',{method:'POST',headers:{origin:'https://elsewhere.invalid','content-type':'application/json',cookie:'__Host-whumpo_session='+a.token},body:JSON.stringify({version:1})}),env,{waitUntil:()=>{}});
  assert.equal(cross.status,403);
 });

 await check('export downloads are single use and bounded per account, so repeated exports cannot exhaust shared photo reads',async()=>{
  const e=await owner(),f=await owner();await photo(e,true);await photo(f,true);
  const usage=async o=>({...await row("SELECT downloads,photo_reads FROM account_export_usage WHERE user_id=? AND period=strftime('%Y-%m','now')",o.user)});
  const platform=async()=>(await row("SELECT read_ops FROM storage_usage WHERE period=strftime('%Y-%m','now')"))?.read_ops??0;
  const first=await exportArchive(e);
  assert.deepEqual(await usage(e),{downloads:1,photo_reads:1});
  // The download consumed its review: the same review cannot be downloaded again.
  await refused(await account(e,'export/download',{reviewId:first.prepared.id,reviewDigest:first.prepared.digest}),409,'stale_review');
  assert.deepEqual(await usage(e),{downloads:1,photo_reads:1});
  // The monthly download allowance refuses before any read and keeps the review.
  await run("UPDATE account_export_usage SET downloads=10 WHERE user_id=?",e.user);
  const capped=(await ok(await account(e,'export/prepare',{requestId:id(),visitorData:false}))).review;
  const before=await platform();
  await refused(await account(e,'export/download',{reviewId:capped.id,reviewDigest:capped.digest}),409,'request_conflict');
  assert.ok(await row('SELECT 1 x FROM account_lifecycle_reviews WHERE id=?',capped.id));assert.equal(await platform(),before);
  // The per-account photo-read allowance stops the archive before the platform-wide ceiling is touched.
  await run("UPDATE account_export_usage SET downloads=0,photo_reads=5000 WHERE user_id=?",e.user);
  const response=await account(e,'export/download',{reviewId:capped.id,reviewDigest:capped.digest});
  assert.equal(response.status,200);await assert.rejects(()=>response.arrayBuffer());
  assert.equal(await platform(),before);assert.deepEqual(await usage(e),{downloads:1,photo_reads:5000});
  // Another account is unaffected.
  await exportArchive(f);assert.deepEqual(await usage(f),{downloads:1,photo_reads:1});assert.equal(await platform(),before+1);
  await assert.rejects(()=>run("UPDATE account_export_usage SET downloads=11 WHERE user_id=?",f.user),/CHECK/);
 });

 await check('export states what it left out, includes lead notes without visitor data, and refuses an export that cannot finish in one pass before using the allowance',async()=>{
  const x=a;
  // 25 model requests (released through the legal transition): the archive keeps the latest 20 and says so.
  for(let i=0;i<25;i++){const req=id(),at=new Date(Date.now()-i*1000).toISOString();await run("INSERT INTO standard_ai_requests(id,user_id,request_hash,created_at,updated_at) VALUES(?,?,?,?,?)",req,x.user,id().replaceAll('-','')+id().replaceAll('-','').slice(0,32),at,at);await run("UPDATE standard_ai_requests SET state='released' WHERE id=?",req);}
  // An owner-only lead note over a record, with no visitor datasets requested.
  const inst=await row("SELECT id FROM module_instances WHERE project_id=? AND local_id='enquiries'",x.project),record=id(),leadNote='LEAD-NOTE-'+marker;
  // The activation was applied before the site went live; suspend and activate it again so it binds to the live publication, as an owner would.
  for(const action of ['disable','activate']){const revision=async()=>(await m.readChat(x.scope,x.user)).state.revision,turn=id();
   const r=await m.sendChatControl(x.scope,x.user,{id:turn,revision:await revision(),action:{type:'moduleActivationReview',projectId:x.project,instanceId:'enquiries',action}});assert.equal(r.status,200,r.error);
   const saved=await row('SELECT * FROM module_activation_reviews WHERE id=?',turn);
   const applied=await m.sendChatControl(x.scope,x.user,{id:id(),revision:await revision(),action:{type:'moduleActivationApply',reviewId:saved.id,reviewDigest:saved.review_digest,expectedRevision:saved.expected_activation_revision}});assert.equal(applied.status,200,applied.error);}
  await run("INSERT INTO module_records(id,instance_id,project_id,schema_id,form_id,fields_revision,submitter_kind,visitor_id,values_json,revision,created_request_id,last_request_id,created_at,updated_at,expires_at) VALUES(?,?,?,'enquiry','ask',1,'public',NULL,'{\"message\":\"hello\"}',1,?,?,unixepoch(),unixepoch(),unixepoch()+7776000)",record,inst.id,x.project,record,record);
  await run("INSERT INTO module_record_leads(entry_id,instance_id,project_id,stage,note,due_date,revision,last_request_id,created_at,updated_at) VALUES(?,?,?,'contacted',?,NULL,1,?,unixepoch(),unixepoch())",record,inst.id,x.project,leadNote,id());
  const {files}=await exportArchive(x,false),manifest=JSON.parse(strFromU8(files['manifest.json']));
  assert.ok(manifest.omissions.some(o=>o.section==='usage.json'&&o.reason==='most-recent-20-requests-only'&&o.count>=25),JSON.stringify(manifest.omissions));
  const leads=JSON.parse(strFromU8(files[`projects/${x.project}/leads.json`]));assert.equal(leads.leads.length,1);assert.equal(leads.leads[0].note,leadNote);assert.equal(leads.leads[0].stage,'contacted');
  assert.ok(!Object.keys(files).some(n=>/records-enquiry/.test(n)),'Visitor datasets stay opt-in');
  // 6: the estimate charges one page per schema or collection.
  const least=async visitor=>{let lo=0,hi=5000;while(lo<hi){const mid=(lo+hi)>>1;try{await m.assertExportWithinBudget(db,x.user,visitor,mid);hi=mid;}catch{lo=mid+1;}}return lo;};
  assert.ok(await least(true)-await least(false)>=8,'one page for the records schema plus one page of records at least');
  // The size pre-check refuses before the review is saved or the monthly allowance touched.
  await assert.rejects(()=>m.assertExportWithinBudget(db,x.user,true,10),/too large to export in one download/);
  const before=(await row("SELECT downloads FROM account_export_usage WHERE user_id=? AND period=strftime('%Y-%m','now')",x.user))?.downloads??0;
  await assert.rejects(()=>m.assertExportWithinBudget(db,x.user,false,1),/Nothing was used from your monthly allowance/);
  assert.equal((await row("SELECT downloads FROM account_export_usage WHERE user_id=? AND period=strftime('%Y-%m','now')",x.user))?.downloads??0,before);
  // Another download consumes the review between this download's read and its consuming batch: this one must produce nothing and use no allowance.
  const prepared=(await ok(await account(x,'export/prepare',{requestId:id(),visitorData:false}))).review;
  const usedBefore=(await row("SELECT downloads FROM account_export_usage WHERE user_id=? AND period=strftime('%Y-%m','now')",x.user))?.downloads??0;
  batchHooks.push({re:/INSERT INTO account_export_usage\(user_id,period,downloads\)/,fn:()=>run('DELETE FROM account_lifecycle_reviews WHERE id=?',prepared.id)});
  const lost=await account(x,'export/download',{reviewId:prepared.id,reviewDigest:prepared.digest});await refused(lost,409,'stale_review');assert.equal(batchHooks.length,0);
  assert.equal((await row("SELECT downloads FROM account_export_usage WHERE user_id=? AND period=strftime('%Y-%m','now')",x.user))?.downloads??0,usedBefore);
 });

 let closureA;
 await check('closure review and confirmation: exact, fresh passkey, replay-safe; new work and delayed OAuth callbacks stop',async()=>{
  // GitHub refresh custody needs the reviewed app-wide grant revocation first: confirmation is refused and nothing is taken away.
  const gated=await closureReview(a);assert.equal(gated.canConfirm,false);assert.deepEqual(gated.requiredBeforeClosure.map(r=>r.id),['githubRefreshCustody']);assert.match(gated.requiredBeforeClosure[0].action,/GitHub access/);
  await refused(await confirm(a,gated),409,'action_required');
  assert.equal(await row('SELECT 1 x FROM account_closures WHERE account_id=?',a.user),null);assert.ok((await row('SELECT version_id FROM publications WHERE project_id=?',a.project)).version_id,'Nothing was taken away');
  // The owner does as told, through the real reviewed revocation (app-wide, explicit confirmation), against the provider stand-in.
  {const grant=id();await m.githubGrant.reviewGitHubGrant(a.scope,a.user,grant,ghConfig);
   assert.equal((await m.githubGrant.confirmGitHubGrant(a.scope,a.user,grant,'REVOKE_APP_ACCESS',ghConfig,async()=>new Response(null,{status:204}))).state,'revoked');}
  assert.equal((await row('SELECT count(*) n FROM github_refresh_custody WHERE user_id=?',a.user)).n,0);
  // A credential row with no refresh custody, added after the revocation (the grant route refuses while any unexpired token lacks custody, platform-wide).
 await run("INSERT INTO github_token_vault(id,user_id,ciphertext,expires_at,state) VALUES('token-a',?,?,'2027-01-01','active')",a.user,ciphertext);
  const review=await closureReview(a);
  assert.equal(review.canConfirm,true);assert.equal(review.needsSupport,false);assert.equal(review.removes.projects,2,'projects');assert.equal(review.removes.connectedProviders,1,'providers');
  assert.ok(!JSON.stringify(review).match(/hold|safety|preserv/i),'The review never reveals preservation detail');
  await refused(await confirm(a,review,{confirmation:'yes'}),400,'invalid_request');
  await refused(await confirm(b,review),409,'stale_review');
  // A content change after the review invalidates it.
  const changed=await closureReview(a);await createFixtureProject(a.scope,a.user,'Third '+marker,'Third project');
  await refused(await confirm(a,changed),409,'stale_review');
  // AI work in flight when the owner confirms (created last, so no Chat read has settled it first).
  neverSent=await turnFor(a.user,9001,'reserved',aged(1));oldUncertain=await turnFor(a.user,9002,'uncertain',aged(60),aged(48));
  const current=await closureReview(a);
  // Interrupted confirmation (lost worker before the batch): nothing committed, the same review confirms afterwards.
  failNext=/INSERT INTO account_closures/;await refused(await confirm(a,current),503,'unavailable');
  assert.equal(await row('SELECT 1 x FROM account_closures WHERE account_id=?',a.user),null);
  const first=await ok(await confirm(a,current));closureA=first.closure.id;assert.equal(closureA,current.id);
  // Reconciliation ran from closure itself: the request that never reached the model is released, the old uncertain one is past its window.
  assert.equal((await row('SELECT state FROM standard_ai_requests WHERE id=?',neverSent)).state,'released');assert.equal((await row('SELECT status FROM chat_turns WHERE id=?',neverSent)).status,'failed');
  assert.equal((await row('SELECT state FROM standard_ai_requests WHERE id=?',oldUncertain)).state,'uncertain','An uncertain answer is never rewritten');
  // The provider answers 503: the token stays, marked revoking, and closure waits at credentials.
  assert.equal(first.closure.state,'waiting');assert.deepEqual(steps(first),{freeze:'done',withdraw:'done',operations:'done',credentials:'waiting',holds:'pending',purge:'pending'});
  assert.equal(first.closure.steps.find(s=>s.step==='freeze').detail.githubRepositoriesLeftInPlace,0);assert.equal(first.closure.steps.find(s=>s.step==='freeze').detail.cloudflareZonesLeftInPlace,0);
  assert.equal((await row("SELECT state FROM github_token_vault WHERE id='token-a'")).state,'revoking');
  const withdraw=first.closure.steps.find(s=>s.step==='withdraw').detail;assert.equal(withdraw.websitesWithdrawn,1);assert.equal(withdraw.modulesSuspended,1);
  assert.equal((await row('SELECT version_id FROM publications WHERE project_id=?',a.project)).version_id,null);
  assert.equal((await row("SELECT a.state FROM module_activations a JOIN module_instances i ON i.id=a.instance_id WHERE i.project_id=? AND i.local_id='enquiries'",a.project)).state,'suspended');
  // Replay of the same confirmation returns the same closure; another review cannot start a second closure.
  assert.equal((await ok(await confirm(a,current))).closure.id,closureA);
  await refused(await account(a,'closure/prepare',{requestId:id()}),409,'closure_exists');
  // Every ordinary workspace route, including a delayed OAuth callback, refuses inside its own transaction.
  const vault=(await row('SELECT count(*) n FROM github_token_vault WHERE user_id=?',a.user)).n;
  await run("INSERT INTO github_oauth_states(user_id,state_hash,authority_id,verifier_ciphertext,expires_at,claimed) VALUES(?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now','+5 minutes'),1)",a.user,'f'.repeat(64),a.authority,await fixtureCiphertext(fixtureKeyring(),'whumpo:github:pkce:'+a.user+':late-state','synthetic-verifier'));
  for(const [path,method] of [['/projects','GET'],['/chat','GET'],['/connections/github/callback?code=late&state=late','GET'],['/connections/github/start','POST'],['/profile','GET']])
   await refused(await call(a,path,method==='POST'?{}:undefined,method),409,'account_closing');
  assert.equal((await row('SELECT count(*) n FROM github_token_vault WHERE user_id=?',a.user)).n,vault);
  // Support stays reachable while closing; an ordinary workspace write is refused.
  assert.equal((await call(a,'/support/v1',undefined,'GET')).status,200);
  // Export and status stay available while closing; the other tenant is unaffected.
  await exportArchive(a);assert.equal((await ok(await account(a,'closure/status'))).closure.state,'waiting');
  assert.equal((await call(b,'/projects',undefined,'GET')).status,200);
 });

 await check('resume is idempotent and recovers interrupted steps; the real provider cleanup finishes revocation; a lost swap closes nothing',async()=>{
  // The provider keeps refusing: closure keeps waiting and repeats nothing else. Then it confirms; the existing cleanup removes the token.
  const before=provider.calls.length;assert.equal((await ok(await account(a,'closure/resume'))).closure.steps.find(s=>s.step==='credentials').state,'waiting');assert.ok(provider.calls.length>before,'The provider revocation is retried');
  provider.github=204;
  failNext=/UPDATE account_closure_steps/;await refused(await account(a,'closure/resume'),503,'unavailable');
  assert.equal((await row("SELECT count(*) n FROM github_token_vault WHERE id='token-a'")).n,0,'The cleanup removed the revoked token');
  const inventory=await accountClosureInventory(db,a.user);assert.equal(inventory.readyForDeletion,false);
  // Purge interrupted inside its batch: the users cascade and completed journal roll back together.
  failNext=/DELETE FROM users/;await refused(await account(a,'closure/resume'),503,'unavailable');
  assert.deepEqual(Object.fromEntries((await rows('SELECT step,state FROM account_closure_steps WHERE closure_id=?',closureA)).map(r=>[r.step,r.state])),{freeze:'done',withdraw:'done',operations:'done',credentials:'done',holds:'done',purge:'pending'});
  assert.ok(await row('SELECT 1 x FROM users WHERE id=?',a.user));assert.equal((await row('SELECT state FROM account_closures WHERE closure_id=?',closureA)).state,'quiescing');
  assert.equal((await row("SELECT state FROM account_closure_steps WHERE closure_id=? AND step='purge'",closureA)).state,'pending');
  // A lost journal swap (another runner advanced the purge step between the read and the batch): the batch must close and delete nothing,
  // and the retry then completes. The first hook is that other runner; the second looks at the database right after the lost batch.
  batchHooks.push({re:/DELETE FROM users/,fn:()=>run("UPDATE account_closure_steps SET attempts=attempts+1 WHERE closure_id=? AND step='purge'",closureA)});
  batchHooks.push({re:/DELETE FROM users/,fn:async()=>{assert.ok(await row('SELECT 1 x FROM users WHERE id=?',a.user),'A lost swap deleted the account');assert.equal((await row('SELECT state FROM account_closures WHERE closure_id=?',closureA)).state,'quiescing','A lost swap closed the closure');}});
  const done=await ok(await account(a,'closure/resume'));assert.equal(batchHooks.length,0,'The swap was lost once and then retried');
  assert.equal(done.closure.state,'complete');assert.equal(done.closure.steps.at(-1).detail.primaryAccountRowsDeleted,true);
  assert.equal(done.closure.steps.at(-1).detail.githubRepositoriesLeftInPlace,0);assert.equal(done.closure.steps.at(-1).detail.cloudflareZonesLeftInPlace,0);
 });

 await check('final receipt survives the account cascade; private objects are queued, not silently dropped; other tenant intact',async()=>{
  for(const [table,column] of [['users','id'],['projects','owner_user_id'],['identity_sessions','account_id'],['chat_turns','user_id'],['account_lifecycle_reviews','user_id'],['standard_ai_requests','user_id']])
   assert.equal((await row(`SELECT count(*) n FROM ${table} WHERE ${column}=?`,a.user)).n,0,table);
  const receipt=await row('SELECT * FROM account_closures WHERE closure_id=?',closureA);assert.equal(receipt.state,'closed');assert.ok(receipt.closed_at);assert.equal(receipt.revision,5);assert.equal(receipt.history,'["requested","reviewed","confirmed","quiescing","closed"]');
  assert.equal((await rows("SELECT step FROM account_closure_steps WHERE closure_id=? AND state='done' ORDER BY position",closureA)).length,6);
  assert.doesNotMatch(JSON.stringify([receipt,await rows('SELECT * FROM account_closure_steps WHERE closure_id=?',closureA)]),new RegExp(marker+'|example.invalid|gho_'));
  assert.ok(await row('SELECT 1 x FROM file_cleanup WHERE object_key=? AND owner_user_id=?',approvedA.key,a.user),'Deleted photo bytes are queued for the existing private cleanup');
  await assert.rejects(()=>run('DELETE FROM account_closures WHERE closure_id=?',closureA),/account_closure_retained/);
  await assert.rejects(()=>run("UPDATE account_closures SET state='cancelled',revision=revision+1 WHERE closure_id=?",closureA),/account_closure_guard/);
  // The deleted session no longer authenticates anything.
  await refused(await account(a,'closure/status'),401,'proof_required');
  assert.equal((await call(b,'/projects',undefined,'GET')).status,200);assert.ok(await row('SELECT 1 x FROM project_files WHERE id=?',photoB.file));
 });

 await check('preservation holds block deletion with a generic pending state until audited release',async()=>{
  const c=await owner(),stale=await workspaceSessionFor(c,-3600);
  const review=await closureReview(c);
  await refused(await confirm(stale,review),401,'proof_required');
  const caseId='case-wh018-'+id().slice(0,8),hold='hold-wh018-'+id().slice(0,8);
  await run("INSERT INTO safety_cases(id,subject_user_id,intake_ref,opened_by,opened_at,retention_due_at) VALUES(?,?,'intake-1','human:reviewer',unixepoch(),unixepoch()+31536000)",caseId,c.user);
  await run("INSERT OR IGNORE INTO safety_case_roles(id,operator_ref,role,granted_by,granted_at) VALUES('grant-test-approver','human:approver','preservation_approver','human:test-administrator',unixepoch())"); // holds need a current preservation approver
  await run("INSERT INTO safety_preservation_holds(id,case_id,subject_user_id,scope,project_id,legal_basis_ref,approved_by,placed_at,review_due_at) VALUES(?,?,?,'project',?,'basis-1','human:approver',unixepoch(),unixepoch()+86400)",hold,caseId,c.user,c.project);
  // The review and the refusal agree: a hold makes the review say, in the same generic sentence every support-only condition uses, that support is needed. No clean review
  // is ever followed by a repeatable refusal, so the refusal reveals nothing the review did not. The hold itself, its case and its scope are never named.
  const fresh=await closureReview(c);assert.equal(fresh.canConfirm,false);assert.equal(fresh.needsSupport,true);assert.match(fresh.supportMessage,/need Whumpo support/);
  assert.doesNotMatch(JSON.stringify(fresh),/hold|safety|preserv|case-|basis/i);
  const other=await owner();await run('INSERT INTO backend_form_settings(project_id,revision) VALUES(?,0)',other.project);assert.equal((await closureReview(other)).supportMessage,fresh.supportMessage,'Every support-only condition shows the same sentence');
  await run('DELETE FROM backend_form_settings WHERE project_id=?',other.project);
  // Confirmation is refused before anything is taken away, with a sentence that is the same for every kind of support-only condition.
  const refusal=await refused(await confirm(c,review),409,'action_required');
  assert.match(refusal.error,/need Whumpo support/);assert.doesNotMatch(JSON.stringify(refusal),/hold|safety|preserv|case-|basis/i);
  assert.equal(await row('SELECT 1 x FROM account_closures WHERE account_id=?',c.user),null);assert.ok((await row('SELECT status FROM projects WHERE id=?',c.project)),'The project is untouched');
  await run("UPDATE safety_preservation_holds SET released_at=unixepoch(),released_by='human:approver',release_ref='release-1' WHERE id=?",hold);
  const released=await closureReview(c);assert.equal((await ok(await confirm(c,released))).closure.state,'complete');
  assert.equal(await row('SELECT 1 x FROM users WHERE id=?',c.user),null);assert.ok(await row('SELECT 1 x FROM safety_cases WHERE id=?',caseId),'Case records stay outside the cascade');
 });

 await check('a settled hostname record no longer traps the account; an unsettled one is an owner action and the database refuses to drop it',async()=>{
  const d=await owner(),claim=id(),conn=id(),host='closure-'+claim.slice(0,8)+'.example.test',exp=new Date(Date.now()+3600000).toISOString(),now=new Date().toISOString();
  await run("INSERT INTO domain_claims(id,project_id,hostname,token,expires_at,created_at) VALUES(?,?,?,'t',?,?)",claim,d.project,host,exp,now);
  await run("INSERT INTO domain_connections(id,user_id,claim_id,project_id,hostname,zone_id,target,proof_hash,state,created_at,expires_at) VALUES(?,?,?,?,?,'zone-1','target.example.test',?,'review',?,?)",conn,d.user,claim,d.project,host,'a'.repeat(64),now,exp);
  await run("UPDATE domain_connections SET state='creating' WHERE id=?",conn);
  const pending=await closureReview(d);assert.deepEqual(pending.requiredBeforeClosure.map(r=>r.id),['unresolvedDomainRecords']);assert.match(pending.requiredBeforeClosure[0].action,/Disconnect each custom domain/);
  await refused(await confirm(d,pending),409,'action_required');
  await assert.rejects(()=>run('DELETE FROM users WHERE id=?',d.user),/domain_connection_active/);await assert.rejects(()=>run('DELETE FROM projects WHERE id=?',d.project),/domain_connection_active/);
  // The owner disconnects (the provider-confirmed end state); the settled record used to refuse the delete forever (RESTRICT) and now leaves with the account.
  await run("UPDATE domain_connections SET state='disconnecting' WHERE id=?",conn);await run("UPDATE domain_connections SET state='disconnected' WHERE id=?",conn);
  const review=await closureReview(d);assert.equal(review.canConfirm,true);assert.equal(review.requiredBeforeClosure.length,0);
  const done=await ok(await confirm(d,review));assert.equal(done.closure.state,'complete');assert.equal(await row('SELECT 1 x FROM domain_connections WHERE id=?',conn),null);
  assert.equal(done.closure.steps.at(-1).detail.cloudflareZonesLeftInPlace,1,'The receipt lists the zone left in place');
 });

 await check('a lost notification reply and an interrupted form continuation stop counting after their windows; recent ones wait; a stuck closure reports itself',async()=>{
  const day=864e5,{enqueueNotice,runNotificationDelivery}=m.notificationOutbox;
  const lockstep=(await row("SELECT sql FROM sqlite_master WHERE name='users_email_lockstep'"))?.sql;await run('DROP TRIGGER IF EXISTS users_email_lockstep');
  // The real notification lane: the sender's reply is lost, so the journal job goes uncertain and its notice unknown, exactly as in production.
  const lost=async(o,agoDays)=>{
   await run("UPDATE users SET email_verified_at=?,email_verified_via='notify@whumpo.com' WHERE id=?",Date.now(),o.user);
   const at=Date.now()-agoDays*day;await enqueueNotice(db,{userId:o.user,scope:'account-email',template:'account.passkey-added@1',eventRef:'evt-'+id(),now:at});
   await runNotificationDelivery(db,{sendCeiling:1000,customerCeilingCents:0},async()=>{throw Error('reply lost');},{now:new Date(at),timeoutMs:50});
   return row('SELECT state,last_at FROM job_journal WHERE owner_user_id=?',o.user);};
  try{
   const old=await owner(),oldJob=await lost(old,4);assert.equal(oldJob.state,'uncertain');assert.ok(oldJob.last_at<Date.now()-3*day,'the lane recorded the old time');
   const oldReview=await closureReview(old);assert.equal(oldReview.canConfirm,true);
   const finished=await ok(await confirm(old,oldReview));assert.equal(finished.closure.state,'complete','a lost reply older than 72 hours does not stop the purge');
   assert.equal(await row('SELECT 1 x FROM job_journal WHERE owner_user_id=?',old.user),null,'the uncertain job and its unknown notice leave with the account');
   const recent=await owner(),recentJob=await lost(recent,0);assert.equal(recentJob.state,'uncertain');
   const waiting=await ok(await confirm(recent,await closureReview(recent)));assert.equal(steps(waiting).operations,'waiting');assert.equal(waiting.closure.overdue,false);
   // A closure still quiescing four days after it began says so to its owner, and the operator report lists it (observed with the JS clock moved forward; nothing is edited).
   const real=Date.now;let stuck,report;Date.now=()=>real()+5*day;try{stuck=await ok(await account(recent,'closure/status'));report=await maintenanceReport(db,Date.now());}finally{Date.now=real;}
   assert.equal(stuck.closure.overdue,true);assert.equal(report.backlogs.find(q=>q.queue==='account_closures').state,'attention');
   assert.equal(waiting.closure.overdue,false);assert.equal((await maintenanceReport(db,Date.now())).backlogs.find(q=>q.queue==='account_closures').state,'pending','a fresh closure is pending, not attention');
  }finally{if(lockstep)await run(lockstep);}
  // An interrupted form-continued AI turn: pending and then unknown. Its window is 24 hours from the start.
  const continuation=async(o,startedHoursAgo,rev)=>{
   const conv=id(),task=id(),interaction=id(),turn=id(),started=new Date(Date.now()-startedHoursAgo*3600000).toISOString(),created=new Date(Date.now()-48*3600000).toISOString();
   await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,?,'q','a',?,'ai','completed')",turn,o.user,rev,created);
   await run('INSERT INTO chat_conversations(id,user_id) VALUES(?,?)',conv,o.user);
   await run('INSERT INTO chat_interaction_tasks(id,user_id,conversation_id,project_id,origin_turn_id) VALUES(?,?,?,?,?)',task,o.user,conv,o.project,turn);
   const expires=new Date(Date.now()+86400000).toISOString(),envelope=JSON.stringify({version:1,id:interaction,scope:{accountId:o.user,actorId:o.user,conversationId:conv,taskId:task,projectId:o.project,originTurnId:turn},createdAt:created,expiresAt:expires,definitionDigest:'a'.repeat(64),definition:{continuationBinding:'agent.task-continue@1'}});
   await run('INSERT INTO chat_interactions(id,user_id,conversation_id,task_id,project_id,origin_turn_id,envelope_json,definition_digest,issue_hash,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',interaction,o.user,conv,task,o.project,turn,envelope,'a'.repeat(64),'b'.repeat(64),created,expires);
   await run("UPDATE chat_interactions SET state='submitted',answer_revision=1,draft_json='{}',draft_saved_at=NULL WHERE id=?",interaction);
   await run("INSERT INTO chat_interaction_requests(user_id,request_id,interaction_id,request_hash,operation,answer_revision,created_at) VALUES(?,?,?,?,'submit',1,?)",o.user,interaction,interaction,'d'.repeat(64),created);
   await run("INSERT INTO chat_interaction_submissions(id,user_id,interaction_id,answers_json,answers_digest,answer_revision,created_at) VALUES(?,?,?,'{}',?,1,?)",interaction,o.user,interaction,'c'.repeat(64),created);
   await run('INSERT INTO chat_interaction_continuations(id) VALUES(?)',interaction);
   await run("UPDATE chat_interaction_continuations SET state='pending',started_at=? WHERE id=?",started,interaction);await run("UPDATE chat_interaction_continuations SET state='unknown' WHERE id=?",interaction);};
  const stale=await owner();await continuation(stale,30,9301);
  assert.equal((await ok(await confirm(stale,await closureReview(stale)))).closure.state,'complete','an unanswered continuation older than 24 hours does not stop closure');
  const fresh=await owner();await continuation(fresh,1,9302);
  assert.equal(steps(await ok(await confirm(fresh,await closureReview(fresh)))).operations,'waiting','a recent one waits');
 });

 await check('what the owner reviewed is what is deleted; a late billing record stops the purge',async()=>{
  // 5: a project created between the confirmation read and the batch.
  const n=await owner(),review=await closureReview(n);
  batchHooks.push({re:/INSERT INTO account_closures/,fn:()=>createFixtureProject(n.scope,n.user,'Created in the gap '+marker,'Second project')});
  await refused(await confirm(n,review),409,'stale_review');assert.equal(batchHooks.length,0);
  assert.equal(await row('SELECT 1 x FROM account_closures WHERE account_id=?',n.user),null,'nothing started');assert.equal((await row('SELECT count(*) c FROM projects WHERE owner_user_id=?',n.user)).c,2,'nothing deleted');
  // 7: a paid plan that lands after the last read is not cascade-deleted silently.
  const z=await owner();let paid;batchHooks.push({re:/DELETE FROM users/,fn:async()=>{paid=await paidPlan(db,z.user,'business');}});
  const stopped=await ok(await confirm(z,await closureReview(z)));
  assert.ok(paid);assert.ok(await row('SELECT 1 x FROM users WHERE id=?',z.user),'the account is still there');assert.ok(await row('SELECT 1 x FROM stripe_paid_invoices WHERE id=?',paid),'the invoice record is kept');
  assert.equal(stopped.closure.state,'blocked');assert.equal(stopped.closure.steps.at(-1).detail.reason,'retained_records');
 });

 await check('work that appears between the last read and the purge batch stops the purge inside the batch',async()=>{
  const k=await owner();let rev=9200;
  // The injected request is created by "another runner" right before the purge batch commits.
  batchHooks.push({re:/DELETE FROM users/,fn:()=>turnFor(k.user,++rev,'reserved',new Date().toISOString())});
  const status=await ok(await confirm(k,await closureReview(k)));
  assert.equal(batchHooks.length,0);assert.equal(status.closure.state,'waiting');assert.equal(steps(status).purge,'waiting');
  assert.ok(await row('SELECT 1 x FROM users WHERE id=?',k.user),'The batch refused to delete with unresolved work present');assert.equal((await row('SELECT state FROM account_closures WHERE account_id=?',k.user)).state,'quiescing');
 });

 await check('support-only and owner-action conditions refuse confirmation before anything is taken away; a late retained record stops the purge for an operator',async()=>{
  const d=await owner();
  await run('INSERT INTO backend_form_settings(project_id,revision) VALUES(?,0)',d.project);
  const blocked=await closureReview(d);assert.equal(blocked.canConfirm,false);assert.equal(blocked.needsSupport,true);assert.deepEqual(blocked.requiredBeforeClosure,[]);assert.match(blocked.supportMessage,/need Whumpo support/);
  assert.doesNotMatch(JSON.stringify(blocked),/backendFormSettings|backend_form/,'The reason is not itemised');
  await refused(await confirm(d,blocked),409,'action_required');assert.equal(await row('SELECT 1 x FROM account_closures WHERE account_id=?',d.user),null);
  assert.equal((await call(d,'/projects',undefined,'GET')).status,200,'The workspace still works');
  await run('DELETE FROM backend_form_settings WHERE project_id=?',d.project);
  // An active domain is something the owner can do; a paid plan too; a paid invoice record is support-only until a finance schedule is approved.
  const billing=await owner();await paidPlan(db,billing.user,'business');
  const plan=await closureReview(billing);assert.deepEqual(plan.requiredBeforeClosure.map(r=>r.id),['activeSubscriptions']);assert.match(plan.requiredBeforeClosure[0].action,/forfeit/);
  await refused(await confirm(billing,plan),409,'action_required');
  await run("UPDATE stripe_subscriptions SET status='canceled' WHERE user_id=?",billing.user); // the end state the Stripe webhook records; no Stripe call is made
  const invoices=await closureReview(billing);assert.equal(invoices.needsSupport,true);assert.equal(invoices.canConfirm,false);assert.match(invoices.paidInvoiceNotice,/cannot be closed yet, by you or by support/);assert.ok(await row('SELECT 1 x FROM stripe_paid_invoices WHERE user_id=?',billing.user),'The paid invoice record is kept');
  // A retained finance record that appears after confirmation (an operator or late write) still stops the purge honestly.
  const e=await owner();
  await run("INSERT INTO github_token_vault(id,user_id,ciphertext,expires_at,state) VALUES('token-late',?,?,'2027-01-01','active')",e.user,await fixtureCiphertext(fixtureKeyring(),`whumpo:github:token:${e.user}:token-late`,'gho_SYNTHETIC_LATE'));
  provider.github=503;const started=await ok(await confirm(e,await closureReview(e)));assert.equal(steps(started).credentials,'waiting');
  await run("INSERT INTO gateway_spend_buckets(id,scope,user_id,limit_micros) VALUES(?,'account',?,1000)",id(),e.user);
  provider.github=204;const stopped=await ok(await account(e,'closure/resume'));
  assert.equal(stopped.closure.state,'blocked');assert.equal(steps(stopped).purge,'blocked');assert.equal(stopped.closure.steps.at(-1).detail.reason,'retained_records');
  assert.ok(await row('SELECT 1 x FROM users WHERE id=?',e.user),'Retained finance records are never deleted by implication');
 });

 await check('maintenance continues waiting closures without the owner: holds block, failures are isolated, re-runs are idempotent',async()=>{
  const e=await owner(),f=await owner(),g=await owner(),h=await owner();
  const token=async(o,name)=>run("INSERT INTO github_token_vault(id,user_id,ciphertext,expires_at,state) VALUES(?,?,?,'2027-01-01','active')",name,o.user,await fixtureCiphertext(fixtureKeyring(),`whumpo:github:token:${o.user}:${name}`,'gho_SYNTHETIC_'+name));
  await token(e,'token-e');await token(g,'token-g');
  const hold=async(o,scope)=>{const caseId='case-bg-'+id().slice(0,8),holdId='hold-bg-'+id().slice(0,8);
   await run("INSERT INTO safety_cases(id,subject_user_id,intake_ref,opened_by,opened_at,retention_due_at) VALUES(?,?,'intake-1','human:reviewer',unixepoch(),unixepoch()+31536000)",caseId,o.user);
   await run("INSERT OR IGNORE INTO safety_case_roles(id,operator_ref,role,granted_by,granted_at) VALUES('grant-test-approver','human:approver','preservation_approver','human:test-administrator',unixepoch())"); // holds need a current preservation approver
   await run("INSERT INTO safety_preservation_holds(id,case_id,subject_user_id,scope,project_id,legal_basis_ref,approved_by,placed_at,review_due_at) VALUES(?,?,?,?,?,'basis-1','human:approver',unixepoch(),unixepoch()+86400)",holdId,caseId,o.user,scope,scope==='account'?null:o.project);
   return ()=>run("UPDATE safety_preservation_holds SET released_at=unixepoch(),released_by='human:approver',release_ref='release-1' WHERE id=?",holdId);};
  // f has a model request that was dispatched an hour ago and a pending Chat turn: closure itself marks it uncertain (inside its 24 hour window) and waits.
  provider.github=503;const fTurn=await turnFor(f.user,9101,'dispatched',aged(1));
  const se=await ok(await confirm(e,await closureReview(e))),sf=await ok(await confirm(f,await closureReview(f))),sg=await ok(await confirm(g,await closureReview(g)));
  assert.equal(steps(se).credentials,'waiting');assert.equal(steps(sf).operations,'waiting');assert.equal(steps(sg).credentials,'waiting');
  assert.equal((await row('SELECT state FROM standard_ai_requests WHERE id=?',fTurn)).state,'uncertain');assert.equal((await row('SELECT status FROM chat_turns WHERE id=?',fTurn)).status,'uncertain');
  assert.equal(se.closure.steps.find(s=>s.step==='credentials').origin,'owner');
  const releaseG=await hold(g,'project'); // placed after confirmation, before the holds step has run
  const closure=o=>row('SELECT * FROM account_closures WHERE account_id=?',o.user),step=(o,name)=>row("SELECT s.* FROM account_closure_steps s JOIN account_closures c ON c.closure_id=s.closure_id WHERE c.account_id=? AND s.step=?",o.user,name);
  const health=async()=>({...await row("SELECT status,failure_category FROM maintenance_health WHERE job='account_closures'")});
  const hourly=async()=>{try{await m.worker.scheduled({cron:'47 * * * *'},env);}catch(error){assert.match(String(error),/Scheduled maintenance or telemetry failed/);}return health();};
  // The provider now confirms revocation; nobody presses resume. The existing cleanup removes e's and g's tokens.
  provider.github=204;
  // Pass 1: e's closure fails mid-pass. It is untouched; the others are still re-checked and journaled; health reports failure.
  const fBefore=await step(f,'operations');failAccount=e.user;
  assert.deepEqual(await hourly(),{status:'failed',failure_category:'job_failed'});failAccount=null;
  assert.equal((await step(e,'credentials')).state,'waiting');assert.ok(await row('SELECT 1 x FROM users WHERE id=?',e.user));
  const fAfter=await step(f,'operations');assert.equal(fAfter.state,'waiting');assert.equal(fAfter.attempts,fBefore.attempts+1);assert.equal(fAfter.last_origin,'maintenance');
  assert.equal((await row('SELECT state FROM standard_ai_requests WHERE id=?',fTurn)).state,'uncertain','The continuation never releases an unresolved operation');
  assert.equal((await step(g,'credentials')).state,'done');assert.equal((await step(g,'holds')).state,'blocked');assert.equal((await step(g,'holds')).last_origin,'maintenance');assert.ok(await row('SELECT 1 x FROM projects WHERE id=?',g.project),'Never purged under hold');
  // Pass 2: e advances to completion through the same journaled steps, without any session.
  assert.equal((await hourly()).status,'completed');
  const ce=await closure(e);assert.equal(ce.state,'closed');assert.equal(await row('SELECT 1 x FROM users WHERE id=?',e.user),null);
  assert.equal((await step(e,'purge')).last_origin,'maintenance');assert.equal((await step(e,'credentials')).last_origin,'maintenance');
  assert.equal((await closure(g)).state,'quiescing');assert.equal((await step(g,'holds')).state,'blocked');assert.ok(await row('SELECT 1 x FROM users WHERE id=?',g.user));
  // Idempotent re-run: a completed receipt is never selected or changed again, and f still waits on its unresolved request.
  await hourly();assert.equal((await closure(e)).revision,ce.revision);assert.equal((await closure(e)).updated_at,ce.updated_at);assert.equal((await step(f,'operations')).state,'waiting');
  // A hold placed between the holds step and the purge batch still stops the purge: the database refuses the cascade, and the step is journaled.
  let releaseH;batchHooks.push({re:/DELETE FROM users/,fn:async()=>{releaseH=await hold(h,'account');}});
  const sh=await ok(await confirm(h,await closureReview(h)));
  assert.equal(sh.closure.state,'blocked');assert.deepEqual(sh.closure.steps.find(s=>s.step==='purge').detail,{reason:'retention_review',support:true});assert.ok(await row('SELECT 1 x FROM users WHERE id=?',h.user),'Never purged under hold');
  await releaseH();await releaseG();
  // Two overlapping continuation passes (and an owner resume) after release: compare-and-swap journal, one purge each.
  const results=await Promise.all([m.continueAccountClosures(env),m.continueAccountClosures(env),account(g,'closure/resume')]);
  // The owner sees the receipt, or (when the background purged the account mid-request) an honest session refusal.
  {const r=results[2],body=await r.json();assert.ok(r.status===200&&body.closure.state==='complete'||[401,409].includes(r.status)&&['proof_required','identity_changed'].includes(body.code),r.status+' '+JSON.stringify(body));}
  await m.continueAccountClosures(env);
  for(const o of [g,h]){assert.equal((await closure(o)).state,'closed');assert.equal(await row('SELECT 1 x FROM users WHERE id=?',o.user),null);
   assert.equal((await rows("SELECT step FROM account_closure_steps s JOIN account_closures c ON c.closure_id=s.closure_id WHERE c.account_id=? AND s.state='done'",o.user)).length,6);}
  assert.equal((await closure(f)).state,'quiescing','f still waits: an uncertain answer is never released before its window ends');
  // Bounds: batch size, time budget, and maintenance-only authority.
  const one=await m.continueAccountClosures(env,{limit:1});assert.ok(one.selected<=1);
  let t=0;const late=await m.continueAccountClosures(env,{clock:()=>(t+=m.closureContinuation.budgetMs)});assert.equal(late.deferred,late.selected);
  await assert.rejects(()=>m.continueAccountClosures(env,{limit:m.closureContinuation.batch+1}),/Invalid closure continuation bounds/);
  await assert.rejects(()=>m.continueAccountClosures({...env,DB:b.scope}),/Platform maintenance authority is required/);
  assert.equal((await call(b,'/projects',undefined,'GET')).status,200,'The other tenant is untouched');
 });

 assert.equal(network,0,'No provider or network call was made');
 assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 assert.ok(!logs.join('\n').includes(marker)&&!logs.join('\n').includes('gho_'),'No private value was logged');
 say(`Account lifecycle passed: ${cases} groups (two-tenant export with exact review, owner/visitor scopes and manifest digests; fresh-passkey closure, stop-new-work and delayed callback refusal, interrupted confirmation/journal/purge with resume, unresolved-operation and provider-revocation waits, preservation-hold refusal and release, owner-action and retained-record blockers, surviving receipt, hourly maintenance continuation with hold refusal, failure isolation and idempotent re-runs) on ${process.argv.includes('--d1')?'local D1':'disposable SQLite'}.`);
}catch(error){originals.error(String(error.stack||error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundled module>'));process.exitCode=1;}
finally{globalThis.fetch=originalFetch;for(const k of consoleMethods)console[k]=originals[k];await fixture.close();}
async function workspaceSessionFor(o,proofOffset){
 const {workspaceSession}=await import('./helpers/workspace-identity.mjs');
 return workspaceSession(db,m,{account:o.account,credential:o.credential},proofOffset);
}
