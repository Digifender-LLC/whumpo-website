/** WH-056 / WH-141 common connector catalog (contract version 1, docs/connectors.md).
 * Server-owned provider and operation declarations plus their validator and the identities derived from them
 * (connectable providers, launch feature ids, OAuth endpoints and vault contexts). Pure functions over plain data.
 * No storage, route, Chat binding, credential or Worker import. The GitHub/Cloudflare adapters send only operations
 * declared here (through ./builder); only the platform Worker reaches this module at runtime. Every later adapter must
 * repeat its runtime predicates inside its committing statements. */

export class ConnectorContractError extends Error {
 constructor(readonly code:string,readonly path='catalog'){super(`${code}: ${path}`);}
}
export function check(condition:unknown,code:string,path:string):asserts condition {
 if(!condition)throw new ConnectorContractError(code,path);
}
export function plain(value:unknown):value is Record<string,unknown> {
 return value!==null&&typeof value==='object'&&!Array.isArray(value)&&[Object.prototype,null].includes(Object.getPrototypeOf(value));
}
export function shape(value:unknown,keys:readonly string[],path:string,optional:readonly string[]=[]):asserts value is Record<string,unknown> {
 check(plain(value),'INVALID_SHAPE',path);
 check(Object.keys(value).every(key=>keys.includes(key)||optional.includes(key)),'UNKNOWN_FIELD',path);
 check(keys.every(key=>Object.hasOwn(value,key)),'MISSING_FIELD',path);
}
const oneOf=(value:unknown,values:readonly unknown[],code:string,path:string)=>check(values.includes(value),code,path);

/** Frozen vocabularies (contract version 1). There is no reader for any other version. */
export const contractVersion=1;
export const connectorProviders=Object.freeze(['github','cloudflare','gmail','google-calendar','outlook-email','microsoft-calendar','hubspot'] as const);
export const authorityClasses=Object.freeze(['owner-request','approved-rule'] as const);
export const consentKinds=Object.freeze(['owner-control','request-bound'] as const);
export const destinations=Object.freeze(['owner-panel','chat-reply','model-context','review-receipt'] as const);
export const readinessLevels=Object.freeze(['planned','synthetic-conformant','private-test','live-accepted'] as const);
export const receiptStates=Object.freeze(['review','dispatching','applied','unchanged','uncertain','observed','failed','expired','cancelled'] as const);
export const idempotencyKinds=Object.freeze(['precondition-and-mutation-id','marker-readback','provider-idempotency-key'] as const);
export const refreshKinds=Object.freeze(['none','retained-unused','single-flight'] as const);
export const revocationKinds=Object.freeze(['rfc7009','github-token-delete','provider-refresh-delete','local-only-owner-removal'] as const);
/** Vault purposes. `refresh` exists only for providers that retain or use refresh custody. */
export const vaultPurposes=Object.freeze(['token','pkce','refresh'] as const);

export type ConnectorProviderId=typeof connectorProviders[number];
export type AuthorityClass=typeof authorityClasses[number];
export type ConsentKind=typeof consentKinds[number];
export type Destination=typeof destinations[number];
export type Readiness=typeof readinessLevels[number];
export type IdempotencyKind=typeof idempotencyKinds[number];
export type VaultPurpose=typeof vaultPurposes[number];

