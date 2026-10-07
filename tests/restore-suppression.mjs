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
Error.stackTraceLimit=0;
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
 return {...actor,scope,user,...site,host:'https://app-'+site.project+'.whumpo.site'};
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
 // Older rows a logical restore would replay, read before any erasure.
 const before={user:await row('SELECT * FROM users WHERE id=?',c.user),project:await row('SELECT * FROM projects WHERE id=?',c.project),file:await row('SELECT * FROM project_files WHERE id=?',photo),
  visitor:await row('SELECT * FROM app_visitors WHERE id=?',erased.visitorId),record:removedRecord,github:await row('SELECT * FROM github_token_vault WHERE id=?',githubToken),grant:await row('SELECT * FROM module_access_roles WHERE visitor_id=?',staff.visitorId)};
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
  const live=await s.captureRestoreSuppressions(db);assert.equal((await s.checkRestoreSuppressions(db,live)).clear,true);
  assert.ok(Object.values((await s.replayRestoreSuppressions(db,live)).applied).every(n=>n===0));
  await assert.rejects(s.replayRestoreSuppressions(db,{...live,entries:live.entries.slice(1)}),/changed/);
 });

 if(fixture.sql)await check('an older whole-database backup is reconciled by the replay before any handler serves it',async()=>{
  const current=await s.captureRestoreSuppressions(db);
  candidateSQL=new DatabaseSync(join(directory,'before.sqlite'));candidateSQL.exec('PRAGMA foreign_keys=ON');
  const candidate=sqliteD1Adapter(candidateSQL),cenv={...baseEnv,DB:candidate},crow=(q,...p)=>candidate.prepare(q).bind(...p).first();
  // The restored copy is the old state: every erased or revoked subject is back.
  assert.ok(await crow('SELECT 1 x FROM users WHERE id=?',c.user));assert.ok(await crow('SELECT 1 x FROM app_visitors WHERE id=? AND revoked=0',revoked.visitorId));
  assert.equal((await crow("SELECT state FROM github_token_vault WHERE id=?",githubToken)).state,'active');
  let gate=await s.checkRestoreSuppressions(candidate,current);assert.equal(gate.clear,false);
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
  // The replay applies the current ledger atomically; a duplicate replay changes nothing.
  const replay=await s.replayRestoreSuppressions(candidate,current);
  assert.equal(replay.applied.accountsRemoved,1);assert.equal(replay.applied.visitorsRevoked,3,'Revoked visitors, and erased ones before their removal');assert.equal(replay.applied.visitorsRemoved,1);assert.equal(replay.applied.staffGrantsRevoked,1);assert.equal(replay.applied.githubTokensRemoved,1);assert.equal(replay.applied.cloudflareTokensRevoking,1);
  const again=await s.replayRestoreSuppressions(candidate,current);assert.ok(Object.values(again.applied).every(n=>n===0),JSON.stringify(again.applied));
  gate=await s.checkRestoreSuppressions(candidate,current);assert.deepEqual(gate,{clear:true,pending:{},missingLedgerEntries:0,ledgerSha256:current.sha256});
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
  // The candidate's own guards now refuse a later logical restore too.
  await refused(insertRow(candidate,'app_visitors',before.visitor));
  // Unrelated subjects are untouched.
  assert.ok(await crow('SELECT 1 x FROM users WHERE id=?',a.user));assert.ok(await crow('SELECT 1 x FROM app_visitors WHERE id=? AND revoked=0',kept.visitorId));
 });
 assert.equal(network,0);
 process.stdout.write(`Restore suppression passed: ${cases} groups on ${d1?'local D1':'SQLite'} — ledger populated inside closure, visitor revocation/self-erasure, staff revocation, owner record removal and provider disconnect/confirmation commits (content-free, append-only); logical restores of older account, project, photo, visitor, record and token rows and un-revocations refused in-commit while a newer owner grant still works${fixture.sql?'; an older whole-database backup gated, recovery-point and saved-version restores refused with the ledger merged, then reconciled by an idempotent atomic replay and verified through actual handlers':''}.\n`);
}finally{globalThis.fetch=originalFetch;candidateSQL?.close();if(directory)await rm(directory,{recursive:true,force:true});await fixture.close();}
