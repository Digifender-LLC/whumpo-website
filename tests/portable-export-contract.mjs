import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {request} from 'node:http';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

// WH-077 / WH-186 offline conformance for the portable export contract (docs/portable-exports.md).
// Synthetic stores and invented identifiers only: no database, bucket, Worker, provider, credential, network
// destination or model. It proves the frozen bundle format, permission filter, tier labelling, report, strict
// reader and a static clean-environment boot of the reference. It does not prove the WH-187 builder over D1/R2,
// a WH-188 standalone runtime or WH-189 clean-room acceptance. Every in-process check also runs against
// deliberately broken copies of the reference (mutants below); each must be caught by its named check.
const prototypeURL=new URL('../tools/prototypes/portable-export.mjs',import.meta.url);
const prototypePath=fileURLToPath(prototypeURL);
const prototypeSource=readFileSync(prototypeURL,'utf8');
const contractDoc=readFileSync(new URL('../docs/portable-exports.md',import.meta.url),'utf8');
const reference=await import(prototypeURL.href);

const A='11111111-1111-4111-8111-111111111111',B='22222222-2222-4222-8222-222222222222';
const CUTOFF='2026-10-08T12:00:00.000Z';
const hex=s=>createHash('sha256').update(s).digest('hex');
const day=n=>new Date(Date.parse(CUTOFF)-n*86400000).toISOString();
const jpeg=label=>new Uint8Array(Buffer.concat([Buffer.from([0xff,0xd8,0xff,0xe0]),Buffer.from(label),Buffer.from([0xff,0xd9])]));
// Every marker below stands for something that must never leave the platform in a default export.
const SECRETS=['SYNTHETIC-PLATFORM-SECRET-0001','SYNTHETIC-OAUTH-TOKEN-0002','SYNTHETIC-PASSKEY-0003','SYNTHETIC-SESSION-0004','SYNTHETIC-RECOVERY-0005','SYNTHETIC-TURNSTILE-0006','SYNTHETIC-DNS-PROOF-0007','SYNTHETIC-INVITE-0008'];
const PRIVATE=['PENDING-BYTES-MARKER','BLOCKED-BYTES-MARKER','HELD-BYTES-MARKER','STAFF-PAGE-MARKER','UNCLEARED-SOURCE-MARKER','CONTACT-MESSAGE-MARKER','FOREIGN-ROW-MARKER'];
const VISITOR_ONLY=['VISITOR-VALUE-MARKER','VISITOR-UPLOAD-MARKER'];
const NEVER_EVEN_WITH_SCOPE=['HELD-RECORD-MARKER','EXPIRED-RECORD-MARKER','PENDING-UPLOAD-MARKER','HELD-UPLOAD-MARKER'];
const TENANT_B=['TENANT-B-PRIVATE-MARKER',B];
const pinOf=name=>({name,version:1,digest:hex(name)});
const headers={'content-security-policy':"default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",'x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
const page=(title,body)=>`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>body{font-family:serif}</style></head><body>${body}</body></html>`;

function specification(name){
 return {schemaVersion:3,name,design:{theme:'ocean'},modules:[{id:'content',version:2},{id:'notifications',version:1}],
  content:[{id:'headline',text:name},{id:'team-note',text:'Team schedule note is owner configuration'}],
  pages:[{id:'home',path:'/',component:'photo-page@1',audience:'public'}],
  instances:[{id:'appointments',kind:'records'},{id:'uploads',kind:'files'},{id:'visitors',kind:'access'},{id:'directory',kind:'content'}],
  integrations:[{id:'staff-mail',capability:'email.staff'}],
  rules:[{id:'notify-staff',trigger:{type:'form.accepted',formId:'book'},effect:{type:'notification.send',integrationId:'staff-mail',recipient:'staff',template:'submission-link@1'}}]};
}
function fixture(){
 const spec=specification('Shine Mobile Detailing');
 const home=page('Shine Mobile Detailing','<h1>Shine Mobile Detailing</h1><img src="/assets/ph-1.jpg" alt="Clean blue hatchback">');
 const services=page('Services','<h1>Services</h1><p>Exterior wash and full detail.</p>');
 const team=page('Team','<h1>STAFF-PAGE-MARKER</h1>');
 const gallery=page('Gallery','<img src="/assets/ph-foreign.jpg" alt="x">');
 const photos={
  'ph-1':{projectId:A,bytes:jpeg('approved-photo'),approval:'approved',hold:false},
  'ph-2':{projectId:A,bytes:jpeg('approved-unused-photo'),approval:'approved',hold:false},
  'ph-pending':{projectId:A,bytes:jpeg('PENDING-BYTES-MARKER'),approval:'pending',hold:false},
  'ph-blocked':{projectId:A,bytes:jpeg('BLOCKED-BYTES-MARKER'),approval:'blocked',hold:false},
  'ph-held':{projectId:A,bytes:jpeg('HELD-BYTES-MARKER'),approval:'approved',hold:true},
  'ph-foreign':{projectId:B,bytes:jpeg('FOREIGN-ROW-MARKER'),approval:'approved',hold:false},
 };
 for(const p of Object.values(photos))p.digest=hex(p.bytes);
 const recordsConfig={retentionDays:90,schemas:[{id:'appointment',fieldsRevision:1,fields:[{key:'name',label:'Name',type:'text',optional:false,read:'staff'},{key:'vehicle',label:'Vehicle',type:'text',optional:false,read:'staff'}],staffWrite:[]}],forms:[{id:'book',recordId:'appointment',submit:'public',uploadCollectionId:null}],views:[]};
 const instances=[
  {resourceId:'33333333-3333-4333-8333-000000000001',localId:'appointments',kind:'records',module:pinOf('module-records'),schema:pinOf('records-data'),configRevision:4,config:recordsConfig},
  {resourceId:'33333333-3333-4333-8333-000000000002',localId:'uploads',kind:'files',module:pinOf('module-files'),schema:pinOf('files-data'),configRevision:2,config:{collections:[{id:'vehicle-photos',read:'staff',upload:['visitor'],maxBytes:1048576,mediaTypes:['image/jpeg'],gallery:null}]}},
  {resourceId:'33333333-3333-4333-8333-000000000003',localId:'visitors',kind:'access',module:pinOf('module-access'),schema:pinOf('access-data'),configRevision:1,config:{roles:['staff'],enrollment:'invitation'}},
  {resourceId:'33333333-3333-4333-8333-000000000004',localId:'directory',kind:'content',module:pinOf('module-collections'),schema:pinOf('collections-data'),configRevision:1,config:{collections:[{id:'listings',type:'directory-listing@1'}]}},
 ];
 const R=instances[0].resourceId,F=instances[1].resourceId;
 const moduleFiles=[
  {id:'f-1',projectId:A,resourceId:F,collectionId:'vehicle-photos',bytes:jpeg('VISITOR-UPLOAD-MARKER'),approval:'approved',hold:false,uploader:{kind:'visitor',visitorId:'v-1'}},
  {id:'f-2',projectId:A,resourceId:F,collectionId:'vehicle-photos',bytes:jpeg('PENDING-UPLOAD-MARKER'),approval:'pending',hold:false,uploader:{kind:'visitor',visitorId:'v-1'}},
  {id:'f-3',projectId:A,resourceId:F,collectionId:'vehicle-photos',bytes:jpeg('HELD-UPLOAD-MARKER'),approval:'approved',hold:true,uploader:{kind:'visitor',visitorId:'v-1'}},
 ];
 for(const f of moduleFiles)f.digest=hex(f.bytes);
 const lineTotal='export function run(input){return {total:input.items.reduce((a,b)=>a+b.price*b.quantity,0)};}\n';
 const projectA={
  ownerId:'owner-a',name:'Shine Mobile Detailing',specification:spec,specificationDigest:hex(reference.canonicalJSON(spec)),
  specificationVersionId:'44444444-4444-4444-8444-000000000001',compiler:pinOf('project-content'),
  components:[{id:'photo-page@1',digest:hex('photo-page@1')},{id:'site-page@1',digest:hex('site-page@1')}],headers,
  pages:[
   {id:'home',path:'/',audience:'public',html:home,digest:hex(home),photos:['ph-1']},
   {id:'services',path:'/services',audience:'public',html:services,digest:hex(services),photos:[]},
   {id:'team',path:'/team',audience:'staff',html:team,digest:hex(team),photos:[]},
   {id:'gallery',path:'/gallery',audience:'public',html:gallery,digest:hex(gallery),photos:['ph-foreign']},
  ],
  photos,instances,moduleFiles,
  records:[
   {id:'r-1',projectId:A,resourceId:R,schemaId:'appointment',formId:'book',submitter:{kind:'visitor',visitorId:'v-1'},revision:1,createdAt:day(1),hold:false,values:{name:'VISITOR-VALUE-MARKER',vehicle:'Blue hatchback'}},
   {id:'r-2',projectId:A,resourceId:R,schemaId:'appointment',formId:'book',submitter:{kind:'anonymous'},revision:1,createdAt:day(2),hold:true,values:{name:'HELD-RECORD-MARKER',vehicle:'Red van'}},
   {id:'r-3',projectId:A,resourceId:R,schemaId:'appointment',formId:'book',submitter:{kind:'anonymous'},revision:1,createdAt:day(120),hold:false,values:{name:'EXPIRED-RECORD-MARKER',vehicle:'Old sedan'}},
   {id:'r-4',projectId:B,resourceId:R,schemaId:'appointment',formId:'book',submitter:{kind:'anonymous'},revision:1,createdAt:day(1),hold:false,values:{name:'FOREIGN-ROW-MARKER',vehicle:'x'}},
  ],
  roles:[{projectId:A,visitorId:'v-staff',grantedAt:day(10),state:'staff',passkeyCredential:'SYNTHETIC-PASSKEY-0003'}],
  directory:{projectId:A,snapshotId:'55555555-5555-4555-8555-000000000001',appliedAt:day(3),listings:[{id:'l-2',name:'North lot'},{id:'l-1',name:'Main Street'}]},
  programs:[
   {id:'line-total',projectId:A,source:lineTotal,digest:hex(lineTotal),cleared:true},
   {id:'draft-tool',projectId:A,source:'// UNCLEARED-SOURCE-MARKER\n',digest:hex('// UNCLEARED-SOURCE-MARKER\n'),cleared:false},
  ],
  frontends:[{id:'booking',files:{'index.html':page('Book','<form id="b"></form><script>fetch(\'/modules\',{method:\'POST\',credentials:\'same-origin\'})</script>')}}],
  visitors:[{id:'v-1',passkey:'SYNTHETIC-PASSKEY-0003',session:'SYNTHETIC-SESSION-0004',recoveryCode:'SYNTHETIC-RECOVERY-0005',invitation:'SYNTHETIC-INVITE-0008'}],
  connections:[{provider:'github',accessToken:'SYNTHETIC-OAUTH-TOKEN-0002'}],
  domains:[{hostname:'shine.example',proof:'SYNTHETIC-DNS-PROOF-0007'}],
  contactInbox:{messages:[{text:'CONTACT-MESSAGE-MARKER'}],turnstileSecret:'SYNTHETIC-TURNSTILE-0006'},
 };
 const specB=specification('TENANT-B-PRIVATE-MARKER');
 const htmlB=page('B','<h1>TENANT-B-PRIVATE-MARKER</h1>');
 const projectB={ownerId:'owner-b',name:'TENANT-B-PRIVATE-MARKER',specification:specB,specificationDigest:hex(reference.canonicalJSON(specB)),
  specificationVersionId:'44444444-4444-4444-8444-000000000002',compiler:pinOf('project-content'),components:[],headers,
  pages:[{id:'home',path:'/',audience:'public',html:htmlB,digest:hex(htmlB),photos:[]}],photos:{},instances:[]};
 return {platformSecrets:{SESSION_SIGNING_KEY:'SYNTHETIC-PLATFORM-SECRET-0001'},projects:{[A]:projectA,[B]:projectB}};
}
// Reverse every object's key order and every unordered stored collection, so determinism cannot depend on
// storage order. Ordered content (specification arrays, record field lists) keeps its meaning and its order.
const unordered=new Set(['pages','instances','records','moduleFiles','programs','frontends','roles','listings','components','visitors','connections','domains']);
function shuffled(value,key='',ordered=false){
 if(value instanceof Uint8Array)return value;
 if(Array.isArray(value)){const items=value.map(v=>shuffled(v,'',ordered));return unordered.has(key)&&!ordered?items.reverse():items;}
 if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).reverse().map(k=>[k,shuffled(value[k],k,ordered||k==='specification'||k==='config')]));
 return value;
}
const owner=(ownerId='owner-a')=>({kind:'owner',ownerId});
const has=(bytes,marker)=>Buffer.from(bytes).includes(Buffer.from(marker));
const slug=h=>h.toLowerCase().replace(/[^a-z0-9 -]/g,'').trim().replace(/ /g,'-');
const anchors=new Set([...contractDoc.matchAll(/^#{2,4} (.+)$/gm)].map(m=>slug(m[1])));

async function suite(m){
 let count=0;
 const test=async(name,fn)=>{try{await fn();count++;}catch(error){throw new Error(name,{cause:error});}};
 const throws=(fn,code)=>assert.throws(fn,e=>{assert.equal(e.code,code,e.message);return true;});
 const build=(o={})=>m.buildExport(o.store??fixture(),{actor:o.actor??owner(),projectId:o.projectId??A,scope:o.scope??{visitorData:false},cutoff:o.cutoff??CUTOFF});
 let base,withVisitors;
 const repack=(bytes,edit)=>{
  const entries=new Map(m.unpackEntries(bytes));
  const manifest=JSON.parse(Buffer.from(entries.get('manifest.json')).toString());
  edit(manifest,entries);
  entries.delete('manifest.json');
  manifest.files=[...entries.keys()].sort().map(path=>{const old=manifest.files.find(f=>f.path===path);const data=entries.get(path);return {...(old??{tier:'data',classId:'projects'}),path,bytes:data.length,sha256:hex(data)};});
  return m.packEntries([['manifest.json',Buffer.from(m.canonicalJSON(manifest))],...[...entries.entries()].sort(([a],[b])=>a<b?-1:1)]);
 };

 await test('deterministic bundle: same inputs give identical bytes and hashes',()=>{
  base=build();withVisitors=build({scope:{visitorData:true}});
  const again=build();
  assert.ok(Buffer.from(again.bytes).equals(Buffer.from(base.bytes)));assert.equal(again.sha256,base.sha256);
  const reordered=build({store:shuffled(fixture())});
  assert.equal(reordered.sha256,base.sha256);
  assert.notEqual(build({cutoff:'2026-10-08T12:00:01.000Z'}).sha256,base.sha256);
  const entries=m.unpackEntries(base.bytes).map(([p])=>p);
  assert.equal(entries[0],'manifest.json');
  for(let i=2;i<entries.length;i++)assert.ok(Buffer.compare(Buffer.from(entries[i-1]),Buffer.from(entries[i]))<0,`entry order ${entries[i]}`);
  const raw=Buffer.from(base.bytes);
  assert.equal(raw.readUInt16LE(10),0);assert.equal(raw.readUInt16LE(12),0x21);assert.equal(raw.readUInt16LE(8),0);
 });
 await test('other tenant: never exported, never readable by another owner',()=>{
  throws(()=>build({actor:owner('owner-b')}),'FORBIDDEN');
  for(const actor of [{kind:'visitor',ownerId:'owner-a'},{kind:'model',ownerId:'owner-a'},{kind:'job',ownerId:'owner-a'},{kind:'owner'}])throws(()=>build({actor}),'FORBIDDEN');
  throws(()=>build({projectId:'99999999-9999-4999-8999-999999999999'}),'FORBIDDEN');
  for(const b of [base,withVisitors])for(const marker of [...TENANT_B,'FOREIGN-ROW-MARKER'])assert.equal(has(b.bytes,marker),false,marker);
  assert.equal(base.manifest.files.some(f=>f.path.includes('ph-foreign')),false);
 });
 await test('platform secrets and credentials are never included',()=>{
  for(const b of [base,withVisitors])for(const marker of SECRETS)assert.equal(has(b.bytes,marker),false,marker);
  const roles=JSON.parse(Buffer.from(new Map(m.unpackEntries(base.bytes)).get('data/access/visitors/roles.json')).toString());
  assert.deepEqual(Object.keys(roles.staff[0]).sort(),['grantedAt','state','visitorId']);
  const store=fixture();store.projects[A].specification.integrations[0].apiKey='x';
  store.projects[A].specificationDigest=hex(m.canonicalJSON(store.projects[A].specification));
  throws(()=>build({store}),'SECRET_FIELD');
  const store2=fixture();store2.projects[A].directory.listings[0].sessionCookie='x';
  throws(()=>build({store:store2}),'SECRET_FIELD');
  assert.ok(base.manifest.exclusions.some(e=>e.category==='credentials-and-sessions'&&e.count===null));
 });
 await test('private, unapproved and held content is never included',()=>{
  for(const b of [base,withVisitors])for(const marker of [...PRIVATE,...NEVER_EVEN_WITH_SCOPE])assert.equal(has(b.bytes,marker),false,marker);
  assert.equal(base.manifest.files.some(f=>f.path.startsWith('site/public/team')),false);
  assert.equal(base.manifest.files.some(f=>f.path.startsWith('site/public/gallery')),false);
  assert.ok(base.manifest.exclusions.some(e=>e.category==='staff-page-not-served'&&e.count===1));
  assert.ok(base.manifest.exclusions.some(e=>e.category==='contact-inbox-separate-export'));
  assert.equal(has(base.bytes,'Team schedule note is owner configuration'),true,'owner configuration text stays in the specification');
 });
 await test('visitor datasets need separate approval',()=>{
  assert.equal(base.manifest.files.some(f=>f.path.startsWith('data/records/')||f.path.startsWith('data/files/')),false);
  for(const marker of VISITOR_ONLY)assert.equal(has(base.bytes,marker),false,marker);
  assert.equal(base.manifest.exclusions.find(e=>e.category==='visitor-dataset-not-requested').count,2);
  for(const marker of VISITOR_ONLY)assert.equal(has(withVisitors.bytes,marker),true,marker);
  const records=JSON.parse(Buffer.from(new Map(m.unpackEntries(withVisitors.bytes)).get('data/records/appointments/appointment.json')).toString());
  assert.deepEqual(records.records.map(r=>r.id),['r-1']);
  assert.equal(withVisitors.manifest.scope.visitorData,true);
  throws(()=>build({scope:{visitorData:true,everything:true}}),'INVALID_SCOPE');
 });
 await test('hold non-disclosure: a held item is indistinguishable from any other uncleared item',()=>{
  const pending=fixture();pending.projects[A].photos['ph-held'].hold=false;pending.projects[A].photos['ph-held'].approval='pending';
  assert.equal(build({store:pending}).sha256,base.sha256);
  assert.ok(base.manifest.exclusions.every(e=>!/hold|held|safety|case/i.test(e.category)));
  // pending, blocked and held photos, the page with a foreign photo and the uncleared program: one generic count.
  assert.equal(base.manifest.exclusions.find(e=>e.category==='not-cleared').count,5);
 });
 await test('tier labelling: a frontend that needs Whumpo APIs is never runnable',()=>{
  assert.deepEqual(base.manifest.claims.runnable,['static-site']);
  const booking=base.manifest.frontends.find(f=>f.id==='booking');
  assert.equal(booking.runnable,false);assert.ok(booking.requires.includes('platform-route')&&booking.requires.includes('dynamic-network'));
  const backendForm=page('Tool','<form id="whumpo-backend-form" data-endpoint="https://p.whumpo.site/backend/x"></form>');
  assert.equal(m.classifyFrontend({'index.html':backendForm}).runnable,false);
  assert.equal(m.classifyFrontend({'index.html':page('Plain','<p>Hi</p>')}).runnable,true);
  for(const html of ['<a href="https://app-x.whumpo.site/">x</a>','<img src="/api/v1/photo">','<form action="/contact">'])assert.equal(m.classifyFrontend({'a.html':html}).runnable,false,html);
  // A project whose public pages need the platform has no runnable claim at all.
  const store=fixture();const p=store.projects[A];
  for(const pg of p.pages){pg.html=pg.html.replace('</body>','<script>fetch("/modules")</script></body>');pg.digest=hex(pg.html);}
  const dynamic=build({store});
  assert.deepEqual(dynamic.manifest.claims.runnable,[]);
  assert.equal(dynamic.manifest.unavailable.find(e=>e.capability==='content-pages').status,'data-only');
  assert.equal(dynamic.manifest.files.some(f=>f.tier==='static'),false);
  // Forged claims are refused by the reader, which re-scans instead of trusting the manifest.
  throws(()=>m.readBundle(repack(dynamic.bytes,mf=>{mf.claims.runnable=['static-site'];mf.unavailable.find(e=>e.capability==='content-pages').status='runnable';for(const f of mf.files)if(f.path.startsWith('site/public/'))f.tier='static';})),'FALSE_RUNNABLE_CLAIM');
  throws(()=>m.readBundle(repack(base.bytes,mf=>{mf.frontends[0].runnable=true;})),'FALSE_RUNNABLE_CLAIM');
  throws(()=>m.readBundle(repack(base.bytes,mf=>{mf.unavailable.find(e=>e.capability==='records').status='runnable';})),'FALSE_RUNNABLE_CLAIM');
  throws(()=>m.readBundle(repack(base.bytes,mf=>{mf.claims.runnable.push('application');})),'FALSE_RUNNABLE_CLAIM');
 });
 await test('unavailable-feature report covers every shared capability',()=>{
  const report=base.manifest.unavailable;
  assert.deepEqual(report.map(e=>e.capability),[...m.capabilities]);
  assert.deepEqual([...m.capabilities],['access','automation','connectors','contact-inbox','content-collections','content-pages','custom-functions','domains','files','forms','maintainer-ai','notifications','records']);
  for(const e of report){
   assert.ok(e.used,`fixture uses ${e.capability}`);assert.ok(e.customerActions.length>0);
   assert.ok(anchors.has(e.migration.split('#')[1]),`docs/portable-exports.md has a migration section for ${e.capability}`);
  }
  assert.equal(report.find(e=>e.capability==='maintainer-ai').status,'unavailable');
  assert.ok(report.filter(e=>e.status==='runnable').map(e=>e.capability).join()==='content-pages');
  const minimal=fixture();const p=minimal.projects[A];
  for(const key of ['instances','programs','frontends','connections','domains','records','moduleFiles'])p[key]=[];delete p.contactInbox;
  p.specification.modules=[{id:'content',version:2}];p.specification.rules=[];p.specificationDigest=hex(m.canonicalJSON(p.specification));
  const lean=build({store:minimal}).manifest.unavailable;
  assert.deepEqual(lean.filter(e=>e.used).map(e=>e.capability),['access','content-pages','maintainer-ai']);
  for(const e of lean.filter(e=>!e.used)){assert.equal(e.status,'not-used');assert.deepEqual(e.customerActions,[]);}
  for(const capability of m.capabilities)throws(()=>m.readBundle(repack(base.bytes,mf=>{mf.unavailable=mf.unavailable.filter(e=>e.capability!==capability);})),'REPORT_INCOMPLETE');
  throws(()=>m.readBundle(repack(base.bytes,mf=>{mf.unavailable.find(e=>e.capability==='notifications').customerActions=[];})),'REPORT_INCOMPLETE');
  const text=Buffer.from(new Map(m.unpackEntries(base.bytes)).get('RECONFIGURE.txt')).toString();
  for(const r of base.manifest.reconfigure)assert.ok(text.includes(`${r.capability} / ${r.setting}`));
  assert.deepEqual(base.manifest.reconfigure.map(r=>r.capability),['access','connectors','content-pages','domains','forms','notifications']);
 });
 await test('version and format refusals: unknown and stale versions are rejected, no legacy decoder',()=>{
  assert.equal(m.readBundle(base.bytes,{expectedSha256:base.sha256}).manifest.formatVersion,1);
  for(const v of [0,2,'1',null])throws(()=>m.readBundle(repack(base.bytes,mf=>{mf.formatVersion=v;})),'UNSUPPORTED_FORMAT_VERSION');
  throws(()=>m.readBundle(repack(base.bytes,mf=>{mf.format='whumpo-static-site';})),'UNSUPPORTED_FORMAT');
  throws(()=>m.readBundle(repack(base.bytes,mf=>{mf.filter='portable-filter@0';})),'UNSUPPORTED_FORMAT_VERSION');
  throws(()=>m.readBundle(repack(base.bytes,mf=>{mf.compatibility={readVersions:[0]};})),'UNKNOWN_FIELD');
  throws(()=>m.readBundle(repack(base.bytes,mf=>{mf.versions.datasetFormats[0].schemaVersion=2;})),'UNSUPPORTED_DATASET_FORMAT');
  throws(()=>m.readBundle(repack(base.bytes,(mf,e)=>{const p='data/access/visitors/roles.json';const d=JSON.parse(Buffer.from(e.get(p)).toString());d.schemaVersion=0;e.set(p,Buffer.from(m.canonicalJSON(d)));})),'UNSUPPORTED_DATASET_FORMAT');
  throws(()=>m.readBundle(repack(base.bytes,mf=>{mf.versions.compiler.version='latest';})),'INVALID_MANIFEST');
  assert.deepEqual(Object.keys(m).filter(k=>/legacy|migrat|upgrade|downgrade|compat/i.test(k)),[]);
 });
 await test('tamper detection',()=>{
  const flipped=Buffer.from(base.bytes);const at=Buffer.from(base.bytes).indexOf('Shine Mobile Detailing</h1>');flipped[at]^=1;
  throws(()=>m.readBundle(flipped),'ARCHIVE_CORRUPT');
  const entries=m.unpackEntries(base.bytes);
  const swap=(path,data)=>m.packEntries(entries.map(([p,d])=>[p,p===path?data:d]));
  throws(()=>m.readBundle(swap('site/public/index.html',Buffer.from('<h1>changed</h1>'))),'CHECKSUM_MISMATCH');
  throws(()=>m.readBundle(m.packEntries([...entries,['zz-extra.txt',Buffer.from('x')]])),'UNLISTED_FILE');
  throws(()=>m.readBundle(m.packEntries(entries.filter(([p])=>p!=='data/directory.json'))),'MISSING_FILE');
  throws(()=>m.readBundle(m.packEntries([...entries,['../escape.txt',Buffer.from('x')]])),'UNSAFE_PATH');
  throws(()=>m.readBundle(m.packEntries([...entries,['site/public//x.html',Buffer.from('x')]])),'UNSAFE_PATH');
  throws(()=>m.readBundle(m.packEntries([...entries,entries[3]])),'DUPLICATE_PATH');
  throws(()=>m.readBundle(m.packEntries([...entries.slice(1),entries[0]])),'INVALID_MANIFEST');
  const restamped=Buffer.from(base.bytes);restamped.writeUInt16LE(0x5000,10);
  throws(()=>m.readBundle(restamped),'NONCANONICAL_ARCHIVE');
  const consistent=repack(base.bytes,(mf,e)=>{e.set('site/public/index.html',Buffer.from(page('Changed','<p>changed</p>')));});
  assert.equal(m.readBundle(consistent).manifest.project.projectId,A,'a consistent rewrite passes local checks');
  throws(()=>m.readBundle(consistent,{expectedSha256:base.sha256}),'ARCHIVE_DIGEST_MISMATCH');
  const zip=Buffer.from(base.bytes);const end=zip.length-22;const cdOffset=zip.readUInt32LE(end+16);zip.writeUInt16LE(0x0808,cdOffset+8);
  throws(()=>m.readBundle(zip),'ARCHIVE_CORRUPT');
  throws(()=>m.readBundle(Buffer.concat([Buffer.from(base.bytes),Buffer.from('trailing')])),'ARCHIVE_CORRUPT');
 });
 await test('clean-environment boot handler serves only the verified static claim',()=>{
  const bundle=m.readBundle(base.bytes,{expectedSha256:base.sha256});
  const handle=m.createStaticHandler(bundle);
  const source=fixture().projects[A];
  for(const [url,expected] of [['/',source.pages[0].html],['/index.html',source.pages[0].html],['/services/',source.pages[1].html],['/assets/ph-1.jpg',source.photos['ph-1'].bytes]]){
   const r=handle('GET',url);assert.equal(r.status,200,url);assert.ok(Buffer.from(r.body).equals(Buffer.from(expected)),url);
   assert.equal(r.headers['content-security-policy'],headers['content-security-policy'],url);assert.equal(r.headers['x-content-type-options'],'nosniff');
  }
  assert.equal(handle('GET','/assets/ph-1.jpg').headers['content-type'],'image/jpeg');
  for(const url of ['/api/v1/projects','/modules','/_headers','/manifest.json','/data/directory.json','/team/','/frontend/booking/index.html','/../manifest.json','/source/line-total/program.js'])assert.equal(handle('GET',url).status,404,url);
  assert.equal(handle('POST','/').status,405);assert.equal(handle('HEAD','/').body.length,0);
  const store=fixture();for(const pg of store.projects[A].pages){pg.html=pg.html.replace('</body>','<script>fetch("/modules")</script></body>');pg.digest=hex(pg.html);}
  throws(()=>m.createStaticHandler(m.readBundle(build({store}).bytes)),'NO_RUNNABLE_CLAIM');
 });
 await test('restored data, assets and versions match the source and documented exclusions',()=>{
  const {manifest,contents}=m.readBundle(withVisitors.bytes,{expectedSha256:withVisitors.sha256});
  const source=fixture().projects[A];
  assert.deepEqual(manifest.versions.compiler,source.compiler);
  assert.deepEqual(manifest.versions.modules.map(x=>[x.localId,x.module,x.schema,x.configRevision]),[...source.instances].sort((a,b)=>a.localId<b.localId?-1:1).map(i=>[i.localId,i.module,i.schema,i.configRevision]));
  assert.deepEqual(JSON.parse(Buffer.from(contents.get('specification/specification.json')).toString()),source.specification);
  assert.equal(hex(contents.get('specification/specification.json')),source.specificationDigest);
  assert.ok(Buffer.from(contents.get('data/media/ph-2.jpg')).equals(Buffer.from(source.photos['ph-2'].bytes)));
  assert.ok(Buffer.from(contents.get('source/line-total/program.js')).equals(Buffer.from(source.programs[0].source)));
  const dir=JSON.parse(Buffer.from(contents.get('data/directory.json')).toString());assert.deepEqual(dir.listings.map(l=>l.id),['l-1','l-2']);
  const files=JSON.parse(Buffer.from(contents.get('data/files/uploads/vehicle-photos.json')).toString());
  assert.deepEqual(files.files.map(f=>[f.id,f.sha256]),[['f-1',source.moduleFiles[0].digest]]);
  assert.deepEqual(manifest.exclusions.map(e=>e.category),['contact-inbox-separate-export','credentials-and-sessions','not-cleared','staff-page-not-served']);
  for(const category of manifest.exclusions.map(e=>e.category))assert.ok(contractDoc.includes(`\`${category}\``),`docs/portable-exports.md documents ${category}`);
 });
 return count;
}

let total=await suite(reference);
const suiteCount=total;

// ---------- Clean-environment boot: the bundle alone, a fresh process, no network, no credentials, no model ----------
function bootChild(dir,zip,expected){
 const child=spawn(process.execPath,['--permission',`--allow-fs-read=${dir}`,`--allow-fs-read=${prototypePath}`,prototypePath,'boot',zip,expected],{env:{},cwd:dir,stdio:['pipe','pipe','pipe']});
 const lines=[];let buffer='',stderr='';
 const waiters=[];
 child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
 child.stderr.on('data',d=>{stderr+=d;});
 child.stdout.on('data',d=>{buffer+=d;let i;while((i=buffer.indexOf('\n'))>=0){lines.push(JSON.parse(buffer.slice(0,i)));buffer=buffer.slice(i+1);waiters.splice(0).forEach(w=>w());}});
 const next=()=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error(`boot timeout ${stderr}`)),10000);
  const take=()=>{if(lines.length){clearTimeout(timer);resolve(lines.shift());}else waiters.push(take);};
  child.once('exit',code=>{if(!lines.length){clearTimeout(timer);reject(new Error(`boot exited ${code}: ${stderr}`));}});
  take();
 });
 const exited=new Promise(resolve=>child.once('exit',code=>resolve(code)));
 return {child,next,exited};
}
const get=(port,path,method='GET')=>new Promise((resolve,reject)=>{
 const req=request({host:'127.0.0.1',port,path,method,agent:false},res=>{const parts=[];res.on('data',c=>parts.push(c));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(parts)}));});
 req.on('error',reject);req.end();
});
const dir=mkdtempSync(join(tmpdir(),'whumpo-portable-boot-'));
try{
 await (async()=>{
  // Three fresh processes start together, each able to read only its own directory holding one bundle.
  const built=reference.buildExport(fixture(),{actor:owner(),projectId:A,scope:{visitorData:true},cutoff:CUTOFF});
  const tampered=Buffer.from(built.bytes);tampered[tampered.indexOf('Services</h1>')]^=1;
  const store=fixture();for(const pg of store.projects[A].pages){pg.html=pg.html.replace('</body>','<script>fetch("/modules")</script></body>');pg.digest=hex(pg.html);}
  const dynamic=reference.buildExport(store,{actor:owner(),projectId:A,scope:{visitorData:false},cutoff:CUTOFF});
  const start=(name,bytes,expected)=>{const own=join(dir,name);mkdirSync(own);const zip=join(own,'export.zip');writeFileSync(zip,bytes);return bootChild(own,zip,expected);};
  const boot=start('runnable',built.bytes,built.sha256),refusedTamper=start('tampered',tampered,built.sha256),refusedDynamic=start('dynamic',dynamic.bytes,dynamic.sha256);
  const ready=await boot.next();
  try{
   assert.equal(ready.ready,true,JSON.stringify(ready));
   assert.deepEqual(ready.selfTest,{network:'fired',socket:'fired',filesystem:'fired',childProcess:'denied',fsWrite:'denied',environment:0});
   const statics=built.manifest.files.filter(f=>f.tier==='static'&&f.path!=='site/public/_headers');
   assert.ok(statics.length>=3);
   for(const f of statics){
    const r=await get(ready.port,'/'+f.path.slice('site/public/'.length));
    assert.equal(r.status,200,f.path);assert.equal(hex(r.body),f.sha256,f.path);
    assert.equal(r.headers['content-security-policy'],headers['content-security-policy']);
   }
   assert.equal((await get(ready.port,'/')).status,200);
   for(const path of ['/api/v1/me','/modules','/manifest.json','/data/records/appointments/appointment.json'])assert.equal((await get(ready.port,path)).status,404,path);
   assert.equal((await get(ready.port,'/','POST')).status,405);
  }finally{boot.child.stdin.write('stop\n');}
  const stopped=await boot.next();
  assert.deepEqual(stopped,{stopped:true,outboundAttempts:0});
  assert.equal(await boot.exited,0);
  total++;
  // The same clean entry point refuses a tampered bundle and a bundle with no runnable claim.
  assert.equal((await refusedTamper.next()).refused,'ARCHIVE_DIGEST_MISMATCH');assert.equal(await refusedTamper.exited,3);
  assert.equal((await refusedDynamic.next()).refused,'NO_RUNNABLE_CLAIM');assert.equal(await refusedDynamic.exited,3);
  total++;
 })().catch(error=>{throw new Error('clean-environment boot',{cause:error});});
}finally{rmSync(dir,{recursive:true,force:true});}

