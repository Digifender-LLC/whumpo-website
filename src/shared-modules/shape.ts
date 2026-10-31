/** Pure view-fact shape for `module.instances@1`, shared by the server read binding, the view validator and the
 * owner panel. States and counts only: never configuration values, request receipts or visitor-submitted data. */
export const publicFormStates=['none','inactive','unavailable','unpublished','stale','bound'] as const;
export type PublicFormState=(typeof publicFormStates)[number];
export type ModuleInstanceFacts={
 specification:'current'|'none'|'unavailable';
 specificationRevision:number|null;
 items:{localId:string;kind:'content'|'records'|'files'|'access';resourceId:string|null;state:'unregistered'|'inactive'|'active'|'suspended'|'migrating';serving:boolean;configRevision:number|null;inSpecification:boolean;configChanged:boolean;catalog:'available'|'withdrawn'|'stale';canActivate:boolean;publicForm:PublicFormState}[];
};
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
export function validModuleInstanceFacts(d:unknown):d is ModuleInstanceFacts{
 return exact(d,['specification','specificationRevision','items'])&&['current','none','unavailable'].includes(String(d.specification))
  &&(d.specificationRevision===null||Number.isSafeInteger(d.specificationRevision)&&Number(d.specificationRevision)>0)&&Array.isArray(d.items)&&d.items.length<=32
  &&d.items.every(i=>exact(i,['localId','kind','resourceId','state','serving','configRevision','inSpecification','configChanged','catalog','canActivate','publicForm'])&&typeof i.localId==='string'&&/^[a-z][a-z0-9-]{0,39}$/.test(i.localId)
   &&['content','records','files','access'].includes(String(i.kind))&&(i.resourceId===null||uuid(i.resourceId))&&['unregistered','inactive','active','suspended','migrating'].includes(String(i.state))
   &&typeof i.serving==='boolean'&&(i.configRevision===null||Number.isSafeInteger(i.configRevision)&&Number(i.configRevision)>0)&&typeof i.inSpecification==='boolean'&&typeof i.configChanged==='boolean'
   &&['available','withdrawn','stale'].includes(String(i.catalog))&&typeof i.canActivate==='boolean'&&(publicFormStates as readonly string[]).includes(String(i.publicForm))&&(i.resourceId===null)===(i.state==='unregistered')&&(i.resourceId===null)===(i.configRevision===null))
  &&new Set(d.items.map(i=>(i as {localId:string}).localId)).size===d.items.length;
}

/** WH-126 `access.roles@1` view facts: opaque visitor ids, enrollment dates and staff state per registered access
 * instance. Never credentials, passkey material, recovery codes, sessions, documents or visitor-submitted values. */
export type AccessVisitorFacts={visitorId:string;enrolledAt:string;revoked:boolean;staff:boolean;staffChangedAt:string|null};
export type AccessRoleFacts={items:{localId:string;resourceId:string;state:'inactive'|'active'|'suspended'|'migrating';configRevision:number;accessRevision:number;staffRole:boolean;visitors:AccessVisitorFacts[]}[]};
const isoDate=(v:unknown)=>typeof v==='string'&&v.length<=30&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(v);
const positive=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>0;
export function validAccessRoleFacts(d:unknown):d is AccessRoleFacts{
 return exact(d,['items'])&&Array.isArray(d.items)&&d.items.length<=8&&d.items.every(i=>exact(i,['localId','resourceId','state','configRevision','accessRevision','staffRole','visitors'])
  &&typeof i.localId==='string'&&/^[a-z][a-z0-9-]{0,39}$/.test(i.localId)&&uuid(i.resourceId)&&['inactive','active','suspended','migrating'].includes(String(i.state))
  &&positive(i.configRevision)&&positive(i.accessRevision)&&typeof i.staffRole==='boolean'&&Array.isArray(i.visitors)&&i.visitors.length<=100
  &&i.visitors.every(v=>exact(v,['visitorId','enrolledAt','revoked','staff','staffChangedAt'])&&uuid(v.visitorId)&&isoDate(v.enrolledAt)&&typeof v.revoked==='boolean'&&typeof v.staff==='boolean'
   &&(v.staffChangedAt===null||isoDate(v.staffChangedAt))&&!(v.staff&&v.revoked))
  &&new Set(i.visitors.map(v=>(v as {visitorId:string}).visitorId)).size===i.visitors.length)
  &&new Set(d.items.map(i=>(i as {localId:string}).localId)).size===d.items.length;
}

