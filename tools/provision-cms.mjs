import {readFile,writeFile,lstat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
import {cloudflareClient,cmsCloudflareProvider,remoteD1} from './cms-cloudflare.mjs';
import {frozenArtifact,cmsMasterKey,instanceConfig,workerExists,activeWorker,runWrangler,privateCMSProbe} from './cms-release.mjs';
import {deployPlatform} from './deploy-platform.mjs';
async function module(path){const code=await build({entryPoints:[path],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(code.outputFiles[0].text).toString('base64'));}
async function main(){
 const args=process.argv.slice(2),project=args[0],storageOnly=args[1]==='--storage-only';
 if(args.length>2||args.length===2&&!storageOnly||project!=='--list'&&!/^[0-9a-f-]{36}$/.test(project??''))throw Error('Usage: node tools/provision-cms.mjs --list | PROJECT_ID [--storage-only]');
 const base=JSON.parse(await readFile('wrangler.jsonc','utf8')),database=base.d1_databases.find(x=>x.binding==='DB'),api=cloudflareClient(base.account_id),db=remoteD1(api,database.database_id);
 if(project==='--list'){const {results}=await db.prepare("SELECT project_id,state FROM cms_instances WHERE state<>'ready' ORDER BY created_at LIMIT 5").all();console.log(JSON.stringify({instances:results}));return;}
 const before=await db.prepare('SELECT state FROM cms_instances WHERE project_id=?').bind(project).first();if(before?.state==='ready'){console.log('CMS is already initialized and connected; use /check-cms '+project);return;}
 const {allocateCMSResources}=await module('src/cms-provision.ts');console.log(JSON.stringify(await allocateCMSResources(db,project,cmsCloudflareProvider(base.account_id,api))));if(storageOnly)return;
 const row=await db.prepare('SELECT * FROM cms_instances WHERE project_id=?').bind(project).first();
 if(await db.prepare('SELECT project_id FROM cms_deployments WHERE project_id=?').bind(project).first())await lstat(resolve('.secrets/cms',project,'artifact'));
 else{const build=spawnSync(process.execPath,['tools/build-emdash.mjs'],{stdio:'inherit'});if(build.status!==0)throw Error('CMS build failed');}
 const snapshot=await frozenArtifact(project),template=JSON.parse(await readFile(join(snapshot.artifact,'server/wrangler.json'),'utf8')),master=await cmsMasterKey(db),{deriveCMSSecret}=await module('src/cms-bridge.ts'),origin='https://'+row.worker_name+'.digifender.com',secret=await deriveCMSSecret(master,project,row.user_id,origin);
 const config=instanceConfig(template,snapshot.artifact,row,base.account_id),configPath=join(snapshot.dir,'worker.json'),secretPath=join(snapshot.dir,'worker-secrets.json');
 await writeFile(configPath,JSON.stringify(config,null,2));await writeFile(secretPath,JSON.stringify({TOWNHELLO_CMS_BRIDGE_KEY:secret}),{mode:0o600});
 let probe;
 try{
  const {deployCMS,connectCMS}=await module('src/cms-deploy.ts');
  const result=await deployCMS(db,project,snapshot.digest,{projectId:project,ownerId:row.user_id,origin,secret},{accountId:base.account_id,exists:name=>workerExists(api,name),deploy:async(_name,tag)=>runWrangler(['deploy','--config',configPath,'--secrets-file',secretPath,'--tag',tag],join(snapshot.dir,'worker-deploy.log')),activeVersion:async(name,tag)=>(await activeWorker(api,name,tag))?.id??null,service:{async fetch(request){probe??=await privateCMSProbe(base.account_id,row.worker_name,origin,snapshot.dir);return probe.service.fetch(request);}}});
  console.log(JSON.stringify(result));const platform=await deployPlatform();if(!platform.projects.includes(project))throw Error('CMS was not included in the verified platform deployment');await connectCMS(db,project,platform.versionId);
  console.log('Private CMS initialized and connected for '+project+'. Public routing remains disabled.');
 }catch(error){await db.prepare("UPDATE cms_instances SET state='uncertain' WHERE project_id=? AND state<>'ready'").bind(project).run();throw error;}finally{await probe?.close();}
}
main().catch(error=>{console.error(error instanceof Error?error.message:'CMS provisioning failed');process.exitCode=1;});
