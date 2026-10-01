import {createHash} from 'node:crypto';
import {readdir,readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
// No secret/configuration-value output. Only explicitly versioned build inputs.
const trees=['src','frontend','web','public-app'];
const files=['package.json','pnpm-lock.yaml','vite.config.ts','tsconfig.json','tsconfig.frontend.json','wrangler.jsonc','wrangler.apps.jsonc','wrangler.sites.jsonc','wrangler.runtime.jsonc','tools/build.mjs','tools/build-pwa.mjs','tools/build-snapshot.mjs','tools/deploy-platform.mjs','tools/check-specification-compiler.mjs','compiler-locks/project-content-v1.json','tools/check-service-client-compiler.mjs','compiler-locks/project-service-clients-v1.json'];
const snapshotPath='.secrets/build-snapshot.json';
async function walk(root,base){
 const result=[];
 for(const e of await readdir(join(root,base),{withFileTypes:true})){
  const path=base+'/'+e.name;
  if(e.isSymbolicLink())throw Error('Build input symlink requires review');
  if(e.isDirectory())result.push(...await walk(root,path));
  else if(e.isFile())result.push(path);
 }
 return result;
}
async function fingerprint(root,paths){
 const hash=createHash('sha256');
 for(const path of [...paths].sort()){
  const content=await readFile(join(root,path));
  hash.update(JSON.stringify([path,content.length]));hash.update(content);
 }
 return {sha256:hash.digest('hex'),files:paths.length};
}
export async function readBuildInputs(root=process.cwd()){
 const inputs=[...files];for(const tree of trees)inputs.push(...await walk(root,tree));
 return fingerprint(root,inputs.filter(path=>path!=='public-app/visitor.js'));
}
async function state(root){
 return {version:1,inputs:await readBuildInputs(root),assets:await fingerprint(root,[...await walk(root,'dist'),'public-app/visitor.js'])};
}
export async function saveBuildSnapshot(root=process.cwd(),expectedInputs){
 const result=await state(root);
 if(expectedInputs&&JSON.stringify(expectedInputs)!==JSON.stringify(result.inputs))throw Error('Build inputs changed during the build. Build again.');
 await mkdir(join(root,'.secrets'),{recursive:true,mode:0o700});
 await writeFile(join(root,snapshotPath),JSON.stringify(result,null,2)+'\n',{mode:0o600});return result;
}
export async function verifyBuildSnapshot(root=process.cwd()){
 try{
  const expected=JSON.parse(await readFile(join(root,snapshotPath),'utf8'));
  const current=await state(root);
  if(JSON.stringify(expected)!==JSON.stringify(current))throw Error('Changed build');
  return current;
 }catch{throw Error('Build snapshot missing or changed. Run the build in this checkout before deploying.');}
}
