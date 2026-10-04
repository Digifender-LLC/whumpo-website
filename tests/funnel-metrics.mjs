import assert from 'node:assert/strict';
import {timingSafeEqual} from 'node:crypto';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
import {currentFixtureModules} from './helpers/current-modules.mjs';
import {authenticator} from './helpers/webauthn-authenticator.mjs';
import {funnelReport,funnelFamilies} from '../tools/report-funnel.mjs';
import {accountClosureInventory} from '../tools/account-closure-inventory.mjs';
Error.stackTraceLimit=0;
// WH-025 synthetic funnel replay. Actual handlers write the receipts; the current
// schema's consent-gated triggers derive events. Run with --d1 for local D1.
const paths=['src/chat-interactions/store.ts','src/chat-interactions/continuation.ts','src/project-specification/store.ts','src/onboarding.ts','src/profile.ts','src/chat.ts','src/index.ts',
 'src/funnel-metrics/events.ts','src/workspace-identity/recovery.ts','src/workspace-identity/kits.ts','src/workspace-identity/ceremonies.ts'];
const modules=await currentFixtureModules(paths),mod=path=>modules.module(path);
const store=await mod(paths[0]),continuation=await mod(paths[1]),site=await mod(paths[2]),onboarding=await mod(paths[3]),profile=await mod(paths[4]),chat=await mod(paths[5]),worker=(await mod(paths[6])).default;
const funnel=await mod(paths[7]),recovery=await mod(paths[8]),kits=await mod(paths[9]),ceremonies=await mod(paths[10]),identity=modules.identity;
crypto.subtle.timingSafeEqual=(a,b)=>timingSafeEqual(Buffer.from(a),Buffer.from(b));
const fixture=await databaseFixture(),{db}=fixture,id=()=>crypto.randomUUID();let cases=0;
const marker='FUNNEL-PRIVATE-'+id().slice(0,8).toUpperCase();
const run=(q,...p)=>db.prepare(q).bind(...p).run(),row=(q,...p)=>db.prepare(q).bind(...p).first(),rows=async(q,...p)=>(await db.prepare(q).bind(...p).all()).results;
const events=user=>rows('SELECT event,dimension,source_key,occurred_at FROM funnel_events WHERE user_id=? ORDER BY event,dimension,source_key',user);
const tally=async user=>Object.fromEntries((await rows('SELECT event||\'/\'||dimension AS k,count(*) AS n FROM funnel_events WHERE user_id=? GROUP BY k',user)).map(r=>[r.k,r.n]));
// The hourly maintenance sweep derives events; running it twice proves replay idempotency.
const derive=async(now)=>{const first=await funnel.deriveFunnelEvents(db,now);assert.equal(await funnel.deriveFunnelEvents(db,now),0,'A repeated sweep adds nothing');return first;};
/** Receipt and consent times share whole-second precision; separate them explicitly. */
const nextSecond=()=>new Promise(resolve=>setTimeout(resolve,1001-Date.now()%1000));
async function test(name,fn){try{await fn();cases++;}catch(e){console.error(name,String(e));throw e;}}
const originalFetch=globalThis.fetch;let network=0;
globalThis.fetch=async url=>{network++;assert.equal(String(url),'https://challenges.cloudflare.com/turnstile/v0/siteverify');return Response.json({success:true,hostname:'whumpo.com',action:'register'});};
const env={DB:db,ENVIRONMENT:'test',TURNSTILE_SECRET:'synthetic-turnstile-secret',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}},ctx={waitUntil:()=>{}};
const http=(o,path,data)=>worker.fetch(new Request('https://whumpo.com'+path,{method:data?'POST':'GET',headers:{origin:'https://whumpo.com',...(data?{'content-type':'application/json'}:{}),cookie:'__Host-whumpo_session='+o.authority.token},...(data?{body:JSON.stringify(data)}:{})}),env,ctx);
const revision=o=>row('SELECT revision FROM workspace_state WHERE user_id=?',o.user).then(r=>r.revision);
async function origin(o){const turn=id();await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at) SELECT ?,user_id,revision+1,?,'Please review the text.',strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM workspace_state WHERE user_id=?",turn,'Change my page '+marker,o.user);await run('UPDATE workspace_state SET revision=revision+1 WHERE user_id=?',o.user);return turn;}

