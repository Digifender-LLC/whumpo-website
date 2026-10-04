/** Pure view-fact shape for `module.instances@1`, shared by the server read binding, the view validator and the
 * owner panel. States and counts only: never configuration values, request receipts or visitor-submitted data. */
export type ModuleInstanceFacts={
 specification:'current'|'none'|'unavailable';
 specificationRevision:number|null;
 items:{localId:string;kind:'content'|'records'|'files'|'access';resourceId:string|null;state:'unregistered'|'inactive'|'active'|'suspended'|'migrating';serving:boolean;configRevision:number|null;inSpecification:boolean;configChanged:boolean;catalog:'available'|'withdrawn'|'stale';canActivate:boolean}[];
};
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
export function validModuleInstanceFacts(d:unknown):d is ModuleInstanceFacts{
 return exact(d,['specification','specificationRevision','items'])&&['current','none','unavailable'].includes(String(d.specification))
  &&(d.specificationRevision===null||Number.isSafeInteger(d.specificationRevision)&&Number(d.specificationRevision)>0)&&Array.isArray(d.items)&&d.items.length<=32
  &&d.items.every(i=>exact(i,['localId','kind','resourceId','state','serving','configRevision','inSpecification','configChanged','catalog','canActivate'])&&typeof i.localId==='string'&&/^[a-z][a-z0-9-]{0,39}$/.test(i.localId)
   &&['content','records','files','access'].includes(String(i.kind))&&(i.resourceId===null||uuid(i.resourceId))&&['unregistered','inactive','active','suspended','migrating'].includes(String(i.state))
   &&typeof i.serving==='boolean'&&(i.configRevision===null||Number.isSafeInteger(i.configRevision)&&Number(i.configRevision)>0)&&typeof i.inSpecification==='boolean'&&typeof i.configChanged==='boolean'
   &&['available','withdrawn','stale'].includes(String(i.catalog))&&typeof i.canActivate==='boolean'&&(i.resourceId===null)===(i.state==='unregistered')&&(i.resourceId===null)===(i.configRevision===null))
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
