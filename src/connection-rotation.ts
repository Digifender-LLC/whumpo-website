import {connectionCiphertextKeyId,connectionKeyFingerprints,connectionKeyringMetadata,seal,unseal} from './connection-vault';
import {assertMaintenanceDatabase} from './workspace-identity/admission';

// Fixed actual stores; operator input never becomes an SQL identifier.
const stores=[
 {table:'github_refresh_custody',provider:'github',purpose:'refresh',id:'token_id',cipher:'ciphertext',fields:['token_id','user_id','client_id','ciphertext','expires_at','access_revoked_at']},
 {table:'github_token_vault',provider:'github',purpose:'token',id:'id',cipher:'ciphertext',fields:['id','user_id','ciphertext','expires_at','state']},
 {table:'cloudflare_token_vault',provider:'cloudflare',purpose:'token',id:'id',cipher:'ciphertext',fields:['id','user_id','ciphertext','expires_at','created_at','revoke_attempt','revoke_after','state']},
 {table:'github_oauth_states',provider:'github',purpose:'pkce',id:'state_hash',cipher:'verifier_ciphertext',fields:['user_id','state_hash','authority_id','verifier_ciphertext','expires_at','claimed']},
 {table:'cloudflare_oauth_states',provider:'cloudflare',purpose:'pkce',id:'state_hash',cipher:'verifier_ciphertext',fields:['user_id','state_hash','authority_id','verifier_ciphertext','expires_at','claimed','cancelled']},
] as const;
const identifier=/^[a-z0-9][a-z0-9-]{0,127}$/;
function input(...values:string[]){if(values.some(v=>typeof v!=='string'||!identifier.test(v)))throw new Error('Invalid connection-key review identity.');}
const denied=()=>new Error('Connection-key operation unavailable; inspect current operator readback.');
const prefix=(column:string)=>`substr(${column},1,length(?))!=?`;
const remainingSQL=stores.map(s=>`SELECT COUNT(*) AS n FROM ${s.table} WHERE ${prefix(s.cipher)}`).join(' UNION ALL ');
const absentSQL=stores.map(s=>`NOT EXISTS(SELECT 1 FROM ${s.table} WHERE ${prefix(s.cipher)})`).join(' AND ');
function remainingParams(id:string){return stores.flatMap(()=>['wv2.'+id+'.','wv2.'+id+'.']);}
type Policy={active_key:string;revision:number;review_id:string};
type Rotation={id:string;source_key:string;target_key:string;revision:number;review_id:string;state:'running'|'complete'};
type Receipt={id:string;rotation_id:string;selected_count:number;changed_count:number;bytes_before:number;bytes_after:number;crypto_ms:number};
const policy=(db:D1Database)=>db.prepare('SELECT active_key,revision,review_id FROM connection_key_policy WHERE singleton=1').first<Policy>();
const rotation=(db:D1Database,id:string)=>db.prepare('SELECT id,source_key,target_key,revision,review_id,state FROM connection_key_rotations WHERE id=?').bind(id).first<Rotation>();
const receipt=(db:D1Database,id:string)=>db.prepare('SELECT id,rotation_id,selected_count,changed_count,bytes_before,bytes_after,crypto_ms FROM connection_rotation_batches WHERE id=?').bind(id).first<Receipt>();
async function registered(db:D1Database,secret:string){
 const keys=await connectionKeyFingerprints(secret);
 for(const k of keys)if(!await db.prepare('SELECT 1 FROM connection_key_registry WHERE id=? AND fingerprint=?').bind(k.id,k.fingerprint).first())throw denied();
 return connectionKeyringMetadata(secret);
}
/** Reviewed platform operation, not an HTTP/Chat/customer capability. */
export async function registerConnectionKeys(db:D1Database,secret:string,reviewId:string){
 assertMaintenanceDatabase(db);input(reviewId);const keys=await connectionKeyFingerprints(secret);
 for(const k of keys){const old=await db.prepare('SELECT fingerprint FROM connection_key_registry WHERE id=?').bind(k.id).first<{fingerprint:string}>();if(old&&old.fingerprint!==k.fingerprint)throw denied();}
 await db.batch(keys.map(k=>db.prepare('INSERT INTO connection_key_registry(id,fingerprint,review_id) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING').bind(k.id,k.fingerprint,reviewId)));
 return registered(db,secret);
}
/** Explicit empty/current-database admission. Customer requests cannot bootstrap it. */
export async function initializeConnectionKeys(db:D1Database,secret:string,reviewId:string){
 assertMaintenanceDatabase(db);input(reviewId);const ring=await registerConnectionKeys(db,secret,reviewId);
 const before=await policy(db);if(before){if(before.active_key!==ring.active||before.review_id!==reviewId)throw denied();return before;}
 await db.prepare(`INSERT INTO connection_key_policy(singleton,active_key,revision,review_id) SELECT 1,?,1,? WHERE NOT EXISTS(SELECT 1 FROM connection_key_policy) AND ${stores.map(s=>`NOT EXISTS(SELECT 1 FROM ${s.table})`).join(' AND ')}`).bind(ring.active,reviewId).run();
 const after=await policy(db);if(!after||after.active_key!==ring.active||after.review_id!==reviewId)throw denied();return after;
}
/** Activation atomically changes the only admitted write key. An OAuth exchange
 * admitted under the previous key must have settled first; it has no TTL escape. */
