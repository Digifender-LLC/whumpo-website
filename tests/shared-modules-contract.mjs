import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {admitInstance,decide,instanceDigest,moduleKinds,validateInstance,validatePrincipal,validateRequest} from '../tools/prototypes/shared-modules.mjs';

// WH-123 offline shape/policy checks. Benign invented UUIDs only: no database, HTTP, model, provider or guest code.
// These prove the frozen contract examples, not runtime authorization; WH-125–130 must test actual handlers.
const project='11111111-1111-4111-8111-111111111111',otherProject='22222222-2222-4222-8222-222222222222';
const resource=n=>`33333333-3333-4333-8333-${String(n).padStart(12,'0')}`;
const visitorId='44444444-4444-4444-8444-444444444444',ownerId='55555555-5555-4555-8555-555555555555';
const pin=(name,digest='a'.repeat(64))=>({name,version:1,digest});
const accessRef={projectId:project,resourceId:resource(9)};
function descriptor(kind,n=1,deps=[{ref:{...accessRef},module:pin(moduleKinds.access.module)}]){
 return {contractVersion:1,ref:{projectId:project,resourceId:resource(n)},kind,module:pin(moduleKinds[kind].module),schema:pin(moduleKinds[kind].schema),
  ownership:{data:[{id:'primary',classId:`module-${kind}`,subject:kind==='records'?'visitor':'project',export:kind==='records'?'separate-approval':'eligible'}],assets:[]},
  dependencies:kind==='access'||kind==='content'?[]:deps,
  lifecycle:{exportFormat:1,exportHook:`${kind}-export-v1`,deleteHook:`${kind}-delete-v1`,restoreHook:`${kind}-restore-v1`,migrateHook:`${kind}-migrate-v1`,portability:'not-verified'}};
}
const source={specificationVersionId:'66666666-6666-4666-8666-666666666666',specificationDigest:'b'.repeat(64)};
const records=()=>({contractVersion:1,descriptor:descriptor('records'),configRevision:3,source,config:{
 retentionDays:90,
 schemas:[{id:'appointment',fieldsRevision:2,staffWrite:['status'],fields:[
  {key:'name',label:'Name',type:'text',optional:false,read:'submitter'},
  {key:'vehicle',label:'Vehicle',type:'text',optional:true,read:'submitter'},
  {key:'status',label:'Status',type:'choice',optional:true,read:'staff'},
  {key:'notes',label:'Owner notes',type:'text',optional:true,read:'owner'}]}],
 forms:[{id:'request',recordId:'appointment',submit:'public',uploadCollectionId:null},{id:'members',recordId:'appointment',submit:'visitor',uploadCollectionId:'uploads'}],
 views:[{id:'queue',recordId:'appointment',audience:'staff',scope:'all',fields:['name','vehicle','status'],limit:50},
  {id:'mine',recordId:'appointment',audience:'visitor',scope:'own',fields:['name','vehicle'],limit:10}]}});
const files=()=>({contractVersion:1,descriptor:descriptor('files',2),configRevision:1,source,config:{collections:[
 {id:'uploads',read:'staff',upload:['staff'],maxBytes:1048576,mediaTypes:['image/jpeg'],gallery:{audience:'staff'}}]}});
const access=()=>({contractVersion:1,descriptor:descriptor('access',9),configRevision:1,source,config:{roles:['staff'],enrollment:'invitation'}});
const content=()=>({contractVersion:1,descriptor:descriptor('content',4),configRevision:1,source,config:{collections:[{id:'directory',type:'directory-listing@1'}]}});
const owner={kind:'owner',userId:ownerId,projectId:project};
const visitor={kind:'visitor',projectId:project,visitorId,roles:[],accessRevision:4};
const staff={...visitor,roles:['staff']};
const anonymous={kind:'public',projectId:project};

