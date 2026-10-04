export const maintenanceJobs={identity:3600000,chat_drafts:3600000,imports:3600000,hosting:3600000,health:3600000,fair_use:86400000,traffic:86400000,funnel:3600000,guest_previews:86400000,applications:86400000,contacts:86400000,photos:86400000,github:86400000,cloudflare:86400000} as const;
type Job={name:keyof typeof maintenanceJobs;enabled?:boolean;run:()=>Promise<unknown>};

/** Telemetry failure must never suppress cleanup or disclose its thrown value. */
export async function runMaintenance(db:D1Database,jobs:Job[],clock=Date.now){
 if(jobs.some(j=>!Object.hasOwn(maintenanceJobs,j.name))||new Set(jobs.map(j=>j.name)).size!==jobs.length)throw Error('Invalid maintenance jobs');
 const results=await Promise.all(jobs.map(async job=>{
  const id=crypto.randomUUID(),started=clock();let telemetryFailed=false;
  try{await db.prepare(`INSERT INTO maintenance_health(job,run_id,started_at,status) VALUES(?,?,?,'running')
   ON CONFLICT(job) DO UPDATE SET run_id=excluded.run_id,started_at=excluded.started_at,finished_at=NULL,duration_ms=NULL,status='running',failure_category=NULL
   WHERE excluded.started_at>=maintenance_health.started_at`).bind(job.name,id,started).run();}catch{telemetryFailed=true;}
  let status:'completed'|'failed'|'skipped'=job.enabled===false?'skipped':'completed';
  if(job.enabled!==false)try{await job.run();}catch{status='failed';}
  const finished=clock();
  try{
   // Late completions cannot overwrite the latest run, but still preserve the
   // most recent successful completion timestamp independently of run order.
   if(status==='completed')await db.prepare('UPDATE maintenance_health SET last_success_at=MAX(COALESCE(last_success_at,0),?) WHERE job=?').bind(finished,job.name).run();
   await db.prepare('UPDATE maintenance_health SET finished_at=?,duration_ms=?,status=?,failure_category=? WHERE job=? AND run_id=?')
    .bind(finished,Math.max(0,finished-started),status,status==='failed'?'job_failed':null,job.name,id).run();
  }catch{telemetryFailed=true;}
  return {job:job.name,status,telemetryFailed};
 }));
 // Every job has settled before the sanitized scheduler failure is reported.
 if(results.some(r=>r.status==='failed'||r.telemetryFailed))throw Error('Scheduled maintenance or telemetry failed');
 return results;
}
