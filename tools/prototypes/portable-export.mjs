// WH-077 / WH-186 offline reference for the portable project export contract (docs/portable-exports.md).
// Builtins only: no Worker, src/ or package imports. Not imported by the product. It proves the frozen
// bundle format, permission filter, tier labelling, unavailable-feature report, strict reader and a
// static clean-environment boot over synthetic stores. It is not the D1/R2 builder (WH-187), the
// standalone runtime (WH-188) or clean-room acceptance (WH-189).
import {createHash} from 'node:crypto';
import {crc32} from 'node:zlib';
import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import {syncBuiltinESMExports} from 'node:module';
import net from 'node:net';
import tls from 'node:tls';
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';

export const bundleFormat='whumpo-portable-export';
export const bundleFormatVersion=1;
export const filterPolicy='portable-filter@1';
export const bounds=Object.freeze({entries:4096,archiveBytes:64*1024*1024,fileBytes:2*1024*1024,pathBytes:200});

// Closed dataset formats a v1 bundle may carry. Each is the current version of an existing or bundle-local
// serializer; there is no list of accepted older versions.
export const datasetFormats=Object.freeze({
 'whumpo-module-records':1,'whumpo-portable-files':1,'whumpo-access-roles':1,'whumpo-directory':1,'whumpo-backend-source':1,
});

// Shared capabilities and what v1 can honestly claim for each. `runnable` is allowed only where a supported
// standalone path exists today (static public pages). Everything else is data-only or unavailable.
export const capabilityCatalog=Object.freeze({
 'content-pages':{allowed:['runnable','data-only','not-used'],cost:'customer-provider',migration:'static-pages',
  actions:['Upload site/public to any static host, or serve it with your own Cloudflare account (Workers static assets).','Recreate the response headers in site/public/_headers on hosts that do not read that file.']},
 'content-collections':{allowed:['data-only','not-used'],cost:'none',migration:'content-collections',
  actions:['Import data/directory.json into your own site or spreadsheet; no directory renderer is included in v1.']},
 records:{allowed:['data-only','not-used'],cost:'customer-provider',migration:'records-and-forms',
  actions:['Choose your own database (for example SQLite) and import the records JSON; Whumpo record views and staff updates do not run outside Whumpo.']},
 forms:{allowed:['unavailable','not-used'],cost:'customer-provider',migration:'records-and-forms',
  actions:['Replace public intake with your own form handler, bot protection and storage.']},
 files:{allowed:['data-only','not-used'],cost:'customer-provider',migration:'files-and-galleries',
  actions:['Store the exported JPEG files with any object storage or file host; access policy must be rebuilt.']},
 access:{allowed:['unavailable','not-used'],cost:'customer-provider',migration:'visitor-access-and-staff-roles',
  actions:['Visitors and staff must enroll again at the new domain; passkeys are bound to the original domain and cannot be exported.']},
 notifications:{allowed:['unavailable','not-used'],cost:'customer-provider',migration:'notifications',
  actions:['Configure your own email provider and sender-domain DNS; Whumpo sending is not portable.']},
 connectors:{allowed:['unavailable','not-used'],cost:'customer-provider',migration:'connectors',
  actions:['Reauthorize each provider under your own account; Whumpo tokens are never exported and are revoked separately.']},
 'custom-functions':{allowed:['data-only','not-used'],cost:'customer-provider',migration:'custom-functions',
  actions:['The reviewed program source is included; running it needs your own QuickJS host and input/output wiring.']},
 'contact-inbox':{allowed:['unavailable','not-used'],cost:'customer-provider',migration:'contact-inbox',
  actions:['Export inbox messages from the contact inbox separately; replace intake with your own form handler.']},
 domains:{allowed:['unavailable','not-used'],cost:'customer-provider',migration:'domains-and-dns',
  actions:['Point your domain DNS at the new host yourself; Whumpo does not change DNS for an export.']},
 automation:{allowed:['unavailable','not-used'],cost:'customer-provider',migration:'automation-rules',
  actions:['Rebuild rules with your own scheduler or workflow tool; rule configuration remains in the specification.']},
 'maintainer-ai':{allowed:['unavailable'],cost:'none',migration:'maintainer-ai',
  actions:['None required: the exported subset runs without the Whumpo maintainer. Chat history is part of the separate account export.']},
});
export const capabilities=Object.freeze(Object.keys(capabilityCatalog).sort());

const reconfigureCatalog=Object.freeze({
 'content-pages':[['response-headers','Apply the security headers listed in site/public/_headers on your host.']],
 forms:[['bot-protection-secret','Create your own bot-protection site key and secret at your provider; Whumpo\'s Turnstile secret is never exported.']],
 access:[['visitor-passkeys','Invite visitors and staff to enroll new passkeys on the new domain.']],
 notifications:[['email-provider-credentials','Create sending credentials and SPF/DKIM records with your own email provider.']],
 connectors:[['provider-authorization','Authorize GitHub, Cloudflare or other providers again under your own account.']],
 domains:[['dns-records','Change DNS records at your DNS provider to point at the new host.']],
});

