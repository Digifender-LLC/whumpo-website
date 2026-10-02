import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomBytes} from 'node:crypto';
import {build} from 'esbuild';
import {pathCheck,readPrivate,writePrivate,contains} from './operator-private-files.mjs';

// Operator-only current key backup. No HTTP route, provider client, Worker
// binding writer or database exporter. Errors never include inputs or paths.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const denied=()=>new Error('Connection key backup unavailable. Check the separate private files and recorded digest locally.');
const sha=value=>createHash('sha256').update(value).digest('hex');
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(k=>Object.hasOwn(value,k));
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(value);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const proofs=new WeakMap();
let vaultModule;
async function vault(){
 if(!vaultModule)vaultModule=(async()=>{
  const result=await build({absWorkingDir:root,entryPoints:['src/connection-vault.ts'],bundle:true,format:'esm',platform:'node',write:false});
  return import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].text).toString('base64'));
 })();
 return vaultModule;
}
async function separate(backupFile,recoveryKeyFile){
 await pathCheck(backupFile,{external:true,parent:true});await pathCheck(recoveryKeyFile,{external:true,parent:true});
 if(contains(dirname(backupFile),dirname(recoveryKeyFile))||contains(dirname(recoveryKeyFile),dirname(backupFile)))throw denied();
 if(!backupFile.endsWith('.whumpo-key-backup'))throw denied();
}
async function recoveryKey(path){
 const bytes=await readPrivate(path,65);
 try{const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(!/^[a-f0-9]{64}\n?$/.test(text))throw denied();return Buffer.from(text.trimEnd(),'hex');}
 finally{bytes.fill(0);}
}
function decode(value,size){
 if(typeof value!=='string'||!/^[A-Za-z0-9_-]+$/.test(value))throw denied();
 const bytes=Buffer.from(value,'base64url');if(bytes.toString('base64url')!==value||bytes.length!==size)throw denied();return bytes;
}
async function keyMetadata(keyring){
 const v=await vault(),meta=v.connectionKeyringMetadata(keyring),fingerprints=await v.connectionKeyFingerprints(keyring);
 return {keyringVersion:meta.version,activeKey:meta.active,keys:fingerprints.sort((a,b)=>a.id.localeCompare(b.id))};
}
function headerCheck(h){
 if(!exact(h,['version','scope','environment','backupId','createdAt','keyringVersion','activeKey','keys'])||h.version!==1||h.scope!=='connection-key-backup'||h.environment!=='test'||!id(h.backupId)||!Number.isSafeInteger(h.createdAt)||h.createdAt<1||h.keyringVersion!==2||typeof h.activeKey!=='string'||!Array.isArray(h.keys)||!h.keys.length||h.keys.length>4)throw denied();
 const seen=new Set();for(const k of h.keys){if(!exact(k,['id','fingerprint'])||typeof k.id!=='string'||!/^[a-z][a-z0-9-]{0,31}$/.test(k.id)||!hash(k.fingerprint)||seen.has(k.id))throw denied();seen.add(k.id);}
 if(!seen.has(h.activeKey))throw denied();
}
function aad(header){return Buffer.from(JSON.stringify(['whumpo-connection-key-backup',header]));}
async function unlock({backupFile,recoveryKeyFile,expectedDigest}){
 if(!hash(expectedDigest))throw denied();await separate(backupFile,recoveryKeyFile);
 const bytes=await readPrivate(backupFile,8192);if(sha(bytes)!==expectedDigest)throw denied();
 const envelope=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
 if(!exact(envelope,['header','iv','ciphertext']))throw denied();headerCheck(envelope.header);
 if(typeof envelope.ciphertext!=='string'||envelope.ciphertext.length>3000)throw denied();
 const iv=decode(envelope.iv,12),encrypted=Buffer.from(envelope.ciphertext,'base64url');
 if(encrypted.length<17||encrypted.length>2064||encrypted.toString('base64url')!==envelope.ciphertext)throw denied();
 const wrapping=await recoveryKey(recoveryKeyFile);let plaintext;
 try{
  const key=await crypto.subtle.importKey('raw',wrapping,'AES-GCM',false,['decrypt']);
  plaintext=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:aad(envelope.header),tagLength:128},key,encrypted));
  const keyring=new TextDecoder('utf-8',{fatal:true}).decode(plaintext),metadata=await keyMetadata(keyring);
  if(!same(metadata,{keyringVersion:envelope.header.keyringVersion,activeKey:envelope.header.activeKey,keys:envelope.header.keys}))throw denied();
  if(JSON.parse(keyring).keys.some(k=>k.secret===wrapping.toString('hex')))throw denied();
  return {keyring,header:envelope.header};
 }finally{wrapping.fill(0);plaintext?.fill(0);}
}
function report(header,digest){return {version:1,scope:'encrypted-key-backup-readback',backupId:header.backupId,sha256:digest,createdAt:header.createdAt,activeKey:header.activeKey,keyIds:Object.freeze(header.keys.map(k=>k.id)),readbackVerified:true,independentCustodyAccepted:false,retirementAllowed:false};}

