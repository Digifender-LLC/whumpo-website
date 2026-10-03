import assert from 'node:assert/strict';
import {build} from 'esbuild';
Error.stackTraceLimit=0;
const result=await build({entryPoints:['src/chat-interactions/input.ts'],bundle:true,platform:'neutral',format:'esm',write:false});
const {readInteractionInput}=await import('data:text/javascript;base64,'+Buffer.from(result.outputFiles[0].contents).toString('base64'));
const encode=text=>new TextEncoder().encode(text),limit=32768;
let count=0;
async function test(name,fn){try{await fn();count++;}catch(e){console.error(name);throw e;}}
function request(body,headers={}){return new Request('https://whumpo.test/api/chat/interactions/v1',{method:'POST',headers:{'content-type':'application/json',...headers},body,duplex:'half'});}
const refuses=(r,code)=>assert.rejects(()=>readInteractionInput(r),e=>e.code===code);
await test('current JSON, exact bytes and no request.json materialization',async()=>{
 const body='{"answer":"☁"}',r=request(body,{'content-length':String(encode(body).length)});r.json=()=>{throw Error('Unbounded parse');};
 assert.deepEqual(await readInteractionInput(r),{answer:'☁'});
 assert.equal(await readInteractionInput(request('"'+ 'a'.repeat(limit-2)+'"')), 'a'.repeat(limit-2));
});
await test('UTF-8 sequences crossing chunk boundaries',async()=>{
 const b=encode('{"answer":"☁"}');let n=0;
 const stream=new ReadableStream({pull(c){if(n===b.length)c.close();else c.enqueue(b.slice(n,n+++1));}});
 assert.deepEqual(await readInteractionInput(request(stream)),{answer:'☁'});
});
await test('chunked oversize canceled before any JSON parse',async()=>{
 let canceled=false;
 const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(limit));c.enqueue(new Uint8Array(1));},cancel(){canceled=true;return new Promise(()=>{});}});
 await refuses(request(stream),'BYTES');assert.equal(canceled,true);
});
await test('declared oversize cancels unread body',async()=>{
 let canceled=false;const stream=new ReadableStream({cancel(){canceled=true;}});
 await refuses(request(stream,{'content-length':String(limit+1)}),'BYTES');assert.equal(canceled,true);
});
await test('non JSON transport and lengths rejected',async()=>{
 for(const type of ['text/plain','application/jsonp','application/json; charset=latin1',''])await refuses(request('{}',{'content-type':type}),'CONTENT_TYPE');
 for(const length of ['-1','x','1.2','999999999999999999999'])await refuses(request('{}',{'content-length':length}),'BODY');
 for(const length of ['1','3'])await refuses(request('{}',{'content-length':length}),'BODY');
 assert.deepEqual(await readInteractionInput(request('{}',{'content-type':'application/json; charset=utf-8'})),{});
});
await test('invalid UTF-8, malformed JSON and transport failure rejected',async()=>{
 for(const body of ['', '{', '{}{}', new Uint8Array([34,0xff,34])])await refuses(request(body),'BODY');
 const stream=new ReadableStream({start(c){c.error(Error('private transport detail'));}});
 await refuses(request(stream),'BODY');await refuses(request(null),'BODY');
});
console.log(`Chat interaction transport: ${count} bounded-body cases passed; no endpoints or model calls.`);
