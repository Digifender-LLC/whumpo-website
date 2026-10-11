// WH-056 synthetic connector reference runtime (WH-140, narrowed by WH-141). The frozen catalog, its validator and the
// typed request builder live in source (src/connector-catalog/). This file keeps only the synthetic in-memory runtime,
// which tests/connectors-contract.mjs bundles together with that source; it is the reference for the later consent,
// receipt, refresh and rule slices (WH-142 to WH-145). It is not OAuth, a vault, D1 storage, an HTTP handler or a
// provider adapter, and no Worker imports it. Production adapters must re-derive principals and repeat every predicate
// inside the committing statement.
import {createHash} from 'node:crypto';
import {availableProvider,check,ConnectorContractError,plain,shape,validateCatalog} from '../../src/connector-catalog/catalog';
import {createRequestBuilder} from '../../src/connector-catalog/builder';

const oneOf=(v,values,code,path)=>check(values.includes(v),code,path);
function canonical(v,depth=0){
 check(depth<=12,'TOO_DEEP','json');
 if(v===null||typeof v==='string'||typeof v==='boolean')return JSON.stringify(v);
 if(typeof v==='number'){check(Number.isFinite(v),'INVALID_NUMBER','json');return JSON.stringify(v);}
 if(Array.isArray(v))return '['+v.map(x=>canonical(x,depth+1)).join(',')+']';
 check(plain(v),'INVALID_SHAPE','json');
 return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k],depth+1)).join(',')+'}';
}
export const digest=v=>createHash('sha256').update(canonical(v)).digest('hex');

/** Synthetic reference runtime. Storage is in memory; transitions mirror the D1 compare-and-swap rules in docs/connectors.md.
 *  Requests are built only by the source builder over a frozen snapshot of `catalog`, with the server-derived authority
 *  class and the credential's granted scopes. */
