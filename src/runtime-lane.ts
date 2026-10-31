import {hashToken} from './security';
/** Opaque per-project fairness lane for the runtime gate (WH-075). Reveals no tenant context to the runtime. */
export const runtimeLane=(project:string)=>hashToken('runtime-lane|'+project);
/** The runtime binding for one project's executions; every dispatch carries that project's lane header. */
export async function projectRuntime(service:Fetcher,project:string,work:'interactive'|'batch'='interactive'):Promise<Fetcher>{
 const lane=await runtimeLane(project);
 // WH-075 D41: batch work (builds, migration checks) may hold at most one of the two runtime slots.
 return {fetch:(input:RequestInfo|URL,init?:RequestInit)=>service.fetch(input,{...init,headers:{...(init?.headers as Record<string,string>|undefined),'x-whumpo-lane':lane,...(work==='batch'?{'x-whumpo-class':'batch'}:{})}})} as Fetcher;
}
