#!/usr/bin/env node
// WH-050 local capacity, abuse and tenant-fairness harness.
//
// LOCAL-ONLY EVIDENCE. Everything runs on loopback in one disposable process tree:
// local D1 (workerd/miniflare SQLite), local R2, the real QuickJS runtime Worker under
// Miniflare, and the real platform/site/visitor handlers called in-process behind a
// loopback HTTP server. No Cloudflare account, provider, deploy or remote URL is ever
// contacted: global fetch is replaced with a guard that rejects non-loopback targets.
// Numbers describe this machine and these fixtures. They are NOT Cloudflare production
// limits or capacity (see docs/capacity-and-fairness.md).
//
// Usage: node tools/capacity.mjs [--smoke] [--scale N] [--tenants N] [--seed N] [--json FILE]
//   --smoke    tiny volumes (seconds) to check that the harness itself works
//   --scale    multiplier for site/photo request volumes (default 1; max 4)
//   --tenants  total synthetic tenants including the one noisy tenant (default 4, 2..8)
//   --seed     deterministic job-order seed (default 50)
//   --json     also write the raw machine-readable result to FILE
import {mkdtemp,rm,readdir,readFile,writeFile} from 'node:fs/promises';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {tmpdir,cpus,totalmem} from 'node:os';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readdirSync} from 'node:fs';
import {monitorEventLoopDelay} from 'node:perf_hooks';
import {fixtureEnvironment} from './verify.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
process.chdir(root);
const argv=process.argv.slice(2),flag=name=>argv.includes('--'+name),value=(name,fallback)=>{const i=argv.indexOf('--'+name);return i<0?fallback:argv[i+1];};
const known=new Set(['--smoke','--scale','--tenants','--seed','--json']);
for(const [i,arg] of argv.entries())if(arg.startsWith('--')?!known.has(arg):!['--scale','--tenants','--seed','--json'].includes(argv[i-1]))throw Error('Unknown argument '+arg);
process.argv.length=2; // The shared database fixture rejects unknown CLI arguments.
const smoke=flag('smoke'),scale=Math.min(4,Math.max(1,Number(value('scale',1)))),tenantCount=Math.min(8,Math.max(2,Number(value('tenants',4)))),seed=Number(value('seed',50)),jsonOut=value('json',null);
if(!Number.isFinite(scale)||!Number.isInteger(tenantCount)||!Number.isInteger(seed))throw Error('Invalid numeric argument');
if(readdirSync(root).some(n=>/^\.(?:dev\.vars|env)(?:\.|$)/.test(n)))throw Error('Local .env/.dev.vars files exist. Use a checkout without them.');
if(Number(process.versions.node.split('.')[0])!==24)console.warn(`WARNING: repository requires Node.js 24; running on ${process.versions.node}. Record this with the results.`);

// Allowlisted environment: no provider keys, proxies, NODE_OPTIONS or inherited Wrangler auth.
const home=await mkdtemp(resolve(tmpdir(),'whumpo-capacity-home-'));
const clean=fixtureEnvironment(process.env,home);
for(const key of Object.keys(process.env))delete process.env[key];
Object.assign(process.env,clean);
// Hard guard: only loopback traffic can leave this process through global fetch.
const realFetch=globalThis.fetch;
globalThis.fetch=(input,init)=>{
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
 if(!['127.0.0.1','localhost'].includes(url.hostname))throw Error('Capacity harness refuses non-loopback request to '+url.hostname);
 return realFetch(input,init);
};

const {databaseFixture}=await import('../tests/helpers/current-database.mjs');
const {workspaceFixture}=await import('../tests/helpers/workspace-identity.mjs');
const {currentSiteFixtureHandlers,createFixtureProject,changeFixtureWebsite,enableFixtureVisitorAccess}=await import('../tests/current-site-fixture.mjs');

const day=()=>new Date().toISOString().slice(0,10);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const id=()=>crypto.randomUUID();
function prng(s){let a=s>>>0;return()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
const random=prng(seed);
const shuffle=a=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}return a;};
const pct=(sorted,p)=>sorted.length?sorted[Math.min(sorted.length-1,Math.max(0,Math.ceil(p/100*sorted.length)-1))]:null;
const round=(n,d=1)=>n===null||n===undefined?null:Math.round(n*10**d)/10**d;
let ipCounter=0;const freshIp=()=>{ipCounter++;return `198.18.${(ipCounter>>8)&255}.${ipCounter&255}`;};

// 1x1-scale baseline JPEG (291 bytes, synthetic solid colour, no metadata).
const jpeg=Buffer.from('/9j/4AAQSkZJRgABAQAAAAAAAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAYACADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAT/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCcAiTAAAAAAP/Z','base64');

const work=await mkdtemp(resolve(tmpdir(),'whumpo-capacity-'));
let store,runtime,server,base;
const cleanup=async()=>{try{if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}await runtime?.dispose();await store?.close();}finally{await rm(work,{recursive:true,force:true});await rm(home,{recursive:true,force:true});}};
process.on('SIGINT',()=>cleanup().finally(()=>process.exit(130)));

