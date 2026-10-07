/** WH-141 current source catalog. Planned declarations confer no executable capability. */

export type ConnectorOperation={
 kind:'read'|'action'; authority:readonly ('owner-request'|'approved-rule')[]; feature:'read'|'dispatch';
 method:'GET'|'POST'; origin:string; path:string; query:readonly (readonly [string,string])[];
 body:null|{kind:'graphql';document:'BackupPaths'|'BackupCommit'}|{kind:'json';fields:readonly string[]};
 params:Readonly<Record<string,ParamType>>; scopes:readonly string[]; consent:'owner-control'|'request-bound';
 destinations:readonly ('owner-panel'|'chat-reply'|'model-context'|'review-receipt')[]; dataClass:string;
 review:'none'|'exact'; idempotency:null|'precondition-and-mutation-id'|'marker-readback'|'provider-idempotency-key';
 reconcile:readonly string[]; price:{readonly customerUnits:number;readonly basis:'plan-inclusion'|'quoted'};
 bounds:{readonly maxBytes:number;readonly maxItems:number;readonly maxRangeDays?:number};
};
export type ParamType='int'|'hex32'|'login'|'repo'|'branch'|'hostname'|'opaque'|'instant'|'query';
function deepFreeze<const T>(value:T):T{if(value&&typeof value==='object'){Object.values(value).forEach(deepFreeze);Object.freeze(value);}return value;}
const included={customerUnits:0,basis:'plan-inclusion'} as const;
const read=(o:Omit<ConnectorOperation,'kind'|'authority'|'feature'|'method'|'query'|'body'|'review'|'idempotency'|'reconcile'|'price'>&Partial<ConnectorOperation>):ConnectorOperation=>({kind:'read',authority:['owner-request'],feature:'read',method:'GET',query:[],body:null,review:'none',idempotency:null,reconcile:[],price:included,...o});
const action=(o:Omit<ConnectorOperation,'kind'|'authority'|'feature'|'consent'|'review'|'query'|'destinations'|'price'>&Partial<ConnectorOperation>):ConnectorOperation=>({kind:'action',authority:['owner-request'],feature:'dispatch',consent:'owner-control',review:'exact',query:[],destinations:['review-receipt'],price:included,...o});
export const graphqlDocuments=deepFreeze({
 BackupPaths:'query BackupPaths($owner:String!,$name:String!,$p0:String!,$p1:String!,$p2:String!,$p3:String!){repository(owner:$owner,name:$name){p0:object(expression:$p0){__typename oid} p1:object(expression:$p1){__typename oid} p2:object(expression:$p2){__typename oid} p3:object(expression:$p3){__typename oid}}}',
 BackupCommit:'mutation BackupCommit($input:CreateCommitOnBranchInput!){createCommitOnBranch(input:$input){commit{oid}}}',
});
export const connectorCatalog=deepFreeze({
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

export type ConnectorProvider=keyof typeof connectorCatalog.providers;
export type ConnectorOperationId<P extends ConnectorProvider>=keyof typeof connectorCatalog.providers[P]['operations']&string;
/** Navigation exposes only implemented adapters; catalog membership alone cannot start OAuth. */
export type ActiveConnectorProvider={[P in ConnectorProvider]:typeof connectorCatalog.providers[P]['readiness'] extends 'planned'?never:P}[ConnectorProvider];
export function isConnectorProvider(value:unknown):value is ConnectorProvider{return typeof value==='string'&&Object.hasOwn(connectorCatalog.providers,value);}
export function isActiveConnectorProvider(value:unknown):value is ActiveConnectorProvider{return isConnectorProvider(value)&&connectorCatalog.providers[value].readiness!=='planned';}
export class ConnectorOperationError extends Error{readonly status=400;constructor(readonly code:string){super('This connector operation is unavailable or invalid.');}}
function requireValue(value:unknown,code:string):asserts value{if(!value)throw new ConnectorOperationError(code);}
const plain=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
function shape(v:unknown,required:readonly string[],optional:readonly string[]=[]):asserts v is Record<string,unknown>{requireValue(plain(v)&&required.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>required.includes(k)||optional.includes(k)),'INVALID_SHAPE');}
const text=(v:unknown,pattern:RegExp,max:number):v is string=>typeof v==='string'&&v.length<=max&&pattern.test(v);
const paramTypes:Record<ParamType,(v:unknown)=>boolean>={
 int:v=>Number.isSafeInteger(v)&&Number(v)>=1,
 hex32:v=>text(v,/^[0-9a-f]{32}$/,32),
 login:v=>text(v,/^[A-Za-z0-9-]{1,39}$/,39),
 repo:v=>text(v,/^[A-Za-z0-9_.-]{1,100}$/,100)&&v!=='.'&&v!=='..',
 branch:v=>text(v,/^[A-Za-z0-9._/-]{1,200}$/,200)&&!v.includes('..')&&!v.startsWith('/'),
 hostname:v=>text(v,/^[a-z0-9_-]+(?:\.[a-z0-9_-]+)+$/,253),
 opaque:v=>text(v,/^[A-Za-z0-9_-]{1,512}$/,512),
 instant:v=>text(v,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,20)&&!Number.isNaN(Date.parse(v)),
 query:v=>typeof v==='string'&&v.trim().length>0&&v.length<=200&&!/[\u0000-\u001f\u007f]/.test(v),
};
export function connectorOperation(provider:unknown,id:unknown):ConnectorOperation{
 requireValue(isActiveConnectorProvider(provider),'PROVIDER_NOT_READY');
 const operations:Readonly<Record<string,ConnectorOperation>>=connectorCatalog.providers[provider].operations;
 requireValue(typeof id==='string'&&Object.hasOwn(operations,id),'UNKNOWN_OPERATION');return operations[id];
}
/** Purpose admission derives from provider readiness and custody declarations, preserving the existing AAD. */
export function connectorVaultContext(context:unknown):boolean{
 if(typeof context!=='string')return false;
 const match=/^whumpo:([a-z-]+):(token|pkce|refresh):[A-Za-z0-9_-]{1,128}:[A-Za-z0-9_-]{1,128}$/.exec(context);
 if(!match||!isActiveConnectorProvider(match[1]))return false;
 const auth=connectorCatalog.providers[match[1]].authorization;
 return match[2]==='token'||match[2]==='pkce'&&(auth.kind as string)!=='oauth-code'||match[2]==='refresh'&&auth.refresh!=='none';
}
/** Fixed documents with closed, typed variables. Extra GraphQL fields can never widen a mutation. */
function graphBody(document:'BackupPaths'|'BackupCommit',body:unknown):string{
 shape(body,['query','variables']);requireValue(body.query===graphqlDocuments[document],'BODY_NOT_ALLOWED');
 const v=body.variables;
 if(document==='BackupPaths'){
  shape(v,['owner','name','p0','p1','p2','p3']);requireValue(paramTypes.login(v.owner)&&paramTypes.repo(v.name),'INVALID_BODY');
  requireValue(['p0','p1','p2','p3'].every(k=>text(v[k],/^[0-9a-f]{40}:whumpo(?:\/[A-Za-z0-9_-]+){0,3}$/,512)),'INVALID_BODY');
 }else{
  shape(v,['input']);const i=v.input;shape(i,['branch','expectedHeadOid','clientMutationId','message','fileChanges']);
  shape(i.branch,['repositoryNameWithOwner','branchName']);const pair=typeof i.branch.repositoryNameWithOwner==='string'?i.branch.repositoryNameWithOwner.split('/'):[];
  requireValue(pair.length===2&&paramTypes.login(pair[0])&&paramTypes.repo(pair[1])&&paramTypes.branch(i.branch.branchName),'INVALID_BODY');
  requireValue(text(i.expectedHeadOid,/^[0-9a-f]{40}$/,40)&&text(i.clientMutationId,/^[0-9a-f-]{36}$/,36),'INVALID_BODY');
  shape(i.message,['headline']);requireValue(text(i.message.headline,/^\[skip ci\] Whumpo source backup [0-9a-f-]{36}$/,80),'INVALID_BODY');
  shape(i.fileChanges,['additions']);const additions=i.fileChanges.additions;requireValue(Array.isArray(additions)&&additions.length>0&&additions.length<=8,'INVALID_BODY');
  for(const a of additions){shape(a,['path','contents']);requireValue(text(a.path,/^whumpo\/[0-9a-f-]{36}\/versions\/[0-9a-f-]{36}\/(?:README\.txt|public\/(?:index\.html|_headers|assets\/[0-9a-f-]{36}\.jpg)|whumpo\/site\.json)$/,256)&&text(a.contents,/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,24*1024*1024),'INVALID_BODY');}
 }
 return JSON.stringify(body);
}
function jsonBody(provider:ConnectorProvider,id:string,body:unknown):string{
 // New adapters must add their own typed body validator before readiness can change.
 requireValue(provider==='cloudflare'&&id==='dnsRecord.create','PROVIDER_NOT_READY');
 shape(body,['type','name','content','ttl','comment'],['proxied']);
 requireValue(['TXT','CNAME'].includes(String(body.type))&&paramTypes.hostname(body.name)&&typeof body.content==='string'&&body.content.length>0&&body.content.length<=8192&&body.ttl===1,'INVALID_BODY');
 requireValue(body.type==='TXT'?body.proxied===undefined:body.proxied===false,'INVALID_BODY');
 requireValue(text(body.comment,body.type==='TXT'?/^Whumpo proof [0-9a-f-]{36}$/:/^Whumpo routing [0-9a-f-]{36}$/,80),'INVALID_BODY');
 return JSON.stringify(body);
}
/** Callers supply declared parameters and typed bodies, never paths, methods, query strings or headers. */
export function buildConnectorRequest<P extends ConnectorProvider>(provider:P,id:ConnectorOperationId<P>,params:Record<string,unknown>={},body?:unknown){
 const op=connectorOperation(provider,id);shape(params,Object.keys(op.params));
 for(const [key,type] of Object.entries(op.params))requireValue(paramTypes[type](params[key]),'INVALID_PARAM');
 if('page' in params)requireValue(Number(params.page)<=(provider==='github'?50:100),'INVALID_PARAM');
 let encoded:string|undefined;
 if(op.body?.kind==='graphql')encoded=graphBody(op.body.document,body);
 else if(op.body?.kind==='json')encoded=jsonBody(provider,id,body);
 else requireValue(body===undefined,'BODY_NOT_ALLOWED');
 const path=op.path.replace(/\{([a-z][A-Za-z]*)\}/g,(_,key:string)=>encodeURIComponent(String(params[key])));
 const query=op.query.length?'?'+new URLSearchParams(op.query.map(([key,value])=>[key,/^\{[a-z][A-Za-z]*\}$/.test(value)?String(params[value.slice(1,-1)]):value])).toString():'';
 const url=op.origin+path+query;requireValue(new URL(url).origin===op.origin,'HOST_NOT_ALLOWED');
 return {url,path:path+query,method:op.method,body:encoded,redirect:'manual' as const,op};
}
