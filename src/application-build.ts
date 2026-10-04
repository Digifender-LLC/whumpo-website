import {projectRuntime} from './runtime-lane';
import {BackendError,listBackends,testBackend} from './backend-versions';
import {prepareApplication,readApplicationReview,describeApplicationReview} from './app-activation';
import {hashToken} from './security';
import {readBackendComponent} from './backend-library';
import {requireExtensionPlan} from './composition-plans';
import {admitBuildJob,assertBuildOutput,describeBuildJob,dispatchBuildJob,failedDiagnostic,finishBuildJob,readBuildJob,reconcileBuildJobs,recordBuildCleanup,staticBuildDiagnostics,type Diagnostic} from './build-jobs';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const bytes=(value:string)=>new TextEncoder().encode(value).length;
type Build={project_id:string;user_id:string;request_hash:string};
function pair(value:unknown,second:string){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==2||!Object.hasOwn(value,'state')||!Object.hasOwn(value,second))throw new BackendError(400,`Provide exactly {state,${second}} for the synthetic application check`);
 for(const item of Object.values(value)){let json:string|undefined;try{json=JSON.stringify(item);}catch{/* Reject non-JSON before creating a draft. */}if(json===undefined||bytes(json)>4096)throw new BackendError(400,'Each synthetic state, input and result must fit 4 KiB of JSON');}
}
export async function readApplicationBuild(db:D1Database,user:string,id:string){
 const row=await db.prepare('SELECT b.project_id FROM application_builds b JOIN projects p ON p.id=b.project_id AND p.owner_user_id=b.user_id WHERE b.id=? AND b.user_id=?').bind(id,user).first<{project_id:string}>();
 if(!row)throw new BackendError(404,'Application build not found');
 const review=await db.prepare('SELECT id FROM app_activation_reviews WHERE id=? AND user_id=?').bind(id,user).first();
 if(review)return describeApplicationReview(await readApplicationReview(db,user,id));
 const run=await db.prepare('SELECT state,result_json FROM backend_runs WHERE id=? AND user_id=?').bind(id,user).first<{state:string;result_json:string|null}>();
 const result=run?.result_json?JSON.parse(run.result_json):null,job=await readBuildJob(db,user,id);
 const failed=job?.diagnostics_json?failedDiagnostic(JSON.parse(job.diagnostics_json) as Diagnostic[]):undefined;
 const status=!run&&failed?'Deterministic checks failed before any test, so no test was run and no test allowance was used. No model repair was run. Ask me to correct the private draft if you want a repair.':job?.state==='cancelled'?'This build was cancelled. It cannot record a result or prepare an approval review.':job?.state==='expired'&&!run?'This build expired before its test was sent. Ask for a new build if you still want one.':!run?'The draft was saved, but no test was reserved. Ask me to inspect and check the saved version.':run.state!=='complete'?'The test is pending or its outcome is unknown. It will not execute again automatically.':result?.ok===true&&result?.check?.status==='passed'?`The synthetic check passed. An approval review has not been prepared. Ask to prepare the application activation review using this saved version and successful test.`:'The synthetic check did not pass. No approval review was prepared. Ask me to inspect the receipt and correct the private draft.';
 return `Private application build\nProject: ${row.project_id}\nVersion: ${id}\n${status}\n${job?describeBuildJob(job)+'\n':''}Ask to read the saved source and test receipt for build ${id}.\nNo application was activated or visitor page published by this build.`;
}
export async function buildApplication(db:D1Database,user:string,id:string,action:Record<string,unknown>,service?:Fetcher){
 let component:Awaited<ReturnType<typeof readBackendComponent>>|undefined;
 if(Object.hasOwn(action,'reference')){
  if(Object.keys(action).some(k=>!['kind','operation','projectId','reference'].includes(k))||typeof action.reference!=='string')throw new BackendError(400,'Choose an exact application library reference without replacement source or test data');
  component=await readBackendComponent(action.reference);
  if(!('usage' in component)||component.usage!=='application-transition')throw new BackendError(400,'This helper is not an application transition');
  action={kind:action.kind,operation:action.operation,projectId:action.projectId,source:component.source,input:component.example.input,expected:component.example.expected};
 }
 if(Object.keys(action).some(k=>!['kind','operation','projectId','source','input','expected','planId'].includes(k))||!uuid.test(id)||typeof action.projectId!=='string'||!uuid.test(action.projectId)||typeof action.source!=='string'||!action.source.trim()||bytes(action.source)>8192)throw new BackendError(400,'Provide an owned project, a private JavaScript module and a synthetic application check');
 pair(action.input,'input');pair(action.expected,'result');
 const inputJSON=JSON.stringify(action.input),expectedJSON=JSON.stringify(action.expected);
 if(bytes(inputJSON)>8192)throw new BackendError(400,'Combined synthetic input exceeds 8 KiB');
 if(!service)throw new BackendError(503,'Backend testing is not connected in this environment');
 await listBackends(db,user,action.projectId);
 const digest=await hashToken(action.source),requestHash=await hashToken(JSON.stringify([action.projectId,digest,inputJSON,expectedJSON,...(component?[{reference:component.reference}]:action.planId?[{planId:action.planId}]:[])]));
 const read=()=>db.prepare('SELECT project_id,user_id,request_hash FROM application_builds WHERE id=?').bind(id).first<Build>();
 const match=(row:Build)=>{if(row.user_id!==user||row.project_id!==action.projectId||row.request_hash!==requestHash)throw new BackendError(409,'Application build ID already used');};
 const prior=await read();
 if(prior){match(prior);return readApplicationBuild(db,user,id);}
 if(component&&component.state!=='available')throw new BackendError(409,'This component was withdrawn. Choose an available version.');
 const provenance=component?db.prepare('INSERT INTO backend_component_instances(version_id,component_id,component_version,artifact_digest,provenance,license) VALUES(?,?,?,?,?,?)').bind(id,component.id,component.version,component.digest,component.provenance,component.license):(await requireExtensionPlan(db,user,action.projectId,action.planId,'visitor-transition'))(id);
 // The intent and version commit together. If acknowledgment is lost, never
 // continue into execution: report the saved private artifact for recovery.
 // WH-074: free capacity whose cleanup is now knowable, then admit one bounded job with the intent.
 await reconcileBuildJobs(db);
 const diagnostics=staticBuildDiagnostics(action.source),job=await admitBuildJob(db,{id,user,project:action.projectId,inputDigest:requestHash,sourceDigest:digest});
 const welcome=await db.prepare("SELECT id FROM chat_turns WHERE id=? AND user_id=? AND user_text=? AND status='pending'").bind(id,user,'/first-app '+action.projectId).first();
 const now=new Date().toISOString();
 try{await db.batch([
  ...(welcome?[db.prepare('INSERT INTO welcome_first_drafts(turn_id,project_id,user_id) VALUES(?,?,?)').bind(id,action.projectId,user)]:[]),
  db.prepare('INSERT INTO backend_versions(id,project_id,source,digest,created_at) VALUES(?,?,?,?,?)').bind(id,action.projectId,action.source,digest,now),
  db.prepare('INSERT INTO application_builds(id,project_id,user_id,request_hash) VALUES(?,?,?,?)').bind(id,action.projectId,user,requestHash),
  job.statement,
  provenance,
  db.prepare("INSERT INTO activity_events(id,user_id,project_id,action,summary,created_at) VALUES(?,?,?,'application.draft.created','Saved a private application draft for a synthetic check',?)").bind('application-build:'+id,user,action.projectId,now)
 ]);}catch(error){
  const saved=await read();if(saved){match(saved);return readApplicationBuild(db,user,id);}
  if(String(error).includes('welcome_first_draft_changed'))throw error;
  if(String(error).includes('build_job_capacity'))throw new BackendError(429,'Shared build capacity for this project or account is not available right now. Nothing was saved; try again later.');
  throw new BackendError(409,'Application draft was not saved. Check project ownership, the draft allowance and whether existing visitors require a data migration.');
 }
 // Deterministic diagnostics precede any spend; a failure is reported for an optional owner-requested repair.
 if(failedDiagnostic(diagnostics)){
  await finishBuildJob(db,job.lease,'failed',[...diagnostics,{check:'build',status:'not_run'}]);await recordBuildCleanup(db,id,'not-dispatched');
  return readApplicationBuild(db,user,id);
 }
 if(!await dispatchBuildJob(db,job.lease)){await reconcileBuildJobs(db);return readApplicationBuild(db,user,id);}
 let returned=false;
 try{
  const run=await testBackend(db,await projectRuntime(service,action.projectId),user,action.projectId,id,id,action.input,{expected:action.expected});
  const result='result' in run?run.result as {ok?:boolean;error?:string;check?:{status?:string}}|undefined:undefined;
  const passed=run.state==='complete'&&result?.ok===true&&result?.check?.status==='passed';
  returned=run.state==='complete'&&result?.error!=='unavailable';
  const finished=await finishBuildJob(db,job.lease,passed?'succeeded':'failed',[...diagnostics,{check:'build',status:passed?'passed':run.state==='complete'?'failed':'unknown',...(result?.error?{code:result.error}:{})}]);
  await recordBuildCleanup(db,id,returned?'runtime-returned':'runtime-unconfirmed');
  if(passed&&finished){
   await assertBuildOutput(db,user,action.projectId,id);
   // WH-126: an application consumes the project's visitor access module (visitor identity); without one, no review.
   if(!await db.prepare("SELECT 1 FROM module_instances WHERE project_id=? AND kind='access'").bind(action.projectId).first())
    return `The private application draft ${id} passed its test and was saved. Visitors sign in through this project’s visitor access module, which has not been set up, so no application review was prepared. Nothing was activated or published.`;
   return describeApplicationReview(await prepareApplication(db,user,action.projectId,id,'enable',id,id));
  }
  return await readApplicationBuild(db,user,id);
 }catch{
  if(!returned){await finishBuildJob(db,job.lease,'failed',[...diagnostics,{check:'build',status:'unknown'}]);await recordBuildCleanup(db,id,'runtime-unconfirmed');}
  return `A private application draft was saved, but its test or approval review could not be confirmed. Ask to check the saved application build ${id} before continuing. This build will not automatically run another test. Nothing was activated or published by this build.`;
 }
}
