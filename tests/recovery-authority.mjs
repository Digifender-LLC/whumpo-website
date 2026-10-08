// WH-008 recovery SOURCE authority: capture and restore-evidence sources are derived from the database
// bound to the active platform, never from a caller-supplied adapter. Synthetic local fixtures only:
// the REAL release provider (observer, D1 REST adapter) runs against a synthetic account API
// (tests/helpers/synthetic-platform.mjs) over local SQLite databases; the REAL journaled
// prepareRelease/applyRelease produce the interrupted mixed-binding states. No network, provider,
// credential or remote Cloudflare access. Bracketing observations prove endpoints only; the tests
// document (and pin) that a binding which moves and moves back between them is NOT detected.
import assert from 'node:assert/strict';
import {DatabaseSync,backup} from 'node:sqlite';
import {mkdtemp,mkdir,writeFile,readFile,copyFile,readdir,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {sqliteD1,sqliteD1Adapter} from './sqlite-d1.mjs';
import {fixtureKeyring,initializeFixtureKeys} from './helpers/connection-keyring.mjs';
import {keyBackupFixture} from './helpers/key-backup.mjs';
import {syntheticPlatform,syntheticAuthority,syntheticDatabaseId} from './helpers/synthetic-platform.mjs';
import {observeRecoveryAuthority,recoveryAuthorityDatabase,reobserveRecoveryAuthority,isRecoveryAuthority,DrillHold} from '../tools/recovery-authority.mjs';
import {captureRecoveryPoint,verifyRecoveryPoint} from '../tools/recovery-drill.mjs';
import {createRestoreInventory,openRestoreInventory} from '../tools/restore-inventory.mjs';
import {restoreManifestDigest} from '../tools/restore-admission.mjs';
import {saveBuildSnapshot} from '../tools/build-snapshot.mjs';
import {prepareRelease} from '../tools/prepare-release.mjs';
import {applyRelease,workerOrder,configFiles,readJSON,digest} from '../tools/release-manifest.mjs';
import {currentSchemaArtifact,currentSchemaFiles,inspectSchema} from '../tools/current-schema.mjs';

Error.stackTraceLimit=0;
const directory=await mkdtemp(join(tmpdir(),'whumpo-recovery-authority-')),points=join(directory,'points');
await mkdir(points,{mode:0o700});
const baselineId=syntheticDatabaseId(1),targetId=syntheticDatabaseId(2),otherId=syntheticDatabaseId(3);
const network=globalThis.fetch;globalThis.fetch=()=>assert.fail('The authority tests must not use the network');
const closers=[],id=()=>crypto.randomUUID();let refusals=0,writes=0,pointNumber=0,hookCalls=null,onCall=null;
const holds=async(work,code)=>{await assert.rejects(work,e=>e instanceof DrillHold&&e.code===code,'expected hold '+code);refusals++;};
// Every synthetic API call is observed: no authority operation may ever issue a write.
const hook=async event=>{
 for(const sql of [event.sql].flat())if(typeof sql==='string'&&/^\s*(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\b/i.test(sql))writes++;
 hookCalls?.push(event);await onCall?.(event);
};
// Run `action` once, the first time `match(event)` holds (race injection between two observations).
function once_(match,action){let done=false;return async event=>{if(!done&&match(event)){done=true;await action();}};}
const objects={get:async()=>null};
const capture=authority=>captureRecoveryPoint({authority,objects,directory:join(points,'p'+(++pointNumber)),snapshotId:'authority-'+pointNumber});
const exists=async path=>{try{await access(path);return true;}catch{return false;}};
const full=async()=>{const f=await sqliteD1();closers.push(()=>f.close());return f;};

try{
 const baseline=await full(),other=await full();
 await baseline.db.prepare("INSERT INTO users VALUES('authority-owner','authority-owner@example.invalid','2026-10-08')").run();
 const artifact=await currentSchemaArtifact();

 // ---- 1. Capture reads the platform-bound database; the point records the observed source.
 const platform=await syntheticPlatform({database:baseline.db,databases:{[otherId]:other.db},hook}),{provider,live}=platform;
 const authority=await platform.authority();
 assert.equal(authority.databaseId,platform.configuredId);assert.equal(authority.accountId,provider.accountId);
 assert.equal(authority.provenance,'injected-client','A synthetic API client is recorded as injected, not as the account client');
 assert.deepEqual(authority.versions,{apps:'v-apps',sites:'v-sites',platform:'v-platform'});
 assert.equal(authority.schema.sqlSha256,artifact.sqlSha256);assert.equal(authority.schema.objectsSha256,(await inspectSchema(baseline.db)).sha256);
 assert.ok(!('db' in authority)&&!JSON.stringify(authority).includes('prepare'),'The database capability is not a public property');
 const first=await capture(authority),firstDir=join(points,'p1');
 const {point}=await verifyRecoveryPoint(firstDir,first.pointDigest);
 assert.equal(point.format,'whumpo-recovery-point-v2');
 assert.deepEqual([point.source.accountId,point.source.databaseId,point.source.versions,point.source.provenance,point.source.continuity],[authority.accountId,authority.databaseId,authority.versions,'injected-client','bracketing-observations']);
 assert.deepEqual(point.source.schema,{sqlSha256:artifact.sqlSha256,objectsSha256:authority.schema.objectsSha256});
 assert.ok(point.source.observed.before<=point.source.observed.after);assert.deepEqual(first.source,{accountId:authority.accountId,databaseId:authority.databaseId,versions:authority.versions});
 assert.equal(first.controlRows>0,true);

 // ---- 2. Interrupted REAL release cutovers: mixed apps/sites/platform bindings are refused; settled states are accepted.
 const root=await mkdtemp(join(tmpdir(),'whumpo-authority-release-'));closers.push(()=>rm(root,{recursive:true,force:true}));
 for(const dir of ['src','frontend','web','public-app','tools','dist','src/workspace-identity','src/funnel-metrics','src/guest-previews','src/shared-modules','node_modules/wrangler','compiler-locks','schema'])await mkdir(join(root,dir),{recursive:true});
 for(const name of ['package.json','pnpm-lock.yaml','vite.config.ts','tsconfig.json','tsconfig.frontend.json','tools/current-schema.mjs','tools/build.mjs','tools/build-pwa.mjs','tools/build-snapshot.mjs','tools/deploy-platform.mjs','tools/check-specification-compiler.mjs','compiler-locks/project-content-v5.json','tools/check-service-client-compiler.mjs','compiler-locks/project-service-clients-v4.json','tools/artifact-protection.mjs','tools/secret-custody.mjs','src/index.ts','frontend/main.tsx','web/visitor.ts','dist/index.html','public-app/visitor.js'])await writeFile(join(root,name),'fixture');
 await writeFile(join(root,'node_modules/wrangler/package.json'),JSON.stringify({version:'4.test'}));
 for(const file of currentSchemaFiles)await copyFile(join(process.cwd(),file),join(root,file));
 for(const role of workerOrder){
  const config={name:'whumpo-'+role,account_id:'a'.repeat(32),main:'src/index.ts',vars:{ENVIRONMENT:'test'},workers_dev:false,preview_urls:false,...(role==='runtime'?{}:{d1_databases:[{binding:'DB',database_name:'whumpo-control-authority-test',database_id:targetId}]}),...(['apps','platform'].includes(role)?{assets:{directory:role==='apps'?'./public-app':'./dist'}}:{})};
  await writeFile(join(root,configFiles[role]),JSON.stringify(config));
 }
 await saveBuildSnapshot(root);
 const review={version:3,environment:'test',buildInputs:(await readJSON(join(root,'.secrets/build-snapshot.json'))).inputs.sha256,review:'synthetic authority cutover review',mixedWorkersCompatible:true,schemaChange:'initialize',schemaSha256:artifact.sqlSha256,testDataResetAuthorized:true,cutoverReview:'Disposable test data, new unbound database; retire old resources separately'};
 // A fresh cutover: populated baseline bound to every Worker, an empty configured target.
 const cutover=async()=>{
  const target=new DatabaseSync(':memory:');target.exec('PRAGMA foreign_keys=ON');closers.push(async()=>target.close());
  const account=await syntheticPlatform({root,databases:{[baselineId]:baseline.db,[targetId]:sqliteD1Adapter(target)},bound:baselineId,hook});
  let failAfter=null,failObserve=false,initialized=0,deployed=0;
  const driver={...account.provider,
   verifyToolchain:async()=>{},withLock:async(manifest,work)=>work(async()=>{}),
   observe:async manifest=>{if(failObserve){failObserve=false;throw Error('Private provider error');}return account.provider.observe(manifest);},
   compile:async(role,base,output)=>{await mkdir(output,{recursive:true});await writeFile(join(output,'index.js'),'// compiled '+role);if(role==='runtime')await writeFile(join(output,'runtime.wasm'),'compiled wasm');return 'index.js';},
   initialize:async()=>{initialized++;target.exec(artifact.sql);},
   deploy:async(role,manifest,dir,guard,onDeployed)=>{
    deployed++;
    account.live.workers[role]={id:'after-'+role,tag:manifest.workers[role].tag,services:manifest.workers[role].services,databases:manifest.workers[role].databases,secrets:[...account.live.workers[role].secrets]};
    await onDeployed();if(failAfter===role){failAfter=null;failObserve=true;}
   }};
  return {account,driver,target,prepare:()=>prepareRelease(root,driver,review,{git:()=>({commit:'a'.repeat(40),dirty:false})}),interruptAfter:role=>{failAfter=role;},counts:()=>({initialized,deployed})};
 };
 {
  // Prepared but not started: the configured database is the EMPTY target, the bound one is the populated baseline.
  const c=await cutover(),release=await c.prepare();
  assert.equal(release.manifest.schema.mode,'initialize');
  assert.equal((await c.driver.observe()).schema.objects,0,'observe() describes the configured, empty target');
  const prepared=await observeRecoveryAuthority({provider:c.driver});
  assert.equal(prepared.databaseId,baselineId,'The authority is the platform-bound database, not the configured target');
  assert.ok(prepared.schema.objects>0&&prepared.schema.objectsSha256===artifact.expected.sha256);
  const preparedPoint=await capture(prepared);assert.equal((await verifyRecoveryPoint(join(points,'p'+pointNumber),preparedPoint.pointDigest)).point.source.databaseId,baselineId);
  assert.deepEqual(c.counts(),{initialized:0,deployed:0});
 }
 const expectMixed={runtime:false,apps:true,sites:true,platform:false};
 for(const role of workerOrder){
  const c=await cutover(),release=await c.prepare();c.interruptAfter(role);
  await assert.rejects(()=>applyRelease(release.directory,c.driver),new RegExp('stopped at '+role));
  const bound=name=>c.account.live.workers[name].databases[0]?.id;
  assert.deepEqual(['apps','sites','platform'].map(bound),role==='runtime'?[baselineId,baselineId,baselineId]:role==='apps'?[targetId,baselineId,baselineId]:role==='sites'?[targetId,targetId,baselineId]:[targetId,targetId,targetId],'the REAL journal left the expected binding state after '+role);
  if(expectMixed[role]){
   await holds(()=>observeRecoveryAuthority({provider:c.driver}),'source-binding-mixed');
  }else{
   const settled=await observeRecoveryAuthority({provider:c.driver});
   assert.equal(settled.databaseId,role==='platform'?targetId:baselineId);
   if(role==='platform')await capture(settled); // the initialized target holds the exact current schema
  }
  // Resume settles the journal; the authority is then the new database.
  const result=await applyRelease(release.directory,c.driver);assert.equal(result.status,'deployed');
  const done=await observeRecoveryAuthority({provider:c.driver});
  assert.equal(done.databaseId,targetId);assert.deepEqual(c.counts(),{initialized:1,deployed:4});
 }
 {
  // An authority proven before a cutover began becomes unusable as the real apply moves apps.
  const c=await cutover(),release=await c.prepare(),early=await observeRecoveryAuthority({provider:c.driver});
  c.interruptAfter('apps');await assert.rejects(()=>applyRelease(release.directory,c.driver),/stopped at apps/);
  await holds(()=>capture(early),'source-binding-changed');
  await holds(()=>reobserveRecoveryAuthority(early),'source-binding-changed');
 }
 // ---- 3. A raw adapter, a forged or copied authority and caller-asserted identity are refused, with no side effect.
 const before=(await readdir(points)).length;
 for(const attempt of [{authority:baseline.db},{sourceDb:baseline.db},{},{authority:{...authority}},{authority:Object.create(authority)},{authority:structuredClone(authority)}])
  await holds(()=>captureRecoveryPoint({objects,directory:join(points,'raw'),snapshotId:'raw-point',...attempt}),'source-not-authority');
 await holds(()=>captureRecoveryPoint({authority,sourceDb:baseline.db,objects,directory:join(points,'raw'),snapshotId:'raw-point'}),'point-input');
 assert.equal((await readdir(points)).length,before,'Refusals create no directory');
 await holds(()=>observeRecoveryAuthority({provider,accountId:provider.accountId}),'source-input');
 await holds(()=>observeRecoveryAuthority({provider,db:baseline.db}),'source-input');
 await holds(()=>observeRecoveryAuthority({provider:baseline.db}),'source-provider');
 await holds(()=>observeRecoveryAuthority({provider:{...provider,openDatabase:undefined}}),'source-provider');
 await holds(()=>observeRecoveryAuthority({provider:{...provider,apiOrigin:'caller-asserted-remote-proof'}}),'source-provider');
 await holds(()=>observeRecoveryAuthority({provider:{...provider,accountId:'not-an-account'}}),'source-provider');
 assert.equal(isRecoveryAuthority(authority),true);assert.equal(isRecoveryAuthority(baseline.db),false);assert.equal(isRecoveryAuthority(null),false);
 await holds(async()=>recoveryAuthorityDatabase(baseline.db),'source-not-authority');
 await holds(()=>reobserveRecoveryAuthority({...authority}),'source-not-authority');

 // ---- 4. The authority is immutable: assignment fails, and later changes to the provider do not redirect it.
 assert.ok(Object.isFrozen(authority)&&Object.isFrozen(authority.versions)&&Object.isFrozen(authority.schema));
 for(const mutate of [()=>{authority.databaseId=otherId;},()=>{authority.versions.platform='forged';},()=>{authority.schema.sqlSha256='f'.repeat(64);},()=>{authority.db=other.db;}])assert.throws(mutate,TypeError);
 const pinnedObserve=provider.observe,pinnedOpen=provider.openDatabase;
 provider.observe=async()=>assert.fail('The pinned observer must be used');provider.openDatabase=()=>assert.fail('The pinned opener must be used');
 try{await reobserveRecoveryAuthority(authority);assert.equal(recoveryAuthorityDatabase(authority)!==other.db,true);}finally{provider.observe=pinnedObserve;provider.openDatabase=pinnedOpen;}

 // ---- 5. Missing binding, account scope, unreadable and obsolete databases.
 // The configured production id has hex letters; the exact contract accepts it on all three Workers.
 assert.match(platform.configuredId,/[a-f]/);
 const wrapped=extra=>({...provider,observe:async()=>{const r=await provider.observe();return extra(r)??r;}});
 await holds(()=>observeRecoveryAuthority({provider:wrapped(r=>{r.workers.platform.databases=[];})}),'source-binding-missing');
 await holds(()=>observeRecoveryAuthority({provider:wrapped(r=>{r.workers.platform.databases=[{binding:'OTHER',id:baselineId}];})}),'source-binding-missing');
 await holds(()=>observeRecoveryAuthority({provider:wrapped(r=>{r.workers.apps.databases=[];})}),'source-binding-mixed');
 await holds(()=>observeRecoveryAuthority({provider:wrapped(r=>{r.workers.sites.databases=[{binding:'DB',id:otherId}];})}),'source-binding-mixed');
 // Exact current contract: ONE database named DB with a lowercase UUID id, on each of apps, sites and platform. A list that
 // merely contains the right entry does not pass, so identical malformed lists on all three Workers are refused too.
 const configuredId=platform.configuredId,at=(roles,databases)=>wrapped(r=>{for(const role of roles)r.workers[role].databases=structuredClone(databases);});
 const entry=(extra={})=>({binding:'DB',id:configuredId,...extra});
 const invalidLists={
  'duplicate identical DB bindings':[entry(),entry()],
  'an extra database beside DB':[entry(),{binding:'EXTRA',id:otherId}],
  'two DB bindings naming different databases':[entry(),{binding:'DB',id:otherId}],
  'an extra database before DB':[{binding:'AAA',id:otherId},entry()],
  'an extra field on the entry':[entry({name:'control'})],
  'a missing id':[{binding:'DB'}],
  'a non-string id':[{binding:'DB',id:1234}],
  'an id with the wrong length':[{binding:'DB',id:configuredId.slice(1)}],
  'an id of 36 hyphens':[{binding:'DB',id:'-'.repeat(36)}],
  'an id of 36 hex digits without hyphens':[{binding:'DB',id:'a'.repeat(36)}],
  'an id with hyphens in the wrong places':[{binding:'DB',id:'dba4c70-7a0c0-4084-a0c0-6c43f6afebde0'}],
  'an uppercase UUID':[{binding:'DB',id:configuredId.toUpperCase()}],
  'a braced UUID':[{binding:'DB',id:'{'+configuredId+'}'}],
  'an id with a trailing space':[{binding:'DB',id:configuredId+' '}],
  'a null entry':[null],
  'a string entry':['DB'],
  'an array entry':[['DB',configuredId]],
  'a DB entry beside a null entry':[entry(),null],
 };
 assert.ok(configuredId!==configuredId.toUpperCase(),'The uppercase case needs letters in the id');
 for(const [label,list] of Object.entries(invalidLists)){
  for(const roles of [['platform'],['sites'],['apps'],['apps','sites','platform']]){
   await holds(()=>observeRecoveryAuthority({provider:at(roles,list)}),'source-binding-invalid');
   assert.ok(label&&roles.length);
  }
 }
 // A role with no DB binding at all keeps its distinct code; a renamed lone binding is that too.
 await holds(()=>observeRecoveryAuthority({provider:at(['apps','sites','platform'],[])}),'source-binding-missing');
 await holds(()=>observeRecoveryAuthority({provider:at(['sites'],[{binding:'OTHER',id:configuredId}])}),'source-binding-mixed');
 // Only the observed binding shape is interpreted: the Worker entry itself must be well formed.
 await holds(()=>observeRecoveryAuthority({provider:wrapped(r=>{r.workers.apps.databases=undefined;})}),'source-observation');
 await holds(()=>observeRecoveryAuthority({provider:wrapped(r=>{r.workers.sites={id:'v-sites'};})}),'source-observation');
 await holds(()=>observeRecoveryAuthority({provider:wrapped(r=>{r.workers.platform.id=7;})}),'source-observation');
 await holds(()=>observeRecoveryAuthority({provider:wrapped(()=>{throw Error('PRIVATE_PROVIDER_DETAIL');})}),'source-observation');
 for(const role of ['platform','sites','apps','runtime']){
  const account=provider.configs[role].account_id;provider.configs[role].account_id='f'.repeat(32);
  try{await holds(()=>observeRecoveryAuthority({provider}),'source-account');}finally{provider.configs[role].account_id=account;}
 }
 // TRUST BOUNDARY, pinned on purpose. The provider is trusted code, not remote attestation: any object shaped like
 // releaseProvider() is accepted, `apiOrigin` is read from it, and its observer and opener are believed. A duck-typed provider
 // that claims 'account-client' and serves a fabricated binding for another database becomes an authority over that database.
 // `provenance` therefore records which client the CALLER wired, never where it points; nothing here proves a remote target.
 {
  const fake=await observeRecoveryAuthority({provider:{configs:provider.configs,accountId:provider.accountId,apiOrigin:'account-client',openDatabase:()=>other.db,
   observe:async()=>({workers:Object.fromEntries(['apps','sites','platform'].map(role=>[role,{id:'fabricated-'+role,databases:[{binding:'DB',id:otherId}]}]))})}});
  assert.equal(fake.provenance,'account-client');assert.equal(fake.databaseId,otherId);assert.equal(recoveryAuthorityDatabase(fake),other.db);
  const forged=await capture(fake);assert.equal((await verifyRecoveryPoint(join(points,'p'+pointNumber),forged.pointDigest)).point.source.provenance,'account-client','A forged provider label is recorded as given');
 }
 // The account scope is the provider's own: a bound database the account does not hold cannot be read.
 const holder=await syntheticPlatform({databases:{[syntheticDatabaseId(9)]:other.db},bound:syntheticDatabaseId(9)});
 holder.live.workers.platform.databases=holder.live.workers.apps.databases=holder.live.workers.sites.databases=[{binding:'DB',id:syntheticDatabaseId(8)}];
 await holds(()=>holder.authority(),'source-observation');
 // Observable binding, unreadable schema.
 let unreadableSchema=false;
 {
  // The configured database is the unbound target here, so observe() succeeds while the bound database cannot answer the schema inventory.
  const split=await syntheticPlatform({root:process.cwd(),databases:{[baselineId]:{...baseline.db,prepare:sql=>{if(/FROM sqlite_master/.test(sql)&&unreadableSchema)throw Error('PRIVATE_SCHEMA_FAILURE');return baseline.db.prepare(sql);}}},database:other.db,bound:baselineId});
  unreadableSchema=true;await holds(()=>split.authority(),'source-database');unreadableSchema=false;
  const ok=await split.authority();
  // observe() describes the CONFIGURED database (other); the authority describes the actually bound one.
  assert.equal(ok.databaseId,baselineId);
  // Authority already open, database becomes unreadable: unobservable, never "unchanged".
  unreadableSchema=true;await holds(()=>capture(ok),'source-database');unreadableSchema=false;
 }
 // An obsolete bound schema is refused even though the provider's configured-database schema is current.
 {
  const obsolete=await full();await obsolete.db.prepare('ALTER TABLE users ADD COLUMN obsolete TEXT').run();
  const skew=await syntheticPlatform({databases:{[baselineId]:obsolete.db},database:other.db,bound:baselineId});
  assert.deepEqual((await skew.provider.observe()).schema,artifact.expected,'observe() reports the CONFIGURED database, which is current');
  await holds(()=>skew.authority(),'source-schema');
  // And a database that drifts after the authority was opened is a change, caught at the next observation.
  const drift=await full(),driftPlatform=await syntheticPlatform({database:drift.db}),driftAuthority=await driftPlatform.authority();
  await drift.db.prepare('ALTER TABLE users ADD COLUMN drifted TEXT').run();
  await holds(()=>capture(driftAuthority),'source-binding-changed');
 }

 // ---- 6. Changes between the bracketing observations refuse capture and write no point.
 const midRead=async(change,code)=>{
  const fresh=await syntheticPlatform({database:baseline.db,databases:{[otherId]:other.db},hook}),a=await fresh.authority();
  onCall=once_(event=>event.kind==='d1'&&[event.sql].flat().some(sql=>/FROM sqlite_schema/.test(sql)),()=>change(fresh.live));
  try{await holds(()=>capture(a),code);}finally{onCall=null;}
  assert.equal(await exists(join(points,'p'+pointNumber)),false,'A refused capture creates no archive directory, so no completion manifest');
 };
 const move=live=>{for(const role of ['apps','sites','platform'])live.workers[role].databases=[{binding:'DB',id:otherId}];};
 await midRead(live=>{live.workers.platform.databases=[{binding:'DB',id:otherId}];},'source-binding-changed'); // mixed during the read
 await midRead(move,'source-binding-changed'); // a consistent cutover completed during the read
 await midRead(live=>{live.workers.platform.id='v-platform-2';},'source-binding-changed'); // SAME bindings, different platform version
 await midRead(live=>{live.workers.apps.id='v-apps-2';},'source-binding-changed');
 await midRead(live=>{live.workers.sites.id='v-sites-2';},'source-binding-changed');
 // An identical EXTRA database on all three Workers appearing during the read is a change (the observer accepts it; the contract does not).
 await midRead(live=>{for(const role of ['apps','sites','platform'])live.workers[role].databases=[{binding:'DB',id:platform.configuredId},{binding:'EXTRA',id:otherId}];},'source-binding-changed');
 // Duplicate binding NAMES never reach the contract through the real provider: its observer already refuses them, which an unobservable
 // read reports as such rather than as a change.
 await midRead(live=>{for(const role of ['apps','sites','platform'])live.workers[role].databases=[{binding:'DB',id:platform.configuredId},{binding:'DB',id:platform.configuredId}];},'source-observation');
 // A change after the authority was proven but before capture starts is caught by the first observation.
 for(const change of [move,live=>{live.workers.platform.id='v-platform-3';}]){
  const fresh=await syntheticPlatform({database:baseline.db,databases:{[otherId]:other.db},hook}),a=await fresh.authority();
  change(fresh.live);await holds(()=>capture(a),'source-binding-changed');
 }
 // The first observation also brackets a change that reverts DURING the read: seen before, gone after.
 {
  const fresh=await syntheticPlatform({database:baseline.db,databases:{[otherId]:other.db},hook}),a=await fresh.authority(),original=structuredClone(fresh.live.workers.platform.databases);
  fresh.live.workers.platform.databases=[{binding:'DB',id:otherId}];fresh.live.workers.apps.databases=fresh.live.workers.sites.databases=fresh.live.workers.platform.databases;
  onCall=once_(event=>event.kind==='d1'&&[event.sql].flat().some(sql=>/FROM sqlite_schema/.test(sql)),()=>{for(const role of ['apps','sites','platform'])fresh.live.workers[role].databases=original;});
  try{await holds(()=>capture(a),'source-binding-changed');}finally{onCall=null;}
 }
 // RESIDUAL LIMIT, pinned on purpose: observations bracket the read, they do not prove continuity. A binding that
 // moves and moves back between them (same versions at both ends, as after a rollback to the earlier Worker
 // version) is not detected, and the read may have raced either database. No write fence or monotonic
 // generation exists to prove otherwise (docs/disaster-recovery.md).
 {
  const fresh=await syntheticPlatform({database:baseline.db,databases:{[otherId]:other.db},hook}),a=await fresh.authority(),original=structuredClone(fresh.live.workers.platform.databases);
  let reads=0;
  onCall=async event=>{
   if(event.kind!=='d1'||![event.sql].flat().some(sql=>/FROM sqlite_schema|PRAGMA table_list/.test(sql)))return;
   reads++;if(reads===1)fresh.live.workers.platform.databases=[{binding:'DB',id:otherId}];if(reads===2)fresh.live.workers.platform.databases=original;
  };
  try{const aba=await capture(a);assert.ok(aba.pointDigest);}finally{onCall=null;}
  assert.ok(reads>=2,'The binding really did move during the read');
 }

 // ---- 7. Point format: current version only. v1 and malformed v2 sources are refused explicitly.
 const rewrite=async(directoryName,change)=>{
  const file=join(directoryName,'recovery-point.json'),parsed=JSON.parse(await readFile(file,'utf8'));change(parsed);
  const bytes=Buffer.from(JSON.stringify(parsed));await writeFile(file,bytes);return digest(bytes);
 };
 for(const [label,change] of [
  ['v1 point',p=>{p.format='whumpo-recovery-point-v1';delete p.source;}],
  ['v1 label on a v2 body',p=>{p.format='whumpo-recovery-point-v1';}],
  ['no source',p=>{delete p.source;}],
  ['bad account',p=>{p.source.accountId='nope';}],
  ['bad database',p=>{p.source.databaseId='nope';}],
  ['missing version',p=>{delete p.source.versions.platform;}],
  ['unknown provenance',p=>{p.source.provenance='remote-proof';}],
  ['continuity claim',p=>{p.source.continuity='continuous';}],
  ['bad schema pin',p=>{p.source.schema.sqlSha256='nope';}],
 ]){
  const copy=join(directory,'rewrite-'+label.replaceAll(' ','-'));await mkdir(copy,{mode:0o700});
  for(const file of ['recovery-point.json','control.json'])await copyFile(join(firstDir,file),join(copy,file));
  await mkdir(join(copy,'objects'),{mode:0o700});
  const changed=await rewrite(copy,change);
  await holds(()=>verifyRecoveryPoint(copy,changed),'point-format');
  await holds(()=>verifyRecoveryPoint(copy,first.pointDigest),'point-digest');
 }

 // ---- 8. Every evidence request re-proves the same authority (P1b); a changed observation refuses and commits nothing.
 {
  const streamId='authority-stream',inventoryFile=join(directory,'authority.whumpo-restore-inventory');
  const keys=await keyBackupFixture();closers.push(()=>keys.close());const keyring=fixtureKeyring(),{proof:keyBackup}=await keys.create(keyring);
  await initializeFixtureKeys(baseline.db,keyring);
  await baseline.db.prepare("INSERT INTO users VALUES('inventory-owner','inventory-owner@example.invalid','2026-10-08') ON CONFLICT DO NOTHING").run();
  for(const name of ['late-binding-b','late-binding-c'])await baseline.db.prepare('INSERT INTO users VALUES(?,?,?) ON CONFLICT DO NOTHING').bind(name,name+'@example.invalid','2026-10-08').run();
  const inventoryPlatform=await syntheticPlatform({database:baseline.db,databases:{[otherId]:other.db},hook});
  const inventoryAuthority=await inventoryPlatform.authority(),live=inventoryPlatform.live;
  await createRestoreInventory({inventoryFile,streamId});
  const inventory=await openRestoreInventory({inventoryFile,expectedStreamId:streamId,authority:inventoryAuthority});closers.push(()=>inventory.close());
  const file=join(directory,'candidate.sqlite');await backup(baseline.sql,file);const candidateSql=new DatabaseSync(file,{readOnly:true});closers.push(async()=>candidateSql.close());
  const manifest=await inventory.registerArchive({archiveDb:sqliteD1Adapter(candidateSql),snapshotId:'authority-archive',keyBackup});
  const request=()=>new Request('https://restore-evidence.internal/v2/check',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:2,snapshotId:manifest.snapshotId,manifestDigest:restoreManifestDigest(manifest),challenge:id()})});
  const evidence=async()=>{const response=await inventory.evidenceSource.fetch(request());assert.equal(response.status,200);return response.json();};
  const refused=async()=>{await assert.rejects(()=>inventory.evidenceSource.fetch(request()),/unavailable/);refusals++;};
  const sequence=async()=>(await inventory.inspect()).currentSequence;
  // The precondition: evidence is issued while the binding is unchanged, re-proving the platform on that very request.
  const calls=[];hookCalls=calls;const ok=await evidence();hookCalls=null;
  assert.equal(ok.currentSequence,0);
  assert.ok(calls.filter(c=>c.kind==='worker'&&/whumpo-platform\/deployments$/.test(c.path)).length>=3,'Each evidence request observes the platform before the first read, after it and after the verification read');
  const repeated=[];hookCalls=repeated;await evidence();hookCalls=null;
  assert.equal(repeated.filter(c=>c.kind==='worker'&&/whumpo-platform\/deployments$/.test(c.path)).length,calls.filter(c=>c.kind==='worker'&&/whumpo-platform\/deployments$/.test(c.path)).length,'The recheck repeats on EACH request');
  const states=[
   ['consistent move to another database',()=>{for(const role of ['apps','sites','platform'])live.workers[role].databases=[{binding:'DB',id:otherId}];},()=>{for(const role of ['apps','sites','platform'])live.workers[role].databases=[{binding:'DB',id:inventoryPlatform.configuredId}];}],
   ['platform only (mixed)',()=>{live.workers.platform.databases=[{binding:'DB',id:otherId}];},()=>{live.workers.platform.databases=[{binding:'DB',id:inventoryPlatform.configuredId}];}],
   ['apps only (mixed)',()=>{live.workers.apps.databases=[{binding:'DB',id:otherId}];},()=>{live.workers.apps.databases=[{binding:'DB',id:inventoryPlatform.configuredId}];}],
   ['same bindings, different platform version',()=>{live.workers.platform.id='v-platform-2';},()=>{live.workers.platform.id='v-platform';}],
   ['same bindings, different sites version',()=>{live.workers.sites.id='v-sites-2';},()=>{live.workers.sites.id='v-sites';}],
  ];
  for(const [,change,restore] of states){change();await refused();restore();await evidence();} // refused, and a restored binding is accepted again: a refusal poisons nothing
  // Constraint observations are bracketed the same way and record nothing across a changed binding.
  const constraint={kind:'owner-erased',ownerId:'never-present'},recorded=await sequence();
  live.workers.platform.id='v-platform-2';
  await assert.rejects(()=>inventory.observe({operationId:'observe-refused',selection:constraint}),/unavailable/);refusals++;
  live.workers.platform.id='v-platform';assert.equal(await sequence(),recorded);
  assert.equal((await inventory.observe({operationId:'observe-refused',selection:constraint})).recorded,true);
  // A permanent absence must never be derived from a read the binding did not survive.
  await baseline.db.prepare('DELETE FROM users WHERE id=?').bind('inventory-owner').run();
  const registered=await sequence();
  onCall=once_(event=>event.kind==='d1'&&[event.sql].flat().some(sql=>/FROM "users"/.test(sql)),()=>{live.workers.platform.id='v-platform-flip';});
  try{await refused();}finally{onCall=null;live.workers.platform.id='v-platform';}
  assert.equal(await sequence(),registered,'A tainted read commits no tombstone');
  const derived=await evidence();assert.ok(derived.events.some(e=>e.kind==='record-suppressed'&&e.data.table==='users'),'The same read, once the binding holds, derives the absence');assert.ok(derived.currentSequence>registered);assert.equal(await sequence(),derived.currentSequence);
  // Where a binding change lands relative to ONE evidence request. The request's authority calls run in this order:
  // observation, source read, observation (before the commit), commit, verification read, observation. The injector counts
  // the API calls after the source read of the users table to place the change deterministically.
  const afterRead=(when,change)=>{
   let read=false,observing=false,done=false;
   return async event=>{
    if(done)return;
    if(!read){read=event.kind==='d1'&&[event.sql].flat().some(sql=>/FROM "users"/.test(sql));return;}
    if(!observing){
     // The first Worker call after the source read opens the observation that precedes the commit.
     observing=event.kind==='worker';
     if(observing&&when==='first-call'){done=true;change();}
     return;
    }
    // The first database call inside that observation comes after its Worker bindings were already read.
    if(when==='after-bindings'&&event.kind==='d1'){done=true;change();}
   };
  };
  const mentions=(body,user)=>body.events.filter(e=>e.kind==='record-suppressed'&&e.data.table==='users'&&JSON.stringify(e.data.key).includes(user));
  // (a) The binding changes right after the first source read: the observation before the commit catches it. The request is
  // refused and NOTHING is appended, so a read the binding did not survive never persists an absence.
  await baseline.db.prepare('DELETE FROM users WHERE id=?').bind('late-binding-b').run();
  const beforeB=await sequence();
  onCall=afterRead('first-call',()=>{live.workers.platform.id='v-platform-late';});
  try{await refused();}finally{onCall=null;live.workers.platform.id='v-platform';}
  assert.equal(await sequence(),beforeB,'A binding change before the commit appends no event');
  assert.equal(mentions(await evidence(),'late-binding-b').length,1,'Once the binding holds, the same absence is derived exactly once');
  assert.equal(await sequence(),beforeB+1);
  // (b) RESIDUAL, pinned on purpose: a change that lands after that last observation has read the Worker bindings, but before the
  // commit, is not detected by it. The commit happens; the observation that follows the verification read refuses the request.
  // The event stays. It is a real observation: the user row is absent from the database that was bound throughout the read and
  // the observation before the commit, and a recorded absence only ever ADDS holds. It is conservative history, not false
  // authority, and it is not a solution to ABA: nothing here fences a write, and a stream must still be used for one database.
  await baseline.db.prepare('DELETE FROM users WHERE id=?').bind('late-binding-c').run();
  const beforeC=await sequence();
  onCall=afterRead('after-bindings',()=>{live.workers.platform.id='v-platform-late';});
  try{await refused();}finally{onCall=null;live.workers.platform.id='v-platform';}
  assert.equal(await sequence(),beforeC+1,'The commit preceded the refusing observation, so exactly the derived absence remains');
  assert.equal((await baseline.db.prepare('SELECT count(*) AS n FROM users WHERE id=?').bind('late-binding-c').first()).n,0,'The recorded absence is true of the database that was bound');
  const settled=await evidence();
  assert.equal(mentions(settled,'late-binding-c').length,1,'The retained event is the same absence, reported once');assert.equal(settled.currentSequence,beforeC+1,'A retry appends nothing further');
  // Deadline: an observation that never answers fails closed inside the evidence deadline.
  const stalled=once_(event=>event.kind==='worker',()=>new Promise(()=>{}));
  onCall=stalled;const start=Date.now();
  try{await refused();}finally{onCall=null;}
  assert.ok(Date.now()-start>=9900&&Date.now()-start<15000,'A stalled authority observation hits the ten second evidence deadline');
  await evidence(); // not poisoned
  // A lost database fails closed rather than falling back to the pinned adapter.
  inventoryPlatform.databases.delete(inventoryPlatform.configuredId);await refused();
 }

 assert.equal(writes,0,'No authority operation issued a write statement');
 console.log(JSON.stringify({suite:'WH-008 recovery source authority',node:process.versions.node,refusals,writeStatements:writes,
  boundaries:{bracketingProvesEndpointsOnly:true,abaNotDetected:true,monotonicGenerationOrWriteFence:false,remoteAccess:false,note:'real release provider over a synthetic account API; no live Cloudflare observation'}},null,1));
}finally{
 globalThis.fetch=network;
 for(const close of closers.reverse())await close();
 await rm(directory,{recursive:true,force:true});
}
