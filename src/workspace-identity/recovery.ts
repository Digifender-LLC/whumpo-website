import {generateAuthenticationOptions} from '@simplewebauthn/server';
import {hashToken,newSessionToken} from '../security';
import {IdentityError,assertCurrentIdentity,identityPredicate,resolveIdentity,type IdentityPrincipal,type IdentityPolicy} from './authority';
import {identityRecord,identityRequestContext,identityDatabaseError,identityChanged,invalidIdentityRequest,identityUUID,type IdentityEnvironment} from './protocol';
import {parse,offerIntent,expected,requestHash,replay,committedReceipt,receiptGate} from './effects';
import {cleanIdentityCeremonies,saveIdentityChallenge,consumeIdentityChallenge,boundIdentityChallenge,verifyIdentityAssertion} from './ceremonies';

type Review={attempt_id:string;account_id:string;review_id:string;loss_mode:'all'|'some'|'none';credential_revision:number;lost_ids:string;retained_ids:string;reviewed_at:number;kit_generation:number|null;kit_saved_at:number|null;secured_at:number|null};
const recoveryPolicy:IdentityPolicy={purpose:'recovery',freshPasskey:false,bindIdentityRevision:true};
const invalidProof=()=>new IdentityError(401,'proof_required','Account recovery could not be verified. Check your current kit and try again.');
const encoder=new TextEncoder();
const publicReview=(r:Review)=>({id:r.review_id,mode:r.loss_mode,lostIds:JSON.parse(r.lost_ids) as string[],retainedIds:JSON.parse(r.retained_ids) as string[],generation:r.kit_generation,savedAt:r.kit_saved_at,secured:r.secured_at!==null});
async function grant(db:D1Database,token:string){return {kind:'grant' as const,token,principal:await resolveIdentity(db,{version:1,client:'web',kind:'grant',token})};}

/** A current kit proves only restricted recovery. It never issues a workspace session. */
export async function startRecovery(request:Request,env:IdentityEnvironment,input:unknown){
 identityRequestContext(request,env);const data=identityRecord(input,['version','email','key']);
 if(typeof data.email!=='string'||data.email.length>254||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())
  ||typeof data.key!=='string'||!/^[a-f0-9]{64}$/.test(data.key))throw invalidProof();
 const db=env.DB,verifier=await hashToken(data.key),a=await db.prepare(`SELECT a.account_id,a.auth_epoch,a.kit_generation,a.kit_verifier FROM identity_accounts a
  JOIN users u ON u.id=a.account_id WHERE u.email=? AND a.policy_version=1 AND a.stage IN ('ready','recovering') AND a.kit_generation>0`)
  .bind(data.email.trim().toLowerCase()).first<{account_id:string;auth_epoch:number;kit_generation:number;kit_verifier:string}>();
 const equal=crypto.subtle.timingSafeEqual(encoder.encode(verifier),encoder.encode(a?.kit_verifier??'0'.repeat(64)));
 if(!a||!equal)throw invalidProof();
 await cleanIdentityCeremonies(db);
 const operationId=crypto.randomUUID(),nonce=crypto.randomUUID(),attemptId=crypto.randomUUID(),token=newSessionToken(),grantId=crypto.randomUUID();
 try{
  const result=await db.batch([
   db.prepare(`INSERT INTO identity_effect_receipts SELECT ?,?,a.account_id,'recovery_start',?,NULL,a.kit_generation,NULL,unixepoch() FROM identity_accounts a
    WHERE a.account_id=? AND a.auth_epoch=? AND a.kit_generation=? AND a.kit_verifier=? AND a.policy_version=1 AND a.stage IN ('ready','recovering')
     AND ((a.current_attempt_id IS NULL AND NOT EXISTS(SELECT 1 FROM identity_attempts t WHERE t.account_id=a.account_id AND t.status IN ('open','secured')))
      OR EXISTS(SELECT 1 FROM identity_attempts t WHERE t.account_id=a.account_id AND t.kind='recovery' AND t.auth_epoch=a.auth_epoch AND t.kit_generation=a.kit_generation
       AND ((t.status='open' AND a.current_attempt_id IS NULL) OR (t.status='secured' AND a.stage='recovering' AND a.current_attempt_id=t.id)))) RETURNING account_id`)
    .bind(operationId,nonce,await hashToken(JSON.stringify(['recovery_start',a.account_id,operationId])),a.account_id,a.auth_epoch,a.kit_generation,verifier),
   db.prepare(`INSERT INTO identity_attempts SELECT ?,account_id,'recovery','open',0,auth_epoch,kit_generation,unixepoch() FROM identity_accounts a
    WHERE account_id=? AND NOT EXISTS(SELECT 1 FROM identity_attempts t WHERE t.account_id=a.account_id AND t.status IN ('open','secured')) AND ${receiptGate}`)
    .bind(attemptId,a.account_id,operationId,nonce),
   db.prepare(`INSERT INTO identity_grants SELECT ?,?,t.account_id,1,t.auth_epoch,'web','recovery',t.id,'recovery-key',unixepoch(),t.revision,NULL,t.kit_generation,unixepoch(),unixepoch()+1800
    FROM identity_attempts t WHERE t.account_id=? AND t.kind='recovery' AND t.status IN ('open','secured') AND ${receiptGate} RETURNING id`)
    .bind(grantId,await hashToken(token),a.account_id,operationId,nonce)
  ]);
  if(result[0].results.length!==1||result[2].results.length!==1)throw invalidProof();
 }catch(error){identityDatabaseError(error);}
 return grant(db,token);
}

