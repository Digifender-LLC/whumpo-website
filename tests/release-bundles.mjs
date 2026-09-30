// Actual Wrangler bundle -> archived no-bundle input round trip. No account,
// deployment, CMS instance or model/provider operation is used by this test.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {compileWorker} from '../tools/release-provider.mjs';
import {archivedConfig} from '../tools/prepare-release.mjs';
import {workerOrder,configFiles,copyTree,fileInventory} from '../tools/release-manifest.mjs';
import {runWrangler} from '../tools/cms-release.mjs';
import {fixtureEnvironment} from '../tools/verify.mjs';

const root=process.cwd(),directory=await mkdtemp(join(tmpdir(),'whumpo-release-bundles-'));
try{
 if((await readdir(root)).some(n=>/^\.(?:dev\.vars|env)(?:\.|$)/.test(n)))throw Error('Use a checkout without local .env/.dev.vars files');
 const env=fixtureEnvironment(process.env,join(directory,'home'));
 await mkdir(env.HOME);const payload=join(directory,'payload');await mkdir(join(payload,'config'),{recursive:true});
 await copyTree('dist',join(payload,'assets/platform'));await copyTree('public-app',join(payload,'assets/apps'));await copyTree('migrations',join(payload,'migrations'));
 for(const role of workerOrder){
  const base=JSON.parse(await readFile(configFiles[role],'utf8')),out=join(payload,'workers',role);
  const entry=await compileWorker(root,role,base,out,directory,{env});
  const config=archivedConfig(role,base,entry,[]),path=join(payload,'config',role+'.json');
  await writeFile(path,JSON.stringify(config));
  const pinned=await fileInventory(payload);
  const replay=join(directory,'replay',role);
  await runWrangler(['deploy','--config',path,'--no-bundle','--dry-run','--outdir',replay],join(directory,role+'-replay.log'),{env});
  assert.deepEqual(await fileInventory(payload),pinned,'Wrangler modified the archived payload');
  const originals=(await fileInventory(out)).filter(f=>f.path.endsWith('.js')||f.path.endsWith('.wasm'));
  const replays=await fileInventory(replay);
  for(const file of originals){const found=replays.find(f=>f.path===file.path);assert.ok(found,'Missing archived module: '+role+'/'+file.path);assert.equal(found.sha256,file.sha256,'Rebuilt or changed module: '+role+'/'+file.path);}
  if(role==='runtime')assert.ok(originals.some(f=>f.path.endsWith('.wasm')));
  console.log('Archived bundle round trip passed: '+role+' ('+originals.length+' executable modules).');
 }
}catch(error){
 // Only failure summaries, never raw Wrangler logs, are printed.
 console.error('Bundle evidence retained at '+directory);throw error;
}
// Keep failures available privately for diagnostics; success needs no temp data.
await rm(directory,{recursive:true,force:true});
