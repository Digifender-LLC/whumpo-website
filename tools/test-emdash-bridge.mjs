import {verifyMappedImport} from '../tests/cms-mapped-import.mjs';
import {verifyNativeMediaUpload} from '../tests/cms-native-media-upload.mjs';
import {verifyNativeMediaPreview} from '../tests/cms-native-media-preview.mjs';
import {randomUUID} from 'node:crypto';
import {build as bundle} from 'esbuild';
import wrangler from 'wrangler';
import {DatabaseSync} from 'node:sqlite';
import {stableCMSDatabase,captureCMSDatabase,restoreCapturedCMSDatabase,restoreCapturedCMSD1} from './cms-database-snapshot.mjs';
// Reproducible disposable local EmDash + private service-binding acceptance.
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
const build=spawnSync(process.execPath,['tools/build-emdash.mjs'],{stdio:'inherit'});if(build.status!==0)process.exit(build.status||1);
// Do not accidentally run against another developer's process.
try{await fetch('http://localhost:8799');throw Error('Port 8799 is already in use; stop its test server first.');}catch(error){if(error.message.includes('already in use'))throw error;}
const dir=await mkdtemp(join(tmpdir(),'townhello-emdash-')),source=resolve('integrations/emdash/dist/server/wrangler.json'),config=JSON.parse(await readFile(source,'utf8'));
config.main=resolve(dirname(source),config.main);config.assets.directory=resolve(dirname(source),config.assets.directory);
config.vars={TOWNHELLO_CMS_PROJECT_ID:'11111111-1111-4111-8111-111111111111',TOWNHELLO_CMS_OWNER_ID:'22222222-2222-4222-8222-222222222222',TOWNHELLO_CMS_BRIDGE_KEY:'local-cms-bridge-fixture-'.repeat(3),TOWNHELLO_CMS_ORIGIN:'https://cms.test',EMDASH_SITE_URL:'https://cms.test'};
delete config.triggers;
await writeFile(join(dir,'cms.json'),JSON.stringify(config));
await writeFile(join(dir,'probe.mjs'),"export default {fetch(request,env){const u=new URL(request.url);return env.CMS.fetch(new Request('https://cms.test'+u.pathname+u.search,request));}};");
await writeFile(join(dir,'probe.json'),JSON.stringify({name:'townhello-cms-local-probe',main:'probe.mjs',compatibility_date:'2026-09-29',workers_dev:false,preview_urls:false,services:[{binding:'CMS',service:config.name}]}));
let logs='',server;
async function stopServer(){if(server&&server.exitCode===null){server.kill('SIGTERM');await new Promise(resolve=>{const timer=setTimeout(()=>{if(server.exitCode===null)server.kill('SIGKILL');resolve();},4000);server.once('exit',()=>{clearTimeout(timer);resolve();});});}}
async function startServer(cmsPath){
 server=spawn(process.execPath,['node_modules/wrangler/bin/wrangler.js','dev','--config',join(dir,'probe.json'),'--config',cmsPath,'--local','--port','8799','--persist-to',join(dir,'state')],{stdio:['ignore','pipe','pipe']});
 for(const stream of [server.stdout,server.stderr])stream.on('data',data=>{logs=(logs+data.toString()).slice(-12000);});
 let ready=false;
 for(let i=0;i<120;i++){
  if(server.exitCode!==null)throw Error('Local CMS server exited: '+logs);
  try{const r=await fetch('http://localhost:8799/_emdash/api/setup/status');if(r.status===403){ready=true;break;}}catch{}
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 if(!ready)throw Error('Local CMS did not start: '+logs);
}
try{
 await startServer(join(dir,'cms.json'));
 const result=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,['tests/emdash-bridge-live.mjs'],{stdio:'inherit'});child.once('error',reject);child.once('exit',resolve);});
 if(result!==0)throw Error('EmDash acceptance failed: '+logs);
 const proxy=await wrangler.getPlatformProxy({configPath:join(dir,'cms.json'),persist:{path:join(dir,'state','v3')},remoteBindings:false});
 const restored=new DatabaseSync(':memory:');
 try{
  await verifyNativeMediaPreview(proxy.env,config.vars);
  await verifyNativeMediaUpload(proxy.env,config.vars);
  const code=await bundle({entryPoints:['src/cms-bridge.ts'],bundle:true,format:'esm',platform:'node',write:false});const {verifyCMSInitialization,callCMS}=await import('data:text/javascript;base64,'+Buffer.from(code.outputFiles[0].text).toString('base64'));
  const identity={projectId:config.vars.TOWNHELLO_CMS_PROJECT_ID,ownerId:config.vars.TOWNHELLO_CMS_OWNER_ID,secret:config.vars.TOWNHELLO_CMS_BRIDGE_KEY,origin:config.vars.TOWNHELLO_CMS_ORIGIN};
  const service={fetch:async request=>fetch('http://localhost:8799'+new URL(request.url).pathname,{method:request.method,headers:request.headers,...(request.method!=='GET'?{body:await request.text()}:{}),redirect:'error'})};
  const recoveryId=randomUUID(),recoveryBody={status:'draft',data:{title:'Native identity recovery',content:[{_type:'block',style:'normal',markDefs:[],children:[{_type:'span',text:'Recover this exact private draft.',marks:[]}]}]}};
  const original=await callCMS(service,identity,'/_emdash/api/content/posts',recoveryId,recoveryBody);
  // Simulate a persisted article whose native response receipt was lost.
  await proxy.env.DB.prepare('UPDATE _townhello_requests SET status=NULL,response=NULL WHERE id=?').bind(recoveryId).run();
  const recovered=await callCMS(service,identity,'/_emdash/api/content/posts',recoveryId,recoveryBody);
  if(recovered.item.id!==original.item.id||recovered._rev!==original._rev||recovered.item.slug!=='whumpo-draft-'+recoveryId)throw Error('Native draft identity recovery differs');
  if((await proxy.env.DB.prepare('SELECT count(*) n FROM ec_posts WHERE slug=?').bind('whumpo-draft-'+recoveryId).first()).n!==1)throw Error('Native recovery duplicated the article');
  console.log('Actual native draft identity recovered the existing article and revision without another creation.');
  const taxonomyCode=await bundle({entryPoints:['src/cms-taxonomy-shape.ts'],bundle:true,format:'esm',platform:'node',write:false});const {cmsTaxonomyDefinition,cmsTaxonomyTerm}=await import('data:text/javascript;base64,'+Buffer.from(taxonomyCode.outputFiles[0].text).toString('base64'));
  for(const name of ['categories','tags'])for(const kind of ['definition','term']){
   const path=kind==='definition'?'/_emdash/api/taxonomies':'/_emdash/api/taxonomies/'+name+'/terms',readPath=kind==='definition'?path+'/'+name:path+'/studio-notes',body=kind==='definition'?cmsTaxonomyDefinition(name):cmsTaxonomyTerm('studio-notes','Studio notes');
   const intent=await proxy.env.DB.prepare('SELECT request_id FROM _townhello_taxonomy_intents WHERE read_path=?').bind(readPath).first();if(!intent)throw Error('Native taxonomy recovery fixture has no reserved intent');
   const before=await callCMS(service,identity,readPath,randomUUID());await proxy.env.DB.prepare('UPDATE _townhello_requests SET status=NULL,response=NULL WHERE id=?').bind(intent.request_id).run();
   const recovered=await callCMS(service,identity,path,intent.request_id,body),key=kind==='definition'?'taxonomy':'term';
   if(recovered.reconciled!==true||recovered[key].id!==before[key].id)throw Error('Native taxonomy reconciliation changed identity');
  }
  console.log('Actual native categories/tags and definitions recovered by exact reads; no repeated creation.');
  const initialCode=await bundle({entryPoints:['src/cms-initial-taxonomy-shape.ts'],bundle:true,format:'esm',platform:'node',write:false});const {initialTaxonomyPath,initialTaxonomies}=await import('data:text/javascript;base64,'+Buffer.from(initialCode.outputFiles[0].text).toString('base64'));
  const terms=[];for(const taxonomy of ['categories','tags']){const {term}=await callCMS(service,identity,'/_emdash/api/taxonomies/'+taxonomy+'/terms/studio-notes',randomUUID());terms.push({taxonomy,id:term.id,slug:term.slug,label:term.label});}
  const assignmentId=randomUUID(),assignment=initialTaxonomies({draftRequestId:recoveryId,itemId:original.item.id,terms});
  const wrong=initialTaxonomies({...assignment,terms:terms.map(t=>({...t,label:'Changed after review'}))});let refused=false;try{await callCMS(service,identity,initialTaxonomyPath,randomUUID(),wrong);}catch(e){refused=e.status===409;}if(!refused)throw Error('Changed taxonomy labels were accepted');
  const assigned=await callCMS(service,identity,initialTaxonomyPath,assignmentId,assignment),again=await callCMS(service,identity,initialTaxonomyPath,assignmentId,assignment);if(JSON.stringify(assigned)!==JSON.stringify(again)||assigned.version!==2)throw Error('Initial taxonomy receipt replay differs');
  for(const taxonomy of ['categories','tags']){const state=await callCMS(service,identity,'/_emdash/api/content/posts/'+original.item.id+'/terms/'+taxonomy,randomUUID());if(state.terms.length!==1||state.terms[0].slug!=='studio-notes')throw Error('Native taxonomy assignment missing');}
  const assignedPost=await callCMS(service,identity,'/_emdash/api/content/posts/'+original.item.id,randomUUID());if(assignedPost.item.version!==2||assignedPost._rev===original._rev||JSON.stringify(assignedPost.item.data)!==JSON.stringify(original.item.data))throw Error('Taxonomy assignment did not fence later edits or changed article content');
  let duplicateRefused=false;try{await callCMS(service,identity,initialTaxonomyPath,randomUUID(),assignment);}catch(e){duplicateRefused=e.status===409;}if(!duplicateRefused)throw Error('A second initial mapping was accepted');
  console.log('Actual native initial category/tag mapping committed together, retained content, advanced the revision and replayed without duplication.');
  const captured=await stableCMSDatabase(async sql=>(await proxy.env.DB.prepare(sql).all()).results);restoreCapturedCMSDatabase(restored,captured.snapshot);
  const roundtrip=await captureCMSDatabase(async sql=>restored.prepare(sql).all());if(roundtrip.digest!==captured.digest)throw Error('Native CMS restore differs from source');
  const expected=['posts','pages'].flatMap(collection=>restored.prepare('SELECT id,title,status,content FROM ec_'+collection).all().map(row=>({...row,collection})));
  const expectedNative=new Map();for(const row of expected)expectedNative.set(row.id,await callCMS(service,identity,'/_emdash/api/content/'+row.collection+'/'+row.id,randomUUID()));
  console.log('Actual EmDash database snapshot restored with identical logical digest ('+captured.snapshot.tables.length+' tables, '+captured.rows+' rows).');
  const targetConfig={...config,d1_databases:[{binding:'DB',database_name:'isolated-cms-restore',database_id:randomUUID()}],r2_buckets:[{binding:'MEDIA',bucket_name:'isolated-cms-restore-media'}],kv_namespaces:[{binding:'SESSION',id:randomUUID().replaceAll('-','')}]};
  const targetPath=join(dir,'restore.json');await writeFile(targetPath,JSON.stringify(targetConfig));
  const target=await wrangler.getPlatformProxy({configPath:targetPath,persist:{path:join(dir,'state','v3')},remoteBindings:false});
  try{await restoreCapturedCMSD1(target.env.DB,captured.snapshot);}finally{await target.dispose();}
  await stopServer();await startServer(targetPath);
  await verifyCMSInitialization(service,identity);
  for(const row of expected){const data=await callCMS(service,identity,'/_emdash/api/content/'+row.collection+'/'+row.id,randomUUID());const before=expectedNative.get(row.id);if(data.item.id!==row.id||data.item.status!==before.item.status||JSON.stringify(data.item.data)!==JSON.stringify(before.item.data)||data._rev!==before._rev)throw Error('Restored native article differs from its pre-restore native snapshot');}
  if(expected.length!==4||expected.filter(row=>row.collection==='posts').length!==3||expected.filter(row=>row.collection==='pages').length!==1)throw Error('Restored fixture must include three posts and one page; neither taxonomy refusal nor identity recovery may add extra articles');
  for(const name of ['categories','tags']){const term=await callCMS(service,identity,'/_emdash/api/taxonomies/'+name+'/terms/studio-notes',randomUUID());if(!JSON.stringify(term).includes('Studio notes'))throw Error('Restored native taxonomy term differs');}
  for(const taxonomy of ['categories','tags']){const state=await callCMS(service,identity,'/_emdash/api/content/posts/'+original.item.id+'/terms/'+taxonomy,randomUUID());if(state.terms.length!==1||state.terms[0].slug!=='studio-notes')throw Error('Restored category/tag mapping differs');}
  const first=expected.find(row=>row.collection==='pages'),path='/_emdash/api/content/'+first.collection+'/'+first.id,current=await callCMS(service,identity,path,randomUUID());
  const shapeCode=await bundle({entryPoints:['src/cms-content-shape.ts'],bundle:true,format:'esm',platform:'node',write:false});const {cmsStagedEditBody}=await import('data:text/javascript;base64,'+Buffer.from(shapeCode.outputFiles[0].text).toString('base64'));
  const edit=await callCMS(service,identity,path,randomUUID(),cmsStagedEditBody('Recovered article edit','Native write after isolated restore',current._rev),'PUT');if(edit.item.data.title!=='Recovered article edit'||edit._rev===current._rev)throw Error('Restored native CMS could not save a revision');
  console.log('Restored native EmDash boots on isolated local D1: closed setup, pinned owner, schemas, text/image article bodies and post-restore native text editing verified (database restoration only; media bytes excluded).');
  const importTarget=await wrangler.getPlatformProxy({configPath:targetPath,persist:{path:join(dir,'state','v3')},remoteBindings:false});
  try{await verifyMappedImport({service,identity,db:importTarget.env.DB});}finally{await importTarget.dispose();}
 }finally{restored.close();await proxy.dispose();}

}finally{
 await stopServer();
 await rm(dir,{recursive:true,force:true});
}