// Parameter types are closed. Every value is validated and percent-encoded by the server; no caller URL exists.
export const paramTypes=Object.freeze({
 int:(v:unknown)=>Number.isSafeInteger(v)&&(v as number)>=1,
 hex32:(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{32}$/.test(v),
 login:(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9-]{1,39}$/.test(v),
 repo:(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9_.-]{1,100}$/.test(v)&&!['.','..'].includes(v),
 // Exactly what the backup adapter accepts as a GitHub default branch (parseRepo); one encoded path segment.
 branch:(v:unknown)=>typeof v==='string'&&v.length>=1&&v.length<=255&&!/[\u0000-\u001f\u007f]/.test(v),
 hostname:(v:unknown)=>typeof v==='string'&&v.length<=253&&/^[a-z0-9_-]+(?:\.[a-z0-9_-]+)+$/.test(v),
 opaque:(v:unknown)=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,512}$/.test(v),
 instant:(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(v)&&!Number.isNaN(Date.parse(v)),
 query:(v:unknown)=>typeof v==='string'&&v.trim().length>0&&v.length<=200&&!/[\u0000-\u001f\u007f]/.test(v),
});
export type ParamType=keyof typeof paramTypes;

/** Registered fixed GraphQL documents with their closed variable sets. GitHub's must equal the strings the existing
 * backup code sends (src/connection-recovery.ts and src/github-backups.ts; checked by tests/connectors-contract.mjs). */
export const graphqlDocuments=Object.freeze({
 BackupPaths:'query BackupPaths($owner:String!,$name:String!,$p0:String!,$p1:String!,$p2:String!,$p3:String!){repository(owner:$owner,name:$name){p0:object(expression:$p0){__typename oid} p1:object(expression:$p1){__typename oid} p2:object(expression:$p2){__typename oid} p3:object(expression:$p3){__typename oid}}}',
 BackupCommit:'mutation BackupCommit($input:CreateCommitOnBranchInput!){createCommitOnBranch(input:$input){commit{oid}}}',
});
export type GraphQLDocumentId=keyof typeof graphqlDocuments;
/** `string` variables are bounded strings; `object` variables are plain JSON objects typed by the fixed document. */
export const graphqlVariables:Readonly<Record<GraphQLDocumentId,Readonly<Record<string,'string'|'object'>>>>=Object.freeze({
 BackupPaths:Object.freeze({owner:'string',name:'string',p0:'string',p1:'string',p2:'string',p3:'string'}),
 BackupCommit:Object.freeze({input:'object'}),
});

export type Price={customerUnits:number;basis:'plan-inclusion'|'quoted'};
export type ConnectorOperation={
 kind:'read'|'action';authority:readonly AuthorityClass[];feature:'read'|'dispatch';method:'GET'|'POST';
 origin:string;path:string;query:readonly (readonly [string,string])[];
 body:null|{kind:'graphql';document:GraphQLDocumentId}|{kind:'json';fields:readonly string[]};
 params:Readonly<Record<string,ParamType>>;scopes:readonly string[];consent:ConsentKind;destinations:readonly Destination[];
 dataClass:string;review:'none'|'exact';idempotency:IdempotencyKind|null;reconcile:readonly string[];price:Price;
 bounds:{maxBytes:number;maxItems:number;maxRangeDays?:number};
};
export type ConnectorAuthorization={
 kind:'github-app-user'|'oauth-code-pkce'|'oauth-code';authorize:string;token:string;revoke:string|null;
 revocation:typeof revocationKinds[number];refresh:typeof refreshKinds[number];maxAccessSeconds:number;
};
export type ConnectorProviderEntry={
 readiness:Readiness;featureId:`connections.${ConnectorProviderId}`;authorization:ConnectorAuthorization;
 origins:readonly string[];scopes:readonly string[];operations:Readonly<Record<string,ConnectorOperation>>;
};
export type ConnectorCatalog={contractVersion:1;providers:Readonly<Partial<Record<ConnectorProviderId,ConnectorProviderEntry>>>};

const included:Price={customerUnits:0,basis:'plan-inclusion'};
type Declared='origin'|'path'|'params'|'scopes'|'consent'|'destinations'|'dataClass'|'bounds';
type ReadInput=Pick<ConnectorOperation,Declared>&Partial<Pick<ConnectorOperation,'method'|'query'|'body'>>;
type ActionInput=Pick<ConnectorOperation,Exclude<Declared,'consent'|'destinations'>|'method'|'body'|'idempotency'|'reconcile'>&Partial<Pick<ConnectorOperation,'authority'>>;
const read=(o:ReadInput):ConnectorOperation=>({kind:'read',authority:['owner-request'],feature:'read',method:'GET',query:[],body:null,review:'none',idempotency:null,reconcile:[],price:{...included},...o});
const action=(o:ActionInput):ConnectorOperation=>({kind:'action',authority:['owner-request'],feature:'dispatch',consent:'owner-control',review:'exact',query:[],destinations:['review-receipt'],price:{...included},...o});

export function deepFreeze<T>(value:T):T {
 if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const item of Object.values(value))deepFreeze(item);}
 return value;
}

/** Frozen v1 catalog. GitHub and Cloudflare declare exactly the requests their current adapters send. `planned`
 *  providers are contract declarations only: no client, scope request or adapter exists, and every helper below
 *  refuses them. Planned provider identifiers (hosts/scopes) require re-verification in each provider's contract child. */
