import assert from 'node:assert/strict';
import {build} from 'esbuild';
const {outputFiles}=await build({stdin:{contents:"export * from './frontend/src/lib/interaction-recovery';export * from './frontend/src/lib/interaction-delivery';export {jsonDigest} from './src/project-specification/v2/json';export {clearChatRecovery} from './frontend/src/lib/chat-recovery';export {useChatRecovery} from './frontend/src/use-chat-recovery';export {renderToStaticMarkup} from 'react-dom/server';export {createElement} from 'react';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',banner:{js:"import {createRequire as moduleRequire} from 'node:module';const require=moduleRequire(process.cwd()+'/package.json');"},write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
const owner=crypto.randomUUID(),other=crypto.randomUUID(),id=crypto.randomUUID(),now=Date.now(),values=new Map();
const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
const request={version:1,requestId:crypto.randomUUID(),interactionId:id,definitionDigest:'a'.repeat(64),expectedAnswerRevision:3,operation:'submit',answers:{'field-1':'Garden care'}};
const record={definitionDigest:request.definitionDigest,answerRevision:3,answers:request.answers,updatedAt:now,dismissed:true,pending:request};
m.writeFormRecovery(storage,owner,id,record);assert.deepEqual(m.readFormRecovery(storage,owner,id),record);
assert.deepEqual(m.readFormRecovery(storage,owner,id,now+m.interactionDraftLifetime),{...record,answers:null});
assert.deepEqual(JSON.parse(storage.getItem(m.interactionRecoveryKey)).forms[id].pending,request,'Expired draft is removed but exact unresolved request survives');
m.prepareInteractionRecovery(storage,other);assert.equal(values.size,0,'Even an account without any forms must remove another account’s records');
m.writeFormRecovery(storage,owner,id,{...record,dismissed:false,pending:null});assert.equal(m.readFormRecovery(storage,owner,id,now+m.interactionDraftLifetime),null);
for(const change of [{version:2},{owner:other},{forms:{bad:record}},{forms:{[id]:{...record,pending:{...request,interactionId:other}}}},{forms:{[id]:{...record,extra:'secret'}}}]){storage.setItem(m.interactionRecoveryKey,JSON.stringify({version:1,owner,forms:{[id]:record},...change}));assert.equal(m.readFormRecovery(storage,owner,id),null);assert.equal(values.size,0);}
m.writeFormRecovery(storage,owner,id,record);
assert.throws(()=>m.readFormRecovery({...storage,setItem(){throw Error('quota');}},owner,id,now+m.interactionDraftLifetime));
assert.deepEqual(JSON.parse(storage.getItem(m.interactionRecoveryKey)).forms[id].pending,request);
assert.throws(()=>m.writeFormRecovery(storage,owner,id,{...record,answers:{text:'x'.repeat(2001)}}));
const receipt={version:1,requestId:request.requestId,requestDigest:await m.jsonDigest(request,32768),interactionId:id,operation:'submit',answerRevision:4,createdAt:new Date(now).toISOString()};
let posts=0,reads=0;const lost=Error('Lost response');
assert.deepEqual(await m.deliverInteraction(request,async()=>{posts++;throw lost;},async()=>{reads++;return receipt;}),receipt);assert.equal(posts,1);assert.equal(reads,1);
for(const change of [{version:2},{requestDigest:'b'.repeat(64)},{operation:'cancel'},{answerRevision:5},{interactionId:other},{requestId:other}]){
 await assert.rejects(m.deliverInteraction(request,async()=>{posts++;throw lost;},async()=>({...receipt,...change})),e=>e===lost);
}
const before=posts;await m.recoverInteraction(request,async()=>receipt);assert.equal(posts,before,'Recovery is a read, never a resend');
await assert.rejects(m.recoverInteraction({...request,answers:{'field-1':'Changed after send'}},async()=>receipt),/does not match/);
for(const status of [400,401,403,404,409,410,422,429])await assert.rejects(m.deliverInteraction(request,async()=>{throw Object.assign(Error('Denied'),{status});},async()=>{assert.fail('No uncertain read on definitive rejection');}));
m.writeFormRecovery(storage,owner,id,{...record,updatedAt:now-m.interactionDraftLifetime-1});
const chatPending={id:crypto.randomUUID(),revision:4,content:'My interrupted message'};
storage.setItem('whumpo.chat-recovery',JSON.stringify({version:2,owner,updatedAt:now,draft:'',pending:chatPending}));
globalThis.sessionStorage={...storage,setItem(k,v){if(k===m.interactionRecoveryKey)throw Error('Form cleanup quota');storage.setItem(k,v);}};
let recovered;m.renderToStaticMarkup(m.createElement(()=>{recovered=m.useChatRecovery(owner);return null;}));
assert.deepEqual(recovered.restored,chatPending,'A form-store failure cannot conceal an unresolved ordinary Chat send');assert.equal(recovered.storageFailed,true);
globalThis.sessionStorage=storage;m.clearChatRecovery();assert.equal(values.size,0);delete globalThis.sessionStorage;
console.log('Interaction client passed: seven-day local expiry, independent unresolved retention, current/owner validation, quota failure preservation, exact request-digest receipts, read-only recovery, definitive refusals and shared sign-out clearing.');
