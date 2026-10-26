import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';

// WH-068 / WH-154 offline notification conformance harness. Synthetic providers, addresses and identifiers only: no
// database, network, credential, model or provider account. It proves the frozen contract and the reference runtime,
// plus agreement with the existing WH-036 contact notification source. It does not prove the D1-backed outbox; the
// implementation slices must run equivalent checks against their handlers. Every suite check is also run against
// deliberately broken copies of the reference (mutants below), each of which must be caught.
const prototypeURL=new URL('../tools/prototypes/notifications.mjs',import.meta.url);
const prototypeSource=readFileSync(prototypeURL,'utf8');
const SECRET='synthetic-provider-credential-0000';
const P='11111111-1111-4111-8111-111111111111',P2='22222222-2222-4222-8222-222222222222';
const R='33333333-3333-4333-8333-000000000001',R2='33333333-3333-4333-8333-000000000002';
const ownerA={kind:'owner',ownerId:'owner-a'},ownerB={kind:'owner',ownerId:'owner-b'};
const fields={name:{type:'text'},vehicle:{type:'text'},service:{type:'choice',options:['Exterior wash','Full detail']},day:{type:'choice',options:['Monday','Tuesday']}};
const values=(o={})=>({name:'Synthetic Visitor',vehicle:'Blue hatchback',service:'Full detail',day:'Tuesday',...o});

