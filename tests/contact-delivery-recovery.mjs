import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers,createFixtureProject} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
import {maintenanceReport} from '../tools/report-maintenance.mjs';
Error.stackTraceLimit=0;
const m=await currentSiteFixtureHandlers(),fixture=await databaseFixture(),db=fixture.db,N=m.contactNotifications,id=()=>crypto.randomUUID();
const row=(q,...p)=>db.prepare(q).bind(...p).first(),run=(q,...p)=>db.prepare(q).bind(...p).run();
const settings={provider:'fixture-provider',review:'reviewed-fixed-sender',sendCeiling:1000},network=globalThis.fetch;
globalThis.fetch=async()=>{throw Error('No network or provider use in contact recovery fixture');};
let cases=0,phase='setup';
const test=async(name,fn)=>{phase=name;await fn();cases++;};
async function project(){
 const actor=await workspaceFixture(db,m),owner=actor.account,scope=await actor.scope(),{project,version}=await createFixtureProject(scope,owner,'Synthetic notice project','Crash recovery');
 const action=async(control)=>m.sendChatControl(scope,owner,{id:id(),revision:(await m.chatState(scope,owner)).revision,action:control});
 const chat=async content=>{const turn=id();assert.equal((await m.sendChat(scope,owner,{id:turn,content,revision:(await m.chatState(scope,owner)).revision})).status,200);return turn;};
 await action({type:'confirm',kind:'site',reviewId:await chat('/publish '+version)});
 await action({type:'confirm',kind:'contact',reviewId:await chat('/contact-on '+project)});
 const revision=(await m.contacts.activeContact(db,project)).revision;
 await N.proposeContactDestination(db,owner,project,owner+'@example.invalid');await N.requestContactVerification(db,settings,owner,project);
 await N.runContactDelivery(db,settings,async()=>({accepted:true,providerRef:'synthetic-verification'}));
 const destination=await row('SELECT * FROM contact_notification_destinations WHERE project_id=?',project);await N.confirmContactDestination(db,owner,project,destination.verification_code);
 return {actor,owner,project,scope,revision,destination,submit:async()=>{const submission={id:id(),name:'PRIVATE-VISITOR-NAME',email:'private-visitor@example.invalid',message:'PRIVATE-VISITOR-CONTENT'};await m.contacts.saveContact(db,project,revision,submission);return submission;}};
}
const closureCall=async(p,action,data={})=>{
 const response=await m.worker.fetch(new Request('https://whumpo.com/api/account/v1/closure/'+action,{method:'POST',headers:{origin:'https://whumpo.com',cookie:'__Host-whumpo_session='+p.actor.token,'content-type':'application/json'},body:JSON.stringify({version:1,...data})}),{DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})},FILES:{list:async()=>({objects:[],truncated:false})}},{waitUntil:()=>{}});
 assert.equal(response.status,200,await response.clone().text());return response.json();
};
const close=async(p,review)=>(await closureCall(p,'confirm',{reviewId:review.id,reviewDigest:review.digest,confirmation:'close-account'}));
const notice=project=>row("SELECT * FROM contact_notification_outbox WHERE project_id=? AND kind='new_message' ORDER BY created_at DESC,id DESC LIMIT 1",project);
const claim=/UPDATE contact_notification_outbox SET state='dispatching'/,accepted=/UPDATE contact_notification_outbox SET state='accepted'/;
try{
 await test('provider accepted but result persistence is lost: no resend after restart',async()=>{
  const p=await project(),submission=await p.submit(),now=new Date();let calls=0;
  const broken=interceptDatabase(db,accepted,()=>{throw Error('Synthetic result write interruption');});
  await assert.rejects(N.runContactDelivery(broken,settings,async()=>{calls++;return {accepted:true,providerRef:'private-provider-receipt'};},{now}),/Synthetic/);
  const original=await notice(p.project);assert.equal(original.state,'dispatching');assert.equal(original.attempts,1);assert.match(original.dispatch_id,/^[a-f0-9-]{36}$/);
  const first=await N.runContactDelivery(db,settings,async()=>{calls++;assert.fail('Unknown effect must not be sent again');},{now:new Date(+now+6*60000)});assert.equal(first.uncertain,1);
  await N.runContactDelivery(db,settings,async()=>{calls++;assert.fail('No daily resend');},{now:new Date(+now+86400000)});
  const retained=await notice(p.project);assert.equal(retained.state,'uncertain');assert.equal(retained.dispatch_id,original.dispatch_id);assert.equal(retained.attempts,1);assert.equal(calls,1);
  assert.ok((await m.contacts.contactInbox(p.scope,p.owner,p.project)).messages.some(r=>r.id===submission.id));
  await assert.rejects(run("UPDATE contact_notification_outbox SET state='queued' WHERE id=?",original.id),/contact_outbox_final/);
  for(const [table,key,value] of [['contact_notification_outbox','id',original.id],['contact_notification_destinations','id',p.destination.id],['projects','id',p.project],['users','id',p.owner]])await assert.rejects(run(`DELETE FROM ${table} WHERE ${key}=?`,value),/contact_delivery_unresolved/);
  await assert.rejects(N.removeContactDestination(db,p.owner,p.project),e=>e.status===409);
  await assert.rejects(N.proposeContactDestination(db,p.owner,p.project,'replacement@example.invalid'),e=>e.status===409);
  assert.equal((await N.contactNotificationStatus(db,p.owner,p.project)).unconfirmed,1);
  const report=await maintenanceReport(db,+now+3600000);assert.ok(report.backlogs.some(b=>b.queue==='contact_notification_unknown'&&b.count>=1));assert.ok(!JSON.stringify(report).includes('PRIVATE-VISITOR'));
  const review=(await closureCall(p,'prepare',{requestId:id()})).review,closing=await close(p,review);assert.equal(closing.closure.state,'waiting');assert.equal(closing.closure.steps.find(s=>s.step==='operations').detail.unresolvedOperations,1);assert.ok(await row('SELECT id FROM users WHERE id=?',p.owner));
 });
 await test('lost dispatch commit response is unresolved even before provider call',async()=>{
  const p=await project();await p.submit();const now=new Date();let calls=0;
  const broken=interceptDatabase(db,claim,async()=>{},()=>{throw Error('Synthetic lost dispatch acknowledgement');});
  await assert.rejects(N.runContactDelivery(broken,settings,async()=>{calls++;return {accepted:true};},{now}),/Synthetic/);
  assert.equal(calls,0);const intent=await notice(p.project);assert.equal(intent.state,'dispatching');
  const result=await N.runContactDelivery(db,null,async()=>assert.fail('No provider configured'),{now:new Date(Date.parse(intent.dispatched_at)+60001)});assert.equal(result.enabled,false);assert.equal(result.uncertain,1);
  await N.runContactDelivery(db,settings,async()=>{calls++;return {accepted:true};},{now:new Date(+now+600000)});assert.equal(calls,0);
 });
 await test('failure before dispatch commit permits a fresh safe attempt; lost accepted commit does not repeat',async()=>{
  const p=await project();await p.submit();let calls=0;const now=new Date();
  const before=interceptDatabase(db,claim,()=>{throw Error('Synthetic pre-commit failure');});
  await assert.rejects(N.runContactDelivery(before,settings,async()=>{calls++;return {accepted:true};},{now}),/Synthetic/);assert.equal((await notice(p.project)).state,'queued');assert.equal(calls,0);
  const after=interceptDatabase(db,accepted,async()=>{},()=>{throw Error('Synthetic accepted response lost');});
  await assert.rejects(N.runContactDelivery(after,settings,async()=>{calls++;return {accepted:true,providerRef:'accepted-once'};},{now}),/Synthetic/);assert.equal((await notice(p.project)).state,'accepted');
  await N.runContactDelivery(db,settings,async()=>{calls++;return {accepted:true};},{now:new Date(+now+600000)});assert.equal(calls,1);
 });
 await test('overlapping claims count and send exactly once; a proved refusal can retry',async()=>{
  const p=await project();await p.submit();const now=new Date(),spent=await N.contactSendsInWindow(db,now);let reads=0,calls=0,release;const ready=new Promise(resolve=>{release=resolve;});
  const competing=interceptDatabase(db,/SELECT o.id,o.user_id,o.project_id/,async()=>{if(++reads===2)release();await ready;});
  await Promise.all([1,2].map(()=>N.runContactDelivery(competing,settings,async()=>{calls++;return {accepted:false,retryable:true};},{now})));
  assert.equal(calls,1);assert.equal(await N.contactSendsInWindow(db,now),spent+1);const refused=await notice(p.project);assert.equal(refused.state,'queued');assert.equal(refused.last_error,'unavailable');
  await N.runContactDelivery(db,settings,async()=>{calls++;return {accepted:true};},{now:new Date(+now+6*60000)});
  const sent=await notice(p.project);assert.equal(sent.state,'accepted');assert.notEqual(sent.dispatch_id,refused.dispatch_id);assert.equal(sent.attempts,2);assert.equal(calls,2);
 });
 await test('each provider attempt uses its own dispatch clock during a delayed drain',async()=>{
  const p=await project();await p.submit();await p.submit();const originalNow=Date.now,start=originalNow();let current=start,calls=0;
  try{Date.now=()=>current;await N.runContactDelivery(db,settings,async()=>{calls++;current+=120000;return {accepted:true};},{now:new Date(start)});}
  finally{Date.now=originalNow;}
  assert.equal(calls,2);const attempts=(await db.prepare("SELECT dispatched_at FROM contact_notification_outbox WHERE project_id=? AND kind='new_message' ORDER BY dispatched_at").bind(p.project).all()).results;
  assert.equal(Date.parse(attempts[1].dispatched_at)-Date.parse(attempts[0].dispatched_at),120000);
 });
 await test('recipient revocation and message removal at claim cannot dispatch stale authority',async()=>{
  for(const operation of ['suppress','delete']){
   const p=await project(),submission=await p.submit();let calls=0,changed=false;
   const racing=interceptDatabase(db,claim,async()=>{if(changed)return;changed=true;if(operation==='suppress')await run("INSERT INTO contact_notification_suppressions(user_id,address,reason,created_at) VALUES(?,?,'unsubscribe',?)",p.owner,p.destination.address,new Date().toISOString());else await m.contacts.deleteContact(p.scope,p.owner,submission.id);});
   await N.runContactDelivery(racing,settings,async()=>{calls++;return {accepted:true};});assert.equal(calls,0);assert.equal((await notice(p.project)).state,'cancelled');assert.equal((await notice(p.project)).dispatch_id,null);
  }
 });
 await test('closure freezing after the read refuses a new dispatch inside the claim',async()=>{
  const p=await project();await p.submit();await N.runContactDelivery(db,settings,async()=>{throw Error('Synthetic existing unknown effect');});
  await p.submit();const review=(await closureCall(p,'prepare',{requestId:id()})).review;let frozen=false,calls=0;
  const race=interceptDatabase(db,claim,async()=>{if(frozen)return;frozen=true;const closing=await close(p,review);assert.equal(closing.closure.state,'waiting');});
  await N.runContactDelivery(race,settings,async()=>{calls++;return {accepted:true};});assert.ok(frozen);assert.equal(calls,0);
  assert.equal((await row("SELECT count(*) n FROM contact_notification_outbox WHERE project_id=? AND state='cancelled'",p.project)).n,1);
  assert.equal((await row("SELECT count(*) n FROM contact_notification_outbox WHERE project_id=? AND state='uncertain'",p.project)).n,1);
 });
 await test('a visible post-claim freeze or revocation stops a provider call that has not started',async()=>{
  for(const operation of ['closure','suppression']){
   const p=await project();await p.submit();let calls=0,changed=false;
   const race=interceptDatabase(db,claim,async()=>{},async()=>{
    if(changed)return;changed=true;
    if(operation==='closure'){const review=(await closureCall(p,'prepare',{requestId:id()})).review;const closing=await close(p,review);assert.equal(closing.closure.state,'waiting');}
    else await run("INSERT INTO contact_notification_suppressions(user_id,address,reason,created_at) VALUES(?,?,'unsubscribe',?)",p.owner,p.destination.address,new Date().toISOString());
   });
   const result=await N.runContactDelivery(race,settings,async()=>{calls++;return {accepted:true};});assert.ok(changed);assert.equal(calls,0);assert.equal(result.cancelled,1);
   const refused=await notice(p.project);assert.equal(refused.state,'cancelled');assert.equal(refused.last_error,'not_sent');assert.equal(refused.attempts,1);assert.ok(refused.dispatch_id);
   await N.runContactDelivery(db,settings,async()=>{calls++;return {accepted:true};},{now:new Date(Date.now()+600000)});assert.equal(calls,0);
   if(operation==='closure'){const done=await closureCall(p,'resume');assert.equal(done.closure.state,'complete');assert.equal(await row('SELECT id FROM users WHERE id=?',p.owner),null);}
  }
 });
 await test('closure after the provider call starts preserves a truly uncertain effect',async()=>{
  const p=await project();await p.submit();let calls=0;
  const result=await N.runContactDelivery(db,settings,async()=>{
   calls++;const review=(await closureCall(p,'prepare',{requestId:id()})).review;const closing=await close(p,review);assert.equal(closing.closure.state,'waiting');throw Error('Synthetic response lost after send began');
  });assert.equal(result.uncertain,1);assert.equal(calls,1);assert.equal((await notice(p.project)).state,'uncertain');
  await N.runContactDelivery(db,settings,async()=>assert.fail('No repeat after closure'),{now:new Date(Date.now()+600000)});
  const waiting=await closureCall(p,'resume');assert.equal(waiting.closure.state,'waiting');assert.equal(waiting.closure.steps.find(s=>s.step==='operations').detail.unresolvedOperations,1);assert.ok(await row('SELECT id FROM users WHERE id=?',p.owner));
 });
 await test('a queued notice cannot silently adopt a different provider or review',async()=>{
  const p=await project();await p.submit();const before=interceptDatabase(db,claim,()=>{throw Error('Synthetic stop before send');});
  await assert.rejects(N.runContactDelivery(before,settings,async()=>assert.fail('No send')),/Synthetic/);
  const r=await N.runContactDelivery(db,{...settings,review:'different-review'},async()=>assert.fail('No changed-review send'));assert.equal(r.cancelled,1);assert.equal((await notice(p.project)).state,'cancelled');
 });
 await test('uncertain verification survives ordinary expiry and never verifies an address',async()=>{
  const actor=await workspaceFixture(db,m),scope=await actor.scope(),{project:p}=await createFixtureProject(scope,actor.account,'Expiry fixture','Synthetic'),old=new Date(Date.now()-40*86400000);
  await N.proposeContactDestination(db,actor.account,p,'unknown-verification@example.invalid',old);await N.requestContactVerification(db,settings,actor.account,p,old);
  const r=await N.runContactDelivery(db,settings,async()=>{throw Error('Synthetic ambiguous transport');},{now:old});assert.equal(r.uncertain,1);
  const retained=await row("SELECT * FROM contact_notification_outbox WHERE project_id=?",p);assert.equal(retained.state,'uncertain');
  await m.contacts.cleanupContacts(db);assert.ok(await row('SELECT id FROM contact_notification_outbox WHERE id=?',retained.id));assert.equal((await N.contactNotificationStatus(db,actor.account,p)).unconfirmed,1);
  const code=(await row('SELECT verification_code FROM contact_notification_destinations WHERE project_id=?',p)).verification_code;await assert.rejects(N.confirmContactDestination(db,actor.account,p,code,old),e=>e.status===400);
 });
 assert.deepEqual((await db.prepare('PRAGMA foreign_key_check').all()).results,[]);
 console.log(`Contact dispatch recovery passed: ${cases} groups on ${process.argv.includes('--d1')?'local D1':'SQLite'}; real durable claim/result transactions, lost commit responses, provider acceptance without saved result, overlap/spending, proved-unsent retry, current recipient/message checks, exact provider review, retained unknown effects and private inbox survival. No network/provider/model calls.`);
}catch(error){console.error(phase,String(error.stack??error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<bundle>'));process.exitCode=1;}
finally{globalThis.fetch=network;await fixture.close();}
