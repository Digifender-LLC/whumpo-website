import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {createHash,randomBytes} from 'node:crypto';
import {readdirSync,readFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';

// WH-063 / WH-200 / WH-203 conformance harness for verified email changes and compromise response. Every decision runs
// in the source module src/email-change/*.ts (bundled with esbuild): the address change (WH-200), and the compromise
// review, sign-in and recovery fences and provider revocation (WH-203). The storage-only driver below keeps the plain
// records the source returns in an in-memory store with revision guards, and stands in for the existing identity
// engine only where WH-203 does not decide (issuing session and grant tokens, resolving them, and the engine's own
// emergency passkey removal). Synthetic accounts, addresses (example.test), kit keys, ciphertext handles, mailer and
// provider revoker only: no database, network, credential, model or provider account. It proves the frozen contract and
// the unwired source, plus read-only agreements with the current identity and connection source. It does not prove D1
// atomicity, real delivery or real provider revocation (WH-201/202/204). Every suite check also runs against
// deliberately broken copies of the source (mutants below).
const root=fileURLToPath(new URL('..',import.meta.url));
// provider-revokers.ts and connection-holds.ts (the WH-203 adapters and state mapping) are listed so the purity and
// Worker import-graph checks below cover them; their behaviour and mutants are in tests/email-change-revokers.mjs.
const moduleFiles=['src/email-change/policy.ts','src/email-change/change.ts','src/email-change/token.ts','src/email-change/compromise.ts','src/email-change/revocation.ts','src/email-change/provider-revokers.ts','src/email-change/connection-holds.ts'];
const read=file=>readFileSync(join(root,file),'utf8');
// WH-201: the storage slice, the trusted HTTP adapter and the maintenance job are NOT part of the pure module; they have their own checks below.
const wiringFiles=['src/email-change/store.ts','src/email-change/http.ts','src/email-change/maintenance.ts'];
const entry=moduleFiles.map(f=>`export * from './${f.replace(/\.ts$/,'')}';`).join('');
/** Bundles the source (with optional mutated files) in esbuild's own process, so bundles can overlap the JS suites. */
async function bundleSource(overrides={}){
 const plugin={name:'mutant',setup(b){b.onLoad({filter:/\.ts$/},args=>{const rel=relative(root,args.path).replaceAll('\\','/');if(Object.hasOwn(overrides,rel))return {contents:overrides[rel],loader:'ts'};});}};
 const out=await build({stdin:{contents:entry,resolveDir:root,loader:'ts'},bundle:true,format:'esm',platform:'node',write:false,logLevel:'silent',plugins:[plugin]});
 return out.outputFiles[0].text;
}
const importText=text=>import('data:text/javascript;base64,'+Buffer.from(text).toString('base64'));
const workers=['src/index.ts','src/site-host.ts','src/app-host.ts','src/runtime/worker.ts'];
const graph=()=>build({entryPoints:workers.map(w=>join(root,w)),bundle:true,format:'esm',platform:'neutral',write:false,outdir:join(root,'.email-change-graph'),metafile:true,logLevel:'silent',packages:'external',external:['cloudflare:*','*.wasm','node:*']});
const KIT='SYNTHETIC-KIT-0001',KIT_B='SYNTHETIC-KIT-0002';
const MIN=60e3,HOUR=60*MIN,DAY=24*HOUR;
let rid=0;const req=()=>`req-${String(++rid).padStart(8,'0')}`;
const sha256=value=>createHash('sha256').update(value).digest('hex');
const newSecret=()=>randomBytes(32).toString('base64url');
/** Lifetimes the existing identity engine owns (not WH-203 decisions). */
const engineBounds=Object.freeze({sessionMs:7*DAY,grantMs:30*MIN,challengeMs:5*MIN});

/**
 * Storage-only driver around the source module `ec`. It reads rows, passes them to the source, and writes back what the
 * source returns under revision guards; it makes no address-change, review, fence or revocation decision itself.
 * mailer: a PlatformMailer or null (no platform delivery is active). revoker: a ProviderRevoker.
 */
function createRuntime({ec,mailer=null,revoker=null,start=Date.UTC(2026,9,9)}){
 const s={now:start,seq:0,accounts:{},sessions:{},grants:{},challenges:{},changes:{},offers:{},reviews:{},connections:{},ciphertexts:{},outbox:[],receipts:{},
  counters:{requests:{},addresses:{},failures:{}}};
 const id=prefix=>`${prefix}-${String(++s.seq).padStart(4,'0')}`;
 const check=(ok,code,detail)=>{if(!ok)throw new ec.EmailChangeError(code,detail);};
 const account=accountId=>{const a=s.accounts[accountId];check(a,'UNKNOWN_ACCOUNT');return a;};
 /** Token issuance and lookup by hash: the existing identity engine's job, modelled here. */
 function issue(table,prefix,record){const token=newSecret();table[sha256(token)]={id:id(prefix),...record};return token;}

 // ---------- storage for the source records (no decisions) ----------
 const changesOf=accountId=>Object.values(s.changes).filter(c=>c.accountId===accountId);
 const pendingOf=accountId=>changesOf(accountId).filter(c=>c.state==='pending').at(-1)??null;
 const connectionsOf=accountId=>Object.values(s.connections).filter(c=>c.accountId===accountId);
 const holders=address=>({accounts:Object.values(s.accounts).filter(x=>x.email===address),changes:Object.values(s.changes).filter(c=>c.previous?.address===address)});
 /** Revision guard: a write must be the next revision of the stored row (or revision 1 of a new row). */
 const guarded=(table,key,next,code)=>{const current=table[key];check(current?current.revision===next.revision-1:next.revision===1,code,key);};
 function putChange(next){guarded(s.changes,next.changeId,next,'CONCURRENT_CHANGE');s.changes[next.changeId]=Object.freeze(next);}
 const putIfChanged=next=>{if(next&&s.changes[next.changeId]?.revision!==next.revision)putChange(next);};
 function putConnection(next){
  guarded(s.connections,next.connectionId,next,'CONCURRENT_CONNECTION');s.connections[next.connectionId]=Object.freeze(next);
  if(!next.credentialHeld)delete s.ciphertexts[next.connectionId];
 }
 const putConnectionIfChanged=next=>{if(s.connections[next.connectionId]?.revision!==next.revision)putConnection(next);};
 const putNotice=next=>{const i=s.outbox.findIndex(x=>x.noticeId===next.noticeId);s.outbox[i]=Object.freeze(next);};
 const queue=drafts=>{for(const n of drafts)s.outbox.push(Object.freeze(ec.queueNotice(n,id('msg'),s.now)));};
 function apply(a,step,addressKey){
  for(const c of step.changes)putChange(c);
  if(step.account)s.accounts[a.accountId]={...s.accounts[a.accountId],email:step.account.email,verifiedAt:step.account.verifiedAt,verifiedVia:step.account.verifiedVia};
  queue(step.notices);
  if(step.limits?.requests)s.counters.requests[a.accountId]=step.limits.requests;
  if(step.limits?.addressSends)s.counters.addresses[addressKey]=step.limits.addressSends;
  if(step.limits?.failures)s.counters.failures[a.accountId]=step.limits.failures;
  if(step.refusal)throw new ec.EmailChangeError(step.refusal.code,step.refusal.detail);
  return step.result;
 }
 /** One committing batch for a compromise-review step: every guard is checked before any write. */
 function applyCommit(step){
  if(!step.account)return step.result;
  const accountId=step.account.accountId;
  guarded(s.reviews,step.review.reviewId,step.review,'CONCURRENT_REVIEW');
  if(step.change)guarded(s.changes,step.change.changeId,step.change,'CONCURRENT_CHANGE');
  for(const c of step.connections)if(s.connections[c.connectionId]?.revision!==c.revision)guarded(s.connections,c.connectionId,c,'CONCURRENT_CONNECTION');
  s.reviews[step.review.reviewId]=Object.freeze(step.review);
  s.accounts[accountId]=step.account;
  if(step.change)putChange(step.change);
  for(const c of step.connections)putConnectionIfChanged(c);
  // Revoke every session, grant, challenge and kit offer issued under an earlier epoch, in the same batch.
  const tables={sessions:s.sessions,grants:s.grants,challenges:s.challenges,kitOffers:s.offers};
  for(const name of ec.revokedAuthority){const table=tables[name];for(const [k,row] of Object.entries(table))if(row.accountId===accountId&&row.epoch<step.revokeAuthorityBefore)delete table[k];}
  if(step.consumedOfferId)delete s.offers[step.consumedOfferId];
  queue(step.notices);
  s.receipts[`${accountId}:${step.receipt.requestId}`]=Object.freeze(step.receipt);
  return step.result;
 }

 /** Synthetic identity resolution (the identity_current_authorities view): token, expiry and active credential.
  * Epoch, purpose, stage and freshness are decided by the source authorizeOwner predicate. */
 function resolve(auth){
  check(auth&&typeof auth.token==='string','AUTH_REQUIRED');
  const h=sha256(auth.token);
  if(auth.kind==='grant'){
   const g=s.grants[h];check(g&&g.expiresAt>s.now,'PROOF_REQUIRED');
   return {accountId:g.accountId,kind:'grant',purpose:g.purpose,authEpoch:g.epoch,proof:{method:'recovery-key',verifiedAt:g.issuedAt}};
  }
  check(auth.kind==='session','AUTH_REQUIRED');
  const x=s.sessions[h];check(x&&x.expiresAt>s.now,'AUTH_REQUIRED');
  check(account(x.accountId).credentials.includes(x.credentialId),'IDENTITY_CHANGED');
  return {accountId:x.accountId,kind:'session',purpose:'workspace',authEpoch:x.epoch,proof:{method:'passkey',verifiedAt:x.proofAt}};
 }
 function owner(auth,{fresh=false}={}){
  const p=resolve(auth),a=account(p.accountId);
  ec.authorizeOwner(p,a,{fresh,now:s.now});
  return {p,a};
 }
 const grantFor=admission=>({kind:'grant',token:issue(s.grants,'grt',{accountId:admission.accountId,epoch:admission.authEpoch,purpose:admission.purpose,issuedAt:s.now,expiresAt:s.now+engineBounds.grantMs})});

 const rt={
  // ---------- synthetic fixtures, clock and audits ----------
  addAccount({accountId,email,credentials,kitKey}){
   s.accounts[accountId]={accountId,email:ec.normalizeAddress(email),verifiedAt:null,verifiedVia:null,authEpoch:1,stage:'ready',
    credentials:[...credentials],credentialRevision:1,kitGeneration:1,kitVerifier:sha256(kitKey)};
  },
  addConnection(accountId,{connectionId,provider}){
   account(accountId);
   s.connections[connectionId]=Object.freeze({connectionId,accountId,provider,access:'active',credentialHeld:true,revision:1,
    revocation:{state:'none',attempts:0,reads:0,since:null,receipt:null}});
   s.ciphertexts[connectionId]=`SYNTHETIC-CIPHERTEXT-${String(Object.keys(s.ciphertexts).length+1).padStart(4,'0')}`;
  },
  advance(ms){s.now+=ms;},
  now:()=>s.now,
  /** Deep copy of every stored record, for storage audits. */
  inspect:()=>structuredClone(s),
  account:accountId=>structuredClone(account(accountId)),
  /** The principal a request holding this token resolves to now (what a concurrent request has already read). */
  principal:auth=>resolve(auth),
  applyCommit,

  // ---------- passkey sign-in (synthetic assertions): the source admits, the driver issues ----------
  beginSignIn({accountId}){const a=account(accountId),cid=id('chl');s.challenges[cid]={accountId,epoch:a.authEpoch,expiresAt:s.now+engineBounds.challengeMs};return cid;},
  finishSignIn({challengeId,credentialId}){
   const c=s.challenges[challengeId]??null;check(c,'PROOF_REQUIRED');delete s.challenges[challengeId];
   const admitted=ec.admitSignIn({challenge:c,account:account(c.accountId),credentialId,now:s.now});
   if(admitted.kind==='grant')return grantFor(admitted);
   return {kind:'session',token:issue(s.sessions,'ses',{accountId:admitted.accountId,epoch:admitted.authEpoch,credentialId,proofAt:s.now,expiresAt:s.now+engineBounds.sessionMs})};
  },
  signIn({accountId,credentialId}){return rt.finishSignIn({challengeId:rt.beginSignIn({accountId}),credentialId});},

  /** Email is a lookup identifier only: the current kit is the proof, and the result is restricted recovery authority. */
  startRecovery(input){
   ec.closedInput(input,['version','email','key']);
   return grantFor(ec.admitRecovery({address:input.email,accounts:Object.values(s.accounts),changes:Object.values(s.changes),
    keyVerifier:typeof input.key==='string'?sha256(input.key):null,now:s.now}));
  },
  identityState(auth){
   if(auth?.kind==='grant'){
    const p=resolve(auth),a=account(p.accountId);check(p.authEpoch===a.authEpoch,'IDENTITY_CHANGED');
    return {authority:'recovery',stage:a.stage,allowedNext:[...ec.recoveryGrantOperations]};
   }
   return {authority:'workspace',stage:owner(auth).a.stage};
  },

  // ---------- verified address change: storage around the WH-200 source ----------
  async requestEmailChange(auth,input){
   const request=ec.parseChangeRequest(input);
   const p=resolve(auth),a=account(p.accountId),key=await ec.addressKey(request.newAddress);
   const step=await ec.requestEmailChange({principal:p,account:a,request,deliveryActive:Boolean(mailer),
    prior:changesOf(a.accountId).find(c=>c.requestId===request.requestId)??null,pending:pendingOf(a.accountId),holders:holders(request.newAddress),
    limits:{requests:s.counters.requests[a.accountId]??[],addressSends:s.counters.addresses[key]??[]},changeId:id('chg'),now:s.now});
   return apply(a,step,key);
  },
  async confirmEmailChange(auth,input){
   const {token}=ec.parseConfirmation(input);
   const p=resolve(auth),a=account(p.accountId),verifier=await ec.tokenVerifier(token);
   const change=verifier?Object.values(s.changes).find(c=>c.tokenVerifier===verifier)??null:null;
   return apply(a,ec.confirmEmailChange({principal:p,account:a,verifier,change,holders:change?holders(change.newAddress):{accounts:[],changes:[]},
    failures:s.counters.failures[a.accountId]??[],now:s.now}));
  },
  async cancelEmailChange(auth,input){
   const {changeId}=ec.parseChangeReference(input);
   const p=resolve(auth),a=account(p.accountId);
   return apply(a,ec.cancelEmailChange({principal:p,account:a,changeId,change:s.changes[changeId]??null,now:s.now}));
  },
  async undoEmailChange(auth,input){
   const {changeId}=ec.parseChangeReference(input);
   const p=resolve(auth),a=account(p.accountId);
   return apply(a,ec.undoEmailChange({principal:p,account:a,changeId,change:s.changes[changeId]??null,now:s.now}));
  },
  async readAccountEmail(auth){
   const p=resolve(auth),a=account(p.accountId);
   return ec.readAccountEmail({principal:p,account:a,pending:pendingOf(a.accountId),now:s.now});
  },
  /** Scheduled delivery pass over queued notices; the source mints the token inside each claimed attempt. */
  async runDelivery(){
   const result={accepted:0,deferred:0,failed:0,unknown:0,cancelled:0};
   if(!mailer)return result;
   for(const notice of s.outbox.filter(x=>x.state==='queued')){
    const change=notice.kind==='confirm-new-address'?s.changes[notice.changeId]??null:null;
    const step=await ec.deliverNotice({notice,change,mailer,now:s.now,claim:(n,c)=>{putNotice(n);putIfChanged(c);return true;}});
    putNotice(step.notice);putIfChanged(step.change);
    if(Object.hasOwn(result,step.outcome))result[step.outcome]++;
   }
   return result;
  },
  outboxStates:()=>s.outbox.map(x=>({kind:x.kind,state:x.state,attempts:x.attempts})),

  // ---------- existing identity engine stand-in: emergency removal outside a review (epoch fence only) ----------
  removePasskey(auth,input){
   ec.closedInput(input,['version','credentialId']);
   const {a}=owner(auth,{fresh:true});
   check(a.credentials.includes(input.credentialId),'UNKNOWN_CREDENTIAL');
   const credentials=a.credentials.filter(k=>k!==input.credentialId);
   s.accounts[a.accountId]={...a,credentials,credentialRevision:a.credentialRevision+1,authEpoch:a.authEpoch+1,stage:credentials.length?a.stage:'recovering'};
   return {epoch:a.authEpoch+1,stage:s.accounts[a.accountId].stage,activePasskeys:credentials.length};
  },

  // ---------- compromise review: storage around the WH-203 source ----------
  prepareCompromiseReview(auth,input){
   ec.parseReviewPrepare(input);
   const p=resolve(auth),a=account(p.accountId);
   const sessions=Object.values(s.sessions).filter(x=>x.accountId===a.accountId).map(x=>({sessionId:x.id,credentialId:x.credentialId,issuedAt:x.proofAt}));
   const {review,result}=ec.prepareCompromiseReview({principal:p,account:a,pending:pendingOf(a.accountId),sessions,connections:connectionsOf(a.accountId),reviewId:id('rev'),now:s.now});
   guarded(s.reviews,review.reviewId,review,'CONCURRENT_REVIEW');s.reviews[review.reviewId]=Object.freeze(review);
   return result;
  },
  /** One-time kit offer bound to the review: plaintext returned once, verifier stored. */
  prepareKit(auth,input){
   const {reviewId}=ec.parseKitOffer(input);
   const p=resolve(auth),a=account(p.accountId),key=newSecret();
   const offer=ec.prepareReviewKit({principal:p,account:a,review:s.reviews[reviewId]??null,offerId:id('kit'),verifier:sha256(key),now:s.now});
   s.offers[offer.offerId]=Object.freeze(offer);
   return {offerId:offer.offerId,key};
  },
  saveKit(auth,input){
   const {offerId}=ec.parseKitSave(input);
   const p=resolve(auth),a=account(p.accountId);
   const offer=ec.saveReviewKit({principal:p,account:a,offer:s.offers[offerId]??null,now:s.now});
   s.offers[offerId]=Object.freeze(offer);
   return {offerId,savedAt:offer.savedAt};
  },
  async commitCompromiseReview(auth,input){
   const request=ec.parseReviewCommit(input);
   const p=resolve(auth),a=account(p.accountId);
   return applyCommit(await ec.commitCompromiseReview({principal:p,account:a,request,prior:s.receipts[`${a.accountId}:${request.requestId}`]??null,
    review:s.reviews[request.reviewId]??null,offer:request.rotateKit?s.offers[request.rotateKit.offerId]??null:null,
    pending:pendingOf(a.accountId),connections:connectionsOf(a.accountId),now:s.now}));
  },

  // ---------- provider connections: storage around the WH-203 revocation source ----------
  useConnection(auth,input){
   ec.closedInput(input,['version','connectionId']);
   const p=resolve(auth),a=account(p.accountId);
   return ec.authorizeConnectionUse({principal:p,account:a,connection:s.connections[input.connectionId]??null,now:s.now});
  },
  /** Scheduled revocation pass. interruptAfterClaim models a worker lost after committing its claim. */
  async runRevocations({interruptAfterClaim=false}={}){
   const result={revoked:0,retry:0,uncertain:0};
   for(const c of Object.values(s.connections).filter(x=>['queued','dispatching'].includes(x.revocation.state))){
    const step=await ec.dispatchRevocation({connection:c,revoker,now:s.now,claim:claimed=>{putConnection(claimed);if(interruptAfterClaim)throw new ec.EmailChangeError('INTERRUPTED');return true;}});
    putConnectionIfChanged(step.connection);
    if(step.outcome==='revoked')result.revoked++;else if(step.outcome==='retry')result.retry++;else if(step.outcome==='unknown')result.uncertain++;
   }
   return result;
  },
  /** Read-only reconciliation with authenticated provider evidence; never calls revoke. */
  reconcileRevocation({connectionId,evidence}){
   const next=ec.reconcileRevocation({connection:s.connections[connectionId]??null,evidence,now:s.now});
   putConnection(next);return next.revocation.state;
  },
  /** Local erasure (cleanup, account closure) requires an exact revocation receipt. */
  eraseConnectionCredential(connectionId){
   putConnectionIfChanged(ec.eraseConnectionCredential(s.connections[connectionId]??null));
   return {connectionId,erased:!Object.hasOwn(s.ciphertexts,connectionId)};
  },
  closureHolds:accountId=>ec.closureHolds(connectionsOf(accountId)),
  connectionState(connectionId){const c=s.connections[connectionId];return {access:c.access,credentialHeld:Object.hasOwn(s.ciphertexts,connectionId),revocation:c.revocation.state};},
 };
 return Object.freeze(rt);
}
/** The suite's view: the source exports plus the storage-only driver hosting that source. */
const compose=source=>({...source,sha256,bounds:{...source.emailChangeBounds,...source.compromiseBounds,...source.revocationBounds},
 createRuntime:options=>createRuntime({...options,ec:source})});

async function suite(m){
 let count=0;
 const test=async(name,fn)=>{try{await fn();count++;}catch(error){throw new Error(name,{cause:error});}};
 const refuses=(fn,code)=>assert.rejects(async()=>fn(),e=>{assert.equal(e.code,code,e.message);return true;});
 function setup({mail=true,outcomes={},revokeOutcomes={}}={}){
  const mailer=mail?m.createSyntheticMailer({decide:message=>{const o=outcomes[message.kind];return typeof o==='function'?o(message):o??'accepted';}}):null;
  const inbox=mailer?mailer.delivered:[],calls=mailer?mailer.calls:[];
  const revoker=m.createSyntheticRevoker({decide:x=>{const o=revokeOutcomes[x.connectionId];return typeof o==='function'?o(x):o??'revoked';}});
  const revocations=revoker.calls;
  const rt=m.createRuntime({mailer,revoker});
  rt.addAccount({accountId:'acct-a',email:'owner-a@example.test',credentials:['key-a1','key-a2'],kitKey:KIT});
  rt.addAccount({accountId:'acct-b',email:'owner-b@example.test',credentials:['key-b1','key-b2'],kitKey:KIT_B});
  rt.addConnection('acct-a',{connectionId:'gh-a',provider:'github'});rt.addConnection('acct-a',{connectionId:'cf-a',provider:'cloudflare'});
  const a=rt.signIn({accountId:'acct-a',credentialId:'key-a1'}),b=rt.signIn({accountId:'acct-b',credentialId:'key-b1'});
  const tokenFor=to=>[...inbox].reverse().find(x=>x.kind==='confirm-new-address'&&x.to===to)?.token;
  const change=(auth,newAddress,requestId=req())=>rt.requestEmailChange(auth,{version:1,requestId,newAddress});
  return {rt,a,b,inbox,calls,revocations,tokenFor,change};
 }
 const v=(o={})=>({version:1,...o});

 // ---------- confirmation token storage (first: later checks rely on hash lookup) ----------
 await test('confirmation token is single use, stored only as a hash and bound to the requesting account',async()=>{
  const {rt,a,b,change,tokenFor}=setup();
  await change(a,'new-a@example.test');await rt.runDelivery();
  const token=tokenFor('new-a@example.test');assert.ok(typeof token==='string'&&token.length>=43);
  const stored=JSON.stringify(rt.inspect());
  assert.ok(!stored.includes(token),'plaintext token stored');assert.ok(stored.includes(m.sha256(token)));
  await refuses(()=>rt.confirmEmailChange(null,v({token})),'AUTH_REQUIRED');
  await refuses(()=>rt.confirmEmailChange(b,v({token})),'INVALID_TOKEN');
  assert.equal((await rt.readAccountEmail(a)).email,'owner-a@example.test');
  const receipt=await rt.confirmEmailChange(a,v({token}));
  assert.deepEqual([receipt.status,receipt.email],['confirmed','new-a@example.test']);
  assert.deepEqual(await rt.readAccountEmail(a),{email:'new-a@example.test',verified:true,pending:null});
  assert.ok(!JSON.stringify(rt.inspect()).includes(token));
 });

 // ---------- current identifier is never a factor ----------
 await test('an unverified or pending email never becomes a recovery or authorization factor',async()=>{
  const {rt,a,change}=setup();
  await refuses(()=>rt.startRecovery(v({email:'owner-a@example.test',key:'SYNTHETIC-WRONG-0000'})),'RECOVERY_PROOF');
  await refuses(()=>rt.startRecovery(v({email:'owner-a@example.test'})),'RECOVERY_PROOF');
  await change(a,'new-a@example.test');await rt.runDelivery();
  await refuses(()=>rt.startRecovery(v({email:'new-a@example.test',key:KIT})),'RECOVERY_PROOF');
  const g=rt.startRecovery(v({email:'OWNER-A@example.test ',key:KIT}));
  assert.equal(g.kind,'grant');assert.equal(rt.identityState(g).authority,'recovery');
  // A verified address changes nothing about recovery: the current kit is still the proof.
  const {rt:rt2,a:a2,change:change2,tokenFor:t2}=setup();await change2(a2,'verified-a@example.test');await rt2.runDelivery();
  await rt2.confirmEmailChange(a2,v({token:t2('verified-a@example.test')}));assert.equal((await rt2.readAccountEmail(a2)).verified,true);
  await refuses(()=>rt2.startRecovery(v({email:'verified-a@example.test',key:'SYNTHETIC-WRONG-0000'})),'RECOVERY_PROOF');
  await refuses(()=>rt2.startRecovery(v({email:'owner-a@example.test',key:KIT})),'RECOVERY_PROOF');
  assert.equal(rt2.startRecovery(v({email:'verified-a@example.test',key:KIT})).kind,'grant');
  // No operation, in the runtime or the source module, turns an email, link or verification state into a session.
  assert.ok([...Object.keys(rt),...Object.keys(m)].every(k=>!/magic|link|emailLogin|signInWithEmail|reset/i.test(k)));
 });
 await test('unknown versions, unknown fields and retired password authority are refused',async()=>{
  const {rt,a}=setup();
  for(const version of [0,2,'1',undefined])await refuses(()=>rt.requestEmailChange(a,{version,requestId:req(),newAddress:'x@example.test'}),'UNSUPPORTED_VERSION');
  await refuses(()=>rt.startRecovery({version:2,email:'owner-a@example.test',key:KIT}),'UNSUPPORTED_VERSION');
  await refuses(()=>rt.prepareCompromiseReview(a,{version:0}),'UNSUPPORTED_VERSION');
  await refuses(()=>rt.confirmEmailChange(a,{version:2,token:'SYNTHETIC-TOKEN-0000'}),'UNSUPPORTED_VERSION');
  await refuses(()=>rt.requestEmailChange(a,v({requestId:req(),newAddress:'x@example.test',sender:'ceo@example.test'})),'UNKNOWN_FIELD');
  await refuses(()=>rt.requestEmailChange(a,v({requestId:req(),newAddress:'x@example.test',connectionId:'gh-a'})),'UNKNOWN_FIELD');
  for(const field of m.retiredAuthorityFields)await refuses(()=>rt.requestEmailChange(a,v({requestId:req(),newAddress:'x@example.test',[field]:'SYNTHETIC-SECRET-0000'})),'RETIRED_AUTHORITY');
  await refuses(()=>rt.startRecovery(v({email:'owner-a@example.test',password:'SYNTHETIC-SECRET-0000'})),'RETIRED_AUTHORITY');
  await refuses(()=>rt.requestEmailChange(a,v({requestId:req(),newAddress:'Owner <x@example.test>'})),'INVALID_ADDRESS');
 });
 await test('an address change requires a fresh passkey on a current ordinary session',async()=>{
  const {rt,a,change}=setup();
  await refuses(()=>rt.requestEmailChange(null,v({requestId:req(),newAddress:'x@example.test'})),'AUTH_REQUIRED');
  rt.advance(11*MIN);
  await refuses(()=>change(a,'x@example.test'),'PROOF_REQUIRED');
  const fresh=rt.signIn({accountId:'acct-a',credentialId:'key-a2'});
  assert.equal((await change(fresh,'x@example.test')).status,'pending-confirmation');
  await refuses(()=>change(fresh,'owner-a@example.test'),'NO_CHANGE');
 });
 await test('recovery secrets grant only restricted enrollment authority',async()=>{
  const {rt}=setup();
  const g=rt.startRecovery(v({email:'owner-a@example.test',key:KIT}));
  assert.equal(g.kind,'grant');
  await refuses(()=>rt.requestEmailChange(g,v({requestId:req(),newAddress:'x@example.test'})),'IDENTITY_INCOMPLETE');
  await refuses(()=>rt.readAccountEmail(g),'IDENTITY_INCOMPLETE');
  await refuses(()=>rt.prepareCompromiseReview(g,v()),'IDENTITY_INCOMPLETE');
  await refuses(()=>rt.commitCompromiseReview(g,v({requestId:req(),reviewId:'rev-0000',revokeCredentials:[],rotateKit:null,revokeConnections:['gh-a']})),'IDENTITY_INCOMPLETE');
  await refuses(()=>rt.useConnection(g,v({connectionId:'gh-a'})),'IDENTITY_INCOMPLETE');
  await refuses(()=>rt.confirmEmailChange(g,v({token:'SYNTHETIC-TOKEN-0000'})),'IDENTITY_INCOMPLETE');
  assert.deepEqual(rt.identityState(g).allowedNext,['review_loss','add_passkey','kit','help','logout']);
 });

 // ---------- delivery and the old-address notice ----------
 await test('delivery unavailable stores nothing; the old address is notified without the token or new address',async()=>{
  const {rt:off,a:offA}=setup({mail:false});const before=JSON.stringify(off.inspect().changes);
  await refuses(()=>off.requestEmailChange(offA,v({requestId:req(),newAddress:'x@example.test'})),'DELIVERY_UNAVAILABLE');
  assert.equal(JSON.stringify(off.inspect().changes),before);assert.equal(off.inspect().outbox.length,0);
  assert.deepEqual(off.inspect().counters,{requests:{},addresses:{},failures:{}});
  const {rt,a,calls,change}=setup();await change(a,'new-a@example.test');await rt.runDelivery();
  const old=calls.filter(x=>x.to==='owner-a@example.test');
  assert.equal(old.length,1);assert.equal(old[0].kind,'change-requested');
  assert.ok(!('token' in old[0])&&!JSON.stringify(old[0]).includes('new-a@example.test'));
  const fresh=calls.find(x=>x.to==='new-a@example.test');
  assert.equal(fresh.kind,'confirm-new-address');assert.ok(!JSON.stringify(fresh).includes('owner-a@example.test'));
  assert.ok(calls.every(x=>x.from===m.platformSender.address&&x.displayName==='Whumpo'));
 });
 await test('a confirmation token is single use: replay returns the saved receipt without a second effect',async()=>{
  const {rt,a,change,tokenFor,calls}=setup();
  await change(a,'new-a@example.test');await rt.runDelivery();const token=tokenFor('new-a@example.test');
  const first=await rt.confirmEmailChange(a,v({token}));await rt.runDelivery();
  const second=await rt.confirmEmailChange(a,v({token}));await rt.runDelivery();
  assert.deepEqual(second,first);
  assert.equal(calls.filter(x=>x.kind==='change-completed').length,1);
  assert.equal(calls.find(x=>x.kind==='change-completed').to,'owner-a@example.test');
  await rt.undoEmailChange(a,v({changeId:first.changeId}));
  await refuses(()=>rt.confirmEmailChange(a,v({token})),'CHANGE_CLOSED');
  assert.equal((await rt.readAccountEmail(a)).email,'owner-a@example.test');
 });
 await test('an expired confirmation token is refused',async()=>{
  const {rt,a,change,tokenFor}=setup();
  await change(a,'new-a@example.test');await rt.runDelivery();const token=tokenFor('new-a@example.test');
  rt.advance(m.bounds.tokenLifetimeMs);
  await refuses(()=>rt.confirmEmailChange(a,v({token})),'TOKEN_EXPIRED');
  await refuses(()=>rt.confirmEmailChange(a,v({token})),'CHANGE_CLOSED');
  assert.equal((await rt.readAccountEmail(a)).email,'owner-a@example.test');
 });
 await test('a competing later change supersedes the earlier one; its token is refused as stale',async()=>{
  const {rt,a,change,tokenFor,calls}=setup();
  await change(a,'first-a@example.test');await rt.runDelivery();const first=tokenFor('first-a@example.test');
  await change(a,'second-a@example.test');await rt.runDelivery();const second=tokenFor('second-a@example.test');
  await refuses(()=>rt.confirmEmailChange(a,v({token:first})),'STALE_CHANGE');
  assert.equal((await rt.confirmEmailChange(a,v({token:second}))).email,'second-a@example.test');
  // An undelivered earlier message is cancelled, never sent after it was superseded.
  const {rt:rt2,a:a2,change:c2,calls:k2}=setup();await c2(a2,'one-a@example.test');await c2(a2,'two-a@example.test');await rt2.runDelivery();
  assert.deepEqual(k2.filter(x=>x.kind==='confirm-new-address').map(x=>x.to),['two-a@example.test']);
  assert.ok(calls.length>0);
 });
 await test('an authority change after the request makes the pending change stale',async()=>{
  const {rt,a,change,tokenFor}=setup();
  await change(a,'new-a@example.test');await rt.runDelivery();const token=tokenFor('new-a@example.test');
  rt.removePasskey(a,v({credentialId:'key-a2'}));
  await refuses(()=>rt.confirmEmailChange(a,v({token})),'IDENTITY_CHANGED');
  const again=rt.signIn({accountId:'acct-a',credentialId:'key-a1'});
  await refuses(()=>rt.confirmEmailChange(again,v({token})),'STALE_CHANGE');
  assert.equal((await rt.readAccountEmail(again)).email,'owner-a@example.test');
 });
 await test('a lost request or confirmation response is retried idempotently',async()=>{
  const {rt,a,tokenFor,calls}=setup();
  const id=req(),first=await rt.requestEmailChange(a,v({requestId:id,newAddress:'new-a@example.test'}));
  assert.deepEqual(await rt.requestEmailChange(a,v({requestId:id,newAddress:'NEW-A@example.test'})),first);
  await refuses(()=>rt.requestEmailChange(a,v({requestId:id,newAddress:'other-a@example.test'})),'REQUEST_CONFLICT');
  await rt.runDelivery();
  assert.equal(calls.filter(x=>x.kind==='confirm-new-address').length,1);
  assert.equal(calls.filter(x=>x.kind==='change-requested').length,1);
  const token=tokenFor('new-a@example.test');
  assert.deepEqual(await rt.confirmEmailChange(a,v({token})),await rt.confirmEmailChange(a,v({token})));
 });
 await test('the response never reveals whether another account uses the address',async()=>{
  const {rt,a,calls,change}=setup();
  const taken=await change(a,'owner-b@example.test'),stateTaken=await rt.readAccountEmail(a);
  const {rt:rt2,a:a2,change:c2}=setup();
  const free=await c2(a2,'free-a@example.test'),stateFree=await rt2.readAccountEmail(a2);
  assert.deepEqual(Object.keys(taken),Object.keys(free));assert.equal(taken.status,free.status);assert.equal(taken.expiresAt,free.expiresAt);
  assert.deepEqual(Object.keys(stateTaken.pending),Object.keys(stateFree.pending));assert.equal(stateTaken.verified,stateFree.verified);
  await rt.runDelivery();
  assert.ok(!calls.some(x=>x.to==='owner-b@example.test'),'no message to an address another account uses');
  assert.ok(calls.some(x=>x.kind==='change-requested'&&x.to==='owner-a@example.test'));
  // Confirmation re-checks uniqueness at commit: an address taken in between is refused only to the token holder.
  const {rt:rt3,a:a3,b:b3,change:c3,inbox:in3}=setup();
  await c3(a3,'contested@example.test');await rt3.runDelivery();
  await c3(b3,'contested@example.test');await rt3.runDelivery();
  const [tokA,tokB]=in3.filter(x=>x.to==='contested@example.test').map(x=>x.token);
  assert.equal((await rt3.confirmEmailChange(b3,v({token:tokB}))).email,'contested@example.test');
  await refuses(()=>rt3.confirmEmailChange(a3,v({token:tokA})),'ADDRESS_UNAVAILABLE');
  assert.equal((await rt3.readAccountEmail(a3)).email,'owner-a@example.test');
 });
 await test('rate limits bound requests per account, messages per address and confirmation guesses',async()=>{
  const {rt,a,b,change}=setup();
  for(let i=0;i<m.bounds.requestsPerAccountPerDay;i++)await change(a,`n${i}-a@example.test`);
  await refuses(()=>change(a,'n9-a@example.test'),'RATE_LIMITED');
  rt.advance(DAY);
  const later=rt.signIn({accountId:'acct-a',credentialId:'key-a1'});
  assert.equal((await change(later,'later-a@example.test')).status,'pending-confirmation');
  // Several accounts aiming at one address: the address receives a bounded number of messages, and every
  // requester sees the same pending response.
  const {rt:r2}=setup(),responses=[];
  for(const x of ['c','d','e','f']){
   r2.addAccount({accountId:`acct-${x}`,email:`owner-${x}@example.test`,credentials:[`key-${x}1`],kitKey:`SYNTHETIC-KIT-000${x.charCodeAt(0)-96}`});
   const s=r2.signIn({accountId:`acct-${x}`,credentialId:`key-${x}1`});
   responses.push(await r2.requestEmailChange(s,v({requestId:req(),newAddress:'target@example.test'})));
  }
  await r2.runDelivery();
  assert.equal(r2.outboxStates().filter(x=>x.kind==='confirm-new-address').length,m.bounds.messagesPerAddressPerDay);
  assert.ok(responses.every(x=>x.status==='pending-confirmation'));
  for(let i=0;i<m.bounds.confirmFailuresPerHour;i++)await refuses(()=>rt.confirmEmailChange(b,v({token:`SYNTHETIC-TOKEN-000${i}`})),'INVALID_TOKEN');
  await refuses(()=>rt.confirmEmailChange(b,v({token:'SYNTHETIC-TOKEN-0009'})),'RATE_LIMITED');
 });
 await test('a lost provider response is never redispatched and undeliverable addresses stop the change',async()=>{
  const {rt,a,change,calls,tokenFor}=setup({outcomes:{'confirm-new-address':'unknown'}});
  await change(a,'new-a@example.test');await rt.runDelivery();await rt.runDelivery();rt.advance(HOUR/2);await rt.runDelivery();
  assert.equal(calls.filter(x=>x.kind==='confirm-new-address').length,1);
  assert.equal(rt.outboxStates().find(x=>x.kind==='confirm-new-address').state,'unknown-outcome');
  assert.equal((await rt.confirmEmailChange(a,v({token:tokenFor('new-a@example.test')}))).status,'confirmed','a possibly delivered token stays usable');
  const {rt:r2,a:a2,change:c2,calls:k2}=setup({outcomes:{'confirm-new-address':'throw'}});
  await c2(a2,'new-a@example.test');await r2.runDelivery();await r2.runDelivery();
  assert.equal(k2.filter(x=>x.kind==='confirm-new-address').length,1);
  const {rt:r3,a:a3,change:c3,calls:k3}=setup({outcomes:{'confirm-new-address':'rejected'}});
  await c3(a3,'bad-a@example.test');await r3.runDelivery();await r3.runDelivery();
  assert.equal(k3.filter(x=>x.kind==='confirm-new-address').length,1);
  assert.deepEqual(Object.values(r3.inspect().changes).map(c=>[c.state,c.tokenVerifier]),[['undeliverable',null]]);
  const {rt:r4,a:a4,change:c4,calls:k4}=setup({outcomes:{'confirm-new-address':(()=>{let n=0;return ()=>++n===1?'deferred':'accepted';})()}});
  await c4(a4,'slow-a@example.test');await r4.runDelivery();await r4.runDelivery();
  const sent=k4.filter(x=>x.kind==='confirm-new-address');assert.equal(sent.length,2);
  await refuses(()=>r4.confirmEmailChange(a4,v({token:sent[0].token})),'INVALID_TOKEN');
  assert.equal((await r4.confirmEmailChange(a4,v({token:sent[1].token}))).status,'confirmed');
  // An old-address notice failure never blocks or reverses the change.
  const {rt:r5,a:a5,change:c5,tokenFor:t5}=setup({outcomes:{'change-requested':'suppressed','change-completed':'unknown'}});
  await c5(a5,'new-a@example.test');await r5.runDelivery();assert.equal((await r5.confirmEmailChange(a5,v({token:t5('new-a@example.test')}))).status,'confirmed');
 });
 await test('cancel before confirmation and undo inside the window; neither revives a closed change',async()=>{
  const {rt,a,change,tokenFor}=setup();
  const p=await change(a,'new-a@example.test');await rt.runDelivery();const token=tokenFor('new-a@example.test');
  assert.equal((await rt.cancelEmailChange(a,v({changeId:p.changeId}))).status,'cancelled');
  assert.equal((await rt.cancelEmailChange(a,v({changeId:p.changeId}))).status,'cancelled');
  await refuses(()=>rt.confirmEmailChange(a,v({token})),'CHANGE_CLOSED');
  const q=await change(a,'next-a@example.test');await rt.runDelivery();await rt.confirmEmailChange(a,v({token:tokenFor('next-a@example.test')}));
  await refuses(()=>rt.cancelEmailChange(a,v({changeId:q.changeId})),'CHANGE_CLOSED');
  rt.advance(m.bounds.undoWindowMs);
  const fresh=rt.signIn({accountId:'acct-a',credentialId:'key-a1'});
  await refuses(()=>rt.undoEmailChange(fresh,v({changeId:q.changeId})),'UNDO_UNAVAILABLE');
  const {rt:r2,a:a2,b:b2,change:c2,tokenFor:t2}=setup();
  const w=await c2(a2,'new-a@example.test');await r2.runDelivery();await r2.confirmEmailChange(a2,v({token:t2('new-a@example.test')}));
  // While the undo window is open the previous address stays reserved for this account.
  await c2(b2,'owner-a@example.test');await r2.runDelivery();assert.equal(t2('owner-a@example.test'),undefined);
  await refuses(()=>r2.undoEmailChange(b2,v({changeId:w.changeId})),'UNKNOWN_CHANGE');
  r2.advance(11*MIN);await refuses(()=>r2.undoEmailChange(a2,v({changeId:w.changeId})),'PROOF_REQUIRED');
  const f2=r2.signIn({accountId:'acct-a',credentialId:'key-a2'});
  assert.deepEqual(await r2.undoEmailChange(f2,v({changeId:w.changeId})),{changeId:w.changeId,status:'undone',email:'owner-a@example.test'});
  assert.equal((await r2.readAccountEmail(f2)).verified,false,'undo restores the previous verification state, it does not invent one');
 });

 // ---------- compromise response ----------
 const review=(rt,auth)=>rt.prepareCompromiseReview(auth,v());
 const commit=(rt,auth,o)=>rt.commitCompromiseReview(auth,v({requestId:req(),revokeCredentials:[],rotateKit:null,revokeConnections:[],...o}));
 await test('emergency revocation is allowed below the two-key count, down to zero',async()=>{
  const {rt,a}=setup();
  const r=review(rt,a);assert.deepEqual(r.credentials,['key-a1','key-a2']);
  const one=await commit(rt,a,{reviewId:r.reviewId,revokeCredentials:['key-a2']});
  assert.deepEqual([one.stage,one.revokedCredentials],['ready',['key-a2']]);
  const s=rt.signIn({accountId:'acct-a',credentialId:'key-a1'}),r2=review(rt,s);
  const zero=await commit(rt,s,{reviewId:r2.reviewId,revokeCredentials:['key-a1']});
  assert.equal(zero.stage,'recovering');assert.deepEqual(rt.account('acct-a').credentials,[]);
  await refuses(()=>rt.signIn({accountId:'acct-a',credentialId:'key-a1'}),'PROOF_REQUIRED');
  const g=rt.startRecovery(v({email:'owner-a@example.test',key:KIT}));
  assert.equal(rt.identityState(g).stage,'recovering');
  const {rt:r3,a:a3}=setup();assert.equal(r3.removePasskey(a3,v({credentialId:'key-a1'})).activePasskeys,1);
 });
 await test('compromise review revokes every session and in-flight sign-in; concurrent sign-in cannot restore authority',async()=>{
  const {rt,a}=setup();
  const other=rt.signIn({accountId:'acct-a',credentialId:'key-a2'}),grant=rt.startRecovery(v({email:'owner-a@example.test',key:KIT}));
  const inflightRevoked=rt.beginSignIn({accountId:'acct-a'}),inflightRetained=rt.beginSignIn({accountId:'acct-a'});
  // Authority a concurrent request has already read before the commit.
  const read={session:rt.principal(a),other:rt.principal(other),grant:rt.principal(grant),challenge:rt.inspect().challenges[inflightRetained]};
  const r=review(rt,a);
  const receipt=await commit(rt,a,{reviewId:r.reviewId,revokeCredentials:['key-a2']});
  assert.equal(receipt.sessionsRevoked,'all');
  // The committing batch deletes every older session, grant, challenge and kit offer, including the initiating session.
  const after=rt.inspect();
  for(const table of ['sessions','grants','challenges','offers'])assert.deepEqual(Object.values(after[table]).filter(x=>x.accountId==='acct-a'),[],table);
  await refuses(()=>rt.readAccountEmail(a),'AUTH_REQUIRED');await refuses(()=>rt.readAccountEmail(other),'AUTH_REQUIRED');
  await refuses(()=>rt.identityState(grant),'PROOF_REQUIRED');
  await refuses(()=>rt.finishSignIn({challengeId:inflightRevoked,credentialId:'key-a2'}),'PROOF_REQUIRED');
  await refuses(()=>rt.finishSignIn({challengeId:inflightRetained,credentialId:'key-a1'}),'PROOF_REQUIRED');
  // Authority read before the commit and presented after it is refused by the epoch fence.
  const account=rt.account('acct-a'),now=rt.now();
  for(const p of [read.session,read.other,read.grant])await refuses(()=>m.authorizeOwner(p,account,{fresh:false,now}),'IDENTITY_CHANGED');
  await refuses(()=>m.admitSignIn({challenge:read.challenge,account,credentialId:'key-a1',now}),'IDENTITY_CHANGED');
  await refuses(()=>rt.requestEmailChange(a,v({requestId:req(),newAddress:'x@example.test'})),'AUTH_REQUIRED');
  await refuses(()=>rt.signIn({accountId:'acct-a',credentialId:'key-a2'}),'PROOF_REQUIRED');
  const back=rt.signIn({accountId:'acct-a',credentialId:'key-a1'});
  assert.equal(rt.principal(back).authEpoch,receipt.epoch);
  assert.equal((await rt.readAccountEmail(back)).email,'owner-a@example.test');
 });
 await test('a stale compromise review is refused and a lost commit response is idempotent',async()=>{
  const {rt,a}=setup();
  const r=review(rt,a);rt.removePasskey(a,v({credentialId:'key-a2'}));
  const fresh=rt.signIn({accountId:'acct-a',credentialId:'key-a1'});
  await refuses(()=>commit(rt,fresh,{reviewId:r.reviewId}),'STALE_REVIEW');
  const r2=review(rt,fresh),id=req();
  const body=v({requestId:id,reviewId:r2.reviewId,revokeCredentials:[],rotateKit:null,revokeConnections:['gh-a']});
  const first=await rt.commitCompromiseReview(fresh,body);
  const epoch=first.epoch;
  // The original session is revoked, so a retry comes from a new sign-in and reads the same receipt.
  const retry=rt.signIn({accountId:'acct-a',credentialId:'key-a1'});
  assert.deepEqual(await rt.commitCompromiseReview(retry,body),first);
  assert.equal(rt.account('acct-a').authEpoch,epoch);
  await refuses(()=>rt.commitCompromiseReview(retry,{...body,revokeConnections:['cf-a']}),'REQUEST_CONFLICT');
  await refuses(()=>commit(rt,retry,{reviewId:r2.reviewId}),'STALE_REVIEW');
  const r3=review(rt,retry);rt.advance(m.bounds.reviewMs);const late=rt.signIn({accountId:'acct-a',credentialId:'key-a1'});
  await refuses(()=>commit(rt,late,{reviewId:r3.reviewId}),'STALE_REVIEW');
  // The snapshot is also bound to the kit generation and the connection set.
  const r4=review(rt,late),snap=rt.inspect(),acct=rt.account('acct-a'),principal=rt.principal(late),connections=Object.values(snap.connections);
  const plan=(account,list)=>m.commitCompromiseReview({principal,account,request:{requestId:req(),reviewId:r4.reviewId,revokeCredentials:[],rotateKit:null,revokeConnections:[]},
   prior:null,review:snap.reviews[r4.reviewId],offer:null,pending:null,connections:list,now:rt.now()});
  await refuses(()=>plan({...acct,kitGeneration:acct.kitGeneration+1},connections),'STALE_REVIEW');
  await refuses(()=>plan(acct,[...connections,{...connections[0],connectionId:'gh-new'}]),'STALE_REVIEW');
  assert.equal((await plan(acct,connections)).result.reviewId,r4.reviewId);
 });
 await test('kit rotation in the review retires the old kit and requires a saved replacement',async()=>{
  const {rt,a}=setup();
  const r=review(rt,a),offer=rt.prepareKit(a,v({reviewId:r.reviewId}));
  await refuses(()=>commit(rt,a,{reviewId:r.reviewId,rotateKit:{offerId:offer.offerId}}),'KIT_NOT_SAVED');
  await refuses(()=>commit(rt,a,{reviewId:r.reviewId,rotateKit:{offerId:offer.offerId,saved:true}}),'UNKNOWN_FIELD');
  // A kit saved for another review is not this review's replacement.
  const other=review(rt,a),foreign=rt.prepareKit(a,v({reviewId:other.reviewId}));rt.saveKit(a,v({offerId:foreign.offerId}));
  await refuses(()=>commit(rt,a,{reviewId:r.reviewId,rotateKit:{offerId:foreign.offerId}}),'KIT_NOT_SAVED');
  assert.deepEqual(rt.saveKit(a,v({offerId:offer.offerId})),rt.saveKit(a,v({offerId:offer.offerId})));
  const receipt=await commit(rt,a,{reviewId:r.reviewId,rotateKit:{offerId:offer.offerId}});
  assert.equal(receipt.kitRotated,true);
  await refuses(()=>rt.startRecovery(v({email:'owner-a@example.test',key:KIT})),'RECOVERY_PROOF');
  assert.equal(rt.startRecovery(v({email:'owner-a@example.test',key:offer.key})).kind,'grant');
  assert.ok(!JSON.stringify(rt.inspect()).includes(offer.key));
  assert.equal(rt.inspect().offers[foreign.offerId],undefined,'the epoch advance revokes every other kit offer');
 });
 await test('compromise review cancels a pending email change',async()=>{
  const {rt,a,change,tokenFor}=setup();
  await change(a,'attacker@example.test');await rt.runDelivery();const token=tokenFor('attacker@example.test');
  const r=review(rt,a);assert.equal(typeof r.pendingEmailChange?.changeId,'string');
  const receipt=await commit(rt,a,{reviewId:r.reviewId});
  assert.equal(receipt.pendingEmailChange,'cancelled');
  const s=rt.signIn({accountId:'acct-a',credentialId:'key-a1'});
  await refuses(()=>rt.confirmEmailChange(s,v({token})),'CHANGE_CLOSED');
  assert.equal((await rt.readAccountEmail(s)).email,'owner-a@example.test');
 });
 await test('provider revocation keeps reconciliation authority until a definitive receipt',async()=>{
  const {rt,a,revocations}=setup();
  const r=review(rt,a);
  assert.deepEqual(r.connections.map(c=>[c.connectionId,c.provider,c.access,c.revocation]),[['cf-a','cloudflare','active','none'],['gh-a','github','active','none']]);
  await commit(rt,a,{reviewId:r.reviewId,revokeConnections:['gh-a','cf-a']});
  const s=rt.signIn({accountId:'acct-a',credentialId:'key-a1'});
  await refuses(()=>rt.useConnection(s,v({connectionId:'gh-a'})),'CONNECTION_DISABLED');
  assert.deepEqual(rt.connectionState('gh-a'),{access:'disabled',credentialHeld:true,revocation:'queued'});
  await refuses(()=>rt.eraseConnectionCredential('gh-a'),'RECONCILIATION_HOLD');
  assert.deepEqual(rt.closureHolds('acct-a'),['cf-a','gh-a']);
  assert.equal(revocations.length,0,'the commit itself calls no provider');
  assert.deepEqual(await rt.runRevocations(),{revoked:2,retry:0,uncertain:0});
  assert.deepEqual(rt.connectionState('gh-a'),{access:'disabled',credentialHeld:false,revocation:'revoked'});
  assert.deepEqual(rt.eraseConnectionCredential('gh-a'),{connectionId:'gh-a',erased:true});
  assert.deepEqual(rt.closureHolds('acct-a'),[]);
  assert.deepEqual(revocations.map(x=>x.connectionId).sort(),['cf-a','gh-a']);
 });
 await test('an unknown provider outcome keeps the hold and is never redispatched blindly',async()=>{
  const {rt,a,revocations}=setup({revokeOutcomes:{'gh-a':'unknown','cf-a':'throw'}});
  const r=review(rt,a);
  await commit(rt,a,{reviewId:r.reviewId,revokeConnections:['gh-a','cf-a']});
  await rt.runRevocations();await rt.runRevocations();rt.advance(DAY);await rt.runRevocations();
  assert.equal(revocations.length,2);
  for(const c of ['gh-a','cf-a']){
   assert.deepEqual(rt.connectionState(c),{access:'disabled',credentialHeld:true,revocation:'uncertain'});
   await refuses(()=>rt.eraseConnectionCredential(c),'RECONCILIATION_HOLD');
  }
  assert.deepEqual(rt.closureHolds('acct-a'),['cf-a','gh-a']);
  // A later review selecting the same connections leaves an uncertain revocation held, not requeued.
  const s=rt.signIn({accountId:'acct-a',credentialId:'key-a1'}),again=review(rt,s);
  const second=await commit(rt,s,{reviewId:again.reviewId,revokeConnections:['gh-a','cf-a']});
  assert.deepEqual(second.connections.map(c=>c.revocation),['uncertain','uncertain']);
  await rt.runRevocations();assert.equal(revocations.length,2);
  await refuses(()=>rt.reconcileRevocation({connectionId:'gh-a',evidence:{authenticated:false,result:'revoked'}}),'EVIDENCE_NOT_AUTHENTICATED');
  assert.equal(rt.reconcileRevocation({connectionId:'gh-a',evidence:{authenticated:true,result:'not-found'}}),'uncertain','not found is not proof');
  assert.equal(rt.reconcileRevocation({connectionId:'gh-a',evidence:{authenticated:true,result:'revoked'}}),'revoked');
  assert.equal(rt.connectionState('gh-a').credentialHeld,false);
  for(let i=0;i<m.bounds.reconcileReads;i++)rt.reconcileRevocation({connectionId:'cf-a',evidence:{authenticated:true,result:'not-found'}});
  assert.deepEqual(rt.connectionState('cf-a'),{access:'disabled',credentialHeld:true,revocation:'unresolved'});
  await refuses(()=>rt.eraseConnectionCredential('cf-a'),'RECONCILIATION_HOLD');
  assert.deepEqual(rt.closureHolds('acct-a'),['cf-a'],'an unresolved hold blocks account closure');
  assert.equal(revocations.length,2,'reconciliation never calls revoke');
  // An attempt interrupted after its claim is an unknown outcome: later passes mark it uncertain and never call again.
  const {rt:r3,a:a3,revocations:k3}=setup();
  const rv3=review(r3,a3);await commit(r3,a3,{reviewId:rv3.reviewId,revokeConnections:['gh-a']});
  await refuses(()=>r3.runRevocations({interruptAfterClaim:true}),'INTERRUPTED');
  await r3.runRevocations();await r3.runRevocations();
  assert.deepEqual([k3.length,r3.connectionState('gh-a').revocation,r3.connectionState('gh-a').credentialHeld],[0,'uncertain',true]);
  // A definitive refusal that changed nothing is retried for the same retired credential.
  const {rt:r2,a:a2,revocations:k2}=setup({revokeOutcomes:{'gh-a':(()=>{let n=0;return ()=>++n===1?'not-revoked':'revoked';})()}});
  const rv=review(r2,a2);await commit(r2,a2,{reviewId:rv.reviewId,revokeConnections:['gh-a']});
  await r2.runRevocations();assert.equal(r2.connectionState('gh-a').revocation,'queued');await r2.runRevocations();
  assert.deepEqual([k2.length,r2.connectionState('gh-a').revocation],[2,'revoked']);
 });
 await test('compromise review never fabricates encrypted-content recovery',async()=>{
  const {rt,a}=setup();
  const r=review(rt,a);assert.equal(r.accountRecoveryOnly,true);
  await refuses(()=>commit(rt,a,{reviewId:r.reviewId,recoverContent:true}),'UNKNOWN_FIELD');
  const receipt=await commit(rt,a,{reviewId:r.reviewId});
  assert.ok(Object.keys(receipt).every(k=>!/content|decrypt|unlock|vault/i.test(k)));assert.equal(receipt.accountRecoveryOnly,true);
  assert.ok([...Object.keys(rt),...Object.keys(m)].every(k=>!/content|decrypt|unlock|vault/i.test(k)));
 });
 await test('the compromise snapshot, receipt and security-review notice are content-free',async()=>{
  const {rt,a,calls}=setup();
  const r=review(rt,a),offer=rt.prepareKit(a,v({reviewId:r.reviewId}));rt.saveKit(a,v({offerId:offer.offerId}));
  assert.deepEqual(r.sessions.map(x=>Object.keys(x).sort()),[['credentialId','issuedAt','sessionId']]);
  const receipt=await commit(rt,a,{reviewId:r.reviewId,revokeCredentials:['key-a2'],rotateKit:{offerId:offer.offerId},revokeConnections:['gh-a']});
  assert.deepEqual(Object.keys(receipt).sort(),['accountRecoveryOnly','connections','epoch','kitRotated','pendingEmailChange','reviewId','revokedCredentials','sessionsRevoked','stage']);
  await rt.runDelivery();
  const notices=calls.filter(x=>x.kind==='security-review-completed');
  assert.deepEqual(notices.map(x=>[x.to,x.from,'token' in x]),[['owner-a@example.test','notify@whumpo.com',false]]);
  const stored=rt.inspect(),text=JSON.stringify([r,receipt,notices,stored.receipts,stored.outbox,stored.reviews]);
  for(const secret of [offer.key,sha256(offer.key),KIT,sha256(KIT),a.token,sha256(a.token),...Object.values(rt.inspect().ciphertexts)])assert.ok(!text.includes(secret),'secret material in a review record');
 });
 await test('no model, Chat or customer-mailbox capability; one platform sender',async()=>{
  const {rt,a,change,calls}=setup();
  assert.ok([...Object.keys(rt),...Object.keys(m)].every(k=>!/model|agent|infer|prompt|chat|oauthMail|mailbox/i.test(k)));
  await change(a,'new-a@example.test');await rt.runDelivery();
  assert.ok(calls.length>0&&calls.every(x=>x.from==='notify@whumpo.com'&&Object.keys(x).every(k=>['from','displayName','to','kind','noticeId','token'].includes(k))));
  assert.ok(calls.every(x=>m.messageKinds.includes(x.kind)));
  // The synthetic mailer cannot address a real mailbox: only the reserved .test top-level domain is accepted.
  const synthetic=m.createSyntheticMailer();
  assert.equal(await synthetic.send({from:'notify@whumpo.com',displayName:'Whumpo',to:'someone@example.com',kind:'change-requested',noticeId:'msg-0001'}),'rejected');
  assert.equal(synthetic.delivered.length,0);
  // The synthetic revoker recognizes only the providers that have revocation adapters today.
  const revoker=m.createSyntheticRevoker();
  assert.equal(await revoker.revoke({provider:'example-provider',connectionId:'x-0001'}),'unrecognized');
 });
 await test('data classes: three are stored and registered (WH-201), the outbox stays planned, hash-only for tokens, nothing claims deployment',async()=>{
  const ids=m.dataClasses.map(c=>c.id);assert.equal(new Set(ids).size,ids.length);
  for(const c of m.dataClasses){for(const k of ['id','status','records','protection','secrets','retention','export','deletion'])assert.ok(c[k],`${c.id}.${k}`);}
  assert.deepEqual(m.dataClasses.filter(c=>c.status==='planned').map(c=>c.id),['platform-notifications']);
  assert.deepEqual(m.dataClasses.filter(c=>c.status==='current').map(c=>c.id).sort(),['connections','owner-email-changes','owner-email-change-limits','owner-security-reviews'].sort());
  assert.match(m.dataClasses.find(c=>c.id==='owner-email-changes').secrets,/SHA-256/);
  assert.match(m.dataClasses.find(c=>c.id==='platform-notifications').secrets,/never stored/);
  assert.match(m.dataClasses.find(c=>c.id==='connections').deletion,/only after an exact revocation receipt/);
 });
 await test('concurrent confirm, cancel and compromise transitions from one read commit exactly one outcome',async()=>{
  const {rt,a,change,tokenFor}=setup();
  const p=await change(a,'new-a@example.test');await rt.runDelivery();
  const verifier=await m.tokenVerifier(tokenFor('new-a@example.test'));
  const snap=rt.inspect(),before=snap.changes[p.changeId],acct=snap.accounts['acct-a'],now=rt.now();
  const principal={accountId:'acct-a',kind:'session',purpose:'workspace',authEpoch:acct.authEpoch,proof:{method:'passkey',verifiedAt:now}};
  const account={accountId:'acct-a',email:acct.email,verifiedAt:null,verifiedVia:null,authEpoch:acct.authEpoch,stage:'ready'};
  const confirm=change=>m.confirmEmailChange({principal,account,verifier,change,holders:{accounts:[],changes:[]},failures:[],now});
  const cancel=change=>m.cancelEmailChange({principal,account,changeId:before.changeId,change,now});
  const candidates=[confirm(before).changes[0],cancel(before).changes[0],m.closeForSecurityReview(before)];
  // Every transition claims the same prior revision, so a revision-guarded store accepts only the first to commit.
  assert.deepEqual(candidates.map(c=>[c.state,c.revision]),[['confirmed',before.revision+1],['cancelled',before.revision+1],['cancelled',before.revision+1]]);
  for(const order of [[0,1,2],[1,0,2],[2,1,0]]){
   let stored=before;
   const won=order.filter(i=>{if(candidates[i].revision!==stored.revision+1)return false;stored=candidates[i];return true;});
   assert.deepEqual(won,[order[0]]);
   // Re-planned against the stored winner, the losers refuse or change nothing.
   if(stored.state==='confirmed')await refuses(()=>cancel(stored),'CHANGE_CLOSED');
   else await refuses(()=>confirm(stored),'CHANGE_CLOSED');
   assert.equal(m.closeForSecurityReview(stored),stored);
  }
  // Two compromise commits planned from one read of the same review: both claim the same review revision, one commits.
  const {rt:r2,a:a2}=setup();const rv=review(r2,a2),read=r2.inspect(),reader=r2.principal(a2),before2=r2.account('acct-a');
  const plan=(principal,account,review,revokeCredentials)=>m.commitCompromiseReview({principal,account,request:{requestId:req(),reviewId:rv.reviewId,revokeCredentials,rotateKit:null,revokeConnections:[]},
   prior:null,review,offer:null,pending:null,connections:Object.values(read.connections),now:r2.now()});
  const planned=await Promise.all([['key-a2'],[]].map(list=>plan(reader,before2,read.reviews[rv.reviewId],list)));
  assert.deepEqual(planned.map(x=>x.review.revision),[2,2]);
  r2.applyCommit(planned[0]);
  await refuses(()=>r2.applyCommit(planned[1]),'CONCURRENT_REVIEW');
  assert.deepEqual([r2.account('acct-a').authEpoch,r2.account('acct-a').credentials],[before2.authEpoch+1,['key-a1']]);
  // Re-planned against the stored state, the loser is fenced (old session) or stale (new sign-in).
  await refuses(()=>plan(reader,r2.account('acct-a'),r2.inspect().reviews[rv.reviewId],[]),'IDENTITY_CHANGED');
  const again=r2.signIn({accountId:'acct-a',credentialId:'key-a1'});
  await refuses(()=>plan(r2.principal(again),r2.account('acct-a'),r2.inspect().reviews[rv.reviewId],[]),'STALE_REVIEW');
 });
 return count;
}

// ---------- Mutation check: each deliberately broken copy of the source must fail the suite ----------
const P='src/email-change/policy.ts',C='src/email-change/change.ts',T='src/email-change/token.ts',K='src/email-change/compromise.ts',V='src/email-change/revocation.ts';
const mutants=[
 ['recovery accepts a pending address',K,"const account=normalized===null?null:accounts.find(x=>x.email===normalized)??null;","const account=normalized===null?null:accounts.find(x=>x.email===normalized||changes.some(c=>c.accountId===x.accountId&&c.state==='pending'&&c.newAddress===normalized))??null;"],
 ['verified email waives the kit',K,"const proven=account!==null&&!ambiguous&&keyVerifier!==null&&keyVerifier===account.kitVerifier;","const proven=account!==null&&!ambiguous&&(account.verifiedAt!==null||keyVerifier!==null&&keyVerifier===account.kitVerifier);"],
 ['unknown version accepted',P,"check(input.version===contractVersion,'UNSUPPORTED_VERSION',String(input.version));",''],
 ['retired password field accepted',P,"for(const key of Object.keys(input))check(!retiredAuthorityFields.includes(key),'RETIRED_AUTHORITY',key);",''],
 ['fresh passkey not required',P,"if(fresh)check(principal.proof.method==='passkey'&&now-principal.proof.verifiedAt<=emailChangeBounds.freshPasskeyMs,'PROOF_REQUIRED');",''],
 ['restricted grant admitted to workspace operations',P,"check(principal.kind==='session'&&principal.purpose==='workspace'&&account.stage==='ready','IDENTITY_INCOMPLETE');","check(true,'IDENTITY_INCOMPLETE');"],
 ['stale session admitted to email operations',P,"check(principal.authEpoch===account.authEpoch,'IDENTITY_CHANGED');",''],
 ['delivery unavailable still stores',C,"check(deliveryActive,'DELIVERY_UNAVAILABLE');",''],
 ['old address not notified',C,"notices.push({kind:'change-requested',changeId,to:account.email});",''],
 ['token stored in plaintext',T,"claimedChange={...change,tokenVerifier:await hashToken(token),revision:change.revision+1};","claimedChange={...change,tokenVerifier:token,revision:change.revision+1};"],
 ['token accepted from another account',C,"||change.accountId!==account.accountId)return step({limits",")return step({limits"],
 ['confirmation replay re-applies',C,"if(change.state==='confirmed')return step({result:change.receipt});","if(change.state==='confirmed')change={...change,state:'pending'};"],
 ['expiry not checked',C,"if(now>=change.expiresAt)return step({changes:[moved(change,'expired')],refusal:{code:'TOKEN_EXPIRED',detail:''}});",''],
 ['superseded change confirmable',C,"const superseded=pending&&pending.state==='pending'?[moved(pending,'superseded','new-request')]:[];","const superseded:EmailChange[]=[];"],
 ['pending change not bound to the epoch',C,"if(change.epoch!==account.authEpoch)return step({changes:[moved(change,'stale','epoch')],refusal:{code:'STALE_CHANGE',detail:'epoch'}});",''],
 ['request replay creates a second change',C,"if(prior){check(prior.accountId===account.accountId&&prior.requestHash===requestHash,'REQUEST_CONFLICT',request.requestId);return step({result:pendingResponse(prior)});}",''],
 ['in-use address enumerated',C,"const deliverable=!reserved&&","check(!reserved,'ADDRESS_IN_USE');const deliverable="],
 ['account request limit removed',C,"check(recent.length<emailChangeBounds.requestsPerAccountPerDay,'RATE_LIMITED','requests');",''],
 ['lost delivery response redispatched',T,"return {notice:{...claimed,state:'unknown-outcome'},change:claimedChange,outcome:'unknown'};","return {notice:{...claimed,state:'queued'},change:claimedChange,outcome:'unknown'};"],
 ['undo after the window',C,"now<change.undoUntil&&account.email===change.newAddress","account.email===change.newAddress"],
 ['compromise commit leaves sessions and sign-ins valid',K,"authEpoch:account.authEpoch+1,","authEpoch:account.authEpoch,"],
 ['in-flight sign-in survives an epoch change',K,"check(challenge.epoch===account.authEpoch,'IDENTITY_CHANGED');",''],
 ['stale compromise review accepted',K,"check(reviewCurrent(review,account,now)&&review.credentialRevision===account.credentialRevision&&review.kitGeneration===account.kitGeneration&&sameList(review.connections,current),'STALE_REVIEW');",''],
 ['compromise commit replay re-applies',K,"if(prior){check(prior.accountId===account.accountId&&prior.requestHash===requestHash,'REQUEST_CONFLICT',request.requestId);","if(false){check(prior.accountId===account.accountId&&prior.requestHash===requestHash,'REQUEST_CONFLICT',request.requestId);"],
 ['two-key minimum blocks emergency revocation',K,"const credentials=account.credentials.filter(k=>!request.revokeCredentials.includes(k));","const credentials=account.credentials.filter(k=>!request.revokeCredentials.includes(k));check(credentials.length>=2,'MIN_KEYS');"],
 ['old kit survives rotation',K,"kitVerifier:rotated?rotated.verifier:account.kitVerifier","kitVerifier:account.kitVerifier"],
 ['unsaved kit accepted',K,"&&now<offer.expiresAt&&offer.savedAt!==null,'KIT_NOT_SAVED'","&&now<offer.expiresAt,'KIT_NOT_SAVED'"],
 ['pending email change survives compromise review',K,"return moved(change,'cancelled','security-review');","return change;"],
 ['credential erased before provider revocation',V,"return bump(connection,{access:'disabled'},{state:'queued',since:null,receipt:null});","return bump(connection,{access:'disabled',credentialHeld:false},{state:'queued',since:null,receipt:null});"],
 ['unknown revocation outcome redispatched',V,"return {connection:bump(claimed,{},{state:'uncertain',since:now}),outcome:'unknown'};","return {connection:bump(claimed,{},{state:'queued'}),outcome:'unknown'};"],
 ['erasure without a revocation receipt',V,"check(connection.revocation.state==='revoked'&&connection.revocation.receipt!==null,'RECONCILIATION_HOLD',connection.revocation.state);",''],
 ['unauthenticated reconciliation evidence accepted',V,"check(plain(evidence)&&evidence.authenticated===true,'EVIDENCE_NOT_AUTHENTICATED');","check(plain(evidence),'EVIDENCE_NOT_AUTHENTICATED');"],
 ['compromise review fabricates content recovery',K,"sessionsRevoked:'all',accountRecoveryOnly:true};","sessionsRevoked:'all',accountRecoveryOnly:true,contentRecovery:'restored'};"],
 // WH-203 additions.
 ['removed passkey completes sign-in',K,"check(typeof credentialId==='string'&&account.credentials.includes(credentialId),'PROOF_REQUIRED');",''],
 ['review not bound to the kit generation',K,"&&review.kitGeneration===account.kitGeneration",''],
 ['kit offer bound to another review accepted',K,"&&offer.reviewId===review.reviewId",''],
 ['security-review notice not queued',K,"notices:[{kind:'security-review-completed',changeId:null,to:account.email}],","notices:[],"],
 ['second review requeues an uncertain revocation',V,"if(connection.revocation.state!=='none')return connection.access==='disabled'?connection:bump(connection,{access:'disabled'});","if(connection.revocation.state==='revoked')return connection;"],
 ['interrupted revocation dispatch redispatched',V,"if(connection.revocation.state==='dispatching')return {connection:bump(connection,{},{state:'uncertain',since:now}),outcome:'unknown'};","if(connection.revocation.state==='dispatching')connection={...connection,revocation:{...connection.revocation,state:'queued'}};"],
 ['reconciliation read bound removed',V,"reads>=revocationBounds.reconcileReads||",''],
 ['unresolved hold does not block account closure',V,"Object.freeze(['queued','dispatching','uncertain','unresolved'])","Object.freeze(['queued','dispatching','uncertain'])"],
];
// Each mutant must be caught by the check written for that property, not by an unrelated failure.
const killedBy={
 'recovery accepts a pending address':'an unverified or pending email','verified email waives the kit':'an unverified or pending email',
 'unknown version accepted':'unknown versions','retired password field accepted':'unknown versions',
 'fresh passkey not required':'an address change requires a fresh passkey','restricted grant admitted to workspace operations':'recovery secrets grant only',
 'stale session admitted to email operations':'an authority change after the request',
 'delivery unavailable still stores':'delivery unavailable stores nothing','old address not notified':'delivery unavailable stores nothing',
 'token stored in plaintext':'confirmation token is single use, stored only as a hash','token accepted from another account':'confirmation token is single use, stored only as a hash',
 'confirmation replay re-applies':'a confirmation token is single use: replay','expiry not checked':'an expired confirmation token',
 'superseded change confirmable':'a competing later change','pending change not bound to the epoch':'an authority change after the request',
 'request replay creates a second change':'a lost request or confirmation response','in-use address enumerated':'the response never reveals',
 'account request limit removed':'rate limits bound','lost delivery response redispatched':'a lost provider response is never redispatched',
 'undo after the window':'cancel before confirmation and undo',
 'compromise commit leaves sessions and sign-ins valid':'compromise review revokes every session','in-flight sign-in survives an epoch change':'compromise review revokes every session',
 'stale compromise review accepted':'a stale compromise review','compromise commit replay re-applies':'a stale compromise review',
 'two-key minimum blocks emergency revocation':'emergency revocation is allowed','old kit survives rotation':'kit rotation in the review','unsaved kit accepted':'kit rotation in the review',
 'pending email change survives compromise review':'compromise review cancels a pending email change',
 'credential erased before provider revocation':'provider revocation keeps reconciliation authority','unknown revocation outcome redispatched':'an unknown provider outcome keeps the hold',
 'erasure without a revocation receipt':'provider revocation keeps reconciliation authority','unauthenticated reconciliation evidence accepted':'an unknown provider outcome keeps the hold',
 'compromise review fabricates content recovery':'compromise review never fabricates',
 'removed passkey completes sign-in':'emergency revocation is allowed','review not bound to the kit generation':'a stale compromise review',
 'kit offer bound to another review accepted':'kit rotation in the review','security-review notice not queued':'the compromise snapshot, receipt and security-review notice',
 'second review requeues an uncertain revocation':'an unknown provider outcome keeps the hold','interrupted revocation dispatch redispatched':'an unknown provider outcome keeps the hold',
 'reconciliation read bound removed':'an unknown provider outcome keeps the hold','unresolved hold does not block account closure':'an unknown provider outcome keeps the hold',
};

// The main suite runs the unmodified source, including src/security.ts hashToken on WebCrypto. Mutant runs replace only
// that SHA-256 hex primitive with node:crypto (Node's WebCrypto digest dominated the run time); the static checks below
// prove both produce the same digests. After the main bundle, every other esbuild job (the Worker import graph and one
// bundle per mutant) starts at once and runs in esbuild's own process while the suites run here.
const fastHash={'src/security.ts':"import {createHash} from 'node:crypto';export async function hashToken(token:string){return createHash('sha256').update(token,'utf8').digest('hex');}"};
const settle=promise=>promise.then(value=>({value}),error=>({error}));
const unwrap=async promise=>{const r=await promise;if(r.error)throw r.error;return r.value;};
const source=await importText(await bundleSource());
const fastSourceBuild=settle(bundleSource(fastHash));
const graphBuild=settle(graph());
const prepared=mutants.map(([name,file,find,replace])=>{
 assert.ok(moduleFiles.includes(file)||file==='src/security.ts',`mutant "${name}" targets ${file}, outside the source module`);
 const text=read(file);
 assert.equal(text.split(find).length,2,`mutant "${name}" must match ${file} exactly once`);
 return settle(bundleSource({...fastHash,[file]:text.replace(find,()=>replace)}));
});
const suiteCount=await suite(compose(source));
let total=suiteCount;
const checkOnce=async(name,fn)=>{try{await fn();total++;}catch(error){throw new Error(name,{cause:error});}};

// ---------- Read-only agreement with the current identity and connection source ----------
await checkOnce('the source fresh-passkey window matches the identity engine',()=>{
 assert.match(read('src/workspace-identity/authority.ts'),/proof_method='passkey' AND proof_at>unixepoch\(\)-600/);
 assert.equal(source.emailChangeBounds.freshPasskeyMs,600e3);
 assert.match(read('src/email-change/policy.ts'),/principal\.proof\.method==='passkey'&&now-principal\.proof\.verifiedAt<=emailChangeBounds\.freshPasskeyMs/);
});
await checkOnce('current recovery treats email as a lookup identifier with one generic proof error',()=>{
 const src=read('src/workspace-identity/recovery.ts');
 assert.match(src,/identityRecord\(input,\['version','email','key'\]\)/);
 assert.match(src,/if\(!a\|\|!equal\)throw invalidProof\(\);/);
});
// G-E1 (WH-201): the schema now carries the verification state, the change, limit and security-review classes. The pin is positive:
// the columns, tables and lockstep triggers exist, the address is still a plain unique label, and nothing profile-shaped edits it.
await checkOnce('the stored account email has verification state, change records and lockstep triggers in the schema, and no edit path other than the stores (gap G-E1)',()=>{
 const users=read('src/workspace-identity/canonical-inputs.sql').match(/CREATE TABLE users \(([^;]*)\) STRICT;/)[1];
 assert.match(users,/email TEXT NOT NULL UNIQUE/);assert.match(users,/email_verified_at INTEGER/);assert.match(users,/email_verified_via TEXT[^\n]*email_verified_via='notify@whumpo\.com'/);
 assert.ok(!/password|recovery_code|magic|otp/i.test(users),'no password or legacy proof column');
 const platform=read('schema/platform.sql');
 for(const table of ['owner_email_changes','owner_email_change_limits','owner_security_reviews'])assert.equal((platform.match(new RegExp('CREATE TABLE '+table+' \\('))??[]).length,1,table);
 for(const trigger of ['users_email_lockstep','users_email_new','owner_email_change_confirm','owner_email_change_undo','owner_email_change_limit_rate','owner_security_review_commit'])assert.match(platform,new RegExp('CREATE TRIGGER '+trigger+'\\b'),trigger);
 assert.ok(!/password|recovery_code|magic_link|otp/i.test(platform.slice(platform.indexOf('CREATE TABLE owner_email_changes'))),'no password or legacy proof field in the new classes');
 const profile=read('src/profile.ts');
 const allow=profile.match(/keys\.some\(k=>!\[([^\]]*)\]\.includes\(k\)\)/)[1];assert.ok(!allow.includes('email'));
 assert.match(profile,/SELECT name,about_me FROM user_profiles WHERE user_id=\? AND share_context=1/);
 // The only writers of users.email are the signup insert and the change store (which runs under the lockstep trigger).
 const writers=readdirSync(join(root,'src'),{recursive:true}).filter(f=>/\.ts$/.test(f)).map(f=>join('src',f)).filter(f=>/UPDATE users SET email/i.test(read(f)));
 assert.deepEqual(writers,['src/email-change/store.ts']);
 assert.deepEqual(Object.keys(source.emailChangeBounds).filter(k=>/Ms$/.test(k)).sort(),['failureWindowMs','freshPasskeyMs','limitWindowMs','tokenLifetimeMs','undoWindowMs']);
 assert.deepEqual([source.emailChangeBounds.tokenLifetimeMs,source.emailChangeBounds.undoWindowMs],[HOUR,7*DAY],'decisions 1 and 2: recommended values');
 // The schema repeats the decision values: one hour, seven days, 3/3/5 per day, day and hour.
 const lifecycle=JSON.parse(read('docs/data-lifecycle.json'));
 for(const [cls,table] of [['owner-email-changes','owner_email_changes'],['owner-email-change-limits','owner_email_change_limits'],['owner-security-reviews','owner_security_reviews']])assert.ok(lifecycle.classes.find(c=>c.id===cls&&c.tables.includes(table)&&c.storageStatus==='current'),`${cls} is registered in the lifecycle catalogue`);
 for(const c of source.dataClasses.filter(c=>c.status==='current'&&c.id.startsWith('owner-')))assert.ok(lifecycle.classes.some(l=>l.id===c.id),c.id);
 assert.match(platform,/expires_at=created_at\+3600000/);assert.match(platform,/undo_until=receipt_verified_at\+604800000/);
 assert.match(platform,/NEW\.kind='request'[^\n]*>=3\)/);assert.match(platform,/NEW\.kind='send'[^\n]*>=3\)/);assert.match(platform,/NEW\.kind='failure'[^\n]*-3600000\)>=5\)/);
});
await checkOnce('the inactive support notice would address the unverified account email (gap G-E5)',()=>{
 assert.match(read('src/support-delivery.ts'),/recipient:row\.email/);
});
// G-E7: the review's emergency removal and epoch fence match the identity engine's own removal and kit rotation.
await checkOnce('the review revokes the same authority rows the identity engine revokes, and allows zero keys (gap G-E7)',()=>{
 const recovery=read('src/workspace-identity/recovery.ts');
 assert.match(recovery,/\['identity_sessions','identity_grants','identity_challenges','identity_kit_offers'\]\.map\(table=>db\.prepare\(`DELETE FROM \$\{table\} WHERE account_id=\?/);
 assert.match(recovery,/auth_epoch=auth_epoch\+1,current_attempt_id=NULL,stage=CASE WHEN EXISTS\(SELECT 1 FROM identity_credentials WHERE account_id=\? AND status='active'\) THEN 'ready' ELSE 'recovering' END/);
 assert.match(read('src/workspace-identity/kits.ts'),/kit_generation=\?,auth_epoch=auth_epoch\+1/);
 assert.deepEqual([...source.revokedAuthority],['sessions','grants','challenges','kitOffers']);
 assert.equal(source.compromiseBounds.reviewMs,10*MIN);assert.equal(source.compromiseBounds.kitOfferMs,30*MIN);
});
// G-E8: revoke-before-erase uses the receipts the existing adapters already require.
await checkOnce('the existing provider adapters settle revocation only on an exact receipt (gap G-E8)',()=>{
 assert.match(read('src/github-connection.ts'),/method:'DELETE'[^\n]*return response\.status===204;/);
 assert.match(read('src/cloudflare-connection.ts'),/oauth2\/revoke[^\n]*if\(response\.status!==200\)complete=false;/);
 assert.deepEqual([source.revocationBounds.reconcileReads,source.revocationBounds.reconcileWindowMs],[3,3*DAY]);
});
await checkOnce('the source module is pure, and no Worker entry reaches it',async()=>{
 // Every file in the module directory is listed, so a new file cannot escape the purity checks below.
 assert.deepEqual(readdirSync(join(root,'src/email-change')).sort(),[...moduleFiles,...wiringFiles].map(f=>f.slice('src/email-change/'.length)).sort());
 const allowed=new Set(['../security','./policy','./change','./revocation']);
 const specifiersOf=text=>[...text.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g)].map(x=>x[1]??x[2]);
 const effectful=/\bfetch\s*\(|XMLHttpRequest|WebSocket|process\.env|D1Database|\.prepare\(|\benv\.[A-Z_]+|console\./;
 for(const file of moduleFiles){
  const text=read(file);
  assert.ok(specifiersOf(text).every(s=>allowed.has(s)),`${file} imports ${specifiersOf(text)}`);
  assert.ok(!effectful.test(text),file);
 }
 assert.deepEqual(specifiersOf(read('src/security.ts')),[]);
 // Walk every runtime import edge esbuild resolved (before tree shaking, so an unused import still counts). Packages stay
 // external (src/runtime/worker.ts imports only QuickJS packages); every src/ module is followed.
 const {inputs}=(await unwrap(graphBuild)).metafile;
 for(const worker of workers){
  const reached=new Set([worker]);
  for(const path of reached)for(const edge of inputs[path]?.imports??[])if(!edge.external&&Object.hasOwn(inputs,edge.path))reached.add(edge.path);
  assert.ok(Object.hasOwn(inputs,worker)&&(worker!=='src/index.ts'||reached.size>100),`${worker}: ${reached.size} modules`);
  // WH-201: only the main Worker reaches the module, and only through the trusted adapter. The site, app and runtime Workers never do.
  const reachedModule=[...reached].filter(p=>/email-change/.test(p));
  if(worker==='src/index.ts')assert.ok(reachedModule.includes('src/email-change/http.ts')&&reachedModule.every(p=>p==='src/email-change/http.ts'||p==='src/email-change/store.ts'||p==='src/email-change/maintenance.ts'||moduleFiles.includes(p)),`${worker} reaches ${reachedModule}`);
  else assert.deepEqual(reachedModule,[],`${worker} reaches the email-change module`);
 }
 // No Chat, agent, model or other module imports it: the only importer outside the folder is the main Worker's route table.
 const importers=readdirSync(join(root,'src'),{recursive:true}).filter(f=>/\.tsx?$/.test(f)).map(f=>join('src',f)).filter(f=>!f.startsWith('src/email-change/')&&/email-change/.test(read(f)));
 assert.deepEqual(importers,['src/index.ts'],'the adapter is mounted by the main Worker only; no agent action reaches it');
 for(const file of wiringFiles){assert.ok(!/ai-chat|site-agent|workspace-agent|agent-|chat-interactions/.test(read(file).split('\n').filter(l=>/^import /.test(l)).join('\n')),`${file} imports no Chat or agent module`);}
 assert.ok(!/email-change|accountEmail/.test(read('src/ai-chat.ts')+read('src/site-agent.ts')),'no agent action can prepare, confirm, cancel or read a change');
});
await checkOnce('the source address rule is the WH-036 destination rule',()=>{
 const rule=text=>{const start=text.indexOf('/^[a-z0-9.!#'),end=text.indexOf('$/.test(address)',start);return start<0||end<0?null:text.slice(start,end+2);};
 const current=rule(read('src/contact-notifications.ts'));
 assert.ok(current&&current.length>60,'WH-036 destination rule not found');
 assert.equal(rule(read('src/email-change/policy.ts')),current);
 assert.match(read('src/email-change/policy.ts'),/address\.length>=3&&address\.length<=254/);
});

const fastSource=await importText(await unwrap(fastSourceBuild));
await checkOnce('mutant runs differ from the source only in the SHA-256 implementation',async()=>{
 for(const value of ['SYNTHETIC-TOKEN-0001','','é-address@example.test',fastSource.mintConfirmationToken()]){
  assert.equal(await fastSource.tokenVerifier(value),await source.tokenVerifier(value));
  assert.equal(await fastSource.addressKey(value),await source.addressKey(value));
 }
 assert.equal(await source.tokenVerifier('abc'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});
let killed=0;
const byFile={};
for(const [index,[name,file]] of mutants.entries()){
 const m=compose(await importText(await unwrap(prepared[index])));
 await assert.rejects(suite(m),e=>{
  if(process.argv.includes('--explain'))console.log(`${name} (${file}) => ${e.message} [${e.cause?.name}: ${String(e.cause?.message).split('\n')[0]}]`);
  assert.ok(killedBy[name]&&e.message.startsWith(killedBy[name]),`mutant "${name}" was caught by an unexpected check: ${e.message}${e.cause?` (${e.cause.message})`:''}`);return true;
 },`mutant survived: ${name}`);killed++;byFile[file.split('/').at(-1)]=(byFile[file.split('/').at(-1)]??0)+1;
}
assert.equal(killed,mutants.length);
assert.deepEqual(Object.keys(killedBy).sort(),mutants.map(([name])=>name).sort());
console.log(`email-change-contract: ${suiteCount} checks and ${total-suiteCount} source-agreement/static checks passed against src/email-change; ${killed}/${mutants.length} mutants caught, all in the source (${Object.entries(byFile).map(([f,n])=>`${f} ${n}`).join(', ')}; synthetic accounts, mailer and provider; no database, network, credential or model).`);
