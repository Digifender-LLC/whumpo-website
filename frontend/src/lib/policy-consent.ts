/** WH-016 owner policy consent client. Reads the current adopted policy version and accepts exactly the version and
 * documents digest the owner reviewed. The server is authoritative: it refuses stale versions and gates publication. */
export const policyConsentPath='/api/policy-consent/v1';
export type PolicyDocument={id:string;title:string;url:string};
export type PolicyConsentView={version:1;current:{version:string;documentsSha256:string;adoptedAt:number}|null;accepted:boolean;acceptedAt:number|null;documents:PolicyDocument[]};
export type PolicyResult={state:'ok';value:PolicyConsentView}|{state:'error';code:string;message:string};
type Fetch=(input:string,init:RequestInit)=>Promise<Response>;
async function result(response:Response):Promise<PolicyResult>{
 let data:Record<string,unknown>={};try{data=await response.json();}catch{}
 if(response.ok&&data.version===1)return {state:'ok',value:data as unknown as PolicyConsentView};
 return {state:'error',code:typeof data.code==='string'?data.code:'unavailable',message:typeof data.error==='string'?data.error:'Policies could not load. Try again.'};
}
export async function readPolicies(send:Fetch){return result(await send(policyConsentPath,{method:'GET',credentials:'same-origin',cache:'no-store'}));}
export async function acceptPolicies(current:NonNullable<PolicyConsentView['current']>,send:Fetch){
 return result(await send(policyConsentPath,{method:'POST',credentials:'same-origin',cache:'no-store',headers:{'content-type':'application/json'},
  body:JSON.stringify({version:1,policyVersion:current.version,documentsSha256:current.documentsSha256})}));
}
