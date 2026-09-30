import {createHash} from 'node:crypto';
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const fail=()=>{throw Error('Invalid fair-use operator request');};
function keys(value,allowed,required=allowed){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k))||required.some(k=>!Object.hasOwn(value,k)))fail();}
function id(value){if(typeof value!=='string'||!uuid.test(value))fail();return value;}
function text(value,max){if(typeof value!=='string'||!value.trim()||value.length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value))fail();return value.trim();}
export function fairUseOperatorInput(raw){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>16384)fail();
 const v=JSON.parse(raw);if(!v||typeof v!=='object'||Array.isArray(v))fail();
 const base={action:v.action,account:id(v.account)};
 if(v.action==='list'){
  keys(v,['action','account','before'],['action','account']);
  if(v.before!==undefined){keys(v.before,['createdAt','id']);if(typeof v.before.createdAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v.before.createdAt)||!Number.isFinite(Date.parse(v.before.createdAt)))fail();base.before={createdAt:v.before.createdAt,id:id(v.before.id)};}
  return base;
 }
 if(v.action==='read'){keys(v,['action','account','id']);return {...base,id:id(v.id)};}
 if(v.action==='open'){
  keys(v,['action','account','id','plan','category','reviewer','context']);
  if(!['starter','personal','business','business-pro'].includes(v.plan)||!['unrelated_chat','project_churn','legitimate_capacity'].includes(v.category))fail();
  return {...base,id:id(v.id),plan:v.plan,category:v.category,reviewer:text(v.reviewer,100),context:text(v.context,2000)};
 }
 if(v.action==='resolve'){
  keys(v,['action','account','id','revision','outcome','reviewer','resolution']);
  if(v.revision!==0||!['legitimate_use','insufficient_evidence','confirmed_pattern'].includes(v.outcome))fail();
  return {...base,id:id(v.id),revision:0,outcome:v.outcome,reviewer:text(v.reviewer,100),resolution:text(v.resolution,2000)};
 }
 fail();
}
export function fairUseOperatorDigest(input){return createHash('sha256').update(JSON.stringify({version:1,policy:'site-maintenance-fair-use-v1',input})).digest('hex');}
export async function runFairUseOperator(service,db,input,apply){
 // Validate even when called outside the CLI, before any database access.
 input=fairUseOperatorInput(JSON.stringify(input));
 const mutation=['open','resolve'].includes(input.action),digest=fairUseOperatorDigest(input);
 if(apply!==undefined&&(!mutation||apply!==digest))throw Error('Preview this exact request before applying it');
 if(input.action==='list')return service.listFairUseReviews(db,input.account,input.before);
 if(input.action==='read')return {review:await service.readFairUseReview(db,input.account,input.id),enforcementEnabled:false};
 if(apply===undefined){
  let current=null;try{current=await service.readFairUseReview(db,input.account,input.id);}catch(error){if(error.status!==404||input.action==='resolve')throw error;}
  const observation=input.action==='open'&&!current?await service.previewFairUseReviewObservation(db,input.account,input.plan):undefined;
  return {preview:true,request:input,current,...(observation?{observation}:{}),applyDigest:digest,enforcementEnabled:false,notice:'Internal review only. No warning is delivered and no customer request is restricted.'};
 }
 if(input.action==='open')return service.openFairUseReview(db,input.account,input.id,{plan:input.plan,category:input.category,reviewer:input.reviewer,context:input.context});
 return service.resolveFairUseReview(db,input.account,input.id,{revision:input.revision,outcome:input.outcome,reviewer:input.reviewer,resolution:input.resolution});
}
