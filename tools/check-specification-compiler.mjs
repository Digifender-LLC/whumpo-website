import {build,version as esbuildVersion} from 'esbuild';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const lockPath=resolve(root,'compiler-locks/project-content-v1.json');
const generatedPath=resolve(root,'src/project-specification/compiler-artifacts.generated.ts');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const encode=value=>JSON.stringify(value,null,2)+'\n';

export async function specificationCompilerArtifacts(){
 const bundle=await build({absWorkingDir:root,entryPoints:['src/project-specification/v1/content.ts'],bundle:true,format:'esm',platform:'neutral',target:'es2022',write:false,metafile:true,legalComments:'none'});
 if(Object.values(bundle.metafile.outputs).some(output=>output.imports.length))throw Error('Specification compiler must have no external runtime dependencies.');
 const paths=[...new Set([...Object.keys(bundle.metafile.inputs),'src/project-specification/compiler.ts','src/project-specification/v1/types.ts','src/backend-form-shape.ts'])].sort();
 if(paths.some(path=>!path.startsWith('src/')||path.includes('..')))throw Error('Unexpected compiler dependency.');
 const sources=[];
 for(const path of paths)sources.push({path,digest:digest(await readFile(resolve(root,path)))});
 const content=digest(bundle.outputFiles[0].contents),component=sources.find(source=>source.path==='src/components.ts').digest;
 const evidence={formatVersion:1,compiler:'project-content@1',schemaVersion:1,esbuildVersion,target:'es2022',content,component,sources};
 return {...evidence,compilerDigest:digest(encode(evidence))};
}
function generated(evidence){return '// Generated from compiler-locks/project-content-v1.json. Do not repin an existing compiler ID.\nexport const compilerArtifacts = '+JSON.stringify({compiler:evidence.compilerDigest,content:evidence.content,component:evidence.component},null,2)+' as const;\n';}
export async function checkSpecificationCompiler(){
 const actual=await specificationCompilerArtifacts(),saved=JSON.parse(await readFile(lockPath,'utf8'));
 if(encode(actual)!==encode(saved))throw Error('Pinned project-content@1 compiler changed. Preserve its implementation and introduce a new reviewed compiler version; do not repin v1.');
 if(await readFile(generatedPath,'utf8')!==generated(saved))throw Error('Compiler artifact constants are stale. Run node tools/check-specification-compiler.mjs --generate.');
 return actual;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const mode=process.argv[2]??'--check';
 if(process.argv.length>3||!['--check','--init','--generate'].includes(mode))throw Error('Use --check, --generate, or --init for a previously unregistered compiler.');
 if(mode==='--init'){
  let exists=false;try{await access(lockPath);exists=true;}catch(error){if(error.code!=='ENOENT')throw error;}
  if(exists)throw Error('Compiler already pinned. --init cannot replace an existing identity.');
  const evidence=await specificationCompilerArtifacts();await mkdir(dirname(lockPath),{recursive:true});
  await writeFile(lockPath,encode(evidence),{flag:'wx'});await writeFile(generatedPath,generated(evidence));
 }else if(mode==='--generate'){
  const actual=await specificationCompilerArtifacts(),saved=JSON.parse(await readFile(lockPath,'utf8'));
  if(encode(actual)!==encode(saved))throw Error('Cannot generate constants for changed compiler source.');
  await writeFile(generatedPath,generated(saved));
 }
 const checked=await checkSpecificationCompiler();console.log(`Specification compiler verified: project-content@1, ${checked.sources.length} source inputs, ${checked.compilerDigest}`);
}
