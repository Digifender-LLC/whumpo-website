import {readCompanyFinance} from './company-finance-input.mjs';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {cloudflareClient,remoteD1} from './cms-cloudflare.mjs';
// Private operator command; uses existing Wrangler authorization. No mutations,
// model calls, email addresses, prompts, source, account listing or finance guesses.
const args=process.argv.slice(2);let account,financePath,valid=true;
for(let i=0;i<args.length;i+=2){const flag=args[i],value=args[i+1];if(!value){valid=false;break;}if(flag==='--account'&&account===undefined&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(value))account=value;else if(flag==='--economics'&&financePath===undefined)financePath=value;else valid=false;}
if(!valid){console.error('Usage: pnpm report:fair-use [--account ACCOUNT_UUID] [--economics PRIVATE_JSON_FILE]');process.exitCode=1;}
else try{
 const financeReview=financePath===undefined?undefined:await readCompanyFinance(financePath);
 const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
 const api=cloudflareClient(config.account_id),db=remoteD1(api,config.d1_databases.find(binding=>binding.binding==='DB').database_id);
 const code=await build({entryPoints:['src/fair-use-report.ts'],bundle:true,format:'esm',platform:'node',write:false});
 const {fairUseReport}=await import('data:text/javascript;base64,'+Buffer.from(code.outputFiles[0].text).toString('base64'));
 console.log(JSON.stringify({...await fairUseReport(db,account),...(financeReview?{financeReview}:{})},null,2));
}catch{console.error('Fair-use report unavailable. Check operator authorization, the current schema, the account identifier and any supplied finance summary. No settings were changed.');process.exitCode=1;}
