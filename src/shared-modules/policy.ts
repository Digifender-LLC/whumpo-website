import type {ModuleInstance,ModuleKind} from '../project-specification/v3/types';

/** WH-125 shared module policy (docs/shared-modules.md). Pure: no storage, catalog, inference or network.
 * Handlers import these shapes; scope and principals are always derived by the receiving server. */
export const moduleErrorCodes=['client_update_required','invalid_request','not_found','forbidden','stale_configuration','stale_module_version','request_conflict','unavailable','incompatible','limited','unresolved'] as const;
export type ModuleErrorCode=typeof moduleErrorCodes[number];
/** WH-071 typed category of each frozen code. Errors are bounded and never echo submitted values. */
export const moduleErrorCategory:Record<ModuleErrorCode,'request'|'not_found'|'forbidden'|'stale'|'unavailable'|'incompatible'|'limited'|'unresolved'>={
 client_update_required:'request',invalid_request:'request',not_found:'not_found',forbidden:'forbidden',stale_configuration:'stale',stale_module_version:'stale',
 request_conflict:'stale',unavailable:'unavailable',incompatible:'incompatible',limited:'limited',unresolved:'unresolved',
};
const statuses:Record<ModuleErrorCode,number>={client_update_required:400,invalid_request:400,not_found:404,forbidden:403,stale_configuration:409,stale_module_version:409,request_conflict:409,unavailable:409,incompatible:409,limited:429,unresolved:503};
const messages:Record<ModuleErrorCode,string>={
 client_update_required:'Update Whumpo to use this module.',
 invalid_request:'Send a current module request.',
 not_found:'Module not found.',
 forbidden:'This module operation is not allowed.',
 stale_configuration:'This module changed. Reload it and try again.',
 stale_module_version:'This module version is no longer current. Reload it and try again.',
 request_conflict:'This request ID was already used for a different module request.',
 unavailable:'This module is not available right now.',
 incompatible:'This module change needs a reviewed migration.',
 limited:'This module has reached its current limit.',
 unresolved:'The result is not confirmed. Send the same request again to read its saved result.',
};
export class ModuleError extends Error{
 readonly status:number;readonly category:string;
 constructor(readonly code:ModuleErrorCode,message=messages[code]){super(message);this.status=statuses[code];this.category=moduleErrorCategory[code];}
 body(){return {error:this.message,code:this.code,category:this.category};}
}

/** Closed v1 operation set frozen by WH-123. A registered operation is not a delivered handler. */
export const moduleOperations=Object.freeze({
 'records.view':{kind:'records',write:false},'records.get':{kind:'records',write:false},
 'forms.submit':{kind:'records',write:true},'records.update':{kind:'records',write:true},'records.remove':{kind:'records',write:true},
 'leads.update':{kind:'records',write:true},
 'files.prepareUpload':{kind:'files',write:true},'files.putBytes':{kind:'files',write:true},'files.read':{kind:'files',write:false},
 'files.gallery':{kind:'files',write:false},'files.requestRemoval':{kind:'files',write:true},
 'access.me':{kind:'access',write:false},'access.list':{kind:'access',write:false},
 'access.prepareRole':{kind:'access',write:true},'access.confirmRole':{kind:'access',write:true},
 'collections.readPublic':{kind:'content',write:false},
} as const satisfies Record<string,{kind:ModuleKind;write:boolean}>);
export type ModuleOperation=keyof typeof moduleOperations;
/** WH-093: owner-only operations that also need a current launch feature at the commit (the receipt's `admitted` predicate). Reading, export and
 * removal of the data they wrote stay available without it. Lead stages, notes and due dates are never a visitor, staff or public operation. */
export const ownerFeatureOperations=Object.freeze({'leads.update':'business.leads'} as const satisfies Partial<Record<ModuleOperation,string>>);
/** WH-067 decision D4 (October 31, 2026): these four operations stay in the closed set but are permanently replaced by delivered
 * paths and never get a handler (an engine request for one is `unavailable`). A test fails if one gains a handler or if any other
 * operation lacks one. */
export const replacedOperations=Object.freeze({
 'files.prepareUpload':'files.putBytes carries the declared metadata and the bytes in one request',
 'files.requestRemoval':'the owner photo removal review, which respects saved-version references and safety holds',
 'access.prepareRole':'the accessRoleReview Chat control',
 'access.confirmRole':'the accessRoleApply Chat control (recent sign-in)',
} as const satisfies Partial<Record<keyof typeof moduleOperations,string>>);
export type ModuleRequest={api:'whumpo-modules';version:1;operation:ModuleOperation;resourceId:string;configRevision:number;requestId:string|null;target:Record<string,unknown>|null;input:Record<string,unknown>|null};

const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
const plain=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const authorityKeys=['projectId','ownerId','userId','visitorId','role','roles','approved','path','prefix','bucket','sql'];
/** Request envelope v1. Another api/version is `client_update_required`; there is no fallback reading. */
export function moduleRequest(value:unknown):ModuleRequest{
 if(!plain(value))throw new ModuleError('invalid_request');
 if(value.api!=='whumpo-modules'||value.version!==1)throw new ModuleError('client_update_required');
 const keys=['api','version','operation','resourceId','configRevision','requestId','target','input'];
 if(Object.keys(value).length!==keys.length||!keys.every(k=>Object.hasOwn(value,k)))throw new ModuleError('invalid_request');
 if(typeof value.operation!=='string'||!Object.hasOwn(moduleOperations,value.operation))throw new ModuleError('client_update_required');
 const op=moduleOperations[value.operation as ModuleOperation];
 if(!uuid(value.resourceId)||!Number.isSafeInteger(value.configRevision)||Number(value.configRevision)<1)throw new ModuleError('invalid_request');
 if(op.write?!uuid(value.requestId):value.requestId!==null)throw new ModuleError('invalid_request');
 for(const scope of [value.target,value.input]){
  if(scope!==null&&!plain(scope))throw new ModuleError('invalid_request');
  // Scope, principals, approvals and storage locations are never caller-supplied.
  if(scope&&authorityKeys.some(k=>Object.hasOwn(scope,k)))throw new ModuleError('invalid_request');
 }
 return value as ModuleRequest;
}

