import {canonicalJSON,jsonDigest} from '../project-specification/v2/json';
import {workspacePredicate} from '../workspace-identity/admission';
import {ModuleError,decideModule,moduleOperations,moduleRequest,type ModuleDecision,type ModuleOperation,type ModulePrincipal,type ModuleRequest} from './policy';
import {resolveResource,type ResolvedResource} from './registry';
import {accessHandlers,visitorPredicate} from './access';
import {recordsHandlers} from './records';

/** WH-125 shared module request engine (whumpo-modules v1). Every call validates the current envelope,
 * resolves exactly one scoped resource from the server-derived principal, evaluates the policy table and,
 * for writes, commits the handler's statements together with an idempotent receipt whose trigger repeats the
 * instance, revision, pin and principal decision. Deterministic only: no owner-maintenance inference, model
 * context, credentials or funding is reachable from here (checked statically by tests/shared-modules-registry.mjs). */
export type ModuleContext={request:ModuleRequest;resource:ResolvedResource;principal:ModulePrincipal;decision:Extract<ModuleDecision,{decision:'allow'}>};
export type ModuleReadHandler=(db:D1Database,context:ModuleContext)=>Promise<Record<string,unknown>>;
/** Writes return statements to commit atomically and a bounded result that must not echo submitted values. */
export type ModuleWriteHandler=(db:D1Database,context:ModuleContext)=>Promise<{statements:D1PreparedStatement[];result:Record<string,unknown>}>;
export type ModuleHandlers=Partial<{[K in ModuleOperation]:(typeof moduleOperations)[K]['write'] extends true?ModuleWriteHandler:ModuleReadHandler}>;
/** Delivered operation handlers. WH-125 delivered the engine; WH-126 registers `access.me` and `access.list`; WH-127
 * registers the records handlers (forms.submit, records.get/view/update/remove); WH-128–129 register theirs here. An
 * operation without a handler is `unavailable`, never a generated or fallback implementation. */
export const moduleHandlers:ModuleHandlers=Object.freeze({...accessHandlers,...recordsHandlers});

const denied=(d:Extract<ModuleDecision,{decision:'deny'}>)=>new ModuleError(d.reason==='not_found'?'not_found':'forbidden');
const principalKey=(p:ModulePrincipal)=>p.kind==='owner'?['owner',p.userId,p.projectId]:p.kind==='visitor'?['visitor',p.visitorId,p.projectId]:['public',p.projectId];
/** Current principal authority composed into the committing receipt: an owner's current workspace identity and
 * project ownership; a public request has no identity (serving checks activation, never the owner's plan). */
function principalPredicate(db:D1Database,p:ModulePrincipal){
 if(p.kind==='owner'){const actor=workspacePredicate(db,p.userId);return {sql:`(${actor.sql} AND EXISTS(SELECT 1 FROM projects WHERE id=? AND owner_user_id=?))`,params:[...actor.params,p.projectId,p.userId]};}
 if(p.kind==='public')return {sql:'1',params:[] as unknown[]};
 // WH-126: the same visitor session, identity, active access instance, access revision and staff decision.
 return visitorPredicate(p);
}
type Receipt={request_hash:string;result_json:string;created_at:number;config_revision:number};
const response=(r:ModuleRequest,result:Record<string,unknown>,receipt:{createdAt:number;replayed:boolean}|null)=>({api:'whumpo-modules' as const,version:1 as const,operation:r.operation,resourceId:r.resourceId,configRevision:r.configRevision,requestId:r.requestId,receipt,result});

async function authorize(db:D1Database,principal:ModulePrincipal,request:ModuleRequest){
 const resource=await resolveResource(db,principal,request.resourceId,request.configRevision);
 if(moduleOperations[request.operation].kind!==resource.kind)throw new ModuleError('not_found');
 const decision=decideModule(principal,resource.instance,request.operation,request.target);
 if(decision.decision==='deny')throw denied(decision);
 return {request,resource,principal,decision} satisfies ModuleContext;
}
export async function handleModuleRequest(db:D1Database,principal:ModulePrincipal,input:unknown,handlers:ModuleHandlers=moduleHandlers){
 const request=moduleRequest(input),op=moduleOperations[request.operation];
 const context=await authorize(db,principal,request);
 const handler=handlers[request.operation];
 if(!op.write){
  if(!handler)throw new ModuleError('unavailable','This module operation is not delivered yet.');
  const result=await (handler as ModuleReadHandler)(db,context);
  // Fence the read: a revocation, disable, role or revision change while reading discards the result.
  await authorize(db,principal,request);
  const fence=principalPredicate(db,principal);
  if(!await db.prepare(`SELECT 1 WHERE ${fence.sql}`).bind(...fence.params).first())throw new ModuleError('forbidden');
  return response(request,result,null);
 }
 const requestHash=await jsonDigest({operation:request.operation,resourceId:request.resourceId,configRevision:request.configRevision,target:request.target,input:request.input,principal:principalKey(principal)},65536);
 const readback=async()=>{
  const row=await db.prepare('SELECT request_hash,result_json,created_at,config_revision FROM module_request_receipts WHERE instance_id=? AND request_id=? AND project_id=?').bind(request.resourceId,request.requestId,principal.projectId).first<Receipt>();
  if(!row)return null;
  if(row.request_hash!==requestHash)throw new ModuleError('request_conflict');
  return response(request,JSON.parse(row.result_json),{createdAt:row.created_at,replayed:true});
 };
 // Permission was rechecked by authorize() above before an earlier receipt can be revealed.
 const existing=await readback();if(existing)return existing;
 if(!handler)throw new ModuleError('unavailable','This module operation is not delivered yet.');
 const {statements,result}=await (handler as ModuleWriteHandler)(db,context),resultJSON=canonicalJSON(result,2048);
 const gate=principalPredicate(db,principal),r=context.resource;
 const receipt=db.prepare(`INSERT INTO module_request_receipts(instance_id,request_id,project_id,operation,principal_kind,principal_hash,request_hash,config_revision,activation_revision,module_digest,schema_digest,admitted,result_json,created_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,(SELECT 1 WHERE ${gate.sql}),?,unixepoch())`)
  .bind(r.resourceId,request.requestId,r.projectId,request.operation,principal.kind,await jsonDigest(principalKey(principal)),requestHash,r.configRevision,r.activationRevision,r.moduleDigest,r.schemaDigest,...gate.params,resultJSON);
 try{await db.batch([...statements,receipt]);}
 catch(error){
  const text=String(error);
  if(text.includes('module_request_forbidden'))throw new ModuleError('forbidden');
  if(text.includes('module_request_unavailable'))throw new ModuleError('unavailable');
  if(text.includes('module_request_stale'))throw new ModuleError('stale_configuration');
  if(text.includes('module_request_limited'))throw new ModuleError('limited');
  if(text.includes('safety_preservation_hold'))throw new ModuleError('unavailable');
  // A concurrent identical request may have won; otherwise the outcome is unknown: read back, never resend.
  const again=await readback().catch(e=>{if(e instanceof ModuleError)throw e;return null;});
  if(again)return again;
  if(/UNIQUE|PRIMARY KEY/.test(text))throw new ModuleError('request_conflict');
  throw new ModuleError('unresolved');
 }
 const saved=await readback();
 if(!saved)throw new ModuleError('unresolved');
 return {...saved,receipt:{...saved.receipt!,replayed:false}};
}
/** HTTP adapter: typed error bodies only, never submitted values. */
export function moduleErrorResponse(error:unknown){
 if(error instanceof ModuleError)return Response.json(error.body(),{status:error.status,headers:{'cache-control':'no-store'}});
 return null;
}
