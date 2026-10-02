import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile,copyFile,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {verifyBuildSnapshot} from './build-snapshot.mjs';
import {workerOrder,copyTree,digest,same,fileInventory,validateCompatibility,sealRelease,configFiles} from './release-manifest.mjs';
import {cmsServices} from './release-provider.mjs';
import {currentSchemaArtifact,currentSchemaPlan} from './current-schema.mjs';
import {assertArtifactConfiguration} from './artifact-protection.mjs';

const sourceTrees=['src','frontend','web','tools','compiler-locks','schema'];
const sourceFiles=['package.json','pnpm-lock.yaml','vite.config.ts','tsconfig.json','tsconfig.frontend.json',...Object.values(configFiles)];
const supportedKeys=['$schema','name','account_id','main','compatibility_date','compatibility_flags','workers_dev','preview_urls','routes','vars','assets','d1_databases','services','r2_buckets','ratelimits','observability','triggers'];

export function expectedServiceBindings(services){
 return services.map(({binding,service,entrypoint,...extra})=>{
  if(Object.keys(extra).length)throw Error('New service binding fields require release archive support');
  // The version API reports the script's default environment explicitly, even
  // when Wrangler config omits it. This is not Whumpo's ENVIRONMENT variable.
  return {binding,service,environment:'production',...(entrypoint?{entrypoint}:{})};
 }).sort((a,b)=>a.binding.localeCompare(b.binding));
}

export function archivedConfig(role,base,entry,cms){
 assertArtifactConfiguration(base);
 for(const key of Object.keys(base))if(!supportedKeys.includes(key))throw Error('New Worker configuration requires release archive support: '+key);
 if(base.name!=='tellumo-'+role||base.workers_dev!==false||base.preview_urls!==false)throw Error('Unexpected release destination');
 const config={...base};delete config.$schema;
 config.main='../workers/'+role+'/'+entry;
 config.base_dir='../workers/'+role;
 config.no_bundle=true;config.find_additional_modules=true;
 config.rules=[{type:'ESModule',globs:['**/*.js'],fallthrough:true}];
 if(config.assets){
  if(!['apps','platform'].includes(role))throw Error('Unsupported asset host');
  config.assets={...config.assets,directory:'../assets/'+role};
 }
 if(config.d1_databases)config.d1_databases=config.d1_databases.map(d=>{
  if(d.binding!=='DB'||!d.database_name||!d.database_id||Object.hasOwn(d,'migrations_dir'))throw Error('Unreviewed release database');
  return {...d};
 });
 config.services=[...(base.services??[]),...(role==='platform'?cmsServices(cms):[])].sort((a,b)=>a.binding.localeCompare(b.binding));
 if(new Set(config.services.map(s=>s.binding)).size!==config.services.length)throw Error('Duplicate service bindings');
 return config;
}

