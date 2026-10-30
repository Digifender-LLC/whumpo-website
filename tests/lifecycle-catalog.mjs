import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {inspectLifecycleSchema,currentLifecycleSchema,validateLifecycleReferences} from '../tools/lifecycle-catalog.mjs';

const catalog=JSON.parse(await readFile('docs/data-lifecycle.json','utf8'));
await validateLifecycleReferences(catalog);
const {db,schemaFiles}=await currentLifecycleSchema();
try{
 const report=inspectLifecycleSchema(db,catalog);
 assert.equal(report.tableCount,236);assert.equal(report.classCount,58);assert.equal(schemaFiles.length,6);
 assert.equal(report.plannedClassCount,6);assert.equal(report.protectionClasses.length,64);
 assert.equal(report.protectionStatus,'decision-not-runtime-enforcement');
 for(const group of report.protectionClasses){assert.equal(group.profile.endToEndEncrypted,false);assert.equal(group.profile.customerUnlockRequired,false);}
 const connections=report.protectionClasses.find(g=>g.id==='connections');
 assert.equal(connections.profile.applicationEncoding,'mixed-aead-and-metadata');
 assert.ok(connections.protection.requirements.includes('DP-01'));
 assert.ok(report.protectionClasses.find(g=>g.id==='profile-workspace').protection.storage.includes('control-d1'));
 assert.ok(report.protectionClasses.find(g=>g.id==='project-media').protection.storage.includes('private-r2'));
 assert.equal(report.protectionClasses.find(g=>g.id==='guest-feedback').profile.applicationEncoding,'readable-records');assert.equal(report.protectionClasses.find(g=>g.id==='brand-kits').profile.applicationEncoding,'not-admitted');
 // WH-128 admits module uploads (module_files beside project_files rows and private R2 objects) as module-files.
 const filesClass=report.protectionClasses.find(g=>g.id==='module-files');assert.equal(filesClass.storageStatus,'current');assert.deepEqual(filesClass.protection.storage,['control-d1','private-r2']);
 assert.deepEqual(report.tables.filter(t=>t.class==='module-files').map(t=>t.name),['module_files']);
 assert.match(filesClass.protection.readers.join(' '),/never enter owner Chat, model context/);
 // WH-125 admits only the registry, activation and request-receipt tables; module data classes stay planned.
 assert.deepEqual(report.tables.filter(t=>t.class==='module-registry').map(t=>t.name),['module_activation_applies','module_activation_links','module_activation_reviews','module_activations','module_instances','module_request_receipts']);
 for(const t of report.tables.filter(t=>t.class==='module-registry'))assert.ok(t.ownerPath.includes('users'),t.name);
 // WH-126 admits the access revision, staff grants and owner role reviews as project-roles.
 const roles=report.protectionClasses.find(g=>g.id==='project-roles');assert.equal(roles.storageStatus,'current');assert.deepEqual(roles.protection.storage,['control-d1']);
 assert.deepEqual(report.tables.filter(t=>t.class==='project-roles').map(t=>t.name),['module_access_role_applies','module_access_role_links','module_access_role_reviews','module_access_roles','module_access_states']);
 // WH-127 admits record values and content-free change events as module-records.
 const recordsClass=report.protectionClasses.find(g=>g.id==='module-records');assert.equal(recordsClass.storageStatus,'current');assert.deepEqual(recordsClass.protection.storage,['control-d1']);
 assert.deepEqual(report.tables.filter(t=>t.class==='module-records').map(t=>t.name),['module_record_events','module_record_files','module_records']);
 assert.match(recordsClass.protection.readers.join(' '),/never enter owner Chat, model context or Chat history/);
 assert.equal(report.readyForDeletion,false);assert.equal(report.policyStatus,'proposed-not-approved');

 assert.deepEqual(report.unlinkedOwnership.map(t=>t.table),['account_closures','file_cleanup','identity_challenges','notification_send_ledger','operator_containments','operator_retention_receipts','operator_session_revocations','safety_case_evidence','safety_case_findings','safety_cases','safety_disclosure_items','safety_disclosures','safety_evidence_objects','safety_preservation_holds','safety_preserved_records','safety_retention_decisions']);
 assert.ok(report.directOwnerBlocks.some(t=>t.table==='domain_connections'&&t.onDelete==='RESTRICT'));
 assert.ok(report.directOwnerBlocks.some(t=>t.table==='gateway_spend_attempts'&&t.onDelete==='RESTRICT'));
 assert.ok(report.directOwnerBlocks.some(t=>t.table==='chat_review_receipts'&&t.onDelete==='NO ACTION'));
 for(const name of ['project_spec_proposals','project_spec_versions','service_client_proposals','service_client_versions']){
  const table=report.tables.find(t=>t.name===name);assert.equal(table.class,'project-configurations');assert.ok(table.columns.includes('spec_json'));assert.ok(table.ownerPath.includes('users'));
 }
 for(const name of ['project_spec_creations','project_spec_applies','service_client_applies','service_client_activation_reviews']){
  const table=report.tables.find(t=>t.name===name);assert.equal(table.class,'configuration-authority');assert.ok(!table.columns.includes('spec_json'));assert.ok(table.ownerPath.includes('users'));
 }
 assert.ok(report.tables.find(t=>t.name==='project_files').columns.includes('handoff_json'));
 assert.equal(report.tables.find(t=>t.name==='publication_chat_links').class,'site-versions');
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
  c=>c.classes.findLast(g=>g.storageStatus==='planned').tables=['invented_storage'],c=>c.classes.findLast(g=>g.storageStatus==='planned').protection.storage=['control-d1'],
  c=>c.classes.findLast(g=>g.storageStatus==='planned').implementationPackets=[],c=>c.classes.findLast(g=>g.storageStatus==='planned').protection.profile='managed-readable',
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
  c=>c.classes.findLast(g=>g.storageStatus==='planned').implementationPackets=['WH-999'],c=>c.classes.findLast(g=>g.storageStatus==='planned').implementationPackets=['WH-052']
 ];
 for(const change of invalidReferences){const broken=structuredClone(catalog);change(broken);await assert.rejects(validateLifecycleReferences(broken));}
 // No data reads: synthetic private row changes cannot affect this report.
 db.exec('PRAGMA query_only=OFF');
 db.exec("INSERT INTO users(id,email,created_at) VALUES('PRIVATE_OWNER','PRIVATE_EMAIL','2026-10-01')");
 db.exec('PRAGMA query_only=ON');assert.deepEqual(inspectLifecycleSchema(db,catalog),report);assert.doesNotMatch(JSON.stringify(report),/PRIVATE_OWNER|PRIVATE_EMAIL|PRIVATE_SALT|PRIVATE_HASH/);
 db.exec('PRAGMA query_only=OFF');db.exec('CREATE TABLE new_personal_data(id TEXT,user_id TEXT REFERENCES users(id),secret TEXT)');db.exec('PRAGMA query_only=ON');
 assert.throws(()=>inspectLifecycleSchema(db,catalog),/missing: new_personal_data/);
 console.log(`Lifecycle catalog passed: 236 tables, 58 current/6 planned classes, ${invalidCatalogs.length+invalidReferences.length} rejected contract/reference cases, complete protection/recovery metadata, owner FK blockers, and zero application-data reads. No runtime authority granted.`);
}finally{db.close();}
