import assert from 'node:assert/strict';
import {accountClosureInventory} from '../tools/account-closure-inventory.mjs';
import {mkdtemp,rm,readdir,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {build} from 'esbuild';
import wrangler from 'wrangler';
Error.stackTraceLimit=2;
const dir=await mkdtemp('/tmp/whumpo-service-journey-');let proxy,runtime;
const originalFetch=globalThis.fetch,background=[],ctx={waitUntil:p=>background.push(p)};
try{
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','tellumo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--config','wrangler.runtime.jsonc','--dry-run','--outdir',dir+'/runtime'],{stdio:'pipe',maxBuffer:16*1024*1024});
 const require=createRequire(import.meta.resolve('wrangler')),{Miniflare,convertV4MiniflareOptions}=require('miniflare');
 runtime=new Miniflare(convertV4MiniflareOptions({modulesRoot:dir+'/runtime',modules:[{type:'ESModule',path:dir+'/runtime/worker.js'},...(await readdir(dir+'/runtime')).filter(p=>p.endsWith('.wasm')).map(p=>({type:'CompiledWasm',path:dir+'/runtime/'+p}))],compatibilityDate:'2026-09-29'}));
 proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB;
 const built=await build({stdin:{contents:"export {default as platform} from './src/index';export {default as host} from './src/site-host';export {hashToken} from './src/security';export {sendChatControl} from './src/chat';export * from './src/project-specification/service-clients/store';export * from './src/project-specification/service-clients/activation';export {confirmBackendForm} from './src/backend-forms';export {saveContact,contactCommand} from './src/contacts';export {saveBackend,testBackend} from './src/backend-versions';export {prepareBackendPublication,confirmBackendPublication} from './src/backend-publication';export {activeContact} from './src/contacts';export {activeBackendForm} from './src/backend-forms';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
 await writeFile(dir+'/fixture.mjs',built.outputFiles[0].contents);const m=await import(pathToFileURL(dir+'/fixture.mjs'));
 let calls=0,executions=0,actions=[],expectLookup=false,expectHistory=false,inference=true;
 const service={fetch:async(request,init)=>{executions++;return runtime.dispatchFetch(request,init);}};
 const env={DB:db,FILES:proxy.env.FILES,BACKEND_RUNTIME:service,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})},AI_BASE_URL:'https://opencode.ai/zen/go/v1',AI_MODEL:'muse-spark-1.3-contributor',AI_PROTOCOL:'responses',AI_API_KEY:'synthetic-fixture-only'};
 globalThis.fetch=async(url,init)=>{
  assert.ok(inference,'No maintainer inference is available for visitor actions or approval');assert.equal(String(url),'https://opencode.ai/zen/go/v1/responses');const body=JSON.parse(init.body),ack=body.max_output_tokens===256;
  if(!ack){calls++;assert.ok(actions.length,'Unexpected model call');
   if(expectHistory&&actions[0]?.operation==='restore'){const lookup=body.input.map(m=>{try{return JSON.parse(m.content);}catch{return null;}}).find(m=>m?.type==='workspace_lookup_result');assert.ok(lookup);const saved=JSON.parse(lookup.result);assert.equal(saved.type,'website_service_history');assert.ok(saved.versions.some(v=>v.id===actions[0].versionId));assert.equal(saved.revision,actions[0].expectedRevision);expectHistory=false;}
   if(expectLookup&&actions[0]?.operation==='prepare'){
    const lookup=body.input.map(m=>{try{return JSON.parse(m.content);}catch{return null;}}).find(m=>m?.type==='workspace_lookup_result');assert.ok(lookup,'Read continuation must include actual saved settings');
    const saved=JSON.parse(lookup.result);assert.equal(saved.type,'website_service_settings');assert.equal(saved.revision,actions[0].expectedRevision);assert.equal(saved.configuration.contact.component,'contact-link@1');assert.ok(saved.websiteVersionId);expectLookup=false;
   }
  }
  return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(ack?{intent:'editing'}:{reply:'Synthetic interpretation',action:actions.shift()})}]}],usage:{input_tokens:100,output_tokens:100}});
 };
 const id=()=>crypto.randomUUID(),now=()=>new Date().toISOString();
 const call=(a,path,method='GET',data,origin='https://whumpo.com')=>m.platform.fetch(new Request('https://whumpo.com'+path,{method,headers:{origin,'content-type':'application/json',cookie:'tellumo_session='+(a?.token??'')},...(data?{body:JSON.stringify(data)}:{})}),env,ctx);
 async function json(a,path,method='GET',data){const r=await call(a,path,method,data);assert.equal(r.status,200,path+' '+await r.clone().text());return r.json();}
 async function account(){const a={id:id(),token:(id()+id()).replaceAll('-','')};await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(a.id,a.id+'@example.test',now()).run();await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await m.hashToken(a.token),a.id,new Date(Date.now()+3600000).toISOString(),now()).run();
  await json(a,'/api/profile','PATCH',{revision:0,name:'River',avatar_id:'sun',about_me:'',share_context:false});await json(a,'/api/onboarding');await json(a,'/api/onboarding','PUT',{revision:0,stage:'review',project_name:'Example Garden',idea:'A local landscaping business.',audience:'Neighbors',preferred_theme:'forest'});await json(a,'/api/onboarding/complete','POST',{revision:1});a.project=(await db.prepare('SELECT id FROM projects WHERE owner_user_id=?').bind(a.id).first()).id;return a;}
 async function chat(a,action,text='Please prepare the website service settings.'){actions=Array.isArray(action)?action:[action];expectLookup=Array.isArray(action)&&action[0]?.kind==='serviceClients'&&action[0]?.operation==='read';expectHistory=Array.isArray(action)&&action[0]?.kind==='serviceClients'&&action[0]?.operation==='history';const input={id:id(),revision:(await json(a,'/api/chat')).state.revision,content:text},data=await json(a,'/api/chat','POST',input);await Promise.all(background);assert.equal(actions.length,0);assert.equal(expectLookup,false);assert.equal(expectHistory,false);return {input,data,turn:data.turns.at(-1)};}
 const sc=(a,operation,fields={})=>({kind:'serviceClients',operation,projectId:a.project,...fields});
 async function input(a,action){return {id:id(),revision:(await json(a,'/api/chat')).state.revision,action};}
 const approval=q=>({type:'serviceClientApply',reviewId:q.id,proposalDigest:q.proposalDigest,expectedRevision:q.expectedRevision});
 async function approve(a,q){assert.ok(q,'Proposal must expose exact server review metadata');const request=await input(a,approval(q)),before=calls;inference=false;let data;try{data=await json(a,'/api/chat/actions','POST',request);}finally{inference=true;}assert.equal(calls,before);return {request,data,version:request.id};}
 async function confirm(a,kind,review){const before=calls;inference=false;try{return await json(a,'/api/chat/actions','POST',await input(a,{type:'confirm',kind,reviewId:review}));}finally{assert.equal(calls,before);inference=true;}}
 async function proposal(a,request,remainingMs){const turn=id(),revision=(await json(a,'/api/chat')).state.revision,clock=Date.now;let prepared;try{if(remainingMs)Date.now=()=>clock()-600000+remainingMs;prepared=await m.prepareServiceClients(db,a.id,turn,request);}finally{Date.now=clock;}
  await db.batch([db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,mode,status,created_at) VALUES(?,?,?,'Synthetic review fixture','','ai','pending',?)").bind(turn,a.id,revision+1,now()),...prepared.statements,db.prepare("UPDATE chat_turns SET assistant_text=?,status='completed' WHERE id=?").bind(prepared.reply,turn),db.prepare('UPDATE workspace_state SET revision=? WHERE user_id=?').bind(revision+1,a.id)]);
  const q=await m.readServiceClientProposal(db,a.id,turn);return {id:q.id,proposalDigest:q.proposal_digest,expectedRevision:q.expected_revision,expiresAt:q.expires_at};
 }
 async function preparedConfirmation(a,q){const turn=id(),command=`/confirm-service-clients ${q.id} ${q.proposalDigest} ${q.expectedRevision}`,prepared=await m.applyServiceClientsCommand(db,a.id,turn,command),revision=(await json(a,'/api/chat')).state.revision;return {turn,statements:[db.prepare('INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at) VALUES(?,?,?,?,?,?)').bind(turn,a.id,revision+1,command,prepared.reply,now()),...prepared.statements]};}
 const count=async(table,project)=>Number((await db.prepare(`SELECT count(*) n FROM ${table} WHERE project_id=?`).bind(project).first()).n);
 const served=a=>m.host.fetch(new Request('https://'+a.project+'.whumpo.site/'),env);
 const config={name:'Example Garden',description:'Landscaping for neighbors.',headline:'A greener neighborhood',theme:'forest',aboutTitle:'Our work',aboutText:'Local garden care.',sections:[]};
 const empty={schemaVersion:1,contact:null,statelessForm:null},contact={...empty,contact:{component:'contact-link@1'}};
 const form={title:'Garden estimate',description:'Choose hours and extras.',buttonLabel:'Calculate',fields:[{key:'hours',label:'Hours',type:'number'},{key:'extra',label:'Extra care',type:'boolean'}]},both={...contact,statelessForm:{component:'stateless-form@1',config:form}};
 async function backend(a,source='export default ({hours,extra})=>({estimate:hours*30+(extra?10:0)})'){a.backend=id();a.run=id();a.backendReview=id();await m.saveBackend(db,a.id,a.project,a.backend,source);await m.testBackend(db,service,a.id,a.project,a.backend,a.run,{hours:2,extra:true},{expected:{estimate:70}});await m.prepareBackendPublication(db,a.id,a.project,a.backendReview,'publish',a.backend,a.run);await m.confirmBackendPublication(db,a.id,a.backendReview);}
 const owner=await account(),foreign=await account();
 async function website(a,theme='forest'){const r=await chat(a,{kind:'preview',projectId:a.project,config:{...config,theme}});assert.ok(r.turn.version_id);return r.turn.version_id;}
 async function publish(a,version){const r=await chat(a,{kind:'review',operation:'publish',targetId:version});await confirm(a,'site',r.input.id);}
 const prepare=(a,expectedRevision,configuration=both,websiteVersionId=a.site)=>sc(a,'prepare',{expectedRevision,websiteVersionId,configuration});
 const activation=(a,versionId,service)=>sc(a,'reviewActivation',{versionId,service});
 async function save(a,revision,configuration=both,site=a.site){const q=await chat(a,prepare(a,revision,configuration,site));return approve(a,q.turn.service_client_review);}
 async function activationReview(a,version,service){const r=await chat(a,activation(a,version,service));assert.ok(r.turn.service_client_activation,r.turn.assistant_text);assert.equal(r.turn.service_client_activation.id,r.input.id);return r;}
 async function confirmActivation(a,r){return confirm(a,r.turn.service_client_activation.service==='contact'?'contact':'backendForm',r.input.id);}
 const status=async r=>(await db.prepare('SELECT status FROM service_client_activation_state WHERE id=?').bind(r).first()).status;
 async function preparedActivation(a,version,service){const turn=id(),state=(await json(a,'/api/chat')).state.revision,result=await m.prepareServiceClientActivation(db,a.id,turn,activation(a,version,service));return {turn,statements:[db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,mode,status,created_at) VALUES(?,?,?,'Prepare service activation','','ai','pending',?)").bind(turn,a.id,state+1,now()),...result.statements,db.prepare("UPDATE chat_turns SET status='completed',assistant_text=? WHERE id=?").bind(result.reply,turn),db.prepare('UPDATE workspace_state SET revision=revision+1 WHERE user_id=?').bind(a.id)]};}
 if(process.env.WHUMPO_SERVICE_ACTIVATION_BROWSER!=='1'){
 owner.site=await website(owner);await backend(owner);const saved=await save(owner,0),v1=saved.version;
 const unpublished=await chat(owner,activation(owner,v1,'contact'));assert.equal(unpublished.turn.service_client_activation,undefined);assert.match(unpublished.turn.assistant_text,/Publish the website version/);
 await publish(owner,owner.site);
 await assert.rejects(m.prepareServiceClientActivation(db,foreign.id,id(),activation(owner,v1,'contact')),e=>e.status===404);
 await assert.rejects(m.prepareServiceClientActivation(db,owner.id,id(),{...activation(owner,v1,'contact'),service:'all'}),e=>e.status===400);
 const refused=await chat(owner,sc(owner,'activate',{versionId:v1,service:'contact'}));assert.equal(refused.turn.service_client_activation,undefined);
 const first=await activationReview(owner,v1,'contact');assert.equal(first.turn.contact_confirmation_id,undefined,'One exact control, not a duplicate legacy button');
 const inventories=await Promise.all([accountClosureInventory(db),accountClosureInventory(db,owner.id),accountClosureInventory(db,foreign.id)]);
 for(const metric of ['serviceClientProposals','serviceClientSnapshots','serviceClientSaveReceipts','serviceActivationReceipts'])assert.deepEqual(inventories.map(r=>r.counts[metric]),[1,1,0]);
 for(const report of inventories){assert.equal(report.readyForDeletion,false);assert.ok(!JSON.stringify(report).includes(owner.id));assert.doesNotMatch(JSON.stringify(report),/Example Garden|Garden estimate|contact-link@1/);}
 for(const suffix of ['preview','diff']){const path=`/api/service-client-activations/${first.input.id}/${suffix}`;assert.equal((await call(null,path)).status,401);assert.equal((await call(foreign,path)).status,404);assert.equal((await call(owner,path+'?confirm=true')).status,400);const response=await call(owner,path);assert.equal(response.status,200);assert.match(response.headers.get('content-security-policy'),/sandbox;.*form-action 'none'/);assert.doesNotMatch(await response.text(),/<script|\saction=|\sformaction=/);}
 assert.equal(await m.activeContact(db,owner.project),null);assert.equal(await m.activeBackendForm(db,owner.project),null);
 // A new private head invalidates old handoffs. No partial service mutation.
 const offSettings=await save(owner,1,empty);const staleInput=await input(owner,{type:'confirm',kind:'contact',reviewId:first.input.id});assert.equal((await call(owner,'/api/chat/actions','POST',staleInput)).status,409);assert.equal(await status(first.input.id),'pending');assert.equal(await m.activeContact(db,owner.project),null);
 await assert.rejects(db.prepare('DELETE FROM service_client_versions WHERE id=?').bind(v1).run(),/service_client_version_retained/);
 const desiredContactOff=await activationReview(owner,offSettings.version,'contact');assert.equal(desiredContactOff.turn.service_client_activation.enabled,false);await confirmActivation(owner,desiredContactOff);
 const desiredFormOff=await activationReview(owner,offSettings.version,'statelessForm');assert.equal(desiredFormOff.turn.service_client_activation.enabled,false);await confirmActivation(owner,desiredFormOff);
 assert.equal(await m.activeContact(db,owner.project),null);assert.equal(await m.activeBackendForm(db,owner.project),null);
 assert.equal((await json(owner,'/api/chat')).turns.find(t=>t.id===first.input.id).service_client_activation,undefined);
 const restore=await chat(owner,sc(owner,'restore',{expectedRevision:2,versionId:v1})),restored=await approve(owner,restore.turn.service_client_review),v3=restored.version;
 const staleVersion=await chat(owner,activation(owner,v1,'contact'));assert.equal(staleVersion.turn.service_client_activation,undefined);assert.match(staleVersion.turn.assistant_text,/Restore those settings/);
 const contactReview=await activationReview(owner,v3,'contact'),tooEarlyForm=await activationReview(owner,v3,'statelessForm');
 await confirmActivation(owner,contactReview);assert.ok(await m.activeContact(db,owner.project));
 assert.equal((await call(owner,`/api/backend-form-reviews/${tooEarlyForm.input.id}/confirm`,'POST',{})).status,409);assert.equal(await status(tooEarlyForm.input.id),'pending');assert.equal(await m.activeBackendForm(db,owner.project),null);
 // Listing and reopening finds an existing review; there is no duplicated preparation.
 const listing=await m.serviceClientActivationAction(db,owner.id,id(),sc(owner,'activations'));const found=JSON.parse(listing.inspection);assert.ok(found.reviews.some(r=>r.id===contactReview.input.id&&r.status==='applied'));assert.ok(Buffer.byteLength(listing.inspection)<8000);
 const history=await chat(owner,{kind:'serviceClients',operation:'activationReview',reviewId:contactReview.input.id});assert.match(history.turn.assistant_text,/historical receipt/);assert.equal(history.turn.service_client_activation,undefined);
 const formReview=await activationReview(owner,v3,'statelessForm'),beforeReviews=await count('service_client_activation_reviews',owner.project);
 const reopened=await chat(owner,{kind:'serviceClients',operation:'activationReview',reviewId:formReview.input.id});assert.equal(reopened.turn.service_client_activation.id,formReview.input.id);assert.equal(await count('service_client_activation_reviews',owner.project),beforeReviews);
 await assert.rejects(m.prepareServiceClientActivation(db,owner.id,formReview.input.id,activation(owner,v3,'contact')),e=>e.status===409);
 // Lost acknowledgement from the underlying approved form update recovers its saved receipt.
 let lose=true;const losing={prepare(sql){const stmt=db.prepare(sql);return {bind(...values){const bound=stmt.bind(...values);if(sql.startsWith("UPDATE backend_form_reviews SET status='applied'"))return {...bound,run:async()=>{const result=await bound.run();if(lose){lose=false;throw Error('Synthetic lost form acknowledgement');}return result;}};return bound;}};}};
 const beforeCalls=calls;assert.equal((await m.confirmBackendForm(losing,owner.id,formReview.input.id)).status,'applied');assert.equal(calls,beforeCalls);await confirmActivation(owner,formReview);assert.ok(await m.activeBackendForm(db,owner.project));
 const candidate=(await db.prepare('SELECT candidate_html FROM service_client_versions WHERE id=?').bind(v3).first()).candidate_html;assert.equal(await(await served(owner)).text(),candidate);
 inference=false;const publicCall=await m.host.fetch(new Request(`https://${owner.project}.whumpo.site/backend/${owner.backendReview}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({hours:3,extra:true})}),env);assert.equal(publicCall.status,200);assert.deepEqual(await publicCall.json(),{ok:true,value:{estimate:100}});inference=true;
 // Republish the same source: old form disappears; the handoff binds the new reviewed endpoint.
 const republished=id();await m.prepareBackendPublication(db,owner.id,owner.project,republished,'publish',owner.backend,owner.run);await m.confirmBackendPublication(db,owner.id,republished);assert.equal(await m.activeBackendForm(db,owner.project),null);
 const fresh=await activationReview(owner,v3,'statelessForm'),freshRow=await db.prepare('SELECT target_json FROM service_client_activation_reviews WHERE id=?').bind(fresh.input.id).first();assert.equal(JSON.parse(freshRow.target_json).backend.reviewId,republished);await confirmActivation(owner,fresh);assert.ok(await m.activeBackendForm(db,owner.project));
 // Two fresh approvals race; the underlying review/settings transaction admits one.
 const qa=await activationReview(owner,v3,'statelessForm'),qb=await activationReview(owner,v3,'statelessForm');
 const race=await Promise.all([qa,qb].map(q=>call(owner,`/api/backend-form-reviews/${q.input.id}/confirm`,'POST',{})));assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);
 // A reference changes after preflight and before the preparation batch: no orphan underlying review.
 const preparing=await preparedActivation(owner,v3,'contact'),replacement=id();await m.prepareBackendPublication(db,owner.id,owner.project,replacement,'publish',owner.backend,owner.run);await m.confirmBackendPublication(db,owner.id,replacement);
 await assert.rejects(db.batch(preparing.statements),/service_client_activation_changed/);assert.equal(await db.prepare('SELECT id FROM contact_reviews WHERE id=?').bind(preparing.turn).first(),null);assert.equal(await db.prepare('SELECT id FROM chat_turns WHERE id=?').bind(preparing.turn).first(),null);
 const heldForm=await activationReview(owner,v3,'statelessForm');await confirmActivation(owner,heldForm);
 const lateContact=await activationReview(owner,v3,'contact'),lateTurn=id(),lateCommand='/confirm-contact '+lateContact.input.id;
 const latePrepared=await m.contactCommand(db,owner.id,lateTurn,lateCommand),lateRevision=(await json(owner,'/api/chat')).state.revision;
 // A hold recorded after activation suppresses linked contact intake/forms, including final insertion.
 const specDigest=(await db.prepare('SELECT spec_digest FROM service_client_versions WHERE id=?').bind(v3).first()).spec_digest;
 await db.prepare("INSERT INTO content_screening_decisions(user_id,kind,digest,policy_version,first_required,required,first_reason,first_percent,first_risk_score) VALUES(?,'generated_artifact',?,'synthetic-hold',1,1,'risk_or_missing_history',100,90)").bind(owner.id,specDigest).run();
 await assert.rejects(db.batch([db.prepare('INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at) VALUES(?,?,?,?,?,?)').bind(lateTurn,owner.id,lateRevision+1,lateCommand,latePrepared.reply,now()),...latePrepared.statements]),/service_client_activation_changed/);assert.equal(await db.prepare('SELECT id FROM chat_turns WHERE id=?').bind(lateTurn).first(),null);
 assert.equal(await m.activeContact(db,owner.project),null);assert.equal(await m.activeBackendForm(db,owner.project),null);assert.doesNotMatch(await(await served(owner)).text(),/townhello-tool-title|https:\/\/whumpo.com\/contact/);
 const heldCalls=calls,heldExecutions=executions;
 for(const url of [`https://${owner.project}.whumpo.site/`,`http://localhost/s/${owner.project}/`])for(const method of ['GET','HEAD']){
  const page=await m.host.fetch(new Request(url,{method}),env);assert.equal(page.status,200);assert.doesNotMatch(await page.text(),/townhello-tool-title|https:\/\/whumpo.com\/contact/);
 }
 for(const path of [`/api/service-client-versions/${v3}/preview`,`/api/service-client-activations/${lateContact.input.id}/preview`,`/api/service-client-activations/${lateContact.input.id}/diff`])assert.equal((await call(owner,path)).status,423);
 // Supply inert Turnstile bindings so this reaches the recorded-hold guard, not missing-provider configuration.
 for(const method of ['GET','HEAD','POST']){
  const response=await m.platform.fetch(new Request(`https://whumpo.com/contact/${owner.project}`,{method,headers:{origin:'https://whumpo.com'}}),{...env,TURNSTILE_SECRET:'synthetic-unused',TURNSTILE_SITE_KEY:'synthetic-unused'},ctx);
  assert.equal(response.status,404);assert.doesNotMatch(await response.text(),/<form|Example Garden/);
 }
 assert.equal(calls,heldCalls);assert.equal(executions,heldExecutions);
 const contactState=await db.prepare('SELECT revision FROM contact_settings WHERE project_id=?').bind(owner.project).first();await assert.rejects(m.saveContact(db,owner.project,contactState.revision,{id:id(),name:'Synthetic visitor',email:'synthetic@example.test',message:'A harmless local fixture'}),e=>e.status===409);
 // Critical legacy disable reviews remain available even when linked configuration is held.
 const contactOff=await chat(owner,{kind:'contactReview',projectId:owner.project,enabled:false});await confirm(owner,'contact',contactOff.input.id);
 const formOff=await chat(owner,{kind:'backend',operation:'reviewDisableForm',projectId:owner.project});assert.ok(formOff.turn.backend_form_confirmation_id);await confirm(owner,'backendForm',formOff.turn.backend_form_confirmation_id);
 await confirmActivation(owner,contactReview);await confirmActivation(owner,fresh);assert.equal(await m.activeContact(db,owner.project),null);assert.equal(await m.activeBackendForm(db,owner.project),null);
 await assert.rejects(db.prepare('DELETE FROM service_client_activation_reviews WHERE id=?').bind(contactReview.input.id).run(),/service_client_receipt_retained/);
 await assert.rejects(db.prepare('UPDATE service_client_activation_reviews SET version_id=? WHERE id=?').bind(offSettings.version,contactReview.input.id).run(),/service_client_immutable/);
 assert.equal(await db.prepare("SELECT name FROM sqlite_schema WHERE name='usage_operations'").first(),null);
 }
 if(process.env.WHUMPO_SERVICE_ACTIVATION_BROWSER==='1'){
  const visitorOwner=await account();visitorOwner.site=await website(visitorOwner);await backend(visitorOwner);const privateSettings=await save(visitorOwner,0);await publish(visitorOwner,visitorOwner.site);
  const contactActivation=await activationReview(visitorOwner,privateSettings.version,'contact'),beforeBrowserCalls=calls,beforeBrowserRuns=executions;
  actions=[activation(visitorOwner,privateSettings.version,'statelessForm')];
  const {serviceClientActivationBrowser}=await import('../tools/service-client-activation-browser.mjs');
  await serviceClientActivationBrowser({platform:m.platform,host:m.host,env,db,account:visitorOwner,contactReview:contactActivation.input.id,ctx,setInference:value=>{inference=value;}});
  assert.equal(calls,beforeBrowserCalls+1);assert.equal(executions,beforeBrowserRuns+1);assert.equal(actions.length,0);
 }
 if(process.env.WHUMPO_SERVICE_ACTIVATION_BROWSER!=='1')console.log('Service activation passed: owned exact saved-settings handoff into existing separate reviews; HTTP preview and human controls; stale heads/targets, atomic preparation rollback, same-source endpoint rebinding, concurrent approval and lost acknowledgement, private visitor execution without inference, post-activation holds, critical disable and replay without reactivation. Disposable local D1/QuickJS, scripted interpretation only.');
}finally{await Promise.allSettled(background);globalThis.fetch=originalFetch;await proxy?.dispose();await runtime?.dispose();await rm(dir,{recursive:true,force:true});}
