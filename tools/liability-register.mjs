import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
// WH-172 operator tool. Reads a private liability register file (see docs/cost-events.md) and appends one `liability.*` cost event per
// entry to the local D1 `cost_events` ledger. Local only: there is no --remote, no provider or billing call, and nothing is read from an
// invoice. An entry without an amount is recorded as an explicit unknown. Re-running is a no-op for unchanged entries (idempotent).
const usage='Use: node tools/liability-register.mjs [--dry-run] REGISTER.json';
try {
 const args=process.argv.slice(2),dry=args.includes('--dry-run'),files=args.filter(a=>a!=='--dry-run');
 if(files.length!==1||files[0].startsWith('--'))throw Error('files');
 const code=await build({entryPoints:['src/liability-register.ts','src/cost-event-store.ts'],bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent',outdir:'out'});
 const load=name=>import('data:text/javascript;base64,'+Buffer.from(code.outputFiles.find(f=>f.path.endsWith(name)).text).toString('base64'));
 const {costEventsFromRegister}=await load('liability-register.js'),{appendCostEvent}=await load('cost-event-store.js');
 const events=await costEventsFromRegister(JSON.parse(await readFile(files[0],'utf8')));
 const summary=events.map(e=>({dimension:e.dimension,period:e.occurredAt.slice(0,7),revision:e.revision,amount:e.cost.basis==='unknown'?'unknown':e.cost.micros}));
 if(dry)console.log(JSON.stringify({dryRun:true,entries:summary},null,2));
 else{
  const {getPlatformProxy}=await import('wrangler');
  const proxy=await getPlatformProxy({configPath:'wrangler.jsonc',persist:{path:'.wrangler/state/v3'},remoteBindings:false});
  try{const results=[];for(const e of events)results.push((await appendCostEvent(proxy.env.DB,e)).status);console.log(JSON.stringify({appended:results.map((status,i)=>({...summary[i],status}))},null,2));}
  finally{await proxy.dispose();}
 }
} catch(error) { // A SyntaxError message quotes the private file, so only a code is printed.
 console.error('Liability register unavailable ('+(error instanceof SyntaxError?'INVALID_JSON':error?.code??error?.message??'error')+'). '+usage+' Nothing was appended.');process.exitCode=1; }
