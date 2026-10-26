// WH-004 slice 13 regression: the photo route's admission refusals as the sites Worker answers them (src/site-host.ts
// default export), not only as reservePublicPhotoRead throws them. Local SQLite with an in-memory R2 stand-in (default)
// or local D1 + local R2 (`--d1`); synthetic accounts, synthetic photo clearance, JPEG envelopes built in Node (no
// Pillow), no network. Closes the gap recorded at docs/boundary-audit.json, family "site-assets", cell "admission"
// ("The host-level 429 mapping is untested (function-level only)"); tests/public-fairness.mjs covers the limits as
// thrown errors only.
// Asserted through GET and HEAD on the project host and the local alias:
//   1. Per-client daily allowance: one client's 400 photo reads of a project are served; the next is 429 with the fixed
//      host text, no image bytes, no object read, and no client, project or platform read charged.
//   2. Per-project monthly budget: at 10,000 project reads a fresh client gets 503 "Photo allowance temporarily
//      exhausted", no bytes, no object read, no project or platform read charged (the client attempt is counted, which
//      is the documented order: client sub-limit first, then the project batch).
//   3. Platform ceiling: at 100,000 platform reads another project's photo is the same 503 with nothing charged.
// Negative controls, each differing only in the property under test: the same client keeps reading another project's
// photo; another client keeps reading the limited project; the budget-limited project's sibling keeps serving; the same
// read is served again once the platform counter is restored below the ceiling.
// Not covered: IPv6 /64 grouping and the shared "unknown" bucket at host level (function-level in
// tests/public-fairness.mjs), the custom-domain /assets/<id>.jpg path, operator photo containment allowances, guest
// preview inlining, remote D1. Standalone (R7): in package.json, not in a verify profile.
import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers,createFixtureProject,changeFixtureWebsite} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';
Error.stackTraceLimit=0;
const d1=process.argv.includes('--d1');
// Only what the upload and public photo paths call on the private bucket.
function memoryR2(){
 const objects=new Map(),meta=key=>{const o=objects.get(key);return o?{key,size:o.bytes.length,customMetadata:o.customMetadata,body:{cancel:async()=>{}},arrayBuffer:async()=>o.bytes.slice().buffer}:null;};
 return {put:async(key,value,options={})=>{if(options.onlyIf?.etagDoesNotMatch==='*'&&objects.has(key))return null;objects.set(key,{bytes:new Uint8Array(value),customMetadata:options.customMetadata??{}});return meta(key);},get:async key=>meta(key),head:async key=>meta(key)};
}
const m=await currentSiteFixtureHandlers(),store=d1?await databaseFixture({d1:true,r2:true}):await databaseFixture(),{db}=store,baseEnv=d1?store.env:{DB:db,FILES:memoryR2()};
let reads=0;const files={put:(...a)=>baseEnv.FILES.put(...a),head:(...a)=>baseEnv.FILES.head(...a),get:(...a)=>{reads++;return baseEnv.FILES.get(...a);},delete:(...a)=>baseEnv.FILES.delete(...a)};
const env={...baseEnv,FILES:files},id=()=>crypto.randomUUID(),scopes=new Map(),scope=u=>scopes.get(u);
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('No network is allowed');};

// A baseline JPEG envelope accepted by src/photo-format.ts; `seed` varies one entropy byte.
function jpeg(seed){
 const segment=(marker,body)=>[255,marker,(body.length+2)>>8,(body.length+2)&255,...body];
 return new Uint8Array([255,216,...segment(219,[0,...Array(64).fill(1)]),...segment(196,[0,1,...Array(15).fill(0),0]),
  ...segment(192,[8,0,24,0,32,1,1,17,0]),...segment(218,[1,1,0,0,63,0]),17,seed&127,0,255,217]);
}
async function account(){const a=await workspaceFixture(db,m);scopes.set(a.account,await a.scope());return a.account;}
async function chat(user,content){const turn=id(),state=await m.readChat(scope(user),user);const sent=await m.sendChat(scope(user),user,{id:turn,content,revision:state.state.revision});assert.equal(sent.status,200,content+' '+JSON.stringify(sent).slice(0,400));return turn;}
/** A project whose published version shows one approved photo; returns its ids and the stored bytes. */
async function photoSite(user,name,seed){
 const site=await createFixtureProject(scope(user),user,name,'A synthetic '+name+' website','clay'),photo=id();
 await m.uploadPhoto(new Request('https://whumpo.com/',{method:'PUT',headers:{'content-type':'image/jpeg','x-whumpo-photo-handoff':'null','x-photo-name':encodeURIComponent(name)},body:jpeg(seed)}),{...env,DB:scope(user)},user,site.project,photo);
 // Synthetic trusted result only: no real detection provider is configured.
 await db.prepare("UPDATE project_photo_safety SET state='approved',csam_check='clear',sexual_check='clear',scanner_reference='synthetic',expires_at=? WHERE file_id=?").bind(new Date(Date.now()+3600000).toISOString(),photo).run();
 const version=await changeFixtureWebsite(scope(user),user,site.project,[{type:'pages.setPhotos',pageId:'home',photos:[{id:photo,alt:name}]}]);
 await chat(user,'/confirm '+await chat(user,'/publish '+version));
 const bytes=new Uint8Array(await (await baseEnv.FILES.get((await db.prepare('SELECT object_key FROM project_files WHERE id=?').bind(photo).first()).object_key)).arrayBuffer());
 return {project:site.project,photo,bytes};
}
const serve=(url,ip,method='GET')=>m.host.fetch(new Request(url,{method,headers:{'cf-connecting-ip':ip}}),env);
const hostURL=s=>`https://${s.project}.whumpo.site/assets/${s.photo}.jpg`,aliasURL=s=>`http://localhost/s/${s.project}/assets/${s.photo}.jpg`;
const count=async(sql,...args)=>Number((await db.prepare(sql).bind(...args).first())?.n??0);
const counters=async s=>({client:await count("SELECT coalesce(sum(uses),0) n FROM public_client_usage WHERE scope='photo' AND project_id=?",s.project),
 project:await count('SELECT coalesce(sum(read_ops),0) n FROM storage_project_usage WHERE project_id=?',s.project),
 platform:await count("SELECT coalesce(sum(read_ops),0) n FROM storage_usage WHERE period=strftime('%Y-%m','now')")});
