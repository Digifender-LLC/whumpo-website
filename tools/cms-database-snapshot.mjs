// Logical native database capture, including FTS5 data without copying shadow tables.
// The caller supplies read-only query access. No live tables are changed.
import {createHash} from 'node:crypto';
const ident=s=>'"'+s.replaceAll('"','""')+'"';
const literal=s=>"'"+s.replaceAll("'","''")+"'";
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function captureCMSDatabase(query,{maxBytes=64*1024*1024,maxRows=100000}={}){
 let bytes=0,total=0;const charge=value=>{bytes+=Buffer.byteLength(JSON.stringify(value));if(bytes>maxBytes)throw Error('CMS database snapshot exceeds its byte limit');};
 const schema=await query("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE sql IS NOT NULL AND substr(name,1,7)<>'sqlite_' AND substr(name,1,4)<>'_cf_' ORDER BY type,name");
 const inventory=(await query('PRAGMA table_list')).filter(t=>t.schema==='main'&&!t.name.startsWith('_cf_')&&(!t.name.startsWith('sqlite_')||t.name==='sqlite_sequence')&&['table','virtual'].includes(t.type)).sort((a,b)=>a.name.localeCompare(b.name,'en'));
 if(inventory.length>500)throw Error('CMS database has too many tables');
 const shadow=new Set((await query('PRAGMA table_list')).filter(t=>t.type==='shadow').map(t=>t.name));
 const definitions=schema.filter(s=>!shadow.has(s.name)&&!shadow.has(s.tbl_name));charge(definitions);
 const tables=[];
 for(const table of inventory){
  const info=await query('PRAGMA table_xinfo('+literal(table.name)+')'),columns=info.filter(c=>c.hidden===0).map(c=>c.name);
  if(!columns.length)throw Error('CMS snapshot encountered a table with no writable columns');
  let rowid;
  if(!table.wr){rowid=['rowid','_rowid_','oid'].find(alias=>!columns.some(c=>c.toLowerCase()===alias));if(!rowid)throw Error('CMS snapshot cannot preserve this table row identity');columns.unshift(rowid);}
  const order=rowid?ident(rowid):info.filter(c=>c.pk).sort((a,b)=>a.pk-b.pk).map(c=>ident(c.name)).join(',');
  if(!order)throw Error('CMS snapshot cannot determine a stable row order');
  // Hex text preserves embedded NULs; SQLite quote preserves integer precision and blobs.
  const values=columns.map((c,i)=>`CASE typeof(${ident(c)}) WHEN 'text' THEN 'CAST(X'''||hex(CAST(${ident(c)} AS BLOB))||''' AS TEXT)' ELSE quote(${ident(c)}) END AS ${ident('c'+i)}`).join(',');
  const rows=[];
  for(let offset=0;;offset+=50){
   const page=await query(`SELECT ${values} FROM ${ident(table.name)} ORDER BY ${order} LIMIT 50 OFFSET ${offset}`);
   for(const row of page){const cells=columns.map((_,i)=>row['c'+i]);if(cells.some(c=>typeof c!=='string'))throw Error('Invalid CMS snapshot cell');charge(cells);rows.push(cells);if(++total>maxRows)throw Error('CMS database snapshot exceeds its row limit');}
   if(page.length<50)break;
  }
  tables.push({name:table.name,columns,rows});
 }
 const result={format:'townhello-cms-database-v1',schema:definitions,tables};return {snapshot:result,digest:hash(result),rows:total,bytes};
}
export async function stableCMSDatabase(query,options){
 const first=await captureCMSDatabase(query,options),second=await captureCMSDatabase(query,options);
 if(first.digest!==second.digest)throw Error('CMS database changed during capture; no stable snapshot was accepted');return first;
}
// Used only for isolated local restore verification of a freshly captured, trusted snapshot.
export function restoreCapturedCMSDatabase(database,snapshot){
 if(snapshot.format!=='townhello-cms-database-v1')throw Error('Unsupported CMS database snapshot');
 database.exec('PRAGMA foreign_keys=OFF; BEGIN');
 try{
  for(const s of snapshot.schema.filter(s=>s.type==='table'))database.prepare(s.sql).run();
  for(const table of snapshot.tables){
   if(table.name==='sqlite_sequence')database.exec('DELETE FROM sqlite_sequence');
   for(const row of table.rows)database.prepare(`INSERT INTO ${ident(table.name)} (${table.columns.map(ident).join(',')}) VALUES (${row.join(',')})`).run();
  }
  for(const s of snapshot.schema.filter(s=>s.type!=='table'))database.prepare(s.sql).run();
  if(database.prepare('PRAGMA foreign_key_check').all().length)throw Error('Restored CMS database failed foreign-key validation');
  const checks=database.prepare('PRAGMA integrity_check').all();if(checks.length!==1||checks[0].integrity_check!=='ok')throw Error('Restored CMS database failed integrity validation');
  database.exec('COMMIT; PRAGMA foreign_keys=ON');
 }catch(error){database.exec('ROLLBACK');throw error;}
}

// Only for a fresh, isolated D1 binding. Callers must never supply a live target.
export async function restoreCapturedCMSD1(database,snapshot){
 if(snapshot?.format!=='townhello-cms-database-v1'||!Array.isArray(snapshot.schema)||!Array.isArray(snapshot.tables))throw Error('Unsupported CMS database snapshot');
 const existing=await database.prepare("SELECT name FROM sqlite_schema WHERE sql IS NOT NULL AND substr(name,1,7)<>'sqlite_' AND substr(name,1,4)<>'_cf_' LIMIT 1").first();
 if(existing)throw Error('CMS restore target must be empty');
 const statements=['PRAGMA defer_foreign_keys=ON'];
 for(const s of snapshot.schema.filter(s=>s.type==='table'))statements.push(s.sql);
 for(const table of snapshot.tables){if(table.name==='sqlite_sequence')statements.push('DELETE FROM sqlite_sequence');for(const row of table.rows)statements.push(`INSERT INTO ${ident(table.name)} (${table.columns.map(ident).join(',')}) VALUES (${row.join(',')})`);}
 for(const s of snapshot.schema.filter(s=>s.type!=='table'))statements.push(s.sql);
 if(statements.length>1000||statements.some(s=>typeof s!=='string'||Buffer.byteLength(s)>90000)||statements.reduce((n,s)=>n+Buffer.byteLength(s),0)>8*1024*1024)throw Error('CMS restore exceeds the isolated D1 batch limit');
 // One D1 batch: a failed statement rolls back earlier writes in this attempt.
 const result=await database.batch(statements.map(sql=>database.prepare(sql)));if(result.some(r=>!r.success))throw Error('CMS D1 restore was not confirmed');
 const foreign=await database.prepare('PRAGMA foreign_key_check').all();if(foreign.results.length)throw Error('CMS D1 restore failed foreign-key validation');
 const integrity=await database.prepare('PRAGMA quick_check').all();if(integrity.results.length!==1||integrity.results[0].quick_check!=='ok')throw Error('CMS D1 restore failed integrity validation');
 const roundtrip=await captureCMSDatabase(async sql=>(await database.prepare(sql).all()).results);
 if(roundtrip.digest!==hash(snapshot))throw Error('CMS D1 restore differs from source');return roundtrip;
}
