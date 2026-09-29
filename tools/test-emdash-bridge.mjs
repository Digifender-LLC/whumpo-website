import wrangler from 'wrangler';
import {DatabaseSync} from 'node:sqlite';
import {stableCMSDatabase,captureCMSDatabase,restoreCapturedCMSDatabase} from './cms-database-snapshot.mjs';
// Reproducible disposable local EmDash + private service-binding acceptance.
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
const build=spawnSync(process.execPath,['tools/build-emdash.mjs'],{stdio:'inherit'});if(build.status!==0)process.exit(build.status||1);
// Do not accidentally run against another developer's process.
try{await fetch('http://localhost:8799');throw Error('Port 8799 is already in use; stop its test server first.');}catch(error){if(error.message.includes('already in use'))throw error;}
const dir=await mkdtemp(join(tmpdir(),'whumpo-emdash-')),source=resolve('integrations/emdash/dist/server/wrangler.json'),config=JSON.parse(await readFile(source,'utf8'));
config.main=resolve(dirname(source),config.main);config.assets.directory=resolve(dirname(source),config.assets.directory);
config.vars={WHUMPO_CMS_PROJECT_ID:'11111111-1111-4111-8111-111111111111',WHUMPO_CMS_OWNER_ID:'22222222-2222-4222-8222-222222222222',WHUMPO_CMS_BRIDGE_KEY:'local-cms-bridge-fixture-'.repeat(3),WHUMPO_CMS_ORIGIN:'https://cms.test',EMDASH_SITE_URL:'https://cms.test'};
delete config.triggers;
await writeFile(join(dir,'cms.json'),JSON.stringify(config));
await writeFile(join(dir,'probe.mjs'),"export default {fetch(request,env){const u=new URL(request.url);return env.CMS.fetch(new Request('https://cms.test'+u.pathname+u.search,request));}};");
await writeFile(join(dir,'probe.json'),JSON.stringify({name:'whumpo-cms-local-probe',main:'probe.mjs',compatibility_date:'2026-09-29',workers_dev:false,preview_urls:false,services:[{binding:'CMS',service:config.name}]}));
let logs='',server;
try{
 server=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--config',join(dir,'probe.json'),'--config',join(dir,'cms.json'),'--port','8799','--persist-to',join(dir,'state')],{stdio:['ignore','pipe','pipe']});
 for(const stream of [server.stdout,server.stderr])stream.on('data',data=>{logs=(logs+data.toString()).slice(-12000);});
 let ready=false;
 for(let i=0;i<120;i++){
  if(server.exitCode!==null)throw Error('Local CMS server exited: '+logs);
  try{const r=await fetch('http://localhost:8799/_emdash/api/setup/status');if(r.status===403){ready=true;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 if(!ready)throw Error('Local CMS did not start: '+logs);
 const result=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['tests/emdash-bridge-live.mjs'],{stdio:'inherit'});child.once('error',reject);child.once('exit',resolve);});
 if(result!==0)throw Error('EmDash acceptance failed: '+logs);
 const proxy=await wrangler.getPlatformProxy({configPath:join(dir,'cms.json'),persist:{path:join(dir,'state','v3')},remoteBindings:false});
 const restored=new DatabaseSync(':memory:');
 try{const captured=await stableCMSDatabase(async sql=>(await proxy.env.DB.prepare(sql).all()).results);restoreCapturedCMSDatabase(restored,captured.snapshot);const roundtrip=await captureCMSDatabase(async sql=>restored.prepare(sql).all());if(roundtrip.digest!==captured.digest)throw Error('Native CMS restore differs from source');console.log('Actual EmDash database snapshot restored with identical logical digest ('+captured.snapshot.tables.length+' tables, '+captured.rows+' rows).');}finally{restored.close();await proxy.dispose();}
}finally{
 if(server&&server.exitCode===null){server.kill('SIGTERM');await new Promise(resolve=>{server.once('exit',resolve);setTimeout(()=>{if(server.exitCode===null)server.kill('SIGKILL');resolve();},4000);});}
 await rm(dir,{recursive:true,force:true});
}