// ---------------------------------------------------------------- fixtures
const limiterState={denied:{AUTH:0,API:0}};
// Local stand-in for the Workers rate-limit binding: exact fixed window per key. The real
// binding is per Cloudflare location and eventually consistent; this is NOT a model of it.
function limiter(name,limit,period=60){
 const windows=new Map();
 return {async limit({key}){const now=Date.now(),w=windows.get(key);if(!w||now-w.start>=period*1000){windows.set(key,{start:now,n:1});return {success:true};}w.n++;if(w.n>limit){limiterState.denied[name]++;return {success:false};}return {success:true};}};
}
const stats={d1:0,runtime:0,runtimeInflight:0,runtimePeak:0,runtimeMs:[]};
function countingDatabase(db){
 const originals=new WeakMap();
 const wrap=original=>{const w={bind:(...v)=>wrap(original.bind(...v)),first:(...v)=>{stats.d1++;return original.first(...v);},all:(...v)=>{stats.d1++;return original.all(...v);},run:(...v)=>{stats.d1++;return original.run(...v);},raw:(...v)=>{stats.d1++;return original.raw(...v);}};originals.set(w,original);return w;};
 return {prepare:q=>wrap(db.prepare(q)),batch:async s=>{stats.d1+=s.length;return db.batch(s.map(x=>originals.get(x)??x));},exec:(...a)=>db.exec(...a)};
}

store=await databaseFixture({d1:true,r2:true});
const db=store.db;
execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--config','wrangler.runtime.jsonc','--dry-run','--outdir',work+'/runtime'],{stdio:'pipe',maxBuffer:16*1024*1024,env:process.env});
const require=createRequire(import.meta.resolve('wrangler')),{Miniflare,convertV4MiniflareOptions}=require('miniflare');
runtime=new Miniflare(convertV4MiniflareOptions({modulesRoot:work+'/runtime',modules:[{type:'ESModule',path:work+'/runtime/worker.js'},...(await readdir(work+'/runtime')).filter(p=>p.endsWith('.wasm')).map(p=>({type:'CompiledWasm',path:work+'/runtime/'+p}))],compatibilityDate:'2026-09-29'}));
const m=await currentSiteFixtureHandlers();

// Limits copied from wrangler.jsonc / wrangler.apps.jsonc (verified below against the files).
const wranglerLimits=async(file)=>{const text=await readFile(file,'utf8');const out={};for(const mm of text.matchAll(/"name":\s*"(\w+_LIMITER)"[\s\S]*?"limit":\s*(\d+),\s*"period":\s*(\d+)/g))out[mm[1]]={limit:Number(mm[2]),period:Number(mm[3])};return out;};
const configured={platform:await wranglerLimits('wrangler.jsonc'),apps:await wranglerLimits('wrangler.apps.jsonc')};
const AUTH_LIMITER=limiter('AUTH',configured.platform.AUTH_LIMITER.limit,configured.platform.AUTH_LIMITER.period),API_LIMITER=limiter('API',configured.platform.API_LIMITER.limit,configured.platform.API_LIMITER.period);

