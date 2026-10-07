import assert from 'node:assert/strict';
import {digest} from '../../tools/prototypes/connectors.mjs';
const owner=(ownerId='owner-a')=>({kind:'owner',ownerId});
const zone='0123456789abcdef0123456789abcdef';
const token=(scope,extra={})=>({access_token:'synthetic-access',token_type:'Bearer',expires_in:3600,...(scope?{scope}:{}),...extra});
const gmailScopes='https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send';
const send={raw:'c3ludGhldGlj',threadId:'t1'};
const rejects=async(fn,code)=>assert.rejects(async()=>fn(),e=>{assert.equal(e.code,code);return true;});
const throws=(fn,code)=>assert.throws(fn,e=>{assert.equal(e.code,code);return true;});
export async function runConformance(label,make,test,scope='full'){
 if(scope==='actions')return runActionConformance(label,make,test);
 const t=(name,fn)=>test(`${label}: ${name}`,fn);
 // Host/scope allowlist.
 await t('only allowlisted hosts are contacted and redirects are refused, not followed',async()=>{
  const {rt,s}=make();rt.connect('owner-a','cloudflare',token('zone.read dns.read dns.write',{expires_in:3600}));
  s.mode.redirect=true;await rejects(()=>rt.read(owner(),'cloudflare','zones.list',{page:1}),'REDIRECT_REFUSED');assert.equal(s.calls.length,1);
 });
 await t('token responses with widened scope, long lifetime, wrong type or unexpected refresh are refused',async()=>{
  const {rt}=make();
  throws(()=>rt.connect('owner-a','cloudflare',token('zone.read dns.read dns.write account.write')),'SCOPE_WIDENED');
  throws(()=>rt.connect('owner-a','cloudflare',token(undefined,{expires_in:86400*30})),'INVALID_TOKEN');
  throws(()=>rt.connect('owner-a','cloudflare',token(undefined,{token_type:'mac'})),'INVALID_TOKEN');
  throws(()=>rt.connect('owner-a','cloudflare',token(undefined,{refresh_token:'synthetic-refresh'})),'UNEXPECTED_REFRESH');
  rt.connect('owner-a','cloudflare',token());throws(()=>rt.connect('owner-a','cloudflare',token()),'DISCONNECT_FIRST');
 });
 await t('an operation needing an ungranted scope is refused before dispatch',async()=>{
  const {rt,s}=make();rt.connect('owner-a','gmail',token('https://www.googleapis.com/auth/gmail.readonly',{refresh_token:'r'}));
  await rejects(()=>rt.prepareAction(owner(),'gmail','message.send',{},send),'INSUFFICIENT_SCOPE');assert.equal(s.calls.length,0);
 });
 // Revoked / expired credentials.
 await t('disconnect disables local access before revocation; later use never reaches the provider',async()=>{
  const {rt,s}=make();rt.connect('owner-a','cloudflare',token());s.revoke=500;
  assert.equal((await rt.disconnect('owner-a','cloudflare')).state,'revocation-pending');const before=s.calls.length;
  await rejects(()=>rt.read(owner(),'cloudflare','zones.list',{page:1}),'NOT_CONNECTED');assert.equal(s.calls.length,before);
  assert.equal(rt.status('owner-a','cloudflare').consent,'revocation-pending');
 });
 await t('a provider without a revocation endpoint reports owner action, never claims revocation',async()=>{
  const {rt,s}=make();rt.connect('owner-a','outlook-email',token('offline_access Mail.Read Mail.Send',{refresh_token:'r'}));
  assert.equal((await rt.disconnect('owner-a','outlook-email')).state,'revocation-owner-action');assert.equal(s.calls.length,0);
 });
 await t('expired access without refresh custody is refused with zero provider calls',async()=>{
  const {rt,s}=make();rt.connect('owner-a','cloudflare',token());rt.expire('owner-a','cloudflare');
  await rejects(()=>rt.read(owner(),'cloudflare','zones.list',{page:1}),'EXPIRED');assert.equal(s.calls.length,0);
  assert.equal(rt.status('owner-a','cloudflare').consent,'expired');
 });
 await t('refresh is single-flight, bounded and never widens scope',async()=>{
  const {rt,s}=make();rt.connect('owner-a','google-calendar',token(undefined,{refresh_token:'r'}));rt.expire('owner-a','google-calendar');
  await Promise.all([rt.read(owner(),'google-calendar','calendars.list',{}),rt.read(owner(),'google-calendar','calendars.list',{})]);
  assert.equal(s.calls.filter(c=>c.url.endsWith('/token')).length,1);
 });
 await t('lost refresh reply fails that use and retries the same custody next time; invalid_grant requires reauthorization',async()=>{
  const {rt,s}=make();rt.connect('owner-a','google-calendar',token(undefined,{refresh_token:'r'}));rt.expire('owner-a','google-calendar');
  s.token.lose=true;await rejects(()=>rt.read(owner(),'google-calendar','calendars.list',{}),'REFRESH_UNCERTAIN');
  s.token.lose=false;s.token.invalid=true;await rejects(()=>rt.read(owner(),'google-calendar','calendars.list',{}),'REAUTHORIZATION_REQUIRED');
  const before=s.calls.length;await rejects(()=>rt.read(owner(),'google-calendar','calendars.list',{}),'NOT_CONNECTED');assert.equal(s.calls.length,before);
  assert.equal(rt.status('owner-a','google-calendar').consent,'reauthorization-required');
 });
 await t('disconnect during an in-flight read refuses the stale result',async()=>{
  const {rt,s}=make();rt.connect('owner-a','cloudflare',token());s.mode.beforeReply=()=>rt.disconnect('owner-a','cloudflare');
  await rejects(()=>rt.read(owner(),'cloudflare','zones.list',{page:1}),'ACCESS_CHANGED');
 });
 await t('provider 401 marks access rejected with no retry',async()=>{
  const {rt,s}=make();rt.connect('owner-a','cloudflare',token());s.mode.status=401;
  await rejects(()=>rt.read(owner(),'cloudflare','zones.list',{page:1}),'PROVIDER_REJECTED');assert.equal(s.calls.length,1);
  await rejects(()=>rt.read(owner(),'cloudflare','zones.list',{page:1}),'NOT_CONNECTED');assert.equal(s.calls.length,1);
 });
 // Durable dispatch receipts and unknown outcomes.
 const prepared=async(rt,marker='m-1')=>{rt.connect('owner-a','cloudflare',token());return rt.prepareAction(owner(),'cloudflare','dnsRecord.create',{zone},{type:'TXT',name:'_whumpo.www.example.com',content:'"v"',ttl:1,comment:marker});};
 const observe=marker=>r=>({operationId:'dnsRecords.findExact',params:{zone,name:'_whumpo.www.example.com'},matches:j=>j.items.some(i=>i.marker===marker)});
 await t('lost response after the provider applied: uncertain, never redispatched, reconciled by readback',async()=>{
  const {rt,s}=make(),p=await prepared(rt);s.mode.lose='after';
  assert.equal((await rt.confirmAction(owner(),p.receiptId,{reviewDigest:p.reviewDigest,acceptedPrice:p.price})).state,'uncertain');
  s.mode.lose=null;assert.deepEqual(await rt.confirmAction(owner(),p.receiptId,{reviewDigest:p.reviewDigest,acceptedPrice:p.price}),{state:'uncertain',dispatched:false});
  assert.equal((await rt.reconcile(owner(),p.receiptId,observe('m-1'))).state,'observed');
  assert.equal(s.effects.length,1);assert.equal(rt.receipt(p.receiptId).dispatches,1);
 });
 await t('lost request before the provider applied stays held; reconciliation never resends',async()=>{
  const {rt,s}=make(),p=await prepared(rt);s.mode.lose='before';
  await rt.confirmAction(owner(),p.receiptId,{reviewDigest:p.reviewDigest,acceptedPrice:p.price});s.mode.lose=null;
  assert.equal((await rt.reconcile(owner(),p.receiptId,observe('m-1'))).state,'uncertain');
  await rt.confirmAction(owner(),p.receiptId,{reviewDigest:p.reviewDigest,acceptedPrice:p.price});
  assert.equal(s.effects.length,0);assert.equal(rt.receipt(p.receiptId).dispatches,1);
 });
 await t('concurrent confirmations dispatch once',async()=>{
  const {rt,s}=make(),p=await prepared(rt),c={reviewDigest:p.reviewDigest,acceptedPrice:p.price};
  await Promise.all([rt.confirmAction(owner(),p.receiptId,c),rt.confirmAction(owner(),p.receiptId,c),rt.confirmAction(owner(),p.receiptId,c)]);
  assert.equal(s.effects.length,1);assert.equal(rt.receipt(p.receiptId).dispatches,1);
 });
 await t('a definitive provider rejection fails without retry; it is not uncertain',async()=>{
  const {rt,s}=make(),p=await prepared(rt);s.mode.reject=true;
  assert.equal((await rt.confirmAction(owner(),p.receiptId,{reviewDigest:p.reviewDigest,acceptedPrice:p.price})).state,'failed');
  assert.equal((await rt.confirmAction(owner(),p.receiptId,{reviewDigest:p.reviewDigest,acceptedPrice:p.price})).dispatched,false);
 });
 await t('reconciliation is limited to the action\'s declared reads',async()=>{
  const {rt,s}=make(),p=await prepared(rt);s.mode.lose='before';await rt.confirmAction(owner(),p.receiptId,{reviewDigest:p.reviewDigest,acceptedPrice:p.price});s.mode.lose=null;
  await rejects(()=>rt.reconcile(owner(),p.receiptId,()=>({operationId:'dnsRecord.create',params:{zone},body:{type:'TXT'},matches:()=>true})),'RECONCILE_NOT_DECLARED');
  await rejects(()=>rt.reconcile(owner(),p.receiptId,()=>({operationId:'zones.list',params:{page:1},matches:()=>true})),'RECONCILE_NOT_DECLARED');
  await rejects(()=>rt.reconcile(owner('owner-b'),p.receiptId,observe('m-1')),'NOT_FOUND');
  assert.equal(s.effects.length,0);
 });
 await t('price is explicit and bound into the exact review',async()=>{
  const {rt,clock}=make(),p=await prepared(rt);
  assert.deepEqual(p.price,{customerUnits:0,basis:'plan-inclusion'});
  await rejects(()=>rt.confirmAction(owner(),p.receiptId,{reviewDigest:p.reviewDigest}),'PRICE_NOT_ACCEPTED');
  await rejects(()=>rt.confirmAction(owner(),p.receiptId,{reviewDigest:'0'.repeat(64),acceptedPrice:p.price}),'STALE_REVIEW');
  rt.catalog.providers.cloudflare.operations['dnsRecord.create'].price={customerUnits:3,basis:'quoted'};
  await rejects(()=>rt.confirmAction(owner(),p.receiptId,{reviewDigest:p.reviewDigest,acceptedPrice:p.price}),'STALE_REVIEW');
  rt.catalog.providers.cloudflare.operations['dnsRecord.create'].price={customerUnits:0,basis:'plan-inclusion'};
  clock.t+=11*60e3;await rejects(()=>rt.confirmAction(owner(),p.receiptId,{reviewDigest:p.reviewDigest,acceptedPrice:p.price}),'REVIEW_EXPIRED');
 });
 await t('a review bound to replaced access is stale',async()=>{
  const {rt}=make(),p=await prepared(rt);await rt.disconnect('owner-a','cloudflare');rt.connect('owner-a','cloudflare',token());
  await rejects(()=>rt.confirmAction(owner(),p.receiptId,{reviewDigest:p.reviewDigest,acceptedPrice:p.price}),'STALE_REVIEW');
 });
 // Request-bound lookup/data-use consent.
 const gmail=(rt)=>rt.connect('owner-a','gmail',token(gmailScopes,{refresh_token:'r'}));
 await t('content reads need confirmed consent bound to owner, credential, exact query and destination',async()=>{
  const {rt,s}=make();gmail(rt);
  await rejects(()=>rt.read(owner(),'gmail','messages.search',{q:'invoice'}),'CONSENT_REQUIRED');
  const c=rt.proposeLookup(owner(),'gmail','messages.search',{q:'invoice'},'owner-panel');
  await rejects(()=>rt.read(owner(),'gmail','messages.search',{q:'invoice'},{consentId:c.consentId}),'CONSENT_MISMATCH');
  throws(()=>rt.confirmLookup(owner('owner-b'),c.consentId),'NOT_FOUND');rt.confirmLookup(owner(),c.consentId);
  await rejects(()=>rt.read(owner(),'gmail','messages.search',{q:'payroll'},{consentId:c.consentId}),'CONSENT_MISMATCH');
  await rejects(()=>rt.read(owner(),'gmail','messages.search',{q:'invoice'},{consentId:c.consentId,destination:'model-context'}),'CONSENT_REQUIRED');
  await rejects(()=>rt.read(owner('owner-b'),'gmail','messages.search',{q:'invoice'},{consentId:c.consentId}),'NOT_CONNECTED');
  const r=await rt.read(owner(),'gmail','messages.search',{q:'invoice'},{consentId:c.consentId});assert.equal(r.provenance,'untrusted-external');assert.equal(r.dataClass,'connector-content');
  await rejects(()=>rt.read(owner(),'gmail','messages.search',{q:'invoice'},{consentId:c.consentId}),'CONSENT_MISMATCH');
  assert.equal(s.calls.length,1);
 });
 await t('consent expires and does not survive reconnection',async()=>{
  const {rt,clock}=make();gmail(rt);
  const a=rt.proposeLookup(owner(),'gmail','messages.search',{q:'x'},'owner-panel');rt.confirmLookup(owner(),a.consentId);clock.t+=16*60e3;
  await rejects(()=>rt.read(owner(),'gmail','messages.search',{q:'x'},{consentId:a.consentId}),'CONSENT_MISMATCH');
  const b=rt.proposeLookup(owner(),'gmail','messages.search',{q:'x'},'owner-panel');rt.confirmLookup(owner(),b.consentId);
  await rt.disconnect('owner-a','gmail');gmail(rt);
  await rejects(()=>rt.read(owner(),'gmail','messages.search',{q:'x'},{consentId:b.consentId}),'CONSENT_MISMATCH');
 });
 await t('calendar ranges are bounded',async()=>{
  const {rt}=make();rt.connect('owner-a','google-calendar',token(undefined,{refresh_token:'r'}));
  throws(()=>rt.proposeLookup(owner(),'google-calendar','events.range',{calendar:'primary',from:'2026-01-01T00:00:00Z',to:'2026-06-01T00:00:00Z'},'owner-panel'),'RANGE_TOO_WIDE');
 });
 await t('connected content never reaches a training-enabled model route',async()=>{
  const {rt}=make();gmail(rt);
  throws(()=>rt.proposeLookup(owner(),'gmail','message.get',{id:'abc'},'model-context'),'ROUTE_INELIGIBLE');
 });
 await t('external data cannot confirm consent, reviews or tools',async()=>{
  const {rt,s}=make();gmail(rt);
  const c=rt.proposeLookup(owner(),'gmail','message.get',{id:'abc'},'owner-panel');rt.confirmLookup(owner(),c.consentId);
  const pending=rt.proposeLookup(owner(),'gmail','message.get',{id:'def'},'owner-panel');
  s.mode.injected={consentId:pending.consentId,approve:true,tool:'message.send'};
  const r=await rt.read(owner(),'gmail','message.get',{id:'abc'},{consentId:c.consentId});assert.ok(Object.isFrozen(r));
  throws(()=>rt.confirmLookup({kind:'external-content',ownerId:'owner-a'},r.data.note.consentId),'PRINCIPAL_FORBIDDEN');
  await rejects(()=>rt.read(owner(),'gmail','message.get',{id:'def'},{consentId:r.data.note.consentId}),'CONSENT_MISMATCH');
  await rejects(()=>rt.prepareAction({kind:'external-content',ownerId:'owner-a'},'gmail','message.send',{},send),'PRINCIPAL_FORBIDDEN');
 });
 // Authority classes.
 const rule=(approval,extra={})=>({kind:'rule',ownerId:'owner-a',ruleId:'rule-1',ruleRevision:3,jobDigest:'j'.repeat(64),approval,...extra});
 await t('owner-request-only operations refuse rule context even when scopes permit',async()=>{
  const {rt,s}=make();gmail(rt);
  await rejects(()=>rt.prepareAction(rule({operationId:'message.send',destinationDigest:digest({}),bodyTemplateDigest:digest(send),maxPerPeriod:5}),'gmail','message.send',{},send),'OWNER_REQUEST_ONLY');
  await rejects(()=>rt.read(rule({}),'gmail','messages.search',{q:'x'}),'RULE_READ_FORBIDDEN');
  assert.equal(s.calls.length,0);
 });
 await t('visitor, runtime and maintainer contexts can never use a connector',async()=>{
  const {rt}=make();gmail(rt);
  for(const kind of ['visitor','runtime','maintainer'])await rejects(()=>rt.read({kind,ownerId:'owner-a'},'gmail','messages.search',{q:'x'}),'PRINCIPAL_FORBIDDEN');
 });
 return t;
}

