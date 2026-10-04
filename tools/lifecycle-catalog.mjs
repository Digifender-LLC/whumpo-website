import {currentSchema,currentSchemaFiles} from './current-schema.mjs';
import {DatabaseSync} from 'node:sqlite';
import {readFile,stat} from 'node:fs/promises';
import {resolve,dirname,isAbsolute,relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const scopes=['owner','project','visitor','mixed','platform'];
const encodings=['readable-records','verifiers-and-public-material','mixed-aead-and-metadata','not-admitted'];
const storageKinds=['control-d1','private-r2','worker-secret','browser-credential','browser-download','browser-private-cache','public-artifact','provider-custody','cms-native','not-admitted'];
const nonempty=value=>typeof value==='string'&&value.trim().length>0;
function strings(value,label){
 if(!Array.isArray(value)||!value.length||!value.every(nonempty)||new Set(value).size!==value.length)throw Error('Missing or duplicate '+label);
}
function fields(value,names,label){
 if(!value||typeof value!=='object'||Array.isArray(value)||names.some(name=>!nonempty(value[name])))throw Error('Missing '+label);
}
// This validates a design inventory, never credentials or runtime admission.
// The current contract deliberately makes no E2E or customer-unlock promise.
function protectionMetadata(catalog){
 if(catalog.version!==2||catalog.protectionStatus!=='decision-not-runtime-enforcement')throw Error('Unsupported current protection catalog');
 fields(catalog,['contract','protectionContract','reviewedAt'],'catalog reference/date');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(catalog.reviewedAt))throw Error('Invalid catalog review date');
 if(!Array.isArray(catalog.protectionProfiles)||!catalog.protectionProfiles.length||!Array.isArray(catalog.protectionRequirements)||!catalog.protectionRequirements.length)throw Error('Missing protection profiles/requirements');
 const profiles=new Map(),requirements=new Map();
 for(const profile of catalog.protectionProfiles){
  fields(profile,['id','applicationEncoding','providerAtRest','transit','keyCustody'],'protection profile');
  if(profiles.has(profile.id)||!encodings.includes(profile.applicationEncoding))throw Error('Invalid or duplicate protection profile');
  if(profile.serverReadable!==true||profile.endToEndEncrypted!==false||profile.customerUnlockRequired!==false)throw Error('Unsupported protection/access claim');
  fields(profile.recovery,['account','content','backup','rotation','missingKey','restore'],'protection recovery');
  strings(profile.references,'profile references');profiles.set(profile.id,profile);
 }
 for(const requirement of catalog.protectionRequirements){
  fields(requirement,['id','title','status'],'protection requirement');
  if(!/^DP-\d{2}$/.test(requirement.id)||requirements.has(requirement.id)||!['required-wh117','metadata-implemented'].includes(requirement.status))throw Error('Invalid or duplicate protection requirement');
  strings(requirement.references,'requirement references');requirements.set(requirement.id,requirement);
 }
 return {profiles,requirements};
}
const unlinkedOwnership={
 identity_challenges:'Pre-account signup challenges and account-bound ceremonies have no FK. The current schema deletes matching account_id challenges before users deletion; unclaimed rows expire after five minutes and bounded cleanup removes them.',
 safety_cases:'Restricted case record keyed by subject account id without a foreign key, so ordinary account cascades cannot remove it (WH-015).',
 safety_case_findings:'Append-only case decisions owned through safety_cases, deliberately outside the account cascade.',
 safety_case_evidence:'Links to reviewed risk evidence ids owned through safety_cases, deliberately outside the account cascade.',
 safety_preservation_holds:'Account/project/object hold keyed by subject account id (and project/file id) without foreign keys; an unreleased hold blocks deletion in its scope rather than following it.',
 safety_preserved_records:'Payloads preserved under an active hold, keyed by subject account id without a foreign key; removed only when the last covering hold is released (WH-132).',
 safety_evidence_objects:'Restricted R2 evidence copies owned through safety_cases; deliberately outside the account cascade until audited disposal after case closure (WH-132).',
 safety_disclosures:'Two-person lawful-disclosure manifest owned through safety_cases, deliberately outside the account cascade (WH-132).',
 safety_disclosure_items:'Manifest items owned through safety_disclosures and safety_evidence_objects, deliberately outside the account cascade (WH-132).',
 file_cleanup:'Physical object deletion queue keyed by object_key, with project/owner identifiers copied without foreign keys so preservation holds can retain queued objects. Never expose keys in customer reports.'
};
export async function currentLifecycleSchema(directory=root){
 const db=new DatabaseSync(':memory:');
 try{
  db.exec(await currentSchema(directory));
  db.exec('PRAGMA query_only=ON');
  return {db,schemaFiles:currentSchemaFiles};
 }catch(error){db.close();throw error;}
}
export function inspectLifecycleSchema(db,catalog){
 if(catalog.policyStatus!=='proposed-not-approved'||catalog.runtimeEnforcement!==false||!Array.isArray(catalog.classes)||!catalog.classes.length)throw Error('Lifecycle catalog must explicitly remain a non-enforcing proposal');
 const {profiles,requirements}=protectionMetadata(catalog);
 const groups=new Map(),assigned=new Map();
 for(const group of catalog.classes){
  if(typeof group.id!=='string'||!group.id||groups.has(group.id))throw Error('Invalid or duplicate lifecycle class');
  groups.set(group.id,group);
  if(!scopes.includes(group.scope)||!Array.isArray(group.tables)||!['current','planned'].includes(group.storageStatus))throw Error('Incomplete lifecycle class: '+group.id);
  strings(group.references,'class references: '+group.id);
  for(const field of ['purpose','currentRetention','proposedRetention','deletionAuthority','exportPolicy'])if(typeof group[field]!=='string'||!group[field].trim())throw Error('Missing lifecycle contract: '+group.id+'.'+field);
  const protection=group.protection;
  fields(protection,['profile','decision','rationale'],'class protection: '+group.id);
  for(const name of ['storage','readers','processors','remainingExposure','requirements'])strings(protection[name],'protection '+name+': '+group.id);
  const profile=profiles.get(protection.profile);
  if(!profile||protection.requirements.some(id=>!requirements.has(id))||protection.storage.some(kind=>!storageKinds.includes(kind)))throw Error('Unknown protection profile/requirement/storage: '+group.id);
  if(group.storageStatus==='planned'){
   strings(group.implementationPackets,'implementation packets: '+group.id);
   if(group.implementationPackets.some(id=>!/^WH-\d{3}$/.test(id))||group.tables.length||profile.applicationEncoding!=='not-admitted'||protection.decision!=='planned-adapter'||protection.storage.length!==1||protection.storage[0]!=='not-admitted')throw Error('Planned protection cannot claim admitted storage: '+group.id);
  }else{
   if(!group.tables.length||profile.applicationEncoding==='not-admitted'||protection.storage.includes('not-admitted')||!protection.storage.includes('control-d1')||group.implementationPackets!==undefined)throw Error('Incomplete current storage classification: '+group.id);
   if(!['retain-and-verify','extend-key-lifecycle'].includes(protection.decision))throw Error('Invalid current protection decision: '+group.id);
   if(profile.applicationEncoding==='mixed-aead-and-metadata'&&(protection.decision!=='extend-key-lifecycle'||!protection.requirements.includes('DP-01')))throw Error('Current vault requires key lifecycle work: '+group.id);
  }
  for(const table of group.tables){
   if(!/^[a-z_]+$/.test(table)||assigned.has(table))throw Error('Invalid or duplicate table classification');assigned.set(table,group.id);
  }
 }
 const names=db.prepare("SELECT name FROM sqlite_schema WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(r=>r.name);
 const missing=names.filter(n=>!assigned.has(n)),obsolete=[...assigned.keys()].filter(n=>!names.includes(n));
 if(missing.length||obsolete.length)throw Error('Lifecycle coverage mismatch; missing: '+missing.join(', ')+'; obsolete: '+obsolete.join(', '));
 // Only schema metadata is read. No application row, count or customer payload
 // is required to understand foreign-key ownership/deletion semantics.
 const tables=names.map(name=>({name,class:assigned.get(name),columns:db.prepare('SELECT name FROM pragma_table_info(?)').all(name).map(r=>r.name),foreignKeys:db.prepare('SELECT "from","table","to",on_delete FROM pragma_foreign_key_list(?) ORDER BY id,seq').all(name).map(r=>({column:r.from,parent:r.table,parentColumn:r.to,onDelete:r.on_delete}))}));
 const byName=new Map(tables.map(t=>[t.name,t]));
 function ownerPath(start){
  const queue=[[start]],visited=new Set();
  while(queue.length){const path=queue.shift(),name=path.at(-1);if(name==='users')return path;if(visited.has(name))continue;visited.add(name);for(const fk of byName.get(name)?.foreignKeys??[])queue.push([...path,fk.parent]);}
  return null;
 }
 for(const table of tables){
  table.ownerPath=ownerPath(table.name);
  if(groups.get(table.class).scope!=='platform'&&!table.ownerPath){
   if(!unlinkedOwnership[table.name])throw Error('Unreviewed unlinked ownership: '+table.name);
   table.ownershipNote=unlinkedOwnership[table.name];
  }
  if(groups.get(table.class).scope==='platform'&&table.ownerPath)throw Error('Customer-linked table classified as global: '+table.name);
 }
 const directOwnerBlocks=tables.flatMap(t=>t.foreignKeys.filter(f=>f.parent==='users'&&f.onDelete!=='CASCADE').map(f=>({table:t.name,column:f.column,onDelete:f.onDelete})));
 const current=catalog.classes.filter(group=>group.storageStatus==='current');
 const protectionClasses=catalog.classes.map(group=>({id:group.id,storageStatus:group.storageStatus,...(group.implementationPackets?{implementationPackets:group.implementationPackets}:{}),scope:group.scope,purpose:group.purpose,currentRetention:group.currentRetention,proposedRetention:group.proposedRetention,deletionAuthority:group.deletionAuthority,exportPolicy:group.exportPolicy,protection:group.protection,profile:profiles.get(group.protection.profile)}));
 return {policyStatus:catalog.policyStatus,protectionStatus:catalog.protectionStatus,readyForDeletion:false,tableCount:tables.length,classCount:current.length,plannedClassCount:groups.size-current.length,protectionClasses,protectionRequirements:catalog.protectionRequirements,directOwnerBlocks,unlinkedOwnership:tables.filter(t=>t.ownershipNote).map(t=>({table:t.name,note:t.ownershipNote})),tables,
  limitations:['Schema metadata only; no customer/provider/object inventory or erasure was performed.','Foreign keys and paths describe relationships, not deletion authority or a safe execution order. Triggers, unresolved operations, native CMS data and external copies need their documented lifecycle.','Proposed terms are not approved policy and no runtime cleanup is enabled by this catalog.','Protection descriptions and planned adapters are contracts, not proof of deployed encryption, recovery or processing authority.']};
}
export async function validateLifecycleReferences(catalog,directory=root){
 protectionMetadata(catalog);
 for(const path of new Set([catalog.contract,catalog.protectionContract,...catalog.classes.flatMap(c=>c.references),...catalog.protectionProfiles.flatMap(p=>p.references),...catalog.protectionRequirements.flatMap(r=>r.references)])){
  if(typeof path!=='string'||isAbsolute(path)||relative(directory,resolve(directory,path)).startsWith('..'))throw Error('Invalid lifecycle reference');
  if(!(await stat(resolve(directory,path))).isFile())throw Error('Lifecycle reference is not a file: '+path);
 }
 const backlog=JSON.parse(await readFile(resolve(directory,'docs/roadmap/backlog.json'),'utf8'));
 for(const group of catalog.classes.filter(c=>c.storageStatus==='planned')){
  strings(group.implementationPackets,'implementation packets: '+group.id);
  if(group.implementationPackets.some(id=>!backlog.tasks.some(t=>t.id===id&&t.kind==='implementation')))throw Error('Unknown implementation packet: '+group.id);
 }
}
export async function lifecycleReport(directory=root){
 const catalog=JSON.parse(await readFile(resolve(directory,'docs/data-lifecycle.json'),'utf8'));
 await validateLifecycleReferences(catalog,directory);
 const {db,schemaFiles}=await currentLifecycleSchema(directory);
 try{return {...inspectLifecycleSchema(db,catalog),schemaFileCount:schemaFiles.length};}finally{db.close();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length>3||(process.argv[2]&&process.argv[2]!=='--json'))throw Error('Usage: node tools/lifecycle-catalog.mjs [--json]');
  const report=await lifecycleReport();
  console.log(process.argv[2]?JSON.stringify(report,null,2):`Lifecycle catalog: ${report.tableCount} tables, ${report.classCount} current and ${report.plannedClassCount} planned data classes, ${report.schemaFileCount} current schema sources; ${report.directOwnerBlocks.length} direct non-cascading account references and ${report.unlinkedOwnership.length} explicit unlinked ownership cases. Protection decision and proposed retention only; no runtime authority or deletion authorized.`);
 }catch(error){console.error(error.message);process.exitCode=1;}
}
