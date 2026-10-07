import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({stdin:{contents:"export * from './src/connector-receipts';export * from './src/connector-review-shape';export {chatControl} from './src/chat-controls';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const id='00000000-0000-4000-8000-000000000001',input={id,owner:'owner-a',credentialId:'credential-a',destination:{repository:'test/source'},request:{bodyDigest:'a'.repeat(64),version:id},expiresAt:'2099-01-01T00:00:00Z'};
let checks=0;
for(const [provider,operation,initial,applied] of [['github','backup.commit','pending','complete'],['cloudflare','dnsRecord.create','review','applied']]){
 const saved=await m.prepareConnectorContract(provider,operation,input),view=m.connectorReceipt(provider,operation,saved,initial,input.expiresAt,null),approval={reviewDigest:view.reviewDigest,acceptedPrice:view.price};
 assert.equal(view.state,'review');assert.equal(view.authority,'owner-request');assert.deepEqual(view.price,{customerUnits:0,basis:'plan-inclusion'});await m.assertConnectorConfirmation(provider,operation,saved,approval);checks++;
 for(const field of ['id','owner','credentialId','destination','request','expiresAt']){
  const changed={...input,[field]:['destination','request'].includes(field)?{changed:true}:input[field]+'-changed'};
  assert.notEqual((await m.prepareConnectorContract(provider,operation,changed)).review_digest,saved.review_digest);checks++;
 }
 for(const invalid of [undefined,{}, {...approval,reviewDigest:'0'.repeat(64)}, {...approval,acceptedPrice:{customerUnits:1,basis:'quoted'}}, {...approval,acceptedPrice:{customerUnits:0,basis:'plan-inclusion',extra:true}}, {...approval,extra:true}]){assert.equal(m.isConnectorConfirmation(invalid),invalid?.reviewDigest==='0'.repeat(64));await assert.rejects(()=>m.assertConnectorConfirmation(provider,operation,saved,invalid),{status:409});checks++;}
 for(const field of ['operation_digest','review_digest','price_json']){await assert.rejects(()=>m.assertConnectorConfirmation(provider,operation,{...saved,[field]:field==='price_json'?'{}':'0'.repeat(64)},approval),{status:409});checks++;}
 assert.equal(m.connectorReceipt(provider,operation,saved,initial,'2000-01-01',null).state,'expired');assert.equal(m.connectorReceipt(provider,operation,saved,applied,input.expiresAt,'result').state,'applied');checks+=2;
}
const saved=await m.prepareConnectorContract('github','backup.commit',input),confirmation={reviewDigest:saved.review_digest,acceptedPrice:JSON.parse(saved.price_json)},action={type:'confirm',kind:'backup',reviewId:id,...confirmation};
assert.ok(m.chatControl(action));assert.match(m.chatControl(action).command,/0 plan-inclusion$/);assert.equal(m.chatControl({type:'confirm',kind:'backup',reviewId:id}),undefined);assert.equal(m.chatControl({...action,acceptedPrice:{customerUnits:1,basis:'quoted'}}),undefined);checks+=4;
console.log(`Connector receipts: ${checks} exact digest/price, stale review, common state and Chat control checks passed.`);
