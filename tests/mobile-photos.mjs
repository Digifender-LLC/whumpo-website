import assert from 'node:assert/strict';
import {timingSafeEqual} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {authenticator} from './helpers/webauthn-authenticator.mjs';
import {createFixtureWebsite,proposeFixtureWebsite} from './current-site-fixture.mjs';

// WH-085 server: photo list, upload, status and bytes of /api/mobile/v1 through the REAL Worker, over the shared mobile-v1 fixtures, on
// disposable SQLite with an in-memory R2 and, with --d1, local D1 + local R2. Each operation runs the web files.ts path; this proves the
// mapping, replay/conflict, lost-reply readback, server-side stripping, limits and two-owner isolation.
const bundle=await build({stdin:{contents:[
 "export {default as worker} from './src/index';export {androidPasskeyOrigins} from './src/android-signing';",
 "export {admitWorkspace} from './src/workspace-identity/admission';export {resolveIdentity} from './src/workspace-identity/authority';",
 "export {newSessionToken,hashToken} from './src/security';",
 "export {createWebsite,prepareSpecification,readSpecificationProposal} from './src/project-specification/store';export {issueContentBrief,issueProjectIntake} from './src/chat-interactions/store';export {readChat,sendChat,sendChatControl} from './src/chat';"
 ].join(''),resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
crypto.subtle.timingSafeEqual=(a,b)=>timingSafeEqual(Buffer.from(a),Buffer.from(b));
const fixtures=name=>JSON.parse(readFileSync(new URL('./fixtures/mobile-v1/'+name,import.meta.url),'utf8'));
const operations=Object.fromEntries(fixtures('operations.json').cases.map(c=>[c.operation,c])),errors=fixtures('errors.json').cases,clients=fixtures('client.json');
const clientHeader=JSON.stringify(clients.current),clientWith=o=>JSON.stringify({...clients.current,...o});
const d1=process.argv.includes('--d1');
function memoryR2(){
 const objects=new Map(),meta=key=>{const o=objects.get(key);return o?{key,size:o.bytes.length,customMetadata:o.customMetadata,body:{cancel:async()=>{}},arrayBuffer:async()=>o.bytes.slice().buffer}:null;};
 return {put:async(key,value,options={})=>{if(options.onlyIf?.etagDoesNotMatch==='*'&&objects.has(key))return null;objects.set(key,{bytes:new Uint8Array(value),customMetadata:options.customMetadata??{}});return meta(key);},get:async key=>meta(key),head:async key=>meta(key),delete:async key=>{objects.delete(key);}};
}
const fixture=d1?await databaseFixture({d1:true,r2:true}):await databaseFixture(),db=fixture.db,store=d1?fixture.env.FILES:memoryR2(),faults={put:false},FILES={put:async(...x)=>{if(faults.put)throw Error("connection reset");return store.put(...x);},get:(...x)=>store.get(...x),head:(...x)=>store.head(...x),delete:(...x)=>store.delete(...x)};
const id=()=>crypto.randomUUID(),run=(sql,...v)=>db.prepare(sql).bind(...v).run(),one=(sql,...v)=>db.prepare(sql).bind(...v).first();
const count=async(sql,...v)=>(await one(`SELECT count(*) n FROM (${sql})`,...v)).n;
const androidOrigin=m.androidPasskeyOrigins[0];
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(e){console.error('FAILED:',name);throw e;}};
const env={DB:db,FILES,ENVIRONMENT:'test',MOBILE_MINIMUM_BUILD:'40',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})}};
const ctx={waitUntil(){}};
async function mobile(path,{method='GET',token,body,raw,client=clientHeader,headers={}}={}){
 const h={...(client===null?{}:{'whumpo-client':client}),...(token?{authorization:'Bearer '+token}:{}),...headers};
 if(body!==undefined)h['content-type']='application/json';
 const response=await m.worker.fetch(new Request('https://whumpo.com/api/mobile/v1'+path,{method,headers:h,body:raw!==undefined?raw:body===undefined?undefined:JSON.stringify(body)}),env,ctx);
 const bytes=new Uint8Array(await response.arrayBuffer()),text=new TextDecoder().decode(bytes);let data=null;try{data=JSON.parse(text);}catch{}
 if(response.headers.get('content-type')!=='image/jpeg')assert.equal(response.headers.get('cache-control'),'no-store');
 return {status:response.status,data,text,bytes,headers:response.headers};
}
// Every fixture key is present in the live body with the same JSON type (null in a fixture accepts any value).
function shaped(live,fixture,at='body'){
 if(fixture===null||live===null)return; // a nullable member may be null live where the fixture shows an example
 assert.equal(typeof live,typeof fixture,at);
 if(Array.isArray(fixture)){assert(Array.isArray(live),at);if(fixture.length&&live.length)shaped(live[0],fixture[0],at+'[0]');return;}
 if(fixture&&typeof fixture==='object')for(const k of Object.keys(fixture)){assert(Object.hasOwn(live,k),`${at}.${k} missing`);shaped(live[k],fixture[k],at+'.'+k);}
}
const fixtureCall=(name,live)=>{assert.equal(live.status,operations[name].response.status,live.text);shaped(live.data,operations[name].response.body);};
const same=(live,fixture)=>assert.deepEqual(live,fixture);
const handleOf=account=>Buffer.from(account).toString('base64url');
let counter=0;
async function session(o,{proofAge=5,method='passkey',lifetime=3600}={}){
 const token=m.newSessionToken(),authority=id();
 await run("INSERT INTO identity_sessions(id,token_hash,account_id,policy_version,auth_epoch,client,credential_id,proof_method,proof_at,issued_at,expires_at) VALUES(?,?,?,1,(SELECT auth_epoch FROM identity_accounts WHERE account_id=?),'android',?,?,unixepoch()-?,unixepoch(),unixepoch()+?)",authority,await m.hashToken(token),o.account,o.account,o.key.id,method,proofAge,lifetime);
 return {token,authority};
}
// An owner with a ready account, a real passkey, a private website and a core.editing read grant.
async function owner({project=true}={}){
 const account=id(),key=authenticator();
 await run("INSERT INTO users(id,email,created_at) VALUES(?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",account,`owner${++counter}${account.slice(0,6)}@example.test`);
 await run("INSERT INTO identity_accounts(account_id,policy_version,stage,auth_epoch,kit_generation,kit_verifier,completion_receipt_id) VALUES(?,1,'ready',1,1,?,?)",account,'a'.repeat(64),id());
 await run("INSERT INTO identity_credentials VALUES(?,?,?,0,'Synthetic passkey','active',NULL,unixepoch(),NULL)",key.id,account,key.publicKey);
 const o={account,key,n:0};
 o.assert=(options)=>key.assertion(options,++o.n,{atOrigin:androidOrigin,handle:handleOf(account)});
 o.setup=await session(o);
 o.scope=async()=>m.admitWorkspace(db,await m.resolveIdentity(db,{version:1,client:'android',kind:'session',token:o.setup.token}));
 if(project){
  o.project=id();const now=new Date().toISOString();
  await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Garden','Landscaping','draft',?,?)",o.project,account,now,now);
  await createFixtureWebsite(await o.scope(),account,o.project,{name:'Garden',headline:'Neighborhood gardens',description:'Local gardening',theme:'ocean',aboutTitle:'Our work',aboutText:'Seasonal planting.',sections:[],photos:[]},m);
  await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.editing','read','private-test-acceptance','synthetic mobile slice fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),account,o.project);
 }
 return o;
}
// A minimal baseline JPEG envelope (what cleanPhoto accepts). `exif` adds an APP1 and a COM segment carrying a secret the server must strip.
const secret='GPS-LAT-51.5-SECRET-DEVICE';
function jpeg({w=1200,h=800,exif=true,seed=1}={}){
 const seg=(marker,body)=>[0xff,marker,(body.length+2)>>8,(body.length+2)&255,...body],text=s=>[...new TextEncoder().encode(s)];
 return new Uint8Array([0xff,0xd8,...(exif?[...seg(0xe1,text('Exif\0\0'+secret)),...seg(0xfe,text(secret))]:[]),
  ...seg(0xdb,[0,0,0]),...seg(0xc4,[0,0,0]),...seg(0xc0,[8,h>>8,h&255,w>>8,w&255,1,1,0x11,0]),...seg(0xda,[1,1,0,0,63,0]),seed&127,0x34,0xff,0xd9]);
}
const has=(bytes,needle)=>Buffer.from(bytes).includes(needle);
const put=(token,project,upload,bytes,{name='van.jpg',type='image/jpeg',headers={},query=''}={})=>mobile(`/projects/${project}/photos/${upload}${query}`,{method:'PUT',token,raw:bytes,headers:{'content-type':type,...(name===null?{}:{'x-photo-name':encodeURIComponent(name)}),...headers}});
const get=(path,token,client)=>mobile(path,{token,client});
const approve=file=>run("UPDATE project_photo_safety SET state='approved',csam_check='clear',sexual_check='clear',scanner_reference='synthetic-only',expires_at=? WHERE file_id=?",new Date(Date.now()+3600000).toISOString(),file);
const objectOf=async file=>FILES.get((await one('SELECT object_key FROM project_files WHERE id=?',file)).object_key);
try{
 const a=await owner(),b=await owner(),sa=await session(a),sb=await session(b);
 const original=jpeg(),up=id();

 await check('upload: fixture shape, server-side validation and metadata stripping (the client is not trusted)',async()=>{
  assert(has(original,secret),'the test image carries metadata');
  const r=await put(sa.token,a.project,up,original);fixtureCall('photo.upload',r);
  assert.equal(r.data.photo.id,up);assert.equal(r.data.photo.name,'van.jpg');assert.equal(r.data.photo.width,1200);assert.equal(r.data.photo.height,800);assert.equal(r.data.photo.status,'ready');assert.equal(r.data.photo.safetyStatus,'pending');
  assert(r.data.photo.size<original.length,'the stored size is the stripped size');
  const stored=new Uint8Array(await(await objectOf(up)).arrayBuffer());
  assert(!has(stored,secret),'EXIF and comment bytes are not stored');assert.equal(stored.length,r.data.photo.size);
  assert(!has(r.text,'object_key')&&!has(r.text,'digest')&&!has(r.text,'photos/'),'no storage key or digest on the wire');
 });

 await check('replay: the same upload ID and bytes return the same result and write nothing',async()=>{
  const before=await count('SELECT 1 FROM project_files WHERE project_id=?',a.project),events=await count("SELECT 1 FROM activity_events WHERE project_id=? AND action='file.uploaded'",a.project);
  const first=await get(`/projects/${a.project}/photos/${up}`,sa.token),again=await put(sa.token,a.project,up,original);
  assert.equal(again.status,200,again.text);same(again.data,first.data);
  assert.equal(await count('SELECT 1 FROM project_files WHERE project_id=?',a.project),before);assert.equal(await count("SELECT 1 FROM activity_events WHERE project_id=? AND action='file.uploaded'",a.project),events);
 });

 await check('conflict: the same ID with different bytes, name or project is request_conflict',async()=>{
  for(const [label,r] of [['bytes',await put(sa.token,a.project,up,jpeg({seed:9}))],['name',await put(sa.token,a.project,up,original,{name:'other.jpg'})]]){assert.equal(r.status,409,label);assert.equal(r.data.error.code,'request_conflict',label);}
  const second=id();await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Second','','draft',datetime('now'),datetime('now'))",second,a.account);
  const moved=await put(sa.token,second,up,original);assert.equal(moved.status,409);assert.equal(moved.data.error.code,'request_conflict');
  assert(!has(moved.text,'SQL')&&!has(moved.text,'photos/'));
  await run('DELETE FROM projects WHERE id=?',second);
 });

 await check('limits and types: over 1 MiB, not JPEG, wrong media type, missing name or body and a query are refused with the contract codes',async()=>{
  const big=new Uint8Array(1048577);big.set([0xff,0xd8]);
  let r=await put(sa.token,a.project,id(),big);assert.equal(r.status,413);same(r.data,errors.payload_too_large.body);
  r=await put(sa.token,a.project,id(),big,{headers:{'content-length':String(big.length)}});assert.equal(r.status,413);
  r=await put(sa.token,a.project,id(),original,{type:'image/png'});assert.equal(r.status,415);same(r.data,errors.unsupported_media_type.body);
  r=await put(sa.token,a.project,id(),original,{type:'application/octet-stream'});assert.equal(r.status,415);
  r=await put(sa.token,a.project,id(),new TextEncoder().encode('GIF89a not a jpeg at all, just text'));assert.equal(r.status,400);assert.equal(r.data.error.code,'invalid_request');
  r=await put(sa.token,a.project,id(),jpeg({w:1601}));assert.equal(r.status,400,'dimensions over 1600 are refused');
  r=await put(sa.token,a.project,id(),original,{name:null});assert.equal(r.status,400);
  r=await put(sa.token,a.project,id(),original,{name:'x'.repeat(101)});assert.equal(r.status,400);
  r=await put(sa.token,a.project,id(),original,{name:'a/b.jpg'});assert.equal(r.status,400);
  r=await mobile(`/projects/${a.project}/photos/${id()}`,{method:'PUT',token:sa.token,headers:{'content-type':'image/jpeg','x-photo-name':'v.jpg'}});assert.equal(r.status,400);
  r=await put(sa.token,a.project,id(),original,{query:'?x=1'});assert.equal(r.status,400);assert.equal(r.data.error.code,'unknown_field');
  r=await put(sa.token,a.project,'not-a-uuid',original);assert.equal(r.status,404);
  r=await put(sa.token,a.project,id(),original,{headers:{cookie:'x=1'}});assert.equal(r.status,400);
  assert.equal(await count('SELECT 1 FROM project_files WHERE project_id=?',a.project),1,'refusals store nothing');
 });

 await check('a native caller cannot name a Chat handoff',async()=>{
  const fresh=id(),r=await put(sa.token,a.project,fresh,jpeg({seed:3}),{headers:{'x-whumpo-photo-handoff':JSON.stringify({interactionId:id(),definitionDigest:'a'.repeat(64)})}});
  assert.equal(r.status,200,r.text);assert.equal((await one('SELECT handoff_json h FROM project_files WHERE id=?',fresh)).h,'null');
 });

 await check('status: fixture shape, readback of a committed upload and not_found when nothing committed',async()=>{
  fixtureCall('photo.status',await get(`/projects/${a.project}/photos/${up}`,sa.token));
  const none=await get(`/projects/${a.project}/photos/${id()}`,sa.token);assert.equal(none.status,404);same(none.data,errors.not_found.body);
 });

 await check('lost reply: a failed write is resolved by status and a same-bytes retry; a lost success is resolved by status alone',async()=>{
  const lost=id(),bytes=jpeg({seed:5});
  faults.put=true;
  try{
   const r=await put(sa.token,a.project,lost,bytes);assert.equal(r.status,503);assert.equal(r.data.error.code,'unavailable');
   const s=await get(`/projects/${a.project}/photos/${lost}`,sa.token);assert.equal(s.status,200,s.text);assert.equal(s.data.photo.status,'pending','the reservation is visible');
   faults.put=false;
   const retry=await put(sa.token,a.project,lost,bytes);assert.equal(retry.status,200,retry.text);assert.equal(retry.data.photo.status,'ready');
  }finally{faults.put=false;}
  const s=await get(`/projects/${a.project}/photos/${lost}`,sa.token);assert.equal(s.data.photo.status,'ready');same(s.data,{version:1,photo:(await put(sa.token,a.project,lost,bytes)).data.photo});
  assert.equal(await count('SELECT 1 FROM project_files WHERE id=?',lost),1);
 });

 await check('list: fixture shape, no storage fields, and each owner sees only their own',async()=>{
  const r=await get(`/projects/${a.project}/photos`,sa.token);fixtureCall('photo.list',r);
  assert(r.data.items.some(p=>p.id===up));for(const p of r.data.items)assert.deepEqual(Object.keys(p).sort(),['height','id','name','safetyStatus','size','status','width']);
  const mine=await get(`/projects/${b.project}/photos`,sb.token);assert.equal(mine.status,200);assert.deepEqual(mine.data.items,[]);
  const foreign=await get(`/projects/${a.project}/photos`,sb.token);assert.equal(foreign.status,404);same(foreign.data,errors.not_found.body);
  assert.equal((await get(`/projects/${a.project}/photos?limit=1`,sa.token)).status,400,'no query keys on the photo list');
 });

 await check('two owners: B can neither upload to, read the status of, nor fetch the bytes of A',async()=>{
  const intrude=await put(sb.token,a.project,id(),original);assert.equal(intrude.status,404);same(intrude.data,errors.not_found.body);
  assert.equal((await get(`/projects/${a.project}/photos/${up}`,sb.token)).status,404);
  assert.equal((await get(`/projects/${b.project}/photos/${up}`,sb.token)).status,404,'A upload ID under B project is not visible');
  await approve(up);
  assert.equal((await get('/photos/'+up,sb.token)).status,404);
  const own=await put(sb.token,b.project,id(),jpeg({seed:7}));assert.equal(own.status,200);
 });

 await check('bytes: held until approved, then the exact stored bytes with the web headers, to the owner only and by bearer only',async()=>{
  const fresh=id();await put(sa.token,a.project,fresh,jpeg({seed:11}));
  const held=await get('/photos/'+fresh,sa.token);assert.equal(held.status,404,'pending safety review is not displayable');same(held.data,errors.not_found.body);
  await approve(fresh);
  const r=await get('/photos/'+fresh,sa.token);
  assert.equal(r.status,operations['photo.bytes'].response.status);const stored=new Uint8Array(await(await objectOf(fresh)).arrayBuffer());assert.deepEqual(r.bytes,stored);assert(!has(r.bytes,secret));
  const want={'content-type':operations['photo.bytes'].response.binary.contentType,'cache-control':operations['photo.bytes'].response.binary.cacheControl,'content-disposition':'inline; filename="photo.jpg"','content-security-policy':"sandbox; default-src 'none'",'x-content-type-options':'nosniff','referrer-policy':'no-referrer','cross-origin-resource-policy':'same-origin'};
  for(const [k,v] of Object.entries(want))assert.equal(r.headers.get(k),v,k);
  assert.equal(r.headers.get('content-length'),String(stored.length));
  assert.equal((await get('/photos/'+fresh,sb.token)).status,404);
  assert.equal((await get('/photos/'+id(),sa.token)).status,404);
  assert.equal((await get('/photos/'+fresh)).status,401);
  assert.equal((await mobile('/photos/'+fresh,{token:sa.token,headers:{cookie:'__Host-whumpo_session='+sa.token}})).status,400);
  assert.equal((await mobile('/photos/'+fresh,{headers:{cookie:'__Host-whumpo_session='+sa.token}})).status,400,'a cookie alone is never authority');
  assert.equal((await get('/photos/'+fresh,sa.token,clientWith({build:39}))).status,426);
  assert.equal((await mobile('/photos/'+fresh,{method:'DELETE',token:sa.token})).status,404);
  // The web route refuses the same bearer.
  const web=await m.worker.fetch(new Request('https://whumpo.com/api/files/'+fresh,{headers:{authorization:'Bearer '+sa.token}}),env,ctx);assert.equal(web.status,401);
 });

 await check('blocked media is never served',async()=>{
  const fresh=id();await put(sa.token,a.project,fresh,jpeg({seed:13}));
  await run("UPDATE project_photo_safety SET state='blocked' WHERE file_id=?",fresh);
  const r=await get('/photos/'+fresh,sa.token);assert.equal(r.status,404);assert(r.bytes.length<400);
  const s=await get(`/projects/${a.project}/photos/${fresh}`,sa.token);assert.equal(s.data.photo.safetyStatus,'blocked');
 });

 await check('quota: the web per-project photo limit applies and leaves no partial upload',async()=>{
  const q=id();await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Quota','','draft',datetime('now'),datetime('now'))",q,a.account);
  let last;for(let i=0;i<21;i++){last=await put(sa.token,q,id(),jpeg({seed:20+i}));if(last.status!==200)break;}
  assert.notEqual(last.status,200,'the 21st photo in one project is refused');assert.equal(last.data.error.code,'unavailable');assert(last.data.error.message.length>0);
  assert.equal(await count('SELECT 1 FROM project_files WHERE project_id=?',q),20);
 });

 await check('sign-in: no bearer is 401',async()=>{
  assert.equal((await put(null,a.project,id(),original)).status,401);
  assert.equal((await get(`/projects/${a.project}/photos`)).status,401);
 });

 console.log(`Mobile photos: ${cases} checks over the four operations on ${d1?'local D1':'SQLite'}.`);
}catch(error){console.error(error);process.exitCode=1;}
finally{await fixture.close();}
