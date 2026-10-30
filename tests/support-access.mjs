import assert from 'node:assert/strict';
import {databaseFixture} from './helpers/current-database.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {runUsageReview} from '../tools/usage-review-input.mjs';
Error.stackTraceLimit=0;
// WH-035: independent support access, private tenant boundaries, distinct saved/delivered/read states, provider gating.
const modules=await currentFixtureModules(['src/index.ts','src/support.ts','src/support-delivery.ts','src/notification-outbox.ts','src/support-shape.ts','src/usage-review-requests.ts']);
const worker=(await modules.module('src/index.ts')).default,support=await modules.module('src/support.ts'),delivery=await modules.module('src/support-delivery.ts'),outbox=await modules.module('src/notification-outbox.ts'),shape=await modules.module('src/support-shape.ts'),service=await modules.module('src/usage-review-requests.ts');
const fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID(),run=(q,...p)=>db.prepare(q).bind(...p).run(),row=(q,...p)=>db.prepare(q).bind(...p).first();
const originalFetch=globalThis.fetch;let network=0;globalThis.fetch=async()=>{network++;throw Error('No network call is permitted');};
// No AI key, no provider, no support values: the baseline outage environment.
const env={DB:db,ENVIRONMENT:'test',API_LIMITER:{limit:async()=>({success:true})}},ctx={waitUntil(){throw Error('No background work is permitted');}};
let cases=0;async function test(name,fn){try{await fn();cases++;}catch(e){console.error(name,e);throw e;}}
async function http(o,path,method='GET',body,status=200,{origin='https://whumpo.com',config=env}={}){
 const response=await worker.fetch(new Request('https://whumpo.com'+path,{method,headers:{...(o?{cookie:'__Host-whumpo_session='+o.auth.token}:{}),origin,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})}),config,ctx);
 assert.equal(response.status,status,await response.clone().text());assert.match(response.headers.get('cache-control'),/no-store/);return response.json();
}
const api=(o,rest='',...args)=>http(o,'/api/support/v1'+rest,...args);
async function owner(){const auth=await workspaceFixture(db,modules.identity);return {auth,user:auth.account};}
const old=new Date(Date.now()-3*3600000).toISOString();
try{
 // A has not finished onboarding, has a stuck Chat turn and a held AI request, and no AI provider exists.
 const a=await owner(),b=await owner(),stuckTurn=id(),heldAI=id();
 await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,1,'PRIVATE-A-CHAT','',?,'ai','pending')",stuckTurn,a.user,old);
 await run("INSERT INTO standard_ai_requests(id,user_id,request_hash,state,created_at,updated_at) VALUES(?,?,?,'reserved',?,?)",heldAI,a.user,'a'.repeat(64),old,old);
 const bTurn=id();await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,1,'PRIVATE-B-CHAT','',?,'ai','pending')",bTurn,b.user,old);
 await run("INSERT INTO fair_use_reviews(id,user_id,policy_version,plan_id,category,opened_by,context,observation_json) VALUES(?,?,'v','starter','project_churn','PRIVATE-FAIR-USE-OPERATOR','PRIVATE-FAIR-USE-NOTE',?)",id(),a.user,JSON.stringify({version:1,entitlement:{planId:'starter'},metrics:{},asOf:'2026-10-04T00:00:00Z'}));

 await test('Chat and onboarding are closed but support, status links and stuck operations stay available',async()=>{
  const chat=await http(a,'/api/chat','GET',undefined,409);assert.equal(chat.code,'onboarding_required');assert.equal(chat.support,'/workspace/support?ref=status%3Aonboarding_required');
  await http(a,'/api/workspace/dashboard','GET',undefined,409);
  const overview=await api(a);assert.equal(overview.version,1);assert.deepEqual(overview.requests,[]);
  assert.deepEqual(overview.operations.map(o=>o.family).sort(),['chat','standard_ai']);
  const chatOp=overview.operations.find(o=>o.family==='chat');assert.equal(chatOp.id,stuckTurn);assert.equal(chatOp.needsAttention,true);assert.ok(chatOp.ageMinutes>=179);assert.equal(chatOp.reference,'operation:chat:'+stuckTurn);
  assert.ok(!JSON.stringify(overview).includes('PRIVATE-A-CHAT'),'operation list never includes Chat content');
  assert.deepEqual(overview.statusLinks.map(l=>l.code),['onboarding_required','chat_unavailable','usage_limit']);assert.ok(overview.statusLinks.every(l=>l.href.startsWith('/workspace/support?ref=status%3A')));
  // Every status link resolves to a structured reference the support route accepts.
  for(const link of overview.statusLinks)assert.equal(shape.parseSupportReference(decodeURIComponent(new URL(link.href,'https://whumpo.com').searchParams.get('ref'))).code,link.code);
  assert.deepEqual(overview.config,{hours:null,notifications:{enabled:false}},'No hours or provider is invented and no general contact address is configured');
  assert.equal(shape.lockoutContact,'hello@whumpo.com','The owner-approved lockout address is fixed source copy');
  assert.equal((await row('SELECT count(*) n FROM chat_turns WHERE user_id=?',a.user)).n,1,'Support reads create no Chat turn');
 });
 await test('another account sees only its own operations',async()=>{
  const overview=await api(b);assert.deepEqual(overview.operations.map(o=>o.id),[bTurn]);assert.ok(!JSON.stringify(overview).includes(heldAI));
 });
 await test('strict, authenticated, same-origin, idempotent submission',async()=>{
  await api(null,'','GET',undefined,401);
  const input={version:1,id:id(),kind:'help',statement:'PRIVATE-HELP-STATEMENT: my reply never finished.',reference:'operation:chat:'+stuckTurn};
  await api(a,'/requests','POST',input,403,{origin:'https://foreign.invalid'});
  for(const bad of [{...input,extra:true},{...input,version:2},{...input,kind:'other'},{...input,id:'nope'},{...input,statement:'  '},{...input,statement:'x'.repeat(951)},{...input,statement:'bad\u0000text'},{...input,reference:'free text'},{...input,reference:'status:unknown'},{...input,reference:'operation:chat:not-a-uuid'}])await api(a,'/requests','POST',bad,400);
  await api(a,'/requests?x=1','POST',input,400);
  await api(a,'/requests','POST',{...input,reference:'operation:chat:'+bTurn},404);
  assert.equal((await row('SELECT count(*) n FROM usage_review_requests')).n,0,'Rejected requests save nothing');
  const first=await api(a,'/requests','POST',input);assert.equal(first.replayed,false);assert.equal(first.request.state,'open');assert.equal(first.request.response.saved,false);assert.equal(first.request.read.state,'not_applicable');
  assert.equal((await api(a,'/requests','POST',input)).replayed,true);
  await api(a,'/requests','POST',{...input,statement:'A different statement'},409);
  await api(a,'/requests','POST',{...input,id:id()},409);
  const usage={version:1,id:id(),kind:'usage_review',statement:'PRIVATE-USAGE-STATEMENT: I maintain client sites.',reference:'status:usage_limit'};
  assert.equal((await api(a,'/requests','POST',usage)).request.kind,'usage_review');
  await api(a,'/requests','POST',{...usage,id:id()},409);
  assert.equal((await row('SELECT count(*) n FROM chat_turns WHERE user_id=? AND id IN (?,?)',a.user,input.id,usage.id)).n,0,'No Chat turn is created');
  const row2=await row('SELECT source,kind FROM usage_review_requests WHERE id=?',usage.id);assert.deepEqual({...row2},{source:'support',kind:'usage_review'});
  a.help=input;a.usage=usage;
 });
 await test('cross-tenant tickets stay private',async()=>{
  await api(b,'/requests/'+a.help.id,'GET',undefined,404);await api(b,'/requests/'+a.help.id+'/read','POST',{version:1},404);
  await api(b,'/requests','POST',{...a.help,id:id()},404,{});
  assert.deepEqual((await api(b)).requests,[]);
  // Reusing A's ID is indistinguishable from a conflict and exposes nothing.
  const clash=await api(b,'/requests','POST',{version:1,id:a.help.id,kind:'help',statement:'mine'},409);assert.ok(!JSON.stringify(clash).includes('PRIVATE'));
  assert.equal((await row('SELECT user_id FROM usage_review_requests WHERE id=?',a.help.id)).user_id,a.user);
 });
 await test('operator queue, preview-bound answer, and saved/delivered/read are three states',async()=>{
  const queue=await runUsageReview(service,db,{action:'queue',state:'open'});assert.equal(queue.queue.length,2);assert.ok(queue.queue.every(r=>r.user_id===a.user&&r.delivery_state===null));assert.deepEqual(queue.queue.map(r=>r.created_at),[...queue.queue.map(r=>r.created_at)].sort());
  const answer={action:'answer',account:a.user,id:a.help.id,response:'Visible reply: we read your report.',operator:'PRIVATE-OPERATOR-IDENTITY'};
  const preview=await runUsageReview(service,db,answer);assert.equal(preview.preview,true);
  assert.equal((await api(a,'/requests/'+a.help.id)).request.state,'open');
  await runUsageReview(service,db,answer,preview.applyDigest);
  const saved=(await api(a,'/requests/'+a.help.id)).request;
  assert.equal(saved.response.saved,true);assert.equal(saved.delivery.state,'none','No provider: nothing was delivered externally');assert.equal(saved.read.state,'unread');assert.equal(saved.publicResponse,answer.response);
  assert.equal((await api(a,'/requests/'+a.help.id)).request.read.state,'unread','Fetching a request is not a read receipt');
  const read=(await api(a,'/requests/'+a.help.id+'/read','POST',{version:1})).request;assert.equal(read.read.state,'read');assert.equal(read.delivery.state,'none');assert.equal(read.response.saved,true);
  assert.deepEqual((await api(a,'/requests/'+a.help.id+'/read','POST',{version:1})).request.read,read.read,'Read receipt is idempotent');
  await api(a,'/requests/'+a.help.id+'/read','POST',{version:1,extra:1},400);
  const open=(await api(a,'/requests/'+a.usage.id+'/read','POST',{version:1})).request;assert.equal(open.read.state,'not_applicable','An unanswered request cannot be marked read');
  await assert.rejects(()=>run("UPDATE usage_review_requests SET customer_read_at=NULL WHERE id=?",a.help.id),/immutable/);
  const text=JSON.stringify([saved,read,await api(a)]);for(const secret of ['PRIVATE-OPERATOR','PRIVATE-FAIR-USE','answered_by','PRIVATE-B-CHAT','user_id'])assert.ok(!text.includes(secret),secret);
  const answered=await runUsageReview(service,db,{action:'queue',state:'answered'});assert.equal(answered.queue.length,1);assert.ok(answered.queue[0].customer_read_at);
 });
 await test('the existing Chat path still sees only usage reviews and records a read',async()=>{
  const list=await service.listUsageReviewRequests(db,a.user,'usage_review');assert.deepEqual(list.map(r=>r.id),[a.usage.id]);
  assert.equal((await service.listUsageReviewRequests(db,a.user)).length,2);
 });
 await test('external notification needs a selected, implemented and reviewed provider',async()=>{
  const settings=env=>support.supportConfig(env,['fixture-provider']).settings;
  assert.equal(settings({}),null);assert.equal(settings({SUPPORT_NOTIFICATION_PROVIDER:'fixture-provider'}),null,'selected but not reviewed');assert.equal(settings({SUPPORT_NOTIFICATION_REVIEW:'review-1'}),null,'reviewed but not selected');
  assert.equal(settings({SUPPORT_NOTIFICATION_PROVIDER:'other',SUPPORT_NOTIFICATION_REVIEW:'review-1'}),null,'not implemented');
  assert.equal(support.supportConfig({SUPPORT_NOTIFICATION_PROVIDER:'x',SUPPORT_NOTIFICATION_REVIEW:'r'}).settings,null,'No provider is implemented in the repository');
  assert.deepEqual(settings({SUPPORT_NOTIFICATION_PROVIDER:'fixture-provider',SUPPORT_NOTIFICATION_REVIEW:'review-1'}),{provider:'fixture-provider',review:'review-1'});
  let sent=0;const result=await delivery.queueSupportNotices(db,null);assert.deepEqual(result,{enabled:false,queued:0});const idle=await outbox.runNotificationDelivery(db,null,async()=>{sent++;return {accepted:true};});assert.equal(idle.enabled,false);assert.equal(sent,0);assert.equal((await row("SELECT count(*) n FROM notification_notices WHERE template='support.response-saved@1'")).n,0);
  // Operator-supplied hours appear only when set, and as plain text.
  const configured=await http(a,'/api/support/v1','GET',undefined,200,{config:{...env,SUPPORT_HOURS:'OWNER-SUPPLIED-HOURS',SUPPORT_NOTIFICATION_PROVIDER:'fixture-provider',SUPPORT_NOTIFICATION_REVIEW:'r'}});
  assert.deepEqual(configured.config,{hours:'OWNER-SUPPLIED-HOURS',notifications:{enabled:false}},'Unimplemented provider keeps notifications off');
 });

 await test('delivery goes through the shared outbox: bounded, content-free and distinct from saved and read',async()=>{
  const settings={provider:'fixture-provider',review:'review-1'},shared={provider:'cloudflare-email',review:'review-1',sendCeiling:1000},c=await owner();await run("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')",c.user);
  // Verification normally moves only through a confirmed email change (users_email_lockstep); this fixture drops that trigger to set it directly.
  await run('DROP TRIGGER users_email_lockstep');const verify=who=>run("UPDATE users SET email_verified_at=?,email_verified_via='notify@whumpo.com' WHERE id=?",Date.now(),who.user);await verify(c);
  async function answered(who,text='Reply'){const request={version:1,id:id(),kind:'help',statement:'PRIVATE-DELIVERY-STATEMENT'};await api(who,'/requests','POST',request);await service.answerUsageReview(db,who.user,request.id,text+' PRIVATE-DELIVERY-REPLY','PRIVATE-DELIVERY-OPERATOR');return request.id;}
  const notice=request=>row("SELECT state,attempts,reason FROM notification_notices WHERE template='support.response-saved@1' AND event_ref=?",request);
  const first=await answered(c),t0=new Date(),seen=[];
  let mode='down';const sender=async n=>{seen.push(n);return mode==='down'?{accepted:false,retryable:true}:mode==='reject'?{accepted:false,retryable:false}:mode==='throw'?(()=>{throw Error('PRIVATE-PROVIDER-ERROR');})():{accepted:true,providerRef:'support-ref'};};
  const drain=async at=>{const queued=await delivery.queueSupportNotices(db,settings,{now:at});const r=await outbox.runNotificationDelivery(db,shared,sender,{now:at});return {...r,queued:queued.queued};};
  let r=await drain(t0);assert.equal(r.queued,1);assert.equal(r.retried,1);
  assert.deepEqual({...await notice(first)},{state:'deferred',attempts:1,reason:'unavailable'});
  assert.equal((await api(c,'/requests/'+first)).request.delivery.state,'queued');assert.equal((await api(c,'/requests/'+first)).request.response.saved,true);
  r=await drain(new Date(t0.getTime()+60000));assert.equal(seen.length,1,'Not retried before its backoff time');
  r=await drain(new Date(t0.getTime()+6*60000));assert.equal(r.retried,1);assert.equal((await notice(first)).attempts,2);
  mode='up';r=await drain(new Date(t0.getTime()+30*60000));assert.equal(r.accepted,1);
  let seenView=(await api(c,'/requests/'+first)).request;assert.equal(seenView.delivery.state,'delivered');assert.equal(seenView.read.state,'unread','Delivery is not a read receipt');
  r=await drain(new Date(t0.getTime()+23*3600000));assert.equal(r.accepted+r.retried+r.failed,0,'A delivered response is never sent again');
  await assert.rejects(()=>run("UPDATE notification_notices SET state='queued' WHERE event_ref=?",first),/notification_notice_transition/);
  for(const n of seen){assert.deepEqual(Object.keys(n).sort(),['idempotencyKey','kind','outboxId','projectId','recipient','template']);assert.equal(n.kind,'account');assert.equal(n.projectId,null);assert.ok(!JSON.stringify(n).includes('PRIVATE'));}
  // Rejection is terminal; exhaustion after the bounded number of attempts is terminal.
  const second=await answered(c);mode='reject';r=await drain(new Date(t0.getTime()+48*3600000));assert.equal(r.failed,1);
  assert.deepEqual({...await notice(second)},{state:'failed',attempts:1,reason:'rejected'});assert.equal((await api(c,'/requests/'+second)).request.delivery.state,'failed');assert.equal((await api(c,'/requests/'+second)).request.response.saved,true);
  const third=await answered(c);mode='down';let at=t0.getTime()+72*3600000,failed=0;for(let i=0;i<8&&!failed;i++){failed+=(await drain(new Date(at))).failed;at+=3*3600000;}
  assert.equal(failed,1);assert.deepEqual({...await notice(third)},{state:'failed',attempts:outbox.maxNoticeAttempts,reason:'exhausted'});
  // A lost reply is held as unknown-outcome and shown as still pending, never resent.
  const lost=await answered(c);mode='throw';const beforeLost=seen.length;r=await drain(new Date(at));assert.equal(r.failed,1);assert.equal(seen.length,beforeLost+1);
  assert.equal((await notice(lost)).state,'unknown-outcome');assert.equal((await api(c,'/requests/'+lost)).request.delivery.state,'queued');mode='up';await drain(new Date(at+3600000));assert.equal(seen.length,beforeLost+1,'An uncertain call is never resent');
  // A response read before delivery is never queued, and one read after queueing is cancelled before any call (late provider enablement never notifies readers).
  at+=86400000;const fourth=await answered(c);await api(c,'/requests/'+fourth+'/read','POST',{version:1});mode='up';const before=seen.length;
  r=await drain(new Date(at));assert.equal(seen.length,before);assert.equal((await row('SELECT count(*) n FROM notification_notices WHERE event_ref=?',fourth)).n,0);
  const late=await answered(c);await delivery.queueSupportNotices(db,settings,{now:new Date(at)});await api(c,'/requests/'+late+'/read','POST',{version:1});
  r=await outbox.runNotificationDelivery(db,shared,sender,{now:new Date(at)});assert.equal(seen.length,before);assert.equal(r.cancelled,1);assert.equal((await notice(late)).state,'cancelled');assert.equal((await api(c,'/requests/'+late)).request.delivery.state,'cancelled');
  // Concurrent drains cannot double send one attempt.
  at+=86400000;const fifth=await answered(c);mode='up';let sends=0;const counting=async()=>{sends++;return {accepted:true};};
  await delivery.queueSupportNotices(db,settings,{now:new Date(at)});await Promise.all([outbox.runNotificationDelivery(db,shared,counting,{now:new Date(at)}),outbox.runNotificationDelivery(db,shared,counting,{now:new Date(at)})]);assert.equal(sends,1,'One claim wins');assert.equal((await notice(fifth)).state,'accepted');
  // G-E5: an account without a verified address is never queued, and one whose address stops being verified after queueing is cancelled before any call.
  at+=86400000;const u=await owner();await run("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')",u.user);const sixth=await answered(u);const sentBefore=seen.length+sends;
  r=await drain(new Date(at));assert.equal(seen.length+sends,sentBefore,'nothing is sent to an unverified address');assert.equal((await row('SELECT count(*) n FROM notification_notices WHERE event_ref=?',sixth)).n,0);assert.equal((await api(u,'/requests/'+sixth)).request.response.saved,true);
  const w=await owner();await run("INSERT INTO workspace_state(user_id,step) VALUES(?,'ready')",w.user);await verify(w);const seventh=await answered(w);await delivery.queueSupportNotices(db,settings,{now:new Date(at)});
  await run('UPDATE users SET email_verified_at=NULL,email_verified_via=NULL WHERE id=?',w.user);r=await outbox.runNotificationDelivery(db,shared,sender,{now:new Date(at)});assert.equal(seen.length+sends,sentBefore,'nothing is sent once the address is no longer verified');assert.equal(r.cancelled,1);assert.equal((await notice(seventh)).state,'cancelled');
 });
 await test('outage and deletion: support survives Chat failure; account deletion cascades',async()=>{
  const chat=await worker.fetch(new Request('https://whumpo.com/api/chat',{method:'POST',headers:{cookie:'__Host-whumpo_session='+a.auth.token,origin:'https://whumpo.com','content-type':'application/json'},body:JSON.stringify({id:id(),revision:0,content:'hello'})}),env,ctx);
  assert.equal(chat.status,409);
  assert.equal((await api(a)).requests.length,2);
  await db.prepare('DELETE FROM users WHERE id=?').bind(a.user).run();
  assert.equal((await row('SELECT count(*) n FROM usage_review_requests WHERE user_id=?',a.user)).n,0);
 });
 assert.equal(network,0);
 console.log('Support access passed ('+cases+' cases): identity-only access outside Chat/onboarding, own stuck-operation inventory, structured status links, strict idempotent submission, cross-tenant and internal-evidence privacy, preview-bound operator response, distinct saved/delivered/read states, provider gating, bounded content-free delivery retries and account-deletion cascade.');
}finally{globalThis.fetch=originalFetch;await fixture.close();}
