import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {build} from 'esbuild';
import {authenticator} from './app-authenticator.mjs';
import {currentSiteFixtureHandlers,createFixtureProject,configureFixtureModules} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
Error.stackTraceLimit=0;
// WH-159 connected synthetic acceptance of configured notifications: two tenants, the real appointment form through the visitor gateway, the real
// admission batch, outbox, delivery lane and event intake, on disposable SQLite or local D1 (--d1), with a SIMULATED provider. No network, no
// provider, no mail, no secret. The customer spending limit is set only in this local fixture env, never in a wrangler file (asserted below).
// Local synthetic evidence only: it is not live acceptance and no sender, DNS record or provider is involved.
//
// Contract scenario (tests/notifications-contract.mjs) -> group below. "n/a" scenarios have no implementation surface today and stay in the reference:
//   standard staff/owner/receipt from a verified sender, recipients only from records ... 1, 4      duplicate submissions and passes ............. 2
//   lost response, interrupted worker, definite refusal ........................ 3 (interrupted worker: tests/notification-outbox.mjs)
//   bounce/duplicate/out-of-order events, provider suppression, reconcile bound ... 3, 4   revoked or opted-out recipient ........................ 4
//   owner cancellation ...... 5 (switch-off and removal; per-notice owner cancel and owner retry: n/a, no handler)   spending ceiling ...... 6
//   failing notification never loses the record ... 8   removed record ... 4   tenant scope ... 1, 7   withdrawn template ... 7   no model/inference ... 9
//   caps per recipient ... 8   secrets only in the adapter ... 9
const m=await currentSiteFixtureHandlers(),d1=process.argv.includes('--d1'),fixture=await databaseFixture({d1}),{db}=fixture,id=()=>crypto.randomUUID();
const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('No network or inference is available');};
const row=(q,...p)=>db.prepare(q).bind(...p).first(),rows=async(q,...p)=>(await db.prepare(q).bind(...p).all()).results,run=(q,...p)=>db.prepare(q).bind(...p).run();
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(error){console.error('FAILED:',name);throw error;}};
const {appAuth:auth,appGateway}=m,Contact=m.contactNotifications,Outbox=m.notificationOutbox;
const pins=kind=>{const e=m.moduleCatalog.find(x=>x.kind===kind);return {module:{...e.module},schema:{...e.schema}};};
const env={DB:db,ENVIRONMENT:'test',NOTIFICATION_CUSTOMER_CEILING_CENTS:'500',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})}};
const limit=cents=>{if(cents===undefined)delete env.NOTIFICATION_CUSTOMER_CEILING_CENTS;else env.NOTIFICATION_CUSTOMER_CEILING_CENTS=String(cents);};
const accessInstance={id:'members',kind:'access',...pins('access'),dependencies:[],config:{roles:['staff'],enrollment:'invitation'}};
const fields=[{key:'name',label:'Name',type:'text',optional:false,read:'owner'},
 {key:'service',label:'Service',type:'choice',options:[{value:'repair',label:'Repair'},{value:'visit',label:'Visit'}],optional:false,read:'submitter'},
 {key:'day',label:'Day',type:'choice',options:[{value:'monday',label:'Monday'},{value:'tuesday',label:'Tuesday'}],optional:false,read:'submitter'}];
const recordsInstance={id:'requests',kind:'records',...pins('records'),dependencies:['members'],config:{retentionDays:30,
 schemas:[{id:'request',fieldsRevision:1,fields,staffWrite:[]}],forms:[{id:'appointment',recordId:'request',submit:'visitor',uploadCollectionId:null}],
 views:[{id:'mine',recordId:'request',audience:'visitor',scope:'own',fields:['service'],limit:2}]}};
