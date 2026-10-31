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
const env={DB:db,ENVIRONMENT:'test',NOTIFICATION_CUSTOMER_CEILING_CENTS:'500',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})}};
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
const submit=async(o,records,v,{consent=false,service='repair',day='monday',form='appointment'}={})=>{
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
async function pass(p,cents,at,via=db){let total={cancelled:0,accepted:0};for(let i=0;i<30;i++){const t=await Contact.runContactDelivery(via,settings(cents),p.send,{now:at??new Date(),timeoutMs:200});total={cancelled:total.cancelled+t.cancelled,accepted:total.accepted+t.accepted};if(t.cancelled+t.accepted+t.refused+t.failed+t.retried===0)break;}return total;}
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

 // Finished appointment notices are cleared between groups so each starts with fresh per-recipient caps (open ones stay, the schema refuses to delete them).
 const clear=o=>run("DELETE FROM notification_notices WHERE project_id=? AND template LIKE 'appointment.%' AND state NOT IN ('queued','dispatching')",o.project);
 const forEvent=async(o,e)=>(await notices(o.project)).filter(n=>n.event_ref.includes(e));
 const limit=cents=>{if(cents===undefined)delete env.NOTIFICATION_CUSTOMER_CEILING_CENTS;else env.NOTIFICATION_CUSTOMER_CEILING_CENTS=String(cents);};
 limit(500);

 await check('D12: accepted forms queue notices in the admitting batch for the owner, opted-in staff and consenting visitors only; no backfill; duplicates once',async()=>{
  assert.equal((await notices(a.project)).length,0,'The submission made before configuration queued nothing, and nothing is added later');
  const e1=await submit(a,records,v1,{consent:true}),e2=await submit(a,records,v2,{consent:false});
  const list=await notices(a.project),key=n=>`${n.template}|${n.scope}`;
  assert.deepEqual(list.map(key).sort(),['appointment.request-receipt@1|submitter','appointment.staff-notice@1|owner-destination','appointment.staff-notice@1|owner-destination','appointment.staff-notice@1|project-staff','appointment.staff-notice@1|project-staff'].sort());
  assert.ok(list.every(n=>n.state==='queued'&&n.job_state!==null),'Each is one queued notice with its journal envelope');
  assert.ok(list.every(n=>n.event_ref.startsWith('form:')&&!JSON.stringify(n).includes(PRIVATE)),'Rows carry ids, never values');
  assert.equal(list.filter(n=>n.scope==='submitter').length,1);assert.equal(list.find(n=>n.scope==='submitter').recipient_ref,v1.visitorId,'A receipt is keyed to the visitor, not the record');
  assert.equal((await forEvent(a,e2)).filter(n=>n.scope==='submitter').length,0,'No consent, no receipt');
  assert.equal((await notices(b.project)).length,0,'Another tenant has no configuration and gets nothing');
  // The same admission statements run again (a retry) queue nothing new: one notice per template, event and recipient.
  const again=await C.admissionNotices(db,{customerCeilingCents:500},{instanceId:records.id,projectId:a.project,formId:'appointment',entryId:e1,visitorId:v1.visitorId,consent:true,now:Date.now()});
  assert.ok(again.length>0);await db.batch(again);assert.equal((await notices(a.project)).length,5);
  assert.notEqual(beforeEntry,e1);
 });

 await check('NOTHING is sent while the owner spending limit is unset: nothing is queued for new requests (never emailed later), and anything queued earlier is cancelled at send time',async()=>{
  const p=provider(),ledger0=(await row('SELECT coalesce(sum(sends),0) n FROM notification_send_ledger')).n;
  limit(undefined);
  const quiet=await submit(a,records,v1,{consent:true});
  assert.equal((await forEvent(a,quiet)).length,0,'No limit, no rows');
  limit(500);const later=await submit(a,records,v1,{consent:true});assert.equal((await forEvent(a,quiet)).length,0,'Setting the limit later does not backfill the earlier request');
  assert.ok((await forEvent(a,later)).length>0);
  // Defence in depth: rows that exist (queued while a limit was set) are cancelled before any call when the limit is gone, or is NaN.
  const tally=await pass(p,undefined);
  assert.equal(p.calls.length,0,'The provider is never called');
  const list=await notices(a.project);
  assert.ok(list.length>=5&&list.every(n=>n.state==='cancelled'&&n.reason==='ceiling-unset'&&n.job_state==='cancelled'),JSON.stringify(list.map(n=>[n.state,n.reason])));
  assert.equal((await row('SELECT coalesce(sum(sends),0) n FROM notification_send_ledger')).n,ledger0,'Nothing was counted against the ledger');
  assert.ok(tally.cancelled>=5);
  for(const bad of [undefined,'','0','-5','12.5','abc',' 500','1e3','1000000'])assert.equal(C.customerCeilingFromEnv({NOTIFICATION_CUSTOMER_CEILING_CENTS:bad}),undefined,String(bad));
  assert.equal(C.customerCeilingFromEnv({NOTIFICATION_CUSTOMER_CEILING_CENTS:'500'}),500);
  for(const bad of [undefined,'','0','-5','12.5','abc'])assert.equal(Contact.contactNotificationConfig({CONTACT_NOTIFICATION_PROVIDER:'cloudflare-email',CONTACT_NOTIFICATION_REVIEW:'r',NOTIFICATION_CUSTOMER_CEILING_CENTS:bad}).settings.customerCeilingCents,undefined,String(bad));
  assert.equal(Contact.contactNotificationConfig({CONTACT_NOTIFICATION_PROVIDER:'cloudflare-email',CONTACT_NOTIFICATION_REVIEW:'r',NOTIFICATION_CUSTOMER_CEILING_CENTS:'500'}).settings.customerCeilingCents,500);
  assert.equal(C.deliveryState(null),'inactive');assert.equal(C.deliveryState({settings:{}}),'spending-limit-unset');assert.equal(C.deliveryState({settings:{customerCeilingCents:500}}),'active');
  for(const off of [undefined,null,{},{customerCeilingCents:0},{customerCeilingCents:NaN},{customerCeilingCents:-5}])assert.deepEqual(await C.admissionNotices(db,off,{instanceId:records.id,projectId:a.project,formId:'appointment',entryId:id(),visitorId:v1.visitorId,consent:true,now:Date.now()}),[],'No statements without a limit');
 });

 await check('with the limit set, owner and staff notices are content-free and receipts carry only reference, service and day',async()=>{
  await clear(a);
  const e=await submit(a,records,v1,{consent:true,service:'visit',day:'tuesday'});
  assert.equal((await forEvent(a,e)).length,3);
  const p=provider();await pass(p,500);
  const mine=p.calls.filter(c=>c.projectId===a.project&&c.idempotencyKey.includes(e));assert.equal(mine.length,3);
  const by=r=>mine.find(c=>c.recipient===r);
  assert.ok(by('owner-a@example.com')&&by('staff@example.com')&&by('receipt-one@example.com'),'Recipients come from current records');
  const text=c=>m.contactEmail.contactEmailMessage(c);
  for(const r of ['owner-a@example.com','staff@example.com']){const t=text(by(r));assert.match(t.subject,/New appointment request for Garden Salon/);assert.match(t.text,/https:\/\/whumpo\.com\/workspace\/records/);assert.match(t.text,/does not include the request details/);assert.ok(!/visit|tuesday|VISITOR/i.test(t.subject+t.text.replace(/appointment|Open the request list/gi,'')),'No submitted value');}
  const receipt=text(by('receipt-one@example.com'));
  assert.match(receipt.text,new RegExp('Reference: '+e.slice(0,8).toUpperCase()));assert.match(receipt.text,/Service: visit/);assert.match(receipt.text,/Preferred day: tuesday/);assert.match(receipt.text,/not a confirmed booking/);assert.ok(!receipt.text.includes(PRIVATE),'The name is never in a receipt');
  assert.ok(mine.every(c=>c.kind==='configured'));
  assert.ok((await forEvent(a,e)).every(n=>n.state==='accepted'&&n.sent_to!==null),'The exact address of each attempt is recorded');
  assert.equal((await row("SELECT coalesce(sum(sends),0) n FROM notification_send_ledger")).n>=3,true);
  const sent=[],send=m.contactEmail.cloudflareEmailSender({send:async x=>{sent.push(x);return {messageId:'cf-1'};}});
  await send(by('receipt-one@example.com'),settings(500));assert.deepEqual(sent[0].from,{email:'notify@whumpo.com',name:'Whumpo'});assert.equal(sent[0].to,'receipt-one@example.com');
 });

 await check('the owner limit bounds spending: past it a configured notice is cancelled with ceiling',async()=>{
  await clear(a);
  const e=await submit(a,records,v2,{consent:false});
  await run("UPDATE notification_send_ledger SET sends=sends+28 WHERE day=(SELECT max(day) FROM notification_send_ledger)"); // $0.01 buys 28 calls at the catalog price
  const p=provider();await pass(p,1);
  const left=await forEvent(a,e);
  assert.ok(left.length>=1&&p.calls.filter(c=>c.idempotencyKey.includes(e)).length===0&&left.every(n=>n.state==='cancelled'&&n.reason==='ceiling'),'Used up: nothing is sent '+JSON.stringify(left.map(n=>[n.state,n.reason])));
 });

 await check('eligibility is read again at send time: suppression, opt-out, switched-off or changed configuration, removed record, lost plan, containment',async()=>{
  await clear(a);
  const v3=await visitor(a);await verifyVisitor(v3,'receipt-three@example.com');
  const vf=await visitor(a);await verifyVisitor(vf,'receipt-fresh@example.com');
  const e=await submit(a,records,v3,{consent:true});
  await run("INSERT INTO contact_notification_suppressions(user_id,address,reason,created_at) VALUES(?,'receipt-three@example.com','unsubscribe','2026-10-30')",a.user);
  await run('DELETE FROM staff_notification_optins WHERE visitor_id=?',staff.visitorId);
  const p=provider();await pass(p,500);
  const by=Object.fromEntries((await forEvent(a,e)).map(n=>[n.scope,n]));
  assert.deepEqual([by['owner-destination'].state,by['project-staff'].state,by['project-staff'].reason],['accepted','cancelled','recipient-revoked']);
  assert.deepEqual([by.submitter.state,by.submitter.reason],['cancelled','recipient-revoked'],'A suppressed receipt address is revoked');
  assert.deepEqual(p.calls.filter(c=>c.idempotencyKey.includes(e)).map(c=>c.recipient),['owner-a@example.com'],'Only the still-eligible recipient was called');
  await run('INSERT INTO staff_notification_optins(instance_id,visitor_id,opted_in_at) VALUES(?,?,unixepoch())',access.id,staff.visitorId);
  // Configuration revised after queueing: nothing queued under the old revision is sent.
  await clear(a);const e2=await submit(a,records,vf,{consent:true});const oldRevision=(await row('SELECT revision FROM notification_configurations WHERE project_id=?',a.project)).revision;
  await configure(a,['owner'],'Garden Salon Two');
  const p2=provider();await pass(p2,500);
  const two=(await forEvent(a,e2)).filter(n=>n.event_ref.endsWith(':r'+oldRevision));
  assert.ok(two.length===3&&two.every(n=>n.state==='cancelled'&&n.reason==='configuration-changed'),JSON.stringify(two.map(n=>[n.state,n.reason])));
  assert.ok(!p2.calls.some(c=>c.idempotencyKey.includes(e2+':r'+oldRevision)));
  // The reviewed switches decide what is queued: owner only now, so a new request queues the owner notice alone.
  await clear(a);const e2b=await submit(a,records,vf,{consent:true});assert.deepEqual((await forEvent(a,e2b)).map(n=>n.scope),['owner-destination']);
  await pass(provider(),500);await configure(a,['owner','staff','receipt'],'Garden Salon');
  // Removed record, lost plan feature, containment.
  await clear(a);
  const e3=await submit(a,records,vf,{consent:true});assert.equal((await forEvent(a,e3)).length,3);
  await run('DELETE FROM module_records WHERE id=?',e3);
  const e4=await submit(a,records,v3,{consent:false}),grants=(await rows("SELECT id FROM feature_preview_grants WHERE user_id=? AND feature_id='core.forms' AND operation='dispatch' AND revoked_at IS NULL",a.user)).map(g=>g.id);
  for(const g of grants)await run('UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE id=?',g);
  const e5=await submit(a,records,v1,{consent:true});assert.equal((await forEvent(a,e5)).length,0,'Not admitted: nothing is queued at admission');
  const p3=provider();await pass(p3,500);
  assert.ok((await forEvent(a,e3)).length===3&&(await forEvent(a,e3)).every(n=>n.state==='cancelled'&&n.reason==='record-removed'));
  assert.ok((await forEvent(a,e4)).length>=1&&(await forEvent(a,e4)).every(n=>n.state==='cancelled'&&n.reason==='configuration-changed'),'The plan feature is rechecked at send time');
  await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.forms','dispatch','private-test-acceptance','restored',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),a.user,a.project);
 });

 await check('two tenants are isolated: events, recipients and configurations never cross',async()=>{
  await configure(b,['owner','receipt'],'Other Salon');
  const eb=await submit(b,theirs,bv,{consent:true});
  const list=await notices(b.project);
  assert.ok(list.length===2&&list.every(n=>n.event_ref.includes(eb)&&n.user_id===b.user),JSON.stringify(list.map(n=>n.scope)));
  const p=provider();await pass(p,500);
  assert.deepEqual(p.calls.filter(c=>c.projectId===b.project).map(c=>c.recipient).sort(),['owner-b@example.com','receipt-b@example.com']);
  assert.ok(!p.calls.some(c=>c.projectId===a.project&&c.recipient.endsWith('-b@example.com')));
  // Containment of the contact scope stops notices for that project only; the other tenant keeps sending.
  await run("INSERT INTO operator_containments(id,scope,subject_kind,subject_id,allowance,operator_ref,reason,request_digest,expires_at) VALUES(?,'contact','project',?,NULL,'human:test','reason',?,?)",id(),b.project,'f'.repeat(64),new Date(Date.now()+3600000).toISOString());
  await clear(b);const ec=await submit(b,theirs,bv,{consent:true});const pc=provider();await pass(pc,500);
  assert.ok((await forEvent(b,ec)).length>=1&&(await forEvent(b,ec)).every(n=>n.state==='cancelled'&&n.reason==='contained'),JSON.stringify((await forEvent(b,ec)).map(n=>[n.state,n.reason])));
  assert.equal(pc.calls.filter(c=>c.projectId===b.project).length,0);
  assert.equal(JSON.stringify(await C.readNotificationSetup(db,a.user,a.project,'active')).includes('Other Salon'),false);
  await assert.rejects(C.readNotificationSetup(db,b.user,a.project,'active'),e=>e.status===404);
  const view=await C.readNotificationSetup(db,a.user,a.project,'spending-limit-unset');
  assert.equal(view.delivery,'spending-limit-unset');assert.deepEqual(view.forms.map(f=>[f.instanceId,f.formId]),[['requests','appointment']]);assert.ok(!JSON.stringify(view).includes('@'),'Counts and switches only');
 });

 await check('the owner dashboard read carries the settings, per-form counts and the sending state on the records route',async()=>{
  const response=await m.worker.fetch(new Request('https://whumpo.com/api/projects/'+a.project+'/module-records',{headers:{cookie:`__Host-whumpo_session=${a.token}`,origin:'https://whumpo.com'}}),{...(fixture.env??{}),...env},{waitUntil(){}});
  assert.equal(response.status,200);const body=await response.json();
  assert.equal(body.notifications.delivery,'inactive','No CONTACT_EMAIL binding in this environment');assert.ok(Array.isArray(body.items));
  const mine=body.notifications.forms[0];assert.equal(mine.formId,'appointment');assert.equal(mine.sending,'inactive');assert.ok(mine.counts.notSent>=1,JSON.stringify(mine.counts));assert.ok(!JSON.stringify(body.notifications).includes('@'));
 });

 await check('truthful sending state: on only when someone can be reached; off, plan, no-recipient and the delivery states are named',async()=>{
  const c=await owner(),cr=await setup(c),cv=await visitor(c);
  const state=async delivery=>(await C.readNotificationSetup(db,c.user,c.project,delivery)).forms[0].sending;
  const conf=async(notices)=>{const r=await reviewControl(c,notices,'State Salon');assert.equal(r.status,200,r.error);assert.equal((await control(c,{type:'confirm',kind:'notificationConfiguration',reviewId:r.id})).status,200);};
  await conf(['owner']);assert.equal(await state('active'),'no-recipient','Owner notice on, no verified address');
  const dest=await verifyOwnerAddress(c,'owner-state@example.com');assert.equal(await state('active'),'active');
  assert.equal(await state('inactive'),'inactive');assert.equal(await state('spending-limit-unset'),'spending-limit-unset');
  await run('DELETE FROM contact_notification_destinations WHERE id=?',dest);
  await conf(['staff']);assert.equal(await state('active'),'no-recipient','Staff notice on, nobody opted in');
  await conf(['receipt']);assert.equal(await state('active'),'no-recipient','Receipt on, no visitor can be reached');
  await verifyVisitor(cv,'visitor-state@example.com');assert.equal(await state('active'),'active','A verified visitor address makes receipts reachable');
  const sup=await visitor(c);await verifyVisitor(sup,'visitor-suppressed@example.com');
  await run("INSERT INTO contact_notification_suppressions(user_id,address,reason,created_at) VALUES(?,'visitor-suppressed@example.com','bounce','2026-10-30')",c.user);assert.equal(await state('active'),'active','The first visitor can still be reached');
  await run('UPDATE app_visitors SET revoked=1 WHERE id=?',cv.visitorId);assert.equal(await state('active'),'no-recipient','A revoked visitor and a suppressed one cannot be reached');
  const vv=await visitor(c);await verifyVisitor(vv,'visitor-ok@example.com');assert.equal(await state('active'),'active','A new verified visitor makes receipts reachable again');
  await run("INSERT INTO operator_containments(id,scope,subject_kind,subject_id,allowance,operator_ref,reason,request_digest,expires_at) VALUES(?,'contact','project',?,NULL,'human:test','reason',?,?)",id(),c.project,'e'.repeat(64),new Date(Date.now()+3600000).toISOString());
  assert.equal(await state('active'),'contained','A contained project is not sending');
  const kept=await row('SELECT config_json FROM module_instances WHERE id=?',cr.id);
  await run("UPDATE module_instances SET config_json=json_set(config_json,'$.forms','[]') WHERE id=?",cr.id);
  assert.equal((await C.readNotificationSetup(db,c.user,c.project,'active')).forms.length,0,'A form removed from the configuration shows no stale status');
  await run('UPDATE module_instances SET config_json=? WHERE id=?',kept.config_json,cr.id);
  await conf([]);assert.equal(await state('active'),'off','Off is named before the pause');
  await run("DELETE FROM operator_containments WHERE subject_id=?",c.project).catch(()=>{});
  await conf(['owner']);for(const g of (await rows("SELECT id FROM feature_preview_grants WHERE user_id=? AND feature_id='core.forms'",c.user)))await run('UPDATE feature_preview_grants SET revoked_at=unixepoch() WHERE id=?',g.id);
  assert.equal(await state('active'),'plan');
 });

 await check('a bounce or complaint suppresses exactly the address the notice was sent to, never the owner login email; the lanes agree on the limit',async()=>{
  const env2={SUPPORT_NOTIFICATION_PROVIDER:'cloudflare-email',SUPPORT_NOTIFICATION_REVIEW:'r',CONTACT_NOTIFICATION_PROVIDER:'cloudflare-email',CONTACT_NOTIFICATION_REVIEW:'r',CONTACT_EMAIL:{send:async()=>({})}};
  assert.equal(m.supportDelivery.supportDelivery({...env2,NOTIFICATION_CUSTOMER_CEILING_CENTS:'500'}).shared.customerCeilingCents,500);
  assert.equal(m.supportDelivery.supportDelivery(env2).shared.customerCeilingCents,undefined);
  assert.equal(m.contactEmail.contactDelivery({...env2,NOTIFICATION_CUSTOMER_CEILING_CENTS:'500'}).settings.customerCeilingCents,500);
  await clear(a);limit(500);
  const e=await submit(a,records,v1,{consent:true}),e2=await submit(a,records,v1,{consent:true});await pass(provider(),500);
  const pick=(scope,ev)=>row("SELECT * FROM notification_notices WHERE project_id=? AND scope=? AND state='accepted' AND event_ref LIKE ?",a.project,scope,'%'+ev+'%');
  const ownerLogin=(await row('SELECT lower(email) e FROM users WHERE id=?',a.user)).e;
  const suppressed=async()=>(await rows('SELECT address FROM contact_notification_suppressions WHERE user_id=?',a.user)).map(x=>x.address);
  const staffNotice=await pick('project-staff',e),receiptNotice=await pick('submitter',e),secondReceipt=await pick('submitter',e2);assert.ok(staffNotice&&receiptNotice&&secondReceipt,JSON.stringify((await notices(a.project)).map(n=>[n.scope,n.state,n.reason])));
  const ownerNotice=await pick('owner-destination',e);assert.ok(ownerNotice);
  assert.deepEqual([ownerNotice.sent_to,staffNotice.sent_to,receiptNotice.sent_to],['owner-a@example.com','staff@example.com','receipt-one@example.com'],'Each attempt recorded the exact address it went to');
  // The address still belongs to the recipient: a bounce suppresses exactly it, and nothing else (never the owner login email).
  await m.notificationOutbox.applyNoticeEvent(db,{noticeId:ownerNotice.id,type:'bounce',authenticated:true});
  assert.deepEqual((await suppressed()).filter(x=>x==='owner-a@example.com'||x===ownerLogin),['owner-a@example.com']);
  // Erasure: removing the visitor's address, changing it, or deleting the visitor clears the recorded address of that visitor's notices, so nothing personal outlives it.
  await run('DELETE FROM visitor_notification_addresses WHERE visitor_id=?',v1.visitorId);
  assert.equal((await row('SELECT sent_to FROM notification_notices WHERE id=?',receiptNotice.id)).sent_to,null,'Address removal clears the receipt notice');
  assert.equal((await row('SELECT sent_to FROM notification_notices WHERE id=?',secondReceipt.id)).sent_to,null);
  await run("UPDATE visitor_notification_addresses SET address='staff-new@example.com',code_hash=NULL,code_expires_at=NULL,code_failures=0,verified_at=NULL WHERE visitor_id=?",staff.visitorId);
  assert.equal((await row('SELECT sent_to FROM notification_notices WHERE id=?',staffNotice.id)).sent_to,null,'An address change clears the staff notice');
  const vd=await visitor(a);await verifyVisitor(vd,'receipt-erased@example.com');await submit(a,records,vd,{consent:true});await pass(provider(),500);
  const erased=await row("SELECT id,sent_to FROM notification_notices WHERE recipient_ref=? AND state='accepted'",vd.visitorId);assert.equal(erased.sent_to,'receipt-erased@example.com');
  await run('DELETE FROM app_visitors WHERE id=?',vd.visitorId);
  assert.equal((await row('SELECT sent_to FROM notification_notices WHERE id=?',erased.id)).sent_to,null,'Deleting the visitor clears it through the cascade');
  assert.equal((await row("SELECT count(*) n FROM notification_notices WHERE sent_to LIKE 'receipt-erased%'")).n,0);
  // An address that is no longer known: a bounce or complaint suppresses nothing, and the owner's login email is never a fallback.
  const before=(await suppressed()).length;
  for(const n of [receiptNotice,staffNotice,erased])await m.notificationOutbox.applyNoticeEvent(db,{noticeId:n.id,type:'complaint',authenticated:true});
  assert.equal((await suppressed()).length,before,'No recorded address, no suppression');assert.ok(!(await suppressed()).includes(ownerLogin)&&!(await suppressed()).includes('receipt-one@example.com')&&!(await suppressed()).includes('staff@example.com'));
  assert.equal((await row("SELECT state FROM contact_notification_destinations WHERE project_id=?",a.project)).state,'suppressed','Only the owner destination whose own address bounced is suppressed');
 });

 await check('the claim serializes with erasure: an address removed, changed or deleted between the read and the claim is never written and nothing is sent; the erasure triggers use the recipient index',async()=>{
  limit(500);
  const race=async(label,act)=>{
   const o=await owner(),rec=await setup(o),v=await visitor(o);await verifyVisitor(v,label+'-private@example.test');await configure(o,['receipt'],'Garden Salon');
   await submit(o,rec,v,{consent:true});
   // The delivery runs through a thin wrapper of the database: statements are tagged with their SQL as they are bound (the SQL is not visible on every database
   // object, e.g. local D1), and the one batch that carries the sent_to claim runs the erasure first, i.e. after the recipient was read and before the claim commits.
   const tag=new WeakMap();let fired=false;
   const via=new Proxy(db,{get:(t,k)=>{
    if(k==='prepare')return sql=>{const st=t.prepare(sql);return new Proxy(st,{get:(x,key)=>key==='bind'?(...a)=>{const b=x.bind(...a);tag.set(b,sql);return b;}:typeof x[key]==='function'?x[key].bind(x):x[key]});};
    if(k==='batch')return async st=>{if(!fired&&st.some(x=>/sent_to=\?7/.test(tag.get(x)??''))){fired=true;await act(v);}return t.batch(st);};
    const f=t[k];return typeof f==='function'?f.bind(t):f;}});
   const p=provider();await pass(p,500,undefined,via);
   assert.ok(fired,label+': the race hook fired');
   assert.equal(p.calls.length,0,label+': no provider call');
   assert.equal((await row("SELECT count(*) n FROM notification_notices WHERE project_id=? AND sent_to IS NOT NULL",o.project)).n,0,label+': sent_to stays null');
   assert.equal((await row("SELECT count(*) n FROM notification_notices WHERE sent_to LIKE ?",label+'-private%')).n,0);
   assert.equal((await row("SELECT count(*) n FROM notification_notices WHERE project_id=? AND state='accepted'",o.project)).n,0);
  };
  await race('remove',v=>run('DELETE FROM visitor_notification_addresses WHERE visitor_id=?',v.visitorId));
  await race('change',v=>run("UPDATE visitor_notification_addresses SET address='new@example.test',code_hash=NULL,code_expires_at=NULL,code_failures=0,verified_at=NULL WHERE visitor_id=?",v.visitorId));
  await race('delete',v=>run('DELETE FROM app_visitors WHERE id=?',v.visitorId));
  const plan=(await rows("EXPLAIN QUERY PLAN UPDATE notification_notices SET sent_to=NULL WHERE recipient_key IN ('project-staff:x','submitter:x') AND sent_to IS NOT NULL")).map(x=>x.detail).join(' ');
  assert.match(plan,/notification_notices_recipient/,'The erasure update uses the recipient_key index, not a scan: '+plan);
  const triggers=(await rows("SELECT sql FROM sqlite_master WHERE type='trigger' AND name IN ('visitor_notification_address_erased','visitor_notification_address_replaced')")).map(x=>x.sql);
  assert.ok(triggers.length===2&&triggers.every(t=>t.includes("recipient_key IN ('project-staff:'||OLD.visitor_id,'submitter:'||OLD.visitor_id)")));
 });

 await check('D8-D10: appointment volume cannot use the contact caps, an over-cap request is still admitted, receipts are capped per visitor, the customer limit keeps a reserve',async()=>{
  const c=await owner(),cr=await setup(c),cv=await visitor(c);
  const dest=await verifyOwnerAddress(c,'owner-c@example.com');await verifyVisitor(cv,'receipt-c@example.com');
  const r=await reviewControl(c,['owner','receipt'],'Cap Salon');assert.equal((await control(c,{type:'confirm',kind:'notificationConfiguration',reviewId:r.id})).status,200);
  const records=()=>row('SELECT count(*) n FROM module_records WHERE project_id=?',c.project).then(x=>x.n);
  // D8 at admission: with no limit the requests are admitted and no row exists, so nothing can count against a cap.
  limit(undefined);for(let i=0;i<4;i++)await submit(c,cr,cv,{consent:true});
  assert.equal((await notices(c.project)).length,0,'No row exists while the limit is unset');
  limit(500);for(let i=0;i<12;i++)await submit(c,cr,cv,{consent:true});
  assert.equal(await records(),16,'Every request was admitted, including the 11th and 12th in the hour');
  const list=await notices(c.project);
  assert.equal(list.filter(n=>n.scope==='owner-destination').length,10,'The owner notice bucket holds 10 an hour; later requests are admitted without a notice');
  assert.equal(list.filter(n=>n.scope==='submitter').length,3,'3 receipts an hour per visitor, however many submissions');
  assert.ok(list.filter(n=>n.scope==='submitter').every(n=>n.recipient_ref===cv.visitorId));
  // D9: those rows do not count against the contact notice bucket of the same destination, in the guarded insert or in the trigger.
  const contactNotice=n=>m.notificationOutbox.enqueueNotice(db,{userId:c.user,scope:'owner-destination',projectId:c.project,destinationId:dest,template:'contact.new-message@1',eventRef:'message:'+n,now:Date.now()});
  for(let i=0;i<10;i++)assert.equal((await contactNotice(i)).queued,true,'Contact notice '+i+' is still accepted after the appointment burst');
  assert.equal((await contactNotice(10)).queued,false,'Contact notices keep their own 10 an hour');
  // The send-time gate stands behind admission: a NaN limit is no limit.
  const p=provider();await pass(p,NaN);assert.equal(p.calls.filter(x=>x.template.startsWith('appointment.')).length,0,'A NaN limit is no limit');
  assert.ok((await notices(c.project)).every(n=>n.state==='cancelled'&&n.reason==='ceiling-unset'),JSON.stringify((await notices(c.project)).map(n=>[n.scope,n.state,n.reason])));
  // D10: the customer limit is clamped to 80% of the platform ledger ceiling; the last fifth is kept for security and contact notices.
  const cv2=await visitor(c);await verifyVisitor(cv2,'receipt-c2@example.com');await submit(c,cr,cv2,{consent:true});
  const used=(await row("SELECT coalesce(sum(sends),0) n FROM notification_send_ledger")).n;
  await run("UPDATE notification_send_ledger SET sends=sends+? WHERE day=(SELECT max(day) FROM notification_send_ledger)",800-used);
  const p2=provider();await pass(p2,100000);
  assert.equal(p2.calls.filter(x=>x.template.startsWith('appointment.')).length,0,'800 of the 1000 platform calls are used: the owner limit (100000 cents) is clamped to 80%, so the last fifth is kept');
  assert.ok((await notices(c.project)).some(n=>n.reason==='ceiling'),'Past 800 of 1000 a configured notice is cancelled with ceiling');
  // Atomic with the record: a batch that fails leaves neither the record nor its notices.
  await clear(c);const before=await records(),noticesBefore=(await notices(c.project)).length;
  await run("CREATE TRIGGER wh158_fail BEFORE INSERT ON module_request_receipts WHEN NEW.project_id='"+c.project+"' BEGIN SELECT RAISE(ABORT,'wh158_injected'); END");
  const cv3=await visitor(c);await verifyVisitor(cv3,'receipt-c3@example.com');
  const failed=await gateway(c,{api:'whumpo-modules',version:1,operation:'forms.submit',resourceId:cr.id,configRevision:cr.config_revision,requestId:id(),target:{formId:'appointment'},input:{values:{name:PRIVATE,service:'repair',day:'monday'},receiptConsent:true}},cv3);
  await run('DROP TRIGGER wh158_fail');
  assert.notEqual(failed.status,200,'The injected failure failed the request');
  assert.equal(await records(),before,'No record was stored');assert.equal((await notices(c.project)).length,noticesBefore,'No notice was queued');
  assert.equal((await row('SELECT count(*) n FROM notification_notices WHERE recipient_ref=?',cv3.visitorId)).n,0);
 });

 await check('a suppressed visitor who ticks the receipt box still submits: the record is admitted and no receipt is queued',async()=>{
  await clear(a);
  const vs=await visitor(a);await verifyVisitor(vs,'receipt-suppressed@example.com');
  await run("INSERT INTO contact_notification_suppressions(user_id,address,reason,created_at) VALUES(?,'receipt-suppressed@example.com','complaint','2026-10-30')",a.user);
  const e=await submit(a,records,vs,{consent:true}); // submit asserts HTTP 200
  assert.ok(await row('SELECT 1 FROM module_records WHERE id=?',e),'The record was admitted');
  const list=await forEvent(a,e);assert.equal(list.filter(n=>n.scope==='submitter').length,0,'No receipt is queued for a suppressed address');
 });

 await check('business names: one rule on every path; scripts with combining marks pass, look-alike dots, invisible and control characters and template syntax are refused',async()=>{
  const ok=['ジョー・サロン','صالون، الورد','Joe’s Hair','Peluquería Ñandú','सुंदर सैलून','ร้านเสริมสวย','சென்னை சலூன்',"Joe's Hair & Co., Ltd.",'Salon 21'],bad=['live．com','live。com','live​.com','live\u0085x','{{businessName}}','evil.xyz','a‍b','x y','Dr Smith','www.example','user@host','10.0.0.1','<b>x</b>','ㅤ','Gardenㅤ Salon','aﾠb','a\u034fb','a\ufe0fb','a\u{E0100}b','a\u180bb','a\u17b4b','example\u0660com','exampleꓸcom','exampleꞏcom','example .com','١٢٧.٠.٠.١','１２７.０.０.１'];
  for(const name of ok){
   assert.ok(m.chatControl({type:'notificationSetupReview',projectId:a.project,instanceId:'requests',formId:'appointment',notices:['owner'],businessName:name}),'control accepts '+name);
   assert.equal((await reviewControl(a,['owner'],name)).status,200,'build accepts '+name);
  }
  for(const name of bad){
   assert.equal(m.chatControl({type:'notificationSetupReview',projectId:a.project,instanceId:'requests',formId:'appointment',notices:['owner'],businessName:name}),undefined,'control refuses '+JSON.stringify(name));
   const typedReview=await typed(a,`/review-notification-setup ${a.project} requests appointment owner ${name}`);assert.ok(typedReview.result.status>=400,'typed path refuses '+JSON.stringify(name));
   const prepared=await m.prepareSiteAction(a.scope,a.user,id(),JSON.stringify({reply:'ok',action:{kind:'notificationSetupReview',projectId:a.project,instanceId:'requests',formId:'appointment',notices:['owner'],businessName:name}}),{}).then(r=>r.statements.length,()=>0);
   assert.equal(prepared,0,'model path refuses '+JSON.stringify(name));
  }
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
}finally{globalThis.fetch=originalFetch;await fixture.close?.();}
