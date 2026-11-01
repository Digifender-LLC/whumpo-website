import {build} from 'esbuild';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export async function printOutcomeCosts(db, from, to, owner, print=console.log) {
 const code=await build({entryPoints:['src/outcome-producer.ts'],bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
 const {producedOutcomeCostReport}=await import('data:text/javascript;base64,'+Buffer.from(code.outputFiles[0].text).toString('base64'));
 print(JSON.stringify(await producedOutcomeCostReport(db,from,to,owner),null,2));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 let proxy;
 try{
  const [from,to,flag,owner,...extra]=process.argv.slice(2);
  if(flag!=='--account'||!owner||extra.length)throw Error('arguments');
  const {getPlatformProxy}=await import('wrangler');
  proxy=await getPlatformProxy({configPath:'wrangler.jsonc',persist:{path:'.wrangler/state/v3'},remoteBindings:false});
  await printOutcomeCosts(proxy.env.DB,from,to,owner);
 }catch{
  console.error('Outcome cost report unavailable. Use: node tools/report-outcome-costs.mjs FROM_ISO TO_EXCLUSIVE_ISO --account UUID. Local current-schema data only; no remote mode, writes or provider calls.');process.exitCode=1;
 }finally{await proxy?.dispose();}
}
