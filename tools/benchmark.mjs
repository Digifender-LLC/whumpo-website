// Offline only: no live mode, caller-selected command, provider key or remote DB.
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,readFile,readdir,writeFile,rm,mkdir,lstat} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {fixtureEnvironment} from './verify.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const scripts={site:'tests/customer-site-journey.mjs',edits:'tests/first-ai-journey.mjs',application:'tests/customer-app-journey.mjs',
 'application-build':'tests/application-build.mjs','page-design':'tests/app-page-design.mjs',conversation:'tests/benchmark-conversation.mjs',failures:'tests/standard-ai-chat.mjs'};
async function sourceManifest(){
 const files=[];
 async function walk(path){for(const entry of await readdir(join(root,path),{withFileTypes:true})){const relative=path+'/'+entry.name;if(entry.isDirectory())await walk(relative);else if(entry.isFile())files.push(relative);else throw Error('Unexpected source entry');}}
 for(const dir of ['src','tests','tools','schema','web','public-app'])await walk(dir);
 for(const name of ['package.json','pnpm-lock.yaml','wrangler.jsonc','wrangler.runtime.jsonc','wrangler.apps.jsonc','wrangler.sites.jsonc','worker-configuration.d.ts'])if((await lstat(join(root,name)).catch(()=>null))?.isFile())files.push(name);
 const entries=[];for(const path of files.sort())entries.push({path,sha256:createHash('sha256').update(await readFile(join(root,path))).digest('hex')});
 return {sha256:createHash('sha256').update(JSON.stringify(entries)).digest('hex'),files:entries};
}
async function child(script,env){
 const start=performance.now();
 return new Promise(resolve=>{
  const process=spawn(globalThis.process.execPath,[script],{cwd:root,env,stdio:['ignore','pipe','pipe'],detached:true});
  const output=[];let bytes=0,timedOut=false,settled=false;
  const capture=b=>{if(bytes<262144){output.push(b.subarray(0,262144-bytes));bytes+=b.length;}};
  process.stdout.on('data',capture);process.stderr.on('data',capture);
  const kill=()=>{try{globalThis.process.kill(-process.pid,'SIGKILL');}catch{}};
  const timer=setTimeout(()=>{timedOut=true;kill();},300000);
  const finish=(status,signal)=>{if(settled)return;settled=true;clearTimeout(timer);kill();resolve({status,signal,timedOut,durationMs:Math.round(performance.now()-start),output:Buffer.concat(output)});};
  process.on('error',()=>finish(null,'spawn_error'));process.on('close',finish);
 });
}
export async function runBenchmark(){
 if(Number(process.versions.node.split('.')[0])!==24)throw Error('Benchmark requires Node 24');
 if((await readdir(root)).some(n=>/^\.(?:dev\.vars|env)(?:\.|$)/.test(n)))throw Error('Use a checkout without local .env/.dev.vars files');
 const suiteBytes=await readFile(join(root,'tests/fixtures/customer-benchmark.json'));
 const suite=JSON.parse(suiteBytes);
 if(suite.version!=='whumpo-customer-benchmark-v1'||suite.mode!=='synthetic'||suite.cases.length!==Object.keys(scripts).length)throw Error('Invalid benchmark suite');
 const ids=new Set();for(const c of suite.cases){if(ids.has(c.id)||scripts[c.id]!==c.script||!['site','app','fast'].includes(c.profile)||!Array.isArray(c.checks)||!c.checks.length)throw Error('Invalid benchmark case');ids.add(c.id);}
 const home=await mkdtemp(join(tmpdir(),'whumpo-benchmark-'));
 const directory=join(root,'.secrets','benchmarks',randomUUID());await mkdir(directory,{recursive:true,mode:0o700});
 const manifest=await sourceManifest(),startedAt=new Date().toISOString(),cases=[];
 await writeFile(join(directory,'sources.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
 try{
  for(const c of suite.cases){
   console.log('Benchmarking synthetic fixture: '+c.id);
   const env=fixtureEnvironment(process.env,home,c.profile);env.WHUMPO_BENCHMARK_DIR=home;
   const result=await child(c.script,env);
   await writeFile(join(directory,c.id+'.log'),result.output,{flag:'wx',mode:0o600});
   let evidence=null;
   try{evidence=JSON.parse(await readFile(join(home,c.id+'.json'),'utf8'));if(evidence.id!==c.id||evidence.mode!=='synthetic'||evidence.realProviderSamples!==0)throw Error('Invalid evidence');}catch{evidence=null;}
   const passed=result.status===0&&!result.timedOut&&!!evidence;
   cases.push({id:c.id,harness:c.script,outcome:passed?'passed':'failed',harnessDurationMs:result.durationMs,
    failure:passed?null:result.timedOut?'timeout':result.status!==0?'harness_failed':'missing_evidence',
    checks:c.checks.map(id=>({id,status:passed?'passed':'unknown'})),evidence});
   console.log(`${c.id}: ${passed?'passed':'failed'} (${result.durationMs} ms)`);
  }
  const after=await sourceManifest(),unchanged=after.sha256===manifest.sha256;
  const report={version:1,suite:suite.version,suiteSha256:createHash('sha256').update(suiteBytes).digest('hex'),
   source:{commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),dirty:!!execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),sha256:manifest.sha256,unchanged},
   startedAt,finishedAt:new Date().toISOString(),environment:{node:process.versions.node,mode:'disposable-local',providers:'scripted-only'},
   cases,summary:{fixtureRuns:cases.length,passed:cases.filter(c=>c.outcome==='passed').length,realProviderSamples:0,
    realProviderQuality:null,actualTaskCostMicros:null,providerLatencyMs:null,rankingEligible:false},
   limitations:['One run per fixture family, with dependent steps and intentional faults; not independent customer samples.',
    'Assertions verify application behavior under scripted responses. Natural model choice, wording, aesthetics and usefulness need separately scored real-provider samples.',
    'Harness time includes setup, auth, runtime and negative cases; it is not customer/provider latency.',
    'Unknown expenses and missing evidence remain unknown, including failed fixtures. No simulated rate or subscription shadow becomes an API invoice.']};
  await writeFile(join(directory,'report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
  console.log('Benchmark report: '+join(directory,'report.json'));
  if(!unchanged||cases.some(c=>c.outcome!=='passed'))throw Error('Benchmark incomplete; inspect private report/logs');
  return {directory,report};
 }finally{await rm(home,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{if(process.argv.length!==2)throw Error('Usage: node tools/benchmark.mjs (offline fixtures only)');await runBenchmark();}
 catch(error){console.error(error.message);process.exitCode=1;}
}
