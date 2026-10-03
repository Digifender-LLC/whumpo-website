import {connectionKeyringMetadata,connectionKeyFingerprints,ConnectionVaultError,seal} from './connection-vault';

/** Check material as well as ID; the immutable registry prevents ID rebinding.
 * SQL independently fences the ID at commit, including after this read. */
export async function connectionWriteKey(db:D1Database,secret:string){
 const metadata=connectionKeyringMetadata(secret),keys=await connectionKeyFingerprints(secret),active=keys.find(k=>k.id===metadata.active)!;
 const row=await db.prepare('SELECT p.active_key,p.revision FROM connection_key_policy p JOIN connection_key_registry k ON k.id=p.active_key WHERE p.singleton=1 AND k.id=? AND k.fingerprint=?').bind(active.id,active.fingerprint).first<{active_key:string;revision:number}>();
 if(!row)throw new ConnectionVaultError('write-key');
 return row;
}
export async function sealConnectionWrite(db:D1Database,secret:string,context:string,value:string){
 await connectionWriteKey(db,secret);return seal(secret,context,value);
}
