import {readFile,stat} from 'node:fs/promises';
import {build} from 'esbuild';
import {cloudflareClient,remoteD1} from './cms-cloudflare.mjs';
import {featurePreviewInput,runFeaturePreviewOperator} from './feature-preview-input.mjs';
// Operator credentials authorize the configured control database. No customer/model endpoint.
try{
 const args=process.argv.slice(2);
 if(![2,4].includes(args.length)||args[0]!=='--input'||!args[1]||(args.length===4&&(args[2]!=='--apply'||! /^[0-9a-f]{64}$/.test(args[3]))))throw Error('arguments');
 const info=await stat(args[1]);if(!info.isFile()||info.size>4096)throw Error('input');
 const code=await build({stdin:{contents:"export * from './src/feature-preview-grants';export {featureRequest,requireFeatureScope} from './src/feature-inclusion';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
 const service=await import('data:text/javascript;base64,'+Buffer.from(code.outputFiles[0].text).toString('base64'));
 const input=featurePreviewInput(await readFile(args[1],'utf8'),service),config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
 if(config.vars?.ENVIRONMENT!=='test')throw Error('Only the test platform is an operator destination');
 const databaseId=config.d1_databases.find(b=>b.binding==='DB').database_id;
 const db=remoteD1(cloudflareClient(config.account_id),databaseId);
 console.log(JSON.stringify(await runFeaturePreviewOperator(service,db,input,{environment:'test',accountId:config.account_id,databaseId},args[3]),null,2));
}catch{
 console.error('Preview-grant request unavailable. Check the private input, operator authorization and schema through 0120. Preview first; apply only its exact digest. An uncertain write must use readback or the same request ID. No customer action or provider call is authorized by inclusion alone.');process.exitCode=1;
}
