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
