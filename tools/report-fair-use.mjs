import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {cloudflareClient,remoteD1} from './cms-cloudflare.mjs';
// Private operator command; uses existing Wrangler authorization. No mutations,
// model calls, email addresses, prompts, source, account listing or finance guesses.
const args=process.argv.slice(2);
if(args.length!==0&&!(args.length===2&&args[0]==='--account'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(args[1]))){console.error('Usage: pnpm report:fair-use [--account ACCOUNT_UUID]');process.exitCode=1;}
else try{
 const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
 const api=cloudflareClient(config.account_id),db=remoteD1(api,config.d1_databases.find(binding=>binding.binding==='DB').database_id);
 const code=await build({entryPoints:['src/fair-use-report.ts'],bundle:true,format:'esm',platform:'node',write:false});
 const {fairUseReport}=await import('data:text/javascript;base64,'+Buffer.from(code.outputFiles[0].text).toString('base64'));
 console.log(JSON.stringify(await fairUseReport(db,args[1]),null,2));
}catch{console.error('Fair-use report unavailable. Check operator authorization, applied migrations and the account identifier. No settings were changed.');process.exitCode=1;}
