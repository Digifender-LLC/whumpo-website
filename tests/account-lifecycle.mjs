import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {unzipSync,strFromU8} from 'fflate';
import {currentSiteFixtureHandlers,createFixtureProject,configureFixtureModules} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
import {initializeFixtureKeys,fixtureKeyring,fixtureCiphertext} from './helpers/connection-keyring.mjs';
import {accountClosureInventory} from '../tools/account-closure-inventory.mjs';
Error.stackTraceLimit=0;
// WH-018 reviewed account export and resumable account closure through the actual platform Worker routes, against the
// complete current schema in disposable SQLite, or local D1 with --d1. Every identity, photo, token and record is
// synthetic. No provider, model or network is used; private object storage is an in-memory stand-in.
const logs=[],consoleMethods=['log','info','warn','error','debug'],originals=Object.fromEntries(consoleMethods.map(k=>[k,console[k]]));
for(const k of consoleMethods)console[k]=(...args)=>{logs.push(args.map(String).join(' '));};
const say=text=>process.stdout.write(text+'\n');
const m=await currentSiteFixtureHandlers(),fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID();
const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('No network is allowed');};
const objects=new Map(),FILES={
 get:async key=>{const bytes=objects.get(key);return bytes?{size:bytes.length,arrayBuffer:async()=>bytes.slice().buffer,body:{cancel:async()=>{}}}:null;},
 head:async key=>objects.has(key)?{size:objects.get(key).length}:null,put:async()=>assert.fail('No upload in this suite'),delete:async key=>{objects.delete(key);},list:async()=>({objects:[],truncated:false}),
};
let failNext=null,failAccount=null;const intercepted=interceptDatabase(db,/./,async()=>{},async()=>{});
// Interruption hook: throw once on the next statement/batch whose SQL matches the armed pattern (a lost worker or response).
// failAccount makes every statement bound to that account fail (one broken closure among several in a maintenance pass).
const armedDB={prepare:q=>{const s=intercepted.prepare(q);
 const wrap=(st,v=[])=>{const guard=fn=>async(...a)=>{if(failNext&&failNext.test(q)){failNext=null;throw Error('synthetic interruption');}if(failAccount&&v.includes(failAccount))throw Error('synthetic closure failure');return fn(...a);};
  return {bind:(...n)=>wrap(st.bind(...n),n),first:guard(st.first),all:guard(st.all),run:guard(st.run),__q:q,__s:st,__v:v};};
 return wrap(s);},
 batch:async list=>{if(failNext&&list.some(s=>failNext.test(s.__q))){failNext=null;throw Error('synthetic interruption');}if(failAccount&&list.some(s=>s.__v.includes(failAccount)))throw Error('synthetic closure failure');return intercepted.batch(list.map(s=>s.__s));}};
