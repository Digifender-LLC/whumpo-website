import {readFile} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

export const currentSchemaFiles=Object.freeze(['src/workspace-identity/canonical-inputs.sql','schema/platform.sql','src/workspace-identity/schema.sql','src/funnel-metrics/schema.sql','src/guest-previews/schema.sql','src/shared-modules/schema.sql','src/account-lifecycle/schema.sql','src/restore-suppression/schema.sql']);
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const hash=value=>createHash('sha256').update(value).digest('hex');
// _cf_KV and _cf_METADATA belong to D1/Wrangler. Everything else, including an obsolete migration ledger,
// is application schema and must participate in the exact inventory.
export const schemaInventorySQL="SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT GLOB 'sqlite_*' AND name NOT IN ('_cf_KV','_cf_METADATA') ORDER BY type,name";
export function schemaSummary(objects){
 const rows=objects.map(({type,name,tbl_name,sql})=>({type,name,tbl_name,sql}));
 return {sha256:hash(JSON.stringify(rows)),objects:rows.length,tables:rows.filter(r=>r.type==='table').length};
}
export async function inspectSchema(db){return schemaSummary((await db.prepare(schemaInventorySQL).all()).results);}
/** One current policy; initialize an empty DB, never convert an old account. */
export async function currentSchema(directory=root){
 return (await Promise.all(currentSchemaFiles.map(file=>readFile(resolve(directory,file),'utf8')))).join('\n');
}
export async function currentSchemaArtifact(directory=root){
 const inputs=await Promise.all(currentSchemaFiles.map(async path=>({path,content:await readFile(resolve(directory,path))})));
 const files=inputs.map(({path,content})=>({path,bytes:content.length,sha256:hash(content)}));
 const sql=inputs.map(i=>i.content.toString('utf8')).join('\n'),db=new DatabaseSync(':memory:');
 try{
  db.exec('PRAGMA foreign_keys=ON');db.exec(sql);
  if(db.prepare('PRAGMA foreign_key_check').all().length)throw Error('Current schema seed data violates foreign keys');
  return {sql,sqlSha256:hash(sql),files,expected:schemaSummary(db.prepare(schemaInventorySQL).all())};
 }finally{db.close();}
}
export function currentSchemaPlan(artifact,observed){
 const equal=JSON.stringify(artifact.expected)===JSON.stringify(observed);
 if(!equal&&observed.objects!==0)throw Error('Database is not the current schema; select a new empty database for the test reset');
 return {mode:equal?'none':'initialize',sqlSha256:artifact.sqlSha256,files:artifact.files,before:observed,expected:artifact.expected};
}
