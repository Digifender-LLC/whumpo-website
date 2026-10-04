import {backendFormConfig} from '../../backend-form-config';
import {SpecificationError,canonicalJSON,plain,requireSpec as check,shape} from '../v2/json';

/** WH-067 module kinds frozen by WH-123 (docs/shared-modules.md). Pin names are exact; digests come only
 * from the trusted server catalog. `lifecycleClasses` name the docs/data-lifecycle.json classes that own
 * the kind's data; the schema pin digest binds them before any table exists. */
export const moduleKinds=Object.freeze({
 content:Object.freeze({module:'module-collections',schema:'collections-data',lifecycleClasses:Object.freeze(['directories'])}),
 records:Object.freeze({module:'module-records',schema:'records-data',lifecycleClasses:Object.freeze(['module-records'])}),
 files:Object.freeze({module:'module-files',schema:'files-data',lifecycleClasses:Object.freeze(['module-files'])}),
 access:Object.freeze({module:'module-access',schema:'access-data',lifecycleClasses:Object.freeze(['visitor-identity','project-roles'])}),
});
export type ModuleKind=keyof typeof moduleKinds;

/** Owner decision of October 4, 2026, recorded on #107 (WH-067). This is the only code location of the
 * module-records retention window; docs/shared-modules.md and the `module-records` lifecycle class quote it
 * and tests/specification-compiler.mjs fails if they drift. Changing it is a compiler identity cutover. */
export const recordsRetention=Object.freeze({defaultDays:90,allowedDays:Object.freeze([30,90,365]),maxDays:365});

export type ModulePin={name:string;version:1;digest:string};
export type Audience='owner'|'staff'|'submitter';
export type RecordField={key:string;label:string;optional:boolean;read:Audience}&({type:'text'|'number'|'boolean'}|{type:'choice';options:{value:string;label:string}[]});
export type RecordsConfig={
 retentionDays:number;
 schemas:{id:string;fieldsRevision:number;fields:RecordField[];staffWrite:string[]}[];
 forms:{id:string;recordId:string;submit:'public'|'visitor'|'staff';uploadCollectionId:string|null}[];
 views:{id:string;recordId:string;audience:'staff'|'visitor';scope:'all'|'own';fields:string[];limit:number}[];
};
export type FilesConfig={collections:{id:string;read:Audience;upload:('owner'|'staff'|'visitor')[];maxBytes:number;mediaTypes:['image/jpeg'];gallery:null|{audience:'staff'|'visitor'}}[]};
export type AccessConfig={roles:[]|['staff'];enrollment:'invitation'};
export type CollectionsConfig={collections:[{id:string;type:'directory-listing@1'}]};
type Instance<K extends ModuleKind,C>={id:string;kind:K;module:ModulePin;schema:ModulePin;dependencies:string[];config:C};
export type ModuleInstance=Instance<'records',RecordsConfig>|Instance<'files',FilesConfig>|Instance<'access',AccessConfig>|Instance<'content',CollectionsConfig>;

function fail(code:string,path:string):never{throw new SpecificationError(code,path);}
const localId=(v:unknown,path:string)=>check(typeof v==='string'&&/^[a-z][a-z0-9-]{0,39}$/.test(v)&&!['constructor','prototype','tojson'].includes(v),'INVALID_ID',path);
const positive=(v:unknown,max:number,path:string)=>check(typeof v==='number'&&Number.isSafeInteger(v)&&v>=1&&v<=max,'INVALID_NUMBER',path);
function list(v:unknown,min:number,max:number,path:string):asserts v is unknown[]{check(Array.isArray(v)&&v.length>=min&&v.length<=max,'INVALID_LIST',path);}
function unique(values:unknown[],path:string){check(new Set(values).size===values.length,'DUPLICATE_ID',path);}
function oneOf(v:unknown,values:readonly unknown[],code:string,path:string){check(values.includes(v),code,path);}
const audiences=['owner','staff','submitter'] as const;
const readRank=(a:Audience)=>audiences.indexOf(a);