/** New random recovery material goes directly into a private operator file;
 * there is no stdout/argument/environment-variable form for key material. */
export async function createConnectionRecoveryKey({recoveryKeyFile}){
 try{const material=randomBytes(32);try{await writePrivate(recoveryKeyFile,material.toString('hex')+'\n');}finally{material.fill(0);}return {version:1,scope:'operator-recovery-key',created:true,independentCustodyAccepted:false};}
 catch{throw denied();}
}
export async function createConnectionKeyBackup({keyringFile,recoveryKeyFile,backupFile,backupId,now=Date.now}){
 let input,wrapping;
 try{
  if(!id(backupId))throw denied();await separate(backupFile,recoveryKeyFile);
  if(keyringFile===recoveryKeyFile||keyringFile===backupFile)throw denied();
  input=await readPrivate(keyringFile,2048);const keyring=new TextDecoder('utf-8',{fatal:true}).decode(input),metadata=await keyMetadata(keyring);
  wrapping=await recoveryKey(recoveryKeyFile);
  if(JSON.parse(keyring).keys.some(k=>k.secret===wrapping.toString('hex')))throw denied();
  const header={version:1,scope:'connection-key-backup',environment:'test',backupId,createdAt:now(),...metadata};headerCheck(header);
  const iv=randomBytes(12),key=await crypto.subtle.importKey('raw',wrapping,'AES-GCM',false,['encrypt']);
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(header),tagLength:128},key,input);
  const bytes=Buffer.from(JSON.stringify({header,iv:iv.toString('base64url'),ciphertext:Buffer.from(encrypted).toString('base64url')})+'\n');
  await writePrivate(backupFile,bytes);
  return await verifyConnectionKeyBackup({backupFile,recoveryKeyFile,expectedDigest:sha(bytes)});
 }catch{throw denied();}
 finally{input?.fill(0);wrapping?.fill(0);}
}
/** A fresh process must supply the independently recorded ciphertext digest.
 * Success proves decryption of these stored bytes, not offsite custody or service
 * restore admission. The process-local capability cannot be replaced with JSON. */
export async function verifyConnectionKeyBackup(input){
 try{
  if(!exact(input,['backupFile','recoveryKeyFile','expectedDigest']))throw denied();
  const {header}=await unlock(input),result=Object.freeze(report(header,input.expectedDigest));
  proofs.set(result,{backupFile:input.backupFile,recoveryKeyFile:input.recoveryKeyFile,expectedDigest:input.expectedDigest,header});return result;
 }
 catch{throw denied();}
}
/** Only trusted operator consumers receive material, in memory. The capsule and
 * recovery file are re-read each time; no plaintext temp file or cached secret. */
export async function withRecoveredConnectionKeys(proof,consume){
 try{
  const input=proofs.get(proof);if(!input||typeof consume!=='function')throw denied();
  const {keyring,header}=await unlock(input);if(!same(input.header,header))throw denied();
  return await consume(keyring);
 }catch{throw denied();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const [operation,...args]=process.argv.slice(2),options=Object.create(null);
  const fields={init:['recoveryKeyFile'],create:['keyringFile','recoveryKeyFile','backupFile','backupId'],verify:['backupFile','recoveryKeyFile','expectedDigest']};
  if(!Object.hasOwn(fields,operation)||args.length!==fields[operation].length*2)throw denied();
  for(let i=0;i<args.length;i+=2){const name=args[i].replace(/^--/,'').replace(/-([a-z])/g,(_m,c)=>c.toUpperCase());if(!args[i].startsWith('--')||!fields[operation].includes(name)||Object.hasOwn(options,name))throw denied();options[name]=args[i+1];}
  const run={init:createConnectionRecoveryKey,create:createConnectionKeyBackup,verify:verifyConnectionKeyBackup};
  console.log(JSON.stringify(await run[operation](options),null,2));
 }catch{console.error(denied().message);process.exitCode=1;}
}