export const connectorCatalog=deepFreeze({
 contractVersion:1,
 providers:{
  github:{readiness:'private-test',featureId:'connections.github',
   authorization:{kind:'github-app-user',authorize:'https://github.com/login/oauth/authorize',token:'https://github.com/login/oauth/access_token',revoke:'https://api.github.com/applications/{clientId}/token',revocation:'github-token-delete',refresh:'retained-unused',maxAccessSeconds:28800},
   origins:['https://api.github.com'],scopes:['metadata:read','contents:write'],
   operations:{
    'user.get':read({origin:'https://api.github.com',path:'/user',params:{},scopes:['metadata:read'],consent:'owner-control',destinations:['owner-panel'],dataClass:'connections',bounds:{maxBytes:524288,maxItems:1}}),
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
} satisfies ConnectorCatalog);
type CatalogProviders=typeof connectorCatalog.providers;
/** Type-level catalog identity: the providers whose declaration is not `planned` ('github' | 'cloudflare' today).
 * Modules that other Workers reach (feature admission) import this as a type only, never the catalog at runtime. */
export type ConnectableProviderId={[P in keyof CatalogProviders]:CatalogProviders[P] extends {readiness:'planned'}?never:P}[keyof CatalogProviders];

const operationKeys=['kind','authority','feature','method','origin','path','query','body','params','scopes','consent','destinations','dataClass','review','idempotency','reconcile','price','bounds'];
const templateName=/\{([a-z][A-Za-z]*)\}/g;
function exactOrigin(value:unknown){
 if(typeof value!=='string')return false;
 try{const u=new URL(value);return u.protocol==='https:'&&u.origin===value&&!u.username&&!u.password&&!u.port&&!/^[0-9.]+$|^\[/.test(u.hostname)&&!u.hostname.includes('*');}catch{return false;}
}
function endpoint(value:unknown){
 if(typeof value!=='string'||!/^https:\/\/[^/?#]+\//.test(value))return false;
 try{const u=new URL(value);return exactOrigin(u.origin)&&!u.search&&!u.hash;}catch{return false;}
}

function validateOperation(provider:string,id:string,op:unknown,entry:Record<string,any>){
 const p=`${provider}.${id}`;
 check(/^[a-z][A-Za-z]*(?:\.[a-z][A-Za-z]*)+$/.test(id),'INVALID_ID',p);
 shape(op,operationKeys,p);
 const o=op as Record<string,any>;
 oneOf(o.kind,['read','action'],'INVALID_KIND',p);
 check(Array.isArray(o.authority)&&o.authority.length>=1&&new Set(o.authority).size===o.authority.length&&o.authority.every((a:unknown)=>authorityClasses.includes(a as AuthorityClass))&&o.authority[0]==='owner-request','INVALID_AUTHORITY',p);
 check(o.kind==='action'||!o.authority.includes('approved-rule'),'RULE_READ_FORBIDDEN',p);
 oneOf(o.method,['GET','POST'],'INVALID_METHOD',p);
 check(o.kind==='action'?o.feature==='dispatch':o.feature==='read','INVALID_FEATURE_OPERATION',p);
 check(entry.origins.includes(o.origin),'HOST_NOT_ALLOWED',p);
 check(typeof o.path==='string'&&o.path.startsWith('/')&&!o.path.startsWith('//')&&!/[?#\\%]|\.\.|:\/\//.test(o.path),'INVALID_PATH',p);
 check(Array.isArray(o.query)&&o.query.every((q:unknown)=>Array.isArray(q)&&q.length===2&&q.every(part=>typeof part==='string'&&/^[$A-Za-z0-9_.{}-]{1,64}$/.test(part))),'INVALID_QUERY',p);
 const names=[...o.path.matchAll(templateName),...o.query.flatMap(([,v]:[string,string])=>[...v.matchAll(/^\{([a-z][A-Za-z]*)\}$/g)])].map(m=>m[1]);
 check(plain(o.params)&&Object.values(o.params).every(t=>typeof t==='string'&&Object.hasOwn(paramTypes,t)),'INVALID_PARAM_TYPE',p);
 check(names.length===new Set(names).size&&names.every(n=>Object.hasOwn(o.params,n))&&Object.keys(o.params).every(n=>names.includes(n)),'PARAM_MISMATCH',p);
 check(Array.isArray(o.scopes)&&o.scopes.length>=1&&o.scopes.every((s:unknown)=>entry.scopes.includes(s)),'SCOPE_NOT_DECLARED',p);
 oneOf(o.consent,consentKinds,'INVALID_CONSENT',p);
 check(Array.isArray(o.destinations)&&o.destinations.length>=1&&o.destinations.every((d:unknown)=>destinations.includes(d as Destination)),'INVALID_DESTINATION',p);
 // A model-context destination always needs request-bound consent; owner-control is for metadata/review inputs only.
 check(o.consent==='request-bound'||!o.destinations.includes('model-context'),'CONSENT_TOO_WEAK',p);
 check(typeof o.dataClass==='string'&&/^[a-z][a-z0-9-]+$/.test(o.dataClass),'INVALID_CLASS',p);
 check(Array.isArray(o.reconcile),'INVALID_ACTION_CONTRACT',p);
 check(o.kind==='read'?o.review==='none'&&o.idempotency===null&&o.reconcile.length===0:o.review==='exact'&&idempotencyKinds.includes(o.idempotency)&&o.reconcile.length>=1,'INVALID_ACTION_CONTRACT',p);
 for(const r of o.reconcile)check(typeof r==='string'&&Object.hasOwn(entry.operations,r)&&entry.operations[r]?.kind==='read'&&entry.operations[r].authority.length===1,'INVALID_RECONCILE',p);
 shape(o.price,['customerUnits','basis'],p+'.price');
 const price:Record<string,any>=o.price;
 check(Number.isSafeInteger(price.customerUnits)&&price.customerUnits>=0&&(price.customerUnits===0)===(price.basis==='plan-inclusion')&&['plan-inclusion','quoted'].includes(price.basis),'INVALID_PRICE',p);
 check(o.body===null||(plain(o.body)&&(o.body.kind==='graphql'&&Object.keys(o.body).length===2&&typeof o.body.document==='string'&&Object.hasOwn(graphqlDocuments,o.body.document)||o.body.kind==='json'&&Object.keys(o.body).length===2&&Array.isArray(o.body.fields)&&o.body.fields.length>=1&&o.body.fields.every((f:unknown)=>typeof f==='string'&&/^[A-Za-z][A-Za-z0-9_]*$/.test(f)))),'INVALID_BODY',p);
 check(o.method==='POST'||o.body===null,'INVALID_BODY',p);
 shape(o.bounds,['maxBytes','maxItems'],p+'.bounds',['maxRangeDays']);
 const bounds:Record<string,any>=o.bounds;
 check(Number.isSafeInteger(bounds.maxBytes)&&bounds.maxBytes>0&&bounds.maxBytes<=1048576&&Number.isSafeInteger(bounds.maxItems)&&bounds.maxItems>=1&&bounds.maxItems<=100&&(bounds.maxRangeDays===undefined||Number.isSafeInteger(bounds.maxRangeDays)&&bounds.maxRangeDays>=1&&bounds.maxRangeDays<=366),'INVALID_BOUNDS',p);
}

/** Throws on any catalog that would widen hosts/scopes, allow rule reads, or omit price/reconciliation. */
export function validateCatalog(catalog:unknown):catalog is ConnectorCatalog {
 shape(catalog,['contractVersion','providers'],'catalog');
 check(catalog.contractVersion===contractVersion,'UNSUPPORTED_VERSION','catalog');
 check(plain(catalog.providers)&&Object.keys(catalog.providers).every(p=>connectorProviders.includes(p as ConnectorProviderId)),'UNKNOWN_PROVIDER','catalog.providers');
 for(const [provider,value] of Object.entries(catalog.providers)){
  shape(value,['readiness','featureId','authorization','origins','scopes','operations'],provider);
  const entry=value as Record<string,any>;
  oneOf(entry.readiness,readinessLevels,'INVALID_READINESS',provider);
  check(entry.featureId===`connections.${provider}`,'FEATURE_MISMATCH',provider);
  shape(entry.authorization,['kind','authorize','token','revoke','revocation','refresh','maxAccessSeconds'],provider+'.authorization');
  const a=entry.authorization as Record<string,any>;
  oneOf(a.kind,['github-app-user','oauth-code-pkce','oauth-code'],'INVALID_AUTHORIZATION',provider);
  for(const url of [a.authorize,a.token,a.revoke].filter(u=>u!==null))check(endpoint(url),'HOST_NOT_ALLOWED',provider+'.authorization');
  check((a.revoke===null)===(a.revocation==='local-only-owner-removal'),'INVALID_REVOCATION',provider);
  oneOf(a.revocation,revocationKinds,'INVALID_REVOCATION',provider);oneOf(a.refresh,refreshKinds,'INVALID_REFRESH',provider);
  check(Number.isSafeInteger(a.maxAccessSeconds)&&a.maxAccessSeconds>0&&a.maxAccessSeconds<=28800,'INVALID_LIFETIME',provider);
  check(Array.isArray(entry.origins)&&entry.origins.length>=1&&entry.origins.every(exactOrigin),'HOST_NOT_ALLOWED',provider+'.origins');
  check(Array.isArray(entry.scopes)&&entry.scopes.length>=1&&entry.scopes.every((s:unknown)=>typeof s==='string'&&s.length>0&&!/\s/.test(s))&&new Set(entry.scopes).size===entry.scopes.length,'INVALID_SCOPE',provider+'.scopes');
  check(plain(entry.operations)&&Object.keys(entry.operations).length>=1,'INVALID_SHAPE',provider+'.operations');
  for(const [id,op] of Object.entries(entry.operations))validateOperation(provider,id,op,entry);
 }
 return true;
}

/** One provider entry. Unknown providers and `planned` declarations are refused: they cannot start OAuth, seal
 * credentials or build a request. Common conformance (WH-146) may raise a provider only to `synthetic-conformant`. */
export function availableProvider(catalog:ConnectorCatalog,providerId:unknown):ConnectorProviderEntry {
 check(typeof providerId==='string'&&connectorProviders.includes(providerId as ConnectorProviderId)&&Object.hasOwn(catalog.providers,providerId),'UNKNOWN_PROVIDER',String(providerId));
 const entry=catalog.providers[providerId as ConnectorProviderId]!;
 check(entry.readiness!=='planned','PROVIDER_PLANNED',providerId);
 return entry;
}

/** Catalog-derived provider identity (gap G-C4): the providers that may connect today, in catalog order. */
export const connectableProviders=Object.freeze(connectorProviders.filter(p=>{const e=connectorCatalog.providers[p];return !!e&&e.readiness!=='planned';})) as readonly ConnectableProviderId[];
export const isConnectableProvider=(value:unknown):value is ConnectableProviderId=>typeof value==='string'&&connectableProviders.includes(value as ConnectableProviderId);
/** The WH-122 launch feature id for a catalog provider (the same id `connectionFeature` requests). */
export function connectorFeatureId(providerId:unknown){
 check(typeof providerId==='string'&&connectorProviders.includes(providerId as ConnectorProviderId),'UNKNOWN_PROVIDER',String(providerId));
 return connectorCatalog.providers[providerId as ConnectorProviderId]!.featureId;
}

/** OAuth start descriptor (fixed endpoints and the complete scope set). Planned providers cannot start OAuth. */
export function connectorAuthorization(providerId:unknown){
 const entry=availableProvider(connectorCatalog,providerId);
 return Object.freeze({providerId:providerId as ConnectorProviderId,...entry.authorization,scopes:entry.scopes});
}

/** Vault purposes a provider may seal (gap G-C3). Refresh custody only where the catalog retains or uses it. */
function purposesFor(entry:ConnectorProviderEntry):readonly VaultPurpose[] {
 return vaultPurposes.filter(purpose=>purpose!=='refresh'||entry.authorization.refresh!=='none');
}
const vaultSegment=/^[A-Za-z0-9_-]{1,128}$/;
/** The `whumpo:<provider>:<purpose>:<owner>:<record>` vault context for a given catalog. Planned providers cannot seal
 * credentials. Catalog-parameterised so that offline suites can supply a catalog in which a synthetic provider is available. */
export function catalogVaultContext(catalog:ConnectorCatalog,providerId:unknown,purpose:unknown,ownerId:unknown,recordId:unknown){
 const entry=availableProvider(catalog,providerId);
 check(typeof purpose==='string'&&purposesFor(entry).includes(purpose as VaultPurpose),'VAULT_PURPOSE_NOT_ALLOWED',`${providerId}.${purpose}`);
 check(typeof ownerId==='string'&&vaultSegment.test(ownerId)&&typeof recordId==='string'&&vaultSegment.test(recordId),'INVALID_VAULT_CONTEXT','vault');
 return `whumpo:${providerId}:${purpose}:${ownerId}:${recordId}`;
}
/** The vault context for the frozen catalog. Planned providers cannot seal credentials. */
export function connectorVaultContext(providerId:unknown,purpose:unknown,ownerId:unknown,recordId:unknown){
 return catalogVaultContext(connectorCatalog,providerId,purpose,ownerId,recordId);
}
/** Catalog-derived equivalent of the vault's context pattern; must accept exactly what the vault accepts today. */
export const connectorVaultContextPattern=new RegExp(`^whumpo:(?:${connectableProviders.flatMap(p=>purposesFor(connectorCatalog.providers[p]!).map(purpose=>`${p}:${purpose}`)).join('|')}):[A-Za-z0-9_-]{1,128}:[A-Za-z0-9_-]{1,128}$`);
