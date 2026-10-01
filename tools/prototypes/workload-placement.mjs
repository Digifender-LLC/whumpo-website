// WH-071 offline decision reference. Not authentication, a runtime router, or a migration engine.
// No Worker imports, provider calls, persistence, guest execution, or production consumers.
import {createHash} from 'node:crypto';

export class PlacementError extends Error {
 constructor(code,path){super(`${code}: ${path}`);this.code=code;}
}
const check=(ok,code,path)=>{if(!ok)throw new PlacementError(code,path);};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
function shape(v,keys,path){
 check(plain(v),'INVALID_SHAPE',path);
 check(Object.keys(v).every(k=>keys.includes(k)),'UNKNOWN_FIELD',path);
 check(keys.every(k=>Object.hasOwn(v,k)),'MISSING_FIELD',path);
}
const id=(v,path)=>check(typeof v==='string'&&/^[a-z][a-z0-9-]{0,63}$/.test(v),'INVALID_ID',path);
const uuid=(v,path)=>check(typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v),'INVALID_ID',path);
const integer=(v,path)=>check(Number.isSafeInteger(v)&&v>=0,'INVALID_NUMBER',path);
function list(v,max,path){check(Array.isArray(v)&&v.length<=max,'INVALID_LIST',path);}
function unique(values,path){check(new Set(values).size===values.length,'DUPLICATE',path);}
function canonical(v,depth=0){
 check(depth<=16,'TOO_DEEP','json');
 if(v===null||typeof v==='string'||typeof v==='boolean')return JSON.stringify(v);
 if(typeof v==='number'){check(Number.isFinite(v),'INVALID_NUMBER','json');return JSON.stringify(v);}
 if(Array.isArray(v))return '['+v.map(x=>canonical(x,depth+1)).join(',')+']';
 check(plain(v),'INVALID_SHAPE','json');
 return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k],depth+1)).join(',')+'}';
}
const equal=(a,b)=>canonical(a)===canonical(b);
const copy=v=>{const json=canonical(v);check(Buffer.byteLength(json)<=32768,'TOO_LARGE','descriptor');return JSON.parse(json);};
export const descriptorDigest=v=>createHash('sha256').update(canonical(validateDescriptor(v))).digest('hex');
function ref(v,path){shape(v,['projectId','resourceId'],path);uuid(v.projectId,path);uuid(v.resourceId,path);}
function pin(v,path){
 shape(v,['name','version','digest'],path);id(v.name,path);integer(v.version,path);
 check(v.version>0,'UNSUPPORTED_VERSION',path);
 check(typeof v.digest==='string'&&/^[0-9a-f]{64}$/.test(v.digest),'INVALID_DIGEST',path);
}
const key=r=>`${r.projectId}/${r.resourceId}`;
const kinds=['content','records','files','access','notifications','automation','custom-function'];

