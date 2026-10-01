import {hashToken,newSessionToken} from '../security';
import {IdentityError,assertCurrentIdentity,identityPredicate,resolveIdentity,type IdentityPrincipal,type IdentityPolicy} from './authority';
import {identityRequestContext,identityDatabaseError,identityChanged,invalidIdentityRequest,type IdentityEnvironment} from './protocol';
import {recoveryKitFilename,recoveryKitText} from './kit-document';
import {parse,offerIntent,expected,requestHash,replay,committedReceipt,receiptGate,readPolicy,actionPolicy} from './effects';

type Offer={id:string;account_id:string;purpose:IdentityPrincipal['purpose'];attempt_id:string|null;auth_epoch:number;credential_revision:number;
 attempt_revision:number|null;generation:number;verifier:string;created_at:number;expires_at:number;saved_at:number|null};
const publicOffer=(o:Offer)=>({id:o.id,generation:o.generation,attemptId:o.attempt_id,expectedRevision:o.attempt_revision??o.credential_revision,
 expectedEpoch:o.auth_epoch,createdAt:o.created_at,expiresAt:o.expires_at,saved:o.saved_at!==null});

/** Current non-secret state only. Neither the active key nor an offer verifier is returned. */
export async function readKitState(db:D1Database,p:IdentityPrincipal){
 const gate=identityPredicate(db,p,readPolicy(p));
 // One guarded snapshot cannot mix a pre-rotation generation with a later offer.
 const state=await db.prepare(`SELECT a.kit_generation AS active_generation,o.* FROM identity_accounts a
  LEFT JOIN identity_current_kit_offers o ON o.account_id=a.account_id AND o.purpose=?
  WHERE a.account_id=? AND ${gate.sql}`).bind(p.purpose,p.accountId,...gate.params).first<{active_generation:number}&(Offer|{id:null})>();
 if(!state)throw identityChanged();
 return {activeGeneration:state.active_generation,offer:state.id===null?null:publicOffer(state)};
}
export async function prepareKit(request:Request,env:IdentityEnvironment,p:IdentityPrincipal,input:unknown){
 identityRequestContext(request,env);const {intent}=parse(input),hash=await requestHash('kit_prepare',p,intent),db=env.DB;
 const prior=await replay(db,p,intent.requestId,hash,'kit_prepare');if(prior)return {receipt:prior,offer:null,key:null,filename:null,text:null};
 expected(p,intent);
 // A zero-key account may be recovering before it has secured an attempt. Its
 // current kit can prepare the initial replacement; replacing a secured saved kit needs a passkey. A new explicit loss review uses recovery authority.
 const secured=p.purpose==='recovery'&&!!await db.prepare(
  "SELECT 1 FROM identity_attempts t JOIN identity_recovery_reviews r ON r.attempt_id=t.id AND r.account_id=t.account_id WHERE t.id=? AND t.account_id=? AND t.status='secured' AND r.kit_generation IS NOT NULL"
 ).bind(p.attempt!.id,p.accountId).first();
 const policy=actionPolicy(p,p.purpose==='workspace'||secured);
 await assertCurrentIdentity(db,p,policy);const gate=identityPredicate(db,p,policy);
 const offerId=crypto.randomUUID(),nonce=crypto.randomUUID(),key=newSessionToken(),verifier=await hashToken(key);
 try{
  const result=await db.batch([
   db.prepare(`INSERT INTO identity_effect_receipts SELECT ?,?,account_id,'kit_prepare',?,?,kit_generation+1,?,unixepoch() FROM identity_accounts WHERE account_id=? AND ${gate.sql} RETURNING id`)
    .bind(intent.requestId,nonce,hash,offerId,p.attempt?.id??null,p.accountId,...gate.params),
   db.prepare(`DELETE FROM identity_kit_offers WHERE account_id=? AND ${receiptGate}`).bind(p.accountId,intent.requestId,nonce),
   db.prepare(`UPDATE identity_attempts SET revision=revision+1 WHERE id=? AND account_id=? AND ${receiptGate}`).bind(p.attempt?.id??null,p.accountId,intent.requestId,nonce),
   db.prepare(`INSERT INTO identity_kit_offers SELECT ?,a.account_id,?,t.id,a.auth_epoch,a.credential_revision,t.revision,a.kit_generation+1,?,unixepoch(),unixepoch()+1800,NULL
    FROM identity_accounts a LEFT JOIN identity_attempts t ON t.id=? AND t.account_id=a.account_id WHERE a.account_id=? AND ${receiptGate} RETURNING id`)
    .bind(offerId,p.purpose,verifier,p.attempt?.id??null,p.accountId,intent.requestId,nonce)
  ]);
  if(result[0].results.length!==1||result[3].results.length!==1)throw identityChanged();
 }catch(error){
  if(/UNIQUE/.test(String(error))||(error instanceof IdentityError&&error.code==='identity_changed')){const prior=await replay(db,p,intent.requestId,hash,'kit_prepare');if(prior)return {receipt:prior,offer:null,key:null,filename:null,text:null};}
  identityDatabaseError(error);
 }
 // Preparing changed the attempt revision; this read validates current authority without reusing that old review.
 const readGate=identityPredicate(db,p,readPolicy(p));
 const offer=await db.prepare(`SELECT o.*,u.email FROM identity_current_kit_offers o JOIN users u ON u.id=o.account_id WHERE o.id=? AND o.account_id=? AND ${readGate.sql}`)
  .bind(offerId,p.accountId,...readGate.params).first<Offer&{email:string}>();
 if(!offer)throw identityChanged();
 return {receipt:await committedReceipt(db,p,intent.requestId),offer:publicOffer(offer),key,filename:recoveryKitFilename,
  text:recoveryKitText({key,accountLabel:offer.email,generation:offer.generation,offerId,createdAt:offer.created_at})};
}
export async function acknowledgeKit(request:Request,env:IdentityEnvironment,p:IdentityPrincipal,input:unknown){
 identityRequestContext(request,env);const {intent,data}=offerIntent(input,['saved']);if(data.saved!==true)throw invalidIdentityRequest();
 const hash=await requestHash('kit_save',p,intent),db=env.DB,prior=await replay(db,p,intent.requestId,hash,'kit_save');if(prior)return {receipt:prior};
 expected(p,intent);const gate=identityPredicate(db,p,actionPolicy(p,false)),nonce=crypto.randomUUID();
 try{
  const result=await db.batch([
   db.prepare(`INSERT INTO identity_effect_receipts SELECT ?,?,account_id,'kit_save',?,id,generation,attempt_id,unixepoch() FROM identity_current_kit_offers
    WHERE id=? AND account_id=? AND purpose=? AND generation=? AND ${gate.sql} RETURNING id`)
    .bind(intent.requestId,nonce,hash,intent.offerId,p.accountId,p.purpose,intent.generation,...gate.params),
   db.prepare(`UPDATE identity_kit_offers SET saved_at=COALESCE(saved_at,unixepoch()) WHERE id=? AND account_id=? AND ${receiptGate} RETURNING id`)
    .bind(intent.offerId,p.accountId,intent.requestId,nonce)
  ]);
  if(result[0].results.length!==1||result[1].results.length!==1)throw identityChanged();
 }catch(error){
  if(/UNIQUE/.test(String(error))){const prior=await replay(db,p,intent.requestId,hash,'kit_save');if(prior)return {receipt:prior};}
  identityDatabaseError(error);
 }
 return {receipt:await committedReceipt(db,p,intent.requestId)};
}

