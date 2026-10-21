// WH-004 slice 11 regression: a safety hold on the published specification withdraws its photos, through the sites
// Worker's real default export (src/site-host.ts). Local SQLite with an in-memory R2 stand-in (default) or local D1 +
// local R2 (`--d1`); synthetic accounts, synthetic photo clearance, JPEG envelopes built in Node (no Pillow), no network.
// Closes the gap recorded at docs/boundary-audit.json, family "site-assets", cell "stale" ("A held specification on the
// photo route is untested") and listed under "Still open (slice 2)" in docs/boundary-audit.md. Rationale: it is the
// highest-risk open cell not covered by slices 3-10. The page route's hold is evidenced (tests/specification-journey.mjs),
// but /s/:id/assets/:id.jpg and the custom-domain /assets/:id.jpg serve approved photo bytes from their own query, so a
// held site whose photos stay public would leak exactly the content a safety review withdrew.
// The project_spec_held view holds a version when its owner has a required generated_artifact decision on any of three
// digests; each gets its own published project:
//   1. spec_digest, 2. manifest_digest, 3. site_versions.digest (this one also reached through a custom domain).
// For every hold, GET and HEAD of the photo are 503 with no image bytes, and the refusal charges no per-client or
// project photo read and reads no object (the hold is checked before admission and storage).
// Negative controls, each differing only in the property under test: every photo is served (200, exact bytes) before its
// hold; an unrelated published project keeps serving after all holds; a required decision on the same digest recorded
// for another account does not hold; a not-required (unsampled) decision does not hold until it is escalated to required.
// Not covered: CMS media (/cms/media/...) and guest-preview inlining under a hold; remote D1. Standalone (R7): not in
// package.json or a verify profile.
import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers,createFixtureProject,changeFixtureWebsite} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';
Error.stackTraceLimit=0;
const d1=process.argv.includes('--d1');
// Only what the upload and public photo paths call on the private bucket; `reads` counts object reads by the host.
function memoryR2(){
 const objects=new Map(),meta=key=>{const o=objects.get(key);return o?{key,size:o.bytes.length,customMetadata:o.customMetadata,body:{cancel:async()=>{}},arrayBuffer:async()=>o.bytes.slice().buffer}:null;};
 return {put:async(key,value,options={})=>{if(options.onlyIf?.etagDoesNotMatch==='*'&&objects.has(key))return null;objects.set(key,{bytes:new Uint8Array(value),customMetadata:options.customMetadata??{}});return meta(key);},get:async key=>meta(key),head:async key=>meta(key)};
}
const m=await currentSiteFixtureHandlers(),store=d1?await databaseFixture({d1:true,r2:true}):await databaseFixture(),{db}=store,baseEnv=d1?store.env:{DB:db,FILES:memoryR2()};
let reads=0;const files={put:(...a)=>baseEnv.FILES.put(...a),head:(...a)=>baseEnv.FILES.head(...a),get:(...a)=>{reads++;return baseEnv.FILES.get(...a);},delete:(...a)=>baseEnv.FILES.delete(...a)};
const env={...baseEnv,FILES:files},id=()=>crypto.randomUUID(),scopes=new Map(),scope=u=>scopes.get(u);
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('No network is allowed');};