/** Closed descriptor; validates shape/compatibility only. Pins and hook IDs need a trusted catalog. */
export function validateDescriptor(input){
 const d=copy(input);
 shape(d,['contractVersion','ref','kind','module','schema','ownership','dependencies','lifecycle','compatibility'],'descriptor');
 check(d.contractVersion===1,'UNSUPPORTED_VERSION','contractVersion');ref(d.ref,'ref');
 check(kinds.includes(d.kind),'UNSUPPORTED_KIND','kind');pin(d.module,'module');pin(d.schema,'schema');
 shape(d.ownership,['data','assets'],'ownership');list(d.ownership.data,32,'ownership.data');list(d.ownership.assets,32,'ownership.assets');
 for(const row of d.ownership.data){
  shape(row,['id','classId','subject','export'],'ownership.data');id(row.id,'data.id');id(row.classId,'data.classId');
  check(['project','visitor'].includes(row.subject),'INVALID_SCOPE','data.subject');
  check(['eligible','separate-approval','excluded'].includes(row.export),'INVALID_EXPORT','data.export');
  check(row.subject!=='visitor'||row.export!=='eligible','INVALID_EXPORT','visitor data requires separate approval');
 }
 unique(d.ownership.data.map(x=>x.id),'ownership.data');
 for(const asset of d.ownership.assets){ref(asset,'asset');check(asset.projectId===d.ref.projectId,'CROSS_PROJECT','asset');check(key(asset)!==key(d.ref),'SELF_REFERENCE','asset');}
 unique(d.ownership.assets.map(key),'ownership.assets');
 list(d.dependencies,16,'dependencies');
 for(const dep of d.dependencies){
  shape(dep,['ref','module'],'dependency');ref(dep.ref,'dependency.ref');pin(dep.module,'dependency.module');
  check(dep.ref.projectId===d.ref.projectId,'CROSS_PROJECT','dependency');check(key(dep.ref)!==key(d.ref),'SELF_REFERENCE','dependency');
 }
 unique(d.dependencies.map(x=>key(x.ref)),'dependencies');
 shape(d.lifecycle,['exportFormat','exportHook','deleteHook','restoreHook','migrateHook','portability'],'lifecycle');
 check(d.lifecycle.exportFormat===1,'UNSUPPORTED_VERSION','exportFormat');
 for(const name of ['deleteHook','restoreHook','migrateHook'])id(d.lifecycle[name],name);
 if(d.lifecycle.exportHook!==null)id(d.lifecycle.exportHook,'exportHook');
 check(d.lifecycle.exportHook!==null||(!d.ownership.assets.length&&d.ownership.data.every(x=>x.export==='excluded')),'MISSING_EXPORT_HOOK','exportHook');
 check(['not-verified','adapter-required','platform-only'].includes(d.lifecycle.portability),'UNVERIFIED_PORTABILITY','portability');
 shape(d.compatibility,['readSchemas','restoreSchemas'],'compatibility');
 for(const name of ['readSchemas','restoreSchemas']){
  const pins=d.compatibility[name];list(pins,8,name);check(pins.length>0,'INVALID_LIST',name);
  for(const p of pins){pin(p,name);check(p.name===d.schema.name,'INCOMPATIBLE_SCHEMA',name);}
  unique(pins.map(p=>p.version),name);
  check(pins.some(p=>equal(p,d.schema)),'INCOMPATIBLE_SCHEMA',name);
 }
 for(const p of d.compatibility.restoreSchemas)check(d.compatibility.readSchemas.some(r=>equal(r,p)),'INCOMPATIBLE_SCHEMA','restoreSchemas');
 return d;
}

/** A trusted fixture manifest, never a caller-supplied authority/catalog in the running product. */
export function validateManifest(inputs){
 list(inputs,64,'manifest');const rows=inputs.map(validateDescriptor),byRef=new Map(rows.map(d=>[key(d.ref),d]));
 unique(rows.map(d=>key(d.ref)),'manifest');
 for(const row of rows){
  for(const dep of row.dependencies){const target=byRef.get(key(dep.ref));check(target&&equal(dep.module,target.module),'DEPENDENCY_MISMATCH','dependency');}
  for(const asset of row.ownership.assets){
   const target=byRef.get(key(asset));check(target?.kind==='files','ASSET_MISMATCH','asset');
   check(row.dependencies.some(d=>key(d.ref)===key(asset)),'DEPENDENCY_MISMATCH','asset pin');
  }
 }
 const visiting=new Set(),done=new Set();
 function visit(row){const k=key(row.ref);check(!visiting.has(k),'DEPENDENCY_CYCLE','manifest');if(done.has(k))return;visiting.add(k);for(const d of row.dependencies)visit(byRef.get(key(d.ref)));visiting.delete(k);done.add(k);}
 for(const row of rows)visit(row);
 return rows;
}

