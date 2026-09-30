import {createHash} from 'node:crypto';
const opaque=/^[a-zA-Z0-9_.:-]{1,128}$/;
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const kinds=['verified_benign','uncertain_flag','confirmed_violation','confirmed_evasion','critical_incident'];
export function contentRiskReviewInput(raw){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>4096)throw Error('Invalid safety review input');
 const v=JSON.parse(raw);
 if(!v||typeof v!=='object'||Array.isArray(v)||!['read','record','reverse'].includes(v.action))throw Error('Invalid safety action');
 const fields=v.action==='read'?['action','account']:v.action==='record'?['action','account','id','incident','kind','occurredAt','evidenceRef','reviewerRef','reviewed']:['action','account','incident','evidenceRef','reviewerRef','reviewed'];
 if(Object.keys(v).some(k=>!fields.includes(k))||fields.some(k=>!Object.hasOwn(v,k))||typeof v.account!=='string'||!uuid.test(v.account))throw Error('Invalid safety review fields');
 if(v.action!=='read'){
  if(v.reviewed!==true)throw Error('Independent review required');
  for(const field of ['incident','evidenceRef','reviewerRef',...(v.action==='record'?['id']:[])])if(typeof v[field]!=='string'||!opaque.test(v[field]))throw Error('Use opaque case references');
  if(v.action==='record'&&(!kinds.includes(v.kind)||!Number.isSafeInteger(v.occurredAt)||v.occurredAt<0||v.occurredAt>Date.now()))throw Error('Invalid evidence classification or occurrence time');
 }
 return Object.fromEntries(fields.map(k=>[k,v[k]]));
}

/** Operator authority comes from D1 access, not the preview digest or reviewed flag.
 * The digest binds the precise proposed mutation, not a forecast score or stale history. */
export async function runContentRiskReview(service,assess,db,input,apply){
 input=contentRiskReviewInput(JSON.stringify(input));
 const digest=createHash('sha256').update(JSON.stringify({version:1,input})).digest('hex');
 if(apply!==undefined&&(input.action==='read'||apply!==digest))throw Error('Preview the exact safety decision before applying its digest');
 const report=async()=>{
  const history=await service.readContentRiskHistory(db,input.account);
  return {account:input.account,evidenceCount:history.events.length,risk:assess(history),enforcementEnabled:false};
 };
 const current=await report();
 if(input.action==='read')return current;
 if(apply===undefined)return {preview:true,request:input,current,applyDigest:digest,
  notice:input.action==='reverse'?'Corrects all evidence for this owned incident, including later duplicate receipts. Does not delete the audit history or change customer access.':'Records independently reviewed evidence. A refusal, a keyword or high usage alone is not a confirmed violation. Does not change customer access.'};
 if(input.action==='record')await service.recordContentRiskEvidence(db,{id:input.id,userId:input.account,incidentId:input.incident,kind:input.kind,occurredAt:input.occurredAt,evidenceRef:input.evidenceRef,reviewerRef:input.reviewerRef});
 else await service.reverseContentRiskIncident(db,input.account,input.incident,input.evidenceRef,input.reviewerRef);
 // If this read fails after the write, retry the same input/digest; the ledger is idempotent.
 return {recorded:true,action:input.action,...await report()};
}
