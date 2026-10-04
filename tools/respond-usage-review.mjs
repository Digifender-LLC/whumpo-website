import {readFile,stat} from 'node:fs/promises';
import {build} from 'esbuild';
import {cloudflareClient,remoteD1} from './cms-cloudflare.mjs';
import {usageReviewInput,runUsageReview} from './usage-review-input.mjs';
try{
 const args=process.argv.slice(2);
 if(![2,4].includes(args.length)||args[0]!=='--input'||!args[1]||(args.length===4&&(args[2]!=='--apply'||!/^([0-9a-f]{64})$/.test(args[3]))))throw Error('arguments');
 const info=await stat(args[1]);if(!info.isFile()||info.size>8192)throw Error('input');
 const input=usageReviewInput(await readFile(args[1],'utf8')),config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
 const code=await build({entryPoints:['src/usage-review-requests.ts'],bundle:true,format:'esm',platform:'node',write:false});
 const service=await import('data:text/javascript;base64,'+Buffer.from(code.outputFiles[0].text).toString('base64'));
 const db=remoteD1(cloudflareClient(config.account_id),config.d1_databases.find(b=>b.binding==='DB').database_id);
 console.log(JSON.stringify(await runUsageReview(service,db,input,args[3]),null,2));
}catch{
 console.error('Usage review unavailable. Check the private input, operator authorization and the current schema. Preview the exact customer-visible response before applying its digest. After an uncertain write, read or retry the same response; do not invent a replacement.');process.exitCode=1;
}
