// WH-004 slice 14 regression: the photo route on a connected custom domain, as the sites Worker's real default export
// (src/site-host.ts) answers it. Closes the "custom-domain /assets/<id>.jpg path" item that the slice 13 note left open
// for docs/boundary-audit.json family "site-assets", cell "admission". Local SQLite with an in-memory R2 stand-in
// (default) or local D1 + local R2 (`--d1`); synthetic accounts, real domain-hosting handlers, Cloudflare and DNS calls
// go to a recording stub, global fetch throws.
// Asserted through GET and HEAD on https://<custom host>/assets/<photo>.jpg:
//   1. Serving: the connected hostname serves the exact approved photo and charges one client, project and platform read.
//   2. Path allowlist: on a custom host only "/" and "/assets/<uuid>.jpg" are mapped. The project-prefixed path, a
//      trailing slash, another extension, a nested path, and a photo id not on the publication get 404 with no bytes,
//      object read or charge. A non-GET/HEAD method is 405.
//   3. Admission: the 401st read from one client is 429, a project at 10,000 reads and a platform at 100,000 reads are
//      503, each with no bytes, no object read and no project or platform charge, as on the project host.
// Negative controls, each differing only in the property under test: another client, another connected project, and
// the same read once the platform counter is restored.
// Standalone (R7): in package.json, not in a verify profile.
import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers,createFixtureProject,changeFixtureWebsite} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';
Error.stackTraceLimit=0;
const d1=process.argv.includes('--d1');
function memoryR2(){
 const objects=new Map(),meta=key=>{const o=objects.get(key);return o?{key,size:o.bytes.length,customMetadata:o.customMetadata,body:{cancel:async()=>{}},arrayBuffer:async()=>o.bytes.slice().buffer}:null;};
 return {put:async(key,value,options={})=>{if(options.onlyIf?.etagDoesNotMatch==='*'&&objects.has(key))return null;objects.set(key,{bytes:new Uint8Array(value),customMetadata:options.customMetadata??{}});return meta(key);},get:async key=>meta(key),head:async key=>meta(key)};
}
const m=await currentSiteFixtureHandlers(),store=d1?await databaseFixture({d1:true,r2:true}):await databaseFixture(),{db}=store,baseEnv=d1?store.env:{DB:db,FILES:memoryR2()};
let reads=0;const files={put:(...a)=>baseEnv.FILES.put(...a),head:(...a)=>baseEnv.FILES.head(...a),get:(...a)=>{reads++;return baseEnv.FILES.get(...a);},delete:(...a)=>baseEnv.FILES.delete(...a)};
const env={...baseEnv,FILES:files},id=()=>crypto.randomUUID(),scopes=new Map(),scope=u=>scopes.get(u);
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('No network is allowed');};

// Provider and DNS stub: one custom hostname per provider id; TXT answers the claim's current proof, CNAME the target.
const fixtureValue=['fixture','value'].join('-'),fixtureZone=id().replaceAll('-','');
const config={token:fixtureValue,zone:fixtureZone,target:'hosting.whumpo.site'};
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

function jpeg(seed){
 const segment=(marker,body)=>[255,marker,(body.length+2)>>8,(body.length+2)&255,...body];
 return new Uint8Array([255,216,...segment(219,[0,...Array(64).fill(1)]),...segment(196,[0,1,...Array(15).fill(0),0]),
  ...segment(192,[8,0,24,0,32,1,1,17,0]),...segment(218,[1,1,0,0,63,0]),17,seed&127,0,255,217]);
}
async function account(){const a=await workspaceFixture(db,m);scopes.set(a.account,await a.scope());return a.account;}
async function chat(user,content){const turn=id(),state=await m.readChat(scope(user),user);const sent=await m.sendChat(scope(user),user,{id:turn,content,revision:state.state.revision});assert.equal(sent.status,200,content+' '+JSON.stringify(sent).slice(0,400));return turn;}
/** A published project with one approved photo, connected to hostname through the real hosting handlers. */
async function customSite(user,name,seed,hostname){
 const site=await createFixtureProject(scope(user),user,name,'A synthetic '+name+' website','clay'),photo=id();
 await m.uploadPhoto(new Request('https://whumpo.com/',{method:'PUT',headers:{'content-type':'image/jpeg','x-whumpo-photo-handoff':'null','x-photo-name':encodeURIComponent(name)},body:jpeg(seed)}),{...env,DB:scope(user)},user,site.project,photo);
 await db.prepare("UPDATE project_photo_safety SET state='approved',csam_check='clear',sexual_check='clear',scanner_reference='synthetic',expires_at=? WHERE file_id=?").bind(new Date(Date.now()+3600000).toISOString(),photo).run();
 const version=await changeFixtureWebsite(scope(user),user,site.project,[{type:'pages.setPhotos',pageId:'home',photos:[{id:photo,alt:name}]}]);
 await chat(user,'/confirm '+await chat(user,'/publish '+version));
 const bytes=new Uint8Array(await (await baseEnv.FILES.get((await db.prepare('SELECT object_key FROM project_files WHERE id=?').bind(photo).first()).object_key)).arrayBuffer());
 const claimId=await chat(user,`/domain ${hostname} ${site.project}`);
 proofs.set(hostname,(await db.prepare('SELECT token AS proof FROM domain_claims WHERE id=?').bind(claimId).first()).proof);
 const review=await m.reviewHosting(scope(user),user,id(),claimId,config);
 assert.equal((await m.confirmHosting(scope(user),user,review.id,config,transport)).state,'provisioning');
 assert.equal((await m.refreshHosting(scope(user),user,review.id,config,transport)).connected,true,hostname+' is connected');
 return {project:site.project,photo,bytes,hostname};
}
const serve=(url,ip,method='GET')=>m.host.fetch(new Request(url,{method,headers:{'cf-connecting-ip':ip}}),env);
const photoURL=s=>`https://${s.hostname}/assets/${s.photo}.jpg`;
const count=async(sql,...args)=>Number((await db.prepare(sql).bind(...args).first())?.n??0);
const counters=async s=>({client:await count("SELECT coalesce(sum(uses),0) n FROM public_client_usage WHERE scope='photo' AND project_id=?",s.project),
 project:await count('SELECT coalesce(sum(read_ops),0) n FROM storage_project_usage WHERE project_id=?',s.project),
 platform:await count("SELECT coalesce(sum(read_ops),0) n FROM storage_usage WHERE period=strftime('%Y-%m','now')")});