const fail=(code,detail='')=>{const e=new Error(`${code}${detail?`: ${detail}`:''}`);e.code=code;throw e;};
const check=(condition,code,detail)=>{if(!condition)fail(code,detail);};
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
export const sha256=bytes=>createHash('sha256').update(bytes).digest('hex');
const bytesOf=value=>typeof value==='string'?encoder.encode(value):value;
// UTF-16 code-unit order (JavaScript's default sort). Bundle paths are ASCII, where this equals byte order.
const byPath=(a,b)=>a<b?-1:a>b?1:0;
const byId=(a,b)=>byPath(a.id,b.id);

export function canonical(value){
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object'){
  const out={};
  for(const key of Object.keys(value).sort(byPath))out[key]=canonical(value[key]);
  return out;
 }
 return value;
}
export const canonicalJSON=value=>JSON.stringify(canonical(value),null,2)+'\n';

// Credential-shaped structural keys never enter a bundle. Customer-defined record field keys live under
// `values` and are customer data, so they are exempt from this structural check.
const credentialKey=/token|secret|password|passkey|credential|api.?key|private.?key|recovery|session|cookie|verifier|ciphertext/i;
function credentialPath(value){
 if(!value||typeof value!=='object')return null;
 if(Array.isArray(value)){for(let i=0;i<value.length;i++){const found=credentialPath(value[i]);if(found!==null)return `[${i}]${found}`;}return null;}
 for(const key in value){
  if(credentialKey.test(key))return `.${key}`;
  if(key!=='values'){const found=credentialPath(value[key]);if(found!==null)return `.${key}${found}`;}
 }
 return null;
}
export function assertNoCredentialKeys(value){
 const found=credentialPath(value);
 check(found===null,'SECRET_FIELD',`$${found}`);
}