export async function rotateKit(request:Request,env:IdentityEnvironment,p:IdentityPrincipal,input:unknown){
 identityRequestContext(request,env);const {intent}=offerIntent(input),hash=await requestHash('kit_rotate',p,intent),db=env.DB;
 const prior=await replay(db,p,intent.requestId,hash,'kit_rotate');if(prior)return {receipt:prior,authority:null};
 expected(p,intent);
 if(p.purpose==='enrollment')throw new IdentityError(403,'identity_incomplete','Finish enrollment to activate its saved kit.');
 const restricted=p.purpose==='recovery',policy:IdentityPolicy={purpose:p.purpose,freshPasskey:true,bindIdentityRevision:true};
 if(restricted){
  await assertCurrentIdentity(db,p,actionPolicy(p,false));
  if(!await db.prepare("SELECT 1 FROM identity_recovery_reviews r JOIN identity_attempts t ON t.id=r.attempt_id AND t.account_id=r.account_id WHERE r.attempt_id=? AND r.account_id=? AND t.status='secured' AND r.kit_generation=t.kit_generation AND r.kit_saved_at IS NOT NULL").bind(p.attempt!.id,p.accountId).first())throw new IdentityError(403,'identity_incomplete','Secure the reviewed recovery before replacing its current kit.');
 }
 await assertCurrentIdentity(db,p,policy);const gate=identityPredicate(db,p,policy),nonce=crypto.randomUUID(),token=restricted?newSessionToken():null;
 const secured=restricted?` AND EXISTS(SELECT 1 FROM identity_recovery_reviews r JOIN identity_attempts t ON t.id=r.attempt_id AND t.account_id=r.account_id
  JOIN identity_accounts a ON a.account_id=r.account_id WHERE r.attempt_id=identity_current_kit_offers.attempt_id AND r.account_id=identity_current_kit_offers.account_id
   AND t.status='secured' AND a.current_attempt_id=t.id AND r.kit_generation=a.kit_generation AND r.kit_saved_at IS NOT NULL)`:'';
 try{
  const result=await db.batch([
   db.prepare(`INSERT INTO identity_effect_receipts SELECT ?,?,account_id,'kit_rotate',?,id,generation,attempt_id,unixepoch() FROM identity_current_kit_offers
    WHERE id=? AND account_id=? AND purpose=? AND generation=? AND saved_at IS NOT NULL${secured} AND ${gate.sql} RETURNING id`)
    .bind(intent.requestId,nonce,hash,intent.offerId,p.accountId,p.purpose,intent.generation,...gate.params),
   db.prepare(`UPDATE identity_accounts SET kit_verifier=(SELECT verifier FROM identity_kit_offers WHERE id=? AND account_id=?),kit_generation=?,auth_epoch=auth_epoch+1
    WHERE account_id=? AND ${receiptGate} RETURNING account_id`).bind(intent.offerId,p.accountId,intent.generation,p.accountId,intent.requestId,nonce),
   db.prepare(`DELETE FROM identity_sessions WHERE account_id=?${restricted?'':' AND id!=?'} AND ${receiptGate}`).bind(p.accountId,...(restricted?[]:[p.authorityId]),intent.requestId,nonce),
   db.prepare(`DELETE FROM identity_grants WHERE account_id=? AND ${receiptGate}`).bind(p.accountId,intent.requestId,nonce),
   db.prepare(`DELETE FROM identity_challenges WHERE account_id=? AND ${receiptGate}`).bind(p.accountId,intent.requestId,nonce),
   ...(restricted?[
    db.prepare(`UPDATE identity_attempts SET auth_epoch=(SELECT auth_epoch FROM identity_accounts WHERE account_id=?),kit_generation=?,revision=revision+1
     WHERE id=? AND account_id=? AND ${receiptGate}`).bind(p.accountId,intent.generation,p.attempt!.id,p.accountId,intent.requestId,nonce),
    db.prepare(`UPDATE identity_recovery_reviews SET kit_generation=?,kit_saved_at=(SELECT saved_at FROM identity_kit_offers WHERE id=?),secured_at=unixepoch()
     WHERE attempt_id=? AND account_id=? AND ${receiptGate}`).bind(intent.generation,intent.offerId,p.attempt!.id,p.accountId,intent.requestId,nonce),
    db.prepare(`INSERT INTO identity_grants SELECT ?,?,account_id,1,auth_epoch,'web','recovery',id,'passkey',?,?,?,NULL,unixepoch(),?
     FROM identity_attempts WHERE id=? AND account_id=? AND ${receiptGate} RETURNING id`)
     .bind(crypto.randomUUID(),await hashToken(token!),p.proof.verifiedAt,p.proof.attemptRevision,p.proof.credentialId,p.expiresAt,p.attempt!.id,p.accountId,intent.requestId,nonce)
   ]:[
    db.prepare(`UPDATE identity_attempts SET status='cancelled',revision=revision+1 WHERE account_id=? AND status IN ('open','secured') AND ${receiptGate}`).bind(p.accountId,intent.requestId,nonce),
    db.prepare(`UPDATE identity_sessions SET auth_epoch=(SELECT auth_epoch FROM identity_accounts WHERE account_id=?) WHERE id=? AND account_id=? AND ${receiptGate} RETURNING id`)
     .bind(p.accountId,p.authorityId,p.accountId,intent.requestId,nonce)
   ]),
   db.prepare(`DELETE FROM identity_kit_offers WHERE account_id=? AND ${receiptGate}`).bind(p.accountId,intent.requestId,nonce)
  ]);
  if(result[0].results.length!==1||result[1].results.length!==1||result[restricted?7:6].results.length!==1)throw identityChanged();
 }catch(error){identityDatabaseError(error);}
 return {receipt:await committedReceipt(db,p,intent.requestId),authority:restricted?{kind:'grant' as const,token:token!,principal:await resolveIdentity(db,{version:1,client:'web',kind:'grant',token:token!})}:null};
}

