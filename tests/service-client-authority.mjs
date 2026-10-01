import {createFixtureWebsite,changeFixtureWebsite} from './current-site-fixture.mjs';
Error.stackTraceLimit=0;
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import wrangler from 'wrangler';
const dir=await mkdtemp('/tmp/whumpo-client-authority-');let proxy,runtime;
const id=()=>crypto.randomUUID(),now=()=>new Date().toISOString();
const oldFetch=globalThis.fetch;let network=0,executions=0;
try{
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--config','wrangler.runtime.jsonc','--dry-run','--outdir',dir+'/runtime'],{stdio:'pipe',maxBuffer:16*1024*1024});
 const require=createRequire(import.meta.resolve('wrangler')),{Miniflare,convertV4MiniflareOptions}=require('miniflare');
 runtime=new Miniflare(convertV4MiniflareOptions({modulesRoot:dir+'/runtime',modules:[{type:'ESModule',path:dir+'/runtime/worker.js'},...(await readdir(dir+'/runtime')).filter(p=>p.endsWith('.wasm')).map(p=>({type:'CompiledWasm',path:dir+'/runtime/'+p}))],compatibilityDate:'2026-09-29'}));
 proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB;
 const built=await build({stdin:{contents:"export * from './src/project-specification/service-clients/compiler';export * from './src/project-specification/service-clients/owned';export {siteConfig,renderSite} from './src/components';export {hashToken} from './src/security';export {publicationCommand} from './src/publications';export {contactCommand,activeContact} from './src/contacts';export {versionRemovalCommand} from './src/version-removal';export {prepareBackendForm,confirmBackendForm,activeBackendForm} from './src/backend-forms';export {saveBackend,testBackend} from './src/backend-versions';export {prepareBackendPublication,confirmBackendPublication} from './src/backend-publication';export {default as host} from './src/site-host';",resolveDir:process.cwd()},bundle:true,platform:'node',format:'esm',write:false});
 await writeFile(dir+'/fixture.mjs',built.outputFiles[0].contents);const m=await import(pathToFileURL(dir+'/fixture.mjs'));
 // Only local service bindings work. Maintenance/provider inference has no route.
 globalThis.fetch=async()=>{network++;throw Error('No maintenance inference/network in service compilation or runtime.');};
 const service={fetch:async(request,init)=>{executions++;return runtime.dispatchFetch(request,init);}};
 const form={title:'Garden estimate',description:'Choose hours and extras.',buttonLabel:'Calculate',fields:[{key:'hours',label:'Hours',type:'number'},{key:'extra',label:'Extra care',type:'boolean'}]};
 const spec={schemaVersion:1,contact:{component:'contact-link@1'},statelessForm:{component:'stateless-form@1',config:form}},empty={schemaVersion:1,contact:null,statelessForm:null},contact={...empty,contact:spec.contact},lock=m.currentServiceClientLock();
 async function command(a,handler,text){const turn=id(),state=await db.prepare('SELECT revision FROM workspace_state WHERE user_id=?').bind(a.user).first();const prepared=await handler(db,a.user,turn,text);assert.ok(prepared);await db.batch([db.prepare('INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at) VALUES(?,?,?,?,?,?)').bind(turn,a.user,state.revision+1,text,prepared.reply,now()),...prepared.statements,db.prepare('UPDATE workspace_state SET revision=revision+1 WHERE user_id=?').bind(a.user)]);return turn;}
 async function publish(a,version=a.version){const review=await command(a,m.publicationCommand,'/publish '+version);await command(a,m.publicationCommand,'/confirm '+review);}
 async function contactSetting(a,enabled){const review=await command(a,m.contactCommand,(enabled?'/contact-on ':'/contact-off ')+a.project);await command(a,m.contactCommand,'/confirm-contact '+review);}
 async function website(a,theme='forest'){const head=await db.prepare('SELECT revision FROM project_spec_heads WHERE project_id=?').bind(a.project).first();return head?changeFixtureWebsite(db,a.user,a.project,[{type:'design.setTheme',theme}]):createFixtureWebsite(db,a.user,a.project,{name:'Garden studio',headline:'Care for your garden',description:'Local garden services.',aboutTitle:'Our work',aboutText:'Neighborhood care.',theme,sections:[],photos:[]});}
 async function fixture(){const a={user:id(),project:id()};await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(a.user,a.user+'@example.test',now()).run();await db.prepare('INSERT INTO workspace_state(user_id) VALUES(?)').bind(a.user).run();await db.prepare('INSERT INTO projects(id,owner_user_id,name,created_at,updated_at) VALUES(?,?,?,?,?)').bind(a.project,a.user,'Garden studio',now(),now()).run();a.version=await website(a);return a;}
 async function backend(a){a.backend=id();a.run=id();a.publication=id();await m.saveBackend(db,a.user,a.project,a.backend,'export default ({hours,extra})=>({estimate:hours*30+(extra?10:0)})');await m.testBackend(db,service,a.user,a.project,a.backend,a.run,{hours:2,extra:true},{expected:{estimate:70}});await m.prepareBackendPublication(db,a.user,a.project,a.publication,'publish',a.backend,a.run);await m.confirmBackendPublication(db,a.user,a.publication);}
 const a=await fixture(),b=await fixture();
 const compile=(a,s=spec,version=a.version)=>m.compileOwnedServiceClients(db,a.user,a.project,version,s,lock);
 const page=a=>m.host.fetch(new Request(`https://${a.project}.whumpo.site/`),{DB:db,FILES:proxy.env.FILES,BACKEND_RUNTIME:service});
 const call=(a,publication,input)=>m.host.fetch(new Request(`https://${a.project}.whumpo.site/backend/${publication}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)}),{DB:db,FILES:proxy.env.FILES,BACKEND_RUNTIME:service});
 await assert.rejects(compile(a),e=>e.status===409);const privateContact=await compile(a,contact);assert.equal(privateContact.target.publication.versionId,null);assert.equal((await page(a)).status,404);assert.equal(await m.activeContact(db,a.project),null);
 await assert.rejects(m.compileOwnedServiceClients(db,b.user,a.project,a.version,contact,lock),e=>e.status===404);
 await assert.rejects(compile(a,contact,b.version),e=>e.status===404);
 // A second project for the same account cannot lend its site version either.
 const other=id();await db.prepare('INSERT INTO projects(id,owner_user_id,name,created_at,updated_at) VALUES(?,?,?,?,?)').bind(other,a.user,'Other',now(),now()).run();const otherVersion=await website({...a,project:other});await assert.rejects(compile(a,contact,otherVersion),e=>e.status===404);
 await publish(a);await backend(a);await publish(b);await backend(b);
 const start=executions,compiled=await compile(a);assert.equal(executions,start);assert.equal(network,0);assert.equal(await m.activeBackendForm(db,a.project),null);assert.equal(await m.activeContact(db,a.project),null);
 assert.deepEqual(await compile(a),compiled);await m.requireCurrentServiceClientTarget(db,a.user,compiled.target);
 assert.equal(compiled.target.backend.versionId,a.backend);assert.equal(compiled.target.backend.reviewId,a.publication);assert.notEqual(compiled.target.backend.reviewId,b.publication);
 const before=await db.prepare('SELECT count(*) n FROM backend_form_reviews').first();await compile(a);assert.equal((await db.prepare('SELECT count(*) n FROM backend_form_reviews').first()).n,before.n);
 await assert.rejects(m.requireCurrentServiceClientTarget(db,b.user,compiled.target),e=>e.status===404);
 // Existing independent review handlers activate these exact client configurations.
 const formReview=id();await m.prepareBackendForm(db,a.user,a.project,formReview,form);await contactSetting(a,true);await assert.rejects(m.requireCurrentServiceClientTarget(db,a.user,compiled.target),e=>e.status===409);await m.confirmBackendForm(db,a.user,formReview);
 const active=await compile(a);assert.ok(active.target.contact.active&&active.target.form.active);assert.equal(await(await page(a)).text(),active.artifacts.find(x=>x.kind==='release-candidate').html);
 const publicCall=await call(a,a.publication,{hours:3,extra:true});assert.equal(publicCall.status,200);assert.deepEqual(await publicCall.json(),{ok:true,value:{estimate:100}});assert.equal(network,0);
 // Republished backend, even the same saved source, invalidates old clients before invocation.
 const replacement=id();await m.prepareBackendPublication(db,a.user,a.project,replacement,'publish',a.backend,a.run);await m.confirmBackendPublication(db,a.user,replacement);await assert.rejects(m.requireCurrentServiceClientTarget(db,a.user,active.target),e=>e.status===409);
 const beforeStale=executions;assert.equal((await call(a,a.publication,{hours:1,extra:false})).status,404);assert.equal(executions,beforeStale);assert.equal(await m.activeBackendForm(db,a.project),null);
 const refreshed=await compile(a);assert.equal(refreshed.target.backend.reviewId,replacement);assert.notEqual(refreshed.manifestDigest,active.manifestDigest);
 const nextForm=id();await m.prepareBackendForm(db,a.user,a.project,nextForm,form);await m.confirmBackendForm(db,a.user,nextForm);const beforeSite=await compile(a);
 const second=await website(a,'clay');await publish(a,second);assert.equal(await m.activeBackendForm(db,a.project),null);assert.equal(await m.activeContact(db,a.project),null);await assert.rejects(m.requireCurrentServiceClientTarget(db,a.user,beforeSite.target),e=>e.status===409);
 // Restoring the original website is a new publication revision and cannot resurrect services.
 await publish(a);assert.equal(await m.activeBackendForm(db,a.project),null);assert.equal(await m.activeContact(db,a.project),null);await assert.rejects(m.requireCurrentServiceClientTarget(db,a.user,compiled.target),e=>e.status===409);
 const fresh=await compile(a);assert.equal(fresh.artifacts[1].html,compiled.artifacts[1].html.replaceAll(a.publication,replacement));assert.notEqual(fresh.targetDigest,compiled.targetDigest);
 // Turning a form off invalidates a pending read snapshot even while website/backend stay put.
 const on=id();await m.prepareBackendForm(db,a.user,a.project,on,form);await m.confirmBackendForm(db,a.user,on);const withForm=await compile(a),off=id();await m.prepareBackendForm(db,a.user,a.project,off,null);await m.confirmBackendForm(db,a.user,off);await assert.rejects(m.requireCurrentServiceClientTarget(db,a.user,withForm.target),e=>e.status===409);
 const removable=await website(a),deleted=await compile(a,contact,removable);await website(a,'ocean');const removal=await command(a,m.versionRemovalCommand,'/delete-version '+removable);await command(a,m.versionRemovalCommand,'/confirm-version-delete '+removal);await assert.rejects(m.requireCurrentServiceClientTarget(db,a.user,deleted.target),e=>e.status===404);
 // Synthetic existing hold is a refusal, not a detector/clearance demonstration.
 await db.prepare("INSERT INTO content_screening_decisions(user_id,kind,digest,policy_version,first_required,required,first_reason,first_percent,first_risk_score) VALUES(?,'generated_artifact',?,'synthetic-hold',1,1,'risk_or_missing_history',100,90)").bind(a.user,fresh.target.website.digest).run();await assert.rejects(compile(a),e=>e.status===423);await assert.rejects(m.requireCurrentServiceClientTarget(db,a.user,fresh.target),e=>e.status===423);
 // Cross-owner same digest is not automatically held by another account's decision.
 assert.ok(await compile(b));
 const offline=id();await m.prepareBackendPublication(db,b.user,b.project,offline,'unpublish',b.backend,null);await m.confirmBackendPublication(db,b.user,offline);await assert.rejects(compile(b),e=>e.status===409);assert.ok(await compile(b,contact));
 assert.equal(network,0);
 console.log('Service client authority passed: two owners/projects, read-only compilation, exact current reviews, real isolated QuickJS operation without maintainer inference, settings/republication/withdrawal/deletion/hold refusal. Existing review paths only; no new endpoint or deployment.');
}finally{globalThis.fetch=oldFetch;await proxy?.dispose();await runtime?.dispose();await rm(dir,{recursive:true,force:true});}
