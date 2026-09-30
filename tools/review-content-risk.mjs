import {readFile,stat} from 'node:fs/promises';
import {build} from 'esbuild';
import {cloudflareClient,remoteD1} from './cms-cloudflare.mjs';
import {contentRiskReviewInput,runContentRiskReview} from './content-risk-review-input.mjs';
try{
 const args=process.argv.slice(2);
 if(![2,4].includes(args.length)||args[0]!=='--input'||!args[1]||(args.length===4&&(args[2]!=='--apply'||!/^([0-9a-f]{64})$/.test(args[3]))))throw Error('arguments');
 const info=await stat(args[1]);if(!info.isFile()||info.size>4096)throw Error('input');
 const input=contentRiskReviewInput(await readFile(args[1],'utf8'));
 const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
 const code=await build({entryPoints:['src/content-risk-evidence.ts','src/content-risk.ts'],bundle:true,format:'esm',platform:'node',outdir:'unused',write:false});
 const [service,{assessContentRisk}]=await Promise.all(code.outputFiles.map(f=>import('data:text/javascript;base64,'+Buffer.from(f.text).toString('base64'))));
 const credentials=process.env.CLOUDFLARE_API_TOKEN?{type:'api_token',token:process.env.CLOUDFLARE_API_TOKEN}:undefined;
 const db=remoteD1(cloudflareClient(config.account_id,fetch,credentials),config.d1_databases.find(b=>b.binding==='DB').database_id);
 console.log(JSON.stringify(await runContentRiskReview(service,assessContentRisk,db,input,args[3]),null,2));
}catch{
 console.error('Safety review unavailable. Check the private input, operator access and migration 0105. Preview the exact decision before applying its digest. After an uncertain write, read or retry the same input; do not create a replacement finding.');process.exitCode=1;
}
