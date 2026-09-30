export const cmsPreviewLimit=5*1024*1024;
export const cmsMediaItemPath=/^\/_emdash\/api\/media\/[0-9A-HJKMNP-TV-Z]{26}$/;
export const cmsMediaPreviewPath=/^\/_emdash\/api\/whumpo\/media\/([0-9A-HJKMNP-TV-Z]{26})\/preview$/;
export const cmsPreviewTypes=['image/png','image/jpeg','image/gif','image/webp'];
// Native uploads use flat ULID keys. Never resolve backup, staging or user-supplied paths.
export const cmsPreviewKey=/^[0-9A-HJKMNP-TV-Z]{26}\.(?:png|jpe?g|gif|webp)$/i;
export function cmsPreviewMagic(bytes:Uint8Array,type:string){
 const starts=(v:number[])=>v.every((b,i)=>bytes[i]===b),text=(a:number,b:number)=>String.fromCharCode(...bytes.slice(a,b));
 return bytes.length>=12&&(type==='image/png'?starts([137,80,78,71,13,10,26,10]):type==='image/jpeg'?starts([255,216,255]):type==='image/gif'?['GIF87a','GIF89a'].includes(text(0,6)):type==='image/webp'?text(0,4)==='RIFF'&&text(8,12)==='WEBP':false);
}
export async function boundedCMSImage(stream:ReadableStream<Uint8Array>,signal?:AbortSignal){
 const reader=stream.getReader(),parts:Uint8Array[]=[];let length=0;
 const cancel=()=>{void reader.cancel().catch(()=>{});};signal?.addEventListener('abort',cancel,{once:true});
 try{for(;;){signal?.throwIfAborted();const {value,done}=await reader.read();signal?.throwIfAborted();if(done)break;length+=value.length;if(length>cmsPreviewLimit)throw Error('Image exceeds preview limit');parts.push(value);}
 const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}return bytes;
 }catch(error){cancel();throw error;}finally{signal?.removeEventListener('abort',cancel);reader.releaseLock();}
}
export function cmsPreviewResponse(bytes:Uint8Array<ArrayBuffer>,type:string){
 return new Response(bytes,{headers:{'content-type':type,'content-length':String(bytes.length),'cache-control':'private, no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox",'cross-origin-resource-policy':'same-origin','content-disposition':'inline'}});
}
