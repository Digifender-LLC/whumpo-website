/** WH-132 restricted case review client. Read-only: it can call only the four audited read actions of the existing
 * operator API, never a write. The server still enforces the fresh passkey proof and the named case role on every
 * call; this client only reauthenticates once when the proof is stale and reports a missing role as "restricted". */
export const operatorReadActions=Object.freeze(['holds/list','cases/read','cases/audit','disclosures/read'] as const);
export type OperatorReadAction=typeof operatorReadActions[number];
export const operatorSafetyPrefix='/api/operator/safety-cases/v1/';
/** Matches the server's opaque identifier rule; anything else is refused before a request is made. */
export const opaqueReference=/^[A-Za-z0-9_.:-]{1,128}$/;
export type OperatorReadResult={state:'ok';result:unknown}|{state:'restricted'}|{state:'not_found'}|{state:'error';message:string};
type Fetch=(input:string,init:RequestInit)=>Promise<Response>;

const inputs:Record<OperatorReadAction,readonly string[]>={'holds/list':[],'cases/read':['caseId'],'cases/audit':['caseId'],'disclosures/read':['disclosureId','caseId']};
export function operatorReadBody(action:OperatorReadAction,input:Record<string,string>={}){
 if(!operatorReadActions.includes(action))throw Error('Only read actions are available here.');
 const keys=inputs[action];
 if(Object.keys(input).some(k=>!keys.includes(k))||keys.some(k=>!opaqueReference.test(input[k]??'')))throw Error('Use an opaque identifier (letters, digits, _ . : -, up to 128).');
 return {version:1,...Object.fromEntries(keys.map(k=>[k,input[k]]))};
}
/** One read. A stale passkey proof runs `reauth` once and retries the same request; nothing is cached or stored. */
export async function operatorSafetyRead(action:OperatorReadAction,input:Record<string,string>,{fetch:send,reauth}:{fetch:Fetch;reauth:()=>Promise<unknown>}):Promise<OperatorReadResult>{
 const body=JSON.stringify(operatorReadBody(action,input));
 for(let attempt=0;;attempt++){
  const response=await send(operatorSafetyPrefix+action,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json'},body});
  let data:{result?:unknown;code?:unknown}={};try{data=await response.json();}catch{}
  if(response.ok)return {state:'ok',result:data.result};
  if(data.code==='proof_required'&&attempt===0){await reauth();continue;}
  if(data.code==='missing_role')return {state:'restricted'};
  if(data.code==='not_found')return {state:'not_found'};
  return {state:'error',message:data.code==='proof_required'||data.code==='identity_changed'?'Your passkey check did not finish. Try again.':'This restricted read could not finish.'};
 }
}
