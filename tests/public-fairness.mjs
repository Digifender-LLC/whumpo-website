// WH-075 first slice: per-client sub-limits, account fair share, per-project photo budget and busy-not-charged.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {authenticator} from './app-authenticator.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
const m=await currentSiteFixtureHandlers(),store=await databaseFixture({d1:true}),db=store.db,scopes=new Map(),scope=user=>scopes.get(user);
const bundle=await build({stdin:{contents:"export * from './src/public-admission';export * from './src/storage-budget';export * from './src/runtime-lane';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const fair=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const {saveBackend,testBackend}=m.backend,{prepareBackendPublication:prepare,confirmBackendPublication:confirm}=m.backendPublication,{appData:data,appAuth:auth}=m,{prepareApplication,confirmApplication}=m.appActivation;
const id=()=>crypto.randomUUID(),now=()=>new Date().toISOString(),today=()=>new Date().toISOString().slice(0,10);
async function user(){const u=id(),authority=await workspaceFixture(db,m,u);scopes.set(u,await authority.scope());return u;}
async function project(owner){const p=id();await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Fairness fixture','','draft',?,?)").bind(p,owner,now(),now()).run();return {user:owner,project:p};}
let outcome=()=>Response.json({ok:true,value:1});const seen=[];
const service={fetch:async(url,init)=>{seen.push(init.headers['x-whumpo-lane']);const body=JSON.parse(init.body);if(body.input&&body.input.state)return Response.json({ok:true,value:{state:body.input.input,result:'saved'}});return outcome(body);}};
async function publish(a){const v=id(),r=id(),rid=id();await saveBackend(scope(a.user),a.user,a.project,v,'export default x=>x');await testBackend(scope(a.user),service,a.user,a.project,v,r,1);await prepare(scope(a.user),a.user,a.project,rid,'publish',v,r);await confirm(scope(a.user),a.user,rid);}
const call=(a,ip)=>m.host.fetch(new Request(`https://${a.project}.whumpo.site/backend`,{method:'POST',headers:{'content-type':'application/json',...(ip?{'cf-connecting-ip':ip}:{})},body:'{"a":1}'}),{DB:db,BACKEND_RUNTIME:service});
const used=async a=>(await db.prepare('SELECT calls FROM backend_public_usage WHERE project_id=?').bind(a.project).first())?.calls??0;
let ipCounter=0;const ip=()=>{ipCounter++;return `198.51.${(ipCounter>>8)&255}.${ipCounter&255}`;};
try{
 // Client source normalization: IPv6 groups by /64; the stored key never contains the address.
 const req=h=>new Request('https://x.invalid/',{headers:h===undefined?{}:{'cf-connecting-ip':h}});
 assert.equal(fair.publicClientSource(req('203.0.113.9')),'203.0.113.9');
 assert.equal(fair.publicClientSource(req('::ffff:203.0.113.9')),'203.0.113.9');
 assert.equal(fair.publicClientSource(req('2001:db8:1:2:aaaa::1')),fair.publicClientSource(req('2001:0db8:0001:0002:ffff:1:2:3')));
 assert.equal(fair.publicClientSource(req('2001:db8::1')),'2001:db8:0:0::/64');
 assert.notEqual(fair.publicClientSource(req('2001:db8:1:2::1')),fair.publicClientSource(req('2001:db8:1:3::1')));
 assert.equal(fair.publicClientSource(req()),'unknown');assert.equal(fair.publicClientSource(req('<script>')),'unknown');
 const p0=id();assert.match(await fair.publicClientKey(req('203.0.113.9'),'photo',p0),/^[0-9a-f]{64}$/);
 assert.notEqual(await fair.publicClientKey(req('203.0.113.9'),'photo',p0),await fair.publicClientKey(req('203.0.113.9'),'backend',p0),'Keys are scope-specific');
 assert.deepEqual({...fair.publicClientLimits},{backend:20,contact:10,photo:400});

 // F5 anonymous lockout: one source cannot spend the project allowance; other callers keep working.
 const a=await project(await user());await publish(a);
 const flood=[];for(let i=0;i<30;i++)flood.push(await call(a,'203.0.113.66'));
 assert.equal(flood.filter(r=>r.status===200).length,20);
 const refused=flood.filter(r=>r.status===429);assert.equal(refused.length,10);assert.deepEqual(await refused[0].json(),{ok:false,error:'client_allowance_exhausted'});
 assert.equal(await used(a),20,'Client refusals do not spend the project allowance');
 for(let i=0;i<5;i++)assert.equal((await call(a,ip())).status,200);assert.equal(await used(a),25);
 // Rows hold only hashed keys and are cleaned after the previous UTC day.
 assert.ok(!JSON.stringify((await db.prepare('SELECT * FROM public_client_usage').all()).results).includes('203.0.113'));
 await assert.rejects(db.prepare("INSERT INTO public_client_usage(scope,project_id,client_key,day,uses) VALUES('backend',?,?,'2000-01-01',1)").bind(a.project,'0'.repeat(64)).run(),/public_client_counter/);
 await assert.rejects(db.prepare('UPDATE public_client_usage SET uses=1').run(),/public_client_counter/);
 // Runtime lane is opaque and per project.
 assert.ok(seen.slice(-5).every(l=>/^[0-9a-f]{64}$/.test(l)));assert.equal(new Set(seen.slice(-5)).size,1);assert.equal(seen.at(-1),await fair.runtimeLane(a.project));
 const lanedFetch=await fair.projectRuntime({fetch:async(_u,init)=>Response.json(init.headers)},a.project);assert.deepEqual(await (await lanedFetch.fetch('https://runtime/execute',{headers:{'content-type':'application/json'}})).json(),{'content-type':'application/json','x-whumpo-lane':await fair.runtimeLane(a.project)});

 // F4 busy/unavailable runtime answers do not spend the allowance; guest failures still do.
 const before=await used(a);
 outcome=()=>Response.json({ok:false,error:'busy'},{status:503});
 for(let i=0;i<3;i++){const r=await call(a,ip());assert.equal(r.status,503);assert.deepEqual(await r.json(),{ok:false,error:'busy'});}
 outcome=()=>new Response('<html>down</html>',{status:500});assert.equal((await call(a,ip())).status,503);
 assert.equal(await used(a),before,'Busy and unavailable calls are refunded exactly');
 outcome=()=>Response.json({ok:false,error:'work_limit'},{status:422});assert.equal((await call(a,ip())).status,422);assert.equal(await used(a),before+1,'Guest failures executed and remain charged');
 outcome=()=>Response.json({ok:true,value:1});
 // A refund can never go below zero, change day, or move between publications.
 await assert.rejects(db.prepare('UPDATE backend_public_usage SET calls=calls-2 WHERE project_id=?').bind(a.project).run(),/backend_public_counter/);
 await assert.rejects(db.prepare("UPDATE backend_public_usage SET calls=calls-1,day='2000-01-01' WHERE project_id=?").bind(a.project).run(),/backend_public_counter/);

 // F4/F1 visitor transitions: busy is refunded once; fair share applies past half the platform pool.
 async function app(owner){const a=await project(owner),version=id(),test=id(),review=id();await saveBackend(scope(owner),owner,a.project,version,'export default ({state,input})=>({state:input,result:"saved"})');await testBackend(scope(owner),service,owner,a.project,version,test,{state:{},input:{}});await prepareApplication(scope(owner),owner,a.project,review,'enable',version,test);await confirmApplication(scope(owner),owner,review);return a;}
 async function visitor(a){const invite=await auth.createAppInvitation(scope(a.user),a.user,a.project),opt=await auth.appPasskeyOptions(db,a.project,'signup',false,invite.code),key=authenticator(),result=await auth.appPasskeyVerify(db,a.project,'signup',opt.challengeToken,key.registration(opt.options),false);return {session:result.session,revision:0};}
 const attempts=async a=>(await db.prepare('SELECT attempts FROM app_daily_usage WHERE project_id=? AND day=?').bind(a.project,today()).first())?.attempts??0;
 const heavyOwner=await user(),heavy=await app(heavyOwner),hv=await visitor(heavy);
 const busy={fetch:async()=>Response.json({ok:false,error:'busy'},{status:503})};
 const busyRun=await data.transitionAppData(db,busy,hv.session,heavy.project,id(),0,{note:'x'});assert.equal(busyRun.state,'failed');assert.deepEqual(busyRun.result,{ok:false,error:'busy'});
 assert.equal(await attempts(heavy),0,'Busy visitor transition is not charged');
 const failing={fetch:async()=>Response.json({ok:false,error:'execution_failed'},{status:422})};
 await data.transitionAppData(db,failing,hv.session,heavy.project,id(),0,{note:'x'});assert.equal(await attempts(heavy),1,'Guest failure is charged');
 // Seed platform use to the reserve threshold: 499 more attempts on another of the heavy account's apps.
 const heavyArchive=await app(heavyOwner);await db.prepare('INSERT INTO app_daily_usage(project_id,day,attempts) VALUES(?,?,499)').bind(heavyArchive.project,today()).run();
 await assert.rejects(data.transitionAppData(db,service,hv.session,heavy.project,id(),0,{note:'over share'}),e=>e.status===409,'Account over its fair share waits');
 const lightOwner=await user(),light=await app(lightOwner),lv=await visitor(light);
 assert.equal((await data.transitionAppData(db,service,lv.session,light.project,id(),0,{note:'fair share'})).state,'complete','Account under its share is admitted from the reserve');
 await db.prepare('UPDATE app_daily_usage SET attempts=100 WHERE project_id=?').bind(heavyArchive.project).run();
 assert.equal((await data.transitionAppData(db,service,hv.session,heavy.project,id(),0,{note:'below threshold'})).state,'complete','Below half the pool, first-come admission resumes');

 // F3 photo reads: per-client daily, per-project monthly, account fair share; platform ceiling kept.
 const photoOwner=await user(),ph=await project(photoOwner),other=await project(await user());
 const read=(p,from)=>fair.reservePublicPhotoRead(db,req(from),p.project);
 for(let i=0;i<400;i++)await read(ph,'203.0.113.77');
 await assert.rejects(read(ph,'203.0.113.77'),e=>e instanceof fair.PublicClientLimitError&&e.status===429);
 await read(ph,'203.0.113.78');await read(other,'203.0.113.77');
 const projectReads=async p=>(await db.prepare('SELECT read_ops FROM storage_project_usage WHERE project_id=?').bind(p.project).first()).read_ops;
 assert.equal(await projectReads(ph),401);assert.equal(await projectReads(other),1);
 const period=new Date().toISOString().slice(0,7),platform=async()=>(await db.prepare('SELECT read_ops FROM storage_usage WHERE period=?').bind(period).first()).read_ops;
 const startPlatform=await platform();
 // Seed counters (the update trigger allows only +1): drop and restore it around the fixture write.
 const trigger=(await db.prepare("SELECT sql FROM sqlite_master WHERE name='storage_project_usage_update'").first()).sql;
 const seed=async(p,n)=>{await db.prepare('DROP TRIGGER storage_project_usage_update').run();await db.prepare('UPDATE storage_project_usage SET read_ops=? WHERE project_id=?').bind(n,p.project).run();await db.prepare(trigger).run();};
 await seed(ph,10000);
 await assert.rejects(read(ph,'203.0.113.79'),e=>e instanceof fair.StorageLimitError&&/This site/.test(e.message));
 await read(other,'203.0.113.79');assert.equal(await platform(),startPlatform+1,'Refused project read charged nothing platform-wide');
 // Fair share past half the platform ceiling: the 10,000-read account waits, others continue.
 const second=await project(photoOwner);await read(second,'203.0.113.80');
 await db.prepare('UPDATE storage_usage SET read_ops=50000 WHERE period=?').bind(period).run();
 await assert.rejects(read(second,'203.0.113.80'),e=>e instanceof fair.StorageLimitError);
 await read(other,'203.0.113.80');
 // The platform ceiling itself is unchanged.
 await db.prepare('UPDATE storage_usage SET read_ops=100000 WHERE period=?').bind(period).run();
 await assert.rejects(read(other,'203.0.113.81'),e=>e instanceof fair.StorageLimitError&&/test platform/.test(e.message));
 assert.equal(await projectReads(other),3,'A refused platform read rolls back the project counter');
 // Retention: client keys older than yesterday and project counters before last month are removed.
 await db.prepare('DROP TRIGGER public_client_usage_insert').run();await db.prepare("INSERT INTO public_client_usage(scope,project_id,client_key,day,uses) VALUES('photo',?,?,'2000-01-01',1)").bind(ph.project,'1'.repeat(64)).run();
 await db.prepare('DROP TRIGGER storage_project_usage_insert').run();await db.prepare("INSERT INTO storage_project_usage(project_id,period,read_ops) VALUES(?,'2000-01',1)").bind(ph.project).run();
 await fair.cleanupPublicClients(db);
 assert.equal((await db.prepare("SELECT count(*) n FROM public_client_usage WHERE day='2000-01-01'").first()).n,0);
 assert.equal((await db.prepare("SELECT count(*) n FROM storage_project_usage WHERE period='2000-01'").first()).n,0);
 assert.ok((await db.prepare('SELECT count(*) n FROM public_client_usage').first()).n>0);
 console.log('Public fairness checks passed: per-client sub-limits (backend/contact/photo) with hashed keys, busy/unavailable refunds, account fair share past half of each platform pool, per-project photo budget, unchanged platform ceilings, opaque runtime lanes and retention.');
}finally{await store.close();}
