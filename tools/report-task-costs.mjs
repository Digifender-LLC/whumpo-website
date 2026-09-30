import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {cloudflareClient,remoteD1} from './cms-cloudflare.mjs';
// Operator-only read. No customer content is selected or printed.
try {
 const args=process.argv.slice(2);
 if(args.length!==2&&args.length!==4)throw Error('Invalid arguments');
 const [from,toExclusive,flag,owner]=args;
 if(flag!==undefined&&flag!=='--account')throw Error('Invalid flag');
 const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
 const code=await build({entryPoints:['src/task-cost-report.ts'],bundle:true,format:'esm',platform:'node',write:false});
 const {taskCostReport}=await import('data:text/javascript;base64,'+Buffer.from(code.outputFiles[0].text).toString('base64'));
 const api=cloudflareClient(config.account_id), db=remoteD1(api,config.d1_databases.find(x=>x.binding==='DB').database_id);
 console.log(JSON.stringify(await taskCostReport(db,from,toExclusive,owner),null,2));
} catch { console.error('Task-cost report unavailable. Use: node tools/report-task-costs.mjs FROM_ISO TO_EXCLUSIVE_ISO [--account UUID]. Check authorization, dates (maximum 93 days), applied migrations and aggregate bounds. No settings were changed.');process.exitCode=1; }
