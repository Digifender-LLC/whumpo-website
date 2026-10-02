import {currentSchema,currentSchemaFiles} from './current-schema.mjs';
import {DatabaseSync} from 'node:sqlite';
import {readFile,stat} from 'node:fs/promises';
import {resolve,dirname,isAbsolute,relative} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const scopes=['owner','project','visitor','mixed','platform'];
const unlinkedOwnership={
 identity_challenges:'Pre-account signup challenges and account-bound ceremonies have no FK. The current schema deletes matching account_id challenges before users deletion; unclaimed rows expire after five minutes and bounded cleanup removes them.',
 file_cleanup:'Physical object deletion queue, keyed by object_key only. Recover tenant association from a separately retained object manifest; never expose keys in customer reports.'
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
 if(catalog.version!==1||catalog.policyStatus!=='proposed-not-approved'||catalog.runtimeEnforcement!==false||!Array.isArray(catalog.classes))throw Error('Lifecycle catalog must explicitly remain a non-enforcing proposal');
 const groups=new Map(),assigned=new Map();
 for(const group of catalog.classes){
  if(typeof group.id!=='string'||!group.id||groups.has(group.id))throw Error('Invalid or duplicate lifecycle class');
  groups.set(group.id,group);
  if(!scopes.includes(group.scope)||!Array.isArray(group.tables)||!group.tables.length||!Array.isArray(group.references)||!group.references.length)throw Error('Incomplete lifecycle class: '+group.id);
  for(const field of ['purpose','currentRetention','proposedRetention','deletionAuthority','exportPolicy'])if(typeof group[field]!=='string'||!group[field].trim())throw Error('Missing lifecycle contract: '+group.id+'.'+field);
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
 return {policyStatus:catalog.policyStatus,readyForDeletion:false,tableCount:tables.length,classCount:groups.size,directOwnerBlocks,unlinkedOwnership:tables.filter(t=>t.ownershipNote).map(t=>({table:t.name,note:t.ownershipNote})),tables,
  limitations:['Schema metadata only; no customer/provider/object inventory or erasure was performed.','Foreign keys and paths describe relationships, not deletion authority or a safe execution order. Triggers, unresolved operations, native CMS data and external copies need their documented lifecycle.','Proposed terms are not approved policy and no runtime cleanup is enabled by this catalog.']};
}
export async function validateLifecycleReferences(catalog,directory=root){
 for(const path of [catalog.contract,...catalog.classes.flatMap(c=>c.references)]){
  if(typeof path!=='string'||isAbsolute(path)||relative(directory,resolve(directory,path)).startsWith('..'))throw Error('Invalid lifecycle reference');
  if(!(await stat(resolve(directory,path))).isFile())throw Error('Lifecycle reference is not a file: '+path);
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
  console.log(process.argv[2]?JSON.stringify(report,null,2):`Lifecycle catalog: ${report.tableCount} tables, ${report.classCount} data classes, ${report.schemaFileCount} current schema sources; ${report.directOwnerBlocks.length} direct non-cascading account references and ${report.unlinkedOwnership.length} explicit unlinked ownership cases. Proposed policy only; no deletion authorized.`);
 }catch(error){console.error(error.message);process.exitCode=1;}
}
