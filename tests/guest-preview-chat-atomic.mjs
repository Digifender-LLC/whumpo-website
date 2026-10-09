import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers,createFixtureProject} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
import {paidPlan} from './helpers/paid-plan.mjs';
Error.stackTraceLimit=0;
// WH-004 finding B3 regression: the guest-preview revoke/delete Chat controls save their effect in the same
// revision-checked batch as the Chat turn, like every other typed control. A request refused with 409 therefore
// changes nothing; a fresh request applies and saves its turn; an exact replay is answered from the saved turn;
// a foreign owner cannot reach the link. Disposable SQLite (or local D1 with --d1), synthetic owners, no network.
const m=await currentSiteFixtureHandlers(),fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID();
const base='https://whumpo.com',guestOrigin='https://preview.whumpo.site';
const env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})}};
const files={get:async()=>assert.fail('No object access'),head:async()=>assert.fail('No object access')};
const originalFetch=globalThis.fetch;globalThis.fetch=async()=>{throw Error('No network is allowed');};
const row=(q,...p)=>db.prepare(q).bind(...p).first(),run=(q,...p)=>db.prepare(q).bind(...p).run();
const api=(actor,path,method='GET',data)=>m.worker.fetch(new Request(base+'/api'+path,{method,headers:{origin:base,cookie:'__Host-whumpo_session='+actor.token,...(data===undefined?{}:{'content-type':'application/json'})},...(data===undefined?{}:{body:JSON.stringify(data)})}),env,{waitUntil:()=>{}});
const ok=async response=>{assert.equal(response.status,200,await response.clone().text());return response.json();};
const guestComment=token=>m.host.fetch(new Request(guestOrigin+'/api/feedback',{method:'POST',headers:{origin:guestOrigin,'content-type':'application/json'},body:JSON.stringify({token,requestId:id(),name:'Guest',text:'Please keep this comment'})}),{DB:db,FILES:files});
let cases=0;const check=async(label,fn)=>{try{await fn();cases++;}catch(error){console.error(label);throw error;}};
async function owner(){
 const actor=await workspaceFixture(db,m),scope=await actor.scope(),user=actor.account;
 await paidPlan(db,user,'personal');
 const site=await createFixtureProject(scope,user,'Atomic studio '+id().slice(0,6),'Synthetic guest preview atomicity');
 return {...actor,admit:actor.scope,scope,user,...site};
}
async function link(o){
 const body={id:id(),versionId:o.version,expiresInHours:24,feedback:true};
 const prepared=await ok(await api(o,`/projects/${o.project}/guest-previews/prepare`,'POST',body));
 const issued=await ok(await api(o,`/projects/${o.project}/guest-previews`,'POST',{...body,confirmation:prepared.confirmation}));
 const comment=await guestComment(issued.token);assert.equal(comment.status,200,await comment.clone().text());
 return issued.link.id;
}
const state=o=>m.readChat(o.scope,o.user);
const control=async(o,action,requestId=id(),revision,scope=o.scope)=>({requestId,...await m.sendChatControl(scope,o.user,{id:requestId,revision:revision??(await state(o)).state.revision,action})});
const revoke=linkId=>({type:'guestPreview',operation:'revoke',linkId}),remove=linkId=>({type:'guestPreview',operation:'delete',linkId,confirmation:'DELETE'});
const linkRow=linkId=>row('SELECT id,revoked_at FROM guest_preview_links WHERE id=?',linkId);
const comments=linkId=>row('SELECT count(*) AS n FROM guest_preview_feedback WHERE link_id=?',linkId).then(r=>r.n);
const turns=(o,requestId)=>row('SELECT count(*) AS n FROM chat_turns WHERE id=? AND user_id=?',requestId,o.user).then(r=>r.n);
/** Pause just before the control's turn batch; meanwhile another control from the same owner commits. */
async function racing(o,action){
 let raced=false;
 const paused=await o.admit(interceptDatabase(db,/INSERT INTO chat_turns/,async()=>{
  if(raced)return;raced=true;
  const other=await control(o,{type:'shortcut',kind:'versions',projectId:o.project});
  assert.equal(other.status,200,other.error);
 }));
 const revision=(await state(o)).state.revision,result=await control(o,action,id(),revision,paused);
 assert.ok(raced,'the competing control did not run');
 return result;
}
try{
 await check('stale-revision delete is refused with no effect',async()=>{
  const o=await owner(),linkId=await link(o);assert.equal(await comments(linkId),1);
  const result=await racing(o,remove(linkId));
  assert.equal(result.status,409,result.error);
  assert.ok(await linkRow(linkId),'the refused delete removed the link');
  assert.equal(await comments(linkId),1,'the refused delete removed the comments');
  assert.equal(await turns(o,result.requestId),0);
 });
 await check('stale-revision revoke is refused with no effect',async()=>{
  const o=await owner(),linkId=await link(o);
  const result=await racing(o,revoke(linkId));
  assert.equal(result.status,409,result.error);
  assert.equal((await linkRow(linkId)).revoked_at,null,'the refused revoke ended the link');
  assert.equal(await turns(o,result.requestId),0);
  // The retry on the current revision succeeds: the earlier refusal left nothing behind.
  const retry=await control(o,revoke(linkId));assert.equal(retry.status,200,retry.error);
  assert.ok((await linkRow(linkId)).revoked_at);
 });
 await check('fresh delete removes the link and comments and saves the turn',async()=>{
  const o=await owner(),linkId=await link(o),before=(await state(o)).state.revision;
  const result=await control(o,remove(linkId));
  assert.equal(result.status,200,result.error);
  assert.equal(await linkRow(linkId),null);assert.equal(await comments(linkId),0);
  const turn=await row('SELECT revision,assistant_text,action_json FROM chat_turns WHERE id=? AND user_id=?',result.requestId,o.user);
  assert.equal(turn.revision,before+1);assert.match(turn.assistant_text,/were deleted/);assert.match(turn.action_json,/"operation":"delete"/);
  assert.equal((await state(o)).state.revision,before+1);
 });
 await check('fresh revoke ends the link, keeps comments and saves the turn',async()=>{
  const o=await owner(),linkId=await link(o);
  const result=await control(o,revoke(linkId));
  assert.equal(result.status,200,result.error);
  assert.ok((await linkRow(linkId)).revoked_at);assert.equal(await comments(linkId),1);
  assert.equal(await turns(o,result.requestId),1);
 });
 await check('exact replay is answered from the saved turn without a second effect or error',async()=>{
  const o=await owner(),linkId=await link(o),requestId=id(),revision=(await state(o)).state.revision;
  assert.equal((await control(o,remove(linkId),requestId,revision)).status,200);
  const after=(await state(o)).state.revision;
  const replay=await control(o,remove(linkId),requestId,revision);
  assert.equal(replay.status,200,replay.error);
  assert.equal((await state(o)).state.revision,after);assert.equal(await turns(o,requestId),1);
  // The same request ID for a different control is still refused, and still changes nothing.
  const other=await link(o),mismatch=await control(o,revoke(other),requestId,revision);
  assert.equal(mismatch.status,409);assert.equal((await linkRow(other)).revoked_at,null);
 });
 await check('a foreign owner cannot reach the link',async()=>{
  const a=await owner(),b=await owner(),linkId=await link(a),before=(await state(b)).state.revision;
  for(const action of [revoke(linkId),remove(linkId)]){
   const result=await control(b,action);
   assert.equal(result.status,404,result.error);assert.equal(await turns(b,result.requestId),0);
  }
  assert.equal((await linkRow(linkId)).revoked_at,null);assert.equal(await comments(linkId),1);
  assert.equal((await state(b)).state.revision,before);
 });
 await check('a preservation hold refuses delete and saves no turn',async()=>{
  const o=await owner(),linkId=await link(o);
  const caseId=id();
  await run("INSERT INTO safety_cases(id,subject_user_id,intake_ref,opened_by,opened_at,retention_due_at) VALUES(?,?,'intake-1','human:reviewer',unixepoch(),unixepoch()+31536000)",caseId,o.user);
  await run("INSERT INTO safety_preservation_holds(id,case_id,subject_user_id,scope,legal_basis_ref,approved_by,placed_at,review_due_at) VALUES(?,?,?,'account','basis-1','human:approver',unixepoch(),unixepoch()+86400)",id(),caseId,o.user);
  const result=await control(o,remove(linkId));
  assert.equal(result.status,409,result.error);
  assert.ok(await linkRow(linkId));assert.equal(await comments(linkId),1);assert.equal(await turns(o,result.requestId),0);
 });
 console.log(`Guest-preview Chat controls apply atomically with the revision-checked turn: ${cases} groups passed`);
}catch(error){console.error(error.message);process.exitCode=1;}
finally{globalThis.fetch=originalFetch;await fixture.close?.();}
