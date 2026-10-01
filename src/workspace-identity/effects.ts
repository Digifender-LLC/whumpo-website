import {hashToken} from '../security';
import {IdentityError,assertCurrentIdentity,identityPredicate,type IdentityPrincipal,type IdentityPolicy} from './authority';
import {identityRecord,identityChanged,invalidIdentityRequest,identityUUID} from './protocol';

export type Intent={requestId:string;attemptId:string|null;expectedRevision:number;expectedEpoch:number};
export type OfferIntent=Intent&{offerId:string;generation:number};
export type Kind='kit_prepare'|'kit_save'|'kit_rotate'|'enrollment_complete'|'enrollment_cancel'|'recovery_start'|'recovery_review'|'recovery_secure'|'recovery_complete'|'passkey_remove';
type Receipt={id:string;kind:Kind;request_hash:string;offer_id:string|null;kit_generation:number|null;attempt_id:string|null;created_at:number};
const baseFields=['version','requestId','attemptId','expectedRevision','expectedEpoch'];
export const receiptGate='EXISTS(SELECT 1 FROM identity_effect_receipts WHERE id=? AND execution_nonce=?)';
export const readPolicy=(p:IdentityPrincipal):IdentityPolicy=>({purpose:p.purpose,freshPasskey:false,bindIdentityRevision:false});
export const actionPolicy=(p:IdentityPrincipal,freshPasskey:boolean):IdentityPolicy=>({purpose:p.purpose,freshPasskey,bindIdentityRevision:true});
const conflict=()=>new IdentityError(409,'request_conflict','This request ID already belongs to a different change.');
export function parse(input:unknown,extra:string[]=[]){
 const data=identityRecord(input,[...baseFields,...extra]);
 if(typeof data.requestId!=='string'||!identityUUID.test(data.requestId)
  ||(data.attemptId!==null&&(typeof data.attemptId!=='string'||!identityUUID.test(data.attemptId)))
  ||typeof data.expectedRevision!=='number'||!Number.isSafeInteger(data.expectedRevision)||data.expectedRevision<0
  ||typeof data.expectedEpoch!=='number'||!Number.isSafeInteger(data.expectedEpoch)||data.expectedEpoch<1)throw invalidIdentityRequest();
 const intent:Intent={requestId:data.requestId,attemptId:data.attemptId,expectedRevision:data.expectedRevision,expectedEpoch:data.expectedEpoch};
 return {intent,data};
}
export function offerIntent(input:unknown,extra:string[]=[]):{intent:OfferIntent;data:Record<string,unknown>}{
 const {intent,data}=parse(input,['offerId','generation',...extra]);
 if(typeof data.offerId!=='string'||!identityUUID.test(data.offerId)||typeof data.generation!=='number'||!Number.isSafeInteger(data.generation)||data.generation<1)throw invalidIdentityRequest();
 return {intent:{...intent,offerId:data.offerId,generation:data.generation},data};
}
export function expected(p:IdentityPrincipal,input:Intent){
 if(input.attemptId!==(p.attempt?.id??null)||input.expectedRevision!==(p.attempt?.revision??p.credentialRevision)||input.expectedEpoch!==p.authEpoch)throw identityChanged();
}
export const requestHash=(kind:Kind,p:IdentityPrincipal,intent:Intent|OfferIntent)=>hashToken(JSON.stringify([kind,p.accountId,intent]));
const publicReceipt=(r:Receipt)=>({operationId:r.id,kind:r.kind,offerId:r.offer_id,generation:r.kit_generation,attemptId:r.attempt_id,completedAt:r.created_at});
export async function replay(db:D1Database,p:IdentityPrincipal,id:string,hash:string,kind:Kind){
 await assertCurrentIdentity(db,p,readPolicy(p));
 const gate=identityPredicate(db,p,readPolicy(p));
 const receipt=await db.prepare(`SELECT id,kind,request_hash,offer_id,kit_generation,attempt_id,created_at FROM identity_effect_receipts WHERE id=? AND account_id=? AND ${gate.sql}`).bind(id,p.accountId,...gate.params).first<Receipt>();
 if(receipt){if(receipt.kind!==kind||receipt.request_hash!==hash)throw conflict();return publicReceipt(receipt);}
 if(await db.prepare('SELECT 1 FROM identity_effect_receipts WHERE id=? UNION ALL SELECT 1 FROM identity_ceremony_receipts WHERE id=? LIMIT 1').bind(id,id).first())throw conflict();
 return null;
}
export async function committedReceipt(db:D1Database,p:IdentityPrincipal,id:string){
 const receipt=await db.prepare('SELECT id,kind,request_hash,offer_id,kit_generation,attempt_id,created_at FROM identity_effect_receipts WHERE id=? AND account_id=?').bind(id,p.accountId).first<Receipt>();
 if(!receipt)throw identityChanged();return publicReceipt(receipt);
}