/** The shared action slice runs against each implemented provider's actual D1 handlers. OAuth,
 * token custody and typed transport checks remain in their dedicated provider suites. Planned
 * lookup/refresh/rule cases in the full reference suite are not reported as D1 acceptance. */
async function runActionConformance(label,make,test){
 const t=(name,fn)=>test(`${label}: ${name}`,fn);
 await t('review price, authority and exact confirmation',async()=>{
  const a=await make(),p=a.review.connector;
  assert.equal(p.state,'review');assert.equal(p.authority,'owner-request');assert.deepEqual(p.price,{customerUnits:0,basis:'plan-inclusion'});
  for(const field of ['operationDigest','requestDigest','reviewDigest'])assert.match(p[field],/^[0-9a-f]{64}$/);
  for(const approval of [undefined,{}, {reviewDigest:p.reviewDigest}, {reviewDigest:'0'.repeat(64),acceptedPrice:p.price}, {reviewDigest:p.reviewDigest,acceptedPrice:{customerUnits:1,basis:'quoted'}}, {reviewDigest:p.reviewDigest,acceptedPrice:p.price,approve:true}])await assert.rejects(()=>a.confirm(approval));
  assert.equal(a.writes(),0);
  if(a.tamper)for(const field of ['operation_digest','request_digest','review_digest','price_json'])await assert.rejects(()=>a.tamper(field));
 });
 await t('concurrent exact confirmations and replay send one mutation',async()=>{
  const a=await make(),p=a.review.connector,approval={reviewDigest:p.reviewDigest,acceptedPrice:p.price};
  const results=await Promise.all([a.confirm(approval),a.confirm(approval),a.confirm(approval)]);
  assert.ok(results.some(r=>['applied','observed','unchanged'].includes(r.connector.state)));assert.equal(a.writes(),1);
  await a.confirm(approval);assert.equal(a.writes(),1);
 });
 for(const mode of ['lost-before','lost-after','429','500','redirect','unreadable'])await t(`${mode} stays read-only after one dispatch`,async()=>{
  const a=await make(),p=a.review.connector,approval={reviewDigest:p.reviewDigest,acceptedPrice:p.price};a.outcome(mode);
  assert.equal((await a.confirm(approval)).connector.state,'uncertain');assert.equal(a.writes(),1);
  a.outcome('ok');const recovered=await a.confirm(approval);
  assert.equal(recovered.connector.state,mode==='lost-after'?a.observedState:'uncertain');assert.equal(a.writes(),1);
 });
}
