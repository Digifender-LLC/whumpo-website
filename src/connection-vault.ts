const encoder=new TextEncoder();
export const CONNECTION_VAULT_FORMAT='wv2';
const keyId=/^[a-z][a-z0-9-]{0,31}$/;
const contextPattern=/^whumpo:(?:(?:github|cloudflare):(?:token|pkce)|github:refresh):[A-Za-z0-9_-]{1,128}:[A-Za-z0-9_-]{1,128}$/;
const maxBytes=8192;
type Keyring={version:2;active:string;keys:{id:string;secret:string}[]};
export class ConnectionVaultError extends Error{
 readonly status=503;
 constructor(readonly code:'configuration'|'ciphertext'|'missing-key'|'authentication'|'write-key'){
  super('Saved connection access is unavailable. Platform recovery is required.');
 }
}
function exact(value:unknown,names:string[]):value is Record<string,unknown>{
 return !!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
}
function keyring(secret:unknown):Keyring{
 try{
  if(typeof secret!=='string'||secret.length>2048)throw Error();
  const value:unknown=JSON.parse(secret);
  if(!exact(value,['version','active','keys'])||value.version!==2||typeof value.active!=='string'||!keyId.test(value.active)||!Array.isArray(value.keys)||value.keys.length<1||value.keys.length>4)throw Error();
  const ids=new Set(),materials=new Set();
  for(const entry of value.keys){
   if(!exact(entry,['id','secret'])||typeof entry.id!=='string'||!keyId.test(entry.id)||typeof entry.secret!=='string'||!/^[0-9a-f]{64}$/.test(entry.secret)||ids.has(entry.id)||materials.has(entry.secret))throw Error();
   ids.add(entry.id);materials.add(entry.secret);
  }
  if(!ids.has(value.active))throw Error();
  return value as Keyring;
 }catch{throw new ConnectionVaultError('configuration');}
}
/** Metadata only. Never return key material in status, diagnostics or exports. */
export function connectionKeyringMetadata(secret:unknown){
 const ring=keyring(secret);return {version:ring.version,active:ring.active,keyIds:ring.keys.map(k=>k.id)};
}
/** Internal identity commitment, never raw key material. Registration is operator-only. */
export async function connectionKeyFingerprints(secret:unknown){
 const ring=keyring(secret);
 return Promise.all(ring.keys.map(async entry=>({id:entry.id,fingerprint:Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode('whumpo:connection-key:'+entry.secret))),b=>b.toString(16).padStart(2,'0')).join('')})));
}
function base64(value:Uint8Array){return btoa(Array.from(value,b=>String.fromCharCode(b)).join('')).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');}
function bytes(value:string){
 if(!/^[A-Za-z0-9_-]+$/.test(value))throw new ConnectionVaultError('ciphertext');
 try{
  const decoded=Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
  if(base64(decoded)!==value)throw Error();return decoded;
 }catch{throw new ConnectionVaultError('ciphertext');}
}
function envelope(value:unknown){
 if(typeof value!=='string'||value.length>11040)throw new ConnectionVaultError('ciphertext');
 const parts=value.split('.');
 if(parts.length!==4||parts[0]!==CONNECTION_VAULT_FORMAT||!keyId.test(parts[1]))throw new ConnectionVaultError('ciphertext');
 const iv=bytes(parts[2]),encrypted=bytes(parts[3]);
 if(iv.length!==12||encrypted.length<17||encrypted.length>maxBytes+16)throw new ConnectionVaultError('ciphertext');
 return {id:parts[1],iv,encrypted};
}
/** Does not authenticate content or confer decryption/rotation authority. */
export function connectionCiphertextKeyId(value:unknown){return envelope(value).id;}
function additionalData(id:string,context:string){
 if(typeof context!=='string'||!contextPattern.test(context))throw new ConnectionVaultError('ciphertext');
 return encoder.encode(JSON.stringify(['whumpo-connection',CONNECTION_VAULT_FORMAT,id,context]));
}
async function key(secret:string){
 return crypto.subtle.importKey('raw',Uint8Array.from(secret.match(/../g)!,b=>parseInt(b,16)),{name:'AES-GCM'},false,['encrypt','decrypt']);
}
/** Every write uses the explicit active key. Storage fencing is a separate required control. */
export async function seal(secret:string,context:string,value:string){
 const ring=keyring(secret),entry=ring.keys.find(k=>k.id===ring.active)!;
 if(typeof value!=='string')throw new ConnectionVaultError('ciphertext');
 const plaintext=encoder.encode(value);
 if(!plaintext.length||plaintext.length>maxBytes||new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(plaintext)!==value)throw new ConnectionVaultError('ciphertext');
 const iv=crypto.getRandomValues(new Uint8Array(12)),aad=additionalData(entry.id,context);
 try{
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad,tagLength:128},await key(entry.secret),plaintext);
  return [CONNECTION_VAULT_FORMAT,entry.id,base64(iv),base64(new Uint8Array(encrypted))].join('.');
 }catch{throw new ConnectionVaultError('authentication');}
}
/** Exact key lookup only; the identifier itself is authenticated. */
export async function unseal(secret:string,context:string,value:string){
 const ring=keyring(secret),record=envelope(value),entry=ring.keys.find(k=>k.id===record.id);
 if(!entry)throw new ConnectionVaultError('missing-key');
 const aad=additionalData(record.id,context);
 try{
  const decrypted=await crypto.subtle.decrypt({name:'AES-GCM',iv:record.iv,additionalData:aad,tagLength:128},await key(entry.secret),record.encrypted);
  return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(decrypted);
 }catch{throw new ConnectionVaultError('authentication');}
}