async function suite(m){
 let count=0,request=0;
 const test=async(name,fn)=>{try{await fn();count++;}catch(error){throw new Error(name,{cause:error});}};
 const throws=(fn,code)=>assert.throws(fn,e=>{assert.equal(e.code,code);return true;});
 const rejects=(fn,code)=>assert.rejects(async()=>fn(),e=>{assert.equal(e.code,code);return true;});
 const clone=()=>structuredClone(m.notificationCatalog);
 const standard=(catalog=m.notificationCatalog,resourceId=R)=>m.standardAppointmentConfigurations({resourceId,formId:'appointment',serviceField:'service',dayField:'day',businessName:'Shine Mobile Detailing'},catalog);
 const staffCfg=(c)=>standard(c)[0],receiptCfg=(c)=>standard(c)[2];
 function setup({catalog=m.notificationCatalog,configure=true}={}){
  const adapter=m.createSyntheticAdapter({secret:SECRET});
  const rt=m.createReferenceRuntime({catalog,adapter});
  rt.addProject(P,'owner-a');rt.addProject(P2,'owner-b');
  rt.setOwnerDestination(P,'owner-a@example.test');rt.setOwnerDestination(P2,'owner-b@example.test');
  rt.addVisitor(P,'v-staff',{email:'staff@example.test',emailVerified:true,notify:true});rt.grantStaff(P,'v-staff');
  rt.addVisitor(P,'v-sub',{email:'submitter@example.test',emailVerified:true});
  rt.addVisitor(P,'v-unverified',{email:'unverified@example.test',emailVerified:false});
  rt.defineForm(P,R,'appointment',fields);rt.defineForm(P2,R2,'appointment',fields);
  if(configure)for(const c of standard(catalog))rt.configure(ownerA,P,c,m.prepareReview(c,catalog));
  return {rt,adapter};
 }
 const submit=(rt,o={})=>rt.submitForm(o.project??P,{resourceId:o.resourceId??R,formId:'appointment',requestId:o.requestId??`req-${++request}`,values:o.values??values(),submitter:o.submitter??{kind:'visitor',visitorId:'v-sub'},receiptConsent:o.receiptConsent??true});
 const byScope=(rt,scope)=>rt.notices().map(id=>rt.receipt(id)).filter(r=>r.recipientScope===scope);
 const bounce=(rt,noticeId,eventId,type='bounced')=>rt.applyProviderEvent({providerEventId:eventId,noticeId,type,authenticated:true});

 // ---------- Frozen catalog and shapes ----------
 await test('frozen catalog is valid; no entry claims live acceptance; contact templates are source, appointment templates planned',()=>{
  assert.equal(m.validateCatalog(m.notificationCatalog),true);
  const entries=Object.entries(m.notificationCatalog.templates);
  assert.ok(entries.every(([,e])=>e.readiness!=='live-accepted'));
  assert.deepEqual(entries.filter(([,e])=>e.readiness==='source').map(([k])=>k).sort(),['contact.new-message@1','owner.destination-verification@1']);
  assert.ok(Object.values(m.notificationCatalog.providers).every(p=>p.readiness!=='live-accepted'));
 });
 await test('unknown contract versions are rejected for templates, configurations and the catalog',()=>{
  const t=clone().templates['appointment.staff-notice@1'].template;t.contractVersion=2;throws(()=>m.validateTemplate(t),'UNSUPPORTED_VERSION');
  throws(()=>m.validateConfiguration({...staffCfg(),contractVersion:2}),'UNSUPPORTED_VERSION');
  throws(()=>m.validateCatalog({...clone(),contractVersion:0}),'UNSUPPORTED_VERSION');
 });
 await test('unknown fields are rejected at every level',()=>{
  throws(()=>m.validateConfiguration({...staffCfg(),priority:'high'}),'UNKNOWN_FIELD');
  throws(()=>m.validateConfiguration({...staffCfg(),trigger:{...staffCfg().trigger,condition:'always'}}),'UNKNOWN_FIELD');
  throws(()=>m.validateConfiguration({...staffCfg(),values:{businessName:'Shine',extra:'x'}}),'UNKNOWN_FIELD');
  const t=clone().templates['appointment.staff-notice@1'].template;t.html='<b>x</b>';throws(()=>m.validateTemplate(t),'UNKNOWN_FIELD');
 });
 await test('caller-supplied recipients, headers and URLs are refused as an open relay',()=>{
  for(const extra of [{to:'victim@example.test'},{cc:['a@example.test']},{bcc:'b@example.test'},{recipients:['x@example.test']},{replyTo:'x@example.test'},{headers:{'X-A':'1'}},{url:'https://evil.example'},{from:'ceo@example.test'}])
   throws(()=>m.validateConfiguration({...staffCfg(),...extra}),'OPEN_RELAY');
  throws(()=>m.validateConfiguration({...staffCfg(),values:{email:'x@example.test'}}),'OPEN_RELAY');
  throws(()=>m.validateConfiguration({...staffCfg(),trigger:{...staffCfg().trigger,webhook:'https://evil.example'}}),'OPEN_RELAY');
  throws(()=>m.validateConfiguration({...staffCfg(),recipientScope:'anyone@example.test'}),'SCOPE_NOT_ALLOWED');
  throws(()=>m.validateConfiguration({...receiptCfg(),recipientScope:'project-staff'}),'SCOPE_NOT_ALLOWED');
  throws(()=>m.validateConfiguration({...staffCfg(),values:{businessName:'Visit https://evil.example now'}}),'CONFIG_URL');
  throws(()=>m.validateConfiguration({...staffCfg(),values:{businessName:'Write to help@evil.example'}}),'CONFIG_URL');
  const t=clone().templates['appointment.staff-notice@1'].template;t.body.push({link:'https://evil.example'});throws(()=>m.validateTemplate(t),'UNKNOWN_LINK');
  const s=clone().templates['appointment.staff-notice@1'].template;s.subject.push({link:'workspace-inbox'});throws(()=>m.validateTemplate(s),'UNKNOWN_LINK');
  const v=clone().templates['appointment.staff-notice@1'].template;v.variables.target={source:'request',type:'url'};v.body.push({var:'target'});throws(()=>m.validateTemplate(v),'INVALID_VARIABLE');
 });
 await test('secrets never appear in configuration',()=>{
  throws(()=>m.validateConfiguration({...staffCfg(),apiKey:'x'}),'SECRET_FIELD');
  throws(()=>m.validateConfiguration({...staffCfg(),values:{token:'x'}}),'SECRET_FIELD');
 });
 await test('an unverified or unknown sender is refused',()=>{
  const c=clone();c.senders['whumpo-notify'].state='unverified';throws(()=>m.validateConfiguration(staffCfg(c),c),'SENDER_NOT_VERIFIED');
  const p=clone();p.senders['customer-domain']={address:'hello@customer.example',displayName:'Customer',provider:'cloudflare-email',domainOwner:'customer',state:'planned',dnsReview:null};
  assert.equal(m.validateCatalog(p),true);throws(()=>m.validateConfiguration({...staffCfg(p),sender:'customer-domain'},p),'SENDER_NOT_VERIFIED');
  throws(()=>m.validateConfiguration({...staffCfg(),sender:'nobody'}),'UNKNOWN_SENDER');
 });
 await test('an unpriced, unreviewed or unbounded provider charge is refused; the review binds the exact price',()=>{
  for(const [field,code] of [['price','UNPRICED_PROVIDER'],['review','UNREVIEWED_PROVIDER'],['ceiling','UNBOUNDED_CHARGE']]){
   const c=clone();c.providers['cloudflare-email'][field]=null;throws(()=>m.validateConfiguration(staffCfg(c),c),code);
  }
  const review=m.prepareReview(staffCfg());
  const {rt}=setup({configure:false});
  throws(()=>rt.configure(ownerA,P,staffCfg(),{...review,price:{...review.price,microsPerCall:1}}),'PRICE_MISMATCH');
  throws(()=>rt.configure(ownerA,P,{...staffCfg(),limits:{perRecipientHour:9,perRecipientDay:50}},review),'STALE_REVIEW');
  const before=m.digest(m.notificationCatalog);rt.configure(ownerA,P,staffCfg(),review);
  assert.equal(m.digest(m.notificationCatalog),before,'configuring provisions or changes nothing in the catalog');
 });
 await test('template and value injection: header bytes, template syntax and markup are refused or rendered as data',()=>{
  const t=clone().templates['appointment.staff-notice@1'].template;t.subject[0].text='Hi\r\nBcc: victim@example.test';throws(()=>m.validateTemplate(t),'HEADER_INJECTION');
  const b=clone().templates['appointment.staff-notice@1'].template;b.body[0].text='Hello {{owner.email}}';throws(()=>m.validateTemplate(b),'TEMPLATE_SYNTAX');
  const staff=m.notificationCatalog.templates['appointment.staff-notice@1'].template;
  throws(()=>m.render(staff,{businessName:'Shine\r\nBcc: victim@example.test'}),'INVALID_VARIABLE');
  throws(()=>m.render(staff,{businessName:'<script>x</script>'}),'INVALID_VARIABLE');
  throws(()=>m.validateConfiguration({...staffCfg(),values:{businessName:'Shine\nBcc: x'}}),'HEADER_INJECTION');
  const literal=m.render(staff,{businessName:'{{x}} ${y}'});
  assert.equal(literal.subject,'New appointment request for {{x}} ${y}');
  const receipt=m.notificationCatalog.templates['appointment.request-receipt@1'].template;
  throws(()=>m.render(receipt,{businessName:'Shine',reference:'ABCDEF12',service:'Full detail\r\nBcc: x',day:'Monday'},{service:fields.service,day:fields.day}),'INVALID_VARIABLE');
 });
 await test('owner and staff notices are content-free; free-text record values never become variables',()=>{
  const t=clone().templates['appointment.staff-notice@1'].template;t.variables.vehicle={source:'record',type:'choice'};t.body.push({var:'vehicle'});throws(()=>m.validateTemplate(t),'CONTENT_IN_NOTICE');
  const {rt}=setup({configure:false});const c={...receiptCfg(),fields:{service:'vehicle',day:'day'}};
  throws(()=>rt.configure(ownerA,P,c,m.prepareReview(c)),'FREE_TEXT_VARIABLE');
 });
 await test('platform templates, withdrawn or stale pins and over-wide limits are refused for customer configuration',()=>{
  const pin=m.notificationCatalog.templates['contact.new-message@1'].template;
  throws(()=>m.validateConfiguration({...staffCfg(),template:{id:pin.id,version:1,digest:m.templateDigest(pin)}}),'PLATFORM_TEMPLATE');
  throws(()=>m.validateConfiguration({...staffCfg(),template:{...staffCfg().template,digest:'0'.repeat(64)}}),'STALE_TEMPLATE');
  const w=clone();w.templates['appointment.staff-notice@1'].state='withdrawn';throws(()=>m.validateConfiguration(staffCfg(w),w),'TEMPLATE_WITHDRAWN');
  throws(()=>m.validateConfiguration({...staffCfg(),limits:{perRecipientHour:11,perRecipientDay:50}}),'LIMIT_TOO_HIGH');
  throws(()=>m.validateConfiguration({...staffCfg(),template:{id:'appointment.staff-notice',version:2,digest:'0'.repeat(64)}}),'UNKNOWN_TEMPLATE');
 });
 await test('receipt transitions: terminal states are final and an unknown outcome never returns to dispatch',()=>{
  assert.deepEqual(Object.keys(m.transitions).sort(),[...m.receiptStates].sort());
  for(const s of ['bounced','complained','failed','cancelled','unresolved'])assert.deepEqual(m.transitions[s],[]);
  for(const s of ['queued','dispatching','deferred'])assert.ok(!m.transitions['unknown-outcome'].includes(s));
  for(const [from,to] of Object.entries(m.transitions))assert.ok(!to.includes('queued'),from);
 });

 // ---------- Reference runtime ----------
 await test('standard appointment configuration: staff, owner and submitter receive exactly their templates from the verified sender',async()=>{
  const {rt,adapter}=setup();submit(rt);
  const r=await rt.runPass();assert.equal(r.accepted,3);assert.equal(r.errors,0);
  assert.deepEqual(adapter.calls.map(c=>c.to).sort(),['owner-a@example.test','staff@example.test','submitter@example.test']);
  for(const c of adapter.calls){
   assert.deepEqual(c.from,{email:'notify@whumpo.com',name:'Whumpo'});assert.deepEqual(Object.keys(c.headers),['X-Whumpo-Notice-Id']);
   assert.ok(!c.text.includes('Synthetic Visitor')&&!c.text.includes('Blue hatchback'),'free-text values never leave the private panel');
  }
  const staffMail=adapter.calls.find(c=>c.to==='staff@example.test');assert.ok(!staffMail.text.includes('Full detail'),'staff notice is content-free');
  const receipt=adapter.calls.find(c=>c.to==='submitter@example.test');assert.match(receipt.text,/Service: Full detail\nPreferred day: Tuesday/);assert.match(receipt.text,/not a confirmed booking/);
 });
 await test('recipients derive only from server-side records: anonymous and unverified submitters get no mail',async()=>{
  const {rt,adapter}=setup();
  submit(rt,{submitter:{kind:'public'},values:values({name:'victim@example.test'}),receiptConsent:true});
  submit(rt,{submitter:{kind:'visitor',visitorId:'v-unverified'}});
  submit(rt,{submitter:{kind:'visitor',visitorId:'v-sub'},receiptConsent:false});
  await rt.runPass();
  assert.equal(byScope(rt,'submitter').length,0);
  assert.ok(adapter.calls.every(c=>['owner-a@example.test','staff@example.test'].includes(c.to)));
 });
 await test('duplicate submissions and repeated passes create one notice per recipient; a changed replay conflicts',async()=>{
  const {rt,adapter}=setup();
  const a=submit(rt,{requestId:'same'}),b=submit(rt,{requestId:'same'});assert.equal(a.recordId,b.recordId);
  throws(()=>submit(rt,{requestId:'same',values:values({day:'Monday'})}),'REQUEST_CONFLICT');
  await rt.runPass();await rt.runPass();rt.advance(3600000);await rt.runPass();
  assert.equal(adapter.calls.length,3);assert.equal(rt.notices().length,3);
 });
 await test('a lost provider response is unknown-outcome and is never redispatched, retried or recalled',async()=>{
  for(const mode of ['timeout-after','timeout-before','throw']){
   const {rt,adapter}=setup();adapter.plan.push(mode);submit(rt);await rt.runPass();
   const [first]=rt.notices();assert.equal(rt.receipt(first).state,'unknown-outcome',mode);
   const calls=adapter.calls.length;
   for(let i=0;i<4;i++){rt.advance(6*3600000);await rt.runPass();}
   assert.equal(adapter.calls.length,calls,mode);assert.equal(rt.receipt(first).attempts,1);
   await rejects(()=>rt.retryNow(ownerA,first),'NO_REDISPATCH');
   await rejects(()=>rt.cancel(ownerA,first),'CANNOT_RECALL');
  }
 });
 await test('an interrupted worker leaves dispatching, which becomes unknown-outcome after the lease without another call',async()=>{
  const {rt,adapter}=setup();submit(rt);rt.faults.crashAfterCall=true;
  const r=await rt.runPass();assert.ok(r.errors>=1);rt.faults.crashAfterCall=false;
  const states=rt.notices().map(id=>rt.receipt(id).state);assert.ok(states.includes('dispatching'));
  const calls=adapter.calls.length;await rt.runPass();assert.equal(adapter.calls.length,calls);
  rt.advance(m.bounds.leaseMs);await rt.runPass();
  assert.ok(rt.notices().every(id=>['unknown-outcome','accepted'].includes(rt.receipt(id).state)));
  assert.equal(adapter.calls.length,calls);
 });
 await test('a definite not-taken refusal is deferred with backoff, retried, and exhausted after the attempt bound',async()=>{
  const {rt,adapter}=setup();rt.revokeStaff(P,'v-staff');rt.setOwnerDestination(P,'owner-a@example.test','unverified');
  adapter.plan.push('not-taken');submit(rt);await rt.runPass();
  const [n]=rt.notices();assert.equal(rt.receipt(n).state,'deferred');
  await rt.runPass();assert.equal(adapter.calls.length,1,'not due yet');
  rt.advance(5*60000);await rt.runPass();assert.equal(rt.receipt(n).state,'accepted');assert.equal(rt.receipt(n).attempts,2);
  assert.equal(rt.state.ledger.calls,2,'every provider call counts against the ceiling');
  const x=setup();x.rt.revokeStaff(P,'v-staff');x.rt.setOwnerDestination(P,'owner-a@example.test','unverified');
  for(let i=0;i<m.bounds.maxAttempts;i++)x.adapter.plan.push('not-taken');submit(x.rt);
  for(let i=0;i<m.bounds.maxAttempts+2;i++){await x.rt.runPass();x.rt.advance(2*3600000);}
  const [e]=x.rt.notices();assert.equal(x.rt.receipt(e).state,'failed');assert.equal(x.rt.receipt(e).reason,'exhausted');assert.equal(x.adapter.calls.length,m.bounds.maxAttempts);
 });
 await test('owner retry is offered only for a deferred notice',async()=>{
  const {rt,adapter}=setup();rt.revokeStaff(P,'v-staff');rt.setOwnerDestination(P,'owner-a@example.test','unverified');
  adapter.plan.push('not-taken');submit(rt);await rt.runPass();const [n]=rt.notices();
  await rejects(()=>rt.retryNow(ownerB,n),'NOT_FOUND');rt.retryNow(ownerA,n);await rt.runPass();assert.equal(rt.receipt(n).state,'accepted');
  await rejects(()=>rt.retryNow(ownerA,n),'NO_REDISPATCH');
 });
 await test('authenticated bounce events suppress the address; duplicates, unauthenticated and out-of-order events change nothing',async()=>{
  const {rt,adapter}=setup();submit(rt);await rt.runPass();
  const staff=byScope(rt,'project-staff')[0].id;
  assert.throws(()=>rt.applyProviderEvent({providerEventId:'e0',noticeId:staff,type:'bounced',authenticated:false}),e=>e.code==='EVENT_NOT_AUTHENTICATED');
  assert.equal(rt.receipt(staff).state,'accepted');
  assert.deepEqual(bounce(rt,staff,'e1'),{applied:true,state:'bounced'});
  assert.deepEqual(bounce(rt,staff,'e1'),{applied:false,duplicate:true});
  assert.equal(bounce(rt,staff,'e2','delivered').applied,false);assert.equal(rt.receipt(staff).state,'bounced');
  const calls=adapter.calls.length;submit(rt);await rt.runPass();
  const next=byScope(rt,'project-staff').find(r=>r.id!==staff);assert.equal(next.state,'cancelled');assert.equal(next.reason,'suppressed');
  assert.ok(adapter.calls.slice(calls).every(c=>c.to!=='staff@example.test'));
  assert.equal(bounce(rt,'notice-unknown','e3').applied,false);
 });
 await test('a provider event resolves an unknown outcome; provider-side deferral is informational',async()=>{
  const {rt,adapter}=setup();adapter.plan.push('timeout-after');submit(rt);await rt.runPass();
  const [n]=rt.notices();assert.equal(rt.receipt(n).state,'unknown-outcome');
  assert.equal(bounce(rt,n,'d0','deferred').applied,false);
  assert.deepEqual(bounce(rt,n,'d1','delivered'),{applied:true,state:'delivered'});
  assert.deepEqual(bounce(rt,n,'d2','complained'),{applied:true,state:'complained'});
 });
 await test('provider suppression at send fails that notice and cancels other unsent notices to the address',async()=>{
  const {rt,adapter}=setup();rt.setOwnerDestination(P,'owner-a@example.test','unverified');
  rt.addVisitor(P,'v-sub',{email:'staff@example.test',emailVerified:true});
  adapter.plan.push('suppressed');submit(rt);await rt.runPass();
  const states=rt.notices().map(id=>rt.receipt(id));
  assert.deepEqual(states.map(s=>[s.state,s.reason]).sort(),[['cancelled','suppressed'],['failed','suppressed']]);
  assert.equal(adapter.calls.length,1);
 });
 await test('owner cancellation stops unsent notices only; other tenants cannot cancel',async()=>{
  const {rt,adapter}=setup();submit(rt);await rt.runPass({limit:0});
  const [n,...rest]=rt.notices();
  await rejects(()=>rt.cancel(ownerB,n),'NOT_FOUND');
  rt.cancel(ownerA,n);assert.equal(rt.receipt(n).state,'cancelled');
  await rt.runPass();assert.equal(adapter.calls.length,rest.length);
  await rejects(()=>rt.cancel(ownerA,rest[0]),'CANNOT_RECALL');
 });
 await test('a recipient revoked or opted out after enqueue is rechecked and cancelled before any call',async()=>{
  const {rt,adapter}=setup();submit(rt);await rt.runPass({limit:0});
  rt.revokeStaff(P,'v-staff');rt.setVisitorNotify(P,'v-staff',false);rt.addVisitor(P,'v-sub',{email:'submitter@example.test',emailVerified:false});
  await rt.runPass();
  for(const scope of ['project-staff','submitter']){const [r]=byScope(rt,scope);assert.equal(r.state,'cancelled');assert.equal(r.reason,'recipient-revoked');}
  assert.deepEqual(adapter.calls.map(c=>c.to),['owner-a@example.test']);
 });
 await test('reconciliation is read-only and bounded: no send, then unresolved after the read or time bound',async()=>{
  const {rt,adapter}=setup();adapter.plan.push('timeout-after','timeout-after','timeout-after');submit(rt);await rt.runPass();
  const [a,b,c]=rt.notices();const calls=adapter.calls.length;
  for(let i=1;i<m.bounds.reconcileReads;i++)assert.equal(rt.reconcile(a,{found:null}),'unknown-outcome');
  assert.equal(rt.reconcile(a,{found:null}),'unresolved');
  assert.throws(()=>rt.reconcile(a,{found:'delivered'}),e=>e.code==='NOT_UNCERTAIN');
  assert.equal(rt.reconcile(b,{found:'delivered'}),'delivered');
  rt.advance(m.bounds.reconcileWindowMs);assert.equal(rt.reconcile(c,{found:null}),'unresolved');
  assert.equal(adapter.calls.length,calls,'reconciliation never sends');
 });
 await test('a failing notification never loses or blocks the accepted form record',async()=>{
  const catalog=clone();const {rt,adapter}=setup({catalog});
  rt.faults.derive=true;const a=submit(rt);const r=await rt.runPass();assert.ok(r.errors>=1);rt.faults.derive=false;
  assert.equal(rt.readRecord(ownerA,P,a.recordId).values.vehicle,'Blue hatchback');
  adapter.plan.push('rejected','rejected','rejected');const b=submit(rt);await rt.runPass();
  assert.ok(rt.notices().some(id=>rt.receipt(id).reason==='rejected'));assert.ok(rt.readRecord(ownerA,P,b.recordId));
  rt.faults.crashAfterCall=true;const c=submit(rt);await rt.runPass();rt.faults.crashAfterCall=false;assert.ok(rt.readRecord(ownerA,P,c.recordId));
  catalog.templates['appointment.staff-notice@1'].state='withdrawn';const d=submit(rt);await rt.runPass();
  assert.ok(rt.notices().some(id=>rt.receipt(id).reason==='template-withdrawn'));assert.ok(rt.readRecord(ownerA,P,d.recordId));
  rt.disable(ownerA,P,'appointment-receipt');const e=submit(rt);await rt.runPass();assert.ok(rt.readRecord(ownerA,P,e.recordId));
  assert.equal(Object.keys(rt.state.projects[P].records).length,5);
 });
 await test('removing the record before dispatch cancels its notices; the remaining records are untouched',async()=>{
  const {rt,adapter}=setup();const a=submit(rt),b=submit(rt);await rt.runPass({limit:0});
  rt.removeRecord(ownerA,P,a.recordId);await rt.runPass();
  assert.equal(rt.notices().filter(id=>rt.receipt(id).reason==='record-removed').length,3);
  assert.ok(rt.readRecord(ownerA,P,b.recordId));assert.equal(adapter.calls.length,3);
 });
 await test('tenant scope: other owners and non-owner principals cannot configure, read or cancel',()=>{
  const {rt}=setup({configure:false});const c=staffCfg();
  throws(()=>rt.configure(ownerB,P,c,m.prepareReview(c)),'NOT_FOUND');
  throws(()=>rt.configure({kind:'visitor',visitorId:'v-sub'},P,c,m.prepareReview(c)),'FORBIDDEN');
  throws(()=>rt.configure({kind:'job',ruleId:'r'},P,c,m.prepareReview(c)),'FORBIDDEN');
  const {recordId}=submit(rt);throws(()=>rt.readRecord(ownerB,P,recordId),'NOT_FOUND');
  throws(()=>rt.configure(ownerB,P2,c,m.prepareReview(c)),'NOT_FOUND');
 });
 await test('the spending ceiling refuses calls before the provider; every attempt counts',async()=>{
  const catalog=clone();catalog.providers['cloudflare-email'].ceiling.callsPer32Days=2;
  const {rt,adapter}=setup({catalog});submit(rt);await rt.runPass();
  assert.equal(adapter.calls.length,2);assert.equal(rt.notices().filter(id=>rt.receipt(id).reason==='ceiling').length,1);
 });
 await test('per-recipient caps hold excess notices back while records are still accepted',async()=>{
  const {rt,adapter}=setup();for(let i=0;i<5;i++)submit(rt);await rt.runPass();
  assert.equal(byScope(rt,'submitter').length,3,'receipt configuration allows 3 an hour');
  assert.equal(Object.keys(rt.state.projects[P].records).length,5);assert.equal(adapter.calls.filter(c=>c.to==='staff@example.test').length,5);
 });
 await test('the provider credential stays inside the adapter: never in state, receipts, messages or configuration',async()=>{
  const {rt,adapter}=setup();adapter.plan.push('timeout-after');submit(rt);await rt.runPass();bounce(rt,rt.notices()[1],'x1');
  const text=JSON.stringify([rt.state,rt.notices().map(id=>rt.receipt(id)),adapter.calls]);
  assert.ok(!text.includes(SECRET));
  for(const id of rt.notices()){const r=rt.receipt(id);assert.deepEqual(Object.keys(r).sort(),['attempts','configurationId','id','providerRef','reason','recipientScope','state']);}
  assert.ok(!JSON.stringify(rt.notices().map(id=>rt.receipt(id))).includes('@'),'receipts carry no address');
  const noKey=m.createSyntheticAdapter({secret:''});const x=m.createReferenceRuntime({adapter:noKey});assert.ok(x);
 });
 await test('the runtime exposes no model, agent or inference capability',()=>{
  const {rt}=setup();
  assert.ok(Object.keys(rt).every(k=>!/model|agent|infer|prompt|chat|ai$/i.test(k)));
 });
 return count;
}

