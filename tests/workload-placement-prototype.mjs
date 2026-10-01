import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {adapterCompatibility,choosePlacement,containerResourceCost,descriptorDigest,validateDescriptor,validateManifest} from '../tools/prototypes/workload-placement.mjs';

// Benign in-memory fixtures only. No customer rows, model, provider, database, or guest code.
const project='11111111-1111-4111-8111-111111111111';
const otherProject='22222222-2222-4222-8222-222222222222';
const resource=n=>`33333333-3333-4333-8333-${String(n).padStart(12,'0')}`;
const pin=(name,version=1,digest='a'.repeat(64))=>({name,version,digest});
function descriptor(kind='records',n=1){
 const schema=pin(`${kind}-data`);
 return {contractVersion:1,ref:{projectId:project,resourceId:resource(n)},kind,module:pin(kind),schema,
  ownership:{data:[{id:'primary',classId:'project-data',subject:'project',export:'eligible'}],assets:[]},dependencies:[],
  lifecycle:{exportFormat:1,exportHook:'export-v1',deleteHook:'delete-v1',restoreHook:'restore-v1',migrateHook:'migrate-v1',portability:'not-verified'}};
}
const copy=x=>structuredClone(x);
const offer=(d,adapter='shared-d1-v1')=>({ref:copy(d.ref),adapter,kinds:[d.kind],module:copy(d.module),schema:copy(d.schema)});
let count=0;
function test(name,fn){fn();count++;}
const rejects=(fn,code)=>assert.throws(fn,e=>e.code===code);
function invalid(name,mutate,code){test(name,()=>{const d=descriptor();mutate(d);rejects(()=>validateDescriptor(d),code);});}

test('descriptor copied, canonical digest ignores key order',()=>{
 const d=descriptor(),valid=validateDescriptor(d);assert.deepEqual(valid,d);assert.notEqual(valid,d);
 const reordered=Object.fromEntries(Object.entries(d).reverse());assert.equal(descriptorDigest(d),descriptorDigest(reordered));
 valid.ownership.data[0].id='changed';assert.equal(d.ownership.data[0].id,'primary');
 assert.notEqual(descriptorDigest(d),descriptorDigest(valid));
});
invalid('future descriptor version',d=>d.contractVersion=2,'UNSUPPORTED_VERSION');
invalid('provider locator cannot enter descriptor',d=>d.databaseId='provider-id','UNKNOWN_FIELD');
invalid('owner identity is not stable resource identity',d=>d.ref.ownerId=project,'UNKNOWN_FIELD');
invalid('credentials cannot enter module pin',d=>d.module.secret='synthetic','UNKNOWN_FIELD');
invalid('unpinned module version',d=>d.module.version='latest','INVALID_NUMBER');
invalid('zero version',d=>d.schema.version=0,'UNSUPPORTED_VERSION');
invalid('non-hash module pin',d=>d.module.digest='latest','INVALID_DIGEST');
invalid('unknown resource kind',d=>d.kind='raw-sql','UNSUPPORTED_KIND');
invalid('missing lifecycle',d=>delete d.lifecycle,'MISSING_FIELD');
invalid('no deletion hook',d=>d.lifecycle.deleteHook=null,'INVALID_ID');
invalid('hook cannot be an executable URL',d=>d.lifecycle.restoreHook='https://example.invalid/restore','INVALID_ID');
invalid('exportable data needs a hook',d=>d.lifecycle.exportHook=null,'MISSING_EXPORT_HOOK');
invalid('portability cannot claim untested standalone',d=>d.lifecycle.portability='standalone','UNVERIFIED_PORTABILITY');
invalid('visitor data requires separate approval',d=>d.ownership.data[0].subject='visitor','INVALID_EXPORT');
invalid('duplicate data set',d=>d.ownership.data.push(copy(d.ownership.data[0])),'DUPLICATE');
invalid('retired schema compatibility descriptor rejected',d=>d.compatibility={readSchemas:[d.schema],restoreSchemas:[d.schema]},'UNKNOWN_FIELD');
invalid('old read schema list rejected',d=>d.readSchemas=[pin('records-data',1),pin('records-data',2)],'UNKNOWN_FIELD');
invalid('old restore schema list rejected',d=>d.restoreSchemas=[pin('records-data',1)],'UNKNOWN_FIELD');
invalid('foreign asset reference',d=>d.ownership.assets.push({projectId:otherProject,resourceId:resource(2)}),'CROSS_PROJECT');
invalid('foreign dependency',d=>d.dependencies.push({ref:{projectId:otherProject,resourceId:resource(2)},module:pin('files')}),'CROSS_PROJECT');
invalid('self dependency',d=>d.dependencies.push({ref:copy(d.ref),module:copy(d.module)}),'SELF_REFERENCE');
invalid('oversized descriptor',d=>d.extra='x'.repeat(32768),'TOO_LARGE');
test('private visitor export with one pinned current schema',()=>{
 const d=descriptor();d.ownership.data[0].subject='visitor';d.ownership.data[0].export='separate-approval';
 d.schema=pin('records-data',2);
 assert.equal(validateDescriptor(d).schema.version,2);
});
test('excluded data needs no export hook',()=>{
 const d=descriptor('access');d.ownership.data[0].export='excluded';d.lifecycle.exportHook=null;
 assert.equal(validateDescriptor(d).lifecycle.exportHook,null);
});

