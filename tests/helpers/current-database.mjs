import {sqliteD1,unavailableAuthorizerProbe} from '../sqlite-d1.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {currentSchema} from '../../tools/current-schema.mjs';
import {execFileSync} from 'node:child_process';
// `probe` opts the in-memory fixture into the report-only SQLite authorizer; miniflare fixtures report it as unavailable.
export async function databaseFixture({d1=false,r2=false,allowedArguments=[],probe=false}={}){
 if(process.argv.slice(2).some(arg=>arg!=='--d1'&&!allowedArguments.includes(arg)))throw Error('Unsupported fixture argument');
 if(new Set(process.argv.slice(2)).size!==process.argv.length-2)throw Error('Repeated fixture argument');
 if(!d1&&!r2&&process.argv.length===2)return sqliteD1({probe});
 const directory=await mkdtemp('/tmp/whumpo-feature-inclusion-'),config=directory+'/wrangler.json';
 try{
  await writeFile(config,JSON.stringify({name:'whumpo-feature-inclusion-local',compatibility_date:'2026-09-29',d1_databases:[{binding:'DB',database_name:'feature-inclusion-local',database_id:crypto.randomUUID()}],...(r2?{r2_buckets:[{binding:'FILES',bucket_name:'whumpo-fixture-files'}]}:{})}));
  await writeFile(directory+'/schema.sql',await currentSchema());
  execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','execute','feature-inclusion-local','--local','--config',config,'--file',directory+'/schema.sql','--persist-to',directory+'/state'],{stdio:'pipe',maxBuffer:16*1024*1024,env:{PATH:process.env.PATH,CI:'true',WRANGLER_SEND_METRICS:'false'}});
  const {getPlatformProxy}=await import('wrangler'),proxy=await getPlatformProxy({configPath:config,persist:{path:directory+'/state/v3'},remoteBindings:false});
  return {db:proxy.env.DB,env:proxy.env,...(probe?{authorizer:unavailableAuthorizerProbe}:{}),close:async()=>{await proxy.dispose();await rm(directory,{recursive:true,force:true});}};
 }catch(error){await rm(directory,{recursive:true,force:true});throw error;}
}