// ---------- Tier labelling ----------
// A frontend is runnable only when nothing in it needs a network call, a script or a Whumpo route.
const privateMarkers=[
 ['script',/<script\b/i],
 ['dynamic-network',/\bfetch\s*\(|XMLHttpRequest|sendBeacon|new\s+WebSocket|EventSource/],
 ['whumpo-origin',/[a-z0-9-]*\.?whumpo\.(?:site|com|app|dev)\b/i],
 ['platform-route',/["'`(=\s]\/(?:api|modules|backend|app|workspace)(?:[/?"'`)\s]|$)/m],
 ['form-post',/<form\b[^>]*\baction\s*=/i],
 ['form-endpoint',/data-endpoint\s*=/i],
];
export function classifyFrontend(files){
 const requires=new Set();
 for(const [path,content] of Object.entries(files)){
  if(!/\.(?:html|css|js|txt|svg)$/.test(path)&&!path.endsWith('_headers'))continue;
  const text=typeof content==='string'?content:decoder.decode(content);
  for(const [marker,pattern] of privateMarkers)if(pattern.test(text))requires.add(marker);
 }
 const list=[...requires].sort();
 return {runnable:list.length===0,requires:list};
}

// ---------- Permission filter and bundle builder ----------
function exclusion(map,category,n=1){map.set(category,n===null?null:(map.get(category)??0)+n);}
// Every clearance failure uses one generic category so a bundle never reveals a preservation/safety hold.
const notCleared='not-cleared';
const cleared=item=>item.approval==='approved'&&!item.hold;
const jpeg=bytes=>bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;

export function buildExport(store,{actor,projectId,scope={visitorData:false},cutoff}){
 check(actor&&actor.kind==='owner'&&typeof actor.ownerId==='string','FORBIDDEN','only the verified owner can export');
 const project=store.projects?.[projectId];
 check(project&&project.ownerId===actor.ownerId,'FORBIDDEN','project');
 check(typeof cutoff==='string'&&!Number.isNaN(Date.parse(cutoff))&&new Date(cutoff).toISOString()===cutoff,'INVALID_CUTOFF');
 check(scope&&Object.keys(scope).every(k=>k==='visitorData')&&typeof scope.visitorData==='boolean','INVALID_SCOPE');
 const owned=item=>item&&item.projectId===projectId;
 const files=new Map(),exclusions=new Map();
 const put=(path,content,tier,classId)=>{check(!files.has(path),'DUPLICATE_PATH',path);files.set(path,{bytes:bytesOf(content),tier,classId});};
 const putJSON=(path,value,tier,classId)=>{assertNoCredentialKeys(value);put(path,canonicalJSON(value),tier,classId);};

 // Specification and exact versions. The specification is owner configuration; it carries no credential.
 assertNoCredentialKeys(project.specification);
 const specText=canonicalJSON(project.specification);
 check(sha256(specText)===project.specificationDigest,'UNAVAILABLE','specification digest');
 put('specification/specification.json',specText,'specification','project-configurations');

 // Static tier: public pages only, every dependency cleared and owned.
 const used=new Set(),photos=project.photos??{};
 const pageFiles={},staticPhotos=new Set();
 let staticPages=0;
 for(const page of [...(project.pages??[])].sort(byId)){
  used.add('content-pages');
  check(/^\/(?:[a-z][a-z0-9-]{0,39})?$/.test(page.path),'INVALID_PATH',page.path);
  if(page.audience!=='public'){exclusion(exclusions,'staff-page-not-served');used.add('access');continue;}
  if(sha256(page.html)!==page.digest){exclusion(exclusions,notCleared);continue;}
  const refs=page.photos??[];
  if(!refs.every(id=>owned(photos[id])&&cleared(photos[id])&&sha256(photos[id].bytes)===photos[id].digest&&jpeg(photos[id].bytes))){exclusion(exclusions,notCleared);continue;}
  const rel=page.path==='/'?'index.html':`${page.path.slice(1)}/index.html`;
  pageFiles[`site/public/${rel}`]=page.html;
  for(const id of refs)staticPhotos.add(id);
  staticPages++;
 }
 const staticCheck=classifyFrontend(pageFiles);
 const runnable=staticPages>0&&staticCheck.runnable;
 for(const [path,html] of Object.entries(pageFiles))put(path,html,runnable?'static':'source','site-versions');
 if(staticPages>0)put('site/public/_headers',headersFile(project.headers),runnable?'static':'source','site-versions');
 for(const id of [...staticPhotos].sort(byPath))put(`site/public/assets/${id}.jpg`,photos[id].bytes,runnable?'static':'source','project-media');
 for(const [id,photo] of Object.entries(photos).sort(([a],[b])=>byPath(a,b))){
  if(staticPhotos.has(id))continue;
  if(!owned(photo))continue; // another tenant's object is never even counted
  if(cleared(photo)&&sha256(photo.bytes)===photo.digest&&jpeg(photo.bytes))put(`data/media/${id}.jpg`,photo.bytes,'data','project-media');
  else exclusion(exclusions,notCleared);
 }

 // Frontend compositions are customer source; they are never runnable while they need Whumpo APIs.
 const frontendRequires={};
 for(const frontend of [...(project.frontends??[])].sort(byId)){
  const verdict=classifyFrontend(frontend.files);
  frontendRequires[frontend.id]=verdict.requires;
  for(const [rel,content] of Object.entries(frontend.files).sort(([a],[b])=>byPath(a,b)))put(`frontend/${frontend.id}/${rel}`,content,'source','project-configurations');
 }

 // Module instances and datasets.
 const instances=[...(project.instances??[])].sort((a,b)=>byPath(a.localId,b.localId));
 const modules=[];
 const resources={};
 for(const instance of instances){
  modules.push({resourceId:instance.resourceId,localId:instance.localId,kind:instance.kind,module:instance.module,schema:instance.schema,configRevision:instance.configRevision});
  (resources[instance.kind]??=[]).push(instance.resourceId);
  if(instance.kind==='records'){
   used.add('records');if(instance.config.forms?.length)used.add('forms');
   if(!scope.visitorData){exclusion(exclusions,'visitor-dataset-not-requested');continue;}
   for(const schema of [...instance.config.schemas].sort(byId)){
    const rows=(project.records??[]).filter(r=>owned(r)&&r.resourceId===instance.resourceId&&r.schemaId===schema.id);
    const kept=[];
    for(const r of rows){
     if(r.hold){exclusion(exclusions,notCleared);continue;}
     if(Date.parse(cutoff)-Date.parse(r.createdAt)>instance.config.retentionDays*86400000)continue; // expired records are never exported
     kept.push({id:r.id,formId:r.formId,submitter:r.submitter,revision:r.revision,createdAt:r.createdAt,values:r.values});
    }
    kept.sort((a,b)=>byPath(b.createdAt,a.createdAt)||byId(a,b));
    putJSON(`data/records/${instance.localId}/${schema.id}.json`,{format:'whumpo-module-records',schemaVersion:1,project:{id:projectId},
     instance:{resourceId:instance.resourceId,localId:instance.localId,configRevision:instance.configRevision,retentionDays:instance.config.retentionDays},
     schema:{id:schema.id,fields:schema.fields},records:kept,sha256:sha256(canonicalJSON(kept))},'data','module-records');
   }
  }else if(instance.kind==='files'){
   used.add('files');
   if(!scope.visitorData){exclusion(exclusions,'visitor-dataset-not-requested');continue;}
   for(const collection of [...instance.config.collections].sort(byId)){
    const list=[];
    for(const f of (project.moduleFiles??[]).filter(f=>owned(f)&&f.resourceId===instance.resourceId&&f.collectionId===collection.id).sort(byId)){
     if(!cleared(f)||sha256(f.bytes)!==f.digest||!jpeg(f.bytes)){exclusion(exclusions,notCleared);continue;}
     const path=`data/files/${instance.localId}/${collection.id}/${f.id}.jpg`;
     put(path,f.bytes,'data','module-files');
     list.push({id:f.id,path,sha256:f.digest,bytes:f.bytes.length,uploader:f.uploader});
    }
    putJSON(`data/files/${instance.localId}/${collection.id}.json`,{format:'whumpo-portable-files',schemaVersion:1,project:{id:projectId},
     instance:{resourceId:instance.resourceId,localId:instance.localId,configRevision:instance.configRevision},collection:{id:collection.id},files:list},'data','module-files');
   }
  }else if(instance.kind==='access'){
   used.add('access');
   const staff=(project.roles??[]).filter(owned).map(r=>({visitorId:r.visitorId,grantedAt:r.grantedAt,state:r.state})).sort((a,b)=>byPath(a.visitorId,b.visitorId));
   putJSON(`data/access/${instance.localId}/roles.json`,{format:'whumpo-access-roles',schemaVersion:1,project:{id:projectId},
    instance:{resourceId:instance.resourceId,localId:instance.localId,configRevision:instance.configRevision},staff},'data','project-roles');
  }else if(instance.kind==='content'){
   used.add('content-collections');
   const d=project.directory;
   if(d&&owned(d))putJSON('data/directory.json',{format:'whumpo-directory',schemaVersion:1,project:{id:projectId,name:project.name},
    snapshot:{id:d.snapshotId,appliedAt:d.appliedAt},listings:[...d.listings].sort(byId)},'data','directories');
  }
 }

 // Reviewed custom source: cleared programs only, never executed while exporting.
 for(const program of [...(project.programs??[])].sort(byId)){
  used.add('custom-functions');
  if(!owned(program)||!program.cleared||sha256(program.source)!==program.digest){exclusion(exclusions,notCleared);continue;}
  put(`source/${program.id}/program.js`,program.source,'source','backend-artifacts');
  putJSON(`source/${program.id}/program.json`,{format:'whumpo-backend-source',schemaVersion:1,programId:program.id,engine:'quickjs',
   sha256:program.digest,bytes:bytesOf(program.source).length,io:'json'},'source','backend-artifacts');
 }

 // Managed dependencies the bundle cannot carry. Values are never read; only presence is reported.
 if(project.contactInbox)used.add('contact-inbox');
 if(project.connections?.length)used.add('connectors');
 if(project.domains?.length)used.add('domains');
 if(project.specification.modules?.some(m=>m.id==='notifications'))used.add('notifications');
 if(project.specification.rules?.length)used.add('automation');
 used.add('maintainer-ai');
 exclusion(exclusions,'credentials-and-sessions',null); // always excluded; never read, so never counted
 if(project.contactInbox)exclusion(exclusions,'contact-inbox-separate-export');

 const report=capabilities.map(capability=>{
  const entry=capabilityCatalog[capability];
  const isUsed=used.has(capability);
  let status=!isUsed?'not-used':entry.allowed.includes('data-only')?'data-only':'unavailable';
  if(capability==='content-pages'&&isUsed)status=runnable?'runnable':'data-only';
  if(capability==='maintainer-ai')status='unavailable';
  const kind=capability==='content-collections'?'content':capability==='forms'?'records':capability;
  return {capability,used:isUsed,status,resources:[...(resources[kind]??[])].sort(byPath),
   customerActions:isUsed?entry.actions:[],cost:isUsed?entry.cost:'none',migration:`docs/portable-exports.md#${entry.migration}`};
 });
 const reconfigure=[];
 for(const capability of capabilities)if(used.has(capability))for(const [setting,instruction] of reconfigureCatalog[capability]??[])reconfigure.push({capability,setting,instruction});
 putJSON('report/unavailable.json',{format:bundleFormat,formatVersion:bundleFormatVersion,report},'report','projects');
 put('RECONFIGURE.txt',reconfigureText(reconfigure),'report','projects');
 put('README.txt',readmeText(runnable),'report','projects');

 const manifest={
  format:bundleFormat,formatVersion:bundleFormatVersion,filter:filterPolicy,
  project:{projectId,name:project.name},
  snapshot:{cutoff,specificationVersionId:project.specificationVersionId,specificationDigest:project.specificationDigest},
  scope:{visitorData:scope.visitorData},
  versions:{compiler:project.compiler,specificationSchema:project.specification.schemaVersion,
   components:[...(project.components??[])].sort(byId),modules,
   datasetFormats:Object.entries(datasetFormats).map(([format,schemaVersion])=>({format,schemaVersion}))},
  claims:{runnable:runnable?['static-site']:[]},
  frontends:Object.entries(frontendRequires).map(([id,requires])=>({id,runnable:false,requires})),
  files:[...files.entries()].sort(([a],[b])=>byPath(a,b)).map(([path,f])=>({path,sha256:sha256(f.bytes),bytes:f.bytes.length,tier:f.tier,classId:f.classId})),
  exclusions:[...exclusions.entries()].sort(([a],[b])=>byPath(a,b)).map(([category,count])=>({category,count})),
  unavailable:report,
  reconfigure,
 };
 assertNoCredentialKeys(manifest);
 const entries=[['manifest.json',encoder.encode(canonicalJSON(manifest))],...[...files.entries()].sort(([a],[b])=>byPath(a,b)).map(([path,f])=>[path,f.bytes])];
 const bytes=packEntries(entries);
 return {bytes,sha256:sha256(bytes),manifest};
}

function headersFile(headers={}){
 return '/*\n'+Object.keys(headers).sort(byPath).map(key=>`  ${key}: ${headers[key]}`).join('\n')+'\n';
}
function reconfigureText(list){
 return ['Settings to recreate yourself','','No password, key, token, passkey or session is included in this export.',
  'Create each setting below with your own provider before relying on the matching feature.','',
  ...list.map(r=>`- ${r.capability} / ${r.setting}: ${r.instruction}`),''].join('\n');
}
function readmeText(runnable){
 return ['Whumpo portable project export (format '+bundleFormat+' version '+bundleFormatVersion+')','',
  'manifest.json lists every file with its SHA-256 checksum, the exact compiler, component and module versions, what was left out and why.',
  runnable?'site/public is a static website that runs without Whumpo: upload it to any static host.':'This export has no runnable static website.',
  'data/ holds your project data as JSON and JPEG files. It is data, not a running application.',
  'frontend/ and source/ hold your custom source. A frontend listed with requirements in manifest.json still needs Whumpo APIs and is not a runnable application.',
  'report/unavailable.json lists every Whumpo capability, whether it runs outside Whumpo and what you need to do. RECONFIGURE.txt lists settings to recreate.',
  'This export does not publish, move or delete anything in Whumpo and does not transfer a subscription.',''].join('\n');
}

// ---------- Deterministic stored ZIP (no compression, fixed 1980-01-01 timestamp, UTF-8 names) ----------
const DOS_TIME=0,DOS_DATE=0x21,FLAGS=0x0800,VERSION=20;
export function packEntries(entries){
 check(entries.length<=bounds.entries,'BUNDLE_TOO_LARGE','entries');
 const locals=[],central=[];let offset=0;
 for(const [path,content] of entries){
  const name=encoder.encode(path),data=bytesOf(content),crc=crc32(data)>>>0;
  const header=Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50,0);header.writeUInt16LE(VERSION,4);header.writeUInt16LE(FLAGS,6);header.writeUInt16LE(0,8);
  header.writeUInt16LE(DOS_TIME,10);header.writeUInt16LE(DOS_DATE,12);header.writeUInt32LE(crc,14);
  header.writeUInt32LE(data.length,18);header.writeUInt32LE(data.length,22);header.writeUInt16LE(name.length,26);header.writeUInt16LE(0,28);
  const cd=Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50,0);cd.writeUInt16LE(VERSION,4);cd.writeUInt16LE(VERSION,6);cd.writeUInt16LE(FLAGS,8);cd.writeUInt16LE(0,10);
  cd.writeUInt16LE(DOS_TIME,12);cd.writeUInt16LE(DOS_DATE,14);cd.writeUInt32LE(crc,16);cd.writeUInt32LE(data.length,20);cd.writeUInt32LE(data.length,24);
  cd.writeUInt16LE(name.length,28);cd.writeUInt32LE(offset,42);
  locals.push(header,name,data);central.push(cd,name);
  offset+=30+name.length+data.length;
 }
 const cdBytes=Buffer.concat(central),end=Buffer.alloc(22);
 end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(entries.length,8);end.writeUInt16LE(entries.length,10);
 end.writeUInt32LE(cdBytes.length,12);end.writeUInt32LE(offset,16);
 const out=new Uint8Array(Buffer.concat([...locals,cdBytes,end]));
 check(out.length<=bounds.archiveBytes,'BUNDLE_TOO_LARGE','bytes');
 return out;
}

const safePath=/^[A-Za-z0-9][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$/;
export function unpackEntries(input){
 const bytes=Buffer.from(input);
 check(bytes.length>=22&&bytes.length<=bounds.archiveBytes,'ARCHIVE_CORRUPT','size');
 const end=bytes.length-22;
 check(bytes.readUInt32LE(end)===0x06054b50&&bytes.readUInt16LE(end+20)===0,'ARCHIVE_CORRUPT','end record');
 const count=bytes.readUInt16LE(end+10),cdSize=bytes.readUInt32LE(end+12),cdOffset=bytes.readUInt32LE(end+16);
 check(count<=bounds.entries&&bytes.readUInt16LE(end+8)===count&&cdOffset+cdSize===end,'ARCHIVE_CORRUPT','directory');
 const entries=[],seen=new Set();let p=cdOffset,expectedLocal=0;
 for(let i=0;i<count;i++){
  check(p+46<=end&&bytes.readUInt32LE(p)===0x02014b50,'ARCHIVE_CORRUPT','central header');
  const flags=bytes.readUInt16LE(p+8),method=bytes.readUInt16LE(p+10),crc=bytes.readUInt32LE(p+16),size=bytes.readUInt32LE(p+20);
  const usize=bytes.readUInt32LE(p+24),nameLength=bytes.readUInt16LE(p+28),extra=bytes.readUInt16LE(p+30),comment=bytes.readUInt16LE(p+32),local=bytes.readUInt32LE(p+42);
  check(method===0&&flags===FLAGS&&size===usize&&extra===0&&comment===0,'ARCHIVE_CORRUPT','entry encoding');
  check(nameLength>0&&nameLength<=bounds.pathBytes,'UNSAFE_PATH','length');
  const path=decoder.decode(bytes.subarray(p+46,p+46+nameLength));
  check(safePath.test(path)&&!path.split('/').includes('..'),'UNSAFE_PATH',path);
  check(!seen.has(path),'DUPLICATE_PATH',path);seen.add(path);
  check(local===expectedLocal&&bytes.readUInt32LE(local)===0x04034b50,'ARCHIVE_CORRUPT','local offset');
  check(bytes.readUInt16LE(local+26)===nameLength&&bytes.readUInt16LE(local+28)===0&&bytes.subarray(local+30,local+30+nameLength).equals(bytes.subarray(p+46,p+46+nameLength)),'ARCHIVE_CORRUPT','local name');
  check(bytes.readUInt32LE(local+14)===crc&&bytes.readUInt32LE(local+18)===size,'ARCHIVE_CORRUPT','local header');
  check(size<=bounds.fileBytes,'BUNDLE_TOO_LARGE',path);
  const data=new Uint8Array(bytes.subarray(local+30+nameLength,local+30+nameLength+size));
  check((crc32(data)>>>0)===crc,'ARCHIVE_CORRUPT',`crc ${path}`);
  entries.push([path,data]);
  expectedLocal=local+30+nameLength+size;p+=46+nameLength;
 }
 check(expectedLocal===cdOffset&&p===end,'ARCHIVE_CORRUPT','trailing bytes');
 // Canonical packaging: the only accepted encoding is the one this format writes.
 check(Buffer.from(packEntries(entries)).equals(bytes),'NONCANONICAL_ARCHIVE');
 return entries;
}

// ---------- Strict reader (current version only; no legacy decoder) ----------
const manifestKeys=['claims','exclusions','files','filter','format','formatVersion','frontends','project','reconfigure','scope','snapshot','unavailable','versions'];
const closed=(value,keys,label)=>{
 check(value&&typeof value==='object'&&!Array.isArray(value),'INVALID_MANIFEST',label);
 for(const key of Object.keys(value))check(keys.includes(key),'UNKNOWN_FIELD',`${label}.${key}`);
 for(const key of keys)check(Object.hasOwn(value,key),'INVALID_MANIFEST',`${label}.${key}`);
};
const list=(value,label)=>{check(Array.isArray(value),'INVALID_MANIFEST',label);return value;};
const pin=v=>v&&/^[a-z][a-z0-9-]*$/.test(v.name)&&Number.isInteger(v.version)&&v.version>0&&/^[a-f0-9]{64}$/.test(v.digest);

export function validateManifest(manifest){
 check(manifest&&manifest.format===bundleFormat,'UNSUPPORTED_FORMAT',String(manifest?.format));
 check(manifest.formatVersion===bundleFormatVersion,'UNSUPPORTED_FORMAT_VERSION',String(manifest.formatVersion));
 closed(manifest,manifestKeys,'manifest');
 check(manifest.filter===filterPolicy,'UNSUPPORTED_FORMAT_VERSION','filter');
 closed(manifest.project,['name','projectId'],'project');
 closed(manifest.snapshot,['cutoff','specificationDigest','specificationVersionId'],'snapshot');
 closed(manifest.scope,['visitorData'],'scope');
 for(const key of ['exclusions','files','frontends','reconfigure','unavailable'])list(manifest[key],key);
 closed(manifest.versions,['compiler','components','datasetFormats','modules','specificationSchema'],'versions');
 check(pin(manifest.versions.compiler),'INVALID_MANIFEST','compiler pin');
 for(const key of ['components','datasetFormats','modules'])list(manifest.versions[key],`versions.${key}`);
 for(const m of manifest.versions.modules)check(pin(m.module)&&pin(m.schema)&&Number.isInteger(m.configRevision),'INVALID_MANIFEST','module pin');
 for(const d of manifest.versions.datasetFormats)check(datasetFormats[d.format]===d.schemaVersion,'UNSUPPORTED_DATASET_FORMAT',`${d.format}@${d.schemaVersion}`);
 closed(manifest.claims,['runnable'],'claims');
 list(manifest.claims.runnable,'claims.runnable');
 for(const claim of manifest.claims.runnable)check(claim==='static-site','FALSE_RUNNABLE_CLAIM',claim);
 for(const f of manifest.frontends)closed(f,['id','requires','runnable'],'frontend');
 for(const f of manifest.frontends)check(f.runnable===false&&f.requires.length>0,'FALSE_RUNNABLE_CLAIM',`frontend ${f.id}`);
 const paths=manifest.files.map(f=>f.path);
 check(paths.every((path,i)=>i===0||byPath(paths[i-1],path)<0),'INVALID_MANIFEST','file order');
 for(const f of manifest.files){
  closed(f,['bytes','classId','path','sha256','tier'],'file');
  check(['static','data','source','specification','report'].includes(f.tier),'INVALID_MANIFEST','tier');
 }
 // Unavailable-feature report: exactly one entry per shared capability, with an allowed status.
 const listed=manifest.unavailable.map(e=>e.capability);
 check(listed.length===capabilities.length&&capabilities.every((c,i)=>listed[i]===c),'REPORT_INCOMPLETE',listed.join(','));
 for(const entry of manifest.unavailable){
  closed(entry,['capability','cost','customerActions','migration','resources','status','used'],'report');
  check(capabilityCatalog[entry.capability].allowed.includes(entry.status),'FALSE_RUNNABLE_CLAIM',`${entry.capability}=${entry.status}`);
  check((entry.status==='not-used')===(entry.used===false),'REPORT_INCOMPLETE',entry.capability);
  check(!entry.used||entry.customerActions.length>0,'REPORT_INCOMPLETE',`${entry.capability} actions`);
  if(entry.status==='runnable')check(manifest.claims.runnable.includes('static-site'),'FALSE_RUNNABLE_CLAIM',entry.capability);
 }
 const pages=manifest.unavailable.find(e=>e.capability==='content-pages');
 if(manifest.claims.runnable.length)check(pages.status==='runnable','FALSE_RUNNABLE_CLAIM','content-pages');
 assertNoCredentialKeys(manifest);
 return true;
}

export function readBundle(input,{expectedSha256}={}){
 if(expectedSha256!==undefined)check(sha256(input)===expectedSha256,'ARCHIVE_DIGEST_MISMATCH');
 const entries=unpackEntries(input);
 check(entries[0]?.[0]==='manifest.json','INVALID_MANIFEST','manifest must be first');
 let manifest;
 try{manifest=JSON.parse(decoder.decode(entries[0][1]));}catch{fail('INVALID_MANIFEST','json');}
 validateManifest(manifest);
 check(decoder.decode(entries[0][1])===canonicalJSON(manifest),'NONCANONICAL_ARCHIVE','manifest');
 const contents=new Map(entries.slice(1));
 const listed=new Set(manifest.files.map(f=>f.path));
 for(const path of contents.keys())check(listed.has(path),'UNLISTED_FILE',path);
 for(const f of manifest.files){
  const data=contents.get(f.path);
  check(data,'MISSING_FILE',f.path);
  check(data.length===f.bytes&&sha256(data)===f.sha256,'CHECKSUM_MISMATCH',f.path);
 }
 // Dataset files must declare a supported current format; no older decoder exists.
 for(const f of manifest.files)if(f.path.endsWith('.json')&&(f.tier==='data'||f.tier==='source')){
  let doc;try{doc=JSON.parse(decoder.decode(contents.get(f.path)));}catch{fail('INVALID_DATASET',f.path);}
  assertNoCredentialKeys(doc);
  check(datasetFormats[doc.format]===doc.schemaVersion,'UNSUPPORTED_DATASET_FORMAT',`${f.path} ${doc.format}@${doc.schemaVersion}`);
 }
 // Never trust the runnable claim: re-run the tier check on every static file.
 const staticFiles=manifest.files.filter(f=>f.tier==='static');
 if(manifest.claims.runnable.includes('static-site')){
  check(contents.has('site/public/index.html')&&manifest.files.find(f=>f.path==='site/public/index.html').tier==='static','FALSE_RUNNABLE_CLAIM','index');
  const verdict=classifyFrontend(Object.fromEntries(staticFiles.map(f=>[f.path,contents.get(f.path)])));
  check(verdict.runnable,'FALSE_RUNNABLE_CLAIM',verdict.requires.join(','));
 }else check(staticFiles.length===0,'FALSE_RUNNABLE_CLAIM','static files without a claim');
 for(const f of staticFiles)check(f.path.startsWith('site/public/'),'FALSE_RUNNABLE_CLAIM',f.path);
 return {manifest,contents};
}

// ---------- Static loader for the claimed portable subset ----------
const mediaTypes={html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',jpg:'image/jpeg',txt:'text/plain; charset=utf-8',json:'application/json'};
function parseHeaders(text){
 const lines=text.split('\n').filter(Boolean);
 check(lines[0]==='/*','UNSUPPORTED_HEADERS_RULE',lines[0]);
 const out={};
 for(const line of lines.slice(1)){
  const m=/^ {2}([a-z0-9-]+): (.+)$/.exec(line);
  check(m,'UNSUPPORTED_HEADERS_RULE',line);
  out[m[1]]=m[2];
 }
 return out;
}
export function createStaticHandler({manifest,contents}){
 check(manifest.claims.runnable.includes('static-site'),'NO_RUNNABLE_CLAIM');
 const routes=new Map();
 for(const f of manifest.files){
  if(f.tier!=='static'||f.path==='site/public/_headers')continue;
  const rel=f.path.slice('site/public/'.length);
  routes.set('/'+rel,f.path);
  if(rel==='index.html')routes.set('/',f.path);
  else if(rel.endsWith('/index.html'))routes.set('/'+rel.slice(0,-'index.html'.length),f.path);
 }
 const headers=contents.has('site/public/_headers')?parseHeaders(decoder.decode(contents.get('site/public/_headers'))):{};
 return function handle(method,url){
  if(method!=='GET'&&method!=='HEAD')return {status:405,headers:{allow:'GET, HEAD',...headers},body:new Uint8Array()};
  const path=String(url).split('?')[0];
  const file=routes.get(path);
  if(!file)return {status:404,headers:{'content-type':'text/plain; charset=utf-8',...headers},body:encoder.encode('Not found\n')};
  const body=contents.get(file);
  return {status:200,headers:{'content-type':mediaTypes[file.split('.').pop()]??'application/octet-stream','content-length':String(body.length),...headers},body:method==='HEAD'?new Uint8Array():body};
 };
}

// Deny every outbound connection in the boot process. Accepted loopback connections to the local server still work.
export function installNetworkGuard(){
 const state={blocked:0};
 const deny=what=>()=>{state.blocked++;const e=new Error(`network disabled: ${what}`);e.code='NETWORK_DISABLED';throw e;};
 globalThis.fetch=deny('fetch');
 globalThis.WebSocket=undefined;
 net.Socket.prototype.connect=deny('socket.connect');
 net.connect=net.createConnection=deny('net.connect');
 tls.connect=deny('tls.connect');
 for(const m of [http,https]){m.request=deny('http.request');m.get=deny('http.get');}
 // Name resolution is denied; an IP literal (the loopback listen address) needs no resolver.
 const lookup=dns.lookup,denyLookup=deny('dns.lookup');
 dns.lookup=(host,...rest)=>net.isIP(host)?lookup(host,...rest):denyLookup();
 for(const key of ['resolve','resolve4','resolve6','resolveAny'])dns[key]=deny(`dns.${key}`);
 for(const key of ['lookup','resolve','resolve4','resolve6','resolveAny'])dns.promises[key]=deny(`dns.promises.${key}`);
 syncBuiltinESMExports();
 return state;
}

// `node --permission --allow-fs-read=<dir> --allow-fs-read=<this file> portable-export.mjs boot <bundle> <sha256>`
// Reads only the bundle, serves the static claim on 127.0.0.1 and refuses every outbound connection.
async function boot([bundlePath,expected]){
 const guard=installNetworkGuard();
 const selfTest={};
 try{await fetch('http://127.0.0.1:9/');selfTest.network='not-enforced';}catch(e){selfTest.network=e.code==='NETWORK_DISABLED'?'fired':e.code;}
 try{net.connect(9,'127.0.0.1');selfTest.socket='not-enforced';}catch(e){selfTest.socket=e.code==='NETWORK_DISABLED'?'fired':e.code;}
 try{readFileSync(new URL('../../package.json',import.meta.url));selfTest.filesystem='not-enforced';}catch(e){selfTest.filesystem=e.code==='ERR_ACCESS_DENIED'?'fired':e.code;}
 selfTest.childProcess=process.permission?.has('child')===false?'denied':'allowed';
 selfTest.fsWrite=process.permission?.has('fs.write')===false?'denied':'allowed';
 selfTest.environment=Object.keys(process.env).length;
 const baseline=guard.blocked;
 let handler;
 try{handler=createStaticHandler(readBundle(readFileSync(bundlePath),{expectedSha256:expected}));}
 catch(e){process.stdout.write(JSON.stringify({refused:e.code??'ERROR',selfTest})+'\n');process.exitCode=3;return;}
 const server=createServer((req,res)=>{const r=handler(req.method,req.url);res.writeHead(r.status,r.headers);res.end(Buffer.from(r.body));});
 server.listen(0,'127.0.0.1',()=>process.stdout.write(JSON.stringify({ready:true,port:server.address().port,selfTest})+'\n'));
 process.stdin.setEncoding('utf8');
 process.stdin.on('data',chunk=>{if(chunk.includes('stop')){server.close();process.stdout.write(JSON.stringify({stopped:true,outboundAttempts:guard.blocked-baseline})+'\n',()=>process.exit(0));}});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href&&process.argv[2]==='boot')await boot(process.argv.slice(3));
