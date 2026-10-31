// WH-067 offline contract reference (WH-123). Validates frozen shapes and the pure policy table only.
// It is not authentication, a catalog, storage, an HTTP handler or a migration engine.
// No Worker imports it; production handlers must re-derive principals and recheck policy at commit.
import {createHash} from 'node:crypto';
import {validateDescriptor,descriptorDigest} from './workload-placement.mjs';

export class ModuleContractError extends Error {
 constructor(code,path){super(`${code}: ${path}`);this.code=code;}
}
const check=(ok,code,path)=>{if(!ok)throw new ModuleContractError(code,path);};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
function shape(v,keys,path){
 check(plain(v),'INVALID_SHAPE',path);
 check(Object.keys(v).every(k=>keys.includes(k)),'UNKNOWN_FIELD',path);
 check(keys.every(k=>Object.hasOwn(v,k)),'MISSING_FIELD',path);
}
const localId=(v,path)=>check(typeof v==='string'&&/^[a-z][a-z0-9-]{0,39}$/.test(v)&&!['constructor','prototype','tojson'].includes(v),'INVALID_ID',path);
const uuid=(v,path)=>check(typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v),'INVALID_ID',path);
const digest=(v,path)=>check(typeof v==='string'&&/^[0-9a-f]{64}$/.test(v),'INVALID_DIGEST',path);
const positive=(v,max,path)=>check(Number.isSafeInteger(v)&&v>=1&&v<=max,'INVALID_NUMBER',path);
function list(v,min,max,path){check(Array.isArray(v)&&v.length>=min&&v.length<=max,'INVALID_LIST',path);}
function unique(values,path){check(new Set(values).size===values.length,'DUPLICATE_ID',path);}
function text(v,max,path,empty=false){check(typeof v==='string'&&v.length<=max&&(empty||v.trim().length>0)&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v),'INVALID_TEXT',path);}
const oneOf=(v,values,code,path)=>check(values.includes(v),code,path);
function canonical(v,depth=0){
 check(depth<=16,'TOO_DEEP','json');
 if(v===null||typeof v==='string'||typeof v==='boolean')return JSON.stringify(v);
 if(typeof v==='number'){check(Number.isFinite(v),'INVALID_NUMBER','json');return JSON.stringify(v);}
 if(Array.isArray(v))return '['+v.map(x=>canonical(x,depth+1)).join(',')+']';
 check(plain(v),'INVALID_SHAPE','json');
 return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k],depth+1)).join(',')+'}';
}
const copy=(v,max)=>{const json=canonical(v);check(Buffer.byteLength(json)<=max,'TOO_LARGE','input');return JSON.parse(json);};

/** WH-067 module kinds and their exact v1 module/schema pin names. Digests come only from the trusted catalog. */
export const moduleKinds=Object.freeze({
 content:Object.freeze({module:'module-collections',schema:'collections-data'}),
 records:Object.freeze({module:'module-records',schema:'records-data'}),
 files:Object.freeze({module:'module-files',schema:'files-data'}),
 access:Object.freeze({module:'module-access',schema:'access-data'}),
});
export const audiences=Object.freeze(['owner','staff','submitter']);
const fieldTypes=['text','number','boolean','choice'];

