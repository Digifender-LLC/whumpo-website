// WH-084 M4: the eight native interaction aliases. Each runs the web WH-105/106 handler unchanged behind the M2 workspace gate; the payloads
// pass through as the contract defines them. The only mobile rules are the 32 KiB bound, the declared-capability check and the error envelope.
import {configuredAI} from '../ai-chat';
import {chatState} from '../chat';
import {handleInteractionRequest} from '../chat-interactions/http';
import {cloudflareConfig} from '../cloudflare-connection';
import {githubConfig} from '../github-connection';
import {workspaceTransport} from '../workspace-identity/admission';
import type {IdentityPrincipal} from '../workspace-identity/authority';
import {MobileError,ok,passthrough,type MobileEnvironment} from './transport';
import {workspace} from './workspace';

const limit=32768;
/** The body, read from the stream so a lying Content-Length cannot bypass the cap. */
async function text(request:Request){
 if(!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type')??''))throw new MobileError('invalid_request');
 const length=request.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||Number(length)>limit))throw new MobileError('payload_too_large');
 const reader=request.body?.getReader();if(!reader)throw new MobileError('invalid_request');
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const c=await reader.read();if(c.done)break;size+=c.value.length;if(size>limit)throw new MobileError('payload_too_large');chunks.push(c.value);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const bytes=new Uint8Array(size);let at=0;for(const c of chunks){bytes.set(c,at);at+=c.length;}
 try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes);}catch{throw new MobileError('invalid_request');}
}
const norm=(c:unknown)=>{const o=c as Record<string,unknown>|null;return o&&typeof o==='object'?JSON.stringify(['versions','fieldTypes','bindings'].map(k=>Array.isArray(o[k])?[...o[k] as unknown[]].sort():null)):'';};
const declared=(request:Request)=>JSON.parse(request.headers.get('whumpo-client')??'{}').interaction;

export const interaction=(request:Request,env:MobileEnvironment,p:IdentityPrincipal,action:string)=>workspace(env,p,true,async(scoped,user)=>{
 const raw=await text(request);
 // `read` carries the client capability; it must be the one the Whumpo-Client header declared, or the form would be judged for a different build.
 if(action==='read'){let d:unknown;try{d=JSON.parse(raw);}catch{throw new MobileError('invalid_request');}if(norm((d as {client?:unknown})?.client)!==norm(declared(request)))throw new MobileError('invalid_request');}
 const web=new Request('https://mobile.invalid/api/chat/interactions/v1/'+action,{method:'POST',headers:{'content-type':'application/json; charset=utf-8'},body:raw});
 const response=await handleInteractionRequest(web,scoped.DB,user,configuredAI(scoped),workspaceTransport(scoped.DB,user),{github:githubConfig(scoped),config:cloudflareConfig(scoped)});
 if(!response)throw new MobileError('not_found');
 const data=await response.json() as Record<string,unknown>;
 if(response.status===200)return ok(data);
 const code=String(data.code),message=String(data.error);
 if(code==='client_update_required')throw new MobileError('client_update_required');
 if(code==='not_found')throw new MobileError('not_found');
 if(code==='request_conflict')throw new MobileError('request_conflict');
 if(code==='continuation_unavailable'&&response.status===409&&message.includes('conversation changed'))throw new MobileError('stale_revision',{currentRevision:(await chatState(scoped.DB,user)).revision});
 return passthrough(response.status,{code,message,...(typeof data.fieldId==='string'?{fieldId:data.fieldId}:{})});
});