// A baseline JPEG envelope accepted by src/photo-format.ts (SOI, DQT, DHT, SOF0 8-bit greyscale, SOS, entropy, EOI);
// it is not a decodable image, which the upload path does not require. `seed` varies one entropy byte.
function jpeg(seed){
 const segment=(marker,body)=>[255,marker,(body.length+2)>>8,(body.length+2)&255,...body];
 return new Uint8Array([255,216,...segment(219,[0,...Array(64).fill(1)]),...segment(196,[0,1,...Array(15).fill(0),0]),
  ...segment(192,[8,0,24,0,32,1,1,17,0]),...segment(218,[1,1,0,0,63,0]),17,seed&127,0,255,217]);
}
async function account(){const a=await workspaceFixture(db,m);scopes.set(a.account,await a.scope());return a.account;}
async function chat(user,content){const turn=id(),state=await m.readChat(scope(user),user);const sent=await m.sendChat(scope(user),user,{id:turn,content,revision:state.state.revision});assert.equal(sent.status,200,content+' '+JSON.stringify(sent).slice(0,400));return turn;}
/** A project whose published version shows one approved photo; returns its ids and the served bytes' digests. */
async function photoSite(user,name,seed){
 const site=await createFixtureProject(scope(user),user,name,'A synthetic '+name+' website','clay'),photo=id();
 await m.uploadPhoto(new Request('https://whumpo.com/',{method:'PUT',headers:{'content-type':'image/jpeg','x-whumpo-photo-handoff':'null','x-photo-name':encodeURIComponent(name)},body:jpeg(seed)}),{...env,DB:scope(user)},user,site.project,photo);
 // Synthetic trusted result only: no real detection provider is configured.
 await db.prepare("UPDATE project_photo_safety SET state='approved',csam_check='clear',sexual_check='clear',scanner_reference='synthetic',expires_at=? WHERE file_id=?").bind(new Date(Date.now()+3600000).toISOString(),photo).run();
 const version=await changeFixtureWebsite(scope(user),user,site.project,[{type:'pages.setPhotos',pageId:'home',photos:[{id:photo,alt:name}]}]);
 await chat(user,'/confirm '+await chat(user,'/publish '+version));
 assert.equal((await db.prepare('SELECT version_id FROM publications WHERE project_id=?').bind(site.project).first())?.version_id,version,name+' is published');
 const digests=await db.prepare('SELECT v.spec_digest spec,v.manifest_digest manifest,s.digest site FROM project_spec_versions v JOIN site_versions s ON s.id=v.version_id WHERE v.version_id=?').bind(version).first();
 const bytes=new Uint8Array(await (await baseEnv.FILES.get((await db.prepare('SELECT object_key FROM project_files WHERE id=?').bind(photo).first()).object_key)).arrayBuffer());
 return {user,project:site.project,version,photo,digests,bytes};
}
const serve=(url,method='GET')=>m.host.fetch(new Request(url,{method,headers:{'cf-connecting-ip':'198.51.100.83'}}),env);
const photoURL=s=>`https://${s.project}.whumpo.site/assets/${s.photo}.jpg`;
const charged=async s=>({client:Number((await db.prepare("SELECT coalesce(sum(uses),0) n FROM public_client_usage WHERE scope='photo' AND project_id=?").bind(s.project).first()).n),project:Number((await db.prepare('SELECT coalesce(sum(read_ops),0) n FROM storage_project_usage WHERE project_id=?').bind(s.project).first()).n)});
async function served(s,label,url=photoURL(s)){
 for(const method of ['GET','HEAD']){
  const response=await serve(url,method);assert.equal(response.status,200,`${label} ${method}: ${response.status}`);assert.equal(response.headers.get('content-type'),'image/jpeg',label);
  if(method==='GET')assert.deepEqual(new Uint8Array(await response.arrayBuffer()),s.bytes,label+' serves the exact photo');else assert.equal(await response.text(),'',label);
 }
}
async function withheld(s,label,url=photoURL(s)){
 const before=await charged(s),readsBefore=reads;
 for(const method of ['GET','HEAD']){
  const response=await serve(url,method),body=new Uint8Array(await response.arrayBuffer());
  assert.equal(response.status,503,`${label} ${method}: ${response.status}`);assert.notEqual(response.headers.get('content-type'),'image/jpeg',label);
  // The catch-all refusal carries the generic outage text on HEAD too (the Workers runtime drops HEAD bodies).
  assert.equal(new TextDecoder().decode(body),'Site temporarily unavailable',label);
  assert.ok(!Buffer.from(body).includes(Buffer.from(s.bytes.subarray(0,32))),label+' leaks no photo bytes');
 }
 assert.deepEqual(await charged(s),before,label+' charges no photo read');assert.equal(reads,readsBefore,label+' reads no object');
}
const decision=(user,digest,required)=>db.prepare("INSERT INTO content_screening_decisions(user_id,kind,digest,policy_version,first_required,required,first_reason,first_percent,first_risk_score) VALUES(?,'generated_artifact',?,'synthetic-policy',?,?,?,100,60)").bind(user,digest,required,required,required?'risk_or_missing_history':'not_sampled').run();

