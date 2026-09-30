import {open} from 'node:fs/promises';
import {build} from 'esbuild';
// Local operator planning only. No credentials, network, billing or provider calls.
if(process.argv.length!==3){console.error('Usage: pnpm plan:inference <reviewed-route-scenario.json>');process.exit(1);}
try{
 const file=await open(process.argv[2],'r');let bytes;
 try{if(!(await file.stat()).isFile())throw Error('Regular scenario file required');const buffer=Buffer.alloc(262145);const {bytesRead}=await file.read(buffer,0,buffer.length,0);if(bytesRead>262144)throw Error('Scenario exceeds 256 KiB');bytes=buffer.subarray(0,bytesRead);}finally{await file.close();}
 const {candidates,request}=JSON.parse(bytes.toString('utf8'));
 const code=await build({entryPoints:['src/inference-routing.ts'],bundle:true,format:'esm',platform:'node',write:false});
 const {planInferenceRoute}=await import('data:text/javascript;base64,'+Buffer.from(code.outputFiles[0].text).toString('base64'));
 console.log(JSON.stringify(planInferenceRoute(candidates,request),null,2));
}catch{console.error('Route scenario could not be planned. Check its schema, numeric bounds, unique IDs and benchmark/rate dates.');process.exitCode=1;}
