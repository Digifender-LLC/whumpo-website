import {currentSiteFixtureHandlers,createFixtureWebsite,changeFixtureWebsite} from './current-site-fixture.mjs';
import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
Error.stackTraceLimit=0;
// WH-036: provider-neutral contact notification outbox. Synthetic provider only; no network and no real provider exists.
const m=await currentSiteFixtureHandlers(),store=await databaseFixture({d1:true}),db=store.db,scopes=new Map(),scope=user=>scopes.get(user);
const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('No network call is permitted');};
const {sendChat,readChat}=m,{activeContact,saveContact,contactInbox,deleteContact,cleanupContacts}=m.contacts,N=m.contactNotifications;
const now=()=>new Date().toISOString(),run=(q,...p)=>db.prepare(q).bind(...p).run(),row=(q,...p)=>db.prepare(q).bind(...p).first(),rows=async(q,...p)=>(await db.prepare(q).bind(...p).all()).results;
async function account(){const id=crypto.randomUUID(),project=crypto.randomUUID(),authority=await workspaceFixture(db,m,id);scopes.set(id,await authority.scope());await run("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Garden fixture','Testing','draft',?,?)",project,id,now(),now());await readChat(scope(id),id);return {id,project};}
async function chat(a,content){const state=await readChat(scope(a.id),a.id),input={id:crypto.randomUUID(),revision:state.state.revision,content};return {id:input.id,result:await sendChat(scope(a.id),a.id,input)};}
async function publish(a){const head=await row('SELECT revision FROM project_spec_heads WHERE project_id=?',a.project);const v=head?await changeFixtureWebsite(scope(a.id),a.id,a.project,[{type:'content.replace',contentId:'headline',text:'Garden revision '+(head.revision+1)}]):await createFixtureWebsite(scope(a.id),a.id,a.project,{name:'Garden',headline:'Garden',description:'Testing',theme:'ocean',aboutTitle:'About',aboutText:'Testing',sections:[],photos:[]});const r=await chat(a,'/publish '+v);assert.equal((await chat(a,'/confirm '+r.id)).result.status,200);}
async function enable(a){await publish(a);const r=await chat(a,'/contact-on '+a.project);assert.equal((await chat(a,'/confirm-contact '+r.id)).result.status,200);return (await activeContact(db,a.project)).revision;}
const CANARY='PRIVATE-VISITOR-CANARY';
const msg=()=>({id:crypto.randomUUID(),name:CANARY+' name',email:'visitor-canary@example.com',message:CANARY+' message body'});
const settings={provider:'fixture-provider',review:'review-1'};
let cases=0;async function test(name,fn){try{await fn();cases++;}catch(e){console.error(name,e);throw e;}}
/** Fake provider: deduplicates on the idempotency key like a real transactional service must. */
function provider(){const state={mode:'up',calls:[],sent:new Map(),hang:false};
 state.send=async notice=>{state.calls.push(notice);
  if(state.mode==='down')return {accepted:false,retryable:true};if(state.mode==='reject')return {accepted:false,retryable:false};if(state.mode==='throw')throw Error('PRIVATE-PROVIDER-ERROR');
  if(!state.sent.has(notice.idempotencyKey))state.sent.set(notice.idempotencyKey,notice);
  if(state.hang){state.hang=false;return new Promise(()=>{});} // provider took the message, the response never returns
  return {accepted:true,providerRef:'ref-'+state.sent.size};};
 return state;}
