/** WH-187 portable project bundle composer and permission filter (`whumpo-portable-export` v1, `portable-filter@1`),
 * frozen by WH-186 in docs/portable-exports.md. This module is pure: it performs no database, storage, network, clock,
 * random or model access and composes one deterministic stored ZIP from rows the owner route (portable.ts) has already
 * read through the shared per-project section reader (project-sections.ts) and the WH-126-129 serializers.
 *
 * The filter re-checks every row against the requested project (never only the query scope), admits only the frozen
 * allowlist (saved specification, public pages whose saved HTML digest matches and whose every photo is this project's
 * cleared photo, other cleared owner photos, the directory, the staff role list, reviewed and cleared custom source and,
 * only with the separate visitor-data choice, retained module records and cleared module files) and counts every
 * clearance failure under one generic `not-cleared` category, so a hold is indistinguishable from any other uncleared
 * item. Credential-shaped structural keys fail the build (`SECRET_FIELD`). A static page is labelled runnable only when
 * its own re-scan finds no script, network call, Whumpo origin, platform route or form endpoint; custom frontends are
 * never runnable. The reference reader (tools/prototypes/portable-export.mjs) re-checks all of this independently. */
import {jsonDigest} from '../project-specification/v2/json';
import {staticSiteHeaders} from '../static-site-headers';

export const portableFormat='whumpo-portable-export',portableFormatVersion=1,portableFilter='portable-filter@1';
/** Production bounds (WH-187). The frozen reference values are 4,096 entries, 2 MiB per file and 64 MiB per bundle; the
 * Worker builds the bundle in memory (the manifest is the first entry and lists every file), so the archive bound is
 * halved. Above a bound the build fails closed with BUNDLE_TOO_LARGE instead of returning a partial bundle. */
export const portableBounds=Object.freeze({entries:4096,fileBytes:2*1024*1024,archiveBytes:32*1024*1024,pathBytes:200});
export const portableDatasetFormats=Object.freeze({'whumpo-module-records':1,'whumpo-portable-files':1,'whumpo-access-roles':1,'whumpo-directory':1,'whumpo-backend-source':1} as const);

