import {readFile} from 'node:fs/promises';import {build} from 'esbuild';import {cloudflareClient,remoteD1} from './cms-cloudflare.mjs';
// Authenticated operator tool; does not print source or customer context, and performs no writes.
try {
 const args=process.argv.slice(2);
 if(args.length!==0&&(args.length!==2||!['--after','--inspect'].includes(args[0])||! /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(args[1])))throw Error('Invalid arguments');
 const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
 const code=await build({entryPoints:['src/backend-nomination-intake.ts'],bundle:true,format:'esm',platform:'node',write:false});
 const {nominationQueue,inspectNominationIntegrity}=await import('data:text/javascript;base64,'+Buffer.from(code.outputFiles[0].text).toString('base64'));
 const db=remoteD1(cloudflareClient(config.account_id),config.d1_databases.find(x=>x.binding==='DB').database_id);
 console.log(JSON.stringify(args[0]==='--inspect'?await inspectNominationIntegrity(db,args[1]):await nominationQueue(db,args[1]),null,2));
}catch{console.error('Nomination review unavailable. Use: node tools/review-backend-nominations.mjs [--after UUID | --inspect UUID]. Check authorization, current consent, source integrity and migration 0093. Nothing was shared or changed.');process.exitCode=1;}
