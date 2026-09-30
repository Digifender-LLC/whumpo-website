// Reproducible connected handlers + actual isolated QuickJS; no live account or fixed port.
Error.stackTraceLimit=0;
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mkdtemp,rm,readdir,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
import {authenticator} from './app-authenticator.mjs';
import {taskListAppJourney} from './task-list-app-journey.mjs';
const id=()=>crypto.randomUUID(),dir=await mkdtemp('/tmp/whumpo-app-journey-');let proxy,runtime;
try{
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','tellumo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--config','wrangler.runtime.jsonc','--dry-run','--outdir',dir+'/runtime'],{stdio:'pipe',maxBuffer:16*1024*1024});
 const require=createRequire(import.meta.resolve('wrangler')),{Miniflare,convertV4MiniflareOptions}=require('miniflare');
 runtime=new Miniflare(convertV4MiniflareOptions({modulesRoot:dir+'/runtime',modules:[{type:'ESModule',path:dir+'/runtime/worker.js'},...(await readdir(dir+'/runtime')).filter(p=>p.endsWith('.wasm')).map(p=>({type:'CompiledWasm',path:dir+'/runtime/'+p}))],compatibilityDate:'2026-09-29'}));
 proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB;
 const b=await build({stdin:{contents:"export {readAppStatus,describeAppStatus} from './src/app-status';export {backendAction} from './src/backend-chat';export {default as platform} from './src/index';export {default as host} from './src/app-host';export {hashToken} from './src/security';export {applicationChatActions} from './src/app-chat-actions';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
 const {readAppStatus,describeAppStatus,backendAction,platform,host,hashToken,applicationChatActions}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
 let executions=0;
 const env={DB:db,FILES:proxy.env.FILES,ENVIRONMENT:'test',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})},BACKEND_RUNTIME:{fetch:async(request,init)=>{executions++;return runtime.dispatchFetch(request,init);}},ASSETS:{fetch:async()=>new Response(await readFile('public-app/index.html'),{headers:{'content-type':'text/html'}})}},ctx={waitUntil(){throw Error('Unexpected external work');}};
 async function account(){const user=id(),token=(id()+id()).replaceAll('-',''),now=new Date().toISOString();await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(user,user+'@example.test',now).run();await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await hashToken(token),user,new Date(Date.now()+3600000).toISOString(),now).run();return {user,token};}
 const owner=await account(),foreign=await account();
 const call=(a,path,body,method=body===undefined?'GET':'POST',origin='https://whumpo.com')=>platform.fetch(new Request('https://whumpo.com/api'+path,{method,headers:{origin,'content-type':'application/json',cookie:'tellumo_session='+(a?.token??'')},body:body===undefined?undefined:JSON.stringify(body)}),env,ctx);
 async function json(path,body,status=200,method){const r=await call(owner,path,body,method);assert.equal(r.status,status,await r.clone().text());return r.json();}
 async function chat(content){const state=await json('/chat'),request={id:id(),revision:state.state.revision,content};return json('/chat',request);}
 await json('/profile',{revision:0,name:'App owner',avatar_id:'planet'},200,'PATCH');await json('/onboarding');await json('/onboarding',{revision:0,stage:'review',project_name:'Private notebook',idea:'A private note for each invited member',audience:'Our team',preferred_theme:'ocean'},200,'PUT');await json('/onboarding/complete',{revision:1});
 const {id:project}=await db.prepare('SELECT id FROM projects WHERE owner_user_id=?').bind(owner.user).first(),path='/projects/'+project,version=id(),run=id();
 assert.equal((await readAppStatus(db,owner.user,project)).configured,0);await assert.rejects(readAppStatus(db,foreign.user,project),e=>e.status===404);
 await json(path+'/backends',{id:version,source:'export default ({state,input})=>({state:{note:input.note,edits:(state.edits??0)+1},result:"Saved"})'},201);
 const tested=await json(path+'/backends/'+version+'/test',{id:run,input:{state:{},input:{note:'Test note'}}});assert.deepEqual(tested.result,{ok:true,value:{state:{note:'Test note',edits:1},result:'Saved'}});assert.equal(executions,1);
 const initialStatus=(await chat('/app-status '+project)).turns.at(-1);assert.match(initialStatus.assistant_text,/No application configured/);
 const origin='https://app-'+project+'.whumpo.site';
 const visit=(url,init)=>host.fetch(new Request(url,init),env);
 assert.equal((await visit(origin+'/')).status,404);
 const enabled=await chat('/enable-application '+version+' '+run),enable=enabled.turns.at(-1).id;assert.match(enabled.turns.at(-1).assistant_text,/Application.*review/i);
 assert.equal(enabled.turns.at(-1).application_confirmation_id,enable);assert.equal(enabled.turns.at(-1).application_operation,'enable');assert.equal(enabled.turns.at(-1).application_review.state,'ready');assert.equal(enabled.turns.at(-1).application_review.projectName,'Private notebook');assert.equal(enabled.turns.at(-1).application_review.testId,run);
 const reviewRead=await chat('/application-review '+enable);assert.equal(reviewRead.turns.at(-1).application_confirmation_id,enable);
 const original=enabled.turns.at(-1),bare=()=>({id:original.id,user_text:original.user_text,assistant_text:original.assistant_text,status:original.status});
 for(const change of [{assistant_text:'Only you can apply this exact review: /confirm-application '+enable},{assistant_text:original.assistant_text+' invented assurance'},{status:'pending'}]){const turn={...bare(),...change};await applicationChatActions(db,owner.user,[turn]);assert.equal(turn.application_confirmation_id,undefined);assert.equal(turn.application_review,undefined);}
 const foreignTurn=bare();await applicationChatActions(db,foreign.user,[foreignTurn]);assert.equal(foreignTurn.application_confirmation_id,undefined);assert.equal(foreignTurn.application_review,undefined);
 const expiredDB={prepare:sql=>db.prepare(sql.replaceAll("strftime('%Y-%m-%dT%H:%M:%fZ','now')","strftime('%Y-%m-%dT%H:%M:%fZ','now','+11 minutes')"))};const expiredTurn=bare();await applicationChatActions(expiredDB,owner.user,[expiredTurn]);assert.equal(expiredTurn.application_confirmation_id,undefined);assert.equal(expiredTurn.application_review.state,'expired');
 assert.equal((await json(path+'/application')).configuration.enabled,0);
 assert.equal((await call(foreign,'/application-reviews/'+enable+'/confirm',{})).status,404);
 const competing=await chat('/enable-application '+version+' '+run);assert.ok(competing.turns.at(-1).application_confirmation_id);
 const applied=await chat('/confirm-application '+enable);assert.ok(applied.turns.every(t=>!t.application_confirmation_id));assert.equal(applied.turns.at(-1).application_review.state,'applied');assert.equal(applied.turns.at(-1).application_page_design_project_id,project);assert.equal(applied.turns.filter(t=>t.application_page_design_project_id).length,1);assert.equal(applied.turns.find(t=>t.id===enable).application_review.state,'applied');assert.equal(applied.turns.find(t=>t.id===competing.turns.at(-1).id).application_review.state,'changed');assert.equal((await visit(origin+'/')).status,404,'Program approval must not publish a page');
 assert.equal((await readAppStatus(db,owner.user,project)).published,0);assert.equal((await readAppStatus(db,owner.user,project)).enabled,1);
 const page=id(),form={title:'Private notebook',description:'A note only you can read',buttonLabel:'Save note',fields:[{key:'note',label:'Your note',type:'text'}]};
 await json(path+'/application-page',{id:page,form});const pageRead=await chat('/app-page-review '+page);assert.ok(pageRead.turns.every(t=>!t.application_page_design_project_id));assert.equal(pageRead.turns.at(-1).app_page_confirmation_id,page);assert.equal(pageRead.turns.at(-1).app_page_operation,'publish');assert.equal((await visit(origin+'/')).status,404);

 const pageTurn=pageRead.turns.at(-1);assert.deepEqual(pageTurn.app_page_review.form,form);assert.equal(pageTurn.app_page_review.state,'ready');assert.equal(pageTurn.app_page_live_project_id,undefined);assert.equal(pageTurn.app_page_review.projectName,'Private notebook');
 const barePage=()=>({id:pageTurn.id,user_text:pageTurn.user_text,assistant_text:pageTurn.assistant_text,status:pageTurn.status,app_page_review:{form:'forged'}});
 for(const change of [{assistant_text:pageTurn.assistant_text+' assurance'},{status:'pending'}]){const turn={...barePage(),...change};await applicationChatActions(db,owner.user,[turn]);assert.equal(turn.app_page_review,undefined);assert.equal(turn.app_page_confirmation_id,undefined);}
 const foreignPage={...barePage(),app_page_live_project_id:project};await applicationChatActions(db,foreign.user,[foreignPage]);assert.equal(foreignPage.app_page_review,undefined);assert.equal(foreignPage.app_page_live_project_id,undefined);
 const expiredPage=barePage();await applicationChatActions(expiredDB,owner.user,[expiredPage]);assert.equal(expiredPage.app_page_review.state,'expired');assert.equal(expiredPage.app_page_confirmation_id,undefined);
 assert.equal((await call(owner,'/application-page-reviews/'+page+'/confirm',{},'POST','https://foreign.test')).status,403);
 const pageApplied=await chat('/confirm-app-page '+page);assert.equal(pageApplied.turns.at(-1).app_page_review.state,'applied');assert.equal(pageApplied.turns.at(-1).app_page_live_project_id,project);assert.equal(pageApplied.turns.filter(t=>t.app_page_live_project_id).length,1);assert.equal(pageApplied.turns.find(t=>t.id===pageTurn.id).app_page_review.state,'applied');assert.ok((await json('/chat')).turns.every(t=>!t.app_page_confirmation_id));await json('/application-page-reviews/'+page+'/confirm',{});
 const published=await visit(origin+'/');assert.equal(published.status,200);assert.match(published.headers.get('content-security-policy'),/script-src 'self'/);assert.match(await published.text(),/passkey/i);
 function client(){const jar=new Map();return {jar,async request(suffix,body,opts={}){const r=await visit(origin+suffix,{method:body===undefined?'GET':'POST',headers:{origin:opts.origin??origin,'content-type':'application/json',cookie:opts.cookie??[...jar].map(([k,v])=>k+'='+v).join('; ')},body:body===undefined?undefined:JSON.stringify(body)});for(const cookie of r.headers.getSetCookie()){const pair=cookie.split(';')[0],i=pair.indexOf('=');jar.set(pair.slice(0,i),pair.slice(i+1));assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);}return {status:r.status,data:await r.json(),headers:r.headers};}};}
 async function signup(c){const invite=await json(path+'/application-access/invitations',{},201),key=authenticator(origin),options=await c.request('/auth/signup/options',{inviteCode:invite.code});assert.equal(options.status,200);const registered=await c.request('/auth/signup/verify',{credential:key.registration(options.data.options)});assert.equal(registered.status,200,JSON.stringify(registered.data));assert.ok(!('session' in registered.data));return {key,...registered.data};}
 const first=client(),second=client();const registration=await signup(first);await signup(second);
 const op={id:id(),revision:0,pageId:page,input:{note:'Private visitor note'}};
 assert.equal((await first.request('/data',op,{origin:'https://whumpo.com'})).status,403);
 const result=await first.request('/data',op);assert.equal(result.status,200,JSON.stringify(result.data));assert.equal(result.data.state,'complete');assert.equal(executions,2);
 assert.deepEqual((await first.request('/data',op)).data,result.data);assert.equal(executions,2,'Lost-response retry must not execute again');
 assert.deepEqual((await first.request('/data')).data,{revision:1,state:{note:'Private visitor note',edits:1}});assert.deepEqual((await second.request('/data')).data,{revision:0,state:{}});assert.equal((await second.request('/receipts/'+op.id)).status,404);
 // Controlled retained-outcome fixtures exercise counts without exposing private result bodies.
 for(const [state,revision] of [['failed',1],['conflict',1],['running',1],['failed',0]]){
  const receipt=id();await db.prepare(`INSERT INTO app_runs(id,visitor_id,project_id,version_id,session_hash,request_hash,base_revision,program_revision) SELECT ?,v.id,v.project_id,a.version_id,s.token_hash,?,d.revision,a.revision FROM app_visitors v JOIN app_spaces a ON a.project_id=v.project_id JOIN app_documents d ON d.visitor_id=v.id JOIN app_sessions s ON s.visitor_id=v.id WHERE v.project_id=? AND d.revision=? LIMIT 1`).bind(receipt,'a'.repeat(64),project,revision).run();
  if(state!=='running')await db.prepare('UPDATE app_runs SET state=?,result_json=? WHERE id=?').bind(state,JSON.stringify({error:'PRIVATE_OUTCOME_CANARY'}),receipt).run();
 }
 const aggregate=await readAppStatus(db,owner.user,project);assert.equal(aggregate.published,1);assert.equal(aggregate.visitors,2);assert.equal(aggregate.attempts,5);assert.equal(aggregate.complete,1);assert.equal(aggregate.failed,2);assert.equal(aggregate.conflict,1);assert.equal(aggregate.unresolved,1);
 const statusChat=(await chat('/app-status '+project)).turns.at(-1).assistant_text;assert.match(statusChat,/5\/100/);assert.match(statusChat,/1 running or outcome unknown/);assert.ok(!statusChat.includes('Private visitor note'));assert.ok(!statusChat.includes('PRIVATE_OUTCOME_CANARY'));assert.ok(!JSON.stringify(aggregate).includes(op.id));
 const agentStatus=await backendAction(db,owner.user,id(),{kind:'backend',operation:'appStatus',projectId:project});assert.match(agentStatus.reply,/Visitor page is published/);assert.equal(agentStatus.statements.length,0);await assert.rejects(backendAction(db,owner.user,id(),{kind:'backend',operation:'appStatus',projectId:project,input:{}}),e=>e.status===400);
 const recovery=await first.request('/auth/recover',{code:registration.recoveryCode,nonce:'7'.repeat(64)});assert.equal(recovery.status,200);assert.notEqual(recovery.data.recoveryCode,registration.recoveryCode);assert.equal((await first.request('/data')).data.state.edits,1);
 const copy=await first.request('/export');assert.equal(copy.status,200);assert.match(copy.headers.get('content-disposition'),/^attachment/);assert.equal(copy.data.document.value.note,op.input.note);
 const deletion={id:id(),revision:0,confirmation:'DELETE'};assert.equal((await second.request('/account/delete',deletion)).status,200);assert.equal((await second.request('/account/delete',deletion)).status,200);assert.equal((await second.request('/data')).status,401);assert.equal((await first.request('/data')).status,200);
 const afterErasure=await readAppStatus(db,owner.user,project);assert.equal(afterErasure.visitors,1);assert.equal(afterErasure.attempts,5);assert.equal(afterErasure.failed,1);
 const off=id();await json(path+'/application-page',{id:off,form:null});const offRead=await chat('/app-page-review '+off);assert.equal(offRead.turns.at(-1).app_page_operation,'unpublish');assert.equal(offRead.turns.at(-1).app_page_review.form,null);assert.equal(offRead.turns.at(-1).app_page_confirmation_id,off);await chat('/confirm-app-page '+off);assert.equal((await visit(origin+'/')).status,404);assert.equal((await first.request('/data')).status,404);assert.ok((await json('/chat')).turns.every(t=>!t.app_page_live_project_id));
 await json('/application-page-reviews/'+page+'/confirm',{});assert.equal((await visit(origin+'/')).status,404,'Historical approval cannot republish');
 assert.equal((await second.request('/account/delete',deletion)).status,200,'Exact erasure receipt survives withdrawal');
 const replacement=id();await json(path+'/application-page',{id:replacement,form:{...form,title:'New notebook'}});const replacementRead=await chat('/app-page-review '+replacement);const replacementApplied=await chat('/confirm-app-page '+replacement);assert.equal(replacementApplied.turns.at(-1).app_page_live_project_id,project);assert.ok(replacementApplied.turns.filter(t=>t.app_page_review?.id===page).every(t=>!t.app_page_live_project_id));assert.equal(replacementApplied.turns.filter(t=>t.app_page_live_project_id).length,1);

 const laterPage=id();await json(path+'/application-page',{id:laterPage,form});const laterRead=await chat('/app-page-review '+laterPage);assert.equal(laterRead.turns.at(-1).app_page_confirmation_id,laterPage);
 const disabled=await chat('/disable-application '+project),disable=disabled.turns.at(-1).id;assert.equal(disabled.turns.at(-1).application_confirmation_id,disable);assert.equal(disabled.turns.at(-1).application_operation,'disable');await chat('/confirm-application '+disable);assert.ok((await json('/chat')).turns.every(t=>!t.application_confirmation_id&&!t.app_page_confirmation_id&&!t.app_page_live_project_id));
 assert.equal((await json('/chat')).turns.find(t=>t.id===laterRead.turns.at(-1).id).app_page_review.state,'changed');
 const disabledStatus=await readAppStatus(db,owner.user,project);assert.equal(disabledStatus.enabled,0);assert.equal(disabledStatus.published,0);assert.match(describeAppStatus(disabledStatus),/data access is disabled/);
 // Owner erasure is distinct from revocation and remains available while the app is disabled.
 const remaining=await db.prepare('SELECT id FROM app_visitors WHERE project_id=?').bind(project).first(),eraseId=id(),erasePath=path+'/application-access/visitors/'+remaining.id+'/erase',eraseBody={id:eraseId,confirmation:'ERASE'};
 assert.equal((await call(null,erasePath,eraseBody)).status,401);assert.equal((await call(foreign,erasePath,eraseBody)).status,404);assert.equal((await call(owner,erasePath,eraseBody,'POST','https://foreign.test')).status,403);
 await json(erasePath,{...eraseBody,confirmation:'erase'},400);await json(erasePath,{...eraseBody,extra:true},400);await json(erasePath,eraseBody,409);
 await json(path+'/application-access/visitors/'+remaining.id+'/revoke',{});
 const sessionHash=await hashToken(owner.token),fresh=(await db.prepare('SELECT created_at FROM sessions WHERE token_hash=?').bind(sessionHash).first()).created_at;
 await db.prepare('UPDATE sessions SET created_at=? WHERE token_hash=?').bind(new Date(Date.now()-11*60000).toISOString(),sessionHash).run();await json(erasePath,eraseBody,401);await db.prepare('UPDATE sessions SET created_at=? WHERE token_hash=?').bind(fresh,sessionHash).run();
 // Simulate a lost storage acknowledgement; concurrent retries recover one committed deletion.
 env.DB=new Proxy(db,{get(target,key){if(key==='prepare')return sql=>{const stmt=target.prepare(sql);if(!sql.startsWith('INSERT INTO app_owner_erasures'))return stmt;return {bind(...args){const bound=stmt.bind(...args);return {async run(){await bound.run();throw Error('Lost erasure acknowledgement');}};}};};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 try{const results=await Promise.all([json(erasePath,eraseBody),json(erasePath,eraseBody)]);assert.ok(results.every(r=>r.erased&&r.receiptId===eraseId));}finally{env.DB=db;}
 assert.equal((await json(erasePath,eraseBody)).erased,true);await json(path+'/application-access/visitors/'+id()+'/erase',eraseBody,409);
 assert.equal((await db.prepare('SELECT count(*) n FROM app_owner_erasures WHERE id=?').bind(eraseId).first()).n,1);
 for(const table of ['app_visitors','app_documents','app_runs','app_passkeys','app_recovery_codes','app_sessions','app_auth_challenges']){const column=table==='app_visitors'?'id':'visitor_id';assert.equal((await db.prepare('SELECT count(*) n FROM '+table+' WHERE '+column+'=?').bind(remaining.id).first()).n,0);}
 assert.equal((await db.prepare('SELECT count(*) n FROM app_invitations WHERE used_by=?').bind(remaining.id).first()).n,0);assert.equal((await readAppStatus(db,owner.user,project)).attempts,5);assert.equal((await readAppStatus(db,owner.user,project)).visitors,0);
 await assert.rejects(db.prepare('UPDATE app_owner_erasures SET visitor_id=? WHERE id=?').bind(id(),eraseId).run());await assert.rejects(db.prepare('DELETE FROM app_owner_erasures WHERE id=?').bind(eraseId).run());
 console.log('Owner erasure passed: explicit typed confirmation, recent session, revoked-only target, owner/origin bounds, disabled app, concurrent/lost-response retry, full credential/document/history erasure and retained aggregate usage.');
 assert.equal(executions,2);assert.equal((await db.prepare('SELECT COUNT(*) n FROM inference_calls').first()).n,0);
 console.log('Customer app journey passed: welcome, actual QuickJS test, separate program/page reviews, public host, signed passkeys, isolated visitors, exact transition replay, recovery/export/deletion, withdrawal and historical approval safety. No live deployment or AI call.');
 await taskListAppJourney({db,account,call,host,env,executions:()=>executions});
}finally{await runtime?.dispose();await proxy?.dispose();await rm(dir,{recursive:true,force:true});}
