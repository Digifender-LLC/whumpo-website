/** WH-056 / WH-141 typed connector request builder (contract version 1, docs/connectors.md).
 * The only way to form a provider request: a catalog operation ID plus typed parameters, the server-derived authority
 * class and the scopes actually granted. Callers never supply a URL, host, path, header or free-form query or body.
 * Pure: it builds a plain request description and never sends it. The GitHub/Cloudflare adapters send only what it
 * builds; only the platform Worker reaches it. */
import {authorityClasses,availableProvider,check,connectorCatalog,deepFreeze,graphqlDocuments,graphqlVariables,paramTypes,plain,shape,validateCatalog,type AuthorityClass,type ConnectorCatalog,type ConnectorOperation,type ConnectorProviderId} from './catalog';

export type ConnectorRequestInput={
 providerId:string;operationId:string;params:Record<string,unknown>;
 /** Derived on the server from the admitted principal, never from request JSON. */
 authority:AuthorityClass;
 /** Scopes held by the credential that will send the request. */
 grantedScopes:readonly string[];
 body?:unknown;
};
export type ConnectorRequest=Readonly<{
 providerId:ConnectorProviderId;operationId:string;kind:ConnectorOperation['kind'];feature:ConnectorOperation['feature'];
 method:ConnectorOperation['method'];url:string;path:string;body:string|undefined;redirect:'manual';
 operation:ConnectorOperation;
}>;

const inputKeys=['providerId','operationId','params','authority','grantedScopes'];
const encoder=new TextEncoder();
function jsonValue(value:unknown,depth=0):boolean {
 if(depth>12)return false;
 if(value===null||typeof value==='string'||typeof value==='boolean')return true;
 if(typeof value==='number')return Number.isFinite(value);
 if(Array.isArray(value))return value.every(item=>jsonValue(item,depth+1));
 return plain(value)&&Object.values(value).every(item=>jsonValue(item,depth+1));
}

function bodyText(op:ConnectorOperation,body:unknown){
 if(op.body?.kind==='graphql'){
  // Only the registered fixed document, with exactly its declared variables.
  shape(body,['query','variables'],'body');
  check(body.query===graphqlDocuments[op.body.document],'BODY_NOT_ALLOWED','body.query');
  const declared=graphqlVariables[op.body.document];
  shape(body.variables,Object.keys(declared),'body.variables');
  for(const [name,kind] of Object.entries(declared)){
   const v=body.variables[name];
   check(kind==='string'?typeof v==='string'&&v.length<=512&&!/[\u0000-\u001f\u007f]/.test(v):plain(v)&&jsonValue(v),'BODY_NOT_ALLOWED',`body.variables.${name}`);
  }
  return JSON.stringify({query:body.query,variables:body.variables});
 }
 if(op.body?.kind==='json'){
  const fields=op.body.fields;
  check(plain(body)&&Object.keys(body).every(key=>fields.includes(key))&&jsonValue(body),'BODY_NOT_ALLOWED','body');
  const text=JSON.stringify(body);
  check(encoder.encode(text).byteLength<=op.bounds.maxBytes,'TOO_LARGE','body');
  return text;
 }
 check(body===undefined,'BODY_NOT_ALLOWED','body');
 return undefined;
}

function build(catalog:ConnectorCatalog,input:unknown):ConnectorRequest {
 shape(input,inputKeys,'request',['body']);
 const entry=availableProvider(catalog,input.providerId),providerId=input.providerId as ConnectorProviderId;
 const operationId=input.operationId;
 check(typeof operationId==='string'&&Object.hasOwn(entry.operations,operationId),'UNKNOWN_OPERATION',`${providerId}.${String(operationId)}`);
 const op=entry.operations[operationId];
 // Authority class: rules never read, owner-request-only operations refuse rules, and rules need live acceptance.
 const authority=input.authority;
 check(authorityClasses.includes(authority as AuthorityClass),'INVALID_AUTHORITY','request.authority');
 check(authority!=='approved-rule'||op.kind==='action','RULE_READ_FORBIDDEN',operationId);
 check(op.authority.includes(authority as AuthorityClass),'OWNER_REQUEST_ONLY',operationId);
 check(authority!=='approved-rule'||entry.readiness==='live-accepted','ADAPTER_NOT_ACCEPTED',providerId);
 // Scope subset: the credential may hold no scope outside the catalog, and must hold every scope the operation needs.
 const granted=input.grantedScopes;
 check(Array.isArray(granted)&&granted.every(scope=>typeof scope==='string'&&entry.scopes.includes(scope)),'SCOPE_WIDENED',providerId);
 check(op.scopes.every(scope=>granted.includes(scope)),'INSUFFICIENT_SCOPE',operationId);
 // Typed parameters only: exactly the declared names, each of its closed type.
 const params=input.params;
 shape(params,Object.keys(op.params),'params');
 for(const [name,type] of Object.entries(op.params))check(paramTypes[type](params[name]),'INVALID_PARAM',name);
 const path=op.path.replace(/\{([a-z][A-Za-z]*)\}/g,(_,name:string)=>encodeURIComponent(String(params[name])));
 const query=op.query.map(([key,value])=>[key,/^\{[a-z][A-Za-z]*\}$/.test(value)?String(params[value.slice(1,-1)]):value]);
 const search=query.length?'?'+new URLSearchParams(query).toString():'';
 const body=bodyText(op,input.body);
 const url=new URL(op.origin+path+search);
 check(url.origin===op.origin,'HOST_NOT_ALLOWED',providerId);
 // The URL parser must not reinterpret any encoded segment (no dot-segment or separator smuggling).
 check(url.pathname===path&&url.search===search,'INVALID_PATH',operationId);
 return Object.freeze({providerId,operationId,kind:op.kind,feature:op.feature,method:op.method,url:url.href,path:path+search,body,redirect:'manual',operation:op});
}

/** A builder over a validated, frozen snapshot of `catalog`. Unpriced, unreconcilable or widened catalogs are refused. */
export function createRequestBuilder(catalog:unknown){
 validateCatalog(catalog);
 const snapshot=deepFreeze(JSON.parse(JSON.stringify(catalog)) as ConnectorCatalog);
 return (input:ConnectorRequestInput)=>build(snapshot,input);
}
/** The server builder over the frozen v1 catalog. */
export const buildConnectorRequest=createRequestBuilder(connectorCatalog);
