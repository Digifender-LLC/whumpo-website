import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import {unzipSync,strFromU8} from 'fflate';
import wrangler from 'wrangler';
Error.stackTraceLimit=0;
const bundle=await build({stdin:{contents:"export {default as platform} from './src/index';export {default as host} from './src/site-host';export {hashToken} from './src/security';export {sendChatControl,readChat} from './src/chat';export * from './src/project-specification/store';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].contents).toString('base64'));
const dir=await mkdtemp('/tmp/whumpo-specification-');
execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false}),db=proxy.env.DB;
const env={DB:db,FILES:proxy.env.FILES,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})},AI_BASE_URL:'https://opencode.ai/zen/go/v1',AI_MODEL:'muse-spark-1.3-contributor',AI_PROTOCOL:'responses',AI_API_KEY:'synthetic-fixture-only'};
const background=[],ctx={waitUntil:p=>background.push(p)},originalFetch=globalThis.fetch;
let actions=[],calls=0;
globalThis.fetch=async(url,init)=>{
 assert.equal(String(url),'https://opencode.ai/zen/go/v1/responses');const body=JSON.parse(init.body),ack=body.max_output_tokens===256;
 if(!ack){calls++;assert.ok(actions.length,'Unexpected inference call');}
 return Response.json({status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(ack?{intent:'editing'}:{reply:'Synthetic fixture proposal',action:actions.shift()})}]}],usage:{input_tokens:100,output_tokens:100}});
};
const id=()=>crypto.randomUUID(),now=()=>new Date().toISOString();
const call=(a,path,method='GET',data,origin='https://whumpo.com')=>m.platform.fetch(new Request('https://whumpo.com'+path,{method,headers:{origin,'content-type':'application/json',cookie:'whumpo_session='+(a?.token??'')},...(data?{body:JSON.stringify(data)}:{})}),env,ctx);
async function json(a,path,method='GET',data){const r=await call(a,path,method,data);assert.equal(r.status,200,path+' '+await r.clone().text());return r.json();}
async function account(){const a={id:id(),token:(id()+id()).replaceAll('-','')};await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(a.id,a.id+'@example.test',now()).run();await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await m.hashToken(a.token),a.id,new Date(Date.now()+3600000).toISOString(),now()).run();
 await json(a,'/api/profile','PATCH',{revision:0,name:'River',avatar_id:'sun',about_me:'',share_context:false});await json(a,'/api/onboarding');await json(a,'/api/onboarding','PUT',{revision:0,stage:'review',project_name:'Example Garden',idea:'A local landscaping business.',audience:'Neighbors',preferred_theme:'forest'});await json(a,'/api/onboarding/complete','POST',{revision:1});a.project=(await db.prepare('SELECT id FROM projects WHERE owner_user_id=?').bind(a.id).first()).id;return a;}
