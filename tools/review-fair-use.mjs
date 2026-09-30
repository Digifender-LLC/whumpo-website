import {readFile,stat} from 'node:fs/promises';
import {build} from 'esbuild';
import {cloudflareClient,remoteD1} from './cms-cloudflare.mjs';
import {fairUseOperatorInput,runFairUseOperator} from './fair-use-review-input.mjs';
// Local operator CLI only; the existing Cloudflare credential must authorize the
// configured control D1. Never mount this on a customer or inference endpoint.
try{
 const args=process.argv.slice(2);
 if(![2,4].includes(args.length)||args[0]!=='--input'||!args[1]||(args.length===4&&(args[2]!=='--apply'||!/^([0-9a-f]{64})$/.test(args[3]))))throw Error('arguments');
 const info=await stat(args[1]);if(!info.isFile()||info.size>16384)throw Error('input');
 const input=fairUseOperatorInput(await readFile(args[1],'utf8'));
 const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
 const code=await build({entryPoints:['src/fair-use-reviews.ts'],bundle:true,format:'esm',platform:'node',write:false});
 const service=await import('data:text/javascript;base64,'+Buffer.from(code.outputFiles[0].text).toString('base64'));
 const db=remoteD1(cloudflareClient(config.account_id),config.d1_databases.find(b=>b.binding==='DB').database_id);
 console.log(JSON.stringify(await runFairUseOperator(service,db,input,args[3]),null,2));
}catch{
 console.error('Review request unavailable. Check the private JSON input, operator authorization and migrations through 0092. For writes, preview first and use its exact --apply digest. If a write outcome is uncertain, read or retry the same request ID; do not create a replacement.');process.exitCode=1;
}
