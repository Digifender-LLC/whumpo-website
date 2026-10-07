import {IdentityError,type IdentityPrincipal} from '../workspace-identity/authority';
import type {IdentityCeremonyContext} from '../workspace-identity/protocol';

export const currentMobileBuild=4;
export const mobilePrefix='/api/mobile/v1';
export const browserReturn='https://whumpo.com/app/return';
export type MobileEnvironment=Pick<Env,'DB'|'ENVIRONMENT'|'TURNSTILE_SECRET'|'API_LIMITER'|'AUTH_LIMITER'|'MOBILE_ANDROID_PACKAGE'|'MOBILE_ANDROID_CERT_SHA256'|'MOBILE_MINIMUM_BUILD'>;
export type MobileClient=Readonly<{contract:1;build:number;platform:'android';controls:string[];interaction:{versions:number[];fieldTypes:string[];bindings:string[]}}>;
const codes={invalid_request:400,invalid_cursor:400,unsupported_control:400,unknown_field:400,missing_field:400,proof_required:401,identity_incomplete:403,not_found:404,onboarding_required:409,identity_changed:409,account_closing:409,request_conflict:409,stale_revision:409,chat_busy:409,review_unavailable:409,payload_too_large:413,client_update_required:426,rate_limited:429,unavailable:503} as const;
export class MobileError extends Error {
 constructor(readonly code:keyof typeof codes,readonly details:Record<string,unknown>={}){super(({proof_required:'Sign in again to continue.',identity_incomplete:'Complete account setup or recovery in the browser.',identity_changed:'Your account access changed. Sign in and review again.',account_closing:'This account is closing. Open account status in the browser.',client_update_required:'Update Whumpo to continue.',unavailable:'Native access is temporarily unavailable.',rate_limited:'Too many requests. Try again in a minute.',not_found:'This resource is unavailable.'} as Partial<Record<keyof typeof codes,string>>)[code]??'This request could not be accepted.');}
 get status(){return codes[this.code];}
}
export function mobileFailure(error:unknown,env:MobileEnvironment){
 if(error instanceof MobileError)return error;
 if(error instanceof IdentityError){
  if(error.code==='proof_required')return new MobileError('proof_required',{proof:'signin'});
  if(error.code==='account_closing')return new MobileError('account_closing',{next:'browser',browserPath:'/workspace/account'});
  if(error.code==='identity_incomplete')return new MobileError('identity_incomplete',{next:'browser'});
  if(error.code==='client_upgrade_required')return updateRequired(env);
  if(error.code==='identity_changed'||error.code==='request_conflict')return new MobileError(error.code);
  if(error.code==='invalid_identity_request')return new MobileError('invalid_request');
 }
 return new MobileError('unavailable');
}
export const mobileHeaders={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
export const mobileResponse=(body:Record<string,unknown>,status=200)=>new Response(JSON.stringify({version:1,...body}),{status,headers:mobileHeaders});
export function mobileErrorResponse(error:unknown,env:MobileEnvironment){const failure=mobileFailure(error,env);return mobileResponse({error:{code:failure.code,message:failure.message,...failure.details}},failure.status);}
export function minimumBuild(env:MobileEnvironment){const value=env.MOBILE_MINIMUM_BUILD??String(currentMobileBuild);if(!/^[1-9][0-9]{0,8}$/.test(value))throw new MobileError('unavailable');return Math.max(currentMobileBuild,Number(value));}
const updateRequired=(env:MobileEnvironment)=>new MobileError('client_update_required',{minimumBuild:minimumBuild(env),contract:1,next:'update_app'});
export function exact(value:unknown,keys:readonly string[]):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.getPrototypeOf(value)!==Object.prototype)throw new MobileError('invalid_request');
 if(Object.keys(value).some(k=>!keys.includes(k)))throw new MobileError('unknown_field');
 if(keys.some(k=>!Object.hasOwn(value,k)))throw new MobileError('missing_field');
 return value as Record<string,unknown>;
}
export function versioned(value:unknown,keys:string[],env:MobileEnvironment){const data=exact(value,['version',...keys]);if(data.version!==1)throw updateRequired(env);return data;}
const controls=['specification.apply','site.confirm','application.confirm','app.restore'];
const fieldTypes=['text','long-text','choice','multi-choice','boolean','number','date','datetime','resource'];
const bindings=['answer.value@1','interaction.answers@1','owned.projects@1','site.content@1','agent.task-continue@1','site.content-prepare@1'];
function subset(value:unknown,allowed:string[],env:MobileEnvironment):asserts value is string[]{
 if(!Array.isArray(value)||value.length>allowed.length||value.some(v=>typeof v!=='string')||new Set(value).size!==value.length)throw new MobileError('invalid_request');
 if(value.some(v=>!allowed.includes(v)))throw updateRequired(env);
}
export function admitMobileClient(request:Request,env:MobileEnvironment,config=false):MobileClient{
 if(request.headers.has('cookie')||request.headers.has('origin'))throw new MobileError('invalid_request');
 const raw=request.headers.get('whumpo-client');if(!raw||! /^[\x20-\x7e]{2,4096}$/.test(raw))throw new MobileError('invalid_request');
 let value:unknown;try{value=JSON.parse(raw);}catch{throw new MobileError('invalid_request');}
 const data=exact(value,['contract','build','platform','controls','interaction']);
 if(data.contract!==1||data.platform!=='android')throw updateRequired(env);
 if(!Number.isSafeInteger(data.build)||Number(data.build)<1||Number(data.build)>1e9)throw new MobileError('invalid_request');
 if(!config&&Number(data.build)<minimumBuild(env))throw updateRequired(env);
 const interaction=exact(data.interaction,['versions','fieldTypes','bindings']);
 if(!Array.isArray(interaction.versions)||interaction.versions.length!==1||interaction.versions[0]!==1)throw updateRequired(env);
 subset(data.controls,controls,env);subset(interaction.fieldTypes,fieldTypes,env);subset(interaction.bindings,bindings,env);
 return data as MobileClient;
}
export function nativeIdentityConfiguration(env:MobileEnvironment){
 const packageName=env.MOBILE_ANDROID_PACKAGE,certificate=env.MOBILE_ANDROID_CERT_SHA256;
 if(!packageName||! /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/.test(packageName)||!certificate||! /^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/.test(certificate))throw new MobileError('unavailable');
 const hash=Uint8Array.from(certificate.split(':').map(v=>parseInt(v,16)));
 return {packageName,certificate,origin:'android:apk-key-hash:'+btoa(String.fromCharCode(...hash)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')};
}
export function mobileRequestContext(request:Request,env:MobileEnvironment):IdentityCeremonyContext{
 const url=new URL(request.url),local=String(env.ENVIRONMENT)==='local';
 if(!(local?['http://localhost:8787','http://127.0.0.1:8787'].includes(url.origin):String(env.ENVIRONMENT)==='test'&&url.origin==='https://whumpo.com'))throw new MobileError('invalid_request');
 return {origin:nativeIdentityConfiguration(env).origin,rpID:'whumpo.com',client:'android'};
}
export async function mobileInput(request:Request,maxBytes=16384){
 if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')??''))throw new MobileError('invalid_request');
 const length=request.headers.get('content-length');if(length!==null&&(!/^\d+$/.test(length)||Number(length)>maxBytes))throw new MobileError('payload_too_large');
 const reader=request.body?.getReader();if(!reader)throw new MobileError('invalid_request');
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>maxBytes)throw new MobileError('payload_too_large');chunks.push(next.value);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes)) as unknown;}catch{throw new MobileError('invalid_request');}
}
export const iso=(seconds:number)=>new Date(seconds*1000).toISOString();
export const sessionInfo=(p:IdentityPrincipal)=>({expiresAt:iso(p.expiresAt),freshUntil:iso(p.proof.verifiedAt+600)});
export const maskAccount=(email:string)=>email.slice(0,1)+'***@'+email.slice(email.lastIndexOf('@')+1).slice(0,75);
export const mobileUUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
