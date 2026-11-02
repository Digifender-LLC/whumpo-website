// WH-051: delayed analytics cannot block serving or corrupt billing. Drives the sites Worker's real default export on a
// connected custom domain (real domain-hosting handlers, recording provider/DNS stub, global fetch throws) on local
// SQLite (default) or local D1 (`--d1`). Synthetic accounts only; no network, provider call, deploy or send.
// Measurement statements are the ones a public GET issues beyond the identical HEAD (which is never measured); the test
// stalls only those, as a slow or unavailable D1 would after the response, and checks that:
//   1. a custom-domain page costs one hostname lookup: the after-response count reuses the project serving resolved;
//   2. responses return while every measurement is stalled, and stalled D1 work after the response stays within the
//      MAX_IN_FLIGHT measurement budget; shed work is disclosed, so counted + missed equals the pages served;
//   3. a stalled measurement that then fails is disclosed once D1 recovers and does not change the page;
//   4. measurement writes only site_traffic_daily and site_traffic_quality: every other table (billing, cost, capacity,
//      usage and quota tables included) is unchanged, no trigger fires from a traffic table and no billing module reads it.
// Prints a JSON line of local statement counts and serving times; timings are not regression gates.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {createFixtureProject,currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';

const m=await currentSiteFixtureHandlers(),{sendChat,readChat,host,readTraffic,reviewHosting,confirmHosting,refreshHosting,pendingMeasurementGaps,MAX_IN_FLIGHT}=m;
const store=await databaseFixture(),db=store.db,scopes=new Map(),scope=u=>scopes.get(u),id=()=>crypto.randomUUID();
const fixtureValue=['fixture','value'].join('-'),config={token:fixtureValue,zone:id().replaceAll('-',''),target:'hosting.whumpo.site'};
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('No network is allowed');};
const providers=new Map(),proofs=new Map();
const transport=async(input,init)=>{
 const u=new URL(input);assert.equal(init.redirect,'manual');
 if(u.hostname==='cloudflare-dns.com'){
  const name=u.searchParams.get('name'),txt=u.searchParams.get('type')==='TXT',hostname=txt?name.replace(/^_whumpo\./,''):name;
  return Response.json({Status:0,Answer:[{name:name+'.',type:txt?16:5,data:txt?JSON.stringify('whumpo-verification='+proofs.get(hostname)):config.target+'.'}]});
 }
 assert.equal(u.origin,'https://api.cloudflare.com');
 if(init.method==='POST'){const hostname=JSON.parse(init.body).hostname,providerId=id();providers.set(providerId,hostname);return Response.json({success:true,result:{id:providerId,hostname,status:'active',ssl:{status:'active'}}});}
 const providerId=u.pathname.split('/').pop();
 if(providers.has(providerId))return Response.json({success:true,result:{id:providerId,hostname:providers.get(providerId),status:'active',ssl:{status:'active'}}});
 return Response.json({success:true,result:[],result_info:{total_count:0}});
};
async function account(){const a=await workspaceFixture(db,m);scopes.set(a.account,await a.scope());return a.account;}
async function chat(user,content){const turn=id(),state=await readChat(scope(user),user);const sent=await sendChat(scope(user),user,{id:turn,content,revision:state.state.revision});assert.equal(sent.status,200,content);return turn;}
async function connect(user,project,hostname){
 const claimId=await chat(user,`/domain ${hostname} ${project}`);
 proofs.set(hostname,(await db.prepare('SELECT token AS proof FROM domain_claims WHERE id=?').bind(claimId).first()).proof);
 const review=await reviewHosting(scope(user),user,id(),claimId,config);
 assert.equal((await confirmHosting(scope(user),user,review.id,config,transport)).state,'provisioning');
 assert.equal((await refreshHosting(scope(user),user,review.id,config,transport)).connected,true);
}

