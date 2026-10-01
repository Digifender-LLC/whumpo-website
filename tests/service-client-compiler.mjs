import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,mkdir,copyFile,symlink,rm} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
import {createHash} from 'node:crypto';
import {checkSpecificationCompiler} from '../tools/check-specification-compiler.mjs';
import {checkServiceClientCompiler} from '../tools/check-service-client-compiler.mjs';
const root=process.cwd(),temp=await mkdtemp('/tmp/whumpo-client-compiler-'),hash=value=>createHash('sha256').update(value).digest('hex');
const oldFetch=globalThis.fetch;let network=0;
try{
 const originalCompiler=await checkSpecificationCompiler(),checked=await checkServiceClientCompiler();assert.equal(originalCompiler.compilerDigest,'25a73c88b1a51e9ec9512ca72c22bd515d835403b659c34fc3bc9b96780c3d2b');
 const bundle=await build({stdin:{contents:"export * from './src/project-specification/service-clients/compiler';export * from './src/project-specification/v1/json';export {siteConfig,renderSite} from './src/components';export {publishedHTML} from './src/published-html';",resolveDir:root},bundle:true,format:'esm',platform:'neutral',write:false});
 await writeFile(join(temp,'module.mjs'),bundle.outputFiles[0].contents);const m=await import(pathToFileURL(join(temp,'module.mjs')));
 globalThis.fetch=async()=>{network++;throw Error('Compiler attempted inference/network.');};
 const id=n=>`${String(n).padStart(8,'0')}-1111-4111-8111-111111111111`;
 const config=m.siteConfig({name:'Garden studio',headline:'Care for your garden',description:'Neighborhood garden care.',aboutTitle:'Our work',aboutText:'Local and friendly.',theme:'forest',sections:[]}),html=m.renderSite(config),website={componentId:'site-page@1',config,html};
 const target={projectId:id(1),website:{versionId:id(2),digest:hash(html)},publication:{revision:1,versionId:id(2)},contact:{revision:0,active:false},backend:{revision:1,reviewId:id(3),versionId:id(4),digest:hash('synthetic backend')},form:{revision:0,reviewId:null,active:false}};
 const form={title:'Estimate garden care',description:'Try a number of hours.',buttonLabel:'Estimate',fields:[{key:'hours',label:'Hours',type:'number'},{key:'querySelector',label:'Note <script>data</script>',type:'text',optional:true},{key:'weekday',label:'Weekday?',type:'boolean'},{key:'service',label:'Service',type:'choice',options:[{value:'care',label:'Garden care'},{value:'design',label:'Design'}]}]};
 const spec={schemaVersion:1,contact:{component:'contact-link@1'},statelessForm:{component:'stateless-form@1',config:form}},lock=m.currentServiceClientLock();
 const compile=(s=spec,t=target,w=website,l=lock)=>m.compileServiceClientArtifacts(s,t,w,l);
 const output=await compile();assert.equal(output.manifest.activation,'not-authorized');assert.equal(output.manifest.published,false);assert.equal(output.manifestDigest,hash(m.canonicalJSON(output.manifest,16384)));
 assert.deepEqual(output.requiredReviews,['website-publication','contact-settings','backend-form-settings']);
 const preview=output.artifacts[0],candidate=output.artifacts[1];
 assert.ok(!preview.html.includes('<script>'));assert.ok(!preview.html.includes('data-endpoint'));assert.ok(!preview.html.includes('href="https://whumpo.com/contact/'));assert.ok(preview.html.includes('<fieldset disabled'));assert.ok(preview.html.includes('&lt;script&gt;data&lt;/script&gt;'));
 assert.equal(candidate.html,m.publishedHTML(html,true,target.projectId,{config_json:m.canonicalJSON(form,4096),backend_publication_id:target.backend.reviewId}));
 assert.equal(output.services[1].destination,`https://${target.projectId}.whumpo.site/backend/${target.backend.reviewId}`);assert.equal(output.services[1].credentials,'omit');
 assert.match(output.previewHeaders['content-security-policy'],/^sandbox;/);assert.match(output.previewHeaders['content-security-policy'],/form-action 'none'/);assert.ok(!output.previewHeaders['content-security-policy'].includes('allow-scripts'));assert.match(output.candidateScriptPolicy,/^'sha256-[A-Za-z0-9+/]+=*'$/);
 for(const artifact of output.artifacts){assert.equal(artifact.bytes,Buffer.byteLength(artifact.html));assert.equal(artifact.digest,hash(artifact.html));}
 const clone=x=>structuredClone(x),reorder=x=>Array.isArray(x)?x.map(reorder):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).reverse().map(([k,v])=>[k,reorder(v)])):x;
 assert.deepEqual(await compile(reorder(spec),reorder(target),reorder(website),reorder(lock)),output);assert.deepEqual(await compile(),output);
 const normalized=clone(spec);normalized.statelessForm.config.title='  Estimate garden care  ';assert.deepEqual((await compile(normalized)).specification,spec);
 const returned=await compile();returned.target.backend.reviewId=id(5);returned.specification.statelessForm.config.fields[0].label='Changed';returned.manifest.lock.modules.length=0;assert.deepEqual(await compile(),output);
 const reject=async(fn,code)=>assert.rejects(fn,e=>e instanceof m.SpecificationError&&e.code===code&&!e.message.includes('synthetic-sensitive-marker'));
 for(const [code,mutate] of [
  ['UNKNOWN_FIELD',s=>{s.ownerId='synthetic-sensitive-marker';}],['UNSUPPORTED_VERSION',s=>{s.schemaVersion=2;}],
  ['UNKNOWN_FIELD',s=>{s.contact.url='https://elsewhere.test';}],['UNSUPPORTED_DELIVERY',s=>{s.contact.component='records@1';}],
  ['UNKNOWN_FIELD',s=>{s.statelessForm.backendVersionId=id(9);}],['INCOMPATIBLE',s=>{s.statelessForm.config.fields[0].type='file';}],
  ['INCOMPATIBLE',s=>{s.statelessForm.config.fields[0].key='constructor';}],['INCOMPATIBLE',s=>{s.statelessForm.config.url='https://elsewhere.test';}],
  ['INCOMPATIBLE',s=>{s.statelessForm.config.fields.push(clone(s.statelessForm.config.fields[0]));}],['INCOMPATIBLE',s=>{s.statelessForm.config.title='';}],
 ]){const s=clone(spec);mutate(s);await reject(()=>compile(s),code);}
 await reject(()=>compile({...spec,statelessForm:{component:'stateless-form@1',config:{...form,description:'x'.repeat(7000)}}}),'INPUT_TOO_LARGE');
 for(const [code,mutate] of [
  ['UNKNOWN_FIELD',t=>{t.backend.url='https://elsewhere.test';}],['INVALID_ID',t=>{t.projectId='../../platform';}],
  ['INVALID_REVISION',t=>{t.publication.revision=-1;}],['INVALID_DIGEST',t=>{t.backend.digest='bad';}],['INVALID_REVISION',t=>{t.backend.revision=0;}],
  ['INCOMPATIBLE',t=>{t.form.active=true;}],['INVALID_SHAPE',t=>{t.contact.active='yes';}],['MISSING_AUTHORITY',t=>{t.backend=null;}],
 ]){const t=clone(target);mutate(t);await reject(()=>compile(spec,t),code);}
 for(const key of ['projectId','publication','contact','form','website','backend']){const changed=clone(target);if(key==='projectId')changed[key]=id(6);else if(key==='website')changed[key].versionId=id(6);else changed[key].revision++;assert.notEqual((await compile(spec,changed)).manifestDigest,output.manifestDigest);}
 await reject(()=>compile(spec,target,{...website,html:html+'tampered'}),'ARTIFACT_MISMATCH');
 const forgedHTML=html.replace('</main>','<script>synthetic_sensitive_marker()</script></main>');await reject(()=>compile(spec,{...target,website:{...target.website,digest:hash(forgedHTML)}},{...website,html:forgedHTML}),'ARTIFACT_MISMATCH');
 await reject(()=>compile(spec,target,{...website,componentId:'photo-page@1'}),'UNSUPPORTED_DELIVERY');
 await reject(()=>compile(spec,target,{...website,config:{...config,headline:'Different'}}),'ARTIFACT_MISMATCH');
 const empty={schemaVersion:1,contact:null,statelessForm:null};const inactive=await compile(empty,{...target,backend:null});assert.equal(inactive.artifacts[1].html,html);assert.equal(inactive.services.length,0);
 const removal=await compile(empty,{...target,contact:{revision:1,active:true},form:{revision:1,reviewId:id(5),active:true}});assert.deepEqual(removal.requiredReviews,['website-publication','contact-settings','backend-form-settings']);
 const wrong=clone(lock);wrong.compiler.digest='0'.repeat(64);await reject(()=>compile(spec,target,website,wrong),'COMPILER_LOCK_MISMATCH');
 const available=[lock.compiler,...lock.modules].map(x=>({...x,state:'available'}));for(let n=0;n<available.length;n++){const withdrawn=clone(available);withdrawn[n].state='withdrawn';assert.throws(()=>m.assertServiceClientCompilerAvailable(lock,withdrawn),e=>e.code==='COMPILER_UNAVAILABLE');}
 assert.equal(network,0);
 // New process and copied source tree prove reproduction independently of module cache/timezone.
 const isolated=join(temp,'independent');await mkdir(isolated);
 const paths=[...checked.sources.map(s=>s.path),'src/project-specification/service-clients/catalog.ts','src/project-specification/service-clients/artifacts.generated.ts','tools/check-service-client-compiler.mjs','compiler-locks/project-service-clients-v1.json'];
 for(const path of new Set(paths)){await mkdir(dirname(join(isolated,path)),{recursive:true});await copyFile(join(root,path),join(isolated,path));}
 await writeFile(join(isolated,'package.json'),'{"type":"module"}');await symlink(resolve('node_modules'),join(isolated,'node_modules'),'dir');await writeFile(join(isolated,'fixture.json'),JSON.stringify({spec,target,website}));
 await writeFile(join(isolated,'run.mjs'),`import {build} from 'esbuild';import {readFile,writeFile} from 'node:fs/promises';globalThis.fetch=async()=>{throw Error('No network');};const b=await build({entryPoints:['src/project-specification/service-clients/compiler.ts'],bundle:true,format:'esm',platform:'neutral',write:false});await writeFile('bundle.mjs',b.outputFiles[0].contents);const m=await import('./bundle.mjs'),f=JSON.parse(await readFile('fixture.json','utf8'));try{console.log((await m.compileServiceClientArtifacts(f.spec,f.target,f.website,m.currentServiceClientLock())).manifestDigest);}catch(e){console.error(e.code);process.exitCode=1;}`);
 const run=(args)=>spawnSync(process.execPath,args,{cwd:isolated,encoding:'utf8',env:{...process.env,TZ:'Pacific/Auckland'}});
 const check=()=>run(['tools/check-service-client-compiler.mjs','--check']);assert.equal(check().status,0);
 const repeated=run(['run.mjs']);assert.equal(repeated.status,0,repeated.stderr);assert.equal(repeated.stdout.trim(),output.manifestDigest);
 const catalog=join(isolated,'src/project-specification/service-clients/catalog.ts'),catalogSource=await readFile(catalog,'utf8');await writeFile(catalog,catalogSource.replaceAll("state:'available'","state:'withdrawn'"));assert.equal(check().status,0);assert.match(run(['run.mjs']).stderr,/COMPILER_UNAVAILABLE/);await writeFile(catalog,catalogSource);
 assert.notEqual(run(['tools/check-service-client-compiler.mjs','--init']).status,0);
 const core=join(isolated,'src/project-specification/service-clients/v1/core.ts'),source=await readFile(core,'utf8');await writeFile(core,source+'\n// drift\n');assert.notEqual(check().status,0);assert.notEqual(run(['tools/check-service-client-compiler.mjs','--generate']).status,0);await writeFile(core,source);
 const constants=join(isolated,'src/project-specification/service-clients/artifacts.generated.ts');await writeFile(constants,'export const serviceClientArtifacts={};');assert.notEqual(check().status,0);assert.equal(run(['tools/check-service-client-compiler.mjs','--generate']).status,0);assert.equal(check().status,0);
 console.log('Service client compiler passed: exact current renderer bytes, no active preview actions, fixed destinations, strict contracts, independent reproduction, immutable locks and withdrawal. No network/inference or activation.');
}finally{globalThis.fetch=oldFetch;await rm(temp,{recursive:true,force:true});}
