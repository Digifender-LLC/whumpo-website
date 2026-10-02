import {cleanPhoto} from '../../../src/photo-format';
/** Decode, resize and strip metadata before computing the exact retry identity. */
export async function prepareProjectPhoto(file:File){
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024||!file.size)throw Error('Choose a JPEG, PNG or WebP under 10 MB.');
 const bitmap=await createImageBitmap(file);
 try{
  const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('Photo preparation is unavailable.');
  ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
  let blob:Blob|null=null;for(const quality of [.85,.7,.55,.4,.25]){blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));if(blob&&blob.size<=1048576)break;}
  if(!blob||blob.size>1048576)throw Error('Choose a less detailed photo.');
  const photo=cleanPhoto(new Uint8Array(await blob.arrayBuffer())),digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',photo.bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  return {blob:new Blob([photo.bytes],{type:'image/jpeg'}),digest,size:photo.bytes.length,width:photo.width,height:photo.height};
 }finally{bitmap.close();}
}
