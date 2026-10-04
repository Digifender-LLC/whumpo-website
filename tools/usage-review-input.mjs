import {createHash} from 'node:crypto';
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
export function usageReviewInput(raw){
 if(typeof raw!=='string'||Buffer.byteLength(raw)>8192)throw Error('Invalid review input');
 const v=JSON.parse(raw),required=v?.action==='queue'?['action','state']:v?.action==='answer'?['action','account','id','response','operator']:v?.action==='read'?['action','account','id']:['action','account'];
 if(!v||typeof v!=='object'||Array.isArray(v)||!['read','list','answer','queue'].includes(v.action)||Object.keys(v).some(k=>!required.includes(k))||required.some(k=>!Object.hasOwn(v,k))||(v.action==='queue'?!['open','answered'].includes(v.state):typeof v.account!=='string'||!uuid.test(v.account))||v.id!==undefined&&(typeof v.id!=='string'||!uuid.test(v.id)))throw Error('Invalid review input');
 if(v.action==='answer')for(const [key,max]of [['response',2000],['operator',100]])if(typeof v[key]!=='string'||!v[key].trim()||v[key].length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v[key]))throw Error('Invalid response text');
 return Object.fromEntries(required.map(k=>[k,typeof v[k]==='string'?v[k].trim():v[k]]));
}
export async function runUsageReview(service,db,input,apply){
 input=usageReviewInput(JSON.stringify(input));
 const digest=createHash('sha256').update(JSON.stringify({version:1,input})).digest('hex');
 if(apply!==undefined&&(input.action!=='answer'||apply!==digest))throw Error('Preview this exact response before applying it');
 if(input.action==='queue')return {queue:await service.listSupportQueue(db,input.state),state:input.state,enforcementEnabled:false,notice:'Private: statements and account IDs. Oldest first. Answering one saves a response only; no external message is sent.'};
 if(input.action==='list')return {reviews:await service.listUsageReviewRequests(db,input.account),enforcementEnabled:false};
 const current=await service.readUsageReviewRequest(db,input.account,input.id);if(!current)throw Error('Review not found');
 if(input.action==='read')return {review:current,enforcementEnabled:false};
 if(apply===undefined)return {preview:true,request:input,current,applyDigest:digest,notice:'This response will be visible to this account in Chat. It does not change limits, billing or enforcement.'};
 return service.answerUsageReview(db,input.account,input.id,input.response,input.operator);
}