export async function readRecoveryState(db:D1Database,p:IdentityPrincipal){
 const gate=identityPredicate(db,p,{...recoveryPolicy,bindIdentityRevision:false});
 const state=await db.prepare(`SELECT a.auth_epoch,a.credential_revision,a.kit_generation,t.id,t.revision,t.status FROM identity_accounts a
  JOIN identity_attempts t ON t.account_id=a.account_id AND t.id=? WHERE a.account_id=? AND ${gate.sql}`).bind(p.attempt!.id,p.accountId,...gate.params)
  .first<{auth_epoch:number;credential_revision:number;kit_generation:number;id:string;revision:number;status:string}>();
 if(!state)throw identityChanged();
 const review=await db.prepare(`SELECT * FROM identity_recovery_reviews WHERE attempt_id=? AND account_id=? AND ${gate.sql}`).bind(state.id,p.accountId,...gate.params).first<Review>();
 const keys=await db.prepare(`SELECT id,name,status,created_at FROM identity_credentials WHERE account_id=? AND ${gate.sql} ORDER BY id`).bind(p.accountId,...gate.params).all<{id:string;name:string;status:string;created_at:number}>();
 // A concurrent semantic change requires a new state read, not a mixed inventory/review.
 await assertCurrentIdentity(db,p,recoveryPolicy);
 return {attemptId:state.id,expectedRevision:state.revision,expectedEpoch:state.auth_epoch,credentialRevision:state.credential_revision,generation:state.kit_generation,status:state.status,review:review?publicReview(review):null,keys:keys.results};
}

