import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,rm,readdir,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {databaseFixture} from './helpers/current-database.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
import {ownerFunding,uncacheable} from './helpers/owner-funding.mjs';
Error.stackTraceLimit=0;
// WH-073 slice 3 (verification only): the REAL whumpo-runtime Worker (bundled QuickJS, run in workerd through Miniflare
// exactly as tests/backend-runtime.mjs does) executes published customer backends that are reached through the real sites
// Worker path (src/site-host.ts -> publicBackend, `https://<project>.whumpo.site/backend`), with no AI binding or key, the
// maintainer provider unavailable or answering 503, the owner's funding exhausted in the durable rows, and global fetch in
// this process replaced by a counting thrower. Every group runs against the production-shaped runtime configuration and
// against a copy whose only difference is a counting outboundService, so a runtime that tried to open any connection is
// seen; a probe Worker that does connect out proves that counter is armed.
// Local synthetic evidence only: workerd under Miniflare on this machine, not Cloudflare, not a deployed Worker, no
// request-path cost measurement. Not in a verification profile (it builds the runtime Worker and boots workerd); run
// `pnpm run test:standard-service-runtime-execution` (SQLite and --d1).
const req=createRequire(import.meta.resolve('wrangler'));
const {Miniflare,convertV4MiniflareOptions}=req('miniflare');
const modules=await currentFixtureModules(['src/site-host.ts','src/backend-versions.ts','src/backend-publication.ts','src/runtime-lane.ts','src/ai-chat.ts','src/model-costs.ts','src/gateway-spend.ts','src/inference-routing.ts']);
const [{default:siteHost},backend,publication,{projectRuntime},{configuredAI}]=await Promise.all(['src/site-host.ts','src/backend-versions.ts','src/backend-publication.ts','src/runtime-lane.ts','src/ai-chat.ts'].map(path=>modules.module(path)));
const fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID(),run=(q,...p)=>db.prepare(q).bind(...p).run(),row=(q,...p)=>db.prepare(q).bind(...p).first();
const {account,reserveGateway,reserveStandard,standardAllowance,gatewayFunding,funding,exhausted}=await ownerFunding({db,modules});
const consoleMethods=['log','info','warn','error','debug'],originals=Object.fromEntries(consoleMethods.map(k=>[k,console[k]]));
const originalFetch=globalThis.fetch;let network=0,providerStatus=null,cases=0,outbound=0,dispatches=0;const urls=[];
// Scratch directory honors TMPDIR (tests/backend-runtime.mjs hard-codes /tmp).
const dir=await mkdtemp(join(tmpdir(),'whumpo-runtime-evidence-')),mfs=[];
const moduleOptions=files=>convertV4MiniflareOptions({modulesRoot:dir,modules:files,compatibilityDate:'2026-09-29'});
const countOutbound=async request=>{outbound++;urls.push(request.url);return new Response('outbound refused',{status:502});};
const withOutbound=options=>({...options,workers:[{...options.workers[0],dev:{...options.workers[0].dev,outboundService:{type:'fetcher',handler:countOutbound}}}]});
const service=mf=>({fetch:async(url,init)=>{dispatches++;return mf.dispatchFetch(url,init);}});
// What the runtime Worker is allowed to be: a module bundle with a compatibility date and nothing else. Read from the
// options Miniflare actually receives (built from the wrangler bundle's modules, as tests/backend-runtime.mjs does, so
// they cannot by themselves show what wrangler.runtime.jsonc deploys), the deployed wrangler config checked below, and
// the bindings workerd actually exposes.
async function assertNoCapabilities(options,mf){
 assert.equal(options.workers.length,1,'One runtime Worker, no sidecar services');
 const [{config,dev}]=options.workers;
 assert.deepEqual(Object.keys(config).sort(),['compatibilityDate','compatibilityFlags','env','exports','manifest','name'],'Only the module bundle and compatibility settings are configured');
 assert.deepEqual(config.env,{},'The runtime Worker has no bindings (no AI, D1, R2, KV, secrets, vars or service bindings)');
 assert.deepEqual(config.exports,{},'The runtime Worker exports no Durable Object, entrypoint or workflow');
 for(const key of ['outboundService','remoteProxyConnectionString','unsafeDirectSockets','unsafeOverrideFetchWorker','unsafeEvalBinding','unsafeEphemeralDurableObjects','unsafeInspectorProxy'])assert.ok(!dev[key],key+' is not configured');
 for(const key of ['unsafeRuntimeEnv','unsafeModuleFallbackService','containerEngine'])assert.ok(!options[key],key+' is not configured');
 assert.deepEqual(await mf.getBindings(),{},'workerd exposes no binding to the runtime Worker');
 // The deployed configuration, not just the harness: no binding, route, trigger or service in wrangler.runtime.jsonc.
 const deployed=JSON.parse(await readFile('wrangler.runtime.jsonc','utf8'));
 assert.deepEqual(Object.keys(deployed).sort(),['$schema','account_id','compatibility_date','main','name','observability','preview_urls','workers_dev'],'wrangler.runtime.jsonc declares no binding, service, route or trigger');
 assert.equal(deployed.main,'src/runtime/worker.ts');
}
async function check(name,fn){try{await fn();cases++;}catch(error){originals.error(name);throw error;}}
// A deterministic customer function, a function that probes for any capability, and one that tries to connect out.
const sources={
 total:'export default input=>({total:input.items.reduce((n,x)=>n+x,0),count:input.items.length,label:input.label.toUpperCase()})',
 probe:'export default ()=>{let attempt="none";try{fetch("https://opencode.ai/zen/go/v1/responses");attempt="called"}catch(e){attempt="threw"}return {types:[typeof fetch,typeof env,typeof process,typeof AI,typeof require,typeof globalThis.AI,typeof globalThis.env],attempt}}',
 connect:'export default ()=>fetch("https://opencode.ai/zen/go/v1/responses")'
};
const variants={
 'maintainer unavailable (no AI binding or key)':{},
 'maintainer configured but failing (provider 503)':{AI_BASE_URL:'https://opencode.ai/zen/go/v1',AI_MODEL:'muse-spark-1.3-contributor',AI_API_KEY:'synthetic-not-a-secret',AI_PROTOCOL:'responses'}
};
let ipCounter=0;const ip=()=>{ipCounter++;return `198.18.${(ipCounter>>8)&255}.${ipCounter&255}`;};
const call=(env,project,input,extra={})=>siteHost.fetch(new Request(`https://${project}.whumpo.site/backend`,{method:'POST',headers:{'content-type':'application/json','cf-connecting-ip':ip()},body:JSON.stringify(input),...extra}),env);
async function saved(o,source,input){
 const project=id(),version=id();
 await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Standard service','','draft',datetime('now'),datetime('now'))",project,o.user);
 await backend.saveBackend(o.scope,o.user,project,version,source);
 return {project,version,testRun:id(),review:id(),input};
}
const counters=async()=>Object.fromEntries(await Promise.all(['inference_calls','gateway_spend_attempts','standard_ai_requests','gateway_inference_requests','chat_turns'].map(async t=>[t,(await row(`SELECT COUNT(*) n FROM ${t}`)).n])));
try{
 // Build the real runtime Worker exactly as tests/backend-runtime.mjs does (wrangler dry-run bundle).
 const built=String(execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--config','wrangler.runtime.jsonc','--dry-run','--outdir',dir],{stdio:'pipe'}));
 const options=moduleOptions([{type:'ESModule',path:dir+'/worker.js'},...(await readdir(dir)).filter(p=>p.endsWith('.wasm')).map(p=>({type:'CompiledWasm',path:dir+'/'+p}))]);
 const production=new Miniflare(options);mfs.push(production);const countedOptions=withOutbound(options),counted=new Miniflare(countedOptions);mfs.push(counted);
 await writeFile(dir+'/probe.js',"export default {fetch:()=>fetch('https://example.com/probe')};");
 const probe=new Miniflare(withOutbound(moduleOptions([{type:'ESModule',path:dir+'/probe.js'}])));mfs.push(probe);
 await Promise.all(mfs.map(mf=>mf.ready));
 const runtimes={'production-shaped runtime (no bindings, no outbound service)':service(production),'runtime with a counting outbound service':service(counted)};
 globalThis.fetch=async(input,init)=>{const request=new Request(input,init);network++;urls.push(request.url);if(providerStatus)return new Response('provider unavailable',{status:providerStatus});throw Error('No network is allowed');};
 await check('configuration: the runtime Worker has no binding or outbound service, and the outbound counter is armed',async()=>{
  await assertNoCapabilities(options,production);
  // Wrangler's own resolution of wrangler.runtime.jsonc for the deploy bundle: the Worker is uploaded with no bindings.
  assert.match(built,/No bindings found\./);assert.ok(!/has access to the following bindings/i.test(built),'wrangler reports a binding');
  // The counted copy differs from the production-shaped one in exactly the counter.
  assert.deepEqual({...countedOptions.workers[0].dev,outboundService:undefined},{...options.workers[0].dev,outboundService:undefined});
  assert.deepEqual(countedOptions.workers[0].config,options.workers[0].config);assert.deepEqual(await counted.getBindings(),{});
  outbound=0;const r=await probe.dispatchFetch('http://probe/');assert.equal(r.status,502,'The probe Worker really tried to connect out and was refused');
  assert.equal(outbound,1,'The outbound counter fires on a Worker that does connect out');assert.ok(urls.splice(0)[0].includes('example.com'));outbound=0;network=0;
 });
 for(const [maintainer,extra] of Object.entries(variants))for(const [balance,fund] of Object.entries(exhausted))for(const [runtimeName,runtime] of Object.entries(runtimes))await check(maintainer+' / '+balance+' / '+runtimeName,async()=>{
  const configured=!!extra.AI_API_KEY,env={DB:db,BACKEND_RUNTIME:runtime,...extra};providerStatus=configured?503:null;
  assert.equal(!!configuredAI(env),configured,'The variant really has (or lacks) a usable maintainer');
  assert.ok(!('AI' in env),'No AI binding is passed to the sites Worker');
  const o=await account();await fund.seed?.(o);await fund.verify?.(o);
  // The funding rows are snapshotted before any backend is saved, tested, published or called: none of that may move them.
  const seeded=await funding(),start=await counters();network=0;outbound=0;urls.length=0;
  const good=await saved(o,sources.total,{items:[1,2],label:'t'}),hostile=await saved(o,sources.probe,null),connecting=await saved(o,sources.connect,null);
  for(const p of [good,hostile,connecting]){
   const before=dispatches;await backend.testBackend(o.scope,await projectRuntime(runtime,p.project),o.user,p.project,p.version,p.testRun,p.input);assert.equal(dispatches,before+1,'The owner test ran in the runtime Worker');
   const review=publication.prepareBackendPublication(o.scope,o.user,p.project,p.review,'publish',p.version,p.testRun);
   // A function that only tries to connect out fails its own test, so it can never be published.
   if(p===connecting)await assert.rejects(review,e=>e.status===409);else{await review;await publication.confirmBackendPublication(o.scope,o.user,p.review);}
  }
  const unserved=await call(env,connecting.project,{});assert.equal(unserved.status,404,'A backend whose test failed is not served');uncacheable(unserved);

  // Visitor calls: sites Worker -> publicBackend -> runtime Worker, with the real QuickJS engine computing the answer.
  const first=dispatches;
  for(const [input,value] of [[{items:[2,3,5],label:'garden'},{total:10,count:3,label:'GARDEN'}],[{items:[],label:'none'},{total:0,count:0,label:'NONE'}],[{items:[40,2],label:'x'},{total:42,count:2,label:'X'}]]){
   const r=await call(env,good.project,input);assert.equal(r.status,200);uncacheable(r);
   assert.equal(r.headers.get('set-cookie'),null,'The public backend sets no cookie');
   assert.deepEqual(await r.json(),{ok:true,value},'The runtime computed the expected deterministic value');
  }
  // A function probing for any capability sees none, and trying to connect out from the guest fails inside QuickJS.
  const probed=await call(env,hostile.project,{});assert.equal(probed.status,200);uncacheable(probed);
  assert.deepEqual(await probed.json(),{ok:true,value:{types:Array(7).fill('undefined'),attempt:'threw'}},'The guest sees no fetch, env, AI or process');
  assert.equal(dispatches-first,4,'Each admitted public call executed once in the real runtime Worker');
  // Boundaries stay non-cacheable and never reach the runtime.
  const refused=[await call(env,good.project,{},{method:'GET',body:undefined}),await call(env,good.project,{},{headers:{'content-type':'text/plain'}}),await call(env,good.project,{},{body:'not JSON'}),await siteHost.fetch(new Request(`https://${good.project}.whumpo.site/backend`,{method:'OPTIONS'}),env)];
  assert.deepEqual(refused.map(r=>r.status),[405,415,400,204]);for(const r of refused)uncacheable(r);
  assert.equal(dispatches-first,4,'Refused boundaries never reached the runtime');
  // Withdrawal: an unpublished backend stops executing and the refusal is not cacheable.
  const off=id();await publication.prepareBackendPublication(o.scope,o.user,good.project,off,'unpublish',good.version,null);await publication.confirmBackendPublication(o.scope,o.user,off);
  const gone=await call(env,good.project,{items:[1],label:'a'});assert.equal(gone.status,404);uncacheable(gone);assert.equal(dispatches-first,4,'An unpublished backend is not executed');

  assert.equal(network,0,'The sites Worker, publication code and runtime client reached no network in this process (so no maintainer provider): '+urls.splice(0).join(', '));
  assert.equal(outbound,0,'The runtime Worker opened no outbound connection');
  assert.deepEqual(await counters(),start,'No inference call, gateway spend attempt, standard-AI or gateway request, or Chat turn was recorded');
  assert.deepEqual(await funding(),seeded,'No funding row moved: no new attempt, reservation, dispatch or balance change');
  await fund.verify?.(o);
  // Contrast: with the same rows, owner maintenance is refused, so the exhaustion above was real and merely irrelevant to visitors.
  await fund.refused?.(o);assert.deepEqual(await funding(),seeded,'A refused owner admission leaves every funding row unchanged');
  providerStatus=null;
 });
 await check('control: the same owner admissions succeed when the balances are funded, so refusal means exhaustion',async()=>{
  const funded=await account();await standardAllowance(funded);await reserveStandard(funded);
  const reserved=await row('SELECT status,reserved_micros FROM inference_calls WHERE user_id=?',funded.user);assert.equal(reserved.status,'reserved');assert.ok(reserved.reserved_micros>0,'The reservation is priced');
  const fundedGateway=await account();await gatewayFunding(fundedGateway,[]);assert.equal((await reserveGateway(fundedGateway,'premium')).replayed,false);
 });
 await check('counting transport is armed: any dispatch from this process would be visible',async()=>{
  network=0;await assert.rejects(()=>globalThis.fetch('https://opencode.ai/zen/go/v1/responses'),/No network/);assert.equal(network,1);network=0;urls.length=0;
 });
 assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 process.stdout.write(`Standard service runtime execution passed: ${cases} groups on ${process.argv.includes('--d1')?'local D1':'SQLite'} — the real whumpo-runtime Worker (bundled QuickJS in workerd via Miniflare, built with wrangler --dry-run) served published customer backends through the real sites Worker path, each with the maintainer absent and with it failing (503), each with the owner's funding unset, with the standard usage allowance spent to its ceiling, and with premium credit, approval and task, account and platform operator buckets spent to their limits, and each against the production-shaped runtime configuration and a copy with a counting outboundService: the expected deterministic values were returned (${dispatches} runtime executions in total), the guest saw no fetch, env, AI or process, zero network calls in this process, zero outbound connections from the runtime Worker (the counter is proven armed by a probe Worker that does connect out), zero inference_calls, gateway_spend_attempts, standard-AI or gateway requests and Chat turns, every seeded budget and bucket row unchanged, every response non-cacheable including refusals and withdrawal; the runtime Worker's Miniflare options, deployed wrangler config and workerd bindings show no binding, service or outbound service, and the same exhausted rows refuse owner maintenance admission while funded controls are admitted. Local synthetic verification in workerd under Miniflare only; not Cloudflare, no deployed Worker, no request-path cost measurement, no real provider outage.\n`);
}catch(error){originals.error(String(error.stack||error));process.exitCode=1;}
finally{
 for(const k of consoleMethods)console[k]=originals[k];globalThis.fetch=originalFetch;
 for(const mf of mfs)await mf.dispose().catch(()=>{});await rm(dir,{recursive:true,force:true});await fixture.close?.();
}
