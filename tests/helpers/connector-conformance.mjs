import assert from 'node:assert/strict';

// WH-142 reusable connector conformance helper. Two layers:
// 1. referenceConformance(): the WH-140 `runConformance` suite and its synthetic provider, moved verbatim from
//    tests/connectors-contract.mjs, which still runs it against the synthetic reference runtime.
// 2. runActionConformance(): the contract's action/receipt clauses (exact review, one atomic claim, replay, lost and
//    reordered replies, expiry/revocation/credential binding, read-only reconciliation, price and common receipt state)
//    over a small driver interface, so the same cases run against the reference runtime and the real D1-backed GitHub
//    backup and Cloudflare DNS handlers (tests/connector-conformance-handlers.mjs). A driver may declare a known gap
//    for a case; the case then pins the driver's current behaviour instead of the contract's, and fails when that
//    behaviour changes, so docs/connectors.md must be updated. A driver may also declare `observedState: false` when its
//    table cannot record `observed` (GitHub backups): the reconciliation case then requires the honest mapping instead
//    (`applied` with `verified-readback` evidence). Synthetic providers and invented identifiers only.

const zone='0123456789abcdef0123456789abcdef';
const owner=(ownerId='owner-a')=>({kind:'owner',ownerId});
const rejects=async(fn,code)=>assert.rejects(async()=>fn(),e=>{assert.equal(e.code,code);return true;});
const throws=(fn,code)=>assert.throws(fn,e=>{assert.equal(e.code,code);return true;});

/** The WH-140 runtime conformance suite. `m` is the bundled catalog/builder/reference module; `test(name, fn)` is the
 *  caller's named-check runner (the contract harness mutation table refers to these names). */
export function referenceConformance({m,test}){
 const allowedOrigins=new Set(Object.values(m.connectorCatalog.providers).flatMap(e=>[...e.origins,...[e.authorization.token,e.authorization.revoke].filter(Boolean).map(u=>new URL(u).origin)]));
 function fakeProvider(){
  const s={calls:[],effects:[],mode:{},token:{},revoke:200};
  async function transport(req){
   s.calls.push(req);assert.equal(req.redirect,'manual');const u=new URL(req.url);assert.ok(allowedOrigins.has(u.origin),'unexpected host '+u.origin);
   if(s.mode.beforeReply){const f=s.mode.beforeReply;s.mode.beforeReply=null;await f(req);}
   if(/\/(token|oauth2\/v2\.0\/token|oauth\/v1\/token)$/.test(u.pathname)){
    if(s.token.lose)throw Error('connection reset');
    if(s.token.invalid)return {status:400,json:{error:'invalid_grant'}};
    s.token.count=(s.token.count??0)+1;return {status:200,json:{access_token:'synthetic-access-'+s.token.count,token_type:'Bearer',expires_in:3600}};
   }
   if(/revoke|refresh-tokens|applications/.test(u.pathname))return {status:s.revoke,json:null};
   if(s.mode.status)return {status:s.mode.status,json:{}};
   if(s.mode.redirect)return {status:302,json:null};
   if(req.method==='POST'&&s.mode.action!=='read'&&/send|events$|contacts$|dns_records$/.test(u.pathname)){
    const marker=JSON.parse(req.body).marker??JSON.parse(req.body).comment??JSON.parse(req.body).properties?.marker;
    if(s.mode.lose==='before')throw Error('timeout before provider accepted');
    if(s.mode.reject)return {status:422,json:{error:'invalid'}};
    s.effects.push(marker);
    if(s.mode.lose==='after')throw Error('response lost after provider accepted');
    return {status:200,json:{id:'provider-'+s.effects.length}};
   }
   return {status:200,json:{items:s.effects.map(marker=>({marker})),note:s.mode.injected??null}};
  }
  return {s,transport};
 }
 const trainingRoute={connectorContent:{trainingUse:true,approvedForConnectorContent:false}},approvedRoute={connectorContent:{trainingUse:false,approvedForConnectorContent:true}};
 const token=(scope,extra={})=>({access_token:'synthetic-access',token_type:'Bearer',expires_in:3600,...(scope?{scope}:{}),...extra});
 const gmailScopes='https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send';
 const send={raw:'c3ludGhldGlj',threadId:'t1'};

 /** Conformance cases any adapter runtime must pass. `make` returns {rt, s, clock}. */
 async function runConformance(label,make){
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
  const observe=marker=>()=>({operationId:'dnsRecords.findExact',params:{zone,name:'_whumpo.www.example.com'},matches:j=>j.items.some(i=>i.marker===marker)});
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
   await rejects(()=>rt.prepareAction(rule({operationId:'message.send',destinationDigest:m.digest({}),bodyTemplateDigest:m.digest(send),maxPerPeriod:5}),'gmail','message.send',{},send),'OWNER_REQUEST_ONLY');
   await rejects(()=>rt.read(rule({}),'gmail','messages.search',{q:'x'}),'RULE_READ_FORBIDDEN');
   assert.equal(s.calls.length,0);
  });
  await t('visitor, runtime and maintainer contexts can never use a connector',async()=>{
   const {rt}=make();gmail(rt);
   for(const kind of ['visitor','runtime','maintainer'])await rejects(()=>rt.read({kind,ownerId:'owner-a'},'gmail','messages.search',{q:'x'}),'PRINCIPAL_FORBIDDEN');
  });
  return t;
 }
 return {fakeProvider,runConformance,token,gmailScopes,trainingRoute,approvedRoute};
}