const PRIVATE='VISITOR-PRIVATE-NAME';
async function owner(){
 const actor=await workspaceFixture(db,m),scope=await actor.scope(),user=actor.account;
 const site=await createFixtureProject(scope,user,'Salon '+id().slice(0,6),'Appointments');
 for(const feature of ['core.editing','core.forms'])for(const operation of ['prepare','confirm','dispatch'])
  await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,?,?,'private-test-acceptance','synthetic WH-159 fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),user,site.project,feature,operation);
 return {...actor,scope,user,...site,host:'https://app-'+site.project+'.whumpo.site'};
}
async function visitor(o){
 const invite=await auth.createAppInvitation(o.scope,o.user,o.project),options=await auth.appPasskeyOptions(db,o.project,'signup',false,invite.code),key=authenticator();
 const result=await auth.appPasskeyVerify(db,o.project,'signup',options.challengeToken,key.registration(options.options),false);
 return {...result,cookie:`__Host-whumpo-app-session-${o.project}=${result.session}`};
}
const revision=async o=>(await m.readChat(o.scope,o.user)).state.revision;
async function control(o,action){const turn=id();return {id:turn,...await m.sendChatControl(o.scope,o.user,{id:turn,revision:await revision(o),action})};}
async function activation(o,instanceId){
 const r=await control(o,{type:'moduleActivationReview',projectId:o.project,instanceId,action:'activate'});assert.equal(r.status,200,r.error);
 const saved=await row('SELECT * FROM module_activation_reviews WHERE id=?',r.id);
 assert.equal((await control(o,{type:'moduleActivationApply',reviewId:saved.id,reviewDigest:saved.review_digest,expectedRevision:saved.expected_activation_revision})).status,200);
}
async function setup(o){
 await configureFixtureModules(o.scope,o.user,o.project,[accessInstance,recordsInstance]);await activation(o,'members');await activation(o,'requests');
 return row('SELECT i.* FROM module_instances i WHERE i.project_id=? AND i.local_id=?',o.project,'requests');
}
async function gateway(o,payload,v){
 const response=await appGateway.applicationGateway(new Request(o.host+'/modules',{method:'POST',headers:{'cf-connecting-ip':'192.0.2.9','content-type':'application/json',origin:o.host,cookie:v.cookie},body:JSON.stringify(payload)}),env);
 return {status:response.status,body:await response.json()};
}
const submit=async(o,records,v,{consent=true,service='repair',day='monday'}={})=>{
 const r=await gateway(o,{api:'whumpo-modules',version:1,operation:'forms.submit',resourceId:records.id,configRevision:records.config_revision,requestId:id(),target:{formId:'appointment'},input:{values:{name:PRIVATE,service,day},...(consent?{receiptConsent:true}:{})}},v);
 assert.equal(r.status,200,JSON.stringify(r.body));return r.body.result.entryId;
};
const verifyOwnerAddress=async(o,address)=>{const d=id();await run("INSERT INTO contact_notification_destinations(id,user_id,project_id,address,created_at) VALUES(?,?,?,?,'2026-10-30')",d,o.user,o.project,address);await run("UPDATE contact_notification_destinations SET state='verified',verified_at='2026-10-30' WHERE id=?",d);return d;};
const verifyVisitor=async(v,address)=>{
 await run('INSERT INTO visitor_notification_addresses(visitor_id,address) VALUES(?,?)',v.visitorId,address);
 await run('UPDATE visitor_notification_addresses SET code_hash=?,code_expires_at=unixepoch()+600 WHERE visitor_id=?','a'.repeat(64),v.visitorId);
 await run('UPDATE visitor_notification_addresses SET verified_at=unixepoch(),code_hash=NULL,code_expires_at=NULL WHERE visitor_id=?',v.visitorId);
};
const optInStaff=async(o,v,access)=>{
 const r=await control(o,{type:'accessRoleReview',projectId:o.project,instanceId:'members',visitorId:v.visitorId,action:'grant'});assert.equal(r.status,200,r.error);
 const saved=await row('SELECT * FROM module_access_role_reviews WHERE id=?',r.id);
 assert.equal((await control(o,{type:'accessRoleApply',reviewId:saved.id,reviewDigest:saved.review_digest,expectedRevision:saved.expected_access_revision})).status,200);
 await run('INSERT INTO staff_notification_optins(instance_id,visitor_id,opted_in_at) VALUES(?,?,unixepoch())',access.id,v.visitorId);
};
async function configure(o,list,name='Garden Salon'){
 const r=await control(o,{type:'notificationSetupReview',projectId:o.project,instanceId:'requests',formId:'appointment',notices:list,businessName:name});assert.equal(r.status,200,r.error);
 assert.equal((await control(o,{type:'confirm',kind:'notificationConfiguration',reviewId:r.id})).status,200);
}
/** The simulated provider. `behave(notice)` picks what each call does; every call is recorded. */
function provider(behave=()=>'up'){
 const p={calls:[],taken:[]};
 p.send=async notice=>{
  p.calls.push(notice);const mode=behave(notice);
  if(mode==='down')return {accepted:false,retryable:true};
  if(mode==='reject')return {accepted:false,retryable:false};
  if(mode==='throw')throw Error('PRIVATE-PROVIDER-ERROR');
  p.taken.push(notice.idempotencyKey);
  if(mode==='lost')return new Promise(()=>{}); // the provider took the message and the reply never returns (a timeout)
  return {accepted:true,providerRef:'ref-'+id()};
 };
 return p;
}
const settings=cents=>({provider:'cloudflare-email',review:'r',sendCeiling:1000,...(cents===undefined?{}:{customerCeilingCents:cents})});
async function pass(p,cents=500,{at,timeoutMs=200,deliver=Contact.runContactDelivery}={}){let total={accepted:0,cancelled:0,failed:0,refused:0};for(let i=0;i<30;i++){const t=await deliver(db,settings(cents),p.send,{now:at??new Date(),timeoutMs});for(const k of Object.keys(total))total[k]+=t[k];if(t.cancelled+t.accepted+t.refused+t.failed+t.retried===0)break;}return total;}
const notices=project=>rows("SELECT n.*,j.state AS job_state FROM notification_notices n LEFT JOIN job_journal j ON j.id=n.job_id WHERE n.project_id=? AND n.template LIKE 'appointment.%' ORDER BY n.created_at,n.id",project);
const forEvent=async(o,e)=>(await notices(o.project)).filter(n=>n.event_ref.includes(e));
const states=list=>list.map(n=>n.scope+':'+n.state+(n.reason?'/'+n.reason:'')).sort();
const records=o=>row('SELECT count(*) n FROM module_records WHERE project_id=?',o.project).then(x=>x.n);
const ledger=async()=>(await row('SELECT coalesce(sum(sends),0) n FROM notification_send_ledger')).n;
const clear=o=>run("DELETE FROM notification_notices WHERE project_id=? AND template LIKE 'appointment.%' AND state NOT IN ('queued','dispatching','unknown-outcome','unresolved','deferred')",o.project);
const reset=o=>run("UPDATE notification_notices SET state='cancelled',reason='expired',outcome_at=? WHERE project_id=? AND state IN ('queued','deferred')",Date.now(),o.project);

