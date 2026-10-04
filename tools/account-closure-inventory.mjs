import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {cloudflareClient,remoteD1} from './cms-cloudflare.mjs';
import {closureCounts} from '../src/account-lifecycle/inventory.ts';
export {closureInventorySQL,closureMetrics} from '../src/account-lifecycle/inventory.ts';

export async function accountClosureInventory(db,userId=null){
 const counts=await closureCounts(db,userId);
 return {observedAt:new Date().toISOString(),scope:userId===null?'platform_aggregate':'single_account',counts,
  readyForDeletion:false,
  limitations:[
   'Read-only control-database snapshot; not a complete data export or deletion authorization.',
   'Identity counts cover rows linked to extant accounts; anonymous login/signup challenges and detached effect receipts need separate platform retention.',
   'Provider resources, R2 objects and backups have not been reconciled. Row counts are not resource counts.',
   'Saved configuration/proposal counts include full content copies. Metadata receipt counts do not prove independent restore suppression or safe deletion order.',
   'An active preservation hold blocks the account cascade until its audited release. Zero active holds or blocked records does not establish legal clearance.',
   'Customer closure (WH-018) uses these same counts in its exact review; this operator report itself authorizes nothing. Provider cancellation and restore-safe deletion suppression are not implemented.',
  ]};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.argv.length!==2)throw Error('Unexpected arguments');
  const config=JSON.parse(await readFile('wrangler.jsonc','utf8'));
  const credentials=process.env.CLOUDFLARE_API_TOKEN?{type:'api_token',token:process.env.CLOUDFLARE_API_TOKEN}:undefined;
  const api=cloudflareClient(config.account_id,fetch,credentials);
  const db=remoteD1(api,config.d1_databases.find(b=>b.binding==='DB').database_id);
  console.log(JSON.stringify(await accountClosureInventory(db),null,2));
 }catch{console.error('Account closure inventory unavailable. Check authorization and the complete current schema. Nothing was changed.');process.exitCode=1;}
}
