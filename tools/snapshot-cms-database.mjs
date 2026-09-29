// Operator-only database recovery artifact. This is not a full CMS backup.
import {readFile,writeFile,mkdir,lstat,chmod} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {cloudflareClient,remoteD1} from './cms-cloudflare.mjs';
import {stableCMSDatabase,captureCMSDatabase,restoreCapturedCMSDatabase} from './cms-database-snapshot.mjs';
export async function cmsDatabaseIdentity(control,project,account){
 if(!/^[0-9a-f-]{36}$/.test(project)||!/^[0-9a-f]{32}$/.test(account))throw Error('Invalid CMS snapshot identity');
 const row=await control.prepare("SELECT c.project_id,c.user_id,c.worker_name,c.database_name,c.database_id,c.bucket_name,d.account_id,d.worker_version_id,d.source_digest FROM cms_instances c JOIN projects p ON p.id=c.project_id JOIN cms_deployments d ON d.project_id=c.project_id JOIN cms_resource_jobs r ON r.project_id=c.project_id AND r.kind='database' WHERE c.project_id=? AND c.state='ready' AND d.state='connected' AND c.user_id=p.owner_user_id AND r.state='complete' AND r.provider_id=c.database_id AND r.account_id=d.account_id").bind(project).first();
 const name='whumpo-cms-'+project.replaceAll('-','');
 if(!row||row.project_id!==project||row.account_id!==account||row.worker_name!==name||row.database_name!==name||row.bucket_name!==name+'-media'||!/^[0-9a-f-]{36}$/.test(row.database_id)||!/^[0-9a-f]{64}$/.test(row.source_digest))throw Error('CMS database identity is not verified');return row;
}
async function privateDirectory(parent,name){const dir=join(parent,name);try{await mkdir(dir,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}const info=await lstat(dir);if(!info.isDirectory()||info.isSymbolicLink())throw Error('Snapshot directories must be private local directories');await chmod(dir,0o700);return dir;}
async function main(){
 const args=process.argv.slice(2);if(args.length!==1)throw Error('Usage: npm run cms:snapshot-db -- PROJECT_ID | --list');
 const base=JSON.parse(await readFile('wrangler.jsonc','utf8')),api=cloudflareClient(base.account_id),control=remoteD1(api,base.d1_databases.find(x=>x.binding==='DB').database_id);
 if(args[0]==='--list'){const rows=await control.prepare("SELECT c.project_id FROM cms_instances c JOIN projects p ON p.id=c.project_id WHERE c.state='ready' AND c.user_id=p.owner_user_id ORDER BY c.project_id LIMIT 100").all();console.log(JSON.stringify({readyProjects:rows.results}));return;}
 const identity=await cmsDatabaseIdentity(control,args[0],base.account_id),native=remoteD1(api,identity.database_id);
 const capture=await stableCMSDatabase(async sql=>(await native.prepare(sql).all()).results);
 if(!capture.snapshot.tables.some(t=>t.name==='_emdash_migrations'))throw Error('Native EmDash database was not found');
 const isolated=new DatabaseSync(':memory:');
 try{restoreCapturedCMSDatabase(isolated,capture.snapshot);const check=await captureCMSDatabase(async sql=>isolated.prepare(sql).all());if(check.digest!==capture.digest)throw Error('Isolated database restore did not match the source');}finally{isolated.close();}
 const after=await cmsDatabaseIdentity(control,args[0],base.account_id);if(JSON.stringify(after)!==JSON.stringify(identity))throw Error('CMS identity changed during capture');
 let dir=await privateDirectory(resolve('.'),'.secrets');dir=await privateDirectory(dir,'cms-database-snapshots');dir=await privateDirectory(dir,args[0]);dir=await privateDirectory(dir,randomUUID());
 await writeFile(join(dir,'database.json'),JSON.stringify(capture.snapshot),{flag:'wx',mode:0o600});
 const manifest={format:'whumpo-cms-database-manifest-v1',createdAt:new Date().toISOString(),identity,digest:capture.digest,rows:capture.rows,tables:capture.snapshot.tables.length,consistency:'two-equal-logical-captures',isolatedSQLiteRestoreVerified:true,completeCMSBackup:false,notIncluded:['R2 media bytes','KV sessions','Worker secrets','compiled Worker artifact','Whumpo control database and public snapshots']};
 // Manifest is the completion marker, written only after successful isolated restore.
 await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});
 console.log('Verified native database snapshot saved to '+dir+'. Media and full CMS recovery are not included.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(()=>{console.error('CMS database snapshot was not completed. Check the registry, provider access and snapshot limits; no live CMS data was changed.');process.exitCode=1;});