let count=0;
function test(name,fn){try{fn();count++;}catch(error){throw new Error(name,{cause:error});}}
const rejects=(fn,code)=>assert.throws(fn,e=>e.code===code);
const invalid=(name,make,mutate,code,validator=validateInstance)=>test(name,()=>{const v=make();mutate(v);rejects(()=>validator(v),code);});
const allowed=(...a)=>decide(...a).decision==='allow';
const reason=(...a)=>decide(...a).reason;

// Instance envelope.
for(const [name,make] of Object.entries({records,files,access,content}))test(`${name} instance valid and canonical`,()=>{
 const i=make(),valid=validateInstance(i);assert.deepEqual(valid,i);assert.notEqual(valid,i);
 assert.equal(instanceDigest(i),instanceDigest(Object.fromEntries(Object.entries(i).reverse())));
 const changed=structuredClone(i);changed.configRevision++;assert.notEqual(instanceDigest(i),instanceDigest(changed));
});
invalid('future instance contract',records,i=>i.contractVersion=2,'UNSUPPORTED_VERSION');
invalid('retired compatibility list',records,i=>i.compatibility={readSchemas:[]},'UNKNOWN_FIELD');
invalid('physical locator in config',files,i=>i.config.collections[0].bucket='private-files','UNKNOWN_FIELD');
invalid('path prefix authorization rejected',files,i=>i.config.collections[0].prefix='staff/','UNKNOWN_FIELD');
invalid('public bucket read audience rejected',files,i=>i.config.collections[0].read='public','INVALID_AUDIENCE');
invalid('anonymous upload audience rejected',files,i=>i.config.collections[0].upload=['public'],'INVALID_AUDIENCE');
invalid('unimplemented PNG intake not declared',files,i=>i.config.collections[0].mediaTypes=['image/jpeg','image/png'],'UNSUPPORTED_MEDIA');
invalid('size above current cleaned JPEG bound',files,i=>i.config.collections[0].maxBytes=5*1048576,'INVALID_NUMBER');
invalid('gallery wider than read policy',files,i=>i.config.collections[0].gallery={audience:'visitor'},'FIELD_FORBIDDEN');
invalid('role-based files need access instance',files,i=>i.descriptor.dependencies=[],'MISSING_DEPENDENCY');
invalid('visitor forms need access instance',records,i=>i.descriptor.dependencies=[],'MISSING_DEPENDENCY');
invalid('owner-only field in staff view',records,i=>i.config.views[0].fields.push('notes'),'FIELD_FORBIDDEN');
invalid('staff field in visitor view',records,i=>i.config.views[1].fields.push('status'),'FIELD_FORBIDDEN');
invalid('visitor view of all records',records,i=>i.config.views[1].scope='all','INVALID_SCOPE');
invalid('staff write on owner-only field',records,i=>i.config.schemas[0].staffWrite=['notes'],'INVALID_AUDIENCE');
invalid('public attachment intake',records,i=>i.config.forms[0].uploadCollectionId='uploads','INCOMPATIBLE');
invalid('form to unknown record',records,i=>i.config.forms[0].recordId='missing','MISSING_REFERENCE');
invalid('arbitrary field type',records,i=>i.config.schemas[0].fields[0].type='sql','UNSUPPORTED_FIELD');
invalid('retention outside owner-selectable windows',records,i=>i.config.retentionDays=400,'UNSUPPORTED_RETENTION');
invalid('roles beyond staff',access,i=>i.config.roles=['admin'],'UNSUPPORTED_ROLE');
invalid('workspace role reuse',access,i=>i.config.roles=['editor'],'UNSUPPORTED_ROLE');
invalid('open self-enrollment not frozen',access,i=>i.config.enrollment='open','UNSUPPORTED_ENROLLMENT');
invalid('booking collection not offered',content,i=>i.config.collections[0].type='booking@1','UNSUPPORTED_COLLECTION');
invalid('module/kind mismatch',records,i=>i.descriptor.module.name='module-files','MODULE_MISMATCH');
invalid('unknown module version',records,i=>i.descriptor.module.version=2,'MODULE_MISMATCH');
invalid('floating module pin',records,i=>i.descriptor.module.version='latest','INVALID_NUMBER');
invalid('custom-function is not a WH-067 module kind',records,i=>{i.descriptor.kind='custom-function';},'UNSUPPORTED_KIND');
invalid('foreign access dependency',records,i=>i.descriptor.dependencies[0].ref.projectId=otherProject,'CROSS_PROJECT');