export async function beginConnectionRotation(db:D1Database,secret:string,request:{id:string;reviewId:string;expectedRevision:number}){
 assertMaintenanceDatabase(db);input(request.id,request.reviewId);if(!Number.isSafeInteger(request.expectedRevision)||request.expectedRevision<1)throw denied();
 const ring=await registered(db,secret),matches=(row:Rotation|null)=>!!row&&row.target_key===ring.active&&row.review_id===request.reviewId&&row.revision===request.expectedRevision+1;
 const existing=await rotation(db,request.id);if(existing){if(!matches(existing))throw denied();return existing;}
 const previous=await policy(db);if(!previous||!ring.keyIds.includes(previous.active_key))throw denied();
 try{await db.batch([
  db.prepare("INSERT INTO connection_key_rotations(id,source_key,target_key,revision,review_id,state) SELECT ?,active_key,?,revision+1,?,'running' FROM connection_key_policy WHERE singleton=1 AND revision=? AND active_key!=? AND NOT EXISTS(SELECT 1 FROM connection_oauth_exchanges)").bind(request.id,ring.active,request.reviewId,request.expectedRevision,ring.active),
  db.prepare("UPDATE connection_key_policy SET active_key=?,revision=revision+1,review_id=? WHERE singleton=1 AND revision=? AND EXISTS(SELECT 1 FROM connection_key_rotations WHERE id=? AND revision=connection_key_policy.revision+1 AND target_key=? AND state='running')").bind(ring.active,request.reviewId,request.expectedRevision,request.id,ring.active),
 ]);}catch{const saved=await rotation(db,request.id);if(matches(saved))return saved!;throw denied();}
 const saved=await rotation(db,request.id);if(!matches(saved))throw denied();return saved!;
}
/** One bounded transaction per caller-supplied batch ID. Readback wins over replay.
 * Only ciphertext changes; every snapshotted lifecycle column participates in CAS. */
