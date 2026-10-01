import {recordFixtureBenchmark} from '../tools/benchmark-evidence.mjs';
// Connected handler acceptance: actual platform HTTP boundary and visitor host, disposable D1.
// Exercises configured Responses with scripted replies; never live inference.
Error.stackTraceLimit=0;
import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import {execFileSync} from 'node:child_process';import {build} from 'esbuild';import {unzipSync,strFromU8} from 'fflate';import wrangler from 'wrangler';
const b=await build({stdin:{contents:"export {default as platform} from './src/index';export {default as host} from './src/site-host';export {hashToken} from './src/security';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {platform,host,hashToken}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const dir=await mkdtemp('/tmp/whumpo-customer-journey-');execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false}),db=proxy.env.DB;
const ai=true,background=[],originalFetch=globalThis.fetch;
const env={DB:db,FILES:proxy.env.FILES,ENVIRONMENT:ai?'test':'local',API_LIMITER:{limit:async()=>({success:true})},...(ai?{AI_BASE_URL:'https://opencode.ai/zen/go/v1',AI_MODEL:'muse-spark-1.3-contributor',AI_PROTOCOL:'responses',AI_API_KEY:'synthetic-only-no-real-credential'}:{})},ctx={waitUntil(promise){background.push(promise)}};
let providerCalls=0,ackCalls=0,nextAction;
if(ai)globalThis.fetch=async(url,init)=>{
 assert.equal(String(url),'https://opencode.ai/zen/go/v1/responses','Unexpected network request');
 const request=JSON.parse(init.body);assert.equal(request.model,'muse-spark-1.3-contributor');assert.equal(init.redirect,'manual');
 assert.ok(!init.body.includes('Unshared profile marker'));
 const ack=request.max_output_tokens===256;
 if(ack)ackCalls++;else{assert.ok(request.input.filter(m=>m.role==='system').every(m=>!m.content.includes('UNTRUSTED_BRIEF_CANARY')));assert.ok(request.input.filter(m=>m.role==='user').some(m=>m.content.includes('UNTRUSTED_BRIEF_CANARY')));providerCalls++;assert.ok(nextAction,'Unexpected extra main-model dispatch');}
 const text=JSON.stringify(ack?{intent:'editing'}:{reply:'Synthetic private draft',action:nextAction});
 if(!ack)nextAction=undefined;
 return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text}]}],usage:{input_tokens:ack?10:1000,output_tokens:ack?10:400}});
};
async function account(){const id=crypto.randomUUID(),token=(crypto.randomUUID()+crypto.randomUUID()).replaceAll('-',''),now=new Date().toISOString();await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(id,id+'@example.test',now).run();await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await hashToken(token),id,new Date(Date.now()+3600000).toISOString(),now).run();return {id,token};}
const call=(a,path,method='GET',body,origin='https://whumpo.com')=>platform.fetch(new Request('https://whumpo.com'+path,{method,headers:{origin,cookie:'whumpo_session='+(a?.token??''),'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})}),env,ctx);
async function json(a,path,method='GET',body){const r=await call(a,path,method,body);assert.equal(r.status,200,await r.clone().text());return r.json();}
async function chat(a,content){const state=await json(a,'/api/chat'),input={id:crypto.randomUUID(),revision:state.state.revision,content};return {input,data:await json(a,'/api/chat','POST',input)};}
async function confirm(a,reviewId){const state=await json(a,'/api/chat');return json(a,'/api/chat/actions','POST',{id:crypto.randomUUID(),revision:state.state.revision,action:{type:'confirm',kind:'site',reviewId}});}
const served=p=>host.fetch(new Request('https://'+p+'.whumpo.site/'),{DB:db,FILES:proxy.env.FILES});
try{
 const owner=await account(),foreign=await account();
 assert.equal((await call(owner,'/api/chat')).status,409);assert.equal(providerCalls,0);
 await json(owner,'/api/profile','PATCH',{revision:0,name:'River',avatar_id:'sun',about_me:'Unshared profile marker',share_context:false});await json(owner,'/api/onboarding');
 await json(owner,'/api/onboarding','PUT',{revision:0,stage:'review',project_name:'Copper Oven',idea:'A neighborhood bakery with fresh bread. UNTRUSTED_BRIEF_CANARY',audience:'Neighbors',preferred_theme:'clay'});
 await json(owner,'/api/onboarding/complete','POST',{revision:1});assert.equal((await json(owner,'/api/profile')).onboardingComplete,true);
 const {id:project}=await db.prepare('SELECT id FROM projects WHERE owner_user_id=?').bind(owner.id).first();
 if(ai){assert.equal((await json(owner,'/api/chat')).firstDraft.id,project);nextAction={kind:'preview',projectId:project,config:{name:'Copper Oven',headline:'Bread for our neighbors',description:'Fresh bread daily.',theme:'clay',aboutTitle:'Our bakery',aboutText:'A neighborhood bakery.',sections:[]}};}
 const draft=await chat(owner,'Build my first private website using the saved brief.'),version=draft.data.turns.at(-1).version_id;assert.ok(version);assert.equal((await served(project)).status,404);
 if(ai){await Promise.all(background);assert.equal(providerCalls,1);assert.equal(draft.data.firstDraft,null);const spent=(await json(owner,'/api/billing')).standardAI.creditCharge;assert.equal(spent,0);await json(owner,'/api/chat','POST',draft.input);assert.equal(providerCalls,1);assert.equal((await json(owner,'/api/billing')).standardAI.creditCharge,spent);}

 const preview=await call(owner,'/api/site-versions/'+version+'/preview');assert.equal(preview.status,200);assert.match(preview.headers.get('cache-control'),/private/);assert.match(preview.headers.get('content-security-policy'),/sandbox/);assert.match(await preview.text(),/Copper Oven/);
 const archive=unzipSync(new Uint8Array(await(await call(owner,'/api/site-versions/'+version+'/export')).arrayBuffer()));const original=strFromU8(archive['public/index.html']);assert.match(original,/Copper Oven/);
 for(const suffix of ['preview','export','diff']){const path='/api/site-versions/'+version+'/'+suffix;assert.equal((await call(null,path)).status,401);assert.equal((await call(foreign,path)).status,404);}
 nextAction={kind:'review',operation:'publish',targetId:version};
 const review=await chat(owner,'Prepare a review to publish version '+version),reviewId=review.data.turns.at(-1).confirmation_id;assert.ok(reviewId);
 const reviewPath='/api/publication-reviews/'+reviewId+'/diff';assert.match(await(await call(owner,reviewPath)).text(),/publish review/);assert.equal((await call(foreign,reviewPath)).status,404);assert.equal((await served(project)).status,404);
 const state=await json(owner,'/api/chat'),input={id:crypto.randomUUID(),revision:state.state.revision,action:{type:'confirm',kind:'site',reviewId}};assert.equal((await call(owner,'/api/chat/actions','POST',input,'https://foreign.test')).status,403);assert.equal((await served(project)).status,404);
 // Discard the first HTTP response, then replay exactly as a reconnecting client would.
 assert.equal((await call(owner,'/api/chat/actions','POST',input)).status,200);await json(owner,'/api/chat/actions','POST',input);
 assert.equal((await db.prepare('SELECT revision FROM publications WHERE project_id=?').bind(project).first()).revision,1);assert.equal(await(await served(project)).text(),original);
 if(ai)nextAction={kind:'edit',baseVersionId:version,changes:{theme:'forest'}};
 const next=await chat(owner,'Change the theme to forest'),nextId=next.data.turns.at(-1).version_id;assert.equal(await(await served(project)).text(),original);
 nextAction={kind:'review',operation:'restore',targetId:version};const stale=await chat(owner,'Review restoring version '+version);
 nextAction={kind:'review',operation:'publish',targetId:nextId};const replace=await chat(owner,'Review publishing version '+nextId);await confirm(owner,replace.data.turns.at(-1).confirmation_id);assert.notEqual(await(await served(project)).text(),original);
 assert.equal((await call(owner,'/api/publication-reviews/'+stale.input.id+'/diff')).status,409);
 nextAction={kind:'review',operation:'restore',targetId:version};const restore=await chat(owner,'Review restoring version '+version);assert.match(await(await call(owner,'/api/publication-reviews/'+restore.input.id+'/diff')).text(),/restore review/);await confirm(owner,restore.data.turns.at(-1).confirmation_id);assert.equal(await(await served(project)).text(),original);
 nextAction={kind:'review',operation:'unpublish',targetId:project};const off=await chat(owner,'Review taking project '+project+' offline.');assert.ok(off.data.turns.at(-1).confirmation_id);assert.match(await(await call(owner,'/api/publication-reviews/'+off.input.id+'/diff')).text(),/After unpublishing/);await confirm(owner,off.input.id);assert.equal((await served(project)).status,404);assert.equal((await call(owner,'/api/site-versions/'+version+'/preview')).status,200);
 assert.equal((await db.prepare('SELECT COUNT(*) n FROM projects WHERE owner_user_id=?').bind(owner.id).first()).n,1);await Promise.all(background);
 if(ai){assert.equal(providerCalls,7);const billing=await json(owner,'/api/billing');assert.equal(billing.standardAI.creditCharge,0);assert.equal(billing.standardAI.creditCharge,0);assert.equal(billing.standardAI.creditCharge,0);assert.equal((await db.prepare("SELECT COUNT(*) n FROM inference_calls WHERE role='orchestrator' AND status='observed'").first()).n,7);assert.equal((await db.prepare("SELECT COUNT(*) n FROM inference_calls WHERE status IN ('reserved','dispatched','uncertain')").first()).n,0);}else assert.equal((await db.prepare('SELECT COUNT(*) n FROM inference_calls').first()).n,0);
 await recordFixtureBenchmark(db,'site',{transportCalls:providerCalls+ackCalls,runtimeCalls:0});
 console.log('Connected HTTP journey passed: welcome, private preview/export, owner/origin boundaries, exact review, lost-response replay, private revision, stale review, byte-exact restore, unpublish and retained preview. No real customer publication or paid provider request. Mode: '+(ai?'synthetic Responses; seven main calls, '+ackCalls+' acknowledgments, zero customer units charged':'guided; no inference')+'.');
}finally{await Promise.allSettled(background);globalThis.fetch=originalFetch;await proxy.dispose();await rm(dir,{recursive:true,force:true});}