// ---------- Action/receipt conformance over a driver (WH-142) ----------

/** Frozen common receipt states (docs/connectors.md, "Actions, receipts and unknown outcomes"). */
export const commonReceiptStates=Object.freeze(['review','dispatching','applied','unchanged','uncertain','observed','failed','expired','cancelled']);

/** Gaps a driver may declare against a case. Each names a row of the docs/connectors.md gap table. */
export const actionGaps=Object.freeze({
 'G-C5':'The review does not state or bind an explicit price, and confirmation does not echo one.',
 'G-C7':'Receipt states use table-specific names instead of the common receipt states.',
 'G-C8':'A definitive provider rejection settles as uncertain (operator review), not failed.',
 'G-C9':'The review has no review digest, and confirmation does not echo one.',
});

/** Maps one recorded provider request to exactly one catalog operation of `entry`: method, exact origin, path template,
 *  query keys and, for GraphQL, the registered document. Anything else is an undeclared request and throws. */
export function operationOf(entry,documents,request){
 const u=new URL(request.url),method=request.method??'GET';
 const found=Object.entries(entry.operations).filter(([,op])=>{
  if(op.method!==method||op.origin!==u.origin)return false;
  const pattern=new RegExp('^'+op.path.split(/\{[A-Za-z]+\}/).map(part=>part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('[^/]+')+'$');
  if(!pattern.test(u.pathname))return false;
  if([...u.searchParams.keys()].sort().join('&')!==op.query.map(([k])=>k).sort().join('&'))return false;
  if(op.body?.kind==='graphql'){try{return JSON.parse(request.body).query===documents[op.body.document];}catch{return false;}}
  return true;
 });
 assert.equal(found.length,1,`undeclared provider request ${method} ${u.origin}${u.pathname}`);
 return found[0][0];
}

/**
 * Runs the contract's action/receipt cases against one driver. The driver owns fixtures and the synthetic provider:
 *  - `setup({shortCredential})` returns a fresh per-case context (owner, credential, review inputs, provider);
 *    `teardown(ctx)` undoes any clock change.
 *  - `prepare(ctx)`, `confirm(ctx,id,{as,acceptedPrice,reviewDigest})`, `reconcile(ctx,id,{as})` return the driver's
 *    receipt view; `id(view)`, `rawState(view)`, `price(view)`, `reviewDigest(view)` read it.
 *  - `provider(ctx)` returns `{requests, mutations, effects, mode}`; `mode.lose` ('before'|'after'), `mode.reject` and
 *    `hold()` (delays the next mutation before it applies; returns `{reached, release}`) shape the next mutation.
 *  - `revoke`, `replace`, `expireReview`, `expireCredential` change local authority as the named contract event.
 *  - `stateMap` maps every raw receipt state to a common state; `gaps` maps case keys to declared gap IDs;
 *    `capabilities` lists optional cases the driver supports; `observedState: false` with `evidence(view)` declares a
 *    table that cannot record `observed`.
 * `catalog` and `documents` are the source catalog and registered GraphQL documents; `test(name,fn)` names each check.
 */
export async function runActionConformance(label,driver,{catalog,documents,test}){
 const entry=catalog.providers[driver.providerId],action=entry.operations[driver.operationId];
 assert.ok(action&&action.kind==='action',`${driver.providerId}.${driver.operationId} is a catalog action`);
 for(const [key,id] of Object.entries(driver.gaps??{}))assert.ok(actionGaps[id],`${label}: unknown gap ${id} for ${key}`);
 const raw=new Set(),used=new Set(),skipped=[];
 const common=view=>{const state=driver.rawState(view);raw.add(state);assert.ok(Object.hasOwn(driver.stateMap,state),`${label}: unmapped receipt state ${state}`);return driver.stateMap[state];};
 const gap=key=>{const id=driver.gaps?.[key];if(id)used.add(key);return id;};
 const ops=(ctx,from=0)=>driver.provider(ctx).requests.slice(from).map(r=>operationOf(entry,documents,r));
 const t=(key,name,fn,requires)=>{
  if(requires&&!driver.capabilities?.includes(requires)){skipped.push(key);return;}
  return test(`${label}: ${name}`,async()=>{const ctx=await driver.setup(fn.options??{});try{await fn(ctx,driver.provider(ctx));}finally{await driver.teardown?.(ctx);}});
 };
 const withOptions=(options,fn)=>Object.assign(fn,{options});
 const prepared=async ctx=>{const v=await driver.prepare(ctx);return driver.id(v);};
 const refused=async(promise)=>assert.rejects(promise,()=>true);

 await t('prepare','an exact review is prepared without dispatch and reads only declared review inputs',async(ctx,p)=>{
  const v=await driver.prepare(ctx);assert.equal(common(v),'review');assert.equal(p.mutations,0);
  for(const id of ops(ctx)){const op=entry.operations[id];assert.equal(op.kind,'read',id);assert.ok(op.destinations.includes('review-receipt'),id);}
 });
 await t('prepareReplay','a repeated review request returns the same receipt',async(ctx,p)=>{
  const a=await driver.prepare(ctx),b=await driver.prepare(ctx);assert.deepEqual(b,a);assert.equal(p.mutations,0);
 },'prepareReplay');
 await t('confirmReplay','confirmation applies once; a replayed confirmation returns the same receipt without redispatch',async(ctx,p)=>{
  const id=await prepared(ctx),a=await driver.confirm(ctx,id);assert.equal(common(a),'applied');assert.equal(p.mutations,1);
  const n=p.requests.length,b=await driver.confirm(ctx,id);assert.deepEqual(b,a);assert.equal(p.mutations,1);assert.equal(p.effects,1);
  assert.ok(ops(ctx,n).every(op=>op!==driver.operationId));
 });
 await t('concurrent','concurrent duplicate confirmations dispatch once',async(ctx,p)=>{
  const id=await prepared(ctx);await Promise.all([driver.confirm(ctx,id),driver.confirm(ctx,id),driver.confirm(ctx,id)]);
  assert.equal(common(await driver.confirm(ctx,id)),'applied');assert.equal(p.mutations,1);assert.equal(p.effects,1);
 });
 await t('reordered','a delayed provider acknowledgement and a concurrent check settle once, in order',async(ctx,p)=>{
  const id=await prepared(ctx),{reached,release}=p.hold();const first=driver.confirm(ctx,id);await reached;
  // The second request arrives while the first dispatch is in flight; it may only observe.
  const second=await driver.confirm(ctx,id);assert.ok(['dispatching','uncertain'].includes(common(second)),common(second));assert.equal(p.mutations,1);
  release();assert.equal(common(await first),'applied');
  assert.equal(common(await driver.confirm(ctx,id)),'applied');assert.equal(p.mutations,1);assert.equal(p.effects,1);
 });
 await t('lostAfter','a reply lost after the provider applied stays held, is never redispatched and reconciles read-only',async(ctx,p)=>{
  const id=await prepared(ctx);p.mode.lose='after';assert.equal(common(await driver.confirm(ctx,id)),'uncertain');p.mode.lose=null;
  const n=p.requests.length,r=await driver.reconcile(ctx,id);
  // A table that cannot record `observed` must say so instead of claiming it (GitHub: every completed backup is a verified
  // readback, but the row does not record which path completed it).
  if(gap('reconciledState'))assert.equal(common(r),'applied');
  else if(driver.observedState===false){assert.equal(common(r),'applied');assert.equal(driver.evidence(r),'verified-readback');}
  else assert.equal(common(r),'observed');
  for(const op of ops(ctx,n))assert.ok(action.reconcile.includes(op),`reconciliation used ${op}`);
  assert.equal(common(await driver.confirm(ctx,id)),common(r));assert.equal(p.mutations,1);assert.equal(p.effects,1);
 });
 await t('lostBefore','a request lost before the provider applied keeps the hold; reconciliation never resends',async(ctx,p)=>{
  const id=await prepared(ctx);p.mode.lose='before';assert.equal(common(await driver.confirm(ctx,id)),'uncertain');p.mode.lose=null;
  const n=p.requests.length;
  for(let i=0;i<2;i++)assert.equal(common(await driver.reconcile(ctx,id)),'uncertain');
  assert.equal(common(await driver.confirm(ctx,id)),'uncertain');
  for(const op of ops(ctx,n))assert.ok(action.reconcile.includes(op),`reconciliation used ${op}`);
  assert.equal(p.mutations,1);assert.equal(p.effects,0);
 });
 await t('rejected','a definitive provider rejection settles failed and is never retried',async(ctx,p)=>{
  const id=await prepared(ctx);p.mode.reject=true;const a=await driver.confirm(ctx,id);p.mode.reject=false;
  assert.equal(common(a),gap('rejected')?'uncertain':'failed');
  assert.equal(common(await driver.confirm(ctx,id)),common(a));assert.equal(p.mutations,1);assert.equal(p.effects,0);
 });
 await t('expiredReview','an expired review is refused with no dispatch',async(ctx,p)=>{
  const id=await prepared(ctx);await driver.expireReview(ctx);await refused(driver.confirm(ctx,id));assert.equal(p.mutations,0);
 });
 await t('revoked','a revoked credential is refused before any provider request',async(ctx,p)=>{
  const id=await prepared(ctx);await driver.revoke(ctx);const n=p.requests.length;
  await refused(driver.confirm(ctx,id));assert.equal(p.requests.length,n);assert.equal(p.mutations,0);
 });
 await t('expiredCredential','an expired credential is refused before any provider request',withOptions({shortCredential:true},async(ctx,p)=>{
  const id=await prepared(ctx);await driver.expireCredential(ctx);const n=p.requests.length;
  await refused(driver.confirm(ctx,id));assert.equal(p.requests.length,n);assert.equal(p.mutations,0);
 }));
 await t('replaced','a review bound to replaced access is stale and refused before any provider request',async(ctx,p)=>{
  const id=await prepared(ctx);await driver.replace(ctx);const n=p.requests.length;
  await refused(driver.confirm(ctx,id));assert.equal(p.requests.length,n);assert.equal(p.mutations,0);
 });
 await t('otherOwner','another owner can neither confirm nor reconcile the receipt',async(ctx,p)=>{
  const id=await prepared(ctx);let n=p.requests.length;
  await refused(driver.confirm(ctx,id,{as:'other'}));assert.equal(p.requests.length,n);assert.equal(p.mutations,0);
  p.mode.lose='after';assert.equal(common(await driver.confirm(ctx,id)),'uncertain');p.mode.lose=null;n=p.requests.length;
  await refused(driver.reconcile(ctx,id,{as:'other'}));assert.equal(p.requests.length,n);assert.equal(p.mutations,1);
 });
 await t('price','the review states the catalog price and confirmation must echo it',async(ctx,p)=>{
  const v=await driver.prepare(ctx);
  if(gap('price')){
   // Current behaviour: no price in the review view, and confirmation takes none.
   assert.equal(driver.price(v),undefined);assert.equal(common(await driver.confirm(ctx,driver.id(v),{acceptedPrice:null})),'applied');assert.equal(p.mutations,1);return;
  }
  assert.deepEqual(driver.price(v),{...action.price});
  await refused(driver.confirm(ctx,driver.id(v),{acceptedPrice:null}));
  await refused(driver.confirm(ctx,driver.id(v),{acceptedPrice:{customerUnits:action.price.customerUnits+1,basis:'quoted'}}));assert.equal(p.mutations,0);
  // A refused echo does not consume the review: the exact echo still confirms once.
  assert.equal(common(await driver.confirm(ctx,driver.id(v))),'applied');assert.equal(p.mutations,1);
 });
 await t('reviewDigest','the review carries a digest and confirmation must echo it exactly',async(ctx,p)=>{
  const v=await driver.prepare(ctx);
  if(gap('reviewDigest')){
   assert.equal(driver.reviewDigest(v),undefined);assert.equal(common(await driver.confirm(ctx,driver.id(v),{reviewDigest:'0'.repeat(64)})),'applied');assert.equal(p.mutations,1);return;
  }
  assert.match(driver.reviewDigest(v),/^[0-9a-f]{64}$/);
  await refused(driver.confirm(ctx,driver.id(v),{reviewDigest:'0'.repeat(64)}));assert.equal(p.mutations,0);
  assert.equal(common(await driver.confirm(ctx,driver.id(v))),'applied');assert.equal(p.mutations,1);
 });
 // Runs last: it judges every raw receipt state the earlier cases observed.
 await test(`${label}: receipt states use the frozen common names`,async()=>{
  assert.ok(raw.size>=3,`${label}: too few states observed`);
  for(const value of Object.values(driver.stateMap))assert.ok(commonReceiptStates.includes(value),value);
  const foreign=[...raw].filter(s=>!commonReceiptStates.includes(s)).sort();
  if(gap('states'))assert.ok(foreign.length>0,`${label}: declared G-C7 but every observed state is common`);else assert.deepEqual(foreign,[]);
 });
 const declared=Object.keys(driver.gaps??{}).sort();
 assert.deepEqual([...used].sort(),declared,`${label}: every declared gap must be exercised by its case`);
 return {gaps:Object.fromEntries(declared.map(k=>[k,driver.gaps[k]])),skipped,states:[...raw].sort()};
}

/** The reference runtime as an action driver for Cloudflare `dnsRecord.create` (the control for the cases above). */
export function referenceActionDriver({m,fakeProvider,token,catalog}){
 const clockBase=Date.parse('2026-10-04T00:00:00Z');let n=0;
 const name='_whumpo.www.example.com';
 return {
  providerId:'cloudflare',operationId:'dnsRecord.create',capabilities:[],gaps:{},
  stateMap:Object.fromEntries(commonReceiptStates.map(s=>[s,s])),
  setup(){
   const clock={t:clockBase},{s,transport}=fakeProvider(),rt=m.createReferenceRuntime({catalog:catalog(),transport,now:()=>clock.t});
   rt.connect('owner-a','cloudflare',token());
   const marker='m-'+(++n),p={get requests(){return s.calls;},get mutations(){return s.calls.filter(c=>c.method==='POST'&&/dns_records$/.test(new URL(c.url).pathname)).length;},get effects(){return s.effects.length;},mode:s.mode,
    hold(){let release,arrived;const reached=new Promise(r=>arrived=r),gate=new Promise(r=>release=r);s.mode.beforeReply=async()=>{arrived();await gate;};return {reached,release};}};
   return {rt,s,clock,marker,p,digests:new Map(),prices:new Map()};
  },
  provider:ctx=>ctx.p,
  async prepare(ctx){const r=await ctx.rt.prepareAction(owner(),'cloudflare','dnsRecord.create',{zone},{type:'TXT',name,content:'"v"',ttl:1,comment:ctx.marker});ctx.digests.set(r.receiptId,r.reviewDigest);ctx.prices.set(r.receiptId,r.price);return {id:r.receiptId,state:r.state,price:r.price,reviewDigest:r.reviewDigest};},
  async confirm(ctx,id,{as,acceptedPrice,reviewDigest}={}){
   await ctx.rt.confirmAction(owner(as==='other'?'owner-b':'owner-a'),id,{reviewDigest:reviewDigest??ctx.digests.get(id),acceptedPrice:acceptedPrice===null?undefined:acceptedPrice??ctx.prices.get(id)});
   return {id,...ctx.rt.receipt(id)};
  },
  async reconcile(ctx,id,{as}={}){
   await ctx.rt.reconcile(owner(as==='other'?'owner-b':'owner-a'),id,()=>({operationId:'dnsRecords.findExact',params:{zone,name},matches:j=>j.items.some(i=>i.marker===ctx.marker)}));
   return {id,...ctx.rt.receipt(id)};
  },
  id:v=>v.id,rawState:v=>v.state,price:v=>v.price,reviewDigest:v=>v.reviewDigest,
  async revoke(ctx){await ctx.rt.disconnect('owner-a','cloudflare');},
  async replace(ctx){await ctx.rt.disconnect('owner-a','cloudflare');ctx.rt.connect('owner-a','cloudflare',token());},
  expireReview(ctx){ctx.clock.t+=11*60e3;},
  expireCredential(ctx){ctx.rt.expire('owner-a','cloudflare');},
 };
}
