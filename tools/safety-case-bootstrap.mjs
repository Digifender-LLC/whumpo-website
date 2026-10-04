import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {cloudflareClient,remoteD1} from './cms-cloudflare.mjs';
// WH-132 one-time bootstrap of the first safety-case role administrator. Uses the existing operator Cloudflare/D1
// authorization (the same trust root as every other operator tool) and only succeeds while no role administrator is
// active. Every later role grant or case action needs that administrator's authenticated passkey session instead.
// Output contains only the opaque grant id and the account id the operator supplied; nothing else is read or printed.
try{
 const args=process.argv.slice(2),apply=args.at(-1)==='--apply',fixed=apply?args.slice(0,-1):args;
 if(fixed.length!==4||fixed[0]!=='--grant'||fixed[2]!=='--account'||!/^[A-Za-z0-9_.:-]{1,128}$/.test(fixed[1])||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(fixed[3]))throw Error('arguments');
 const proposal={grantId:fixed[1],accountId:fixed[3],role:'role_administrator'};
 if(!apply){console.log(JSON.stringify({version:1,proposal,applied:false,next:'Re-run with --apply after confirming the account is the reviewed named operator.'},null,2));process.exit(0);}
 const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
 const code=await build({entryPoints:['src/safety-cases.ts'],bundle:true,format:'esm',platform:'node',write:false});
 const cases=await import('data:text/javascript;base64,'+Buffer.from(code.outputFiles[0].text).toString('base64'));
 const credentials=process.env.CLOUDFLARE_API_TOKEN?{type:'api_token',token:process.env.CLOUDFLARE_API_TOKEN}:undefined;
 const db=remoteD1(cloudflareClient(config.account_id,fetch,credentials),config.d1_databases.find(b=>b.binding==='DB').database_id);
 console.log(JSON.stringify({version:1,applied:true,result:await cases.bootstrapSafetyRoleAdministrator(db,{grantId:proposal.grantId,accountId:proposal.accountId})},null,2));
}catch{
 console.error('Safety case bootstrap unavailable. Use --grant ID --account ACCOUNT_UUID [--apply]; the account must be a ready passkey identity and no role administrator may be active. Retry the same grant ID after an uncertain result.');process.exitCode=1;
}
