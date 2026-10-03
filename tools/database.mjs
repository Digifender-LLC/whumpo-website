import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {getPlatformProxy} from 'wrangler';
import {runWrangler} from './cms-release.mjs';
import {currentSchemaArtifact,currentSchemaPlan,inspectSchema} from './current-schema.mjs';

// Remote initialization belongs to the archived release journal. This command
// operates only on Wrangler's local state and never resets an occupied database.
export async function localDatabase(command,{root=process.cwd(),persistTo=resolve(root,'.wrangler/state')}={}){
 if(!['initialize','status'].includes(command))throw Error('Choose initialize or status');
 const config=JSON.parse(await readFile(join(root,'wrangler.jsonc'),'utf8'));
 const binding=config.d1_databases.find(d=>d.binding==='DB');
 if(!binding||Object.hasOwn(binding,'migrations_dir'))throw Error('Configure one current database without numbered migrations');
 const directory=await mkdtemp(join(tmpdir(),'whumpo-schema-')),configPath=join(directory,'wrangler.json');
 try{
  await writeFile(configPath,JSON.stringify({name:'whumpo-schema-local',compatibility_date:config.compatibility_date,d1_databases:[binding]}),{mode:0o600});
  const observe=async()=>{
   const proxy=await getPlatformProxy({configPath,persist:{path:join(persistTo,'v3')},remoteBindings:false});
   try{return await inspectSchema(proxy.env.DB);}finally{await proxy.dispose();}
  };
  const artifact=await currentSchemaArtifact(root),before=await observe();
  if(command==='status')return {current:JSON.stringify(before)===JSON.stringify(artifact.expected),observed:before,expected:artifact.expected};
  const plan=currentSchemaPlan(artifact,before);
  if(plan.mode==='initialize'){
   const file=join(directory,'current.sql');await writeFile(file,artifact.sql,{mode:0o600});
   await runWrangler(['d1','execute','DB','--local','--yes','--config',configPath,'--persist-to',persistTo,'--file',file],join(directory,'initialize.log'));
  }
  const after=await observe();
  if(JSON.stringify(after)!==JSON.stringify(artifact.expected))throw Error('Local schema initialization was not confirmed; observed '+JSON.stringify(after)+'; expected '+JSON.stringify(artifact.expected));
  return {current:true,initialized:plan.mode==='initialize',schema:after};
 }finally{await rm(directory,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 try{
  if(args.length!==1)throw Error('Usage: node tools/database.mjs initialize|status (local only)');
  console.log(JSON.stringify(await localDatabase(args[0]),null,2));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