export async function reviewRecovery(request:Request,env:IdentityEnvironment,p:IdentityPrincipal,input:unknown){
 identityRequestContext(request,env);const parsed=parse(input,['mode','lostIds']),data=parsed.data;
 if(typeof data.mode!=='string'||!['all','some','none'].includes(data.mode)||!Array.isArray(data.lostIds)||data.lostIds.length>10
  ||data.lostIds.some(v=>typeof v!=='string'||!/^[A-Za-z0-9_-]{1,1024}$/.test(v))||new Set(data.lostIds).size!==data.lostIds.length)throw invalidIdentityRequest();
 const lostIds=[...data.lostIds as string[]].sort(),intent={...parsed.intent,mode:data.mode as Review['loss_mode'],lostIds};
 const db=env.DB,hash=await requestHash('recovery_review',p,intent),prior=await replay(db,p,intent.requestId,hash,'recovery_review');if(prior)return {receipt:prior};
 expected(p,intent);await assertCurrentIdentity(db,p,recoveryPolicy);
 const inventory=(await db.prepare("SELECT id FROM identity_credentials WHERE account_id=? AND status='active' ORDER BY id").bind(p.accountId).all<{id:string}>()).results.map(k=>k.id);
 const retained=inventory.filter(key=>!lostIds.includes(key));
 if(lostIds.some(key=>!inventory.includes(key))||(intent.mode==='all'&&retained.length!==0)
  ||(intent.mode==='none'&&(lostIds.length!==0||retained.length===0))||(intent.mode==='some'&&(lostIds.length===0||retained.length===0)))throw invalidIdentityRequest();
 const gate=identityPredicate(db,p,recoveryPolicy),nonce=crypto.randomUUID();
 try{
  const result=await db.batch([
   db.prepare(`INSERT INTO identity_effect_receipts SELECT ?,?,?,'recovery_review',?,NULL,NULL,?,unixepoch() WHERE ${gate.sql} RETURNING id`)
    .bind(intent.requestId,nonce,p.accountId,hash,intent.attemptId,...gate.params),
   db.prepare(`DELETE FROM identity_recovery_reviews WHERE attempt_id=? AND account_id=? AND ${receiptGate}`).bind(intent.attemptId,p.accountId,intent.requestId,nonce),
   db.prepare(`INSERT INTO identity_recovery_reviews SELECT ?,?,?,?,?,?,?,unixepoch(),NULL,NULL,NULL WHERE ${receiptGate}`)
    .bind(intent.attemptId,p.accountId,intent.requestId,intent.mode,p.credentialRevision,JSON.stringify(lostIds),JSON.stringify(retained),intent.requestId,nonce),
   db.prepare(`UPDATE identity_attempts SET revision=revision+1 WHERE id=? AND account_id=? AND ${receiptGate}`).bind(intent.attemptId,p.accountId,intent.requestId,nonce),
   db.prepare(`DELETE FROM identity_kit_offers WHERE account_id=? AND ${receiptGate}`).bind(p.accountId,intent.requestId,nonce)
  ]);
  if(result[0].results.length!==1)throw identityChanged();
 }catch(error){
  if(/UNIQUE/.test(String(error))||(error instanceof IdentityError&&error.code==='identity_changed')){const prior=await replay(db,p,intent.requestId,hash,'recovery_review');if(prior)return {receipt:prior};}
  identityDatabaseError(error);
 }
 return {receipt:await committedReceipt(db,p,intent.requestId)};
}

