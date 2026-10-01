import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,mkdtemp,copyFile,symlink,rm} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {checkSpecificationCompiler} from '../tools/check-specification-compiler.mjs';
Error.stackTraceLimit=0;

const checked=await checkSpecificationCompiler();
const bundle=await build({stdin:{contents:`export * from './src/project-specification/compiler';export * from './src/project-specification/v2/schema';export * from './src/project-specification/v2/json';export {siteConfig,renderSite,renderPhotoPage} from './src/components';export {backendFormConfig} from './src/backend-form-config';`,resolveDir:process.cwd()},bundle:true,format:'esm',platform:'neutral',write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].contents).toString('base64'));
const detailing=JSON.parse(await readFile('tests/fixtures/project-specification/detailing.json','utf8'));
const clone=value=>structuredClone(value),hash=text=>createHash('sha256').update(text).digest('hex');
const lock=m.currentCompilerLock();
const content={...clone(detailing),modules:[{id:'content',version:2}],records:[],forms:[],files:[],access:{roles:[]},integrations:[],rules:[]};
const rejects=(fn,code)=>assert.throws(fn,error=>error instanceof m.SpecificationError&&error.code===code,code);
const rejectsAsync=(fn,code)=>assert.rejects(fn,error=>error instanceof m.SpecificationError&&error.code===code,code);
let networkCalls=0;
let expectedManifestDigest;
const fetch=globalThis.fetch;globalThis.fetch=async()=>{networkCalls++;throw Error('Compiler attempted network/inference.');};
try{
 assert.deepEqual(m.validateSpecification(content),content);
 const decoded=m.validateSpecification(detailing);decoded.content[0].text='Mutable return';assert.notEqual(detailing.content[0].text,decoded.content[0].text);
 const negatives=[
  ['UNKNOWN_FIELD',s=>{s.ownerId='synthetic-private-marker';}],
  ['UNKNOWN_FIELD',s=>{s.design.css='synthetic-private-marker';}],
  ['UNKNOWN_FIELD',s=>{s.integrations[0].apiKey='synthetic-private-marker';}],
  ['MISSING_FIELD',s=>{delete s.name;}],
  ['UNSUPPORTED_VERSION',s=>{s.schemaVersion=1;}],
  ['UNSUPPORTED_VERSION',s=>{s.modules[0].version=1;}],
  ['UNKNOWN_MODULE',s=>{s.modules[0].id='downloaded-module';}],
  ['UNSUPPORTED_VERSION',s=>{s.pages[0].component='site-page@2';}],
  ['INCOMPATIBLE',s=>{s.modules=s.modules.filter(m=>m.id!=='access');}],
  ['DUPLICATE_ID',s=>{s.pages.push(clone(s.pages[0]));}],
  ['DUPLICATE_ID',s=>{s.content.push(clone(s.content[0]));}],
  ['INVALID_SHAPE',s=>{s.content.push(null);}],
  ['MISSING_REFERENCE',s=>{s.pages[0].headline='missing';}],
  ['INCOMPATIBLE',s=>{s.pages[0].path='/api';}],
  ['INCOMPATIBLE',s=>{s.pages[0].path='/../secret';}],
  ['INCOMPATIBLE',s=>{s.records[0].fields.push({key:'constructor',label:'Reserved',type:'text'});}],
  ['INCOMPATIBLE',s=>{s.records[0].fields.push(clone(s.records[0].fields[0]));}],
  ['INCOMPATIBLE',s=>{s.records[0].read='owner';}],
  ['INCOMPATIBLE',s=>{s.files[0].read='public';}],
  ['INCOMPATIBLE',s=>{s.files[0].mimeTypes=['image/jpeg','image/jpeg'];}],
  ['INVALID_NUMBER',s=>{s.files[0].maxBytes=5*1024*1024+1;}],
  ['INCOMPATIBLE',s=>{s.forms[0].submit='public';}],
  ['MISSING_REFERENCE',s=>{s.forms[0].recordId='missing';}],
  ['INCOMPATIBLE',s=>{s.forms[0].uploadCollectionId='missing';}],
  ['INVALID_TEXT',s=>{s.content[0].text='x'.repeat(1001);}],
  ['INVALID_TEXT',s=>{s.content[0].text='bad\u0000text';}],
  ['INVALID_ID',s=>{s.content[0].id='prototype';}],
 ];
 for(const [code,mutate] of negatives){
  const value=clone(detailing);mutate(value);rejects(()=>m.validateSpecification(value),code);
  assert.throws(()=>m.validateSpecification(value),error=>!error.message.includes('synthetic-private-marker'));
 }
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
 const operationBatches=[
  [{type:'content.replace',contentId:'hours',text:'Monday to Saturday, 8am to 6pm.'}],
  [{type:'design.setTheme',theme:'clay'}],
  [{type:'records.addField',recordId:'appointments',field:{key:'vehicle',label:'Your vehicle',type:'text',optional:true}}],
  [{type:'files.setPolicy',collectionId:'vehicle-photos',read:'staff',upload:'visitor'}],
  [{type:'pages.setAudience',pageId:'home',audience:'staff'}],
  [{type:'rules.put',rule}],
 ];
 for(const operations of operationBatches)assert.notDeepEqual(m.changeSpecification(detailing,operations).spec,detailing);
 assert.deepEqual(m.changeSpecification(detailing,operationBatches[2]).reviews,['schema']);
 assert.deepEqual(m.changeSpecification(detailing,operationBatches[3]).reviews,['permissions']);
 assert.deepEqual(m.changeSpecification(detailing,operationBatches[5]).reviews,['integration','spending']);
 const unchanged=clone(detailing);
 rejects(()=>m.changeSpecification(detailing,[...operationBatches[0],{type:'database.execute',sql:'synthetic-private-marker'}]),'UNSUPPORTED_OPERATION');assert.deepEqual(detailing,unchanged);
 for(const field of [{key:'vehicle',label:'Vehicle',type:'text'},{key:'vehicle',label:'Vehicle',type:'number',optional:true}])rejects(()=>m.changeSpecification(detailing,[{type:'records.addField',recordId:'appointments',field}]),'MIGRATION_REQUIRED');
 rejects(()=>m.changeSpecification(detailing,[{type:'records.addField',recordId:'appointments',field:{key:'name',label:'Duplicate',type:'text',optional:true}}]),'INCOMPATIBLE');
 for(const type of ['records.removeField','records.renameField','json.patch','module.install','resources.provision','publish','billing.spend'])rejects(()=>m.changeSpecification(detailing,[{type}]),'UNSUPPORTED_OPERATION');
 for(const type of ['maintainer.chat','model.complete','shell.run','webhook.call']){const bad=clone(rule);bad.effect.type=type;rejects(()=>m.changeSpecification(detailing,[{type:'rules.put',rule:bad}]),'INCOMPATIBLE');}
 rejects(()=>m.changeSpecification(detailing,[]),'INVALID_LIST');
 rejects(()=>m.changeSpecification(detailing,Array(9).fill(operationBatches[0][0])),'INVALID_LIST');
 rejects(()=>m.changeSpecification(detailing,[{type:'design.setTheme',theme:'ocean'}]),'NO_CHANGE');

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
 for(const mutate of [l=>{l.compiler.digest='0'.repeat(64);},l=>{l.compiler.version=1;},l=>{l.modules[0].digest='0'.repeat(64);},l=>{l.modules[0].dependencies.push('invented');},l=>{l.components=[];},l=>{l.approved=true;}]){const bad=clone(lock);mutate(bad);await rejectsAsync(()=>m.compileProjectSpecification(content,bad),'COMPILER_LOCK_MISMATCH');}
 const available=[lock.compiler,...lock.modules,...lock.components].map(a=>({...a,state:'available'}));
 m.assertCompilerAvailable(lock,available);
 for(let n=0;n<available.length;n++){const withdrawn=clone(available);withdrawn[n].state='withdrawn';rejects(()=>m.assertCompilerAvailable(lock,withdrawn),'COMPILER_UNAVAILABLE');}
 rejects(()=>m.assertCompilerAvailable(lock,[]),'COMPILER_UNAVAILABLE');
 await rejectsAsync(()=>m.compileProjectSpecification(detailing,lock),'UNAVAILABLE_CAPABILITY');
 const staff={...clone(content),modules:[...content.modules,{id:'access',version:1}],access:{roles:['staff']}};staff.pages[0].audience='staff';await rejectsAsync(()=>m.compileProjectSpecification(staff,lock),'UNSUPPORTED_DELIVERY');
 const unused={...clone(content),modules:[...content.modules,{id:'records',version:1}]};await rejectsAsync(()=>m.compileProjectSpecification(unused,lock),'UNAVAILABLE_CAPABILITY');

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
 function unchangedContent(){return {...clone(detailing),modules:[{id:'content',version:2}],records:[],forms:[],files:[],access:{roles:[]},integrations:[],rules:[]};}

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
 assert.equal(networkCalls,0);
 console.log('Compiler fixtures passed: current schema validation, detached edits and review classes, incompatible migrations rejected, deterministic content/routes/themes/manifests, exact locks and withdrawals, escaped output, direct current creation, photos, sections/name edits and retired schema refusal, zero network/model calls.');
}finally{globalThis.fetch=fetch;}

// A second checkout/process proves input-path independence and that the build gate
// rejects source/constant drift without rewriting any working-tree file.
const dir=await mkdtemp('/tmp/whumpo-compiler-lock-');
try{
 const paths=[...checked.sources.map(s=>s.path),'tools/check-specification-compiler.mjs','compiler-locks/project-content-v2.json','src/project-specification/compiler-artifacts.generated.ts','src/project-specification/catalog.ts','package.json'];
 for(const path of paths){await mkdir(dirname(join(dir,path)),{recursive:true});await copyFile(path,join(dir,path));}
 await symlink(resolve('node_modules'),join(dir,'node_modules'),'dir');
 const run=args=>spawnSync(process.execPath,['tools/check-specification-compiler.mjs',...args],{cwd:dir,encoding:'utf8'});
 assert.equal(run(['--check']).status,0);
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
