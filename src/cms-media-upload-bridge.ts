import {CMSBridgeError,type CMSBridgeConfig} from './cms-bridge';
import {cleanPhoto,maxPhotoBytes} from './photo-format';
export const cmsMediaUploadPath='/_emdash/api/media';
export const cmsMediaUploadLimit=maxPhotoBytes;
const envelopeLimit=maxPhotoBytes+8192,uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/,encoder=new TextEncoder();
const hex=(bytes:ArrayBuffer)=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
const digest=(bytes:Uint8Array)=>crypto.subtle.digest('SHA-256',new Uint8Array(bytes)).then(hex);
const key=(config:CMSBridgeConfig)=>crypto.subtle.importKey('raw',encoder.encode(config.secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
export const isCMSMediaUpload=(request:Request)=>request.method==='POST'&&new URL(request.url).pathname===cmsMediaUploadPath;
function filename(name:string){if(!/^[A-Za-z0-9][A-Za-z0-9 _.-]{0,95}\.jpe?g$/i.test(name))throw new CMSBridgeError(400,'Choose a simple JPEG filename');return name;}
function payload(config:CMSBridgeConfig,id:string,expires:number,type:string,hash:string){return encoder.encode(JSON.stringify(['whumpo-cms-media-v1',config.projectId,config.ownerId,config.origin,'POST',cmsMediaUploadPath,id,expires,type,hash]));}
async function body(request:Request){
 const signal=AbortSignal.timeout(15000),reader=request.body?.getReader();if(!reader)throw new CMSBridgeError(400,'Image body required');
 const cancel=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',cancel,{once:true});
 const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){signal.throwIfAborted();const part=await reader.read();signal.throwIfAborted();if(part.done)break;size+=part.value.length;if(size>envelopeLimit)throw new CMSBridgeError(413,'Image upload exceeds its bound');chunks.push(part.value);}const all=new Uint8Array(size);let offset=0;for(const chunk of chunks){all.set(chunk,offset);offset+=chunk.length;}return all;}
 catch(error){cancel();throw error;}finally{signal.removeEventListener('abort',cancel);reader.releaseLock();}
}
/** Separate signature domain and bounded multipart envelope; JSON bridge limits stay unchanged. */
export async function signCMSMediaUpload(config:CMSBridgeConfig,id:string,bytes:Uint8Array,name:string,now=Date.now()){
 if(!uuid.test(id))throw new CMSBridgeError(400,'Invalid upload request ID');
 const photo=cleanPhoto(bytes),form=new FormData();form.set('file',new File([new Uint8Array(photo.bytes)],filename(name),{type:'image/jpeg'}));
 const request=new Request(config.origin+cmsMediaUploadPath,{method:'POST',body:form}),raw=new Uint8Array(await request.arrayBuffer()),type=request.headers.get('content-type')!,expires=Math.floor(now/1000)+60;
 const signature=hex(await crypto.subtle.sign('HMAC',await key(config),payload(config,id,expires,type,await digest(raw))));
 return new Request(request.url,{method:'POST',headers:{'content-type':type,'x-whumpo-cms-id':id,'x-whumpo-cms-expires':String(expires),'x-whumpo-cms-signature':signature},body:raw});
}
export async function verifyCMSMediaUpload(request:Request,config:CMSBridgeConfig,now=Date.now()){
 const url=new URL(request.url),id=request.headers.get('x-whumpo-cms-id')??'',time=request.headers.get('x-whumpo-cms-expires')??'',signature=request.headers.get('x-whumpo-cms-signature')??'',contentType=request.headers.get('content-type')??'',expires=Number(time),seconds=Math.floor(now/1000);
 if(!isCMSMediaUpload(request)||url.origin!==config.origin||url.search||url.hash||url.username||url.password||request.headers.has('cookie')||request.headers.has('authorization')||request.headers.has('content-encoding')||!uuid.test(id)||!/^\d{10}$/.test(time)||expires<=seconds||expires>seconds+60||!/^[0-9a-f]{64}$/.test(signature)||!/^multipart\/form-data; boundary=[A-Za-z0-9_-]{1,70}$/.test(contentType))throw new CMSBridgeError(403,'CMS upload not authorized');
 const raw=await body(request.clone());
 if(!await crypto.subtle.verify('HMAC',await key(config),Uint8Array.from(signature.match(/../g)!,s=>parseInt(s,16)),payload(config,id,expires,contentType,await digest(raw))))throw new CMSBridgeError(403,'CMS upload not authorized');
 let form:FormData;try{form=await new Request(request.url,{method:'POST',headers:{'content-type':contentType},body:raw}).formData();}catch{throw new CMSBridgeError(400,'Invalid upload form');}
 const entries=[...form.entries()],file=form.get('file');
 if(entries.length!==1||entries[0][0]!=='file'||!(file instanceof File)||file.type!=='image/jpeg'||file.size>maxPhotoBytes)throw new CMSBridgeError(400,'Upload one prepared JPEG image');
 filename(file.name);const bytes=new Uint8Array(await file.arrayBuffer());let cleaned;
 try{cleaned=cleanPhoto(bytes);}catch{throw new CMSBridgeError(400,'Invalid prepared JPEG');}
 const imageHash=await digest(bytes);
 if(await digest(cleaned.bytes)!==imageHash)throw new CMSBridgeError(400,'Image metadata must be removed before upload');
 // Multipart boundaries change on an exact retry. Receipt identity pins the actual
 // filename and cleaned bytes, while each signature still pins its complete wire body.
 const requestHash=await digest(encoder.encode(JSON.stringify(['whumpo-cms-media-receipt-v1',config.projectId,config.ownerId,config.origin,file.name,file.type,imageHash])));
 return {id,path:cmsMediaUploadPath,body:raw,contentType,requestHash};
}