export async function secureRecovery(request:Request,env:IdentityEnvironment,p:IdentityPrincipal,input:unknown){
 identityRequestContext(request,env);const parsed=offerIntent(input,['reviewId','confirmation']);
 if(typeof parsed.data.reviewId!=='string'||!identityUUID.test(parsed.data.reviewId)||parsed.data.confirmation!=='secure-account')throw invalidIdentityRequest();
 const intent={...parsed.intent,reviewId:parsed.data.reviewId},db=env.DB,hash=await requestHash('recovery_secure',p,intent);
 const prior=await replay(db,p,intent.requestId,hash,'recovery_secure');if(prior)return {receipt:prior,authority:null};
 expected(p,intent);await assertCurrentIdentity(db,p,recoveryPolicy);
 const gate=identityPredicate(db,p,recoveryPolicy),nonce=crypto.randomUUID(),token=newSessionToken();
 try{
  const result=await db.batch([
   db.prepare(`INSERT INTO identity_effect_receipts SELECT ?,?,o.account_id,'recovery_secure',?,o.id,o.generation,o.attempt_id,unixepoch() FROM identity_current_kit_offers o
    JOIN identity_recovery_reviews r ON r.attempt_id=o.attempt_id AND r.account_id=o.account_id
    WHERE o.id=? AND o.account_id=? AND o.purpose='recovery' AND o.generation=? AND o.saved_at IS NOT NULL AND r.review_id=?
     AND r.credential_revision=o.credential_revision AND r.kit_generation IS NULL AND ${gate.sql} RETURNING id`)
    .bind(intent.requestId,nonce,hash,intent.offerId,p.accountId,intent.generation,intent.reviewId,...gate.params),
   ...['identity_sessions','identity_grants','identity_challenges'].map(table=>db.prepare(`DELETE FROM ${table} WHERE account_id=? AND ${receiptGate}`).bind(p.accountId,intent.requestId,nonce)),
   db.prepare(`DELETE FROM identity_credentials WHERE account_id=? AND status='active' AND id IN
    (SELECT value FROM identity_recovery_reviews r,json_each(r.lost_ids) WHERE r.attempt_id=? AND r.account_id=?) AND ${receiptGate}`)
    .bind(p.accountId,intent.attemptId,p.accountId,intent.requestId,nonce),
   db.prepare(`UPDATE identity_accounts SET stage='recovering',current_attempt_id=?,auth_epoch=auth_epoch+1,kit_generation=?,kit_verifier=(SELECT verifier FROM identity_kit_offers WHERE id=? AND account_id=?)
    WHERE account_id=? AND ${receiptGate}`).bind(intent.attemptId,intent.generation,intent.offerId,p.accountId,p.accountId,intent.requestId,nonce),
   db.prepare(`UPDATE identity_attempts SET status='secured',revision=revision+1,auth_epoch=(SELECT auth_epoch FROM identity_accounts WHERE account_id=?),kit_generation=?
    WHERE id=? AND account_id=? AND ${receiptGate}`).bind(p.accountId,intent.generation,intent.attemptId,p.accountId,intent.requestId,nonce),
   db.prepare(`UPDATE identity_recovery_reviews SET kit_generation=?,kit_saved_at=(SELECT saved_at FROM identity_kit_offers WHERE id=?),secured_at=unixepoch()
    WHERE attempt_id=? AND account_id=? AND ${receiptGate}`).bind(intent.generation,intent.offerId,intent.attemptId,p.accountId,intent.requestId,nonce),
   db.prepare(`DELETE FROM identity_kit_offers WHERE account_id=? AND ${receiptGate}`).bind(p.accountId,intent.requestId,nonce),
   db.prepare(`INSERT INTO identity_grants SELECT ?,?,account_id,1,auth_epoch,'web','recovery',id,'recovery-commit',?,revision,NULL,kit_generation,unixepoch(),?
    FROM identity_attempts WHERE id=? AND account_id=? AND ${receiptGate} RETURNING id`)
    .bind(crypto.randomUUID(),await hashToken(token),p.proof.verifiedAt,p.expiresAt,intent.attemptId,p.accountId,intent.requestId,nonce)
  ]);
  if(result[0].results.length!==1||result[9].results.length!==1)throw identityChanged();
 }catch(error){identityDatabaseError(error);}
 return {receipt:await committedReceipt(db,p,intent.requestId),authority:await grant(db,token)};
}