function pin(v:unknown,name:string,path:string){
 shape(v,['name','version','digest'],path);
 check(v.name===name,path==='instances.module'?'MODULE_MISMATCH':'SCHEMA_MISMATCH',path);
 check(typeof v.version==='number'&&Number.isSafeInteger(v.version),'INVALID_NUMBER',path);check(v.version===1,'UNSUPPORTED_VERSION',path);
 check(typeof v.digest==='string'&&/^[0-9a-f]{64}$/.test(v.digest),'INVALID_DIGEST',path);
}
function field(f:unknown){
 check(plain(f),'INVALID_SHAPE','fields');
 shape(f,f.type==='choice'?['key','label','type','optional','read','options']:['key','label','type','optional','read'],'fields');
 oneOf(f.type,['text','number','boolean','choice'],'UNSUPPORTED_FIELD','fields.type');
 check(typeof f.label==='string'&&!/[\u0000-\u001f\u007f]/.test(f.label),'INVALID_TEXT','fields.label');
 check(typeof f.optional==='boolean','INVALID_SHAPE','fields.optional');oneOf(f.read,audiences,'INVALID_AUDIENCE','fields.read');
}
function recordsConfig(c:unknown):asserts c is RecordsConfig{
 shape(c,['retentionDays','schemas','forms','views'],'records');
 oneOf(c.retentionDays,recordsRetention.allowedDays,'UNSUPPORTED_RETENTION','records.retentionDays');
 list(c.schemas,1,4,'records.schemas');
 const schemas=new Map<string,RecordsConfig['schemas'][number]>();
 for(const s of c.schemas){
  shape(s,['id','fieldsRevision','fields','staffWrite'],'records.schemas');localId(s.id,'records.schemas.id');check(!schemas.has(s.id as string),'DUPLICATE_ID','records.schemas');
  positive(s.fieldsRevision,1e6,'records.schemas.fieldsRevision');list(s.fields,1,8,'records.schemas.fields');
  for(const f of s.fields)field(f);
  const fields=s.fields as RecordField[];
  // Field keys, labels, choice options, optional-text-only and size bounds reuse the bounded form validator.
  try{backendFormConfig({title:'Record',description:'',buttonLabel:'Submit',fields:fields.map(({read:_,optional,...f})=>({...f,...(optional?{optional:true}:{})}))});}catch{fail('INCOMPATIBLE','records.schemas.fields');}
  list(s.staffWrite,0,8,'records.schemas.staffWrite');unique(s.staffWrite,'records.schemas.staffWrite');
  for(const key of s.staffWrite){const f=fields.find(x=>x.key===key);check(f,'MISSING_REFERENCE','records.schemas.staffWrite');check(f.read!=='owner','INVALID_AUDIENCE','records.schemas.staffWrite');}
  schemas.set(s.id as string,s as RecordsConfig['schemas'][number]);
 }
 list(c.forms,0,4,'records.forms');unique(c.forms.map(f=>plain(f)?f.id:f),'records.forms');
 for(const f of c.forms){
  shape(f,['id','recordId','submit','uploadCollectionId'],'records.forms');localId(f.id,'records.forms.id');check(schemas.has(f.recordId as string),'MISSING_REFERENCE','records.forms.recordId');
  oneOf(f.submit,['public','visitor','staff'],'INVALID_AUDIENCE','records.forms.submit');
  if(f.uploadCollectionId!==null){localId(f.uploadCollectionId,'records.forms.uploadCollectionId');check(f.submit!=='public','INCOMPATIBLE','records.forms.uploadCollectionId');}
 }
 list(c.views,0,8,'records.views');unique(c.views.map(v=>plain(v)?v.id:v),'records.views');
 for(const v of c.views){
  shape(v,['id','recordId','audience','scope','fields','limit'],'records.views');localId(v.id,'records.views.id');
  const s=schemas.get(v.recordId as string);check(s,'MISSING_REFERENCE','records.views.recordId');
  oneOf(v.audience,['staff','visitor'],'INVALID_AUDIENCE','records.views.audience');oneOf(v.scope,['all','own'],'INVALID_SCOPE','records.views.scope');
  check(v.audience!=='visitor'||v.scope==='own','INVALID_SCOPE','records.views.scope');
  positive(v.limit,50,'records.views.limit');list(v.fields,1,8,'records.views.fields');unique(v.fields,'records.views.fields');
  for(const key of v.fields){
   const f=s.fields.find(x=>x.key===key);check(f,'MISSING_REFERENCE','records.views.fields');
   // A view never projects more than its audience may read: staff excludes owner fields; visitors see submitter fields of their own records.
   check(v.audience==='staff'?f.read!=='owner':f.read==='submitter','FIELD_FORBIDDEN','records.views.fields');
  }
 }
}
function filesConfig(c:unknown):asserts c is FilesConfig{
 shape(c,['collections'],'files');list(c.collections,1,4,'files.collections');unique(c.collections.map(x=>plain(x)?x.id:x),'files.collections');
 for(const x of c.collections){
  shape(x,['id','read','upload','maxBytes','mediaTypes','gallery'],'files.collections');localId(x.id,'files.collections.id');
  oneOf(x.read,audiences,'INVALID_AUDIENCE','files.collections.read');
  list(x.upload,1,3,'files.collections.upload');unique(x.upload,'files.collections.upload');
  for(const u of x.upload)oneOf(u,['owner','staff','visitor'],'INVALID_AUDIENCE','files.collections.upload');
  // Current server photo paths accept cleaned JPEG up to 1 MiB only (docs/photos.md).
  positive(x.maxBytes,1048576,'files.collections.maxBytes');
  check(Array.isArray(x.mediaTypes)&&x.mediaTypes.length===1&&x.mediaTypes[0]==='image/jpeg','UNSUPPORTED_MEDIA','files.collections.mediaTypes');
  if(x.gallery!==null){
   shape(x.gallery,['audience'],'files.collections.gallery');oneOf(x.gallery.audience,['staff','visitor'],'INVALID_AUDIENCE','files.collections.gallery');
   check(x.gallery.audience==='staff'?x.read!=='owner':x.read==='submitter','FIELD_FORBIDDEN','files.collections.gallery');
  }
 }
}
function accessConfig(c:unknown):asserts c is AccessConfig{
 shape(c,['roles','enrollment'],'access');list(c.roles,0,1,'access.roles');check(c.roles.every(r=>r==='staff'),'UNSUPPORTED_ROLE','access.roles');
 oneOf(c.enrollment,['invitation'],'UNSUPPORTED_ENROLLMENT','access.enrollment');
}
function collectionsConfig(c:unknown):asserts c is CollectionsConfig{
 shape(c,['collections'],'content');list(c.collections,1,1,'content.collections');
 for(const x of c.collections){shape(x,['id','type'],'content.collections');localId(x.id,'content.collections.id');oneOf(x.type,['directory-listing@1'],'UNSUPPORTED_COLLECTION','content.collections.type');}
}
const configs:{[K in ModuleKind]:(c:unknown)=>void}={content:collectionsConfig,records:recordsConfig,files:filesConfig,access:accessConfig};