async function chat(a,action,text='Please prepare this website change.'){actions=Array.isArray(action)?action:[action];const state=await json(a,'/api/chat'),input={id:id(),revision:state.state.revision,content:text},data=await json(a,'/api/chat','POST',input);await Promise.all(background);assert.equal(actions.length,0);return {input,data,turn:data.turns.at(-1)};}
const spec=(a,operation,fields)=>({kind:'specification',operation,projectId:a.project,...fields});
async function input(a,action){return {id:id(),revision:(await json(a,'/api/chat')).state.revision,action};}
const approval=q=>({type:'specificationApply',reviewId:q.id,proposalDigest:q.proposalDigest,expectedRevision:q.expectedRevision});
async function approve(a,q){const request=await input(a,approval(q)),before=calls;const data=await json(a,'/api/chat/actions','POST',request);assert.equal(calls,before);return {request,data,version:request.id};}
async function syntheticProposal(a,request,remainingMs){
 const turn=id(),revision=(await json(a,'/api/chat')).state.revision,clock=Date.now;
 let prepared;try{if(remainingMs)Date.now=()=>clock()-600000+remainingMs;prepared=await m.prepareSpecification(db,a.id,turn,request);}finally{Date.now=clock;}
 await db.batch([
  db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,mode,status,created_at) VALUES(?,?,?,'Synthetic review fixture','','ai','pending',?)").bind(turn,a.id,revision+1,now()),
  ...prepared.statements,
  db.prepare("UPDATE chat_turns SET assistant_text=?,status='completed' WHERE id=?").bind(prepared.reply,turn),
  db.prepare('UPDATE workspace_state SET revision=? WHERE user_id=?').bind(revision+1,a.id)
 ]);
 const q=await m.readSpecificationProposal(db,a.id,turn);return {id:q.id,proposalDigest:q.proposal_digest,expectedRevision:q.expected_revision,expiresAt:q.expires_at};
}
async function preparedConfirmation(a,q){
 const turn=id(),command=`/confirm-specification ${q.id} ${q.proposalDigest} ${q.expectedRevision}`,prepared=await m.applySpecificationCommand(db,a.id,turn,command),revision=(await json(a,'/api/chat')).state.revision;
 return {turn,statements:[db.prepare('INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at) VALUES(?,?,?,?,?,?)').bind(turn,a.id,revision+1,command,prepared.reply,now()),...prepared.statements]};
}
const served=a=>m.host.fetch(new Request('https://'+a.project+'.whumpo.site/'),{DB:db,FILES:proxy.env.FILES});
const count=async(table,project)=>Number((await db.prepare(`SELECT count(*) n FROM ${table} WHERE project_id=?`).bind(project).first()).n);
try{
 const owner=await account(),foreign=await account();
 const config={name:'Example Garden',description:'Landscaping for neighbors.',headline:'A greener neighborhood',theme:'forest',aboutTitle:'Our work',aboutText:'Local garden care.',sections:[{heading:'Hours',text:'Monday through Friday'}]};
 // Separate owner: actual concurrent HTTP controls commit at most one outcome.
 const foreignFirst=await chat(foreign,{kind:'preview',projectId:foreign.project,config});
 const foreignImport=await chat(foreign,spec(foreign,'import',{expectedRevision:0,versionId:foreignFirst.turn.version_id}));
 await approve(foreign,foreignImport.turn.specification_review);
 const qa=await syntheticProposal(foreign,spec(foreign,'change',{expectedRevision:1,operations:[{type:'design.setTheme',theme:'clay'}]}));
 const qb=await syntheticProposal(foreign,spec(foreign,'change',{expectedRevision:1,operations:[{type:'design.setTheme',theme:'ocean'}]}));
 const raceRevision=(await json(foreign,'/api/chat')).state.revision;
 const raceInputs=[qa,qb].map(q=>({id:id(),revision:raceRevision,action:approval(q)}));
 const race=await Promise.all(raceInputs.map(request=>call(foreign,'/api/chat/actions','POST',request)));
 assert.deepEqual(race.map(r=>r.status).sort(),[200,409]);assert.equal((await m.readSpecification(db,foreign.id,foreign.project)).revision,2);assert.equal(await count('project_spec_applies',foreign.project),2);
 // A candidate disappearing after validation cannot commit a success-only turn.
 const deleted=await syntheticProposal(foreign,spec(foreign,'change',{expectedRevision:2,operations:[{type:'content.replace',contentId:'section-1-text',text:'By appointment'}]}));
 const deleting=await preparedConfirmation(foreign,deleted);await db.prepare('DELETE FROM project_spec_proposals WHERE id=?').bind(deleted.id).run();
 await assert.rejects(db.batch(deleting.statements),/specification_changed/);assert.equal(await db.prepare('SELECT id FROM chat_turns WHERE id=?').bind(deleting.turn).first(),null);
 assert.equal(await db.prepare('SELECT id FROM site_versions WHERE id=?').bind(deleting.turn).first(),null);
 // Expiry is enforced inside the transaction, then cleanup releases candidate bytes.
 const expiring=await syntheticProposal(foreign,spec(foreign,'change',{expectedRevision:2,operations:[{type:'content.replace',contentId:'section-1-text',text:'Seasonal appointments'}]}),2500);
 const expiry=await preparedConfirmation(foreign,expiring);await new Promise(resolve=>setTimeout(resolve,Math.max(0,Date.parse(expiring.expiresAt)-Date.now()+100)));
 await assert.rejects(db.batch(expiry.statements),/specification_expired/);assert.equal(await db.prepare('SELECT id FROM chat_turns WHERE id=?').bind(expiry.turn).first(),null);
 await assert.rejects(m.readSpecificationProposal(db,foreign.id,expiring.id),e=>e.status===409);
 const next=await syntheticProposal(foreign,spec(foreign,'change',{expectedRevision:2,operations:[{type:'content.replace',contentId:'section-1-text',text:'New appointments'}]}));
 assert.equal(await db.prepare('SELECT id FROM project_spec_proposals WHERE id=?').bind(expiring.id).first(),null);assert.equal(await count('project_spec_applies',foreign.project),2);
 // A safety hold on the prior content added after validation blocks the new version.
 const lateHold=await preparedConfirmation(foreign,next),foreignHead=await m.readSpecification(db,foreign.id,foreign.project);
 const foreignDigest=(await db.prepare('SELECT spec_digest FROM project_spec_versions WHERE version_id=?').bind(foreignHead.versionId).first()).spec_digest;
 await db.prepare("INSERT INTO content_screening_decisions(user_id,kind,digest,policy_version,first_required,required,first_reason,first_percent,first_risk_score) VALUES(?,'generated_artifact',?,'synthetic-policy',1,1,'risk_or_missing_history',100,60)").bind(foreign.id,foreignDigest).run();
 await assert.rejects(db.batch(lateHold.statements),/specification_held/);assert.equal(await db.prepare('SELECT id FROM chat_turns WHERE id=?').bind(lateHold.turn).first(),null);
 await assert.rejects(m.readSpecification(db,foreign.id,foreign.project),e=>e.status===423);assert.equal((await call(foreign,`/api/specification-reviews/${next.id}/diff`)).status,423);
 const first=await chat(owner,{kind:'preview',projectId:owner.project,config}),original=first.turn.version_id;assert.ok(original);
 const originalHTML=await(await call(owner,`/api/site-versions/${original}/preview`)).text();
 const proposal=await chat(owner,spec(owner,'import',{expectedRevision:0,versionId:original}));let review=proposal.turn.specification_review;assert.ok(review);
 assert.equal((await m.readSpecification(db,owner.id,owner.project)).revision,0);assert.equal(await count('site_versions',owner.project),1);
 for(const suffix of ['preview','diff']){const path=`/api/specification-reviews/${review.id}/${suffix}`;assert.equal((await call(null,path)).status,401);assert.equal((await call(foreign,path)).status,404);const page=await call(owner,path);assert.equal(page.status,200);assert.match(page.headers.get('content-security-policy'),/sandbox;.*form-action 'none'/);assert.match(page.headers.get('cache-control'),/private/);if(suffix==='preview')assert.equal(await page.text(),originalHTML);}
 const bad=await input(owner,approval(review));bad.action.proposalDigest='0'.repeat(64);assert.equal((await call(owner,'/api/chat/actions','POST',bad)).status,409);
 const exact=await input(owner,approval(review));assert.equal((await call(owner,'/api/chat/actions','POST',exact,'https://foreign.test')).status,403);
 await db.prepare('UPDATE sessions SET created_at=? WHERE user_id=?').bind(new Date(Date.now()-3600000).toISOString(),owner.id).run();assert.equal((await call(owner,'/api/chat/actions','POST',exact)).status,401);await db.prepare('UPDATE sessions SET created_at=? WHERE user_id=?').bind(now(),owner.id).run();
 const imported=await approve(owner,review),v1=imported.version;assert.equal((await m.readSpecification(db,owner.id,owner.project)).revision,1);assert.equal((await served(owner)).status,404);
 await json(owner,'/api/chat/actions','POST',imported.request);assert.equal(await count('site_versions',owner.project),2);assert.equal(await count('project_spec_applies',owner.project),1);
 assert.equal((await call(owner,'/api/chat/actions','POST',{...imported.request,action:{...imported.request.action,expectedRevision:1}})).status,409);
 assert.equal((await call(owner,`/api/specification-reviews/${review.id}/preview`)).status,409);
 const direct=await chat(owner,{kind:'edit',baseVersionId:v1,changes:{theme:'clay'}});assert.match(direct.turn.assistant_text,/saved configuration/);assert.equal(await count('site_versions',owner.project),2);
 const denial=await chat(owner,{kind:'specification',operation:'apply',reviewId:review.id});assert.equal(denial.turn.specification_review,undefined);assert.equal(await count('project_spec_applies',owner.project),1);
 const changed=await chat(owner,[spec(owner,'read',{}),spec(owner,'change',{expectedRevision:1,operations:[{type:'content.replace',contentId:'section-1-text',text:'Monday through Saturday'}]})]);review=changed.turn.specification_review;assert.ok(review);
 const rival=await chat(owner,spec(owner,'change',{expectedRevision:1,operations:[{type:'design.setTheme',theme:'clay'}]}));assert.ok(rival.turn.specification_review);
 // Lose the committed database acknowledgement; the same typed request recovers once.
 const lostInput=await input(owner,approval(review));let lose=true;
 const lostDB={prepare:db.prepare.bind(db),batch:async statements=>{const result=await db.batch(statements);if(lose){lose=false;throw Error('Synthetic lost acknowledgement');}return result;}};
 const beforeCalls=calls;assert.equal((await m.sendChatControl(lostDB,owner.id,lostInput)).status,200);assert.equal(calls,beforeCalls);await json(owner,'/api/chat/actions','POST',lostInput);
 const v2=lostInput.id;assert.equal(await count('project_spec_applies',owner.project),2);assert.equal((await m.readSpecification(db,owner.id,owner.project)).revision,2);
 assert.equal((await call(owner,'/api/chat/actions','POST',await input(owner,approval(rival.turn.specification_review)))).status,409);
 const html2=await(await call(owner,`/api/site-versions/${v2}/preview`)).text();assert.match(html2,/Monday through Saturday/);assert.equal(await(await call(owner,`/api/site-versions/${v1}/preview`)).text(),originalHTML);
 const zip=unzipSync(new Uint8Array(await(await call(owner,`/api/site-versions/${v2}/export`)).arrayBuffer()));assert.equal(strFromU8(zip['public/index.html']),html2);
 const publish=await chat(owner,{kind:'review',operation:'publish',targetId:v2});await json(owner,'/api/chat/actions','POST',await input(owner,{type:'confirm',kind:'site',reviewId:publish.input.id}));assert.equal(await(await served(owner)).text(),html2);
 const restore=await chat(owner,spec(owner,'restore',{expectedRevision:2,versionId:v1}));assert.ok(restore.turn.specification_review);const restored=await approve(owner,restore.turn.specification_review),v3=restored.version;
 assert.equal((await m.readSpecification(db,owner.id,owner.project)).revision,3);assert.equal(await(await call(owner,`/api/site-versions/${v3}/preview`)).text(),originalHTML);assert.equal(await(await served(owner)).text(),html2);
 assert.equal(await count('project_spec_versions',owner.project),3);
 // User/project boundaries and immutable protocol records.
 await assert.rejects(m.readSpecification(db,foreign.id,owner.project),e=>e.status===404);
 await assert.rejects(db.prepare('UPDATE project_spec_proposals SET html=? WHERE id=?').bind('altered',restore.input.id).run(),/specification_immutable/);
 await assert.rejects(db.prepare('UPDATE project_spec_versions SET spec_json=? WHERE version_id=?').bind('{}',v1).run(),/specification_immutable/);
 await assert.rejects(db.prepare('DELETE FROM project_spec_applies WHERE id=?').bind(v1).run(),/specification_receipt_retained/);
 await assert.rejects(db.prepare('UPDATE project_spec_heads SET revision=revision+1 WHERE project_id=?').bind(owner.project).run(),/specification_changed/);
 const currentRemoval=await chat(owner,{kind:'versionRemovalReview',versionId:v3});assert.equal(currentRemoval.turn.version_confirmation_id,null);assert.match(currentRemoval.turn.assistant_text,/current saved website configuration/);await assert.rejects(db.prepare('DELETE FROM site_versions WHERE id=?').bind(v3).run(),/version_removal_specification/);
 // A removed legacy origin cannot survive inside its saved candidate/diff; full independent versions remain.
 const removal=await chat(owner,{kind:'versionRemovalReview',versionId:original});await json(owner,'/api/chat/actions','POST',await input(owner,{type:'confirm',kind:'version',reviewId:removal.input.id}));assert.equal((await call(owner,`/api/site-versions/${original}/preview`)).status,404);
 assert.equal(await db.prepare('SELECT id FROM project_spec_proposals WHERE id=?').bind(proposal.input.id).first(),null);assert.equal((await m.readSpecification(db,owner.id,owner.project)).revision,3);
 await json(owner,'/api/chat/actions','POST',imported.request);assert.equal((await m.readSpecification(db,owner.id,owner.project)).revision,3);assert.equal(await count('project_spec_applies',owner.project),3);
 const afterDelete=await chat(owner,spec(owner,'change',{expectedRevision:3,operations:[{type:'design.setTheme',theme:'ocean'}]}));assert.ok(afterDelete.turn.specification_review);
 // Recheck a concurrent new draft inside the transaction, after application validation.
 const r=afterDelete.turn.specification_review,turn=id(),prepared=await m.applySpecificationCommand(db,owner.id,turn,`/confirm-specification ${r.id} ${r.proposalDigest} ${r.expectedRevision}`);
 const later=id();await db.prepare("INSERT INTO site_versions(id,project_id,component_id,config_json,html,digest,created_at) SELECT ?,project_id,component_id,config_json,html,digest,? FROM site_versions WHERE id=?").bind(later,now(),v3).run();
 const rev=(await json(owner,'/api/chat')).state.revision;
 await assert.rejects(db.batch([db.prepare('INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at) VALUES(?,?,?,?,?,?)').bind(turn,owner.id,rev+1,`/confirm-specification ${r.id} ${r.proposalDigest} ${r.expectedRevision}`,prepared.reply,now()),...prepared.statements]),/specification_changed/);
 assert.equal(await db.prepare('SELECT id FROM site_versions WHERE id=?').bind(turn).first(),null);assert.equal(await db.prepare('SELECT id FROM chat_turns WHERE id=?').bind(turn).first(),null);assert.equal((await m.readSpecification(db,owner.id,owner.project)).revision,3);
 // Known safety requirements hold all delivery paths, not just the new proposal preview.
 const saved=await db.prepare('SELECT spec_digest FROM project_spec_versions WHERE version_id=?').bind(v2).first();
 await db.prepare("INSERT INTO content_screening_decisions(user_id,kind,digest,policy_version,first_required,required,first_reason,first_percent,first_risk_score) VALUES(?,'generated_artifact',?,'synthetic-policy',1,1,'risk_or_missing_history',100,60)").bind(owner.id,saved.spec_digest).run();
 for(const suffix of ['preview','export','diff'])assert.equal((await call(owner,`/api/site-versions/${v2}/${suffix}`)).status,423);
 assert.equal((await served(owner)).status,503);await assert.rejects(db.prepare('UPDATE publications SET version_id=? WHERE project_id=?').bind(v2,owner.project).run(),/specification_held/);
 const heldRestore=await chat(owner,spec(owner,'restore',{expectedRevision:3,versionId:v2}));assert.equal(heldRestore.turn.specification_review,undefined);assert.match(heldRestore.turn.assistant_text,/held for safety/);
 // Explicit operator parent cascade must clean up the bounded state and metadata receipts.
 await db.prepare('DELETE FROM projects WHERE id=?').bind(owner.project).run();for(const table of ['project_spec_proposals','project_spec_versions','project_spec_applies','project_spec_heads'])assert.equal(await count(table,owner.project),0);
 console.log('Specification journey passed: actual authenticated HTTP Chat/tools and exact recent-auth controls; private preview/diff, import/change/forward restore, immutable versions, export/publication reuse, foreign/origin/refusal, lost acknowledgement replay, stale/late rollback, deletion cleanup/tombstones, current-head retention, safety holds across delivery and operator cascade. Scripted interpretation only; compiler/approval/preview execute no model calls.');
}finally{await Promise.allSettled(background);globalThis.fetch=originalFetch;await proxy.dispose();await rm(dir,{recursive:true,force:true});}