function completionIntent(input:unknown){
 const parsed=parse(input,['reviewId','generation']);
 if(typeof parsed.data.reviewId!=='string'||!identityUUID.test(parsed.data.reviewId)||typeof parsed.data.generation!=='number'||!Number.isSafeInteger(parsed.data.generation)||parsed.data.generation<1)throw invalidIdentityRequest();
 return {...parsed.intent,reviewId:parsed.data.reviewId,generation:parsed.data.generation};
}
export async function recoveryCompletionOptions(request:Request,env:IdentityEnvironment,p:IdentityPrincipal,input:unknown){
 const rp=identityRequestContext(request,env),intent=completionIntent(input),db=env.DB,hash=await requestHash('recovery_complete',p,intent);
 const prior=await replay(db,p,intent.requestId,hash,'recovery_complete');if(prior)return {completed:prior};
 expected(p,intent);await assertCurrentIdentity(db,p,recoveryPolicy);const gate=identityPredicate(db,p,recoveryPolicy);
 if(!await db.prepare(`SELECT 1 FROM identity_recovery_ready WHERE attempt_id=? AND account_id=? AND review_id=? AND kit_generation=? AND ${gate.sql}`)
  .bind(intent.attemptId,p.accountId,intent.reviewId,intent.generation,...gate.params).first())throw identityChanged();
 const keys=await db.prepare("SELECT id FROM identity_credentials WHERE account_id=? AND attempt_id=? AND status='staged' ORDER BY id").bind(p.accountId,intent.attemptId).all<{id:string}>();
 const options=await generateAuthenticationOptions({rpID:rp.rpID,userVerification:'required',allowCredentials:keys.results.map(key=>({id:key.id}))});
 await cleanIdentityCeremonies(db);
 return {options,...await saveIdentityChallenge(db,rp,'recovery_complete',options.challenge,{p,requestId:intent.requestId,requestHash:hash})};
}
export async function recoveryCompletionVerify(request:Request,env:IdentityEnvironment,p:IdentityPrincipal,challengeToken:unknown,input:unknown){
 const rp=identityRequestContext(request,env),db=env.DB,c=await consumeIdentityChallenge(db,challengeToken,'recovery_complete',rp),data=identityRecord(input,['version','credential']);
 boundIdentityChallenge(c,p);await assertCurrentIdentity(db,p,recoveryPolicy);
 const r=await db.prepare('SELECT * FROM identity_recovery_ready WHERE attempt_id=? AND account_id=?').bind(p.attempt!.id,p.accountId).first<Review>();if(!r)throw identityChanged();
 const intent={requestId:c.request_id,attemptId:p.attempt!.id,expectedRevision:p.attempt!.revision,expectedEpoch:p.authEpoch,reviewId:r.review_id,generation:r.kit_generation!};
 if(c.request_hash!==await requestHash('recovery_complete',p,intent)||c.created_at<r.kit_saved_at!)throw identityChanged();
 const {key,newCounter,verifiedAt}=await verifyIdentityAssertion(env,c,data.credential,p);
 if(key.status!=='staged'||key.credential_attempt_id!==p.attempt!.id)throw invalidProof();
 const gate=identityPredicate(db,p,recoveryPolicy),nonce=crypto.randomUUID(),token=newSessionToken(),sessionId=crypto.randomUUID();
 try{
  const result=await db.batch([
   db.prepare(`INSERT INTO identity_effect_receipts SELECT ?,?,k.account_id,'recovery_complete',?,NULL,r.kit_generation,r.attempt_id,unixepoch()
    FROM identity_authentication_candidates k JOIN identity_recovery_ready r ON r.account_id=k.account_id AND r.attempt_id=k.attempt_id
    WHERE k.id=? AND k.account_id=? AND k.status='staged' AND k.credential_attempt_id=r.attempt_id AND k.public_key=? AND k.counter=?
     AND r.review_id=? AND r.kit_generation=? AND r.kit_saved_at<=? AND ?>unixepoch() AND ?>unixepoch()-600 AND ${gate.sql} RETURNING id`)
    .bind(c.request_id,nonce,c.request_hash,key.id,p.accountId,new Uint8Array(key.public_key),key.counter,r.review_id,r.kit_generation,c.created_at,c.expires_at,verifiedAt,...gate.params),
   db.prepare(`UPDATE identity_credentials SET counter=?,last_used_at=? WHERE id=? AND account_id=? AND ${receiptGate}`).bind(newCounter,verifiedAt,key.id,p.accountId,c.request_id,nonce),
   db.prepare(`UPDATE identity_attempts SET status='complete',revision=revision+1 WHERE id=? AND account_id=? AND ${receiptGate}`).bind(intent.attemptId,p.accountId,c.request_id,nonce),
   db.prepare(`UPDATE identity_credentials SET status='active' WHERE account_id=? AND attempt_id=? AND status='staged' AND ${receiptGate}`).bind(p.accountId,intent.attemptId,c.request_id,nonce),
   db.prepare(`UPDATE identity_accounts SET stage='ready',current_attempt_id=NULL,completion_receipt_id=? WHERE account_id=? AND ${receiptGate}`).bind(c.request_id,p.accountId,c.request_id,nonce),
   ...['identity_grants','identity_challenges','identity_sessions','identity_kit_offers'].map(table=>db.prepare(`DELETE FROM ${table} WHERE account_id=? AND ${receiptGate}`).bind(p.accountId,c.request_id,nonce)),
   db.prepare(`INSERT INTO identity_sessions SELECT ?,?,account_id,1,auth_epoch,'web',?,'passkey',?,unixepoch(),? FROM identity_accounts
    WHERE account_id=? AND ${receiptGate} RETURNING id`).bind(sessionId,await hashToken(token),key.id,verifiedAt,verifiedAt+604800,p.accountId,c.request_id,nonce)
  ]);
  if(result[0].results.length!==1||result[9].results.length!==1)throw identityChanged();
 }catch(error){identityDatabaseError(error);}
 return {receipt:await committedReceipt(db,p,c.request_id),authority:{kind:'session' as const,token,principal:await resolveIdentity(db,{version:1,client:'web',kind:'session',token})}};
}

