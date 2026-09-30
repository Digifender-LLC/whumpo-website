/** Keep the prepared Blob for retries; re-encoding on each retry can change its digest. */
export async function prepareCMSImage(file:File){
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>10*1024*1024)throw Error('Choose a JPEG, PNG or WebP image under 10 MB.');
 const bitmap=await createImageBitmap(file);
 try{
  const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const context=canvas.getContext('2d');if(!context)throw Error('Image preparation is unavailable in this browser.');
  context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);context.drawImage(bitmap,0,0,canvas.width,canvas.height);
  for(const quality of [.85,.7,.55,.4,.25]){const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));if(blob&&blob.size<=1048576)return blob;}
  throw Error('This image is too detailed. Choose a smaller image.');
 }finally{bitmap.close();}
}
export function cmsImageFilename(name:string){return (name.replace(/\.[^.]+$/,'').replace(/[^A-Za-z0-9 _.-]/g,'').replace(/^[^A-Za-z0-9]+/,'').slice(0,90)||'image')+'.jpg';}