export async function completeEnrollment(request:Request,env:IdentityEnvironment,p:IdentityPrincipal,input:unknown){
 identityRequestContext(request,env);const {intent}=offerIntent(input),hash=await requestHash('enrollment_complete',p,intent),db=env.DB;
 const prior=await replay(db,p,intent.requestId,hash,'enrollment_complete');if(prior)return {receipt:prior,authority:null};
 expected(p,intent);const policy:IdentityPolicy={purpose:'enrollment',freshPasskey:true,bindIdentityRevision:true};
 await assertCurrentIdentity(db,p,policy);const gate=identityPredicate(db,p,policy),nonce=crypto.randomUUID(),token=newSessionToken(),sessionId=crypto.randomUUID();
 try{
  const result=await db.batch([
   db.prepare(`INSERT INTO identity_effect_receipts SELECT ?,?,o.account_id,'enrollment_complete',?,o.id,o.generation,o.attempt_id,unixepoch() FROM identity_current_kit_offers o
    WHERE o.id=? AND o.account_id=? AND o.purpose='enrollment' AND o.generation=? AND o.saved_at IS NOT NULL
     AND (SELECT count(*) FROM identity_credentials WHERE account_id=o.account_id AND attempt_id=o.attempt_id AND status='staged')>=2 AND ${gate.sql} RETURNING id`)
    .bind(intent.requestId,nonce,hash,intent.offerId,p.accountId,intent.generation,...gate.params),
   db.prepare(`UPDATE identity_attempts SET status='complete',revision=revision+1,kit_generation=? WHERE id=? AND account_id=? AND ${receiptGate}`)
    .bind(intent.generation,intent.attemptId,p.accountId,intent.requestId,nonce),
   db.prepare(`UPDATE identity_credentials SET status='active' WHERE account_id=? AND attempt_id=? AND status='staged' AND ${receiptGate}`)
    .bind(p.accountId,intent.attemptId,intent.requestId,nonce),
   db.prepare(`UPDATE identity_accounts SET stage='ready',current_attempt_id=NULL,kit_generation=?,kit_verifier=(SELECT verifier FROM identity_kit_offers WHERE id=? AND account_id=?),completion_receipt_id=?
    WHERE account_id=? AND ${receiptGate} RETURNING account_id`).bind(intent.generation,intent.offerId,p.accountId,intent.requestId,p.accountId,intent.requestId,nonce),
   db.prepare(`DELETE FROM identity_grants WHERE account_id=? AND ${receiptGate}`).bind(p.accountId,intent.requestId,nonce),
   db.prepare(`DELETE FROM identity_challenges WHERE account_id=? AND ${receiptGate}`).bind(p.accountId,intent.requestId,nonce),
   db.prepare(`DELETE FROM identity_sessions WHERE account_id=? AND ${receiptGate}`).bind(p.accountId,intent.requestId,nonce),
   db.prepare(`DELETE FROM identity_kit_offers WHERE account_id=? AND ${receiptGate}`).bind(p.accountId,intent.requestId,nonce),
   db.prepare(`INSERT INTO identity_sessions SELECT ?,?,account_id,1,auth_epoch,'web',?,'passkey',?,unixepoch(),? FROM identity_accounts WHERE account_id=? AND ${receiptGate} RETURNING id`)
    .bind(sessionId,await hashToken(token),p.proof.credentialId,p.proof.verifiedAt,p.proof.verifiedAt+604800,p.accountId,intent.requestId,nonce)
  ]);
  if(result[0].results.length!==1||result[8].results.length!==1)throw identityChanged();
 }catch(error){identityDatabaseError(error);}
 return {receipt:await committedReceipt(db,p,intent.requestId),authority:{kind:'session' as const,token,principal:await resolveIdentity(db,{version:1,client:'web',kind:'session',token})}};
}