/** Server-derived principals. A visitor principal is derived only from the project's visitor session cookie on the
 * visitor origin by the access module (WH-126, `visitorPrincipal` in access.ts): the governing access instance, the
 * session hash, current roles and the access revision are re-checked inside every committing statement. WH-054
 * workspace members, workspace cookies and maintenance jobs are never module principals. */
export type ModulePrincipal={kind:'owner';userId:string;projectId:string}|{kind:'public';projectId:string}
 |{kind:'visitor';projectId:string;visitorId:string;sessionHash:string;accessInstanceId:string;roles:[]|['staff'];accessRevision:number};
export type ModuleDecision={decision:'allow';fields:string[]|null;scope:'all'|'own'|null}|{decision:'deny';reason:'not_found'|'forbidden'|'sign_in_required'};

/** Policy table over the frozen configuration. The registry composes the instance state, revisions and the
 * principal predicate into the committing statement; this table never grants access on its own. */
export function decideModule(p:ModulePrincipal,instance:ModuleInstance,operation:ModuleOperation,target:Record<string,unknown>|null):ModuleDecision{
 const op=moduleOperations[operation];
 if(op.kind!==instance.kind)return {decision:'deny',reason:'not_found'};
 const allow=(fields:string[]|null=null,scope:'all'|'own'|null=null):ModuleDecision=>({decision:'allow',fields,scope});
 const deny=(reason:'not_found'|'forbidden'|'sign_in_required'):ModuleDecision=>({decision:'deny',reason});
 const staff=p.kind==='visitor'&&p.roles.length===1;
 const anonymous=()=>deny(p.kind==='public'?'sign_in_required':'forbidden');
 const t=target??{};
 if(instance.kind==='records'){
  const c=instance.config;
  if(operation==='forms.submit'){
   const f=c.forms.find(x=>x.id===t.formId);if(!f)return deny('not_found');
   return (f.submit==='public'?p.kind==='public'||p.kind==='visitor':f.submit==='visitor'?p.kind==='visitor':staff)?allow():anonymous();
  }
  if(operation==='records.view'){
   const v=c.views.find(x=>x.id===t.viewId);if(!v)return deny('not_found');
   if(p.kind==='owner')return deny('forbidden');
   return (v.audience==='staff'?staff:p.kind==='visitor')?allow([...v.fields],v.scope):anonymous();
  }
  const s=c.schemas.find(x=>x.id===t.recordId);
  if(operation==='records.remove'||operation==='leads.update')return p.kind==='owner'?(s?allow():deny('not_found')):deny('forbidden');
  if(!s)return deny('not_found');
  if(operation==='records.update'){
   if(p.kind==='owner')return allow(s.fields.map(f=>f.key));
   if(!staff)return anonymous();
   const keys=plain(t.changes)?Object.keys(t.changes):[];
   return keys.length&&keys.every(k=>s.staffWrite.includes(k))?allow(keys):deny('forbidden');
  }
  // records.get: owner all fields; staff non-owner fields; a visitor only submitter fields of its own records.
  if(p.kind==='owner')return allow(s.fields.map(f=>f.key),'all');
  if(staff)return allow(s.fields.filter(f=>f.read!=='owner').map(f=>f.key),'all');
  return p.kind==='visitor'?allow(s.fields.filter(f=>f.read==='submitter').map(f=>f.key),'own'):anonymous();
 }
 if(instance.kind==='files'){
  if(operation==='files.requestRemoval')return p.kind==='owner'?allow():deny('forbidden');
  const x=instance.config.collections.find(y=>y.id===t.collectionId);if(!x)return deny('not_found');
  if(operation==='files.prepareUpload'||operation==='files.putBytes'){
   // Upload authority is the collection role policy; names, prefixes and object keys are never consulted.
   const as=p.kind==='owner'?'owner':staff?'staff':p.kind==='visitor'?'visitor':null;
   return as&&x.upload.includes(as)?allow():anonymous();
  }
  if(p.kind==='owner')return allow(null,'all');
  if(operation==='files.gallery'&&(!x.gallery||x.gallery.audience==='staff'&&!staff))return anonymous();
  return (staff?x.read!=='owner':p.kind==='visitor'&&x.read==='submitter')?allow(null,staff?'all':'own'):anonymous();
 }
 if(instance.kind==='access'){
  if(operation==='access.me')return p.kind==='visitor'?allow():deny('sign_in_required');
  return p.kind==='owner'?allow():deny('forbidden');
 }
 // WH-129 content: collections.readPublic serves only the snapshot an exact directory publication review already made
 // public, so every principal may read it from an active instance; drafts and history stay on the owner directory routes.
 if(instance.kind==='content')return instance.config.collections.some(x=>x.id===t.collectionId)?allow():deny('not_found');
 return deny('not_found');
}
