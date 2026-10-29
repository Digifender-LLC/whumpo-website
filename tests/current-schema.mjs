import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {getPlatformProxy} from 'wrangler';
import {DatabaseSync} from 'node:sqlite';
import {localDatabase} from '../tools/database.mjs';
import {currentSchemaArtifact,inspectSchema,currentSchemaPlan,schemaSummary} from '../tools/current-schema.mjs';

const directory=await mkdtemp((process.env.TMPDIR||'/tmp')+'/whumpo-current-schema-');
const artifact=await currentSchemaArtifact(),sqlite=new DatabaseSync(':memory:');
try{
 sqlite.exec(artifact.sql);
 // These are current account semantics, not merely two implementations agreeing
 // on a digest. Password sessions and re-spendable invitations must be absent.
 const tables=sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>r.name);
 for(const old of ['sessions','passkeys','auth_challenges','recovery_codes','d1_migrations'])assert.ok(!tables.includes(old),old+' must not be supported');
 for(const current of ['identity_accounts','identity_sessions','identity_credentials','identity_kit_offers','identity_admission_checks'])assert.ok(tables.includes(current));
 assert.deepEqual(sqlite.prepare('PRAGMA table_info(users)').all().map(c=>c.name),['id','email','created_at','email_verified_at','email_verified_via'],'users carry the WH-201 verification state and no password field');
 assert.equal(currentSchemaPlan(artifact,schemaSummary([])).mode,'initialize');
 assert.equal(currentSchemaPlan(artifact,artifact.expected).mode,'none');
 assert.throws(()=>currentSchemaPlan(artifact,{...artifact.expected,sha256:'obsolete'}),/new empty database/);
 const persistTo=join(directory,'state'),root=resolve('.');
 const first=await localDatabase('initialize',{root,persistTo});
 assert.equal(first.initialized,true);assert.deepEqual(first.schema,artifact.expected);
 const config=JSON.parse(await readFile('wrangler.jsonc','utf8')),path=join(directory,'wrangler.json');
 await writeFile(path,JSON.stringify({name:'whumpo-current-schema-test',compatibility_date:config.compatibility_date,d1_databases:config.d1_databases}));
 const open=()=>getPlatformProxy({configPath:path,persist:{path:join(persistTo,'v3')},remoteBindings:false});
 let proxy=await open();
 try{
  assert.deepEqual(await inspectSchema(proxy.env.DB),artifact.expected,'Actual local D1 must match the canonical SQLite catalog');
  await proxy.env.DB.prepare("INSERT INTO users(id,email,created_at) VALUES('current-user','fixture@example.test','2026-10-01T00:00:00Z')").run();
  await proxy.env.DB.prepare("INSERT INTO invitations(code_hash,created_at,expires_at,used_by,used_at) VALUES('spent','now','future','current-user',123)").run();
  await assert.rejects(()=>proxy.env.DB.prepare("UPDATE invitations SET used_at=NULL WHERE code_hash='spent'").run(),/invitation_spent_immutable/);
 }finally{await proxy.dispose();}
 const second=await localDatabase('initialize',{root,persistTo});assert.equal(second.initialized,false);
 proxy=await open();
 try{
  assert.equal((await proxy.env.DB.prepare('SELECT count(*) n FROM users').first()).n,1,'A current DB must not be cleared on repeated initialization');
  await proxy.env.DB.prepare('DROP TRIGGER invitation_spent_immutable').run();
 }finally{await proxy.dispose();}
 const status=await localDatabase('status',{root,persistTo});assert.equal(status.current,false);
 await assert.rejects(()=>localDatabase('initialize',{root,persistTo}),/new empty database/);
 proxy=await open();
 try{assert.equal((await proxy.env.DB.prepare('SELECT count(*) n FROM users').first()).n,1,'Drift refusal must not delete test data');}finally{await proxy.dispose();}
 console.log('Current schema passed on SQLite and actual local D1: complete catalog, passkey-only account shape, immutable spent invitations, empty initialization, repeat without writes, drift detection/refusal without data loss.');
}finally{sqlite.close();await rm(directory,{recursive:true,force:true});}
