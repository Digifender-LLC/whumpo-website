import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,copyFile,symlink,rm} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {checkSpecificationCompiler} from '../tools/check-specification-compiler.mjs';
Error.stackTraceLimit=0;

const checked=await checkSpecificationCompiler();
const bundle=await build({stdin:{contents:`export * from './src/project-specification/compiler';export * from './src/project-specification/catalog';export * from './src/project-specification/v3/schema';export {moduleKinds,recordsRetention,classifyModuleChange} from './src/project-specification/v3/modules';export * from './src/project-specification/v2/json';export {siteConfig,renderSite,renderPhotoPage} from './src/components';export {backendFormConfig} from './src/backend-form-config';`,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'neutral',write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].contents).toString('base64'));
const detailing=JSON.parse(await readFile('tests/fixtures/project-specification/detailing.json','utf8'));
const clone=value=>structuredClone(value),hash=text=>createHash('sha256').update(text).digest('hex');
const lock=m.currentCompilerLock();
const content={...clone(detailing),modules:[{id:'content',version:2}],instances:[],integrations:[],rules:[]};
const rejects=(fn,code)=>assert.throws(fn,error=>error instanceof m.SpecificationError&&error.code===code,code);
const rejectsAsync=(fn,code)=>assert.rejects(fn,error=>error instanceof m.SpecificationError&&error.code===code,code);
const instance=(spec,id)=>spec.instances.find(i=>i.id===id);
const records=s=>instance(s,'appointments').config,files=s=>instance(s,'vehicle-photos').config.collections[0],access=s=>instance(s,'team').config;
let networkCalls=0;
let expectedManifestDigest;
const fetch=globalThis.fetch;globalThis.fetch=async()=>{networkCalls++;throw Error('Compiler attempted network/inference.');};
try{
 assert.deepEqual(m.validateSpecification(content),content);
 assert.deepEqual(m.validateSpecification(detailing),detailing);
 const decoded=m.validateSpecification(detailing);decoded.content[0].text='Mutable return';assert.notEqual(detailing.content[0].text,decoded.content[0].text);
 // The fixture carries the exact trusted pins; a compiler identity cutover must update it, never a fallback.
 for(const i of detailing.instances){const entry=m.moduleCatalog.find(e=>e.kind===i.kind);assert.deepEqual(i.module,entry.module);assert.deepEqual(i.schema,entry.schema);}
 assert.deepEqual(m.moduleCatalog.map(e=>[e.kind,e.module.name,e.schema.name,e.state]),Object.entries(m.moduleKinds).map(([kind,n])=>[kind,n.module,n.schema,'available']));
 const negatives=[
  ['UNKNOWN_FIELD',s=>{s.ownerId='synthetic-private-marker';}],
  ['UNKNOWN_FIELD',s=>{s.design.css='synthetic-private-marker';}],
  ['UNKNOWN_FIELD',s=>{s.integrations[0].apiKey='synthetic-private-marker';}],
  ['MISSING_FIELD',s=>{delete s.name;}],
  ['UNSUPPORTED_VERSION',s=>{s.schemaVersion=1;}],
  // Schema 2 is retired: no reader, conversion or fallback, even with its old library sections.
  ['UNSUPPORTED_VERSION',s=>{s.schemaVersion=2;}],
  ['UNSUPPORTED_VERSION',s=>{s.schemaVersion=2;delete s.instances;Object.assign(s,{records:[],forms:[],files:[],access:{roles:[]}});}],
  ['UNKNOWN_FIELD',s=>{s.records=[];}],
  ['UNKNOWN_FIELD',s=>{s.access={roles:['staff']};}],
  ['UNSUPPORTED_VERSION',s=>{s.modules[0].version=1;}],
  ['UNKNOWN_MODULE',s=>{s.modules[0].id='downloaded-module';}],
  ['UNKNOWN_MODULE',s=>{s.modules[1]={id:'records',version:1};}],
  ['UNSUPPORTED_VERSION',s=>{s.pages[0].component='site-page@2';}],
  ['INCOMPATIBLE',s=>{s.modules=s.modules.filter(m=>m.id!=='notifications');}],
  ['DUPLICATE_ID',s=>{s.pages.push(clone(s.pages[0]));}],
  ['DUPLICATE_ID',s=>{s.content.push(clone(s.content[0]));}],
  ['DUPLICATE_ID',s=>{s.instances.push(clone(s.instances[0]));}],
  ['INVALID_SHAPE',s=>{s.content.push(null);}],
  ['MISSING_REFERENCE',s=>{s.pages[0].headline='missing';}],
  ['INCOMPATIBLE',s=>{s.pages[0].path='/api';}],
  ['INCOMPATIBLE',s=>{s.pages[0].path='/../secret';}],
  ['INVALID_TEXT',s=>{s.content[0].text='x'.repeat(1001);}],
  ['INVALID_TEXT',s=>{s.content[0].text='bad\u0000text';}],
  ['INVALID_ID',s=>{s.content[0].id='prototype';}],
  // Records configuration reuses the bounded form field validator.
  ['INCOMPATIBLE',s=>{records(s).schemas[0].fields.push({key:'constructor',label:'Reserved',type:'text',optional:true,read:'owner'});}],
  ['INCOMPATIBLE',s=>{records(s).schemas[0].fields.push(clone(records(s).schemas[0].fields[0]));}],
  ['INCOMPATIBLE',s=>{records(s).schemas[0].fields[0].type='number';records(s).schemas[0].fields[0].optional=true;}],
  ['UNSUPPORTED_FIELD',s=>{records(s).schemas[0].fields[0].type='sql';}],
  ['UNKNOWN_FIELD',s=>{records(s).schemas[0].fields[0].options=[];}],
  ['INVALID_LIST',s=>{records(s).schemas[0].fields=Array.from({length:9},(_,n)=>({key:'field'+n,label:'Field',type:'text',optional:true,read:'owner'}));}],
  ['UNSUPPORTED_RETENTION',s=>{records(s).retentionDays=400;}],
  ['UNSUPPORTED_RETENTION',s=>{records(s).retentionDays=7;}],
  // Media: cleaned JPEG up to 1 MiB only.
  ['UNSUPPORTED_MEDIA',s=>{files(s).mediaTypes=['image/jpeg','image/png'];}],
  ['UNSUPPORTED_MEDIA',s=>{files(s).mediaTypes=['image/png'];}],
  ['INVALID_NUMBER',s=>{files(s).maxBytes=1048577;}],
  ['INVALID_NUMBER',s=>{files(s).maxBytes=5*1024*1024;}],
  // Public read audiences are absent; public exposure happens only through publication reviews.
  ['INVALID_AUDIENCE',s=>{files(s).read='public';}],
  ['INVALID_AUDIENCE',s=>{files(s).upload=['public'];}],
  ['INVALID_AUDIENCE',s=>{files(s).gallery={audience:'public'};}],
  ['INVALID_AUDIENCE',s=>{records(s).schemas[0].fields[0].read='public';}],
  ['INVALID_AUDIENCE',s=>{records(s).views[0].audience='public';}],
  ['INVALID_AUDIENCE',s=>{records(s).forms[0].submit='anyone';}],
  // Roles: staff only; workspace roles are not project roles.
  ['UNSUPPORTED_ROLE',s=>{access(s).roles=['admin'];}],
  ['UNSUPPORTED_ROLE',s=>{access(s).roles=['editor'];}],
  ['INVALID_LIST',s=>{access(s).roles=['staff','staff'];}],
  ['UNSUPPORTED_ENROLLMENT',s=>{access(s).enrollment='open';}],
  // Over-wide projections.
  ['FIELD_FORBIDDEN',s=>{records(s).views[0].fields.push('details');}],
  ['FIELD_FORBIDDEN',s=>{records(s).views.push({id:'mine',recordId:'appointments',audience:'visitor',scope:'own',fields:['name'],limit:10});}],
  ['INVALID_SCOPE',s=>{records(s).schemas[0].fields[0].read='submitter';records(s).views.push({id:'mine',recordId:'appointments',audience:'visitor',scope:'all',fields:['name'],limit:10});}],
  ['INVALID_NUMBER',s=>{records(s).views[0].limit=51;}],
  ['FIELD_FORBIDDEN',s=>{files(s).gallery={audience:'staff'};}],
  ['INVALID_AUDIENCE',s=>{records(s).schemas[0].staffWrite=['details'];}],
  ['MISSING_REFERENCE',s=>{records(s).schemas[0].staffWrite=['missing'];}],
  // Missing access dependencies and references.
  ['MISSING_DEPENDENCY',s=>{instance(s,'vehicle-photos').dependencies=[];}],
  ['MISSING_DEPENDENCY',s=>{instance(s,'appointments').dependencies=['vehicle-photos'];}],
  ['MISSING_DEPENDENCY',s=>{instance(s,'appointments').dependencies=['team'];}],
  ['MISSING_DEPENDENCY',s=>{access(s).roles=[];}],
  ['MISSING_DEPENDENCY',s=>{s.instances=s.instances.map(i=>i.kind==='access'?{...i,config:{...i.config,roles:[]}}:i);instance(s,'appointments').config.views=[];instance(s,'appointments').config.schemas[0].fields.forEach(f=>{f.read='submitter';});}],
  ['MISSING_REFERENCE',s=>{instance(s,'appointments').dependencies=['team','missing'];}],
  ['INCOMPATIBLE',s=>{instance(s,'vehicle-photos').dependencies=['team','appointments'];}],
  ['INCOMPATIBLE',s=>{s.instances.push({...clone(instance(s,'team')),id:'second-team'});}],
  ['MISSING_REFERENCE',s=>{records(s).forms[0].recordId='missing';}],
  ['MISSING_REFERENCE',s=>{records(s).forms[0].uploadCollectionId='missing';}],
  ['INCOMPATIBLE',s=>{records(s).forms[0].submit='public';}],
  ['INCOMPATIBLE',s=>{records(s).forms[0].submit='staff';}],
  ['MISSING_REFERENCE',s=>{s.rules.push({id:'tell',trigger:{type:'form.accepted',formId:'missing'},effect:{type:'notification.send',integrationId:'team-email',recipient:'staff',template:'submission-link@1'}});}],
  ['INCOMPATIBLE',s=>{records(s).schemas[0].fields.forEach(f=>{f.read='owner';});records(s).views=[];s.rules.push({id:'tell',trigger:{type:'form.accepted',formId:'appointment-request'},effect:{type:'notification.send',integrationId:'team-email',recipient:'staff',template:'submission-link@1'}});}],
  // Exact pins and closed instance envelopes.
  ['MODULE_MISMATCH',s=>{instance(s,'appointments').module.name='module-files';}],
  ['SCHEMA_MISMATCH',s=>{instance(s,'appointments').schema.name='files-data';}],
  ['UNSUPPORTED_VERSION',s=>{instance(s,'appointments').module.version=2;}],
  ['INVALID_NUMBER',s=>{instance(s,'appointments').module.version='latest';}],
  ['INVALID_DIGEST',s=>{instance(s,'appointments').schema.digest='latest';}],
  ['UNSUPPORTED_KIND',s=>{instance(s,'appointments').kind='custom-function';}],
  ['UNKNOWN_FIELD',s=>{files(s).bucket='private-files';}],
  ['UNKNOWN_FIELD',s=>{files(s).prefix='staff/';}],
  ['UNKNOWN_FIELD',s=>{instance(s,'appointments').compatibility={readSchemas:[]};}],
  ['UNSUPPORTED_COLLECTION',s=>{s.instances.push({id:'directory',kind:'content',module:clone(m.moduleCatalog.find(e=>e.kind==='content').module),schema:clone(m.moduleCatalog.find(e=>e.kind==='content').schema),dependencies:[],config:{collections:[{id:'directory',type:'booking@1'}]}});}],
 ];
 for(const [code,mutate] of negatives){
  const value=clone(detailing);mutate(value);rejects(()=>m.validateSpecification(value),code);
  assert.throws(()=>m.validateSpecification(value),error=>!error.message.includes('synthetic-private-marker'));
 }
 // Staff upload and staff write are expressible configuration (not serving).
 const staffWork=clone(detailing);
 Object.assign(files(staffWork),{read:'staff',upload:['staff'],gallery:{audience:'staff'}});
 records(staffWork).schemas[0].fields.push({key:'status',label:'Status',type:'choice',optional:false,read:'staff',options:[{value:'new',label:'New'},{value:'done',label:'Done'}]});
 records(staffWork).schemas[0].staffWrite=['status'];records(staffWork).forms[0].submit='staff';records(staffWork).views[0].fields.push('status');
 assert.deepEqual(m.validateSpecification(staffWork),staffWork);
 const own=clone(detailing);records(own).schemas[0].fields[0].read='submitter';records(own).views.push({id:'mine',recordId:'appointments',audience:'visitor',scope:'own',fields:['name'],limit:10});m.validateSpecification(own);
 const contactLike={...clone(content),instances:[{id:'messages',kind:'records',module:clone(instance(detailing,'appointments').module),schema:clone(instance(detailing,'appointments').schema),dependencies:[],config:{retentionDays:30,schemas:[{id:'message',fieldsRevision:1,staffWrite:[],fields:[{key:'message',label:'Message',type:'text',optional:false,read:'owner'}]}],forms:[{id:'contact',recordId:'message',submit:'public',uploadCollectionId:null}],views:[]}}]};
 m.validateSpecification(contactLike); // Public intake to owner-only fields needs no access instance.
 const big=clone(content);big.content=Array.from({length:40},(_,n)=>({id:'copy-'+n,text:'x'.repeat(1000)}));rejects(()=>m.validateSpecification(big),'INPUT_TOO_LARGE');
 let deep={};for(let n=0;n<33;n++)deep={nested:deep};rejects(()=>m.validateSpecification(deep),'INPUT_TOO_DEEP');
 const cycle={};cycle.self=cycle;rejects(()=>m.canonicalJSON(cycle),'INPUT_TOO_DEEP');
 for(const bad of [undefined,NaN,Infinity,()=>{},new Date(),new Map(),[1,,3],{key:undefined}])rejects(()=>m.canonicalJSON(bad),typeof bad==='number'?'INVALID_NUMBER':'INVALID_SHAPE');
 let getters=0;const accessor={get value(){getters++;throw Error('Getter called');}};rejects(()=>m.canonicalJSON(accessor),'INVALID_SHAPE');assert.equal(getters,0);
 const withHook={toJSON(){throw Error('Hook called');}};rejects(()=>m.canonicalJSON(withHook),'INVALID_SHAPE');
 const symbol={a:1,[Symbol('extra')]:2};rejects(()=>m.canonicalJSON(symbol),'INVALID_SHAPE');
 rejects(()=>m.canonicalJSON('é'.repeat(17000)),'INPUT_TOO_LARGE');
 rejects(()=>m.canonicalJSON('x'.repeat(32769)),'INPUT_TOO_LARGE');

 const rule={id:'tell-the-team',trigger:{type:'form.accepted',formId:'appointment-request'},effect:{type:'notification.send',integrationId:'team-email',recipient:'staff',template:'submission-link@1'}};
 const put=mutate=>{const next=clone(detailing);mutate(next);return [{type:'modules.put',instance:instance(next,mutate.id??'appointments')}];};
 const putFiles=mutate=>{const next=clone(detailing);mutate(next);return [{type:'modules.put',instance:instance(next,'vehicle-photos')}];};
 const optional={key:'vehicle',label:'Your vehicle',type:'text',optional:true,read:'owner'};
 const operationBatches=[
  [{type:'content.replace',contentId:'hours',text:'Monday to Saturday, 8am to 6pm.'}],
  [{type:'design.setTheme',theme:'clay'}],
  [{type:'records.addField',instanceId:'appointments',schemaId:'appointments',field:optional}],
  putFiles(s=>{files(s).read='staff';}),
  [{type:'pages.setAudience',pageId:'home',audience:'staff'}],
  [{type:'rules.put',rule}],
 ];
 for(const operations of operationBatches)assert.notDeepEqual(m.changeSpecification(detailing,operations).spec,detailing);
 const classify=operations=>{const r=m.changeSpecification(detailing,operations);return [r.reviews,r.migration];};
 // Optional additions are additive-optional; fieldsRevision advances and stored records report the field as absent.
 assert.deepEqual(classify(operationBatches[2]),[['schema'],'additive-optional']);
 assert.equal(records(m.changeSpecification(detailing,operationBatches[2]).spec).schemas[0].fieldsRevision,2);
 assert.deepEqual(classify([{type:'records.addField',instanceId:'appointments',schemaId:'appointments',field:{...optional,read:'staff'}}]),[['permissions','schema'],'additive-optional']);
 assert.deepEqual(classify(put(s=>{records(s).schemas[0].fields.push(optional);records(s).schemas[0].fieldsRevision=2;})),[['schema'],'additive-optional']);
 rejects(()=>m.changeSpecification(detailing,put(s=>{records(s).schemas[0].fields.push(optional);})),'INCOMPATIBLE');
 // Permission widening classifies a permissions review; narrowing and labels need none.
 assert.deepEqual(classify(operationBatches[3]),[['permissions'],'none']);
 for(const widen of [
  put(s=>{records(s).retentionDays=365;}),put(s=>{records(s).schemas[0].fields[2].read='staff';}),put(s=>{records(s).schemas[0].staffWrite=['name'];}),
  put(s=>{records(s).views.push({id:'all',recordId:'appointments',audience:'staff',scope:'all',fields:['service'],limit:10});}),
  put(s=>{records(s).forms.push({id:'walk-in',recordId:'appointments',submit:'public',uploadCollectionId:null});}),
  putFiles(s=>{files(s).upload=['visitor','staff'];}),
  [{type:'modules.put',instance:{...clone(instance(detailing,'vehicle-photos')),config:{collections:[files(detailing),{id:'staff-files',read:'staff',upload:['staff'],maxBytes:1048576,mediaTypes:['image/jpeg'],gallery:null}]}}}],
 ])assert.ok(classify(widen)[0].includes('permissions'),JSON.stringify(widen));
 assert.deepEqual(classify(put(s=>{records(s).retentionDays=30;})),[[],'none']);
 assert.deepEqual(classify(put(s=>{records(s).views[0].fields=['name'];})),[[],'none']);
 assert.deepEqual(classify(put(s=>{records(s).schemas[0].fields[0].label='Full name';})),[[],'none']);
 assert.deepEqual(classify(put(s=>{records(s).schemas[0].fields[0].read='owner';records(s).views[0].fields=['service'];})),[[],'none']);
 assert.deepEqual(classify([{type:'modules.put',instance:{id:'directory',kind:'content',module:clone(m.moduleCatalog.find(e=>e.kind==='content').module),schema:clone(m.moduleCatalog.find(e=>e.kind==='content').schema),dependencies:[],config:{collections:[{id:'directory',type:'directory-listing@1'}]}}}]),[['schema'],'none']);
 // Required, removed, renamed and retyped fields, removed collections and pin changes need a reviewed migration hook.
 for(const field of [{...optional,optional:false},{key:'vehicle',label:'Vehicle',type:'text',read:'owner'}])rejects(()=>m.changeSpecification(detailing,[{type:'records.addField',instanceId:'appointments',schemaId:'appointments',field}]),'MIGRATION_REQUIRED');
 for(const migration of [
  put(s=>{records(s).schemas[0].fields.push({...optional,optional:false});records(s).schemas[0].fieldsRevision=2;}),
  put(s=>{records(s).schemas[0].fields.pop();}),
  put(s=>{records(s).schemas[0].fields[2].key='notes';}),
  put(s=>{Object.assign(records(s).schemas[0].fields[2],{type:'number',optional:false});}),
  put(s=>{records(s).schemas[0].fields[2].optional=false;}),
  put(s=>{records(s).schemas[0].fields[1].options[1].value='exterior';}),
  put(s=>{records(s).schemas[0].id='bookings';records(s).forms[0].recordId='bookings';records(s).views[0].recordId='bookings';}),
  put(s=>{instance(s,'appointments').module.digest='0'.repeat(64);}),
  (()=>{const s=clone(detailing);files(s).id='car-photos';records(s).forms[0].uploadCollectionId='car-photos';return [{type:'modules.put',instance:instance(s,'vehicle-photos')},{type:'modules.put',instance:instance(s,'appointments')}];})(),
 ])rejects(()=>m.changeSpecification(detailing,migration),'MIGRATION_REQUIRED');
 rejects(()=>m.changeSpecification(detailing,[{type:'records.addField',instanceId:'appointments',schemaId:'appointments',field:{...optional,key:'name'}}]),'INCOMPATIBLE');
 rejects(()=>m.changeSpecification(detailing,[{type:'records.addField',instanceId:'vehicle-photos',schemaId:'appointments',field:optional}]),'INCOMPATIBLE');
 rejects(()=>m.changeSpecification(detailing,[{type:'records.addField',instanceId:'missing',schemaId:'appointments',field:optional}]),'MISSING_REFERENCE');
 assert.deepEqual(m.changeSpecification(detailing,operationBatches[5]).reviews,['integration','spending']);
 assert.deepEqual(m.changeSpecification(detailing,operationBatches[4]).reviews,['permissions']);
 const unchanged=clone(detailing);
 rejects(()=>m.changeSpecification(detailing,[...operationBatches[0],{type:'database.execute',sql:'synthetic-private-marker'}]),'UNSUPPORTED_OPERATION');assert.deepEqual(detailing,unchanged);
 for(const type of ['records.removeField','records.renameField','files.setPolicy','json.patch','module.install','resources.provision','publish','billing.spend'])rejects(()=>m.changeSpecification(detailing,[{type}]),'UNSUPPORTED_OPERATION');
 for(const type of ['maintainer.chat','model.complete','shell.run','webhook.call']){const bad=clone(rule);bad.effect.type=type;rejects(()=>m.changeSpecification(detailing,[{type:'rules.put',rule:bad}]),'INCOMPATIBLE');}
 rejects(()=>m.changeSpecification(detailing,[]),'INVALID_LIST');
 rejects(()=>m.changeSpecification(detailing,Array(9).fill(operationBatches[0][0])),'INVALID_LIST');
 rejects(()=>m.changeSpecification(detailing,[{type:'design.setTheme',theme:'ocean'}]),'NO_CHANGE');
 rejects(()=>m.changeSpecification(detailing,put(()=>{})),'NO_CHANGE');
 // modules.remove (owner decision of October 4, 2026): only instances the caller verified were never activated are
 // removable; the default removable set is empty, so removal fails closed. Dependents go in the same change.
 const saved={...clone(content),instances:clone(detailing.instances)};
 const remove=instanceId=>({type:'modules.remove',instanceId});
 rejects(()=>m.changeSpecification(saved,[remove('appointments')]),'MIGRATION_REQUIRED');
 rejects(()=>m.changeSpecification(saved,[remove('appointments')],['vehicle-photos','team']),'MIGRATION_REQUIRED');
 const removedOne=m.changeSpecification(saved,[remove('appointments')],['appointments']);
 assert.deepEqual(removedOne.spec.instances.map(i=>i.id),saved.instances.map(i=>i.id).filter(i=>i!=='appointments'));assert.deepEqual([removedOne.reviews,removedOne.migration],[[],'none']);
 rejects(()=>m.changeSpecification(saved,[remove('team')],saved.instances.map(i=>i.id)),'MISSING_REFERENCE');
 rejects(()=>m.changeSpecification(saved,[remove('missing')],['missing']),'MISSING_REFERENCE');
 rejects(()=>m.changeSpecification(saved,[{...remove('appointments'),extra:1}],['appointments']),'UNKNOWN_FIELD');
 assert.deepEqual(m.changeSpecification(saved,saved.instances.map(i=>remove(i.id)).reverse(),saved.instances.map(i=>i.id)).spec.instances,[]);
 // Removing and re-adding the same id is a net put against the base, classified as usual (a kind change stays refused).
 const directory={id:'appointments',kind:'content',module:clone(m.moduleCatalog.find(e=>e.kind==='content').module),schema:clone(m.moduleCatalog.find(e=>e.kind==='content').schema),dependencies:[],config:{collections:[{id:'directory',type:'directory-listing@1'}]}};
 m.validateSpecification({...clone(saved),instances:[...saved.instances.filter(i=>i.id!=='appointments'),directory]});
 rejects(()=>m.changeSpecification(saved,[remove('appointments'),{type:'modules.put',instance:directory}],['appointments']),'MIGRATION_REQUIRED');

 // Retention is the owner decision of October 4, 2026 (#107); docs and lifecycle class must quote the one constant.
 const days=m.recordsRetention.allowedDays,choices=`${days.slice(0,-1).join(', ')} or ${days.at(-1)} days`;
 const recordsClass=JSON.parse(await readFile('docs/data-lifecycle.json','utf8')).classes.find(c=>c.id==='module-records'),sharedDoc=await readFile('docs/shared-modules.md','utf8');
 for(const text of [recordsClass.proposedRetention,sharedDoc])for(const phrase of [`default ${m.recordsRetention.defaultDays} days`,choices,`maximum ${m.recordsRetention.maxDays} days`])assert.ok(text.includes(phrase),phrase);
 assert.ok(days.includes(m.recordsRetention.defaultDays)&&Math.max(...days)===m.recordsRetention.maxDays);

 const output=await m.compileProjectSpecification(content,lock);
 expectedManifestDigest=output.manifestDigest;
 assert.equal(output.manifest.activation,'not-configured');assert.equal(output.manifest.published,false);
 assert.equal(output.manifestDigest,hash(m.canonicalJSON(output.manifest)));
 assert.match(output.previewHeaders['content-security-policy'],/^sandbox;/);
 assert.match(output.previewHeaders['content-security-policy'],/form-action 'none'/);
 assert.equal(output.previewHeaders['cache-control'],'private, no-store');
 assert.equal(output.artifacts[0].html,m.renderSite((({photos,...text})=>text)(m.projectPage(content,'home'))));
 assert.equal(output.artifacts[0].digest,hash(output.artifacts[0].html));
 assert.deepEqual(await m.compileProjectSpecification(content,m.currentCompilerLock()),output);
 function reorder(value){if(Array.isArray(value))return value.map(reorder);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).reverse().map(([k,v])=>[k,reorder(v)]));return value;}
 assert.deepEqual(await m.compileProjectSpecification(reorder(content),reorder(lock)),output);
 const mutableLock=m.currentCompilerLock();mutableLock.modules.length=0;assert.deepEqual(m.currentCompilerLock(),lock);
 for(const mutate of [l=>{l.compiler.digest='0'.repeat(64);},l=>{l.compiler.version=1;},l=>{l.compiler.version=2;},l=>{l.compiler.version=3;},l=>{l.compiler.version=4;},l=>{l.compiler.version=5;},l=>{l.schemaVersion=2;},l=>{l.modules[0].digest='0'.repeat(64);},l=>{l.modules[0].dependencies.push('invented');},l=>{l.components=[];},l=>{l.approved=true;}]){const bad=clone(lock);mutate(bad);await rejectsAsync(()=>m.compileProjectSpecification(content,bad),'COMPILER_LOCK_MISMATCH');}
 const available=[lock.compiler,...lock.modules,...lock.components].map(a=>({...a,state:'available'}));
 m.assertCompilerAvailable(lock,available);
 for(let n=0;n<available.length;n++){const withdrawn=clone(available);withdrawn[n].state='withdrawn';rejects(()=>m.assertCompilerAvailable(lock,withdrawn),'COMPILER_UNAVAILABLE');}
 rejects(()=>m.assertCompilerAvailable(lock,[]),'COMPILER_UNAVAILABLE');
 // project-content@6: instance configuration compiles against exact trusted pins as saved, inactive configuration
 // (serving needs WH-125 activation). Notification/automation modules, integrations and rules stay unavailable.
 assert.deepEqual([lock.compiler.id,lock.compiler.version,lock.schemaVersion],['project-content',6,3]);
 await rejectsAsync(()=>m.compileProjectSpecification(detailing,lock),'UNAVAILABLE_CAPABILITY');
 const configured={...clone(content),instances:clone(detailing.instances)},configuredOutput=await m.compileProjectSpecification(configured,lock);
 assert.deepEqual(configuredOutput.artifacts.map(a=>[a.path,a.digest]),output.artifacts.map(a=>[a.path,a.digest]),'Instances add no compiled artifact');
 assert.notEqual(configuredOutput.specificationDigest,output.specificationDigest);assert.deepEqual(configuredOutput.manifest.lock,lock);assert.equal(configuredOutput.manifest.activation,'not-configured');
 assert.deepEqual(configuredOutput.specification.instances,detailing.instances);
 await rejectsAsync(()=>m.compileProjectSpecification({...clone(configured),modules:[{id:'content',version:2},{id:'notifications',version:1}]},lock),'UNAVAILABLE_CAPABILITY');
 // Owner edits classify against the saved base; the hook table refuses destructive changes before any save.
 const added=await m.compileSpecificationChange(content,[{type:'modules.put',instance:clone(instance(detailing,'team'))}],lock);
 assert.deepEqual(added.requiredReviews,['permissions','schema']);assert.equal(added.compiled.artifacts[0].digest,output.artifacts[0].digest);
 const owned=added.compiled.specification,withRecords=await m.compileSpecificationChange(owned,[{type:'modules.put',instance:{...clone(instance(contactLike,'messages')),dependencies:[]}}],lock);
 assert.deepEqual(withRecords.requiredReviews,['schema']);
 await rejectsAsync(()=>m.compileSpecificationChange(withRecords.compiled.specification,[{type:'modules.put',instance:{...clone(instance(contactLike,'messages')),config:{...clone(instance(contactLike,'messages').config),schemas:[{id:'message',fieldsRevision:1,staffWrite:[],fields:[{key:'message',label:'Message',type:'number',optional:false,read:'owner'}]}]}}}],lock),'MIGRATION_REQUIRED');
 // Restore is a forward revision under the target's exact lock, classified with the same table.
 const restoredUp=await m.compileSpecificationRestore(content,configured,lock);assert.deepEqual(restoredUp.requiredReviews,['permissions','schema']);assert.equal(restoredUp.nextDigest,configuredOutput.specificationDigest);
 assert.deepEqual((await m.compileSpecificationRestore(configured,configured,lock)).requiredReviews,[]);
 await rejectsAsync(()=>m.compileSpecificationRestore(configured,content,lock),'MIGRATION_REQUIRED');
 await rejectsAsync(()=>m.compileSpecificationRestore(configured,content,lock,['team']),'MIGRATION_REQUIRED');
 assert.deepEqual((await m.compileSpecificationRestore(configured,content,lock,configured.instances.map(i=>i.id))).requiredReviews,[]);
 assert.deepEqual((await m.compileSpecificationChange(configured,[remove('appointments')],lock,['appointments'])).compiled.artifacts[0].digest,output.artifacts[0].digest);
 const priorLock=clone(lock);priorLock.compiler.version=5;await rejectsAsync(()=>m.compileSpecificationRestore(content,configured,priorLock),'COMPILER_LOCK_MISMATCH');
 assert.deepEqual(m.transitionReviews(content,content),{reviews:[],migration:'none'});
 const stale=clone(detailing);instance(stale,'appointments').module.digest='0'.repeat(64);await rejectsAsync(()=>m.compileProjectSpecification(stale,lock),'STALE_MODULE_VERSION');
 const staleSchema=clone(detailing);instance(staleSchema,'team').schema.digest='f'.repeat(64);rejects(()=>m.assertModulesAvailable(staleSchema,m.moduleCatalog),'STALE_MODULE_VERSION');
 assert.deepEqual(m.assertModulesAvailable(detailing,m.moduleCatalog),detailing);
 for(const kind of ['records','files','access']){const withdrawn=m.moduleCatalog.map(e=>e.kind===kind?{...e,state:'withdrawn'}:e);rejects(()=>m.assertModulesAvailable(detailing,withdrawn),'MODULE_UNAVAILABLE');m.assertModulesAvailable(content,withdrawn);}
 rejects(()=>m.assertModulesAvailable(detailing,[]),'MODULE_UNAVAILABLE');
 const staff={...clone(content),instances:[clone(instance(detailing,'team'))]};staff.pages[0].audience='staff';await rejectsAsync(()=>m.compileProjectSpecification(staff,lock),'UNSUPPORTED_DELIVERY');
 const unused={...clone(content),instances:[clone(instance(detailing,'team'))]};assert.equal((await m.compileProjectSpecification(unused,lock)).artifacts[0].digest,output.artifacts[0].digest);
 const retired={...clone(content),schemaVersion:2,records:[],forms:[],files:[],access:{roles:[]}};delete retired.instances;await rejectsAsync(()=>m.compileProjectSpecification(retired,lock),'UNSUPPORTED_VERSION');

 const four=clone(content);four.pages=Array.from({length:4},(_,n)=>({...clone(four.pages[0]),id:'page-'+n,path:n?'/page-'+n:'/'}));
 for(const theme of ['ocean','clay','forest']){
  four.design.theme=theme;const result=await m.compileProjectSpecification(four,lock);assert.equal(result.artifacts.length,4);
  assert.deepEqual(result.artifacts.map(a=>a.path),['/','/page-1','/page-2','/page-3']);
  for(const artifact of result.artifacts){assert.equal(artifact.bytes,Buffer.byteLength(artifact.html));assert.equal(artifact.digest,hash(artifact.html));}
  assert.deepEqual(await m.compileProjectSpecification(reorder(four),lock),result);
 }
 const reversed=clone(four);reversed.pages.reverse();assert.notEqual((await m.compileProjectSpecification(reversed,lock)).manifestDigest,(await m.compileProjectSpecification(four,lock)).manifestDigest);
 const hostile=clone(content);hostile.content[0].text='<script>maintainer()</script>';const escaped=await m.compileProjectSpecification(hostile,lock);assert.ok(escaped.artifacts[0].html.includes('&lt;script&gt;maintainer()&lt;/script&gt;'));assert.ok(!escaped.artifacts[0].html.includes('<script>'));
 // Exercise escaping expansion near the supported configuration/output ceilings.
 const dense=clone(content);dense.name='&'.repeat(100);
 for(const [index,length] of [160,1000,100,1000,100,800,100,800].entries())dense.content[index].text='&'.repeat(length);
 for(const suffix of ['one','two']){dense.content.push({id:'extra-title-'+suffix,text:'&'.repeat(100)},{id:'extra-copy-'+suffix,text:'&'.repeat(suffix==='one'?800:450)});dense.pages[0].sections.push({heading:'extra-title-'+suffix,text:'extra-copy-'+suffix});}
 m.validateSpecification(dense);
 const denseOutput=await m.compileProjectSpecification(dense,lock);assert.ok(denseOutput.artifacts[0].bytes>30000&&denseOutput.artifacts[0].bytes<=32768);
 const change=await m.compileSpecificationChange(content,operationBatches[0],lock);assert.equal(change.baseDigest,output.specificationDigest);assert.notEqual(change.nextDigest,change.baseDigest);assert.deepEqual(change.requiredReviews,[]);assert.ok(change.compiled.artifacts[0].html.includes('Monday to Saturday'));assert.equal(change.diff[0].path,'/content');assert.deepEqual(content,unchangedContent());
 function unchangedContent(){return {...clone(detailing),modules:[{id:'content',version:2}],instances:[],integrations:[],rules:[]};}

 const page=m.projectPage(content,'home'),created=await m.compileNewWebsite(page);
 assert.equal(created.artifacts[0].html,output.artifacts[0].html);
 assert.deepEqual(m.projectPage(created.specification,'home'),page);
 assert.equal(m.importLegacySpecification,undefined);
 const photoId=crypto.randomUUID(),photos=[{id:photoId,alt:'A tidy garden'}];
 const illustrated=await m.compileNewWebsite({...page,photos});
 assert.equal(illustrated.specification.pages[0].component,'photo-page@1');
 assert.equal(illustrated.artifacts[0].html,m.renderPhotoPage({...page,photos}));
 const removed=await m.compileSpecificationChange(illustrated.specification,[{type:'pages.setPhotos',pageId:'home',photos:[]}],lock);
 assert.equal(removed.compiled.artifacts[0].html,created.artifacts[0].html);
 assert.equal(removed.compiled.specification.pages[0].component,'site-page@1');
 const renamed=await m.compileSpecificationChange(created.specification,[{type:'project.setName',name:'Neighborhood gardens'}],lock);
 assert.match(renamed.compiled.artifacts[0].html,/Neighborhood gardens/);
 const sections=[{heading:'Seasonal care',text:'Tidy every spring.'}];
 const resectioned=await m.compileSpecificationChange(created.specification,[{type:'pages.setSections',pageId:'home',sections}],lock);
 assert.deepEqual(m.projectPage(resectioned.compiled.specification,'home').sections,sections);
 for(const operations of [[{type:'pages.setPhotos',pageId:'home',photos:[{id:'bad',alt:'Invalid'}]}],[{type:'pages.setPhotos',pageId:'home',photos:null}],[{type:'pages.setPhotos',pageId:'home',photos:[...photos,...photos]}],[{type:'pages.setSections',pageId:'home',sections:Array(7).fill(sections[0])}],[{type:'project.setName',name:''}]])assert.throws(()=>m.changeSpecification(content,operations));
 const shared=clone(content);shared.pages.push({...clone(shared.pages[0]),id:'other',path:'/other'});
 const modified=m.changeSpecification(shared,[{type:'pages.setSections',pageId:'home',sections}]).spec;
 assert.deepEqual(m.projectPage(modified,'other'),m.projectPage(shared,'other'),'Replacing one page must retain shared content references');
 const incompatible=clone(illustrated.specification);incompatible.pages[0].component='site-page@1';rejects(()=>m.validateSpecification(incompatible),'INCOMPATIBLE');
 const missing=clone(content);delete missing.pages[0].photos;rejects(()=>m.validateSpecification(missing),'MISSING_FIELD');
 const {photos:omitted,...oldInput}=page;await assert.rejects(m.compileNewWebsite(oldInput));
 // The schema pins bind storage "current", which is only true while every lifecycle class they name is an admitted, current class.
 const lifecycle=JSON.parse(await readFile('docs/data-lifecycle.json','utf8'));
 for(const [kind,names] of Object.entries(m.moduleKinds))for(const id of names.lifecycleClasses)assert.equal(lifecycle.classes.find(c=>c.id===id)?.storageStatus,'current',kind+' '+id);
 for(const e of m.moduleCatalog)assert.equal(e.schema.digest,hash(JSON.stringify({formatVersion:1,kind:e.kind,schema:{name:e.schema.name,version:1},lifecycleClasses:[...m.moduleKinds[e.kind].lifecycleClasses],storage:'current'},null,2)+'\n'));
 assert.equal(networkCalls,0);
 console.log('Compiler fixtures passed: project-content@6 instance-bearing compile/change/restore classification, never-activated modules.remove, and @3/@4 lock refusal, schema 3 module configuration (PNG/size/public audience/role/view/dependency refusals, staff upload/write), permission/additive/migration classification, exact module pins and withdrawals, detached edits, deterministic content/routes/themes/manifests, exact locks and withdrawals, escaped output, direct current creation, photos, sections/name edits and retired schema refusal, zero network/model calls.');
}finally{globalThis.fetch=fetch;}

