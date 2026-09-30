import {execFileSync} from 'node:child_process';
import {mkdir,readFile,writeFile,copyFile,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {verifyBuildSnapshot} from './build-snapshot.mjs';
import {workerOrder,copyTree,digest,same,fileInventory,migrationPlan,validateCompatibility,sealRelease,configFiles} from './release-manifest.mjs';
import {cmsServices} from './release-provider.mjs';

const sourceTrees=['src','frontend','web','tools'];
const sourceFiles=['package.json','pnpm-lock.yaml','vite.config.ts','tsconfig.json','tsconfig.frontend.json',...Object.values(configFiles)];
const supportedKeys=['$schema','name','account_id','main','compatibility_date','compatibility_flags','workers_dev','preview_urls','routes','vars','assets','d1_databases','services','r2_buckets','ratelimits','observability','triggers'];

export function archivedConfig(role,base,entry,cms){
 for(const key of Object.keys(base))if(!supportedKeys.includes(key))throw Error('New Worker configuration requires release archive support: '+key);
 if(base.name!=='whumpo-'+role||base.workers_dev!==false||base.preview_urls!==false)throw Error('Unexpected release destination');
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
  if(d.binding!=='DB'||d.database_name!=='whumpo-control'||d.migrations_dir!=='./migrations')throw Error('Unreviewed release database');
  return {...d,migrations_dir:'../migrations'};
 });
 config.services=[...(base.services??[]),...(role==='platform'?cmsServices(cms):[])].sort((a,b)=>a.binding.localeCompare(b.binding));
 if(new Set(config.services.map(s=>s.binding)).size!==config.services.length)throw Error('Duplicate service bindings');
 return config;
}

export async function prepareRelease(root,driver,review,{git=()=>({commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),dirty:!!execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim()})}={}){
 const build=await verifyBuildSnapshot(root),before=await driver.observe();
 if(review?.buildInputs!==build.inputs.sha256)throw Error('Compatibility review does not match the current build inputs');
 const migrationFiles=await fileInventory(join(root,'migrations')),migrations=migrationPlan(migrationFiles,before.migrations);
 validateCompatibility(review,migrations);
 const id=randomUUID(),directory=resolve(root,'.secrets/releases',id),payload=join(directory,'payload');
 await mkdir(payload,{recursive:true,mode:0o700});
 const source=join(payload,'source');await mkdir(source,{mode:0o700});
 for(const tree of sourceTrees)await copyTree(join(root,tree),join(source,tree));
 for(const name of sourceFiles){if(!(await lstat(join(root,name))).isFile())throw Error('Release source must be a regular file');await copyFile(join(root,name),join(source,name));}
 await copyTree(join(root,'migrations'),join(payload,'migrations'));
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
  if(!(await lstat(join(payload,'workers',role,entry))).isFile())throw Error('Worker bundle entry missing');
  await writeFile(join(payload,'config',role+'.json'),JSON.stringify(config,null,2)+'\n',{mode:0o600});
  workers[role]={name:base.name,config:'payload/config/'+role+'.json',tag:'whumpo-'+id.replaceAll('-','')+'-'+role,services:config.services};
 }
 if(!same(build,await verifyBuildSnapshot(root))||!same(before,await driver.observe()))throw Error('Build or remote baseline changed during preparation');
 // The older build guard does not cover all release tooling or migrations.
 for(const tree of sourceTrees)if(!same(await fileInventory(join(root,tree)),await fileInventory(join(source,tree))))throw Error('Release source changed during preparation');
 for(const name of sourceFiles)if(!(await readFile(join(root,name))).equals(await readFile(join(source,name))))throw Error('Release configuration changed during preparation');
 if(!same(migrationFiles,await fileInventory(join(payload,'migrations')))||!same(migrationFiles,await fileInventory(join(root,'migrations'))))throw Error('Migrations changed during preparation');
 for(const [role,path] of [['platform','dist'],['apps','public-app']])if(!same(await fileInventory(join(root,path)),await fileInventory(join(payload,'assets',role))))throw Error('Assets changed during preparation');
 const manifest=await sealRelease(directory,{id,createdAt:new Date().toISOString(),accountId:driver.configs.platform.account_id,controlDatabaseId:driver.configs.platform.d1_databases.find(d=>d.binding==='DB').database_id,source:git(),build,order:workerOrder,workers,before,cms:before.cms,migrations,compatibility:review,sourceDigest:digest(JSON.stringify(await fileInventory(source))),toolchain:{node:process.version,wrangler:JSON.parse(await readFile(join(root,'node_modules/wrangler/package.json'),'utf8')).version}});
 return {directory,manifest};
}
