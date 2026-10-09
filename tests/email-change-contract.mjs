import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

// WH-063 / WH-199 offline conformance harness for verified email changes and compromise response. Synthetic accounts,
// addresses (example.test), kit keys, mailer and provider revoker only: no database, network, credential, model or
// provider account. It proves the frozen contract and the reference runtime, plus a few read-only agreements with the
// current identity source. It does not prove D1 atomicity or real delivery; WH-200/201/204 must run equivalent checks
// against their handlers. Every suite check also runs against deliberately broken copies of the reference (mutants).
const prototypeURL=new URL('../tools/prototypes/email-change.mjs',import.meta.url);
const prototypeSource=readFileSync(prototypeURL,'utf8');
const read=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8');
const KIT='SYNTHETIC-KIT-0001',KIT_B='SYNTHETIC-KIT-0002';
const MIN=60e3,HOUR=60*MIN,DAY=24*HOUR;
let rid=0;const req=()=>`req-${String(++rid).padStart(8,'0')}`;

async function suite(m){
 let count=0;
 const test=async(name,fn)=>{try{await fn();count++;}catch(error){throw new Error(name,{cause:error});}};
 const throws=(fn,code)=>assert.throws(fn,e=>{assert.equal(e.code,code,e.message);return true;});
 function setup({mail=true,outcomes={},revokeOutcomes={}}={}){
  const inbox=[],calls=[],revocations=[];
  const mailer=mail?message=>{calls.push(message);const o=outcomes[message.kind];const r=typeof o==='function'?o(message):o??'accepted';if(r==='accepted'||r==='unknown')inbox.push(message);if(r==='throw')throw new Error('synthetic transport loss');return r;}:null;
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
 await test('confirmation token is single use, stored only as a hash and bound to the requesting account',()=>{
  const {rt,a,b,change,tokenFor}=setup();
  change(a,'new-a@example.test');rt.runDelivery();
  const token=tokenFor('new-a@example.test');assert.ok(typeof token==='string'&&token.length>=43);
  const stored=JSON.stringify(rt.inspect());
  assert.ok(!stored.includes(token),'plaintext token stored');assert.ok(stored.includes(m.sha256(token)));
  throws(()=>rt.confirmEmailChange(null,v({token})),'AUTH_REQUIRED');
  throws(()=>rt.confirmEmailChange(b,v({token})),'INVALID_TOKEN');
  assert.equal(rt.readAccountEmail(a).email,'owner-a@example.test');
  const receipt=rt.confirmEmailChange(a,v({token}));
  assert.deepEqual([receipt.status,receipt.email],['confirmed','new-a@example.test']);
  assert.deepEqual(rt.readAccountEmail(a),{email:'new-a@example.test',verified:true,pending:null});
  assert.ok(!JSON.stringify(rt.inspect()).includes(token));
 });

 // ---------- current identifier is never a factor ----------
 await test('an unverified or pending email never becomes a recovery or authorization factor',()=>{
  const {rt,a,change}=setup();
  throws(()=>rt.startRecovery(v({email:'owner-a@example.test',key:'SYNTHETIC-WRONG-0000'})),'RECOVERY_PROOF');
  throws(()=>rt.startRecovery(v({email:'owner-a@example.test'})),'RECOVERY_PROOF');
  change(a,'new-a@example.test');rt.runDelivery();
  throws(()=>rt.startRecovery(v({email:'new-a@example.test',key:KIT})),'RECOVERY_PROOF');
  const g=rt.startRecovery(v({email:'OWNER-A@example.test ',key:KIT}));
  assert.equal(g.kind,'grant');assert.equal(rt.identityState(g).authority,'recovery');
  // A verified address changes nothing about recovery: the current kit is still the proof.
  const {rt:rt2,a:a2,change:change2,tokenFor:t2}=setup();change2(a2,'verified-a@example.test');rt2.runDelivery();
  rt2.confirmEmailChange(a2,v({token:t2('verified-a@example.test')}));assert.equal(rt2.readAccountEmail(a2).verified,true);
  throws(()=>rt2.startRecovery(v({email:'verified-a@example.test',key:'SYNTHETIC-WRONG-0000'})),'RECOVERY_PROOF');
  throws(()=>rt2.startRecovery(v({email:'owner-a@example.test',key:KIT})),'RECOVERY_PROOF');
  assert.equal(rt2.startRecovery(v({email:'verified-a@example.test',key:KIT})).kind,'grant');
  // No operation turns an email, link or verification state into a session.
  assert.ok(Object.keys(rt).every(k=>!/magic|link|emailLogin|signInWithEmail|reset/i.test(k)));
 });
 await test('unknown versions, unknown fields and retired password authority are refused',()=>{
  const {rt,a}=setup();
  for(const version of [0,2,'1',undefined])throws(()=>rt.requestEmailChange(a,{version,requestId:req(),newAddress:'x@example.test'}),'UNSUPPORTED_VERSION');
  throws(()=>rt.startRecovery({version:2,email:'owner-a@example.test',key:KIT}),'UNSUPPORTED_VERSION');
  throws(()=>rt.prepareCompromiseReview(a,{version:0}),'UNSUPPORTED_VERSION');
  throws(()=>rt.requestEmailChange(a,v({requestId:req(),newAddress:'x@example.test',sender:'ceo@example.test'})),'UNKNOWN_FIELD');
  throws(()=>rt.requestEmailChange(a,v({requestId:req(),newAddress:'x@example.test',connectionId:'gh-a'})),'UNKNOWN_FIELD');
  for(const field of m.retiredAuthorityFields)throws(()=>rt.requestEmailChange(a,v({requestId:req(),newAddress:'x@example.test',[field]:'SYNTHETIC-SECRET-0000'})),'RETIRED_AUTHORITY');
  throws(()=>rt.startRecovery(v({email:'owner-a@example.test',password:'SYNTHETIC-SECRET-0000'})),'RETIRED_AUTHORITY');
  throws(()=>rt.requestEmailChange(a,v({requestId:req(),newAddress:'Owner <x@example.test>'})),'INVALID_ADDRESS');
 });
 await test('an address change requires a fresh passkey on a current ordinary session',()=>{
  const {rt,a,change}=setup();
  throws(()=>rt.requestEmailChange(null,v({requestId:req(),newAddress:'x@example.test'})),'AUTH_REQUIRED');
  rt.advance(11*MIN);
  throws(()=>change(a,'x@example.test'),'PROOF_REQUIRED');
  const fresh=rt.signIn({accountId:'acct-a',credentialId:'key-a2'});
  assert.equal(change(fresh,'x@example.test').status,'pending-confirmation');
  throws(()=>change(fresh,'owner-a@example.test'),'NO_CHANGE');
 });
 await test('recovery secrets grant only restricted enrollment authority',()=>{
  const {rt}=setup();
  const g=rt.startRecovery(v({email:'owner-a@example.test',key:KIT}));
  assert.equal(g.kind,'grant');
  throws(()=>rt.requestEmailChange(g,v({requestId:req(),newAddress:'x@example.test'})),'IDENTITY_INCOMPLETE');
  throws(()=>rt.readAccountEmail(g),'IDENTITY_INCOMPLETE');
  throws(()=>rt.prepareCompromiseReview(g,v()),'IDENTITY_INCOMPLETE');
  throws(()=>rt.useConnection(g,v({connectionId:'gh-a'})),'IDENTITY_INCOMPLETE');
  throws(()=>rt.confirmEmailChange(g,v({token:'SYNTHETIC-TOKEN-0000'})),'IDENTITY_INCOMPLETE');
  assert.deepEqual(rt.identityState(g).allowedNext,['review_loss','add_passkey','kit','help','logout']);
 });

 // ---------- delivery and the old-address notice ----------
 await test('delivery unavailable stores nothing; the old address is notified without the token or new address',()=>{
  const {rt:off,a:offA}=setup({mail:false});const before=JSON.stringify(off.inspect().changes);
  throws(()=>off.requestEmailChange(offA,v({requestId:req(),newAddress:'x@example.test'})),'DELIVERY_UNAVAILABLE');
  assert.equal(JSON.stringify(off.inspect().changes),before);assert.equal(off.inspect().outbox.length,0);
  const {rt,a,calls,change}=setup();change(a,'new-a@example.test');rt.runDelivery();
  const old=calls.filter(x=>x.to==='owner-a@example.test');
  assert.equal(old.length,1);assert.equal(old[0].kind,'change-requested');
  assert.ok(!('token' in old[0])&&!JSON.stringify(old[0]).includes('new-a@example.test'));
  const fresh=calls.find(x=>x.to==='new-a@example.test');
  assert.equal(fresh.kind,'confirm-new-address');assert.ok(!JSON.stringify(fresh).includes('owner-a@example.test'));
  assert.ok(calls.every(x=>x.from===m.platformSender.address&&x.displayName==='Whumpo'));
 });
 await test('a confirmation token is single use: replay returns the saved receipt without a second effect',()=>{
  const {rt,a,change,tokenFor,calls}=setup();
  change(a,'new-a@example.test');rt.runDelivery();const token=tokenFor('new-a@example.test');
  const first=rt.confirmEmailChange(a,v({token}));rt.runDelivery();
  const second=rt.confirmEmailChange(a,v({token}));rt.runDelivery();
  assert.deepEqual(second,first);
  assert.equal(calls.filter(x=>x.kind==='change-completed').length,1);
  assert.equal(calls.find(x=>x.kind==='change-completed').to,'owner-a@example.test');
  rt.undoEmailChange(a,v({changeId:first.changeId}));
  throws(()=>rt.confirmEmailChange(a,v({token})),'CHANGE_CLOSED');
  assert.equal(rt.readAccountEmail(a).email,'owner-a@example.test');
 });
 await test('an expired confirmation token is refused',()=>{
  const {rt,a,change,tokenFor}=setup();
  change(a,'new-a@example.test');rt.runDelivery();const token=tokenFor('new-a@example.test');
  rt.advance(m.bounds.tokenLifetimeMs);
  throws(()=>rt.confirmEmailChange(a,v({token})),'TOKEN_EXPIRED');
  throws(()=>rt.confirmEmailChange(a,v({token})),'CHANGE_CLOSED');
  assert.equal(rt.readAccountEmail(a).email,'owner-a@example.test');
 });
 await test('a competing later change supersedes the earlier one; its token is refused as stale',()=>{
  const {rt,a,change,tokenFor,calls}=setup();
  change(a,'first-a@example.test');rt.runDelivery();const first=tokenFor('first-a@example.test');
  change(a,'second-a@example.test');rt.runDelivery();const second=tokenFor('second-a@example.test');
  throws(()=>rt.confirmEmailChange(a,v({token:first})),'STALE_CHANGE');
  assert.equal(rt.confirmEmailChange(a,v({token:second})).email,'second-a@example.test');
  // An undelivered earlier message is cancelled, never sent after it was superseded.
  const {rt:rt2,a:a2,change:c2,calls:k2}=setup();c2(a2,'one-a@example.test');c2(a2,'two-a@example.test');rt2.runDelivery();
  assert.deepEqual(k2.filter(x=>x.kind==='confirm-new-address').map(x=>x.to),['two-a@example.test']);
  assert.ok(calls.length>0);
 });
 await test('an authority change after the request makes the pending change stale',()=>{
  const {rt,a,change,tokenFor}=setup();
  change(a,'new-a@example.test');rt.runDelivery();const token=tokenFor('new-a@example.test');
  rt.removePasskey(a,v({credentialId:'key-a2'}));
  throws(()=>rt.confirmEmailChange(a,v({token})),'IDENTITY_CHANGED');
  const again=rt.signIn({accountId:'acct-a',credentialId:'key-a1'});
  throws(()=>rt.confirmEmailChange(again,v({token})),'STALE_CHANGE');
  assert.equal(rt.readAccountEmail(again).email,'owner-a@example.test');
 });
 await test('a lost request or confirmation response is retried idempotently',()=>{
  const {rt,a,tokenFor,calls}=setup();
  const id=req(),first=rt.requestEmailChange(a,v({requestId:id,newAddress:'new-a@example.test'}));
  assert.deepEqual(rt.requestEmailChange(a,v({requestId:id,newAddress:'NEW-A@example.test'})),first);
  throws(()=>rt.requestEmailChange(a,v({requestId:id,newAddress:'other-a@example.test'})),'REQUEST_CONFLICT');
  rt.runDelivery();
  assert.equal(calls.filter(x=>x.kind==='confirm-new-address').length,1);
  assert.equal(calls.filter(x=>x.kind==='change-requested').length,1);
  const token=tokenFor('new-a@example.test');
  assert.deepEqual(rt.confirmEmailChange(a,v({token})),rt.confirmEmailChange(a,v({token})));
 });
 await test('the response never reveals whether another account uses the address',()=>{
  const {rt,a,calls,change}=setup();
  const taken=change(a,'owner-b@example.test'),stateTaken=rt.readAccountEmail(a);
  const {rt:rt2,a:a2,change:c2}=setup();
  const free=c2(a2,'free-a@example.test'),stateFree=rt2.readAccountEmail(a2);
  assert.deepEqual(Object.keys(taken),Object.keys(free));assert.equal(taken.status,free.status);assert.equal(taken.expiresAt,free.expiresAt);
  assert.deepEqual(Object.keys(stateTaken.pending),Object.keys(stateFree.pending));assert.equal(stateTaken.verified,stateFree.verified);
  rt.runDelivery();
  assert.ok(!calls.some(x=>x.to==='owner-b@example.test'),'no message to an address another account uses');
  assert.ok(calls.some(x=>x.kind==='change-requested'&&x.to==='owner-a@example.test'));
  // Confirmation re-checks uniqueness at commit: an address taken in between is refused only to the token holder.
  const {rt:rt3,a:a3,b:b3,change:c3,inbox:in3}=setup();
  c3(a3,'contested@example.test');rt3.runDelivery();
  c3(b3,'contested@example.test');rt3.runDelivery();
  const [tokA,tokB]=in3.filter(x=>x.to==='contested@example.test').map(x=>x.token);
  assert.equal(rt3.confirmEmailChange(b3,v({token:tokB})).email,'contested@example.test');
  throws(()=>rt3.confirmEmailChange(a3,v({token:tokA})),'ADDRESS_UNAVAILABLE');
  assert.equal(rt3.readAccountEmail(a3).email,'owner-a@example.test');
 });
 await test('rate limits bound requests per account, messages per address and confirmation guesses',()=>{
  const {rt,a,b,change}=setup();
  for(let i=0;i<m.bounds.requestsPerAccountPerDay;i++)change(a,`n${i}-a@example.test`);
  throws(()=>change(a,'n9-a@example.test'),'RATE_LIMITED');
  rt.advance(DAY);
  const later=rt.signIn({accountId:'acct-a',credentialId:'key-a1'});
  assert.equal(change(later,'later-a@example.test').status,'pending-confirmation');
  // Several accounts aiming at one address: the address receives a bounded number of messages, and every
  // requester sees the same pending response.
  const {rt:r2}=setup(),responses=[];
  for(const x of ['c','d','e','f']){
   r2.addAccount({accountId:`acct-${x}`,email:`owner-${x}@example.test`,credentials:[`key-${x}1`],kitKey:`SYNTHETIC-KIT-000${x.charCodeAt(0)-96}`});
   const s=r2.signIn({accountId:`acct-${x}`,credentialId:`key-${x}1`});
   responses.push(r2.requestEmailChange(s,v({requestId:req(),newAddress:'target@example.test'})));
  }
  r2.runDelivery();
  assert.equal(r2.outboxStates().filter(x=>x.kind==='confirm-new-address').length,m.bounds.messagesPerAddressPerDay);
  assert.ok(responses.every(x=>x.status==='pending-confirmation'));
  for(let i=0;i<m.bounds.confirmFailuresPerHour;i++)throws(()=>rt.confirmEmailChange(b,v({token:`SYNTHETIC-TOKEN-000${i}`})),'INVALID_TOKEN');
  throws(()=>rt.confirmEmailChange(b,v({token:'SYNTHETIC-TOKEN-0009'})),'RATE_LIMITED');
 });
 await test('a lost provider response is never redispatched and undeliverable addresses stop the change',()=>{
  const {rt,a,change,calls,tokenFor}=setup({outcomes:{'confirm-new-address':'unknown'}});
  change(a,'new-a@example.test');rt.runDelivery();rt.runDelivery();rt.advance(HOUR/2);rt.runDelivery();
  assert.equal(calls.filter(x=>x.kind==='confirm-new-address').length,1);
  assert.equal(rt.outboxStates().find(x=>x.kind==='confirm-new-address').state,'unknown-outcome');
  assert.equal(rt.confirmEmailChange(a,v({token:tokenFor('new-a@example.test')})).status,'confirmed','a possibly delivered token stays usable');
  const {rt:r2,a:a2,change:c2,calls:k2}=setup({outcomes:{'confirm-new-address':'throw'}});
  c2(a2,'new-a@example.test');r2.runDelivery();r2.runDelivery();
  assert.equal(k2.filter(x=>x.kind==='confirm-new-address').length,1);
  const {rt:r3,a:a3,change:c3,calls:k3}=setup({outcomes:{'confirm-new-address':'rejected'}});
  c3(a3,'bad-a@example.test');r3.runDelivery();r3.runDelivery();
  assert.equal(k3.filter(x=>x.kind==='confirm-new-address').length,1);
  assert.equal(JSON.stringify(r3.inspect().changes).includes('"tokenHash":null'),true);
  const {rt:r4,a:a4,change:c4,calls:k4}=setup({outcomes:{'confirm-new-address':(()=>{let n=0;return ()=>++n===1?'deferred':'accepted';})()}});
  c4(a4,'slow-a@example.test');r4.runDelivery();r4.runDelivery();
  const sent=k4.filter(x=>x.kind==='confirm-new-address');assert.equal(sent.length,2);
  throws(()=>r4.confirmEmailChange(a4,v({token:sent[0].token})),'INVALID_TOKEN');
  assert.equal(r4.confirmEmailChange(a4,v({token:sent[1].token})).status,'confirmed');
  // An old-address notice failure never blocks or reverses the change.
  const {rt:r5,a:a5,change:c5,tokenFor:t5}=setup({outcomes:{'change-requested':'suppressed','change-completed':'unknown'}});
  c5(a5,'new-a@example.test');r5.runDelivery();assert.equal(r5.confirmEmailChange(a5,v({token:t5('new-a@example.test')})).status,'confirmed');
 });
 await test('cancel before confirmation and undo inside the window; neither revives a closed change',()=>{
  const {rt,a,change,tokenFor}=setup();
  const p=change(a,'new-a@example.test');rt.runDelivery();const token=tokenFor('new-a@example.test');
  assert.equal(rt.cancelEmailChange(a,v({changeId:p.changeId})).status,'cancelled');
  assert.equal(rt.cancelEmailChange(a,v({changeId:p.changeId})).status,'cancelled');
  throws(()=>rt.confirmEmailChange(a,v({token})),'CHANGE_CLOSED');
  const q=change(a,'next-a@example.test');rt.runDelivery();rt.confirmEmailChange(a,v({token:tokenFor('next-a@example.test')}));
  throws(()=>rt.cancelEmailChange(a,v({changeId:q.changeId})),'CHANGE_CLOSED');
  rt.advance(m.bounds.undoWindowMs);
  const fresh=rt.signIn({accountId:'acct-a',credentialId:'key-a1'});
  throws(()=>rt.undoEmailChange(fresh,v({changeId:q.changeId})),'UNDO_UNAVAILABLE');
  const {rt:r2,a:a2,b:b2,change:c2,tokenFor:t2}=setup();
  const w=c2(a2,'new-a@example.test');r2.runDelivery();r2.confirmEmailChange(a2,v({token:t2('new-a@example.test')}));
  // While the undo window is open the previous address stays reserved for this account.
  c2(b2,'owner-a@example.test');r2.runDelivery();assert.equal(t2('owner-a@example.test'),undefined);
  throws(()=>r2.undoEmailChange(b2,v({changeId:w.changeId})),'UNKNOWN_CHANGE');
  r2.advance(11*MIN);throws(()=>r2.undoEmailChange(a2,v({changeId:w.changeId})),'PROOF_REQUIRED');
  const f2=r2.signIn({accountId:'acct-a',credentialId:'key-a2'});
  assert.deepEqual(r2.undoEmailChange(f2,v({changeId:w.changeId})),{changeId:w.changeId,status:'undone',email:'owner-a@example.test'});
  assert.equal(r2.readAccountEmail(f2).verified,false,'undo restores the previous verification state, it does not invent one');
 });

 // ---------- compromise response ----------
 const review=(rt,auth)=>rt.prepareCompromiseReview(auth,v());
 await test('emergency revocation is allowed below the two-key count, down to zero',()=>{
  const {rt,a}=setup();
  const r=review(rt,a);
  const one=rt.commitCompromiseReview(a,v({requestId:req(),reviewId:r.reviewId,revokeCredentials:['key-a2'],rotateKit:null,revokeConnections:[]}));
  assert.equal(one.stage,'ready');
  const s=rt.signIn({accountId:'acct-a',credentialId:'key-a1'}),r2=review(rt,s);
  const zero=rt.commitCompromiseReview(s,v({requestId:req(),reviewId:r2.reviewId,revokeCredentials:['key-a1'],rotateKit:null,revokeConnections:[]}));
  assert.equal(zero.stage,'recovering');
  throws(()=>rt.signIn({accountId:'acct-a',credentialId:'key-a1'}),'PROOF_REQUIRED');
  const g=rt.startRecovery(v({email:'owner-a@example.test',key:KIT}));
  assert.equal(rt.identityState(g).stage,'recovering');
  const {rt:r3,a:a3}=setup();assert.equal(r3.removePasskey(a3,v({credentialId:'key-a1'})).activePasskeys,1);
 });
 await test('compromise review revokes every session and in-flight sign-in; concurrent sign-in cannot restore authority',()=>{
  const {rt,a}=setup();
  const other=rt.signIn({accountId:'acct-a',credentialId:'key-a2'});
  const inflightRevoked=rt.beginSignIn({accountId:'acct-a'}),inflightRetained=rt.beginSignIn({accountId:'acct-a'});
  const r=review(rt,a);
  const receipt=rt.commitCompromiseReview(a,v({requestId:req(),reviewId:r.reviewId,revokeCredentials:['key-a2'],rotateKit:null,revokeConnections:[]}));
  assert.equal(receipt.sessionsRevoked,'all');
  throws(()=>rt.readAccountEmail(a),'IDENTITY_CHANGED');throws(()=>rt.readAccountEmail(other),'IDENTITY_CHANGED');
  throws(()=>rt.finishSignIn({challengeId:inflightRevoked,credentialId:'key-a2'}),'IDENTITY_CHANGED');
  throws(()=>rt.finishSignIn({challengeId:inflightRetained,credentialId:'key-a1'}),'IDENTITY_CHANGED');
  throws(()=>rt.signIn({accountId:'acct-a',credentialId:'key-a2'}),'PROOF_REQUIRED');
  const back=rt.signIn({accountId:'acct-a',credentialId:'key-a1'});
  assert.equal(rt.readAccountEmail(back).email,'owner-a@example.test');
 });
 await test('a stale compromise review is refused and a lost commit response is idempotent',()=>{
  const {rt,a}=setup();
  const r=review(rt,a);rt.removePasskey(a,v({credentialId:'key-a2'}));
  const fresh=rt.signIn({accountId:'acct-a',credentialId:'key-a1'});
  throws(()=>rt.commitCompromiseReview(fresh,v({requestId:req(),reviewId:r.reviewId,revokeCredentials:[],rotateKit:null,revokeConnections:[]})),'STALE_REVIEW');
  const r2=review(rt,fresh),id=req();
  const body=v({requestId:id,reviewId:r2.reviewId,revokeCredentials:[],rotateKit:null,revokeConnections:['gh-a']});
  const first=rt.commitCompromiseReview(fresh,body);
  const epoch=first.epoch;
  // The original session is fenced, so a retry comes from a new sign-in and reads the same receipt.
  const retry=rt.signIn({accountId:'acct-a',credentialId:'key-a1'});
  assert.deepEqual(rt.commitCompromiseReview(retry,body),first);
  assert.equal(rt.inspect().accounts['acct-a'].epoch,epoch);
  throws(()=>rt.commitCompromiseReview(retry,{...body,revokeConnections:['cf-a']}),'REQUEST_CONFLICT');
  const r3=review(rt,retry);rt.advance(m.bounds.reviewMs);const late=rt.signIn({accountId:'acct-a',credentialId:'key-a1'});
  throws(()=>rt.commitCompromiseReview(late,v({requestId:req(),reviewId:r3.reviewId,revokeCredentials:[],rotateKit:null,revokeConnections:[]})),'STALE_REVIEW');
 });
 await test('kit rotation in the review retires the old kit and requires a saved replacement',()=>{
  const {rt,a}=setup();
  const r=review(rt,a),offer=rt.prepareKit(a,v({reviewId:r.reviewId}));
  throws(()=>rt.commitCompromiseReview(a,v({requestId:req(),reviewId:r.reviewId,revokeCredentials:[],rotateKit:{offerId:offer.offerId,saved:false},revokeConnections:[]})),'KIT_NOT_SAVED');
  const receipt=rt.commitCompromiseReview(a,v({requestId:req(),reviewId:r.reviewId,revokeCredentials:[],rotateKit:{offerId:offer.offerId,saved:true},revokeConnections:[]}));
  assert.equal(receipt.kitRotated,true);
  throws(()=>rt.startRecovery(v({email:'owner-a@example.test',key:KIT})),'RECOVERY_PROOF');
  assert.equal(rt.startRecovery(v({email:'owner-a@example.test',key:offer.key})).kind,'grant');
  assert.ok(!JSON.stringify(rt.inspect()).includes(offer.key));
 });
 await test('compromise review cancels a pending email change',()=>{
  const {rt,a,change,tokenFor}=setup();
  change(a,'attacker@example.test');rt.runDelivery();const token=tokenFor('attacker@example.test');
  const r=review(rt,a);assert.equal(r.pendingEmailChange,true);
  rt.commitCompromiseReview(a,v({requestId:req(),reviewId:r.reviewId,revokeCredentials:[],rotateKit:null,revokeConnections:[]}));
  const s=rt.signIn({accountId:'acct-a',credentialId:'key-a1'});
  throws(()=>rt.confirmEmailChange(s,v({token})),'CHANGE_CLOSED');
  assert.equal(rt.readAccountEmail(s).email,'owner-a@example.test');
 });
 await test('provider revocation keeps reconciliation authority until a definitive receipt',()=>{
  const {rt,a,revocations}=setup();
  const r=review(rt,a);
  rt.commitCompromiseReview(a,v({requestId:req(),reviewId:r.reviewId,revokeCredentials:[],rotateKit:null,revokeConnections:['gh-a','cf-a']}));
  const s=rt.signIn({accountId:'acct-a',credentialId:'key-a1'});
  throws(()=>rt.useConnection(s,v({connectionId:'gh-a'})),'CONNECTION_DISABLED');
  assert.deepEqual(rt.connectionState('gh-a'),{access:'disabled',credentialHeld:true,revocation:'queued'});
  throws(()=>rt.eraseConnectionCredential('gh-a'),'RECONCILIATION_HOLD');
  assert.equal(revocations.length,0,'the commit itself calls no provider');
  rt.runRevocations();
  assert.deepEqual(rt.connectionState('gh-a'),{access:'disabled',credentialHeld:false,revocation:'revoked'});
  assert.equal(rt.eraseConnectionCredential('gh-a').erased,true);
 });
 await test('an unknown provider outcome keeps the hold and is never redispatched blindly',()=>{
  const {rt,a,revocations}=setup({revokeOutcomes:{'gh-a':'unknown','cf-a':'throw'}});
  const r=review(rt,a);
  rt.commitCompromiseReview(a,v({requestId:req(),reviewId:r.reviewId,revokeCredentials:[],rotateKit:null,revokeConnections:['gh-a','cf-a']}));
  rt.runRevocations();rt.runRevocations();rt.advance(DAY);rt.runRevocations();
  assert.equal(revocations.length,2);
  for(const c of ['gh-a','cf-a']){
   assert.deepEqual(rt.connectionState(c),{access:'disabled',credentialHeld:true,revocation:'uncertain'});
   throws(()=>rt.eraseConnectionCredential(c),'RECONCILIATION_HOLD');
  }
  throws(()=>rt.reconcileRevocation({connectionId:'gh-a',evidence:{authenticated:false,result:'revoked'}}),'EVIDENCE_NOT_AUTHENTICATED');
  assert.equal(rt.reconcileRevocation({connectionId:'gh-a',evidence:{authenticated:true,result:'not-found'}}),'uncertain','not found is not proof');
  assert.equal(rt.reconcileRevocation({connectionId:'gh-a',evidence:{authenticated:true,result:'revoked'}}),'revoked');
  assert.equal(rt.connectionState('gh-a').credentialHeld,false);
  for(let i=0;i<m.bounds.reconcileReads;i++)rt.reconcileRevocation({connectionId:'cf-a',evidence:{authenticated:true,result:'not-found'}});
  assert.deepEqual(rt.connectionState('cf-a'),{access:'disabled',credentialHeld:true,revocation:'unresolved'});
  throws(()=>rt.eraseConnectionCredential('cf-a'),'RECONCILIATION_HOLD');
  assert.equal(revocations.length,2,'reconciliation never calls revoke');
  const {rt:r2,a:a2,revocations:k2}=setup({revokeOutcomes:{'gh-a':(()=>{let n=0;return ()=>++n===1?'not-revoked':'revoked';})()}});
  const rv=review(r2,a2);r2.commitCompromiseReview(a2,v({requestId:req(),reviewId:rv.reviewId,revokeCredentials:[],rotateKit:null,revokeConnections:['gh-a']}));
  r2.runRevocations();assert.equal(r2.connectionState('gh-a').revocation,'queued');r2.runRevocations();
  assert.deepEqual([k2.length,r2.connectionState('gh-a').revocation],[2,'revoked']);
 });
 await test('compromise review never fabricates encrypted-content recovery',()=>{
  const {rt,a}=setup();
  const r=review(rt,a);assert.equal(r.accountRecoveryOnly,true);
  throws(()=>rt.commitCompromiseReview(a,v({requestId:req(),reviewId:r.reviewId,revokeCredentials:[],rotateKit:null,revokeConnections:[],recoverContent:true})),'UNKNOWN_FIELD');
  const receipt=rt.commitCompromiseReview(a,v({requestId:req(),reviewId:r.reviewId,revokeCredentials:[],rotateKit:null,revokeConnections:[]}));
  assert.ok(Object.keys(receipt).every(k=>!/content|decrypt|unlock|vault/i.test(k)));assert.equal(receipt.accountRecoveryOnly,true);
  assert.ok(Object.keys(rt).every(k=>!/content|decrypt|unlock|vault/i.test(k)));
 });
 await test('no model, Chat or customer-mailbox capability; one platform sender',()=>{
  const {rt,a,change,calls}=setup();
  assert.ok(Object.keys(rt).every(k=>!/model|agent|infer|prompt|chat|oauthMail|mailbox/i.test(k)));
  change(a,'new-a@example.test');rt.runDelivery();
  assert.ok(calls.length>0&&calls.every(x=>x.from==='notify@whumpo.com'&&Object.keys(x).every(k=>['from','displayName','to','kind','noticeId','token'].includes(k))));
  assert.ok(calls.every(x=>m.messageKinds.includes(x.kind)));
 });
 await test('data classes are planned, hash-only for tokens and never claim deployment',()=>{
  const ids=m.dataClasses.map(c=>c.id);assert.equal(new Set(ids).size,ids.length);
  for(const c of m.dataClasses){for(const k of ['id','status','records','protection','secrets','retention','export','deletion'])assert.ok(c[k],`${c.id}.${k}`);}
  assert.ok(m.dataClasses.filter(c=>c.status==='planned').length>=4);
  assert.match(m.dataClasses.find(c=>c.id==='owner-email-changes').secrets,/SHA-256/);
  assert.match(m.dataClasses.find(c=>c.id==='platform-notifications').secrets,/never stored/);
 });
 return count;
}

let total=0;
const checkOnce=async(name,fn)=>{try{await fn();total++;}catch(error){throw new Error(name,{cause:error});}};
const real=await import(prototypeURL);
const suiteCount=await suite(real);total+=suiteCount;

// ---------- Read-only agreement with the current identity source (static text checks; no bundling) ----------
await checkOnce('the reference fresh-passkey window matches the identity engine',()=>{
 assert.match(read('src/workspace-identity/authority.ts'),/proof_at>unixepoch\(\)-600/);
 assert.equal(real.bounds.freshPasskeyMs,600e3);
});
await checkOnce('current recovery treats email as a lookup identifier with one generic proof error',()=>{
 const src=read('src/workspace-identity/recovery.ts');
 assert.match(src,/identityRecord\(input,\['version','email','key'\]\)/);
 assert.match(src,/if\(!a\|\|!equal\)throw invalidProof\(\);/);
});
await checkOnce('the account email is stored without verification state and cannot be edited through the profile (gap G-E1)',()=>{
 const users=read('src/workspace-identity/canonical-inputs.sql').match(/CREATE TABLE users \(([^;]*)\) STRICT;/)[1];
 assert.match(users,/email TEXT NOT NULL UNIQUE/);assert.ok(!/verif/i.test(users));
 const profile=read('src/profile.ts');
 const allow=profile.match(/keys\.some\(k=>!\[([^\]]*)\]\.includes\(k\)\)/)[1];assert.ok(!allow.includes('email'));
 assert.match(profile,/SELECT name,about_me FROM user_profiles WHERE user_id=\? AND share_context=1/);
});
await checkOnce('the inactive support notice would address the unverified account email (gap G-E5)',()=>{
 assert.match(read('src/support-delivery.ts'),/recipient:row\.email/);
});
await checkOnce('the reference imports only node builtins and performs no network call',()=>{
 const specifiers=[...prototypeSource.matchAll(/\bfrom\s+['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]/g)].map(x=>x[1]??x[2]);
 assert.deepEqual(specifiers,['node:crypto']);
 assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|process\.env/.test(prototypeSource));
});

// ---------- Mutation check: each deliberately broken reference must fail the suite at its intended check ----------
const mutants=[
 ['recovery accepts a pending address',"const a=address&&Object.values(s.accounts).find(x=>x.email===address);","const a=address&&Object.values(s.accounts).find(x=>x.email===address||s.changes[x.pendingChange]?.newAddress===address);"],
 ['verified email waives the kit',"typeof input.key==='string'&&a.kitVerifier===sha256(input.key)","(a.emailVerifiedAt!==null||typeof input.key==='string'&&a.kitVerifier===sha256(input.key))"],
 ['unknown version accepted',"check(input.version===contractVersion,'UNSUPPORTED_VERSION',String(input.version));",''],
 ['retired password field accepted',"for(const key of Object.keys(input))check(!retiredAuthorityFields.includes(key),'RETIRED_AUTHORITY',key);",''],
 ['fresh passkey not required',"if(fresh)check(s.now-x.proofAt<=bounds.freshPasskeyMs,'PROOF_REQUIRED');",''],
 ['restricted grant admitted to workspace operations',"check(purpose==='recovery','IDENTITY_INCOMPLETE');","check(true,'IDENTITY_INCOMPLETE');"],
 ['delivery unavailable still stores',"check(mailer,'DELIVERY_UNAVAILABLE');",''],
 ['old address not notified',"enqueue({kind:'change-requested',changeId,to:a.email});",''],
 ['token stored in plaintext',"secret=newSecret();c.tokenHash=sha256(secret);","secret=newSecret();c.tokenHash=secret;"],
 ['token accepted from another account',"if(!c||c.accountId!==p.accountId){","if(!c){"],
 ['confirmation replay re-applies',"c.status='confirmed';\n","c.status='pending';\n"],
 ['expiry not checked',"if(s.now>=c.expiresAt){c.status='expired';throw new ContractError('TOKEN_EXPIRED');}",''],
 ['superseded change confirmable',"if(earlier&&earlier.status==='pending')earlier.status='superseded';",''],
 ['pending change not bound to the epoch',"if(c.epoch!==a.epoch){c.status='stale';throw new ContractError('STALE_CHANGE','epoch');}",''],
 ['request replay creates a second change',"const r=replayed(a.id,rid,['email-change',address]);if(r.prior)return r.prior;","const r=replayed(a.id,`${rid}:${s.seq}`,['email-change',address]);"],
 ['in-use address enumerated',"const deliverable=!inUse&&","check(!inUse,'ADDRESS_IN_USE');const deliverable="],
 ['account request limit removed',"check(recent.length<bounds.requestsPerAccountPerDay,'RATE_LIMITED');",''],
 ['lost delivery response redispatched',"else {item.state='unknown-outcome';result.unknown++;}","else {item.state='queued';result.unknown++;}"],
 ['undo after the window',"s.now<a.previous.until&&a.email===c.newAddress","a.email===c.newAddress"],
 ['compromise commit leaves sessions and sign-ins valid',"if(!active(a).length)a.stage='recovering';\n   a.epoch++;","if(!active(a).length)a.stage='recovering';"],
 ['in-flight sign-in survives an epoch change',"check(c.epoch===a.epoch,'IDENTITY_CHANGED');\n   check(a.credentials[credentialId]","check(true,'IDENTITY_CHANGED');\n   check(a.credentials[credentialId]"],
 ['stale compromise review accepted',"check(s.now<review.expiresAt&&review.epoch===a.epoch&&review.credentialRevision===a.credentialRevision&&canonical(review.connections)===canonical(connections),'STALE_REVIEW');",''],
 ['compromise commit replay re-applies',"const r=replayed(a.id,rid,['compromise',input.reviewId,revokeCredentials,rotate,revokeConnections]);if(r.prior)return r.prior;","const r=replayed(a.id,`${rid}:${s.seq}`,['compromise',input.reviewId,revokeCredentials,rotate,revokeConnections]);"],
 ['two-key minimum blocks emergency revocation',"for(const k of revokeCredentials)a.credentials[k].status='removed';","check(active(a).length-revokeCredentials.length>=2,'MIN_KEYS');for(const k of revokeCredentials)a.credentials[k].status='removed';"],
 ['old kit survives rotation',"if(offer){a.kitVerifier=offer.verifier;a.kitGeneration++;delete s.offers[offer.id];}","if(offer){a.kitGeneration++;delete s.offers[offer.id];}"],
 ['unsaved kit accepted',"&&rotate.saved===true,'KIT_NOT_SAVED'",",'KIT_NOT_SAVED'"],
 ['pending email change survives compromise review',"if(pending&&pending.status==='pending'){pending.status='cancelled';a.pendingChange=null;}",''],
 ['credential erased before provider revocation',"c.access='disabled';c.revocation={state:'queued',reads:0,since:null,receipt:null};","c.access='disabled';c.credential=null;c.revocation={state:'queued',reads:0,since:null,receipt:null};"],
 ['unknown revocation outcome redispatched',"else {c.revocation.state='uncertain';c.revocation.since=s.now;result.uncertain++;}","else {c.revocation.state='queued';result.uncertain++;}"],
 ['erasure without a revocation receipt',"check(c.revocation.state==='revoked'&&c.revocation.receipt,'RECONCILIATION_HOLD',c.revocation.state);",''],
 ['unauthenticated reconciliation evidence accepted',"check(evidence&&evidence.authenticated===true,'EVIDENCE_NOT_AUTHENTICATED');",''],
 ['compromise review fabricates content recovery',"sessionsRevoked:'all',accountRecoveryOnly:true});","sessionsRevoked:'all',accountRecoveryOnly:true,contentRecovery:'restored'});"],
];
const killedBy={
 'recovery accepts a pending address':'an unverified or pending email','verified email waives the kit':'an unverified or pending email',
 'unknown version accepted':'unknown versions','retired password field accepted':'unknown versions',
 'fresh passkey not required':'an address change requires a fresh passkey','restricted grant admitted to workspace operations':'recovery secrets grant only',
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
let killed=0;
for(const [name,find,replace] of mutants){
 assert.equal(prototypeSource.split(find).length,2,`mutant "${name}" must match the reference exactly once`);
 const mutant=await import('data:text/javascript;base64,'+Buffer.from(prototypeSource.replace(find,()=>replace)).toString('base64'));
 await assert.rejects(suite(mutant),e=>{
  if(process.argv.includes('--explain'))console.log(`${name} => ${e.message}`);
  assert.ok(killedBy[name]&&e.message.startsWith(killedBy[name]),`mutant "${name}" was caught by an unexpected check: ${e.message}${e.cause?` (${e.cause.message})`:''}`);return true;
 },`mutant survived: ${name}`);killed++;
}
assert.equal(killed,mutants.length);
console.log(`email-change-contract: ${suiteCount} reference checks and ${total-suiteCount} source-agreement/static checks passed; ${killed}/${mutants.length} mutants caught (synthetic accounts, mailer and provider; no database, network, credential or model).`);
