import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inspectLifecycleSchema,currentLifecycleSchema,validateLifecycleReferences} from '../tools/lifecycle-catalog.mjs';

const catalog=JSON.parse(await readFile('docs/data-lifecycle.json','utf8'));
await validateLifecycleReferences(catalog);
const {db,schemaFiles}=await currentLifecycleSchema();
try{
 const report=inspectLifecycleSchema(db,catalog);
 assert.equal(report.tableCount,163);assert.equal(report.classCount,37);assert.equal(schemaFiles.length,3);
 assert.equal(report.plannedClassCount,8);assert.equal(report.protectionClasses.length,45);
 assert.equal(report.protectionStatus,'decision-not-runtime-enforcement');
 for(const group of report.protectionClasses){assert.equal(group.profile.endToEndEncrypted,false);assert.equal(group.profile.customerUnlockRequired,false);}
 const connections=report.protectionClasses.find(g=>g.id==='connections');
 assert.equal(connections.profile.applicationEncoding,'mixed-aead-and-metadata');
 assert.ok(connections.protection.requirements.includes('DP-01'));
 assert.ok(report.protectionClasses.find(g=>g.id==='profile-workspace').protection.storage.includes('control-d1'));
 assert.ok(report.protectionClasses.find(g=>g.id==='project-media').protection.storage.includes('private-r2'));
 assert.equal(report.protectionClasses.find(g=>g.id==='guest-feedback').profile.applicationEncoding,'not-admitted');
 assert.equal(report.readyForDeletion,false);assert.equal(report.policyStatus,'proposed-not-approved');

 assert.deepEqual(report.unlinkedOwnership.map(t=>t.table),['file_cleanup','identity_challenges']);
 assert.ok(report.directOwnerBlocks.some(t=>t.table==='domain_connections'&&t.onDelete==='RESTRICT'));
 assert.ok(report.directOwnerBlocks.some(t=>t.table==='gateway_spend_attempts'&&t.onDelete==='RESTRICT'));
 assert.ok(report.directOwnerBlocks.some(t=>t.table==='chat_review_receipts'&&t.onDelete==='NO ACTION'));
 for(const name of ['project_spec_proposals','project_spec_versions','service_client_proposals','service_client_versions']){
  const table=report.tables.find(t=>t.name===name);assert.equal(table.class,'project-configurations');assert.ok(table.columns.includes('spec_json'));assert.ok(table.ownerPath.includes('users'));
 }
 for(const name of ['project_spec_creations','project_spec_applies','service_client_applies','service_client_activation_reviews']){
  const table=report.tables.find(t=>t.name===name);assert.equal(table.class,'configuration-authority');assert.ok(!table.columns.includes('spec_json'));assert.ok(table.ownerPath.includes('users'));
 }
 assert.equal(report.tables.find(t=>t.name==='feature_preview_grants').class,'feature-preview-authority');
 assert.ok(report.tables.find(t=>t.name==='feature_preview_grants').ownerPath.includes('users'));
 assert.equal(report.tables.find(t=>t.name==='backend_extension_uses').class,'backend-artifacts');
 assert.ok(report.tables.find(t=>t.name==='app_documents').ownerPath.includes('app_visitors'));
 assert.ok(report.tables.find(t=>t.name==='cms_media_uploads').ownerPath.includes('users'));
 assert.equal(report.tables.find(t=>t.name==='maintenance_health').ownerPath,null);
 const invalidCatalogs=[
  c=>c.classes[0].tables.pop(),c=>c.classes[0].tables.push('missing_table'),c=>c.classes[1].tables.push('users'),c=>c.classes[0].exportPolicy='',c=>c.classes[0].scope='platform',c=>c.runtimeEnforcement=true,
  c=>c.version=1,c=>c.protectionStatus='implemented',c=>delete c.classes[0].protection,
  c=>c.classes[0].protection.profile='unknown',c=>c.classes[0].protection.readers=[],c=>c.classes[0].protection.processors=[' '],
  c=>c.classes[0].protection.remainingExposure=[],c=>c.classes[0].protection.rationale='',c=>c.classes[0].protection.storage=['unknown'],
  c=>c.classes[0].protection.requirements=['DP-99'],c=>c.classes[0].protection.requirements=[],
  c=>c.classes[0].storageStatus='deployed',c=>c.classes[0].protection.decision='planned-adapter',
  c=>c.classes.at(-1).tables=['invented_storage'],c=>c.classes.at(-1).protection.storage=['control-d1'],
  c=>c.classes.at(-1).implementationPackets=[],c=>c.classes.at(-1).protection.profile='managed-readable',
  c=>c.classes[0].protection.profile='planned-adapter',c=>c.classes[0].protection.storage=['not-admitted'],
  c=>c.protectionProfiles[0].endToEndEncrypted=true,c=>c.protectionProfiles[0].customerUnlockRequired=true,
  c=>c.protectionProfiles[0].serverReadable=false,c=>delete c.protectionProfiles[0].recovery.missingKey,
  c=>c.protectionProfiles[0].recovery.backup='',c=>c.protectionProfiles[0].transit='',c=>c.protectionProfiles[0].keyCustody='',
  c=>c.protectionProfiles.push(c.protectionProfiles[0]),c=>c.protectionRequirements.push(c.protectionRequirements[0]),
  c=>c.protectionRequirements[0].status='deployed',
  c=>c.classes.find(g=>g.id==='connections').protection.requirements=['DP-02'],
  c=>c.classes.find(g=>g.id==='connections').protection.decision='retain-and-verify'
 ];
 for(const change of invalidCatalogs){
  const broken=structuredClone(catalog);change(broken);assert.throws(()=>inspectLifecycleSchema(db,broken));
 }
 const invalidReferences=[
  c=>c.protectionContract='../outside.md',c=>c.protectionProfiles[0].references=['docs/does-not-exist.md'],
  c=>c.protectionRequirements[0].references=['/tmp/outside.md'],
  c=>c.classes.at(-1).implementationPackets=['WH-999'],c=>c.classes.at(-1).implementationPackets=['WH-052']
 ];
 for(const change of invalidReferences){const broken=structuredClone(catalog);change(broken);await assert.rejects(validateLifecycleReferences(broken));}
 // No data reads: synthetic private row changes cannot affect this report.
 db.exec('PRAGMA query_only=OFF');
 db.exec("INSERT INTO users(id,email,created_at) VALUES('PRIVATE_OWNER','PRIVATE_EMAIL','2026-10-01')");
 db.exec('PRAGMA query_only=ON');assert.deepEqual(inspectLifecycleSchema(db,catalog),report);assert.doesNotMatch(JSON.stringify(report),/PRIVATE_OWNER|PRIVATE_EMAIL|PRIVATE_SALT|PRIVATE_HASH/);
 db.exec('PRAGMA query_only=OFF');db.exec('CREATE TABLE new_personal_data(id TEXT,user_id TEXT REFERENCES users(id),secret TEXT)');db.exec('PRAGMA query_only=ON');
 assert.throws(()=>inspectLifecycleSchema(db,catalog),/missing: new_personal_data/);
 console.log(`Lifecycle catalog passed: 163 tables, 37 current/8 planned classes, ${invalidCatalogs.length+invalidReferences.length} rejected contract/reference cases, complete protection/recovery metadata, owner FK blockers, and zero application-data reads. No runtime authority granted.`);
}finally{db.close();}