const service={fetch:async(url,init)=>{
 stats.runtime++;stats.runtimeInflight++;stats.runtimePeak=Math.max(stats.runtimePeak,stats.runtimeInflight);const t=performance.now();
 try{return await runtime.dispatchFetch(url,init);}finally{stats.runtimeInflight--;stats.runtimeMs.push(performance.now()-t);}
}};
// Seeding calls testBackend directly, bypassing the platform's per-project lane wrapper; give them a fixture lane.
const seedRuntime={fetch:(url,init)=>service.fetch(url,{...init,headers:{'x-whumpo-lane':'e'.repeat(64),...init?.headers}})};
const cdb=countingDatabase(db);
const env={...store.env,DB:cdb,ENVIRONMENT:'local',AUTH_LIMITER,API_LIMITER,BACKEND_RUNTIME:service,ASSETS:{fetch:async request=>{const p=new URL(request.url).pathname;const file=['/visitor.js','/visitor.css','/design-tokens.css'].includes(p)?p:'/index.html';return new Response(await readFile('public-app'+file),{headers:{'content-type':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html'}});}}};
const seedEnv={...store.env,DB:db};

server=createServer(async(req,res)=>{try{
 const chunks=[];for await(const c of req)chunks.push(c);
 const body=['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks);
 const pending=[],ctx={waitUntil:t=>pending.push(t),passThroughOnException(){}};
 let response;
 if(req.url.startsWith('/apps/'))response=await m.appHost.fetch(new Request('http://localhost:8787'+req.url,{method:req.method,headers:req.headers,body}),env);
 else if(req.url.startsWith('/s/'))response=await m.host.fetch(new Request(base+req.url,{method:req.method,headers:req.headers,body}),env,ctx);
 else response=await m.worker.fetch(new Request(base+req.url,{method:req.method,headers:req.headers,body}),env,ctx);
 await Promise.all(pending);
 for(const cookie of response.headers.getSetCookie())res.appendHeader('set-cookie',cookie);
 res.writeHead(response.status,Object.fromEntries([...response.headers].filter(([n])=>n!=='set-cookie')));res.end(Buffer.from(await response.arrayBuffer()));
}catch(error){res.writeHead(599);res.end('Harness handler failed');}});
await new Promise((ok,bad)=>{server.once('error',bad);server.listen(0,'127.0.0.1',ok);});base='http://127.0.0.1:'+server.address().port;

// ---------------------------------------------------------------- seeding
const owners=new Map();
async function account(){const a=await workspaceFixture(db,m),scope=await a.scope();const t={user:a.account,scope,cookie:'__Host-whumpo_session='+a.token};owners.set(t.user,t);return t;}
const api=async(t,path,body,method=body===undefined?'GET':'POST')=>{const r=await realFetch(base+'/api'+path,{method,headers:{origin:base,cookie:t.cookie,'content-type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(r.status>=400)throw Error(`Seed ${method} ${path} failed ${r.status}: ${(await r.text()).slice(0,200)}`);return r.json();};
async function chat(t,content){const state=await m.readChat(t.scope,t.user),input={id:id(),revision:state.state.revision,content},result=await m.sendChat(t.scope,t.user,input);if(result.status!==200)throw Error('Seed chat failed '+JSON.stringify(result));return input.id;}
async function newProjectRow(t,name){const project=id(),now=new Date().toISOString();await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,?,'Synthetic capacity fixture','draft',?,?)").bind(project,t.user,name,now,now).run();return project;}
const calculator='export default ({a,b})=>({sum:a+b})';
// Benign on ordinary input; resource-abusive when the caller supplies a mode. Same source for every call.
const abusive='export default i=>{if(i&&i.mode==="spin"){while(true){}}if(i&&i.mode==="alloc"){const a=[];while(true)a.push("x".repeat(65536))}if(i&&i.mode==="recurse"){const f=n=>f(n+1)+1;return f(0)}return {sum:(i?.a??0)+(i?.b??0)}}';
async function publishBackend(t,project,source){
 const version=id(),run=id(),review=id();
 await m.backend.saveBackend(t.scope,t.user,project,version,source);
 const test=await m.backend.testBackend(t.scope,seedRuntime,t.user,project,version,run,{a:1,b:2});if(!test?.result?.ok)throw Error('Seed backend test failed '+JSON.stringify(test));
 await api(t,'/projects/'+project+'/backend-publication',{id:review,operation:'publish',versionId:version,runId:run});
 await api(t,'/backend-publication-reviews/'+review+'/confirm',{});
 return version;
}
async function seedTenant(name,role,{abusiveSource=false}={}){
 const t=await account();t.name=name;t.role=role;
 const site=await createFixtureProject(t.scope,t.user,name,'Synthetic capacity fixture');t.project=site.project;
 const photo=id();
 const up=await m.uploadPhoto(new Request('https://whumpo.com/',{method:'PUT',headers:{'content-type':'image/jpeg','x-whumpo-photo-handoff':'null','x-photo-name':encodeURIComponent('Synthetic')},body:jpeg}),{...seedEnv,DB:t.scope},t.user,t.project,photo);if(up.status!=='ready')throw Error('Photo upload '+up.status);
 // Synthetic trusted safety result: no real detection provider is configured or contacted.
 await db.prepare("UPDATE project_photo_safety SET state='approved',csam_check='clear',sexual_check='clear',scanner_reference='synthetic-capacity',expires_at=? WHERE file_id=?").bind(new Date(Date.now()+3600000).toISOString(),photo).run();
 const version=await changeFixtureWebsite(t.scope,t.user,t.project,[{type:'pages.setPhotos',pageId:'home',photos:[{id:photo,alt:'Synthetic'}]}]);
 const review=await chat(t,'/publish '+version);await chat(t,'/confirm '+review);
 const contact=await chat(t,'/contact-on '+t.project);await chat(t,'/confirm-contact '+contact);
 t.revision=(await m.contacts.activeContact(db,t.project)).revision;t.photo=photo;
 await publishBackend(t,t.project,abusiveSource?abusive:calculator);
 // Visitor application on the same project: program, live page, invited visitor sessions.
 const appVersion=id(),appTest=id(),appReview=id(),pageReview=id();
 await m.backend.saveBackend(t.scope,t.user,t.project,appVersion,'export default ({state,input})=>({state:{note:input.note,edits:(state.edits??0)+1},result:"Saved"})');
 const tested=await m.backend.testBackend(t.scope,seedRuntime,t.user,t.project,appVersion,appTest,{state:{},input:{note:'seed'}});if(!tested?.result?.ok)throw Error('App test failed');
 // WH-126: the application consumes the project's visitor access module (real owner save and activation path).
 await enableFixtureVisitorAccess(t.scope,t.user,t.project);
 await m.appActivation.prepareApplication(t.scope,t.user,t.project,appReview,'enable',appVersion,appTest);await m.appActivation.confirmApplication(t.scope,t.user,appReview);
 await api(t,'/projects/'+t.project+'/application-page',{id:pageReview,form:{title:'Capacity notebook',description:'Synthetic',buttonLabel:'Save',fields:[{key:'note',label:'Note',type:'text'}]}});
 await api(t,'/application-page-reviews/'+pageReview+'/confirm',{});
 t.pageId=pageReview;t.visitors=[];
 return t;
}
async function addVisitors(t,n){for(let i=0;i<n;i++){const who=id();await db.prepare("INSERT INTO app_visitors(id,project_id,access_id) SELECT ?,?,id FROM module_instances WHERE project_id=? AND kind='access'").bind(who,t.project,t.project).run();t.visitors.push({who,token:await m.appData.issueAppSession(db,who),revision:0});}}

// ---------------------------------------------------------------- load generation
const records=[];
async function timed(meta,url,init){
 const t=performance.now();let status=-1,tag='';
 try{
  const r=await realFetch(url,init);status=r.status;const text=await r.text();
  if(meta.kind==='backend'||meta.kind==='visitor'){try{const j=JSON.parse(text);tag=j.error??(j.state?String(j.state):j.ok===true?'ok':'');}catch{tag='?';}}
 }catch{status=-1;tag='transport';}
 const rec={...meta,status,tag,ms:performance.now()-t};records.push(rec);return rec;
}
const ipHeader=ip=>({'cf-connecting-ip':ip});
const ops={
 site:(t,meta,ip=freshIp())=>timed({...meta,kind:'site',tenant:t.name},base+'/s/'+t.project+'/',{headers:ipHeader(ip)}),
 photo:(t,meta,ip=freshIp())=>timed({...meta,kind:'photo',tenant:t.name},base+'/s/'+t.project+'/assets/'+t.photo+'.jpg',{headers:ipHeader(ip)}),
 contactGet:(t,meta,ip=freshIp())=>timed({...meta,kind:'contact_get',tenant:t.name},base+'/contact/'+t.project,{headers:ipHeader(ip)}),
 contactPost:(t,meta,ip=freshIp())=>timed({...meta,kind:'contact_post',tenant:t.name},base+'/contact/'+t.project,{method:'POST',headers:{...ipHeader(ip),origin:base,'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({id:id(),revision:String(t.revision),name:'Synthetic Visitor',email:'visitor@example.invalid',message:'Synthetic capacity message.'}).toString()}),
 backend:(t,meta,input={a:2,b:3},ip=freshIp())=>timed({...meta,kind:'backend',tenant:t.name},base+'/s/'+t.project+'/backend',{method:'POST',headers:{...ipHeader(ip),'content-type':'application/json'},body:JSON.stringify(input)}),
 // A visitor's transitions are sequential: each depends on the previous revision.
 async visitor(t,meta,v,count){for(let i=0;i<count;i++){const op={id:id(),revision:v.revision,pageId:t.pageId,input:{note:'Synthetic note '+i}};const rec=await timed({...meta,kind:'visitor',tenant:t.name},base+'/apps/'+t.project+'/data',{method:'POST',headers:{...ipHeader(freshIp()),origin:'http://localhost:8787','content-type':'application/json',cookie:`local-whumpo-app-session-${t.project}=${v.token}`},body:JSON.stringify(op)});if(rec.status===200&&rec.tag==='complete')v.revision++;}},
 appPage:(t,meta,ip=freshIp())=>timed({...meta,kind:'app_page',tenant:t.name},base+'/apps/'+t.project+'/',{headers:{...ipHeader(ip)}}),
};
async function pool(jobs,concurrency){let next=0;const run=async()=>{for(;;){const i=next++;if(i>=jobs.length)return;await jobs[i]();}};await Promise.all(Array.from({length:Math.min(concurrency,jobs.length)},run));}
const bounded=(n)=>smoke?Math.max(1,Math.ceil(n/20)):n;

function victimJobs(t,meta,volume){
 const j=[];
 for(let i=0;i<bounded(40*scale);i++)j.push(()=>ops.site(t,meta));
 for(let i=0;i<bounded(25*scale);i++)j.push(()=>ops.photo(t,meta));
 for(let i=0;i<bounded(10);i++)j.push(()=>ops.contactGet(t,meta));
 for(let i=0;i<bounded(6);i++)j.push(()=>ops.contactPost(t,meta));
 for(let i=0;i<bounded(40);i++)j.push(()=>ops.backend(t,meta));
 for(let i=0;i<bounded(15);i++)j.push(()=>ops.appPage(t,meta));
 const visitors=t.visitors.slice(t.visitorCursor??0,(t.visitorCursor??0)+6);t.visitorCursor=(t.visitorCursor??0)+6;
 for(const v of visitors)j.push(()=>ops.visitor(t,meta,v,bounded(6)));
 return shuffle(j);
}
function noisyJobs(t,meta){
 const j=[],scaleN=n=>bounded(n*scale);
 for(let i=0;i<scaleN(150);i++)j.push(()=>ops.site(t,meta));
 for(let i=0;i<scaleN(150);i++)j.push(()=>ops.photo(t,meta));
 // Same single abusive IP for contact reads: the per-IP limiter should engage.
 for(let i=0;i<bounded(200);i++)j.push(()=>ops.contactGet(t,meta,'203.0.113.9'));
 // Distributed submitters: only the per-project atomic caps can stop them.
 for(let i=0;i<bounded(60);i++)j.push(()=>ops.contactPost(t,meta));
 // Half of the public backend calls are CPU-spinning, half allocate or recurse; 220 > the 100/project/day cap.
 const modes=['spin','alloc','recurse'];
 for(let i=0;i<bounded(220);i++)j.push(()=>ops.backend(t,meta,i%2?{mode:modes[(i>>1)%3]}:{a:1,b:1}));
 for(let i=0;i<bounded(60);i++)j.push(()=>ops.appPage(t,meta));
 for(const v of t.visitors)j.push(()=>ops.visitor(t,meta,v,bounded(8)));
 return shuffle(j);
}

// ---------------------------------------------------------------- summaries
function summarize(rows){
 const groups=new Map();
 for(const r of rows){const k=r.kind;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);}
 const out={};
 for(const [k,list] of groups){
  const ms=list.map(r=>r.ms).sort((a,b)=>a-b),codes={},tags={};
  for(const r of list){codes[r.status]=(codes[r.status]??0)+1;if(r.tag)tags[r.tag]=(tags[r.tag]??0)+1;}
  out[k]={n:list.length,p50:round(pct(ms,50)),p95:round(pct(ms,95)),p99:round(pct(ms,99)),max:round(ms[ms.length-1]),codes,tags};
 }
 return out;
}
function allSummary(rows){const ms=rows.map(r=>r.ms).sort((a,b)=>a-b),bad=rows.filter(r=>r.status>=500||r.status<0).length,limited=rows.filter(r=>r.status===429).length;return {n:rows.length,p50:round(pct(ms,50)),p95:round(pct(ms,95)),p99:round(pct(ms,99)),max:round(ms[ms.length-1]),limited429:limited,serverErrors5xx:bad};}
const view=(rows,f)=>rows.filter(f);
const report={meta:{date:new Date().toISOString(),node:process.versions.node,platform:process.platform+' '+process.arch,cpus:cpus().length,memGiB:round(totalmem()/2**30,1),smoke,scale,tenants:tenantCount,seed,configuredLimiters:configured,localOnly:true},phases:{}};
const log=(...a)=>console.log(...a);

// ---------------------------------------------------------------- scenarios
try{
 log(`Capacity harness (local only) node ${process.versions.node}, ${smoke?'SMOKE':'full'} volumes, scale ${scale}, ${tenantCount} tenants, seed ${seed}`);
 const t0=performance.now();
 const victims=[];const noisy=await seedTenant('noisy','noisy',{abusiveSource:true});
 for(let i=1;i<tenantCount;i++)victims.push(await seedTenant('victim-'+i,'victim'));
 await addVisitors(noisy,15);for(const v of victims)await addVisitors(v,12);
 log(`Seeded ${tenantCount} tenants (published photo site, contact form, public backend, live visitor app) in ${round((performance.now()-t0)/1000)} s`);

 // Runtime bounds, called directly at the service boundary (no gateway, no quotas).
 // Each direct call names an opaque fairness lane (WH-075); by default a fresh lane, like distinct projects.
 const newLane=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');
 const call=async(source,input,rawBody,lane=newLane())=>{const t=performance.now();const r=await runtime.dispatchFetch('https://runtime/execute',{method:'POST',headers:{'content-type':'application/json','x-whumpo-lane':lane},body:rawBody??JSON.stringify({version:1,source,input})});const body=await r.json().catch(()=>({}));return {status:r.status,result:body.ok===true?'ok':body.error??'?',ms:performance.now()-t};};
 const bound=[];const row=async(name,source,input,raw)=>{const first=await call(source,input,raw);const after=await call('export default ({a,b})=>({sum:a+b})',{a:1,b:2});bound.push({case:name,status:first.status,result:first.result,ms:round(first.ms),nextBenign:after.result});};
 await call(calculator,{a:1,b:1});
 await row('benign sum',calculator,{a:1,b:2});
 await row('infinite loop',abusive,{mode:'spin'});
 await row('allocation growth (4 MiB heap)',abusive,{mode:'alloc'});
 await row('unbounded recursion',abusive,{mode:'recurse'});
 await row('unresolved promise','export default ()=>new Promise(()=>{})',{});
 await row('oversized output (>16 KiB)','export default ()=>"x".repeat(20000)',{});
 await row('source over 32 KiB','export default ()=>1;'+'/'.repeat(33000),{});
 await row('input over 8 KiB','export default ()=>1',{v:'x'.repeat(9000)});
 await row('request body over 48 KiB','export default ()=>1',null,JSON.stringify({version:1,source:'export default ()=>1',input:{v:'x'.repeat(50000)}}));
 await row('regex backtracking','export default ()=>/^(a+)+$/.test("a".repeat(40)+"b")',{});
 report.runtimeBounds=bound;
 // Concurrency gate: runtime allows 2 simultaneous guest executions, at most 1 per lane, then returns busy (503).
 const conc=[];
 for(const lanes of ['distinct','same'])for(const [label,source,input] of [['benign',calculator,{a:1,b:2}],['spinning',abusive,{mode:'spin'}]]){
  for(const level of smoke?[1,2,4]:[1,2,4,8,16]){
   const waves=smoke?2:4,res=[];const t=performance.now();
   for(let w=0;w<waves;w++){const shared=newLane();res.push(...await Promise.all(Array.from({length:level},()=>call(source,input,undefined,lanes==='same'?shared:newLane()))));}
   const ms=res.map(r=>r.ms).sort((a,b)=>a-b),busy=res.filter(r=>r.result==='busy').length;
   conc.push({lanes,workload:label,concurrency:level,calls:res.length,busy,okOrGuestError:res.length-busy,p50:round(pct(ms,50)),p95:round(pct(ms,95)),max:round(ms[ms.length-1]),throughputPerSec:round(res.length/((performance.now()-t)/1000),1)});
  }
 }
 report.runtimeConcurrency=conc;
 log('Runtime bounds and concurrency gate measured.');

 // D1 statements and latency per request, sequential and unloaded.
 const unit={};
 for(const [name,fn] of Object.entries({site:()=>ops.site(victims[0],{phase:'unit'}),photo:()=>ops.photo(victims[0],{phase:'unit'}),contact_get:()=>ops.contactGet(victims[0],{phase:'unit'}),contact_post:()=>ops.contactPost(victims[0],{phase:'unit'}),backend:()=>ops.backend(victims[0],{phase:'unit'}),app_page:()=>ops.appPage(victims[0],{phase:'unit'}),visitor:()=>ops.visitor(victims[0],{phase:'unit'},victims[0].visitors[11],1)})){
  const n=name==='contact_post'?3:name==='backend'||name==='visitor'?3:20,d0=stats.d1,r0=stats.runtime,t=performance.now();
  for(let i=0;i<n;i++)await fn();
  unit[name]={requests:n,d1PerRequest:round((stats.d1-d0)/n,1),runtimeCallsPerRequest:round((stats.runtime-r0)/n,1),sequentialMeanMs:round((performance.now()-t)/n)};
 }
 report.unitCost=unit;
 // The unit-cost run consumed a few quota units; reset nothing, but account for it below.
 log('Unit costs measured.');

 // ---- Phase A: victims alone
 const loop=monitorEventLoopDelay({resolution:10});
 const victimRows=(phase)=>records.filter(r=>r.phase===phase&&r.group==='victim');
 {
  const start=performance.now();
  loop.reset();loop.enable();
  await Promise.all(victims.map(t=>pool(victimJobs(t,{phase:'A-quiet',group:'victim'}),3)));loop.disable();
  report.phases.A={wallSeconds:round((performance.now()-start)/1000),eventLoopDelayMs:{p50:round(loop.percentile(50)/1e6),p99:round(loop.percentile(99)/1e6),max:round(loop.max/1e6)},victim:allSummary(victimRows('A-quiet')),byKind:summarize(victimRows('A-quiet'))};
  log(`Phase A (victims alone) ${report.phases.A.wallSeconds}s`);
 }
 // ---- Phase S: simultaneous burst. Hostile public backend calls from the noisy tenant and benign calls
 // from every victim are all in flight at once, to exercise the runtime's global concurrency gate.
 {
  const r0=stats.runtime,start=performance.now();
  const hostile=Array.from({length:bounded(40)},(_,i)=>ops.backend(noisy,{phase:'S',group:'noisy'},{mode:['spin','alloc','recurse'][i%3]}));
  const benign=victims.flatMap(t=>Array.from({length:bounded(5)},()=>ops.backend(t,{phase:'S',group:'victim'})));
  await Promise.all([...hostile,...benign]);
  const sRows=records.filter(r=>r.phase==='S');
  report.phases.S={wallSeconds:round((performance.now()-start)/1000),runtimeCalls:stats.runtime-r0,victim:summarize(sRows.filter(r=>r.group==='victim')).backend,noisy:summarize(sRows.filter(r=>r.group==='noisy')).backend};
  log(`Phase S (simultaneous backend burst) ${report.phases.S.wallSeconds}s`);
 }
 // ---- Phase B: same victim work while the noisy tenant floods all paths
 {
  const peak0=stats.runtimePeak;stats.runtimePeak=0;const d0=stats.d1,r0=stats.runtime,start=performance.now();
  const nj=noisyJobs(noisy,{phase:'B-noisy',group:'noisy'});
  loop.reset();loop.enable();
  await Promise.all([pool(nj,smoke?8:24),...victims.map(t=>pool(victimJobs(t,{phase:'B-noisy',group:'victim'}),3))]);loop.disable();
  const wall=(performance.now()-start)/1000;
  report.phases.B={wallSeconds:round(wall),eventLoopDelayMs:{p50:round(loop.percentile(50)/1e6),p99:round(loop.percentile(99)/1e6),max:round(loop.max/1e6)},victim:allSummary(victimRows('B-noisy')),victimByKind:summarize(victimRows('B-noisy')),noisy:allSummary(records.filter(r=>r.phase==='B-noisy'&&r.group==='noisy')),noisyByKind:summarize(records.filter(r=>r.phase==='B-noisy'&&r.group==='noisy')),d1Statements:stats.d1-d0,runtimeCalls:stats.runtime-r0,runtimePeakInflight:stats.runtimePeak,previousPeak:peak0};
  // F4: runtime refusals (503 busy/unavailable) must not be charged; executed calls (200/422) are.
  const charged=[];
  for(const t of [noisy,...victims]){const mine=records.filter(r=>r.tenant===t.name&&r.kind==='backend');charged.push({tenant:t.name,executed:mine.filter(r=>r.status===200||r.status===422).length,busy503:mine.filter(r=>r.status===503).length,refused429:mine.filter(r=>r.status===429).length,projectCounter:(await db.prepare('SELECT calls FROM backend_public_usage WHERE project_id=?').bind(t.project).first())?.calls??0});}
  report.phases.B.backendCharging=charged;
  log(`Phase B (noisy neighbour) ${report.phases.B.wallSeconds}s`);
 }
 // ---- Phase P: what per-IP limits do and do not do
 {
  const t=victims[0];const probe=async(label,fn,n)=>{const rows=[];for(let i=0;i<n;i++)rows.push(await fn(i));return {label,requests:n,ok:rows.filter(r=>r.status===200).length,limited429:rows.filter(r=>r.status===429).length};};
  const n=bounded(150);
  report.limiterProbe=[
   await probe('contact form GET, one IP (API_LIMITER 120/60 s)',()=>ops.contactGet(t,{phase:'P'},'203.0.113.77'),n),
   await probe('contact form GET, distinct IP each request',()=>ops.contactGet(t,{phase:'P'}),n),
   await probe('site page GET, one IP (no limiter in site host)',()=>ops.site(t,{phase:'P'},'203.0.113.78'),n),
   await probe('public backend POST, one IP (20/client/project/day inside the project quota)',(i)=>ops.backend(t,{phase:'P'},{a:i,b:1},'203.0.113.79'),smoke?3:5),
   await probe('visitor app page GET, one IP (API_LIMITER 120/60 s)',()=>ops.appPage(t,{phase:'P'},'203.0.113.80'),n),
  ];
  log('Per-IP limiter probe done.');
 }
 // ---- Phase L: anonymous lockout (F5). One source floods a fresh tenant; others must still be served.
 {
  const t=await seedTenant('lockout','victim');const one='203.0.113.90',start=performance.now();
  const probe=async(label,fn,n,concurrency=1)=>{const rows=[];const jobs=Array.from({length:n},(_,i)=>async()=>{rows.push(await fn(i));});await pool(jobs,concurrency);return {label,requests:n,ok:rows.filter(r=>r.status===200).length,limited429:rows.filter(r=>r.status===429).length,other:rows.filter(r=>![200,429].includes(r.status)).length};};
  const rows=[
   await probe('public backend POST, one IP',i=>ops.backend(t,{phase:'L'},{a:i,b:1},one),bounded(40)),
   await probe('public backend POST, distinct IPs afterwards',i=>ops.backend(t,{phase:'L'},{a:i,b:2}),bounded(10)),
   await probe('contact POST, one IP',()=>ops.contactPost(t,{phase:'L'},one),bounded(15)),
   await probe('contact POST, distinct IPs afterwards',()=>ops.contactPost(t,{phase:'L'}),bounded(3)),
   await probe('photo GET, one IP',()=>ops.photo(t,{phase:'L'},one),smoke?20:450,8),
   await probe('photo GET, distinct IPs afterwards',()=>ops.photo(t,{phase:'L'}),bounded(10)),
  ];
  report.phases.L={wallSeconds:round((performance.now()-start)/1000),rows,projectBackendCalls:(await db.prepare('SELECT calls FROM backend_public_usage WHERE project_id=?').bind(t.project).first())?.calls??0,clientLimits:{backend:20,contact:10,photo:400}};
  log(`Phase L (anonymous lockout) ${report.phases.L.wallSeconds}s`);
 }
 // ---- Phase D: shared daily budgets. Real traffic from filler accounts, 5 projects each.
 {
  const usage=async()=>(await db.prepare('SELECT coalesce(sum(calls),0) n FROM backend_public_usage WHERE day=?').bind(day()).first()).n;
  const own=async(t)=>(await db.prepare('SELECT coalesce(calls,0) n FROM backend_public_usage WHERE project_id=?').bind(t.project).first())?.n??0;
  const before=await usage(),victimBefore=await own(victims[0]);
  const fillers=[];
  const accounts=smoke?1:2,perAccount=smoke?2:5;
  for(let a=0;a<accounts;a++){const t=await account();t.name='filler-'+a;for(let p=0;p<perAccount;p++){const project=await newProjectRow(t,'Filler '+a+'-'+p);await publishBackend(t,project,calculator);fillers.push({...t,project,name:'filler-'+a});}}
  const start=performance.now();
  const jobs=[];for(const f of fillers)for(let i=0;i<(smoke?20:100);i++)jobs.push(()=>ops.backend(f,{phase:'D-fill',group:'filler'}));
  await pool(shuffle(jobs),16);
  const after=await usage(),victimAfter=await own(victims[0]);
  const probes=[];for(let i=0;i<bounded(5);i++)probes.push(await ops.backend(victims[0],{phase:'D-victim-probe',group:'victim'}));
  // A brand-new light account after the fillers: fair share must still admit it.
  const fresh=await account();fresh.name='fresh-light';const freshProject=await newProjectRow(fresh,'Fresh light');await publishBackend(fresh,freshProject,calculator);
  for(let i=0;i<bounded(10);i++)await ops.backend({...fresh,project:freshProject},{phase:'D-fresh-probe',group:'victim'});
  const finalUsage=await usage(),accountSums=(await db.prepare('SELECT p.owner_user_id u,sum(c.calls) n FROM backend_public_usage c JOIN projects p ON p.id=c.project_id WHERE c.day=? GROUP BY p.owner_user_id ORDER BY n DESC').bind(day()).all()).results;
  report.phases.D={wallSeconds:round((performance.now()-start)/1000),platformBackendCallsBefore:before,afterFillers:after,afterVictimProbe:finalUsage,fillerProjects:fillers.length,fillerAccounts:accounts,fillerCodes:summarize(records.filter(r=>r.phase==='D-fill')).backend?.codes,victimOwnProjectCallsBefore:victimBefore,victimOwnProjectCallsAfter:victimAfter,victimProbeCodes:summarize(records.filter(r=>r.phase==='D-victim-probe')).backend?.codes,freshAccountProbeCodes:summarize(records.filter(r=>r.phase==='D-fresh-probe')).backend?.codes,accountDailySums:accountSums.map(r=>r.n),largestAccountDailySum:accountSums[0]?.n??0,platformCap:1000,accountCap:500,projectCap:100,fairShare:{reserveFrom:500,perAccount:100}};
  log(`Phase D (shared platform budget) ${report.phases.D.wallSeconds}s: platform used ${finalUsage}/1000`);
 }
 // ---- Phase C: serving and recovery while the backend budget is exhausted and the noisy tenant is spent
 {
  const rows=[];const sample=async(name,fn,n)=>{const out=[];for(let i=0;i<n;i++)out.push(await fn());rows.push({path:name,requests:n,ok:out.filter(r=>r.status===200).length,codes:Object.fromEntries([...new Set(out.map(r=>r.status))].map(c=>[c,out.filter(r=>r.status===c).length]))});};
  const t=victims[0],n=bounded(10);
  await sample('victim site page',()=>ops.site(t,{phase:'C'}),n);
  await sample('victim photo',()=>ops.photo(t,{phase:'C'}),n);
  await sample('victim contact form GET',()=>ops.contactGet(t,{phase:'C'}),n);
  await sample('victim visitor app page',()=>ops.appPage(t,{phase:'C'}),n);
  await sample('victim visitor transition',async()=>{const v=t.visitors[10];const before=records.length;await ops.visitor(t,{phase:'C'},v,1);return records[before];},3);
  await sample('victim public backend after filler accounts (fair share)',()=>ops.backend(t,{phase:'C'}),3);
  await sample('noisy tenant own site page',()=>ops.site(noisy,{phase:'C'}),n);
  // Runtime recovery after hostile traffic: a benign call succeeds immediately.
  const recovery=[];for(let i=0;i<5;i++)recovery.push((await call(calculator,{a:1,b:2})).result);
  report.phases.C={samples:rows,runtimeRecoveryAfterHostile:recovery};
  log('Phase C (serving and recovery) done.');
 }
 // ---- Phase E: monthly R2 read budgets. Counters are pre-set by fixture writes (the mechanism is measured, not 100,000 requests).
 {
  const period=new Date().toISOString().slice(0,7),readsBefore=(await db.prepare('SELECT read_ops FROM storage_usage WHERE period=?').bind(period).first())?.read_ops??0;
  const count=rows=>({requests:rows.length,ok:rows.filter(r=>r.status===200).length,status503:rows.filter(r=>r.status===503).length,status429:rows.filter(r=>r.status===429).length});
  // E1: the noisy tenant reaches its per-project monthly budget (10,000) while the platform is past the 50,000 fair-share mark.
  const trigger=(await db.prepare("SELECT sql FROM sqlite_master WHERE name='storage_project_usage_update'").first()).sql;
  await db.prepare('DROP TRIGGER storage_project_usage_update').run();await db.prepare('UPDATE storage_project_usage SET read_ops=? WHERE project_id=? AND period=?').bind(9990,noisy.project,period).run();await db.prepare(trigger).run();
  await db.prepare('UPDATE storage_usage SET read_ops=? WHERE period=?').bind(60000,period).run();
  const burst=[];for(let i=0;i<20;i++)burst.push(await ops.photo(noisy,{phase:'E',group:'noisy'}));
  const victim=[];for(let i=0;i<5;i++)victim.push(await ops.photo(victims[1]??victims[0],{phase:'E',group:'victim'}));
  // E2: the platform ceiling itself still applies to everyone.
  await db.prepare('UPDATE storage_usage SET read_ops=? WHERE period=?').bind(99995,period).run();
  const ceiling=[];for(let i=0;i<10;i++)ceiling.push(await ops.photo(victims[(i%victims.length)],{phase:'E',group:'victim'}));
  const html=await ops.site(victims[0],{phase:'E',group:'victim'});
  report.phases.E={readOpsBeforeCounterPreload:readsBefore,noisyProjectCounterSetTo:9990,platformCounterSetTo:60000,noisyPhotoBurst:count(burst),victimPhotoAfter:count(victim),platformCeiling:{counterSetTo:99995,victimPhotos:count(ceiling)},victimHtmlStatus:html.status,platformReadCeiling:100000,projectReadBudget:10000};
  log('Phase E (R2 read budgets) done.');
 }
 report.limiterDenied=limiterState.denied;
 report.d1StatementsTotal=stats.d1;report.runtimeCallsTotal=stats.runtime;
 const rt=stats.runtimeMs.slice().sort((a,b)=>a-b);report.runtimeServiceLatency={calls:rt.length,p50:round(pct(rt,50)),p95:round(pct(rt,95)),p99:round(pct(rt,99)),max:round(rt[rt.length-1])};
 report.totalWallSeconds=round((performance.now()-t0)/1000);
 // Raw per-kind tables for pasting.
 const fmt=(s)=>Object.entries(s).map(([k,v])=>`${k.padEnd(13)} n=${String(v.n).padStart(5)} p50=${String(v.p50).padStart(6)} p95=${String(v.p95).padStart(6)} p99=${String(v.p99).padStart(6)} max=${String(v.max).padStart(7)} codes=${JSON.stringify(v.codes)}${Object.keys(v.tags).length?' tags='+JSON.stringify(v.tags):''}`).join('\n');
 log('\n=== Phase A (victims alone) ===\n'+fmt(report.phases.A.byKind));
 log('\n=== Phase B victims during noisy flood ===\n'+fmt(report.phases.B.victimByKind));
 log('\n=== Phase B noisy tenant ===\n'+fmt(report.phases.B.noisyByKind));
 log('\n=== JSON report ===');log(JSON.stringify(report,null,1));
 if(jsonOut)await writeFile(jsonOut,JSON.stringify(report,null,1));
}finally{await cleanup();}
