import {currentSiteFixtureHandlers,createFixtureWebsite,changeFixtureWebsite} from './current-site-fixture.mjs';
import assert from 'node:assert/strict';
import {assertTypedReplyEditRefused} from './helpers/receipt-forge.mjs';
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
const settings={provider:'fixture-provider',review:'review-1',sendCeiling:1000};
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
  assert.deepEqual(Object.keys(N.implementedContactNotificationProviders),['cloudflare-email'],'Cloudflare Email Service is the only implemented provider');
  const list={'fixture-provider':{sendCeiling:7}},cfg=(env,l)=>N.contactNotificationConfig(env,l).settings;
  assert.equal(cfg({}),null);assert.equal(cfg({CONTACT_NOTIFICATION_PROVIDER:'fixture-provider'},list),null,'selected but not reviewed');assert.equal(cfg({CONTACT_NOTIFICATION_REVIEW:'r'},list),null,'reviewed but not selected');
  assert.equal(cfg({CONTACT_NOTIFICATION_PROVIDER:'fixture-provider',CONTACT_NOTIFICATION_REVIEW:'r'}),null,'not implemented');assert.equal(N.contactNotificationConfig({CONTACT_NOTIFICATION_PROVIDER:'cloudflare-email-routing',CONTACT_NOTIFICATION_REVIEW:'r'}).settings,null,'Inbound Email Routing is never a provider');
  assert.equal(cfg({CONTACT_NOTIFICATION_PROVIDER:'constructor',CONTACT_NOTIFICATION_REVIEW:'r'}),null,'Only own keys name providers');
  assert.deepEqual(cfg({CONTACT_NOTIFICATION_PROVIDER:'fixture-provider',CONTACT_NOTIFICATION_REVIEW:'r'},list),{provider:'fixture-provider',review:'r',sendCeiling:7});
  assert.deepEqual(cfg({CONTACT_NOTIFICATION_PROVIDER:'cloudflare-email',CONTACT_NOTIFICATION_REVIEW:'issue-146'}),{provider:'cloudflare-email',review:'issue-146',sendCeiling:14285},'$5 at $0.35 per 1,000, ignoring the included quota');
  // The live sender is reachable only with the reviewed provider AND the owner-added binding.
  const E=m.contactEmail,binding={send:async()=>assert.fail('not sent')};
  for(const env of [{},{CONTACT_EMAIL:binding},{CONTACT_NOTIFICATION_PROVIDER:'cloudflare-email',CONTACT_EMAIL:binding},{CONTACT_NOTIFICATION_PROVIDER:'cloudflare-email',CONTACT_NOTIFICATION_REVIEW:'r'},{CONTACT_NOTIFICATION_PROVIDER:'cloudflare-email',CONTACT_NOTIFICATION_REVIEW:'r',CONTACT_EMAIL:{}}])assert.equal(E.contactDelivery(env),null);
  assert.equal(E.contactDelivery({CONTACT_NOTIFICATION_PROVIDER:'cloudflare-email',CONTACT_NOTIFICATION_REVIEW:'r',CONTACT_EMAIL:binding}).settings.provider,'cloudflare-email');
  const a=await account(),fake=provider(),revision=await enable(a);await saveContact(db,a.project,revision,msg());
  const destination=await N.proposeContactDestination(db,a.id,a.project,'  Owner@Example.COM ');assert.deepEqual({address:destination.address,state:destination.state},{address:'owner@example.com',state:'unverified'});
  assert.deepEqual(await N.requestContactVerification(db,null,a.id,a.project),{status:'provider_not_configured'});
  assert.deepEqual(await N.runContactDelivery(db,null,fake.send),{enabled:false,queued:0,accepted:0,retried:0,failed:0,cancelled:0,refused:0});
  assert.equal((await N.runContactDelivery(db,null,fake.send)).enabled,false);assert.equal(fake.calls.length,0);assert.equal((await row('SELECT count(*) n FROM notification_notices')).n,0);
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
  const sent=fake.calls[0];assert.equal(sent.kind,'verification');assert.equal(sent.verificationCode,code);assert.equal(sent.recipient,'owner-a@example.com');assert.deepEqual(Object.keys(sent).sort(),['idempotencyKey','kind','outboxId','projectId','recipient','template','verificationCode']);
  await assert.rejects(N.confirmContactDestination(db,b.id,a.project,code),e=>e.status===404);
  const wrong=code[0]==='A'?'B'+code.slice(1):'A'+code.slice(1);for(let i=0;i<5;i++)await assert.rejects(N.confirmContactDestination(db,a.id,a.project,wrong),e=>e.status===400);
  await assert.rejects(N.confirmContactDestination(db,a.id,a.project,code),e=>e.status===400,'Five wrong guesses lock the code');
  assert.equal((await N.contactNotificationStatus(db,a.id,a.project)).destination.state,'unverified');
  await N.requestContactVerification(db,settings,a.id,a.project);const code2=(await row('SELECT verification_code c FROM contact_notification_destinations WHERE project_id=?',a.project)).c;assert.notEqual(code2,code);
  await N.runContactDelivery(db,settings,fake.send);assert.equal((await row("SELECT state FROM notification_notices WHERE event_ref LIKE ?",'%:'+code)).state,'accepted');
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
  // The dispatcher serves at most two notices per owner in a run: drain what this test left behind so later counts start clean.
  for(let i=0;i<4;i++)await N.runContactDelivery(db,settings,async()=>({accepted:true}),{now:new Date(Date.now()+i)});
 });
 await test('notices are content-free, deduplicated across replay and a provider timeout is never resent',async()=>{
  const a=await account(),fake=provider(),{revision}=await verified(a,'owner-b@example.com',fake);fake.calls.length=0;const base=fake.sent.size;
  const first=msg();await Promise.all([saveContact(db,a.project,revision,first),saveContact(db,a.project,revision,first)]);
  const t=Date.now();fake.hang=true;
  let r=await N.runContactDelivery(db,settings,fake.send,{now:new Date(t),timeoutMs:25});assert.equal(r.queued,1);assert.equal(r.failed,1,'A timeout is held as unknown-outcome');assert.equal(fake.sent.size,base+1,'The provider did take the first attempt');
  let out=await row("SELECT id,state,attempts,reason,reconcile_until,outcome_at,event_ref FROM notification_notices WHERE template='contact.new-message@1'");assert.deepEqual({state:out.state,attempts:out.attempts,reason:out.reason},{state:'unknown-outcome',attempts:1,reason:'uncertain'});assert.equal(out.reconcile_until-out.outcome_at,72*3600000,'Held for at most 72 hours of reconciliation');
  for(const later of [6*60000,3600000,86400000])await N.runContactDelivery(db,settings,fake.send,{now:new Date(t+later)});assert.equal(fake.calls.length,1,'The provider has no idempotency key, so an uncertain call is never resent');assert.equal(fake.sent.size,base+1);
  // Replays: the same drain, the same message and another process cannot create or send a second notice.
  await saveContact(db,a.project,revision,first);r=await N.runContactDelivery(db,settings,fake.send,{now:new Date(t+3600000)});assert.equal(r.queued+r.accepted+r.retried,0);assert.equal((await row("SELECT count(*) n FROM notification_notices WHERE template='contact.new-message@1'")).n,1);
  await assert.rejects(()=>run("INSERT INTO notification_notices(id,user_id,scope,project_id,destination_id,recipient_key,template,event_ref,created_at,expires_at) SELECT ?,user_id,scope,project_id,destination_id,recipient_key,template,event_ref,created_at,expires_at FROM notification_notices WHERE id=?",crypto.randomUUID(),out.id),/UNIQUE/);
  for(const n of fake.calls){assert.equal(n.kind,'new_message');assert.deepEqual(Object.keys(n).sort(),['idempotencyKey','kind','outboxId','projectId','recipient','template']);assert.ok(!JSON.stringify(n).includes('PRIVATE'));assert.ok(!JSON.stringify(n).includes('visitor-canary'));}
  assert.ok(!JSON.stringify(await rows('SELECT * FROM notification_notices')).includes('PRIVATE-VISITOR'),'The outbox stores no visitor content');
  // Concurrent drains cannot double send one attempt.
  const second=msg();await saveContact(db,a.project,revision,second);fake.calls.length=0;const t2=t+2*3600000;
  await Promise.all([N.runContactDelivery(db,settings,fake.send,{now:new Date(t2)}),N.runContactDelivery(db,settings,fake.send,{now:new Date(t2)})]);assert.equal(fake.calls.length,1,'One claim wins');
  assert.equal((await contactInbox(scope(a.id),a.id,a.project)).messages.length,2,'The durable inbox is the source of truth');
 });
 await test('failure is bounded: rejection and exhaustion are terminal and terminal states cannot reverse',async()=>{
  const a=await account(),fake=provider(),{revision}=await verified(a,'owner-c@example.com',fake);const t0=Date.now();
  await saveContact(db,a.project,revision,msg());fake.mode='reject';let r=await N.runContactDelivery(db,settings,fake.send,{now:new Date(t0)});assert.equal(r.failed,1);
  const rejected=await row("SELECT id,state,reason FROM notification_notices WHERE project_id=? AND template='contact.new-message@1'",a.project);assert.deepEqual({state:rejected.state,reason:rejected.reason},{state:'failed',reason:'rejected'});
  await assert.rejects(()=>run("UPDATE notification_notices SET state='queued' WHERE id=?",rejected.id),/notification_notice_transition/);await assert.rejects(()=>run("UPDATE notification_notices SET state='accepted',reason=NULL WHERE id=?",rejected.id),/notification_notice_transition/);
  const calls=fake.calls.length;r=await N.runContactDelivery(db,settings,fake.send,{now:new Date(t0+86400000)});assert.equal(fake.calls.length,calls,'A failed notice is never sent again');
  // A thrown provider call is uncertain and final after one call.
  await saveContact(db,a.project,revision,msg());fake.mode='throw';const before=fake.calls.length;r=await N.runContactDelivery(db,settings,fake.send,{now:new Date(t0+3600000)});assert.equal(r.failed,1);assert.equal(fake.calls.length,before+1);
  await N.runContactDelivery(db,settings,fake.send,{now:new Date(t0+2*86400000)});assert.equal(fake.calls.length,before+1,'Never resent');assert.ok(!JSON.stringify(await rows('SELECT * FROM notification_notices')).includes('PRIVATE-PROVIDER-ERROR'));
  await saveContact(db,a.project,revision,msg());fake.mode='down';let at=t0+3*3600000,failed=0,sends=0;
  for(let i=0;i<8&&!failed;i++){const before=fake.calls.length;failed+=(await N.runContactDelivery(db,settings,fake.send,{now:new Date(at)})).failed;sends+=fake.calls.length-before;at+=3*3600000;}
  assert.equal(failed,1);assert.equal(sends,N.maxContactDeliveryAttempts);const ex=await row("SELECT attempts,reason FROM notification_notices WHERE state='failed' AND reason='exhausted'");assert.equal(ex.attempts,N.maxContactDeliveryAttempts);
  // Accepted can only become a bounce or complaint, never go back.
  fake.mode='up';await saveContact(db,a.project,revision,msg());await N.runContactDelivery(db,settings,fake.send,{now:new Date(at+86400000)});
  const accepted=await row("SELECT id FROM notification_notices WHERE state='accepted' AND template='contact.new-message@1'");
  await assert.rejects(()=>run("UPDATE notification_notices SET state='queued' WHERE id=?",accepted.id),/notification_notice_transition/);await assert.rejects(()=>run("UPDATE notification_notices SET state='cancelled',reason='expired' WHERE id=?",accepted.id),/notification_notice_transition/);await assert.rejects(()=>run("UPDATE notification_notices SET provider_ref='other' WHERE id=?",accepted.id),/notification_notice_transition/);
 });
 await test('bounce, complaint and unsubscribe suppress permanently, idempotently, and the suppression cannot be reversed',async()=>{
  for(const type of ['bounce','complaint','unsubscribe']){
   const a=await account(),fake=provider(),{revision}=await verified(a,type+'@example.com',fake);await saveContact(db,a.project,revision,msg());
   await N.runContactDelivery(db,settings,fake.send);const sentRow=await row("SELECT id FROM notification_notices WHERE project_id=? AND template='contact.new-message@1'",a.project);assert.ok(sentRow);
   await saveContact(db,a.project,revision,msg());await N.runContactDelivery(db,settings,async()=>({accepted:false,retryable:true}),{now:new Date(Date.now()+1000)});
   const queuedBefore=await row("SELECT count(*) n FROM notification_notices WHERE project_id=? AND state IN ('queued','deferred')",a.project);assert.equal(queuedBefore.n,1);
   assert.deepEqual(await N.applyContactDeliveryEvent(db,{outboxId:sentRow.id,type}),{applied:true});
   const expected=type==='bounce'?'bounced':type==='complaint'?'complained':'accepted';assert.equal((await row('SELECT state FROM notification_notices WHERE id=?',sentRow.id)).state,expected);
   assert.equal((await row("SELECT count(*) n FROM notification_notices WHERE project_id=? AND state IN ('queued','deferred')",a.project)).n,0,'Unsent notices are cancelled');assert.equal((await row("SELECT reason FROM notification_notices WHERE project_id=? AND state='cancelled'",a.project)).reason,'suppressed');
   assert.equal((await row("SELECT count(*) n FROM job_journal j JOIN notification_notices n ON n.job_id=j.id WHERE n.project_id=? AND n.state='cancelled' AND j.state!='cancelled'",a.project)).n,0,'The cancelled notice takes its unclaimed envelope with it');
   assert.equal((await row('SELECT state FROM contact_notification_destinations WHERE project_id=?',a.project)).state,'suppressed');assert.equal((await row('SELECT reason FROM contact_notification_suppressions WHERE user_id=? AND address=?',a.id,type+'@example.com')).reason,type);
   await N.applyContactDeliveryEvent(db,{outboxId:sentRow.id,type});if(type!=='unsubscribe')await N.applyContactDeliveryEvent(db,{outboxId:sentRow.id,type:'complaint'});assert.equal((await rows('SELECT * FROM contact_notification_suppressions WHERE user_id=?',a.id)).length,1,'A replayed or later event does not rewrite suppression');
   assert.equal((await row('SELECT state FROM notification_notices WHERE id=?',sentRow.id)).state,expected,'A terminal state does not change on replay');
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
  for(let i=0;i<12;i++)await saveContact(db,a.project,revision,msg());let r=await N.runContactDelivery(db,settings,fake.send,{limit:25});assert.equal(r.queued,9,'At most 10 notices an hour per destination (the verification notice counts as one)');assert.equal((await N.runContactDelivery(db,settings,fake.send,{limit:25})).queued,0);
  assert.equal((await contactInbox(scope(a.id),a.id,a.project)).messages.length,12,'Throttled messages remain in the inbox');
  await assert.rejects(()=>run("INSERT INTO notification_notices(id,user_id,scope,project_id,destination_id,recipient_key,template,event_ref,created_at,expires_at) SELECT ?,d.user_id,'owner-destination',d.project_id,d.id,'owner-destination:'||d.id,'contact.new-message@1','message:backstop-'||d.id,?,? FROM contact_notification_destinations d WHERE d.project_id=?",crypto.randomUUID(),Date.now(),Date.now()+3600000,a.project),/notification_notice_rate/);
  // A message deleted by the owner before sending is cancelled, not sent.
  const b=await account(),fb=provider(),vb=await verified(b,'owner-e@example.com',fb),gone=msg();await saveContact(db,b.project,vb.revision,gone);const queued=await N.runContactDelivery(db,settings,async n=>n.projectId===b.project?{accepted:false,retryable:true}:{accepted:true});assert.equal(queued.retried,1);await deleteContact(scope(b.id),b.id,gone.id);
  fb.calls.length=0;r=await N.runContactDelivery(db,settings,fb.send,{now:new Date(Date.now()+3600000)});assert.equal(r.cancelled,1);assert.equal(fb.calls.filter(n=>n.projectId===b.project).length,0);
  // Messages received before verification are never back-filled.
  const c=await account();const cRev=await enable(c);await saveContact(db,c.project,cRev,msg());await new Promise(r=>setTimeout(r,5));const fc=provider();await N.proposeContactDestination(db,c.id,c.project,'owner-f@example.com');await N.requestContactVerification(db,settings,c.id,c.project);await N.runContactDelivery(db,settings,fc.send);
  await N.confirmContactDestination(db,c.id,c.project,(await row('SELECT verification_code c FROM contact_notification_destinations WHERE project_id=?',c.project)).c);fc.calls.length=0;assert.equal((await N.runContactDelivery(db,settings,fc.send)).queued,0);
  // WH-050 containment of the contact scope stops notices while the inbox still works for the owner.
  const d=await account(),fd=provider(),vd=await verified(d,'owner-g@example.com',fd);await saveContact(db,d.project,vd.revision,msg());
  await run("INSERT INTO operator_containments(id,scope,subject_kind,subject_id,allowance,operator_ref,reason,request_digest,expires_at) VALUES(?,'contact','project',?,NULL,'human:test','reason',?,?)",crypto.randomUUID(),d.project,'f'.repeat(64),new Date(Date.now()+3600000).toISOString());
  fd.calls.length=0;r=await N.runContactDelivery(db,settings,fd.send);assert.equal(r.queued,0);assert.equal(fd.calls.filter(n=>n.projectId===d.project).length,0);
  // Another account's runner view is isolated: a notice always goes to its own project's destination.
  const e=await account(),fe=provider(),ve=await verified(e,'owner-h@example.com',fe);fe.calls.length=0;await saveContact(db,e.project,ve.revision,msg());await N.runContactDelivery(db,settings,fe.send);assert.deepEqual(fe.calls.filter(n=>n.projectId===e.project).map(n=>[n.projectId,n.recipient]),[[e.project,'owner-h@example.com']]);
 });
 await test('retention skips held projects and expiry removes only content-free outbox rows',async()=>{
  const a=await account(),b=await account();for(const [x,addr] of [[a,'owner-i@example.com'],[b,'owner-j@example.com']]){await enable(x);await N.proposeContactDestination(db,x.id,x.project,addr);}
  const destA=await row('SELECT id FROM contact_notification_destinations WHERE project_id=?',a.project),destB=await row('SELECT id FROM contact_notification_destinations WHERE project_id=?',b.project);
  const old=Date.parse('2000-01-01T00:00:00.000Z');
  for(const [x,d,k] of [[a,destA,'expired-a'],[b,destB,'expired-b']]){const nid=crypto.randomUUID();await run("INSERT INTO notification_notices(id,user_id,scope,project_id,destination_id,recipient_key,template,event_ref,created_at,expires_at) VALUES(?,?,'owner-destination',?,?,?,'owner.destination-verification@1',?,?,?)",nid,x.id,x.project,d.id,'owner-destination:'+d.id,'verify:'+k+d.id,old,old+3600000);await run("UPDATE notification_notices SET state='cancelled',reason='expired',outcome_at=? WHERE id=?",old+3600000,nid);}
  const open=crypto.randomUUID();await run("INSERT INTO notification_notices(id,user_id,scope,project_id,destination_id,recipient_key,template,event_ref,created_at,expires_at) VALUES(?,?,'owner-destination',?,?,?,'owner.destination-verification@1','verify:open',?,?)",open,b.id,b.project,destB.id,'owner-destination:'+destB.id,Date.now(),Date.now()+3600000);
  await assert.rejects(()=>run('DELETE FROM notification_notices WHERE id=?',open),/notification_notice_retained/,'No delete while a notice is open');
  await run("INSERT INTO safety_cases(id,subject_user_id,intake_ref,opened_by,opened_at,retention_due_at) VALUES('case-wh036',?,'intake-1','human:reviewer',unixepoch(),unixepoch()+31536000)",a.id);
  await run("INSERT INTO safety_preservation_holds(id,case_id,subject_user_id,scope,project_id,legal_basis_ref,approved_by,placed_at,review_due_at) VALUES('hold-wh036','case-wh036',?,'project',?,'basis-1','human:approver',unixepoch(),unixepoch()+86400)",a.id,a.project);
  await cleanupContacts(db);assert.equal((await row("SELECT count(*) n FROM notification_notices WHERE event_ref LIKE 'verify:expired-%'")).n,1,'Only the unheld project expires');assert.equal((await row("SELECT project_id FROM notification_notices WHERE event_ref LIKE 'verify:expired-%'")).project_id,a.project);
  await assert.rejects(N.removeContactDestination(db,a.id,a.project),e=>e.status===423&&!/safety_preservation_hold/.test(e.message));await assert.rejects(()=>run("DELETE FROM notification_notices WHERE project_id=?",a.project),/safety_preservation_hold/);
  await N.removeContactDestination(db,b.id,b.project);assert.equal((await row('SELECT count(*) n FROM contact_notification_destinations WHERE project_id=?',b.project)).n,0);assert.equal((await row('SELECT count(*) n FROM notification_notices WHERE project_id=?',b.project)).n,0,'Removal cancels and cascades the unheld project\'s unsent notices');
 });
 await test('Cloudflare Email Service adapter: documented binding shape, content-free text and error mapping',async()=>{
  const E=m.contactEmail,sent=[];let failWith=null;
  const binding={send:async message=>{if(failWith)throw failWith;sent.push(message);return {messageId:'cf-'+sent.length};}};
  const send=E.cloudflareEmailSender(binding),notice={outboxId:crypto.randomUUID(),idempotencyKey:'verify:x:ABCDEFGH',kind:'verification',template:'owner.destination-verification@1',projectId:crypto.randomUUID(),recipient:'owner@example.com',verificationCode:'ABCDEFGH'};
  assert.deepEqual(await send(notice,settings),{accepted:true,providerRef:'cf-1'});
  assert.deepEqual(Object.keys(sent[0]).sort(),['from','headers','subject','text','to']);assert.deepEqual(sent[0].from,{email:'notify@whumpo.com',name:'Whumpo'});assert.equal(sent[0].to,'owner@example.com');
  assert.deepEqual(sent[0].headers,{'X-Whumpo-Notice-Id':notice.outboxId});assert.match(sent[0].text,/ABCDEFGH/);assert.ok(!('html' in sent[0])&&!('replyTo' in sent[0])&&!('cc' in sent[0])&&!('bcc' in sent[0]));
  await send({...notice,kind:'new_message',template:'contact.new-message@1',verificationCode:undefined,idempotencyKey:'message:a:b'},settings);assert.match(sent[1].text,/https:\/\/whumpo\.com\/workspace\/inbox/);assert.match(sent[1].text,/does not include the message/);assert.ok(!/ABCDEFGH/.test(sent[1].text));
  await send({...notice,kind:'account',template:'account.passkey-added@1',projectId:null,verificationCode:undefined,idempotencyKey:'account:x'},settings);assert.match(sent[2].subject,/passkey was added/);sent.length=2;
  await assert.rejects(async()=>E.contactEmailMessage({...notice,verificationCode:'bad code'}),/Invalid verification notice/);
  const coded=code=>Object.assign(Error('PRIVATE-PROVIDER-ERROR'),{code});
  const cases={E_RATE_LIMIT_EXCEEDED:{accepted:false,retryable:true},E_DAILY_LIMIT_EXCEEDED:{accepted:false,retryable:true},E_SENDER_NOT_VERIFIED:{accepted:false,retryable:true},E_RECIPIENT_SUPPRESSED:{accepted:false,retryable:false,suppressed:true},E_DELIVERY_FAILED:{accepted:false,retryable:false},E_RECIPIENT_NOT_ALLOWED:{accepted:false,retryable:false},E_INTERNAL_SERVER_ERROR:{accepted:false,retryable:false,uncertain:true},E_SOMETHING_NEW:{accepted:false,retryable:false,uncertain:true}};
  for(const [code,outcome] of Object.entries(cases)){failWith=coded(code);assert.deepEqual(await send(notice,settings),outcome,code);}
  failWith=new TypeError('network');assert.deepEqual(await send(notice,settings),{accepted:false,retryable:false,uncertain:true});failWith=null;
  // End to end through the scheduled handler: inactive without the owner's configuration, then a verified notice, then provider suppression.
  const env={DB:db,CONTACT_NOTIFICATION_PROVIDER:'cloudflare-email',CONTACT_NOTIFICATION_REVIEW:'issue-146',CONTACT_EMAIL:binding};
  const a=await account(),revision=await enable(a);await N.proposeContactDestination(db,a.id,a.project,'cf-owner@example.com');
  assert.deepEqual(await N.requestContactVerification(db,E.contactDelivery({DB:db})?.settings??null,a.id,a.project),{status:'provider_not_configured'});
  assert.equal((await N.requestContactVerification(db,E.contactDelivery(env).settings,a.id,a.project)).status,'queued');
  const mine=()=>sent.filter(x=>x.to==='cf-owner@example.com');
  await m.worker.scheduled({cron:'* * * * *'},{DB:db});await m.worker.scheduled({cron:'* * * * *'},{...env,CONTACT_EMAIL:undefined});assert.equal(mine().length,0,'No cron run sends without the binding');
  await m.worker.scheduled({cron:'17 3 * * *'},{...env,FILES:{list:async()=>({objects:[]}),delete:async()=>{}}}).catch(()=>{});assert.equal(mine().length,0,'Only the every-minute trigger drains notices');
  await m.worker.scheduled({cron:'* * * * *'},env);assert.equal(mine().length,1);const code=/([A-Z0-9]{8})/.exec(mine()[0].text)[1];
  assert.equal((await N.confirmContactDestination(db,a.id,a.project,code)).state,'verified');
  await saveContact(db,a.project,revision,msg());await m.worker.scheduled({cron:'* * * * *'},env);assert.equal(mine().length,2);assert.equal(mine()[1].subject,'New contact-form message in Whumpo');assert.ok(!JSON.stringify(mine()).includes('PRIVATE-VISITOR')&&!JSON.stringify(mine()).includes('visitor-canary'));
  assert.match((await row("SELECT provider_ref FROM notification_notices WHERE project_id=? AND template='contact.new-message@1'",a.project)).provider_ref,/^cf-\d+$/);
  failWith=coded('E_RECIPIENT_SUPPRESSED');await saveContact(db,a.project,revision,msg());await m.worker.scheduled({cron:'* * * * *'},env);failWith=null;
  assert.equal((await row('SELECT reason FROM contact_notification_suppressions WHERE user_id=? AND address=?',a.id,'cf-owner@example.com')).reason,'provider');assert.equal((await row('SELECT state FROM contact_notification_destinations WHERE project_id=?',a.project)).state,'suppressed');
  assert.equal((await row("SELECT count(*) n FROM notification_notices WHERE project_id=? AND state='failed' AND reason='rejected'",a.project)).n,1,'The refused notice failed; the destination is suppressed');
  await saveContact(db,a.project,revision,msg());await m.worker.scheduled({cron:'* * * * *'},env);assert.equal(mine().length,2,'Nothing more after provider suppression');
 });
 await test('exact Chat review sets the address; cross-owner, replay, expiry, suppression and holds are refused',async()=>{
  const a=await account(),b=await account();
  const review=await chat(a,'/contact-notify '+a.project+' Review-Owner@Example.com');assert.equal(review.result.status,200);
  const turn=(await readChat(scope(a.id),a.id)).turns.find(t=>t.id===review.id);assert.match(turn.assistant_text,/review-owner@example\.com/);assert.match(turn.assistant_text,/Nothing changes until you use the confirmation button/);assert.equal(turn.contact_notification_confirmation_id,review.id);
  assert.equal((await N.contactNotificationStatus(db,a.id,a.project)).destination,null,'Preparing changes nothing');
  for(const bad of ['/contact-notify '+a.project,'/contact-notify '+a.project+' a@example.com b@example.com','/contact-notify '+a.project+' <a@example.com>']){const r=await chat(a,bad);assert.equal(r.result.status,200);assert.equal(await row('SELECT count(*) n FROM contact_destination_reviews WHERE id=?',r.id).then(x=>x.n),0);}
  const foreign=await chat(b,'/contact-notify '+a.project+' x@example.com');assert.equal((await row('SELECT count(*) n FROM contact_destination_reviews WHERE id=?',foreign.id)).n,0,'Another owner cannot prepare a review');
  await chat(b,'/confirm-contact-notify '+review.id);assert.equal((await N.contactNotificationStatus(db,a.id,a.project)).destination,null,'Another owner cannot confirm it');
  await assertTypedReplyEditRefused({db,kind:'contactNotification',reviewId:review.id,table:'contact_destination_reviews',typed:async()=>{const r=await chat(a,'/confirm-contact-notify '+review.id);return (await readChat(scope(a.id),a.id)).turns.find(t=>t.id===r.id).assistant_text;}});
  assert.equal((await chat(a,'/confirm-contact-notify '+review.id)).result.status,200);
  let status=await N.contactNotificationStatus(db,a.id,a.project);assert.deepEqual({address:status.destination.address,state:status.destination.state},{address:'review-owner@example.com',state:'unverified'},'Applied, but never verified by the review itself');
  assert.equal((await row("SELECT count(*) n FROM activity_events WHERE id=?",'contact-notify:'+review.id)).n,1);assert.ok(!JSON.stringify(await rows('SELECT summary FROM activity_events WHERE user_id=?',a.id)).includes('review-owner@'),'Activity is content-free');
  const replay=await chat(a,'/confirm-contact-notify '+review.id);assert.match((await readChat(scope(a.id),a.id)).turns.find(t=>t.id===replay.id).assistant_text,/already applied/);
  await assert.rejects(()=>run("UPDATE contact_destination_reviews SET address='other@example.com' WHERE id=?",review.id),/contact_destination_review_changed/);
  // An expired review is refused by the handler and by the database.
  const expired=crypto.randomUUID();await run("INSERT INTO contact_destination_reviews(id,user_id,project_id,address,expires_at) VALUES(?,?,?,'late@example.com',?)",expired,a.id,a.project,new Date(Date.now()-1000).toISOString());
  await chat(a,'/confirm-contact-notify '+expired);assert.equal((await N.contactNotificationStatus(db,a.id,a.project)).destination.address,'review-owner@example.com');
  await assert.rejects(()=>run("UPDATE contact_destination_reviews SET status='applied',confirmed_by=? WHERE id=?",review.id,expired),/contact_destination_review_changed/);
  // A second review replaces the address and starts unverified again.
  const second=await chat(a,'/contact-notify '+a.project+' second@example.com');await chat(a,'/confirm-contact-notify '+second.id);assert.equal((await N.contactNotificationStatus(db,a.id,a.project)).destination.address,'second@example.com');
  // Suppressed addresses are refused when preparing and when confirming.
  const prepared=await chat(a,'/contact-notify '+a.project+' blocked@example.com');await run("INSERT INTO contact_notification_suppressions(user_id,address,reason,created_at) VALUES(?,'blocked@example.com','complaint',?)",a.id,now());
  assert.equal((await chat(a,'/confirm-contact-notify '+prepared.id)).result.status,409);assert.equal((await N.contactNotificationStatus(db,a.id,a.project)).destination.address,'second@example.com');
  const refused=await chat(a,'/contact-notify '+a.project+' blocked@example.com');assert.match((await readChat(scope(a.id),a.id)).turns.find(t=>t.id===refused.id).assistant_text,/cannot receive notices/);
  // Inside a safety preservation hold, replacing the address is refused as a whole.
  const held=await chat(a,'/contact-notify '+a.project+' third@example.com');
  await run("INSERT INTO safety_cases(id,subject_user_id,intake_ref,opened_by,opened_at,retention_due_at) VALUES('case-wh036-review',?,'intake-2','human:reviewer',unixepoch(),unixepoch()+31536000)",a.id);
  await run("INSERT INTO safety_preservation_holds(id,case_id,subject_user_id,scope,project_id,legal_basis_ref,approved_by,placed_at,review_due_at) VALUES('hold-wh036-review','case-wh036-review',?,'project',?,'basis-2','human:approver',unixepoch(),unixepoch()+86400)",a.id,a.project);
  assert.equal((await chat(a,'/confirm-contact-notify '+held.id)).result.status,423);assert.equal((await N.contactNotificationStatus(db,a.id,a.project)).destination.address,'second@example.com');
  await assert.rejects(N.proposeContactDestination(db,a.id,a.project,'fourth@example.com'),e=>e.status===423,'The Dashboard control is refused the same way');
  // The model can prepare the exact review, never confirm it or add fields.
  const c=await account(),ctx=await m.siteContext(scope(c.id),c.id);
  const proposal=await m.prepareSiteAction(scope(c.id),c.id,crypto.randomUUID(),JSON.stringify({reply:'Done!',action:{kind:'contactNotificationReview',projectId:c.project,address:'Model@Example.com'}}),ctx);assert.match(proposal.reply,/model@example\.com/);assert.match(proposal.reply,/Nothing changes/);assert.equal(proposal.statements.length,2,"review row plus its receipt");
  for(const action of [{kind:'contactNotificationReview',projectId:c.project,address:'a@example.com',confirm:true},{kind:'contactNotificationReview',projectId:c.project},{kind:'confirmContactNotification',reviewId:review.id}])await assert.rejects(m.prepareSiteAction(scope(c.id),c.id,crypto.randomUUID(),JSON.stringify({reply:'Done',action}),ctx));
 });
 await test('operator-reviewed suppression reset: preview digest, exact suppression, audit, holds',async()=>{
  const {runSuppressionReset,suppressionResetInput}=await import('../tools/contact-suppression-reset-input.mjs');
  const a=await account(),fake=provider();await verified(a,'reset-me@example.com',fake);
  const sentRow=await row("SELECT id FROM notification_notices WHERE project_id=? AND template='owner.destination-verification@1'",a.project);await N.applyContactDeliveryEvent(db,{outboxId:sentRow.id,type:'complaint'});
  const status=await runSuppressionReset(db,{action:'status',account:a.id,address:'Reset-Me@example.com'});assert.equal(status.suppression.reason,'complaint');assert.deepEqual(status.destinations.map(d=>d.state),['suppressed']);assert.match(status.notice,/Cloudflare Email Service suppression list/);
  const request={action:'reset',id:crypto.randomUUID(),account:a.id,address:'reset-me@example.com',suppressedAt:status.suppression.suppressedAt,operator:'human:operator',reason:'Owner opted in again through support.'};
  for(const bad of [{...request,extra:1},{...request,id:'x'},{...request,operator:'has space'},{...request,suppressedAt:'yesterday'}])assert.throws(()=>suppressionResetInput(JSON.stringify(bad)));
  const preview=await runSuppressionReset(db,request);assert.equal(preview.preview,true);assert.equal((await row('SELECT count(*) n FROM contact_notification_suppressions WHERE user_id=?',a.id)).n,1,'Preview changes nothing');
  await assert.rejects(runSuppressionReset(db,request,'0'.repeat(64)),/Preview this exact request/);await assert.rejects(runSuppressionReset(db,{...request,suppressedAt:'2001-01-01T00:00:00.000Z'}),/changed/);
  const applied=await runSuppressionReset(db,request,preview.applyDigest);assert.equal(applied.applied,true);assert.equal(applied.suppression,null);assert.deepEqual(applied.destinations,[]);assert.equal(applied.resets.length,1);
  assert.equal((await runSuppressionReset(db,request,preview.applyDigest)).replayed,true);await assert.rejects(runSuppressionReset(db,{...request,reason:'Different'}),/different request/);
  await assert.rejects(()=>run("UPDATE contact_notification_suppression_resets SET reason='x' WHERE id=?",request.id),/reset_final/);
  await assert.rejects(()=>run("INSERT INTO contact_notification_suppression_resets(id,user_id,address,suppression_reason,suppressed_at,operator_ref,reason,request_digest) VALUES(?,?,'nobody@example.com','bounce',?,'human:x','r',?)",crypto.randomUUID(),a.id,now(),'a'.repeat(64)),/reset_stale/,'A reset must name an existing suppression');
  // The owner must set and verify the address again; nothing resumes by itself.
  assert.equal((await N.contactNotificationStatus(db,a.id,a.project)).destination,null);assert.equal((await N.proposeContactDestination(db,a.id,a.project,'reset-me@example.com')).state,'unverified');
  // Without a reset the suppression is still permanent, and inside a hold the reset is refused.
  const h=await account(),fh=provider();await verified(h,'held-reset@example.com',fh);const hs=await row("SELECT id FROM notification_notices WHERE project_id=? AND template='owner.destination-verification@1'",h.project);await N.applyContactDeliveryEvent(db,{outboxId:hs.id,type:'bounce'});
  await assert.rejects(()=>run('DELETE FROM contact_notification_suppressions WHERE user_id=?',h.id),/suppression_final/);
  await run("INSERT INTO safety_cases(id,subject_user_id,intake_ref,opened_by,opened_at,retention_due_at) VALUES('case-wh036-reset',?,'intake-3','human:reviewer',unixepoch(),unixepoch()+31536000)",h.id);
  await run("INSERT INTO safety_preservation_holds(id,case_id,subject_user_id,scope,project_id,legal_basis_ref,approved_by,placed_at,review_due_at) VALUES('hold-wh036-reset','case-wh036-reset',?,'project',?,'basis-3','human:approver',unixepoch(),unixepoch()+86400)",h.id,h.project);
  const hstatus=await runSuppressionReset(db,{action:'status',account:h.id,address:'held-reset@example.com'});assert.equal(hstatus.destinations[0].held,true);
  await assert.rejects(runSuppressionReset(db,{...request,id:crypto.randomUUID(),account:h.id,address:'held-reset@example.com',suppressedAt:hstatus.suppression.suppressedAt}),/safety preservation hold/);
  await assert.rejects(()=>run("INSERT INTO contact_notification_suppression_resets(id,user_id,address,suppression_reason,suppressed_at,operator_ref,reason,request_digest) VALUES(?,?,'held-reset@example.com','bounce',?,'human:x','r',?)",crypto.randomUUID(),h.id,hstatus.suppression.suppressedAt,'b'.repeat(64)),/safety_preservation_hold/,'The database refuses it too');
 });
 await test('spending ceiling: counted before each call, refused past the 32-day window, never raised mid-day',async()=>{
  await run("UPDATE notification_notices SET state='cancelled',reason='expired',outcome_at=1 WHERE state IN ('queued','deferred')");
  const F=Date.parse('2031-03-10T12:00:00.000Z'),tight={...settings,sendCeiling:2},owners=[];
  for(let i=0;i<3;i++){const a=await account();await enable(a);await N.proposeContactDestination(db,a.id,a.project,`ceiling-${i}@example.com`);await N.requestContactVerification(db,tight,a.id,a.project,new Date(F));owners.push(a);}
  const fake=provider();let r=await N.runContactDelivery(db,tight,fake.send,{now:new Date(F),limit:25});
  assert.equal(r.accepted,2);assert.equal(r.refused,1);assert.equal(fake.calls.length,2,'The third call is refused before reaching the provider');
  assert.equal((await row("SELECT count(*) n FROM notification_notices WHERE state='cancelled' AND reason='ceiling'")).n,1);assert.equal(await N.contactSendsInWindow(db,new Date(F)),2);
  // Still inside the window a later day is refused; a lower ceiling applies immediately and a higher one cannot be written into today's row.
  const late=owners.find(o=>true);await N.requestContactVerification(db,tight,late.id,late.project,new Date(F+20*86400000));
  r=await N.runContactDelivery(db,tight,fake.send,{now:new Date(F+20*86400000)});assert.equal(r.refused,1);assert.equal(fake.calls.length,2);
  await assert.rejects(()=>run("UPDATE notification_send_ledger SET ceiling=ceiling+1 WHERE day='2031-03-10'"),/notification_send_final/);await assert.rejects(()=>run("UPDATE notification_send_ledger SET sends=0 WHERE day='2031-03-10'"),/notification_send_final/);
  await assert.rejects(()=>run("UPDATE notification_send_ledger SET sends=sends+1 WHERE day='2031-03-10'"),/notification_send_ceiling/,'The database refuses a direct increment past the ceiling');
  // After 32 days the window has moved on.
  const after=F+33*86400000;await N.requestContactVerification(db,tight,late.id,late.project,new Date(after));
  r=await N.runContactDelivery(db,tight,fake.send,{now:new Date(after)});assert.equal(r.accepted,1);assert.equal(fake.calls.length,3);
 });
 assert.equal(network,0,'No network call was made');
 console.log(`Contact notification checks passed (${cases} groups): provider gating, Cloudflare Email Service adapter and scheduled drain, exact Chat review, operator suppression reset, spending ceiling, verification through the provider, content-free notices, at-most-once timeout handling, bounded retries, bounce/complaint/unsubscribe suppression, irreversible terminal states, caps, containment and hold-aware retention.`);
}finally{globalThis.fetch=originalFetch;await store.close();}