const env={DB:armedDB,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},FILES};
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
 await run("INSERT INTO github_token_vault(id,user_id,ciphertext,expires_at,state) VALUES('token-a',?,?,'2027-01-01','active')",a.user,ciphertext);
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
  for(const secret of [tokenSecret,ciphertext,a.token,b.token,b.user,b.project,approvedA.key,photoB.file,'object_key','token_hash','ciphertext',a.credential,a.authority])assert.ok(!text.includes(secret),'Export leaked '+secret.slice(0,24));
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
 });

 let closureA;
 await check('closure review and confirmation: exact, fresh passkey, replay-safe; new work and delayed OAuth callbacks stop',async()=>{
  const review=await closureReview(a);
  assert.equal(review.canConfirm,true);assert.equal(review.removes.projects,2);assert.equal(review.removes.connectedProviders,1);
  assert.ok(!JSON.stringify(review).match(/hold|safety|preserv/i),'The review never reveals preservation detail');
  await refused(await confirm(a,review,{confirmation:'yes'}),400,'invalid_request');
  await refused(await confirm(b,review),409,'stale_review');
  // A content change after the review invalidates it.
  const changed=await closureReview(a);await createFixtureProject(a.scope,a.user,'Third '+marker,'Third project');
  await refused(await confirm(a,changed),409,'stale_review');
  const current=await closureReview(a);
  // Interrupted confirmation (lost worker before the batch): nothing committed, the same review confirms afterwards.
  failNext=/INSERT INTO account_closures/;await refused(await confirm(a,current),503,'unavailable');
  assert.equal(await row('SELECT 1 x FROM account_closures WHERE account_id=?',a.user),null);
  const first=await ok(await confirm(a,current));closureA=first.closure.id;assert.equal(closureA,current.id);
  // Provider revocation is pending (no provider configured here): the token stays, marked revoking, and closure waits.
  assert.equal(first.closure.state,'waiting');assert.deepEqual(steps(first),{freeze:'done',withdraw:'done',credentials:'waiting',holds:'pending',operations:'pending',purge:'pending'});
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
  // Export and status stay available while closing; the other tenant is unaffected.
  await exportArchive(a);assert.equal((await ok(await account(a,'closure/status'))).closure.state,'waiting');
  assert.equal((await call(b,'/projects',undefined,'GET')).status,200);
 });

 await check('resume is idempotent and recovers interrupted steps; unresolved operations wait honestly',async()=>{
  // An uncertain AI operation is never released because closure was requested.
  const ai=id();await run("INSERT INTO standard_ai_requests(id,user_id,request_hash,created_at,updated_at) VALUES(?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))",ai,a.user,'a'.repeat(64));
  await run("UPDATE standard_ai_requests SET state='dispatched' WHERE id=?",ai);await run("UPDATE standard_ai_requests SET state='uncertain' WHERE id=?",ai);
  // The provider confirms revocation (the scheduled cleanup removes the token); a lost journal write is then re-run.
  await run("DELETE FROM github_token_vault WHERE id='token-a'");
  failNext=/UPDATE account_closure_steps/;await refused(await account(a,'closure/resume'),503,'unavailable');
  const status=await ok(await account(a,'closure/resume'));
  assert.deepEqual(steps(status),{freeze:'done',withdraw:'done',credentials:'done',holds:'done',operations:'waiting',purge:'pending'});
  assert.equal(status.closure.state,'waiting');assert.equal(status.closure.steps.find(s=>s.step==='operations').detail.unresolvedOperations,1);
  assert.equal((await row('SELECT state FROM standard_ai_requests WHERE id=?',ai)).state,'uncertain');
  const again=await ok(await account(a,'closure/resume'));assert.equal(again.closure.revision,status.closure.revision+1,'A waiting re-run journals only the attempt');
  assert.ok(await row('SELECT 1 x FROM users WHERE id=?',a.user),'Nothing is deleted while operations are unresolved');
  await run("UPDATE standard_ai_requests SET state='completed',input_tokens=1,output_tokens=1 WHERE id=?",ai);
  const inventory=await accountClosureInventory(db,a.user);assert.equal(inventory.readyForDeletion,false);
  // Purge interrupted inside its batch: the users cascade and completed journal roll back together.
  failNext=/DELETE FROM users/;await refused(await account(a,'closure/resume'),503,'unavailable');
  assert.ok(await row('SELECT 1 x FROM users WHERE id=?',a.user));assert.equal((await row('SELECT state FROM account_closures WHERE id=?',closureA)).state,'closing');
  assert.equal((await row("SELECT state FROM account_closure_steps WHERE closure_id=? AND step='purge'",closureA)).state,'pending');
  const done=await ok(await account(a,'closure/resume'));
  assert.equal(done.closure.state,'complete');assert.equal(done.closure.steps.at(-1).detail.primaryAccountRowsDeleted,true);
  assert.equal(done.closure.obligations.cloudflareZonesPreserved,true);assert.equal(done.closure.obligations.restoreSuppression,'ledger-recorded');
 });

 await check('final receipt survives the account cascade; private objects are queued, not silently dropped; other tenant intact',async()=>{
  for(const [table,column] of [['users','id'],['projects','owner_user_id'],['identity_sessions','account_id'],['chat_turns','user_id'],['account_lifecycle_reviews','user_id'],['standard_ai_requests','user_id']])
   assert.equal((await row(`SELECT count(*) n FROM ${table} WHERE ${column}=?`,a.user)).n,0,table);
  const receipt=await row('SELECT * FROM account_closures WHERE id=?',closureA);assert.equal(receipt.state,'complete');assert.ok(receipt.completed_at);
  assert.equal((await rows("SELECT step FROM account_closure_steps WHERE closure_id=? AND state='done' ORDER BY position",closureA)).length,6);
  assert.doesNotMatch(JSON.stringify([receipt,await rows('SELECT * FROM account_closure_steps WHERE closure_id=?',closureA)]),new RegExp(marker+'|example.invalid|gho_'));
  assert.ok(await row('SELECT 1 x FROM file_cleanup WHERE object_key=? AND owner_user_id=?',approvedA.key,a.user),'Deleted photo bytes are queued for the existing private cleanup');
  await assert.rejects(()=>run('DELETE FROM account_closures WHERE id=?',closureA),/account_closure_retained/);
  await assert.rejects(()=>run("UPDATE account_closures SET state='closing',revision=revision+1 WHERE id=?",closureA),/account_closure_immutable/);
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
  await run("INSERT INTO safety_preservation_holds(id,case_id,subject_user_id,scope,project_id,legal_basis_ref,approved_by,placed_at,review_due_at) VALUES(?,?,?,'project',?,'basis-1','human:approver',unixepoch(),unixepoch()+86400)",hold,caseId,c.user,c.project);
  const fresh=await closureReview(c),status=await ok(await confirm(c,fresh));
  assert.equal(status.closure.state,'blocked');assert.equal(steps(status).holds,'blocked');
  assert.deepEqual(status.closure.steps.find(s=>s.step==='holds').detail,{reason:'retention_review',support:true});
  assert.doesNotMatch(JSON.stringify(status),/case-|hold-|basis|safety/);
  assert.equal((await ok(await account(c,'closure/resume'))).closure.state,'blocked');assert.ok(await row('SELECT 1 x FROM projects WHERE id=?',c.project));
  await run("UPDATE safety_preservation_holds SET released_at=unixepoch(),released_by='human:approver',release_ref='release-1' WHERE id=?",hold);
  assert.equal((await ok(await account(c,'closure/resume'))).closure.state,'complete');
  assert.equal(await row('SELECT 1 x FROM users WHERE id=?',c.user),null);assert.ok(await row('SELECT 1 x FROM safety_cases WHERE id=?',caseId),'Case records stay outside the cascade');
 });

 await check('owner teardown actions block confirmation; retained finance records stop the purge for an operator',async()=>{
  const d=await owner();
  await run('INSERT INTO backend_form_settings(project_id,revision) VALUES(?,0)',d.project);
  const blocked=await closureReview(d);assert.equal(blocked.canConfirm,false);assert.deepEqual(blocked.requiredBeforeClosure.map(r=>r.id),['backendFormSettings']);
  await refused(await confirm(d,blocked),409,'action_required');assert.equal(await row('SELECT 1 x FROM account_closures WHERE account_id=?',d.user),null);
  await run('DELETE FROM backend_form_settings WHERE project_id=?',d.project);
  await run("INSERT INTO gateway_spend_buckets(id,scope,user_id,limit_micros) VALUES(?,'account',?,1000)",id(),d.user);
  const status=await ok(await confirm(d,await closureReview(d)));
  assert.equal(status.closure.state,'blocked');assert.equal(steps(status).purge,'blocked');assert.equal(status.closure.steps.at(-1).detail.reason,'retained_records');
  assert.ok(await row('SELECT 1 x FROM users WHERE id=?',d.user),'Retained finance records are never deleted by implication');
 });

 await check('maintenance continues waiting closures without the owner: holds block, failures are isolated, re-runs are idempotent',async()=>{
  const e=await owner(),f=await owner(),g=await owner();
  await run("INSERT INTO github_token_vault(id,user_id,ciphertext,expires_at,state) VALUES('token-e',?,?,'2027-01-01','active')",e.user,await fixtureCiphertext(fixtureKeyring(),`whumpo:github:token:${e.user}:token-e`,'gho_SYNTHETIC_E'));
  const ai=id();await run("INSERT INTO standard_ai_requests(id,user_id,request_hash,created_at,updated_at) VALUES(?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))",ai,f.user,'b'.repeat(64));
  await run("UPDATE standard_ai_requests SET state='dispatched' WHERE id=?",ai);await run("UPDATE standard_ai_requests SET state='uncertain' WHERE id=?",ai);
  const hold=async(o,scope)=>{const caseId='case-bg-'+id().slice(0,8),holdId='hold-bg-'+id().slice(0,8);
   await run("INSERT INTO safety_cases(id,subject_user_id,intake_ref,opened_by,opened_at,retention_due_at) VALUES(?,?,'intake-1','human:reviewer',unixepoch(),unixepoch()+31536000)",caseId,o.user);
   await run("INSERT INTO safety_preservation_holds(id,case_id,subject_user_id,scope,project_id,legal_basis_ref,approved_by,placed_at,review_due_at) VALUES(?,?,?,?,?,'basis-1','human:approver',unixepoch(),unixepoch()+86400)",holdId,caseId,o.user,scope,scope==='account'?null:o.project);
   return ()=>run("UPDATE safety_preservation_holds SET released_at=unixepoch(),released_by='human:approver',release_ref='release-1' WHERE id=?",holdId);};
  const releaseG=await hold(g,'project');
  const se=await ok(await confirm(e,await closureReview(e))),sf=await ok(await confirm(f,await closureReview(f))),sg=await ok(await confirm(g,await closureReview(g)));
  assert.equal(steps(se).credentials,'waiting');assert.equal(steps(sf).operations,'waiting');assert.equal(steps(sg).holds,'blocked');
  assert.equal(se.closure.steps.find(s=>s.step==='credentials').origin,'owner');
  const closure=o=>row('SELECT * FROM account_closures WHERE account_id=?',o.user),step=(o,name)=>row("SELECT s.* FROM account_closure_steps s JOIN account_closures c ON c.id=s.closure_id WHERE c.account_id=? AND s.step=?",o.user,name);
  const health=async()=>({...await row("SELECT status,failure_category FROM maintenance_health WHERE job='account_closures'")});
  const hourly=async()=>{try{await m.worker.scheduled({cron:'47 * * * *'},env);}catch(error){assert.match(String(error),/Scheduled maintenance or telemetry failed/);}return health();};
  // The provider confirms e's revocation (scheduled connection cleanup removed the token); nobody presses resume.
  await run("DELETE FROM github_token_vault WHERE id='token-e'");
  // Pass 1: e's closure fails mid-pass. It is untouched; the others are still re-checked and journaled; health reports failure.
  const fBefore=await step(f,'operations');failAccount=e.user;
  assert.deepEqual(await hourly(),{status:'failed',failure_category:'job_failed'});failAccount=null;
  assert.equal((await step(e,'credentials')).state,'waiting');assert.ok(await row('SELECT 1 x FROM users WHERE id=?',e.user));
  const fAfter=await step(f,'operations');assert.equal(fAfter.state,'waiting');assert.equal(fAfter.attempts,fBefore.attempts+1);assert.equal(fAfter.last_origin,'maintenance');
  assert.equal((await row('SELECT state FROM standard_ai_requests WHERE id=?',ai)).state,'uncertain','The continuation never releases an unresolved operation');
  assert.equal((await step(g,'holds')).state,'blocked');assert.equal((await step(g,'holds')).last_origin,'maintenance');assert.ok(await row('SELECT 1 x FROM projects WHERE id=?',g.project),'Never purged under hold');
  // Pass 2: e advances to completion through the same journaled steps, without any session.
  assert.equal((await hourly()).status,'completed');
  const ce=await closure(e);assert.equal(ce.state,'complete');assert.equal(await row('SELECT 1 x FROM users WHERE id=?',e.user),null);
  assert.equal((await step(e,'purge')).last_origin,'maintenance');assert.equal((await step(e,'credentials')).last_origin,'maintenance');
  assert.ok(await row("SELECT 1 x FROM restore_suppressions WHERE kind='account' AND subject_id=?",e.user),'The purge records the same suppression entry');
  assert.equal((await closure(g)).state,'blocked');assert.ok(await row('SELECT 1 x FROM users WHERE id=?',g.user));
  // Idempotent re-run: a completed receipt is never selected or changed again.
  await hourly();assert.equal((await closure(e)).revision,ce.revision);assert.equal((await closure(e)).updated_at,ce.updated_at);
  // A hold placed after the holds step finished still stops the purge (f); release lets the next pass finish.
  const releaseF=await hold(f,'account');await run("UPDATE standard_ai_requests SET state='completed',input_tokens=1,output_tokens=1 WHERE id=?",ai);
  await hourly();
  assert.equal((await step(f,'operations')).state,'done');const purgeF=await step(f,'purge');assert.equal(purgeF.state,'blocked');
  assert.deepEqual(JSON.parse(purgeF.detail_json),{reason:'retention_review',support:true});assert.ok(await row('SELECT 1 x FROM users WHERE id=?',f.user),'Never purged under hold');
  await releaseF();await releaseG();
  // Two overlapping continuation passes (and an owner resume) after release: compare-and-swap journal, one purge each.
  const results=await Promise.all([m.continueAccountClosures(env),m.continueAccountClosures(env),account(g,'closure/resume')]);
  // The owner sees the receipt, or (when the background purged the account mid-request) an honest session refusal.
  {const r=results[2],body=await r.json();assert.ok(r.status===200&&body.closure.state==='complete'||[401,409].includes(r.status)&&['proof_required','identity_changed'].includes(body.code),r.status+' '+JSON.stringify(body));}
  for(const o of [f,g]){assert.equal((await closure(o)).state,'complete');assert.equal(await row('SELECT 1 x FROM users WHERE id=?',o.user),null);
   assert.equal((await rows("SELECT step FROM account_closure_steps s JOIN account_closures c ON c.id=s.closure_id WHERE c.account_id=? AND s.state='done'",o.user)).length,6);}
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
