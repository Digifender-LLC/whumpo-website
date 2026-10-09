// WH-063 / WH-203 offline reference for the compromise review, plus the synthetic identity engine that hosts the
// WH-200 source email-change module (src/email-change/*.ts) in tests/email-change-contract.mjs.
// Contract: docs/email-change-and-compromise.md. Synthetic in-memory store and fake provider revoker only. No Worker,
// database, network, model or credential. Nothing in src/ imports this file.
//
// Email-change decisions are NOT made here: every address-change operation parses, authorizes and decides in the
// injected source module (`emailChange`), and this file only reads and stores the plain records it returns, with a
// revision guard. What remains here is (a) a synthetic stand-in for the existing identity engine (passkey sign-in,
// sessions, restricted recovery grants, emergency passkey removal) and (b) the compromise-review and provider
// revocation reference that WH-203 must implement in source. When WH-203 lands, (b) moves to source as WH-200's
// part did, and this file shrinks to (a) or is deleted.
//
// The reference fences authority by the account epoch: sessions, restricted grants and sign-in challenges carry the
// epoch they were issued under and fail once it advances. The implementation must also delete those rows in the same
// committing batch and recheck the epoch inside the committing statements, as the identity engine does.
import {createHash,randomBytes} from 'node:crypto';

const MIN=60e3,HOUR=60*MIN,DAY=24*HOUR;
/** Synthetic identity engine and compromise-review bounds (recommended v1 values, see the contract). The email-change
 * bounds are the source module's emailChangeBounds. */
export const bounds=Object.freeze({sessionMs:7*DAY,grantMs:30*MIN,challengeMs:5*MIN,reviewMs:10*MIN,reconcileReads:3,reconcileWindowMs:3*DAY});

export class ContractError extends Error{constructor(code,detail){super(detail?`${code}: ${detail}`:code);this.code=code;}}
const check=(ok,code,detail)=>{if(!ok)throw new ContractError(code,detail);};
export const sha256=value=>createHash('sha256').update(value).digest('hex');
const newSecret=()=>randomBytes(32).toString('base64url');
const canonical=value=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:1)):v);

/** Planned lifecycle classes (WH-116/WH-009 extension); registered by WH-201 with the real tables. */
export const dataClasses=Object.freeze([
 {id:'owner-email',status:'current-extension',records:['account email','verification time and sender'],protection:'managed-readable',secrets:'none',
  retention:'while the account exists; enters closure purge',export:'address, verified time',deletion:'account closure'},
 {id:'owner-email-changes',status:'planned',records:['pending change','confirmation-token verifier','previous-address undo reservation'],protection:'managed-readable',secrets:'token verifier only (SHA-256); plaintext exists only in the one provider call',
  retention:'pending until confirmed, cancelled, superseded, stale or expired; terminal rows 30 days with the new address replaced by its hash; previous address until the undo window ends',
  export:'current pending address and expiry; never token verifiers, request hashes or rate-limit keys',deletion:'cancellation, expiry cleanup, account closure'},
 {id:'owner-email-change-limits',status:'planned',records:['per-account request times','hashed per-address daily send keys','confirmation failure counts'],protection:'managed-readable',secrets:'none (address keys are hashes)',
  retention:'48 hours',export:'none',deletion:'bounded maintenance'},
 {id:'platform-notifications',status:'planned',records:['content-free account notices in the WH-156 shared outbox'],protection:'managed-readable',secrets:'none: the confirmation token is never stored in the outbox',
  retention:'30 days; unknown-outcome and unresolved evidence until resolved',export:'state and time only',deletion:'outbox expiry'},
 {id:'owner-security-reviews',status:'planned',records:['review snapshot identifiers','selections','commit receipt'],protection:'managed-readable',secrets:'none: identifiers and counts only, never kit, token or credential material',
  retention:'90 days after commit or expiry',export:'review time, selections and outcome',deletion:'retention cleanup, account closure'},
 {id:'connections',status:'current',records:['encrypted provider credentials held for revocation','revocation receipts'],protection:'application-encrypted',secrets:'ciphertext retained until definitive provider revocation',
  retention:'until definitive revocation or reconciled evidence; unresolved holds block closure',export:'connection state only',deletion:'only after an exact revocation receipt'},
]);

