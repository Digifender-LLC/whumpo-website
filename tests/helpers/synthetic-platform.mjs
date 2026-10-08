// SYNTHETIC LOCAL recovery source authority for fixtures. Nothing here reaches a
// network, a provider or a Cloudflare account. It is the explicit fixture stand-in for
// the account control plane: a synthetic API behind the REAL releaseProvider, so the
// real observer (`observe`), the real D1 REST adapter (`remoteD1`) and the real
// authority checks run. The synthetic parts are only the account's Worker versions,
// the D1 databases (local SQLite adapters supplied by the test) and their ids.
import {join} from 'node:path';
import {readFile} from 'node:fs/promises';
import {releaseProvider} from '../../tools/release-provider.mjs';
import {observeRecoveryAuthority} from '../../tools/recovery-authority.mjs';
import {configFiles,workerOrder} from '../../tools/release-manifest.mjs';

export const syntheticDatabaseId=n=>String(n).padStart(8,'0')+'-0000-4000-8000-000000000000';

/** A synthetic account.
 * database:     adapter bound as `DB` to apps, sites and platform (default id = the configured one)
 * databases:    optional additional {id: adapter} entries (unbound targets, other accounts)
 * bound:        the database id apps, sites and platform start bound to (default: the configured one)
 * hook:         async ({kind,id,sql}) called before every synthetic API call (race injection)
 * Returns {provider, live, databases, authority(), replace(adapter)}. */
export async function syntheticPlatform({root=process.cwd(),database,databases={},bound,hook}={}){
 const configs=Object.fromEntries(await Promise.all(workerOrder.map(async role=>[role,JSON.parse(await readFile(join(root,configFiles[role]),'utf8'))])));
 const configured=configs.platform.d1_databases.find(d=>d.binding==='DB').database_id;
 const store=new Map(Object.entries(databases));
 if(database)store.set(configured,database);
 const names=Object.fromEntries(workerOrder.map(role=>[configs[role].name,role]));
 const live={workers:Object.fromEntries(workerOrder.map(role=>[role,{id:'v-'+role,tag:'tag-'+role,databases:role==='runtime'?[]:[{binding:'DB',id:bound??configured}],services:[],secrets:[]}]))};
 const notFound=()=>Object.assign(Error('Synthetic resource not found'),{status:404});
 const api=async(path,body)=>{
  const worker=/^\/workers\/scripts\/([a-z-]+)\/(deployments|versions\/[A-Za-z0-9._-]+)$/.exec(path);
  if(worker){
   await hook?.({kind:'worker',path});
   const role=names[worker[1]],w=live.workers[role];if(!w)throw notFound();
   if(worker[2]==='deployments')return {result:{deployments:[{versions:[{version_id:w.id,percentage:100}]}]}};
   const bindings=[...w.databases.map(d=>({type:'d1',name:d.binding,id:d.id})),...w.services.map(s=>({type:'service',name:s.binding,service:s.service,environment:s.environment??'production'})),...w.secrets.map(name=>({type:'secret_text',name}))];
   return {result:{annotations:{'workers/tag':w.tag},resources:{bindings}}};
  }
  const query=/^\/d1\/database\/([0-9a-f-]{36})\/query$/.exec(path);
  if(!query||body===undefined)throw Error('Unexpected synthetic endpoint');
  const adapter=store.get(query[1]);
  await hook?.({kind:'d1',id:query[1],sql:body.batch?body.batch.map(b=>b.sql):body.sql});
  if(!adapter)throw notFound();
  // Statements are built through the supplied adapter so its interceptors still see them.
  if(body.batch){const results=await adapter.batch(body.batch.map(b=>adapter.prepare(b.sql).bind(...b.params)));return {success:true,result:results.map(r=>structuredClone({success:r.success!==false,results:r.results??[]}))};}
  const result=await adapter.prepare(body.sql).bind(...body.params).all();
  return {success:true,result:[structuredClone({success:result.success!==false,results:result.results??[]})]};
 };
 const provider=await releaseProvider(root,{api});
 return {provider,live,databases:store,configuredId:configured,
  authority:()=>observeRecoveryAuthority({provider}),
  replace:adapter=>store.set(configured,adapter)};
}

/** Authority over one synthetic platform whose bound database is `adapter`. */
export async function syntheticAuthority(adapter,options={}){return (await syntheticPlatform({database:adapter,...options})).authority();}
