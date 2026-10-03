import assert from 'node:assert/strict';
import {build} from 'esbuild';
const {outputFiles}=await build({entryPoints:['frontend/src/lib/chat-location.ts'],bundle:true,format:'esm',write:false});
const {readChatLocation,saveChatLocation,chatLocationKey:key,chatLocationLifetime:life}=await import('data:text/javascript;base64,'+Buffer.from(outputFiles[0].text).toString('base64'));
const owner=crypto.randomUUID(),other=crypto.randomUUID(),id=crypto.randomUUID(),now=2000000000000,values=new Map();
const store={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
saveChatLocation(store,owner,{kind:'interaction',id},now);const original=values.get(key);
assert.deepEqual(readChatLocation(store,owner,now+1),{kind:'interaction',id});assert.equal(values.get(key),original,'Reading does not renew retention');
assert.equal(readChatLocation(store,other,now+1),null);assert.equal(values.size,0,'Account change removes the locator');
for(const time of [now-1,now+life]){saveChatLocation(store,owner,{kind:'interaction',id},now);assert.equal(readChatLocation(store,owner,time),null);assert.equal(values.size,0);}
for(const raw of ['{','[]','null','x'.repeat(351),JSON.stringify({version:2,owner,kind:'url',id,updatedAt:now}),JSON.stringify({version:2,owner,kind:'turn',id:'https://example.invalid',updatedAt:now}),JSON.stringify({version:2,owner,kind:'turn',id,updatedAt:now,answers:'private'}),JSON.stringify({version:0,owner,interactionId:id,updatedAt:now}),JSON.stringify({version:1,owner,interactionId:'https://example.invalid',updatedAt:now}),JSON.stringify({version:1,owner,interactionId:id,updatedAt:now,answers:'private'})]){store.setItem(key,raw);assert.equal(readChatLocation(store,owner,now),null);assert.equal(values.size,0);}
saveChatLocation(store,owner,{kind:'turn',id},now);assert.deepEqual(readChatLocation(store,owner,now+1),{kind:'turn',id});saveChatLocation(store,owner,null,now);assert.equal(values.size,0);
assert.throws(()=>saveChatLocation(store,'wrong-owner',{kind:'turn',id},now));assert.throws(()=>saveChatLocation(store,owner,{kind:'turn',id:'not-an-id'},now));
const unavailable={getItem(){throw Error('blocked')},setItem(){throw Error('full')},removeItem(){throw Error('blocked')}};
assert.throws(()=>readChatLocation(unavailable,owner,now));assert.throws(()=>saveChatLocation(unavailable,owner,{kind:'interaction',id},now));
console.log('Chat location passed: account-bound locator, seven-day expiry without read renewal, malformed/current-version refusal, explicit clearing and storage failures. No private content, actions or network.');