// A second checkout/process proves input-path independence and that the build gate
// rejects source/constant drift without rewriting any working-tree file.
const dir=await mkdtemp((process.env.TMPDIR||'/tmp')+'/whumpo-compiler-lock-');
try{
 const paths=[...checked.sources.map(s=>s.path),'tools/check-specification-compiler.mjs','compiler-locks/project-content-v6.json','src/project-specification/compiler-artifacts.generated.ts','src/project-specification/catalog.ts','package.json'];
 for(const path of paths){await mkdir(dirname(join(dir,path)),{recursive:true});await copyFile(path,join(dir,path));}
 await symlink(resolve('node_modules'),join(dir,'node_modules'),'dir');
 const run=args=>spawnSync(process.execPath,['tools/check-specification-compiler.mjs',...args],{cwd:dir,encoding:'utf8'});
 {const r=run(['--check']);assert.equal(r.status,0,r.stderr);}
 await writeFile(join(dir,'fixture.json'),JSON.stringify(content));
 await writeFile(join(dir,'compile-fixture.mjs'),`import {build} from 'esbuild';import {readFile} from 'node:fs/promises';
globalThis.fetch=async()=>{throw Error('No compiler network');};
const b=await build({entryPoints:['src/project-specification/compiler.ts'],bundle:true,format:'esm',platform:'neutral',write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].contents).toString('base64'));
try{const c=await m.compileProjectSpecification(JSON.parse(await readFile('fixture.json','utf8')),m.currentCompilerLock());console.log(c.manifestDigest);}catch(e){console.error(e.code);process.exitCode=1;}`);
 const fresh=()=>spawnSync(process.execPath,['compile-fixture.mjs'],{cwd:dir,encoding:'utf8',env:{PATH:process.env.PATH,TZ:'Pacific/Auckland'}});
 const repeated=fresh();assert.equal(repeated.status,0,repeated.stderr);assert.equal(repeated.stdout.trim(),expectedManifestDigest);
 const policyPath=join(dir,'src/project-specification/catalog.ts'),policy=await readFile(policyPath,'utf8');
 await writeFile(policyPath,policy.replaceAll("state:'available'","state:'withdrawn'"));
 assert.equal(run(['--check']).status,0); // Withdrawal must not rewrite immutable identity.
 const withdrawn=fresh();assert.notEqual(withdrawn.status,0);assert.match(withdrawn.stderr,/COMPILER_UNAVAILABLE/);await writeFile(policyPath,policy);
 const repin=run(['--init']);assert.notEqual(repin.status,0);assert.match(repin.stderr,/already pinned/);
 const target=join(dir,'src/components.ts'),original=await readFile(target,'utf8');await writeFile(target,original+'\n// Unexpected artifact drift\n');
 const drift=run(['--check']);assert.notEqual(drift.status,0);assert.match(drift.stderr,/compiler changed/);
 await writeFile(target,original);await writeFile(join(dir,'src/project-specification/compiler-artifacts.generated.ts'),'export const compilerArtifacts = {};\n');
 const stale=run(['--check']);assert.notEqual(stale.status,0);assert.match(stale.stderr,/constants are stale/);
 execFileSync(process.execPath,['tools/check-specification-compiler.mjs','--generate'],{cwd:dir,stdio:'pipe'});assert.equal(run(['--check']).status,0);
 console.log('Isolated build gate passed: independent checkout/process, immutable identity, source drift and stale constants. No D1, live deployment, CMS or provider activation.');
}finally{await rm(dir,{recursive:true,force:true});}
