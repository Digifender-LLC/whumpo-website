// WH-063 / WH-199 offline reference for verified account email changes and compromise response.
// Planned contract: docs/email-change-and-compromise.md. Synthetic in-memory store, fake mailer and fake provider
// revoker only. No Worker, database, network, model or credential. Nothing in src/ imports this file.
//
// The reference fences authority by the account epoch: sessions, restricted grants and sign-in challenges carry the
// epoch they were issued under and fail once it advances. The implementation (WH-200/201) must also delete those rows
// in the same committing batch and recheck the epoch inside the committing statements, as the identity engine does.
import {createHash,randomBytes} from 'node:crypto';

export const contractVersion=1;
const MIN=60e3,HOUR=60*MIN,DAY=24*HOUR;
/** Recommended v1 values. Token lifetime and the undo window are open owner decisions (see the contract). */
export const bounds=Object.freeze({
 freshPasskeyMs:10*MIN,sessionMs:7*DAY,grantMs:30*MIN,challengeMs:5*MIN,reviewMs:10*MIN,
 tokenLifetimeMs:HOUR,undoWindowMs:7*DAY,
 requestsPerAccountPerDay:3,messagesPerAddressPerDay:3,confirmFailuresPerHour:5,
 reconcileReads:3,reconcileWindowMs:3*DAY,
});
/** The only sender. Platform delivery (WH-036) — never a customer's connected mailbox. */
export const platformSender=Object.freeze({address:'notify@whumpo.com',displayName:'Whumpo',authority:'platform-obligation'});
/** Retired or never-admitted proof kinds. Presenting one is refused; nothing revives password authority. */
export const retiredAuthorityFields=Object.freeze(['password','passwordHash','newPassword','recoveryCode','magicLink','emailCode','otp']);
export const messageKinds=Object.freeze(['confirm-new-address','change-requested','change-completed','change-undone','security-review-completed']);

export class ContractError extends Error{constructor(code,detail){super(detail?`${code}: ${detail}`:code);this.code=code;}}
const check=(ok,code,detail)=>{if(!ok)throw new ContractError(code,detail);};
export const sha256=value=>createHash('sha256').update(value).digest('hex');
const newSecret=()=>randomBytes(32).toString('base64url');
const canonical=value=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:1)):v);

/** Same shape rule as the WH-036 destination normalizer: one plain lower-case address, no name or display text. */
export function normalizeAddress(value){
 check(typeof value==='string','INVALID_ADDRESS');
 const address=value.trim().toLowerCase();
 check(address.length>=3&&address.length<=254&&/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/.test(address),'INVALID_ADDRESS');
 return address;
}
function closed(input,allowed){
 check(input&&typeof input==='object'&&!Array.isArray(input),'INVALID_REQUEST');
 for(const key of Object.keys(input))check(!retiredAuthorityFields.includes(key),'RETIRED_AUTHORITY',key);
 for(const key of Object.keys(input))check(allowed.includes(key),'UNKNOWN_FIELD',key);
 check(input.version===contractVersion,'UNSUPPORTED_VERSION',String(input.version));
 return input;
}
const requestId=value=>{check(typeof value==='string'&&/^[A-Za-z0-9-]{8,64}$/.test(value),'INVALID_REQUEST','requestId');return value;};

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
 * mailer(message) -> 'accepted' | 'deferred' (certainly not sent) | 'rejected' | 'suppressed' | anything else/throw = unknown.
 * revoker({provider, connectionId}) -> 'revoked' (definitive) | 'not-revoked' (definitive refusal, nothing changed) | else unknown.
 * Omitting the mailer models the current state: no platform delivery is active.
 */