const staffAudience=(i:ModuleInstance)=>i.kind==='records'?i.config.forms.some(f=>f.submit==='staff')||i.config.views.some(v=>v.audience==='staff')||i.config.schemas.some(s=>s.staffWrite.length>0||s.fields.some(f=>f.read==='staff'))
 :i.kind==='files'?i.config.collections.some(x=>x.read==='staff'||x.upload.includes('staff')||x.gallery?.audience==='staff'):false;
const principalAudience=(i:ModuleInstance)=>i.kind==='records'?staffAudience(i)||i.config.views.length>0||i.config.forms.some(f=>f.submit!=='public')||i.config.schemas.some(s=>s.fields.some(f=>f.read!=='owner'))
 :i.kind==='files'?i.config.collections.some(x=>x.read!=='owner'||x.upload.some(u=>u!=='owner')||x.gallery!==null):false;
const dependencyKinds:{[K in ModuleKind]:ModuleKind[]}={content:[],access:[],records:['access','files'],files:['access']};

/** Validates the closed schema 3 instance list. Pure: no catalog, storage or principal is consulted. */
export function validateInstances(value:unknown):ModuleInstance[]{
 list(value,0,8,'instances');
 const rows=value as ModuleInstance[],byId=new Map<string,ModuleInstance>();
 for(const i of rows){
  shape(i,['id','kind','module','schema','dependencies','config'],'instances');localId(i.id,'instances.id');check(!byId.has(i.id),'DUPLICATE_ID','instances');
  check(typeof i.kind==='string'&&Object.hasOwn(moduleKinds,i.kind),'UNSUPPORTED_KIND','instances.kind');
  const names=moduleKinds[i.kind];pin(i.module,names.module,'instances.module');pin(i.schema,names.schema,'instances.schema');
  list(i.dependencies,0,3,'instances.dependencies');unique(i.dependencies,'instances.dependencies');for(const d of i.dependencies)localId(d,'instances.dependencies');
  configs[i.kind](i.config);byId.set(i.id,i);
 }
 for(const kind of ['access','content'] as const)check(rows.filter(i=>i.kind===kind).length<=1,'INCOMPATIBLE','instances.'+kind);
 const forms=rows.flatMap(i=>i.kind==='records'?i.config.forms.map(f=>f.id):[]),collections=rows.flatMap(i=>i.kind==='files'?i.config.collections.map(x=>x.id):[]);
 unique(forms,'instances.forms');unique(collections,'instances.collections');
 for(const i of rows){
  const deps=i.dependencies.map(id=>{const d=byId.get(id);check(d&&d!==i,'MISSING_REFERENCE','instances.dependencies');return d;});
  check(deps.every(d=>dependencyKinds[i.kind].includes(d.kind)),'INCOMPATIBLE','instances.dependencies');
  // Visitor/staff audiences resolve only through a same-project access instance; never through workspace membership.
  const access=deps.find(d=>d.kind==='access');
  check(!principalAudience(i)||access,'MISSING_DEPENDENCY','instances.dependencies.access');
  check(!staffAudience(i)||access?.kind==='access'&&access.config.roles.length===1,'MISSING_DEPENDENCY','instances.dependencies.access.staff');
  if(i.kind!=='records')continue;
  for(const f of i.config.forms){
   if(f.uploadCollectionId===null)continue;
   const owner=rows.find(x=>x.kind==='files'&&x.config.collections.some(c=>c.id===f.uploadCollectionId));
   check(owner,'MISSING_REFERENCE','records.forms.uploadCollectionId');check(deps.includes(owner),'MISSING_DEPENDENCY','records.forms.uploadCollectionId');
   const collection=(owner as Extract<ModuleInstance,{kind:'files'}>).config.collections.find(c=>c.id===f.uploadCollectionId)!;
   check(collection.upload.includes(f.submit as 'staff'|'visitor'),'INCOMPATIBLE','records.forms.uploadCollectionId');
  }
 }
 return rows;
}
export const accessInstance=(rows:ModuleInstance[])=>rows.find((i):i is Extract<ModuleInstance,{kind:'access'}>=>i.kind==='access');
export const staffRole=(rows:ModuleInstance[])=>accessInstance(rows)?.config.roles.length===1;

