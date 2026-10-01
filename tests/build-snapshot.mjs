import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {saveBuildSnapshot,verifyBuildSnapshot,readBuildInputs} from '../tools/build-snapshot.mjs';
import {deployPlatform} from '../tools/deploy-platform.mjs';
const dir=await mkdtemp('/tmp/whumpo-build-snapshot-');
try{
 for(const d of ['src','frontend','web','public','public-app','tools','dist','compiler-locks'])await mkdir(join(dir,d));
 for(const f of ['package.json','pnpm-lock.yaml','vite.config.ts','tsconfig.json','tsconfig.frontend.json','wrangler.jsonc','wrangler.apps.jsonc','wrangler.sites.jsonc','wrangler.runtime.jsonc','tools/build.mjs','tools/build-pwa.mjs','tools/build-snapshot.mjs','tools/deploy-platform.mjs','tools/check-specification-compiler.mjs','compiler-locks/project-content-v1.json','tools/check-service-client-compiler.mjs','compiler-locks/project-service-clients-v1.json'])await writeFile(join(dir,f),'fixture');
 await writeFile(join(dir,'public-app/visitor.js'),'generated visitor');
 await writeFile(join(dir,'src/index.ts'),'version one');await writeFile(join(dir,'dist/index.html'),'built asset');
 await assert.rejects(()=>verifyBuildSnapshot(dir));
 const cwd=process.cwd();try{process.chdir(dir);await assert.rejects(()=>deployPlatform(),/Build snapshot missing or changed/);}finally{process.chdir(cwd);}
 const first=await saveBuildSnapshot(dir);assert.deepEqual(await verifyBuildSnapshot(dir),first);
 await writeFile(join(dir,'.secrets/provider.key'),'PRIVATE_FIXTURE');assert.deepEqual(await verifyBuildSnapshot(dir),first);
 assert.ok(!(await readFile(join(dir,'.secrets/build-snapshot.json'),'utf8')).includes('PRIVATE_FIXTURE'));
 for(const path of ['tools/build-pwa.mjs','src/index.ts','dist/index.html','public-app/visitor.js','pnpm-lock.yaml','tools/deploy-platform.mjs','tools/check-specification-compiler.mjs','compiler-locks/project-content-v1.json','tools/check-service-client-compiler.mjs','compiler-locks/project-service-clients-v1.json']){
  const original=await readFile(join(dir,path));await writeFile(join(dir,path),'changed');await assert.rejects(()=>verifyBuildSnapshot(dir));await writeFile(join(dir,path),original);assert.deepEqual(await verifyBuildSnapshot(dir),first);
 }
 for(const path of ['src/extra.ts','dist/extra.js']){
  await writeFile(join(dir,path),'added');await assert.rejects(()=>verifyBuildSnapshot(dir));await rm(join(dir,path));assert.deepEqual(await verifyBuildSnapshot(dir),first);
 }
 // Required lock/checker removal must fail closed, not silently shrink inputs.
 for(const path of ['compiler-locks/project-content-v1.json','compiler-locks/project-service-clients-v1.json','tools/check-specification-compiler.mjs','tools/check-service-client-compiler.mjs']){
  const original=await readFile(join(dir,path));await rm(join(dir,path));
  await assert.rejects(()=>saveBuildSnapshot(dir),{code:'ENOENT'});await assert.rejects(()=>verifyBuildSnapshot(dir));
  await writeFile(join(dir,path),original);assert.deepEqual(await verifyBuildSnapshot(dir),first);
 }
 const before=await readBuildInputs(dir);
 await rm(join(dir,'src/index.ts'));
 await assert.rejects(()=>saveBuildSnapshot(dir,before),/changed during the build/);await assert.rejects(()=>verifyBuildSnapshot(dir));
 await saveBuildSnapshot(dir);await verifyBuildSnapshot(dir);
 await symlink(join(dir,'.secrets/provider.key'),join(dir,'frontend/linked-secret'));await assert.rejects(()=>saveBuildSnapshot(dir));await rm(join(dir,'frontend/linked-secret'));
 await writeFile(join(dir,'.secrets/build-snapshot.json'),'{}');await assert.rejects(()=>verifyBuildSnapshot(dir));
 console.log('Build snapshots passed: reproducible digest, source/assets/config/compiler-checker/lock drift and missing required inputs, added/removed files, missing/malformed snapshot, secret exclusion and symlink refusal.');
}finally{await rm(dir,{recursive:true,force:true});}
