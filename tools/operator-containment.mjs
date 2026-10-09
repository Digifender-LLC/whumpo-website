import {readFile,stat} from 'node:fs/promises';
import {cloudflareClient,remoteD1} from './cms-cloudflare.mjs';
import {containmentInput,newActionId,runContainment} from './operator-containment-input.mjs';
// WH-050 F7 / runbook G3 (containment, project serving stop, account session revocation, lift/close, 90-day cleanup). Local operator CLI only: the existing operator Cloudflare/D1 authorization must
// authorize the configured control D1. Never mount this on a customer, visitor or inference endpoint.
// Usage: node tools/operator-containment.mjs --new-id | --input PRIVATE.json [--apply DIGEST]
// --new-id prints a fresh UUIDv7 request ID (local random generation, no network or database). The schema, not the CLI, enforces that a new
// request ID is a UUIDv7 minted within the last day by the database clock.
try{
 const args=process.argv.slice(2);
 if(args.length===1&&args[0]==='--new-id'){console.log(newActionId());}
 else{
  if(![2,4].includes(args.length)||args[0]!=='--input'||!args[1]||(args.length===4&&(args[2]!=='--apply'||!/^([0-9a-f]{64})$/.test(args[3]))))throw Error('arguments');
  const info=await stat(args[1]);if(!info.isFile()||info.size>8192)throw Error('input');
  const input=containmentInput(await readFile(args[1],'utf8')),config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
  const credentials=process.env.CLOUDFLARE_API_TOKEN?{type:'api_token',token:process.env.CLOUDFLARE_API_TOKEN}:undefined;
  const db=remoteD1(cloudflareClient(config.account_id,fetch,credentials),config.d1_databases.find(b=>b.binding==='DB').database_id);
  console.log(JSON.stringify(await runContainment(db,input,args[3]),null,2));
 }
}catch{
 console.error('Operator containment unavailable. Check the private JSON input, operator authorization and the complete current schema. A new request ID must come from --new-id (a UUIDv7 minted within the last day). Preview first and apply its exact digest. After an uncertain write, read status or retry the same request ID within one day; do not create a replacement.');process.exitCode=1;
}
