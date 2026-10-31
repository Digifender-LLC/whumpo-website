import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {authenticator} from './app-authenticator.mjs';
import {currentSiteFixtureHandlers,createFixtureProject,configureFixtureModules} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
Error.stackTraceLimit=0;
// WH-158 customer notification configuration for the standard appointment presets (schema batch 5), over the complete current schema on
// disposable SQLite, or local D1 with --d1, with two owners/projects and a SIMULATED provider. Exact owner review, stale review, owner/staff/receipt
// queueing from real form submissions through the visitor gateway, the unset monthly spending limit (nothing is sent), revocation and
// configuration change at send time, tenant isolation and the absence of any inference path. No network, no provider, no mail.
const m=await currentSiteFixtureHandlers(),fixture=await databaseFixture({d1:process.argv.includes('--d1')}),{db}=fixture,id=()=>crypto.randomUUID();
const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('No network or inference is available');};
const row=(q,...p)=>db.prepare(q).bind(...p).first(),rows=async(q,...p)=>(await db.prepare(q).bind(...p).all()).results,run=(q,...p)=>db.prepare(q).bind(...p).run();
let cases=0,forged_n=0;const check=async(name,fn)=>{try{if(process.env.WH_TRACE)console.error(Date.now(),'START',name.slice(0,50));await fn();cases++;}catch(error){console.error('FAILED:',name);throw error;}};
const {appAuth:auth,appGateway}=m,C=m.notificationConfigurations,Contact=m.contactNotifications;
const pins=kind=>{const e=m.moduleCatalog.find(x=>x.kind===kind);return {module:{...e.module},schema:{...e.schema}};};
const env={DB:db,ENVIRONMENT:'test',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})}};
const accessInstance={id:'members',kind:'access',...pins('access'),dependencies:[],config:{roles:['staff'],enrollment:'invitation'}};
const fields=[{key:'name',label:'Name',type:'text',optional:false,read:'owner'},
 {key:'service',label:'Service',type:'choice',options:[{value:'repair',label:'Repair'},{value:'visit',label:'Visit'}],optional:false,read:'submitter'},
 {key:'day',label:'Day',type:'choice',options:[{value:'monday',label:'Monday'},{value:'tuesday',label:'Tuesday'}],optional:false,read:'submitter'}];
const recordsInstance=(schemaFields=fields)=>({id:'requests',kind:'records',...pins('records'),dependencies:['members'],config:{retentionDays:30,
 schemas:[{id:'request',fieldsRevision:1,fields:schemaFields,staffWrite:[]}],
 forms:[{id:'appointment',recordId:'request',submit:'visitor',uploadCollectionId:null},{id:'walk-in',recordId:'request',submit:'public',uploadCollectionId:null}],
 views:[{id:'mine',recordId:'request',audience:'visitor',scope:'own',fields:['service'],limit:2}]}});
