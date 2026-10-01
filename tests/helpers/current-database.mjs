import {sqliteD1} from '../sqlite-d1.mjs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {resolve as pathResolve} from 'node:path';
export async function databaseFixture(){
 if(process.argv.length===2)return sqliteD1();
 if(process.argv.length!==3||process.argv[2]!=='--d1')throw Error('Choose SQLite or --d1');
 const directory=await mkdtemp('/tmp/whumpo-feature-inclusion-'),config=directory+'/wrangler.json';
 try{
  await writeFile(config,JSON.stringify({name:'whumpo-feature-inclusion-local',compatibility_date:'2026-09-29',d1_databases:[{binding:'DB',database_name:'feature-inclusion-local',database_id:crypto.randomUUID(),migrations_dir:pathResolve('migrations')}]}));
  execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','feature-inclusion-local','--local','--config',config,'--persist-to',directory+'/state'],{stdio:'pipe',maxBuffer:16*1024*1024,env:{PATH:process.env.PATH,CI:'true',WRANGLER_SEND_METRICS:'false'}});
  const {getPlatformProxy}=await import('wrangler'),proxy=await getPlatformProxy({configPath:config,persist:{path:directory+'/state/v3'},remoteBindings:false});
  return {db:proxy.env.DB,close:async()=>{await proxy.dispose();await rm(directory,{recursive:true,force:true});}};
 }catch(error){await rm(directory,{recursive:true,force:true});throw error;}
}