export function createReferenceRuntime({mailer=null,revoker=null,start=Date.UTC(2026,9,9)}={}){
 const s={now:start,seq:0,accounts:{},sessions:{},grants:{},challenges:{},changes:{},offers:{},reviews:{},connections:{},outbox:[],receipts:{},
  counters:{requests:{},addresses:{},failures:{}}};
 const id=prefix=>`${prefix}-${String(++s.seq).padStart(4,'0')}`;
 const account=accountId=>{const a=s.accounts[accountId];check(a,'UNKNOWN_ACCOUNT');return a;};
 const active=a=>Object.entries(a.credentials).filter(([,c])=>c.status==='active').map(([k])=>k).sort();
 const enqueue=item=>s.outbox.push({id:id('msg'),state:'queued',attempts:0,...item});
 const within=(list,ms)=>(list??[]).filter(t=>s.now-t<ms);
 const reserved=(address,except)=>Object.values(s.accounts).some(x=>x.id!==except&&(x.email===address||(x.previous&&x.previous.address===address&&x.previous.until>s.now)));
 function issue(table,record){const token=newSecret();table[sha256(token)]=record;return token;}

 /** Resolves current authority. A restricted grant is admitted only for recovery-purpose operations. */
 function principal(auth,{fresh=false,purpose='workspace'}={}){
  check(auth&&typeof auth.token==='string','AUTH_REQUIRED');
  const h=sha256(auth.token);
  if(auth.kind==='grant'){
   const g=s.grants[h];check(g&&g.expiresAt>s.now,'PROOF_REQUIRED');
   check(g.epoch===account(g.accountId).epoch,'IDENTITY_CHANGED');
   check(purpose==='recovery','IDENTITY_INCOMPLETE');
   return g;
  }
  check(auth.kind==='session','AUTH_REQUIRED');
  const x=s.sessions[h];check(x&&x.expiresAt>s.now,'AUTH_REQUIRED');
  const a=account(x.accountId);
  check(x.epoch===a.epoch,'IDENTITY_CHANGED');
  check(a.stage==='ready','IDENTITY_INCOMPLETE');
  check(a.credentials[x.credentialId]?.status==='active','IDENTITY_CHANGED');
  if(fresh)check(s.now-x.proofAt<=bounds.freshPasskeyMs,'PROOF_REQUIRED');
  return x;
 }
 function replayed(accountId,rid,payload){
  const key=`${accountId}:${rid}`,hash=sha256(canonical(payload)),prior=s.receipts[key];
  if(prior){check(prior.hash===hash,'REQUEST_CONFLICT');return {key,hash,prior:prior.response};}
  return {key,hash,prior:null};
 }

 const rt={
  // ---------- synthetic fixtures and clock ----------
  addAccount({accountId,email,credentials,kitKey}){
   s.accounts[accountId]={id:accountId,email:normalizeAddress(email),emailVerifiedAt:null,emailVerifiedVia:null,stage:'ready',epoch:1,credentialRevision:1,
    kitGeneration:1,kitVerifier:sha256(kitKey),credentials:Object.fromEntries(credentials.map(c=>[c,{status:'active'}])),pendingChange:null,previous:null};
  },
  addConnection(accountId,{connectionId,provider}){account(accountId);s.connections[connectionId]={id:connectionId,accountId,provider,access:'active',credential:`ciphertext:${connectionId}`,revocation:{state:'none',reads:0,since:null,receipt:null}};},
  advance(ms){s.now+=ms;},
  now:()=>s.now,
  /** Deep copy of every stored record, for storage audits. */
  inspect:()=>structuredClone(s),

  // ---------- passkey sign-in (synthetic assertions) ----------
  beginSignIn({accountId}){const a=account(accountId),cid=id('chl');s.challenges[cid]={accountId,epoch:a.epoch,expiresAt:s.now+bounds.challengeMs};return cid;},
  finishSignIn({challengeId,credentialId}){
   const c=s.challenges[challengeId];check(c&&c.expiresAt>s.now,'PROOF_REQUIRED');delete s.challenges[challengeId];
   const a=account(c.accountId);
   check(c.epoch===a.epoch,'IDENTITY_CHANGED');
   check(a.credentials[credentialId]?.status==='active','PROOF_REQUIRED');
   if(a.stage!=='ready')return {kind:'grant',token:issue(s.grants,{accountId:a.id,epoch:a.epoch,purpose:'recovery',expiresAt:s.now+bounds.grantMs})};
   return {kind:'session',token:issue(s.sessions,{accountId:a.id,epoch:a.epoch,credentialId,proofAt:s.now,expiresAt:s.now+bounds.sessionMs})};
  },
  signIn({accountId,credentialId}){return rt.finishSignIn({challengeId:rt.beginSignIn({accountId}),credentialId});},

  /** Email is a lookup identifier only: the current kit is the proof, and the result is restricted recovery authority. */
  startRecovery(input){
   closed(input,['version','email','key']);
   let address=null;try{address=normalizeAddress(input.email);}catch{}
   const a=address&&Object.values(s.accounts).find(x=>x.email===address);
   const proven=Boolean(a)&&typeof input.key==='string'&&a.kitVerifier===sha256(input.key);
   check(proven&&['ready','recovering'].includes(a.stage),'RECOVERY_PROOF');
   return {kind:'grant',token:issue(s.grants,{accountId:a.id,epoch:a.epoch,purpose:'recovery',expiresAt:s.now+bounds.grantMs})};
  },
  identityState(auth){
   const p=principal(auth,{purpose:auth?.kind==='grant'?'recovery':'workspace'}),a=account(p.accountId);
   return auth.kind==='grant'?{authority:'recovery',stage:a.stage,allowedNext:['review_loss','add_passkey','kit','help','logout']}:{authority:'workspace',stage:a.stage};
  },
  readAccountEmail(auth){
   const a=account(principal(auth).accountId),c=a.pendingChange&&s.changes[a.pendingChange];
   return {email:a.email,verified:a.emailVerifiedAt!==null,pending:c&&c.status==='pending'?{changeId:c.id,expiresAt:c.expiresAt}:null};
  },

  // ---------- verified address change ----------
  requestEmailChange(auth,input){
   closed(input,['version','requestId','newAddress']);
   const p=principal(auth,{fresh:true}),a=account(p.accountId);
   check(mailer,'DELIVERY_UNAVAILABLE');
   const rid=requestId(input.requestId),address=normalizeAddress(input.newAddress);
   const r=replayed(a.id,rid,['email-change',address]);if(r.prior)return r.prior;
   check(address!==a.email,'NO_CHANGE');
   const recent=within(s.counters.requests[a.id],DAY);
   check(recent.length<bounds.requestsPerAccountPerDay,'RATE_LIMITED');
   s.counters.requests[a.id]=[...recent,s.now];
   const earlier=a.pendingChange&&s.changes[a.pendingChange];
   if(earlier&&earlier.status==='pending')earlier.status='superseded';
   const addressKey=sha256(address),sent=within(s.counters.addresses[addressKey],DAY);
   const inUse=reserved(address,a.id);
   const deliverable=!inUse&&sent.length<bounds.messagesPerAddressPerDay;
   if(deliverable)s.counters.addresses[addressKey]=[...sent,s.now];
   const changeId=id('chg');
   s.changes[changeId]={id:changeId,accountId:a.id,requestId:rid,newAddress:address,tokenHash:null,epoch:a.epoch,createdAt:s.now,expiresAt:s.now+bounds.tokenLifetimeMs,status:'pending',deliverable,receipt:null};
   a.pendingChange=changeId;
   if(deliverable)enqueue({kind:'confirm-new-address',changeId,to:address});
   enqueue({kind:'change-requested',changeId,to:a.email});
   const response=Object.freeze({status:'pending-confirmation',changeId,expiresAt:s.now+bounds.tokenLifetimeMs});
   s.receipts[r.key]={hash:r.hash,response};
   return response;
  },
  /** The link proves control of the new mailbox only; the owner's current ordinary session is also required. */
  confirmEmailChange(auth,input){
   closed(input,['version','token']);
   const p=principal(auth),a=account(p.accountId);
   const failures=within(s.counters.failures[a.id],HOUR);
   check(failures.length<bounds.confirmFailuresPerHour,'RATE_LIMITED');
   const h=typeof input.token==='string'&&input.token.length<=128?sha256(input.token):null;
   const c=h&&Object.values(s.changes).find(x=>x.tokenHash===h);
   if(!c||c.accountId!==p.accountId){s.counters.failures[a.id]=[...failures,s.now];throw new ContractError('INVALID_TOKEN');}
   if(c.status==='confirmed')return c.receipt;
   check(c.status!=='superseded','STALE_CHANGE','superseded');
   check(c.status==='pending','CHANGE_CLOSED',c.status);
   if(s.now>=c.expiresAt){c.status='expired';throw new ContractError('TOKEN_EXPIRED');}
   if(c.epoch!==a.epoch){c.status='stale';throw new ContractError('STALE_CHANGE','epoch');}
   if(reserved(c.newAddress,a.id)){c.status='failed';throw new ContractError('ADDRESS_UNAVAILABLE');}
   a.previous={address:a.email,verifiedAt:a.emailVerifiedAt,verifiedVia:a.emailVerifiedVia,until:s.now+bounds.undoWindowMs,changeId:c.id};
   a.email=c.newAddress;a.emailVerifiedAt=s.now;a.emailVerifiedVia=platformSender.address;a.pendingChange=null;
   c.status='confirmed';
   c.receipt=Object.freeze({changeId:c.id,status:'confirmed',email:a.email,verifiedAt:s.now});
   enqueue({kind:'change-completed',changeId:c.id,to:a.previous.address});
   return c.receipt;
  },
  cancelEmailChange(auth,input){
   closed(input,['version','changeId']);
   const a=account(principal(auth).accountId),c=s.changes[input.changeId];
   check(c&&c.accountId===a.id,'UNKNOWN_CHANGE');
   if(c.status==='cancelled')return {changeId:c.id,status:'cancelled'};
   check(c.status==='pending','CHANGE_CLOSED',c.status);
   c.status='cancelled';a.pendingChange=null;
   return {changeId:c.id,status:'cancelled'};
  },
  undoEmailChange(auth,input){
   closed(input,['version','changeId']);
   const a=account(principal(auth,{fresh:true}).accountId),c=s.changes[input.changeId];
   check(c&&c.accountId===a.id,'UNKNOWN_CHANGE');
   check(c.status==='confirmed'&&a.previous?.changeId===c.id&&s.now<a.previous.until&&a.email===c.newAddress,'UNDO_UNAVAILABLE');
   const restored=a.previous;
   a.email=restored.address;a.emailVerifiedAt=restored.verifiedAt;a.emailVerifiedVia=restored.verifiedVia;a.previous=null;c.status='undone';
   enqueue({kind:'change-undone',changeId:c.id,to:c.newAddress});enqueue({kind:'change-undone',changeId:c.id,to:a.email});
   return {changeId:c.id,status:'undone',email:a.email};
  },

  /** Scheduled delivery pass. The confirmation token is minted inside the claimed attempt and stored only as a hash. */
  runDelivery(){
   const result={accepted:0,deferred:0,failed:0,unknown:0,cancelled:0};
   for(const item of s.outbox.filter(x=>x.state==='queued')){
    const c=s.changes[item.changeId];
    if(item.kind==='confirm-new-address'&&(c.status!=='pending'||s.now>=c.expiresAt)){item.state='cancelled';result.cancelled++;continue;}
    item.state='dispatching';item.attempts++;
    let secret=null;
    if(item.kind==='confirm-new-address'){secret=newSecret();c.tokenHash=sha256(secret);}
    const message={from:platformSender.address,displayName:platformSender.displayName,to:item.to,kind:item.kind,noticeId:item.id,...(secret?{token:secret}:{})};
    let outcome;try{outcome=mailer(message);}catch{outcome='unknown';}
    if(outcome==='accepted'){item.state='accepted';result.accepted++;}
    else if(outcome==='deferred'){item.state='queued';if(secret)c.tokenHash=null;result.deferred++;}
    else if(outcome==='rejected'||outcome==='suppressed'){item.state='failed';if(secret){c.tokenHash=null;c.status='undeliverable';}result.failed++;}
    else {item.state='unknown-outcome';result.unknown++;}
   }
   return result;
  },
  outboxStates:()=>s.outbox.map(x=>({kind:x.kind,state:x.state,attempts:x.attempts})),

  // ---------- emergency removal (shared identity engine, below the two-key count) ----------
  removePasskey(auth,input){
   closed(input,['version','credentialId']);
   const a=account(principal(auth,{fresh:true}).accountId);
   check(a.credentials[input.credentialId]?.status==='active','UNKNOWN_CREDENTIAL');
   a.credentials[input.credentialId].status='removed';a.credentialRevision++;a.epoch++;
   if(!active(a).length)a.stage='recovering';
   return {epoch:a.epoch,stage:a.stage,activePasskeys:active(a).length};
  },

  // ---------- compromise review ----------
  prepareCompromiseReview(auth,input){
   closed(input,['version']);
   const a=account(principal(auth,{fresh:true}).accountId),reviewId=id('rev');
   const connections=Object.values(s.connections).filter(c=>c.accountId===a.id).map(c=>c.id).sort();
   s.reviews[reviewId]={id:reviewId,accountId:a.id,epoch:a.epoch,credentialRevision:a.credentialRevision,kitGeneration:a.kitGeneration,credentials:active(a),connections,expiresAt:s.now+bounds.reviewMs};
   return {reviewId,credentials:active(a),connections,pendingEmailChange:Boolean(a.pendingChange),kitGeneration:a.kitGeneration,expiresAt:s.now+bounds.reviewMs,accountRecoveryOnly:true};
  },
  /** One-time kit offer bound to the review; plaintext returned once, verifier stored. */
  prepareKit(auth,input){
   closed(input,['version','reviewId']);
   const a=account(principal(auth,{fresh:true}).accountId),r=s.reviews[input.reviewId];
   check(r&&r.accountId===a.id,'UNKNOWN_REVIEW');
   const key=newSecret(),offerId=id('kit');s.offers[offerId]={id:offerId,accountId:a.id,reviewId:r.id,verifier:sha256(key)};
   return {offerId,key};
  },
  commitCompromiseReview(auth,input){
   closed(input,['version','requestId','reviewId','revokeCredentials','rotateKit','revokeConnections']);
   const a=account(principal(auth,{fresh:true}).accountId),rid=requestId(input.requestId);
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
   const pending=a.pendingChange&&s.changes[a.pendingChange];
   if(pending&&pending.status==='pending'){pending.status='cancelled';a.pendingChange=null;}
   if(offer){a.kitVerifier=offer.verifier;a.kitGeneration++;delete s.offers[offer.id];}
   for(const k of revokeConnections){const c=s.connections[k];c.access='disabled';c.revocation={state:'queued',reads:0,since:null,receipt:null};}
   enqueue({kind:'security-review-completed',to:a.email});
   const response=Object.freeze({reviewId:review.id,epoch:a.epoch,stage:a.stage,revokedCredentials:revokeCredentials,kitRotated:Boolean(offer),
    connections:revokeConnections.map(k=>({connectionId:k,access:'disabled',revocation:'queued'})),sessionsRevoked:'all',accountRecoveryOnly:true});
   s.receipts[r.key]={hash:r.hash,response};
   return response;
  },

  // ---------- provider connections: revoke at the provider before local erasure ----------
  useConnection(auth,input){
   closed(input,['version','connectionId']);
   const a=account(principal(auth).accountId),c=s.connections[input.connectionId];
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
