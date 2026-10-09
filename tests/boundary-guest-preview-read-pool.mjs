// WH-004 finding B6 regression (disposable SQLite with an in-memory R2 stand-in, or local D1 + local R2 with --d1;
// synthetic JPEGs, synthetic photo clearance; no network). Anonymous guest-preview views used to inline a version's
// photos through reserveStorage(), which charged only the platform-wide monthly read pool (100,000), so one owner's
// links could exhaust it and refuse every tenant's public photos. Guest views now charge the link's project exactly
// like its public photos (WH-075): the per-client 400/day photo sub-limit, then atomically the project's monthly
// budget (10,000, operator containment, account fair share) and the platform ceiling. Counters are pre-seeded to
// stand in for prior views. Exits 1 if any assertion fails. Standalone: not in package.json or a verify profile.
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import {currentSiteFixtureHandlers,createFixtureProject,changeFixtureWebsite} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';
Error.stackTraceLimit=0;
const d1=process.argv.includes('--d1');
// Only what the upload, owner-preview and guest paths call on the private bucket.
function memoryR2(){
 const objects=new Map(),meta=key=>{const o=objects.get(key);return o?{key,size:o.bytes.length,customMetadata:o.customMetadata,body:{cancel:async()=>{}},arrayBuffer:async()=>o.bytes.slice().buffer}:null;};
 return {put:async(key,value,options={})=>{if(options.onlyIf?.etagDoesNotMatch==='*'&&objects.has(key))return null;objects.set(key,{bytes:new Uint8Array(value),customMetadata:options.customMetadata??{}});return meta(key);},get:async key=>meta(key),head:async key=>meta(key)};
}
const m=await currentSiteFixtureHandlers(),store=d1?await databaseFixture({d1:true,r2:true}):await databaseFixture(),{db}=store,env=d1?store.env:{DB:db,FILES:memoryR2()};
const bundle=await build({stdin:{contents:"export * from './src/storage-budget';export * from './src/public-admission';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const budget=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const dir=await mkdtemp('/tmp/whumpo-guest-pool-');
const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('No network is allowed');};
try{
 execFileSync('python3',['-c',"from PIL import Image; import sys; Image.new('RGB',(32,24),(60,110,80)).save(sys.argv[1]); Image.new('RGB',(24,32),(90,60,40)).save(sys.argv[2])",dir+'/a.jpg',dir+'/b.jpg']);
 const actor=await workspaceFixture(db,m),scope=await actor.scope(),user=actor.account;await paidPlan(db,user,'personal');
 const site=await createFixtureProject(scope,user,'Photo garden','A neighborhood website','clay'),photos=[];
 for(const [name,file] of [['Garden','a.jpg'],['Gate','b.jpg']]){
  const photo=crypto.randomUUID();photos.push({id:photo,alt:name});
  await m.uploadPhoto(new Request('https://whumpo.com/',{method:'PUT',headers:{'content-type':'image/jpeg','x-whumpo-photo-handoff':'null','x-photo-name':name},body:new Uint8Array(await readFile(dir+'/'+file))}),{...env,DB:scope},user,site.project,photo);
  await db.prepare("UPDATE project_photo_safety SET state='approved',csam_check='clear',sexual_check='clear',scanner_reference='synthetic',expires_at=? WHERE file_id=?").bind(new Date(Date.now()+3600000).toISOString(),photo).run();
 }
 const version=await changeFixtureWebsite(scope,user,site.project,[{type:'pages.setPhotos',pageId:'home',photos}]);
 const api=(path,method='GET',data)=>m.worker.fetch(new Request('https://whumpo.com/api'+path,{method,headers:{origin:'https://whumpo.com',cookie:'__Host-whumpo_session='+actor.token,...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})}),{...env,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})}},{waitUntil:()=>{}});
 const request={id:crypto.randomUUID(),versionId:version,expiresInHours:2,feedback:false},prepared=await (await api(`/projects/${site.project}/guest-previews/prepare`,'POST',request)).json();
 const issued=await (await api(`/projects/${site.project}/guest-previews`,'POST',{...request,confirmation:prepared.confirmation})).json();
 assert.match(issued.token,/^[A-Za-z0-9_-]{43}$/);
 const guestIP='198.51.100.7',view=(ip=guestIP)=>m.host.fetch(new Request('https://preview.whumpo.site/view',{method:'POST',headers:{origin:'https://preview.whumpo.site','content-type':'application/x-www-form-urlencoded','cf-connecting-ip':ip},body:'token='+issued.token}),env);
 const n=async(sql,...p)=>(await db.prepare(sql).bind(...p).first())?.n??0;
 const period=new Date().toISOString().slice(0,7);
 const pool=()=>n('SELECT read_ops n FROM storage_usage WHERE period=?',period);
 const projectBudget=(project=site.project)=>n('SELECT read_ops n FROM storage_project_usage WHERE project_id=? AND period=?',project,period);
 const clientKey=ip=>budget.publicClientKey(new Request('https://preview.whumpo.site/view',{headers:{'cf-connecting-ip':ip}}),'photo',site.project);
 const client=async(ip=guestIP)=>n("SELECT uses n FROM public_client_usage WHERE scope='photo' AND project_id=? AND client_key=?",site.project,await clientKey(ip));
 const counters=async()=>({pool:await pool(),project:await projectBudget(),client:await client()});
 // Counters only move by +1 through their triggers; stand-in prior usage is written with the trigger briefly removed.
 const seed=async(table,sql,...params)=>{const name=table+'_update',trigger=(await db.prepare('SELECT sql FROM sqlite_master WHERE name=?').bind(name).first()).sql;await db.prepare('DROP TRIGGER '+name).run();try{await db.prepare(sql).bind(...params).run();}finally{await db.prepare(trigger).run();}};
 const setPool=value=>db.prepare('UPDATE storage_usage SET read_ops=? WHERE period=?').bind(value,period).run();
 const setProject=(value,project=site.project)=>seed('storage_project_usage','UPDATE storage_project_usage SET read_ops=? WHERE project_id=? AND period=?',value,project,period);
 const other=await workspaceFixture(db,m),otherScope=await other.scope(),bystander=await createFixtureProject(otherScope,other.account,'Bystander','Another tenant','ocean');
 const bystanderRead=()=>budget.reservePublicPhotoRead(db,new Request('https://'+bystander.project+'.whumpo.site/assets/'+crypto.randomUUID()+'.jpg',{headers:{'cf-connecting-ip':'203.0.113.9'}}),bystander.project);
 const refused=async(response,status,text)=>{assert.equal(response.status,status);const body=await response.text();assert.ok(body.includes(text),body);assert.ok(!body.includes('data:image'));return body;};

 // 1. Exact-version delivery is unchanged; the owner preview keeps the platform-pool accounting, while one guest
 //    view of a two-photo version charges two reads to the project budget, the platform ceiling and the client.
 let before=await counters();
 const ownerHTML=await (await api('/site-versions/'+version+'/preview')).text();
 assert.deepEqual(await counters(),{...before,pool:before.pool+2},'owner preview: platform pool only (unchanged by B6)');
 before=await counters();
 const first=await view(),html=await first.text();
 assert.equal(first.status,200);assert.equal(html,ownerHTML,'guest sees exactly the owner preview bytes');
 assert.equal(html.split('src="data:image/jpeg;base64,').length,3);
 assert.deepEqual(await counters(),{pool:before.pool+2,project:before.project+2,client:before.client+2},'guest view charges the project budget, platform ceiling and per-client sub-limit');

 // 2. Per-client bound: a client whose daily photo sub-limit cannot cover the view gets a bounded 429; the batch is
 //    all-or-none, so no project or platform read is spent. Another connection still views.
 await seed('public_client_usage',"UPDATE public_client_usage SET uses=399 WHERE scope='photo' AND project_id=? AND client_key=?",site.project,await clientKey(guestIP));
 before=await counters();
 await refused(await view(),429,'Too many requests from this connection today. Please try again tomorrow.');
 assert.deepEqual(await counters(),before,'a client refusal charges nothing');
 assert.equal((await view('198.51.100.8')).status,200);

 // 3. Project budget: once this project's 10,000 monthly reads cannot cover the view, guests get the generic 503 and
 //    the pool is not consumed beyond the project budget; another tenant's public photo read still succeeds.
 await setProject(9999);before=await counters();
 const projectRefusal=await refused(await view('198.51.100.9'),503,'This preview is temporarily unavailable.');
 assert.equal(await projectBudget(),9999,'all-or-none: the remaining read is not taken by a partial view');
 assert.equal(await pool(),before.pool,'the platform pool is not consumed beyond the project budget');
 const poolBeforeBystander=await pool();await bystanderRead();assert.equal(await pool(),poolBeforeBystander+1,'another tenant\'s public photo read still succeeds');

 // 4. Account fair share: with the platform pool past half, an account already holding 10,000 reads this month
 //    (here across two projects) is refused for guest views too; an account under its share keeps reading.
 await setProject(1);
 const second=await createFixtureProject(scope,user,'Second garden','Another project of the same owner','clay');
 await budget.reservePublicPhotoRead(db,new Request('https://'+second.project+'.whumpo.site/',{headers:{'cf-connecting-ip':'203.0.113.10'}}),second.project);
 await setProject(9999,second.project);
 await setPool(40000);assert.equal((await view('198.51.100.10')).status,200,'below half the pool, fair share does not apply');
 await setPool(60000);before=await counters();
 const fairRefusal=await refused(await view('198.51.100.11'),503,'This preview is temporarily unavailable.');
 assert.equal(await projectBudget(),before.project);assert.equal(await pool(),60000,'a fair-share refusal consumes no platform read');
 await bystanderRead();assert.equal(await pool(),60001,'another tenant under its share is still admitted');

 // 5. Platform ceiling: still enforced and still all-or-none; the guest learns nothing about which budget refused.
 await setProject(1,second.project);await setPool(99999);
 const poolRefusal=await refused(await view('198.51.100.12'),503,'This preview is temporarily unavailable.');
 assert.equal(await pool(),99999);
 assert.equal(projectRefusal,fairRefusal);assert.equal(fairRefusal,poolRefusal,'project, fair-share and platform refusals are indistinguishable');
 assert.equal(network,0);
 console.log(`B6 regression passed (${d1?'local D1 + local R2':'SQLite + in-memory R2'}): guest-preview photos charge the link's project budget, account fair share and per-client sub-limit all-or-none; exhausting them refuses only that project's guests (bounded 429/503, identical refusal text) while another tenant's public photo reads continue. Owner previews keep the platform-pool accounting.`);
}catch(error){console.error(String(error.stack||error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundled module>'));process.exitCode=1;}
finally{globalThis.fetch=originalFetch;await store.close();await rm(dir,{recursive:true,force:true});}
