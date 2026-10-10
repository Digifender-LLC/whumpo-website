// WH-004 finding B6 reproduction (local D1 + local R2, one synthetic JPEG, synthetic photo clearance; no network).
// Anonymous guest-preview views inline the version's photos through reserveStorage(), which charges only the
// platform-wide monthly read pool (100,000). Public site photos (WH-075) charge a per-project budget with an account
// fair share first, so "one project or client exhausting its budget no longer refuses every tenant's photos". Guest
// views bypass that: they add nothing to the owner's project budget, so the fair-share trigger never stops them.
// At 60 views per 10 minutes per link and 20 active links per project, one owner can drain the pool in hours.
// Step 2 pre-seeds the monthly counter to 99,999 to stand in for those prior views (the per-view charge is measured
// in step 1). Exits 1 while the defect reproduces. Deliberately not in package.json scripts or any verify profile.
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import {currentSiteFixtureHandlers,createFixtureProject,changeFixtureWebsite} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';
Error.stackTraceLimit=0;
const m=await currentSiteFixtureHandlers(),store=await databaseFixture({d1:true,r2:true}),{db,env}=store;
const bundle=await build({stdin:{contents:"export * from './src/storage-budget';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const budget=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const dir=await mkdtemp('/tmp/whumpo-guest-pool-');
const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('No network is allowed');};
const reproduced=[];
try{
 execFileSync('python3',['-c',"from PIL import Image; import sys; Image.new('RGB',(32,24),(60,110,80)).save(sys.argv[1])",dir+'/photo.jpg']);
 const jpeg=new Uint8Array(await readFile(dir+'/photo.jpg'));
 const actor=await workspaceFixture(db,m),scope=await actor.scope(),user=actor.account;await paidPlan(db,user,'personal');
 const site=await createFixtureProject(scope,user,'Photo garden','A neighborhood website','clay'),photo=crypto.randomUUID();
 await m.uploadPhoto(new Request('https://whumpo.com/',{method:'PUT',headers:{'content-type':'image/jpeg','x-whumpo-photo-handoff':'null','x-photo-name':'Garden'},body:jpeg}),{...env,DB:scope},user,site.project,photo);
 await db.prepare("UPDATE project_photo_safety SET state='approved',csam_check='clear',sexual_check='clear',scanner_reference='synthetic',expires_at=? WHERE file_id=?").bind(new Date(Date.now()+3600000).toISOString(),photo).run();
 const version=await changeFixtureWebsite(scope,user,site.project,[{type:'pages.setPhotos',pageId:'home',photos:[{id:photo,alt:'Garden'}]}]);
 const api=(path,method='GET',data)=>m.worker.fetch(new Request('https://whumpo.com/api'+path,{method,headers:{origin:'https://whumpo.com',cookie:'__Host-whumpo_session='+actor.token,...(data?{'content-type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})}),{...env,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})}},{waitUntil:()=>{}});
 const request={id:crypto.randomUUID(),versionId:version,expiresInHours:2,feedback:false},prepared=await (await api(`/projects/${site.project}/guest-previews/prepare`,'POST',request)).json();
 const issued=await (await api(`/projects/${site.project}/guest-previews`,'POST',{...request,confirmation:prepared.confirmation})).json();
 assert.match(issued.token,/^[A-Za-z0-9_-]{43}$/);
 const view=()=>m.host.fetch(new Request('https://preview.whumpo.site/view',{method:'POST',headers:{origin:'https://preview.whumpo.site','content-type':'application/x-www-form-urlencoded','cf-connecting-ip':'198.51.100.7'},body:'token='+issued.token}),env);
 const n=async(sql,...p)=>(await db.prepare(sql).bind(...p).first())?.n??0;
 const period=new Date().toISOString().slice(0,7);
 const pool=()=>n('SELECT read_ops n FROM storage_usage WHERE period=?',period);
 const projectBudget=()=>n('SELECT read_ops n FROM storage_project_usage WHERE project_id=? AND period=?',site.project,period);
 const clients=()=>n('SELECT count(*) n FROM public_client_usage');

 // Step 1: what one anonymous guest view charges.
 const [poolBefore,projectBefore,clientsBefore]=[await pool(),await projectBudget(),await clients()];
 const first=await view();assert.equal(first.status,200);assert.ok((await first.text()).includes('src="data:image/jpeg;base64,'));
 const charged=await pool()-poolBefore;
 assert.equal(charged,1,'one inlined photo is one platform read');
 if(await projectBudget()===projectBefore&&await clients()===clientsBefore)reproduced.push('a guest view charges the platform-wide read pool but not the owner\'s per-project photo budget or any per-client allowance, so the WH-075 fair-share trigger never limits it');

 // Step 2: when guest views have used the pool, another tenant's public photo is refused.
 const other=await workspaceFixture(db,m),otherScope=await other.scope();
 const bystander=await createFixtureProject(otherScope,other.account,'Bystander','Another tenant','ocean');
 await db.prepare('UPDATE storage_usage SET read_ops=99999 WHERE period=?').bind(period).run();
 assert.equal((await view()).status,200,'the guest view takes the last read in the pool');
 assert.equal(await projectBudget(),projectBefore,'still nothing charged to the guest-preview owner\'s project budget');
 const visitor=new Request('https://'+bystander.project+'.whumpo.site/assets/'+crypto.randomUUID()+'.jpg',{headers:{'cf-connecting-ip':'203.0.113.9'}});
 try{await budget.reservePublicPhotoRead(db,visitor,bystander.project);}
 catch(error){if(error instanceof budget.StorageLimitError)reproduced.push(`another tenant's first public photo read this month is refused (${error.message}); the site host turns this into 503 "Photo allowance temporarily exhausted"`);else throw error;}
 assert.equal((await view()).status,503,'further guest views are refused only once every tenant is already affected');
 assert.equal(network,0);
}catch(error){console.error(String(error.stack||error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundled module>'));process.exitCode=2;}
finally{globalThis.fetch=originalFetch;await store.close();await rm(dir,{recursive:true,force:true});}
if(process.exitCode===2)process.exit(2);
if(reproduced.length){console.error('B6 reproduced:\n- '+reproduced.join('\n- '));process.exit(1);}
console.log('Guest-preview views are charged to their project and cannot exhaust other tenants\' photo reads.');