export type ModuleChange={schema:boolean;permissions:boolean;migration:'none'|'additive-optional'};
const same=(a:unknown,b:unknown)=>canonicalJSON(a)===canonicalJSON(b);
function migration(path:string):never{throw new SpecificationError('MIGRATION_REQUIRED',path);}
const submitRank=(s:string)=>['staff','visitor','public'].indexOf(s);
const galleryRank=(g:FilesConfig['collections'][number]['gallery'])=>g===null?-1:g.audience==='staff'?0:1;
/** Classifies one validated instance change under the current-version-only hook table (docs/shared-modules.md).
 * Widening any read/upload/submit/staff audience or the retention window requires the permissions review.
 * Required/removed/renamed/retyped fields, removed schemas or collections and pin/kind changes reject. */
export function classifyModuleChange(before:ModuleInstance|undefined,after:ModuleInstance):ModuleChange{
 const result:ModuleChange={schema:false,permissions:false,migration:'none'};
 if(!before){result.schema=true;result.permissions=principalAudience(after)||after.kind==='access'&&after.config.roles.length>0;return result;}
 if(before.kind!==after.kind||!same(before.module,after.module)||!same(before.schema,after.schema))migration('instances.pin');
 const widen=()=>{result.permissions=true;};
 if(before.kind==='records'&&after.kind==='records'){
  const b=before.config,a=after.config;
  if(a.retentionDays>b.retentionDays)widen();
  for(const s of b.schemas){
   const next=a.schemas.find(x=>x.id===s.id);if(!next)migration('records.schemas');
   const added=next.fields.filter(f=>!s.fields.some(x=>x.key===f.key));
   for(const f of s.fields){
    const n=next.fields.find(x=>x.key===f.key);if(!n)migration('records.schemas.fields');
    const {label:_l,read:r1,...shapeBefore}=f,{label:_m,read:r2,...shapeAfter}=n;
    if(!same(shapeBefore,shapeAfter))migration('records.schemas.fields');
    if(readRank(r2)>readRank(r1))widen();
   }
   for(const f of added){if(!f.optional)migration('records.schemas.fields');result.schema=true;result.migration='additive-optional';if(f.read!=='owner')widen();}
   check(next.fieldsRevision===s.fieldsRevision+(added.length?1:0),'INCOMPATIBLE','records.schemas.fieldsRevision');
   if(next.staffWrite.some(k=>!s.staffWrite.includes(k)))widen();
  }
  for(const s of a.schemas)if(!b.schemas.some(x=>x.id===s.id)){result.schema=true;if(s.staffWrite.length||s.fields.some(f=>f.read!=='owner'))widen();}
  for(const f of a.forms){const old=b.forms.find(x=>x.id===f.id);if(!old||old.recordId!==f.recordId||submitRank(f.submit)>submitRank(old.submit)||f.uploadCollectionId!==null&&f.uploadCollectionId!==old.uploadCollectionId)widen();}
  for(const v of a.views){const old=b.views.find(x=>x.id===v.id);if(!old||old.recordId!==v.recordId||old.audience!==v.audience||old.scope==='own'&&v.scope==='all'||v.fields.some(k=>!old.fields.includes(k)))widen();}
 }else if(before.kind==='files'&&after.kind==='files'){
  for(const x of before.config.collections){
   const n=after.config.collections.find(y=>y.id===x.id);if(!n)migration('files.collections');
   if(readRank(n.read)>readRank(x.read)||n.upload.some(u=>!x.upload.includes(u))||galleryRank(n.gallery)>galleryRank(x.gallery))widen();
  }
  for(const n of after.config.collections)if(!before.config.collections.some(x=>x.id===n.id)){result.schema=true;if(n.read!=='owner'||n.upload.some(u=>u!=='owner')||n.gallery)widen();}
 }else if(before.kind==='access'&&after.kind==='access'){
  if(after.config.roles.length>before.config.roles.length)widen();
 }else if(before.kind==='content'&&after.kind==='content'){
  if(!same(before.config,after.config))migration('content.collections');
 }
 return result;
}
