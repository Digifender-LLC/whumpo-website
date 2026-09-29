// Private CMS request authentication. No browser cookie or model-provided identity is trusted.
export type CMSBridgeConfig={projectId:string;ownerId:string;secret:string;origin:string};
export class CMSBridgeError extends Error {constructor(readonly status:number,message:string){super(message);}}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const encoder=new TextEncoder();
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
async function digest(value:string){return hex(await crypto.subtle.digest('SHA-256',encoder.encode(value)));}
export function cmsBridgeConfig(env:Record<string,unknown>):CMSBridgeConfig{
 const projectId=env.WHUMPO_CMS_PROJECT_ID,ownerId=env.WHUMPO_CMS_OWNER_ID,secret=env.WHUMPO_CMS_BRIDGE_KEY,origin=env.WHUMPO_CMS_ORIGIN;
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
function canonical(config:CMSBridgeConfig,method:string,path:string,id:string,expires:number,bodyHash:string){return JSON.stringify(['whumpo-cms-v1',config.projectId,config.ownerId,config.origin,method,path,id,expires,bodyHash]);}
export async function signCMSRequest(config:CMSBridgeConfig,path:string,id:string,body?:unknown,now=Date.now()){
 if(!uuid.test(id)||!path.startsWith('/_emdash/api/')||/[?#%\\]/.test(path))throw new CMSBridgeError(400,'Invalid CMS request');
 const method=body===undefined?'GET':'POST',serialized=body===undefined?'':JSON.stringify(body),expires=Math.floor(now/1000)+60;
 if(encoder.encode(serialized).length>4096)throw new CMSBridgeError(413,'CMS request exceeds its bound');
 const signature=hex(await crypto.subtle.sign('HMAC',await key(config),encoder.encode(canonical(config,method,path,id,expires,await digest(serialized)))));
 return new Request(config.origin+path,{method,headers:{'content-type':'application/json','x-whumpo-cms-id':id,'x-whumpo-cms-expires':String(expires),'x-whumpo-cms-signature':signature},...(body===undefined?{}:{body:serialized})});
}
export async function verifyCMSRequest(request:Request,config:CMSBridgeConfig,now=Date.now()){
 const url=new URL(request.url),id=request.headers.get('x-whumpo-cms-id')??'',expiration=request.headers.get('x-whumpo-cms-expires')??'',signature=request.headers.get('x-whumpo-cms-signature')??'';
 const expires=Number(expiration),seconds=Math.floor(now/1000);
 if(url.origin!==config.origin||url.search||url.hash||url.username||url.password||!uuid.test(id)||!/^\d{10}$/.test(expiration)||expires<=seconds||expires>seconds+60||!/^[0-9a-f]{64}$/.test(signature)||!['GET','POST'].includes(request.method)||request.headers.has('cookie')||request.headers.has('authorization'))throw new CMSBridgeError(403,'CMS request not authorized');
 const body=await boundedBody(request.clone()),bodyHash=await digest(body),payload=canonical(config,request.method,url.pathname,id,expires,bodyHash);
 const valid=await crypto.subtle.verify('HMAC',await key(config),Uint8Array.from(signature.match(/../g)!,v=>parseInt(v,16)),encoder.encode(payload));
 if(!valid)throw new CMSBridgeError(403,'CMS request not authorized');
 // The stable hash excludes assertion expiry, so a fresh signature can read a prior receipt.
 return {id,path:url.pathname,body,requestHash:await digest(JSON.stringify([config.projectId,config.ownerId,config.origin,request.method,url.pathname,bodyHash]))};
}
export function cmsRequestAllowed(method:string,path:string,body:string){
 if(method==='GET'&&['/_emdash/api/setup/status','/_emdash/api/auth/me','/_emdash/api/schema/collections'].includes(path)&&body==='')return true;
 if(method!=='POST'||path!=='/_emdash/api/setup')return false;
 try{const value=JSON.parse(body);return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>['title','tagline','includeContent'].includes(k))&&typeof value.title==='string'&&value.title.trim().length>0&&value.title.length<=100&&(value.tagline===undefined||typeof value.tagline==='string'&&value.tagline.length<=200)&&value.includeContent===false;}catch{return false;}
}
