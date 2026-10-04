/** WH-132 restricted operator transport for safety cases. Same-origin JSON POST only, authenticated by the existing
 * Whumpo passkey session; every operation additionally requires a fresh passkey proof and a named case role, both
 * enforced by `safety-cases.ts` inside the committing SQL. There is no Chat, agent, model or customer route here,
 * responses are `no-store`, and nothing (input, result or failure detail) is logged. */
import {workspaceIdentity} from './workspace-identity/http';
import {IdentityError} from './workspace-identity/authority';
import * as cases from './safety-cases';

type Environment=Pick<Env,'DB'|'FILES'|'ENVIRONMENT'|'TURNSTILE_SECRET'>;
export const safetyCasePrefix='/api/operator/safety-cases/v1/';
const status:Record<cases.SafetyCaseReason,number>={missing_role:403,invalid_input:400,conflict:409,not_found:404,active_hold:409,case_closed:409,capacity:503,unavailable:503};
const maxBody=16384;
function invalid():never{throw new cases.SafetyCaseError('invalid_input');}
function record(value:unknown,keys:readonly string[],optional:readonly string[]=[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)invalid();
 const data=value as Record<string,unknown>,present=Object.keys(data);
 if(data.version!==1||!keys.every(k=>Object.hasOwn(data,k))||present.some(k=>k!=='version'&&!keys.includes(k)&&!optional.includes(k)))invalid();
 return data;
}
async function body(request:Request){
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')??''))invalid();
 const length=request.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>maxBody))invalid();
 const text=await request.text();if(text.length>maxBody)invalid();
 try{return JSON.parse(text) as unknown;}catch{invalid();}
}
type Handler=(env:Environment,principal:unknown,data:Record<string,unknown>)=>Promise<unknown>;
const s=(v:unknown)=>v as string;
const retention=(d:Record<string,unknown>)=>({caseId:s(d.caseId),decision:d.decision as 'extend'|'release',decisionRef:s(d.decisionRef),...(d.extendDays===undefined?{}:{extendDays:d.extendDays as number})});
const actions:Record<string,{keys:readonly string[];optional?:readonly string[];run:Handler}>={
 'roles/grant':{keys:['grantId','operatorAccountId','role'],run:(e,p,d)=>cases.grantSafetyCaseRole(e.DB,p,{grantId:s(d.grantId),operatorAccountId:s(d.operatorAccountId),role:d.role as cases.SafetyCaseRole})},
 'roles/revoke':{keys:['grantId','revokeRef'],run:(e,p,d)=>cases.revokeSafetyCaseRole(e.DB,p,{grantId:s(d.grantId),revokeRef:s(d.revokeRef)})},
 'cases/open':{keys:['caseId','subjectUserId','intakeRef'],run:(e,p,d)=>cases.openSafetyCase(e.DB,p,{caseId:s(d.caseId),subjectUserId:s(d.subjectUserId),intakeRef:s(d.intakeRef)})},
 'cases/link-evidence':{keys:['caseId','evidenceId'],run:(e,p,d)=>cases.linkSafetyCaseEvidence(e.DB,p,{caseId:s(d.caseId),evidenceId:s(d.evidenceId)})},
 'cases/record-finding':{keys:['caseId','finding','decisionRef'],run:(e,p,d)=>cases.recordSafetyCaseFinding(e.DB,p,{caseId:s(d.caseId),finding:d.finding as cases.SafetyCaseFinding,decisionRef:s(d.decisionRef)})},
 'cases/close':{keys:['caseId','closeRef'],run:(e,p,d)=>cases.closeSafetyCase(e.DB,p,{caseId:s(d.caseId),closeRef:s(d.closeRef)})},
 'cases/read':{keys:['caseId'],run:(e,p,d)=>cases.readSafetyCase(e.DB,p,{caseId:s(d.caseId)})},
 'cases/audit':{keys:['caseId'],run:(e,p,d)=>cases.readSafetyCaseAudit(e.DB,p,{caseId:s(d.caseId)})},
 'holds/place':{keys:['holdId','caseId','legalBasisRef','reviewDays','scope'],optional:['projectId','fileId'],
  run:(e,p,d)=>cases.placePreservationHold(e.DB,p,{holdId:s(d.holdId),caseId:s(d.caseId),legalBasisRef:s(d.legalBasisRef),reviewDays:d.reviewDays as number,scope:d.scope as cases.SafetyHoldScope,
   ...(d.projectId===undefined?{}:{projectId:s(d.projectId)}),...(d.fileId===undefined?{}:{fileId:s(d.fileId)})})},
 'holds/release':{keys:['holdId','caseId','releaseRef'],run:(e,p,d)=>cases.releasePreservationHold(e.DB,p,{holdId:s(d.holdId),caseId:s(d.caseId),releaseRef:s(d.releaseRef)})},
 'holds/list':{keys:[],run:(e,p)=>cases.listActivePreservationHolds(e.DB,p)},
 'evidence/capture':{keys:['objectId','caseId','holdId','source','sourceRef'],run:(e,p,d)=>cases.captureSafetyEvidence(e,p,{objectId:s(d.objectId),caseId:s(d.caseId),holdId:s(d.holdId),source:d.source as cases.SafetyEvidenceSource,sourceRef:s(d.sourceRef)})},
 'evidence/dispose':{keys:['objectId','caseId','disposeRef'],run:(e,p,d)=>cases.disposeSafetyEvidence(e,p,{objectId:s(d.objectId),caseId:s(d.caseId),disposeRef:s(d.disposeRef)})},
 'disclosures/request':{keys:['disclosureId','caseId','legalProcessRef','recipientRef','evidenceObjectIds'],run:(e,p,d)=>cases.requestSafetyDisclosure(e.DB,p,{disclosureId:s(d.disclosureId),caseId:s(d.caseId),legalProcessRef:s(d.legalProcessRef),recipientRef:s(d.recipientRef),evidenceObjectIds:d.evidenceObjectIds as string[]})},
 'disclosures/approve':{keys:['disclosureId','caseId','manifestSha256'],run:(e,p,d)=>cases.approveSafetyDisclosure(e.DB,p,{disclosureId:s(d.disclosureId),caseId:s(d.caseId),manifestSha256:s(d.manifestSha256)})},
 'disclosures/record':{keys:['disclosureId','caseId','outcomeRef'],run:(e,p,d)=>cases.recordSafetyDisclosure(e.DB,p,{disclosureId:s(d.disclosureId),caseId:s(d.caseId),outcomeRef:s(d.outcomeRef)})},
 'disclosures/cancel':{keys:['disclosureId','caseId','cancelRef'],run:(e,p,d)=>cases.cancelSafetyDisclosure(e.DB,p,{disclosureId:s(d.disclosureId),caseId:s(d.caseId),cancelRef:s(d.cancelRef)})},
 'retention/list':{keys:[],run:(e,p)=>cases.listSafetyRetentionReviews(e.DB,p)},
 'retention/preview':{keys:['caseId','decision','decisionRef'],optional:['extendDays'],run:(e,p,d)=>cases.previewSafetyRetentionDecision(e.DB,p,retention(d))},
 'retention/apply':{keys:['caseId','decision','decisionRef','reviewSha256'],optional:['extendDays'],run:(e,p,d)=>cases.applySafetyRetentionDecision(e.DB,p,{...retention(d),reviewSha256:s(d.reviewSha256)})},
 'reports/list':{keys:[],run:(e,p)=>cases.listAbuseReports(e.DB,p)},
 'reports/read':{keys:['reportId'],run:(e,p,d)=>cases.readAbuseReport(e.DB,p,{reportId:s(d.reportId)})},
 'reports/triage':{keys:['reportId','decision','decisionRef'],optional:['caseId'],run:(e,p,d)=>cases.triageAbuseReport(e.DB,p,{reportId:s(d.reportId),decision:d.decision as cases.AbuseReportDecision,decisionRef:s(d.decisionRef),...(d.caseId===undefined?{}:{caseId:s(d.caseId)})})},
 'disclosures/read':{keys:['disclosureId','caseId'],run:(e,p,d)=>cases.readSafetyDisclosure(e.DB,p,{disclosureId:s(d.disclosureId),caseId:s(d.caseId)})},
};
export const safetyCaseActions=Object.freeze(Object.keys(actions));
/** Returns null for every other path. Identity failures carry the existing identity codes, so the browser can run the
 * ordinary passkey reauthentication ceremony and retry the same request. */
export async function handleSafetyCaseRequest(request:Request,env:Environment):Promise<Response|null>{
 const url=new URL(request.url);if(!url.pathname.startsWith(safetyCasePrefix))return null;
 const headers=new Headers({'content-type':'application/json; charset=utf-8','cache-control':'no-store','pragma':'no-cache','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
 const respond=(value:unknown,code=200)=>new Response(JSON.stringify(value),{status:code,headers});
 try{
  const action=actions[url.pathname.slice(safetyCasePrefix.length)];
  if(!action||request.method!=='POST'||url.search)return respond({error:'Not found',code:'not_found'},404);
  const principal=await workspaceIdentity(request,env);
  const data=record(await body(request),action.keys,action.optional);
  return respond({version:1,result:await action.run(env,principal,data)});
 }catch(error){
  if(error instanceof IdentityError)return respond({error:error.message,code:error.code},error.status);
  const reason=error instanceof cases.SafetyCaseError?error.reason:'unavailable';
  return respond({error:'Safety case operation refused.',code:reason},status[reason]);
 }
}
