import {build,version as esbuildVersion} from 'esbuild';
import {createHash} from 'node:crypto';
import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const lockPath=resolve(root,'compiler-locks/project-content-v3.json');
const generatedPath=resolve(root,'src/project-specification/compiler-artifacts.generated.ts');
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const encode=value=>JSON.stringify(value,null,2)+'\n';

const modulesPath='src/project-specification/v3/modules.ts';
// Module pins (WH-124): each module digest binds the kind's exact pin name to the pinned configuration
// validator source; each schema digest binds the storage pin name to its lifecycle classes. No table is
// admitted yet (storage "not-admitted"), so a later storage layout is a reviewed identity cutover.
async function modulePins(sources){
 const bundle=await build({absWorkingDir:root,entryPoints:[modulesPath],bundle:true,format:'esm',platform:'neutral',target:'es2022',write:false,legalComments:'none'});
 const {moduleKinds}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].contents).toString('base64'));
 const configuration=sources.find(source=>source.path===modulesPath).digest;
 return Object.entries(moduleKinds).map(([kind,names])=>({kind,
  module:{name:names.module,version:1,digest:digest(encode({formatVersion:1,kind,module:{name:names.module,version:1},configuration}))},
  schema:{name:names.schema,version:1,digest:digest(encode({formatVersion:1,kind,schema:{name:names.schema,version:1},lifecycleClasses:[...names.lifecycleClasses],storage:'not-admitted'}))}}));
}
export async function specificationCompilerArtifacts(){
 const bundle=await build({absWorkingDir:root,entryPoints:['src/project-specification/v3/content.ts'],bundle:true,format:'esm',platform:'neutral',target:'es2022',write:false,metafile:true,legalComments:'none'});
 if(Object.values(bundle.metafile.outputs).some(output=>output.imports.length))throw Error('Specification compiler must have no external runtime dependencies.');
 const paths=[...new Set([...Object.keys(bundle.metafile.inputs),'src/project-specification/compiler.ts','src/project-specification/v3/types.ts','src/backend-form-shape.ts'])].sort();
 if(paths.some(path=>!path.startsWith('src/')||path.includes('..')))throw Error('Unexpected compiler dependency.');
 const sources=[];
 for(const path of paths)sources.push({path,digest:digest(await readFile(resolve(root,path)))});
 const content=digest(bundle.outputFiles[0].contents),component=sources.find(source=>source.path==='src/components.ts').digest;
 const evidence={formatVersion:1,compiler:'project-content@3',schemaVersion:3,esbuildVersion,target:'es2022',content,component,modules:await modulePins(sources),sources};
 return {...evidence,compilerDigest:digest(encode(evidence))};
}
function generated(evidence){return '// Generated from compiler-locks/project-content-v3.json. Do not repin an existing compiler ID.\nexport const compilerArtifacts = '+JSON.stringify({compiler:evidence.compilerDigest,content:evidence.content,component:evidence.component,modules:Object.fromEntries(evidence.modules.map(m=>[m.kind,{module:m.module.digest,schema:m.schema.digest}]))},null,2)+' as const;\n';}
export async function checkSpecificationCompiler(){
 const actual=await specificationCompilerArtifacts(),saved=JSON.parse(await readFile(lockPath,'utf8'));
 if(encode(actual)!==encode(saved))throw Error('Pinned project-content@3 compiler changed. Introduce a new reviewed current compiler identity; do not repin v3.');
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
 const checked=await checkSpecificationCompiler();console.log(`Specification compiler verified: project-content@3, ${checked.sources.length} source inputs, ${checked.compilerDigest}`);
}