/** Real welcome handlers. The consent choice rides the same profile save as the bio step. */
async function welcomed(consent){
 const authority=await workspaceFixture(db,identity),user=authority.account,scope=await authority.scope(),o={authority,user,scope};
 await profile.updateProfile(scope,user,{revision:0,name:'River '+marker,about_me:'Bio '+marker,share_context:false,...(consent===undefined?{}:{measurement_consent:consent})});
 await onboarding.readOnboarding(scope,user);
 await onboarding.saveOnboarding(scope,user,{revision:0,stage:'review',prompt:'review',project_name:'Garden '+marker,idea:'Idea '+marker,audience:'Audience '+marker,preferred_theme:'forest'});
 await Promise.all([onboarding.completeOnboarding(scope,user,{revision:1}),onboarding.completeOnboarding(scope,user,{revision:1})]);
 o.project=(await row('SELECT id FROM projects WHERE owner_user_id=?',user)).id;
 await run("INSERT INTO feature_preview_grants VALUES(?,1,?,?,'core.editing','prepare','private-test-acceptance','synthetic funnel fixture',unixepoch()-1,unixepoch()+3600,unixepoch(),NULL)",id(),user,o.project);
 return o;
}
/** Actual first website creation, form issue/draft/reject/submit/continue, reviewed save and publication. */
async function journey(o){
 const turn=id(),created=await site.createWebsite(o.scope,o.user,turn,o.project,{name:'Garden '+marker,headline:'Headline '+marker,description:'Care '+marker,theme:'ocean',aboutTitle:'Our work',aboutText:'About '+marker,sections:[{heading:'Services',text:'Planting '+marker}],photos:[]});
 const r=await revision(o);
 await o.scope.batch([o.scope.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,?,'Create my website',?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),'ai','pending')").bind(turn,o.user,r+1,created.reply),...created.statements,o.scope.prepare("UPDATE chat_turns SET status='completed' WHERE id=?").bind(turn),o.scope.prepare('UPDATE workspace_state SET revision=? WHERE user_id=?').bind(r+1,o.user)]);
 const form=await store.issueContentBrief(o.scope,o.user,{originTurnId:await origin(o),projectId:o.project,contentIds:['headline','section-1-text']});
 const base=(operation,answerRevision)=>({version:1,requestId:id(),interactionId:form.envelope.id,definitionDigest:form.envelope.definitionDigest,expectedAnswerRevision:answerRevision,operation,answers:{'field-1':'Answer '+marker,'field-2':'Detail '+marker}});
 await store.mutateInteraction(o.scope,o.user,base('save-draft',0));
 const invalid={...base('submit',1),answers:{'field-1':''}};
 for(let i=0;i<2;i++)await assert.rejects(()=>store.mutateInteraction(o.scope,o.user,invalid),e=>e.fieldId==='field-1');
 const submit=base('submit',1);await store.mutateInteraction(o.scope,o.user,submit);await store.mutateInteraction(o.scope,o.user,submit);
 await continuation.continueContentBrief(o.scope,o.user,submit.requestId,await revision(o));
 const review=await site.readSpecificationProposal(o.scope,o.user,submit.requestId),apply={id:id(),revision:await revision(o),action:{type:'specificationApply',reviewId:review.id,proposalDigest:review.proposal_digest,expectedRevision:review.expected_revision}};
 for(let i=0;i<2;i++){const response=await http(o,'/api/chat/actions',apply);assert.equal(response.status,200,await response.text());}
 const version=apply.id,publish=id(),state=async()=>(await chat.readChat(o.scope,o.user)).state.revision;
 assert.equal((await chat.sendChat(o.scope,o.user,{content:'/publish '+version,id:publish,revision:await state()})).status,200);
 const confirm=id(),current=await state();
 for(let i=0;i<2;i++)assert.equal((await chat.sendChat(o.scope,o.user,{content:'/confirm '+publish,id:confirm,revision:current})).status,200);
 const second=await store.issueContentBrief(o.scope,o.user,{originTurnId:await origin(o),projectId:o.project,contentIds:['headline']});
 await store.mutateInteraction(o.scope,o.user,{version:1,requestId:id(),interactionId:second.envelope.id,definitionDigest:second.envelope.definitionDigest,expectedAnswerRevision:0,operation:'cancel'});
 return {version};
}
/** Synthetic later visits: owner Chat turns dated after welcome completion. */
async function visit(o,days){
 const welcome=await row('SELECT completed_at FROM welcome_onboarding WHERE user_id=?',o.user);
 const at=new Date(Date.parse(welcome.completed_at)+days*86400000).toISOString();
 await run("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at) SELECT ?,user_id,revision+1,'Back again','Welcome back.',? FROM workspace_state WHERE user_id=?",id(),at,o.user);await run('UPDATE workspace_state SET revision=revision+1 WHERE user_id=?',o.user);
}
const allowedEvents=new Set(Object.values(funnelFamilies).flat());
async function assertContentFree(secrets){
 const stored=await rows('SELECT * FROM funnel_events'),text=JSON.stringify(stored);
 assert.ok(!text.includes(marker),'no seeded private marker');assert.doesNotMatch(text,/@|example\.invalid/,'no email');
 for(const secret of secrets)assert.ok(!text.includes(secret),'no private identifier or secret');
 for(const r of stored){
  assert.deepEqual(Object.keys(r).sort(),['dimension','event','occurred_at','source_key','user_id']);assert.ok(allowedEvents.has(r.event));
  assert.match(r.source_key,/^[a-z_]+:[0-9a-z_-]+$|^welcome$/);assert.match(r.occurred_at,/^\d{4}-\d\d-\d\dT\d\d:\d\dZ$/);
 }
}
try{
 await test('contract rejects unlisted events, free text, credentials and changes',async()=>{
  const o=await workspaceFixture(db,identity),insert=(event,dimension,key='k:1',at='2026-10-04T12:00Z')=>run('INSERT INTO funnel_events VALUES(?,?,?,?,?)',o.account,event,dimension,key,at);
  for(const [event,dimension,key,at] of [['page_viewed','welcome'],['welcome_completed','website'],['draft_created','My bakery'],['interaction_submitted','field-1'],['welcome_completed','welcome','a b'],['welcome_completed','welcome','x@example.invalid'],['welcome_completed','welcome','x'.repeat(161)],['welcome_completed','welcome','k:1','2026-10-04T12:00:01.000Z']])
   await assert.rejects(()=>insert(event,dimension,key,at),/CHECK|constraint/i);
  await insert('welcome_completed','welcome');await assert.rejects(()=>run("UPDATE funnel_events SET dimension='welcome' WHERE user_id=?",o.account),/funnel_event_immutable/);
  await funnel.recordInteractionValidationFailure(db,o.account,'custom@1','not-a-request');
  assert.equal((await row('SELECT count(*) n FROM funnel_events WHERE user_id=?',o.account)).n,1);
  await run('DELETE FROM funnel_events WHERE user_id=?',o.account);
  await assert.rejects(()=>profile.updateProfile(db,o.account,{revision:0,measurement_consent:'yes'}),e=>e.status===400);
  assert.equal((await profile.readProfile(db,o.account)).measurement_consent,0,'Measurement is off by default');
 });
 const silent=await welcomed(undefined),declined=await welcomed(false),owner=await welcomed(true);
 await test('opt-in default: no consent means no measurement, even for complete journeys',async()=>{
  await journey(silent);await journey(declined);await visit(declined,8);await derive();
  assert.equal((await row('SELECT count(*) n FROM funnel_events WHERE user_id IN (?,?)',silent.user,declined.user)).n,0);
 });
 await test('consenting synthetic journey records exactly one event per receipt despite replays',async()=>{
  await journey(owner);await visit(owner,3);await visit(owner,8);await visit(owner,9);await visit(owner,31);
  const handled=await tally(owner.user);for(const key of ['interaction_validation_failed/content_change','interaction_started/content_change','interaction_canceled/content_change'])assert.equal(handled[key],1,'Handler-side recorder before the sweep: '+key);
  assert.equal(handled['publication_confirmed/website_publish'],undefined,'Receipt-derived events wait for the sweep');
  assert.ok(await derive()>0);
  assert.deepEqual(await tally(owner.user),{'welcome_completed/welcome':1,'draft_created/website':1,'interaction_started/content_change':2,'interaction_draft_saved/content_change':1,
   'interaction_validation_failed/content_change':1,'interaction_submitted/content_change':1,'interaction_resumed/content_change':1,'interaction_continued/succeeded':1,
   'interaction_canceled/content_change':1,'edit_accepted/website_content':1,'review_prepared/website_publish':1,'publication_confirmed/website_publish':1,
   'workspace_returned/day_7':1,'workspace_returned/day_30':1});
  await assertContentFree([silent.user,declined.user,silent.project,declined.project]);
 });
 await test('operator aggregate matches operation receipts and suppresses small cells',async()=>{
  const report=await funnelReport(db,{minimumAccounts:1});
  for(const metric of ['welcome_completed','draft_created/website','edit_accepted/website_content','review_prepared/website','publication_confirmed','interaction_started','interaction_draft_saved','interaction_submitted','interaction_canceled','interaction_continued'])
   assert.equal(report.receiptComparison.find(c=>c.metric===metric).status,'match',metric);
  assert.deepEqual(report.activation.stages,{welcome_completed:{accounts:1},first_draft:{accounts:1},accepted_edit:{accounts:1},review_prepared:{accounts:1},publication_confirmed:{accounts:1},returned_day_7:{accounts:1},returned_day_30:{accounts:1}});
  assert.equal(report.activation.timeToFirstPublication.accounts,1);assert.equal(report.coverage.consenting.accounts,1);
  const suppressed=await funnelReport(db);assert.equal(suppressed.minimumAccounts,5);
  assert.ok(Object.values(suppressed.activation.stages).every(s=>s.suppressed));assert.ok(suppressed.receiptComparison.every(c=>c.suppressed&&!('events' in c)));
  assert.ok(suppressed.activation.events.every(c=>c.suppressed));assert.ok(suppressed.activation.timeToFirstDraft.suppressed);
  const text=JSON.stringify([report,suppressed]);
  for(const secret of [marker,owner.user,owner.project,silent.user,'@'])assert.ok(!text.includes(secret),'report is content- and identifier-free');
  await assert.rejects(()=>funnelReport(db,{days:181}),/Invalid/);await assert.rejects(()=>funnelReport(db,{minimumAccounts:0}),/Invalid/);
 });
 await test('withdrawal deletes recorded events and stops recording; renewed consent is not retroactive',async()=>{
  const before=(await profile.readProfile(db,owner.user)).revision;
  await profile.updateProfile(owner.scope,owner.user,{revision:before,measurement_consent:false});
  assert.equal((await row('SELECT count(*) n FROM funnel_events WHERE user_id=?',owner.user)).n,0);
  assert.equal((await profile.readProfile(db,owner.user)).measurement_consent,0);
  await store.issueContentBrief(owner.scope,owner.user,{originTurnId:await origin(owner),projectId:owner.project,contentIds:['headline']});await derive();
  assert.equal((await row('SELECT count(*) n FROM funnel_events WHERE user_id=?',owner.user)).n,0,'Withdrawn accounts are not measured');
  // A later choice is not retroactive: the earlier complete journey stays unmeasured.
  await nextSecond();
  await profile.updateProfile(silent.scope,silent.user,{revision:(await profile.readProfile(db,silent.user)).revision,measurement_consent:true});await derive();
  assert.equal((await row('SELECT count(*) n FROM funnel_events WHERE user_id=?',silent.user)).n,0,'No backfill from receipts before the current consent');
  const form=await store.issueContentBrief(silent.scope,silent.user,{originTurnId:await origin(silent),projectId:silent.project,contentIds:['headline']});
  await store.mutateInteraction(silent.scope,silent.user,{version:1,requestId:id(),interactionId:form.envelope.id,definitionDigest:form.envelope.definitionDigest,expectedAnswerRevision:0,operation:'cancel'});await derive();
  assert.deepEqual(await tally(silent.user),{'interaction_started/content_change':1,'interaction_canceled/content_change':1},'Cancellation keeps its template family');
  const report=await funnelReport(db,{minimumAccounts:1});
  assert.ok(report.receiptComparison.every(c=>c.status==='match'),JSON.stringify(report.receiptComparison));
 });
 await test('bounded retention, per-account quota and account deletion',async()=>{
  const old=new Date(Date.now()-181*86400000).toISOString().slice(0,16)+'Z';
  await run("INSERT INTO funnel_events VALUES(?,'draft_created','application','application:retention-fixture',?)",silent.user,old);
  await funnel.cleanupFunnelEvents(db);
  assert.equal((await row("SELECT count(*) n FROM funnel_events WHERE source_key='application:retention-fixture'")).n,0);
  assert.equal((await row('SELECT count(*) n FROM funnel_events WHERE user_id=?',silent.user)).n,2,'Recent events remain');
  const later=Date.now()+181*86400000;await funnel.maintainFunnelEvents(db,later);await derive(later);
  assert.equal((await row('SELECT count(*) n FROM funnel_events WHERE user_id=?',silent.user)).n,0,'Pruned events are never re-derived from retained receipts');
  const closing=await workspaceFixture(db,identity);await profile.updateProfile(db,closing.account,{revision:0,measurement_consent:true});
  await run("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<2000) INSERT INTO funnel_events SELECT ?,'interaction_validation_failed','other','validation:'||i,'2026-10-04T12:00Z' FROM n",closing.account);
  await funnel.recordInteractionValidationFailure(db,closing.account,'choice@1',id());
  assert.equal((await row('SELECT count(*) n FROM funnel_events WHERE user_id=?',closing.account)).n,2000,'Quota stops further rows');
  assert.equal((await accountClosureInventory(db,closing.account)).counts.funnelEvents,2000);
  await run('DELETE FROM users WHERE id=?',closing.account);
  assert.equal((await row('SELECT count(*) n FROM funnel_events WHERE user_id=?',closing.account)).n,0,'Account deletion cascades');
 });
 await test('identity friction is measured separately, after consent, without credentials or recovery data',async()=>{
  const request=()=>new Request('https://whumpo.com/api/auth/identity/v1/test',{method:'POST',headers:{origin:'https://whumpo.com'}});
  const current=a=>identity.resolveIdentity(db,{version:1,client:'web',kind:a.kind,token:a.token}),input=credential=>({version:1,credential}),counters=new Map();
  const intent=p=>({version:1,requestId:id(),attemptId:p.attempt?.id??null,expectedRevision:p.attempt?.revision??p.credentialRevision,expectedEpoch:p.authEpoch});
  const offered=(p,k)=>({...intent(p),offerId:k.offer.id,generation:k.offer.generation});
  const assertion=(key,options)=>key.assertion(options,counters.set(key.id,(counters.get(key.id)??0)+1).get(key.id));
  async function add(f){const p=await current(f.access),key=authenticator(),options=await ceremonies.addPasskeyOptions(request(),env,p,{version:1,requestId:id(),attemptId:p.attempt?.id??null,expectedRevision:p.attempt?.revision??p.credentialRevision,name:'Key '+marker});
   await ceremonies.addPasskeyVerify(request(),env,p,options.challengeToken,input(key.registration(options.options)));f.keys.push(key);return key;}
  async function kit(f){const p=await current(f.access),k=await kits.prepareKit(request(),env,p,intent(p)),updated=await current(f.access);await kits.acknowledgeKit(request(),env,updated,{...offered(updated,k),saved:true});return k;}
  async function fresh(f){const p=await current(f.access),options=await ceremonies.reauthenticationOptions(request(),env,p,{version:1});f.access=await ceremonies.reauthenticationVerify(request(),env,p,options.challengeToken,input(assertion(f.keys.at(-1),options.options)));return f.access.principal;}
  const email=marker.toLowerCase()+'@example.invalid',code=id();
  await run("INSERT INTO invitations VALUES(?,strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now','+1 hour'),NULL,NULL)",await identity.hashToken(code));
  const start=await ceremonies.signupOptions(request(),env,{version:1,email,inviteCode:code,usBased:true,turnstileToken:id()}),key=authenticator();
  const f={keys:[key],access:await ceremonies.signupVerify(request(),env,start.challengeToken,input(key.registration(start.options)))},account=f.access.principal.accountId;
  await add(f);f.kit=await kit(f);const p=await fresh(f);f.access=(await kits.completeEnrollment(request(),env,p,offered(p,f.kit))).authority;
  await derive();assert.equal((await row('SELECT count(*) n FROM funnel_events WHERE user_id=?',account)).n,0,'Signup precedes any measurement choice');
  await nextSecond();await profile.updateProfile(db,account,{revision:0,measurement_consent:true});await derive();
  assert.equal((await row('SELECT count(*) n FROM funnel_events WHERE user_id=?',account)).n,0,'Consent is not retroactive');

  const enrolled=f.kit,workspaceKit=(await add(f),await kit(f));
  f.access=await recovery.startRecovery(request(),env,{version:1,email,key:enrolled.key});
  const rp=await current(f.access),lostIds=(await recovery.readRecoveryState(db,rp)).keys.filter(k=>k.status==='active').map(k=>k.id),review={...intent(rp),mode:'all',lostIds};
  await recovery.reviewRecovery(request(),env,rp,review);
  const replacement=await kit(f),sp=await current(f.access);f.access=(await recovery.secureRecovery(request(),env,sp,{...offered(sp,replacement),reviewId:review.requestId,confirmation:'secure-account'})).authority;
  await add(f);await add(f);
  const cp=await current(f.access),state=await recovery.readRecoveryState(db,cp),change={...intent(cp),reviewId:state.review.id,generation:state.generation},options=await recovery.recoveryCompletionOptions(request(),env,cp,change);
  await recovery.recoveryCompletionVerify(request(),env,cp,options.challengeToken,input(assertion(f.keys.at(-1),options.options)));await derive();
  assert.deepEqual(await tally(account),{'passkey_registered/workspace_added':1,'recovery_kit_saved/workspace':1,'recovery_started/recovery':1,'recovery_kit_saved/recovery':1,'recovery_secured/recovery':1,'passkey_registered/recovery_replacement':2,'recovery_completed/recovery':1});
  const secrets=[...(await rows('SELECT id FROM identity_credentials')).map(r=>r.id),...(await rows('SELECT token_hash FROM identity_sessions UNION ALL SELECT token_hash FROM identity_grants')).map(r=>r.token_hash),
   ...(await rows('SELECT verifier FROM identity_kit_offers UNION ALL SELECT kit_verifier FROM identity_accounts WHERE kit_verifier IS NOT NULL')).map(r=>r.verifier),enrolled.key,workspaceKit.key,replacement.key,email];
  await assertContentFree(secrets);
  const report=await funnelReport(db,{minimumAccounts:1});
  assert.ok(report.identity.events.some(e=>e.event==='recovery_completed'));assert.ok(!report.activation.events.some(e=>e.event.startsWith('recovery')),'Identity reported separately from welcome');
  assert.ok(report.receiptComparison.every(c=>c.status==='match'),'Pre-consent signup/enrollment receipts are excluded from both sides');
  for(const secret of secrets)assert.ok(!JSON.stringify(report).includes(secret));
 });
 assert.equal(network>0,true);
 console.log(`Funnel metrics passed (${process.argv.includes('--d1')?'local D1':'SQLite'}): ${cases} cases; actual welcome/form/website/publication/identity handlers, opt-in default, replay idempotency, withdrawal deletion, retention, quota, account cascade, receipt comparison, small-cell suppression and seeded-marker scans.`);
}finally{globalThis.fetch=originalFetch;await fixture.close();}