// Recording D1: every statement is logged; a statement is a measurement when its SQL is not one the HEAD issued.
const raw=new WeakMap(),log=[];let servingSQL=null,gate=null,failing=false,pending=0,peak=0;
const measurement=sql=>servingSQL!==null&&!servingSQL.has(sql);
function statement(s,sql){
 const w={bind:(...a)=>statement(s.bind(...a),sql)};
 for(const k of ['first','run','all','raw'])w[k]=async(...a)=>{
  log.push(sql);if(!measurement(sql))return s[k](...a);
  pending++;peak=Math.max(peak,pending);
  try{if(gate)await gate.promise;if(failing)throw Error('synthetic delayed telemetry failure');return await s[k](...a);}finally{pending--;}
 };
 raw.set(w,s);return w;
}
const recorded={prepare:sql=>statement(db.prepare(sql),sql),batch:list=>{for(const x of list)assert.ok(raw.has(x));return db.batch(list.map(x=>raw.get(x)));}};
const stall=()=>{let release;const promise=new Promise(r=>{release=r;});gate={promise,release};};
const open=()=>{const g=gate;gate=null;g.release();};
const within=(promise,label)=>Promise.race([promise,new Promise((_,reject)=>setTimeout(()=>reject(Error(label+' waited for a stalled measurement')),10000).unref())]);
const tasks=[],ctx={waitUntil:p=>tasks.push(p)},settle=async()=>{await Promise.all(tasks.splice(0));};
const median=values=>{const s=[...values].sort((a,b)=>a-b);return Math.round(s[Math.floor(s.length/2)]*1000)/1000;};
const rows=async sql=>(await db.prepare(sql).all()).results;
const traffic=new Set(['site_traffic_daily','site_traffic_quality']);
async function snapshot(){
 const tables=(await rows("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name")).map(r=>r.name).filter(t=>!traffic.has(t));
 const out={};for(const t of tables)out[t]=(await rows(`SELECT * FROM "${t}"`)).map(r=>JSON.stringify(r)).sort();return out;
}

