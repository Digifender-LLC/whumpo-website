// WH-056 offline connector contract reference (WH-140). Validates the frozen catalog/operation/request shapes
// and runs a synthetic in-memory reference runtime for the conformance harness in tests/connectors-contract.mjs.
// It is not OAuth, a vault, D1 storage, an HTTP handler or a provider adapter. No Worker imports it; production
// adapters must re-derive principals and repeat every predicate inside the committing statement.
import {createHash} from 'node:crypto';

export class ConnectorContractError extends Error {
 constructor(code,path){super(`${code}: ${path}`);this.code=code;}
}
const check=(ok,code,path)=>{if(!ok)throw new ConnectorContractError(code,path);};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
function shape(v,keys,path,optional=[]){
 check(plain(v),'INVALID_SHAPE',path);
 check(Object.keys(v).every(k=>keys.includes(k)||optional.includes(k)),'UNKNOWN_FIELD',path);
 check(keys.every(k=>Object.hasOwn(v,k)),'MISSING_FIELD',path);
}
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

/** Frozen vocabularies (contract version 1). */
export const providers=Object.freeze(['github','cloudflare','gmail','google-calendar','outlook-email','microsoft-calendar','hubspot']);
export const authorityClasses=Object.freeze(['owner-request','approved-rule']);
export const consentKinds=Object.freeze(['owner-control','request-bound']);
export const destinations=Object.freeze(['owner-panel','chat-reply','model-context','review-receipt']);
export const readinessLevels=Object.freeze(['planned','synthetic-conformant','private-test','live-accepted']);
export const receiptStates=Object.freeze(['review','dispatching','applied','unchanged','uncertain','observed','failed','expired','cancelled']);
export const idempotencyKinds=Object.freeze(['precondition-and-mutation-id','marker-readback','provider-idempotency-key']);
const refreshKinds=['none','retained-unused','single-flight'];
const revocationKinds=['rfc7009','github-token-delete','provider-refresh-delete','local-only-owner-removal'];
// Parameter types are closed. Every value is validated and percent-encoded by the server; no caller URL exists.
export const paramTypes=Object.freeze({
 int:v=>Number.isSafeInteger(v)&&v>=1,
 hex32:v=>typeof v==='string'&&/^[0-9a-f]{32}$/.test(v),
 login:v=>typeof v==='string'&&/^[A-Za-z0-9-]{1,39}$/.test(v),
 repo:v=>typeof v==='string'&&/^[A-Za-z0-9_.-]{1,100}$/.test(v)&&!['.','..'].includes(v),
 branch:v=>typeof v==='string'&&/^[A-Za-z0-9._/-]{1,200}$/.test(v)&&!v.includes('..')&&!v.startsWith('/'),
 hostname:v=>typeof v==='string'&&v.length<=253&&/^[a-z0-9_-]+(?:\.[a-z0-9_-]+)+$/.test(v),
 opaque:v=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,512}$/.test(v),
 instant:v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v)&&!Number.isNaN(Date.parse(v)),
 query:v=>typeof v==='string'&&v.trim().length>0&&v.length<=200&&!/[\u0000-\u001f\u007f]/.test(v),
});
const origin=v=>{try{const u=new URL(v);return u.protocol==='https:'&&u.origin===v&&!u.username&&!u.password&&!u.port&&!/^[0-9.]+$|^\[/.test(u.hostname)&&!u.hostname.includes('*');}catch{return false;}};

// Shared fixed GraphQL documents; GitHub's must equal src/connection-recovery.ts (checked by the harness).
export const graphqlDocuments=Object.freeze({
 BackupPaths:'query BackupPaths($owner:String!,$name:String!,$p0:String!,$p1:String!,$p2:String!,$p3:String!){repository(owner:$owner,name:$name){p0:object(expression:$p0){__typename oid} p1:object(expression:$p1){__typename oid} p2:object(expression:$p2){__typename oid} p3:object(expression:$p3){__typename oid}}}',
 BackupCommit:'mutation BackupCommit($input:CreateCommitOnBranchInput!){createCommitOnBranch(input:$input){commit{oid}}}',
});

const included={customerUnits:0,basis:'plan-inclusion'};
const read=(o)=>({kind:'read',authority:['owner-request'],feature:'read',method:'GET',query:[],body:null,review:'none',idempotency:null,reconcile:[],price:included,...o});
const action=(o)=>({kind:'action',authority:['owner-request'],feature:'dispatch',consent:'owner-control',review:'exact',query:[],destinations:['review-receipt'],price:included,...o});

/** Frozen v1 catalog. `planned` providers are contract declarations only: no client, scope request or adapter exists.
 *  Planned provider identifiers (hosts/scopes) require re-verification in each provider's own contract child. */
export const connectorCatalog=Object.freeze({
 contractVersion:1,
 providers:{
  github:{readiness:'private-test',featureId:'connections.github',
   authorization:{kind:'github-app-user',authorize:'https://github.com/login/oauth/authorize',token:'https://github.com/login/oauth/access_token',revoke:'https://api.github.com/applications/{clientId}/token',revocation:'github-token-delete',refresh:'retained-unused',maxAccessSeconds:28800},
   origins:['https://api.github.com'],scopes:['metadata:read','contents:write'],
   operations:{
    'installations.list':read({origin:'https://api.github.com',path:'/user/installations',query:[['per_page','100']],params:{},scopes:['metadata:read'],consent:'owner-control',destinations:['owner-panel','chat-reply'],dataClass:'connections',bounds:{maxBytes:524288,maxItems:100}}),
    'repositories.list':read({origin:'https://api.github.com',path:'/user/installations/{installation}/repositories',query:[['per_page','20'],['page','{page}']],params:{installation:'int',page:'int'},scopes:['metadata:read'],consent:'owner-control',destinations:['owner-panel','chat-reply'],dataClass:'connections',bounds:{maxBytes:524288,maxItems:20}}),
    'repository.get':read({origin:'https://api.github.com',path:'/repos/{owner}/{name}',params:{owner:'login',name:'repo'},scopes:['metadata:read'],consent:'owner-control',destinations:['review-receipt'],dataClass:'github-backups',bounds:{maxBytes:524288,maxItems:1}}),
    'branch.head':read({origin:'https://api.github.com',path:'/repos/{owner}/{name}/git/ref/heads/{branch}',params:{owner:'login',name:'repo',branch:'branch'},scopes:['contents:write'],consent:'owner-control',destinations:['review-receipt'],dataClass:'github-backups',bounds:{maxBytes:524288,maxItems:1}}),
    'backup.paths':read({origin:'https://api.github.com',path:'/graphql',method:'POST',body:{kind:'graphql',document:'BackupPaths'},params:{},scopes:['contents:write'],consent:'owner-control',destinations:['review-receipt'],dataClass:'github-backups',bounds:{maxBytes:524288,maxItems:4}}),
    'backup.commit':action({origin:'https://api.github.com',path:'/graphql',method:'POST',body:{kind:'graphql',document:'BackupCommit'},params:{},scopes:['contents:write'],dataClass:'github-backups',idempotency:'precondition-and-mutation-id',reconcile:['repository.get','branch.head','backup.paths'],bounds:{maxBytes:524288,maxItems:1}}),
   }},
  cloudflare:{readiness:'private-test',featureId:'connections.cloudflare',
   authorization:{kind:'oauth-code-pkce',authorize:'https://dash.cloudflare.com/oauth2/auth',token:'https://dash.cloudflare.com/oauth2/token',revoke:'https://dash.cloudflare.com/oauth2/revoke',revocation:'rfc7009',refresh:'none',maxAccessSeconds:28800},
   origins:['https://api.cloudflare.com'],scopes:['zone.read','dns.read','dns.write'],
   operations:{
    'zones.list':read({origin:'https://api.cloudflare.com',path:'/client/v4/zones',query:[['per_page','50'],['page','{page}']],params:{page:'int'},scopes:['zone.read'],consent:'owner-control',destinations:['owner-panel','chat-reply'],dataClass:'connections',bounds:{maxBytes:262144,maxItems:50}}),
    'zone.get':read({origin:'https://api.cloudflare.com',path:'/client/v4/zones/{zone}',params:{zone:'hex32'},scopes:['zone.read'],consent:'owner-control',destinations:['review-receipt'],dataClass:'domains-dns',bounds:{maxBytes:262144,maxItems:1}}),
    'dnsRecords.findExact':read({origin:'https://api.cloudflare.com',path:'/client/v4/zones/{zone}/dns_records',query:[['name.exact','{name}'],['per_page','100'],['page','1']],params:{zone:'hex32',name:'hostname'},scopes:['dns.read'],consent:'owner-control',destinations:['review-receipt'],dataClass:'domains-dns',bounds:{maxBytes:262144,maxItems:100}}),
    'dnsRecord.create':action({origin:'https://api.cloudflare.com',path:'/client/v4/zones/{zone}/dns_records',method:'POST',body:{kind:'json',fields:['type','name','content','ttl','proxied','comment']},params:{zone:'hex32'},scopes:['dns.write'],dataClass:'domains-dns',idempotency:'marker-readback',reconcile:['zone.get','dnsRecords.findExact'],bounds:{maxBytes:262144,maxItems:1}}),
   }},
  gmail:{readiness:'planned',featureId:'connections.gmail',
   authorization:{kind:'oauth-code-pkce',authorize:'https://accounts.google.com/o/oauth2/v2/auth',token:'https://oauth2.googleapis.com/token',revoke:'https://oauth2.googleapis.com/revoke',revocation:'rfc7009',refresh:'single-flight',maxAccessSeconds:3600},
   origins:['https://gmail.googleapis.com'],scopes:['https://www.googleapis.com/auth/gmail.readonly','https://www.googleapis.com/auth/gmail.send'],
   operations:{
    'messages.search':read({origin:'https://gmail.googleapis.com',path:'/gmail/v1/users/me/messages',query:[['q','{q}'],['maxResults','10']],params:{q:'query'},scopes:['https://www.googleapis.com/auth/gmail.readonly'],consent:'request-bound',destinations:['owner-panel','model-context'],dataClass:'connector-content',bounds:{maxBytes:262144,maxItems:10}}),
    'message.get':read({origin:'https://gmail.googleapis.com',path:'/gmail/v1/users/me/messages/{id}',query:[['format','full']],params:{id:'opaque'},scopes:['https://www.googleapis.com/auth/gmail.readonly'],consent:'request-bound',destinations:['owner-panel','model-context'],dataClass:'connector-content',bounds:{maxBytes:1048576,maxItems:1}}),
    'message.send':action({origin:'https://gmail.googleapis.com',path:'/gmail/v1/users/me/messages/send',method:'POST',body:{kind:'json',fields:['raw','threadId']},params:{},scopes:['https://www.googleapis.com/auth/gmail.send'],dataClass:'connector-receipts',idempotency:'marker-readback',reconcile:['messages.search'],bounds:{maxBytes:65536,maxItems:1}}),
   }},
  'google-calendar':{readiness:'planned',featureId:'connections.google-calendar',
   authorization:{kind:'oauth-code-pkce',authorize:'https://accounts.google.com/o/oauth2/v2/auth',token:'https://oauth2.googleapis.com/token',revoke:'https://oauth2.googleapis.com/revoke',revocation:'rfc7009',refresh:'single-flight',maxAccessSeconds:3600},
   origins:['https://www.googleapis.com'],scopes:['https://www.googleapis.com/auth/calendar.calendarlist.readonly','https://www.googleapis.com/auth/calendar.events.owned'],
   operations:{
    'calendars.list':read({origin:'https://www.googleapis.com',path:'/calendar/v3/users/me/calendarList',query:[['maxResults','50']],params:{},scopes:['https://www.googleapis.com/auth/calendar.calendarlist.readonly'],consent:'owner-control',destinations:['owner-panel'],dataClass:'connector-content',bounds:{maxBytes:262144,maxItems:50}}),
    'events.range':read({origin:'https://www.googleapis.com',path:'/calendar/v3/calendars/{calendar}/events',query:[['timeMin','{from}'],['timeMax','{to}'],['singleEvents','true'],['maxResults','50']],params:{calendar:'opaque',from:'instant',to:'instant'},scopes:['https://www.googleapis.com/auth/calendar.events.owned'],consent:'request-bound',destinations:['owner-panel','model-context'],dataClass:'connector-content',bounds:{maxBytes:524288,maxItems:50,maxRangeDays:31}}),
    'event.create':action({origin:'https://www.googleapis.com',path:'/calendar/v3/calendars/{calendar}/events',method:'POST',body:{kind:'json',fields:['summary','start','end','attendees','id']},params:{calendar:'opaque'},scopes:['https://www.googleapis.com/auth/calendar.events.owned'],dataClass:'connector-receipts',idempotency:'provider-idempotency-key',reconcile:['events.range'],bounds:{maxBytes:65536,maxItems:1}}),
   }},
  'outlook-email':{readiness:'planned',featureId:'connections.outlook-email',
   authorization:{kind:'oauth-code-pkce',authorize:'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',token:'https://login.microsoftonline.com/common/oauth2/v2.0/token',revoke:null,revocation:'local-only-owner-removal',refresh:'single-flight',maxAccessSeconds:5400},
   origins:['https://graph.microsoft.com'],scopes:['offline_access','Mail.Read','Mail.Send'],
   operations:{
    'messages.search':read({origin:'https://graph.microsoft.com',path:'/v1.0/me/messages',query:[['$search','{q}'],['$top','10']],params:{q:'query'},scopes:['Mail.Read'],consent:'request-bound',destinations:['owner-panel','model-context'],dataClass:'connector-content',bounds:{maxBytes:262144,maxItems:10}}),
    'message.get':read({origin:'https://graph.microsoft.com',path:'/v1.0/me/messages/{id}',params:{id:'opaque'},scopes:['Mail.Read'],consent:'request-bound',destinations:['owner-panel','model-context'],dataClass:'connector-content',bounds:{maxBytes:1048576,maxItems:1}}),
    'message.send':action({origin:'https://graph.microsoft.com',path:'/v1.0/me/sendMail',method:'POST',body:{kind:'json',fields:['message','saveToSentItems']},params:{},scopes:['Mail.Send'],dataClass:'connector-receipts',idempotency:'marker-readback',reconcile:['messages.search'],bounds:{maxBytes:65536,maxItems:1}}),
   }},
  'microsoft-calendar':{readiness:'planned',featureId:'connections.microsoft-calendar',
   authorization:{kind:'oauth-code-pkce',authorize:'https://login.microsoftonline.com/common/oauth2/v2.0/authorize',token:'https://login.microsoftonline.com/common/oauth2/v2.0/token',revoke:null,revocation:'local-only-owner-removal',refresh:'single-flight',maxAccessSeconds:5400},
   origins:['https://graph.microsoft.com'],scopes:['offline_access','Calendars.ReadWrite'],
   operations:{
    'events.range':read({origin:'https://graph.microsoft.com',path:'/v1.0/me/calendars/{calendar}/calendarView',query:[['startDateTime','{from}'],['endDateTime','{to}'],['$top','50']],params:{calendar:'opaque',from:'instant',to:'instant'},scopes:['Calendars.ReadWrite'],consent:'request-bound',destinations:['owner-panel','model-context'],dataClass:'connector-content',bounds:{maxBytes:524288,maxItems:50,maxRangeDays:31}}),
    'event.create':action({origin:'https://graph.microsoft.com',path:'/v1.0/me/calendars/{calendar}/events',method:'POST',body:{kind:'json',fields:['subject','start','end','attendees','transactionId']},params:{calendar:'opaque'},scopes:['Calendars.ReadWrite'],dataClass:'connector-receipts',idempotency:'provider-idempotency-key',reconcile:['events.range'],bounds:{maxBytes:65536,maxItems:1}}),
   }},
  hubspot:{readiness:'planned',featureId:'connections.hubspot',
   authorization:{kind:'oauth-code',authorize:'https://app.hubspot.com/oauth/authorize',token:'https://api.hubapi.com/oauth/v1/token',revoke:'https://api.hubapi.com/oauth/v1/refresh-tokens/{token}',revocation:'provider-refresh-delete',refresh:'single-flight',maxAccessSeconds:1800},
   origins:['https://api.hubapi.com'],scopes:['oauth','crm.objects.contacts.read','crm.objects.contacts.write'],
   operations:{
    'contacts.search':read({origin:'https://api.hubapi.com',path:'/crm/v3/objects/contacts/search',method:'POST',body:{kind:'json',fields:['filterGroups','properties','limit']},params:{},scopes:['crm.objects.contacts.read'],consent:'request-bound',destinations:['owner-panel','model-context'],dataClass:'connector-content',bounds:{maxBytes:262144,maxItems:10}}),
    'contact.create':action({origin:'https://api.hubapi.com',path:'/crm/v3/objects/contacts',method:'POST',body:{kind:'json',fields:['properties']},params:{},scopes:['crm.objects.contacts.write'],authority:['owner-request','approved-rule'],dataClass:'connector-receipts',idempotency:'marker-readback',reconcile:['contacts.search'],bounds:{maxBytes:65536,maxItems:1}}),
   }},
 },
});

function validateOperation(provider,id,op,entry){
 const p=`${provider}.${id}`;
 check(/^[a-z][A-Za-z]*(?:\.[a-z][A-Za-z]*)+$/.test(id),'INVALID_ID',p);
 shape(op,['kind','authority','feature','method','origin','path','query','body','params','scopes','consent','destinations','dataClass','review','idempotency','reconcile','price','bounds'],p);
 oneOf(op.kind,['read','action'],'INVALID_KIND',p);
 check(Array.isArray(op.authority)&&op.authority.length>=1&&op.authority.every(a=>authorityClasses.includes(a))&&op.authority[0]==='owner-request','INVALID_AUTHORITY',p);
 check(op.kind==='action'||!op.authority.includes('approved-rule'),'RULE_READ_FORBIDDEN',p);
 oneOf(op.method,['GET','POST'],'INVALID_METHOD',p);
 check(op.kind==='action'?op.feature==='dispatch':op.feature==='read','INVALID_FEATURE_OPERATION',p);
 check(entry.origins.includes(op.origin),'HOST_NOT_ALLOWED',p);
 check(typeof op.path==='string'&&op.path.startsWith('/')&&!op.path.startsWith('//')&&!/[?#\\]|\.\.|:\/\//.test(op.path),'INVALID_PATH',p);
 const names=[...op.path.matchAll(/\{([a-z][A-Za-z]*)\}/g),...op.query.flatMap(([,v])=>[...v.matchAll(/^\{([a-z][A-Za-z]*)\}$/g)])].map(m=>m[1]);
 check(plain(op.params)&&Object.values(op.params).every(t=>Object.hasOwn(paramTypes,t)),'INVALID_PARAM_TYPE',p);
 check(names.length===new Set(names).size&&names.every(n=>Object.hasOwn(op.params,n))&&Object.keys(op.params).every(n=>names.includes(n)),'PARAM_MISMATCH',p);
 check(Array.isArray(op.scopes)&&op.scopes.length>=1&&op.scopes.every(s=>entry.scopes.includes(s)),'SCOPE_NOT_DECLARED',p);
 oneOf(op.consent,consentKinds,'INVALID_CONSENT',p);
 check(Array.isArray(op.destinations)&&op.destinations.length>=1&&op.destinations.every(d=>destinations.includes(d)),'INVALID_DESTINATION',p);
 // Provider-selected content always needs request-bound consent; owner-control is for metadata/review inputs only.
 check(op.dataClass!=='connector-content'||op.consent==='request-bound'||!op.destinations.includes('model-context'),'CONSENT_TOO_WEAK',p);
 check(op.consent==='request-bound'||!op.destinations.includes('model-context'),'CONSENT_TOO_WEAK',p);
 check(typeof op.dataClass==='string'&&/^[a-z][a-z0-9-]+$/.test(op.dataClass),'INVALID_CLASS',p);
 check(op.kind==='read'?op.review==='none'&&op.idempotency===null&&op.reconcile.length===0:op.review==='exact'&&idempotencyKinds.includes(op.idempotency)&&op.reconcile.length>=1,'INVALID_ACTION_CONTRACT',p);
 for(const r of op.reconcile)check(entry.operations[r]?.kind==='read'&&entry.operations[r].authority.length===1,'INVALID_RECONCILE',p);
 shape(op.price,['customerUnits','basis'],p+'.price');
 check(Number.isSafeInteger(op.price.customerUnits)&&op.price.customerUnits>=0&&(op.price.customerUnits===0)===(op.price.basis==='plan-inclusion')&&['plan-inclusion','quoted'].includes(op.price.basis),'INVALID_PRICE',p);
 check(op.body===null||(op.body.kind==='graphql'&&Object.hasOwn(graphqlDocuments,op.body.document))||(op.body.kind==='json'&&Array.isArray(op.body.fields)&&op.body.fields.length>=1),'INVALID_BODY',p);
 check(op.method==='POST'||op.body===null,'INVALID_BODY',p);
 shape(op.bounds,['maxBytes','maxItems'],p+'.bounds',['maxRangeDays']);
 check(Number.isSafeInteger(op.bounds.maxBytes)&&op.bounds.maxBytes>0&&op.bounds.maxBytes<=1048576&&Number.isSafeInteger(op.bounds.maxItems)&&op.bounds.maxItems>=1&&op.bounds.maxItems<=100,'INVALID_BOUNDS',p);
}
/** Throws on any catalog that would widen hosts/scopes, allow rule reads, or omit price/reconciliation. */
export function validateCatalog(catalog){
 shape(catalog,['contractVersion','providers'],'catalog');
 check(catalog.contractVersion===1,'UNSUPPORTED_VERSION','catalog');
 check(plain(catalog.providers)&&Object.keys(catalog.providers).every(p=>providers.includes(p)),'UNKNOWN_PROVIDER','catalog.providers');
 for(const [provider,entry] of Object.entries(catalog.providers)){
  shape(entry,['readiness','featureId','authorization','origins','scopes','operations'],provider);
  oneOf(entry.readiness,readinessLevels,'INVALID_READINESS',provider);
  check(entry.featureId===`connections.${provider}`,'FEATURE_MISMATCH',provider);
  const a=entry.authorization;
  shape(a,['kind','authorize','token','revoke','revocation','refresh','maxAccessSeconds'],provider+'.authorization');
  for(const u of [a.authorize,a.token,a.revoke].filter(Boolean))check(/^https:\/\/[^/?#]+\//.test(u)&&origin(new URL(u).origin)&&!new URL(u).search,'HOST_NOT_ALLOWED',provider+'.authorization');
  check((a.revoke===null)===(a.revocation==='local-only-owner-removal'),'INVALID_REVOCATION',provider);
  oneOf(a.revocation,revocationKinds,'INVALID_REVOCATION',provider);oneOf(a.refresh,refreshKinds,'INVALID_REFRESH',provider);
  check(Number.isSafeInteger(a.maxAccessSeconds)&&a.maxAccessSeconds>0&&a.maxAccessSeconds<=28800,'INVALID_LIFETIME',provider);
  check(Array.isArray(entry.origins)&&entry.origins.length>=1&&entry.origins.every(origin),'HOST_NOT_ALLOWED',provider+'.origins');
  check(Array.isArray(entry.scopes)&&entry.scopes.length>=1&&new Set(entry.scopes).size===entry.scopes.length,'INVALID_SCOPE',provider+'.scopes');
  check(plain(entry.operations)&&Object.keys(entry.operations).length>=1,'INVALID_SHAPE',provider+'.operations');
  for(const [id,op] of Object.entries(entry.operations))validateOperation(provider,id,op,entry);
 }
 return true;
}

/** Builds the only request an operation may send. Callers supply typed parameters, never a URL. */
export function buildRequest(catalog,provider,operationId,params,body){
 const op=catalog.providers[provider]?.operations[operationId];
 check(op,'UNKNOWN_OPERATION',`${provider}.${operationId}`);
 shape(params,Object.keys(op.params),'params');
 for(const [k,t] of Object.entries(op.params))check(paramTypes[t](params[k]),'INVALID_PARAM',k);
 const fill=s=>s.replace(/\{([a-z][A-Za-z]*)\}/g,(_,k)=>encodeURIComponent(String(params[k])));
 const search=op.query.length?'?'+new URLSearchParams(op.query.map(([k,v])=>[k,/^\{[a-z][A-Za-z]*\}$/.test(v)?String(params[v.slice(1,-1)]):v])).toString():'';
 let text;
 if(op.body?.kind==='graphql'){shape(body,['query','variables'],'body');check(body.query===graphqlDocuments[op.body.document],'BODY_NOT_ALLOWED','body.query');text=JSON.stringify(body);}
 else if(op.body?.kind==='json'){check(plain(body)&&Object.keys(body).every(k=>op.body.fields.includes(k)),'BODY_NOT_ALLOWED','body');text=JSON.stringify(body);check(Buffer.byteLength(text)<=op.bounds.maxBytes,'TOO_LARGE','body');}
 else check(body===undefined,'BODY_NOT_ALLOWED','body');
 const url=op.origin+fill(op.path)+search;
 check(new URL(url).origin===op.origin,'HOST_NOT_ALLOWED',url);
 return {url,path:fill(op.path)+search,method:op.method,body:text,redirect:'manual',op};
}

/** Synthetic reference runtime. Storage is in memory; transitions mirror the D1 compare-and-swap rules in docs/connectors.md. */
export function createReferenceRuntime({catalog=connectorCatalog,transport,now=()=>Date.now(),routes={}}={}){
 validateCatalog(catalog);
 const credentials=new Map(),consents=new Map(),receipts=new Map(),inclusion=new Map(),configured=new Set(Object.keys(catalog.providers)),ruleUse=new Map();
 let sequence=0;const id=()=>`00000000-0000-4000-8000-${String(++sequence).padStart(12,'0')}`;
 const entry=p=>{check(catalog.providers[p],'UNKNOWN_PROVIDER',p);return catalog.providers[p];};
 const key=(owner,p)=>owner+':'+p;
 const current=(owner,p)=>{const c=credentials.get(key(owner,p));return c&&c.state==='active'&&c.expiresAt>now()?c:null;};
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
  try{response=await transport({url:request.url,method:request.method,redirect:'manual',body:request.body,authorization:'Bearer '+c.access});}
  catch(error){throw new ConnectorContractError('LOST_RESPONSE',provider,{cause:error});}
  // Recheck exact credential identity after the provider replies; a disconnect mid-flight refuses the result.
  const after=credentials.get(key(c.ownerId,provider));
  check(after&&after.id===before&&after.state==='active'&&after.generation>=generation,'ACCESS_CHANGED',provider);
  if(response.status===401||response.status===403){c.state='provider-rejected';throw new ConnectorContractError('PROVIDER_REJECTED',provider);}
  check(response.status<300||response.status>=400,'REDIRECT_REFUSED',provider);
  check(Buffer.byteLength(JSON.stringify(response.json??null))<=request.op.bounds.maxBytes,'TOO_LARGE',provider);
  return response;
 }
 const runtime={
  catalog,
  setInclusion(owner,provider,value){inclusion.set(key(owner,provider),value);},
  setConfigured(provider,value){value?configured.add(provider):configured.delete(provider);},
  /** Token response admission: exact scopes, bounded explicit lifetime, Bearer only. */
  connect(owner,provider,token){
   const e=entry(provider);
   check(token.token_type==='Bearer'&&Number.isSafeInteger(token.expires_in)&&token.expires_in>0&&token.expires_in<=e.authorization.maxAccessSeconds,'INVALID_TOKEN',provider);
   const granted=token.scope===undefined?e.scopes:token.scope.split(' ');
   check(granted.every(s=>e.scopes.includes(s)),'SCOPE_WIDENED',provider);
   check(!token.refresh_token||e.authorization.refresh!=='none','UNEXPECTED_REFRESH',provider);
   const prior=credentials.get(key(owner,provider));check(!prior||prior.state!=='active','DISCONNECT_FIRST',provider);
   const c={id:id(),ownerId:owner,provider,state:'active',scopes:granted,access:token.access_token,refresh:token.refresh_token??null,expiresAt:now()+token.expires_in*1000,generation:1,refreshing:null};
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
   buildRequest(catalog,provider,operationId,params);
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
   const request=buildRequest(catalog,provider,operationId,params);
   await access(c,provider);check(c.state==='active','NOT_CONNECTED',provider);
   const response=await send(c,provider,request);
   check(response.status===200,'PROVIDER_ERROR',provider);
   // Provenance marks the data untrusted; nothing in it can confirm consent, a review or a tool call.
   return Object.freeze({provenance:'untrusted-external',dataClass:op.dataClass,destination,data:response.json});
  },
  /** Exact review: binds destination, input digest, credential, catalog operation digest and price. */
  prepareAction(principal,provider,operationId,params,body,{marker}={}){
   const {e,op,c}=admitUse(principal,provider,operationId);
   check(op.kind==='action','NOT_AN_ACTION',operationId);
   const request=buildRequest(catalog,provider,operationId,params,body);
   if(principal.kind==='rule'){
    const a=principal.approval;
    check(a.operationId===operationId&&a.destinationDigest===digest(params)&&a.bodyTemplateDigest===digest(body),'RULE_DESTINATION_MISMATCH',operationId);
    const used=ruleUse.get(principal.ruleId+':'+principal.ruleRevision)??0;check(used<a.maxPerPeriod,'RULE_LIMIT',operationId);
    ruleUse.set(principal.ruleId+':'+principal.ruleRevision,used+1);
   }
   const receipt={id:id(),ownerId:principal.ownerId,authority:principal.kind==='rule'?'approved-rule':'owner-request',provider,operationId,credentialId:c.id,
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
   const request=buildRequest(catalog,r.provider,plan.operationId,plan.params,plan.body);
   await access(c,r.provider);
   const response=await send(c,r.provider,request);
   if(response.status===200&&plan.matches(response.json)){r.state='observed';}
   return {state:r.state};
  },
  receipt(receiptId){const r=receipts.get(receiptId);return r&&{state:r.state,dispatches:r.dispatches,authority:r.authority,price:r.price};},
 };
 return runtime;
}