let total=0,src;
const checkOnce=async(name,fn)=>{try{await fn();total++;}catch(error){throw new Error(name,{cause:error});}};
const real=await import(prototypeURL);
const suiteCount=await suite(real);total+=suiteCount;

// ---------- Agreement with the existing WH-036 source (read-only) ----------
await checkOnce('bundle the existing contact notification source',async()=>{
 const bundled=await build({stdin:{contents:"export {contactEmailMessage,cloudflareEmailOutcome,contactNotificationSender,cloudflareEmailProvider} from './src/contact-email';export {implementedContactNotificationProviders,maxContactDeliveryAttempts,contactMonthlyCeilingCents} from './src/contact-notifications';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'neutral',write:false,logLevel:'silent'});
 src=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
});
// The WH-036 contact notice text as it was hard-coded before WH-155 (src/contact-email.ts at ad6bae9). Since WH-155 the source
// renders it from the catalog, so these literals, not the source, are the byte-for-byte baseline.
const inbox='https://whumpo.com/workspace/inbox';
const goldenNewMessage={subject:'New contact-form message in Whumpo',text:`A visitor sent a new message through a contact form on one of your Whumpo websites.\n\nRead it in your private inbox: ${inbox}\n\nThis notice does not include the message.\n\nYou receive this because this address was added and verified for contact-form notices in Whumpo. To stop them, remove the address in Dashboard → Contact inbox (${inbox}).`};
const goldenVerification=code=>({subject:'Your Whumpo verification code',text:`Your Whumpo verification code is ${code}\n\nEnter it in Dashboard → Contact inbox within one hour to receive contact-form notices at this address. If you did not ask for this, ignore this email; nothing will be sent unless the code is entered.`});
await checkOnce('the catalog re-expresses the existing contact notices byte for byte',()=>{
 const t=real.notificationCatalog.templates;
 assert.deepEqual(real.render(t['contact.new-message@1'].template,{}),goldenNewMessage);
 assert.deepEqual(real.render(t['owner.destination-verification@1'].template,{code:'ABCD2345'}),goldenVerification('ABCD2345'));
 assert.deepEqual(src.contactEmailMessage({outboxId:'o',idempotencyKey:'k',kind:'new_message',projectId:'p',recipient:'owner@example.test'}),goldenNewMessage);
 assert.deepEqual(src.contactEmailMessage({outboxId:'o',idempotencyKey:'k',kind:'verification',projectId:'p',recipient:'owner@example.test',verificationCode:'Z9Y8X7W6'}),goldenVerification('Z9Y8X7W6'));
 assert.deepEqual(real.render(t['contact.new-message@1'].template,{}),src.contactEmailMessage({outboxId:'o',idempotencyKey:'k',kind:'new_message',projectId:'p',recipient:'owner@example.test'}));
 assert.deepEqual(real.render(t['owner.destination-verification@1'].template,{code:'ABCD2345'}),src.contactEmailMessage({outboxId:'o',idempotencyKey:'k',kind:'verification',projectId:'p',recipient:'owner@example.test',verificationCode:'ABCD2345'}));
});
await checkOnce('sender, provider ceiling, attempt bound and error classes agree with the WH-036 adapter',()=>{
 const p=real.notificationCatalog.providers[src.cloudflareEmailProvider];assert.ok(p);
 assert.equal(real.notificationCatalog.senders['whumpo-notify'].address,src.contactNotificationSender);
 assert.equal(p.ceiling.callsPer32Days,src.implementedContactNotificationProviders[src.cloudflareEmailProvider].sendCeiling);
 assert.equal(p.ceiling.callsPer32Days,Math.floor(src.contactMonthlyCeilingCents*1000/35),'the $5 owner ceiling at $0.35 per 1,000');
 assert.equal(real.bounds.maxAttempts,src.maxContactDeliveryAttempts);
 const codes=[...p.errorClasses.notTaken,...p.errorClasses.rejected,...p.errorClasses.suppressed,'E_INTERNAL_SERVER_ERROR','E_NOT_DOCUMENTED',''];
 for(const code of codes){
  const o=src.cloudflareEmailOutcome(code?{code}:new Error('x')),c=real.classifyProviderError(real.notificationCatalog,src.cloudflareEmailProvider,code);
  const mapped=o.suppressed?'suppressed':o.uncertain?'uncertain':o.retryable?'not-taken':'rejected';
  assert.equal(c,mapped,code);
 }
});
await checkOnce('every existing contact outbox state maps to a contract receipt state',()=>{
 const sql=readFileSync(new URL('../schema/platform.sql',import.meta.url),'utf8');
 const table=sql.slice(sql.indexOf('CREATE TABLE contact_notification_outbox'));
 const list=re=>[...table.match(re)[1].matchAll(/'([a-z_]+)'/g)].map(x=>x[1]);
 const states=list(/state TEXT[^\n]*CHECK\(state IN \(([^)]*)\)\)/),errors=list(/last_error TEXT[^\n]*last_error IN \(([^)]*)\)\)/);
 assert.ok(states.length>=6&&errors.length>=6);
 for(const s of states){
  const entry=real.contactStateMap[s];assert.ok(entry,`unmapped contact state ${s}`);
  for(const v of typeof entry==='string'?[entry]:Object.values(entry))assert.ok(real.receiptStates.includes(v),`${s} -> ${v}`);
 }
 for(const v of Object.values(real.contactStateMap).flatMap(e=>typeof e==='string'?[]:Object.keys(e)))assert.ok(v==='null'||v==='not_sent'||errors.includes(v),v);
});
await checkOnce('the existing contact notification source cannot reach owner-maintenance inference',async()=>{
 const inference=/^src\/(ai|ai-chat|ai-gateway|acknowledgment|site-agent|agent-[a-z-]+|standard-ai[a-z-]*|chat|backend-chat|app-upgrade-chat|app-recovery-chat|app-page-design)\.ts$|^src\/chat-interactions\/(agent|agent-request|model-continuation|continuation)\.ts$/;
 for(const entry of ['src/contact-notifications.ts','src/contact-email.ts','src/notification-catalog.ts']){
  const out=await build({entryPoints:[entry],bundle:true,format:'esm',platform:'node',write:false,metafile:true,logLevel:'silent'});
  const inputs=Object.keys(out.metafile.inputs);assert.ok(inputs.length>0);
  assert.deepEqual(inputs.filter(p=>inference.test(p)),[],entry);
  for(const name of ['AI_GATEWAY','OPENAI','ANTHROPIC','sendAIChat','agentPrompt'])assert.ok(!out.outputFiles[0].text.includes(name),`${entry} references ${name}`);
 }
});
await checkOnce('the reference imports only node builtins and performs no network call',()=>{
 const specifiers=[...prototypeSource.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g)].map(x=>x[1]??x[2]);
 assert.deepEqual(specifiers,['node:crypto']);
 assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|process\.env/.test(prototypeSource));
});

