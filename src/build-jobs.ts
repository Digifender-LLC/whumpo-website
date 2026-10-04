import {BackendError} from './backend-error';
import {hashToken,newSessionToken} from './security';
import {triageImportedSource} from './backend-imports';
/**
 * WH-074 pooled build job envelope (docs/build-jobs.md).
 * One bounded job per owner-requested application build: per-job lease (only its digest is stored), expiry,
 * private output key bound to project/job/source digest, publish ownership check and explicit cleanup records.
 * The shared pool is the existing stateless QuickJS runtime Worker: nothing here allocates or keeps a container,
 * server or warm workspace per customer. Schema triggers (build_job_*) enforce the same invariants.
 */
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,hex64=/^[0-9a-f]{64}$/;
export const buildJobLimits=Object.freeze({deadlineMs:60000,runtimeBoundMs:30000,perProject:1,perAccount:3,pool:16,cleanupAttempts:5});
/** Public, platform-pinned identity of the prepared runtime image. It is reused across tenants because it holds no tenant input. */
export const runtimeToolchain=Object.freeze({engine:'@jitl/quickjs-wasmfile-release-sync@0.32.0',core:'quickjs-emscripten-core@0.32.0',contract:'runtime-execute-v1',limits:'heap-4MiB;stack-128KiB;interrupts-64;jobs-64'});
const toolchainFields=Object.freeze(['engine','core','contract','limits']);
/** Content-addressed key for a shared, immutable toolchain cache. Tenant/project/job/source fields are refused. */
export async function sharedToolchainKey(identity:Record<string,unknown>=runtimeToolchain){
 const keys=Object.keys(identity).sort();
 if(keys.join()!==[...toolchainFields].sort().join()||keys.some(k=>typeof identity[k]!=='string'||!(identity[k] as string)))throw new BackendError(400,'A shared toolchain key accepts only the public pinned toolchain identity');
 return 'shared/toolchain/'+await hashToken(JSON.stringify(keys.map(k=>[k,identity[k]])));
}
/** Private artifact key: never shared or deduplicated across projects or jobs, even for identical bytes. */
export function privateArtifactKey(project:string,job:string,digest:string){
 if(!uuid.test(project)||!uuid.test(job)||!hex64.test(digest))throw new BackendError(400,'A private artifact key needs a project, job and SHA-256 digest');
 return `private/${project}/${job}/${digest}`;
}

export type Diagnostic={check:'schema'|'type'|'dependency'|'build';status:'passed'|'failed'|'not_run'|'unknown';code?:string};
/**
 * Deterministic checks that run before any runtime spend and before a model repair is offered. No source is executed
 * here: `type` is a static module-shape check (a default-export handler), `dependency` refuses imports, dynamic code
 * and embedded credentials, and `build` is the later bounded QuickJS expected-output check.
 */
export function staticBuildDiagnostics(source:string):Diagnostic[]{
 const triage=triageImportedSource(source);
 const exported=/\bexport\s+default\b/.test(source)||/\bexport\s*\{[^}]*\bas\s+default\b[^}]*\}/.test(source);
 return [
  {check:'schema',status:'passed'},
  exported?{check:'type',status:'passed'}:{check:'type',status:'failed',code:'missing_default_export'},
  triage?{check:'dependency',status:'failed',code:triage}:{check:'dependency',status:'passed'},
 ];
}
export const failedDiagnostic=(diagnostics:readonly Diagnostic[])=>diagnostics.find(d=>d.status==='failed');
export function describeDiagnostics(diagnostics:readonly Diagnostic[]){return diagnostics.map(d=>`${d.check} ${d.status==='not_run'?'not run':d.status}${d.code?' ('+d.code+')':''}`).join('; ');}

export type BuildLease={readonly job:string;readonly token:string};
const leaseDigest=(lease:BuildLease)=>hashToken('build-job-lease|'+lease.job+'|'+lease.token);
const now="strftime('%Y-%m-%dT%H:%M:%fZ','now')";
/** Prepares the job row for the build intent batch. The lease is returned to the admitting request only. */
export async function admitBuildJob(db:D1Database,{id,user,project,inputDigest,sourceDigest}:{id:string;user:string;project:string;inputDigest:string;sourceDigest:string}){
 if(!hex64.test(inputDigest))throw new BackendError(400,'A build job needs its exact input digest');
 const lease:BuildLease={job:id,token:newSessionToken()};
 const statement=db.prepare(`INSERT INTO build_jobs(id,project_id,user_id,purpose,origin,lease_digest,input_digest,toolchain_key,artifact_key,expires_at) VALUES(?,?,?,'project-build','owner-chat',?,?,?,?,strftime('%Y-%m-%dT%H:%M:%fZ','now','+${buildJobLimits.deadlineMs/1000} seconds'))`)
  .bind(id,project,user,await leaseDigest(lease),inputDigest,await sharedToolchainKey(),privateArtifactKey(project,id,sourceDigest));
 return {lease,statement};
}
async function changed(statement:D1PreparedStatement){try{return (await statement.run()).meta.changes===1;}catch{return false;}}
/** Marks the job's single spend. False when the lease is wrong or the job is cancelled, expired or already dispatched. */
export async function dispatchBuildJob(db:D1Database,lease:BuildLease){
 return changed(db.prepare(`UPDATE build_jobs SET dispatched_at=${now} WHERE id=? AND lease_digest=? AND state='running' AND dispatched_at IS NULL AND expires_at>${now}`).bind(lease.job,await leaseDigest(lease)));
}
/** Records the execution outcome under the job's own lease. A cancelled or expired job cannot be finished or later published. */
export async function finishBuildJob(db:D1Database,lease:BuildLease,state:'succeeded'|'failed',diagnostics:readonly Diagnostic[]){
 return changed(db.prepare(`UPDATE build_jobs SET state=?,finished_at=${now},diagnostics_json=? WHERE id=? AND lease_digest=? AND state='running' AND expires_at>${now}`).bind(state,JSON.stringify(diagnostics),lease.job,await leaseDigest(lease)));
}
export type CleanupReason='runtime-returned'|'not-dispatched'|'runtime-unconfirmed'|'runtime-bound-elapsed';
/** Appends one cleanup attempt. Never throws: an unrecorded cleanup stays pending and keeps the slot held. */
export async function recordBuildCleanup(db:D1Database,job:string,reason:CleanupReason){
 return changed(db.prepare(`INSERT INTO build_job_cleanups(job_id,attempt,outcome,reason,held_ms) SELECT id,1+(SELECT count(*) FROM build_job_cleanups WHERE job_id=?),?,?,MAX(0,CAST(round((julianday('now')-julianday(created_at))*86400000) AS INTEGER)) FROM build_jobs WHERE id=?`).bind(job,reason==='runtime-unconfirmed'?'failed':'released',reason,job));
}
/**
 * Deterministic, AI-free reconciliation: expire unfinished jobs past their deadline and release cleanup that is now
 * knowable (never dispatched, or the runtime's per-call bound has elapsed since dispatch). Bounded per call.
 */
