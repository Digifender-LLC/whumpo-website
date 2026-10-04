import {pathToFileURL} from 'node:url';
// WH-007 runbook G11 slice: read-only synthetic probe of the platform health endpoint at an operator-supplied origin.
// One unauthenticated GET per check, no cookies or credentials, no redirects followed, bounded body and time.
// It schedules nothing and delivers no alert: run it by hand or from an owner-approved scheduler (alert delivery stays owner-gated).
export const healthChecks=Object.freeze([{name:'platform',path:'/api/health',expect:body=>body?.status==='ok'}]);
const loopback=new Set(['127.0.0.1','localhost','[::1]']);
/** Accepts only a bare origin: https, or http on loopback for local stubs. No credentials, path, query or fragment. */
export function probeTarget(raw){
 let url;try{url=new URL(raw);}catch{throw Error('Invalid probe target');}
 if(url.username||url.password||url.search||url.hash||(url.pathname!=='/'&&url.pathname!=='')||!(url.protocol==='https:'||(url.protocol==='http:'&&loopback.has(url.hostname))))throw Error('Invalid probe target');
 return url.origin;
}
async function readBounded(response,limit){
 const reader=response.body?.getReader();if(!reader)return '';
 const parts=[];let size=0;
 for(;;){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw Error('too_large');}parts.push(value);}
 return new TextDecoder().decode(Buffer.concat(parts));
}
export async function probeHealth(target,{fetcher=fetch,timeoutMs=10000,now=()=>performance.now()}={}){
 const origin=probeTarget(target);
 if(!Number.isSafeInteger(timeoutMs)||timeoutMs<100||timeoutMs>30000)throw Error('Invalid probe timeout');
 const checks=[];
 for(const check of healthChecks){
  const started=now();
  try{
   const response=await fetcher(origin+check.path,{method:'GET',redirect:'manual',credentials:'omit',headers:{accept:'application/json','cache-control':'no-store'},signal:AbortSignal.timeout(timeoutMs)});
   let body=null;try{body=JSON.parse(await readBounded(response,4096));}catch{body=null;}
   const ok=response.status===200&&check.expect(body);
   checks.push({check:check.name,path:check.path,state:ok?'ok':'failed',status:response.status,latencyMs:Math.round(now()-started),...(ok?{}:{failure:response.status===200?'unexpected_body':'unexpected_status'})});
  }catch(error){
   checks.push({check:check.name,path:check.path,state:'failed',status:null,latencyMs:Math.round(now()-started),failure:error?.name==='TimeoutError'?'timeout':'unreachable'});
  }
 }
 return {target:origin,observedAt:new Date().toISOString(),checks,attention:checks.some(c=>c.state!=='ok'),scope:'Read-only GET of public health endpoints. A pass is liveness of the platform Worker only, not D1, R2, AI, Turnstile, customer sites or provider health. Nothing is scheduled or delivered.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const args=process.argv.slice(2);
  if(!(args.length===1||(args.length===3&&args[1]==='--timeout-ms'&&/^\d{3,5}$/.test(args[2]))))throw Error('arguments');
  const report=await probeHealth(args[0],args[2]?{timeoutMs:Number(args[2])}:{});
  console.log(JSON.stringify(report,null,2));if(report.attention)process.exitCode=2;
 }catch{console.error('Health probe unavailable. Usage: node tools/probe-health.mjs https://ORIGIN [--timeout-ms 100-30000]. The target must be a bare https origin (http only on loopback).');process.exitCode=1;}
}
