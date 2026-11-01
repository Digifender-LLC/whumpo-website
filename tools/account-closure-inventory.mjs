import {readFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {cloudflareClient,remoteD1} from './cms-cloudflare.mjs';

// Static SQL fragments only. Caller input is bound once in the scope CTE. The list is shared with the Worker's closure review
// (src/account-closure/inventory.ts), so the operator inventory and the customer review count exactly the same things.
const metrics=Object.fromEntries(JSON.parse(readFileSync(new URL('../src/account-closure/metrics.json',import.meta.url),'utf8')).map(([name,...rest])=>[name,rest]));
const inventorySQL=entries=>`WITH scope AS (SELECT id FROM users WHERE (?1 IS NULL OR id=?1)),
 owned_projects AS (SELECT id FROM projects WHERE owner_user_id IN (SELECT id FROM scope))
 SELECT ${entries.map(([name,[table,owner,condition]])=>
 `(SELECT COUNT(*) FROM ${table} WHERE ${owner.includes(' IN ')?owner:`${owner} IN (SELECT id FROM scope)`}${condition?` AND (${condition})`:''}) AS ${name}`).join(',\n')}`;
export const closureInventorySQL=inventorySQL(Object.entries(metrics));
// D1 refuses a result set above 100 columns, so the same metrics run as several statements of at most 50 and are merged.
const chunks=Object.entries(metrics).reduce((all,entry,i)=>(i%50?all.at(-1).push(entry):all.push([entry]),all),[]);

export async function accountClosureInventory(db,userId=null){
 if(userId!==null&&(typeof userId!=='string'||!userId.length||userId.length>128))throw Error('Invalid account scope');
 const row=Object.assign({},...await Promise.all(chunks.map(chunk=>db.prepare(inventorySQL(chunk)).bind(userId).first())));
 if(!row||Object.keys(metrics).some(key=>!Number.isSafeInteger(row[key])||row[key]<0))throw Error('Closure inventory unavailable');
 if(userId!==null&&row.accounts!==1)throw Error('Account scope unavailable');
 const counts=Object.fromEntries(Object.keys(metrics).map(key=>[key,row[key]]));
 return {observedAt:new Date().toISOString(),scope:userId===null?'platform_aggregate':'single_account',counts,
  readyForDeletion:false,
  limitations:[
   'Read-only control-database counts taken in three separate statements (D1 limits a result to 100 columns), so they are not one atomic snapshot; not a complete data export or deletion authorization.',
   'Identity counts cover rows linked to extant accounts; anonymous login/signup challenges and detached effect receipts need separate platform retention.',
   'Provider resources, R2 objects and backups have not been reconciled. Row counts are not resource counts.',
   'Saved configuration/proposal counts include full content copies. Metadata receipt counts do not prove independent restore suppression or safe deletion order.',
   'An active preservation hold blocks the account cascade until its audited release. Zero active holds or blocked records does not establish legal clearance.',
   'Account closure, provider cancellation and restore-safe deletion orchestration are not implemented.',
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
