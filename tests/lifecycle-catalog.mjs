import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inspectLifecycleSchema,migratedLifecycleSchema,validateLifecycleReferences} from '../tools/lifecycle-catalog.mjs';

const catalog=JSON.parse(await readFile('docs/data-lifecycle.json','utf8'));
await validateLifecycleReferences(catalog);
const {db,migrations}=await migratedLifecycleSchema();
try{
 const report=inspectLifecycleSchema(db,catalog);
 assert.equal(report.tableCount,133);assert.equal(migrations.length,107);
 assert.equal(report.readyForDeletion,false);assert.equal(report.policyStatus,'proposed-not-approved');
 assert.equal(report.directOwnerBlocks.length,20);
 assert.deepEqual(report.unlinkedOwnership.map(t=>t.table),['auth_challenges','file_cleanup']);
 assert.ok(report.directOwnerBlocks.some(t=>t.table==='domain_connections'&&t.onDelete==='RESTRICT'));
 assert.ok(report.directOwnerBlocks.some(t=>t.table==='gateway_spend_attempts'&&t.onDelete==='RESTRICT'));
 assert.ok(report.tables.find(t=>t.name==='app_documents').ownerPath.includes('app_visitors'));
 assert.ok(report.tables.find(t=>t.name==='cms_media_uploads').ownerPath.includes('users'));
 assert.equal(report.tables.find(t=>t.name==='maintenance_health').ownerPath,null);
 for(const change of [c=>c.classes[0].tables.pop(),c=>c.classes[0].tables.push('missing_table'),c=>c.classes[1].tables.push('users'),c=>c.classes[0].exportPolicy='',c=>c.classes[0].scope='platform',c=>c.runtimeEnforcement=true]){
  const broken=structuredClone(catalog);change(broken);assert.throws(()=>inspectLifecycleSchema(db,broken));
 }
 // No data reads: synthetic private row changes cannot affect this report.
 db.exec('PRAGMA query_only=OFF');
 db.exec("INSERT INTO users(id,email,password_salt,password_hash,created_at) VALUES('PRIVATE_OWNER','PRIVATE_EMAIL','PRIVATE_SALT','PRIVATE_HASH','2026-09-30')");
 db.exec('PRAGMA query_only=ON');assert.deepEqual(inspectLifecycleSchema(db,catalog),report);assert.doesNotMatch(JSON.stringify(report),/PRIVATE_OWNER|PRIVATE_EMAIL|PRIVATE_SALT|PRIVATE_HASH/);
 db.exec('PRAGMA query_only=OFF');db.exec('CREATE TABLE new_personal_data(id TEXT,user_id TEXT REFERENCES users(id),secret TEXT)');db.exec('PRAGMA query_only=ON');
 assert.throws(()=>inspectLifecycleSchema(db,catalog),/missing: new_personal_data/);
 console.log('Lifecycle catalog passed: complete current schema coverage, owner FK blockers, unlinked ownership exceptions, future/duplicate/misclassified tables, explicit proposal status and zero application-data reads.');
}finally{db.close();}
