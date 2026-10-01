import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['frontend/src/lib/chat-delivery.ts'],bundle:true,format:'esm',write:false});
const {submitChat}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const request={id:crypto.randomUUID(),revision:8,content:'Build my bakery website.'};
const saved={turns:[{id:request.id,user_text:request.content,action_json:null,revision:request.revision+1,status:'completed'}]};
let posts=0,reads=0;
const lost=new TypeError('Connection lost');
const post=async value=>{posts++;assert.deepEqual(value,request);throw lost;};
const read=async()=>{reads++;return saved;};
assert.equal(await submitChat(request,post,read),saved);
assert.equal(posts,1);assert.equal(reads,1);
// A persisted pending turn is sufficient proof of acceptance; polling owns completion.
saved.turns[0].status='pending';
assert.equal(await submitChat(request,post,read),saved);
// Foreign/mismatched results and unavailable reads cannot claim success.
await assert.rejects(submitChat(request,post,async()=>({turns:[{id:crypto.randomUUID(),user_text:request.content}]})),e=>e===lost);
await assert.rejects(submitChat(request,post,async()=>({turns:[{id:request.id,user_text:'Different message'}]})),e=>e===lost);
await assert.rejects(submitChat(request,post,async()=>{throw Error('Read unavailable')}),e=>e===lost);
// A later explicit retry carries the exact original identity and revision.
assert.equal(await submitChat(request,async value=>{assert.deepEqual(value,request);return saved;},read),saved);
for(const status of [400,401,403,409,402,429]){
  const denied=Object.assign(Error('Rejected'),{status});
  await assert.rejects(submitChat(request,async()=>{throw denied},async()=>{assert.fail('Definitive errors must not read/replay')}),e=>e===denied);
}
assert.equal(await submitChat(request,async()=>{throw Object.assign(Error('Gateway failed'),{status:502})},read),saved);
console.log('Chat delivery passed: lost-response readback, pending acceptance, identity/content isolation, unavailable reads, explicit same-ID retry and definitive error boundaries.');

const action={type:'confirm',kind:'site',reviewId:crypto.randomUUID()},approval={id:crypto.randomUUID(),revision:12,content:'Confirm the reviewed website change.',action};
const accepted={turns:[{id:approval.id,revision:13,user_text:approval.content,action_json:JSON.stringify(action)}]};
assert.equal(await submitChat(approval,async()=>{throw lost},async()=>accepted),accepted);
for(const change of [{action_json:null},{action_json:JSON.stringify({...action,reviewId:crypto.randomUUID()})},{revision:12},{action_json:undefined}]){
 await assert.rejects(submitChat(approval,async()=>{throw lost},async()=>({turns:[{...accepted.turns[0],...change}]})),e=>e===lost);
}
await assert.rejects(submitChat({...approval,action:undefined},async()=>{throw lost},async()=>accepted),e=>e===lost);
console.log('Typed action delivery requires exact saved action identity and revision, even when labels match; no text-only recovery.');