function recordsConfig(c){
 shape(c,['retentionDays','schemas','forms','views'],'config');
 // WH-124 retention window: owner decision of October 4, 2026 (#107): default 90 days (src/project-specification/v3/modules.ts).
 oneOf(c.retentionDays,[30,90,365],'UNSUPPORTED_RETENTION','retentionDays');
 list(c.schemas,1,4,'schemas');unique(c.schemas.map(s=>s?.id),'schemas');
 const schemas=new Map();
 for(const s of c.schemas){
  shape(s,['id','fieldsRevision','fields','staffWrite'],'schemas');localId(s.id,'schemas.id');positive(s.fieldsRevision,1e6,'schemas.fieldsRevision');
  list(s.fields,1,8,'schemas.fields');unique(s.fields.map(f=>f?.key),'schemas.fields');
  for(const f of s.fields){
   shape(f,['key','label','type','optional','read'],'fields');localId(f.key,'fields.key');text(f.label,60,'fields.label');
   oneOf(f.type,fieldTypes,'UNSUPPORTED_FIELD','fields.type');check(typeof f.optional==='boolean','INVALID_SHAPE','fields.optional');
   oneOf(f.read,audiences,'INVALID_AUDIENCE','fields.read');
  }
  list(s.staffWrite,0,8,'schemas.staffWrite');unique(s.staffWrite,'schemas.staffWrite');
  for(const key of s.staffWrite){const f=s.fields.find(x=>x.key===key);check(f&&f.read!=='owner','INVALID_AUDIENCE','staffWrite requires a staff-readable field');}
  schemas.set(s.id,s);
 }
 list(c.forms,0,4,'forms');unique(c.forms.map(f=>f?.id),'forms');
 for(const f of c.forms){
  shape(f,['id','recordId','submit','uploadCollectionId'],'forms');localId(f.id,'forms.id');check(schemas.has(f.recordId),'MISSING_REFERENCE','forms.recordId');
  oneOf(f.submit,['public','visitor','staff'],'INVALID_AUDIENCE','forms.submit');
  if(f.uploadCollectionId!==null){localId(f.uploadCollectionId,'forms.uploadCollectionId');check(f.submit!=='public','INCOMPATIBLE','anonymous attachment intake');}
 }
 list(c.views,0,8,'views');unique(c.views.map(v=>v?.id),'views');
 for(const v of c.views){
  shape(v,['id','recordId','audience','scope','fields','limit'],'views');localId(v.id,'views.id');
  const s=schemas.get(v.recordId);check(s,'MISSING_REFERENCE','views.recordId');
  oneOf(v.audience,['staff','visitor'],'INVALID_AUDIENCE','views.audience');oneOf(v.scope,['all','own'],'INVALID_SCOPE','views.scope');
  check(v.audience!=='visitor'||v.scope==='own','INVALID_SCOPE','visitor views are own-records only');
  positive(v.limit,50,'views.limit');list(v.fields,1,8,'views.fields');unique(v.fields,'views.fields');
  for(const key of v.fields){
   const f=s.fields.find(x=>x.key===key);check(f,'MISSING_REFERENCE','views.fields');
   check(v.audience==='staff'?f.read!=='owner':f.read==='submitter','FIELD_FORBIDDEN','views.fields');
  }
 }
}
function filesConfig(c){
 shape(c,['collections'],'config');list(c.collections,1,4,'collections');unique(c.collections.map(x=>x?.id),'collections');
 for(const x of c.collections){
  shape(x,['id','read','upload','maxBytes','mediaTypes','gallery'],'collections');localId(x.id,'collections.id');
  oneOf(x.read,audiences,'INVALID_AUDIENCE','collections.read');
  list(x.upload,1,3,'collections.upload');unique(x.upload,'collections.upload');
  for(const u of x.upload)oneOf(u,['owner','staff','visitor'],'INVALID_AUDIENCE','collections.upload');
  positive(x.maxBytes,1048576,'collections.maxBytes');
  check(Array.isArray(x.mediaTypes)&&x.mediaTypes.length===1&&x.mediaTypes[0]==='image/jpeg','UNSUPPORTED_MEDIA','collections.mediaTypes');
  if(x.gallery!==null){shape(x.gallery,['audience'],'collections.gallery');oneOf(x.gallery.audience,['staff','visitor'],'INVALID_AUDIENCE','collections.gallery');
   check(x.gallery.audience==='staff'?x.read!=='owner':x.read==='submitter','FIELD_FORBIDDEN','gallery exceeds read policy');}
 }
}
function accessConfig(c){
 shape(c,['roles','enrollment'],'config');list(c.roles,0,1,'roles');check(c.roles.every(r=>r==='staff'),'UNSUPPORTED_ROLE','roles');
 oneOf(c.enrollment,['invitation'],'UNSUPPORTED_ENROLLMENT','enrollment');
}
function contentConfig(c){
 shape(c,['collections'],'config');list(c.collections,1,1,'collections');
 for(const x of c.collections){shape(x,['id','type'],'collections');localId(x.id,'collections.id');oneOf(x.type,['directory-listing@1'],'UNSUPPORTED_COLLECTION','collections.type');}
}
const configs={content:contentConfig,records:recordsConfig,files:filesConfig,access:accessConfig};

/** Closed instance envelope v1: a WH-071 descriptor, kind-specific configuration and its source specification. */
export function validateInstance(input){
 const i=copy(input,49152);
 shape(i,['contractVersion','descriptor','config','configRevision','source'],'instance');
 check(i.contractVersion===1,'UNSUPPORTED_VERSION','contractVersion');
 const d=validateDescriptor(i.descriptor),names=moduleKinds[d.kind];
 check(names,'UNSUPPORTED_KIND','descriptor.kind');
 check(d.module.name===names.module&&d.module.version===1,'MODULE_MISMATCH','descriptor.module');
 check(d.schema.name===names.schema&&d.schema.version===1,'SCHEMA_MISMATCH','descriptor.schema');
 positive(i.configRevision,Number.MAX_SAFE_INTEGER,'configRevision');
 shape(i.source,['specificationVersionId','specificationDigest'],'source');uuid(i.source.specificationVersionId,'source');digest(i.source.specificationDigest,'source');
 configs[d.kind](i.config);
 const c=i.config;
 const needsAccess=d.kind==='records'?c.views.length>0||c.forms.some(f=>f.submit!=='public')||c.schemas.some(s=>s.staffWrite.length>0)
  :d.kind==='files'?c.collections.some(x=>x.read!=='owner'||x.upload.some(u=>u!=='owner')||x.gallery!==null):false;
 // Visitor/staff audiences resolve only through a same-project access instance; never through workspace membership.
 check(!needsAccess||d.dependencies.some(dep=>dep.module.name===moduleKinds.access.module),'MISSING_DEPENDENCY','access module');
 return i;
}
export const instanceDigest=v=>createHash('sha256').update(canonical(validateInstance(v))).digest('hex');
export {descriptorDigest};