async function verified(a,address,fake=provider(),t=Date.now()){
 const revision=await enable(a);await N.proposeContactDestination(db,a.id,a.project,address);
 assert.equal((await N.requestContactVerification(db,settings,a.id,a.project)).status,'queued');
 await N.runContactDelivery(db,settings,fake.send,{now:new Date(Math.max(t,Date.now()+1)),limit:25});
 const code=(await row('SELECT verification_code c FROM contact_notification_destinations WHERE project_id=?',a.project)).c;
 await N.confirmContactDestination(db,a.id,a.project,code);return {revision,fake};
}
try{
 await test('nothing is queued or sent without a selected, implemented and reviewed provider',async()=>{
  assert.deepEqual(N.implementedContactNotificationProviders,[],'No provider is implemented in this repository');
  const cfg=(env,list)=>N.contactNotificationConfig(env,list).settings;
  assert.equal(cfg({}),null);assert.equal(cfg({CONTACT_NOTIFICATION_PROVIDER:'fixture-provider'},['fixture-provider']),null,'selected but not reviewed');assert.equal(cfg({CONTACT_NOTIFICATION_REVIEW:'r'},['fixture-provider']),null,'reviewed but not selected');
  assert.equal(cfg({CONTACT_NOTIFICATION_PROVIDER:'fixture-provider',CONTACT_NOTIFICATION_REVIEW:'r'}),null,'not implemented');assert.equal(N.contactNotificationConfig({CONTACT_NOTIFICATION_PROVIDER:'cloudflare-email-routing',CONTACT_NOTIFICATION_REVIEW:'r'}).settings,null,'Inbound Email Routing is never a provider');
  assert.deepEqual(cfg({CONTACT_NOTIFICATION_PROVIDER:'fixture-provider',CONTACT_NOTIFICATION_REVIEW:'r'},['fixture-provider']),{provider:'fixture-provider',review:'r'});
  const a=await account(),fake=provider(),revision=await enable(a);await saveContact(db,a.project,revision,msg());
  const destination=await N.proposeContactDestination(db,a.id,a.project,'  Owner@Example.COM ');assert.deepEqual({address:destination.address,state:destination.state},{address:'owner@example.com',state:'unverified'});
  assert.deepEqual(await N.requestContactVerification(db,null,a.id,a.project),{status:'provider_not_configured'});
  assert.deepEqual(await N.runContactDelivery(db,null,fake.send),{enabled:false,queued:0,accepted:0,retried:0,failed:0,cancelled:0});
  assert.equal((await N.runContactDelivery(db,null,fake.send)).enabled,false);assert.equal(fake.calls.length,0);assert.equal((await row('SELECT count(*) n FROM contact_notification_outbox')).n,0);
  await assert.rejects(N.confirmContactDestination(db,a.id,a.project,'ABCDEFGH'),e=>e.status===400);
  assert.equal((await N.contactNotificationStatus(db,a.id,a.project)).destination.state,'unverified','Without a provider the destination stays unverified');
  assert.equal((await contactInbox(scope(a.id),a.id,a.project)).messages.length,1,'The inbox is unchanged');
  for(const bad of ['a@b','a b@example.com','x@example.com, y@example.com','<x@example.com>','Name <x@example.com>','x@example.com\r\nBcc: y@example.com',5,null])await assert.rejects(N.proposeContactDestination(db,a.id,a.project,bad),e=>e.status===400);
 });
 await test('verification goes through the provider; wrong or early codes fail; destinations are tenant-private',async()=>{
  const a=await account(),b=await account(),fake=provider();await enable(a);await N.proposeContactDestination(db,a.id,a.project,'owner-a@example.com');
  await assert.rejects(N.proposeContactDestination(db,b.id,a.project,'x@example.com'),e=>e.status===404);await assert.rejects(N.requestContactVerification(db,settings,b.id,a.project),e=>e.status===404);await assert.rejects(N.contactNotificationStatus(db,b.id,a.project),e=>e.status===404);await assert.rejects(N.removeContactDestination(db,b.id,a.project),e=>e.status===404);
  await assert.rejects(()=>run("INSERT INTO contact_notification_destinations(id,user_id,project_id,address,created_at) VALUES(?,?,?,'x@example.com',?)",crypto.randomUUID(),b.id,a.project,now()),/destination_initial/);
  await N.requestContactVerification(db,settings,a.id,a.project);const code=(await row('SELECT verification_code c FROM contact_notification_destinations WHERE project_id=?',a.project)).c;
  await assert.rejects(N.confirmContactDestination(db,a.id,a.project,code),e=>e.status===400,'The code cannot be used before the provider accepted its notice');
  let r=await N.runContactDelivery(db,settings,fake.send);assert.equal(r.accepted,1);
  const sent=fake.calls[0];assert.equal(sent.kind,'verification');assert.equal(sent.verificationCode,code);assert.equal(sent.recipient,'owner-a@example.com');assert.deepEqual(Object.keys(sent).sort(),['idempotencyKey','kind','outboxId','projectId','recipient','verificationCode']);
  await assert.rejects(N.confirmContactDestination(db,b.id,a.project,code),e=>e.status===404);
  const wrong=code[0]==='A'?'B'+code.slice(1):'A'+code.slice(1);for(let i=0;i<5;i++)await assert.rejects(N.confirmContactDestination(db,a.id,a.project,wrong),e=>e.status===400);
  await assert.rejects(N.confirmContactDestination(db,a.id,a.project,code),e=>e.status===400,'Five wrong guesses lock the code');
  assert.equal((await N.contactNotificationStatus(db,a.id,a.project)).destination.state,'unverified');
  await N.requestContactVerification(db,settings,a.id,a.project);const code2=(await row('SELECT verification_code c FROM contact_notification_destinations WHERE project_id=?',a.project)).c;assert.notEqual(code2,code);
  await N.runContactDelivery(db,settings,fake.send);assert.equal((await row("SELECT state FROM contact_notification_outbox WHERE idempotency_key LIKE ?",'%:'+code)).state,'accepted');
  await assert.rejects(N.confirmContactDestination(db,a.id,a.project,code),e=>e.status===400,'A superseded code is dead');
  const confirmed=await N.confirmContactDestination(db,a.id,a.project,code2.toLowerCase());assert.equal(confirmed.state,'verified');assert.equal((await row('SELECT verification_code c FROM contact_notification_destinations WHERE project_id=?',a.project)).c,null);
  await assert.rejects(N.confirmContactDestination(db,a.id,a.project,code2),e=>e.status===409);await assert.rejects(()=>run("UPDATE contact_notification_destinations SET state='unverified',verified_at=NULL WHERE project_id=?",a.project),/destination_final/);
  // Verification notices are rate limited so an unverified address cannot be used to spam a third party.
  const c=await account();await enable(c);await N.proposeContactDestination(db,c.id,c.project,'third@example.com');for(let i=0;i<3;i++)await N.requestContactVerification(db,settings,c.id,c.project);
  await assert.rejects(N.requestContactVerification(db,settings,c.id,c.project),e=>e.status===429);
  // Expired codes fail.
  const d=await account();await enable(d);await N.proposeContactDestination(db,d.id,d.project,'late@example.com');await N.requestContactVerification(db,settings,d.id,d.project,new Date(Date.now()-7200000));
  await N.runContactDelivery(db,settings,fake.send,{now:new Date(Date.now()-7100000)});const late=(await row('SELECT verification_code c FROM contact_notification_destinations WHERE project_id=?',d.project)).c;
  await assert.rejects(N.confirmContactDestination(db,d.id,d.project,late),e=>e.status===400);
 });
 await test('notices are content-free, deduplicated across replay and survive a provider timeout without duplicating',async()=>{
  const a=await account(),fake=provider(),{revision}=await verified(a,'owner-b@example.com',fake);fake.calls.length=0;const base=fake.sent.size;
  const first=msg();await Promise.all([saveContact(db,a.project,revision,first),saveContact(db,a.project,revision,first)]);
  const t=Date.now();fake.hang=true;
  let r=await N.runContactDelivery(db,settings,fake.send,{now:new Date(t),timeoutMs:25});assert.equal(r.queued,1);assert.equal(r.retried,1,'A timeout is a retryable outcome');assert.equal(fake.sent.size,base+1,'The provider did take the first attempt');
  let out=await row("SELECT state,attempts,last_error,idempotency_key FROM contact_notification_outbox WHERE kind='new_message'");assert.deepEqual({state:out.state,attempts:out.attempts,last_error:out.last_error},{state:'queued',attempts:1,last_error:'unavailable'});
  r=await N.runContactDelivery(db,settings,fake.send,{now:new Date(t+60000)});assert.equal(fake.calls.length,1,'Not retried before its backoff time');
  r=await N.runContactDelivery(db,settings,fake.send,{now:new Date(t+6*60000)});assert.equal(r.accepted,1);assert.equal(fake.calls.length,2);assert.equal(fake.calls[0].idempotencyKey,fake.calls[1].idempotencyKey,'Retries reuse one provider idempotency key');assert.equal(fake.sent.size,base+1,'The provider deduplicated the replay');
  // Replays: the same drain, the same message and another process cannot create or send a second notice.
  await saveContact(db,a.project,revision,first);r=await N.runContactDelivery(db,settings,fake.send,{now:new Date(t+3600000)});assert.equal(r.queued+r.accepted+r.retried,0);assert.equal((await row("SELECT count(*) n FROM contact_notification_outbox WHERE kind='new_message'")).n,1);
  const idem=out.idempotency_key;await assert.rejects(()=>run("INSERT INTO contact_notification_outbox(id,user_id,project_id,destination_id,kind,submission_id,idempotency_key,provider,review,created_at,next_attempt_at,expires_at) SELECT ?,user_id,project_id,destination_id,kind,submission_id,idempotency_key,provider,review,created_at,next_attempt_at,expires_at FROM contact_notification_outbox WHERE idempotency_key=?",crypto.randomUUID(),idem),/UNIQUE/);
  for(const n of fake.calls){assert.equal(n.kind,'new_message');assert.deepEqual(Object.keys(n).sort(),['idempotencyKey','kind','outboxId','projectId','recipient']);assert.ok(!JSON.stringify(n).includes('PRIVATE'));assert.ok(!JSON.stringify(n).includes('visitor-canary'));}
  assert.ok(!JSON.stringify(await rows('SELECT * FROM contact_notification_outbox')).includes('PRIVATE-VISITOR'),'The outbox stores no visitor content');
  // Concurrent drains cannot double send one attempt.
  const second=msg();await saveContact(db,a.project,revision,second);fake.calls.length=0;const t2=t+2*3600000;
  await Promise.all([N.runContactDelivery(db,settings,fake.send,{now:new Date(t2)}),N.runContactDelivery(db,settings,fake.send,{now:new Date(t2)})]);assert.equal(fake.calls.length,1,'One claim wins');
  assert.equal((await contactInbox(scope(a.id),a.id,a.project)).messages.length,2,'The durable inbox is the source of truth');
 });
 await test('failure is bounded: rejection and exhaustion are terminal and terminal states cannot reverse',async()=>{
  const a=await account(),fake=provider(),{revision}=await verified(a,'owner-c@example.com',fake);const t0=Date.now();
  await saveContact(db,a.project,revision,msg());fake.mode='reject';let r=await N.runContactDelivery(db,settings,fake.send,{now:new Date(t0)});assert.equal(r.failed,1);
  const rejected=await row("SELECT id,state,last_error FROM contact_notification_outbox WHERE project_id=? AND kind='new_message'",a.project);assert.deepEqual({state:rejected.state,last_error:rejected.last_error},{state:'failed',last_error:'rejected'});
  await assert.rejects(()=>run("UPDATE contact_notification_outbox SET state='queued' WHERE id=?",rejected.id),/final/);await assert.rejects(()=>run("UPDATE contact_notification_outbox SET state='accepted',accepted_at=? WHERE id=?",now(),rejected.id),/final/);
  const calls=fake.calls.length;r=await N.runContactDelivery(db,settings,fake.send,{now:new Date(t0+86400000)});assert.equal(fake.calls.length,calls,'A failed notice is never sent again');
  await saveContact(db,a.project,revision,msg());fake.mode='throw';let at=t0+3*3600000,failed=0,sends=0;
  for(let i=0;i<8&&!failed;i++){const before=fake.calls.length;failed+=(await N.runContactDelivery(db,settings,fake.send,{now:new Date(at)})).failed;sends+=fake.calls.length-before;at+=7*3600000;}
  assert.equal(failed,1);assert.equal(sends,N.maxContactDeliveryAttempts);const ex=await row("SELECT attempts,last_error FROM contact_notification_outbox WHERE state='failed' AND last_error='exhausted'");assert.equal(ex.attempts,N.maxContactDeliveryAttempts);
  // Accepted can only become a bounce or complaint, never go back.
  fake.mode='up';await saveContact(db,a.project,revision,msg());await N.runContactDelivery(db,settings,fake.send,{now:new Date(at+86400000)});
  const accepted=await row("SELECT id FROM contact_notification_outbox WHERE state='accepted' AND kind='new_message'");
  await assert.rejects(()=>run("UPDATE contact_notification_outbox SET state='queued',accepted_at=NULL WHERE id=?",accepted.id),/final/);await assert.rejects(()=>run("UPDATE contact_notification_outbox SET state='cancelled',accepted_at=NULL WHERE id=?",accepted.id),/final/);await assert.rejects(()=>run("UPDATE contact_notification_outbox SET provider_ref='other' WHERE id=?",accepted.id),/final/);
 });
 await test('bounce, complaint and unsubscribe suppress permanently, idempotently, and the suppression cannot be reversed',async()=>{
  for(const type of ['bounce','complaint','unsubscribe']){
   const a=await account(),fake=provider(),{revision}=await verified(a,type+'@example.com',fake);await saveContact(db,a.project,revision,msg());
   await N.runContactDelivery(db,settings,fake.send);const sentRow=await row("SELECT id FROM contact_notification_outbox WHERE project_id=? AND kind='new_message'",a.project);assert.ok(sentRow);
   await saveContact(db,a.project,revision,msg());await N.runContactDelivery(db,settings,async()=>({accepted:false,retryable:true}),{now:new Date(Date.now()+1000)});
   const queuedBefore=await row("SELECT count(*) n FROM contact_notification_outbox WHERE project_id=? AND state='queued'",a.project);assert.equal(queuedBefore.n,1);
   assert.deepEqual(await N.applyContactDeliveryEvent(db,{outboxId:sentRow.id,type}),{applied:true});
   const expected=type==='bounce'?'bounced':type==='complaint'?'complained':'accepted';assert.equal((await row('SELECT state FROM contact_notification_outbox WHERE id=?',sentRow.id)).state,expected);
   assert.equal((await row("SELECT count(*) n FROM contact_notification_outbox WHERE project_id=? AND state='queued'",a.project)).n,0,'Unsent notices are cancelled');assert.equal((await row("SELECT last_error FROM contact_notification_outbox WHERE project_id=? AND state='cancelled'",a.project)).last_error,'suppressed');
   assert.equal((await row('SELECT state FROM contact_notification_destinations WHERE project_id=?',a.project)).state,'suppressed');assert.equal((await row('SELECT reason FROM contact_notification_suppressions WHERE user_id=? AND address=?',a.id,type+'@example.com')).reason,type);
   await N.applyContactDeliveryEvent(db,{outboxId:sentRow.id,type});if(type!=='unsubscribe')await N.applyContactDeliveryEvent(db,{outboxId:sentRow.id,type:'complaint'});assert.equal((await rows('SELECT * FROM contact_notification_suppressions WHERE user_id=?',a.id)).length,1,'A replayed or later event does not rewrite suppression');
   assert.equal((await row('SELECT state FROM contact_notification_outbox WHERE id=?',sentRow.id)).state,expected,'A terminal state does not change on replay');
   await assert.rejects(()=>run("UPDATE contact_notification_destinations SET state='verified' WHERE project_id=?",a.project),/destination_final/);await assert.rejects(()=>run("UPDATE contact_notification_suppressions SET reason='bounce' WHERE user_id=?",a.id),/suppression_final/);await assert.rejects(()=>run("DELETE FROM contact_notification_suppressions WHERE user_id=?",a.id),/suppression_final/);
   await assert.rejects(N.proposeContactDestination(db,a.id,a.project,type+'@example.com'),e=>e.status===409);await assert.rejects(N.requestContactVerification(db,settings,a.id,a.project),e=>e.status===409);
   // Even removing and re-adding the address cannot resume delivery.
   await N.removeContactDestination(db,a.id,a.project);await assert.rejects(N.proposeContactDestination(db,a.id,a.project,type+'@example.com'),e=>e.status===409);
   await saveContact(db,a.project,revision,msg());const calls=fake.calls.length;await N.runContactDelivery(db,settings,fake.send,{now:new Date(Date.now()+86400000)});assert.equal(fake.calls.length,calls,'No notice after suppression');
   assert.equal((await N.applyContactDeliveryEvent(db,{outboxId:crypto.randomUUID(),type})).applied,false);
   await db.prepare('DELETE FROM users WHERE id=?').bind(a.id).run();assert.equal((await row('SELECT count(*) n FROM contact_notification_suppressions WHERE user_id=?',a.id)).n,0,'Account deletion removes the account\'s own suppressions');
  }
 });
 await test('caps, no backfill, deleted messages, tenant and containment boundaries',async()=>{
  const a=await account(),fake=provider(),{revision}=await verified(a,'owner-d@example.com',fake);
  for(let i=0;i<12;i++)await saveContact(db,a.project,revision,msg());let r=await N.runContactDelivery(db,settings,fake.send,{limit:25});assert.equal(r.queued,10,'At most 10 notices an hour per destination');assert.equal((await N.runContactDelivery(db,settings,fake.send,{limit:25})).queued,0);
  assert.equal((await contactInbox(scope(a.id),a.id,a.project)).messages.length,12,'Throttled messages remain in the inbox');
  await assert.rejects(()=>run("INSERT INTO contact_notification_outbox(id,user_id,project_id,destination_id,kind,submission_id,idempotency_key,provider,review,created_at,next_attempt_at,expires_at) SELECT ?,d.user_id,d.project_id,d.id,'new_message',(SELECT id FROM contact_submissions WHERE project_id=d.project_id LIMIT 1),'message:backstop-'||d.id,'p','r',?,?,? FROM contact_notification_destinations d WHERE d.project_id=?",crypto.randomUUID(),now(),now(),now(),a.project),/outbox_rate/);
  // A message deleted by the owner before sending is cancelled, not sent.
  const b=await account(),fb=provider(),vb=await verified(b,'owner-e@example.com',fb),gone=msg();await saveContact(db,b.project,vb.revision,gone);const queued=await N.runContactDelivery(db,settings,async()=>({accepted:false,retryable:true}));assert.equal(queued.retried,1);await deleteContact(scope(b.id),b.id,gone.id);
  fb.calls.length=0;r=await N.runContactDelivery(db,settings,fb.send,{now:new Date(Date.now()+86400000)});assert.equal(r.cancelled,1);assert.equal(fb.calls.length,0);
  // Messages received before verification are never back-filled.
  const c=await account();const cRev=await enable(c);await saveContact(db,c.project,cRev,msg());await new Promise(r=>setTimeout(r,5));const fc=provider();await N.proposeContactDestination(db,c.id,c.project,'owner-f@example.com');await N.requestContactVerification(db,settings,c.id,c.project);await N.runContactDelivery(db,settings,fc.send);
  await N.confirmContactDestination(db,c.id,c.project,(await row('SELECT verification_code c FROM contact_notification_destinations WHERE project_id=?',c.project)).c);fc.calls.length=0;assert.equal((await N.runContactDelivery(db,settings,fc.send)).queued,0);
  // WH-050 containment of the contact scope stops notices while the inbox still works for the owner.
  const d=await account(),fd=provider(),vd=await verified(d,'owner-g@example.com',fd);await saveContact(db,d.project,vd.revision,msg());
  await run("INSERT INTO operator_containments(id,scope,subject_kind,subject_id,allowance,operator_ref,reason,request_digest,expires_at) VALUES(?,'contact','project',?,NULL,'human:test','reason',?,?)",crypto.randomUUID(),d.project,'f'.repeat(64),new Date(Date.now()+3600000).toISOString());
  fd.calls.length=0;r=await N.runContactDelivery(db,settings,fd.send);assert.equal(r.queued,0);assert.equal(fd.calls.length,0);
  // Another account's runner view is isolated: a notice always goes to its own project's destination.
  const e=await account(),fe=provider(),ve=await verified(e,'owner-h@example.com',fe);fe.calls.length=0;await saveContact(db,e.project,ve.revision,msg());await N.runContactDelivery(db,settings,fe.send);assert.deepEqual(fe.calls.map(n=>[n.projectId,n.recipient]),[[e.project,'owner-h@example.com']]);
 });
 await test('retention skips held projects and expiry removes only content-free outbox rows',async()=>{
  const a=await account(),b=await account();for(const [x,addr] of [[a,'owner-i@example.com'],[b,'owner-j@example.com']]){await enable(x);await N.proposeContactDestination(db,x.id,x.project,addr);}
  const destA=await row('SELECT id FROM contact_notification_destinations WHERE project_id=?',a.project),destB=await row('SELECT id FROM contact_notification_destinations WHERE project_id=?',b.project);
  const old='2000-01-01T00:00:00.000Z';
  for(const [x,d,k] of [[a,destA,'expired-a'],[b,destB,'expired-b']])await run("INSERT INTO contact_notification_outbox(id,user_id,project_id,destination_id,kind,idempotency_key,provider,review,created_at,next_attempt_at,expires_at) VALUES(?,?,?,?,'verification',?,'p','r',?,?,?)",crypto.randomUUID(),x.id,x.project,d.id,'verify:'+k+d.id,old,old,old);
  await run("INSERT INTO safety_cases(id,subject_user_id,intake_ref,opened_by,opened_at) VALUES('case-wh036',?,'intake-1','human:reviewer',unixepoch())",a.id);
  await run("INSERT INTO safety_preservation_holds(id,case_id,subject_user_id,scope,project_id,legal_basis_ref,approved_by,placed_at,review_due_at) VALUES('hold-wh036','case-wh036',?,'project',?,'basis-1','human:approver',unixepoch(),unixepoch()+86400)",a.id,a.project);
  await cleanupContacts(db);assert.equal((await row("SELECT count(*) n FROM contact_notification_outbox WHERE idempotency_key LIKE 'verify:expired-%'")).n,1,'Only the unheld project expires');assert.equal((await row("SELECT project_id FROM contact_notification_outbox WHERE idempotency_key LIKE 'verify:expired-%'")).project_id,a.project);
  await assert.rejects(N.removeContactDestination(db,a.id,a.project),/safety_preservation_hold/);await assert.rejects(()=>run("DELETE FROM contact_notification_outbox WHERE project_id=?",a.project),/safety_preservation_hold/);
  await N.removeContactDestination(db,b.id,b.project);assert.equal((await row('SELECT count(*) n FROM contact_notification_destinations WHERE project_id=?',b.project)).n,0);assert.equal((await row('SELECT count(*) n FROM contact_notification_outbox WHERE project_id=?',b.project)).n,0,'Removal cascades the unheld project\'s notices');
 });
 assert.equal(network,0,'No network call was made');
 console.log(`Contact notification checks passed (${cases} groups): provider gating, verification through the provider, content-free notices, idempotency and timeout replay, bounded retries, bounce/complaint/unsubscribe suppression, irreversible terminal states, caps, containment and hold-aware retention.`);
}finally{globalThis.fetch=originalFetch;await store.close();}
