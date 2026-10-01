import assert from 'node:assert/strict';
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
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--config','wrangler.runtime.jsonc','--dry-run','--outdir',dir+'/runtime'],{stdio:'pipe',maxBuffer:16*1024*1024});
 const require=createRequire(import.meta.resolve('wrangler')),{Miniflare,convertV4MiniflareOptions}=require('miniflare');
 runtime=new Miniflare(convertV4MiniflareOptions({modulesRoot:dir+'/runtime',modules:[{type:'ESModule',path:dir+'/runtime/worker.js'},...(await readdir(dir+'/runtime')).filter(p=>p.endsWith('.wasm')).map(p=>({type:'CompiledWasm',path:dir+'/runtime/'+p}))],compatibilityDate:'2026-09-29'}));
 proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB;
 const built=await build({stdin:{contents:"export {default as platform} from './src/index';export {default as host} from './src/site-host';export {hashToken} from './src/security';export {sendChatControl} from './src/chat';export * from './src/project-specification/service-clients/store';export {saveBackend,testBackend} from './src/backend-versions';export {prepareBackendPublication,confirmBackendPublication} from './src/backend-publication';export {activeContact} from './src/contacts';export {activeBackendForm} from './src/backend-forms';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
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
 const call=(a,path,method='GET',data,origin='https://whumpo.com')=>m.platform.fetch(new Request('https://whumpo.com'+path,{method,headers:{origin,'content-type':'application/json',cookie:'whumpo_session='+(a?.token??'')},...(data?{body:JSON.stringify(data)}:{})}),env,ctx);
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
 const first=await chat(owner,{kind:'preview',projectId:owner.project,config});owner.site=first.turn.version_id;assert.ok(owner.site);
 const foreignFirst=await chat(foreign,{kind:'preview',projectId:foreign.project,config});foreign.site=foreignFirst.turn.version_id;
 const prepare=(a,expectedRevision,configuration=contact,websiteVersionId=a.site)=>sc(a,'prepare',{expectedRevision,websiteVersionId,configuration});
 // Ownership, strict model schema and exact current target are prerequisites, not prompt promises.
 await assert.rejects(m.prepareServiceClients(db,foreign.id,id(),prepare(owner,0)),e=>e.status===404);
 await assert.rejects(m.prepareServiceClients(db,owner.id,id(),prepare(owner,0,contact,foreign.site)),e=>e.status===404);
 const other=id();await db.prepare('INSERT INTO projects(id,owner_user_id,name,created_at,updated_at) VALUES(?,?,?,?,?)').bind(other,owner.id,'Other',now(),now()).run();
 await assert.rejects(m.prepareServiceClients(db,owner.id,id(),{...prepare(owner,0),projectId:other}),e=>e.status===404);
 const denied=await chat(owner,sc(owner,'apply',{reviewId:id()}));assert.equal(denied.turn.service_client_review,undefined);assert.equal(await count('service_client_versions',owner.project),0);
 const prepared=await chat(owner,prepare(owner,0)),q1=prepared.turn.service_client_review;assert.ok(q1);assert.equal((await m.readServiceClients(db,owner.id,owner.project)).revision,0);
 const beforeCalls=calls;
 for(const suffix of ['preview','diff']){const path=`/api/service-client-reviews/${q1.id}/${suffix}`;assert.equal((await call(null,path)).status,401);assert.equal((await call(foreign,path)).status,404);assert.equal((await call(owner,path+'?activate=1')).status,400);const page=await call(owner,path);assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/sandbox;.*form-action 'none'/);assert.match(page.headers.get('cache-control'),/private/);const html=await page.text();assert.doesNotMatch(html,/<script|<form|href="https:\/\/whumpo.com\/contact/);}
 assert.equal(calls,beforeCalls);
 const bad=await input(owner,{...approval(q1),proposalDigest:'0'.repeat(64)});assert.equal((await call(owner,'/api/chat/actions','POST',bad)).status,409);
 const exact=await input(owner,approval(q1));assert.equal((await call(owner,'/api/chat/actions','POST',exact,'https://foreign.test')).status,403);
 await db.prepare('UPDATE sessions SET created_at=? WHERE user_id=?').bind(new Date(Date.now()-3600000).toISOString(),owner.id).run();assert.equal((await call(owner,'/api/chat/actions','POST',exact)).status,401);await db.prepare('UPDATE sessions SET created_at=? WHERE user_id=?').bind(now(),owner.id).run();
 const saved=await approve(owner,q1),v1=saved.version;assert.equal(saved.data.turns.at(-1).service_client_version_id,v1);assert.equal((await served(owner)).status,404);assert.equal(await m.activeContact(db,owner.project),null);assert.equal(await count('site_versions',owner.project),1);
 await json(owner,'/api/chat/actions','POST',saved.request);assert.equal(await count('service_client_applies',owner.project),1);assert.equal((await call(owner,'/api/chat/actions','POST',{...saved.request,action:{...saved.request.action,expectedRevision:1}})).status,409);
 assert.equal((await call(owner,`/api/service-client-reviews/${q1.id}/preview`)).status,409);
 const savedPage=await call(owner,`/api/service-client-versions/${v1}/preview`);assert.equal(savedPage.status,200);const originalHTML=await savedPage.text();assert.equal((await call(foreign,`/api/service-client-versions/${v1}/preview`)).status,404);
 const change=await chat(owner,[sc(owner,'read'),prepare(owner,1,empty)]);assert.ok(change.turn.service_client_review);
 // Commit succeeds, but the acknowledgement is lost. Same typed request recovers once.
 const lostInput=await input(owner,approval(change.turn.service_client_review));let lose=true;
 const lostDB={prepare:db.prepare.bind(db),batch:async statements=>{const result=await db.batch(statements);if(lose){lose=false;throw Error('Synthetic lost acknowledgement');}return result;}};
 const noCalls=calls;assert.equal((await m.sendChatControl(lostDB,owner.id,lostInput)).status,200);assert.equal(calls,noCalls);await json(owner,'/api/chat/actions','POST',lostInput);assert.equal((await m.readServiceClients(db,owner.id,owner.project)).revision,2);assert.equal(await count('service_client_applies',owner.project),2);
 const restore=await chat(owner,[sc(owner,'history'),sc(owner,'restore',{expectedRevision:2,versionId:v1})]);await approve(owner,restore.turn.service_client_review);assert.equal((await m.readServiceClients(db,owner.id,owner.project)).revision,3);assert.equal(await(await call(owner,`/api/service-client-versions/${v1}/preview`)).text(),originalHTML);
 // HTTP race: exactly one competing approval advances the head.
 const qa=await proposal(foreign,prepare(foreign,0)),qb=await proposal(foreign,prepare(foreign,0,empty)),raceRevision=(await json(foreign,'/api/chat')).state.revision;
 const race=await Promise.all([qa,qb].map(q=>call(foreign,'/api/chat/actions','POST',{id:id(),revision:raceRevision,action:approval(q)})));assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);assert.equal((await m.readServiceClients(db,foreign.id,foreign.project)).revision,1);
 const removed=await proposal(foreign,prepare(foreign,1)),deleting=await preparedConfirmation(foreign,removed);await db.prepare('DELETE FROM service_client_proposals WHERE id=?').bind(removed.id).run();await assert.rejects(db.batch(deleting.statements),/service_client_changed/);assert.equal(await db.prepare('SELECT id FROM chat_turns WHERE id=?').bind(deleting.turn).first(),null);
 const expiring=await proposal(foreign,prepare(foreign,1),2500),expiry=await preparedConfirmation(foreign,expiring);await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(expiring.expiresAt)-Date.now()+100)));await assert.rejects(db.batch(expiry.statements),/service_client_changed/);assert.equal(await db.prepare('SELECT id FROM chat_turns WHERE id=?').bind(expiry.turn).first(),null);
 const late=await proposal(foreign,prepare(foreign,1));assert.equal(await db.prepare('SELECT id FROM service_client_proposals WHERE id=?').bind(expiring.id).first(),null);const lateApply=await preparedConfirmation(foreign,late);
 const held=(await db.prepare('SELECT v.spec_digest FROM service_client_versions v JOIN service_client_heads h ON h.version_id=v.id WHERE h.project_id=?').bind(foreign.project).first()).spec_digest;
 await db.prepare("INSERT INTO content_screening_decisions(user_id,kind,digest,policy_version,first_required,required,first_reason,first_percent,first_risk_score) VALUES(?,'generated_artifact',?,'synthetic-hold',1,1,'risk_or_missing_history',100,90)").bind(foreign.id,held).run();await assert.rejects(db.batch(lateApply.statements),/service_client_changed/);assert.equal(await db.prepare('SELECT id FROM chat_turns WHERE id=?').bind(lateApply.turn).first(),null);assert.equal((await call(foreign,`/api/service-client-reviews/${late.id}/diff`)).status,423);
 // Current live references are checked again after application validation, inside the transaction.
 const sitePublication=await chat(owner,{kind:'review',operation:'publish',targetId:owner.site});await confirm(owner,'site',sitePublication.input.id);await backend(owner);
 const racing=await proposal(owner,prepare(owner,3,both)),racingApply=await preparedConfirmation(owner,racing);
 const on=await chat(owner,{kind:'contactReview',projectId:owner.project,enabled:true});await confirm(owner,'contact',on.input.id);
 // Rebase only the fixture's chat revision so the service guard itself must reject the stale target.
 racingApply.statements[0]=db.prepare('INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at) VALUES(?,?,?,?,?,?)').bind(racingApply.turn,owner.id,(await json(owner,'/api/chat')).state.revision+1,`/confirm-service-clients ${racing.id} ${racing.proposalDigest} ${racing.expectedRevision}`,'Synthetic stale apply',now());
 await assert.rejects(db.batch(racingApply.statements),/service_client_changed/);assert.equal(await db.prepare('SELECT id FROM chat_turns WHERE id=?').bind(racingApply.turn).first(),null);assert.equal((await m.readServiceClients(db,owner.id,owner.project)).revision,3);
 const withForm=await chat(owner,prepare(owner,3,both)),formSaved=await approve(owner,withForm.turn.service_client_review);assert.equal(await m.activeBackendForm(db,owner.project),null);assert.ok(await m.activeContact(db,owner.project));
 const inert=await(await call(owner,`/api/service-client-versions/${formSaved.version}/preview`)).text();assert.match(inert,/<fieldset disabled/);assert.doesNotMatch(inert,/<script|data-endpoint|\saction=|\sformaction=/);
 const formReview=await chat(owner,{kind:'backend',operation:'reviewForm',projectId:owner.project,form});assert.ok(formReview.turn.backend_form_confirmation_id);await confirm(owner,'backendForm',formReview.turn.backend_form_confirmation_id);
 const candidate=(await db.prepare('SELECT candidate_html FROM service_client_versions WHERE id=?').bind(formSaved.version).first()).candidate_html;assert.equal(await(await served(owner)).text(),candidate);
 inference=false;const publicCall=await m.host.fetch(new Request(`https://${owner.project}.whumpo.site/backend/${owner.backendReview}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({hours:3,extra:true})}),env);assert.equal(publicCall.status,200);assert.deepEqual(await publicCall.json(),{ok:true,value:{estimate:100}});inference=true;
 const beforeExecutions=executions,newReview=id();await m.prepareBackendPublication(db,owner.id,owner.project,newReview,'publish',owner.backend,owner.run);await m.confirmBackendPublication(db,owner.id,newReview);assert.equal(await m.activeBackendForm(db,owner.project),null);
 const compatible=await proposal(owner,sc(owner,'restore',{expectedRevision:4,versionId:formSaved.version}));assert.ok(compatible);assert.equal(executions,beforeExecutions);
 await backend(owner,'export default input=>({estimate:input.hours*30+(input.extra?10:0)})');await assert.rejects(m.prepareServiceClients(db,owner.id,id(),sc(owner,'restore',{expectedRevision:4,versionId:formSaved.version})),e=>e.status===409);await assert.rejects(m.readServiceClientProposal(db,owner.id,compatible.id),e=>e.status===409);
 const contactRestore=await proposal(owner,sc(owner,'restore',{expectedRevision:4,versionId:v1}));assert.ok(contactRestore);
 const off=id();await m.prepareBackendPublication(db,owner.id,owner.project,off,'unpublish',owner.backend,null);await m.confirmBackendPublication(db,owner.id,off);await assert.rejects(m.prepareServiceClients(db,owner.id,id(),sc(owner,'restore',{expectedRevision:4,versionId:formSaved.version})),e=>e.status===409);
 // Immutable snapshots, metadata receipts and current references cannot be bypassed by direct mutation.
 await assert.rejects(db.prepare('UPDATE service_client_versions SET spec_json=? WHERE id=?').bind('{}',v1).run(),/service_client_immutable/);await assert.rejects(db.prepare('UPDATE service_client_proposals SET preview_html=? WHERE id=?').bind('changed',withForm.input.id).run(),/service_client_immutable/);await assert.rejects(db.prepare('DELETE FROM service_client_applies WHERE id=?').bind(v1).run(),/service_client_receipt_retained/);await assert.rejects(db.prepare('DELETE FROM service_client_heads WHERE project_id=?').bind(owner.project).run(),/service_client_head_retained/);
 const retained=await chat(owner,{kind:'versionRemovalReview',versionId:owner.site});assert.equal(retained.turn.version_confirmation_id,null);assert.match(retained.turn.assistant_text,/retained by saved service/);await assert.rejects(db.prepare('DELETE FROM site_versions WHERE id=?').bind(owner.site).run(),/version_removal_service_client/);
 // Move to another site, then remove the old site through the actual owner review. Full old copies disappear; receipts remain.
 const nextSite=await chat(owner,{kind:'preview',projectId:owner.project,config:{...config,theme:'clay'}}),nextId=nextSite.turn.version_id;
 // Remove synthetic stale pending reviews to isolate eligible deletion; timed expiry/cleanup is exercised above.
 await db.prepare('DELETE FROM service_client_proposals WHERE project_id=? AND NOT EXISTS(SELECT 1 FROM service_client_applies WHERE proposal_id=service_client_proposals.id)').bind(owner.project).run();
 const nextSettings=await chat(owner,prepare(owner,4,contact,nextId)),nextSaved=await approve(owner,nextSettings.turn.service_client_review);
 const publishNext=await chat(owner,{kind:'review',operation:'publish',targetId:nextId});await confirm(owner,'site',publishNext.input.id);
 const removal=await chat(owner,{kind:'versionRemovalReview',versionId:owner.site});assert.ok(removal.turn.version_confirmation_id);await confirm(owner,'version',removal.turn.version_confirmation_id);
 assert.equal((await call(owner,`/api/service-client-versions/${v1}/preview`)).status,404);assert.equal(await count('service_client_versions',owner.project),1);assert.equal(await count('service_client_proposals',owner.project),0);assert.equal(await count('service_client_applies',owner.project),5);assert.equal((await m.readServiceClients(db,owner.id,owner.project)).versionId,nextSaved.version);
 await json(owner,'/api/chat/actions','POST',saved.request);assert.equal(await count('service_client_versions',owner.project),1);assert.equal(await count('service_client_applies',owner.project),5);
 assert.equal((await db.prepare("SELECT coalesce(sum(quota_charged+credits_charged),0) units FROM usage_operations WHERE user_id=?").bind(owner.id).first()).units,0);
 if(process.env.WHUMPO_SERVICE_BROWSER==='1'){
  const browserAccount=await account(),draft=await chat(browserAccount,{kind:'preview',projectId:browserAccount.project,config});browserAccount.site=draft.turn.version_id;await backend(browserAccount);
  const review=await chat(browserAccount,prepare(browserAccount,0,both));const before={calls,executions};inference=false;
  const {serviceClientBrowser}=await import('../tools/service-client-browser-fixture.mjs');await serviceClientBrowser({platform:m.platform,env,db,account:browserAccount,review:review.turn.service_client_review,ctx});
  assert.deepEqual({calls,executions},before);inference=true;
 }
 // Existing backend review retention still requires separate operator cleanup; do not relax it.
 await assert.rejects(db.prepare('DELETE FROM projects WHERE id=?').bind(owner.project).run(),/FOREIGN KEY/);
 // An otherwise eligible parent cascade removes the new private snapshots and metadata receipts.
 const cascade=await account(),cascadeDraft=await chat(cascade,{kind:'preview',projectId:cascade.project,config});cascade.site=cascadeDraft.turn.version_id;
 const cascadeReview=await chat(cascade,prepare(cascade,0));await approve(cascade,cascadeReview.turn.service_client_review);
 await db.prepare('DELETE FROM projects WHERE id=?').bind(cascade.project).run();for(const table of ['service_client_proposals','service_client_versions','service_client_applies','service_client_heads'])assert.equal(await count(table,cascade.project),0);
 await db.prepare('DELETE FROM users WHERE id=?').bind(foreign.id).run();assert.equal(await count('service_client_applies',foreign.project),0);assert.equal(await db.prepare('SELECT id FROM projects WHERE id=?').bind(foreign.project).first(),null);
 console.log('Service client journey passed: authenticated HTTP Chat/read continuation, disabled previews and exact recent-auth approvals; concurrent/stale/expiry/late-hold rollback, lost acknowledgement replay, immutable forward restore, current backend compatibility/withdrawal, source deletion purge with metadata receipts, zero standard AI units, project/account cleanup, and separately reviewed visitor execution in real QuickJS with maintainer inference disabled. Local scripted interpretation only.');
}finally{await Promise.allSettled(background);globalThis.fetch=originalFetch;await proxy?.dispose();await runtime?.dispose();await rm(dir,{recursive:true,force:true});}