/** WH-127 `records.summary@1` view facts: per registered records instance, its state, revisions and retention, and per
 * schema the count of retained records by submitter kind; forms and views by id, audience and scope. Never a field
 * label, field value, visitor id or entry id (visitor-submitted values stay dashboard-only). */
export type RecordsSummaryFacts={items:{localId:string;resourceId:string;state:'inactive'|'active'|'suspended'|'migrating';configRevision:number;retentionDays:30|90|365;publicForm:PublicFormState;
 schemas:{recordId:string;fieldsRevision:number;fields:number;records:{public:number;visitor:number;staff:number}}[];
 forms:{formId:string;recordId:string;submit:'public'|'visitor'|'staff';attachments:boolean}[];
 views:{viewId:string;recordId:string;audience:'staff'|'visitor';scope:'all'|'own'}[]}[]};
const localName=(v:unknown)=>typeof v==='string'&&/^[a-z][a-z0-9-]{0,39}$/.test(v);
const tally=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0&&Number(v)<=20000;
export function validRecordsSummaryFacts(d:unknown):d is RecordsSummaryFacts{
 return exact(d,['items'])&&Array.isArray(d.items)&&d.items.length<=8&&d.items.every(i=>exact(i,['localId','resourceId','state','configRevision','retentionDays','publicForm','schemas','forms','views'])&&(publicFormStates as readonly string[]).includes(String(i.publicForm))
  &&localName(i.localId)&&uuid(i.resourceId)&&['inactive','active','suspended','migrating'].includes(String(i.state))&&positive(i.configRevision)&&[30,90,365].includes(Number(i.retentionDays))
  &&Array.isArray(i.schemas)&&i.schemas.length>=1&&i.schemas.length<=4&&i.schemas.every(s=>exact(s,['recordId','fieldsRevision','fields','records'])&&localName(s.recordId)&&positive(s.fieldsRevision)
   &&Number.isSafeInteger(s.fields)&&Number(s.fields)>=1&&Number(s.fields)<=8&&exact(s.records,['public','visitor','staff'])&&tally((s.records as Record<string,unknown>).public)&&tally((s.records as Record<string,unknown>).visitor)&&tally((s.records as Record<string,unknown>).staff))
  &&Array.isArray(i.forms)&&i.forms.length<=4&&i.forms.every(f=>exact(f,['formId','recordId','submit','attachments'])&&localName(f.formId)&&localName(f.recordId)&&['public','visitor','staff'].includes(String(f.submit))&&typeof f.attachments==='boolean')
  &&Array.isArray(i.views)&&i.views.length<=8&&i.views.every(v=>exact(v,['viewId','recordId','audience','scope'])&&localName(v.viewId)&&localName(v.recordId)&&['staff','visitor'].includes(String(v.audience))&&['all','own'].includes(String(v.scope))))
  &&new Set(d.items.map(i=>(i as {localId:string}).localId)).size===d.items.length;
}

/** WH-128 owner photo-collection panel facts (dashboard only, owner route GET /api/projects/P/module-files): the saved
 * specification's page ids and paths, the owner's ready library photos not yet in a collection (id and exact digest, so
 * the owner's `files.putBytes` can name them), and per owner collection (`upload` lists `owner`) of each registered files
 * instance its state, revisions and the owner-filed photo ids with their safety state. Never a staff or visitor upload. */
export type OwnerFileCollections={
 /** Which step of the standard photo collection setup (`filesModuleReview`) comes next; ids and states only. */
 setup:{state:'website-required'|'not-configured'|'saved'|'registered'|'unavailable';instanceId:string|null};
 pages:{id:string;path:string}[];
 candidates:{fileId:string;sha256:string}[];
 collections:{instanceId:string;resourceId:string;configRevision:number;state:'inactive'|'active'|'suspended'|'migrating';collectionId:string;files:{fileId:string;safety:'pending'|'approved'|'blocked'}[]}[];
};
