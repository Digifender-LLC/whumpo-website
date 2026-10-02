import {currentSchemaArtifact,inspectSchema} from './current-schema.mjs';
import {verifyBuildSnapshot} from './build-snapshot.mjs';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {build} from 'esbuild';
import {cloudflareClient,remoteD1} from './cms-cloudflare.mjs';
import {cmsMasterKey,runWrangler,activeWorker} from './cms-release.mjs';
import {assertArtifactConfiguration} from './artifact-protection.mjs';
export async function withPlatformLock(db,work){
 const token=crypto.randomUUID();
 await db.prepare("UPDATE cms_platform_deploy_lock SET token=?,expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+15 minutes') WHERE id=1 AND expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now')").bind(token).run();
 if((await db.prepare('SELECT token FROM cms_platform_deploy_lock WHERE id=1').first())?.token!==token)throw Error('Another platform deployment is active; inspect its process before retrying');
 const guard=async()=>{
  const result=await db.prepare("UPDATE cms_platform_deploy_lock SET expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now','+15 minutes') WHERE id=1 AND token=? AND expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now') RETURNING token").bind(token).first();
  if(result?.token!==token)throw Error('Deployment lease expired or changed; reconcile before retrying');
 };
 try{return await work(guard);}finally{await db.prepare("UPDATE cms_platform_deploy_lock SET expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1 AND token=?").bind(token).run();}
}
export async function deployPlatform(prepared){
 const base=prepared?.config??JSON.parse(await readFile('wrangler.jsonc','utf8'));
 assertArtifactConfiguration(base);
 if(prepared)await prepared.verify();else await verifyBuildSnapshot();
 const api=prepared?.api??cloudflareClient(base.account_id),db=prepared?.db??remoteD1(api,base.d1_databases.find(x=>x.binding==='DB').database_id);
 const expectedSchema=prepared?.schema??(await currentSchemaArtifact()).expected;
 const verifySchema=async()=>{if(JSON.stringify(await inspectSchema(db))!==JSON.stringify(expectedSchema))throw Error('Platform deployment requires the complete current schema; use the reviewed four-Worker cutover');};
 const work=async guard=>{
 await guard();await verifySchema();
 try{
  const {results:instances}=await db.prepare("SELECT c.*,d.origin,d.secret_digest FROM cms_instances c JOIN cms_deployments d ON d.project_id=c.project_id WHERE d.state IN ('verified','connected') ORDER BY c.project_id").all();
  if(instances.length>5)throw Error('CMS binding capacity exceeded');
  const dir=resolve('.secrets/cms');await mkdir(dir,{recursive:true,mode:0o700});const configPath=resolve(dir,'platform.json'),secretPath=resolve(dir,'platform-secrets.json');
  const config={...base,main:resolve(base.main),assets:{...base.assets,directory:resolve(base.assets.directory)},d1_databases:base.d1_databases.map(d=>({...d})),services:[...(base.services??[])]};
  if(prepared){
   await prepared.verify();
   const services=instances.map(row=>({binding:'CMS_'+row.project_id.replaceAll('-',''),service:row.worker_name}));
   if(JSON.stringify(services)!==JSON.stringify(base.services.filter(s=>s.binding.startsWith('CMS_'))))throw Error('Prepared CMS bindings no longer match the registry');
   // They are re-added only after validating the existing master key below.
   config.services=config.services.filter(s=>!s.binding.startsWith('CMS_'));
  }
  const args=['deploy','--config',configPath,...(prepared?['--no-bundle','--tag',prepared.tag]:[])];
  if(instances.length){
   const master=await cmsMasterKey(db),code=await build({entryPoints:['src/cms-bridge.ts'],bundle:true,format:'esm',platform:'node',write:false}),{deriveCMSSecret}=await import('data:text/javascript;base64,'+Buffer.from(code.outputFiles[0].text).toString('base64'));
   const {createHash}=await import('node:crypto');
   for(const row of instances){
    if(row.worker_name!=='townhello-cms-'+row.project_id.replaceAll('-',''))throw Error('Invalid CMS service registry');
    const secret=await deriveCMSSecret(master,row.project_id,row.user_id,row.origin);if(createHash('sha256').update(secret).digest('hex')!==row.secret_digest)throw Error('CMS master key does not match existing instance');
    const binding='CMS_'+row.project_id.replaceAll('-','');if(config.services.some(s=>s.binding===binding))throw Error('Duplicate CMS binding');config.services.push({binding,service:row.worker_name});
   }
   await writeFile(secretPath,JSON.stringify({CMS_BRIDGE_MASTER_KEY:master}),{mode:0o600});args.push('--secrets-file',secretPath);
  }
  await guard();await verifySchema();if(prepared)await prepared.verify();
  await writeFile(configPath,JSON.stringify(config,null,2),{mode:0o600});await runWrangler(args,prepared?.logFile??resolve(dir,'platform-deploy.log'));
  if(prepared)await prepared.onDeployed();
  const active=await activeWorker(api,base.name,prepared?.tag);if(!active)throw Error('Platform deployment did not resolve to one active version');
  for(const row of instances)if(!active.bindings.some(b=>b.name==='CMS_'+row.project_id.replaceAll('-','')&&b.type==='service'&&b.service===row.worker_name))throw Error('CMS platform binding was not verified');
  if(instances.length&&!active.bindings.some(b=>b.name==='CMS_BRIDGE_MASTER_KEY'&&b.type==='secret_text'))throw Error('CMS master secret binding missing');
  console.log('Platform deployment verified: '+active.id);return {versionId:active.id,projects:instances.map(x=>x.project_id)};
 }finally{await guard();}
 };
 return prepared?.guard?work(prepared.guard):withPlatformLock(db,work);
}
if(process.argv[1]===new URL(import.meta.url).pathname)await deployPlatform();