// Catalog admission: exact current pins only; no old reader.
const catalog=[{kind:'records',state:'available',module:pin('module-records'),schema:pin('records-data')}];
test('exact catalog pin admitted without granting authority',()=>assert.equal(admitInstance(records(),catalog).authority,'not-granted'));
test('stale module digest rejected',()=>rejects(()=>admitInstance(records(),[{...catalog[0],module:pin('module-records','c'.repeat(64))}]),'STALE_MODULE_VERSION'));
test('stale storage schema rejected',()=>rejects(()=>admitInstance(records(),[{...catalog[0],schema:pin('records-data','d'.repeat(64))}]),'STALE_MODULE_VERSION'));
test('withdrawn module unavailable',()=>rejects(()=>admitInstance(records(),[{...catalog[0],state:'withdrawn'}]),'UNAVAILABLE'));
test('unregistered kind unavailable',()=>rejects(()=>admitInstance(files(),catalog),'UNAVAILABLE'));

// Request envelope for direct/custom frontends.
const request=(over={})=>({api:'whumpo-modules',version:1,operation:'forms.submit',resourceId:resource(1),configRevision:3,requestId:'77777777-7777-4777-8777-777777777777',target:{formId:'request'},input:{answers:{name:'Synthetic'}},...over});
test('current write request valid',()=>assert.equal(validateRequest(request()).operation,'forms.submit'));
test('read carries no request ID',()=>assert.equal(validateRequest(request({operation:'records.view',requestId:null,target:{viewId:'queue'},input:null})).requestId,null));
invalid('old client version',request,r=>r.version=0,'CLIENT_UPDATE_REQUIRED',validateRequest);
invalid('missing API marker',request,r=>delete r.api,'CLIENT_UPDATE_REQUIRED',validateRequest);
invalid('unknown operation',request,r=>r.operation='records.query','UNSUPPORTED_OPERATION',validateRequest);
invalid('write without request ID',request,r=>r.requestId=null,'INVALID_ID',validateRequest);
invalid('stale-shaped revision',request,r=>r.configRevision=0,'INVALID_NUMBER',validateRequest);
for(const field of ['projectId','ownerId','visitorId','role','approved','prefix','bucket','sql'])
 invalid(`caller cannot supply ${field}`,request,r=>r.input[field]='x','AUTHORITY_FIELD',validateRequest);
invalid('extra envelope field',request,r=>r.session='token','UNKNOWN_FIELD',validateRequest);

// Principals.
invalid('workspace member is not a module principal',()=>({kind:'member',userId:ownerId,projectId:project,role:'editor'}),()=>{},'RESTRICTED_PRINCIPAL',validatePrincipal);
invalid('maintainer job is not a module principal',()=>({kind:'job',projectId:project,jobId:visitorId,purpose:'owner-maintenance'}),()=>{},'RESTRICTED_PRINCIPAL',validatePrincipal);
invalid('visitor cannot hold admin role',()=>({...staff,roles:['admin']}),()=>{},'UNSUPPORTED_ROLE',validatePrincipal);