async function served(s,ip,label){
 for(const method of ['GET','HEAD']){
  const response=await serve(photoURL(s),ip,method);assert.equal(response.status,200,`${label} ${method}: ${response.status}`);assert.equal(response.headers.get('content-type'),'image/jpeg',label);
  if(method==='GET')assert.deepEqual(new Uint8Array(await response.arrayBuffer()),s.bytes,label+' serves the exact photo');else assert.equal(await response.text(),'',label);
 }
}
/** Every listed method refused with status (and text, when given); no bytes, no object read; the listed counters are unchanged. */
async function refused(s,url,ip,label,status,text,{unchanged=['client','project','platform'],methods=['GET','HEAD']}={}){
 const before=await counters(s),readsBefore=reads;
 for(const method of methods){
  const response=await serve(url,ip,method),body=new Uint8Array(await response.arrayBuffer());
  assert.equal(response.status,status,`${label} ${method}: ${response.status}`);assert.notEqual(response.headers.get('content-type'),'image/jpeg',label);
  assert.equal(response.headers.get('cache-control'),'no-store',label+' is not cacheable');
  if(method!=='HEAD'&&text!==undefined)assert.equal(new TextDecoder().decode(body),text,label);
  assert.ok(!Buffer.from(body).includes(Buffer.from(s.bytes.subarray(0,32))),label+' leaks no photo bytes');
 }
 assert.equal(reads,readsBefore,label+' reads no object');
 const after=await counters(s);for(const k of unchanged)assert.equal(after[k],before[k],`${label} charges no ${k} read`);
 return {before,after};
}
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
 const limited=await customSite(owner,'Domain orchard',1,'orchard-'+id().slice(0,8)+'.example.com'),sibling=await customSite(siblingOwner,'Domain meadow',2,'meadow-'+id().slice(0,8)+'.example.com');
 const flood='198.51.100.51',other='198.51.100.52',fresh='198.51.100.53',late='198.51.100.54',probe='198.51.100.55';

 // 1. Serving on the connected hostname charges one client, project and platform read per request.
 const start=await counters(limited);
 await served(limited,probe,'custom host photo');
 const first=await counters(limited);
 assert.deepEqual([first.client-start.client,first.project-start.project,first.platform-start.platform],[2,2,2],'each custom-host read (GET and HEAD) is charged');

 // 2. Path allowlist: only "/" and "/assets/<uuid>.jpg" are mapped on a custom host.
 const base='https://'+limited.hostname;
 for(const [label,path] of [['project-prefixed path',`/s/${limited.project}/assets/${limited.photo}.jpg`],['trailing slash',`/assets/${limited.photo}.jpg/`],['another extension',`/assets/${limited.photo}.png`],
  ['nested path',`/x/assets/${limited.photo}.jpg`],['photo id not on the publication',`/assets/${id()}.jpg`],['another project photo',`/assets/${sibling.photo}.jpg`]])
  await refused(limited,base+path,probe,label,404,undefined);
 await refused(limited,photoURL(limited),probe,'POST on the photo path',405,'Method not allowed',{methods:['POST']});

 // 3. Admission on the custom host: 400 reads per client per day, then 429.
 const spent=(await counters(limited)).client;
 for(let i=0;i<(400-spent+2)/2;i++)await served(limited,flood,'client read '+(2*i+1));
 await refused(limited,photoURL(limited),flood,'client allowance on the custom host',429,clientText);
 await served(limited,other,'another client, same custom host');
 await served(sibling,flood,'same client, another connected project');

 // 4. Project budget at 10,000 reads.
 await seedProjectReads(limited,10000);
 const budget=await refused(limited,photoURL(limited),fresh,'project budget on the custom host',503,budgetText,{unchanged:['project','platform']});
 assert.equal(budget.after.client,budget.before.client+2,'the refused attempts count against the client sub-limit only');
 await served(sibling,fresh,"another account's connected project under its own budget");

 // 5. Platform ceiling at 100,000 reads, for a project well under its own budget.
 const platform=(await counters(sibling)).platform;
 await setPlatformReads(100000);
 await refused(sibling,photoURL(sibling),late,'platform ceiling on the custom host',503,budgetText,{unchanged:['project','platform']});
 await setPlatformReads(platform);
 await served(sibling,late,'same read once the platform counter is below the ceiling');
 console.log(`Custom-domain photo route passed (${d1?'local D1 + local R2':'SQLite + in-memory R2'}): served and charged on the connected hostname, non-allowlisted paths 404/405 uncharged, client allowance 429, project budget and platform ceiling 503 on GET/HEAD with no bytes, object read or project/platform charge; controls served.`);
}catch(error){failed=true;console.error(error);}
finally{globalThis.fetch=originalFetch;await store.close?.();}
process.exit(failed?1:0);