async function served(s,ip,label,url=hostURL(s)){
 for(const method of ['GET','HEAD']){
  const response=await serve(url,ip,method);assert.equal(response.status,200,`${label} ${method}: ${response.status}`);assert.equal(response.headers.get('content-type'),'image/jpeg',label);
  if(method==='GET')assert.deepEqual(new Uint8Array(await response.arrayBuffer()),s.bytes,label+' serves the exact photo');else assert.equal(await response.text(),'',label);
 }
}
/** Both methods refused with `status` and `text`; no bytes, no object read; the listed counters are unchanged. */
async function refused(s,ip,label,status,text,{url=hostURL(s),unchanged=['client','project','platform']}={}){
 const before=await counters(s),readsBefore=reads;
 for(const method of ['GET','HEAD']){
  const response=await serve(url,ip,method),body=new Uint8Array(await response.arrayBuffer());
  assert.equal(response.status,status,`${label} ${method}: ${response.status}`);assert.notEqual(response.headers.get('content-type'),'image/jpeg',label);
  assert.equal(response.headers.get('cache-control'),'no-store',label+' is not cacheable');
  assert.equal(new TextDecoder().decode(body),text,label);
  assert.ok(!Buffer.from(body).includes(Buffer.from(s.bytes.subarray(0,32))),label+' leaks no photo bytes');
 }
 assert.equal(reads,readsBefore,label+' reads no object');
 const after=await counters(s);for(const k of unchanged)assert.equal(after[k],before[k],`${label} charges no ${k} read`);
 return {before,after};
}
// The project counter's update trigger allows only +1: drop and restore it around a fixture seed.
async function seedProjectReads(s,n){
 const trigger=(await db.prepare("SELECT sql FROM sqlite_master WHERE name='storage_project_usage_update'").first()).sql;
 await db.prepare('DROP TRIGGER storage_project_usage_update').run();
 try{await db.prepare("UPDATE storage_project_usage SET read_ops=? WHERE project_id=? AND period=strftime('%Y-%m','now')").bind(n,s.project).run();}
 finally{await db.prepare(trigger).run();}
}
const setPlatformReads=n=>db.prepare("UPDATE storage_usage SET read_ops=? WHERE period=strftime('%Y-%m','now')").bind(n).run();
const clientText='Too many photo requests from this connection today',budgetText='Photo allowance temporarily exhausted';

let failed=false;
try{
 const owner=await account(),siblingOwner=await account();await paidPlan(db,owner,'personal');
 const limited=await photoSite(owner,'Client orchard',1),sibling=await photoSite(siblingOwner,'Sibling meadow',2);
 const flood='198.51.100.41',other='198.51.100.42',fresh='198.51.100.43',late='198.51.100.44';

 // 1. Per-client daily allowance. Two reads per served() call (GET and HEAD); 400 in total across both hosts.
 for(let i=0;i<199;i++)await served(limited,flood,'client read '+(2*i+1));
 await served(limited,flood,'client reads 399-400 on the local alias',aliasURL(limited));
 assert.equal((await counters(limited)).client,400,'400 client reads charged');
 await refused(limited,flood,'client allowance on the project host',429,clientText);
 await refused(limited,flood,'client allowance on the local alias',429,clientText,{url:aliasURL(limited)});
 await served(sibling,flood,'same client, another project');
 await served(limited,other,'another client, same project');

 // 2. Per-project monthly budget at 10,000 reads. The client sub-limit runs first, so each attempt counts for the client.
 await seedProjectReads(limited,10000);
 const budget=await refused(limited,fresh,'project budget',503,budgetText,{unchanged:['project','platform']});
 assert.equal(budget.after.client,budget.before.client+2,'the refused attempts count against the client sub-limit only');
 await refused(limited,fresh,'project budget on the local alias',503,budgetText,{url:aliasURL(limited),unchanged:['project','platform']});
 await served(sibling,fresh,'another account\'s project under its own budget');

 // 3. Platform ceiling at 100,000 reads, for a project well under its own budget.
 const platform=(await counters(sibling)).platform;
 await setPlatformReads(100000);
 await refused(sibling,late,'platform ceiling',503,budgetText,{unchanged:['project','platform']});
 await setPlatformReads(platform);
 await served(sibling,late,'same read once the platform counter is below the ceiling');
 console.log(`Photo-route admission passed (${d1?'local D1 + local R2':'SQLite + in-memory R2'}): client allowance 429, project budget and platform ceiling 503 on GET/HEAD (project host, local alias) with no bytes, object read or project/platform charge; controls served.`);
}catch(error){failed=true;console.error(error);}
finally{globalThis.fetch=originalFetch;await store.close?.();}
process.exit(failed?1:0);
