import {newQuickJSWASMModuleFromVariant,newVariant,type QuickJSHandle,type CustomizeVariantOptions} from 'quickjs-emscripten-core';
import baseVariant from '@jitl/quickjs-wasmfile-release-sync';
// Wrangler's Wasm loader needs the explicit extension, rather than the package /wasm alias.
import wasmModule from '../../node_modules/@jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm';

const limits=Object.freeze({bodyBytes:49152,sourceBytes:32768,inputBytes:8192,outputBytes:16384,heapBytes:4*1024*1024,stackBytes:128*1024,interrupts:64,jobs:64});
type Failure='invalid_request'|'invalid_code'|'execution_failed'|'work_limit'|'unresolved_promise'|'invalid_output'|'unavailable';
class GuestFailure extends Error {constructor(readonly category:Failure){super(category);}}
const fail=(category:Failure):never=>{throw new GuestFailure(category);};
const bytes=(s:string)=>new TextEncoder().encode(s).length;
// Only the immutable compiled engine is shared. Every call instantiates fresh Wasm memory.
async function execute(source:string,inputJSON:string){
 // The pinned Emscripten loader supports print/printErr; its narrow TS interface omits them.
 const moduleOptions:NonNullable<CustomizeVariantOptions['emscriptenModule']>&{print:()=>void;printErr:()=>void}={print:()=>{},printErr:()=>{}};
 const engine=await newQuickJSWASMModuleFromVariant(newVariant(baseVariant,{wasmModule,wasmMemory:new WebAssembly.Memory({initial:256,maximum:256}),emscriptenModule:moduleOptions}));
 const runtime=engine.newRuntime();
 runtime.setMemoryLimit(limits.heapBytes);runtime.setMaxStackSize(limits.stackBytes);
 let interrupts=0,jobs=0;
 // Worker clocks may not advance during synchronous computation. Count engine interrupts.
 runtime.setInterruptHandler(()=>++interrupts>limits.interrupts);
 const vm=runtime.newContext(),handles=new Set<QuickJSHandle>();
 const keep=(h:QuickJSHandle)=>{handles.add(h);return h;};
 const unwrap=(r:{value?:QuickJSHandle;error?:QuickJSHandle},category:Failure)=>{
  if(r.error){keep(r.error);return fail(interrupts>limits.interrupts?'work_limit':category);}
  if(!r.value)return fail(category);return keep(r.value);
 };
 const settle=(handle:QuickJSHandle):QuickJSHandle=>{
  for(;;){
   const state=vm.getPromiseState(handle);
   if(state.type==='fulfilled')return keep(state.value);
   if(state.type==='rejected'){keep(state.error);return fail(interrupts>limits.interrupts?'work_limit':'execution_failed');}
   if(!runtime.hasPendingJob())return fail('unresolved_promise');
   if(++jobs>limits.jobs)return fail('work_limit');
   const ran=runtime.executePendingJobs(1);
   if(ran.error){keep(ran.error);return fail(interrupts>limits.interrupts?'work_limit':'execution_failed');}
  }
 };
 try{
  // Capture serialization intrinsics before guest code can replace globals. No host callbacks.
  const parse=unwrap(vm.evalCode('(text)=>JSON.parse(text)'),'unavailable');
  const stringify=unwrap(vm.evalCode(`(()=>{const stringify=JSON.stringify;return value=>{const text=stringify(value);if(typeof text!=="string"||text.length>${limits.outputBytes})throw 0;return text;};})()`),'unavailable');
  const input=unwrap(vm.callFunction(parse,vm.undefined,keep(vm.newString(inputJSON))),'invalid_request');
  const exports=settle(unwrap(vm.evalCode(source,'backend.mjs',{type:'module'}),'invalid_code'));
  const handler=keep(vm.getProp(exports,'default'));
  if(vm.typeof(handler)!=='function')return fail('invalid_code');
  const value=settle(unwrap(vm.callFunction(handler,vm.undefined,input),'execution_failed'));
  const json=unwrap(vm.callFunction(stringify,vm.undefined,value),'invalid_output');
  if(vm.typeof(json)!=='string')return fail('invalid_output');
  const text=vm.getString(json);
  if(bytes(text)>limits.outputBytes)return fail('invalid_output');
  return JSON.parse(text) as unknown;
 }finally{
  for(const h of [...handles].reverse())h.dispose();
  vm.dispose();runtime.dispose();
 }
}
async function boundedBody(request:Request){
 const reader=request.body?.getReader();if(!reader)return fail('invalid_request');
 const chunks:Uint8Array[]=[];let size=0;
 for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>limits.bodyBytes){await reader.cancel();return fail('invalid_request');}chunks.push(value);}
 const all=new Uint8Array(size);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(all)) as unknown;}catch{return fail('invalid_request');}
}
const response=(body:unknown,status=200)=>Response.json(body,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
// Resource counters only, never tenant context. Bound concurrent fresh-Wasm allocations per isolate.
// The caller's opaque fairness lane (a per-project hash) may hold at most one of the two slots, so one
// project cannot occupy the whole gate. Busy refusals run no guest code; callers do not charge them.
let active=0;
const lanes=new Set<string>();
export default {
 async fetch(request:Request):Promise<Response>{
  if(request.method!=='POST'||new URL(request.url).pathname!=='/execute')return response({ok:false,error:'not_found'},404);
  const lane=request.headers.get('x-whumpo-lane')??'';
  if(!/^[0-9a-f]{64}$/.test(lane))return response({ok:false,error:'invalid_request'},422);
  if(active>=2||lanes.has(lane))return response({ok:false,error:'busy'},503);
  active++;lanes.add(lane);
  try{
   const body=await boundedBody(request);
   if(!body||typeof body!=='object'||Array.isArray(body))return fail('invalid_request');
   const data=body as Record<string,unknown>;
   if(Object.keys(data).some(k=>!['version','source','input'].includes(k))||data.version!==1||typeof data.source!=='string'||!data.source.trim()||!('input'in data)||bytes(data.source)>limits.sourceBytes)return fail('invalid_request');
   const inputJSON=JSON.stringify(data.input);if(bytes(inputJSON)>limits.inputBytes)return fail('invalid_request');
   return response({ok:true,value:await execute(data.source,inputJSON)});
  }catch(error){
   const category=error instanceof GuestFailure?error.category:'unavailable';
   return response({ok:false,error:category},category==='unavailable'?503:422);
  }finally{active--;lanes.delete(lane);}
 }
};
