import assert from 'node:assert/strict';
import {build} from 'esbuild';

// Actual current primitive, synthetic material only. This does not exercise a
// provider, storage rotation, key custody or operational restore acceptance.
const built=await build({entryPoints:['src/connection-vault.ts'],bundle:true,platform:'node',format:'esm',write:false});
const {seal,unseal}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const secret='ab'.repeat(32),otherKey='cd'.repeat(32),value='synthetic-provider-value';
let checks=0;
for(const provider of ['github','cloudflare']){
 for(const purpose of ['token','pkce']){
  const context=`whumpo:${provider}:${purpose}:owner-a:record-a`;
  const ciphertext=await seal(secret,context,value);
  assert.equal(await unseal(secret,context,ciphertext),value);checks++;
  assert.notEqual(await seal(secret,context,value),ciphertext);checks++;
  assert.ok(!ciphertext.includes(value));checks++;
  for(const contextSubstitution of [
   `whumpo:${provider}:${purpose}:owner-b:record-a`,
   `whumpo:${provider}:${purpose}:owner-a:record-b`,
   `whumpo:${provider}:other-purpose:owner-a:record-a`,
   `whumpo:other-provider:${purpose}:owner-a:record-a`
  ]){await assert.rejects(unseal(secret,contextSubstitution,ciphertext));checks++;}
  for(const unavailableKey of [otherKey,'',secret.slice(2)]){await assert.rejects(unseal(unavailableKey,context,ciphertext));checks++;}
  const parts=ciphertext.split('.');
  for(const index of [1,2]){
   const altered=[...parts],bytes=Buffer.from(altered[index],'base64');bytes[0]^=1;altered[index]=bytes.toString('base64');
   await assert.rejects(unseal(secret,context,altered.join('.')));checks++;
  }
  for(const broken of [value,ciphertext.slice(0,-8),'unknown.'+parts.slice(1).join('.'),ciphertext+'.extra']){
   await assert.rejects(unseal(secret,context,broken));checks++;
  }
  // A data-only copy cannot compensate for a lost Worker key. A recovered
  // identity cannot decrypt this copied token using a newly generated key.
  const restored=structuredClone({owner:'owner-a',ciphertext});
  await assert.rejects(unseal(otherKey,context,restored.ciphertext));checks++;
  assert.equal(await unseal(secret,context,restored.ciphertext),value);checks++;
 }
}
await assert.rejects(seal(secret,'test','x'.repeat(8193)));checks++;
console.log(`Connection vault: ${checks} synthetic current AES-GCM isolation/corruption/key-loss checks passed; no rotation or operational restore claim.`);
