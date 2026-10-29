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
