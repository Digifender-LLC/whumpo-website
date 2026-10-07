import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFile} from 'node:fs/promises';
import {portalFixture} from './helpers/portal-fixture.mjs';
import {moduleClient} from '../web/module-client.js';
import {changeFixtureWebsite,proposeFixtureWebsite,applyFixtureWebsite} from './current-site-fixture.mjs';
Error.stackTraceLimit=0;
const f=await portalFixture({d1:process.argv.includes('--d1')}),{m,db,row,run}=f;let groups=0,network=0;
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{network++;throw Error('No inference or provider');};
const check=async(name,fn)=>{try{await fn();groups++;}catch(e){console.error(name);throw e;}};
try{
 const a=await f.owner('First studio'),b=await f.owner('Other studio'),visitor=await f.visitor(a),other=await f.visitor(a),foreign=await f.visitor(b),staff=await f.visitor(a);await f.role(a,staff.visitorId,'grant');
 const saved=await row('SELECT v.spec_json FROM project_spec_heads h JOIN project_spec_versions v ON v.version_id=h.version_id WHERE h.project_id=?',a.project),base=JSON.parse(saved.spec_json);
 const compiled=[];
 const exporterBundle=await build({entryPoints:['src/visitor-presentation/export.ts'],bundle:true,format:'esm',platform:'neutral',write:false});
 const {serializePortal}=await import('data:text/javascript;base64,'+Buffer.from(exporterBundle.outputFiles[0].contents).toString('base64'));
 const clientSource=await readFile('public-app/module-portal.js','utf8');
 await check('closed contract, bounded custom component and focused edits',async()=>{
  for(const layout of ['studio','journal','desk']){
   const c=await m.compileProjectSpecification({...base,presentation:f.presentation(layout)},m.currentCompilerLock());compiled.push(c);
   const archive=await serializePortal(c.specification,m.currentCompilerLock(),clientSource);assert.deepEqual(archive,await serializePortal(c.specification,m.currentCompilerLock(),clientSource));assert.equal(archive.files.find(f=>f.path==='public/portal/index.html').text,c.presentation.html);await assert.rejects(()=>serializePortal(c.specification,m.currentCompilerLock(),clientSource+' '));
   assert.deepEqual(c,await m.compileProjectSpecification({...base,presentation:f.presentation(layout)},m.currentCompilerLock()));assert(c.presentation.html.includes(`data-layout="${layout}"`));
  }
  assert.equal(new Set(compiled.map(c=>c.presentation.digest)).size,3);
  const before=compiled[0].specification,edited=await m.compileSpecificationChange(before,[{type:'presentation.putBlock',block:{...before.presentation.blocks[0],paragraphs:['<img src=x onerror=alert(1)>']}}],m.currentCompilerLock());
  assert.deepEqual(edited.compiled.specification.instances,before.instances);assert.deepEqual(edited.compiled.specification.pages,before.pages);assert.deepEqual(edited.compiled.specification.presentation.blocks.slice(1),before.presentation.blocks.slice(1));assert(edited.compiled.presentation.html.includes('&lt;img'));
  for(const mutate of [p=>p.source='alert(1)',p=>p.version=2,p=>p.template='remote@1',p=>p.blocks[0].href='https://evil.example',p=>p.blocks[1].instanceId='foreign',p=>p.blocks[0].paragraphs=['x'.repeat(401)],p=>p.blocks[1].targetId='missing',p=>p.accessInstanceId='enquiries']){
   const p=f.presentation();mutate(p);await assert.rejects(()=>m.compileProjectSpecification({...base,presentation:p},m.currentCompilerLock()));
  }
  const stale=m.currentCompilerLock();stale.compiler.version=5;await assert.rejects(()=>m.compileProjectSpecification(base,stale));
 });
 await check('exact owner control, inert private preview and publication comparison',async()=>{
  const p=f.presentation(),review=await f.control(a,{type:'presentationReview',projectId:a.project,presentation:p}),q=await m.readSpecificationProposal(db,a.user,review);
  assert(JSON.parse(q.diff_json).some(d=>d.label==='Visitor portal'));assert.equal((await f.request(a,'/portal')).status,404);
  const response=await m.worker.fetch(new Request('https://whumpo.com/api/specification-reviews/'+review+'/presentation',{headers:{cookie:'__Host-whumpo_session='+a.token}}),f.env,{waitUntil(){}});assert.equal(response.status,200);const html=await response.text();assert(!html.includes('<script'));assert(html.includes('Private preview'));assert.match(response.headers.get('content-security-policy'),/sandbox/);
  const denied=await m.worker.fetch(new Request('https://whumpo.com/api/specification-reviews/'+review+'/presentation',{headers:{cookie:'__Host-whumpo_session='+b.token}}),f.env,{waitUntil(){}});assert.equal(denied.status,404);
  const applied=await applyFixtureWebsite(a.scope,a.user,q);assert.equal(applied.status,200);assert.equal((await f.request(a,'/portal')).status,404);
  const read=await m.specificationAction(db,a.user,crypto.randomUUID(),{kind:'specification',operation:'readPresentation',projectId:a.project,blockId:'welcome'});const selected=JSON.parse(read.inspection);assert.equal(selected.component.id,'welcome');assert.equal(selected.backend,null);assert(!read.inspection.includes('recordId'));assert(!read.inspection.includes('Private owner-only value'));assert(m.inspectionRequest(JSON.stringify({reply:'Inspect portal',action:{kind:'specification',operation:'readPresentation',projectId:a.project,blockId:'welcome'}})));
  const diff=await m.compareVersions(db,a.user,applied.version);assert(diff.changes.some(c=>c.label==='Visitor portal'&&c.after.includes(p.title)));await f.publish(a,applied.version);
 });
 const sent=[];
 async function clientFor(o,v){const response=await f.request(o,'/portal/config');assert.equal(response.status,200);const manifest=await response.json();return {manifest,client:moduleClient({manifest,send:async(path,body)=>{sent.push(body);const response=await f.request(o,'/'+path,{visitor:v,body});return {status:response.status,...await response.json()};}})};}
 await check('three layouts, identical real API permission conformance and exact replay',async()=>{
  for(const layout of ['studio','journal','desk']){
   if(layout!=='studio')await f.publish(a,await f.configure(a,f.presentation(layout)));const page=await f.request(a,'/portal');assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/script-src 'self'/);assert(!page.headers.get('content-security-policy').includes('unsafe-inline'));assert.match(page.headers.get('cache-control'),/no-store/);
   const {client,manifest}=await clientFor(a,visitor),foreignClient=(await clientFor(a,foreign)).client,anonymous=(await clientFor(a,null)).client,second=(await clientFor(a,other)).client,team=(await clientFor(a,staff)).client;
   assert.equal((await client.read('members','access.me')).status,200);assert.equal((await foreignClient.read('members','access.me')).status,403);assert.equal((await anonymous.read('enquiries','records.view',{viewId:'mine',cursor:null})).status,403);
   assert.equal((await client.read('enquiries','records.view',{viewId:'desk',cursor:null})).status,403);
   const envelope=client.request('enquiries','forms.submit',{formId:'enquiry'},{values:{name:'Private '+layout,message:'Visitor <script>value</script>',private:'Owner-only marker'},attachments:[]},crypto.randomUUID());
   const post=()=>f.request(a,'/modules',{visitor,body:envelope});const first=await (await post()).json(),replay=await (await post()).json();assert(first.result.accepted);assert.equal(replay.result.entryId,first.result.entryId);assert(replay.receipt.replayed);
   const own=await client.read('enquiries','records.view',{viewId:'mine',cursor:null});assert(own.result.items.some(i=>i.entryId===first.result.entryId));assert(!JSON.stringify(own).includes('Owner-only marker'));
   const empty=await second.read('enquiries','records.view',{viewId:'mine',cursor:null});assert.equal(empty.result.items.length,0);assert((await team.read('enquiries','records.view',{viewId:'desk',cursor:null})).result.items.length>0);
   assert.equal((await f.request(b,'/modules',{visitor:foreign,body:envelope})).status,404);
   assert.equal((await f.request(a,'/modules',{visitor,body:{...envelope,configRevision:99}})).status,409);
   assert.equal((await f.request(a,'/modules',{visitor,body:{...envelope,ownerId:a.user}})).status,400);
   assert.equal((await f.request(a,'/modules',{visitor,body:envelope,origin:b.host})).status,403);
   assert(!JSON.stringify(manifest).includes('Owner-only marker'));
  }
 });
 await check('revocation, publication withdrawal, active config drift and safety holds',async()=>{
  const {client,manifest}=await clientFor(a,staff);await f.role(a,staff.visitorId,'revoke');assert.equal((await client.read('enquiries','records.view',{viewId:'desk',cursor:null})).status,403);
  await f.activate(a,'enquiries','disable');assert.equal((await f.request(a,'/portal')).status,503);await f.activate(a,'enquiries');
  const updated=structuredClone(f.records);updated.config.schemas[0].fields.push({key:'extra',label:'Extra',type:'text',optional:true,read:'submitter'});updated.config.schemas[0].fieldsRevision++;
  await changeFixtureWebsite(a.scope,a.user,a.project,[{type:'modules.put',instance:updated}]);await f.activate(a,'enquiries');assert.equal((await f.request(a,'/portal')).status,503);
  await f.publish(a,(await row('SELECT version_id FROM project_spec_heads WHERE project_id=?',a.project)).version_id);assert.equal((await f.request(a,'/portal')).status,200);
  const digest=(await row("SELECT json_extract(v.manifest_json,'$.presentation.digest') spec_digest FROM publications p JOIN project_spec_versions v ON v.version_id=p.version_id WHERE p.project_id=?",a.project)).spec_digest;
  await run("INSERT INTO content_screening_decisions(user_id,kind,digest,policy_version,first_required,required,first_reason,first_percent,first_risk_score) VALUES(?,'generated_artifact',?,'synthetic-policy',1,1,'risk_or_missing_history',100,60)",a.user,digest);
  assert.equal((await f.request(a,'/portal')).status,503);assert.equal((await f.request(a,'/portal/config')).status,423);
  await f.control(a,{type:'confirm',kind:'site',reviewId:await f.chat(a,'/unpublish '+a.project)});assert.equal((await f.request(a,'/portal')).status,404);
 });
 await check('exact portal artifact holds and late save rollback',async()=>{
  const p={...f.presentation(),title:'Held preview fixture'},review=await f.control(b,{type:'presentationReview',projectId:b.project,presentation:p}),q=await m.readSpecificationProposal(db,b.user,review),turn=crypto.randomUUID();
  const prepared=await m.applySpecificationCommand(b.scope,b.user,turn,`/confirm-specification ${q.id} ${q.proposal_digest} ${q.expected_revision}`),artifact=JSON.parse(q.manifest_json).presentation;
  await run("INSERT INTO content_screening_decisions(user_id,kind,digest,policy_version,first_required,required,first_reason,first_percent,first_risk_score) VALUES(?,'generated_artifact',?,'synthetic-portal-preview',1,1,'risk_or_missing_history',100,60)",b.user,artifact.previewDigest);
  await assert.rejects(()=>m.readSpecificationProposal(db,b.user,review),e=>e.status===423);
  await assert.rejects(async()=>b.scope.batch([b.scope.prepare('INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,action_json) VALUES(?,?,?,?,?,?,?)').bind(turn,b.user,(await m.readChat(b.scope,b.user)).state.revision+1,'Save reviewed website changes',prepared.reply,new Date().toISOString(),JSON.stringify({type:'specificationApply',reviewId:q.id,proposalDigest:q.proposal_digest,expectedRevision:q.expected_revision})),...prepared.statements]),/specification_held/);
  assert.equal(await row('SELECT version_id FROM project_spec_versions WHERE version_id=?',turn),null);
  assert.equal((await row('SELECT version_id FROM project_spec_heads WHERE project_id=?',b.project)).version_id,q.base_version_id);
 });
 await check('maintained browser dependency graph and zero inference',async()=>{
  const bundled=await build({entryPoints:['web/module-portal.js'],bundle:true,write:false,format:'iife',metafile:true});assert(!Object.keys(bundled.metafile.inputs).some(p=>/src\/(?:security|ai|backend-versions|app-auth|chat)|node_modules.*(?:openai|anthropic)/.test(p)));
  const source=await readFile('web/module-portal.js','utf8');assert(!/innerHTML|document\.cookie|eval\(|new Function/.test(source));assert(sent.every(e=>Object.keys(e).sort().join(',')==='api,configRevision,input,operation,requestId,resourceId,target,version'));assert.equal(network,0);
 });
 console.log(`Visitor presentation passed ${groups} groups (${process.argv.includes('--d1')?'local D1/R2':'SQLite'}): three layouts, exact private review/publication, deterministic compiler/custom card, focused edits, shared API auth/fields/replay/revocation/tenant checks, fail-closed drift and zero inference.`);
}finally{globalThis.fetch=originalFetch;await f.fixture.close();}