try{
 const user=await account(),site=await createFixtureProject(scope(user),user,'Delayed traffic','A synthetic delayed traffic website.');
 await chat(user,'/confirm '+await chat(user,'/publish '+site.version));
 const hostname='shop-'+id().slice(0,8)+'.example.com',page='https://'+hostname+'/';await connect(user,site.project,hostname);
 const get=(env={DB:recorded},target=page)=>host.fetch(new Request(target,{headers:{'cf-connecting-ip':'198.51.100.62','user-agent':'Mozilla/5.0'}}),env,ctx);
 const totals=async()=>{const t=(await readTraffic(scope(user),user)).telemetry.projects.find(p=>p.projectId===site.project);return {counted:(await readTraffic(scope(user),user)).rows.reduce((n,r)=>n+r.requests,0),missed:t.missedMeasurements};};
 const head=await host.fetch(new Request(page,{method:'HEAD',headers:{'cf-connecting-ip':'198.51.100.62'}}),{DB:recorded},ctx);
 assert.equal(head.status,200);assert.equal(tasks.length,0,'HEAD is never measured');servingSQL=new Set(log.splice(0));
 const control=await get({DB:db});assert.equal(control.status,200);const body=await control.text();await settle();
 assert.equal(control.headers.get('cache-control'),'no-store');

 // 1. Statements per custom-domain page, measurement running normally.
 const n=20,perGet=[],servedMs={normal:[],stalled:[]};let before=await totals();
 for(let i=0;i<n;i++){const t=performance.now(),r=await get();servedMs.normal.push(performance.now()-t);assert.equal(await r.text(),body);await settle();perGet.push(log.splice(0));}
 const statements=perGet[0].length,measured=perGet[0].filter(measurement),lookups=perGet[0].filter(sql=>/FROM domain_connections/.test(sql));
 for(const list of perGet)assert.deepEqual(list,perGet[0],'every page issues the same statements');
 assert.equal((await totals()).counted,before.counted+n);
 // 2. Stalled measurement: sequential pages under a stall, then a burst over the in-flight budget.
 stall();before=await totals();const snap0=await snapshot();
 for(let i=0;i<n;i++){const t=performance.now(),r=await within(get(),'a page');servedMs.stalled.push(performance.now()-t);assert.equal(r.status,200);assert.equal(await r.text(),body);}
 open();await settle();assert.deepEqual(await totals(),{counted:before.counted+n,missed:before.missed});
 stall();peak=0;before=await totals();const burst=MAX_IN_FLIGHT+8;
 const responses=await within(Promise.all(Array.from({length:burst},()=>get())),'the burst');
 assert.ok(responses.every(r=>r.status===200&&r.headers.get('cache-control')==='no-store'));assert.equal(tasks.length,burst);
 const stalledPeak=peak,shed=pendingMeasurementGaps();
 const report={database:process.argv.includes('--d1')?'local D1':'SQLite',customDomainGet:{statements,measurementStatements:measured.length,hostnameLookups:lookups.length,measurementSQL:measured.map(s=>s.replace(/\s+/g,' ').slice(0,72))},
  stalled:{burst,maxInFlight:MAX_IN_FLIGHT,peakPendingMeasurementStatements:stalledPeak,shedBeforeRelease:shed},servedMsMedian:{normal:median(servedMs.normal),stalled:median(servedMs.stalled)}};
 console.log(JSON.stringify(report));
 assert.equal(lookups.length,1,'one hostname lookup per custom-domain page: the count reuses the project serving resolved');
 assert.deepEqual(measured.map(s=>s.match(/^INSERT INTO (\w+)/)?.[1]),['site_traffic_daily'],'a normal measurement is one aggregate upsert');
 assert.ok(stalledPeak<=MAX_IN_FLIGHT,`stalled D1 work after the response stays within the budget (${stalledPeak})`);
 assert.equal(shed,burst-MAX_IN_FLIGHT,'work over the budget is shed and remembered, not queued');
 open();await settle();
 let after=await totals();assert.equal(pendingMeasurementGaps(),0);
 assert.equal(after.counted-before.counted+after.missed-before.missed,burst,'counted plus disclosed missed equals pages served');
 assert.equal(after.missed-before.missed,burst-MAX_IN_FLIGHT);
 // 3. Stalled, then failing: pages are unchanged; the gaps are disclosed after the next successful measurement.
 stall();before=await totals();
 const failed=await within(Promise.all(Array.from({length:4},()=>get())),'failing measurements');assert.ok(failed.every(r=>r.status===200));
 failing=true;open();await settle();failing=false;assert.equal(pendingMeasurementGaps(),4);
 assert.equal((await get()).status,200);await settle();after=await totals();
 assert.deepEqual(after,{counted:before.counted+1,missed:before.missed+4});assert.equal(pendingMeasurementGaps(),0);
 // 4. Only the two traffic tables changed across every stalled, shed, failed and flushed measurement above.
 const snap1=await snapshot();assert.deepEqual(Object.keys(snap1),Object.keys(snap0));
 for(const t of Object.keys(snap0))assert.deepEqual(snap1[t],snap0[t],t+' changed while analytics was delayed');
 const billing=Object.keys(snap0).filter(t=>/^(stripe_|cost_|capacity_)|usage|ledger/.test(t));
 for(const t of ['stripe_paid_invoices','stripe_invoice_voids','stripe_subscriptions','cost_events','capacity_ledgers','storage_usage','public_client_usage'])assert.ok(billing.includes(t),t+' is compared');
 assert.deepEqual(await rows("SELECT name FROM sqlite_master WHERE type='trigger' AND tbl_name IN ('site_traffic_daily','site_traffic_quality')"),[],'no trigger fires from a traffic write');
 for(const t of traffic)assert.deepEqual((await rows(`PRAGMA foreign_key_list(${t})`)).map(r=>r.table),['projects']);
 const unknown=await get(undefined,'https://unknown-'+id().slice(0,8)+'.example.com/');assert.equal(unknown.status,404);assert.equal(tasks.length,0);log.splice(0);
 const files=dir=>readdirSync(dir).flatMap(f=>statSync(join(dir,f)).isDirectory()?files(join(dir,f)):[join(dir,f)]);
 const readers=files('src').filter(f=>/\.tsx?$/.test(f)&&f!=='src/site-traffic.ts'&&/from '\.\/site-traffic'|site_traffic_/.test(readFileSync(f,'utf8'))).sort();
 assert.deepEqual(readers,['src/index.ts','src/site-diagnostics.ts','src/site-health.ts','src/site-host.ts','src/workspace-dashboard.ts','src/workspace-observations.ts','src/workspace-view-bindings.ts'],'no billing, cost or capacity module reads traffic');
 console.log(`Delayed traffic passed (${report.database}): one hostname lookup per custom-domain page; pages return while measurement is stalled, stalled work stays within ${MAX_IN_FLIGHT} in flight, shed and failed measurements are disclosed (counted + missed = served); only the two traffic tables change (${billing.length} billing, cost, capacity and usage tables compared unchanged).`);
}finally{globalThis.fetch=originalFetch;await store.close();}