/** Compatibility is NOT admission. Both adapter offers are trusted fixtures, with no provider locators. */
export function adapterCompatibility(descriptor,input){
 const d=validateDescriptor(descriptor),offer=copy(input);
 shape(offer,['ref','adapter','kinds','module','schema'],'offer');ref(offer.ref,'offer.ref');id(offer.adapter,'adapter');
 list(offer.kinds,kinds.length,'offer.kinds');check(offer.kinds.every(k=>kinds.includes(k)),'UNSUPPORTED_KIND','offer.kinds');
 pin(offer.module,'offer.module');pin(offer.schema,'offer.schema');
 check(equal(d.ref,offer.ref),'CROSS_PROJECT','offer.ref');
 check(offer.kinds.includes(d.kind),'INCOMPATIBLE_ADAPTER','offer.kind');
 check(equal(d.module,offer.module),'MODULE_MISMATCH','offer.module');
 // The initial decision admits exact schema only. A migration is a separate reviewed operation.
 check(equal(d.schema,offer.schema),'SCHEMA_MISMATCH','offer.schema');
 return {compatible:true,ref:d.ref,descriptorDigest:descriptorDigest(d),adapter:offer.adapter,authority:'not-granted'};
}

/** Synthetic workload classifier; callers cannot purchase, publish, or dispatch from its output. */
export function choosePlacement(input){
 const w=copy(input);
 shape(w,['version','behavior','sourceBytes','inputBytes','outputBytes','network','native','persistent','boundedWork','maintainer','rawConnection'],'workload');
 check(w.version===1,'UNSUPPORTED_VERSION','workload.version');
 check(['static','maintained-api','custom'].includes(w.behavior),'UNSUPPORTED_KIND','behavior');
 for(const name of ['sourceBytes','inputBytes','outputBytes'])integer(w[name],name);
 for(const name of ['network','native','persistent','boundedWork','maintainer','rawConnection'])check(typeof w[name]==='boolean','INVALID_SHAPE',name);
 check(!w.maintainer,'MAINTAINER_FORBIDDEN','visitor/runtime path');
 check(!w.rawConnection,'RAW_CONNECTION_FORBIDDEN','guest database access');
 const result=(candidate,requires)=>({candidate,requires,activation:'not-granted'});
 if(w.behavior!=='custom'){
  check(!w.sourceBytes&&!w.network&&!w.native&&!w.persistent&&w.boundedWork,'INCOMPATIBLE_WORKLOAD','maintained behavior');
  return w.behavior==='static'?result('current-site-host',['publication-and-safety']):result('shared-maintained-api',['delivered-capability','current-scoped-authority']);
 }
 check(w.sourceBytes>0,'INVALID_NUMBER','custom source');
 if(w.native||w.persistent)return result('container-or-vm-review',['measured-need','entitlement','full-cost','isolation-and-lifecycle','explicit-activation']);
 // Public/private source intake is stricter than the isolated engine's 32768-byte source ceiling.
 if(!w.network&&w.boundedWork&&w.sourceBytes<=8192&&w.inputBytes<=8192&&w.outputBytes<=16384)
  return result('current-quickjs',['existing-gateway-budgets','exact-version-review','current-scoped-authority']);
 return result('broader-isolation-review',['capability-gap','workers-for-platforms-or-dynamic-worker-comparison','entitlement','full-cost','isolation-and-lifecycle','explicit-activation']);
}

/** Marginal resource estimate, not a customer quote. Shared allowances are intentionally not deducted. */
export function containerResourceCost({hours,vcpu,memoryGiB,diskGB,cpuUtilization}){
 for(const v of [hours,vcpu,memoryGiB,diskGB,cpuUtilization])check(Number.isFinite(v)&&v>=0,'INVALID_NUMBER','cost');
 check(cpuUtilization<=1,'INVALID_NUMBER','utilization');
 const seconds=hours*3600;
 return {cpu:seconds*vcpu*cpuUtilization*0.000020,memory:seconds*memoryGiB*0.0000025,disk:seconds*diskGB*0.00000007};
}