// ---------- Static checks ----------
assert.deepEqual([...prototypeSource.matchAll(/^import .* from '([^']+)';$/gm)].map(m=>m[1]).filter(s=>!s.startsWith('node:')),[],'prototype imports builtins only');
assert.equal(/\bDate\.now\(|Math\.random\(|new Date\(\)/.test(prototypeSource),false,'no clock or randomness in the reference');
total++;

// ---------- Mutation check: each deliberately broken reference must fail the suite, at the named check ----------
const mutants=[
 ['unsorted archive entries',"...[...files.entries()].sort(([a],[b])=>byPath(a,b)).map(([path,f])=>[path,f.bytes])]","...[...files.entries()].reverse().map(([path,f])=>[path,f.bytes])]"],
 ['archive timestamp not fixed','const DOS_TIME=0,DOS_DATE=0x21','const DOS_TIME=0,DOS_DATE=0x21+(globalThis.process?.hrtime?1<<9:0)'],
 ['object keys not canonicalised','for(const key of Object.keys(value).sort(byPath))out[key]','for(const key of Object.keys(value))out[key]'],
 ['owner not checked',"check(project&&project.ownerId===actor.ownerId,'FORBIDDEN','project');","check(project,'FORBIDDEN','project');"],
 ['foreign rows accepted','const owned=item=>item&&item.projectId===projectId;','const owned=item=>!!item;'],
 ['unapproved media exported',"const cleared=item=>item.approval==='approved'&&!item.hold;","const cleared=item=>!item.hold;"],
 ['held media exported',"const cleared=item=>item.approval==='approved'&&!item.hold;","const cleared=item=>item.approval==='approved';"],
 ['hold disclosed in exclusions','else exclusion(exclusions,notCleared);',"else exclusion(exclusions,photo.hold?'held-by-safety':notCleared);"],
 ['staff page served',"if(page.audience!=='public'){","if(false){"],
 ['expired records exported','if(Date.parse(cutoff)-Date.parse(r.createdAt)>instance.config.retentionDays*86400000)continue;',''],
 ['uncleared source exported','if(!owned(program)||!program.cleared||','if(!owned(program)||'],
 ['visitor scope ignored',"used.add('records');if(instance.config.forms?.length)used.add('forms');\n   if(!scope.visitorData)","used.add('records');if(instance.config.forms?.length)used.add('forms');\n   if(false)"],
 ['credential keys allowed','if(credentialKey.test(key))return `.${key}`;',''],
 ['tier scan disabled','return {runnable:list.length===0,requires:list};','return {runnable:true,requires:list};'],
 ['reader trusts the runnable claim',"check(verdict.runnable,'FALSE_RUNNABLE_CLAIM',verdict.requires.join(','));",''],
 ['capability status not checked',"check(capabilityCatalog[entry.capability].allowed.includes(entry.status),'FALSE_RUNNABLE_CLAIM',`${entry.capability}=${entry.status}`);",''],
 ['report completeness not checked',"check(listed.length===capabilities.length&&capabilities.every((c,i)=>listed[i]===c),'REPORT_INCOMPLETE',listed.join(','));",''],
 ['newer format accepted',"check(manifest.formatVersion===bundleFormatVersion,","check(manifest.formatVersion>=bundleFormatVersion,"],
 ['older format accepted (legacy decoder)',"check(manifest.formatVersion===bundleFormatVersion,","check(manifest.formatVersion<=bundleFormatVersion,"],
 ['unknown fields accepted',"for(const key of Object.keys(value))check(keys.includes(key),'UNKNOWN_FIELD',`${label}.${key}`);",''],
 ['dataset version not checked',"check(datasetFormats[doc.format]===doc.schemaVersion,'UNSUPPORTED_DATASET_FORMAT',`${f.path} ${doc.format}@${doc.schemaVersion}`);",''],
 ['file checksum not checked',"check(data.length===f.bytes&&sha256(data)===f.sha256,'CHECKSUM_MISMATCH',f.path);",''],
 ['unlisted files accepted',"for(const path of contents.keys())check(listed.has(path),'UNLISTED_FILE',path);",''],
 ['unsafe paths accepted',"check(safePath.test(path)&&!path.split('/').includes('..'),'UNSAFE_PATH',path);",''],
 ['noncanonical archive accepted',"check(Buffer.from(packEntries(entries)).equals(bytes),'NONCANONICAL_ARCHIVE');",''],
 ['archive digest not checked',"if(expectedSha256!==undefined)check(sha256(input)===expectedSha256,'ARCHIVE_DIGEST_MISMATCH');",''],
 ['loader serves unlisted bundle files','const file=routes.get(path);',"const file=routes.get(path)??(contents.has(path.slice(1))?path.slice(1):undefined);"],
 ['loader drops security headers',"'content-length':String(body.length),...headers}","'content-length':String(body.length)}"],
];
const killedBy={
 'unsorted archive entries':'deterministic bundle','archive timestamp not fixed':'deterministic bundle','object keys not canonicalised':'deterministic bundle',
 'owner not checked':'other tenant','foreign rows accepted':'other tenant',
 'unapproved media exported':'private, unapproved and held','held media exported':'private, unapproved and held','staff page served':'private, unapproved and held',
 'expired records exported':'private, unapproved and held','uncleared source exported':'private, unapproved and held',
 'hold disclosed in exclusions':'hold non-disclosure','visitor scope ignored':'visitor datasets need separate approval','credential keys allowed':'platform secrets and credentials',
 'tier scan disabled':'tier labelling','reader trusts the runnable claim':'tier labelling','capability status not checked':'tier labelling',
 'report completeness not checked':'unavailable-feature report',
 'newer format accepted':'version and format refusals','older format accepted (legacy decoder)':'version and format refusals','unknown fields accepted':'version and format refusals','dataset version not checked':'version and format refusals',
 'file checksum not checked':'tamper detection','unlisted files accepted':'tamper detection','unsafe paths accepted':'tamper detection','noncanonical archive accepted':'tamper detection','archive digest not checked':'tamper detection',
 'loader serves unlisted bundle files':'clean-environment boot handler','loader drops security headers':'clean-environment boot handler',
};
let killed=0;
for(const [name,find,replace] of mutants){
 assert.equal(prototypeSource.split(find).length,2,`mutant "${name}" must match the reference exactly once`);
 const mutant=await import('data:text/javascript;base64,'+Buffer.from(prototypeSource.replace(find,()=>replace)).toString('base64'));
 await assert.rejects(suite(mutant),e=>{
  if(process.argv.includes('--explain'))console.log(`${name} => ${e.message}: ${e.cause?.message?.split('\n')[0]}`);
  assert.ok(killedBy[name]&&e.message.startsWith(killedBy[name]),`mutant "${name}" was caught by an unexpected check: ${e.message} (${e.cause?.message})`);return true;
 },`mutant survived: ${name}`);killed++;
}
assert.equal(killed,mutants.length);
console.log(`portable-export-contract: ${suiteCount} reference checks, 2 clean-environment boot checks and 1 static check passed; ${killed}/${mutants.length} mutants caught (synthetic data; no database, provider, credential, network destination or model).`);