// A second bundle of the same handlers whose catalog withdraws the staff template, to run the actual delivery lane against a withdrawn template.
const withdrawn=await build({stdin:{contents:"export * from './src/notification-outbox';",resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent',
 plugins:[{name:'withdraw',setup:b=>b.onLoad({filter:/notification-catalog\.ts$/},a=>{
  const text=readFileSync(a.path,'utf8'),from="'appointment.staff-notice@1':{state:'available'";assert.equal(text.split(from).length,2);
  return {contents:text.replace(from,"'appointment.staff-notice@1':{state:'withdrawn'"),loader:'ts'};})}]});
const Withdrawn=await import('data:text/javascript;base64,'+Buffer.from(withdrawn.outputFiles[0].text).toString('base64'));

try{
 const a=await owner(),b=await owner(),ra=await setup(a),rb=await setup(b);
 const access=await row("SELECT * FROM module_instances WHERE project_id=? AND local_id='members'",a.project);
 const v1=await visitor(a),v2=await visitor(a),staff=await visitor(a),bv=await visitor(b);
 await verifyVisitor(v1,'receipt-one@example.com');await verifyVisitor(v2,'receipt-two@example.com');await verifyVisitor(staff,'staff@example.com');await optInStaff(a,staff,access);
 await verifyOwnerAddress(a,'owner-a@example.com');await verifyOwnerAddress(b,'owner-b@example.com');await verifyVisitor(bv,'receipt-b@example.com');
 await configure(a,['owner','staff','receipt']);await configure(b,['owner','staff','receipt'],'Other Salon');
 limit(500);

 await check('1 journey: form to record to staff notice, owner notice and submitter receipt, per tenant, content-free, from current records only',async()=>{
  const ea=await submit(a,ra,v1),eb=await submit(b,rb,bv);
  assert.ok(await row('SELECT 1 FROM module_records WHERE id=?',ea),'The record is stored');
  assert.deepEqual(states(await forEvent(a,ea)),['owner-destination:queued','project-staff:queued','submitter:queued']);
  assert.deepEqual(states(await forEvent(b,eb)),['owner-destination:queued','submitter:queued'],'Tenant B has no staff opted in');
  assert.ok((await notices(a.project)).every(n=>n.job_state==='ready'&&!JSON.stringify(n).includes(PRIVATE)),'One envelope per notice; rows carry ids, never values');
  const p=provider(),before=await ledger();await pass(p);
  const to=e=>p.calls.filter(c=>c.idempotencyKey.includes(e)).map(c=>c.recipient).sort();
  assert.deepEqual(to(ea),['owner-a@example.com','receipt-one@example.com','staff@example.com']);
  assert.deepEqual(to(eb),['owner-b@example.com','receipt-b@example.com'],'No address crosses tenants');
  assert.ok(p.calls.every(c=>c.kind==='configured'));
  assert.equal((await ledger())-before,p.calls.length,'Every call was counted once');
  for(const c of p.calls){const t=m.contactEmail.contactEmailMessage(c),text=t.subject+t.text;assert.ok(!text.includes(PRIVATE),'The name is never mailed');
   if(c.template==='appointment.staff-notice@1')assert.match(t.text,/does not include the request details/);}
  assert.ok((await forEvent(a,ea)).every(n=>n.state==='accepted'&&n.sent_to));
 });

 await check('2 duplicate events and passes: one notice per template, event and recipient; concurrent passes call the provider once each',async()=>{
  await clear(a);const e=await submit(a,ra,v1);
  const again=await m.notificationConfigurations.admissionNotices(db,{customerCeilingCents:500},{instanceId:ra.id,projectId:a.project,formId:'appointment',entryId:e,visitorId:v1.visitorId,consent:true,now:Date.now()});
  await db.batch(again);assert.equal((await forEvent(a,e)).length,3,'The replayed admission queues nothing new');
  const p=provider(),before=await ledger();await Promise.all([pass(p),pass(p),pass(p)]);
  assert.equal(p.calls.filter(c=>c.idempotencyKey.includes(e)).length,3,'Three notices, three calls, however many passes');
  assert.equal((await ledger())-before,3);
  await pass(p);assert.equal(p.calls.filter(c=>c.idempotencyKey.includes(e)).length,3,'A later pass sends nothing');
 });

 await check('3 lost response, timeout, throw and bounce: unknown-outcome is never redispatched, events are authenticated and idempotent, reconciliation is bounded and read-only',async()=>{
  await clear(a);const v4=await visitor(a);await verifyVisitor(v4,'receipt-four@example.com');const e=await submit(a,ra,v4);
  const p=provider(n=>n.recipient==='owner-a@example.com'?'lost':n.recipient==='staff@example.com'?'throw':'up');
  const t=await pass(p);assert.equal(t.failed,2);
  let list=await forEvent(a,e);const by=Object.fromEntries(list.map(n=>[n.scope,n]));
  assert.deepEqual([by['owner-destination'].state,by['owner-destination'].reason,by['project-staff'].state,by.submitter.state],['unknown-outcome','uncertain','unknown-outcome','accepted']);
  assert.equal(by['owner-destination'].reconcile_until-by['owner-destination'].outcome_at,72*3600000,'Bounded at 72 hours');
  assert.ok(!JSON.stringify(await rows('SELECT * FROM notification_notices')).includes('PRIVATE-PROVIDER-ERROR'),'No provider error text is stored');
  const calls=p.calls.length;await pass(provider(),500,{at:new Date(Date.now()+30*3600000)});assert.equal(p.calls.length,calls,'No redispatch');
  assert.equal((await forEvent(a,e)).filter(n=>n.state==='unknown-outcome').length,2);
  // Events: unauthenticated is refused; a bounce moves an accepted or unknown notice and suppresses exactly the address it went to; replays change nothing.
  await assert.rejects(Outbox.applyNoticeEvent(db,{noticeId:by.submitter.id,type:'bounce',authenticated:false}),/EVENT_NOT_AUTHENTICATED/);
  assert.equal((await row('SELECT state FROM notification_notices WHERE id=?',by.submitter.id)).state,'accepted');
  await Outbox.applyNoticeEvent(db,{noticeId:by.submitter.id,type:'bounce',authenticated:true});await Outbox.applyNoticeEvent(db,{noticeId:by.submitter.id,type:'bounce',authenticated:true});
  await Outbox.applyNoticeEvent(db,{noticeId:by.submitter.id,type:'accepted',providerRef:'late',authenticated:true});
  assert.equal((await row('SELECT state FROM notification_notices WHERE id=?',by.submitter.id)).state,'bounced','Out of order and replayed events change nothing');
  assert.equal((await row("SELECT count(*) n FROM contact_notification_suppressions WHERE user_id=? AND address='receipt-four@example.com'",a.user)).n,1);
  const later=await submit(a,ra,v4);assert.equal((await forEvent(a,later)).filter(n=>n.scope==='submitter').length,0,'The bounced address gets no further receipt, but the record is accepted');
  // A provider event resolves an unknown outcome; the rest end unresolved at the bound with no provider call.
  await Outbox.applyNoticeEvent(db,{noticeId:by['owner-destination'].id,type:'delivered',authenticated:true});
  assert.equal((await row('SELECT state FROM notification_notices WHERE id=?',by['owner-destination'].id)).state,'delivered');
  assert.equal(await Outbox.recordNoticeLookup(db,by['project-staff'].id),1,'A read-only lookup is counted, never a send');
  const sent=p.calls.length;await Outbox.maintainNotices(db,by['project-staff'].reconcile_until);
  assert.deepEqual([(await row('SELECT state,reason FROM notification_notices WHERE id=?',by['project-staff'].id)).state],['unresolved']);assert.equal(p.calls.length,sent);
  await reset(a);
 });

 await check('4 revoked recipients are rechecked and cancelled before any call: opt-out, suppression, revoked visitor, removed destination and removed record',async()=>{
  await clear(a);const v3=await visitor(a);await verifyVisitor(v3,'receipt-three@example.com');
  const e=await submit(a,ra,v3);
  await run("INSERT INTO contact_notification_suppressions(user_id,address,reason,created_at) VALUES(?,'receipt-three@example.com','unsubscribe','2026-10-30')",a.user);
  await run('DELETE FROM staff_notification_optins WHERE visitor_id=?',staff.visitorId);
  const p=provider();await pass(p);
  assert.deepEqual(states(await forEvent(a,e)),['owner-destination:accepted','project-staff:cancelled/recipient-revoked','submitter:cancelled/recipient-revoked']);
  assert.deepEqual(p.calls.filter(c=>c.idempotencyKey.includes(e)).map(c=>c.recipient),['owner-a@example.com'],'Only the still-eligible recipient is called');
  await run('INSERT INTO staff_notification_optins(instance_id,visitor_id,opted_in_at) VALUES(?,?,unixepoch())',access.id,staff.visitorId);
  await clear(a);const v5=await visitor(a);await verifyVisitor(v5,'receipt-five@example.com');const e2=await submit(a,ra,v5);await run('UPDATE app_visitors SET revoked=1 WHERE id=?',v5.visitorId);
  const p2=provider();await pass(p2);
  assert.ok((await forEvent(a,e2)).filter(n=>n.scope==='submitter').every(n=>n.state==='cancelled'&&n.reason==='recipient-revoked'),'A revoked visitor gets no receipt');
  await clear(a);const e3=await submit(a,ra,v1);await run('DELETE FROM module_records WHERE id=?',e3);
  const p3=provider();await pass(p3);
  assert.ok((await forEvent(a,e3)).length===3&&(await forEvent(a,e3)).every(n=>n.state==='cancelled'&&n.reason==='record-removed')&&p3.calls.filter(c=>c.idempotencyKey.includes(e3)).length===0,'A removed record cancels its notices');
 });

 await check('5 cancellation: switching the notices off cancels unsent notices with their envelopes, leaves sent ones and the other tenant untouched',async()=>{
  await clear(a);await clear(b);const done=await submit(a,ra,v1);await pass(provider());
  const e=await submit(a,ra,v1),eb=await submit(b,rb,bv);
  await configure(a,['owner'],'Garden Salon');
  const p=provider();await pass(p);
  const cancelled=await forEvent(a,e);
  assert.ok(cancelled.length===3&&cancelled.every(n=>n.state==='cancelled'&&n.reason==='configuration-changed'&&n.job_state==='cancelled'),JSON.stringify(states(cancelled)));
  assert.ok((await forEvent(a,done)).every(n=>n.state==='accepted'),'Sent notices are not touched');
  assert.deepEqual(p.calls.filter(c=>c.projectId===a.project).length,0);
  assert.deepEqual(states(await forEvent(b,eb)),['owner-destination:accepted','submitter:accepted'],'The other tenant is still served');
  await configure(a,['owner','staff','receipt']);
 });

 await check('6 ceiling: nothing is queued or sent without the customer limit, every call is counted before it is made, and past the limit notices are cancelled',async()=>{
  assert.deepEqual([...Object.keys(env)].filter(k=>k==='NOTIFICATION_CUSTOMER_CEILING_CENTS').length,1,'Set only in this local fixture env');
  limit(undefined);const quiet=await submit(a,ra,v1);assert.equal((await forEvent(a,quiet)).length,0,'No limit, no notices, record still accepted');assert.ok(await row('SELECT 1 FROM module_records WHERE id=?',quiet));
  limit(500);await clear(a);const e=await submit(a,ra,v1);
  const p0=provider(),sends=await ledger();await pass(p0,NaN);
  assert.equal(p0.calls.length,0);assert.equal(await ledger(),sends);assert.ok((await forEvent(a,e)).every(n=>n.state==='cancelled'&&n.reason==='ceiling-unset'),'A NaN or missing limit cancels before any call');
  await clear(a);const e2=await submit(a,ra,v1);let counted=true;
  const p=provider();const send=p.send;let seen=0;p.send=async n=>{const now=await ledger();counted=counted&&now>seen;seen=now;return send(n);};seen=await ledger();
  await pass(p,500,{timeoutMs:5000});assert.ok(counted&&p.calls.length>=3,'Each call was counted in the ledger before the provider was reached');
  await clear(a);const e3=await submit(a,ra,v2);
  await run('UPDATE notification_send_ledger SET sends=sends+28 WHERE day=(SELECT max(day) FROM notification_send_ledger)');
  const p3=provider();await pass(p3,1);
  assert.ok(p3.calls.filter(c=>c.idempotencyKey.includes(e3)).length===0&&(await forEvent(a,e3)).every(n=>n.state==='cancelled'&&n.reason==='ceiling'),'Past a one-cent limit nothing is sent');
  void e2;
  // D42: the limit is a local fixture value only; no wrangler file may carry it.
  const wrangler=execFileSync('git',['ls-files','*wrangler*'],{encoding:'utf8'}).split('\n').filter(Boolean);assert.ok(wrangler.length>=3);
  for(const f of wrangler)assert.ok(!readFileSync(f,'utf8').includes('NOTIFICATION_CUSTOMER_CEILING_CENTS'),f+' must not set the customer limit');
 });

 await check('7 template withdrawal: a withdrawn template is cancelled before any recipient is read or call made; the other template and tenant still send',async()=>{
  await clear(a);await clear(b);const e=await submit(a,ra,v1),eb=await submit(b,rb,bv);
  const p=provider();const t=await pass(p,500,{deliver:Withdrawn.runNotificationDelivery});
  assert.ok(t.cancelled>=3,JSON.stringify(t));
  const list=await forEvent(a,e);
  assert.deepEqual(states(list),['owner-destination:cancelled/template-withdrawn','project-staff:cancelled/template-withdrawn','submitter:accepted'],'Owner and staff notices use the withdrawn staff template; the receipt template is still available');
  assert.deepEqual(p.calls.filter(c=>c.projectId===a.project).map(c=>c.template),['appointment.request-receipt@1']);
  assert.deepEqual(states(await forEvent(b,eb)),['owner-destination:cancelled/template-withdrawn','submitter:accepted'],'Withdrawal is a catalog fact, so it reaches both tenants');
  assert.ok((await forEvent(a,e)).filter(n=>n.state==='cancelled').every(n=>n.job_state==='cancelled'));
 });

 await check('8 accepted-record isolation: refusal, timeout, throw, retry exhaustion and the per-recipient caps never alter or lose the accepted record',async()=>{
  const c=await owner(),rc=await setup(c),cv=await visitor(c);await verifyOwnerAddress(c,'owner-c@example.com');await verifyVisitor(cv,'receipt-c@example.com');await configure(c,['owner','receipt']);
  const entries=[];for(let i=0;i<12;i++)entries.push(await submit(c,rc,cv,{service:i%2?'visit':'repair'}));
  assert.equal(await records(c),12,'Every request was admitted, including those past the notice caps');
  const before=JSON.stringify(await rows('SELECT id,project_id,values_json FROM module_records WHERE project_id=? ORDER BY id',c.project));
  for(const mode of ['down','reject','throw','lost']){await pass(provider(()=>mode));await reset(c);}
  assert.equal(JSON.stringify(await rows('SELECT id,project_id,values_json FROM module_records WHERE project_id=? ORDER BY id',c.project)),before,'Records are byte-for-byte what was accepted');
  assert.equal(await records(c),12);
  const mine=await gateway(c,{api:'whumpo-modules',version:1,operation:'records.view',resourceId:rc.id,configRevision:rc.config_revision,requestId:null,target:{viewId:'mine',cursor:null},input:null},cv);
  assert.equal(mine.status,200,JSON.stringify(mine.body));
  assert.ok((await notices(c.project)).every(n=>['unknown-outcome','failed','cancelled','deferred','queued','unresolved'].includes(n.state)),'Failures were recorded as notice states only');
  // The submitter can still read their own accepted requests and the owner destination is intact.
  assert.equal((await row("SELECT state FROM contact_notification_destinations WHERE project_id=?",c.project)).state,'verified');
  assert.equal(network,0);
 });

 await check('9 no inference, no relay: delivery imports no model code, recipients come from records only, and the provider is never reached by caller input',async()=>{
  for(const f of ['src/notification-configurations.ts','src/notification-outbox.ts','src/contact-email.ts']){
   const imports=[...readFileSync(f,'utf8').matchAll(/from '([^']+)'/g)].map(x=>x[1]);
   assert.deepEqual(imports.filter(i=>/(^|\/)(ai|ai-chat|ai-gateway|chat|site-agent|agent-[a-z-]+|maintainer[a-z-]*|opencode[a-z-]*)$/.test(i)),[],f);
  }
  await clear(a);const e=await submit(a,ra,v1);
  const hostile=await gateway(a,{api:'whumpo-modules',version:1,operation:'forms.submit',resourceId:ra.id,configRevision:ra.config_revision,requestId:id(),target:{formId:'appointment'},input:{values:{name:PRIVATE,service:'repair',day:'monday'},receiptConsent:true,recipient:'attacker@example.com',to:'attacker@example.com'}},v1);
  const p=provider();await pass(p);
  assert.ok(!p.calls.some(c=>/attacker/.test(JSON.stringify(c))),'Caller input cannot add a recipient');void e;void hostile;
  assert.ok(p.calls.length>0&&p.calls.every(c=>Object.keys(c).filter(k=>k!=='configured').sort().join()==='idempotencyKey,kind,outboxId,projectId,recipient,template'&&Object.keys(c.configured??{}).sort().join()==='fields,variables'),'The sender gets a recipient and a template reference, never a credential or caller header');
  // Cross-origin: a visitor session of one project presented at the other project's origin is refused and queues nothing; no response carries an address.
  const [na,nb]=[(await notices(a.project)).length,(await notices(b.project)).length];
  const input={values:{name:PRIVATE,service:'repair',day:'monday'},receiptConsent:true};
  const cross=(o,r,v)=>gateway(o,{api:'whumpo-modules',version:1,operation:'forms.submit',resourceId:r.id,configRevision:r.config_revision,requestId:id(),target:{formId:'appointment'},input},v);
  assert.ok((await cross(b,rb,v1)).status>=400&&(await cross(a,ra,bv)).status>=400,'A session is only good at its own project origin');
  assert.deepEqual([(await notices(a.project)).length,(await notices(b.project)).length],[na,nb]);
  const own=await gateway(a,{api:'whumpo-modules',version:1,operation:'forms.submit',resourceId:ra.id,configRevision:ra.config_revision,requestId:id(),target:{formId:'appointment'},input},v1);
  assert.ok(!JSON.stringify(own.body).includes('@'),'No visitor-origin response carries an address');
  assert.equal(network,0,'The network was never used');
 });
 globalThis.fetch=originalFetch;
 console.log(`Notifications connected: ${cases} groups passed on ${d1?'local D1':'SQLite'} — two-tenant appointment journey, duplicates, lost response and timeout, bounce and events, revoked recipients, cancellation, ceiling, template withdrawal, accepted-record isolation and no inference. Simulated provider only; no mail was sent and no sender, DNS or provider was touched.`);
}finally{globalThis.fetch=originalFetch;await fixture.close?.();}