let failed=false;
try{
 // Four live sites need a plan above the free one (personal: 5).
 const owner=await account(),other=await account();await paidPlan(db,owner,'personal');
 const bySpec=await photoSite(owner,'Spec garden',1),byManifest=await photoSite(owner,'Manifest orchard',2),bySite=await photoSite(owner,'Site meadow',3),control=await photoSite(owner,'Control field',4);
 const all=[bySpec,byManifest,bySite,control];
 // Holds must be scoped to one version: the digests under test are distinct across these projects.
 for(const kind of ['spec','manifest','site'])assert.equal(new Set(all.map(s=>s.digests[kind])).size,all.length,kind+' digests are distinct');
 for(const s of all)await served(s,'before any hold');
 // Custom domain for the site-digest project, rows as tests/photo-versions.mjs creates them (no provider call).
 const claim=await chat(owner,'/domain meadow.example.com '+bySite.project),connection=id(),expiry=new Date(Date.now()+600000).toISOString();
 await db.prepare("INSERT INTO domain_connections(id,user_id,claim_id,project_id,hostname,zone_id,target,proof_hash,state,created_at,expires_at) VALUES(?,?,?,?,'meadow.example.com',?,'hosting.whumpo.site','fixture','review',?,?)").bind(connection,owner,claim,bySite.project,id().replaceAll('-',''),new Date().toISOString(),expiry).run();
 await db.prepare("UPDATE domain_connections SET state='active',provider_id=?,serve_until=? WHERE id=?").bind(id(),expiry,connection).run();
 const customURL=`https://meadow.example.com/assets/${bySite.photo}.jpg`;
 await served(bySite,'custom domain before hold',customURL);

 // 1. spec_digest. Control first: the same required decision recorded for another account holds nothing.
 await decision(other,bySpec.digests.spec,1);await served(bySpec,'another account\'s decision on the spec digest');
 await decision(owner,bySpec.digests.spec,1);await withheld(bySpec,'spec-digest hold');
 // 2. manifest_digest. Control first: an unsampled, not-required decision holds nothing; escalating it does.
 await decision(owner,byManifest.digests.manifest,0);await served(byManifest,'not-required decision on the manifest digest');
 await db.prepare("UPDATE content_screening_decisions SET required=1,escalation_reason='risk_or_missing_history',escalated_at=? WHERE user_id=? AND digest=?").bind(new Date().toISOString(),owner,byManifest.digests.manifest).run();
 await withheld(byManifest,'manifest-digest hold after escalation');
 // 3. site_versions.digest, on the project host, the local alias and the custom domain.
 await decision(owner,bySite.digests.site,1);
 await withheld(bySite,'site-digest hold');await withheld(bySite,'site-digest hold on the custom domain',customURL);
 await withheld(bySite,'site-digest hold on the local alias',`http://localhost/s/${bySite.project}/assets/${bySite.photo}.jpg`);
 // The held page is withdrawn too (already evidenced elsewhere; asserted here so photo and page agree).
 for(const s of [bySpec,byManifest,bySite])assert.equal((await serve(`https://${s.project}.whumpo.site/`)).status,503,'held page');
 // The unrelated project is untouched by all three holds.
 await served(control,'unrelated project after all holds');
 console.log(`Photo-route safety hold passed (${d1?'local D1 + local R2':'SQLite + in-memory R2'}): spec, manifest and site-digest holds withdraw the photo on GET/HEAD (project host, local alias, custom domain) with no read charged or object read; controls served.`);
}catch(error){failed=true;console.error(error);}
finally{globalThis.fetch=originalFetch;await store.close?.();}
process.exit(failed?1:0);