export async function reconcileBuildJobs(db:D1Database,scope:{user?:string}={}){
 const filter=scope.user?' AND user_id=?':'',bind=scope.user?[scope.user]:[];
 await db.prepare(`UPDATE build_jobs SET state='expired',finished_at=${now} WHERE state='running' AND expires_at<=${now}${filter}`).bind(...bind).run();
 const {results}=await db.prepare(`SELECT id,dispatched_at FROM build_jobs WHERE state<>'running' AND cleanup<>'released' AND (dispatched_at IS NULL OR dispatched_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now','-${buildJobLimits.runtimeBoundMs/1000} seconds'))${filter} ORDER BY created_at,id LIMIT 50`).bind(...bind).all<{id:string;dispatched_at:string|null}>();
 let released=0;
 for(const row of results)if(await recordBuildCleanup(db,row.id,row.dispatched_at?'runtime-bound-elapsed':'not-dispatched'))released++;
 return {examined:results.length,released};
}
export type BuildJob={id:string;project_id:string;user_id:string;state:string;cleanup:string;diagnostics_json:string|null;artifact_key:string;toolchain_key:string;dispatched_at:string|null;expires_at:string};
export async function readBuildJob(db:D1Database,user:string,id:string){
 return db.prepare('SELECT id,project_id,user_id,state,cleanup,diagnostics_json,artifact_key,toolchain_key,dispatched_at,expires_at FROM build_jobs WHERE id=? AND user_id=?').bind(id,user).first<BuildJob>();
}
/** Output ownership before publish: exact owner/project/job, succeeded with released cleanup and intact private bytes. */
export async function assertBuildOutput(db:D1Database,user:string,project:string,id:string){
 const row=await db.prepare('SELECT j.user_id,j.project_id,j.state,j.cleanup,j.artifact_key,v.source,v.digest FROM build_jobs j JOIN backend_versions v ON v.id=j.id AND v.project_id=j.project_id WHERE j.id=?').bind(id).first<{user_id:string;project_id:string;state:string;cleanup:string;artifact_key:string;source:string;digest:string}>();
 if(!row||row.user_id!==user||row.project_id!==project||row.state!=='succeeded'||row.cleanup!=='released'||row.artifact_key!==privateArtifactKey(project,id,row.digest)||await hashToken(row.source)!==row.digest)throw new BackendError(409,'Build output is not owned by this completed job');
}
/** Owner cancellation. Stops dispatch, completion and publication for this job; an already-sent test is not recalled. */
export async function cancelBuildJob(db:D1Database,user:string,id:string){
 if(!uuid.test(id))throw new BackendError(400,'Choose a build to cancel');
 const job=await readBuildJob(db,user,id);if(!job)throw new BackendError(404,'Build not found');
 if(job.state==='running'||job.state==='succeeded')await changed(db.prepare(`UPDATE build_jobs SET state='cancelled',finished_at=coalesce(finished_at,${now}) WHERE id=? AND user_id=? AND state IN ('running','succeeded')`).bind(id,user));
 await reconcileBuildJobs(db,{user});
 const after=await readBuildJob(db,user,id);if(!after)throw new BackendError(404,'Build not found');
 return after.state==='cancelled'?`Build ${id} is cancelled. It cannot run, record a result or prepare an approval review. ${after.dispatched_at?'A test already sent is not recalled; its receipt stays private.':'No test was sent.'} Capacity cleanup: ${after.cleanup}.`:`Build ${id} is ${after.state} and was not changed.`;
}
export function describeBuildJob(job:BuildJob){
 const diagnostics=job.diagnostics_json?JSON.parse(job.diagnostics_json) as Diagnostic[]:[];
 return `Build job: ${job.state}; capacity cleanup ${job.cleanup}.`+(diagnostics.length?`\nDeterministic checks: ${describeDiagnostics(diagnostics)}.`:'');
}
