import {cmsMediaItemPath,cmsMediaPreviewPath} from './cms-media-preview-shape';
import {cmsMediaListPath} from './cms-media-path';
import {cmsCapabilitiesPath} from './cms-capability-contract';
import {cmsItemId,validCMSDraft,validCMSEdit} from './cms-content-shape';
// Private CMS request authentication. No browser cookie or model-provided identity is trusted.
export type CMSBridgeConfig={projectId:string;ownerId:string;secret:string;origin:string};
export class CMSBridgeError extends Error {constructor(readonly status:number,message:string){super(message);}}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const encoder=new TextEncoder();
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
async function digest(value:string){return hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)));}
export function cmsBridgeConfig(env:Record<string,unknown>):CMSBridgeConfig{
 const projectId=env.TOWNHELLO_CMS_PROJECT_ID,ownerId=env.TOWNHELLO_CMS_OWNER_ID,secret=env.TOWNHELLO_CMS_BRIDGE_KEY,origin=env.TOWNHELLO_CMS_ORIGIN;
 if(typeof projectId!=='string'||!uuid.test(projectId)||typeof ownerId!=='string'||!uuid.test(ownerId)||typeof secret!=='string'||secret.length<43||typeof origin!=='string')throw new CMSBridgeError(503,'CMS ownership is not configured');
 let url:URL;try{url=new URL(origin);}catch{throw new CMSBridgeError(503,'CMS origin is not configured');}
 if(url.protocol!=='https:'||url.origin!==origin)throw new CMSBridgeError(503,'CMS origin is not configured');
 return {projectId,ownerId,secret,origin};
}
async function key(config:CMSBridgeConfig){return crypto.subtle.importKey('raw',encoder.encode(config.secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
async function boundedBody(request:Request){
 const reader=request.body?.getReader();if(!reader)return '';
 const parts:Uint8Array[]=[];let length=0;
 for(;;){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>4096){await reader.cancel();throw new CMSBridgeError(413,'CMS request exceeds its bound');}parts.push(value);}
 const all=new Uint8Array(length);let offset=0;for(const part of parts){all.set(part,offset);offset+=part.length;}
 try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(all);}catch{throw new CMSBridgeError(400,'Invalid CMS request encoding');}
}
function canonical(config:CMSBridgeConfig,method:string,path:string,id:string,expires:number,bodyHash:string){return JSON.stringify(['townhello-cms-v1',config.projectId,config.ownerId,config.origin,method,path,id,expires,bodyHash]);}
export async function signCMSRequest(config:CMSBridgeConfig,path:string,id:string,body?:unknown,now=Date.now(),verb?:'PUT'){
 if(!uuid.test(id)||!path.startsWith('/_emdash/api/')||(/[?#%\\]/.test(path)&&!cmsMediaListPath.test(path)))throw new CMSBridgeError(400,'Invalid CMS request');
 const method=verb??(body===undefined?'GET':'POST'),serialized=body===undefined?'':JSON.stringify(body),expires=Math.floor(now/1000)+60;
 if(encoder.encode(serialized).length>4096)throw new CMSBridgeError(413,'CMS request exceeds its bound');
 const signature=hex(await crypto.subtle.sign('HMAC',await key(config),encoder.encode(canonical(config,method,path,id,expires,await digest(serialized)))));
 return new Request(config.origin+path,{method,headers:{'content-type':'application/json','x-townhello-cms-id':id,'x-townhello-cms-expires':String(expires),'x-townhello-cms-signature':signature},...(body===undefined?{}:{body:serialized})});
}
export async function verifyCMSRequest(request:Request,config:CMSBridgeConfig,now=Date.now()){
 const url=new URL(request.url),id=request.headers.get('x-townhello-cms-id')??'',expiration=request.headers.get('x-townhello-cms-expires')??'',signature=request.headers.get('x-townhello-cms-signature')??'';
 const expires=Number(expiration),seconds=Math.floor(now/1000);
 if(url.origin!==config.origin||(!!url.search&&!cmsMediaListPath.test(url.pathname+url.search))||url.hash||url.username||url.password||!uuid.test(id)||!/^\d{10}$/.test(expiration)||expires<=seconds||expires>seconds+60||!/^[0-9a-f]{64}$/.test(signature)||!['GET','POST','PUT'].includes(request.method)||request.headers.has('cookie')||request.headers.has('authorization'))throw new CMSBridgeError(403,'CMS request not authorized');
 const body=await boundedBody(request.clone()),bodyHash=await digest(body),payload=canonical(config,request.method,url.pathname+url.search,id,expires,bodyHash);
 const valid=await crypto.subtle.verify('HMAC',await key(config),Uint8Array.from(signature.match(/../g)!,v=>parseInt(v,16)),encoder.encode(payload));
 if(!valid)throw new CMSBridgeError(403,'CMS request not authorized');
 // The stable hash excludes assertion expiry, so a fresh signature can read a prior receipt.
 return {id,path:url.pathname+url.search,body,requestHash:await digest(JSON.stringify([config.projectId,config.ownerId,config.origin,request.method,url.pathname+url.search,bodyHash]))};
}
export function cmsRequestAllowed(method:string,path:string,body:string){
 if(method==='GET'&&body===''&&(cmsMediaListPath.test(path)||cmsMediaItemPath.test(path)||cmsMediaPreviewPath.test(path)))return true;
 if(method==='GET'&&[cmsCapabilitiesPath,'/_emdash/api/setup/status','/_emdash/api/auth/me','/_emdash/api/schema/collections'].includes(path)&&body==='')return true;
 const item=path.match(/^\/_emdash\/api\/content\/(posts|pages)\/([^/]+)$/);
 if(method==='GET'&&item&&cmsItemId.test(item[2])&&body==='')return true;
 const publish=path.match(/^\/_emdash\/api\/content\/(posts|pages)\/([^/]+)\/(?:publish|unpublish|discard-draft)$/);
 if(method==='POST'&&publish&&cmsItemId.test(publish[2])){try{const v=JSON.parse(body);return Object.keys(v).length===1&&typeof v._rev==='string'&&/^[A-Za-z0-9+/=_-]{4,256}$/.test(v._rev);}catch{return false;}}
 if(method==='PUT'&&item&&cmsItemId.test(item[2]))return validCMSEdit(body);
 if(method==='POST'&&/^\/_emdash\/api\/content\/(posts|pages)$/.test(path)){if(!validCMSDraft(body))return false;return path.endsWith('/posts')||JSON.parse(body).data.excerpt===undefined;}
 if(method!=='POST'||path!=='/_emdash/api/setup')return false;
 try{const value=JSON.parse(body);return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>['title','tagline','includeContent'].includes(k))&&typeof value.title==='string'&&value.title.trim().length>0&&value.title.length<=100&&(value.tagline===undefined||typeof value.tagline==='string'&&value.tagline.length<=200)&&value.includeContent===false;}catch{return false;}
}
export async function deriveCMSSecret(master:string,projectId:string,ownerId:string,origin:string){
 if(master.length<43||!uuid.test(projectId)||!uuid.test(ownerId))throw new CMSBridgeError(503,'CMS signing configuration unavailable');
 const key=await crypto.subtle.importKey('raw',encoder.encode(master),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 return hex(await crypto.subtle.sign('HMAC',key,encoder.encode(JSON.stringify(['townhello-cms-key-v1',projectId,ownerId,origin]))));
}
export async function callCMS(service:Fetcher,config:CMSBridgeConfig,path:string,id:string,body?:unknown,verb?:'PUT'){
 return callSignedCMS(service,await signCMSRequest(config,path,id,body,Date.now(),verb));
}
export async function callSignedCMS(service:Fetcher,request:Request){
 const controller=new AbortController();
 let timer:ReturnType<typeof setTimeout>;
 const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new CMSBridgeError(503,'CMS response timed out; check state before retrying a write'));},45000);});
 try{
  const response=await Promise.race([service.fetch(new Request(request,{signal:controller.signal,redirect:'manual'})),deadline]);
  if(response.status>=300&&response.status<400){void response.body?.cancel().catch(()=>{});throw new CMSBridgeError(502,'CMS redirects are not allowed');}
  if(!response.headers.get('content-type')?.startsWith('application/json'))throw new CMSBridgeError(502,'CMS returned an invalid response');
  const reader=response.body?.getReader();if(!reader)throw new CMSBridgeError(502,'CMS response unavailable');
  const parts:Uint8Array[]=[];let length=0;
  for(;;){const {value,done}=await Promise.race([reader.read(),deadline]);if(done)break;length+=value.length;if(length>65536){void reader.cancel().catch(()=>{});throw new CMSBridgeError(502,'CMS response exceeds its bound');}parts.push(value);}
  const buffer=new Uint8Array(length);let offset=0;for(const part of parts){buffer.set(part,offset);offset+=part.length;}
  const result=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(buffer));
  if(response.status===409)throw new CMSBridgeError(409,'CMS revision conflict or unresolved receipt; read the draft and inspect this request before preparing another edit');
  if(!response.ok||result?.success!==true)throw new CMSBridgeError(502,'CMS operation was not confirmed');return result.data;
 }catch(error){if(error instanceof CMSBridgeError)throw error;throw new CMSBridgeError(503,'CMS response unavailable; check state before retrying a write');}finally{clearTimeout(timer!);}
}
export async function verifyCMSInitialization(service:Fetcher,config:CMSBridgeConfig){
 const setup=await callCMS(service,config,'/_emdash/api/setup/status',crypto.randomUUID());
 if(setup?.needsSetup!==false)throw new CMSBridgeError(409,'CMS setup is incomplete');
 const owner=await callCMS(service,config,'/_emdash/api/auth/me',crypto.randomUUID());
 if(owner?.email!==config.ownerId+'@owners.townhello.invalid'||owner?.role!==50)throw new CMSBridgeError(409,'CMS owner could not be verified');
 const schema=await callCMS(service,config,'/_emdash/api/schema/collections',crypto.randomUUID());
 const collections=schema?.items;if(!Array.isArray(collections)||!collections.some(c=>c.slug==='posts')||!collections.some(c=>c.slug==='pages'))throw new CMSBridgeError(409,'CMS core collections are missing');
 return {ownerVerified:true,collections:collections.filter(c=>typeof c.slug==='string').map(c=>c.slug).slice(0,25)};
}
