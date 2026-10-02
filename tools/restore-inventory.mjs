import {DatabaseSync} from 'node:sqlite';
import {lstat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {pathCheck,readPrivate,writePrivate} from './operator-private-files.mjs';
import {captureRestoreManifest,captureRestoreConstraint,restoreManifestDigest} from './restore-admission.mjs';
import {withRecoveredConnectionKeys} from './connection-key-backup.mjs';

// A separate operator authority, not a table in the recovered application DB.
// No network listener, provider adapter, service activation or key retirement.
const denied=()=>new Error('Independent restore inventory unavailable. Inspect the current operator inventory locally.');
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const id=v=>typeof v==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(v);
const hash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const text=v=>JSON.stringify(v);
const same=(a,b)=>text(a)===text(b);
const limit={archives:256,events:512,bytes:32*1024*1024,evidenceBytes:262144};
const schema=`
 CREATE TABLE identity(singleton INTEGER PRIMARY KEY CHECK(singleton=1),version INTEGER NOT NULL CHECK(version=1),environment TEXT NOT NULL CHECK(environment='test'),stream_id TEXT NOT NULL UNIQUE) STRICT;
 CREATE TABLE archive(snapshot_id TEXT PRIMARY KEY NOT NULL,manifest_digest TEXT NOT NULL,manifest TEXT NOT NULL CHECK(json_valid(manifest)),sequence INTEGER NOT NULL CHECK(sequence>=0),key_backup TEXT NOT NULL CHECK(json_valid(key_backup)),recorded_at INTEGER NOT NULL CHECK(recorded_at>0)) STRICT;
 CREATE TABLE withdrawal(snapshot_id TEXT PRIMARY KEY NOT NULL REFERENCES archive(snapshot_id),recorded_at INTEGER NOT NULL CHECK(recorded_at>0)) STRICT;
 CREATE TABLE event(sequence INTEGER PRIMARY KEY CHECK(sequence>0 AND sequence<=512),operation_id TEXT NOT NULL UNIQUE,selection TEXT NOT NULL CHECK(json_valid(selection)),kind TEXT NOT NULL,data TEXT NOT NULL CHECK(json_valid(data))) STRICT;
 CREATE TRIGGER event_sequence BEFORE INSERT ON event WHEN NEW.sequence<>(SELECT COUNT(*)+1 FROM event) BEGIN SELECT RAISE(ABORT,'inventory_sequence'); END;
 CREATE TRIGGER archive_sequence BEFORE INSERT ON archive WHEN NEW.sequence<>(SELECT COUNT(*) FROM event) OR (SELECT COUNT(*) FROM archive)>=256 BEGIN SELECT RAISE(ABORT,'inventory_sequence'); END;
 ${['identity','archive','withdrawal','event'].flatMap(table=>['UPDATE','DELETE'].map(action=>`CREATE TRIGGER ${table}_${action.toLowerCase()} BEFORE ${action} ON ${table} BEGIN SELECT RAISE(ABORT,'inventory_immutable'); END;`)).join('\n')}
`;
const schemaRows=db=>db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT GLOB 'sqlite_*' ORDER BY type,name").all();
const temp=new DatabaseSync(':memory:');temp.exec(schema);const expectedSchema=text(schemaRows(temp));temp.close();
function configure(db){db.exec('PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA busy_timeout=1000;');}
function metadata(db,streamId){
 if(text(schemaRows(db))!==expectedSchema||db.prepare('PRAGMA quick_check').get().quick_check!=='ok'||db.prepare('PRAGMA foreign_key_check').all().length)throw denied();
 const identity=db.prepare('SELECT * FROM identity').all();
 if(identity.length!==1||identity[0].version!==1||identity[0].environment!=='test'||identity[0].stream_id!==streamId)throw denied();
 const archives=db.prepare('SELECT * FROM archive ORDER BY snapshot_id').all(),withdrawn=new Set(db.prepare('SELECT snapshot_id FROM withdrawal').all().map(r=>r.snapshot_id));
 const events=db.prepare('SELECT * FROM event ORDER BY sequence').all();
 if(archives.length>limit.archives||events.length>limit.events)throw denied();
 for(const [index,row] of events.entries()){
  if(row.sequence!==index+1||!id(row.operation_id))throw denied();
  row.data=JSON.parse(row.data);row.selection=JSON.parse(row.selection);
 }
 for(const row of archives){
  row.manifest=JSON.parse(row.manifest);row.key_backup=JSON.parse(row.key_backup);
  const m=row.manifest,k=row.key_backup;
  if(!id(row.snapshot_id)||!hash(row.manifest_digest)||restoreManifestDigest(m)!==row.manifest_digest||m.snapshotId!==row.snapshot_id||m.checkpoint.streamId!==streamId||m.checkpoint.sequence!==row.sequence||row.sequence>events.length)throw denied();
  if(!exact(k,['backupId','sha256','keyIds'])||!id(k.backupId)||!hash(k.sha256)||!Array.isArray(k.keyIds)||!k.keyIds.length||k.keyIds.length>4||!k.keyIds.every(id)||new Set(k.keyIds).size!==k.keyIds.length)throw denied();
 }
 return {archives,withdrawn,events,revision:[archives.length,withdrawn.size,events.length]};
}
function status(state,streamId){return {version:1,scope:'operator-restore-inventory',streamId,archives:state.archives.length,permitted:state.archives.length-state.withdrawn.size,withdrawn:state.withdrawn.size,currentSequence:state.events.length,servingAllowed:false,providerDispatchAllowed:false,retirementAllowed:false,independentCustodyAccepted:false};}
async function fileCheck(file){
 await pathCheck(file,{external:true,parent:true});await readPrivate(file,limit.bytes);
 const stat=await lstat(file);if(!file.endsWith('.whumpo-restore-inventory'))throw denied();return {dev:stat.dev,ino:stat.ino};
}

export async function createRestoreInventory({inventoryFile,streamId}){
 let db;
 try{
  if(!id(streamId)||typeof inventoryFile!=='string'||!inventoryFile.endsWith('.whumpo-restore-inventory'))throw denied();
  // O_EXCL prevents accidentally replacing the authority after an uncertain init.
  await writePrivate(inventoryFile,Buffer.alloc(0));db=new DatabaseSync(inventoryFile);configure(db);
  db.exec('BEGIN IMMEDIATE');try{db.exec(schema);db.prepare("INSERT INTO identity VALUES(1,1,'test',?)").run(streamId);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
  await fileCheck(inventoryFile);return status(metadata(db,streamId),streamId);
 }catch{throw denied();}finally{db?.close();}
}

/** sourceDb is a trusted operator-selected CURRENT database capability. It is
 * never taken from a restore request. Omit it for read-only evidence/status.
 * Local file custody does not prove offsite storage or provider freshness. */
export async function openRestoreInventory({inventoryFile,expectedStreamId,sourceDb}){
 let db;
 try{
  if(!id(expectedStreamId))throw denied();const identity=await fileCheck(inventoryFile);
  db=new DatabaseSync(inventoryFile,{readOnly:!sourceDb});
  if(sourceDb)configure(db);else db.exec('PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA query_only=ON; PRAGMA busy_timeout=1000;');
  metadata(db,expectedStreamId);let closed=false,queue=Promise.resolve();
  const check=async()=>{if(closed||!same(identity,await fileCheck(inventoryFile)))throw denied();return metadata(db,expectedStreamId);};
  // Keep a handle's async observations ordered. Across processes, BEGIN IMMEDIATE
  // plus revision readback rejects an observation captured across a changed head.
  const serial=operation=>{const result=queue.then(operation).catch(()=>{throw denied();});queue=result.catch(()=>{});return result;};
  const transact=(before,write)=>{
   if(!sourceDb)throw denied();db.exec('BEGIN IMMEDIATE');
   try{const current=metadata(db,expectedStreamId);if(!same(before.revision,current.revision))throw denied();const result=write(current);db.exec('COMMIT');return result;}
   catch(error){db.exec('ROLLBACK');throw error;}
  };
  const api={
   inspect:()=>serial(async()=>status(await check(),expectedStreamId)),
   registerArchive:({archiveDb,snapshotId,keyBackup})=>serial(async()=>{
    if(!sourceDb||archiveDb===sourceDb||!archiveDb||!id(snapshotId))throw denied();
    const before=await check();if(before.withdrawn.has(snapshotId))throw denied();
    const existing=before.archives.find(r=>r.snapshot_id===snapshotId);
    const manifest=await captureRestoreManifest(archiveDb,{snapshotId,streamId:expectedStreamId,sequence:existing?.sequence??before.events.length});
    // A real stored-byte capability must still decrypt before its metadata can
    // be registered. A caller's copied JSON or arbitrary digest is not accepted.
    await withRecoveredConnectionKeys(keyBackup,()=>undefined);
    const reference={backupId:keyBackup.backupId,sha256:keyBackup.sha256,keyIds:keyBackup.keyIds};
    if(!manifest.keyIds.every(k=>reference.keyIds.includes(k)))throw denied();
    await check();
    transact(before,()=>{
     if(existing){if(existing.manifest_digest!==restoreManifestDigest(manifest)||!same(existing.key_backup,reference))throw denied();return;}
     db.prepare('INSERT INTO archive VALUES(?,?,?,?,?,?)').run(snapshotId,restoreManifestDigest(manifest),text(manifest),manifest.checkpoint.sequence,text(reference),Date.now());
    });
    return manifest;
   }),
   withdrawArchive:({snapshotId})=>serial(async()=>{
    if(!id(snapshotId))throw denied();const before=await check();
    transact(before,()=>{if(!before.archives.some(r=>r.snapshot_id===snapshotId))throw denied();if(!before.withdrawn.has(snapshotId))db.prepare('INSERT INTO withdrawal VALUES(?,?)').run(snapshotId,Date.now());});
    return {snapshotId,state:'withdrawn',servingAllowed:false};
   }),
   observe:({operationId,selection})=>{
    // Copy before joining the async queue; no later caller mutation of selectors.
    let selected;try{selected=structuredClone(selection);}catch{return Promise.reject(denied());}
    return serial(async()=>{
     if(!sourceDb||!id(operationId))throw denied();const before=await check();
     const prior=before.events.find(e=>e.operation_id===operationId);
     if(prior){if(!same(prior.selection,selected))throw denied();return {operationId,sequence:prior.sequence,kind:prior.kind,recorded:true};}
     const observed=await captureRestoreConstraint(sourceDb,selected);
     // Epoch observations advance. Replays use the original operation ID;
     // another same-epoch observation must not append an invalid duplicate.
     if(observed.kind==='identity-epoch'){
      const last=before.events.filter(e=>e.kind===observed.kind&&e.data.ownerId===observed.data.ownerId).at(-1);
      if(last&&observed.data.epoch<=last.data.epoch)throw denied();
     }
     const events=[...before.events.map(({sequence,kind,data})=>({sequence,kind,data})),{sequence:before.events.length+1,...observed}];
     if(events.length>limit.events||Buffer.byteLength(text(events))+4096>limit.evidenceBytes)throw denied();await check();
     transact(before,()=>db.prepare('INSERT INTO event VALUES(?,?,?,?,?)').run(before.events.length+1,operationId,text(selected),observed.kind,text(observed.data)));
     return {operationId,sequence:before.events.length+1,kind:observed.kind,recorded:true};
    });
   },
   evidenceSource:Object.freeze({fetch:request=>serial(async()=>{
    if(!(request instanceof Request)||request.url!=='https://restore-evidence.internal/v2/check'||request.method!=='POST'||request.headers.get('content-type')!=='application/json'||request.signal.aborted)return new Response(null,{status:400});
    const reader=request.body?.getReader();if(!reader)return new Response(null,{status:400});
    let bytes=0,timer;const parts=[];
    const cancel=()=>{void reader.cancel().catch(()=>{});};request.signal.addEventListener('abort',cancel,{once:true});
    try{
     await Promise.race([
      new Promise((_,reject)=>{timer=setTimeout(()=>{cancel();reject(denied());},2000);}),
      (async()=>{for(;;){const p=await reader.read();if(p.done)break;bytes+=p.value.length;if(bytes>2048)throw denied();parts.push(p.value);}})(),
     ]);
    }finally{clearTimeout(timer);request.signal.removeEventListener('abort',cancel);cancel();reader.releaseLock();}
    if(request.signal.aborted)throw denied();
    const input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(parts)));
    if(!exact(input,['version','snapshotId','manifestDigest','challenge'])||input.version!==2||!id(input.snapshotId)||!hash(input.manifestDigest)||!id(input.challenge))return new Response(null,{status:400});
    // One SQLite transaction provides a consistent permission/event head.
    await check();db.exec('BEGIN');let state;
    try{state=metadata(db,expectedStreamId);db.exec('COMMIT');}catch(error){db.exec('ROLLBACK');throw error;}
    const archive=state.archives.find(r=>r.snapshot_id===input.snapshotId&&r.manifest_digest===input.manifestDigest);
    if(!archive||state.withdrawn.has(input.snapshotId))return new Response(null,{status:404});
    const issuedAt=Date.now();
    const body={version:2,streamId:expectedStreamId,snapshotId:input.snapshotId,manifestDigest:archive.manifest_digest,challenge:input.challenge,archiveState:'permitted',capturedSequence:archive.sequence,baseSequence:0,currentSequence:state.events.length,issuedAt,expiresAt:issuedAt+10000,events:state.events.map(({sequence,kind,data})=>({sequence,kind,data})),keyBackup:archive.key_backup};
    const encoded=text(body);if(Buffer.byteLength(encoded)>limit.evidenceBytes||request.signal.aborted)throw denied();
    return new Response(encoded,{headers:{'content-type':'application/json','cache-control':'no-store'}});
   })}),
   close:()=>serial(async()=>{if(!closed){closed=true;db.close();}}),
  };
  return Object.freeze(api);
 }catch{db?.close();throw denied();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 let inventory;
 try{
  const [operation,file,stream,...rest]=process.argv.slice(2);
  if(rest.length||!['init','inspect'].includes(operation))throw denied();
  if(operation==='init')console.log(text(await createRestoreInventory({inventoryFile:file,streamId:stream})));
  else{inventory=await openRestoreInventory({inventoryFile:file,expectedStreamId:stream});console.log(text(await inventory.inspect()));}
 }catch{console.error(denied().message);process.exitCode=1;}finally{await inventory?.close();}
}