type Status='runnable'|'data-only'|'unavailable'|'not-used';
type CapabilityEntry={allowed:readonly Status[];cost:'none'|'customer-provider';migration:string;actions:readonly string[]};
/** Shared capabilities and what v1 can honestly claim for each (frozen with the reference). */
export const capabilityCatalog:Readonly<Record<string,CapabilityEntry>>=Object.freeze({
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
const capabilities=Object.freeze(Object.keys(capabilityCatalog).sort());
const reconfigureCatalog:Readonly<Record<string,readonly (readonly [string,string])[]>>=Object.freeze({
 'content-pages':[['response-headers','Apply the security headers listed in site/public/_headers on your host.']],
 forms:[['bot-protection-secret','Create your own bot-protection site key and secret at your provider; Whumpo\'s Turnstile secret is never exported.']],
 access:[['visitor-passkeys','Invite visitors and staff to enroll new passkeys on the new domain.']],
 notifications:[['email-provider-credentials','Create sending credentials and SPF/DKIM records with your own email provider.']],
 connectors:[['provider-authorization','Authorize GitHub, Cloudflare or other providers again under your own account.']],
 domains:[['dns-records','Change DNS records at your DNS provider to point at the new host.']],
});

export class PortableBundleError extends Error{
 constructor(readonly code:'FORBIDDEN'|'INVALID_CUTOFF'|'INVALID_SCOPE'|'UNAVAILABLE'|'SECRET_FIELD'|'UNSAFE_PATH'|'DUPLICATE_PATH'|'BUNDLE_TOO_LARGE',detail=''){super(detail?`${code}: ${detail}`:code);this.name='PortableBundleError';}
}
function check(condition:unknown,code:PortableBundleError['code'],detail=''):asserts condition{if(!condition)throw new PortableBundleError(code,detail);}
const encoder=new TextEncoder();
const hex=(bytes:ArrayBuffer)=>[...new Uint8Array(bytes)].map(v=>v.toString(16).padStart(2,'0')).join('');
export const sha256=async(value:Uint8Array|string)=>hex(await crypto.subtle.digest('SHA-256',typeof value==='string'?encoder.encode(value):value));
// UTF-16 code-unit order; bundle paths and identifiers are ASCII, where this equals byte order.
const byPath=(a:string,b:string)=>a<b?-1:a>b?1:0;
const byId=<T extends {id:string}>(a:T,b:T)=>byPath(a.id,b.id);

/** Canonical JSON: object keys sorted, two-space indentation, trailing newline. Arrays keep their defined order. */
function canonical(value:unknown):unknown{
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object'){const out:Record<string,unknown>={};for(const key of Object.keys(value).sort(byPath))out[key]=canonical((value as Record<string,unknown>)[key]);return out;}
 return value;
}
export const canonicalJSON=(value:unknown)=>JSON.stringify(canonical(value),null,2)+'\n';
/** Serializer digests (`recordsSha256`, `rolesSha256`) are SHA-256 over `JSON.stringify` of their list. In a bundle the
 * list is stored canonically (sorted keys), so the digest is recomputed over exactly that form: a reader that parses the
 * file and re-serializes the list (the WH-126/127 import validators) gets the same digest. */
const listDigest=(list:unknown[])=>sha256(JSON.stringify(canonical(list)));

// Credential-shaped structural keys never enter a bundle. Customer-defined record field values live under `values` and are
// customer data, so they are exempt from this structural check.
const credentialKey=/token|secret|password|passkey|credential|api.?key|private.?key|recovery|session|cookie|verifier|ciphertext/i;
function credentialPath(value:unknown):string|null{
 if(!value||typeof value!=='object')return null;
 if(Array.isArray(value)){for(let i=0;i<value.length;i++){const found=credentialPath(value[i]);if(found!==null)return `[${i}]${found}`;}return null;}
 for(const key of Object.keys(value)){
  if(credentialKey.test(key))return `.${key}`;
  if(key!=='values'){const found=credentialPath((value as Record<string,unknown>)[key]);if(found!==null)return `.${key}${found}`;}
 }
 return null;
}
export function assertNoCredentialKeys(value:unknown){const found=credentialPath(value);check(found===null,'SECRET_FIELD',`$${found}`);}

// Tier labelling: a file set is runnable only when nothing in it needs a script, network call or Whumpo route.
const privateMarkers:readonly (readonly [string,RegExp])[]=[
 ['script',/<script\b/i],
 ['dynamic-network',/\bfetch\s*\(|XMLHttpRequest|sendBeacon|new\s+WebSocket|EventSource/],
 ['whumpo-origin',/[a-z0-9-]*\.?whumpo\.(?:site|com|app|dev)\b/i],
 ['platform-route',/["'`(=\s]\/(?:api|modules|backend|app|workspace)(?:[/?"'`)\s]|$)/m],
 ['form-post',/<form\b[^>]*\baction\s*=/i],
 ['form-endpoint',/data-endpoint\s*=/i],
];
export function classifyFrontend(files:Record<string,string>){
 const requires=new Set<string>();
 for(const [path,text] of Object.entries(files)){
  if(!/\.(?:html|css|js|txt|svg)$/.test(path)&&!path.endsWith('_headers'))continue;
  for(const [marker,pattern] of privateMarkers)if(pattern.test(text))requires.add(marker);
 }
 const list=[...requires].sort();
 return {runnable:list.length===0,requires:list};
}

// ---------- Rows read by the owner route (portable.ts) ----------
export type Pin={name:string;version:number;digest:string};
type Json=Record<string,unknown>;
export type PortableRecord={entryId:string;createdAt:string;expiresAt:string;[key:string]:unknown};
export type PortableSource={
 ownerId:string;
 project:{id:string;ownerId:string;name:string};
 /** Saved specification head. `held`: the exact version is held (WH-014); it is then not exported, like any uncleared item. */
 specification:null|{projectId:string;versionId:string;digest:string;json:string;schemaVersion:number;compiler:Pin;components:{id:string;digest:string}[];held:boolean};
 /** The saved website page of that same version, and its photo references (version_photos, each with its file's project). */
 site:null|{projectId:string;versionId:string;component:string;html:string;digest:string;photos:{fileId:string;projectId:string}[]};
 /** Owner library photos the shared reader returned with verified bytes, and the count it withheld as not cleared. */
 photos:{id:string;projectId:string;digest:string;bytes:Uint8Array;cleared:boolean}[];
 withheldPhotos:number;
 directory:null|{projectId:string;document:Json};
 instances:{resourceId:string;projectId:string;localId:string;kind:'content'|'records'|'files'|'access';configRevision:number;module:Pin;schema:Pin;forms:boolean}[];
 roles:{resourceId:string;projectId:string;document:Json}[];
 /** Visitor-subject data sets; read only when the owner chose visitor data. */
 records:{resourceId:string;projectId:string;schemaId:string;retentionDays:number;document:Json&{records:PortableRecord[];next:string|null}}[];
 files:{resourceId:string;projectId:string;collectionId:string;withheld:number;complete:boolean;files:{id:string;projectId:string;digest:string;bytes:Uint8Array;cleared:boolean;uploadedBy:string;visitorId:string|null;width:number;height:number;createdAt:string}[]}[];
 /** Custom function sources: `cleared` only for an owner-reviewed (published/activated) version that is not held. */
 programs:{id:string;projectId:string;source:string|null;digest:string|null;cleared:boolean}[];
 /** Customer frontend source (none is stored in v1; WH-070 has no served composition). Never runnable. */
 frontends:{id:string;projectId:string;files:Record<string,string>}[];
 /** Presence only: values of these are never read. */
 presence:{contactInbox:boolean;connectors:boolean;domains:boolean;forms:boolean;customFunctions:boolean};
 resources:{customFunctions:string[]};
};

type SpecShape={pages?:{id:string;path:string;audience:string;photos?:{id:string}[]}[];modules?:{id:string}[];rules?:unknown[]};
const notCleared='not-cleared';
const jpeg=(bytes:Uint8Array)=>bytes.length>=3&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff;
const localId=/^[a-z][a-z0-9-]{0,39}$/,uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const safePath=/^[A-Za-z0-9][A-Za-z0-9_.-]*(?:\/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$/;

/** Composes the bundle. `cutoff` comes from the export review (its creation time), never from the build clock. */
export async function composePortableBundle(source:PortableSource,{ownerId,projectId,visitorData,cutoff}:{ownerId:string;projectId:string;visitorData:boolean;cutoff:string}){
 check(typeof ownerId==='string'&&ownerId.length>0&&source.ownerId===ownerId&&source.project.ownerId===ownerId,'FORBIDDEN','owner');
 check(source.project.id===projectId&&uuid.test(projectId),'FORBIDDEN','project');
 check(typeof cutoff==='string'&&!Number.isNaN(Date.parse(cutoff))&&new Date(cutoff).toISOString()===cutoff,'INVALID_CUTOFF');
 check(typeof visitorData==='boolean','INVALID_SCOPE');
 const at=Date.parse(cutoff);
 const owned=(item:{projectId:string}|null|undefined)=>!!item&&item.projectId===projectId;
 const files=new Map<string,{bytes:Uint8Array;tier:string;classId:string}>(),exclusions=new Map<string,number|null>();
 const exclude=(category:string,n:number|null=1)=>{if(n!==null&&n<=0)return;exclusions.set(category,n===null?null:((exclusions.get(category)??0)+n));};
 const put=(path:string,content:Uint8Array|string,tier:string,classId:string)=>{
  check(safePath.test(path)&&!path.split('/').includes('..')&&encoder.encode(path).length<=portableBounds.pathBytes,'UNSAFE_PATH',path);
  check(!files.has(path),'DUPLICATE_PATH',path);
  const bytes=typeof content==='string'?encoder.encode(content):content;
  check(bytes.length<=portableBounds.fileBytes,'BUNDLE_TOO_LARGE',path);
  files.set(path,{bytes,tier,classId});
 };
 const putJSON=(path:string,value:unknown,tier:string,classId:string)=>{assertNoCredentialKeys(value);put(path,canonicalJSON(value),tier,classId);};
 const used=new Set<string>(['maintainer-ai']);

 // Specification: the saved head, integrity-checked against its stored digest; a held version is not cleared.
 const spec=source.specification;
 check(spec&&owned(spec),'UNAVAILABLE','specification');
 let parsed=null as SpecShape|null;
 used.add('content-pages');
 if(spec.held)exclude(notCleared);
 else{
  parsed=JSON.parse(spec.json) as SpecShape;
  check(await jsonDigest(parsed)===spec.digest,'UNAVAILABLE','specification digest');
  assertNoCredentialKeys(parsed);
  putJSON('specification/specification.json',parsed,'specification','project-configurations');
 }

 // Static tier: public pages only, every dependency this project's own cleared photo, the saved HTML digest exact.
 const photos=new Map(source.photos.filter(owned).map(p=>[p.id,p]));
 const clearedPhoto=async(id:string)=>{const p=photos.get(id);return !!p&&p.cleared&&jpeg(p.bytes)&&await sha256(p.bytes)===p.digest;};
 const pageFiles:Record<string,string>={},staticPhotos=new Set<string>();
 let staticPages=0;
 const site=source.site;
 // A held saved version (specification and its page) is one uncleared item, counted above; its page is not read.
 if(!spec.held)for(const page of [...(parsed!.pages??[])].sort(byId)){
  if(page.audience!=='public'){exclude('staff-page-not-served');used.add('access');continue;}
  check(page.path==='/','UNAVAILABLE','only the saved homepage has a saved artifact');
  if(!site||!owned(site)||site.versionId!==spec.versionId||await sha256(site.html)!==site.digest){exclude(notCleared);continue;}
  const refs=site.photos.map(p=>p.fileId),declared=(page.photos??[]).map(p=>p.id);
  let ok=refs.length===declared.length&&refs.every((id,n)=>id===declared[n])&&site.photos.every(owned);
  for(const id of refs)if(ok&&!await clearedPhoto(id))ok=false;
  if(!ok){exclude(notCleared);continue;}
  pageFiles['site/public/index.html']=site.html;
  for(const id of refs)staticPhotos.add(id);
  staticPages++;
 }
 const headers=staticPages>0?staticSiteHeaders(site!.component):null;
 const staticCheck=classifyFrontend(headers===null?pageFiles:{...pageFiles,'site/public/_headers':headers});
 const runnable=staticPages>0&&staticCheck.runnable;
 const staticTier=runnable?'static':'source';
 for(const [path,html] of Object.entries(pageFiles))put(path,html,staticTier,'site-versions');
 if(headers!==null)put('site/public/_headers',headers,staticTier,'site-versions');
 for(const id of [...staticPhotos].sort(byPath))put(`site/public/assets/${id}.jpg`,photos.get(id)!.bytes,staticTier,'project-media');
 for(const photo of [...photos.values()].sort(byId)){
  if(staticPhotos.has(photo.id))continue;
  if(await clearedPhoto(photo.id))put(`data/media/${photo.id}.jpg`,photo.bytes,'data','project-media');
  else exclude(notCleared);
 }
 exclude(notCleared,source.withheldPhotos);

 // Custom frontends are customer source; they are never runnable while they need Whumpo APIs.
 const frontendRequires:{id:string;runnable:false;requires:string[]}[]=[];
 for(const frontend of [...source.frontends].filter(owned).sort(byId)){
  check(localId.test(frontend.id),'UNSAFE_PATH',frontend.id);
  const verdict=classifyFrontend(frontend.files);
  frontendRequires.push({id:frontend.id,runnable:false,requires:verdict.requires.length?verdict.requires:['whumpo-managed-capability']});
  for(const [rel,content] of Object.entries(frontend.files).sort(([a],[b])=>byPath(a,b)))put(`frontend/${frontend.id}/${rel}`,content,'source','project-configurations');
 }

 // Directory (owner content collection data).
 const directory=source.directory;
 if(directory&&owned(directory)&&(directory.document.project as Json|undefined)?.id===projectId){
  used.add('content-collections');
  putJSON('data/directory.json',directory.document,'data','directories');
 }

 // Module instances, exact pins and data sets.
 const instances=source.instances.filter(owned).sort((a,b)=>byPath(a.localId,b.localId));
 const resources:Record<string,string[]>={'custom-functions':[...source.resources.customFunctions]};
 for(const instance of instances){
  check(localId.test(instance.localId),'UNSAFE_PATH',instance.localId);
  const capability=instance.kind==='content'?'content-collections':instance.kind;
  used.add(capability);(resources[capability]??=[]).push(instance.resourceId);
  if(instance.kind==='records'){if(instance.forms){used.add('forms');(resources.forms??=[]).push(instance.resourceId);}}
  if(instance.kind==='access'){
   for(const roles of source.roles.filter(r=>owned(r)&&r.resourceId===instance.resourceId)){
    if((roles.document.project as Json|undefined)?.id!==projectId)continue;
    const list=Array.isArray(roles.document.roles)?roles.document.roles:[];
    putJSON(`data/access/${instance.localId}/roles.json`,{...roles.document,rolesSha256:await listDigest(list)},'data','project-roles');
   }
  }else if(instance.kind==='records'){
   if(!visitorData){exclude('visitor-dataset-not-requested');continue;}
   for(const set of source.records.filter(r=>owned(r)&&r.resourceId===instance.resourceId).sort((a,b)=>byPath(a.schemaId,b.schemaId))){
    check(localId.test(set.schemaId),'UNSAFE_PATH',set.schemaId);
    const doc=set.document;
    if((doc.project as Json|undefined)?.id!==projectId||(doc.instance as Json|undefined)?.resourceId!==instance.resourceId)continue;
    check(doc.next===null,'BUNDLE_TOO_LARGE',`records ${instance.localId}/${set.schemaId}`);
    // Records past their retention window at the review cutoff are never exported (and, like any expired row, not counted).
    const retained=doc.records.filter(r=>Date.parse(r.expiresAt)>at&&at-Date.parse(r.createdAt)<set.retentionDays*86400000);
    putJSON(`data/records/${instance.localId}/${set.schemaId}.json`,{...doc,records:retained,recordsSha256:await listDigest(retained)},'data','module-records');
   }
  }else if(instance.kind==='files'){
   if(!visitorData){exclude('visitor-dataset-not-requested');continue;}
   for(const set of source.files.filter(f=>owned(f)&&f.resourceId===instance.resourceId).sort((a,b)=>byPath(a.collectionId,b.collectionId))){
    check(localId.test(set.collectionId),'UNSAFE_PATH',set.collectionId);
    check(set.complete,'BUNDLE_TOO_LARGE',`files ${instance.localId}/${set.collectionId}`);
    exclude(notCleared,set.withheld);
    const list:Json[]=[];
    for(const f of [...set.files].sort(byId)){
     if(!owned(f))continue; // another tenant's object is never read into the bundle, nor counted
     if(!f.cleared||!jpeg(f.bytes)||await sha256(f.bytes)!==f.digest){exclude(notCleared);continue;}
     check(uuid.test(f.id),'UNSAFE_PATH',f.id);
     const path=`data/files/${instance.localId}/${set.collectionId}/${f.id}.jpg`;
     put(path,f.bytes,'data','module-files');
     list.push({id:f.id,path,sha256:f.digest,bytes:f.bytes.length,uploadedBy:f.uploadedBy,visitorId:f.visitorId,width:f.width,height:f.height,createdAt:f.createdAt});
    }
    putJSON(`data/files/${instance.localId}/${set.collectionId}.json`,{format:'whumpo-portable-files',schemaVersion:1,project:{id:projectId},
     instance:{resourceId:instance.resourceId,localId:instance.localId,configRevision:instance.configRevision},collection:{id:set.collectionId},files:list},'data','module-files');
   }
  }
 }

 // Reviewed custom source: cleared programs only, never executed while exporting.
 if(source.presence.customFunctions)used.add('custom-functions');
 for(const program of [...source.programs].sort(byId)){
  if(!owned(program))continue;
  used.add('custom-functions');
  check(localId.test(program.id),'UNSAFE_PATH',program.id);
  if(!program.cleared||program.source===null||program.digest===null||await sha256(program.source)!==program.digest){exclude(notCleared);continue;}
  put(`source/${program.id}/program.js`,program.source,'source','backend-artifacts');
  putJSON(`source/${program.id}/program.json`,{format:'whumpo-backend-source',schemaVersion:1,programId:program.id,engine:'quickjs',
   sha256:program.digest,bytes:encoder.encode(program.source).length,io:'json'},'source','backend-artifacts');
 }

 // Managed dependencies the bundle cannot carry. Values are never read; only presence is reported.
 if(source.presence.contactInbox){used.add('contact-inbox');exclude('contact-inbox-separate-export');}
 if(source.presence.connectors)used.add('connectors');
 if(source.presence.domains)used.add('domains');
 if(source.presence.forms)used.add('forms');
 if(parsed?.modules?.some(m=>m.id==='notifications'))used.add('notifications');
 if(parsed?.rules?.length)used.add('automation');
 exclude('credentials-and-sessions',null); // always excluded; never read, so never counted

 const report=capabilities.map(capability=>{
  const entry=capabilityCatalog[capability],isUsed=used.has(capability);
  let status:Status=!isUsed?'not-used':entry.allowed.includes('data-only')?'data-only':'unavailable';
  if(capability==='content-pages'&&isUsed)status=runnable?'runnable':'data-only';
  if(capability==='maintainer-ai')status='unavailable';
  return {capability,used:isUsed,status,resources:[...(resources[capability]??[])].sort(byPath),
   customerActions:isUsed?[...entry.actions]:[],cost:isUsed?entry.cost:'none',migration:`docs/portable-exports.md#${entry.migration}`};
 });
 const reconfigure:{capability:string;setting:string;instruction:string}[]=[];
 for(const capability of capabilities)if(used.has(capability))for(const [setting,instruction] of reconfigureCatalog[capability]??[])reconfigure.push({capability,setting,instruction});
 putJSON('report/unavailable.json',{format:portableFormat,formatVersion:portableFormatVersion,report},'report','projects');
 put('RECONFIGURE.txt',reconfigureText(reconfigure),'report','projects');
 put('README.txt',readmeText(runnable),'report','projects');

 const sorted=[...files.entries()].sort(([a],[b])=>byPath(a,b));
 const listed=[];
 for(const [path,f] of sorted)listed.push({path,sha256:await sha256(f.bytes),bytes:f.bytes.length,tier:f.tier,classId:f.classId});
 const manifest={
  format:portableFormat,formatVersion:portableFormatVersion,filter:portableFilter,
  project:{projectId,name:source.project.name},
  snapshot:{cutoff,specificationVersionId:spec.versionId,specificationDigest:spec.digest},
  scope:{visitorData},
  versions:{compiler:{name:spec.compiler.name,version:spec.compiler.version,digest:spec.compiler.digest},specificationSchema:spec.schemaVersion,
   components:[...spec.components].sort(byId),
   modules:instances.map(i=>({resourceId:i.resourceId,localId:i.localId,kind:i.kind,module:i.module,schema:i.schema,configRevision:i.configRevision})),
   datasetFormats:Object.entries(portableDatasetFormats).map(([format,schemaVersion])=>({format,schemaVersion}))},
  claims:{runnable:runnable?['static-site']:[]},
  frontends:frontendRequires,
  files:listed,
  exclusions:[...exclusions.entries()].sort(([a],[b])=>byPath(a,b)).map(([category,count])=>({category,count})),
  unavailable:report,
  reconfigure,
 };
 assertNoCredentialKeys(manifest);
 const bytes=packEntries([['manifest.json',encoder.encode(canonicalJSON(manifest))],...sorted.map(([path,f])=>[path,f.bytes] as [string,Uint8Array])]);
 return {bytes,sha256:await sha256(bytes),manifest};
}

function reconfigureText(list:{capability:string;setting:string;instruction:string}[]){
 return ['Settings to recreate yourself','','No password, key, token, passkey or session is included in this export.',
  'Create each setting below with your own provider before relying on the matching feature.','',
  ...list.map(r=>`- ${r.capability} / ${r.setting}: ${r.instruction}`),''].join('\n');
}
function readmeText(runnable:boolean){
 return ['Whumpo portable project export (format '+portableFormat+' version '+portableFormatVersion+')','',
  'manifest.json lists every file with its SHA-256 checksum, the exact compiler, component and module versions, what was left out and why.',
  runnable?'site/public is a static website that runs without Whumpo: upload it to any static host.':'This export has no runnable static website.',
  'data/ holds your project data as JSON and JPEG files. It is data, not a running application.',
  'frontend/ and source/ hold your custom source. A frontend listed with requirements in manifest.json still needs Whumpo APIs and is not a runnable application.',
  'report/unavailable.json lists every Whumpo capability, whether it runs outside Whumpo and what you need to do. RECONFIGURE.txt lists settings to recreate.',
  'The SHA-256 of this whole file is returned separately with the download (x-whumpo-bundle-sha256). Compare it before relying on the copy.',
  'This export does not publish, move or delete anything in Whumpo and does not transfer a subscription.',''].join('\n');
}

// ---------- Deterministic stored ZIP (method 0, UTF-8 names, fixed 1980-01-01 00:00 timestamp, no extras or ZIP64) ----------
const crcTable=(()=>{const t=new Uint32Array(256);for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}return t;})();
function crc32(bytes:Uint8Array){let c=0xffffffff;for(let i=0;i<bytes.length;i++)c=crcTable[(c^bytes[i])&0xff]^(c>>>8);return (c^0xffffffff)>>>0;}
const DOS_TIME=0,DOS_DATE=0x21,FLAGS=0x0800,VERSION=20;
export function packEntries(entries:[string,Uint8Array][]){
 check(entries.length<=portableBounds.entries,'BUNDLE_TOO_LARGE','entries');
 const names=entries.map(([path])=>encoder.encode(path));
 let localBytes=0,centralBytes=0;
 entries.forEach(([,data],n)=>{localBytes+=30+names[n].length+data.length;centralBytes+=46+names[n].length;});
 const total=localBytes+centralBytes+22;
 check(total<=portableBounds.archiveBytes,'BUNDLE_TOO_LARGE','bytes');
 const out=new Uint8Array(total),view=new DataView(out.buffer);
 let offset=0,central=localBytes;
 entries.forEach(([,data],n)=>{
  const name=names[n],crc=crc32(data),local=offset;
  view.setUint32(offset,0x04034b50,true);view.setUint16(offset+4,VERSION,true);view.setUint16(offset+6,FLAGS,true);view.setUint16(offset+8,0,true);
  view.setUint16(offset+10,DOS_TIME,true);view.setUint16(offset+12,DOS_DATE,true);view.setUint32(offset+14,crc,true);
  view.setUint32(offset+18,data.length,true);view.setUint32(offset+22,data.length,true);view.setUint16(offset+26,name.length,true);view.setUint16(offset+28,0,true);
  out.set(name,offset+30);out.set(data,offset+30+name.length);offset+=30+name.length+data.length;
  view.setUint32(central,0x02014b50,true);view.setUint16(central+4,VERSION,true);view.setUint16(central+6,VERSION,true);view.setUint16(central+8,FLAGS,true);view.setUint16(central+10,0,true);
  view.setUint16(central+12,DOS_TIME,true);view.setUint16(central+14,DOS_DATE,true);view.setUint32(central+16,crc,true);view.setUint32(central+20,data.length,true);view.setUint32(central+24,data.length,true);
  view.setUint16(central+28,name.length,true);view.setUint32(central+42,local,true);out.set(name,central+46);central+=46+name.length;
 });
 view.setUint32(central,0x06054b50,true);view.setUint16(central+8,entries.length,true);view.setUint16(central+10,entries.length,true);
 view.setUint32(central+12,centralBytes,true);view.setUint32(central+16,localBytes,true);
 return out;
}