export async function rotateConnectionBatch(db:D1Database,secret:string,rotationId:string,batchId:string,limit=10){
 assertMaintenanceDatabase(db);input(rotationId,batchId);if(!Number.isSafeInteger(limit)||limit<1||limit>20)throw denied();
 const saved=await receipt(db,batchId);if(saved){if(saved.rotation_id!==rotationId)throw denied();return saved;}
 const ring=await registered(db,secret),run=await rotation(db,rotationId),current=await policy(db);
 if(!run||run.state!=='running'||run.target_key!==ring.active||current?.revision!==run.revision||current.active_key!==run.target_key)throw denied();
 const selected: {store:typeof stores[number];row:Record<string,string|number|null>;next:string}[]=[];
 let bytesBefore=0,bytesAfter=0,cryptoMs=0;
 for(const store of stores){
  const rows=await db.prepare(`SELECT ${store.fields.join(',')} FROM ${store.table} WHERE ${prefix(store.cipher)} ORDER BY user_id,${store.id} LIMIT ?`).bind('wv2.'+run.target_key+'.','wv2.'+run.target_key+'.',limit-selected.length).all<Record<string,string|number|null>>();
  for(const row of rows.results){
   const ciphertext=String(row[store.cipher]);connectionCiphertextKeyId(ciphertext);
   const context=`whumpo:${store.provider}:${store.purpose}:${row.user_id}:${row[store.id]}`;
   const start=performance.now(),next=await seal(secret,context,await unseal(secret,context,ciphertext));cryptoMs+=performance.now()-start;
   bytesBefore+=ciphertext.length;bytesAfter+=next.length;selected.push({store,row,next});
  }
  if(selected.length===limit)break;
 }
 const statements=[db.prepare("INSERT INTO connection_rotation_batches(id,rotation_id,selected_count,bytes_before,bytes_after,crypto_ms) SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM connection_key_rotations r JOIN connection_key_policy p ON p.revision=r.revision AND p.active_key=r.target_key WHERE r.id=? AND r.state='running')").bind(batchId,rotationId,selected.length,bytesBefore,bytesAfter,Math.ceil(cryptoMs),rotationId)];
 for(const {store,row,next} of selected){
  statements.push(db.prepare('INSERT INTO connection_rotation_guards(batch_id,store,owner_id,record_id,old_ciphertext,new_ciphertext) VALUES(?,?,?,?,?,?)').bind(batchId,store.table,row.user_id,row[store.id],row[store.cipher],next));
  statements.push(db.prepare(`UPDATE ${store.table} SET ${store.cipher}=? WHERE ${store.fields.map(f=>`${f} IS ?`).join(' AND ')}`).bind(next,...store.fields.map(f=>row[f])));
 }
 statements.push(db.prepare('DELETE FROM connection_rotation_guards WHERE batch_id=?').bind(batchId));
 statements.push(db.prepare(`UPDATE connection_key_rotations SET state='complete',completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND state='running' AND ${absentSQL}`).bind(rotationId,...remainingParams(run.target_key)));
 try{await db.batch(statements);}catch{const found=await receipt(db,batchId);if(found?.rotation_id===rotationId)return found;throw denied();}
 const found=await receipt(db,batchId);if(!found||found.rotation_id!==rotationId)throw denied();return found;
}
/** Metadata only; never returns owner IDs, ciphertext, fingerprints or provider secrets. */
export async function connectionRotationStatus(db:D1Database,id:string){
 assertMaintenanceDatabase(db);input(id);const run=await rotation(db,id);if(!run)throw denied();
 const current=await policy(db),remaining=await db.prepare(`SELECT SUM(n) AS n FROM (${remainingSQL})`).bind(...remainingParams(run.target_key)).first<{n:number}>();
 const totals=await db.prepare('SELECT COUNT(*) AS batches,COALESCE(SUM(changed_count),0) AS rotated,COALESCE(SUM(selected_count-changed_count),0) AS skipped FROM connection_rotation_batches WHERE rotation_id=?').bind(id).first<{batches:number;rotated:number;skipped:number}>();
 return {id:run.id,state:run.state,targetKey:run.target_key,revision:run.revision,current:current?.revision===run.revision,remaining:current?.revision===run.revision?remaining?.n??0:null,...totals};
}
/** Registry deletion stays forbidden until independent permitted-restore/custody
 * evidence exists (WH-117C). A zero live count alone is never retirement approval. */
export async function connectionKeyRetirementStatus(db:D1Database,id:string){
 assertMaintenanceDatabase(db);input(id);if(!await db.prepare('SELECT 1 FROM connection_key_registry WHERE id=?').bind(id).first())throw denied();
 const countSQL=stores.map(s=>`SELECT COUNT(*) AS n FROM ${s.table} WHERE substr(${s.cipher},1,length(?))=?`).join(' UNION ALL ');
 const rows=await db.prepare(`SELECT SUM(n) AS n FROM (${countSQL})`).bind(...remainingParams(id)).first<{n:number}>();
 const exchanges=await db.prepare('SELECT COUNT(*) AS n FROM connection_oauth_exchanges WHERE key_id=?').bind(id).first<{n:number}>();
 return {keyId:id,active:(await policy(db))?.active_key===id,liveReferences:rows?.n??0,unsettledExchanges:exchanges?.n??0,retirementAllowed:false,independentRestoreEvidence:'required' as const};
}