/** A trusted catalog fixture: exact current pins. Anything else is unavailable, never a fallback. */
export function admitInstance(input,catalog){
 const i=validateInstance(input),d=i.descriptor;
 const same=(a,b)=>!!b&&a.name===b.name&&a.version===b.version&&a.digest===b.digest;
 const entry=catalog.find(e=>e.kind===d.kind&&e.state==='available');
 check(entry,'UNAVAILABLE','catalog');
 check(same(d.module,entry.module),'STALE_MODULE_VERSION','descriptor.module');
 check(same(d.schema,entry.schema),'STALE_MODULE_VERSION','descriptor.schema');
 return {admitted:true,authority:'not-granted',instanceDigest:instanceDigest(i)};
}

/** Request envelope for every module API call, including direct/custom frontend use. */
export const moduleOperations=Object.freeze({
 'records.view':{kind:'records',write:false},'records.get':{kind:'records',write:false},
 'forms.submit':{kind:'records',write:true},'records.update':{kind:'records',write:true},'records.remove':{kind:'records',write:true},
 'leads.update':{kind:'records',write:true},
 'files.prepareUpload':{kind:'files',write:true},'files.putBytes':{kind:'files',write:true},'files.read':{kind:'files',write:false},
 'files.gallery':{kind:'files',write:false},'files.requestRemoval':{kind:'files',write:true},
 'access.me':{kind:'access',write:false},'access.list':{kind:'access',write:false},
 'access.prepareRole':{kind:'access',write:true},'access.confirmRole':{kind:'access',write:true},
 'collections.readPublic':{kind:'content',write:false},
});
export function validateRequest(input){
 const r=copy(input,16384);
 check(plain(r),'INVALID_SHAPE','request');
 check(r.api==='whumpo-modules'&&r.version===1,'CLIENT_UPDATE_REQUIRED','api');
 shape(r,['api','version','operation','resourceId','configRevision','requestId','target','input'],'request');
 check(Object.hasOwn(moduleOperations,r.operation),'UNSUPPORTED_OPERATION','operation');
 uuid(r.resourceId,'resourceId');positive(r.configRevision,Number.MAX_SAFE_INTEGER,'configRevision');
 const write=moduleOperations[r.operation].write;
 if(write)uuid(r.requestId,'requestId');else check(r.requestId===null,'INVALID_SHAPE','reads carry no request ID');
 check(r.target===null||plain(r.target),'INVALID_SHAPE','target');
 check(r.input===null||plain(r.input),'INVALID_SHAPE','input');
 for(const forbidden of ['projectId','ownerId','userId','visitorId','role','roles','approved','path','prefix','bucket','sql'])
  for(const scope of [r.target??{},r.input??{}])check(!Object.hasOwn(scope,forbidden),'AUTHORITY_FIELD',forbidden);
 return r;
}

/** Principals are server-derived. Workspace membership (WH-054) and maintainer jobs are not module principals. */
export function validatePrincipal(input){
 const p=copy(input,2048);check(plain(p),'INVALID_SHAPE','principal');
 if(p.kind==='owner'){shape(p,['kind','userId','projectId'],'principal');uuid(p.userId,'userId');uuid(p.projectId,'projectId');}
 else if(p.kind==='visitor'){shape(p,['kind','projectId','visitorId','roles','accessRevision'],'principal');uuid(p.projectId,'projectId');uuid(p.visitorId,'visitorId');
  list(p.roles,0,1,'roles');check(p.roles.every(r=>r==='staff'),'UNSUPPORTED_ROLE','roles');positive(p.accessRevision,Number.MAX_SAFE_INTEGER,'accessRevision');}
 else if(p.kind==='public'){shape(p,['kind','projectId'],'principal');uuid(p.projectId,'projectId');}
 else if(p.kind==='job'){shape(p,['kind','projectId','jobId','purpose'],'principal');uuid(p.projectId,'projectId');uuid(p.jobId,'jobId');oneOf(p.purpose,['deterministic-rule'],'RESTRICTED_PRINCIPAL','purpose');}
 else throw new ModuleContractError('RESTRICTED_PRINCIPAL','principal.kind');
 return p;
}

