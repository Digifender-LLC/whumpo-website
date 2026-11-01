import assert from 'node:assert/strict';
import {backup,DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {build} from 'esbuild';
import {authenticator} from './app-authenticator.mjs';
import {sqliteD1Adapter} from './sqlite-d1.mjs';
import {currentSiteFixtureHandlers,createFixtureProject,configureFixtureModules,enableFixtureVisitorAccess} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {initializeFixtureKeys,fixtureKeyring,fixtureCiphertext} from './helpers/connection-keyring.mjs';
import {createHash} from 'node:crypto';
Error.stackTraceLimit=process.env.TRACE?20:0;
// WH-019 restore-safe erasure and revocation suppression. Actual handlers (account closure routes, owner and visitor
// erasure, visitor revocation, staff role reviews, owner record removal, provider disconnect routes, recovery points) populate
// the content-free ledger; logical restores of older rows are refused inside their commits; and an isolated
// whole-database candidate restored from a backup taken BEFORE those actions is reconciled by the operator replay
// before any handler serves it. Disposable SQLite by default (including the backup candidate, as in
// tests/restore-admission.mjs); local D1 with --d1 covers population and in-commit guards on the live database.
// Synthetic identities and values only; no provider, model or network.
const logs=[],consoleMethods=['log','info','warn','error','debug'],originals=Object.fromEntries(consoleMethods.map(k=>[k,console[k]]));
for(const k of consoleMethods)console[k]=(...args)=>{logs.push(args.map(String).join(' '));};
const d1=process.argv.includes('--d1'),m=await currentSiteFixtureHandlers(),fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID();
const built=await build({stdin:{contents:`export * as suppression from './src/restore-suppression.ts';`,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {suppression:s}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const {currentSchema}=await import('../tools/current-schema.mjs');
// The trigger set of the current schema artifact: what a reconciled candidate must carry exactly.
const artifactTriggers=await (async()=>{const sql=new DatabaseSync(':memory:');try{sql.exec(await currentSchema());return sql.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'").all();}finally{sql.close();}})();
const expected={triggerSha256:await s.triggerSetDigest(artifactTriggers)};
const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('No network or inference is available');};
const row=(q,...p)=>db.prepare(q).bind(...p).first(),run=(q,...p)=>db.prepare(q).bind(...p).run();
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(error){originals.error(name);throw error;}};
const {appAuth:auth,appGateway,appLifecycle,appData:data,appActivation:activationApi,appDocumentRecovery:recovery,backend}=m;
const runtime={fetch:async(_url,init)=>Response.json({ok:true,value:{state:JSON.parse(init.body).input.input??{},result:{}}})};
const baseEnv={ENVIRONMENT:'test',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})},BACKEND_RUNTIME:runtime,FILES:{get:async()=>null,head:async()=>null,delete:async()=>{},list:async()=>({objects:[],truncated:false}),put:async()=>assert.fail('No upload')}};
const env={...baseEnv,DB:db};
const pins=kind=>{const e=m.moduleCatalog.find(x=>x.kind===kind);return {module:{...e.module},schema:{...e.schema}};};
const marker='SUPPRESSION-PRIVATE-'+id().slice(0,8);
const accessInstance={id:'members',kind:'access',...pins('access'),dependencies:[],config:{roles:['staff'],enrollment:'invitation'}};
const recordsInstance={id:'requests',kind:'records',...pins('records'),dependencies:['members'],config:{retentionDays:30,
 schemas:[{id:'request',fieldsRevision:1,fields:[{key:'name',label:'Name',type:'text',optional:false,read:'owner'}],staffWrite:[]}],
 forms:[{id:'request-form',recordId:'request',submit:'visitor',uploadCollectionId:null}],views:[]}};
async function owner(){
 const actor=await workspaceFixture(db,m),scope=await actor.scope(),user=actor.account;
 const site=await createFixtureProject(scope,user,'Studio '+marker,'Neighborhood studio');
 for(const feature of ['core.editing','core.forms'])for(const operation of ['prepare','confirm'])
  await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,?,?,'private-test-acceptance','synthetic WH-019 fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),user,site.project,feature,operation);
 return {...actor,actorScope:actor.scope,scope,user,...site,host:'https://app-'+site.project+'.whumpo.site'};
}
async function visitor(o){
 const invite=await auth.createAppInvitation(o.scope,o.user,o.project),options=await auth.appPasskeyOptions(db,o.project,'signup',false,invite.code),key=authenticator();
 const result=await auth.appPasskeyVerify(db,o.project,'signup',options.challengeToken,key.registration(options.options),false);
 return {...result,cookie:`__Host-whumpo-app-session-${o.project}=${result.session}`};
}
const revision=async o=>(await m.readChat(o.scope,o.user)).state.revision;
async function control(o,action){const turn=id();return {id:turn,...await m.sendChatControl(o.scope,o.user,{id:turn,revision:await revision(o),action})};}
async function activate(o,instanceId){
 const r=await control(o,{type:'moduleActivationReview',projectId:o.project,instanceId,action:'activate'});assert.equal(r.status,200,r.error);
 const saved=await row('SELECT * FROM module_activation_reviews WHERE id=?',r.id);
 const a=await control(o,{type:'moduleActivationApply',reviewId:saved.id,reviewDigest:saved.review_digest,expectedRevision:saved.expected_activation_revision});assert.equal(a.status,200,a.error);
}
async function setRole(o,visitorId,action){
 const r=await control(o,{type:'accessRoleReview',projectId:o.project,instanceId:'members',visitorId,action});assert.equal(r.status,200,r.error);
 const review=await row('SELECT * FROM module_access_role_reviews WHERE id=?',r.id);
 return control(o,{type:'accessRoleApply',reviewId:review.id,reviewDigest:review.review_digest,expectedRevision:review.expected_access_revision});
}
const instance=(o,localId)=>row('SELECT i.* FROM module_instances i WHERE i.project_id=? AND i.local_id=?',o.project,localId);
const envelope=(resource,operation,{target=null,input=null}={})=>({api:'whumpo-modules',version:1,operation,resourceId:resource.id,configRevision:resource.config_revision,requestId:m.modulePolicy.moduleOperations[operation].write?id():null,target,input});
async function gateway(o,payload,v,environment=env){
 const response=await appGateway.applicationGateway(new Request(o.host+'/modules',{method:'POST',headers:{'cf-connecting-ip':'192.0.2.9','content-type':'application/json',origin:o.host,cookie:v?.cookie??''},body:JSON.stringify(payload)}),environment);
 return {status:response.status,body:await response.json()};
}
async function workspace(o,path,payload,environment=env){
 const response=await m.worker.fetch(new Request('https://whumpo.com'+path,{method:'POST',headers:{cookie:`__Host-whumpo_session=${o.token}`,origin:'https://whumpo.com','content-type':'application/json'},body:JSON.stringify(payload)}),environment,{waitUntil(){}});
 return {status:response.status,body:await response.json()};
}
const refused=async(promise,pattern=/restore_suppressed/)=>assert.rejects(promise,e=>{assert.match(String(e?.message??e),pattern);return true;});
const ledger=async(kind,subject)=>(await db.prepare('SELECT effect,revision FROM restore_suppressions WHERE kind=? AND subject_id=? ORDER BY effect').bind(kind,subject).all()).results;
async function insertRow(database,table,value){const keys=Object.keys(value);return database.prepare(`INSERT INTO ${table}(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).bind(...keys.map(k=>value[k])).run();}

let directory=null,candidateSQL=null;
try{
 await initializeFixtureKeys(db);
 // Operator-only: no Worker, route, Chat control or agent module imports the replay.
 {const {readdir,readFile}=await import('node:fs/promises');for(const f of (await readdir('src',{recursive:true})).filter(f=>/\.ts$/.test(f)&&f!=='restore-suppression.ts'))assert.ok(!(await readFile('src/'+f,'utf8')).includes('restore-suppression'),f);}
 // Owner A: access (staff role) and records instances; staff, revoked, self-erased and record-removed visitors.
 const a=await owner();
 await configureFixtureModules(a.scope,a.user,a.project,[accessInstance,recordsInstance]);await activate(a,'members');await activate(a,'requests');
 const records=await instance(a,'requests'),staff=await visitor(a),revoked=await visitor(a),erased=await visitor(a),kept=await visitor(a);
 assert.equal((await setRole(a,staff.visitorId,'grant')).status,200);
 for(const v of [revoked,erased,kept]){const r=await gateway(a,envelope(records,'forms.submit',{target:{formId:'request-form'},input:{values:{name:marker+' '+v.visitorId.slice(0,4)}}}),v);assert.equal(r.status,200,JSON.stringify(r.body));}
 const recordOf=v=>row('SELECT * FROM module_records WHERE visitor_id=?',v.visitorId);
 const removedRecord=await recordOf(kept),erasedRecord=await recordOf(erased);
 // Provider credentials (synthetic ciphertext under the fixture keyring).
 const keyring=fixtureKeyring(),githubToken='gh-'+id(),cloudflareToken='cf-'+id();
 await run("INSERT INTO github_token_vault(id,user_id,ciphertext,expires_at,state) VALUES(?,?,?,'2027-01-01','active')",githubToken,a.user,await fixtureCiphertext(keyring,`whumpo:github:token:${a.user}:${githubToken}`,'gho_SYNTHETIC_'+marker));
 await run("INSERT INTO cloudflare_token_vault(id,user_id,ciphertext,expires_at,created_at,state) VALUES(?,?,?,'2027-01-01',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'active')",cloudflareToken,a.user,await fixtureCiphertext(keyring,`whumpo:cloudflare:token:${a.user}:${cloudflareToken}`,'cf_SYNTHETIC_'+marker));
 // Owner C closes the account; it owns a project with a stored photo row.
 const c=await owner(),photo=id();
 await run("INSERT INTO project_files(id,project_id,name,object_key,digest,size,width,height,status,created_at) VALUES(?,?,'garden.jpg',?,?,4,10,10,'ready',strftime('%Y-%m-%dT%H:%M:%fZ','now'))",photo,c.project,`photos/${c.project}/${photo}.jpg`,'a'.repeat(64));
 // Owner D: a visitor application with a recovery point holding two visitors' documents.
 const dActor=await workspaceFixture(db,m),dScope=await dActor.scope(),dUser=dActor.account,dProject=id(),dVersion=id(),dRun=id();
 await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Recovery','','draft',strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'))",dProject,dUser);
 await backend.saveBackend(dScope,dUser,dProject,dVersion,'export default ({state,input})=>({state:input,result:"saved"})');await backend.testBackend(dScope,runtime,dUser,dProject,dVersion,dRun,{state:{},input:{}});
 await enableFixtureVisitorAccess(dScope,dUser,dProject);
 const toggle=async enabled=>{const review=id();await activationApi.prepareApplication(dScope,dUser,dProject,review,enabled?'enable':'disable',enabled?dVersion:null,enabled?dRun:null);await activationApi.confirmApplication(dScope,dUser,review);};
 await toggle(true);
 const appVisitor=async()=>{const v=id();await run("INSERT INTO app_visitors(id,project_id,access_id) SELECT ?,?,id FROM module_instances WHERE project_id=? AND kind='access'",v,dProject,dProject);return {id:v,token:await data.issueAppSession(db,v)};};
 const docKeep=await appVisitor(),docRevoked=await appVisitor();
 await data.transitionAppData(db,runtime,docKeep.token,dProject,id(),0,{note:'keep'});await data.transitionAppData(db,runtime,docRevoked.token,dProject,id(),0,{note:marker});
 const point=id();await recovery.createRecoveryPoint(dScope,dUser,dProject,point);
 // A second GitHub token (still `revoking`, never deleted, in the live source) and a Cloudflare row read before any change.
 const githubToken2='gh2-'+id();
 await run("INSERT INTO github_token_vault(id,user_id,ciphertext,expires_at,state) VALUES(?,?,?,'2027-01-01','active')",githubToken2,a.user,await fixtureCiphertext(keyring,`whumpo:github:token:${a.user}:${githubToken2}`,'gho_SYNTHETIC2_'+marker));
 const ghConfig={clientId:'restore-client',clientSecret:'synthetic-secret',appId:123,slug:'fixture',key:keyring};
 // Owner X is closed completely after the backup: a photo referenced by a saved version, GitHub refresh custody, an unsettled hostname and a preservation hold that is released after the backup.
 const x=await owner(),xPhoto=id(),placeHold=async(subject,project)=>{const caseId='case-r-'+id().slice(0,8),holdId='hold-r-'+id().slice(0,8);
  await run("INSERT INTO safety_cases(id,subject_user_id,intake_ref,opened_by,opened_at,retention_due_at) VALUES(?,?,'intake-1','human:reviewer',unixepoch(),unixepoch()+31536000)",caseId,subject);
  await run("INSERT OR IGNORE INTO safety_case_roles(id,operator_ref,role,granted_by,granted_at) VALUES('grant-test-approver','human:approver','preservation_approver','human:test-administrator',unixepoch())");
  await run("INSERT INTO safety_preservation_holds(id,case_id,subject_user_id,scope,project_id,legal_basis_ref,approved_by,placed_at,review_due_at) VALUES(?,?,?,'project',?,'basis-1','human:approver',unixepoch(),unixepoch()+86400)",holdId,caseId,subject,project);
  return ()=>run("UPDATE safety_preservation_holds SET released_at=unixepoch(),released_by='human:approver',release_ref='release-1' WHERE id=?",holdId);};
 await run("INSERT INTO project_files(id,project_id,name,object_key,digest,size,width,height,status,created_at) VALUES(?,?,'x.jpg',?,?,4,10,10,'ready',strftime('%Y-%m-%dT%H:%M:%fZ','now'))",xPhoto,x.project,`photos/${x.project}/${xPhoto}.jpg`,'b'.repeat(64));
 await run("UPDATE project_photo_safety SET state='approved',csam_check='clear',sexual_check='clear',scanner_reference='synthetic-clearance',expires_at=? WHERE file_id=?",new Date(Date.now()+3600000).toISOString(),xPhoto);
 await run("INSERT INTO version_photos(version_id,file_id,position,alt) VALUES(?,?,0,'Garden')",x.version,xPhoto);
 await run("INSERT INTO feature_preview_grants VALUES(?,1,?,NULL,'connections.github','connect','private-test-acceptance','synthetic WH-019 fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),x.user);
 {const start=await m.githubConnection.startGitHub(x.scope,x.user,ghConfig);
  await m.githubConnection.finishGitHub(x.scope,x.user,new URL(start.url).searchParams.get('state'),'synthetic-code',ghConfig,async url=>{
   if(url.endsWith('/access_token'))return Response.json({access_token:'ghu_SYNTHETIC_'+id().replaceAll('-',''),expires_in:3600,refresh_token:'ghr_SYNTHETIC_'+id().replaceAll('-',''),refresh_token_expires_in:15897600});
   if(url.endsWith('/user'))return Response.json({id:4242,login:'restore-fixture'});
   if(url.endsWith('/token'))return new Response(null,{status:204});
   assert.fail('Unexpected provider call');});}
 assert.ok(await row('SELECT 1 x FROM github_refresh_custody WHERE user_id=?',x.user),'refresh custody exists in the backup');
 {const claim=id(),conn=id(),host='restore-'+claim.slice(0,8)+'.example.test',exp=new Date(Date.now()+3600000).toISOString(),stamp=new Date().toISOString();
  await run("INSERT INTO domain_claims(id,project_id,hostname,token,expires_at,created_at) VALUES(?,?,?,'t',?,?)",claim,x.project,host,exp,stamp);
  await run("INSERT INTO domain_connections(id,user_id,claim_id,project_id,hostname,zone_id,target,proof_hash,state,created_at,expires_at) VALUES(?,?,?,?,?,'zone-1','target.example.test',?,'review',?,?)",conn,x.user,claim,x.project,host,'a'.repeat(64),stamp,exp);
  await run("UPDATE domain_connections SET state='creating' WHERE id=?",conn);x.conn=conn;}
 const releaseX=await placeHold(x.user,x.project);
 // Older rows a logical restore would replay, read before any erasure.
 const before={user:await row('SELECT * FROM users WHERE id=?',c.user),project:await row('SELECT * FROM projects WHERE id=?',c.project),file:await row('SELECT * FROM project_files WHERE id=?',photo),
  xuser:await row('SELECT * FROM users WHERE id=?',x.user),cloudflare:await row('SELECT * FROM cloudflare_token_vault WHERE id=?',cloudflareToken),visitor:await row('SELECT * FROM app_visitors WHERE id=?',erased.visitorId),record:removedRecord,github:await row('SELECT * FROM github_token_vault WHERE id=?',githubToken),grant:await row('SELECT * FROM module_access_roles WHERE visitor_id=?',staff.visitorId)};
 // The backup: an exact copy of the database before any erasure or revocation (SQLite mode).
 if(fixture.sql){directory=await mkdtemp('/tmp/whumpo-restore-suppression-');await backup(fixture.sql,join(directory,'before.sqlite'));}

 await check('erasure, closure and revocation paths populate the content-free ledger inside their commits',async()=>{
  assert.equal((await setRole(a,staff.visitorId,'revoke')).status,200);
  await auth.revokeAppVisitor(a.scope,a.user,a.project,revoked.visitorId);
  const review=await appLifecycle.prepareAppDeletion(db,erased.session,a.project);await appLifecycle.deleteAppAccount(db,erased.session,a.project,review.id,review.revision,'DELETE');
  const removal=await workspace(a,`/api/projects/${a.project}/modules`,envelope(records,'records.remove',{target:{recordId:'request',entryId:removedRecord.id}}));assert.equal(removal.status,200,JSON.stringify(removal.body));
  for(const provider of ['github','cloudflare']){const r=await workspace(a,`/api/connections/${provider}/disconnect`,{});assert.equal(r.status,200,JSON.stringify(r.body));}
  await auth.revokeAppVisitor(dScope,dUser,dProject,docRevoked.id);
  // Closure through the actual routes: the purge cascade records the account, project and photo.
  const call=(path,payload)=>workspace(c,'/api/account/v1/'+path,{version:1,...payload});
  const prepared=(await call('closure/prepare',{requestId:id()})).body.review;
  const done=await call('closure/confirm',{reviewId:prepared.id,reviewDigest:prepared.digest,confirmation:'close-account'});assert.equal(done.body.closure?.state,'complete',JSON.stringify(done.body));
  const subject=`${(await instance(a,'members')).id}/${staff.visitorId}/staff`;
  assert.deepEqual((await ledger('staff',subject)).map(r=>r.effect),['revoked']);assert.ok((await ledger('staff',subject))[0].revision>before.grant.access_revision);
  assert.deepEqual((await ledger('visitor',revoked.visitorId)).map(r=>r.effect),['revoked']);
  assert.deepEqual((await ledger('visitor',erased.visitorId)).map(r=>r.effect),['deleted']);
  assert.deepEqual((await ledger('record',erasedRecord.id)).map(r=>r.effect),['deleted'],'Cascaded record erasure is recorded');
  assert.deepEqual((await ledger('record',removedRecord.id)).map(r=>r.effect),['deleted']);
  assert.deepEqual((await ledger('github_token',githubToken)).map(r=>r.effect),['revoked']);assert.deepEqual((await ledger('cloudflare_token',cloudflareToken)).map(r=>r.effect),['revoked']);
  for(const [kind,subjectId] of [['account',c.user],['project',c.project],['file',photo]])assert.deepEqual((await ledger(kind,subjectId)).map(r=>r.effect),['deleted'],kind);
  assert.deepEqual((await ledger('visitor',docRevoked.id)).map(r=>r.effect),['revoked']);
  // X is closed completely after the backup: the hold is released, the app-wide GitHub access removed through the reviewed route, the hostname disconnected.
  await releaseX();
  { // The reviewed app-wide revocation (its provider call is not made here): the settled grant record is the evidence the custody delete needs.
   const custody=await row('SELECT token_id,client_id,github_user_id FROM github_refresh_custody WHERE user_id=?',x.user),trigger=await row("SELECT sql FROM sqlite_master WHERE name='github_grant_review'"),stamp=new Date().toISOString();
   await run('DROP TRIGGER github_grant_review');
   try{await run("INSERT INTO github_grant_revocations(id,user_id,client_id,github_user_id,login,token_id,token_ids,state,created_at,expires_at,dispatched_at,settled_at,http_status) VALUES(?,?,?,?,'restore-fixture',?,?,'revoked',?,?,?,?,204)",id(),x.user,custody.client_id,custody.github_user_id,custody.token_id,JSON.stringify([custody.token_id]),stamp,stamp,stamp,stamp);}finally{await run(trigger.sql);}
   await run('UPDATE github_connections SET active_token_id=NULL WHERE user_id=?',x.user);await run('DELETE FROM github_refresh_custody WHERE user_id=?',x.user);await run('DELETE FROM github_token_vault WHERE user_id=?',x.user);}
  await run("UPDATE domain_connections SET state='disconnecting' WHERE id=?",x.conn);await run("UPDATE domain_connections SET state='disconnected' WHERE id=?",x.conn);
  {const xcall=(path,payload)=>workspace(x,'/api/account/v1/'+path,{version:1,...payload}),prepared=(await xcall('closure/prepare',{requestId:id()})).body.review;
   const done=await xcall('closure/confirm',{reviewId:prepared.id,reviewDigest:prepared.digest,confirmation:'close-account'});assert.equal(done.body.closure?.state,'complete',JSON.stringify(done.body));}
  // The provider confirms the GitHub revocation (the scheduled cleanup removes the row): a second, deleted entry.
  await run('DELETE FROM github_token_vault WHERE id=?',githubToken);assert.deepEqual((await ledger('github_token',githubToken)).map(r=>r.effect),['deleted','revoked']);
  const capture=await s.captureRestoreSuppressions(db),text=JSON.stringify(capture);
  assert.ok(!text.includes(marker)&&!text.includes('gho_')&&!text.includes('garden'),'Ledger is content-free');
  assert.ok(capture.entries.every(e=>Object.keys(e).sort().join()==='effect,kind,recordedAt,revision,subjectId'));
  await refused(run("UPDATE restore_suppressions SET effect='revoked' WHERE kind='account' AND subject_id=?",c.user),/restore_suppression_immutable/);
  await refused(run("DELETE FROM restore_suppressions WHERE kind='account' AND subject_id=?",c.user),/restore_suppression_retained/);
 });

 await check('logical restores of older rows are refused inside their commits; later owner decisions still work',async()=>{
  await refused(insertRow(db,'users',before.user));await refused(insertRow(db,'projects',{...before.project,owner_user_id:a.user}));
  await refused(insertRow(db,'project_files',{...before.file,project_id:a.project}));
  await refused(insertRow(db,'app_visitors',before.visitor));await refused(insertRow(db,'module_records',before.record));
  await refused(insertRow(db,'github_token_vault',{...before.github,user_id:a.user}));
  await refused(run('UPDATE app_visitors SET revoked=0 WHERE id=?',revoked.visitorId));
  await refused(run("UPDATE cloudflare_token_vault SET state='active' WHERE id=?",cloudflareToken));
  await refused(run("UPDATE module_access_roles SET state='granted',review_id=?,access_revision=? WHERE visitor_id=?",before.grant.review_id,before.grant.access_revision,staff.visitorId));
  assert.equal((await gateway(a,envelope(await instance(a,'members'),'access.me'),revoked)).body.code,'forbidden');
  // A new exact owner review grants again: it carries a newer access revision than the revocation.
  assert.equal((await setRole(a,staff.visitorId,'grant')).status,200);assert.equal((await row('SELECT state FROM module_access_roles WHERE visitor_id=?',staff.visitorId)).state,'granted');
  assert.equal((await setRole(a,staff.visitorId,'revoke')).status,200);
  const subject=`${(await instance(a,'members')).id}/${staff.visitorId}/staff`;assert.equal((await ledger('staff',subject))[0].revision,(await row('SELECT access_revision FROM module_access_roles WHERE visitor_id=?',staff.visitorId)).access_revision,'The ledger keeps the newest revocation revision');
  // Recovery points never captured the revoked visitor's document again, and the live restore excludes them.
  await toggle(false);const review=id();assert.equal((await recovery.prepareAppRestore(dScope,dUser,dProject,point,review)).documents,1);
  // The live database already satisfies its own ledger: the gate is clear and the replay statements change nothing.
  const live=await s.captureRestoreSuppressions(db);assert.equal((await s.checkRestoreSuppressions(db,live,expected)).clear,true);
  // The replay refuses to run on its own source, and without a named candidate.
  await assert.rejects(s.replayRestoreSuppressions(db,live,{source:db,name:'live'}),/own source/);
  await assert.rejects(s.replayRestoreSuppressions(Object.create(db),live,{source:db,name:' '}),/Name the isolated candidate/);
  await assert.rejects(s.replayRestoreSuppressions(Object.create(db),{...live,entries:live.entries.slice(1)},{source:db,name:'t'}),/changed/);
 });

 if(fixture.sql)await check('an older whole-database backup is reconciled by the replay before any handler serves it',async()=>{
  const current=await s.captureRestoreSuppressions(db);
  candidateSQL=new DatabaseSync(join(directory,'before.sqlite'));candidateSQL.exec('PRAGMA foreign_keys=ON');
  const candidate=sqliteD1Adapter(candidateSQL),cenv={...baseEnv,DB:candidate},crow=(q,...p)=>candidate.prepare(q).bind(...p).first();
  // The restored copy is the old state: every erased or revoked subject is back.
  assert.ok(await crow('SELECT 1 x FROM users WHERE id=?',c.user));assert.ok(await crow('SELECT 1 x FROM app_visitors WHERE id=? AND revoked=0',revoked.visitorId));
  assert.equal((await crow("SELECT state FROM github_token_vault WHERE id=?",githubToken)).state,'active');
  let gate=await s.checkRestoreSuppressions(candidate,current,expected);assert.equal(gate.clear,false);
  for(const kind of ['account','project','visitor','staff','record','file','github_token','cloudflare_token'])assert.ok(gate.pending[kind]>0,kind);
  // Inside a restore commit: with the current ledger merged but not yet applied, the recovery point holding the revoked
  // visitor's older document copy is refused, and a saved version cannot point at the erased photo.
  const dCandidate=await dActor.scope(candidate);{const review=id();await activationApi.prepareApplication(dCandidate,dUser,dProject,review,'disable',null,null);await activationApi.confirmApplication(dCandidate,dUser,review);}
  // Without the current ledger the older copy would restore both visitors' documents, including the revoked one.
  const early=id();assert.equal((await recovery.prepareAppRestore(dCandidate,dUser,dProject,point,early)).documents,2);
  await candidate.prepare("INSERT OR IGNORE INTO restore_suppressions(kind,subject_id,effect,revision,recorded_at) SELECT json_extract(value,'$.kind'),json_extract(value,'$.subjectId'),json_extract(value,'$.effect'),json_extract(value,'$.revision'),json_extract(value,'$.recordedAt') FROM json_each(?)").bind(JSON.stringify(current.entries)).run();
  await assert.rejects(recovery.prepareAppRestore(dCandidate,dUser,dProject,point,id()),e=>e.status===409);
  await assert.rejects(recovery.confirmAppRestore(dCandidate,dUser,dProject,early,'RESTORE'),e=>e.status===409);assert.equal((await candidate.prepare('SELECT status FROM app_restore_reviews WHERE id=?').bind(early).first()).status,'pending');
  await refused(candidate.prepare("UPDATE app_restore_reviews SET status='applied' WHERE id=?").bind(early).run());
  await refused(candidate.prepare('INSERT INTO version_photos(version_id,file_id,position,alt) SELECT id,?,0,? FROM site_versions WHERE project_id=? LIMIT 1').bind(photo,'Garden',c.project).run());
  // The older backup also points the GitHub connection at a token that was revoked later.
  await candidate.prepare("INSERT INTO github_connections(user_id,github_user_id,login,active_token_id,connected_at) VALUES(?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))").bind(a.user,'4242','fixture',githubToken2).run();
  assert.ok(await crow('SELECT 1 x FROM users WHERE id=?',x.user),'X is back in the backup');
  // The older backup still holds rows that closure had to clear before it could purge (RESTRICT / NO ACTION children of the closed account and its project):
  // the replay removes them with the account instead of failing on the foreign key every time.
  await candidate.prepare("INSERT INTO gateway_spend_buckets(id,scope,user_id,limit_micros) VALUES(?,'account',?,1000)").bind('bucket-'+c.user,c.user).run();
  await candidate.prepare('INSERT INTO backend_form_settings(project_id,revision) VALUES(?,0)').bind(c.project).run();
  // A child of a child: the attempt references the user and three buckets, so it has to go before its account bucket does.
  await candidate.prepare("INSERT INTO gateway_spend_buckets(id,scope,user_id,task_id,limit_micros) VALUES(?,'task',?,'t',1000)").bind('task-'+c.user,c.user).run();
  await candidate.prepare("INSERT OR IGNORE INTO gateway_spend_buckets(id,scope,limit_micros) VALUES('platform-restore-test','platform',1000)").run();
  await candidate.prepare("INSERT INTO gateway_spend_attempts(id,user_id,task_id,snapshot,task_bucket,account_bucket,platform_bucket,provider_reserved,customer_reserved) VALUES(?,?,'t',?,?,?,?,0,0)").bind('attempt-'+c.user,c.user,JSON.stringify({ownerId:c.user,taskId:'t',providerReservationMicros:0,customerReservationMicros:0,role:'ack',tier:'standard',inputBound:1,outputBound:1,rate:{inputMicrosPerMillion:0,outputMicrosPerMillion:0},extraMicrosPerCall:0,rateValidUntil:Date.now()+86400000}),'task-'+c.user,'bucket-'+c.user,'platform-restore-test').run();
  // The replay applies the current ledger atomically; a duplicate replay changes nothing.
  const replay=await s.replayRestoreSuppressions(candidate,current,{source:db,name:'older backup candidate'});
  assert.equal(replay.applied.accountsRemoved,2);assert.equal(replay.applied.visitorsRevoked,3,'Revoked visitors, and erased ones before their removal');assert.equal(replay.applied.visitorsRemoved,1);assert.equal(replay.applied.staffGrantsRevoked,1);assert.equal(replay.applied.githubTokensRemoved,2);assert.equal(replay.applied.cloudflareTokensRevoking,1);
  assert.equal(await crow('SELECT 1 x FROM gateway_spend_buckets WHERE user_id=?',c.user),null,'the closed account\'s RESTRICT child went with it');assert.equal(await crow('SELECT 1 x FROM gateway_spend_attempts WHERE user_id=?',c.user),null,'and the child of that child');assert.equal(await crow('SELECT 1 x FROM backend_form_settings WHERE project_id=?',c.project),null,'and the closed project\'s NO ACTION child');
  const again=await s.replayRestoreSuppressions(candidate,current,{source:db,name:'older backup candidate'});assert.ok(Object.values(again.applied).every(n=>n===0),JSON.stringify(again.applied));
  gate=await s.checkRestoreSuppressions(candidate,current,expected);assert.deepEqual(gate,{clear:true,pending:{},missingLedgerEntries:0,triggersMatch:true,ledgerSha256:current.sha256});
  // Actual handlers against the reconciled candidate: nothing erased or revoked comes back.
  assert.equal((await workspace(c,'/api/account/v1/closure/status',{version:1},cenv)).status,401,'The closed account has no session');
  assert.equal(await crow('SELECT 1 x FROM projects WHERE id=?',c.project),null);assert.equal(await crow('SELECT 1 x FROM project_files WHERE id=?',photo),null);
  const members=await crow("SELECT * FROM module_instances WHERE project_id=? AND local_id='members'",a.project);
  for(const v of [revoked,erased])assert.equal((await gateway(a,envelope(members,'access.me'),v,cenv)).body.code,'forbidden');
  assert.equal((await crow('SELECT state FROM module_access_roles WHERE visitor_id=?',staff.visitorId)).state,'revoked');
  for(const record of [removedRecord,erasedRecord])assert.equal(await crow('SELECT 1 x FROM module_records WHERE id=?',record.id),null);
  assert.ok(await crow('SELECT 1 x FROM module_records WHERE visitor_id=?',revoked.visitorId),'A revoked visitor\'s records stay with the owner');
  assert.equal(await crow('SELECT 1 x FROM github_token_vault WHERE id=?',githubToken),null);assert.equal((await crow('SELECT state FROM cloudflare_token_vault WHERE id=?',cloudflareToken)).state,'revoking','Unconfirmed revocation keeps its key for the cleanup');
  assert.equal((await crow('SELECT count(*) n FROM app_recovery_documents WHERE point_id=? AND visitor_id=?',point,docRevoked.id)).n,0);
  const review=id();assert.equal((await recovery.prepareAppRestore(dCandidate,dUser,dProject,point,review)).documents,1);assert.equal((await recovery.confirmAppRestore(dCandidate,dUser,dProject,review,'RESTORE')).status,'applied');
  // The candidate's own guards now refuse a later logical restore too, and the triggers the replay dropped fire again.
  await refused(insertRow(candidate,'app_visitors',before.visitor));await refused(insertRow(candidate,'users',before.xuser));
  assert.equal(await crow('SELECT 1 x FROM users WHERE id=?',x.user),null,'X (photo in a saved version, refresh custody, hostname, released hold) is removed');
  assert.equal(await crow('SELECT 1 x FROM project_files WHERE id=?',xPhoto),null);assert.equal(await crow('SELECT 1 x FROM version_photos WHERE file_id=?',xPhoto),null);assert.equal(await crow('SELECT 1 x FROM github_refresh_custody WHERE user_id=?',x.user),null);assert.equal(await crow('SELECT 1 x FROM domain_connections WHERE id=?',x.conn),null);
  assert.ok(await crow('SELECT 1 x FROM file_cleanup WHERE object_key=?',`photos/${x.project}/${xPhoto}.jpg`),'The erased photo\'s private object is queued for storage cleanup');
  assert.equal((await crow('SELECT count(*) n FROM sqlite_master WHERE type=\'trigger\'')).n,artifactTriggers.length);
  await refused(candidate.prepare("UPDATE restore_suppressions SET effect='revoked' WHERE kind='account' AND subject_id=?").bind(c.user).run(),/restore_suppression_immutable/);
  // N: the token that was revoked after the backup no longer holds the connection pointer, so the cleanup claims it and calls the provider once.
  assert.equal((await crow('SELECT active_token_id FROM github_connections WHERE user_id=?',a.user)).active_token_id,null);
  {let calls=0;await m.githubConnection.cleanupGitHub(candidate,ghConfig,async()=>{calls++;return new Response(null,{status:204});},null);assert.equal(calls,1,'the cleanup made the provider revocation call');assert.equal(await crow('SELECT 1 x FROM github_token_vault WHERE id=?',githubToken2),null);}
  { // M: an exact new owner review re-grants the staff role on the reconciled candidate.
   const sc=await a.actorScope(candidate),rev=async()=>(await m.readChat(sc,a.user)).state.revision,turn=id();
   const review=await m.sendChatControl(sc,a.user,{id:turn,revision:await rev(),action:{type:'accessRoleReview',projectId:a.project,instanceId:'members',visitorId:staff.visitorId,action:'grant'}});assert.equal(review.status,200,review.error);
   const rv=await crow('SELECT * FROM module_access_role_reviews WHERE id=?',turn);
   const applied=await m.sendChatControl(sc,a.user,{id:id(),revision:await rev(),action:{type:'accessRoleApply',reviewId:rv.id,reviewDigest:rv.review_digest,expectedRevision:rv.expected_access_revision}});assert.equal(applied.status,200,applied.error);
   assert.equal((await crow('SELECT state FROM module_access_roles WHERE visitor_id=?',staff.visitorId)).state,'granted');
  }
  // Unrelated subjects are untouched.
  assert.ok(await crow('SELECT 1 x FROM users WHERE id=?',a.user));assert.ok(await crow('SELECT 1 x FROM app_visitors WHERE id=? AND revoked=0',kept.visitorId));
 });

 await check('each population and guard trigger fires: staff deletion and re-insert, GitHub un-revoke, Cloudflare delete and re-insert, and a removed photo cannot be uploaded again',async()=>{
  // Staff: a granted role that is deleted is ledgered with a newer revision, and the older row cannot come back.
  const staff2=await visitor(a);assert.equal((await setRole(a,staff2.visitorId,'grant')).status,200);
  const granted=await row('SELECT * FROM module_access_roles WHERE visitor_id=?',staff2.visitorId),subject=`${granted.instance_id}/${staff2.visitorId}/staff`;
  await run('DELETE FROM module_access_roles WHERE visitor_id=?',staff2.visitorId);
  assert.deepEqual((await ledger('staff',subject)).map(r=>[r.effect,r.revision]),[['deleted',granted.access_revision+1]],'restore_suppress_staff_deleted records the deletion');
  await refused(insertRow(db,'module_access_roles',granted));
  // GitHub: a revoking token cannot be set active again.
  const gh='gh3-'+id();await run("INSERT INTO github_token_vault(id,user_id,ciphertext,expires_at,state) VALUES(?,?,?,'2027-01-01','active')",gh,a.user,await fixtureCiphertext(keyring,`whumpo:github:token:${a.user}:${gh}`,'gho_SYNTHETIC3_'+marker));
  await run("UPDATE github_token_vault SET state='revoking' WHERE id=?",gh);await refused(run("UPDATE github_token_vault SET state='active' WHERE id=?",gh));
  // Cloudflare: a deleted token is ledgered and the older row cannot be inserted again.
  await run('DELETE FROM cloudflare_token_vault WHERE id=?',cloudflareToken);
  assert.deepEqual((await ledger('cloudflare_token',cloudflareToken)).map(r=>r.effect),['deleted','revoked']);
  await refused(insertRow(db,'cloudflare_token_vault',before.cloudflare));
  // A removed photo cannot be uploaded under the same id: the existing removal refusal.
  const segment=(marker,body)=>[255,marker,(body.length+2)>>8,(body.length+2)&255,...body];
  const jpeg=new Uint8Array([255,216,...segment(219,[0,...Array(64).fill(1)]),...segment(196,[0,1,...Array(15).fill(0),0]),...segment(192,[8,0,24,0,32,1,1,17,0]),...segment(218,[1,1,0,0,63,0]),17,5,0,255,217]); // an envelope src/photo-format.ts accepts
  await run("INSERT INTO restore_suppressions(kind,subject_id,effect,recorded_at) VALUES('file',?,'deleted',unixepoch())",'11111111-2222-4333-8444-555555555555');
  await assert.rejects(m.uploadPhoto(new Request('https://whumpo.com/',{method:'PUT',headers:{'content-type':'image/jpeg','x-whumpo-photo-handoff':'null','x-photo-name':'again.jpg'},body:jpeg}),{...env,DB:a.scope},a.user,a.project,'11111111-2222-4333-8444-555555555555'),e=>{assert.equal(e.status,409);assert.match(e.message,/This photo was removed/);return true;});
 });

 await check('the replay works on an isolated candidate of either engine: several ledger chunks, nothing over the bound, older staff entries, missing entries',async()=>{
  const second=await databaseFixture(),candidate=second.db;
  try{
   const make=entries=>{const list=entries.map(e=>({revision:null,recordedAt:1700000000,...e}));return {version:1,format:'whumpo-restore-suppressions-v1',entries:list,sha256:createHash('sha256').update(JSON.stringify(list.map(e=>[e.kind,e.subjectId,e.effect,e.revision,e.recordedAt]))).digest('hex')};};
   // Wrap the candidate to see every bound string and every batch.
   const bound=[],seen=[];let failCreate=false;
   const spy={prepare:q=>{const st=candidate.prepare(q);return new Proxy(st,{get(t,k){if(k==='__raw')return t;if(k==='__q')return q;if(k==='bind')return(...a)=>{for(const v of a)if(typeof v==='string')bound.push(v.length);return t.bind(...a);};const v=t[k];return typeof v==='function'?v.bind(t):v;}});},
    batch:async list=>{seen.push(list.length);if(failCreate&&list.some(x=>/^CREATE TRIGGER/i.test(x.__q??'')))throw Error('synthetic crash while recreating triggers');return candidate.batch(list.map(x=>x.__raw??x));}};
   const entries=Array.from({length:32000},(_,i)=>({kind:'record',subjectId:`${(i+1).toString(16).padStart(8,'0')}-0000-4000-8000-${(i+1).toString(16).padStart(12,'0')}`,effect:'deleted',recordedAt:1700000000+i}));
   // missing entries and an older staff entry
   const small=make([{kind:'record',subjectId:'aaaaaaaa-0000-4000-8000-000000000001',effect:'deleted'},{kind:'staff',subjectId:'inst/visitor/staff',effect:'revoked',revision:3}]);
   await candidate.prepare("INSERT INTO restore_suppressions(kind,subject_id,effect,revision,recorded_at) VALUES('staff','inst/visitor/staff','revoked',5,1700000000)").run();
   let gate=await s.checkRestoreSuppressions(candidate,small,expected);assert.equal(gate.missingLedgerEntries,1);assert.equal(gate.clear,false);assert.equal(gate.triggersMatch,true);
   const older=await s.replayRestoreSuppressions(spy,small,{source:db,name:'engine candidate'});
   assert.equal((await candidate.prepare("SELECT revision FROM restore_suppressions WHERE kind='staff'").first()).revision,5,'an older ledger revision never lowers the candidate\'s');assert.equal(older.applied.staffRevisionsRaised,0);
   gate=await s.checkRestoreSuppressions(candidate,small,expected);assert.equal(gate.clear,true,JSON.stringify(gate));
   const higher=make([{kind:'staff',subjectId:'inst/visitor/staff',effect:'revoked',revision:7}]);assert.equal((await s.replayRestoreSuppressions(spy,higher,{source:db,name:'engine candidate'})).applied.staffRevisionsRaised,1);
   // several chunks, each bound string under 1.5 MB
   bound.length=0;const big=make(entries);
   const result=await s.replayRestoreSuppressions(spy,big,{source:db,name:'engine candidate'});
   assert.equal(result.applied.ledgerEntriesAdded,32000);assert.ok(bound.filter(n=>n>1000000).length>=2,'the ledger needed several chunks: '+bound.filter(n=>n>1000000).length);assert.ok(Math.max(...bound)<=1500000,'no bound string above 1.5 MB: '+Math.max(...bound));
   gate=await s.checkRestoreSuppressions(spy,big,expected);assert.equal(gate.clear,true,JSON.stringify(gate));
   assert.equal((await candidate.prepare('SELECT count(*) n FROM restore_suppressions').first()).n,32002);
   // over the bound: capture refuses rather than truncating
   await assert.rejects(s.captureRestoreSuppressions({prepare:()=>({all:async()=>({results:Array.from({length:100001},()=>({kind:'record',subject_id:'x',effect:'deleted',revision:null,recorded_at:1}))})})}),/exceeds this replay bound/);
   // A replay that cannot apply is all or nothing and leaves the candidate held; the data is unchanged and the triggers are back.
   const x2=await workspaceFixture(candidate,m),x2scope=await x2.scope(),project=(await createFixtureProject(x2scope,x2.account,'Held '+marker,'Held project')).project;
   // SET NULL on a NOT NULL column fails mid-batch; a plain RESTRICT/NO ACTION child would now be cleared by the replay.
   await candidate.prepare('CREATE TABLE restore_blocker(project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE SET NULL)').run();await candidate.prepare('INSERT INTO restore_blocker VALUES(?)').bind(project).run();
   const blocked=make([{kind:'project',subjectId:project,effect:'deleted'},{kind:'record',subjectId:'bbbbbbbb-0000-4000-8000-000000000002',effect:'deleted'}]);
   const ledgerRows=async()=>(await candidate.prepare('SELECT count(*) n FROM restore_suppressions').first()).n,before2=await ledgerRows();
   await assert.rejects(s.replayRestoreSuppressions(spy,blocked,{source:db,name:'engine candidate'}),/NOT NULL|constraint/i);
   assert.ok(await candidate.prepare('SELECT 1 x FROM projects WHERE id=?').bind(project).first(),'nothing was deleted');assert.equal(await ledgerRows(),before2,'the ledger merge was rolled back with the rest');
   const afterFail=await s.triggerSetDigest((await candidate.prepare("SELECT name,sql FROM sqlite_master WHERE type='trigger'").all()).results);assert.equal(afterFail,expected.triggerSha256,'the triggers are back');
   gate=await s.checkRestoreSuppressions(candidate,blocked,expected);assert.equal(gate.clear,false,'held: the project is still there and the scratch table remains');
   // A crash while recreating the triggers leaves none; the gate refuses; a re-run resumes from the saved set.
   await candidate.prepare('DROP TABLE restore_blocker').run();failCreate=true;
   await assert.rejects(s.replayRestoreSuppressions(spy,blocked,{source:db,name:'engine candidate'}),/synthetic crash/);failCreate=false;
   assert.equal((await candidate.prepare("SELECT count(*) n FROM sqlite_master WHERE type='trigger'").first()).n,0,'no triggers after the crash');
   gate=await s.checkRestoreSuppressions(candidate,blocked,expected);assert.equal(gate.clear,false);assert.equal(gate.triggersMatch,false);
   await s.replayRestoreSuppressions(spy,blocked,{source:db,name:'engine candidate'});
   gate=await s.checkRestoreSuppressions(candidate,blocked,expected);assert.equal(gate.clear,true,JSON.stringify(gate));assert.equal(await candidate.prepare('SELECT 1 x FROM projects WHERE id=?').bind(project).first(),null);
   // the recreated triggers fire again
   await assert.rejects(candidate.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'x','','draft','2026-01-01','2026-01-01')").bind(project,x2.account).run(),/restore_suppressed/);
  }finally{await second.close();}
 });

 assert.equal(network,0);
 process.stdout.write(`Restore suppression passed: ${cases} groups on ${d1?'local D1':'SQLite'} — ledger populated inside closure, visitor revocation/self-erasure, staff revocation, owner record removal and provider disconnect/confirmation commits (content-free, append-only); logical restores of older account, project, photo, visitor, record and token rows and un-revocations refused in-commit while a newer owner grant still works${fixture.sql?'; an older whole-database backup gated, recovery-point and saved-version restores refused with the ledger merged, then reconciled by an idempotent atomic replay and verified through actual handlers':''}.\n`);
}finally{globalThis.fetch=originalFetch;candidateSQL?.close();if(directory)await rm(directory,{recursive:true,force:true});await fixture.close();}
