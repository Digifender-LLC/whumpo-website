import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {readFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {fileURLToPath} from 'node:url';

// WH-063 / WH-200 conformance harness for verified email changes and compromise response. The address-change rules run
// against the source module src/email-change/*.ts (bundled with esbuild); tools/prototypes/compromise-review.mjs only
// hosts it in a synthetic identity engine (sign-in, sessions, recovery grants, emergency removal) and holds the WH-203
// compromise-review and provider-revocation reference that has no source yet. Synthetic accounts, addresses
// (example.test), kit keys, mailer and provider revoker only: no database, network, credential, model or provider
// account. It proves the frozen contract, the source state machine and the reference, plus read-only agreements with the
// current identity source. It does not prove D1 atomicity or real delivery (WH-201/202/204). Every suite check also runs
// against deliberately broken copies of the source and of the reference (mutants below).
const root=fileURLToPath(new URL('..',import.meta.url));
const moduleFiles=['src/email-change/policy.ts','src/email-change/change.ts','src/email-change/token.ts','src/email-change/compromise.ts'];
const referenceFile='tools/prototypes/compromise-review.mjs';
const read=file=>readFileSync(join(root,file),'utf8');
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
/** The suite's view: source exports, plus the reference runtime hosting that source. */
const compose=(source,reference)=>({...source,dataClasses:reference.dataClasses,sha256:reference.sha256,bounds:{...source.emailChangeBounds,...reference.bounds},
 createReferenceRuntime:options=>reference.createReferenceRuntime({...options,emailChange:source})});
const KIT='SYNTHETIC-KIT-0001',KIT_B='SYNTHETIC-KIT-0002';
const MIN=60e3,HOUR=60*MIN,DAY=24*HOUR;
let rid=0;const req=()=>`req-${String(++rid).padStart(8,'0')}`;

async function suite(m){
 let count=0;
 const test=async(name,fn)=>{try{await fn();count++;}catch(error){throw new Error(name,{cause:error});}};
 const refuses=(fn,code)=>assert.rejects(async()=>fn(),e=>{assert.equal(e.code,code,e.message);return true;});
 function setup({mail=true,outcomes={},revokeOutcomes={}}={}){
  const revocations=[];
  const mailer=mail?m.createSyntheticMailer({decide:message=>{const o=outcomes[message.kind];return typeof o==='function'?o(message):o??'accepted';}}):null;
  const inbox=mailer?mailer.delivered:[],calls=mailer?mailer.calls:[];
  const revoker=x=>{revocations.push(x);const o=revokeOutcomes[x.connectionId];const r=typeof o==='function'?o(x):o??'revoked';if(r==='throw')throw new Error('synthetic transport loss');return r;};
  const rt=m.createReferenceRuntime({mailer,revoker});
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
 await test('emergency revocation is allowed below the two-key count, down to zero',async()=>{
  const {rt,a}=setup();
  const r=review(rt,a);
  const one=rt.commitCompromiseReview(a,v({requestId:req(),reviewId:r.reviewId,revokeCredentials:['key-a2'],rotateKit:null,revokeConnections:[]}));
  assert.equal(one.stage,'ready');
  const s=rt.signIn({accountId:'acct-a',credentialId:'key-a1'}),r2=review(rt,s);
  const zero=rt.commitCompromiseReview(s,v({requestId:req(),reviewId:r2.reviewId,revokeCredentials:['key-a1'],rotateKit:null,revokeConnections:[]}));
  assert.equal(zero.stage,'recovering');
  await refuses(()=>rt.signIn({accountId:'acct-a',credentialId:'key-a1'}),'PROOF_REQUIRED');
  const g=rt.startRecovery(v({email:'owner-a@example.test',key:KIT}));
  assert.equal(rt.identityState(g).stage,'recovering');
  const {rt:r3,a:a3}=setup();assert.equal(r3.removePasskey(a3,v({credentialId:'key-a1'})).activePasskeys,1);
 });
 await test('compromise review revokes every session and in-flight sign-in; concurrent sign-in cannot restore authority',async()=>{
  const {rt,a}=setup();
  const other=rt.signIn({accountId:'acct-a',credentialId:'key-a2'});
  const inflightRevoked=rt.beginSignIn({accountId:'acct-a'}),inflightRetained=rt.beginSignIn({accountId:'acct-a'});
  const r=review(rt,a);
  const receipt=rt.commitCompromiseReview(a,v({requestId:req(),reviewId:r.reviewId,revokeCredentials:['key-a2'],rotateKit:null,revokeConnections:[]}));
  assert.equal(receipt.sessionsRevoked,'all');
  await refuses(()=>rt.readAccountEmail(a),'IDENTITY_CHANGED');await refuses(()=>rt.readAccountEmail(other),'IDENTITY_CHANGED');
  await refuses(()=>rt.requestEmailChange(a,v({requestId:req(),newAddress:'x@example.test'})),'IDENTITY_CHANGED');
  await refuses(()=>rt.finishSignIn({challengeId:inflightRevoked,credentialId:'key-a2'}),'IDENTITY_CHANGED');
  await refuses(()=>rt.finishSignIn({challengeId:inflightRetained,credentialId:'key-a1'}),'IDENTITY_CHANGED');
  await refuses(()=>rt.signIn({accountId:'acct-a',credentialId:'key-a2'}),'PROOF_REQUIRED');
  const back=rt.signIn({accountId:'acct-a',credentialId:'key-a1'});
  assert.equal((await rt.readAccountEmail(back)).email,'owner-a@example.test');
 });
 await test('a stale compromise review is refused and a lost commit response is idempotent',async()=>{
  const {rt,a}=setup();
  const r=review(rt,a);rt.removePasskey(a,v({credentialId:'key-a2'}));
  const fresh=rt.signIn({accountId:'acct-a',credentialId:'key-a1'});
  await refuses(()=>rt.commitCompromiseReview(fresh,v({requestId:req(),reviewId:r.reviewId,revokeCredentials:[],rotateKit:null,revokeConnections:[]})),'STALE_REVIEW');
  const r2=review(rt,fresh),id=req();
  const body=v({requestId:id,reviewId:r2.reviewId,revokeCredentials:[],rotateKit:null,revokeConnections:['gh-a']});
  const first=rt.commitCompromiseReview(fresh,body);
  const epoch=first.epoch;
  // The original session is fenced, so a retry comes from a new sign-in and reads the same receipt.
  const retry=rt.signIn({accountId:'acct-a',credentialId:'key-a1'});
  assert.deepEqual(rt.commitCompromiseReview(retry,body),first);
  assert.equal(rt.inspect().accounts['acct-a'].epoch,epoch);
  await refuses(()=>rt.commitCompromiseReview(retry,{...body,revokeConnections:['cf-a']}),'REQUEST_CONFLICT');
  const r3=review(rt,retry);rt.advance(m.bounds.reviewMs);const late=rt.signIn({accountId:'acct-a',credentialId:'key-a1'});
  await refuses(()=>rt.commitCompromiseReview(late,v({requestId:req(),reviewId:r3.reviewId,revokeCredentials:[],rotateKit:null,revokeConnections:[]})),'STALE_REVIEW');
 });
 await test('kit rotation in the review retires the old kit and requires a saved replacement',async()=>{
  const {rt,a}=setup();
  const r=review(rt,a),offer=rt.prepareKit(a,v({reviewId:r.reviewId}));
  await refuses(()=>rt.commitCompromiseReview(a,v({requestId:req(),reviewId:r.reviewId,revokeCredentials:[],rotateKit:{offerId:offer.offerId,saved:false},revokeConnections:[]})),'KIT_NOT_SAVED');
  const receipt=rt.commitCompromiseReview(a,v({requestId:req(),reviewId:r.reviewId,revokeCredentials:[],rotateKit:{offerId:offer.offerId,saved:true},revokeConnections:[]}));
  assert.equal(receipt.kitRotated,true);
  await refuses(()=>rt.startRecovery(v({email:'owner-a@example.test',key:KIT})),'RECOVERY_PROOF');
  assert.equal(rt.startRecovery(v({email:'owner-a@example.test',key:offer.key})).kind,'grant');
  assert.ok(!JSON.stringify(rt.inspect()).includes(offer.key));
 });
 await test('compromise review cancels a pending email change',async()=>{
  const {rt,a,change,tokenFor}=setup();
  await change(a,'attacker@example.test');await rt.runDelivery();const token=tokenFor('attacker@example.test');
  const r=review(rt,a);assert.equal(r.pendingEmailChange,true);
  rt.commitCompromiseReview(a,v({requestId:req(),reviewId:r.reviewId,revokeCredentials:[],rotateKit:null,revokeConnections:[]}));
  const s=rt.signIn({accountId:'acct-a',credentialId:'key-a1'});
  await refuses(()=>rt.confirmEmailChange(s,v({token})),'CHANGE_CLOSED');
  assert.equal((await rt.readAccountEmail(s)).email,'owner-a@example.test');
 });
 await test('provider revocation keeps reconciliation authority until a definitive receipt',async()=>{
  const {rt,a,revocations}=setup();
  const r=review(rt,a);
  rt.commitCompromiseReview(a,v({requestId:req(),reviewId:r.reviewId,revokeCredentials:[],rotateKit:null,revokeConnections:['gh-a','cf-a']}));
  const s=rt.signIn({accountId:'acct-a',credentialId:'key-a1'});
  await refuses(()=>rt.useConnection(s,v({connectionId:'gh-a'})),'CONNECTION_DISABLED');
  assert.deepEqual(rt.connectionState('gh-a'),{access:'disabled',credentialHeld:true,revocation:'queued'});
  await refuses(()=>rt.eraseConnectionCredential('gh-a'),'RECONCILIATION_HOLD');
  assert.equal(revocations.length,0,'the commit itself calls no provider');
  rt.runRevocations();
  assert.deepEqual(rt.connectionState('gh-a'),{access:'disabled',credentialHeld:false,revocation:'revoked'});
  assert.equal(rt.eraseConnectionCredential('gh-a').erased,true);
 });
 await test('an unknown provider outcome keeps the hold and is never redispatched blindly',async()=>{
  const {rt,a,revocations}=setup({revokeOutcomes:{'gh-a':'unknown','cf-a':'throw'}});
  const r=review(rt,a);
  rt.commitCompromiseReview(a,v({requestId:req(),reviewId:r.reviewId,revokeCredentials:[],rotateKit:null,revokeConnections:['gh-a','cf-a']}));
  rt.runRevocations();rt.runRevocations();rt.advance(DAY);rt.runRevocations();
  assert.equal(revocations.length,2);
  for(const c of ['gh-a','cf-a']){
   assert.deepEqual(rt.connectionState(c),{access:'disabled',credentialHeld:true,revocation:'uncertain'});
   await refuses(()=>rt.eraseConnectionCredential(c),'RECONCILIATION_HOLD');
  }
  await refuses(()=>rt.reconcileRevocation({connectionId:'gh-a',evidence:{authenticated:false,result:'revoked'}}),'EVIDENCE_NOT_AUTHENTICATED');
  assert.equal(rt.reconcileRevocation({connectionId:'gh-a',evidence:{authenticated:true,result:'not-found'}}),'uncertain','not found is not proof');
  assert.equal(rt.reconcileRevocation({connectionId:'gh-a',evidence:{authenticated:true,result:'revoked'}}),'revoked');
  assert.equal(rt.connectionState('gh-a').credentialHeld,false);
  for(let i=0;i<m.bounds.reconcileReads;i++)rt.reconcileRevocation({connectionId:'cf-a',evidence:{authenticated:true,result:'not-found'}});
  assert.deepEqual(rt.connectionState('cf-a'),{access:'disabled',credentialHeld:true,revocation:'unresolved'});
  await refuses(()=>rt.eraseConnectionCredential('cf-a'),'RECONCILIATION_HOLD');
  assert.equal(revocations.length,2,'reconciliation never calls revoke');
  const {rt:r2,a:a2,revocations:k2}=setup({revokeOutcomes:{'gh-a':(()=>{let n=0;return ()=>++n===1?'not-revoked':'revoked';})()}});
  const rv=review(r2,a2);r2.commitCompromiseReview(a2,v({requestId:req(),reviewId:rv.reviewId,revokeCredentials:[],rotateKit:null,revokeConnections:['gh-a']}));
  r2.runRevocations();assert.equal(r2.connectionState('gh-a').revocation,'queued');r2.runRevocations();
  assert.deepEqual([k2.length,r2.connectionState('gh-a').revocation],[2,'revoked']);
 });
 await test('compromise review never fabricates encrypted-content recovery',async()=>{
  const {rt,a}=setup();
  const r=review(rt,a);assert.equal(r.accountRecoveryOnly,true);
  await refuses(()=>rt.commitCompromiseReview(a,v({requestId:req(),reviewId:r.reviewId,revokeCredentials:[],rotateKit:null,revokeConnections:[],recoverContent:true})),'UNKNOWN_FIELD');
  const receipt=rt.commitCompromiseReview(a,v({requestId:req(),reviewId:r.reviewId,revokeCredentials:[],rotateKit:null,revokeConnections:[]}));
  assert.ok(Object.keys(receipt).every(k=>!/content|decrypt|unlock|vault/i.test(k)));assert.equal(receipt.accountRecoveryOnly,true);
  assert.ok([...Object.keys(rt),...Object.keys(m)].every(k=>!/content|decrypt|unlock|vault/i.test(k)));
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
 });
 await test('data classes are planned, hash-only for tokens and never claim deployment',async()=>{
  const ids=m.dataClasses.map(c=>c.id);assert.equal(new Set(ids).size,ids.length);
  for(const c of m.dataClasses){for(const k of ['id','status','records','protection','secrets','retention','export','deletion'])assert.ok(c[k],`${c.id}.${k}`);}
  assert.ok(m.dataClasses.filter(c=>c.status==='planned').length>=4);
  assert.match(m.dataClasses.find(c=>c.id==='owner-email-changes').secrets,/SHA-256/);
  assert.match(m.dataClasses.find(c=>c.id==='platform-notifications').secrets,/never stored/);
 });
 await test('concurrent confirm, cancel and compromise transitions from one read commit exactly one outcome',async()=>{
  const {rt,a,change,tokenFor}=setup();
  const p=await change(a,'new-a@example.test');await rt.runDelivery();
  const verifier=await m.tokenVerifier(tokenFor('new-a@example.test'));
  const snap=rt.inspect(),before=snap.changes[p.changeId],acct=snap.accounts['acct-a'],now=rt.now();
  const principal={accountId:'acct-a',kind:'session',purpose:'workspace',authEpoch:acct.epoch,proof:{method:'passkey',verifiedAt:now}};
  const account={accountId:'acct-a',email:acct.email,verifiedAt:null,verifiedVia:null,authEpoch:acct.epoch,stage:'ready'};
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
 });
 return count;
}

// ---------- Mutation check: each deliberately broken copy of the source or reference must fail the suite ----------
const P='src/email-change/policy.ts',C='src/email-change/change.ts',T='src/email-change/token.ts',K='src/email-change/compromise.ts',R=referenceFile;
const mutants=[
 ['recovery accepts a pending address',R,"const a=address&&Object.values(s.accounts).find(x=>x.email===address);","const a=address&&Object.values(s.accounts).find(x=>x.email===address||Object.values(s.changes).some(c=>c.accountId===x.id&&c.state==='pending'&&c.newAddress===address));"],
 ['verified email waives the kit',R,"typeof input.key==='string'&&a.kitVerifier===sha256(input.key)","(a.emailVerifiedAt!==null||typeof input.key==='string'&&a.kitVerifier===sha256(input.key))"],
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
 ['compromise commit leaves sessions and sign-ins valid',R,"if(!active(a).length)a.stage='recovering';\n   a.epoch++;","if(!active(a).length)a.stage='recovering';"],
 ['in-flight sign-in survives an epoch change',R,"check(c.epoch===a.epoch,'IDENTITY_CHANGED');\n   check(a.credentials[credentialId]","check(true,'IDENTITY_CHANGED');\n   check(a.credentials[credentialId]"],
 ['stale compromise review accepted',R,"check(s.now<review.expiresAt&&review.epoch===a.epoch&&review.credentialRevision===a.credentialRevision&&canonical(review.connections)===canonical(connections),'STALE_REVIEW');",''],
 ['compromise commit replay re-applies',R,"const r=replayed(a.id,rid,['compromise',input.reviewId,revokeCredentials,rotate,revokeConnections]);if(r.prior)return r.prior;","const r=replayed(a.id,`${rid}:${s.seq}`,['compromise',input.reviewId,revokeCredentials,rotate,revokeConnections]);"],
 ['two-key minimum blocks emergency revocation',R,"for(const k of revokeCredentials)a.credentials[k].status='removed';","check(active(a).length-revokeCredentials.length>=2,'MIN_KEYS');for(const k of revokeCredentials)a.credentials[k].status='removed';"],
 ['old kit survives rotation',R,"if(offer){a.kitVerifier=offer.verifier;a.kitGeneration++;delete s.offers[offer.id];}","if(offer){a.kitGeneration++;delete s.offers[offer.id];}"],
 ['unsaved kit accepted',R,"&&rotate.saved===true,'KIT_NOT_SAVED'",",'KIT_NOT_SAVED'"],
 ['pending email change survives compromise review',K,"return moved(change,'cancelled','security-review');","return change;"],
 ['credential erased before provider revocation',R,"c.access='disabled';c.revocation={state:'queued',reads:0,since:null,receipt:null};","c.access='disabled';c.credential=null;c.revocation={state:'queued',reads:0,since:null,receipt:null};"],
 ['unknown revocation outcome redispatched',R,"else {c.revocation.state='uncertain';c.revocation.since=s.now;result.uncertain++;}","else {c.revocation.state='queued';result.uncertain++;}"],
 ['erasure without a revocation receipt',R,"check(c.revocation.state==='revoked'&&c.revocation.receipt,'RECONCILIATION_HOLD',c.revocation.state);",''],
 ['unauthenticated reconciliation evidence accepted',R,"check(evidence&&evidence.authenticated===true,'EVIDENCE_NOT_AUTHENTICATED');",''],
 ['compromise review fabricates content recovery',R,"sessionsRevoked:'all',accountRecoveryOnly:true});","sessionsRevoked:'all',accountRecoveryOnly:true,contentRecovery:'restored'});"],
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
};

// The main suite runs the unmodified source, including src/security.ts hashToken on WebCrypto. Mutant runs replace only
// that SHA-256 hex primitive with node:crypto (Node's WebCrypto digest dominated the run time); the static checks below
// prove both produce the same digests. After the main bundle, every other esbuild job (the Worker import graph and one
// bundle per source mutant) starts at once and runs in esbuild's own process while the suites run here.
const fastHash={'src/security.ts':"import {createHash} from 'node:crypto';export async function hashToken(token:string){return createHash('sha256').update(token,'utf8').digest('hex');}"};
const settle=promise=>promise.then(value=>({value}),error=>({error}));
const unwrap=async promise=>{const r=await promise;if(r.error)throw r.error;return r.value;};
const referenceText=read(referenceFile);
const source=await importText(await bundleSource());
const fastSourceBuild=settle(bundleSource(fastHash));
const graphBuild=settle(graph());
const prepared=mutants.map(([name,file,find,replace])=>{
 const text=file===R?referenceText:read(file);
 assert.equal(text.split(find).length,2,`mutant "${name}" must match ${file} exactly once`);
 const mutated=text.replace(find,()=>replace);
 return {mutated,bundle:file===R?null:settle(bundleSource({...fastHash,[file]:mutated}))};
});
const reference=await import(new URL(`../${referenceFile}`,import.meta.url));
const suiteCount=await suite(compose(source,reference));
let total=suiteCount;
const checkOnce=async(name,fn)=>{try{await fn();total++;}catch(error){throw new Error(name,{cause:error});}};

// ---------- Read-only agreement with the current identity source ----------
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
// G-E1 is closed in the source module (verification time and sender, previous-state undo) but stays open in the schema:
// WH-201 adds the columns and tables and must update this pin and the module-isolation assertions together.
await checkOnce('the stored account email still has no verification state and no edit path outside the unwired module (gap G-E1 in schema)',()=>{
 const users=read('src/workspace-identity/canonical-inputs.sql').match(/CREATE TABLE users \(([^;]*)\) STRICT;/)[1];
 assert.match(users,/email TEXT NOT NULL UNIQUE/);assert.ok(!/verif/i.test(users));
 assert.ok(!/email_change/i.test(read('src/workspace-identity/canonical-inputs.sql')+read('src/workspace-identity/schema.sql')));
 const profile=read('src/profile.ts');
 const allow=profile.match(/keys\.some\(k=>!\[([^\]]*)\]\.includes\(k\)\)/)[1];assert.ok(!allow.includes('email'));
 assert.match(profile,/SELECT name,about_me FROM user_profiles WHERE user_id=\? AND share_context=1/);
 assert.deepEqual(Object.keys(source.emailChangeBounds).filter(k=>/Ms$/.test(k)).sort(),['failureWindowMs','freshPasskeyMs','limitWindowMs','tokenLifetimeMs','undoWindowMs']);
 assert.deepEqual([source.emailChangeBounds.tokenLifetimeMs,source.emailChangeBounds.undoWindowMs],[HOUR,7*DAY],'decisions 1 and 2: recommended values');
});
await checkOnce('the inactive support notice would address the unverified account email (gap G-E5)',()=>{
 assert.match(read('src/support-delivery.ts'),/recipient:row\.email/);
});
await checkOnce('the source module and the reference are pure, and no Worker entry reaches the module',async()=>{
 const allowed=new Set(['../security','./policy','./change']);
 const specifiersOf=text=>[...text.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g)].map(x=>x[1]??x[2]);
 const effectful=/\bfetch\s*\(|XMLHttpRequest|WebSocket|process\.env|D1Database|\.prepare\(|\benv\.[A-Z_]+|console\./;
 for(const file of moduleFiles){
  const text=read(file);
  assert.ok(specifiersOf(text).every(s=>allowed.has(s)),`${file} imports ${specifiersOf(text)}`);
  assert.ok(!effectful.test(text),file);
 }
 assert.deepEqual(specifiersOf(read('src/security.ts')),[]);
 assert.deepEqual(specifiersOf(referenceText),['node:crypto']);
 assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|process\.env/.test(referenceText));
 // Walk every runtime import edge esbuild resolved (before tree shaking, so an unused import still counts). Packages stay
 // external (src/runtime/worker.ts imports only QuickJS packages); every src/ module is followed.
 const {inputs}=(await unwrap(graphBuild)).metafile;
 for(const worker of workers){
  const reached=new Set([worker]);
  for(const path of reached)for(const edge of inputs[path]?.imports??[])if(!edge.external&&Object.hasOwn(inputs,edge.path))reached.add(edge.path);
  assert.ok(Object.hasOwn(inputs,worker)&&(worker!=='src/index.ts'||reached.size>100),`${worker}: ${reached.size} modules`);
  assert.deepEqual([...reached].filter(p=>/email-change/.test(p)),[],`${worker} reaches the email-change module`);
 }
 assert.ok(Object.keys(inputs).every(p=>!/email-change/.test(p)),'no Worker entry parses the email-change module');
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
let killed=0,sourceKilled=0;
for(const [index,[name,file]] of mutants.entries()){
 const {mutated,bundle}=prepared[index];
 const m=file===R?compose(fastSource,await importText(mutated)):compose(await importText(await unwrap(bundle)),reference);
 await assert.rejects(suite(m),e=>{
  if(process.argv.includes('--explain'))console.log(`${name} (${file}) => ${e.message} [${e.cause?.name}: ${String(e.cause?.message).split('\n')[0]}]`);
  assert.ok(killedBy[name]&&e.message.startsWith(killedBy[name]),`mutant "${name}" was caught by an unexpected check: ${e.message}${e.cause?` (${e.cause.message})`:''}`);return true;
 },`mutant survived: ${name}`);killed++;if(file!==R)sourceKilled++;
}
assert.equal(killed,mutants.length);
console.log(`email-change-contract: ${suiteCount} checks and ${total-suiteCount} source-agreement/static checks passed against src/email-change and the WH-203 reference; ${killed}/${mutants.length} mutants caught (${sourceKilled} in src/email-change, ${killed-sourceKilled} in ${referenceFile}; synthetic accounts, mailer and provider; no database, network, credential or model).`);