/** Exact emergency revocation is allowed even when no passkeys will remain. */
export async function removePasskey(request:Request,env:IdentityEnvironment,p:IdentityPrincipal,input:unknown){
 identityRequestContext(request,env);const parsed=parse(input,['credentialId','confirmation']);
 if(typeof parsed.data.credentialId!=='string'||!/^[A-Za-z0-9_-]{1,1024}$/.test(parsed.data.credentialId)||parsed.data.confirmation!=='remove-passkey')throw invalidIdentityRequest();
 const intent={...parsed.intent,credentialId:parsed.data.credentialId},db=env.DB,hash=await requestHash('passkey_remove',p,intent);
 const prior=await replay(db,p,intent.requestId,hash,'passkey_remove');if(prior)return {receipt:prior};
 expected(p,intent);
 if(p.purpose==='enrollment')throw new IdentityError(403,'identity_incomplete','Cancel pending enrollment or finish its setup.');
 const restricted=p.purpose==='recovery',policy:IdentityPolicy={purpose:p.purpose,freshPasskey:true,bindIdentityRevision:true};
 await assertCurrentIdentity(db,p,policy);
 if(restricted&&!await db.prepare("SELECT 1 FROM identity_attempts t JOIN identity_accounts a ON a.current_attempt_id=t.id AND a.account_id=t.account_id WHERE t.id=? AND t.account_id=? AND t.status='secured'").bind(p.attempt!.id,p.accountId).first())throw new IdentityError(403,'identity_incomplete','Use ordinary security controls before securing recovery.');
 const gate=identityPredicate(db,p,policy),nonce=crypto.randomUUID();
 try{
  const result=await db.batch([
   db.prepare(`INSERT INTO identity_effect_receipts SELECT ?,?,account_id,'passkey_remove',?,NULL,NULL,?,unixepoch() FROM identity_credentials
    WHERE id=? AND account_id=? AND (status='active' OR (status='staged' AND attempt_id=?)) AND ${gate.sql} RETURNING id`).bind(intent.requestId,nonce,hash,intent.attemptId,intent.credentialId,p.accountId,restricted?p.attempt!.id:null,...gate.params),
   ...['identity_sessions','identity_grants','identity_challenges','identity_kit_offers'].map(table=>db.prepare(`DELETE FROM ${table} WHERE account_id=? AND ${receiptGate}`).bind(p.accountId,intent.requestId,nonce)),
   ...(restricted?[]:[db.prepare(`UPDATE identity_attempts SET status='cancelled',revision=revision+1 WHERE account_id=? AND status IN ('open','secured') AND ${receiptGate}`).bind(p.accountId,intent.requestId,nonce)]),
   db.prepare(`DELETE FROM identity_credentials WHERE id=? AND account_id=? AND ${receiptGate}`).bind(intent.credentialId,p.accountId,intent.requestId,nonce),
   ...(restricted?[
    db.prepare(`UPDATE identity_accounts SET auth_epoch=auth_epoch+1 WHERE account_id=? AND ${receiptGate}`).bind(p.accountId,intent.requestId,nonce),
    db.prepare(`UPDATE identity_attempts SET auth_epoch=(SELECT auth_epoch FROM identity_accounts WHERE account_id=?),revision=revision+1 WHERE id=? AND account_id=? AND ${receiptGate}`).bind(p.accountId,p.attempt!.id,p.accountId,intent.requestId,nonce),
    db.prepare(`DELETE FROM identity_recovery_reviews WHERE attempt_id=? AND account_id=? AND ${receiptGate}`).bind(p.attempt!.id,p.accountId,intent.requestId,nonce)
   ]:[db.prepare(`UPDATE identity_accounts SET auth_epoch=auth_epoch+1,current_attempt_id=NULL,stage=CASE WHEN EXISTS(SELECT 1 FROM identity_credentials WHERE account_id=? AND status='active') THEN 'ready' ELSE 'recovering' END
    WHERE account_id=? AND ${receiptGate}`).bind(p.accountId,p.accountId,intent.requestId,nonce)])
  ]);
  if(result[0].results.length!==1)throw identityChanged();
 }catch(error){identityDatabaseError(error);}
 return {receipt:await committedReceipt(db,p,intent.requestId)};
}