export async function prepareRelease(root,driver,review,{git=()=>({commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),dirty:!!execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim()})}={}){
 for(const role of workerOrder)assertArtifactConfiguration(driver.configs[role]);
 if(driver.configs.platform.vars?.ENVIRONMENT!=='test')throw Error('Only the test platform may be released');
 const build=await verifyBuildSnapshot(root),before=await driver.observe();
 if(review?.buildInputs!==build.inputs.sha256)throw Error('Compatibility review does not match the current build inputs');
 const artifact=await currentSchemaArtifact(root),schema=currentSchemaPlan(artifact,before.schema);
 validateCompatibility(review,schema);
 const database=driver.configs.platform.d1_databases.find(d=>d.binding==='DB');
 for(const role of ['apps','sites'])if(!same(driver.configs[role].d1_databases,driver.configs.platform.d1_databases))throw Error('All control database bindings must select the same current database');
 const baselineDatabase=before.workers.platform.databases.find(d=>d.binding==='DB');
 if(!baselineDatabase)throw Error('Active platform database binding is missing');
 if(schema.mode==='initialize'){
  if(Object.values(before.workers).some(w=>w.databases.some(d=>d.id===database.database_id)))throw Error('Schema initialization requires a new database not bound to an active Worker');
  if(before.cms.length)throw Error('Registered CMS resources need an explicit retirement review before an account reset');
 }else if(baselineDatabase.id!==database.database_id)throw Error('Database replacement must start from an empty reviewed database');
 const id=randomUUID(),directory=resolve(root,'.secrets/releases',id),payload=join(directory,'payload');
 await mkdir(payload,{recursive:true,mode:0o700});
 const source=join(payload,'source');await mkdir(source,{mode:0o700});
 for(const tree of sourceTrees)await copyTree(join(root,tree),join(source,tree));
 for(const name of sourceFiles){if(!(await lstat(join(root,name))).isFile())throw Error('Release source must be a regular file');await copyFile(join(root,name),join(source,name));}
 await mkdir(join(payload,'schema'),{mode:0o700});
 await writeFile(join(payload,'schema/current.sql'),artifact.sql,{mode:0o600});
 await copyTree(join(root,'dist'),join(payload,'assets/platform'));
 await copyTree(join(root,'public-app'),join(payload,'assets/apps'));
 await mkdir(join(payload,'config'),{recursive:true,mode:0o700});
 const workers={};
 for(const role of workerOrder){
  const base=driver.configs[role];
  if(!same(base,JSON.parse(await readFile(join(source,configFiles[role]),'utf8'))))throw Error('Loaded configuration differs from archived source');
  if(base.account_id!==driver.configs.platform.account_id)throw Error('Cross-account release refused');
  const entry=await driver.compile(role,base,join(payload,'workers',role),directory);
  const config=archivedConfig(role,base,entry,before.cms);
  const services=expectedServiceBindings(config.services);
  if(!(await lstat(join(payload,'workers',role,entry))).isFile())throw Error('Worker bundle entry missing');
  await writeFile(join(payload,'config',role+'.json'),JSON.stringify(config,null,2)+'\n',{mode:0o600});
  workers[role]={databases:(base.d1_databases??[]).map(d=>({binding:d.binding,id:d.database_id})).sort((a,b)=>a.binding.localeCompare(b.binding)),name:base.name,config:'payload/config/'+role+'.json',tag:'whumpo-'+id.replaceAll('-','')+'-'+role,services};
 }
 if(!same(build,await verifyBuildSnapshot(root))||!same(before,await driver.observe()))throw Error('Build or remote baseline changed during preparation');
 // Archive every source input, including release tooling and complete schema.
 for(const tree of sourceTrees)if(!same(await fileInventory(join(root,tree)),await fileInventory(join(source,tree))))throw Error('Release source changed during preparation');
 for(const name of sourceFiles)if(!(await readFile(join(root,name))).equals(await readFile(join(source,name))))throw Error('Release configuration changed during preparation');
 if(!same(artifact,await currentSchemaArtifact(root))||(await readFile(join(payload,'schema/current.sql'),'utf8'))!==artifact.sql)throw Error('Current schema changed during preparation');
 for(const [role,path] of [['platform','dist'],['apps','public-app']])if(!same(await fileInventory(join(root,path)),await fileInventory(join(payload,'assets',role))))throw Error('Assets changed during preparation');
 const manifest=await sealRelease(directory,{id,createdAt:new Date().toISOString(),accountId:driver.configs.platform.account_id,controlDatabaseId:driver.configs.platform.d1_databases.find(d=>d.binding==='DB').database_id,source:git(),build,order:workerOrder,workers,before,cms:before.cms,schema,compatibility:review,sourceDigest:digest(JSON.stringify(await fileInventory(source))),toolchain:{node:process.version,wrangler:JSON.parse(await readFile(join(root,'node_modules/wrangler/package.json'),'utf8')).version}});
 return {directory,manifest};
}