// ---------- WH-155 source catalog agreement ----------
// The source catalog (src/notification-catalog.ts) must equal the frozen reference value for value, produce the same digests
// and renders, and refuse the same inputs with the same codes. Source mutants below must each be caught here.
const catalogURL=new URL('../src/notification-catalog.ts',import.meta.url);
const catalogSource=readFileSync(catalogURL,'utf8');
const bundleCatalog=async contents=>{
 const out=await build({stdin:{contents,loader:'ts',resolveDir:process.cwd(),sourcefile:'notification-catalog.ts'},bundle:true,format:'esm',platform:'neutral',write:false,logLevel:'silent'});
 return import('data:text/javascript;base64,'+Buffer.from(out.outputFiles[0].text).toString('base64'));
};
async function sourceSuite(S){
 let count=0;
 const test=async(name,fn)=>{try{await fn();count++;}catch(error){throw new Error(name,{cause:error});}};
 const code=async(fn,expected)=>{let got;try{await fn();}catch(e){got=e.code??e.message;}assert.equal(got,expected);};
 const refCode=async fn=>{try{await fn();return 'ok';}catch(e){return e.code??e.message;}};
 const C=()=>structuredClone(real.notificationCatalog);
 const pin=key=>{const t=real.notificationCatalog.templates[key].template;return {id:t.id,version:t.version,digest:real.templateDigest(t)};};
 const R='44444444-4444-4444-8444-444444444444';
 const staff=(o={})=>({contractVersion:1,id:'appointment-staff',template:pin('appointment.staff-notice@1'),trigger:{event:'form.accepted',resourceId:R,formId:'booking'},recipientScope:'project-staff',sender:'whumpo-notify',values:{businessName:'Shine Detailing'},fields:{},limits:{perRecipientHour:10,perRecipientDay:50},...o});
 const receipt=(o={})=>({...staff(),id:'appointment-receipt',template:pin('appointment.request-receipt@1'),recipientScope:'submitter',fields:{service:'service',day:'day'},limits:{perRecipientHour:3,perRecipientDay:10},...o});
 await test('source catalog equals the frozen reference catalog and validates',()=>{
  assert.deepEqual(JSON.parse(JSON.stringify(S.notificationCatalog)),JSON.parse(JSON.stringify(real.notificationCatalog)));
  assert.equal(S.validateNotificationCatalog(S.notificationCatalog),true);
  assert.ok(Object.isFrozen(S.notificationCatalog.templates['contact.new-message@1'].template.body),'the source catalog is deeply frozen');
  assert.deepEqual({...S.platformLinks},{...real.platformLinks});
  assert.deepEqual([...S.recipientScopes],[...real.recipientScopes]);assert.deepEqual([...S.notificationTriggers],[...real.triggers]);
 });
 await test('source digests equal reference digests for every template and the catalog',async()=>{
  for(const [key,e] of Object.entries(S.notificationCatalog.templates))assert.equal(await S.notificationTemplateDigest(e.template),real.templateDigest(real.notificationCatalog.templates[key].template),key);
  assert.equal(await S.notificationDigest(S.notificationCatalog),real.digest(real.notificationCatalog));
 });
 await test('source renders every template exactly as the reference',()=>{
  const f={service:{options:['Exterior wash','Full detail']},day:{options:['Monday','Tuesday']}};
  const cases={'contact.new-message@1':{},'owner.destination-verification@1':{code:'ABCD2345'},'appointment.staff-notice@1':{businessName:'Shine Detailing'},'appointment.request-receipt@1':{businessName:'Shine Detailing',reference:'ABCDEF12',service:'Full detail',day:'Tuesday'}};
  for(const [key,values] of Object.entries(cases))assert.deepEqual(S.renderCatalogNotification(key,values,f),real.render(real.notificationCatalog.templates[key].template,values,f),key);
  assert.deepEqual(S.renderCatalogNotification('contact.new-message@1'),goldenNewMessage);
  assert.equal(S.renderCatalogNotification('appointment.staff-notice@1',{businessName:'{{x}} ${y}'}).subject,'New appointment request for {{x}} ${y}','values are data, never template syntax');
 });
 await test('source renderer refuses invalid values, unknown and withdrawn templates',async()=>{
  for(const values of [{},{code:'abcd2345'},{code:'ABCD2345\r\nBcc: x'},{code:'ABCD234'}])await code(()=>S.renderCatalogNotification('owner.destination-verification@1',values),'INVALID_VARIABLE');
  for(const businessName of ['Shine\r\nBcc: victim@example.test','<script>x</script>','Visit https://evil.example','help@evil.example','x'.repeat(81)])
   await code(()=>S.renderCatalogNotification('appointment.staff-notice@1',{businessName}),'INVALID_VARIABLE');
  await code(()=>S.renderCatalogNotification('appointment.request-receipt@1',{businessName:'Shine',reference:'ABCDEF12',service:'Valet',day:'Monday'},{service:{options:['Full detail']},day:{options:['Monday']}}),'INVALID_VARIABLE');
  await code(()=>S.renderCatalogNotification('contact.new-message@2'),'UNKNOWN_TEMPLATE');
  await code(()=>S.renderCatalogNotification('__proto__'),'UNKNOWN_TEMPLATE');
  const w=C();w.templates['contact.new-message@1'].state='withdrawn';await code(()=>S.renderCatalogNotification('contact.new-message@1',{},{},w),'TEMPLATE_WITHDRAWN');
 });
 await test('source template and catalog validators refuse what the reference refuses, with the same codes',async()=>{
  const mut=(key,f)=>{const t=C().templates[key].template;f(t);return t;};
  const templates=[
   mut('appointment.staff-notice@1',t=>{t.contractVersion=2;}),mut('appointment.staff-notice@1',t=>{t.html='<b>x</b>';}),
   mut('appointment.staff-notice@1',t=>{t.purpose='marketing';}),mut('appointment.staff-notice@1',t=>{t.audiences=['everyone'];}),
   mut('appointment.staff-notice@1',t=>{t.body.push({link:'https://evil.example'});}),mut('appointment.staff-notice@1',t=>{t.subject.push({link:'workspace-inbox'});}),
   mut('appointment.staff-notice@1',t=>{t.variables.target={source:'request',type:'url'};t.body.push({var:'target'});}),
   mut('appointment.staff-notice@1',t=>{t.subject[0].text='Hi\r\nBcc: victim@example.test';}),mut('appointment.staff-notice@1',t=>{t.body[0].text='Hello {{owner.email}}';}),
   mut('appointment.staff-notice@1',t=>{t.body[0].text='Hello ${owner}';}),mut('appointment.staff-notice@1',t=>{t.subject[0].text='a'+String.fromCharCode(0x2028);}),
   mut('appointment.staff-notice@1',t=>{t.variables.vehicle={source:'record',type:'choice'};t.body.push({var:'vehicle'});}),
   mut('appointment.staff-notice@1',t=>{t.variables.unused={source:'config',type:'text-line'};}),mut('appointment.staff-notice@1',t=>{t.body.push({var:'missing'});}),
   mut('appointment.staff-notice@1',t=>{t.body.push({text:'x',var:'businessName'});}),mut('appointment.staff-notice@1',t=>{t.body.push({text:'x'.repeat(4000)});}),
   mut('appointment.staff-notice@1',t=>{t.subject.push({text:'x'.repeat(100)});}),mut('appointment.staff-notice@1',t=>{t.headers={'X-A':'1'};}),
   mut('contact.new-message@1',t=>{t.trigger='form.accepted';}),mut('contact.new-message@1',t=>{t.audiences=['owner-destination','submitter'];}),
   mut('appointment.staff-notice@1',t=>{t.trigger='contact.accepted';}),mut('owner.destination-verification@1',t=>{t.trigger='contact.accepted';}),
   mut('appointment.staff-notice@1',t=>{t.id='Bad Id';}),mut('appointment.staff-notice@1',t=>{t.version=0;}),
  ];
  for(const [i,t] of templates.entries()){
   const expected=await refCode(()=>real.validateTemplate(structuredClone(t)));
   assert.notEqual(expected,'ok',`case ${i} must be refused by the reference`);
   await code(()=>S.validateNotificationTemplate(t),expected);
  }
  const catalogs=[c=>{c.contractVersion=0;},c=>{c.senders['whumpo-notify'].displayName='Whumpo\r\nBcc: x';},c=>{c.senders['whumpo-notify'].dnsReview=null;},
   c=>{c.senders['whumpo-notify'].provider='nobody';},c=>{c.providers['cloudflare-email'].idempotency='maybe';},c=>{c.providers['cloudflare-email'].ceiling={callsPer32Days:0};},
   c=>{c.templates['contact.new-message@1'].readiness='done';},c=>{const e=c.templates['contact.new-message@1'];delete c.templates['contact.new-message@1'];c.templates['contact.new-message@2']=e;}];
  for(const [i,f] of catalogs.entries()){
   const c=C();f(c);const expected=await refCode(()=>real.validateCatalog(structuredClone(c)));
   assert.notEqual(expected,'ok',`catalog case ${i} must be refused by the reference`);
   await code(()=>S.validateNotificationCatalog(c),expected);
  }
 });
 await test('source configuration validator agrees with the reference on accepted and refused configurations',async()=>{
  for(const cfg of [staff(),staff({recipientScope:'owner-destination',id:'appointment-owner'}),receipt()]){
   const r=real.validateConfiguration(structuredClone(cfg)),v=await S.validateNotificationConfiguration(cfg);
   assert.equal(v.configurationDigest,r.configurationDigest);assert.deepEqual(v.price,r.price);assert.equal(v.sender.address,'notify@whumpo.com');
  }
  const contact=pin('contact.new-message@1');
  const unverified=C();unverified.senders['whumpo-notify'].state='unverified';
  const withdrawn=C();withdrawn.templates['appointment.staff-notice@1'].state='withdrawn';
  const cases=[
   ...[{to:'victim@example.test'},{cc:['a@example.test']},{bcc:'b@example.test'},{recipients:['x@example.test']},{replyTo:'x@example.test'},{headers:{'X-A':'1'}},{url:'https://evil.example'},{from:'ceo@example.test'},{apiKey:'x'},{priority:'high'}].map(extra=>[staff(extra)]),
   [staff({values:{email:'x@example.test'}})],[staff({values:{token:'x'}})],[staff({trigger:{event:'form.accepted',resourceId:R,formId:'booking',webhook:'https://evil.example'}})],
   [staff({values:{businessName:'Visit https://evil.example now'}})],[staff({values:{businessName:'Write to help@evil.example'}})],[staff({values:{businessName:'Shine\nBcc: x'}})],
   [staff({values:{businessName:'<b>Shine</b>'}})],[staff({values:{businessName:'Shine',extra:'x'}})],[staff({recipientScope:'anyone@example.test'})],[receipt({recipientScope:'project-staff'})],
   [receipt({fields:{service:'Service Name',day:'day'}})],[staff({contractVersion:2})],[staff({template:{id:contact.id,version:1,digest:contact.digest}})],
   [staff({template:{...pin('appointment.staff-notice@1'),digest:'0'.repeat(64)}})],[staff({template:{id:'appointment.staff-notice',version:2,digest:'0'.repeat(64)}})],
   [staff({trigger:{event:'contact.accepted',resourceId:R,formId:'booking'}})],[staff({trigger:{event:'form.accepted',resourceId:'not-a-uuid',formId:'booking'}})],
   [staff({limits:{perRecipientHour:11,perRecipientDay:50}})],[staff({limits:{perRecipientHour:10,perRecipientDay:51}})],[staff({limits:{perRecipientHour:5,perRecipientDay:4}})],
   [staff({sender:'nobody'})],[staff(),unverified],[staff(),withdrawn],
   ...['price','review','ceiling'].map(field=>{const c=C();c.providers['cloudflare-email'][field]=null;return [staff(),c];}),
  ];
  for(const [i,[cfg,catalog]] of cases.entries()){
   const expected=await refCode(()=>real.validateConfiguration(structuredClone(cfg),catalog?structuredClone(catalog):undefined));
   assert.notEqual(expected,'ok',`configuration case ${i} must be refused by the reference`);
   await code(()=>S.validateNotificationConfiguration(cfg,catalog),expected);
  }
 });
 await test('source provider error classes agree with the reference for every documented and unknown code',()=>{
  const p=real.notificationCatalog.providers['cloudflare-email'].errorClasses;
  for(const c of [...p.notTaken,...p.rejected,...p.suppressed,'E_INTERNAL_SERVER_ERROR','E_NOT_DOCUMENTED','','__proto__'])
   assert.equal(S.classifyProviderError('cloudflare-email',c),real.classifyProviderError(real.notificationCatalog,'cloudflare-email',c),c);
  assert.equal(S.classifyProviderError('unknown-provider','E_RATE_LIMIT_EXCEEDED'),'uncertain');
  assert.equal(S.classifyProviderError('__proto__','E_RATE_LIMIT_EXCEEDED'),'uncertain');
 });
 return count;
}
let sourceCount=0;
await checkOnce('the source catalog agrees with the frozen reference',async()=>{sourceCount=await sourceSuite(await bundleCatalog(catalogSource));});
total+=sourceCount-1;
await checkOnce('the source catalog imports nothing and the contact adapter no longer hard-codes notice text or provider facts',()=>{
 assert.ok(!/\bimport\b/.test(catalogSource.replace(/\/\*[\s\S]*?\*\//g,'')),'notification-catalog.ts must not import');
 assert.ok(!/\bfetch\s*\(|process\.env|\benv\./.test(catalogSource));
 const adapter=readFileSync(new URL('../src/contact-email.ts',import.meta.url),'utf8');
 for(const literal of ['A visitor sent a new message','Your Whumpo verification code','notify@whumpo.com','E_RATE_LIMIT_EXCEEDED','workspace/inbox'])assert.ok(!adapter.includes(literal),`contact-email.ts still contains ${literal}`);
});
const sourceMutants=[
 ['source open relay keys accepted',"check(!relayKeys.has(k.toLowerCase()),'OPEN_RELAY'","check(true,'OPEN_RELAY'"],
 ['source content allowed in owner/staff notices',"if(v.source==='record')check(","if(false)check("],
 ['source template syntax accepted',"check(!/\\{\\{|\\}\\}|\\$\\{/.test(text as string),'TEMPLATE_SYNTAX',p);","check(true,'TEMPLATE_SYNTAX',p);"],
 ['source render does not validate values',"check(spec&&variableTypes[spec.type](v,","check(spec||variableTypes[spec.type](v,"],
 ['source unverified sender accepted',"check(sender.state==='verified','SENDER_NOT_VERIFIED'","check(true,'SENDER_NOT_VERIFIED'"],
 ['source stale template digest accepted',"check(pin.digest===await notificationTemplateDigest(t),'STALE_TEMPLATE'","check(true,'STALE_TEMPLATE'"],
 ['source contact text drifted',"This notice does not include the message.","This notice does not include the message"],
 ['source withdrawn template rendered',"check(entry.state==='available','TEMPLATE_WITHDRAWN',key);",""],
 ['source error class widened',"if(e.notTaken.includes(code))return 'not-taken';","if(e.notTaken.includes(code)||code==='E_INTERNAL_SERVER_ERROR')return 'not-taken';"],
 ['source subject length unbounded',"segments(t.subject,'subject',false,notificationBounds.subjectChars);","segments(t.subject,'subject',false,1e9);"],
];
let sourceKilled=0;
for(const [name,find,replace] of sourceMutants){
 assert.equal(catalogSource.split(find).length,2,`source mutant "${name}" must match src/notification-catalog.ts exactly once`);
 const mutant=await bundleCatalog(catalogSource.replace(find,()=>replace));
 await assert.rejects(sourceSuite(mutant),e=>{if(process.argv.includes('--explain'))console.log(`${name} => ${e.message}`);return true;},`source mutant survived: ${name}`);sourceKilled++;
}

// ---------- Mutation check: each deliberately broken reference must fail the suite ----------
const mutants=[
 ['open relay keys accepted',"check(!relayKeys.has(k.toLowerCase()),'OPEN_RELAY'","check(true,'OPEN_RELAY'"],
 ['unknown configuration version accepted',"check(cfg.contractVersion===contractVersion,'UNSUPPORTED_VERSION','configuration.contractVersion');",''],
 ['unverified sender accepted',"check(sender.state==='verified','SENDER_NOT_VERIFIED'","check(true,'SENDER_NOT_VERIFIED'"],
 ['unpriced provider accepted',"check(provider.price,'UNPRICED_PROVIDER'","check(true,'UNPRICED_PROVIDER'"],
 ['review price not bound',"check(canonical(review.price)===canonical(v.price),'PRICE_MISMATCH','review.price');",''],
 ['render does not validate values',"check(variableTypes[spec.type](v,fields[name]),'INVALID_VARIABLE'","check(true,'INVALID_VARIABLE'"],
 ['content allowed in owner/staff notices',"if(v.source==='record')check(","if(false)check("],
 ['lost response retried',"else{move(n,'unknown-outcome','uncertain');n.uncertainAt=now;result.uncertain++;}","else{move(n,'deferred','uncertain');n.dueAt=now;result.deferred++;}"],
 ['interrupted dispatch requeued',"move(n,'unknown-outcome','interrupted');n.uncertainAt=now;","n.state='queued';n.history.push('queued');"],
 ['unknown outcome may be cancelled',"check(['queued','deferred'].includes(n.state),'CANNOT_RECALL',n.state);move(n,'cancelled','owner-cancelled');","check(n.state!=='cancelled','CANNOT_RECALL',n.state);n.state='cancelled';"],
 ['owner retry of an uncertain notice',"check(n.state==='deferred','NO_REDISPATCH',n.state);n.dueAt=now;","n.dueAt=now;"],
 ['revoked staff not rechecked',"if(!st||st.revoked||!p.visitors[n.recipientRef]?.notify)return 'recipient-revoked';","if(false)return 'recipient-revoked';"],
 ['bounce does not suppress',"if((type==='bounced'||type==='complained')&&address)suppress(n.ownerId,address);",''],
 ['unauthenticated events applied',"check(authenticated===true,'EVENT_NOT_AUTHENTICATED','event');",''],
 ['duplicate events re-applied',"if(s.providerEvents.includes(providerEventId))return {applied:false,duplicate:true};",''],
 ['reconciliation unbounded',"if(n.reconcileReads>=bounds.reconcileReads||now-n.uncertainAt>=bounds.reconcileWindowMs)move(n,'unresolved','reconcile-bound');",''],
 ['notification fault escapes the pass',"try{result.queued=derive();}catch{result.errors++;}","result.queued=derive();"],
 ['rejection deletes the accepted record',"else if(outcome?.kind==='rejected'){move(n,'failed','rejected');","else if(outcome?.kind==='rejected'){delete s.projects[n.projectId].records[n.recordId];move(n,'failed','rejected');"],
 ['spending ceiling ignored',"if(s.ledger.calls>=provider.ceiling.callsPer32Days)","if(false)"],
 ['anonymous submitter mailed',"if(record.submitter.kind==='visitor'&&record.receiptConsent&&p.visitors[record.submitter.visitorId]?.emailVerified)return [record.submitter.visitorId];","if(record.receiptConsent!==undefined)return ['v-sub'];"],
];
// Each mutant must be caught by the check written for that property, not by an unrelated failure.
const killedBy={
 'open relay keys accepted':'caller-supplied recipients','unknown configuration version accepted':'unknown contract versions',
 'unverified sender accepted':'an unverified or unknown sender','unpriced provider accepted':'an unpriced, unreviewed','review price not bound':'an unpriced, unreviewed',
 'render does not validate values':'template and value injection','content allowed in owner/staff notices':'owner and staff notices are content-free',
 'lost response retried':'a lost provider response','interrupted dispatch requeued':'an interrupted worker','unknown outcome may be cancelled':'a lost provider response',
 'owner retry of an uncertain notice':'a lost provider response','revoked staff not rechecked':'a recipient revoked',
 'bounce does not suppress':'authenticated bounce events','unauthenticated events applied':'authenticated bounce events','duplicate events re-applied':'authenticated bounce events',
 'reconciliation unbounded':'reconciliation is read-only and bounded','notification fault escapes the pass':'a failing notification never loses',
 'rejection deletes the accepted record':'a failing notification never loses','spending ceiling ignored':'the spending ceiling','anonymous submitter mailed':'recipients derive only from server-side records',
};
let killed=0;
for(const [name,find,replace] of mutants){
 assert.equal(prototypeSource.split(find).length,2,`mutant "${name}" must match the reference exactly once`);
 const mutant=await import('data:text/javascript;base64,'+Buffer.from(prototypeSource.replace(find,()=>replace)).toString('base64'));
 await assert.rejects(suite(mutant),e=>{
  if(process.argv.includes('--explain'))console.log(`${name} => ${e.message}`);
  assert.ok(killedBy[name]&&e.message.startsWith(killedBy[name]),`mutant "${name}" was caught by an unexpected check: ${e.message}`);return true;
 },`mutant survived: ${name}`);killed++;
}
assert.equal(killed,mutants.length);
console.log(`notifications-contract: ${suiteCount} reference checks and ${total-suiteCount} source-agreement/static checks passed; ${killed}/${mutants.length} reference mutants and ${sourceKilled}/${sourceMutants.length} source mutants caught (synthetic providers; no database, network, credential or model).`);
