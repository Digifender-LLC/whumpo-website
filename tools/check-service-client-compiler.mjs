import {build,version as esbuildVersion} from 'esbuild';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const lockPath=resolve(root,'compiler-locks/project-service-clients-v3.json');
const generatedPath=resolve(root,'src/project-specification/service-clients/artifacts.generated.ts');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const encode=value=>JSON.stringify(value,null,2)+'\n';
export async function serviceClientCompilerArtifacts(){
 const bundle=await build({absWorkingDir:root,entryPoints:['src/project-specification/service-clients/v3/core.ts'],bundle:true,format:'esm',platform:'neutral',target:'es2022',write:false,metafile:true,legalComments:'none'});
 if(Object.values(bundle.metafile.outputs).some(output=>output.imports.length))throw Error('Service client compiler must have no external runtime dependencies.');
 const paths=[...new Set([...Object.keys(bundle.metafile.inputs),'src/project-specification/service-clients/compiler.ts','src/backend-form-shape.ts'])].sort();
 if(paths.some(path=>!path.startsWith('src/')||path.includes('..')))throw Error('Unexpected compiler dependency.');
 const sources=[];for(const path of paths)sources.push({path,digest:digest(await readFile(resolve(root,path)))});
 const evidence={formatVersion:1,compiler:'project-service-clients@3',schemaVersion:1,esbuildVersion,target:'es2022',renderer:digest(bundle.outputFiles[0].contents),sources};
 return {...evidence,compilerDigest:digest(encode(evidence))};
}
function generated(e){return '// Generated from compiler-locks/project-service-clients-v3.json. Never repin an existing identity.\nexport const serviceClientArtifacts = '+JSON.stringify({compiler:e.compilerDigest,renderer:e.renderer},null,2)+' as const;\n';}
export async function checkServiceClientCompiler(){
 const actual=await serviceClientCompilerArtifacts(),saved=JSON.parse(await readFile(lockPath,'utf8'));
 if(encode(actual)!==encode(saved))throw Error('Pinned project-service-clients@3 compiler changed. Preserve the accepted identity and introduce a reviewed version.');
 if(await readFile(generatedPath,'utf8')!==generated(saved))throw Error('Service client artifact constants are stale. Run --generate with unchanged source.');
 return actual;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const mode=process.argv[2]??'--check';if(process.argv.length>3||!['--check','--init','--generate'].includes(mode))throw Error('Use --check, --generate, or --init for a new identity.');
 if(mode==='--init'){
  let exists=false;try{await access(lockPath);exists=true;}catch(error){if(error.code!=='ENOENT')throw error;}
  if(exists)throw Error('Compiler already pinned; --init cannot replace it.');
  const evidence=await serviceClientCompilerArtifacts();await mkdir(dirname(lockPath),{recursive:true});await writeFile(lockPath,encode(evidence),{flag:'wx'});await writeFile(generatedPath,generated(evidence));
 }else if(mode==='--generate'){
  const actual=await serviceClientCompilerArtifacts(),saved=JSON.parse(await readFile(lockPath,'utf8'));
  if(encode(actual)!==encode(saved))throw Error('Cannot generate constants for changed compiler source.');await writeFile(generatedPath,generated(saved));
 }
 const checked=await checkServiceClientCompiler();console.log(`Service client compiler verified: project-service-clients@3, ${checked.sources.length} source inputs, ${checked.compilerDigest}`);
}