function manifest(){
 const content=descriptor('content',1),files=descriptor('files',2);
 content.ownership.assets=[copy(files.ref)];content.dependencies=[{ref:copy(files.ref),module:copy(files.module)}];
 return [content,files];
}
test('content and files share pinned logical manifest',()=>assert.equal(validateManifest(manifest()).length,2));
test('missing dependency',()=>rejects(()=>validateManifest([manifest()[0]]),'DEPENDENCY_MISMATCH'));
test('duplicate resource',()=>rejects(()=>validateManifest([descriptor(),descriptor()]),'DUPLICATE'));
test('dependency bytes drift',()=>{const ds=manifest();ds[1].module.digest='b'.repeat(64);rejects(()=>validateManifest(ds),'DEPENDENCY_MISMATCH');});
test('assets must target files module',()=>{const ds=manifest();ds[1].kind='records';rejects(()=>validateManifest(ds),'ASSET_MISMATCH');});
test('asset dependency pin required',()=>{const ds=manifest();ds[0].dependencies=[];rejects(()=>validateManifest(ds),'DEPENDENCY_MISMATCH');});
test('cyclic dependency rejected',()=>{const ds=manifest();ds[1].dependencies=[{ref:copy(ds[0].ref),module:copy(ds[0].module)}];rejects(()=>validateManifest(ds),'DEPENDENCY_CYCLE');});
test('separate projects with same local resource UUID do not collide',()=>{
 const a=descriptor(),b=descriptor();b.ref.projectId=otherProject;assert.equal(validateManifest([a,b]).length,2);
});

test('shared and project database adapters preserve logical identities and digest',()=>{
 const d=descriptor();const old=adapterCompatibility(d,offer(d));const next=adapterCompatibility(d,offer(d,'project-d1-v1'));
 assert.equal(old.descriptorDigest,next.descriptorDigest);assert.deepEqual(old.ref,next.ref);
 assert.equal(old.authority,'not-granted');assert.equal(next.authority,'not-granted');
});
test('cross-project adapter rejected',()=>{const d=descriptor(),o=offer(d);o.ref.projectId=otherProject;rejects(()=>adapterCompatibility(d,o),'CROSS_PROJECT');});
test('same project wrong resource rejected',()=>{const d=descriptor(),o=offer(d);o.ref.resourceId=resource(9);rejects(()=>adapterCompatibility(d,o),'CROSS_PROJECT');});
test('adapter capability rejected',()=>{const d=descriptor(),o=offer(d);o.kinds=['files'];rejects(()=>adapterCompatibility(d,o),'INCOMPATIBLE_ADAPTER');});
test('module replacement is not placement',()=>{const d=descriptor(),o=offer(d);o.module.digest='b'.repeat(64);rejects(()=>adapterCompatibility(d,o),'MODULE_MISMATCH');});
test('both older and newer adapter schemas reject',()=>{
 const d=descriptor();d.schema=pin('records-data',2);
 for(const version of [1,3]){const o=offer(d);o.schema=pin('records-data',version);rejects(()=>adapterCompatibility(d,o),'SCHEMA_MISMATCH');}
});
test('same schema version with changed bytes rejects',()=>{
 const d=descriptor(),o=offer(d);o.schema.digest='b'.repeat(64);rejects(()=>adapterCompatibility(d,o),'SCHEMA_MISMATCH');
});
test('physical locator not part of public adapter offer',()=>{const d=descriptor(),o=offer(d);o.connection='synthetic';rejects(()=>adapterCompatibility(d,o),'UNKNOWN_FIELD');});