const PRIVATE='VISITOR-PRIVATE-NAME';
async function owner({grants=true}={}){
 const actor=await workspaceFixture(db,m),scope=await actor.scope(),user=actor.account;
 const site=await createFixtureProject(scope,user,'Salon '+id().slice(0,6),'Appointments');
 if(grants)for(const feature of ['core.editing','core.forms'])for(const operation of ['prepare','confirm','dispatch'])
  await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,?,?,'private-test-acceptance','synthetic WH-158 fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),user,site.project,feature,operation);
 return {...actor,scope,user,...site,host:'https://app-'+site.project+'.whumpo.site',grants:[]};
}
async function visitor(o){
 const invite=await auth.createAppInvitation(o.scope,o.user,o.project),options=await auth.appPasskeyOptions(db,o.project,'signup',false,invite.code),key=authenticator();
 const result=await auth.appPasskeyVerify(db,o.project,'signup',options.challengeToken,key.registration(options.options),false);
 return {...result,cookie:`__Host-whumpo-app-session-${o.project}=${result.session}`};
}
const revision=async o=>(await m.readChat(o.scope,o.user)).state.revision;
async function control(o,action){const turn=id();return {id:turn,...await m.sendChatControl(o.scope,o.user,{id:turn,revision:await revision(o),action})};}
async function typed(o,content){const turn=id();return {id:turn,result:await m.sendChat(o.scope,o.user,{id:turn,revision:await revision(o),content})};}
async function activation(o,instanceId){
 const r=await control(o,{type:'moduleActivationReview',projectId:o.project,instanceId,action:'activate'});assert.equal(r.status,200,r.error);
 const saved=await row('SELECT * FROM module_activation_reviews WHERE id=?',r.id);
 const a=await control(o,{type:'moduleActivationApply',reviewId:saved.id,reviewDigest:saved.review_digest,expectedRevision:saved.expected_activation_revision});assert.equal(a.status,200,a.error);
}
async function setup(o){
 await configureFixtureModules(o.scope,o.user,o.project,[accessInstance,recordsInstance()]);await activation(o,'members');await activation(o,'requests');
 return row('SELECT i.* FROM module_instances i WHERE i.project_id=? AND i.local_id=?',o.project,'requests');
}
async function gateway(o,payload,v){
 const response=await appGateway.applicationGateway(new Request(o.host+'/modules',{method:'POST',headers:{'cf-connecting-ip':'192.0.2.9','content-type':'application/json',origin:o.host,cookie:v.cookie},body:JSON.stringify(payload)}),env);
 return {status:response.status,body:await response.json()};
}
// Events are whole seconds, ordered by (second, id) behind a cursor. The suite's clock runs ahead (`soon`), so each submission takes a second of its own, as real time would.
let lastSecond=0;
const submit=async(o,records,v,{consent=false,service='repair',day='monday',form='appointment'}={})=>{
 while(Math.floor(Date.now()/1000)<=lastSecond)await new Promise(r=>setTimeout(r,50));lastSecond=Math.floor(Date.now()/1000);
 const r=await gateway(o,{api:'whumpo-modules',version:1,operation:'forms.submit',resourceId:records.id,configRevision:records.config_revision,requestId:id(),target:{formId:form},input:{values:{name:PRIVATE,service,day},...(consent?{receiptConsent:true}:{})}},v);
 assert.equal(r.status,200,JSON.stringify(r.body));return r.body.result.entryId;
};
const verifyOwnerAddress=async(o,address)=>{
 const d=id();await run("INSERT INTO contact_notification_destinations(id,user_id,project_id,address,created_at) VALUES(?,?,?,?,'2026-10-30')",d,o.user,o.project,address);
 await run("UPDATE contact_notification_destinations SET state='verified',verified_at='2026-10-30' WHERE id=?",d);return d;
};
const verifyVisitor=async(v,address)=>{
 await run('INSERT INTO visitor_notification_addresses(visitor_id,address) VALUES(?,?)',v.visitorId,address);
 await run('UPDATE visitor_notification_addresses SET code_hash=?,code_expires_at=unixepoch()+600 WHERE visitor_id=?','a'.repeat(64),v.visitorId);
 await run('UPDATE visitor_notification_addresses SET verified_at=unixepoch(),code_hash=NULL,code_expires_at=NULL WHERE visitor_id=?',v.visitorId);
};
const grantStaff=async(o,v,access)=>{
 const r=await control(o,{type:'accessRoleReview',projectId:o.project,instanceId:'members',visitorId:v.visitorId,action:'grant'});assert.equal(r.status,200,r.error);
 const saved=await row('SELECT * FROM module_access_role_reviews WHERE id=?',r.id);
 const a=await control(o,{type:'accessRoleApply',reviewId:saved.id,reviewDigest:saved.review_digest,expectedRevision:saved.expected_access_revision});assert.equal(a.status,200,a.error);
 await run('INSERT INTO staff_notification_optins(instance_id,visitor_id,opted_in_at) VALUES(?,?,unixepoch())',access.id,v.visitorId);
};
const reviewControl=(o,notices,name='Garden Salon',form='appointment')=>control(o,{type:'notificationSetupReview',projectId:o.project,instanceId:'requests',formId:form,notices,businessName:name});
async function configure(o,notices,name){
 const r=await reviewControl(o,notices,name);assert.equal(r.status,200,r.error);
 const c=await control(o,{type:'confirm',kind:'notificationConfiguration',reviewId:r.id});assert.equal(c.status,200,c.error);return r.id;
}
function provider(){
 const p={calls:[]};
 p.send=async notice=>{p.calls.push(notice);return {accepted:true,providerRef:'ref-'+p.calls.length};};
 return p;
}
const settings=cents=>({provider:'cloudflare-email',review:'r',sendCeiling:1000,...(cents===undefined?{}:{customerCeilingCents:cents})});
// The lane leases a few attempts per pass, so a test drains it with repeated passes.
// Accepted events are queued once their second has settled (two seconds), so the suite lets the clock run ahead instead of sleeping.
const soon=()=>Date.now()+4000;
async function pass(p,cents,at){let total={cancelled:0,accepted:0};for(let i=0;i<30;i++){const t=await Contact.runContactDelivery(db,settings(cents),p.send,{now:at??new Date(soon()),timeoutMs:200});total={cancelled:total.cancelled+t.cancelled,accepted:total.accepted+t.accepted};if(t.cancelled+t.accepted+t.refused+t.failed+t.retried===0)break;}return total;}
const notices=project=>rows("SELECT n.*,j.state AS job_state FROM notification_notices n LEFT JOIN job_journal j ON j.id=n.job_id WHERE n.project_id=? AND n.template LIKE 'appointment.%' ORDER BY n.created_at,n.id",project);
const sourceOf=f=>readFileSync(new URL('../'+f,import.meta.url),'utf8');

