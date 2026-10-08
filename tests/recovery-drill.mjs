// WH-008 isolated local disaster-recovery drill. Synthetic data only: the source
// platform uses the actual D1 query adapter over SQLite, recovery targets are empty
// local D1/R2 resources (Miniflare) and programs run in actual workerd/QuickJS.
// No remote Cloudflare access, provider dispatch, public listener, customer traffic
// or key retirement. Local timings are not a forecast of Cloudflare restore time.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,mkdir,rm,readdir,writeFile,readFile,rename,cp,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {sqliteD1,sqliteD1Adapter} from './sqlite-d1.mjs';
import {workspaceFixture,workspaceSession} from './helpers/workspace-identity.mjs';
import {fixtureKeyring,initializeFixtureKeys,fixtureCiphertext} from './helpers/connection-keyring.mjs';
import {keyBackupFixture} from './helpers/key-backup.mjs';
import {currentSiteFixtureHandlers,createFixtureProject,changeFixtureWebsite,enableFixtureVisitorAccess,fixtureVisitorSQL} from './current-site-fixture.mjs';
import {memoryBucket,isolatedTargets,seedCredentials,syntheticJPEG} from './helpers/recovery-drill.mjs';
import {startRestoredStack,exerciseRestoredStacks} from './helpers/recovery-serving.mjs';
import {compileWorker} from '../tools/release-provider.mjs';
import {archivedConfig} from '../tools/prepare-release.mjs';
import {workerOrder,configFiles,fileInventory,copyTree} from '../tools/release-manifest.mjs';
import {runWrangler} from '../tools/cms-release.mjs';
import {fixtureEnvironment} from '../tools/verify.mjs';
import {createRestoreInventory,openRestoreInventory} from '../tools/restore-inventory.mjs';
import {syntheticPlatform} from './helpers/synthetic-platform.mjs';
import {inspectIsolatedRestore} from '../tools/restore-admission.mjs';
import {restoreCapturedCMSDatabase,captureCMSDatabase} from '../tools/cms-database-snapshot.mjs';
import {captureRecoveryPoint,verifyRecoveryPoint,openArchivedControl,restoreControlD1,restoreObjects,restoreWorkerArtifact,isolatedObjects,reconcileArtifacts,restoreDiscrepancies,DrillHold} from '../tools/recovery-drill.mjs';

