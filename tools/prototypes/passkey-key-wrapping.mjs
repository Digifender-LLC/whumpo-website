// WH-118 synthetic feasibility prototype: passkey-PRF content-key wrapping.
// NOT production encryption and NOT evidence that any browser, device or passkey
// provider supports WebAuthn PRF. Node builtins/WebCrypto only; no Worker,
// storage, network, provider or schema import. See docs/passkey-encryption-feasibility.md.
//
// Model: a random content key (CK) encrypts selected private content on the
// client. Each authorized passkey wraps CK under a key derived (HKDF-SHA-256)
// from that credential's client-only PRF output; a separate client-generated
// content recovery key wraps CK too. The server stores only opaque wrapped
// blobs, public salts/IVs and a key commitment. PRF outputs, CK, wrapping keys
// and the content recovery key never enter the authentication payload or the
// server-held record. Account recovery (WH-115 kit) cannot unlock content.
const subtle=globalThis.crypto.subtle;
const encoder=new TextEncoder();
export const contractVersion=1;
// Login is usernameless (no allowCredentials), so `evalByCredential` is not
// available there; one RP-wide PRF input is evaluated by whichever credential
// the user selects. Per-credential uniqueness comes from the PRF itself.
export const unlockPrfLabel='whumpo/passkey-content-unlock/v1';
const labels={credential:'whumpo:passkey-content-kek:v1',recovery:'whumpo:content-recovery-kek:v1',commitment:'whumpo:content-key-commitment:v1'};
export class PasskeyWrapError extends Error{constructor(code){super(code);this.name='PasskeyWrapError';this.code=code;}}
const fail=code=>{throw new PasskeyWrapError(code);};
const check=(ok,code='invalid_keyset')=>{if(!ok)fail(code);};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const shape=(v,keys,code='invalid_keyset')=>{check(plain(v),code);check(Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k)),code);};
const idPattern=/^[A-Za-z0-9_-]{1,128}$/;
const id=v=>check(typeof v==='string'&&idPattern.test(v),'invalid_identifier');
export const b64u=bytes=>Buffer.from(bytes).toString('base64url');
export function fromB64u(value,length,code='invalid_keyset'){
 check(typeof value==='string'&&/^[A-Za-z0-9_-]*$/.test(value),code);
 const bytes=new Uint8Array(Buffer.from(value,'base64url'));
 check(b64u(bytes)===value&&(length===undefined||bytes.length===length),code);
 return bytes;
}
const bytes32=(v,code)=>check(v instanceof Uint8Array&&v.length===32,code);
export const randomBytes=n=>globalThis.crypto.getRandomValues(new Uint8Array(n));
export async function sha256(data){return new Uint8Array(await subtle.digest('SHA-256',typeof data==='string'?encoder.encode(data):data));}
export const unlockPrfInput=()=>sha256(unlockPrfLabel);
const equalBytes=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);

