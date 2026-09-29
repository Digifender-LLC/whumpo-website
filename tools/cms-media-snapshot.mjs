import {createHash} from 'node:crypto';
import {open,lstat,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {constants} from 'node:fs';
import {request} from 'node:https';
import {Readable} from 'node:stream';
import {cloudflareClient,cloudflareCredentials} from './cms-cloudflare.mjs';
const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0)):v);
// Node HTTPS preserves stored encoded bytes; fetch would transparently decompress gzip objects.
export function rawCloudflareObject(account,bucket,key,credentials){
 if(!/^[0-9a-f]{32}$/.test(account)||!/^townhello-cms-[0-9a-f]{32}-media$/.test(bucket)||typeof key!=='string'||!key||Buffer.byteLength(key)>1024||key.split('/').some(p=>p==='.'||p==='..'))throw Error('Invalid media object identity');
 const path='/client/v4/accounts/'+account+'/r2/buckets/'+bucket+'/objects/'+key.split('/').map(encodeURIComponent).join('/');
 return new Promise((resolve,reject)=>{
  const req=request({hostname:'api.cloudflare.com',path,method:'GET',headers:{authorization:'Bearer '+credentials.token,'accept-encoding':'identity'}},res=>{
   try{const headers=new Headers();for(const [k,v] of Object.entries(res.headers))if(v!==undefined)headers.set(k,Array.isArray(v)?v.join(','):v);
   res.once('close',()=>clearTimeout(timer));resolve(new Response(Readable.toWeb(res),{status:res.statusCode,headers}));}catch{clearTimeout(timer);res.destroy();reject(Error('Invalid media response'));}
  });const timer=setTimeout(()=>req.destroy(Error('Media request timed out')),30000);
  req.once('error',()=>{clearTimeout(timer);reject(Error('Media response unavailable'));});req.end();
 });
}
export function cmsMediaProvider(account,bucket,{credentials,transport=fetch,getObject=rawCloudflareObject}={}){
 if(!/^[0-9a-f]{32}$/.test(account)||!/^townhello-cms-[0-9a-f]{32}-media$/.test(bucket))throw Error('Invalid CMS media source');
 credentials=cloudflareCredentials(credentials);const api=cloudflareClient(account,transport,credentials);
 return {list:cursor=>api('/r2/buckets/'+bucket+'/objects?'+new URLSearchParams({per_page:'100',...(cursor?{cursor}:{})})),get:key=>getObject(account,bucket,key,credentials)};
}
export async function mediaInventory(provider,{maxObjects=1000,maxObjectBytes=16*1024*1024,maxTotalBytes=128*1024*1024}={}){
 const objects=[],keys=new Set(),cursors=new Set();let cursor='',total=0;
 for(let page=0;page<20;page++){
  const response=await provider.list(cursor);if(response.success!==true||!Array.isArray(response.result)||Buffer.byteLength(JSON.stringify(response))>1024*1024)throw Error('Invalid media inventory');
  for(const item of response.result){
   if(typeof item.key!=='string'||!item.key||Buffer.byteLength(item.key)>1024||item.key.split('/').some(p=>p==='.'||p==='..')||keys.has(item.key)||!Number.isSafeInteger(item.size)||item.size<0||typeof item.etag!=='string'||!/^[a-fA-F0-9]+(?:-\d+)?$/.test(item.etag)||typeof item.last_modified!=='string'||!Number.isFinite(Date.parse(item.last_modified)))throw Error('Invalid media object metadata');
   if(item.ssec||item.storage_class&&item.storage_class!=='Standard')throw Error('Media capture requires standard unencrypted-key storage');
   if(item.size>maxObjectBytes||(total+=item.size)>maxTotalBytes||objects.length>=maxObjects)throw Error('CMS media snapshot exceeds its limit');
   keys.add(item.key);objects.push(item);
  }
  const info=response.result_info;
  // The live Cloudflare API omits pagination metadata for an empty terminal page.
  if(info===undefined&&response.result.length===0)return objects.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
  if(info?.is_truncated!==true&&info?.is_truncated!==false)throw Error('Media pagination completion was not confirmed');
  if(!info.is_truncated)return objects.sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0);
  if(typeof info.cursor!=='string'||!info.cursor||cursors.has(info.cursor))throw Error('Media pagination did not advance');cursors.add(info.cursor);cursor=info.cursor;
 }
 throw Error('Media inventory exceeds its page limit');
}
export async function captureCMSMedia(provider,directory,limits){
 // Require a new directory; never overwrite files or follow an existing media-directory symlink.
 await mkdir(directory,{mode:0o700});if(!(await lstat(directory)).isDirectory())throw Error('Invalid media directory');
 const inventory=await mediaInventory(provider,limits),files=[];let total=0;
 for(const object of inventory){
  const response=await provider.get(object.key);
  if(response.status!==200||response.headers.get('etag')!=='"'+object.etag+'"'){await response.body?.cancel();throw Error('Media object changed or was unavailable');}
  const expectedLength=response.headers.get('content-length');if(expectedLength!==null&&Number(expectedLength)!==object.size){await response.body?.cancel();throw Error('Media object size changed');}
  if(!response.body)throw Error('Media object body unavailable');
  const file=sha(object.key)+'.bin',handle=await open(join(directory,file),'wx',0o600),digest=createHash('sha256');let size=0;
  try{for await(const chunk of response.body){size+=chunk.length;if(size>object.size)throw Error('Media body exceeds its declared bound');digest.update(chunk);await handle.writeFile(chunk);}if(size!==object.size)throw Error('Media body was truncated');}finally{await handle.close();}
  total+=size;files.push({key:object.key,file,size,sha256:digest.digest('hex'),metadata:object});
 }
 const after=await mediaInventory(provider,limits);if(canonical(after)!==canonical(inventory))throw Error('Media inventory changed during capture');
 return {format:'townhello-cms-media-v1',objects:files,bytes:total,inventoryDigest:sha(canonical(inventory))};
}

export async function verifyCapturedCMSMedia(directory,media){
 if(media?.format!=='townhello-cms-media-v1'||!Array.isArray(media.objects)||media.objects.length>1000)throw Error('Invalid media snapshot');
 const directoryStat=await lstat(directory);if(!directoryStat.isDirectory()||directoryStat.isSymbolicLink())throw Error('Invalid media snapshot directory');
 let total=0;const keys=new Set();
 for(const object of media.objects){
  if(typeof object.key!=='string'||keys.has(object.key)||object.file!==sha(object.key)+'.bin'||!Number.isSafeInteger(object.size)||object.size<0||object.size>16*1024*1024||!/^[0-9a-f]{64}$/.test(object.sha256))throw Error('Invalid media snapshot object');keys.add(object.key);
  const handle=await open(join(directory,object.file),constants.O_RDONLY|constants.O_NOFOLLOW),hash=createHash('sha256');
  try{const stat=await handle.stat();if(!stat.isFile()||stat.size!==object.size)throw Error('Media snapshot size mismatch');for await(const chunk of handle.createReadStream({autoClose:false}))hash.update(chunk);if(hash.digest('hex')!==object.sha256)throw Error('Media snapshot checksum mismatch');}finally{await handle.close();}
  total+=object.size;if(total>128*1024*1024)throw Error('Media snapshot exceeds verification bound');
 }
 if(total!==media.bytes)throw Error('Media snapshot total mismatch');return true;
}