/** Pure policy table. Production composes the same decision into the committing SQL statement. */
export function decide(principalInput,instanceInput,operation,target){
 const p=validatePrincipal(principalInput),i=validateInstance(instanceInput),d=i.descriptor,op=moduleOperations[operation];
 check(op,'UNSUPPORTED_OPERATION','operation');check(op.kind===d.kind,'UNSUPPORTED_OPERATION','operation kind');
 if(p.projectId!==d.ref.projectId)return deny('not_found');
 const staff=p.kind==='visitor'&&p.roles.includes('staff');
 const allow=(fields=null)=>({decision:'allow',fields,inference:'none',authority:'current-request-only'});
 function deny(reason){return {decision:'deny',reason};}
 if(p.kind==='job')return deny('forbidden'); // WH-069 registers deterministic job operations through its own admission.
 const c=i.config;
 switch(operation){
  case 'forms.submit':{
   const f=c.forms.find(x=>x.id===target?.formId);if(!f)return deny('not_found');
   const ok=f.submit==='public'?['public','visitor'].includes(p.kind):f.submit==='visitor'?p.kind==='visitor':staff;
   return ok?allow():deny(p.kind==='public'?'sign_in_required':'forbidden');
  }
  case 'records.view':{
   const v=c.views.find(x=>x.id===target?.viewId);if(!v)return deny('not_found');
   if(p.kind==='owner')return deny('owner_api');
   const ok=v.audience==='staff'?staff:p.kind==='visitor';
   return ok?allow({fields:[...v.fields],scope:v.scope,limit:v.limit}):deny(p.kind==='public'?'sign_in_required':'forbidden');
  }
  case 'records.update':{
   const s=c.schemas.find(x=>x.id===target?.recordId);if(!s)return deny('not_found');
   if(p.kind==='owner')return allow({fields:s.fields.map(f=>f.key)});
   if(!staff)return deny(p.kind==='public'?'sign_in_required':'forbidden');
   const keys=Object.keys(target?.changes??{});
   return keys.length&&keys.every(k=>s.staffWrite.includes(k))?allow({fields:keys}):deny('field_forbidden');
  }
  case 'records.remove':return p.kind==='owner'?allow():deny('forbidden');
  // WH-093 lead stage, note and due date: owner only, never staff, visitor or public.
  case 'leads.update':{if(p.kind!=='owner')return deny('forbidden');return c.schemas.some(x=>x.id===target?.recordId)?allow():deny('not_found');}
  case 'records.get':{
   const s=c.schemas.find(x=>x.id===target?.recordId);if(!s)return deny('not_found');
   if(p.kind==='owner')return allow({fields:s.fields.map(f=>f.key),scope:'all'});
   if(staff)return allow({fields:s.fields.filter(f=>f.read!=='owner').map(f=>f.key),scope:'all'});
   // A visitor reads only its own submitted record and only submitter-readable fields.
   return p.kind==='visitor'?allow({fields:s.fields.filter(f=>f.read==='submitter').map(f=>f.key),scope:'own'}):deny('sign_in_required');
  }
  case 'files.prepareUpload':case 'files.putBytes':{
   const x=c.collections.find(y=>y.id===target?.collectionId);if(!x)return deny('not_found');
   const as=p.kind==='owner'?'owner':staff?'staff':p.kind==='visitor'?'visitor':null;
   // Upload authority is the collection's role policy. Names, prefixes and object keys are never consulted.
   return as&&x.upload.includes(as)?allow():deny(p.kind==='public'?'sign_in_required':'forbidden');
  }
  case 'files.read':case 'files.gallery':{
   const x=c.collections.find(y=>y.id===target?.collectionId);if(!x)return deny('not_found');
   if(p.kind==='owner')return allow({clearance:'approved-only'});
   const ok=staff?x.read!=='owner':p.kind==='visitor'&&x.read==='submitter';
   if(operation==='files.gallery'&&(!x.gallery||(x.gallery.audience==='staff'&&!staff)))return deny('forbidden');
   return ok?allow({clearance:'approved-only',scope:staff?'all':'own'}):deny(p.kind==='public'?'sign_in_required':'forbidden');
  }
  case 'files.requestRemoval':return p.kind==='owner'?allow({review:'exact-owner-review'}):deny('forbidden');
  case 'access.me':return p.kind==='visitor'?allow():deny('sign_in_required');
  case 'access.list':case 'access.prepareRole':case 'access.confirmRole':return p.kind==='owner'?allow(operation==='access.list'?null:{review:'exact-owner-review'}):deny('forbidden');
  case 'collections.readPublic':return allow({snapshot:'approved-public-only'});
 }
 return deny('forbidden');
}
