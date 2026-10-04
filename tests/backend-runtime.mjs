import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,rm,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const req=createRequire(import.meta.resolve('wrangler'));
const {Miniflare,convertV4MiniflareOptions}=req('miniflare');
const remote=process.env.RUNTIME_PREVIEW_URL;
if(remote)assert.ok(['localhost','127.0.0.1'].includes(new URL(remote).hostname),'Use the local Wrangler remote-preview proxy, never a public execution endpoint.');
const dir=await mkdtemp('/tmp/whumpo-runtime-');
execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--config','wrangler.runtime.jsonc','--dry-run','--outdir',dir],{stdio:'pipe'});
const mf=remote?{dispatchFetch:(url,init)=>fetch(new URL(new URL(url).pathname,remote),init),dispose:async()=>{}}:new Miniflare(convertV4MiniflareOptions({modulesRoot:dir,modules:[{type:'ESModule',path:dir+'/worker.js'},...(await readdir(dir)).filter(p=>p.endsWith('.wasm')).map(p=>({type:'CompiledWasm',path:dir+'/'+p}))],compatibilityDate:'2026-09-29'}));
const lane=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
async function request(source,input=null,laneKey=lane()){
 let timer;try{return await Promise.race([mf.dispatchFetch('http://runtime/execute',{method:'POST',headers:{'x-whumpo-lane':laneKey},body:JSON.stringify({version:1,source,input})}).then(async r=>({status:r.status,data:await r.json()})),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Execution did not stop within 5 seconds')),5000)})]);}finally{clearTimeout(timer);}
}
async function works(source,input,expected){const r=await request(source,input);assert.deepEqual(r,{status:200,data:{ok:true,value:expected}});}
async function rejects(source,allowed){const r=await request(source);assert.equal(r.status,422,JSON.stringify(r));assert.ok(allowed.includes(r.data.error),JSON.stringify(r));await works('export default () => 42',null,42);}
try{
 await works('export default input => ({total:input.items.reduce((n,x)=>n+x,0)})',{items:[2,3,5]},{total:10});
 await works('export default async input => ({value:await Promise.resolve(input)})',{hello:'world'},{value:{hello:'world'}});
 await works('const value=await Promise.resolve(7);export default ()=>value',null,7);
 await works('export default ()=>[typeof fetch,typeof process,typeof require,typeof WebAssembly,typeof setTimeout,typeof env,typeof console]',null,Array(7).fill('undefined'));
 await works('export default ()=>Function("return typeof process")()',null,'undefined');
 await works('export default input=>{globalThis.secret=input;Object.prototype.leak=input;return input;}',{private:'tenant one'},{private:'tenant one'});
 await works('export default ()=>({secret:typeof globalThis.secret,leak:typeof ({}).leak})',null,{secret:'undefined',leak:'undefined'});
 await works('JSON.stringify=()=>"forged";export default ()=>({correct:true})',null,{correct:true});
 for(const [code,reason] of [
  ['not valid JavaScript',['invalid_code']],
  ['export const other=1',['invalid_code']],
  ['import x from "https://example.com/secret";export default()=>x',['invalid_code','execution_failed']],
  ['export default ()=>fetch("https://example.com")',['execution_failed']],
  ['export default ()=>{while(true){}}',['work_limit']],
  ['export default ()=>{function f(){return f()}return f()}',['execution_failed']],
  ['export default ()=>{const xs=[];for(;;)xs.push(new Array(10000).fill("x"));}',['execution_failed','work_limit']],
  ['export default ()=>new Promise(()=>{})',['unresolved_promise']],
  ['export default async()=>{for(;;)await Promise.resolve()}',['work_limit']],
  ['export default ()=>({get bad(){while(true){}}})',['work_limit']],
  ['export default ()=>({toJSON(){throw new Error("private data")}})',['invalid_output']],
  ['export default ()=>undefined',['invalid_output']],
  ['export default ()=>1n',['invalid_output']],
  ['export default ()=>{const x={};x.self=x;return x}',['invalid_output']],
  ['export default ()=>"x".repeat(20000)',['invalid_output']],
  ['export default ()=>/^(a+)+$/.test("a".repeat(1000)+"!")',['work_limit','execution_failed']]
 ]){await rejects(code,reason);console.log('Rejected hostile/invalid fixture:',reason.join('/'));}
 const wide=await request('export default x=>x','x'.repeat(9000));assert.equal(wide.status,422);assert.equal(wide.data.error,'invalid_request');
 const source=await request(' '.repeat(33000)+'export default ()=>1');assert.equal(source.status,422);
 const oversized=await mf.dispatchFetch('http://runtime/execute',{method:'POST',headers:{'x-whumpo-lane':lane()},body:'x'.repeat(50000)});assert.equal(oversized.status,422);
 assert.equal((await mf.dispatchFetch('http://runtime/execute')).status,404);
 assert.equal((await mf.dispatchFetch('http://runtime/other',{method:'POST',body:'{}'})).status,404);
 for(let batch=0;batch<10;batch++){
  const r=await Promise.all(Array.from({length:4},(_,i)=>request('export default x=>{globalThis.secret=x;return x}',{tenant:batch*4+i})));
  r.forEach((x,i)=>{if(x.status===200)assert.deepEqual(x.data.value,{tenant:batch*4+i});else assert.deepEqual(x,{status:503,data:{ok:false,error:'busy'}});});
 }
 await works('export default ()=>typeof globalThis.secret',null,'undefined');
 // WH-075 fairness lane: required, opaque, and one lane holds at most one of the two execution slots.
 for(const bad of [undefined,'tenant-a','A'.repeat(64)]){const r=await mf.dispatchFetch('http://runtime/execute',{method:'POST',headers:bad===undefined?{}:{'x-whumpo-lane':bad},body:JSON.stringify({version:1,source:'export default ()=>1',input:null})});assert.equal(r.status,422);assert.deepEqual(await r.json(),{ok:false,error:'invalid_request'});}
 const slow='export default async()=>{let n=0;for(let i=0;i<40;i++){n+=await Promise.resolve(i)}return n}';
 let noisyBusy=0;
 for(let round=0;round<10;round++){
  const noisy=lane(),other=lane();
  const r=await Promise.all([request(slow,null,noisy),request(slow,null,noisy),request(slow,null,noisy),request(slow,null,other)]);
  // Without the lane cap three overlapping noisy calls could hold both slots and refuse the other lane.
  assert.deepEqual(r[3],{status:200,data:{ok:true,value:780}},'another lane always keeps a slot: '+JSON.stringify(r));
  r.slice(0,3).forEach(x=>{if(x.status!==200)assert.deepEqual(x,{status:503,data:{ok:false,error:'busy'}});else assert.equal(x.data.value,780);});
  noisyBusy+=r.slice(0,3).filter(x=>x.status===503).length;
 }
 assert.ok(noisyBusy>0,'same-lane overlap was refused at least once');
 await works('export default ()=>2',null,2);
 console.log((remote?'Cloudflare remote preview: ':'Actual workerd: ')+'JSON functions/async modules, fresh tenant instances, no host capabilities, bounded invalid/exhaustion paths, required per-project fairness lane and post-failure recovery passed.');
}finally{await mf.dispose();await rm(dir,{recursive:true,force:true});}