/**
 * emailChange: the bundled source module (src/email-change). mailer: a PlatformMailer ({send}) or null, which models
 * the current state (no platform delivery is active).
 * revoker({provider, connectionId}) -> 'revoked' (definitive) | 'not-revoked' (definitive refusal, nothing changed) | else unknown.
 */
export function createReferenceRuntime({emailChange:ec,mailer=null,revoker=null,start=Date.UTC(2026,9,9)}){
 const s={now:start,seq:0,accounts:{},sessions:{},grants:{},challenges:{},changes:{},offers:{},reviews:{},connections:{},outbox:[],receipts:{},
  counters:{requests:{},addresses:{},failures:{}}};
 const id=prefix=>`${prefix}-${String(++s.seq).padStart(4,'0')}`;
 const account=accountId=>{const a=s.accounts[accountId];check(a,'UNKNOWN_ACCOUNT');return a;};
 const active=a=>Object.entries(a.credentials).filter(([,c])=>c.status==='active').map(([k])=>k).sort();
 function issue(table,record){const token=newSecret();table[sha256(token)]=record;return token;}

 // ---------- storage for the source email-change records (no decisions) ----------
 const view=a=>({accountId:a.id,email:a.email,verifiedAt:a.emailVerifiedAt,verifiedVia:a.emailVerifiedVia,authEpoch:a.epoch,stage:a.stage});
 const changesOf=accountId=>Object.values(s.changes).filter(c=>c.accountId===accountId);
 const pendingOf=accountId=>changesOf(accountId).filter(c=>c.state==='pending').at(-1)??null;
 const holders=address=>({accounts:Object.values(s.accounts).filter(x=>x.email===address).map(view),changes:Object.values(s.changes).filter(c=>c.previous?.address===address)});
 /** Revision guard: a write must be the next revision of the stored row (or revision 1 of a new row). */
 function putChange(next){
  const current=s.changes[next.changeId];
  check(current?current.revision===next.revision-1:next.revision===1,'CONCURRENT_CHANGE',next.changeId);
  s.changes[next.changeId]=Object.freeze(next);
 }
 const putIfChanged=next=>{if(next&&s.changes[next.changeId]?.revision!==next.revision)putChange(next);};
 const putNotice=next=>{const i=s.outbox.findIndex(x=>x.noticeId===next.noticeId);s.outbox[i]=Object.freeze(next);};
 function apply(a,step,addressKey){
  for(const c of step.changes)putChange(c);
  if(step.account){a.email=step.account.email;a.emailVerifiedAt=step.account.verifiedAt;a.emailVerifiedVia=step.account.verifiedVia;}
  for(const n of step.notices)s.outbox.push(Object.freeze(ec.queueNotice(n,id('msg'),s.now)));
  if(step.limits?.requests)s.counters.requests[a.id]=step.limits.requests;
  if(step.limits?.addressSends)s.counters.addresses[addressKey]=step.limits.addressSends;
  if(step.limits?.failures)s.counters.failures[a.id]=step.limits.failures;
  if(step.refusal)throw new ec.EmailChangeError(step.refusal.code,step.refusal.detail);
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
  check(account(x.accountId).credentials[x.credentialId]?.status==='active','IDENTITY_CHANGED');
  return {accountId:x.accountId,kind:'session',purpose:'workspace',authEpoch:x.epoch,proof:{method:'passkey',verifiedAt:x.proofAt}};
 }
 function owner(auth,{fresh=false}={}){
  const p=resolve(auth),a=account(p.accountId);
  ec.authorizeOwner(p,view(a),{fresh,now:s.now});
  return {p,a};
 }
 function replayed(accountId,rid,payload){
  const key=`${accountId}:${rid}`,hash=sha256(canonical(payload)),prior=s.receipts[key];
  if(prior){check(prior.hash===hash,'REQUEST_CONFLICT');return {key,hash,prior:prior.response};}
  return {key,hash,prior:null};
 }

 const rt={
  // ---------- synthetic fixtures and clock ----------
  addAccount({accountId,email,credentials,kitKey}){
   s.accounts[accountId]={id:accountId,email:ec.normalizeAddress(email),emailVerifiedAt:null,emailVerifiedVia:null,stage:'ready',epoch:1,credentialRevision:1,
    kitGeneration:1,kitVerifier:sha256(kitKey),credentials:Object.fromEntries(credentials.map(c=>[c,{status:'active'}]))};
  },
  addConnection(accountId,{connectionId,provider}){account(accountId);s.connections[connectionId]={id:connectionId,accountId,provider,access:'active',credential:`ciphertext:${connectionId}`,revocation:{state:'none',reads:0,since:null,receipt:null}};},
  advance(ms){s.now+=ms;},
  now:()=>s.now,
  /** Deep copy of every stored record, for storage audits. */
  inspect:()=>structuredClone(s),

  // ---------- synthetic identity engine: passkey sign-in (synthetic assertions) ----------
  beginSignIn({accountId}){const a=account(accountId),cid=id('chl');s.challenges[cid]={accountId,epoch:a.epoch,expiresAt:s.now+bounds.challengeMs};return cid;},
  finishSignIn({challengeId,credentialId}){
   const c=s.challenges[challengeId];check(c&&c.expiresAt>s.now,'PROOF_REQUIRED');delete s.challenges[challengeId];
   const a=account(c.accountId);
   check(c.epoch===a.epoch,'IDENTITY_CHANGED');
   check(a.credentials[credentialId]?.status==='active','PROOF_REQUIRED');
   if(a.stage!=='ready')return {kind:'grant',token:issue(s.grants,{accountId:a.id,epoch:a.epoch,purpose:'recovery',issuedAt:s.now,expiresAt:s.now+bounds.grantMs})};
   return {kind:'session',token:issue(s.sessions,{accountId:a.id,epoch:a.epoch,credentialId,proofAt:s.now,expiresAt:s.now+bounds.sessionMs})};
  },
  signIn({accountId,credentialId}){return rt.finishSignIn({challengeId:rt.beginSignIn({accountId}),credentialId});},

  /** Email is a lookup identifier only: the current kit is the proof, and the result is restricted recovery authority. */
  startRecovery(input){
   ec.closedInput(input,['version','email','key']);
   let address=null;try{address=ec.normalizeAddress(input.email);}catch{}
   const a=address&&Object.values(s.accounts).find(x=>x.email===address);
   const proven=Boolean(a)&&typeof input.key==='string'&&a.kitVerifier===sha256(input.key);
   check(proven&&['ready','recovering'].includes(a.stage),'RECOVERY_PROOF');
   return {kind:'grant',token:issue(s.grants,{accountId:a.id,epoch:a.epoch,purpose:'recovery',issuedAt:s.now,expiresAt:s.now+bounds.grantMs})};
  },
  identityState(auth){
   if(auth?.kind==='grant'){
    const p=resolve(auth),a=account(p.accountId);check(p.authEpoch===a.epoch,'IDENTITY_CHANGED');
    return {authority:'recovery',stage:a.stage,allowedNext:['review_loss','add_passkey','kit','help','logout']};
   }
   return {authority:'workspace',stage:owner(auth).a.stage};
  },

  // ---------- verified address change: storage around the WH-200 source module ----------
  async requestEmailChange(auth,input){
   const request=ec.parseChangeRequest(input);
   const p=resolve(auth),a=account(p.accountId),key=await ec.addressKey(request.newAddress);
   const step=await ec.requestEmailChange({principal:p,account:view(a),request,deliveryActive:Boolean(mailer),
    prior:changesOf(a.id).find(c=>c.requestId===request.requestId)??null,pending:pendingOf(a.id),holders:holders(request.newAddress),
    limits:{requests:s.counters.requests[a.id]??[],addressSends:s.counters.addresses[key]??[]},changeId:id('chg'),now:s.now});
   return apply(a,step,key);
  },
  async confirmEmailChange(auth,input){
   const {token}=ec.parseConfirmation(input);
   const p=resolve(auth),a=account(p.accountId),verifier=await ec.tokenVerifier(token);
   const change=verifier?Object.values(s.changes).find(c=>c.tokenVerifier===verifier)??null:null;
   return apply(a,ec.confirmEmailChange({principal:p,account:view(a),verifier,change,holders:change?holders(change.newAddress):{accounts:[],changes:[]},
    failures:s.counters.failures[a.id]??[],now:s.now}));
  },
  async cancelEmailChange(auth,input){
   const {changeId}=ec.parseChangeReference(input);
   const p=resolve(auth),a=account(p.accountId);
   return apply(a,ec.cancelEmailChange({principal:p,account:view(a),changeId,change:s.changes[changeId]??null,now:s.now}));
  },
  async undoEmailChange(auth,input){
   const {changeId}=ec.parseChangeReference(input);
   const p=resolve(auth),a=account(p.accountId);
   return apply(a,ec.undoEmailChange({principal:p,account:view(a),changeId,change:s.changes[changeId]??null,now:s.now}));
  },
  async readAccountEmail(auth){
   const p=resolve(auth),a=account(p.accountId);
   return ec.readAccountEmail({principal:p,account:view(a),pending:pendingOf(a.id),now:s.now});
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

  // ---------- synthetic identity engine: emergency removal (below the two-key count) ----------
  removePasskey(auth,input){
   ec.closedInput(input,['version','credentialId']);
   const {a}=owner(auth,{fresh:true});
   check(a.credentials[input.credentialId]?.status==='active','UNKNOWN_CREDENTIAL');
   a.credentials[input.credentialId].status='removed';a.credentialRevision++;a.epoch++;
   if(!active(a).length)a.stage='recovering';
   return {epoch:a.epoch,stage:a.stage,activePasskeys:active(a).length};
  },

  // ---------- WH-203 reference: compromise review ----------
  prepareCompromiseReview(auth,input){
   ec.closedInput(input,['version']);
   const {a}=owner(auth,{fresh:true}),reviewId=id('rev');
   const connections=Object.values(s.connections).filter(c=>c.accountId===a.id).map(c=>c.id).sort();
   s.reviews[reviewId]={id:reviewId,accountId:a.id,epoch:a.epoch,credentialRevision:a.credentialRevision,kitGeneration:a.kitGeneration,credentials:active(a),connections,expiresAt:s.now+bounds.reviewMs};
   return {reviewId,credentials:active(a),connections,pendingEmailChange:Boolean(ec.pendingChangeForReview(pendingOf(a.id),s.now)),kitGeneration:a.kitGeneration,expiresAt:s.now+bounds.reviewMs,accountRecoveryOnly:true};
  },
  /** One-time kit offer bound to the review; plaintext returned once, verifier stored. */
  prepareKit(auth,input){
   ec.closedInput(input,['version','reviewId']);
   const {a}=owner(auth,{fresh:true}),r=s.reviews[input.reviewId];
   check(r&&r.accountId===a.id,'UNKNOWN_REVIEW');
   const key=newSecret(),offerId=id('kit');s.offers[offerId]={id:offerId,accountId:a.id,reviewId:r.id,verifier:sha256(key)};
   return {offerId,key};
  },
  commitCompromiseReview(auth,input){
   ec.closedInput(input,['version','requestId','reviewId','revokeCredentials','rotateKit','revokeConnections']);
   const {a}=owner(auth,{fresh:true}),rid=ec.requestIdentifier(input.requestId);
   const revokeCredentials=[...(input.revokeCredentials??[])].sort(),revokeConnections=[...(input.revokeConnections??[])].sort(),rotate=input.rotateKit??null;
   const r=replayed(a.id,rid,['compromise',input.reviewId,revokeCredentials,rotate,revokeConnections]);if(r.prior)return r.prior;
   const review=s.reviews[input.reviewId];
   check(review&&review.accountId===a.id,'UNKNOWN_REVIEW');
   const connections=Object.values(s.connections).filter(c=>c.accountId===a.id).map(c=>c.id).sort();
   check(s.now<review.expiresAt&&review.epoch===a.epoch&&review.credentialRevision===a.credentialRevision&&canonical(review.connections)===canonical(connections),'STALE_REVIEW');
   check(new Set(revokeCredentials).size===revokeCredentials.length&&revokeCredentials.every(k=>review.credentials.includes(k)),'INVALID_SELECTION','credentials');
   check(new Set(revokeConnections).size===revokeConnections.length&&revokeConnections.every(k=>review.connections.includes(k)),'INVALID_SELECTION','connections');
   let offer=null;
   if(rotate!==null){
    check(rotate&&typeof rotate==='object'&&canonical(Object.keys(rotate).sort())===canonical(['offerId','saved']),'UNKNOWN_FIELD','rotateKit');
    offer=s.offers[rotate.offerId];check(offer&&offer.accountId===a.id&&offer.reviewId===review.id&&rotate.saved===true,'KIT_NOT_SAVED');
   }
   // Effects: one guarded commit. Emergency revocation may leave fewer than two (or zero) passkeys.
   for(const k of revokeCredentials)a.credentials[k].status='removed';
   if(revokeCredentials.length)a.credentialRevision++;
   if(!active(a).length)a.stage='recovering';
   a.epoch++;
   // The pending address change is closed by the WH-200 source transition.
   const pending=pendingOf(a.id);if(pending)putIfChanged(ec.closeForSecurityReview(pending));
   if(offer){a.kitVerifier=offer.verifier;a.kitGeneration++;delete s.offers[offer.id];}
   for(const k of revokeConnections){const c=s.connections[k];c.access='disabled';c.revocation={state:'queued',reads:0,since:null,receipt:null};}
   s.outbox.push(Object.freeze(ec.queueNotice({kind:'security-review-completed',changeId:null,to:a.email},id('msg'),s.now)));
   const response=Object.freeze({reviewId:review.id,epoch:a.epoch,stage:a.stage,revokedCredentials:revokeCredentials,kitRotated:Boolean(offer),
    connections:revokeConnections.map(k=>({connectionId:k,access:'disabled',revocation:'queued'})),sessionsRevoked:'all',accountRecoveryOnly:true});
   s.receipts[r.key]={hash:r.hash,response};
   return response;
  },

  // ---------- WH-203 reference: provider connections, revoked at the provider before local erasure ----------
  useConnection(auth,input){
   ec.closedInput(input,['version','connectionId']);
   const {a}=owner(auth),c=s.connections[input.connectionId];
   check(c&&c.accountId===a.id,'UNKNOWN_CONNECTION');check(c.access==='active','CONNECTION_DISABLED');
   return {connectionId:c.id,provider:c.provider};
  },
  runRevocations(){
   const result={revoked:0,retry:0,uncertain:0};
   for(const c of Object.values(s.connections).filter(x=>x.revocation.state==='queued')){
    c.revocation.state='dispatching';
    let outcome;try{outcome=revoker({provider:c.provider,connectionId:c.id});}catch{outcome='unknown';}
    if(outcome==='revoked'){c.revocation={...c.revocation,state:'revoked',receipt:{connectionId:c.id,at:s.now,evidence:'direct'}};c.credential=null;result.revoked++;}
    else if(outcome==='not-revoked'){c.revocation.state='queued';result.retry++;}
    else {c.revocation.state='uncertain';c.revocation.since=s.now;result.uncertain++;}
   }
   return result;
  },
  /** Read-only reconciliation with authenticated provider evidence; never calls revoke again. */
  reconcileRevocation({connectionId,evidence}){
   const c=s.connections[connectionId];check(c,'UNKNOWN_CONNECTION');
   check(c.revocation.state==='uncertain','NOT_UNCERTAIN',c.revocation.state);
   check(evidence&&evidence.authenticated===true,'EVIDENCE_NOT_AUTHENTICATED');
   c.revocation.reads++;
   if(evidence.result==='revoked'){c.revocation={...c.revocation,state:'revoked',receipt:{connectionId:c.id,at:s.now,evidence:'reconciled'}};c.credential=null;return c.revocation.state;}
   if(c.revocation.reads>=bounds.reconcileReads||s.now-c.revocation.since>=bounds.reconcileWindowMs)c.revocation.state='unresolved';
   return c.revocation.state;
  },
  /** Local erasure (cleanup, account closure) requires an exact revocation receipt. */
  eraseConnectionCredential(connectionId){
   const c=s.connections[connectionId];check(c,'UNKNOWN_CONNECTION');
   check(c.revocation.state==='revoked'&&c.revocation.receipt,'RECONCILIATION_HOLD',c.revocation.state);
   c.credential=null;return {connectionId,erased:true};
  },
  connectionState(connectionId){const c=s.connections[connectionId];return {access:c.access,credentialHeld:c.credential!==null,revocation:c.revocation.state};},
 };
 return Object.freeze(rt);
}