// Policy table.
test('public form accepts anonymous and visitor',()=>{assert.ok(allowed(anonymous,records(),'forms.submit',{formId:'request'}));assert.ok(allowed(visitor,records(),'forms.submit',{formId:'request'}));});
test('visitor form requires sign-in',()=>assert.equal(reason(anonymous,records(),'forms.submit',{formId:'members'}),'sign_in_required'));
test('foreign project is not found',()=>assert.equal(reason({...staff,projectId:otherProject},records(),'records.view',{viewId:'queue'}),'not_found'));
test('staff queue view denied to plain visitor',()=>assert.equal(reason(visitor,records(),'records.view',{viewId:'queue'}),'forbidden'));
test('staff queue view projects allowed fields only',()=>assert.deepEqual(decide(staff,records(),'records.view',{viewId:'queue'}).fields.fields,['name','vehicle','status']));
test('visitor own view is own-scoped',()=>assert.equal(decide(visitor,records(),'records.view',{viewId:'mine'}).fields.scope,'own'));
test('visitor record read excludes staff/owner fields',()=>assert.deepEqual(decide(visitor,records(),'records.get',{recordId:'appointment'}).fields,{fields:['name','vehicle'],scope:'own'}));
test('staff record read excludes owner field',()=>assert.ok(!decide(staff,records(),'records.get',{recordId:'appointment'}).fields.fields.includes('notes')));
test('staff updates only staff-writable fields',()=>{
 assert.ok(allowed(staff,records(),'records.update',{recordId:'appointment',changes:{status:'done'}}));
 assert.equal(reason(staff,records(),'records.update',{recordId:'appointment',changes:{notes:'x'}}),'field_forbidden');
 assert.equal(reason(visitor,records(),'records.update',{recordId:'appointment',changes:{status:'done'}}),'forbidden');
});
test('only owner removes records',()=>{assert.ok(allowed(owner,records(),'records.remove',{}));assert.equal(reason(staff,records(),'records.remove',{}),'forbidden');});
test('staff-only upload is a role policy',()=>{
 assert.ok(allowed(staff,files(),'files.putBytes',{collectionId:'uploads'}));
 assert.equal(reason(visitor,files(),'files.putBytes',{collectionId:'uploads'}),'forbidden');
 assert.equal(reason(visitor,files(),'files.putBytes',{collectionId:'uploads',name:'staff/photo.jpg'}),'forbidden');
 assert.equal(reason(anonymous,files(),'files.putBytes',{collectionId:'uploads'}),'sign_in_required');
 assert.equal(reason(owner,files(),'files.putBytes',{collectionId:'uploads'}),'forbidden');
});
test('file reads only expose approved bytes',()=>{for(const p of [owner,staff])assert.equal(decide(p,files(),'files.read',{collectionId:'uploads'}).fields.clearance,'approved-only');});
test('revoked staff role loses access on the next decision',()=>assert.equal(reason({...staff,roles:[],accessRevision:5},files(),'files.gallery',{collectionId:'uploads'}),'forbidden'));
test('retired file operations require a current client',()=>{for(const operation of ['files.prepareUpload','files.requestRemoval'])rejects(()=>validateRequest(request({operation})),'UNSUPPORTED_OPERATION');});
test('role grants are owner reviews; staff cannot grant',()=>{assert.equal(decide(owner,access(),'access.prepareRole',{}).fields.review,'exact-owner-review');assert.equal(reason(staff,access(),'access.confirmRole',{}),'forbidden');});
test('public collection serves approved snapshot only',()=>assert.equal(decide(anonymous,content(),'collections.readPublic',{}).fields.snapshot,'approved-public-only'));
test('operation must match instance kind',()=>rejects(()=>decide(staff,files(),'records.view',{viewId:'queue'}),'UNSUPPORTED_OPERATION'));
test('every allow is inference-free',()=>assert.equal(decide(staff,records(),'records.view',{viewId:'queue'}).inference,'none'));

// Contract document anchors.
const doc=readFileSync(new URL('../docs/shared-modules.md',import.meta.url),'utf8');
test('document names the frozen anchors',()=>{for(const anchor of ['whumpo-modules','module-records','module-files','module-access','module-collections','client_update_required','stale_configuration','tools/prototypes/shared-modules.mjs'])assert.ok(doc.includes(anchor),anchor);});

console.log(`shared-modules contract: ${count} offline checks passed`);