Error.stackTraceLimit=0;
const id=()=>crypto.randomUUID(),hash=v=>createHash('sha256').update(v).digest('hex');
const directory=await mkdtemp('/tmp/whumpo-recovery-drill-'),phases={},holds={};let refusals=0;
const phase=async(name,work)=>{const start=performance.now();try{return await work();}finally{phases[name]=Math.round((performance.now()-start)*10)/10;console.error(`drill phase ${name}: ${phases[name]} ms`);}};
const drillHold=async(work,code)=>{await assert.rejects(work,e=>e instanceof DrillHold&&e.code===code,code);refusals++;};
const closers=[];let fixture,isolated,sourceRuntime,restoredRuntime;
const require=createRequire(import.meta.resolve('wrangler')),{Miniflare,convertV4MiniflareOptions}=require('miniflare');
const workerd=async dir=>new Miniflare(convertV4MiniflareOptions({modulesRoot:dir,modules:[{type:'ESModule',path:dir+'/worker.js'},...(await readdir(dir)).filter(p=>p.endsWith('.wasm')).map(p=>({type:'CompiledWasm',path:dir+'/'+p}))],compatibilityDate:'2026-09-29'}));
const lane=()=>hash(id());
async function execute(runtime,source,input){const r=await runtime.dispatchFetch('http://runtime/execute',{method:'POST',headers:{'x-whumpo-lane':lane()},body:JSON.stringify({version:1,source,input})});assert.equal(r.status,200);return r.json();}
const network=globalThis.fetch,independentEvidenceRetries=[];
async function retryIndependentEvidence(run){for(let attempt=1;;attempt++){const result=await run();if(result.holds[0]!=='independent-evidence'||attempt===3)return result;independentEvidenceRetries.push(attempt);}}
try{
 // ---- Source platform: complete current schema in local D1 + private local R2.
 // The source platform uses the actual D1 query adapter over SQLite, like the
 // restore-inventory suites: its full observations must fit the inventory's fixed
 // ten-second evidence deadline. Private object bodies sit in a separate store.
 fixture=await phase('setupSource',()=>sqliteD1());const {db}=fixture,files=memoryBucket();
 // Build all four Workers once with the release tooling's own compile step (local
 // Wrangler dry run, credential-free environment). Their output is archived, destroyed
 // and restored below; the original inventories are kept for independent comparison.
 const build=join(directory,'build'),runtimeBuild=join(build,'runtime'),buildEnv=fixtureEnvironment(process.env,join(directory,'home'));await mkdir(build,{mode:0o700});await mkdir(buildEnv.HOME,{mode:0o700});
 const configs={},entries={},builds={};
 await phase('buildWorkerArtifacts',async()=>{
  for(const role of workerOrder){
   configs[role]=JSON.parse(await readFile(configFiles[role],'utf8'));builds[role]=join(build,role);
   entries[role]=await compileWorker(process.cwd(),role,configs[role],builds[role],directory,{env:buildEnv});
  }
 });
 const buildInventories={};for(const role of workerOrder)buildInventories[role]=await fileInventory(builds[role]);
 const assetTrees={'assets-platform':'dist','assets-apps':'public-app'};
 for(const [role,path] of Object.entries(assetTrees))buildInventories[role]=await fileInventory(path);
 sourceRuntime=await workerd(runtimeBuild);let executions=0;
 // Direct handler calls bypass the platform's per-project lane wrapper; supply an opaque lane.
 const runtimeService={fetch:(url,init={})=>{executions++;const headers=new Headers(init.headers);if(!headers.has('x-whumpo-lane'))headers.set('x-whumpo-lane',lane());return sourceRuntime.dispatchFetch(url,{...init,headers});}};
 // Isolated targets: a separate Wrangler state directory with EMPTY D1 databases
 // and buckets. No routes, service bindings or schema are configured for them.
 isolated=await isolatedTargets(directory,{databases:['A','B'],buckets:['A','B']});
 const target=isolated.env;
 globalThis.fetch=()=>assert.fail('The recovery drill must not dispatch to any real provider');

 const m=await phase('bundleHandlers',()=>currentSiteFixtureHandlers()),keyring=fixtureKeyring(),canary='PRIVATE_RECOVERY_DRILL_CANARY';
 await initializeFixtureKeys(db,keyring);const owner=await workspaceFixture(db,m),scope=await owner.scope();
 const {project:site,version:siteVersion}=await createFixtureProject(scope,owner.account,'Recovered garden','Synthetic recovery drill website');
 let revision=(await m.readChat(scope,owner.account)).state.revision,review=id();
 assert.equal((await m.sendChat(scope,owner.account,{id:review,revision,content:'/publish '+siteVersion})).status,200);
 revision=(await m.readChat(scope,owner.account)).state.revision;
 assert.equal((await m.sendChatControl(scope,owner.account,{id:id(),revision,action:{type:'confirm',kind:'site',reviewId:review}})).status,200);
 await seedCredentials(db,keyring,owner,canary);
 const objectRow=async(project,name,bytes)=>{const key='private-drill/'+id();await files.put(key,bytes);await db.prepare("INSERT INTO project_files(id,project_id,name,object_key,digest,size,width,height,status,created_at) VALUES(?,?,?,?,?,?,1,1,'pending',?)").bind(id(),project,name,key,hash(bytes),bytes.length,new Date().toISOString()).run();return key;};
 const objectKeys=[await objectRow(site,'Garden plan',Buffer.from('Synthetic private garden plan '+canary)),await objectRow(site,'Planting notes',Buffer.from('Synthetic private planting notes'))];
 // Visitor application: actual owner handlers and actual QuickJS transitions.
 const app=id(),program=id(),test=id(),appReview=id(),page=id(),now=new Date().toISOString();
 const source='export default ({state,input})=>({state:{note:input.note,edits:(state.edits??0)+1},result:"Saved"})';
 await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Recovered notebook','Synthetic recovery drill application','draft',?,?)").bind(app,owner.account,now,now).run();
 await m.backend.saveBackend(scope,owner.account,app,program,source);await m.backend.testBackend(scope,runtimeService,owner.account,app,program,test,{state:{},input:{note:'test'}});
 await enableFixtureVisitorAccess(scope,owner.account,app,{handlers:m});
 await m.appActivation.prepareApplication(scope,owner.account,app,appReview,'enable',program,test);await m.appActivation.confirmApplication(scope,owner.account,appReview);
 await m.appPages.prepareAppPage(scope,owner.account,app,page,{title:'Recovered notebook',description:'Synthetic recovery drill',buttonLabel:'Save',fields:[{key:'note',label:'Note',type:'text'}]});await m.appPages.confirmAppPage(scope,owner.account,page);
 const visitors=[];
 for(const note of ['first visitor note','second visitor note']){const who=id();await db.prepare(fixtureVisitorSQL).bind(who,app,app).run();const session=await m.appData.issueAppSession(db,who);const r=await m.appData.transitionAppData(db,runtimeService,session,app,id(),0,{note});assert.equal(r.state,'complete');visitors.push({who,session});}
 assert.ok(executions>=3,'Fixture writes used actual QuickJS executions');
 const reference=async(database,runtime)=>{
  const rows=(await database.prepare('SELECT d.visitor_id,d.state_json,v.source FROM app_documents d JOIN app_visitors x ON x.id=d.visitor_id JOIN app_spaces a ON a.project_id=x.project_id JOIN backend_versions v ON v.id=a.version_id ORDER BY d.visitor_id').all()).results;
  const outputs=[];for(const row of rows)outputs.push(await execute(runtime,row.source,{state:JSON.parse(row.state_json),input:{note:'recovery probe'}}));
  return {documents:rows.length,sha256:hash(JSON.stringify(outputs))};
 };
 const before=await reference(db,sourceRuntime);assert.equal(before.documents,2);

 // ---- Published-site photos through the actual upload, safety-gate, version and
 // publication handlers. The only synthetic input is the trusted safety receipt that
 // a real scanner would supply (as in tests/photo-versions.mjs); no production gate is disabled.
 // The owner's plan allows one live site, so the photo version replaces the published version of the same site;
 // a second, unpublished project holds a photo that must never be reachable through the first.
 const neighbour=await createFixtureProject(scope,owner.account,'Unpublished neighbour','Synthetic recovery drill neighbour','clay');
 const upload=async(project,name,seed)=>{const photoId=id();await m.uploadPhoto(new Request('https://whumpo.com/',{method:'PUT',headers:{'content-type':'image/jpeg','x-whumpo-photo-handoff':'null','x-photo-name':encodeURIComponent(name)},body:syntheticJPEG(seed)}),{DB:scope,FILES:files},owner.account,project,photoId);return photoId;};
 const gardenPhotos=[await upload(site,'Garden bed',1),await upload(site,'Greenhouse',2)],strayPhoto=await upload(neighbour.project,'Photo of another project',3);
 await assert.rejects(()=>m.readPhoto({DB:scope,FILES:files},owner.account,gardenPhotos[0]),{status:423});
 await assert.rejects(()=>changeFixtureWebsite(scope,owner.account,site,[{type:'pages.setPhotos',pageId:'home',photos:[{id:gardenPhotos[0],alt:'Held photo'}]}],m),{status:423});
 for(const file of [...gardenPhotos,strayPhoto])await db.prepare("UPDATE project_photo_safety SET state='approved',csam_check='clear',sexual_check='clear',scanner_reference='synthetic-drill',expires_at=? WHERE file_id=?").bind(new Date(Date.now()+3600000).toISOString(),file).run();
 await assert.rejects(()=>changeFixtureWebsite(scope,owner.account,site,[{type:'pages.setPhotos',pageId:'home',photos:[{id:strayPhoto,alt:'Wrong project'}]}],m),{status:423},'The source refuses another project\'s photo');
 const photoVersion=await changeFixtureWebsite(scope,owner.account,site,[{type:'pages.setPhotos',pageId:'home',photos:gardenPhotos.map((photo,i)=>({id:photo,alt:'Drill photo '+(i+1)}))}],m);
 const photoReview=id();revision=(await m.readChat(scope,owner.account)).state.revision;
 assert.equal((await m.sendChat(scope,owner.account,{id:photoReview,revision,content:'/publish '+photoVersion})).status,200);
 revision=(await m.readChat(scope,owner.account)).state.revision;
 assert.equal((await m.sendChatControl(scope,owner.account,{id:id(),revision,action:{type:'confirm',kind:'site',reviewId:photoReview}})).status,200);
 const publishedPhotos=(await db.prepare('SELECT f.id,f.object_key,f.digest FROM publications p JOIN version_photos vp ON vp.version_id=p.version_id JOIN project_files f ON f.id=vp.file_id WHERE p.project_id=? ORDER BY vp.position').bind(site).all()).results;
 assert.deepEqual(publishedPhotos.map(r=>r.id),gardenPhotos);
 const photoKeys=[...publishedPhotos.map(r=>r.object_key),(await db.prepare('SELECT object_key FROM project_files WHERE id=?').bind(strayPhoto).first()).object_key];
 const publishedHTML=(await db.prepare('SELECT v.html FROM publications p JOIN site_versions v ON v.id=p.version_id WHERE p.project_id=?').bind(site).first()).html;

 // ---- Independent authority and encrypted key custody, outside the data archive.
 const inventoryFile=join(directory,'operator.whumpo-restore-inventory'),streamId='recovery-drill-stream';
 await createRestoreInventory({inventoryFile,streamId});
 // The recovery source is the platform-bound database of a synthetic account (real release observer, real D1 REST adapter).
 const platform=await syntheticPlatform({database:db}),authority=await platform.authority();
 const inventory=await openRestoreInventory({inventoryFile,expectedStreamId:streamId,authority});closers.push(()=>inventory.close());
 const keys=await keyBackupFixture();closers.push(()=>keys.close());const stored=await keys.create(keyring),keyBackup=stored.proof;
 await mkdir(join(directory,'points'),{mode:0o700});
 const pointA=join(directory,'points','A'),snapshotA='drill-point-a';
 const capture=await phase('captureRecoveryPoint',()=>captureRecoveryPoint({authority,objects:files,directory:pointA,snapshotId:snapshotA,workers:{...builds,...assetTrees}}));
 assert.equal(capture.objects,5);assert.deepEqual(capture.workers,Object.keys(buildInventories));
 const pointDigestA=capture.pointDigest,archived=await openArchivedControl(pointA,pointDigestA);
 const manifest=await phase('registerArchive',async()=>{try{return await inventory.registerArchive({archiveDb:archived.db,snapshotId:snapshotA,keyBackup});}finally{archived.close();}});
 const pointBytes=await readFile(join(pointA,'control.json'));
 assert.ok(!pointBytes.includes(Buffer.from(JSON.parse(keyring).keys[0].secret)),'Key material stays out of the data archive');
 assert.ok(!JSON.stringify(capture).includes(canary)&&!JSON.stringify(manifest).includes(canary));

 // ---- Loss window, then the disaster: new work after the point, every private
 // object body lost (including published photos) and every compiled Worker output gone.
 // D1 remains readable here. The asset trees are checkout directories and are left in place.
 const disasterAt=Date.now();
 await objectRow(site,'Created after the recovery point',Buffer.from('Lost synthetic upload'));
 for(const key of [...objectKeys,...photoKeys])await files.delete(key);
 await rm(build,{recursive:true});

 // ---- Restore into isolated resources.
 const restoreStart=performance.now();
 await phase('verifyRecoveryPoint',()=>verifyRecoveryPoint(pointA,pointDigestA));
 // An interrupted single-batch restore leaves the target empty and can be retried.
 const failing={prepare:sql=>target.DRILL_A.prepare(sql),batch:statements=>target.DRILL_A.batch([...statements,target.DRILL_A.prepare('INSERT INTO drill_injected_failure VALUES(1)')])};
 await drillHold(()=>restoreControlD1(failing,pointA,pointDigestA),'restore-batch-failed');
 assert.equal((await target.DRILL_A.prepare("SELECT count(*) n FROM sqlite_schema WHERE name='users'").first()).n,0,'Failed batch left no partial schema');
 const control=await phase('restoreControlD1',()=>restoreControlD1(target.DRILL_A,pointA,pointDigestA));
 assert.equal(control.digest,capture.controlDigest);
 await drillHold(()=>restoreControlD1(target.DRILL_A,pointA,pointDigestA),'restore-target-not-empty');
 // Interrupted object copy, then idempotent resume.
 let puts=0;const interrupted={list:o=>target.OBJECTS_A.list(o),get:k=>target.OBJECTS_A.get(k),put:async(k,v,o)=>{if(++puts>1)throw Error('Injected interruption');return target.OBJECTS_A.put(k,v,o);}};
 await assert.rejects(restoreObjects(interrupted,pointA,pointDigestA));
 const objects=isolatedObjects(target.OBJECTS_A),inspectOnce=(extra={})=>inspectIsolatedRestore({db:target.DRILL_A,manifest,keyBackup,evidenceSource:inventory.evidenceSource,expectedStreamId:streamId,objects,...extra});
 // The inventory's evidence reply has fixed ten-second deadlines covering two full
 // source observations. On a contended host independent-evidence holds can occur
 // from missing/unavailable/malformed evidence. Retries up to three attempts.
 const inspect=(extra={})=>retryIndependentEvidence(()=>inspectOnce(extra));
 const partial=await inspect();assert.deepEqual(partial.holds,['missing-objects']);holds.partialObjects=partial.holds;
 const resumed=await phase('restoreObjects',()=>restoreObjects(target.OBJECTS_A,pointA,pointDigestA));
 assert.deepEqual({written:resumed.written,skipped:resumed.skipped},{written:4,skipped:1});
 assert.deepEqual(await restoreObjects(target.OBJECTS_A,pointA,pointDigestA),{objects:5,written:0,skipped:5,preexisting:5},'Repeated restore writes nothing');
 // Recovered bytes only: each archived Worker output and asset tree is copied out and
 // compared with the inventory taken before the disaster (independent of the point manifest).
 const restoredPayload=join(directory,'restored-payload'),restoredDir=role=>role.startsWith('assets-')?join(restoredPayload,'assets',role.slice(7)):join(restoredPayload,'workers',role),restoredBuild=restoredDir('runtime'),restoredWorkers={};
 await phase('restoreWorkerArtifacts',async()=>{for(const role of Object.keys(buildInventories))restoredWorkers[role]=await restoreWorkerArtifact(pointA,pointDigestA,role,restoredDir(role));});
 for(const role of Object.keys(buildInventories))assert.deepEqual(await fileInventory(restoredDir(role)),buildInventories[role],'Restored '+role+' equals its pre-disaster inventory');
 const worker=restoredWorkers.runtime;
 const admitted=await phase('inspectIsolatedRestore',()=>inspect());
 assert.equal(admitted.status,'verified',JSON.stringify(admitted));
 assert.deepEqual([admitted.servingAllowed,admitted.providerDispatchAllowed,admitted.retirementAllowed],[false,false,false]);
 assert.equal(admitted.keys.credentials,4);assert.equal(admitted.objects,5);
 const artifacts=await phase('reconcileArtifacts',()=>reconcileArtifacts(target.DRILL_A,objects));
 assert.equal(artifacts.status,'consistent',JSON.stringify(artifacts));assert.equal(artifacts.publishedSites,1);assert.equal(artifacts.publishedSitePhotos,2);assert.equal(artifacts.enabledApplications,1);assert.equal(artifacts.applicationDocuments,2);
 restoredRuntime=await workerd(restoredBuild);
 const after=await phase('restoredQuickJS',()=>reference(target.DRILL_A,restoredRuntime));
 assert.deepEqual(after,before,'Restored program, documents and runtime artifact reproduce the pre-disaster outputs');
 const rto=Math.round(performance.now()-restoreStart);
 const loss=await phase('restoreDiscrepancies',()=>restoreDiscrepancies(target.DRILL_A,db));
 assert.deepEqual(loss.counts.resurrected,{});assert.deepEqual(loss.counts.rolledBack,{});assert.deepEqual(loss.tables.lostSinceSnapshot,{project_files:1});
 // The candidate stays unchanged and unrouted: nothing in the drill wrote to it.
 assert.equal((await captureCMSDatabase(async sql=>(await target.DRILL_A.prepare(sql).all()).results,{maxRows:200000})).digest,capture.controlDigest);
 assert.ok(!JSON.stringify([admitted,artifacts,loss]).includes(canary)&&!JSON.stringify([admitted,artifacts,loss]).includes(owner.account));
 // The restored bytes of all four Workers are accepted by the release tooling's own
 // archived no-bundle path (local Wrangler dry run) and reproduce every module byte-for-byte.
 // This is not a deployment, a workerd execution or an HTTP serving test of those bundles.
 await phase('replayRestoredBundles',async()=>{
  const config=join(restoredPayload,'config');await mkdir(config,{recursive:true});
  for(const role of workerOrder)await writeFile(join(config,role+'.json'),JSON.stringify(archivedConfig(role,configs[role],entries[role],[])));
  const pinned=await fileInventory(restoredPayload);
  for(const role of workerOrder){
   const out=join(directory,'replay',role);
   await runWrangler(['deploy','--config',join(config,role+'.json'),'--no-bundle','--dry-run','--outdir',out],join(directory,role+'-replay.log'),{env:buildEnv});
   const replayed=await fileInventory(out),modules=buildInventories[role].filter(f=>/\.(?:js|wasm)$/.test(f.path));
   assert.ok(modules.length>0);
   for(const file of modules)assert.equal(replayed.find(f=>f.path===file.path)?.sha256,file.sha256,'Replayed module differs: '+role+'/'+file.path);
  }
  assert.deepEqual(await fileInventory(restoredPayload),pinned,'Wrangler left the restored payload unchanged');
 });



 // ---- Execute the RESTORED bundles (no recompilation) with their restored asset trees against a
 // second, disposable restore of the same point, in loopback-only workerd. The verified candidate above stays
 // unrouted and unserved; this probe grants no customer-traffic authority and uses no provider or credential.
 const probePinned=await fileInventory(restoredPayload);
 const probe=await phase('executeRestoredBundles',async()=>{
  const bundles=Object.fromEntries(workerOrder.map(role=>[role,restoredDir(role)])),assetDirs={apps:restoredDir('assets-apps'),platform:restoredDir('assets-platform')};
  const launch=roles=>startRestoredStack({bundles,entries,configs,assets:assetDirs,persist:join(directory,'probe-state'),roles});
  const documents=[];for(const visitor of visitors){const row=await db.prepare('SELECT revision,state_json FROM app_documents WHERE visitor_id=?').bind(visitor.who).first();documents.push({revision:row.revision,state:JSON.parse(row.state_json)});}
  return exerciseRestoredStacks({launch,point:{directory:pointA,digest:pointDigestA,controlDigest:capture.controlDigest},
   ids:{site,neighbour:neighbour.project,gardenPhotos,strayPhoto,app,page,visitors,ownerToken:owner.token,ownerAccount:owner.account,canary,objectKeys},assetDirs,
   photos:publishedPhotos.map((row,i)=>({bytes:syntheticJPEG(i+1),digest:row.digest})),publishedHTML,documents,
   makeStranger:async target=>{const stranger=await workspaceFixture(target,m);await createFixtureProject(await stranger.scope(target),stranger.account,'Second owner project','Synthetic second owner on the probe copy');return stranger;}});
 });
 assert.deepEqual(await fileInventory(restoredPayload),probePinned,'Executing the restored bundles left them unchanged');
 assert.equal((await captureCMSDatabase(async sql=>(await target.DRILL_A.prepare(sql).all()).results,{maxRows:200000})).digest,capture.controlDigest,'The verified candidate was neither routed to nor changed by the probe');
 // ---- Missing/corrupt keys, archives and artifacts fail visibly.
 const recoveryKey=stored.recoveryKeyFile,moved=recoveryKey+'.moved';
 await rename(recoveryKey,moved);holds.missingRecoveryKey=(await inspect()).holds;await rename(moved,recoveryKey);
 assert.deepEqual(holds.missingRecoveryKey,['key-backup-unavailable']);
 const otherKeys=(await keys.create(fixtureKeyring('cd'.repeat(32)))).proof;
 holds.unregisteredKeyBackup=(await inspect({keyBackup:otherKeys})).holds;assert.deepEqual(holds.unregisteredKeyBackup,['key-backup-binding']);
 const damaged=join(directory,'points','damaged');
 const damage=async(mutate,code)=>{await rm(damaged,{recursive:true,force:true});await cp(pointA,damaged,{recursive:true});await mutate(damaged);await drillHold(()=>verifyRecoveryPoint(damaged,pointDigestA),code);};
 const firstObject=async dir=>join(dir,'objects',(await readdir(join(dir,'objects')))[0]);
 await damage(async dir=>unlink(await firstObject(dir)),'object-missing');
 await damage(async dir=>{const f=await firstObject(dir),b=await readFile(f);b[0]^=1;await unlink(f);await writeFile(f,b,{mode:0o600});},'object-digest');
 await damage(async dir=>{const f=join(dir,'control.json'),b=await readFile(f);await unlink(f);await writeFile(f,Buffer.concat([b.subarray(0,b.length-1),Buffer.from(' }')]),{mode:0o600});},'control-digest');
 await damage(async dir=>{const f=join(dir,'workers','runtime','worker.js');await writeFile(f,(await readFile(f,'utf8'))+'\n// altered');},'worker-artifact-digest');
 await damage(async dir=>unlink(join(dir,'recovery-point.json')),'point-missing');
 // A consistently edited manifest (object entry and its digest both replaced) still fails the independent pin.
 await damage(async dir=>{const f=join(dir,'recovery-point.json'),p=JSON.parse(await readFile(f));p.objects.entries.pop();p.objects.count--;p.objects.sha256=createHash('sha256').update(JSON.stringify(p.objects.entries)).digest('hex');await unlink(f);await writeFile(f,JSON.stringify(p),{mode:0o600});},'point-digest');
 await drillHold(()=>verifyRecoveryPoint(pointA,'0'.repeat(64)),'point-digest');
 await drillHold(()=>restoreWorkerArtifact(pointA,pointDigestA,'runtime',restoredBuild),'restore-target-not-empty');
 await target.OBJECTS_A.delete(objectKeys[0]);
 holds.missingRestoredObject=(await inspect()).holds;assert.deepEqual(holds.missingRestoredObject,['missing-objects']);
 await target.OBJECTS_A.put(objectKeys[0],Buffer.alloc(Buffer.byteLength('Synthetic private garden plan '+canary),'x'));
 holds.corruptRestoredObject=(await inspect()).holds;assert.deepEqual(holds.corruptRestoredObject,['object-integrity']);
 await drillHold(()=>restoreObjects(target.OBJECTS_A,pointA,pointDigestA),'restore-target-conflict');
 await target.OBJECTS_A.delete(objectKeys[0]);assert.equal((await restoreObjects(target.OBJECTS_A,pointA,pointDigestA)).written,1);
 await target.OBJECTS_A.put('unexpected/object','x');await drillHold(()=>restoreObjects(target.OBJECTS_A,pointA,pointDigestA),'restore-target-not-isolated');await target.OBJECTS_A.delete('unexpected/object');
 assert.equal((await inspect()).status,'verified','Retried object restore returns to the verified state');
 // Unknown custom metadata cannot be preserved by the point, so capture refuses it instead of dropping it.
 await drillHold(async()=>captureRecoveryPoint({authority,directory:join(directory,'points','metadata'),snapshotId:'drill-metadata',objects:{get:async key=>{const o=await target.OBJECTS_A.get(key);return o&&{size:o.size,arrayBuffer:()=>o.arrayBuffer(),httpMetadata:o.httpMetadata,customMetadata:{...o.customMetadata,note:'unpreserved'}};}}}),'object-metadata');
 // A changed published artifact in a candidate copy (immutability triggers are
 // created after rows, so edit the archived cells): pointers and manifest refuse it.
 const {snapshot}=await verifyRecoveryPoint(pointA,pointDigestA);
 const cell=v=>"CAST(X'"+Buffer.from(v).toString('hex').toUpperCase()+"' AS TEXT)";
 const tamperedCopy=async(changes)=>{
  const copy=structuredClone(snapshot);
  for(const [table,column,value,only] of changes){const t=copy.tables.find(x=>x.name===table),i=t.columns.indexOf(column);for(const row of t.rows)if(!only||only(row,t.columns))row[i]=value;}
  const sql=new DatabaseSync(':memory:');restoreCapturedCMSDatabase(sql,copy);return sql;
 };
 for(const [changes,expected] of [[[['site_versions','html',"'Tampered page'"]],['site-artifact-digest']],[[['site_versions','html',"'Tampered page'"],['backend_versions','digest',"'"+'0'.repeat(64)+"'"]],['app-program-digest','site-artifact-digest']]]){
  const sql=await tamperedCopy(changes);
  try{
   const copy=sqliteD1Adapter(sql),report=await reconcileArtifacts(copy,objects);assert.deepEqual(report.holds,expected);holds['tampered:'+expected.join('+')]=report.holds;
   holds.tamperedCandidate=(await inspect({db:copy})).holds;assert.deepEqual(holds.tamperedCandidate,['manifest-mismatch']);
  }finally{sql.close();}
 }

 // ---- Published-site photos: the restored rows and restored bytes are checked against the
 // rules the actual public host applies. Everything below uses throwaway copies (archived
 // control rows in SQLite, restored bodies in a memory bucket), because the real host handler
 // writes usage counters; the candidate itself is never served or changed.
 const scratchSQL=new DatabaseSync(':memory:');restoreCapturedCMSDatabase(scratchSQL,snapshot);
 const scratchDB=sqliteD1Adapter(scratchSQL),scratchBucket=memoryBucket();
 try{
  assert.equal((await restoreObjects(scratchBucket,pointA,pointDigestA)).written,5);
  const serve=(path,method='GET',db=scratchDB)=>{const parts=path.split('/');return m.host.fetch(new Request('https://'+parts[2]+'.whumpo.site/'+parts.slice(3).join('/'),{method}),{DB:db,FILES:scratchBucket});};
  const photoPath=`/s/${site}/assets/${gardenPhotos[0]}.jpg`;
  const page=await serve(`/s/${site}/`);assert.equal(page.status,200);assert.equal(await page.text(),publishedHTML,'Restored rows publish the exact version HTML');
  for(const [index,photo] of gardenPhotos.entries()){
   const response=await serve(`/s/${site}/assets/${photo}.jpg`);assert.equal(response.status,200);
   const bytes=new Uint8Array(await response.arrayBuffer());assert.deepEqual(bytes,syntheticJPEG(index+1),'Restored bytes are the exact uploaded photo');assert.equal(hash(bytes),publishedPhotos[index].digest);
  }
  assert.equal((await serve(`/s/${site}/assets/${strayPhoto}.jpg`)).status,404,'A photo outside the published version is not served');
  assert.equal((await serve(`/s/${neighbour.project}/assets/${gardenPhotos[0]}.jpg`)).status,404,'A photo cannot be served through another project');
  const restoredReport=await reconcileArtifacts(scratchDB,scratchBucket);assert.deepEqual([restoredReport.status,restoredReport.publishedSitePhotos],['consistent',2]);
  // Missing, altered and metadata-less bodies fail visibly in both the reconciliation and the serving path.
  const goodBody=Buffer.from(syntheticJPEG(1)),stored=scratchBucket.objects.get(publishedPhotos[0].object_key);
  const variant=async(label,put,code,status)=>{
   await scratchBucket.delete(publishedPhotos[0].object_key);if(put)await scratchBucket.put(publishedPhotos[0].object_key,...put);
   holds['photo:'+label]=(await reconcileArtifacts(scratchDB,scratchBucket)).holds;assert.deepEqual(holds['photo:'+label],code?[code]:[],label);
   assert.equal((await serve(photoPath)).status,status,label);
  };
  const flipped=Buffer.from(goodBody);flipped[flipped.length-4]^=1;
  await variant('missing-body',null,'site-photo-bytes',503);
  await variant('altered-body',[flipped,{httpMetadata:stored.httpMetadata,customMetadata:stored.customMetadata}],'site-photo-bytes',503);
  await variant('metadata-lost',[goodBody,{}],'site-photo-metadata',503);
  await variant('restored-exactly',[goodBody,{httpMetadata:stored.httpMetadata,customMetadata:stored.customMetadata}],undefined,200);
 }catch(error){scratchSQL.close();throw error;}
 scratchSQL.close();
 // Archived-row edits: the wrong project's photo, an unapproved receipt and a changed digest.
 const photoTamper=[
  ['wrong-project',[['version_photos','file_id',cell(strayPhoto),(row,columns)=>row[columns.indexOf('file_id')]===cell(gardenPhotos[1])]],['site-photo-project']],
  ['unapproved',[['project_photo_safety','state',"'pending'",(row,columns)=>row[columns.indexOf('file_id')]===cell(gardenPhotos[0])]],['site-photo-safety']],
  ['changed-digest',[['project_files','digest',"'"+'0'.repeat(64)+"'",(row,columns)=>row[columns.indexOf('id')]===cell(gardenPhotos[1])]],['site-photo-bytes','site-photo-safety']],
 ];
 for(const [label,changes,expected] of photoTamper){
  const sql=await tamperedCopy(changes);
  try{
   const copy=sqliteD1Adapter(sql),report=await reconcileArtifacts(copy,objects);holds['photo:'+label]=report.holds;assert.deepEqual(report.holds,expected,label);
   if(label==='wrong-project'){holds.tamperedPhotoCandidate=(await inspect({db:copy})).holds;assert.deepEqual(holds.tamperedPhotoCandidate,['manifest-mismatch']);}
  }finally{sql.close();}
 }

 // ---- Identity, revocation, deletion and publication changes after the point.
 const replacement=await workspaceSession(db,m,{account:owner.account,credential:owner.credential}),current=await replacement.scope();
 await owner.revoke();
 revision=(await m.readChat(current,owner.account)).state.revision;const withdraw=id();
 assert.equal((await m.sendChat(current,owner.account,{id:withdraw,revision,content:'/unpublish '+site})).status,200);
 revision=(await m.readChat(current,owner.account)).state.revision;
 assert.equal((await m.sendChatControl(current,owner.account,{id:id(),revision,action:{type:'confirm',kind:'site',reviewId:withdraw}})).status,200);
 assert.equal((await db.prepare('SELECT version_id FROM publications WHERE project_id=?').bind(site).first()).version_id,null);
 const erased=visitors[1],deletion=await m.appLifecycle.prepareAppDeletion(db,erased.session,app);
 assert.equal((await m.appLifecycle.deleteAppAccount(db,erased.session,app,deletion.id,deletion.revision,'DELETE')).deleted,true);
 const gaps=await phase('reconciliationInventory',()=>restoreDiscrepancies(target.DRILL_A,db));
 assert.ok(gaps.tables.resurrected.identity_sessions>=1&&gaps.tables.resurrected.app_visitors===1&&gaps.tables.resurrected.app_documents===1&&gaps.tables.rolledBack.publications===1,JSON.stringify(gaps));
 const revoked=await inspect();holds.afterRevocation=revoked.holds;assert.equal(revoked.status,'held');
 assert.ok(['suppressed-record','stale-authority'].includes(revoked.holds[0]),JSON.stringify(revoked.holds));
 // The candidate is held, not scrubbed: the restored rows remain present for WH-019.
 assert.ok(await target.DRILL_A.prepare('SELECT id FROM identity_sessions WHERE id=?').bind(owner.authority).first());
 assert.ok(await target.DRILL_A.prepare('SELECT id FROM app_visitors WHERE id=?').bind(erased.who).first());

 // ---- Total control-database loss: no independent current authority on main.
 const lost={prepare(){throw Error('source lost');},batch(){throw Error('source lost');}};
 // Total loss: the authority was proven while the database existed; every later evidence request must re-prove it and cannot.
 const lostPlatform=await syntheticPlatform({database:db}),lostAuthority=await lostPlatform.authority();lostPlatform.replace(lost);
 const orphan=await openRestoreInventory({inventoryFile,expectedStreamId:streamId,authority:lostAuthority});closers.push(()=>orphan.close());
 holds.sourceLost=(await inspectOnce({evidenceSource:orphan.evidenceSource})).holds;assert.deepEqual(holds.sourceLost,['independent-evidence']);
 const lostReport=await restoreDiscrepancies(target.DRILL_A,lost);assert.deepEqual([lostReport.sourceAvailable,lostReport.reconciliation,'sourceHold' in lostReport],[false,'unavailable-without-current-source',false]);

 // ---- A point captured during in-flight provider work never dispatches or admits.
 const inflight=id();
 await db.prepare("INSERT INTO standard_ai_requests(id,user_id,request_hash,created_at,updated_at) VALUES(?,?,?,'2026-10-08','2026-10-08')").bind(inflight,owner.account,'c'.repeat(64)).run();
 await db.prepare("UPDATE standard_ai_requests SET state='dispatched' WHERE id=?").bind(inflight).run();
 await files.put(objectKeys[1],'Synthetic private planting notes');
 const pointB=join(directory,'points','B'),snapshotB='drill-point-b';
 const captureB=await captureRecoveryPoint({authority,objects:{get:async key=>(await files.get(key))??(await target.OBJECTS_A.get(key))},directory:pointB,snapshotId:snapshotB});
 const archivedB=await openArchivedControl(pointB,captureB.pointDigest);let manifestB;try{manifestB=await inventory.registerArchive({archiveDb:archivedB.db,snapshotId:snapshotB,keyBackup});}finally{archivedB.close();}
 await restoreControlD1(target.DRILL_B,pointB,captureB.pointDigest);await restoreObjects(target.OBJECTS_B,pointB,captureB.pointDigest);
 const inspectB=()=>inspectIsolatedRestore({db:target.DRILL_B,manifest:manifestB,keyBackup,evidenceSource:inventory.evidenceSource,expectedStreamId:streamId,objects:isolatedObjects(target.OBJECTS_B)});
 const executed=executions;
 holds.inFlightSource=(await inspectB()).holds;assert.deepEqual(holds.inFlightSource,['independent-evidence'],'Unresolved current effects refuse evidence');
 // The source is readable; the dispatched AI request (a real unsettled effect) is what holds the comparison, not a lost source.
 holds.inFlightReport=await restoreDiscrepancies(target.DRILL_B,db);assert.deepEqual([holds.inFlightReport.sourceAvailable,holds.inFlightReport.reconciliation,holds.inFlightReport.sourceHold,'counts' in holds.inFlightReport],[true,'held-current-source-unsettled','uncertain-effect',false]);
 await db.prepare("UPDATE standard_ai_requests SET state='completed',input_tokens=1,output_tokens=1 WHERE id=?").bind(inflight).run();
 await inventory.observe({operationId:'drill-inflight-terminal',selection:{kind:'external-effect',store:'standard_ai_requests',effectId:inflight}});
 holds.inFlightCandidate=(await retryIndependentEvidence(inspectB)).holds;// The settled source row now differs from the archived in-flight row, so the derived
 // current-record constraint holds it first; the restore-admission suite covers the
 // separate uncertain-effect refusal for an unchanged in-flight candidate.
 assert.deepEqual(holds.inFlightCandidate,['stale-authority'],'The recovered in-flight row stays held after reconciliation');
 assert.equal(executions,executed,'Admission and reconciliation dispatched no runtime work');

 const summary={suite:'WH-008 isolated local disaster-recovery drill',node:process.versions.node,
  inventory:{controlRows:capture.controlRows,controlBytes:capture.controlBytes,restoreStatements:control.statements,objects:capture.objects,objectBytes:capture.objectBytes,runtimeFiles:worker.files,workerArtifacts:Object.fromEntries(Object.entries(restoredWorkers).map(([role,r])=>[role,r.files])),publishedSitePhotos:artifacts.publishedSitePhotos,credentials:admitted.keys.credentials,keyIds:admitted.keys.keyIds.length,tables:admitted.tables,artifacts:{publishedSites:artifacts.publishedSites,publishedBackends:artifacts.publishedBackends,applications:artifacts.applications,applicationDocuments:artifacts.applicationDocuments}},
  measured:{phasesMs:phases,restoreToVerifiedMs:rto,lossSinceSnapshot:{...loss.tables.lostSinceSnapshot,objects:1},pointAgeAtDisasterMs:disasterAt-capture.capturedAt},
  execution:probe,
  holds,afterRevocationTables:gaps.tables,drillRefusals:refusals,independentEvidenceRetries:independentEvidenceRetries.length,afterRevocationCounts:gaps.counts,servingAllowed:false,providerDispatchAllowed:false,retirementAllowed:false,remoteAccess:false};
 console.log(JSON.stringify(summary,null,1));
}finally{
 globalThis.fetch=network;
 for(const close of closers.reverse())await close().catch(()=>{});
 await restoredRuntime?.dispose();await sourceRuntime?.dispose();await isolated?.dispose();await fixture?.close();
 await rm(directory,{recursive:true,force:true});
}