try{
 const a=await owner(),b=await owner();
 const records=await setup(a),theirs=await setup(b);
 const access=await row("SELECT * FROM module_instances WHERE project_id=? AND local_id='members'",a.project);
 const v1=await visitor(a),v2=await visitor(a),staff=await visitor(a),bv=await visitor(b);
 await verifyVisitor(v1,'receipt-one@example.com');await verifyVisitor(v2,'receipt-two@example.com');await verifyVisitor(staff,'staff@example.com');await grantStaff(a,staff,access);
 await verifyOwnerAddress(a,'owner-a@example.com');await verifyOwnerAddress(b,'owner-b@example.com');await verifyVisitor(bv,'receipt-b@example.com');
 const beforeEntry=await submit(a,records,v1,{consent:true});
 await new Promise(r=>setTimeout(r,1100)); // a configuration takes effect from its own second
 
 await check('an exact review binds the notices, price and business name; preparing changes nothing and provisions nothing',async()=>{
  const ledger0=(await row('SELECT count(*) n FROM notification_send_ledger')).n,jobs0=(await row('SELECT count(*) n FROM job_journal')).n,dest0=(await row('SELECT count(*) n FROM contact_notification_destinations')).n;
  const r=await reviewControl(a,['owner','receipt','staff'],'Garden Salon');assert.equal(r.status,200,r.error);
  const turn=(await m.readChat(a.scope,a.user)).turns.find(t=>t.id===r.id);
  assert.match(turn.assistant_text,/Business name in the emails: Garden Salon/);
  const siteName=(await row('SELECT name FROM projects WHERE id=?',a.project)).name;assert.ok(turn.assistant_text.includes('on the website “'+siteName+'”'),'The review names the site as well as the form');assert.match(turn.assistant_text,/\$0\.00035 per email/);assert.match(turn.assistant_text,/Not sending yet/);assert.match(turn.assistant_text,/not a confirmed booking/);
  assert.equal(turn.notification_configuration_confirmation_id,r.id,'The chat turn carries the confirmation id');
  const review=await row('SELECT * FROM notification_configuration_reviews WHERE id=?',r.id);
  assert.equal(review.status,'pending');assert.equal(review.price_micros,350);assert.equal(review.base_revision,0);assert.equal(JSON.parse(review.config_json).length,3);assert.match(review.digest,/^[0-9a-f]{64}$/);
  assert.equal((await row('SELECT count(*) n FROM notification_configurations WHERE project_id=?',a.project)).n,0,'Preparing configures nothing');
  assert.equal((await row('SELECT kind FROM chat_review_receipts WHERE turn_id=?',r.id)).kind,'notificationConfiguration');
  // Provisions nothing: no ledger row, no journal envelope, no destination, no notice.
  assert.deepEqual([(await row('SELECT count(*) n FROM notification_send_ledger')).n,(await row('SELECT count(*) n FROM job_journal')).n,(await row('SELECT count(*) n FROM contact_notification_destinations')).n],[ledger0,jobs0,dest0]);
  const c=await control(a,{type:'confirm',kind:'notificationConfiguration',reviewId:r.id});assert.equal(c.status,200,c.error);
  const saved=await row('SELECT * FROM notification_configurations WHERE project_id=? AND form_id=?',a.project,'appointment');
  assert.deepEqual([saved.revision,saved.owner_notice,saved.staff_notice,saved.receipt,saved.business_name,saved.price_micros,saved.review_id],[1,1,1,1,'Garden Salon',350,r.id]);
  assert.deepEqual([(await row('SELECT count(*) n FROM notification_send_ledger')).n,(await row('SELECT count(*) n FROM job_journal')).n,(await row('SELECT count(*) n FROM contact_notification_destinations')).n],[ledger0,jobs0,dest0],'Confirming provisions nothing either');
  assert.equal((await row('SELECT count(*) n FROM activity_events WHERE id=?','notification-config:'+r.id)).n,1);
  assert.ok(!JSON.stringify(await rows('SELECT summary FROM activity_events WHERE user_id=?',a.user)).includes('Garden Salon'),'Activity is content-free');
  const replay=await control(a,{type:'confirm',kind:'notificationConfiguration',reviewId:r.id});assert.equal(replay.status,200);
  assert.match((await m.readChat(a.scope,a.user)).turns.find(t=>t.id===replay.id).assistant_text,/already applied/);
  assert.equal((await row('SELECT revision FROM notification_configurations WHERE project_id=?',a.project)).revision,1,'A replay changes nothing');
  const same=await reviewControl(a,['owner','receipt','staff'],'Garden Salon');
  assert.match((await m.readChat(a.scope,a.user)).turns.find(t=>t.id===same.id).assistant_text,/already set/);
 });

 await check('the model may prepare but never confirm; only a typed confirm control applies a review',async()=>{
  const ctx=undefined;void ctx;
  const prepared=await typed(a,`/review-notification-setup ${a.project} requests appointment owner Tidy Hair`);assert.equal(prepared.result.status,200);
  const review=await row('SELECT * FROM notification_configuration_reviews WHERE id=?',prepared.id);assert.equal(review.status,'pending');
  // A model proposal is a site action; there is no confirm action, and extra fields are refused.
  for(const action of [{kind:'confirmNotificationSetup',reviewId:review.id},{kind:'notificationSetupReview',projectId:a.project,instanceId:'requests',formId:'appointment',notices:['owner'],businessName:'X',confirm:true},{kind:'notificationSetupReview',projectId:a.project,instanceId:'requests',formId:'appointment',notices:['everyone'],businessName:'X'}])
   await assert.rejects(m.prepareSiteAction(a.scope,a.user,id(),JSON.stringify({reply:'Done',action}),{}));
  // The trigger refuses any confirmer that is not a typed confirm turn for exactly this review, whatever a handler does.
  await assert.rejects(()=>run("UPDATE notification_configuration_reviews SET status='applied',confirmed_by=? WHERE id=?",prepared.id,review.id),/notification_configuration_changed/);
  const other=await control(a,{type:'moduleActivationReview',projectId:a.project,instanceId:'requests',action:'disable'});
  await assert.rejects(()=>run("UPDATE notification_configuration_reviews SET status='applied',confirmed_by=? WHERE id=?",other.id,review.id),/notification_configuration_changed/);
  for(const [mode,action] of [['ai',JSON.stringify({type:'confirm',kind:'notificationConfiguration',reviewId:review.id})],['guided',null],['guided',JSON.stringify({type:'confirm',kind:'notificationConfiguration',reviewId:id()})],['guided',JSON.stringify({type:'confirm',kind:'contactNotification',reviewId:review.id})]]){
   const forged=id();
   try{await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status,action_json) VALUES(?,?,?,'forged','forged',datetime('now'),?,'completed',?)",forged,a.user,200000+(++forged_n),mode,action);}
   catch(error){assert.match(String(error),/chat_action_mode/,'A model turn cannot even carry a control');continue;}
   await assert.rejects(()=>run("UPDATE notification_configuration_reviews SET status='applied',confirmed_by=? WHERE id=?",forged,review.id),/notification_configuration_changed/,'Only a guided typed confirm for this review applies it');
  }
  assert.equal((await row('SELECT status FROM notification_configuration_reviews WHERE id=?',review.id)).status,'pending');
  await control(b,{type:'confirm',kind:'notificationConfiguration',reviewId:review.id});
  assert.equal((await row('SELECT status FROM notification_configuration_reviews WHERE id=?',review.id)).status,'pending','Another owner cannot confirm it');
  assert.equal(m.chatControl({type:'notificationSetupReview',projectId:a.project,instanceId:'requests',formId:'appointment',notices:['owner'],businessName:'Bad <b>',extra:1}),undefined);
  assert.equal(m.chatControl({type:'notificationSetupReview',projectId:a.project,instanceId:'requests',formId:'appointment',notices:['owner'],businessName:'Bad <b>'}),undefined);
  await run("UPDATE notification_configuration_reviews SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?",review.id).catch(()=>{});
 });

 await check('a changed price, template, form or configuration makes the review stale',async()=>{
  const r=await reviewControl(a,['owner'],'Garden Salon');assert.equal(r.status,200,r.error);
  const original=await row('SELECT * FROM notification_configuration_reviews WHERE id=?',r.id);
  const forged=async(patch,label)=>{
   await run('DELETE FROM notification_configuration_reviews WHERE id=?',r.id);
   const v={...original,...patch};
   await run('INSERT INTO notification_configuration_reviews(id,user_id,project_id,instance_id,form_id,owner_notice,staff_notice,receipt,business_name,config_json,price_micros,price_checked_at,base_revision,digest,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    v.id,v.user_id,v.project_id,v.instance_id,v.form_id,v.owner_notice,v.staff_notice,v.receipt,v.business_name,v.config_json,v.price_micros,v.price_checked_at,v.base_revision,v.digest,v.expires_at);
   const c=await control(a,{type:'confirm',kind:'notificationConfiguration',reviewId:r.id});
   const reply=(await m.readChat(a.scope,a.user)).turns.find(t=>t.id===c.id)?.assistant_text??c.error;
   assert.match(reply,/changed since this review|changed or expired/,label);
   assert.equal((await row('SELECT status FROM notification_configuration_reviews WHERE id=?',r.id)).status,'pending',label);
  };
  await forged({price_micros:999},'a different price');
  await forged({config_json:original.config_json.replace(/"digest":"[0-9a-f]{64}"/,'"digest":"'+'0'.repeat(64)+'"')},'a different template digest');
  await forged({business_name:'Another Name'},'a different business name');
  await forged({digest:'1'.repeat(64)},'a different digest');
  // A configuration saved in between makes the base revision stale (trigger and chat mapping).
  const first=await reviewControl(a,['owner'],'Second Name'),second=await reviewControl(a,['owner','staff'],'Third Name');
  const sc=await control(a,{type:'confirm',kind:'notificationConfiguration',reviewId:second.id});assert.equal(sc.status,200,sc.error);
  const stale=await control(a,{type:'confirm',kind:'notificationConfiguration',reviewId:first.id});assert.equal(stale.status,409);
  assert.equal((await row('SELECT business_name,revision FROM notification_configurations WHERE project_id=?',a.project)).business_name,'Third Name');
  assert.equal((await row('SELECT revision FROM notification_configurations WHERE project_id=?',a.project)).revision,2,'One save, one stale refusal');
  await assert.rejects(()=>run("UPDATE notification_configurations SET revision=revision+2 WHERE project_id=?",a.project),/notification_configuration_stale/);
  // Restore the full preset for the delivery cases below.
  await configure(a,['owner','staff','receipt'],'Garden Salon');
 });

 await check('review refusals: anonymous forms get no receipt, unknown forms, bad names, other owners, no plan feature',async()=>{
  assert.match((await reviewControl(a,['receipt'],'Garden Salon','walk-in')).error??'',/sign in/);
  assert.equal((await reviewControl(a,['owner'],'Garden Salon','missing')).status,404);
  assert.equal((await reviewControl(a,['owner'],'visit www.example.com')).status,400);
  for(const bad of ['evil.xyz','Salon.shop','Visit salon.co.uk','10.0.0.1'])assert.equal((await reviewControl(a,['owner'],bad)).status,400,bad+' is domain-shaped text');
  assert.equal((await reviewControl(a,['owner'],'Peluquería Ñandú')).status,200,'Accented names pass on the control path, as on the model path');
  assert.equal((await typed(a,`/review-notification-setup ${a.project} requests appointment owner a@example.com`)).result.status,400);
  const stranger=await control(b,{type:'notificationSetupReview',projectId:a.project,instanceId:'requests',formId:'appointment',notices:['owner'],businessName:'Intruder'});assert.ok(stranger.status===403||stranger.status===404,String(stranger.status));assert.equal((await row('SELECT count(*) n FROM notification_configuration_reviews WHERE id=?',stranger.id)).n,0);
  const c=await owner({grants:false});
  assert.equal((await control(c,{type:'notificationSetupReview',projectId:c.project,instanceId:'requests',formId:'appointment',notices:['owner'],businessName:'No Plan'})).status>=400,true,'Presets are gated on core.forms');
  assert.equal((await row('SELECT count(*) n FROM notification_configuration_reviews WHERE project_id=?',c.project)).n,0);
  await assert.rejects(()=>run("INSERT INTO notification_configurations(instance_id,form_id,project_id,owner_notice,staff_notice,receipt,business_name,config_json,price_micros,price_checked_at,revision,digest,review_id,created_at) VALUES(?,?,?,1,0,0,'X',?,350,'2026-10-08',1,?,?,1)",
   records.id,'platform',a.project,JSON.stringify([{template:{id:'contact.new-message'},sender:'whumpo-notify'}]),'a'.repeat(64),id()),/notification_configuration_platform_template/,'A platform template is refused');
 });

 await check('accepted forms queue notices for the owner, opted-in staff and consenting visitors only; no backfill; duplicates once',async()=>{
  assert.equal((await notices(a.project)).length,0,'The submission made before configuration is not backfilled');
  const e1=await submit(a,records,v1,{consent:true}),e2=await submit(a,records,v2,{consent:false});
  assert.equal(await C.queueConfiguredNotices(db,settings(500),soon()),5,'owner+staff+receipt for the consenting submission, owner+staff for the other');
  assert.equal(await C.queueConfiguredNotices(db,settings(500),soon()),0,'Another pass queues nothing');
  const list=await notices(a.project);
  const key=n=>`${n.template}|${n.scope}`;
  assert.deepEqual(list.map(key).sort(),['appointment.request-receipt@1|submitter','appointment.staff-notice@1|owner-destination','appointment.staff-notice@1|owner-destination','appointment.staff-notice@1|project-staff','appointment.staff-notice@1|project-staff'].sort());
  assert.ok(list.every(n=>n.state==='queued'&&n.job_state!==null),'Each is one queued notice with its journal envelope');
  assert.ok(list.every(n=>n.event_ref.startsWith('form:')&&!JSON.stringify(n).includes(PRIVATE)),'Rows carry ids, never values');
  assert.equal(list.filter(n=>n.scope==='submitter').length,1);assert.equal(list.find(n=>n.scope==='submitter').recipient_ref,v1.visitorId,'A receipt is keyed to the visitor, not the record');
  assert.equal(list.filter(n=>n.event_ref.includes(e2)&&n.scope==='submitter').length,0,'No consent, no receipt');
  assert.equal((await notices(b.project)).length,0,'Another tenant has no configuration and gets nothing');
  assert.notEqual(beforeEntry,e1);
 });

 await check('NOTHING is sent while the owner spending limit is unset: configured notices are cancelled at send time',async()=>{
  const p=provider(),ledger0=(await row('SELECT coalesce(sum(sends),0) n FROM notification_send_ledger')).n;
  const tally=await pass(p,undefined);
  assert.equal(p.calls.length,0,'The provider is never called');
  const list=await notices(a.project);
  assert.ok(list.length>=5&&list.every(n=>n.state==='cancelled'&&n.reason==='ceiling-unset'&&n.job_state==='cancelled'),JSON.stringify(list.map(n=>[n.state,n.reason])));
  assert.equal((await row('SELECT coalesce(sum(sends),0) n FROM notification_send_ledger')).n,ledger0,'Nothing was counted against the ledger');
  assert.ok(tally.cancelled>=5);
  // A zero, negative or malformed value is unset; so is a missing provider.
  for(const bad of [undefined,'','0','-5','12.5','abc',' 500','1e3','1000000'])assert.equal(Contact.contactNotificationConfig({CONTACT_NOTIFICATION_PROVIDER:'cloudflare-email',CONTACT_NOTIFICATION_REVIEW:'r',NOTIFICATION_CUSTOMER_CEILING_CENTS:bad}).settings.customerCeilingCents,undefined,String(bad));
  assert.equal(Contact.contactNotificationConfig({CONTACT_NOTIFICATION_PROVIDER:'cloudflare-email',CONTACT_NOTIFICATION_REVIEW:'r',NOTIFICATION_CUSTOMER_CEILING_CENTS:'500'}).settings.customerCeilingCents,500);
  assert.equal(C.deliveryState(null),'inactive');assert.equal(C.deliveryState({settings:{}}),'spending-limit-unset');assert.equal(C.deliveryState({settings:{customerCeilingCents:500}}),'active');
  // Contact notices keep their own owner-decided ceiling and are unaffected by the unset limit (verified in tests/contact-notifications.mjs).
 });

 await check('with the limit set, owner and staff notices are content-free and receipts carry only reference, service and day',async()=>{
  const e=await submit(a,records,v1,{consent:true,service:'visit',day:'tuesday'});
  assert.equal(await C.queueConfiguredNotices(db,settings(500),soon()),3);
  const p=provider();await pass(p,500);
  const mine=p.calls.filter(c=>c.projectId===a.project);assert.equal(mine.length,3);
  const by=r=>mine.find(c=>c.recipient===r);
  assert.ok(by('owner-a@example.com')&&by('staff@example.com')&&by('receipt-one@example.com'),'Recipients come from current records');
  const text=c=>m.contactEmail.contactEmailMessage(c);
  for(const r of ['owner-a@example.com','staff@example.com']){const t=text(by(r));assert.match(t.subject,/New appointment request for Garden Salon/);assert.match(t.text,/https:\/\/whumpo\.com\/workspace\/records/);assert.match(t.text,/does not include the request details/);assert.ok(!/visit|tuesday|VISITOR/i.test(t.subject+t.text.replace(/appointment|Open the request list/gi,'')),'No submitted value');}
  const receipt=text(by('receipt-one@example.com'));
  assert.match(receipt.text,new RegExp('Reference: '+e.slice(0,8).toUpperCase()));assert.match(receipt.text,/Service: visit/);assert.match(receipt.text,/Preferred day: tuesday/);assert.match(receipt.text,/not a confirmed booking/);assert.ok(!receipt.text.includes(PRIVATE),'The name is never in a receipt');
  assert.ok(mine.every(c=>c.kind==='configured'));
  assert.ok((await notices(a.project)).filter(n=>n.event_ref.includes(e)).every(n=>n.state==='accepted'));
  assert.equal((await row("SELECT coalesce(sum(sends),0) n FROM notification_send_ledger")).n>=3,true);
  // The sender is the platform sender through the real adapter.
  const sent=[],send=m.contactEmail.cloudflareEmailSender({send:async x=>{sent.push(x);return {messageId:'cf-1'};}});
  await send(by('receipt-one@example.com'),settings(500));assert.deepEqual(sent[0].from,{email:'notify@whumpo.com',name:'Whumpo'});assert.equal(sent[0].to,'receipt-one@example.com');
 });

 await check('the owner limit bounds spending: past it a configured notice is cancelled with ceiling',async()=>{
  await submit(a,records,v2,{consent:false});await C.queueConfiguredNotices(db,settings(500),soon());
  // $0.01 buys 28 calls at the catalog price of $0.00035 per email; the 32-day window already holds that many sends.
  await run("UPDATE notification_send_ledger SET sends=sends+28 WHERE day=(SELECT max(day) FROM notification_send_ledger)");
  const p=provider();
  await pass(p,1);
  const left=(await notices(a.project)).filter(n=>n.reason==='ceiling');
  assert.ok(left.length>=1&&p.calls.length===0,'Used up: nothing is sent '+left.length+' '+JSON.stringify(p.calls.map(c=>[c.template,c.recipient]))+JSON.stringify((await notices(a.project)).slice(-4).map(n=>[n.scope,n.state,n.reason])));
  assert.ok(left.every(n=>n.state==='cancelled'));
 });

 await check('eligibility is read again at send time: revoked consent, opt-out, suppression, removed record, switched-off or changed configuration, lost plan, containment',async()=>{
  const v3=await visitor(a);await verifyVisitor(v3,'receipt-three@example.com');
  const vf=await visitor(a);await verifyVisitor(vf,'receipt-fresh@example.com'); // a visitor with a clean 3-an-hour receipt allowance
  const e=await submit(a,records,v3,{consent:true});
  const queue=()=>C.queueConfiguredNotices(db,settings(500),soon());
  await queue();
  const mine=async()=>(await notices(a.project)).filter(n=>n.event_ref.includes(e));
  assert.equal((await mine()).length,3);
  await run("INSERT INTO contact_notification_suppressions(user_id,address,reason,created_at) VALUES(?,'receipt-three@example.com','unsubscribe','2026-10-30')",a.user);
  await run('DELETE FROM staff_notification_optins WHERE visitor_id=?',staff.visitorId);
  const p=provider();await pass(p,500);
  const by=Object.fromEntries((await mine()).map(n=>[n.scope,n]));
  assert.deepEqual([by['owner-destination'].state,by['project-staff'].state,by['project-staff'].reason],['accepted','cancelled','recipient-revoked']);
  assert.deepEqual([by.submitter.state,by.submitter.reason],['cancelled','recipient-revoked'],'A suppressed receipt address is revoked');
  assert.deepEqual(p.calls.map(c=>c.recipient),['owner-a@example.com'],'Only the still-eligible recipient was called');
  // Configuration switched off or revised after queueing.
  await run('INSERT INTO staff_notification_optins(instance_id,visitor_id,opted_in_at) VALUES(?,?,unixepoch())',access.id,staff.visitorId);
  const e2=await submit(a,records,v1,{consent:true});await queue();
  const oldRevision=(await row('SELECT revision FROM notification_configurations WHERE project_id=?',a.project)).revision;
  await configure(a,['owner'],'Garden Salon Two');
  const p2=provider();await pass(p2,500);
  const two=(await notices(a.project)).filter(n=>n.event_ref.includes(e2)&&n.event_ref.endsWith(':r'+oldRevision));
  assert.ok(two.length===3&&two.every(n=>n.state==='cancelled'&&n.reason==='configuration-changed'),JSON.stringify(two.map(n=>[n.state,n.reason])));
  assert.ok(!p2.calls.some(c=>c.idempotencyKey.includes(e2+':r'+oldRevision)),'Nothing queued under the old revision is sent');
  // Back to the full preset; a removed record, a lost plan feature and containment each cancel.
  await configure(a,['owner','staff','receipt'],'Garden Salon');
  const e3=await submit(a,records,vf,{consent:true}),e4=await submit(a,records,v1,{consent:true}),e5=await submit(a,records,v1,{consent:true});await queue();
  await run('DELETE FROM module_records WHERE id=?',e3);
  const p3=provider();
  await pass(p3,500);
  const of=ev=>notices(a.project).then(l=>l.filter(n=>n.event_ref.includes(ev)));
  assert.ok((await of(e3)).length>=1&&(await of(e3)).every(n=>n.state==='cancelled'&&n.reason==='record-removed'),JSON.stringify((await of(e3)).map(n=>[n.state,n.reason])));
  // Plan feature lost: nothing is queued for a new submission, and a queued notice is cancelled at send time.
  await run("UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE user_id=? AND feature_id='core.forms' AND operation='dispatch'",a.user);
  const eLost=await submit(a,records,v1,{consent:true});assert.equal(await queue(),0,'Not admitted: nothing queued');
  assert.equal((await of(eLost)).length,0);
  await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.forms','dispatch','private-test-acceptance','restored',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),a.user,a.project);
  await queue();assert.equal((await row('SELECT cursor_entry e FROM notification_configurations WHERE project_id=?',a.project)).e,eLost,'Admitted again: the held event is handled (its recipients may be at their hourly caps by now)');
  // Contained project: nothing more is sent for it.
  await run("INSERT INTO operator_containments(id,scope,subject_kind,subject_id,allowance,operator_ref,reason,request_digest,expires_at) VALUES(?,'contact','project',?,NULL,'human:test','reason',?,?)",id(),a.project,'f'.repeat(64),new Date(Date.now()+3600000).toISOString());
  const e6=await submit(a,records,vf,{consent:true});await queue();const p4=provider();await pass(p4,500);
  assert.ok((await of(e6)).length>=1&&(await of(e6)).every(n=>n.state==='cancelled'&&n.reason==='contained'),JSON.stringify((await of(e6)).map(n=>[n.state,n.reason])));
  assert.equal(p4.calls.filter(c=>c.projectId===a.project).length,0,JSON.stringify(p4.calls.map(c=>[c.template,c.recipient])));
  void e4;void e5;
 });

 await check('two tenants are isolated: events, recipients and configurations never cross',async()=>{
  const cfg=await configure(b,['owner','receipt'],'Other Salon');void cfg;
  const eb=await submit(b,theirs,bv,{consent:true});
  await C.queueConfiguredNotices(db,settings(500),soon());
  const list=await notices(b.project);
  assert.deepEqual(list.map(n=>n.event_ref.includes(eb)).filter(Boolean).length,list.length);
  assert.ok(list.every(n=>n.user_id===b.user));
  const p=provider();await pass(p,500);
  const calls=p.calls.filter(c=>c.projectId===b.project);
  assert.deepEqual(calls.map(c=>c.recipient).sort(),['owner-b@example.com','receipt-b@example.com']);
  assert.ok(!p.calls.some(c=>c.projectId===a.project&&c.recipient.endsWith('-b@example.com')));
  assert.equal(JSON.stringify(await C.readNotificationSetup(db,a.user,a.project,'active')).includes('Other Salon'),false);
  await assert.rejects(C.readNotificationSetup(db,b.user,a.project,'active'),e=>e.status===404);
  const view=await C.readNotificationSetup(db,a.user,a.project,'spending-limit-unset');
  assert.equal(view.delivery,'spending-limit-unset');assert.deepEqual(view.forms.map(f=>[f.instanceId,f.formId]),[['requests','appointment']]);assert.ok(!JSON.stringify(view).includes('@'),'Counts and switches only');
 });

 await check('the owner dashboard read carries the settings and the sending state on the records route',async()=>{
  const response=await m.worker.fetch(new Request('https://whumpo.com/api/projects/'+a.project+'/module-records',{headers:{cookie:`__Host-whumpo_session=${a.token}`,origin:'https://whumpo.com'}}),{...(fixture.env??{}),...env},{waitUntil(){}});
  assert.equal(response.status,200);const body=await response.json();
  assert.equal(body.notifications.delivery,'inactive','No CONTACT_EMAIL binding in this environment');assert.equal(body.notifications.forms[0].formId,'appointment');assert.ok(Array.isArray(body.items));
  const mine=body.notifications.forms[0];assert.equal(mine.sending,'inactive','Nothing is sending in this environment');assert.ok(mine.counts.notSent>=1&&mine.counts.sent>=1,JSON.stringify(mine.counts));assert.ok(!JSON.stringify(body.notifications).includes('@'));
 });


 await check('D8-D10: nothing is queued while the limit is unset, appointment volume cannot use the contact caps, receipts are capped per visitor, the customer limit keeps a reserve',async()=>{
  const c=await owner(),cr=await setup(c),cv=await visitor(c),cacc=await row("SELECT * FROM module_instances WHERE project_id=? AND local_id='members'",c.project);void cacc;
  const dest=await verifyOwnerAddress(c,'owner-c@example.com');await verifyVisitor(cv,'receipt-c@example.com');
  const r=await reviewControl(c,['owner','receipt'],'Cap Salon');assert.equal((await control(c,{type:'confirm',kind:'notificationConfiguration',reviewId:r.id})).status,200);
  for(let i=0;i<12;i++)await submit(c,cr,cv,{consent:true});
  // D8: with no limit, the queue step writes nothing at all, so no cancelled row can ever count against a cap.
  for(const unset of [undefined,{},{customerCeilingCents:0},{customerCeilingCents:NaN},{customerCeilingCents:-5}])assert.equal(await C.queueConfiguredNotices(db,unset===undefined?null:unset,soon()),0);
  assert.equal((await notices(c.project)).length,0,'No row exists while the limit is unset');
  const contactNotice=n=>m.notificationOutbox.enqueueNotice(db,{userId:c.user,scope:'owner-destination',projectId:c.project,destinationId:dest,template:'contact.new-message@1',eventRef:'message:'+n,now:Date.now()});
  // The same twelve requests with the limit set: owner notices stop at their own 10 an hour, receipts at 3 per visitor.
  await C.queueConfiguredNotices(db,settings(500),soon());
  const list=await notices(c.project);
  assert.equal(list.filter(n=>n.scope==='owner-destination').length,10,'The owner notice bucket holds 10 an hour');
  assert.equal(list.filter(n=>n.scope==='submitter').length,3,'3 receipts an hour per visitor, however many submissions');
  assert.ok(list.filter(n=>n.scope==='submitter').every(n=>n.recipient_ref===cv.visitorId));
  // D9: those ten rows do not count against the contact notice bucket of the same destination, in the guarded insert or in the trigger.
  for(let i=0;i<10;i++)assert.equal((await contactNotice(i)).queued,true,'Contact notice '+i+' is still accepted after the appointment burst');
  assert.equal((await contactNotice(10)).queued,false,'Contact notices keep their own 10 an hour');
  // The send-time gate stands behind the queue: a row queued under a limit that is later removed, or is NaN, is cancelled before any call.
  const p=provider();await pass(p,NaN);assert.equal(p.calls.filter(x=>x.template.startsWith('appointment.')).length,0,'A NaN limit is no limit');
  assert.ok((await notices(c.project)).every(n=>n.state==='cancelled'&&n.reason==='ceiling-unset'),JSON.stringify((await notices(c.project)).map(n=>[n.scope,n.state,n.reason])));
  // D10: the customer limit is clamped to 80% of the platform ledger ceiling; the last fifth is kept for security and contact notices.
  const cv2=await visitor(c);await verifyVisitor(cv2,'receipt-c2@example.com');await submit(c,cr,cv2,{consent:true});await run("UPDATE notification_configurations SET cursor_at=0,cursor_entry='' WHERE project_id=?",c.project);
  const used=(await row("SELECT coalesce(sum(sends),0) n FROM notification_send_ledger")).n;
  await run("UPDATE notification_send_ledger SET sends=sends+? WHERE day=(SELECT max(day) FROM notification_send_ledger)",800-used);
  const q=await C.queueConfiguredNotices(db,settings(100000),soon());assert.ok(q>=1);
  const p2=provider();await pass(p2,100000);const sent=p2.calls.filter(x=>x.template.startsWith('appointment.')).length;
  assert.equal(sent,0,'800 of the 1000 platform calls are used: the owner limit (100000 cents) is clamped to 80%, so the last fifth is kept');
  assert.ok((await notices(c.project)).some(n=>n.reason==='ceiling'),'Past 800 of 1000 a configured notice is cancelled with ceiling');
  assert.ok((await row("SELECT coalesce(sum(sends),0) n FROM notification_send_ledger")).n<=800);
  assert.equal(Contact.contactNotificationConfig({CONTACT_NOTIFICATION_PROVIDER:'cloudflare-email',CONTACT_NOTIFICATION_REVIEW:'r',NOTIFICATION_CUSTOMER_CEILING_CENTS:'100000'}).settings.customerCeilingCents,100000);
 });

 await check('the resolver cursor: pages advance, no event is lost behind recipientless ones, a repeat queues nothing, the event index is used',async()=>{
  const c=await owner(),cr=await setup(c),cv=await visitor(c);await verifyOwnerAddress(c,'owner-d@example.com');
  const r=await reviewControl(c,['owner'],'Cursor Salon');assert.equal((await control(c,{type:'confirm',kind:'notificationConfiguration',reviewId:r.id})).status,200);
  const got=[];for(let i=0;i<5;i++)got.push(await submit(c,cr,cv,{consent:false}));
  const one=()=>C.queueConfiguredNotices(db,settings(500),soon(),2);
  assert.equal(await one(),2);assert.equal(await one(),2);assert.equal(await one(),1);assert.equal(await one(),0,'All five were queued, in pages of two');
  assert.deepEqual((await notices(c.project)).map(n=>n.event_ref.slice(5,41)).sort(),[...got].sort());
  // An event nobody could receive is final: it never blocks the ones after it, and a later recipient is not given the old event.
  await run("DELETE FROM contact_notification_destinations WHERE project_id=?",c.project);
  const lone=await submit(c,cr,cv,{consent:false});assert.equal(await one(),0);
  await verifyOwnerAddress(c,'owner-e@example.com');const next=await submit(c,cr,cv,{consent:false});assert.equal(await one(),1);
  assert.ok((await notices(c.project)).some(n=>n.event_ref.includes(next))&&!(await notices(c.project)).some(n=>n.event_ref.includes(lone)));
  const cursor=await row('SELECT cursor_at,cursor_entry FROM notification_configurations WHERE project_id=?',c.project);assert.equal(cursor.cursor_entry,next>lone?next:next,'The cursor stands on the newest handled event');
  const plan=(await rows("EXPLAIN QUERY PLAN SELECT e.entry_id FROM module_record_events e WHERE e.instance_id=?1 AND e.event='form.accepted' AND e.created_at>=?2 ORDER BY e.created_at,e.entry_id",cr.id,0)).map(x=>x.detail).join(' ');
  assert.match(plan,/module_record_events_resolver/,'The resolver reads events through its index, not a full scan');
  // Not admitted: nothing moves, and the event is picked up once admission returns.
  await run("UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE user_id=? AND feature_id='core.forms' AND operation='dispatch'",c.user);
  const held=await submit(c,cr,cv,{consent:false});assert.equal(await one(),0);
  await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.forms','dispatch','private-test-acceptance','restored',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),c.user,c.project);
  assert.equal(await one(),1);assert.ok((await notices(c.project)).some(n=>n.event_ref.includes(held)));
 });

 await check('the lanes agree on the limit, and a bounce or complaint suppresses the recipient, not the owner',async()=>{
  const env={SUPPORT_NOTIFICATION_PROVIDER:'cloudflare-email',SUPPORT_NOTIFICATION_REVIEW:'r',CONTACT_NOTIFICATION_PROVIDER:'cloudflare-email',CONTACT_NOTIFICATION_REVIEW:'r',CONTACT_EMAIL:{send:async()=>({})}};
  assert.equal(m.supportDelivery.supportDelivery({...env,NOTIFICATION_CUSTOMER_CEILING_CENTS:'500'}).shared.customerCeilingCents,500);
  assert.equal(m.supportDelivery.supportDelivery(env).shared.customerCeilingCents,undefined);
  assert.equal(m.contactEmail.contactDelivery({...env,NOTIFICATION_CUSTOMER_CEILING_CENTS:'500'}).settings.customerCeilingCents,500);
  const ownerAddress='owner-a@example.com',pick=scope=>row("SELECT * FROM notification_notices WHERE project_id=? AND scope=? AND state='accepted' ORDER BY created_at LIMIT 1",a.project,scope);
  const staffNotice=await pick('project-staff'),receiptNotice=await pick('submitter');assert.ok(staffNotice&&receiptNotice);
  const suppressed=async()=>(await rows('SELECT address,reason FROM contact_notification_suppressions WHERE user_id=?',a.user)).map(x=>x.address);
  assert.ok(!(await suppressed()).includes(ownerAddress));
  await m.notificationOutbox.applyNoticeEvent(db,{noticeId:staffNotice.id,type:'bounce',authenticated:true});
  assert.deepEqual((await suppressed()).filter(x=>x==='staff@example.com'||x===ownerAddress),['staff@example.com'],'The staff address is suppressed, not the owner');
  await m.notificationOutbox.applyNoticeEvent(db,{noticeId:receiptNotice.id,type:'complaint',authenticated:true});
  assert.ok((await suppressed()).includes('receipt-one@example.com')&&!(await suppressed()).includes(ownerAddress));
  assert.equal((await row("SELECT state FROM contact_notification_destinations WHERE project_id=?",a.project)).state,'verified','The owner destination is untouched');
 });

 await check('no inference path: the configuration, resolver and send path import no model, maintainer or gateway code; the network was never used',async()=>{
  for(const f of ['src/notification-configurations.ts','src/notification-outbox.ts','src/contact-email.ts']){
   const imports=[...sourceOf(f).matchAll(/from '([^']+)'/g)].map(x=>x[1]);
   assert.deepEqual(imports.filter(i=>/(^|\/)(ai|ai-chat|ai-gateway|chat|site-agent|agent-[a-z-]+|maintainer[a-z-]*|opencode[a-z-]*)$/.test(i)),[],f);
  }
  assert.equal(network,0);
  const catalog=m.notificationConfigurations;assert.ok(catalog.appointmentPresets.every(p=>['appointment.staff-notice@1','appointment.request-receipt@1'].includes(p.template)));
 });
 globalThis.fetch=originalFetch;
 console.log(`Notification configurations passed: ${cases} groups on ${process.argv.includes('--d1')?'local D1':'SQLite'} — exact review and stale review, model prepare without confirm, presets gated on core.forms, owner/staff/receipt queueing, the unset spending limit cancels every configured notice before any provider call, content-free notices, send-time revocation, tenant isolation and no inference path. Simulated provider only; no mail was sent.`);
}finally{globalThis.fetch=originalFetch;}
