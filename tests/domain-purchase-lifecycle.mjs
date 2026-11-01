import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {DatabaseSync} from 'node:sqlite';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {databaseFixture} from './helpers/current-database.mjs';
import {sqliteD1Adapter} from './sqlite-d1.mjs';
import {currentSchema} from '../tools/current-schema.mjs';

// WH-196: renewal opt-in, renewal approval, expiry reminders, hosting entry, transfer-out and disconnect of a purchased name over the actual current schema.
// On SQLite the two clients are two real connections to one file; with --d1 they share the actual local D1. Synthetic registrar and names only: no network,
// registrar, payment provider, Stripe key, sender or real domain. A reminder is a queued outbox row and nothing is sent.
const bundle=await build({stdin:{contents:"export * from './src/domain-purchase/store';export * from './src/domain-purchase/lifecycle';export * from './src/domain-purchase/order';export * from './src/domain-purchase/quote';export * from './src/domain-purchase/registrar';export * from './src/domain-purchase/renewal';export {claimProofHolds} from './src/domain-hosting';",resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent'});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const d1=process.argv.includes('--d1'),fixture=await databaseFixture({d1});
let directory,files=[],A=fixture.db,B=fixture.db;
if(!d1){
 directory=await mkdtemp(join(tmpdir(),'whumpo-domain-lifecycle-'));
 const open=()=>{const sql=new DatabaseSync(join(directory,'domain.sqlite'));sql.exec('PRAGMA foreign_keys=ON;PRAGMA busy_timeout=5000');return sql;};
 const first=open();first.exec('PRAGMA journal_mode=WAL');first.exec(await currentSchema());const second=open();files=[first,second];
 A=sqliteD1Adapter(first);B=sqliteD1Adapter(second);
}
const run=(sql,...v)=>A.prepare(sql).bind(...v).run(),all=async(sql,...v)=>(await A.prepare(sql).bind(...v).all()).results,one=(sql,...v)=>A.prepare(sql).bind(...v).first();
const count=async(sql,...v)=>Object.values(await one(sql,...v))[0];
const refuse=(p,re)=>assert.rejects(p,re);
let cases=0;const check=async(name,fn)=>{try{await fn();cases++;}catch(e){console.error('FAILED:',name);throw e;}};

const HOUR=3600000,DAY=86400000,T0=1_800_000_000_000,MINUTE=60000;
const policy={pricing:{markupCents:0,feeCents:30,taxBasisPoints:800},allowPremium:false};
const owners={a:{id:'owner-a',project:'project-a',pm:'pm-a'},b:{id:'owner-b',project:'project-b',pm:'pm-b'}};
for(const o of Object.values(owners)){
 await run("INSERT INTO users(id,email,created_at) VALUES(?,?,'2026-10-31')",o.id,o.id+'@example.test');
 await run("INSERT INTO projects(id,owner_user_id,name,created_at,updated_at) VALUES(?,?,'Synthetic','2026-10-31','2026-10-31')",o.project,o.id);
}
const fundingOf=o=>({coverage:null,paymentMethod:{kind:'payment-method',id:owners[o].pm}});
const actorOf=o=>({kind:'owner',ownerId:owners[o].id});
const projectOf=o=>({projectId:owners[o].project,ownerId:owners[o].id,revision:1});
let seq=0;const id=p=>`${p}-${String(++seq).padStart(4,'0')}`;
let names=0;
const clock={now:T0};
// One registrar for every name, as in production: reconciliation reads it for all open requests.
const shared=m.createSyntheticRegistrar({clock:()=>clock.now});
function registrar(host){shared.setPrice(host,{registration:1050,renewal:1150});return shared;}
/** A registered name, bought through the real store path at T0 with its order dispatched. */
async function registered(o='a'){
 const host=`synthetic-l${++names}.com`,reg=registrar(host);clock.now=T0;
 const prep=await m.prepareDomainPurchase({actor:actorOf(o),request:{contractVersion:1,projectId:owners[o].project,hostname:host},project:projectOf(o),owner:fundingOf(o),registrar:reg,policy,ids:{quoteId:id('quote'),reviewId:id('review')},now:T0});
 await m.saveReview(A,prep.quote,prep.review,T0);
 const accept={contractVersion:1,reviewId:prep.review.reviewId,quoteDigest:prep.review.quoteDigest,consentTextDigest:prep.review.consentTextDigest,decision:'accept'};
 const step=await m.consent({db:A,actor:actorOf(o),submission:accept,reviewId:prep.review.reviewId,project:projectOf(o),owner:fundingOf(o),registrar:reg,policy,orderId:id('order'),now:T0+1});
 await m.reserve(A,owners[o].id,step.order.orderId,T0+2);
 await m.dispatch({db:A,ownerId:owners[o].id,orderId:step.order.orderId,owner:fundingOf(o),project:projectOf(o),registrar:reg,policy,now:T0+3});
 const registration=await m.loadRegistration(A,owners[o].id,host);assert.equal(registration.state,'active');
 return {host,reg,registration};
}
const renewalState=async host=>{const r=await one('SELECT auto_renew,renewal_review_id,renewal_total_cents,state FROM domain_registrations WHERE hostname=?',host);return {...r};};
const prepare=(db,o,host,reg,reviewId=id('renewal'),now=T0+DAY,actor=actorOf(o))=>m.prepareRenewalReview({db,actor,hostname:host,registrar:reg,policy,reviewId,now});
const confirm=(db,o,prep,reg,now=T0+DAY+1,actor=actorOf(o),extra={})=>m.confirmRenewalReview({db,actor,submission:{contractVersion:1,reviewId:prep.review.reviewId,consentTextDigest:prep.review.consentTextDigest,...extra},registrar:reg,policy,now});

try{
 await check('renewal is off by default; the opt-in is an exact review that only the owner confirms, once, at the price shown',async()=>{
  const {host,reg,registration}=await registered();
  assert.equal(registration.autoRenew,false);assert.equal(registration.renewalOptIn,null);
  const prep=await prepare(A,'a',host,reg,id('renewal'),T0+DAY,{kind:'model',ownerId:owners.a.id});// the model may prepare
  assert.match(prep.consentText,/each year the renewal price, currently \$\d+\.\d\d/i);assert.equal(prep.review.renewalTotalCents,await m.currentRenewalTotal(host,reg,policy));
  await refuse(confirm(A,'a',prep,reg,T0+DAY+1,{kind:'model',ownerId:owners.a.id}),/MODEL_CANNOT_CONSENT/);
  await refuse(confirm(A,'b',prep,reg),/FOREIGN_OWNER/);
  await refuse(confirm(A,'a',prep,reg,T0+DAY+1,actorOf('a'),{consentTextDigest:'0'.repeat(64)}),/CONSENT_MISMATCH/);
  await refuse(confirm(A,'a',prep,reg,prep.review.expiresAt+1),/QUOTE_EXPIRED/);
  reg.setPrice(host,{renewal:1300});await refuse(confirm(A,'a',prep,reg),/PRICE_CHANGED/);reg.setPrice(host,{renewal:1150});
  assert.equal((await renewalState(host)).auto_renew,0,'nothing changed so far');
  // Skipping the module: the schema refuses auto-renew without a confirmed review for this name, owner and price.
  await refuse(run('UPDATE domain_registrations SET auto_renew=1,renewal_review_id=?,renewal_total_cents=? WHERE hostname=?',prep.review.reviewId,prep.review.renewalTotalCents,host),/domain_registration_renewal/);
  const [x,y]=await Promise.allSettled([confirm(A,'a',prep,reg),confirm(B,'a',prep,reg)]);
  assert.equal([x,y].filter(r=>r.status==='fulfilled').length,1,'a review confirms once');assert.match(String([x,y].find(r=>r.status==='rejected').reason.code),/REVIEW_NOT_OPEN/);
  const on=await renewalState(host);assert.deepEqual([on.auto_renew,on.renewal_review_id,on.renewal_total_cents],[1,prep.review.reviewId,prep.review.renewalTotalCents]);
  await refuse(confirm(A,'a',prep,reg),/REVIEW_NOT_OPEN/);
  await refuse(run('UPDATE domain_renewal_reviews SET renewal_total_cents=1 WHERE review_id=?',prep.review.reviewId),/domain_renewal_frozen/);
  // Foreign and model actors cannot prepare for another owner's name.
  await refuse(prepare(A,'b',host,reg,id('renewal'),T0+DAY),/FOREIGN_OWNER/);
  const off=await m.turnOffAutoRenew(A,actorOf('a'),host);assert.equal(off.autoRenew,false);assert.equal((await renewalState(host)).renewal_review_id,null);
  await refuse(m.turnOffAutoRenew(A,{kind:'model',ownerId:owners.a.id},host),/HUMAN_REVIEW_REQUIRED/);
 });

 await check('no renewal is approved without a current opt-in covering the price; a rise stops auto-renew until a new review',async()=>{
  const {host,reg,registration}=await registered();
  const expiry=registration.expiresAt;
  assert.deepEqual(await m.decideRenewal({db:A,hostname:host,registrar:reg,policy,now:expiry-DAY}),{renew:false,reason:'auto-renew-off'});
  assert.equal(await count('SELECT count(*) FROM domain_renewal_approvals WHERE hostname=?',host),0);
  await refuse(run('INSERT INTO domain_renewal_approvals(hostname,for_expiry,review_id,price_cents,approved_at) VALUES(?,?,?,1,?)',host,expiry,'forged',expiry-DAY),/domain_renewal_not_opted_in/);
  const prep=await prepare(A,'a',host,reg);await confirm(A,'a',prep,reg);
  const [d1x,d2x]=await Promise.all([m.decideRenewal({db:A,hostname:host,registrar:reg,policy,now:expiry-DAY}),m.decideRenewal({db:B,hostname:host,registrar:reg,policy,now:expiry-DAY})]);
  assert.deepEqual([d1x.renew,d2x.renew],[true,true]);assert.equal(await count('SELECT count(*) FROM domain_renewal_approvals WHERE hostname=?',host),1,'one approval per name and expiry');
  const approval=await one('SELECT review_id,price_cents,for_expiry FROM domain_renewal_approvals WHERE hostname=?',host);
  assert.deepEqual([approval.review_id,approval.price_cents,approval.for_expiry],[prep.review.reviewId,prep.review.renewalTotalCents,expiry]);
  await refuse(run('UPDATE domain_renewal_approvals SET price_cents=? WHERE hostname=?',prep.review.renewalTotalCents+1,host),/domain_renewal_not_opted_in/);
  await refuse(run('INSERT INTO domain_renewal_approvals(hostname,for_expiry,review_id,price_cents,approved_at) VALUES(?,?,?,?,?)',host,expiry+1,prep.review.reviewId,approval.price_cents,expiry-DAY),/domain_renewal_not_opted_in/);
  // A price rise: auto-renew goes off, nothing is approved for a later term, and a raw approval above the opted-in price is refused.
  reg.setPrice(host,{renewal:1500});
  const rise=await m.decideRenewal({db:A,hostname:host,registrar:reg,policy,now:expiry-DAY});assert.deepEqual(rise,{renew:false,reason:'renewal-price-changed'});
  assert.equal((await renewalState(host)).auto_renew,0);
  const again=await m.decideRenewal({db:A,hostname:host,registrar:reg,policy,now:expiry-DAY});assert.equal(again.reason,'auto-renew-off');
  const fresh=await prepare(A,'a',host,reg,id('renewal'),expiry-2*DAY);await confirm(A,'a',fresh,reg,expiry-2*DAY+1);
  assert.equal((await renewalState(host)).renewal_total_cents,fresh.review.renewalTotalCents);assert.ok(fresh.review.renewalTotalCents>prep.review.renewalTotalCents);
 });

 await check('a price-rise invalidation cannot undo an opt-in the owner confirmed while the decision was waiting on the registrar',async()=>{
  const {host,reg,registration}=await registered(),expiry=registration.expiresAt;
  const first=await prepare(A,'a',host,reg,id('renewal'),expiry-5*DAY);await confirm(A,'a',first,reg,expiry-5*DAY+1);
  reg.setPrice(host,{renewal:1500});
  // The owner confirms a new review at the higher price after the decision loaded the old opt-in and before its lookup returns.
  let fresh=null;const slow={...reg,lookup:async name=>{const found=await reg.lookup(name);if(!fresh){fresh=await prepare(B,'a',host,reg,id('renewal'),expiry-3*DAY);await confirm(B,'a',fresh,reg,expiry-3*DAY+1);}return found;}};
  const rise=await m.decideRenewal({db:A,hostname:host,registrar:slow,policy,now:expiry-DAY});assert.deepEqual(rise,{renew:false,reason:'renewal-price-changed'});
  const after=await renewalState(host);
  assert.equal(after.auto_renew,1,'the newer opt-in stays on');assert.equal(after.renewal_review_id,fresh.review.reviewId);assert.equal(after.renewal_total_cents,fresh.review.renewalTotalCents);
 });

 await check('expiry reminders follow the recovery schedule, queue one never-sent notice per name, kind and expiry, and the email names no domain',async()=>{
  const {host,registration}=await registered();const expiry=registration.expiresAt;
  assert.deepEqual([-40,-29,-8,-6,-1,0,1,3,5,6].map(d=>m.dueReminder(expiry,expiry+d*DAY)),[null,'month','month','week','week',null,'expired','expired',null,null]);
  const mine=()=>all("SELECT template,state,user_id,event_ref FROM notification_notices WHERE event_ref GLOB ? ORDER BY created_at,template",host+':*');
  await m.queueDueReminders(A,expiry-100*DAY);assert.equal((await mine()).length,0);
  await m.queueDueReminders(A,expiry-29*DAY);assert.equal((await mine()).length,1);
  const again=await m.queueDueReminders(B,expiry-29*DAY);assert.equal(again.queued,0,'a repeat queues nothing');assert.equal((await mine()).length,1);
  await m.queueDueReminders(A,expiry-6*DAY);await m.queueDueReminders(A,expiry+2*DAY);await m.queueDueReminders(A,expiry+9*DAY);
  const rows=await mine();
  assert.deepEqual(rows.map(r=>r.template).sort(),['domain.expiry-expired@1','domain.expiry-month@1','domain.expiry-week@1']);assert.ok(rows.every(r=>r.state==='queued'&&r.user_id===owners.a.id));
  assert.deepEqual(rows.map(r=>r.event_ref).sort(),['month','week','expired'].map(k=>`${host}:${k}:${expiry}`).sort());
  assert.ok(await count("SELECT count(*) FROM job_journal WHERE purpose='platform-email'")>=3,'envelopes exist, so the check below is not vacuous');assert.match(JSON.stringify(await all('SELECT event_ref FROM notification_notices')),new RegExp(host.replace('.','\\.')),'the outbox row keys on the name internally');
  assert.doesNotMatch(JSON.stringify(await all('SELECT envelope_json FROM job_journal')),new RegExp(host.replace('.','\\.')),'no domain name in a job envelope');
 });

 await check('transfer-out: owner only, after the 60-day lock, one provider unlock per request, replays and concurrent starts repeat nothing, the code never leaves the owner',async()=>{
  const {host,reg}=await registered();
  const start=(db,o=actorOf('a'),at=T0+61*DAY,requestId=id('transfer'))=>m.startTransferOut({db,actor:o,hostname:host,registrar:reg,requestId,now:at});
  await refuse(start(A,actorOf('a'),T0+30*DAY),/TRANSFER_LOCKED/);await refuse(start(A,{kind:'model',ownerId:owners.a.id}),/FOREIGN_OWNER/);await refuse(start(A,actorOf('b')),/NOT_ACTIVE/);
  assert.equal(reg.calls.transferOut,0);
  await refuse(run("INSERT INTO domain_transfer_requests(request_id,hostname,owner_user_id,state,requested_at,updated_at) VALUES('forged',?,?,'requested',?,?)",host,owners.a.id,T0+30*DAY,T0+30*DAY),/domain_transfer_scope/);
  const [x,y]=await Promise.all([start(A),start(B)]);
  assert.equal(reg.calls.transferOut,1,'one unlock for two concurrent starts');assert.equal(await count('SELECT count(*) FROM domain_transfer_requests WHERE hostname=?',host),1);
  assert.equal(x.request.requestId,y.request.requestId);assert.equal(x.request.state,'unlocked');assert.equal([x,y].filter(r=>r.replayed).length,1);
  const after=await renewalState(host);assert.deepEqual([after.state,after.auto_renew],['transfer-out',0]);
  assert.equal((await start(A)).replayed,true);assert.equal(reg.calls.transferOut,1);
  await refuse(run('DELETE FROM users WHERE id=?',owners.a.id),/domain_registration_active/);
  await refuse(run("UPDATE domain_registrations SET auto_renew=1,renewal_review_id='x',renewal_total_cents=1 WHERE hostname=?",host),/domain_registration_renewal/);
  // The code is read for the owner now: a model, visitor, operator, service or foreign owner gets nothing, and nothing stores it.
  for(const kind of ['model','visitor','operator','service'])await refuse(m.readAuthCode({db:A,actor:{kind,ownerId:owners.a.id},hostname:host,registrar:reg}),/AUTH_CODE_OWNER_ONLY/);
  await refuse(m.readAuthCode({db:A,actor:actorOf('b'),hostname:host,registrar:reg}),/TRANSFER_NOT_UNLOCKED/);
  assert.equal(reg.calls.authCode,0,'refused callers never reach the registrar read');
  const code=await m.readAuthCode({db:A,actor:actorOf('a'),hostname:host,registrar:reg});assert.equal(code.authCode,`SYNTHETIC-AUTH-${host}`);
  const second=await m.readAuthCode({db:A,actor:actorOf('a'),hostname:host,registrar:reg});assert.equal(second.authCode,code.authCode,'a lost response is recovered by reading again, not by a new unlock');assert.equal(reg.calls.transferOut,1);
  const dump=JSON.stringify([await all('SELECT * FROM domain_transfer_requests'),await all('SELECT * FROM domain_registrations'),await all('SELECT * FROM domain_registrar_events'),await all('SELECT * FROM notification_notices'),await all('SELECT envelope_json FROM job_journal')]);
  assert.doesNotMatch(dump,/SYNTHETIC-AUTH/,'the code has no column, event or job');
  for(const t of ['domain_quotes','domain_reviews','domain_orders','domain_funding_holds','domain_order_attempts','domain_registrar_events','domain_registrations','domain_registrant_contacts','domain_renewal_reviews','domain_renewal_approvals','domain_transfer_requests'].map(name=>({name})))assert.deepEqual((await all(`SELECT name FROM pragma_table_info('${t.name}')`)).map(r=>r.name).filter(n=>/auth|epp|secret|token|password|card|credential/i.test(n)),[],t.name);
  // The registrar reports the name gone: the request completes and the registration is released for purge.
  // Absence is never evidence: the name vanishing from lookups, however often it is read, leaves the transfer open; the registrar's own transfer-complete report completes it.
  reg.vanish(host);for(let i=0;i<4;i++)assert.deepEqual(await m.reconcileTransfers(A,reg,T0+62*DAY+i*7*HOUR),{moved:0});
  assert.equal((await m.loadTransfer(A,owners.a.id,host)).state,'unlocked');assert.equal((await renewalState(host)).state,'transfer-out');
  reg.completeTransfer(host);
  assert.deepEqual(await m.reconcileTransfers(A,reg,T0+62*DAY+HOUR),{moved:0},'inside the spacing');
  assert.deepEqual(await m.reconcileTransfers(A,reg,T0+64*DAY),{moved:1});
  assert.equal((await renewalState(host)).state,'transferred-out');assert.equal((await m.loadTransfer(A,owners.a.id,host)).state,'completed');
  await refuse(run("UPDATE domain_registrations SET state='active' WHERE hostname=?",host),/domain_registration_final/);
 });

 await check('a lost unlock is reconciled by reading, never repeated; a refusal returns the name to active; account purge waits for both',async()=>{
  const base=shared.calls.transferOut,lost=await registered('b');lost.reg.nextTransfer('timeout-after');
  const start=(r,at=T0+70*DAY,requestId=id('transfer'))=>m.startTransferOut({db:A,actor:actorOf('b'),hostname:r.host,registrar:r.reg,requestId,now:at});
  const first=await start(lost);assert.equal(first.request.state,'unknown-outcome');assert.equal(lost.reg.calls.transferOut-base,1);
  assert.equal((await start(lost)).replayed,true);assert.equal(lost.reg.calls.transferOut-base,1);
  await refuse(m.readAuthCode({db:A,actor:actorOf('b'),hostname:lost.host,registrar:lost.reg}),/TRANSFER_NOT_UNLOCKED/);
  await refuse(run('DELETE FROM users WHERE id=?',owners.b.id),/domain_registration_active/);
  assert.deepEqual(await m.reconcileTransfers(A,lost.reg,T0+71*DAY),{moved:1});
  assert.equal((await m.loadTransfer(A,owners.b.id,lost.host)).state,'unlocked');assert.equal(lost.reg.calls.transferOut-base,1,'reconciliation only reads');
  const kept=await registered('b');kept.reg.nextTransfer('timeout-before');
  assert.equal((await start(kept)).request.state,'unknown-outcome');
  assert.deepEqual(await m.reconcileTransfers(A,kept.reg,T0+71*DAY),{moved:0},'nothing unlocked, nothing proven');assert.equal((await m.loadTransfer(A,owners.b.id,kept.host)).state,'unknown-outcome');
  const refused=await registered('b');refused.reg.nextTransfer('rejected');
  const r=await start(refused);assert.equal(r.request.state,'failed');assert.equal((await renewalState(refused.host)).state,'active','a refused unlock leaves the name active');
  const retry=await start(refused,T0+72*DAY);assert.equal(retry.replayed,false);assert.equal(retry.request.state,'unlocked');
 });

 await check('G-D8: registrar evidence puts a purchased name in hosting through the ordinary claim; buying never connects it; only the owner of an active registration',async()=>{
  const {host}=await registered('a');
  assert.equal(await count('SELECT count(*) FROM domain_connections WHERE hostname=?',host),0,'a purchase creates no hosting connection');assert.equal(await count('SELECT count(*) FROM domain_claims WHERE hostname=?',host),0);
  await refuse(m.claimPurchasedName({db:A,actor:actorOf('b'),projectId:owners.a.project,hostname:host,now:T0+DAY}),/NOT_REGISTERED/);
  await refuse(m.claimPurchasedName({db:A,actor:{kind:'model',ownerId:owners.a.id},projectId:owners.a.project,hostname:host,now:T0+DAY}),/HUMAN_REVIEW_REQUIRED/);
  await refuse(m.claimPurchasedName({db:A,actor:actorOf('a'),projectId:owners.b.project,hostname:host,now:T0+DAY}),/NOT_REGISTERED/);
  await refuse(m.claimPurchasedName({db:A,actor:actorOf('a'),projectId:owners.a.project,hostname:'synthetic-unbought.com',now:T0+DAY}),/NOT_REGISTERED/);
  const claim=await m.claimPurchasedName({db:A,actor:actorOf('a'),projectId:owners.a.project,hostname:host,now:T0+DAY});
  const row=await one('SELECT * FROM domain_claims WHERE id=?',claim.claimId);assert.ok(row.verified_at&&row.token.startsWith('registrar-evidence:'));
  let dnsQueries=0;const transport=async()=>{dnsQueries++;return Response.json({Status:0,Answer:[]});};
  const stored={project_id:row.project_id,hostname:row.hostname,token:row.token};
  assert.equal(await m.claimProofHolds(A,stored,transport,T0+DAY),true);assert.equal(dnsQueries,0,'no DNS proof is needed for registrar evidence');
  const expiry=(await one('SELECT expires_at FROM domain_registrations WHERE hostname=?',host)).expires_at;
  assert.equal(await m.claimProofHolds(A,stored,transport,expiry),false,'an expired registration proves nothing');assert.equal(await m.claimProofHolds(A,stored,transport,expiry-1),true);
  assert.equal(new Date(row.expires_at).getTime()-new Date(row.verified_at).getTime(),7*DAY,'the claim lasts as long as a TXT claim');
  await refuse(m.claimPurchasedName({db:A,actor:actorOf('a'),projectId:owners.a.project,hostname:host,now:expiry}),/NOT_REGISTERED/);
  // The proof ends with the registration, and an ordinary TXT claim is still checked in DNS.
  await run("UPDATE domain_registrations SET state='lapsed' WHERE hostname=?",host);assert.equal(await m.claimProofHolds(A,stored,transport,T0+DAY),false);
  assert.equal(await m.claimProofHolds(A,{...stored,token:'plain-token'},transport,T0+DAY),false);assert.ok(dnsQueries>0);
  // A name is not hosted just because its token says so: a forged marker for a name nobody registered proves nothing.
  assert.equal(await m.claimProofHolds(A,{project_id:owners.a.project,hostname:'synthetic-unbought.com',token:'registrar-evidence:forged'},transport,T0+DAY),false);
 });

 await check('the registrar is read after the fact: foreign proof lapses a name at once, absence only after its expiry, a missing expiry is backfilled, the expiry never moves back',async()=>{
  const {host,reg,registration}=await registered();const expiry=registration.expiresAt;
  assert.equal((await m.syncRegistration({db:A,hostname:host,registrar:reg,now:T0+DAY})).expiresAt,expiry);
  await refuse(run('UPDATE domain_registrations SET expires_at=expires_at-1 WHERE hostname=?',host),/domain_registration_expiry/);
  // Absence ("not found") is not proof: the name stays active until its expiry has passed.
  reg.vanish(host);
  assert.equal((await m.syncRegistration({db:A,hostname:host,registrar:reg,now:expiry-DAY})).state,'active');
  // One not-found read after the expiry only notes the absence; a second, at least six hours later, lapses it (owner decision Q-17: a lapse is final, so it needs two reads).
  assert.equal((await m.syncRegistration({db:A,hostname:host,registrar:reg,now:expiry+DAY})).state,'active','one absent read is not enough');
  assert.equal((await one('SELECT absent_since FROM domain_registrations WHERE hostname=?',host)).absent_since,expiry+DAY);
  assert.equal((await m.syncRegistration({db:A,hostname:host,registrar:reg,now:expiry+DAY+HOUR})).state,'active','a second read inside the spacing does not count');
  assert.equal((await m.syncRegistration({db:A,hostname:host,registrar:reg,now:expiry+DAY+7*HOUR})).state,'lapsed');
  // A registration naming another known order is proof at any time.
  const other=await registered();other.reg.takeBy(other.host,'someone-elses-order');
  const lapsed=await m.syncRegistration({db:A,hostname:other.host,registrar:other.reg,now:T0+DAY});assert.equal(lapsed.state,'lapsed');assert.equal(lapsed.autoRenew,false);
  assert.equal((await m.listRegistrations(A,owners.a.id)).find(r=>r.hostname===other.host).state,'lapsed');assert.equal((await m.listRegistrations(A,owners.b.id)).some(r=>r.hostname===other.host),false);
  // A null reference proves nothing either way.
  const quiet=await registered();quiet.reg.takeBy(quiet.host,null);assert.equal((await m.syncRegistration({db:A,hostname:quiet.host,registrar:quiet.reg,now:T0+DAY})).state,'active');
  // A lost reply and an event without an expiry leave no expiry; that fails closed for hosting proof until a lookup that shows the name is ours fills it in.
  const host2=`synthetic-l${++names}.com`,reg2=registrar(host2);
  const prep=await m.prepareDomainPurchase({actor:actorOf('a'),request:{contractVersion:1,projectId:owners.a.project,hostname:host2},project:projectOf('a'),owner:fundingOf('a'),registrar:reg2,policy,ids:{quoteId:id('quote'),reviewId:id('review')},now:T0});
  await m.saveReview(A,prep.quote,prep.review,T0);
  const step=await m.consent({db:A,actor:actorOf('a'),submission:{contractVersion:1,reviewId:prep.review.reviewId,quoteDigest:prep.review.quoteDigest,consentTextDigest:prep.review.consentTextDigest,decision:'accept'},reviewId:prep.review.reviewId,project:projectOf('a'),owner:fundingOf('a'),registrar:reg2,policy,orderId:id('order'),now:T0+1});
  await m.reserve(A,owners.a.id,step.order.orderId,T0+2);reg2.next('timeout-after');
  await m.dispatch({db:A,ownerId:owners.a.id,orderId:step.order.orderId,owner:fundingOf('a'),project:projectOf('a'),registrar:reg2,policy,now:T0+3});
  await m.receiveRegistrarEvent(A,{eventId:id('evt'),orderId:step.order.orderId,attemptId:`${step.order.orderId}:a1`,type:'registered',authenticated:true},T0+4);
  assert.equal((await renewalState(host2)).state,'active');assert.equal((await one('SELECT expires_at FROM domain_registrations WHERE hostname=?',host2)).expires_at,null);
  await refuse(m.claimPurchasedName({db:A,actor:actorOf('a'),projectId:owners.a.project,hostname:host2,now:T0+5}),/NOT_REGISTERED/);
  assert.equal(await m.claimProofHolds(A,{project_id:owners.a.project,hostname:host2,token:'registrar-evidence:x'},async()=>assert.fail('no DNS'),T0+5),false);
  const filled=await m.syncRegistration({db:A,hostname:host2,registrar:reg2,now:T0+6});assert.ok(filled.expiresAt>T0,'a lookup that shows the name is ours backfills the expiry');
  assert.ok((await m.claimPurchasedName({db:A,actor:actorOf('a'),projectId:owners.a.project,hostname:host2,now:T0+7})).claimId);
 });

 await check('renewal approvals follow the live opt-in: window, current price, revoked with the opt-in and the lapse',async()=>{
  const {host,reg,registration}=await registered();const expiry=registration.expiresAt;
  const prep=await prepare(A,'a',host,reg,id('renewal'),expiry-40*DAY);await confirm(A,'a',prep,reg,expiry-40*DAY+1);
  assert.deepEqual(await m.decideRenewal({db:A,hostname:host,registrar:reg,policy,now:expiry-40*DAY+2}),{renew:false,reason:'outside-renewal-window'},'only inside 30 days before the expiry');
  await refuse(run('INSERT INTO domain_renewal_approvals(hostname,for_expiry,review_id,price_cents,approved_at) VALUES(?,?,?,?,?)',host,expiry,prep.review.reviewId,prep.review.renewalTotalCents,expiry-31*DAY),/domain_renewal_not_opted_in/);
  assert.equal((await m.decideRenewal({db:A,hostname:host,registrar:reg,policy,now:expiry-10*DAY})).renew,true);
  // The row follows a lower price and never exceeds the opted-in one.
  reg.setPrice(host,{renewal:1000});const lower=await m.decideRenewal({db:A,hostname:host,registrar:reg,policy,now:expiry-9*DAY});
  assert.equal((await one('SELECT price_cents FROM domain_renewal_approvals WHERE hostname=?',host)).price_cents,lower.priceCents);assert.ok(lower.priceCents<prep.review.renewalTotalCents);
  await refuse(run('UPDATE domain_renewal_approvals SET price_cents=? WHERE hostname=?',prep.review.renewalTotalCents+1,host),/domain_renewal_not_opted_in/);
  // The charger's gate is the view over the live opt-in (it uses the real clock, and these synthetic dates are ahead of it, so the row is current and listed).
  assert.deepEqual((await all('SELECT hostname,price_cents,for_expiry FROM domain_renewal_chargeable WHERE hostname=?',host)).map(r=>({...r})),[{hostname:host,price_cents:lower.priceCents,for_expiry:expiry}]);
  // Turning auto-renew off deletes the approval in the same statement; so does a lapse.
  await m.turnOffAutoRenew(A,actorOf('a'),host);assert.equal(await count('SELECT count(*) FROM domain_renewal_approvals WHERE hostname=?',host),0);assert.equal(await count('SELECT count(*) FROM domain_renewal_chargeable WHERE hostname=?',host),0);
  reg.setPrice(host,{renewal:1150});const again=await prepare(A,'a',host,reg,id('renewal'),expiry-8*DAY);await confirm(A,'a',again,reg,expiry-8*DAY+1);
  await m.decideRenewal({db:A,hostname:host,registrar:reg,policy,now:expiry-7*DAY});assert.equal(await count('SELECT count(*) FROM domain_renewal_approvals WHERE hostname=?',host),1);
  await run("UPDATE domain_registrations SET state='lapsed',auto_renew=0,renewal_review_id=NULL,renewal_total_cents=NULL WHERE hostname=?",host);assert.equal(await count('SELECT count(*) FROM domain_renewal_approvals WHERE hostname=?',host),0);
 });

 await check('transfer requests always have an exit: a stuck claim becomes unknown, an old one fails and returns the name, the owner can cancel, two absent reads complete one and a failed lookup costs one retry',async()=>{
  const a=await registered('b'),b=await registered('b'),c=await registered('b');
  a.reg.nextTransfer('timeout-before');
  const start=(r,at)=>m.startTransferOut({db:A,actor:actorOf('b'),hostname:r.host,registrar:r.reg,requestId:id('transfer'),now:at});
  assert.equal((await start(a,T0+70*DAY)).request.state,'unknown-outcome');assert.equal((await start(b,T0+70*DAY)).request.state,'unlocked');
  assert.equal((await m.sweepTransfers(A,shared,T0+71*DAY)).moved,0,'young requests are left alone');
  assert.equal((await m.sweepTransfers(A,shared,T0+70*DAY+15*DAY)).moved>=2,true);
  for(const r of [a,b]){assert.equal((await m.loadTransfer(A,owners.b.id,r.host)).state,'failed');assert.equal((await renewalState(r.host)).state,'active');}
  await start(c,T0+90*DAY);await refuse(m.cancelTransfer(A,{kind:'model',ownerId:owners.b.id},c.host,shared,T0+91*DAY),/HUMAN_REVIEW_REQUIRED/);
  await refuse(m.readAuthCode({db:A,actor:actorOf('b'),hostname:a.host,registrar:a.reg}),/TRANSFER_NOT_UNLOCKED/);
  assert.equal((await m.cancelTransfer(A,actorOf('b'),c.host,shared,T0+91*DAY)).state,'failed');assert.equal((await renewalState(c.host)).state,'active');
  const d=await registered('b'),e=await registered('b');await start(d,T0+100*DAY);await start(e,T0+100*DAY);
  const lookup=shared.lookup;let boom=true;shared.lookup=async n=>{if(boom&&n===d.host){boom=false;throw Error('down');}return lookup.call(shared,n);};
  shared.completeTransfer(e.host);
  await m.reconcileTransfers(A,shared,T0+101*DAY);shared.lookup=lookup;
  assert.equal((await m.loadTransfer(A,owners.b.id,e.host)).state,'completed');assert.equal((await renewalState(e.host)).state,'transferred-out');
  assert.equal((await m.loadTransfer(A,owners.b.id,d.host)).state,'unlocked','the failed read cost d one retry only');
 });

 await check('a request whose registrar lookup keeps failing goes to the back of the line, so later requests still get read with a small batch',async()=>{
  const d=await registered('b'),e=await registered('b'),start=r=>m.startTransferOut({db:A,actor:actorOf('b'),hostname:r.host,registrar:r.reg,requestId:id('transfer'),now:T0+130*DAY});
  await start(d);await start(e);shared.completeTransfer(e.host);
  const lookup=shared.lookup;shared.lookup=async n=>{if(n===d.host)throw Error('registrar down');return lookup.call(shared,n);};
  try{for(let i=0;i<4;i++)await m.reconcileTransfers(A,shared,T0+131*DAY+i*7*HOUR,1);}finally{shared.lookup=lookup;}
  assert.equal((await m.loadTransfer(A,owners.b.id,e.host)).state,'completed','the healthy request was reached despite the failing one ahead of it');
  assert.equal((await m.loadTransfer(A,owners.b.id,d.host)).state,'unlocked');
 });

 await check('a registration naming another order completes a transfer at once; reminders cover a lapsed name and page past names already reminded',async()=>{
  const a=await registered('b');await m.startTransferOut({db:A,actor:actorOf('b'),hostname:a.host,registrar:a.reg,requestId:id('transfer'),now:T0+70*DAY});
  a.reg.takeBy(a.host,'new-owner-order');const synced=await m.syncRegistration({db:A,hostname:a.host,registrar:a.reg,now:T0+71*DAY});
  assert.equal(synced.state,'transferred-out');assert.equal((await m.loadTransfer(A,owners.b.id,a.host)).state,'completed');
  const l=await registered('a');const expiry=(await m.loadRegistration(A,owners.a.id,l.host)).expiresAt;
  await run("UPDATE domain_registrations SET state='lapsed' WHERE hostname=?",l.host);
  await m.queueDueReminders(A,expiry+2*DAY,500);
  assert.deepEqual((await all("SELECT template FROM notification_notices WHERE event_ref GLOB ?",l.host+':*')).map(r=>r.template),['domain.expiry-expired@1']);
  // Paging: with a limit of one, repeated passes reach every name instead of re-reading the first.
  const open=await count("SELECT count(*) FROM domain_registrations WHERE state IN ('active','transfer-out') AND expires_at BETWEEN ? AND ?",expiry-6*DAY-DAY,expiry-6*DAY+30*DAY);
  for(let i=0;i<open+3;i++)await m.queueDueReminders(A,expiry-6*DAY+i*2*HOUR,1);/* two hours apart: the per-recipient hourly cap is the outbox's own */
  const week=await count("SELECT count(*) FROM notification_notices WHERE template='domain.expiry-week@1'");
  assert.equal(week>=3,true,`later names are reached past the ones already reminded (${week} of ${open}; the rest wait on the outbox's own per-recipient caps)`);
 });
 await check('absence never completes a transfer: stray absent reads, a long lookup outage and every interleaving leave it open; it ends in a bounded failure that returns the name to active',async()=>{
  const open=async r=>(await m.loadTransfer(A,owners.b.id,r.host)).state;
  const start=(r,at)=>m.startTransferOut({db:A,actor:actorOf('b'),hostname:r.host,registrar:r.reg,requestId:id('transfer'),now:at});
  // Every interleaving of absent, present and thrown reads, each at least the spacing apart, then a long outage of absence: nothing completes it.
  const y=await registered('b');await start(y,T0+120*DAY);
  const lookup=shared.lookup;let mode='absent';
  shared.lookup=async n=>{if(n!==y.host)return lookup.call(shared,n);if(mode==='absent')return {status:'not-found'};if(mode==='throw')throw Error('outage');return lookup.call(shared,n);};
  const modes=['absent','present','absent','absent','throw','throw','absent','present','absent','throw','absent'];
  for(const [i,next] of modes.entries()){mode=next;await m.reconcileTransfers(A,shared,T0+121*DAY+i*7*HOUR);assert.notEqual(await open(y),'completed',`after ${next} read ${i}`);}
  mode='absent';for(let i=0;i<20;i++)await m.reconcileTransfers(A,shared,T0+123*DAY+i*7*HOUR);
  assert.notEqual(await open(y),'completed');assert.equal((await renewalState(y.host)).state,'transfer-out');
  assert.equal(await count("SELECT count(*) FROM domain_registrant_contacts WHERE review_id=(SELECT review_id FROM domain_orders WHERE order_id=(SELECT order_id FROM domain_registrations WHERE hostname=?))",y.host),0);
  // the schema agrees: no row reaches completed without positive evidence, however it is written
  await refuse(run("UPDATE domain_transfer_requests SET state='completed',version=version+1 WHERE hostname=? AND state IN ('unlocked','unknown-outcome')",y.host),/domain_transfer_evidence/);
  // it ends in a bounded failure that returns the name to active, never in transferred-out
  const swept=await m.sweepTransfers(A,shared,T0+120*DAY+15*DAY);assert.ok(swept.moved>=1);
  assert.equal(await open(y),'failed');assert.equal((await renewalState(y.host)).state,'active');
  shared.lookup=lookup;
 });

 await check('a slow sync cannot lapse a new owner; a raised total on the same review is refused; sync during requested completes on positive evidence; a lost swap returns the winning request',async()=>{
  const old=await registered('a');const host=old.host;
  const again=registrar(host);// the name will be bought again by tenant b
  const original=shared.lookup;
  shared.lookup=async n=>{
   if(n===host){
    shared.lookup=original;
    await run("UPDATE domain_registrations SET state='transferred-out' WHERE hostname=?",host);
    shared.completeTransfer(host);
    const prep=await m.prepareDomainPurchase({actor:actorOf('b'),request:{contractVersion:1,projectId:owners.b.project,hostname:host},project:projectOf('b'),owner:fundingOf('b'),registrar:again,policy,ids:{quoteId:id('quote'),reviewId:id('review')},now:T0+DAY});
    await m.saveReview(A,prep.quote,prep.review,T0+DAY);
    const st=await m.consent({db:A,actor:actorOf('b'),submission:{contractVersion:1,reviewId:prep.review.reviewId,quoteDigest:prep.review.quoteDigest,consentTextDigest:prep.review.consentTextDigest,decision:'accept'},reviewId:prep.review.reviewId,project:projectOf('b'),owner:fundingOf('b'),registrar:again,policy,orderId:id('order'),now:T0+DAY+1});
    await m.reserve(A,owners.b.id,st.order.orderId,T0+DAY+2);
    await m.dispatch({db:A,ownerId:owners.b.id,orderId:st.order.orderId,owner:fundingOf('b'),project:projectOf('b'),registrar:again,policy,now:T0+DAY+3});
    return {status:'registered',orderRef:'someone-elses-order',expiresAt:T0+9*DAY,renewal:{currency:'USD',wholesaleCents:1}};
   }
   return original.call(shared,n);
  };
  const row=await m.syncRegistration({db:A,hostname:host,registrar:shared,now:T0+DAY+10});
  assert.equal(row.ownerId,owners.b.id);assert.equal(row.state,'active','the new owner row was not lapsed by a sync that started on the old one');
  // A raised total on the same review is refused in the schema, so decideRenewal cannot approve it.
  const r=await registered('a');const prep=await prepare(A,'a',r.host,r.reg,id('renewal'),r.registration.expiresAt-40*DAY);await confirm(A,'a',prep,r.reg,r.registration.expiresAt-40*DAY+1);
  await refuse(run('UPDATE domain_registrations SET renewal_total_cents=renewal_total_cents+500 WHERE hostname=?',r.host),/domain_registration_renewal/);
  // sync during `requested` (a claim whose reply was lost) completes on a registration naming another order
  const q=await registered('b');
  await run("INSERT INTO domain_transfer_requests(request_id,hostname,owner_user_id,state,requested_at,updated_at) VALUES(?,?,?,'requested',?,?)",id('transfer'),q.host,owners.b.id,T0+70*DAY,T0+70*DAY);
  q.reg.takeBy(q.host,'new-owner-order');
  const done=await m.syncRegistration({db:A,hostname:q.host,registrar:q.reg,now:T0+71*DAY});assert.equal(done.state,'transferred-out');assert.equal((await m.loadTransfer(A,owners.b.id,q.host)).state,'completed');
  // a sweep moves the claim while the unlock is in flight: the caller gets the request as it stands, not null
  const w=await registered('b');const beginTransferOut=w.reg.beginTransferOut;
  w.reg.beginTransferOut=async req=>{await m.sweepTransfers(A,shared,T0+80*DAY+2*MINUTE);return beginTransferOut.call(w.reg,req);};
  const res=await m.startTransferOut({db:A,actor:actorOf('b'),hostname:w.host,registrar:w.reg,requestId:id('transfer'),now:T0+80*DAY});
  assert.ok(res.request,'never null');assert.equal(res.request.state,'unknown-outcome');w.reg.beginTransferOut=beginTransferOut;
 });
 await check('a transfer claim interrupted after the registrar unlocked the name is swept, read and unlocked for the owner without a second unlock',async()=>{
  const r=await registered('b'),at=T0+140*DAY;
  // The worker died after the registrar unlocked and before the result was stored: the row is still `requested`.
  await run("INSERT INTO domain_transfer_requests(request_id,hostname,owner_user_id,state,requested_at,updated_at) VALUES(?,?,?,'requested',?,?)",id('transfer'),r.host,owners.b.id,at,at);
  const base=r.reg.calls.transferOut;
  const lookup=shared.lookup;shared.lookup=async n=>{const f=await lookup.call(shared,n);return n===r.host&&f.status==='registered'?{...f,unlocked:true}:f;};
  try{
   await m.sweepTransfers(A,shared,at+30000);assert.equal((await m.loadTransfer(A,owners.b.id,r.host)).state,'requested','inside the 60 second lease it is left alone');
   await m.sweepTransfers(A,shared,at+120000);assert.equal((await m.loadTransfer(A,owners.b.id,r.host)).state,'unknown-outcome');
   await m.reconcileTransfers(A,shared,at+120000+7*HOUR);
  }finally{shared.lookup=lookup;}
  assert.equal((await m.loadTransfer(A,owners.b.id,r.host)).state,'unlocked');assert.equal(r.reg.calls.transferOut-base,0,'reconciliation never repeats the unlock');
  assert.equal((await m.cancelTransfer(A,actorOf('b'),r.host,shared,at+DAY)).state,'failed');// leave the shared fixture as found
 });
 await check('a cancelled or expired transfer leaves the name locked again: the request fails only once the registrar confirms the lock',async()=>{
  const start=(r,at)=>m.startTransferOut({db:A,actor:actorOf('b'),hostname:r.host,registrar:r.reg,requestId:id('transfer'),now:at});
  const open=async r=>(await m.loadTransfer(A,owners.b.id,r.host)).state;
  const relock=shared.relockTransferOut,only=host=>fn=>{shared.relockTransferOut=async req=>req.hostname===host?fn(req):relock.call(shared,req);};
  try{
   // Cancel: an unconfirmed lock keeps the request open (the name really is still unlocked); a confirmed one fails it and the auth code stops working.
   const a=await registered('b');await start(a,T0+150*DAY);assert.equal(shared.isUnlocked(a.host),true);
   only(a.host)(async()=>({kind:'rejected'}));
   await refuse(m.cancelTransfer(A,actorOf('b'),a.host,shared,T0+151*DAY),/RELOCK_UNAVAILABLE/);
   assert.equal(await open(a),'unlocked');assert.equal((await renewalState(a.host)).state,'transfer-out');assert.equal(shared.isUnlocked(a.host),true,'still unlocked, and D1 says so');
   shared.relockTransferOut=relock;
   assert.equal((await m.cancelTransfer(A,actorOf('b'),a.host,shared,T0+151*DAY+1)).state,'failed');
   assert.equal(shared.isUnlocked(a.host),false);assert.equal((await shared.authCode(a.host)).unavailable,true,'the issued code no longer works');assert.equal((await renewalState(a.host)).state,'active');
   // Sweep: the same rule at 14 days, retried behind other requests, and bounded by the give-up age so an unreachable registrar cannot trap closure.
   const b=await registered('b');await start(b,T0+160*DAY);only(b.host)(async()=>{throw Error('registrar down');});
   await m.sweepTransfers(A,shared,T0+160*DAY+15*DAY);assert.equal(await open(b),'unlocked','an unconfirmed lock keeps the request open');
   await m.sweepTransfers(A,shared,T0+160*DAY+31*DAY);assert.equal(await open(b),'failed','after the give-up age it ends anyway');assert.equal((await renewalState(b.host)).state,'active');
   shared.relockTransferOut=relock;
   const c=await registered('b');await start(c,T0+200*DAY);await m.sweepTransfers(A,shared,T0+200*DAY+15*DAY);
   assert.equal(await open(c),'failed');assert.equal(shared.isUnlocked(c.host),false,'a confirmed lock lets the sweep fail it at 14 days');
   // A cancel that lands while the unlock is in flight: the unlock still happens at the registrar, so the start locks it again.
   const d=await registered('b'),begin=shared.beginTransferOut;
   shared.beginTransferOut=async req=>{if(req.hostname===d.host)await m.cancelTransfer(A,actorOf('b'),d.host,shared,T0+210*DAY+1);return begin.call(shared,req);};
   try{await start(d,T0+210*DAY);}finally{shared.beginTransferOut=begin;}
   assert.equal(await open(d),'failed');assert.equal(shared.isUnlocked(d.host),false,'the late unlock was undone');
  }finally{shared.relockTransferOut=relock;}
 });
 await check('a read that shows the name again clears a pending lapse, so the next absent read starts over',async()=>{
  const flaky=await registered(),fexp=flaky.registration.expiresAt;
  flaky.reg.vanish(flaky.host);assert.equal((await m.syncRegistration({db:A,hostname:flaky.host,registrar:flaky.reg,now:fexp+DAY})).state,'active');
  flaky.reg.takeBy(flaky.host,flaky.registration.orderId);assert.equal((await m.syncRegistration({db:A,hostname:flaky.host,registrar:flaky.reg,now:fexp+DAY+7*HOUR})).state,'active');
  assert.equal((await one('SELECT absent_since FROM domain_registrations WHERE hostname=?',flaky.host)).absent_since,null,'seen again clears it');
  flaky.reg.vanish(flaky.host);assert.equal((await m.syncRegistration({db:A,hostname:flaky.host,registrar:flaky.reg,now:fexp+DAY+14*HOUR})).state,'active','the clock restarted');
 });
}finally{for(const f of files)f.close();}
console.log(`Domain purchase lifecycle passed: ${cases} cases on ${d1?'actual local D1':'SQLite'}.`);
process.exit(0);
