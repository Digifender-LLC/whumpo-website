import {claimJob,dueJobs,recoverExpiredJobs,type JobLease,type JobPurpose,type JobRow} from './job-journal';
/** WH-052 P-1: one dispatcher for the every-minute cron. Handlers settle independently; no schema, no new trigger. */
export const dispatchBounds={perType:10,perOwner:2,providerCalls:2,admissionMs:20000} as const;
export type JobClaim='ok'|'owner-cap'|'stop';
export type JobContext={
 /** Ask before claiming one job. 'stop' means the type cap or the deadline is reached; 'owner-cap' means skip this owner's job. */
 claim(owner:string):JobClaim;
 /** Every provider call runs through here: at most dispatchBounds.providerCalls at once across all types. */
 provider<T>(call:()=>Promise<T>):Promise<T>;
};
export type JobType={type:string;run(ctx:JobContext):Promise<unknown>};
/** Rotating start so no type is always first when the deadline cuts a run short. */
export async function dispatchJobs(registry:readonly JobType[],options:{now?:()=>number}={}){
 if(new Set(registry.map(j=>j.type)).size!==registry.length)throw Error('Invalid job registry');
 const clock=options.now??Date.now,start=clock(),shift=registry.length?Math.floor(start/60000)%registry.length:0;
 let active=0;const waiting:Array<()=>void>=[];
 const provider=async<T>(call:()=>Promise<T>)=>{
  if(active>=dispatchBounds.providerCalls)await new Promise<void>(go=>waiting.push(go));else active++;
  try{return await call();}finally{const next=waiting.shift();if(next)next();else active--;}
 };
 const settled=await Promise.allSettled([...registry.slice(shift),...registry.slice(0,shift)].map(job=>{
  let claimed=0;const owners=new Map<string,number>();
  return job.run({provider,claim(owner){
   if(claimed>=dispatchBounds.perType||clock()-start>=dispatchBounds.admissionMs)return 'stop';
   if((owners.get(owner)??0)>=dispatchBounds.perOwner)return 'owner-cap';
   claimed++;owners.set(owner,(owners.get(owner)??0)+1);return 'ok';
  }});
 }));
 // Every type has settled before the first failure escapes raw, as the single contact drain's failure did before the registry.
 const failed=settled.find(r=>r.status==='rejected');if(failed)throw failed.reason;
 return settled.length;
}

/** WH-052 P-2: a journal-backed lane. `claim()` still asks the in-memory per-run caps first (decision D3: per-type, per-owner and deadline caps are not
 * stored); a job it admits is then claimed with a D1 lease, so overlapping ticks or a second Worker never run the same job twice. A lost race is skipped.
 * The handler gets the leased job and its lease; it must settle through src/job-journal.ts (beginExternal before any outside call). A handler that throws
 * leaves the job leased: after the lease expires an unsent job is claimed again, a job with an intent recorded becomes uncertain and is never resent. */
export function journalLane(db:Pick<D1Database,'prepare'|'batch'>,lane:{type:string;purpose:JobPurpose;handle(job:JobRow,lease:JobLease,ctx:JobContext):Promise<unknown>;now?:()=>number;scan?:number}):JobType{
 const clock=lane.now??Date.now;
 return {type:lane.type,async run(ctx){
  await recoverExpiredJobs(db,clock(),lane.purpose);
  let failure:unknown,failed=false;
  for(const due of await dueJobs(db,lane.purpose,clock(),dispatchBounds.perOwner,lane.scan??25)){
   const verdict=ctx.claim(due.owner_user_id);
   if(verdict==='stop')break;
   if(verdict==='owner-cap')continue;
   const claimed=await claimJob(db,due.owner_user_id,due.id,clock());
   if(!claimed)continue;
   try{await lane.handle(claimed.row,claimed.lease,ctx);}catch(error){if(!failed){failed=true;failure=error;}}
  }
  if(failed)throw failure;
 }};
}
