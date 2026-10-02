import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,basename} from 'node:path';
import {cloudflareClient,remoteD1} from './cms-cloudflare.mjs';
import {activeWorker,runWrangler} from './cms-release.mjs';
import {withPlatformLock,deployPlatform} from './deploy-platform.mjs';
import {inspectSchema} from './current-schema.mjs';
import {configFiles,workerOrder,readJSON,verifyRelease,same} from './release-manifest.mjs';
import {secretBindingReadback} from './secret-custody.mjs';

export function bindingSummary(bindings){
 secretBindingReadback(bindings);
 return {
  databases:bindings.filter(b=>b.type==='d1').map(b=>({binding:b.name,id:b.id})).sort((a,b)=>a.binding.localeCompare(b.binding)),
  services:bindings.filter(b=>b.type==='service').map(b=>({binding:b.name,service:b.service,...(b.environment?{environment:b.environment}:{}),...(b.entrypoint?{entrypoint:b.entrypoint}:{})})).sort((a,b)=>a.binding.localeCompare(b.binding)),
  secrets:bindings.filter(b=>b.type==='secret_text').map(b=>b.name).sort()
 };
}
export async function cmsInventory(db){
 const {results}=await db.prepare(`SELECT c.project_id,c.user_id,c.review_id,c.worker_name,c.database_name,c.bucket_name,c.state,c.database_id,c.session_namespace_id,c.deployed_version_id,c.created_at,
 d.account_id,d.source_digest,d.secret_digest,d.origin,d.tag,d.state deployment_state,d.worker_version_id,d.platform_version_id
 FROM cms_instances c LEFT JOIN cms_deployments d ON d.project_id=c.project_id ORDER BY c.project_id`).all();
 return results;
}
export function cmsServices(cms){
 return cms.filter(c=>['verified','connected'].includes(c.deployment_state)).map(c=>{
  if(c.worker_name!=='townhello-cms-'+c.project_id.replaceAll('-',''))throw Error('Invalid CMS registration');
  return {binding:'CMS_'+c.project_id.replaceAll('-',''),service:c.worker_name};
 });
}
export function resolveConfig(config,directory){
 return {...config,main:resolve(directory,config.main),...(config.base_dir?{base_dir:resolve(directory,config.base_dir)}:{}),...(config.assets?{assets:{...config.assets,directory:resolve(directory,config.assets.directory)}}:{})};
}
export async function compileWorker(root,role,config,output,directory,options){
 const file=join(directory,role+'-build.json');
 const c=resolveConfig(config,root);delete c.$schema;
 await writeFile(file,JSON.stringify(c),{mode:0o600});
 await mkdir(output,{recursive:true,mode:0o700});
 await runWrangler(['deploy','--config',file,'--dry-run','--outdir',output],join(directory,role+'-build.log'),options);
 return basename(config.main).replace(/\.[^.]+$/,'.js');
}
export async function releaseProvider(root=process.cwd()){
 const configs=Object.fromEntries(await Promise.all(workerOrder.map(async role=>[role,await readJSON(join(root,configFiles[role]))])));
 const base=configs.platform,api=cloudflareClient(base.account_id),db=remoteD1(api,base.d1_databases.find(b=>b.binding==='DB').database_id);
 return {
  configs,
  withLock:(manifest,work)=>withPlatformLock(remoteD1(api,manifest.before.workers.platform.databases.find(d=>d.binding==='DB').id),work),
  async verifyToolchain(manifest,directory){
   if(Number(process.versions.node.split('.')[0])!==24||JSON.parse(await readFile(join(root,'node_modules/wrangler/package.json'),'utf8')).version!==manifest.toolchain.wrangler)throw Error('Restore the pinned Node/Wrangler toolchain before applying this release');
   for(const name of ['deploy.mjs','release-manifest.mjs','prepare-release.mjs','release-provider.mjs','deploy-platform.mjs','cms-release.mjs','cms-cloudflare.mjs','current-schema.mjs'])if(!(await readFile(join(root,'tools',name))).equals(await readFile(join(directory,'payload/source/tools',name))))throw Error('Release tooling changed; restore the archived tools before applying');
   if(manifest.cms.length&&!(await readFile(join(root,'src/cms-bridge.ts'))).equals(await readFile(join(directory,'payload/source/src/cms-bridge.ts'))))throw Error('CMS key derivation source changed');
  },
  async observe(manifest){
   if(manifest&&manifest.accountId!==base.account_id)throw Error('Release belongs to another account');
   if(manifest&&manifest.controlDatabaseId!==base.d1_databases.find(b=>b.binding==='DB').database_id)throw Error('Release control database differs from current operator configuration');
   const workers={};
   for(const role of workerOrder){
    const name=manifest?.workers[role].name??configs[role].name,active=await activeWorker(api,name);
    if(!active)throw Error('Expected one active version for each Worker');
    const version=(await api('/workers/scripts/'+name+'/versions/'+active.id)).result;
    workers[role]={id:active.id,tag:version.annotations?.['workers/tag']??null,...bindingSummary(active.bindings)};
   }
   const schema=await inspectSchema(db);
   const baselineId=manifest?.before.workers.platform.databases.find(d=>d.binding==='DB').id??workers.platform.databases.find(d=>d.binding==='DB')?.id;
   if(!baselineId)throw Error('Active platform database binding is missing');
   const cms=await cmsInventory(remoteD1(api,baselineId));
   if(schema.objects&&baselineId!==base.d1_databases.find(b=>b.binding==='DB').database_id&& !same(cms,await cmsInventory(db)))throw Error('Replacement database CMS registry differs');
   return {workers,cms,schema};
  },
  compile:(role,config,output,directory)=>compileWorker(root,role,config,output,directory),
  async initialize(manifest,directory){
   if((await inspectSchema(db)).objects!==0)throw Error('Schema initialization requires an empty database');
   await runWrangler(['d1','execute','DB','--remote','--yes','--config',join(directory,'payload/config/platform.json'),'--file',join(directory,'payload/schema/current.sql')],join(directory,'schema.log'));
  },
  async deploy(role,manifest,directory,guard,onDeployed){
   const path=join(directory,'payload/config',role+'.json'),config=resolveConfig(await readJSON(path),join(directory,'payload/config'));
   if(role==='platform'){
    await deployPlatform({config,api,db,guard,schema:manifest.schema.expected,tag:manifest.workers[role].tag,logFile:join(directory,role+'-deploy.log'),onDeployed,verify:async()=>{
     await verifyRelease(directory);
     if(!same(manifest.cms,await cmsInventory(db)))throw Error('CMS registrations changed');
    }});
   }else{
    await runWrangler(['deploy','--config',path,'--no-bundle','--tag',manifest.workers[role].tag],join(directory,role+'-deploy.log'));
    await onDeployed();
   }
  }
 };
}