// Every internal call goes through `p` so a test can replace exactly one member
// (a mutant) and observe which named check kills it.
export function createProtocol(){
 const p={
  newContentKey(_context){return randomBytes(32);},
  newRecoveryKey(){return randomBytes(32);},
  newIv(){return randomBytes(12);},
  newSalt(){return randomBytes(32);},
  wrapAad({accountId,keysetId,generation,credentialId}){
   return encoder.encode(JSON.stringify(['wrap',contractVersion,accountId,keysetId,generation,credentialId]));
  },
  recoveryAad({accountId,keysetId,generation}){
   return encoder.encode(JSON.stringify(['recovery',contractVersion,accountId,keysetId,generation]));
  },
  contentAad({accountId,keysetId,generation,objectId}){
   return encoder.encode(JSON.stringify(['content',contractVersion,accountId,keysetId,generation,objectId]));
  },
  async deriveWrappingKey(secret,salt,label){
   bytes32(secret,'invalid_secret');
   const base=await subtle.importKey('raw',secret,'HKDF',false,['deriveKey']);
   return subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt,info:encoder.encode(label)},base,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  },
  async wrapEntry(contentKey,secret,label,aad){
   const hkdfSalt=p.newSalt(),iv=p.newIv(),kek=await p.deriveWrappingKey(secret,hkdfSalt,label);
   const wrapped=new Uint8Array(await subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},kek,contentKey));
   return {hkdfSalt:b64u(hkdfSalt),iv:b64u(iv),wrappedKey:b64u(wrapped)};
  },
  async unwrapEntry(entry,secret,label,aad){
   const kek=await p.deriveWrappingKey(secret,fromB64u(entry.hkdfSalt,32),label);
   try{return new Uint8Array(await subtle.decrypt({name:'AES-GCM',iv:fromB64u(entry.iv,12),additionalData:aad},kek,fromB64u(entry.wrappedKey,48)));}
   catch{fail('unwrap_failed');}
  },
  async commitment(contentKey,{accountId,keysetId,generation}){
   const base=await subtle.importKey('raw',contentKey,'HKDF',false,['deriveKey']);
   const mac=await subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:new Uint8Array(32),info:encoder.encode(labels.commitment)},base,{name:'HMAC',hash:'SHA-256',length:256},false,['sign']);
   return b64u(new Uint8Array(await subtle.sign('HMAC',mac,encoder.encode(JSON.stringify(['commit',contractVersion,accountId,keysetId,generation])))));
  },
  async assertContentKey(record,contentKey){
   bytes32(contentKey,'invalid_content_key');
   check(await p.commitment(contentKey,record)===record.commitment,'content_key_mismatch');
   return contentKey;
  },
  validateRecord(r,{minGeneration=1}={}){
   shape(r,['version','accountId','keysetId','generation','commitment','credentials','pending','recovery']);
   check(r.version===contractVersion,'unsupported_keyset_version');
   id(r.accountId);id(r.keysetId);
   check(Number.isSafeInteger(r.generation)&&r.generation>=1,'invalid_keyset');
   check(r.generation>=minGeneration,'stale_keyset');
   fromB64u(r.commitment,32);
   check(Array.isArray(r.credentials)&&r.credentials.length<=16&&Array.isArray(r.pending)&&r.pending.length<=16);
   const seen=new Set();
   for(const e of r.credentials){
    shape(e,['credentialId','hkdfSalt','iv','wrappedKey']);id(e.credentialId);
    fromB64u(e.hkdfSalt,32);fromB64u(e.iv,12);fromB64u(e.wrappedKey,48);
    check(!seen.has(e.credentialId),'duplicate_credential');seen.add(e.credentialId);
   }
   for(const c of r.pending){id(c);check(!seen.has(c),'duplicate_credential');seen.add(c);}
   if(r.recovery!==null){shape(r.recovery,['hkdfSalt','iv','wrappedKey']);fromB64u(r.recovery.hkdfSalt,32);fromB64u(r.recovery.iv,12);fromB64u(r.recovery.wrappedKey,48);}
   return r;
  },

  // ---- Authentication boundary -------------------------------------------
  // Client-only: read the PRF output from an assertion/registration result.
  // Accepts PublicKeyCredential.toJSON()-style base64url strings and live
  // ArrayBuffer/typed-array values. Missing PRF never falls back to anything.
  prfOutputFromCredential(credential){
   const results=credential?.clientExtensionResults?.prf?.results,first=results?.first;
   let out;
   if(typeof first==='string')out=fromB64u(first,undefined,'prf_unavailable');
   else if(first instanceof ArrayBuffer)out=new Uint8Array(first.slice(0));
   else if(ArrayBuffer.isView(first))out=new Uint8Array(first.buffer.slice(first.byteOffset,first.byteOffset+first.byteLength));
   else fail('prf_unavailable');
   check(out.length===32,'prf_unavailable');
   return out;
  },
  // Client: build the exact object sent for server verification. Allowlist the
  // WebAuthn fields; client extension results are dropped entirely because
  // toJSON() includes PRF `results` (W3C WebAuthn L3, prf extension note).
  serverAuthenticationPayload(credential){
   const r=credential.response,out={id:credential.id,rawId:credential.rawId,type:credential.type,response:{clientDataJSON:r.clientDataJSON,authenticatorData:r.authenticatorData,signature:r.signature},clientExtensionResults:{}};
   if(r.userHandle!==undefined)out.response.userHandle=r.userHandle;
   if(credential.authenticatorAttachment!==undefined)out.authenticatorAttachment=credential.authenticatorAttachment;
   return out;
  },
  // Server: defense in depth. Reject any payload that carries PRF material or
  // unknown fields rather than silently ignoring it.
  validateServerAuthenticationPayload(payload){
   check(plain(payload),'invalid_authentication_payload');
   const allowed=['id','rawId','type','response','clientExtensionResults','authenticatorAttachment'];
   check(Object.keys(payload).every(k=>allowed.includes(k)),'invalid_authentication_payload');
   const ext=payload.clientExtensionResults;
   check(ext===undefined||plain(ext),'invalid_authentication_payload');
   check(!ext||!Object.hasOwn(ext,'prf'),'client_secret_in_payload');
   check(plain(payload.response)&&Object.keys(payload.response).every(k=>['clientDataJSON','authenticatorData','signature','userHandle'].includes(k)),'invalid_authentication_payload');
   return payload;
  },

  // ---- Keyset lifecycle (client side; server stores the returned record) ----
  async createKeyset({accountId,keysetId,credentialId,prfOutput}){
   id(accountId);id(keysetId);id(credentialId);bytes32(prfOutput,'prf_unavailable');
   const generation=1,contentKey=p.newContentKey({accountId,keysetId}),recoveryKey=p.newRecoveryKey(),ctx={accountId,keysetId,generation};
   const record={version:contractVersion,accountId,keysetId,generation,commitment:await p.commitment(contentKey,ctx),
    credentials:[{credentialId,...await p.wrapEntry(contentKey,prfOutput,labels.credential,p.wrapAad({...ctx,credentialId}))}],pending:[],
    recovery:await p.wrapEntry(contentKey,recoveryKey,labels.recovery,p.recoveryAad(ctx))};
   return {record:p.validateRecord(record),contentKey,recoveryKey};
  },
  async unlock(record,{credentialId,prfOutput},options){
   p.validateRecord(record,options);id(credentialId);bytes32(prfOutput,'prf_unavailable');
   const entry=record.credentials.find(e=>e.credentialId===credentialId);
   if(!entry)fail(record.pending.includes(credentialId)?'rewrap_required':'credential_not_authorized');
   return p.assertContentKey(record,await p.unwrapEntry(entry,prfOutput,labels.credential,p.wrapAad({...record,credentialId})));
  },
  async unlockWithRecoveryKey(record,recoveryKey,options){
   p.validateRecord(record,options);bytes32(recoveryKey,'invalid_recovery_key');
   if(record.recovery===null)fail('content_unrecoverable');
   return p.assertContentKey(record,await p.unwrapEntry(record.recovery,recoveryKey,labels.recovery,p.recoveryAad(record)));
  },
  // Second-key enrollment needs an already-unlocked CK on this client plus the
  // new credential's PRF output. Same CK; generation unchanged.
  async enrollCredential(record,contentKey,{credentialId,prfOutput}){
   p.validateRecord(record);id(credentialId);bytes32(prfOutput,'prf_unavailable');await p.assertContentKey(record,contentKey);
   check(!record.credentials.some(e=>e.credentialId===credentialId),'duplicate_credential');
   const entry={credentialId,...await p.wrapEntry(contentKey,prfOutput,labels.credential,p.wrapAad({...record,credentialId}))};
   return p.validateRecord({...record,credentials:[...record.credentials,entry],pending:record.pending.filter(c=>c!==credentialId)});
  },
  // Removes future access through the current record only. A revoked holder who
  // already unlocked CK, or retains an older record copy, still has CK: rotate.
  revokeCredential(record,credentialId){
   p.validateRecord(record);id(credentialId);
   return p.validateRecord({...record,credentials:record.credentials.filter(e=>e.credentialId!==credentialId),pending:record.pending.filter(c=>c!==credentialId)});
  },
  // New CK and generation. Symmetric wrapping needs a fresh PRF output from each
  // credential that should keep access; absent ones become `pending` and must be
  // re-enrolled from an unlocked client. Without the current content recovery
  // key, a new one is issued and must be saved again.
  async rotate(record,contentKey,{present,keepCredentialIds,existingRecoveryKey}){
   p.validateRecord(record);await p.assertContentKey(record,contentKey);
   const keep=new Set(keepCredentialIds);
   for(const c of present)check(keep.has(c.credentialId),'credential_not_authorized');
   for(const c of keep)check(record.credentials.some(e=>e.credentialId===c)||record.pending.includes(c),'credential_not_authorized');
   let recoveryKey=p.newRecoveryKey(),reissued=true;
   if(existingRecoveryKey!==undefined){await p.unlockWithRecoveryKey(record,existingRecoveryKey);recoveryKey=existingRecoveryKey;reissued=false;}
   const generation=record.generation+1,ctx={accountId:record.accountId,keysetId:record.keysetId,generation};
   const newKey=p.newContentKey(ctx),credentials=[];
   for(const c of present){bytes32(c.prfOutput,'prf_unavailable');credentials.push({credentialId:c.credentialId,...await p.wrapEntry(newKey,c.prfOutput,labels.credential,p.wrapAad({...ctx,credentialId:c.credentialId}))});}
   const presentIds=new Set(present.map(c=>c.credentialId));
   const next={version:contractVersion,...ctx,commitment:await p.commitment(newKey,ctx),credentials,pending:[...keep].filter(c=>!presentIds.has(c)),
    recovery:await p.wrapEntry(newKey,recoveryKey,labels.recovery,p.recoveryAad(ctx))};
   return {record:p.validateRecord(next),contentKey:newKey,recoveryKey,recoveryKeyReissued:reissued};
  },

  // ---- Content ---------------------------------------------------------------
  async contentCipherKey(contentKey,usage){return subtle.importKey('raw',contentKey,'AES-GCM',false,[usage]);},
  async encryptContent(record,contentKey,objectId,plaintext){
   p.validateRecord(record);await p.assertContentKey(record,contentKey);id(objectId);
   const iv=p.newIv(),aad=p.contentAad({...record,objectId});
   const ciphertext=new Uint8Array(await subtle.encrypt({name:'AES-GCM',iv,additionalData:aad},await p.contentCipherKey(contentKey,'encrypt'),plaintext));
   return {version:contractVersion,accountId:record.accountId,keysetId:record.keysetId,generation:record.generation,objectId,iv:b64u(iv),ciphertext:b64u(ciphertext)};
  },
  async decryptContent(record,contentKey,object){
   p.validateRecord(record);
   shape(object,['version','accountId','keysetId','generation','objectId','iv','ciphertext'],'invalid_content');
   check(object.version===contractVersion,'unsupported_content_version');
   check(object.accountId===record.accountId&&object.keysetId===record.keysetId,'keyset_mismatch');
   check(object.generation===record.generation,'generation_mismatch');
   await p.assertContentKey(record,contentKey);id(object.objectId);
   try{return new Uint8Array(await subtle.decrypt({name:'AES-GCM',iv:fromB64u(object.iv,12,'invalid_content'),additionalData:p.contentAad({...record,objectId:object.objectId})},await p.contentCipherKey(contentKey,'decrypt'),fromB64u(object.ciphertext,undefined,'invalid_content')));}
   catch(error){if(error instanceof PasskeyWrapError)throw error;fail('decrypt_failed');}
  },
 };
 return p;
}
export {labels as wrappingLabels,equalBytes};
