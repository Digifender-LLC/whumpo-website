// Native /api/mobile/v1 transport (docs/mobile-api-v1.md): client admission, the error envelope and bounded JSON.
// Authority never comes from here: the Whumpo-Client header selects a contract and grants nothing.
export type MobileEnvironment=Env&{MOBILE_MINIMUM_BUILD?:string};
export const contractVersion=1,jsonLimit=16384,credentialLimit=8192;
const messages={
 invalid_request:'Check the request and try again.',unknown_field:'Check the request and try again.',missing_field:'Check the request and try again.',
 proof_required:'Sign in to continue.',identity_incomplete:'Finish setting up your account in the browser.',identity_changed:'Your account access changed. Sign in again to continue.',
 not_found:'This item is unavailable.',onboarding_required:'Start your first project in welcome before opening your workspace.',
 stale_revision:'Your conversation changed. Refresh and review it again.',chat_busy:'Your previous reply is still being prepared.',review_unavailable:'This review is stale or expired. Ask for a fresh review.',
 invalid_cursor:'Start the list again.',unsupported_control:'This action is not available in the app.',payload_too_large:'This request is too large.',unsupported_media_type:'Use a prepared JPEG photo.',client_update_required:'Update Whumpo to continue.',
 rate_limited:'Too many requests. Try again in a minute.',unavailable:'Whumpo is temporarily unavailable.',request_conflict:'This request ID was already used for another message.'
} as const;
const statuses={invalid_request:400,unknown_field:400,missing_field:400,proof_required:401,identity_incomplete:403,not_found:404,identity_changed:409,request_conflict:409,onboarding_required:409,stale_revision:409,chat_busy:409,review_unavailable:409,invalid_cursor:400,unsupported_control:400,payload_too_large:413,unsupported_media_type:415,client_update_required:426,rate_limited:429,unavailable:503} as const;
export type MobileCode=keyof typeof statuses;
export class MobileError extends Error{
 constructor(readonly code:MobileCode,readonly extra:Record<string,unknown>={}){super(code);this.name='MobileError';}
}
export const fresh=()=>new MobileError('proof_required',{proof:'fresh_passkey'});
export const signin=()=>new MobileError('proof_required',{proof:'signin'});
const headers=()=>new Headers({'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
export const ok=(body:Record<string,unknown>)=>new Response(JSON.stringify({version:1,...body}),{status:200,headers:headers()});
/** Server-configured floor; unset means every build is admitted until the owner sets MOBILE_MINIMUM_BUILD. */
export function minimumBuild(env?:Pick<MobileEnvironment,'MOBILE_MINIMUM_BUILD'>){const n=Number(env?.MOBILE_MINIMUM_BUILD);return Number.isSafeInteger(n)&&n>=1?n:1;}
export function refusal(e:MobileError,env?:MobileEnvironment){
 const extra=e.code==='client_update_required'?{minimumBuild:minimumBuild(env),contract:contractVersion,next:'update_app'}:e.code==='identity_incomplete'?{next:'browser'}:e.code==='identity_changed'?{proof:'signin'}:e.code==='rate_limited'?{retryAfterSeconds:60}:e.extra;
 const message=e.code==='proof_required'&&e.extra.proof==='fresh_passkey'?'Verify your passkey to continue.':messages[e.code];
 const response=new Response(JSON.stringify({version:1,error:{code:e.code,message,...extra}}),{status:statuses[e.code],headers:headers()});
 if(e.code==='rate_limited')response.headers.set('retry-after','60');
 return response;
}

/** A WH-105 interaction error keeps its own code and status inside the mobile envelope (the contract passes that vocabulary through). */
export const passthrough=(status:number,error:{code:string;message:string;fieldId?:string})=>new Response(JSON.stringify({version:1,error}),{status,headers:headers()});

const plain=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const controlsAllowed=['specification.apply','site.confirm','application.confirm','app.restore'];
const fieldTypes=['text','long-text','choice','multi-choice','boolean','number','date','datetime','resource'];
const bindings=['answer.value@1','interaction.answers@1','owned.projects@1','site.content@1','agent.task-continue@1','site.content-prepare@1'];
const bad=(code:MobileCode='invalid_request'):never=>{throw new MobileError(code);};
function exact(v:unknown,keys:string[]):Record<string,unknown>{
 if(!plain(v))return bad();
 for(const k of Object.keys(v))if(!keys.includes(k))bad('unknown_field');
 for(const k of keys)if(!Object.hasOwn(v,k))bad('missing_field');
 return v;
}
function list(v:unknown,allowed:string[],max:number){
 if(!Array.isArray(v)||v.length>max||!v.every(x=>typeof x==='string'&&allowed.includes(x))||new Set(v).size!==v.length)bad();
}
/** Whumpo-Client admission: strict shape (400), then contract, build and interaction version (426). `/config` alone tolerates a build below the minimum. */
export function admitClient(request:Request,env:MobileEnvironment,config:boolean){
 const raw=request.headers.get('whumpo-client');
 if(raw===null||!/^[\x20-\x7e]{2,4096}$/.test(raw))return bad();
 let h:unknown;try{h=JSON.parse(raw);}catch{return bad();}
 const o=exact(h,['contract','build','platform','controls','interaction']);
 if(!Number.isSafeInteger(o.contract)||(o.contract as number)<0||(o.contract as number)>1e6||!Number.isSafeInteger(o.build)||(o.build as number)<1||(o.build as number)>1e9||o.platform!=='android')bad();
 list(o.controls,controlsAllowed,8);
 const i=exact(o.interaction,['versions','fieldTypes','bindings']);
 const versions=i.versions as unknown[];
 if(!Array.isArray(versions)||versions.length<1||versions.length>4||!versions.every(v=>Number.isSafeInteger(v)&&(v as number)>=1&&(v as number)<=1e6)||new Set(versions).size!==versions.length)bad();
 list(i.fieldTypes,fieldTypes,20);list(i.bindings,bindings,64);
 if(o.contract!==contractVersion||(!config&&(o.build as number)<minimumBuild(env))||versions.length!==1||versions[0]!==1)throw new MobileError('client_update_required');
}
/** Exact-key JSON object, at most 16 KiB, read from the stream so a lying Content-Length cannot bypass the cap. */
export async function readJson(request:Request,keys:string[]):Promise<Record<string,unknown>>{
 if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')??''))bad();
 const length=request.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>jsonLimit))throw new MobileError('payload_too_large');
 const reader=request.body?.getReader();if(!reader)return bad();
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const c=await reader.read();if(c.done)break;size+=c.value.length;if(size>jsonLimit)throw new MobileError('payload_too_large');chunks.push(c.value);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}
 let data:unknown;try{data=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes));}catch{return bad();}
 const o=exact(data,keys);if(o.version!==1)bad();return o;
}
/** The WebAuthn credential is a bounded opaque object; the Android client enforces the same 8 KiB. */
export function credentialJson(v:unknown){
 if(!plain(v))return bad();
 if(new TextEncoder().encode(JSON.stringify(v)).length>credentialLimit)throw new MobileError('payload_too_large');
 return v;
}
/** The controls this build declared (already validated by admitClient); the server issues approval only for these. */
export const declaredControls=(request:Request):string[]=>JSON.parse(request.headers.get('whumpo-client')??'{}').controls??[];
