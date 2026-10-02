import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {fixtureKeyring} from './helpers/connection-keyring.mjs';

// Actual current primitive/config readers, synthetic material only. No provider,
// storage rotation, secret file or operational restore is exercised here.
const built=await build({stdin:{contents:"export * from './src/connection-vault';export {githubConfig} from './src/github-connection';export {cloudflareConfig} from './src/cloudflare-connection';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const {seal,unseal,connectionKeyringMetadata,connectionCiphertextKeyId,githubConfig,cloudflareConfig,ConnectionVaultError}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const material='ab'.repeat(32),otherMaterial='cd'.repeat(32),secret=fixtureKeyring(material,'current'),otherKey=fixtureKeyring(otherMaterial,'current'),value='synthetic-provider-value';
let checks=0;
async function refuses(promise,code){await assert.rejects(promise,error=>{
 assert.ok(error instanceof ConnectionVaultError);assert.equal(error.status,503);if(code)assert.equal(error.code,code);
 for(const canary of [material,otherMaterial,value])assert.ok(!String(error).includes(canary));return true;
});checks++;}
for(const provider of ['github','cloudflare']){
 for(const purpose of ['token','pkce']){
  const context=`whumpo:${provider}:${purpose}:owner-a:record-a`;
  const ciphertext=await seal(secret,context,value);
  assert.equal(await unseal(secret,context,ciphertext),value);checks++;
  assert.notEqual(await seal(secret,context,value),ciphertext);checks++;
  assert.equal(connectionCiphertextKeyId(ciphertext),'current');checks++;
  assert.ok(!ciphertext.includes(value));checks++;
  for(const substitution of [
   `whumpo:${provider}:${purpose}:owner-b:record-a`,
   `whumpo:${provider}:${purpose}:owner-a:record-b`,
   `whumpo:${provider}:${purpose==='token'?'pkce':'token'}:owner-a:record-a`,
   `whumpo:${provider==='github'?'cloudflare':'github'}:${purpose}:owner-a:record-a`
  ])await refuses(unseal(secret,substitution,ciphertext),'authentication');
  await refuses(unseal(otherKey,context,ciphertext),'authentication');
  await refuses(unseal(fixtureKeyring(material,'absent'),context,ciphertext),'missing-key');
  // Even the same physical key under a renamed identifier cannot authenticate
  // a relabelled envelope; the key ID is part of the authentication data.
  const relabelled=ciphertext.replace('.current.','.renamed.');
  await refuses(unseal(fixtureKeyring(material,'renamed'),context,relabelled),'authentication');
  const parts=ciphertext.split('.');
  for(const index of [2,3]){
   const altered=[...parts],bytes=Buffer.from(altered[index],'base64url');bytes[0]^=1;altered[index]=bytes.toString('base64url');
   await refuses(unseal(secret,context,altered.join('.')),'authentication');
  }
  const badIV=[...parts];badIV[2]=Buffer.alloc(8).toString('base64url');
  for(const broken of [value,ciphertext.slice(0,-8),'v1.'+parts.slice(2).join('.'),'wv3.'+parts.slice(1).join('.'),ciphertext+'.extra',ciphertext+'=',badIV.join('.'),ciphertext+'\n','x'.repeat(11041)])await refuses(unseal(secret,context,broken));
  const next=fixtureKeyring(otherMaterial,'next',[{id:'current',secret:material}]);
  assert.equal(await unseal(next,context,ciphertext),value);checks++;
  const newest=await seal(next,context,value);assert.equal(connectionCiphertextKeyId(newest),'next');assert.equal(await unseal(next,context,newest),value);checks++;
  await refuses(unseal(secret,context,newest),'missing-key');
  // A copied database row does not supply the lost platform key, even after
  // account recovery. Only the exact retained key can authenticate this copy.
  const restored=structuredClone({owner:'owner-a',ciphertext});
  await refuses(unseal(otherKey,context,restored.ciphertext),'authentication');
  assert.equal(await unseal(secret,context,restored.ciphertext),value);checks++;
 }
}
const context='whumpo:github:token:owner-a:record-a';
for(const badContext of ['owner-a','whumpo:github:token:owner-a:record-a','whumpo:github:token:owner-a:record-a:extra','whumpo:github:other:owner-a:record-a','whumpo:github:token::record-a','whumpo:github:token:owner-a:'+('x'.repeat(129))])await refuses(seal(secret,badContext,value));
for(const badValue of ['',null,'x'.repeat(8193),'🌱'.repeat(2049),'\ud800'])await refuses(seal(secret,context,badValue));
for(const good of ['x'.repeat(8192),'🌱'.repeat(2048)]){assert.equal(await unseal(secret,context,await seal(secret,context,good)),good);checks++;}
const config=JSON.parse(secret),invalid=[
 '',material,'null','[]','{','x'.repeat(2049),
 {...config,version:1},{...config,extra:true},{...config,active:'absent'},
 {...config,active:7},{...config,active:'bad.id'},
 {...config,keys:[]},{...config,keys:[...config.keys,...config.keys]},
 {...config,keys:[...config.keys,{id:'other',secret:material}]},
 {...config,keys:[{id:'current',secret:material.toUpperCase()}]},
 {...config,keys:[{id:'current',secret:material.slice(2)}]},
 {...config,keys:[{id:'current',secret:material,extra:true}]},
 {...config,keys:[{id:'X'.repeat(33),secret:material}]},
 {...config,keys:Array.from({length:5},(_,i)=>({id:'key-'+i,secret:('0'+i).repeat(32)}))}
];
for(const bad of invalid){const raw=typeof bad==='string'?bad:JSON.stringify(bad);await refuses(seal(raw,context,value),'configuration');await refuses(unseal(raw,context,'unread'),'configuration');}
assert.deepEqual(connectionKeyringMetadata(secret),{version:2,active:'current',keyIds:['current']});checks++;
const env={GITHUB_CLIENT_ID:'fixture',GITHUB_CLIENT_SECRET:'synthetic',GITHUB_APP_ID:'1',GITHUB_APP_SLUG:'fixture',CLOUDFLARE_CLIENT_ID:'fixture',CLOUDFLARE_CLIENT_SECRET:'synthetic',CONNECTION_ENCRYPTION_KEYRING:secret};
assert.equal(githubConfig(env).key,secret);assert.equal(cloudflareConfig(env).key,secret);checks++;
for(const bad of [undefined,material,'invalid']){const e={...env,CONNECTION_ENCRYPTION_KEYRING:bad,CONNECTION_ENCRYPTION_KEY:material};assert.equal(githubConfig(e),undefined);assert.equal(cloudflareConfig(e),undefined);checks++;}
console.log(`Connection vault: ${checks} current-format, key-ID, configuration, isolation, byte-bound, tamper and missing-key cases passed. No rotation or operational restore claim.`);
