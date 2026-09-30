import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {saveBuildSnapshot} from '../tools/build-snapshot.mjs';
import {prepareRelease,archivedConfig} from '../tools/prepare-release.mjs';
import {workerOrder,configFiles,readJSON,verifyRelease,applyRelease,fileInventory,migrationPlan,validateCompatibility,digest,copyTree} from '../tools/release-manifest.mjs';
import {bindingSummary} from '../tools/release-provider.mjs';

const root=await mkdtemp(join(tmpdir(),'whumpo-release-'));
const sql=['0001_initial.sql','0002_expand.sql'];
const configs={};
let live,counts,failAfter,failBefore,observeFailure,mutations;
const baseline=()=>({workers:Object.fromEntries(workerOrder.map(role=>[role,{id:'before-'+role,tag:null,services:configs[role].services??[],secrets:role==='platform'?['AI_API_KEY']:[]}])),cms:[],migrations:sql.slice(0,1)});
const driver={
 configs,verifyToolchain:async()=>{},withLock:async work=>work(async()=>{}),
 observe:async()=>{if(observeFailure){observeFailure=false;throw Error('Private provider error must not be persisted');}return structuredClone(live);},
 compile:async(role,base,output)=>{await mkdir(output,{recursive:true});await writeFile(join(output,'index.js'),'// compiled '+role);if(role==='runtime')await writeFile(join(output,'runtime.wasm'),'compiled wasm');return 'index.js';},
 migrate:async(manifest,directory)=>{mutations++;counts.migrations++;const journal=await readJSON(join(directory,'journal.json'));assert.equal(journal.steps.migrations.status,'running');live.migrations=[...sql];},
 deploy:async(role,manifest,directory,guard,onDeployed)=>{
  mutations++;counts[role]++;
  const journal=await readJSON(join(directory,'journal.json'));assert.equal(journal.steps[role].status,'running');
  if(failBefore===role)throw Error('Private failed command detail');
  live.workers[role]={id:'after-'+role,tag:manifest.workers[role].tag,services:manifest.workers[role].services,secrets:[...live.workers[role].secrets]};
  await onDeployed();
  if(failAfter===role){failAfter=null;observeFailure=true;}
 }
};
const reset=()=>{live=baseline();counts=Object.fromEntries(['migrations',...workerOrder].map(k=>[k,0]));failAfter=null;failBefore=null;observeFailure=false;mutations=0;};
let review;
const prepare=()=>prepareRelease(root,driver,review,{git:()=>({commit:'a'.repeat(40),dirty:false})});
try{
 for(const dir of ['src','frontend','web','public-app','tools','dist','migrations','node_modules/wrangler'])await mkdir(join(root,dir),{recursive:true});
 for(const name of ['package.json','pnpm-lock.yaml','vite.config.ts','tsconfig.json','tsconfig.frontend.json','tools/build.mjs','tools/build-snapshot.mjs','tools/deploy-platform.mjs'])await writeFile(join(root,name),'fixture');
 await writeFile(join(root,'node_modules/wrangler/package.json'),JSON.stringify({version:'4.test'}));
 for(const role of workerOrder){
  configs[role]={name:'tellumo-'+role,account_id:'a'.repeat(32),main:'src/index.ts',workers_dev:false,preview_urls:false,...(role==='runtime'?{}:{d1_databases:[{binding:'DB',database_name:'tellumo-control',database_id:'1'.repeat(36),migrations_dir:'./migrations'}]}),...(['apps','platform'].includes(role)?{assets:{directory:role==='apps'?'./public-app':'./dist'}}:{})};
  await writeFile(join(root,configFiles[role]),JSON.stringify(configs[role]));
 }
 await writeFile(join(root,'src/index.ts'),'source');await writeFile(join(root,'dist/index.html'),'static asset');await writeFile(join(root,'public-app/visitor.js'),'visitor');
 await writeFile(join(root,'migrations',sql[0]),'CREATE TABLE fixture(id);');await writeFile(join(root,'migrations',sql[1]),'ALTER TABLE fixture ADD COLUMN label TEXT;');
 await saveBuildSnapshot(root);await writeFile(join(root,'.secrets/private.key'),'DO_NOT_ARCHIVE');reset();
 review={version:1,buildInputs:(await readJSON(join(root,'.secrets/build-snapshot.json'))).inputs.sha256,review:'synthetic mixed-version review',mixedWorkersCompatible:true,schemaChange:'backward-compatible',previousWorkersCompatible:true,schemaReview:'synthetic schema review',migrations:[{name:sql[1],sha256:digest(await readFile(join(root,'migrations',sql[1])))}]};
 await assert.rejects(()=>prepareRelease(root,driver,{...review,buildInputs:'wrong'}),/current build inputs/);
 const first=await prepare(),manifest=await verifyRelease(first.directory);
 assert.equal(mutations,0);assert.deepEqual(manifest.order,workerOrder);assert.equal(manifest.migrations.pending.length,1);
 assert.equal(manifest.before.workers.platform.id,'before-platform');
 assert.ok(manifest.files.some(f=>f.path==='workers/runtime/runtime.wasm'));
 assert.ok(!JSON.stringify(manifest).includes('DO_NOT_ARCHIVE'));
 assert.ok(!manifest.files.some(f=>f.path.includes('.secrets')||f.path.includes('node_modules')));
 assert.equal((await readJSON(join(first.directory,'payload/config/platform.json'))).assets.directory,'../assets/platform');
 for(const path of ['workers/runtime/index.js','workers/runtime/runtime.wasm','assets/platform/index.html','migrations/'+sql[1],'config/platform.json','source/pnpm-lock.yaml']){
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
  assert.equal(interrupted.steps[role].status,'unknown');assert.equal(interrupted.steps[role].operationConfirmed,true);
  const result=await applyRelease(release.directory,driver);assert.equal(result.status,'deployed');
  assert.deepEqual(Object.values(counts),[1,1,1,1,1]);
  await applyRelease(release.directory,driver);assert.deepEqual(Object.values(counts),[1,1,1,1,1]);
  assert.ok(!(await readFile(join(release.directory,'journal.json'),'utf8')).includes('Private'));
  live.workers.platform.secrets=[];await assert.rejects(()=>applyRelease(release.directory,driver),/required secret/);assert.deepEqual(Object.values(counts),[1,1,1,1,1]);
 }
 // An ambiguous command cannot be replayed, even if a tagged version appeared.
 reset();const unknown=await prepare();failBefore='apps';
 await assert.rejects(()=>applyRelease(unknown.directory,driver),/stopped at apps/);const attempts=mutations;
 failBefore=null;live.workers.apps={id:'maybe-apps',tag:unknown.manifest.workers.apps.tag,services:[],secrets:[]};
 await assert.rejects(()=>applyRelease(unknown.directory,driver),/command outcome is unresolved/);assert.equal(mutations,attempts);
 for(const modify of [()=>live.workers.runtime.id='foreign',()=>live.cms.push({project_id:'new'}),()=>live.migrations.push('9999_unknown.sql')]){
  reset();const candidate=await prepare();modify();await assert.rejects(()=>applyRelease(candidate.directory,driver));assert.equal(mutations,0);
 }
 reset();const migrated=await prepare();const originalMigrate=driver.migrate;
 driver.migrate=async()=>{mutations++;throw Error('Private SQL failure');};await assert.rejects(()=>applyRelease(migrated.directory,driver),/stopped at migrations/);assert.equal(counts.runtime,0);
 await assert.rejects(()=>applyRelease(migrated.directory,driver),/Migration outcome is unresolved/);assert.equal(mutations,1);driver.migrate=originalMigrate;
 const migrationFiles=await fileInventory(join(root,'migrations')),plan=migrationPlan(migrationFiles,[sql[0]]);
 assert.throws(()=>migrationPlan(migrationFiles,[sql[1]]),/prefix/);
 assert.throws(()=>migrationPlan(migrationFiles,['0099_unknown.sql']),/unknown/);
 assert.throws(()=>validateCompatibility({...review,migrations:[]},plan),/exact pending/);
 assert.throws(()=>validateCompatibility({...review,schemaReview:''},plan),/schema review/);
 assert.throws(()=>validateCompatibility({...review,previousWorkersCompatible:'true'},plan),/compatibility/);
 assert.throws(()=>validateCompatibility({...review,schemaChange:'destructive'},plan),/separate restore/);
 validateCompatibility({...review,schemaChange:'destructive',restoreReview:'review-2',restoreEvidence:'disposable restore drill',recoveryStrategy:'forward-compatible contraction after old readers retired'},plan);
 // Binding inventory preserves identities while stripping credential values.
 assert.deepEqual(bindingSummary([{type:'secret_text',name:'KEY',text:'PRIVATE_VALUE'},{type:'service',name:'CMS_x',service:'cms-x',token:'PRIVATE_VALUE'}]),{services:[{binding:'CMS_x',service:'cms-x'}],secrets:['KEY']});
 const cms=[{project_id:'abc-def',worker_name:'townhello-cms-abcdef',deployment_state:'connected'}];
 assert.deepEqual(archivedConfig('platform',configs.platform,'index.js',cms).services,[{binding:'CMS_abcdef',service:'townhello-cms-abcdef'}]);
 assert.throws(()=>archivedConfig('platform',{...configs.platform,build:{command:'unexpected'}},'index.js',[]),/archive support/);
 // Previous candidate bytes are retained after later preparations/deployments.
 await verifyRelease(first.directory);await copyTree(join(first.directory,'payload'),join(root,'restored-payload'));
 assert.deepEqual(await fileInventory(join(first.directory,'payload')),await fileInventory(join(root,'restored-payload')));
 console.log('Release manifests passed: immutable four-Worker artifacts/assets/SQL, no secret copies, schema review, drift refusal, persisted intent, partial failures at all four steps, reconciliation without duplicate deployment, uncertain-command holds, binding inventory and recoverable archives.');
}finally{await rm(root,{recursive:true,force:true});}