export async function cancelEnrollment(request:Request,env:IdentityEnvironment,p:IdentityPrincipal,input:unknown){
 identityRequestContext(request,env);const {intent,data}=parse(input,['confirmation']);if(data.confirmation!=='cancel-enrollment')throw invalidIdentityRequest();
 const hash=await requestHash('enrollment_cancel',p,intent),db=env.DB;
 await replay(db,p,intent.requestId,hash,'enrollment_cancel');expected(p,intent);
 const gate=identityPredicate(db,p,{purpose:'enrollment',freshPasskey:false,bindIdentityRevision:true}),nonce=crypto.randomUUID();
 try{
  const result=await db.batch([
   db.prepare(`INSERT INTO identity_effect_receipts SELECT ?,?,?,'enrollment_cancel',?,NULL,NULL,?,unixepoch() WHERE ${gate.sql} RETURNING id`)
    .bind(intent.requestId,nonce,p.accountId,hash,intent.attemptId,...gate.params),
   db.prepare(`DELETE FROM users WHERE id=? AND ${receiptGate} RETURNING id`).bind(p.accountId,intent.requestId,nonce)
  ]);
  if(result[0].results.length!==1||result[1].results.length!==1)throw identityChanged();
 }catch(error){identityDatabaseError(error);}
 // Deleted identity has no continuing authority. A receipt cannot sign it back in.
 return {operationId:intent.requestId,cancelled:true};
}
