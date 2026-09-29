import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';
import {cloudflareClient,cmsCloudflareProvider,remoteD1} from './cms-cloudflare.mjs';
const args=process.argv.slice(2),project=args[0];
if(args.length!==1||project!=='--list'&&!/^[0-9a-f-]{36}$/.test(project??''))throw Error('Usage: node tools/provision-cms.mjs --list | PROJECT_ID');
const config=JSON.parse(await readFile('wrangler.jsonc','utf8')),database=config.d1_databases.find(x=>x.binding==='DB'),api=cloudflareClient(config.account_id),db=remoteD1(api,database.database_id);
if(project==='--list'){
 const {results}=await db.prepare("SELECT project_id,state FROM cms_instances WHERE state<>'ready' ORDER BY created_at LIMIT 5").all();console.log(JSON.stringify({instances:results}));
}else{
 const code=await build({entryPoints:['src/cms-provision.ts'],bundle:true,format:'esm',platform:'node',write:false});const {allocateCMSResources}=await import('data:text/javascript;base64,'+Buffer.from(code.outputFiles[0].text).toString('base64'));
 try{const result=await allocateCMSResources(db,project,cmsCloudflareProvider(config.account_id,api));console.log(JSON.stringify(result));console.log('Storage resources recorded. Worker deployment, credential installation and signed CMS bootstrap are still required; this instance is not ready.');}catch(error){console.error(error.message);process.exitCode=1;}
}
