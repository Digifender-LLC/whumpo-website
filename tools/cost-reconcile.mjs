import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {cloudflareClient,remoteD1} from './cms-cloudflare.mjs';
// WH-171 operator tool. Reads private exported statement files (CSV or JSON, see docs/cost-events.md) and the `cost_events` heads
// read-only (local D1 by default, `--remote` for the control database). It writes nothing: no table, no file, no provider call.
// Output is the aggregate reconciliation report on stdout; it holds no account identifiers or statement text.
const usage='Use: node tools/cost-reconcile.mjs [--remote] [--tolerance MICROS] STATEMENT.csv|STATEMENT.json ...';
try {
 const args=process.argv.slice(2),files=[];let remote=false,tolerance=0;
 for(let i=0;i<args.length;i++){
  if(args[i]==='--remote')remote=true;
  else if(args[i]==='--tolerance'){tolerance=Number(args[++i]);if(!Number.isSafeInteger(tolerance)||tolerance<0)throw Error('tolerance');}
  else if(args[i].startsWith('--'))throw Error('flag');
  else files.push(args[i]);
 }
 if(!files.length)throw Error('files');
 const code=await build({entryPoints:['src/cost-reconcile.ts'],bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
 const {parseStatementCsv,reconciliationReport}=await import('data:text/javascript;base64,'+Buffer.from(code.outputFiles[0].text).toString('base64'));
 const statements=[];
 for(const file of files){
  const text=await readFile(file,'utf8');
  if(file.endsWith('.csv'))statements.push(...parseStatementCsv(text));
  else if(file.endsWith('.json')){const v=JSON.parse(text);statements.push(...(Array.isArray(v)?v:[v]));}
  else throw Error('extension');
 }
 const config=JSON.parse(await readFile('wrangler.jsonc','utf8')),binding=config.d1_databases.find(x=>x.binding==='DB');
 let db,dispose=async()=>{};
 if(remote)db=remoteD1(cloudflareClient(config.account_id),binding.database_id);
 else{
  const {getPlatformProxy}=await import('wrangler');
  const proxy=await getPlatformProxy({configPath:'wrangler.jsonc',persist:{path:'.wrangler/state/v3'},remoteBindings:false});
  db=proxy.env.DB;dispose=()=>proxy.dispose();
 }
 try{
  const heads=(await db.prepare('SELECT e.event_json FROM cost_events e WHERE e.revision=(SELECT MAX(revision) FROM cost_events WHERE idempotency_key=e.idempotency_key) ORDER BY e.seq LIMIT 10001').all()).results;
  if(heads.length>10000)throw Error('bound');
  console.log(JSON.stringify(reconciliationReport(statements,heads.map(r=>JSON.parse(r.event_json)),{toleranceMicros:tolerance}),null,2));
 }finally{await dispose();}
} catch(error) { console.error('Cost reconciliation unavailable ('+(error?.code??error?.message??'error')+'). '+usage+' Check the files, the schema and authorization. Nothing was written.');process.exitCode=1; }
