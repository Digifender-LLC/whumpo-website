import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {saveBuildSnapshot,verifyBuildSnapshot,readBuildInputs} from '../tools/build-snapshot.mjs';
import {prepareRelease,archivedConfig,expectedServiceBindings} from '../tools/prepare-release.mjs';
import {workerOrder,configFiles,readJSON,verifyRelease,applyRelease,fileInventory,validateCompatibility,digest,copyTree,assertWorker,statusReconciliation} from '../tools/release-manifest.mjs';
import {currentSchemaArtifact,schemaSummary,currentSchemaPlan} from '../tools/current-schema.mjs';
import {bindingSummary} from '../tools/release-provider.mjs';

const root=await mkdtemp(join(tmpdir(),'whumpo-release-'));
let artifact;
const databaseId='11111111-1111-4111-8111-111111111111',previousDatabaseId='22222222-2222-4222-8222-222222222222';
const configs={};
// Nonempty registration metadata only; never provision or invoke a CMS instance.
const cmsFixture={project_id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',user_id:'fixture-owner',review_id:'fixture-review',worker_name:'whumpo-cms-bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb',database_name:'fixture-db',bucket_name:'fixture-bucket',state:'connected',database_id:'fixture-db-id',session_namespace_id:'fixture-namespace',deployed_version_id:'fixture-cms-version',created_at:'2026-09-30T00:00:00.000Z',account_id:'a'.repeat(32),source_digest:'b'.repeat(64),secret_digest:'c'.repeat(64),origin:'https://cms-fixture.example.test',tag:'fixture-cms-tag',deployment_state:'connected',worker_version_id:'fixture-cms-version',platform_version_id:'before-platform'};
const cmsBinding={binding:'CMS_bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb',service:cmsFixture.worker_name,environment:'production'};
let live,counts,failAfter,failBefore,observeFailure,mutations;
const reportedServices=role=>[...(configs[role].services??[]).map(s=>({...s,environment:'production'})),...(role==='platform'?[cmsBinding]:[])];
const baseline=()=>({workers:Object.fromEntries(workerOrder.map(role=>[role,{id:'before-'+role,tag:null,services:reportedServices(role),secrets:role==='platform'?['AI_API_KEY','CMS_BRIDGE_MASTER_KEY']:[],databases:role==='runtime'?[]:[{binding:'DB',id:databaseId}]}])),cms:[structuredClone(cmsFixture)],schema:artifact.expected});
const driver={
 configs,verifyToolchain:async()=>{},withLock:async(manifest,work)=>work(async()=>{}),
 observe:async()=>{if(observeFailure){observeFailure=false;throw Error('Private provider error must not be persisted');}return structuredClone(live);},
 compile:async(role,base,output)=>{await mkdir(output,{recursive:true});await writeFile(join(output,'index.js'),'// compiled '+role);if(role==='runtime')await writeFile(join(output,'runtime.wasm'),'compiled wasm');return 'index.js';},
 initialize:async(manifest,directory)=>{mutations++;counts.schema++;const journal=await readJSON(join(directory,'journal.json'));assert.equal(journal.steps.schema.status,'running');live.schema=manifest.schema.expected;},
 deploy:async(role,manifest,directory,guard,onDeployed)=>{
  mutations++;counts[role]++;
  const journal=await readJSON(join(directory,'journal.json'));assert.equal(journal.steps[role].status,'running');
  if(failBefore===role)throw Error('Private failed command detail');
  live.workers[role]={id:'after-'+role,tag:manifest.workers[role].tag,services:manifest.workers[role].services,databases:manifest.workers[role].databases,secrets:[...live.workers[role].secrets]};
  await onDeployed();
  if(failAfter===role){failAfter=null;observeFailure=true;}
 }
};
const reset=()=>{live=baseline();counts=Object.fromEntries(['schema',...workerOrder].map(k=>[k,0]));failAfter=null;failBefore=null;observeFailure=false;mutations=0;};
let review;
const prepare=()=>prepareRelease(root,driver,review,{git:()=>({commit:'a'.repeat(40),dirty:false})});
try{
 for(const dir of ['src','frontend','web','public-app','tools','dist','src/workspace-identity','src/funnel-metrics','src/guest-previews','src/shared-modules','src/account-lifecycle','src/restore-suppression','node_modules/wrangler','compiler-locks','schema'])await mkdir(join(root,dir),{recursive:true});
 for(const name of ['package.json','pnpm-lock.yaml','vite.config.ts','tsconfig.json','tsconfig.frontend.json','tools/current-schema.mjs','schema/platform.sql','tools/build.mjs','tools/build-pwa.mjs','tools/build-snapshot.mjs','tools/deploy-platform.mjs','tools/check-specification-compiler.mjs','compiler-locks/project-content-v6.json','tools/check-service-client-compiler.mjs','compiler-locks/project-service-clients-v4.json'])await writeFile(join(root,name),'fixture');
 await writeFile(join(root,'node_modules/wrangler/package.json'),JSON.stringify({version:'4.test'}));
 for(const name of ['tools/artifact-protection.mjs','tools/secret-custody.mjs'])await writeFile(join(root,name),'fixture');
 for(const role of workerOrder){
  configs[role]={name:'whumpo-'+role,account_id:'a'.repeat(32),main:'src/index.ts',vars:{ENVIRONMENT:'test'},workers_dev:false,preview_urls:false,...(role==='runtime'?{}:{d1_databases:[{binding:'DB',database_name:'whumpo-control-chat-connections-test',database_id:databaseId}]}),...(['apps','platform'].includes(role)?{assets:{directory:role==='apps'?'./public-app':'./dist'}}:{})};
  if(role==='apps')configs[role].services=[{binding:'BACKEND_RUNTIME',service:'whumpo-runtime'}];
  await writeFile(join(root,configFiles[role]),JSON.stringify(configs[role]));
 }
 await writeFile(join(root,'src/index.ts'),'source');await writeFile(join(root,'dist/index.html'),'static asset');await writeFile(join(root,'public-app/visitor.js'),'visitor');
 // Model the real nonempty input trees: archives retain files, not empty dirs.
 await writeFile(join(root,'frontend/main.tsx'),'frontend source');await writeFile(join(root,'web/visitor.ts'),'visitor source');
 await writeFile(join(root,'src/workspace-identity/canonical-inputs.sql'),'CREATE TABLE users(id TEXT PRIMARY KEY);');
 await writeFile(join(root,'schema/platform.sql'),'CREATE TABLE projects(id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id));');
 await writeFile(join(root,'src/workspace-identity/schema.sql'),'CREATE TABLE identity_sessions(id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id));');
 await writeFile(join(root,'src/funnel-metrics/schema.sql'),'CREATE TABLE funnel_events(user_id TEXT REFERENCES users(id));');
 await writeFile(join(root,'src/guest-previews/schema.sql'),'CREATE TABLE guest_preview_links(owner_user_id TEXT REFERENCES users(id));');
  await writeFile(join(root,'src/shared-modules/schema.sql'),'CREATE TABLE module_instances(project_id TEXT REFERENCES projects(id));');
 await writeFile(join(root,'src/account-lifecycle/schema.sql'),'CREATE TABLE account_export_usage(user_id TEXT REFERENCES users(id));');
 await writeFile(join(root,'src/restore-suppression/schema.sql'),'CREATE TABLE restore_suppressions(kind TEXT);');
 artifact=await currentSchemaArtifact(root);
 await saveBuildSnapshot(root);await writeFile(join(root,'.secrets/private.key'),'DO_NOT_ARCHIVE');reset();
 review={version:3,environment:'test',buildInputs:(await readJSON(join(root,'.secrets/build-snapshot.json'))).inputs.sha256,review:'synthetic mixed-version review',mixedWorkersCompatible:true,schemaChange:'none',schemaSha256:artifact.sqlSha256};
 await assert.rejects(()=>prepareRelease(root,driver,{...review,buildInputs:'wrong'}),/current build inputs/);
 const first=await prepare(),manifest=await verifyRelease(first.directory);
 assert.equal(mutations,0);assert.deepEqual(manifest.order,workerOrder);assert.equal(manifest.schema.mode,'none');
 assert.equal(manifest.before.workers.platform.id,'before-platform');
 assert.deepEqual(manifest.cms,[cmsFixture]);assert.deepEqual(manifest.before.cms,[cmsFixture]);assert.deepEqual(manifest.workers.platform.services,[cmsBinding]);
 assert.deepEqual(manifest.workers.apps.services,[{binding:'BACKEND_RUNTIME',service:'whumpo-runtime',environment:'production'}]);
 for(const mismatch of [{service:'other'},{environment:'staging'},{entrypoint:'Other'}])assert.throws(()=>assertWorker(manifest,'apps',{tag:manifest.workers.apps.tag,services:[{...manifest.workers.apps.services[0],...mismatch}],secrets:[]}),/service bindings changed/);
 assert.throws(()=>assertWorker(manifest,'apps',{tag:manifest.workers.apps.tag,services:manifest.workers.apps.services,databases:[{binding:'DB',id:previousDatabaseId}],secrets:[]}),/database bindings changed/);
 assert.deepEqual(expectedServiceBindings([{binding:'TEST',service:'worker',entrypoint:'API'}]),[{binding:'TEST',service:'worker',environment:'production',entrypoint:'API'}]);
 assert.throws(()=>expectedServiceBindings([{binding:'TEST',service:'worker',props:{unexpected:true}}]),/archive support/);
 assert.ok(manifest.files.some(f=>f.path==='workers/runtime/runtime.wasm'));
 for(const name of ['project-content-v6.json','project-service-clients-v4.json'])assert.ok(manifest.files.some(f=>f.path==='source/compiler-locks/'+name),'Required compiler lock missing from archived source: '+name);
 assert.ok(!JSON.stringify(manifest).includes('DO_NOT_ARCHIVE'));
 assert.ok(!manifest.files.some(f=>f.path.includes('.secrets')||f.path.includes('node_modules')));
 assert.equal((await readJSON(join(first.directory,'payload/config/platform.json'))).assets.directory,'../assets/platform');
 for(const path of ['workers/runtime/index.js','workers/runtime/runtime.wasm','assets/platform/index.html','schema/current.sql','config/platform.json','source/pnpm-lock.yaml','source/compiler-locks/project-content-v6.json','source/compiler-locks/project-service-clients-v4.json']){
  const file=join(first.directory,'payload',path),bytes=await readFile(file);await writeFile(file,'changed');await assert.rejects(()=>applyRelease(first.directory,driver),/mismatch/);assert.equal(mutations,0);await writeFile(file,bytes);
 }
 await writeFile(join(first.directory,'payload/unexpected'),'extra');await assert.rejects(()=>verifyRelease(first.directory));await rm(join(first.directory,'payload/unexpected'));
 await symlink(join(root,'.secrets/private.key'),join(first.directory,'payload/link'));await assert.rejects(()=>verifyRelease(first.directory),/symlink/);await rm(join(first.directory,'payload/link'));
 const manifestText=await readFile(join(first.directory,'manifest.json'));await writeFile(join(first.directory,'manifest.json'),'{}');await assert.rejects(()=>verifyRelease(first.directory),/manifest changed/);await writeFile(join(first.directory,'manifest.json'),manifestText);
 // Failure after every completed CLI step, before readback. Resume observes and
 // settles that version, then executes only the remaining suffix of the release.
 for(const role of workerOrder){
  reset();const release=await prepare();failAfter=role;
  await assert.rejects(()=>applyRelease(release.directory,driver),new RegExp('stopped at '+role));
  const interrupted=await readJSON(join(release.directory,'journal.json'));
  assert.deepEqual((await verifyRelease(release.directory)).cms,[cmsFixture]);assert.deepEqual(live.cms,[cmsFixture]);
  assert.equal(interrupted.steps[role].status,'unknown');assert.equal(interrupted.steps[role].operationConfirmed,true);
  const result=await applyRelease(release.directory,driver);assert.equal(result.status,'deployed');
  assert.deepEqual(Object.values(counts),[0,1,1,1,1]);
  await applyRelease(release.directory,driver);assert.deepEqual(Object.values(counts),[0,1,1,1,1]);assert.deepEqual(live.cms,[cmsFixture]);assert.deepEqual(live.workers.platform.services,[cmsBinding]);
  assert.ok(!(await readFile(join(release.directory,'journal.json'),'utf8')).includes('Private'));
  live.workers.platform.secrets=[];await assert.rejects(()=>applyRelease(release.directory,driver),/required secret/);assert.deepEqual(Object.values(counts),[0,1,1,1,1]);
 }
 // An ambiguous command cannot be replayed, even if a tagged version appeared.
 reset();const unknown=await prepare();failBefore='apps';
 await assert.rejects(()=>applyRelease(unknown.directory,driver),/stopped at apps/);const attempts=mutations;
 failBefore=null;live.workers.apps={id:'maybe-apps',tag:unknown.manifest.workers.apps.tag,services:[],secrets:[]};
 await assert.rejects(()=>applyRelease(unknown.directory,driver),/command outcome is unresolved/);assert.equal(mutations,attempts);
 for(const modify of [()=>live.workers.runtime.id='foreign',()=>live.cms.push({project_id:'new'}),()=>live.schema={...live.schema,sha256:'drift'}]){
  reset();const candidate=await prepare();modify();await assert.rejects(()=>applyRelease(candidate.directory,driver));assert.equal(mutations,0);
 }
 // Initialization is allowed only for a new empty database, never an active
 // database or an in-place conversion. Ordinary releases retain the same DB.
 const normalReview=review;
 const resetToEmpty=()=>{
  reset();live.schema=schemaSummary([]);live.cms=[];
  for(const role of workerOrder){live.workers[role].services=live.workers[role].services.filter(s=>!s.binding.startsWith('CMS_'));live.workers[role].databases=role==='runtime'?[]:[{binding:'DB',id:previousDatabaseId}];}
  review={...normalReview,schemaChange:'initialize',testDataResetAuthorized:true,cutoverReview:'Disposable test data, new unbound database; retire old resources separately'};
 };
 resetToEmpty();const initialized=await prepare();
 assert.equal(initialized.manifest.schema.mode,'initialize');
 assert.equal((await applyRelease(initialized.directory,driver)).status,'deployed');
 assert.deepEqual(Object.values(counts),[1,1,1,1,1]);
 assert.deepEqual(live.workers.platform.databases,[{binding:'DB',id:databaseId}]);
 await applyRelease(initialized.directory,driver);assert.deepEqual(Object.values(counts),[1,1,1,1,1]);
 resetToEmpty();live.workers.sites.databases=[{binding:'DB',id:databaseId}];await assert.rejects(()=>prepare(),/not bound to an active Worker/);assert.equal(mutations,0);
 resetToEmpty();live.cms=[cmsFixture];await assert.rejects(()=>prepare(),/retirement review/);assert.equal(mutations,0);
 resetToEmpty();live.schema=artifact.expected;review=normalReview;await assert.rejects(()=>prepare(),/replacement must start/);assert.equal(mutations,0);
 resetToEmpty();live.schema={...artifact.expected,sha256:'retired-account-schema'};await assert.rejects(()=>prepare(),/not the current schema/);assert.equal(mutations,0);
 // Even a matching schema does not prove an uncertain import command ended.
 resetToEmpty();const unknownSchema=await prepare(),originalInitialize=driver.initialize;
 driver.initialize=async()=>{mutations++;live.schema=artifact.expected;throw Error('Private SQL failure');};
 await assert.rejects(()=>applyRelease(unknownSchema.directory,driver),/stopped at schema/);assert.equal(counts.runtime,0);
 await assert.rejects(()=>applyRelease(unknownSchema.directory,driver),/Schema command outcome is unresolved/);assert.equal(mutations,1);driver.initialize=originalInitialize;
 const plan=currentSchemaPlan(artifact,schemaSummary([]));
 assert.throws(()=>validateCompatibility({...review,schemaSha256:'wrong'},plan),/complete current schema/);
 assert.throws(()=>validateCompatibility({...review,previousWorkersCompatible:true},plan),/compatibility/);
 assert.throws(()=>validateCompatibility({...review,migrations:[]},plan),/compatibility/);
 assert.throws(()=>validateCompatibility({...review,testDataResetAuthorized:false},plan),/data-reset authorization/);
 assert.throws(()=>validateCompatibility({...review,version:2},plan),/current test-release/);
 assert.throws(()=>validateCompatibility({...review,environment:'production'},plan),/current test-release/);
 review=normalReview;reset();
 // Binding inventory preserves identities while stripping credential values.
 assert.deepEqual(bindingSummary([{type:'secret_text',name:'AI_API_KEY',text:'PRIVATE_VALUE'},{type:'service',name:'CMS_x',service:'cms-x',token:'PRIVATE_VALUE'}]),{databases:[],services:[{binding:'CMS_x',service:'cms-x'}],secrets:['AI_API_KEY']});
 assert.throws(()=>bindingSummary([{type:'plain_text',name:'AI_API_KEY',text:'PRIVATE_VALUE'}]),/custody/);
 const cms=[{project_id:'abc-def',worker_name:'whumpo-cms-abcdef',deployment_state:'connected'}];
 assert.deepEqual(archivedConfig('platform',configs.platform,'index.js',cms).services,[{binding:'CMS_abcdef',service:'whumpo-cms-abcdef'}]);
 assert.throws(()=>archivedConfig('platform',{...configs.platform,build:{command:'unexpected'}},'index.js',[]),/archive support/);
 // Previous candidate bytes are retained after later preparations/deployments.
 await verifyRelease(first.directory);await copyTree(join(first.directory,'payload'),join(root,'restored-payload'));
 assert.deepEqual(await fileInventory(join(first.directory,'payload')),await fileInventory(join(root,'restored-payload')));
 // Reconstruct the recorded build from source + assets. Do not mint a new
 // snapshot: the original manifest must validate the recovered compiler inputs.
 const recovered=join(root,'recovered-checkout');await copyTree(join(first.directory,'payload/source'),recovered);
 await copyTree(join(first.directory,'payload/assets/platform'),join(recovered,'dist'));
 await copyTree(join(first.directory,'payload/assets/apps'),join(recovered,'public-app'));
 await mkdir(join(recovered,'.secrets'));await writeFile(join(recovered,'.secrets/build-snapshot.json'),JSON.stringify(manifest.build));
 assert.deepEqual(await readBuildInputs(recovered),manifest.build.inputs);
 assert.deepEqual(await verifyBuildSnapshot(recovered),manifest.build);
 // Read-only status: a finished release whose tags moved on is superseded; incomplete ones keep the error.
 {reset();const release=await prepare();await applyRelease(release.directory,driver);
  const done=await readJSON(join(release.directory,'journal.json')),m=await verifyRelease(release.directory);
  assert.equal(statusReconciliation(m,done,live),'ready');
  live.workers.platform={...live.workers.platform,id:'ci-platform',tag:'ci-tag'};
  const out=statusReconciliation(m,done,live);
  assert.equal(out.result,'superseded by a later release');assert.deepEqual(out.live.platform,{id:'ci-platform',tag:'ci-tag'});
  assert.equal(statusReconciliation(m,{...done,status:'needs-reconciliation'},live),'Candidate Worker version was not confirmed');
  for(const step of [{status:'pending'},{status:'unknown',operationConfirmed:true}])assert.equal(typeof statusReconciliation(m,{...done,steps:{...done.steps,platform:step}},live),'string');
 }
 console.log('Current-schema release manifests passed: immutable four-Worker artifacts/assets/SQL, no secret copies, exact current schema, empty unbound initialization, active DB/reset refusals, drift refusal, persisted intent, partial failures at all four steps, reconciliation without duplicate deployment, uncertain-command holds, nonempty CMS registration/binding preservation and recovered build inputs including compiler locks.');
}finally{await rm(root,{recursive:true,force:true});}