const workload=(overrides={})=>({version:1,behavior:'custom',sourceBytes:1024,inputBytes:256,outputBytes:256,network:false,native:false,persistent:false,boundedWork:true,maintainer:false,rawConnection:false,...overrides});
const cases=[
 ['static landscaping site',{behavior:'static',sourceBytes:0},'current-site-host'],
 ['maintained contact API',{behavior:'maintained-api',sourceBytes:0},'shared-maintained-api'],
 ['small calculator',{},'current-quickjs'],
 ['source intake boundary',{sourceBytes:8192},'current-quickjs'],
 ['engine capacity does not enlarge intake',{sourceBytes:8193},'broader-isolation-review'],
 ['oversize input',{inputBytes:8193},'broader-isolation-review'],
 ['oversize output',{outputBytes:16385},'broader-isolation-review'],
 ['outbound requirement',{network:true},'broader-isolation-review'],
 ['unbounded computation',{boundedWork:false},'broader-isolation-review'],
 ['native video batch',{native:true},'container-or-vm-review'],
 ['persistent process',{persistent:true},'container-or-vm-review']
];
for(const [name,overrides,expected] of cases)test(name,()=>{
 const actual=choosePlacement(workload(overrides));assert.equal(actual.candidate,expected);assert.equal(actual.activation,'not-granted');assert(actual.requires.length);
});
test('visitor cannot invoke maintainer',()=>rejects(()=>choosePlacement(workload({maintainer:true})),'MAINTAINER_FORBIDDEN'));
test('raw all-tenant database access forbidden',()=>rejects(()=>choosePlacement(workload({rawConnection:true})),'RAW_CONNECTION_FORBIDDEN'));
test('custom source cannot claim maintained/static class',()=>rejects(()=>choosePlacement(workload({behavior:'static'})),'INCOMPATIBLE_WORKLOAD'));
test('caller cannot inject provider activation flag',()=>rejects(()=>choosePlacement(workload({approved:true})),'UNKNOWN_FIELD'));
test('negative and unbounded dimensions rejected',()=>{for(const sourceBytes of [-1,Infinity,NaN,1.5])rejects(()=>choosePlacement(workload({sourceBytes})),'INVALID_NUMBER');});
test('declared workload requires source',()=>rejects(()=>choosePlacement(workload({sourceBytes:0})),'INVALID_NUMBER'));

test('current source anchors: engine/gateway limits and service boundary',()=>{
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
 const runtime=read('src/runtime/worker.ts');
 for(const literal of ['sourceBytes:32768','inputBytes:8192','outputBytes:16384','heapBytes:4*1024*1024'])assert(runtime.includes(literal),`reconcile placement against ${literal}`);
 assert(read('src/backend-versions.ts').includes('size(source)>8192'));
 const config=read('wrangler.runtime.jsonc');assert.match(config,/"workers_dev":\s*false/);assert.doesNotMatch(config,/"(?:d1_databases|r2_buckets|vars|services|durable_objects)"\s*:/);
});
test('marginal container examples account for provisioned memory/disk when CPU idle',()=>{
 const estimate=(hours,cpuUtilization)=>Object.values(containerResourceCost({hours,vcpu:0.25,memoryGiB:1,diskGB:4,cpuUtilization})).reduce((a,b)=>a+b,0);
 assert(Math.abs(estimate(720,1)-20.16576)<1e-8);
 assert(Math.abs(estimate(72,1)-2.016576)<1e-8);
 assert(Math.abs(estimate(720,0)-7.20576)<1e-8);
 rejects(()=>containerResourceCost({hours:720,vcpu:0.25,memoryGiB:1,diskGB:4,cpuUtilization:1.01}),'INVALID_NUMBER');
});
console.log(`WH-071: ${count} offline contract/scenario checks passed; no runtime admission, provisioning, migration, or export acceptance.`);