export function createReferenceRuntime({catalog,transport,now=()=>Date.now(),routes={}}){
 validateCatalog(catalog);
 const build=createRequestBuilder(catalog);
 const buildRequest=(c,authority,provider,operationId,params,body)=>build({providerId:provider,operationId,params,authority,grantedScopes:c.scopes,body});
 const credentials=new Map(),consents=new Map(),receipts=new Map(),inclusion=new Map(),configured=new Set(Object.keys(catalog.providers)),ruleUse=new Map();
 let sequence=0;const id=()=>`00000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`;
 const entry=p=>{check(catalog.providers[p],'UNKNOWN_PROVIDER',p);return catalog.providers[p];};
 const key=(owner,p)=>owner+':'+p;
 const included=(owner,p)=>inclusion.get(key(owner,p))!==false;

 function principalOf(principal,op,path){
  shape(principal,['kind','ownerId'],path,['ruleId','ruleRevision','approval','jobDigest','projectId']);
  oneOf(principal.kind,['owner','rule','visitor','runtime','maintainer','external-content'],'INVALID_PRINCIPAL',path);
  check(['owner','rule'].includes(principal.kind),'PRINCIPAL_FORBIDDEN',principal.kind);
  if(principal.kind==='rule'){
   check(op.authority.includes('approved-rule'),'OWNER_REQUEST_ONLY',path);
   check(principal.approval&&typeof principal.ruleRevision==='number'&&typeof principal.jobDigest==='string','RULE_APPROVAL_REQUIRED',path);
  }
 }
 function admitUse(principal,provider,operationId){
  const e=entry(provider),op=e.operations[operationId];check(op,'UNKNOWN_OPERATION',operationId);
  principalOf(principal,op,'principal');
  check(configured.has(provider),'NOT_CONFIGURED',provider);
  check(included(principal.ownerId,provider),'NOT_INCLUDED',provider);
  if(principal.kind==='rule')check(e.readiness==='live-accepted','ADAPTER_NOT_ACCEPTED',provider);
  const c=credentials.get(key(principal.ownerId,provider));
  check(c&&c.state==='active','NOT_CONNECTED',provider);
  check(op.scopes.every(s=>c.scopes.includes(s)),'INSUFFICIENT_SCOPE',operationId);
  return {e,op,c};
 }
 async function access(c,provider){
  if(c.expiresAt>now())return c;
  const e=entry(provider);
  check(e.authorization.refresh==='single-flight'&&c.refresh,'EXPIRED',provider);
  if(!c.refreshing)c.refreshing=(async()=>{
   let response;
   try{response=await transport({url:e.authorization.token,method:'POST',redirect:'manual',body:new URLSearchParams({grant_type:'refresh_token',refresh_token:c.refresh}).toString()});}
   // A lost refresh reply is a credential outcome, not a customer side effect: this use fails and the next admitted
   // use may retry the same retained refresh credential under a new single-flight claim. Nothing else is tried.
   catch{throw new ConnectorContractError('REFRESH_UNCERTAIN',provider);}
   finally{c.refreshing=null;}
   if(response.status===400){c.state='reauthorization-required';throw new ConnectorContractError('REAUTHORIZATION_REQUIRED',provider);}
   check(response.status===200,'REFRESH_UNCERTAIN',provider);
   const t=response.json;check(t.token_type==='Bearer'&&Number.isSafeInteger(t.expires_in)&&t.expires_in>0&&t.expires_in<=e.authorization.maxAccessSeconds,'INVALID_TOKEN',provider);
   check(!t.scope||t.scope.split(' ').every(s=>c.scopes.includes(s)),'SCOPE_WIDENED',provider);
   c.access=t.access_token;c.expiresAt=now()+t.expires_in*1000;if(t.refresh_token)c.refresh=t.refresh_token;c.generation++;
  })();
  await c.refreshing;return c;
 }
 async function send(c,provider,request){
  const generation=c.generation,before=c.id;
  let response;
  try{response=await transport({url:request.url,method:request.method,redirect:request.redirect,body:request.body,authorization:'Bearer '+c.access});}
  catch(error){throw new ConnectorContractError('LOST_RESPONSE',provider,{cause:error});}
  // Recheck exact credential identity after the provider replies; a disconnect mid-flight refuses the result.
  const after=credentials.get(key(c.ownerId,provider));
  check(after&&after.id===before&&after.state==='active'&&after.generation>=generation,'ACCESS_CHANGED',provider);
  if(response.status===401||response.status===403){c.state='provider-rejected';throw new ConnectorContractError('PROVIDER_REJECTED',provider);}
  check(response.status<300||response.status>=400,'REDIRECT_REFUSED',provider);
  check(Buffer.byteLength(JSON.stringify(response.json??null))<=request.operation.bounds.maxBytes,'TOO_LARGE',provider);
  return response;
 }
 const runtime={
  catalog,
  setInclusion(owner,provider,value){inclusion.set(key(owner,provider),value);},
  setConfigured(provider,value){value?configured.add(provider):configured.delete(provider);},
  /** Token response admission: exact scopes, bounded explicit lifetime, Bearer only. Planned providers cannot connect. */
  connect(owner,provider,token){
   const e=availableProvider(catalog,provider);
   check(token.token_type==='Bearer'&&Number.isSafeInteger(token.expires_in)&&token.expires_in>0&&token.expires_in<=e.authorization.maxAccessSeconds,'INVALID_TOKEN',provider);
   const granted=token.scope===undefined?e.scopes:token.scope.split(' ');
   check(granted.every(s=>e.scopes.includes(s)),'SCOPE_WIDENED',provider);
   check(!token.refresh_token||e.authorization.refresh!=='none','UNEXPECTED_REFRESH',provider);
   const prior=credentials.get(key(owner,provider));check(!prior||prior.state!=='active','DISCONNECT_FIRST',provider);
   const c={id:id(),ownerId:owner,provider,state:'active',scopes:[...granted],access:token.access_token,refresh:token.refresh_token??null,expiresAt:now()+token.expires_in*1000,generation:1,refreshing:null};
   credentials.set(key(owner,provider),c);return {credentialId:c.id,scopes:[...granted]};
  },
  /** Local access is disabled first; only a definitive provider acknowledgement settles remote revocation. */
  async disconnect(owner,provider){
   const c=credentials.get(key(owner,provider));if(!c)return {state:'disconnected'};
   c.state='revoking';for(const consent of consents.values())if(consent.credentialId===c.id)consent.state='void';
   const e=entry(provider);
   if(e.authorization.revocation==='local-only-owner-removal'){c.state='revocation-owner-action';return {state:c.state};}
   try{const r=await transport({url:e.authorization.revoke,method:'POST',redirect:'manual',body:'token=redacted'});c.state=r.status===200||r.status===204?'revoked':'revocation-pending';}
   catch{c.state='revocation-pending';}
   return {state:c.state};
  },
  expire(owner,provider){const c=credentials.get(key(owner,provider));if(c)c.expiresAt=now()-1;},
  /** Distinct states: inclusion, configuration, consent and readiness never collapse into one flag. */
  status(owner,provider){
   const e=entry(provider),c=credentials.get(key(owner,provider));
   const consent=!c?'none':c.state==='active'?(c.expiresAt>now()?'active':'expired'):c.state;
   return {inclusion:included(owner,provider)?'included':'not-included',configuration:configured.has(provider)?'configured':'unconfigured',consent,readiness:e.readiness};
  },
  /** Server-issued request-bound consent for one exact read and destination. Model output may only propose it. */
  proposeLookup(principal,provider,operationId,params,destination){
   const {op,c}=admitUse(principal,provider,operationId);
   check(principal.kind==='owner','OWNER_REQUEST_ONLY',operationId);
   check(op.kind==='read'&&op.consent==='request-bound','CONSENT_NOT_APPLICABLE',operationId);
   check(op.destinations.includes(destination),'INVALID_DESTINATION',destination);
   if(destination==='model-context'){const r=routes.connectorContent;check(r&&r.trainingUse===false&&r.approvedForConnectorContent===true,'ROUTE_INELIGIBLE','model-context');}
   buildRequest(c,'owner-request',provider,operationId,params);
   if(op.bounds.maxRangeDays)check((Date.parse(params.to)-Date.parse(params.from))/864e5<=op.bounds.maxRangeDays&&Date.parse(params.to)>Date.parse(params.from),'RANGE_TOO_WIDE',operationId);
   const consent={id:id(),ownerId:principal.ownerId,provider,operationId,credentialId:c.id,paramsDigest:digest(params),destination,expiresAt:now()+15*60e3,state:'proposed'};
   consents.set(consent.id,consent);return {consentId:consent.id,operationId,destination,expiresAt:consent.expiresAt};
  },
  confirmLookup(principal,consentId){
   check(principal.kind==='owner','PRINCIPAL_FORBIDDEN',principal.kind);
   const c=consents.get(consentId);check(c&&c.ownerId===principal.ownerId,'NOT_FOUND','consent');
   check(c.state==='proposed'&&c.expiresAt>now(),'CONSENT_UNAVAILABLE','consent');c.state='confirmed';return {consentId};
  },
  async read(principal,provider,operationId,params,{consentId=null,destination='owner-panel'}={}){
   check(principal.kind!=='rule','RULE_READ_FORBIDDEN',operationId);
   const {op,c}=admitUse(principal,provider,operationId);
   check(op.kind==='read','NOT_A_READ',operationId);
   check(op.destinations.includes(destination),'INVALID_DESTINATION',destination);
   if(op.consent==='request-bound'){
    const s=consents.get(consentId);
    check(s&&s.ownerId===principal.ownerId&&s.provider===provider&&s.operationId===operationId&&s.destination===destination,'CONSENT_REQUIRED',operationId);
    check(s.state==='confirmed'&&s.expiresAt>now()&&s.credentialId===c.id&&s.paramsDigest===digest(params),'CONSENT_MISMATCH',operationId);
    s.state='used';
   }else check(consentId===null,'CONSENT_NOT_APPLICABLE',operationId);
   const request=buildRequest(c,'owner-request',provider,operationId,params);
   await access(c,provider);check(c.state==='active','NOT_CONNECTED',provider);
   const response=await send(c,provider,request);
   check(response.status===200,'PROVIDER_ERROR',provider);
   // Provenance marks the data untrusted; nothing in it can confirm consent, a review or a tool call.
   return Object.freeze({provenance:'untrusted-external',dataClass:op.dataClass,destination,data:response.json});
  },
  /** Exact review: binds destination, input digest, credential, catalog operation digest and price. */
  prepareAction(principal,provider,operationId,params,body,{marker}={}){
   const {op,c}=admitUse(principal,provider,operationId);
   check(op.kind==='action','NOT_AN_ACTION',operationId);
   const authority=principal.kind==='rule'?'approved-rule':'owner-request';
   const request=buildRequest(c,authority,provider,operationId,params,body);
   if(principal.kind==='rule'){
    const a=principal.approval;
    check(a.operationId===operationId&&a.destinationDigest===digest(params)&&a.bodyTemplateDigest===digest(body),'RULE_DESTINATION_MISMATCH',operationId);
    const used=ruleUse.get(principal.ruleId+':'+principal.ruleRevision)??0;check(used<a.maxPerPeriod,'RULE_LIMIT',operationId);
    ruleUse.set(principal.ruleId+':'+principal.ruleRevision,used+1);
   }
   const receipt={id:id(),ownerId:principal.ownerId,authority,provider,operationId,credentialId:c.id,
    operationDigest:digest(op),requestDigest:digest({params,body:body??null}),params,body,marker:marker??null,price:{...op.price},state:'review',dispatches:0,expiresAt:now()+10*60e3,request};
   receipt.reviewDigest=digest({operationDigest:receipt.operationDigest,requestDigest:receipt.requestDigest,credentialId:c.id,price:receipt.price,provider,operationId});
   receipts.set(receipt.id,receipt);
   return {receiptId:receipt.id,reviewDigest:receipt.reviewDigest,price:receipt.price,state:'review'};
  },
  /** One atomic claim per receipt; only that claim may dispatch. Retries and lost replies never redispatch. */
  async confirmAction(principal,receiptId,{reviewDigest,acceptedPrice}){
   const r=receipts.get(receiptId);check(r&&r.ownerId===principal.ownerId,'NOT_FOUND','receipt');
   if(r.state!=='review')return {state:r.state,dispatched:false};
   check(principal.kind==='owner'||r.authority==='approved-rule'&&principal.kind==='rule','PRINCIPAL_FORBIDDEN',principal.kind);
   const {op,c}=admitUse(principal,r.provider,r.operationId);
   check(r.expiresAt>now(),'REVIEW_EXPIRED',receiptId);
   check(reviewDigest===r.reviewDigest&&digest(op)===r.operationDigest&&c.id===r.credentialId,'STALE_REVIEW',receiptId);
   check(plain(acceptedPrice)&&canonical(acceptedPrice)===canonical(r.price),'PRICE_NOT_ACCEPTED',receiptId);
   await access(c,r.provider);check(c.state==='active','NOT_CONNECTED',r.provider);
   // Compare-and-swap claim with no await between the check and the write (one UPDATE ... WHERE state='review' in D1).
   if(r.state!=='review')return {state:r.state,dispatched:false};
   r.state='dispatching';r.dispatches++;
   try{
    const response=await send(c,r.provider,r.request);
    if(response.status>=200&&response.status<300){r.state='applied';r.providerId=response.json?.id??null;}
    else if(response.status>=400&&response.status<500&&response.status!==408&&response.status!==429)r.state='failed';
    else r.state='uncertain';
   }catch(error){
    if(error.code==='PROVIDER_REJECTED')r.state='failed';
    else r.state='uncertain';
   }
   return {state:r.state,dispatched:true};
  },
  /** Read-only targeted readback through the action's declared reconcile operations; never resends. */
  async reconcile(principal,receiptId,observe){
   check(principal.kind==='owner','PRINCIPAL_FORBIDDEN',principal.kind);
   const r=receipts.get(receiptId);check(r&&r.ownerId===principal.ownerId,'NOT_FOUND','receipt');
   if(!['dispatching','uncertain'].includes(r.state))return {state:r.state};
   const e=entry(r.provider),op=e.operations[r.operationId];
   // Eligibility loss does not block reconciliation of an existing effect; it still needs the same credential.
   const c=credentials.get(key(principal.ownerId,r.provider));check(c&&c.state==='active'&&c.id===r.credentialId,'RECONCILE_NEEDS_SAME_ACCESS',receiptId);
   const plan=observe(r);
   check(op.reconcile.includes(plan.operationId),'RECONCILE_NOT_DECLARED',plan.operationId);
   const request=buildRequest(c,'owner-request',r.provider,plan.operationId,plan.params,plan.body);
   await access(c,r.provider);
   const response=await send(c,r.provider,request);
   if(response.status===200&&plan.matches(response.json)){r.state='observed';}
   return {state:r.state};
  },
  receipt(receiptId){const r=receipts.get(receiptId);return r&&{state:r.state,dispatches:r.dispatches,authority:r.authority,price:r.price};},
 };
 return runtime;
}
