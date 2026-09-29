const encoder=new TextEncoder();
function bytes(value:string){return Uint8Array.from(atob(value),c=>c.charCodeAt(0));}
function base64(value:Uint8Array){return btoa(Array.from(value,b=>String.fromCharCode(b)).join(''));}
async function key(secret:string){if(!/^[0-9a-f]{64}$/.test(secret))throw Error('Invalid connection encryption key');return crypto.subtle.importKey('raw',Uint8Array.from(secret.match(/../g)!,b=>parseInt(b,16)),{name:'AES-GCM'},false,['encrypt','decrypt']);}
/** Authentication data prevents copying a ciphertext across users, providers or purposes. */
export async function seal(secret:string,context:string,value:string){
 if(value.length>8192)throw Error('Connection value too large');const iv=crypto.getRandomValues(new Uint8Array(12));
 const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:encoder.encode(context)},await key(secret),encoder.encode(value));
 return 'v1.'+base64(iv)+'.'+base64(new Uint8Array(encrypted));
}
export async function unseal(secret:string,context:string,value:string){
 const parts=value.split('.');if(parts.length!==3||parts[0]!=='v1'||value.length>12000)throw Error('Invalid connection ciphertext');
 return new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes(parts[1]),additionalData:encoder.encode(context)},await key(secret),bytes(parts[2])));
}
