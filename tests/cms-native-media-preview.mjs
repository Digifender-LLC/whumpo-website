import assert from 'node:assert/strict';
import {build} from 'esbuild';
// Seed only the disposable native fixture; production has no direct SQL/media write route.
export async function verifyNativeMediaPreview(env,vars){
 const b=await build({entryPoints:['src/cms-bridge.ts'],bundle:true,format:'esm',platform:'node',write:false});const {signCMSRequest}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
 const config={projectId:vars.WHUMPO_CMS_PROJECT_ID,ownerId:vars.WHUMPO_CMS_OWNER_ID,origin:vars.WHUMPO_CMS_ORIGIN,secret:vars.WHUMPO_CMS_BRIDGE_KEY};
 const id='01ARZ3NDEKTSV4RRFFQ69G5FAV',key=id+'.png',bytes=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a6ioAAAAASUVORK5CYII=','base64');
 await env.DB.prepare('INSERT INTO media(id,filename,mime_type,size,storage_key,status) VALUES(?,?,?,?,?,?)').bind(id,'fixture.png','image/png',bytes.length,key,'ready').run();
 await env.MEDIA.put(key,bytes,{httpMetadata:{contentType:'image/png'}});
 try{
  const metadataRequest=await signCMSRequest(config,'/_emdash/api/media/'+id,crypto.randomUUID());
  const metadataResponse=await fetch('http://localhost:8799/_emdash/api/media/'+id,{headers:metadataRequest.headers});
  assert.equal(metadataResponse.status,200);const metadata=await metadataResponse.json();assert.equal(metadata.data.item.status,'ready');assert.equal(metadata.data.item.storageKey,key);
  const path='/_emdash/api/whumpo/media/'+id+'/preview',signed=await signCMSRequest(config,path,crypto.randomUUID());
  const response=await fetch('http://localhost:8799'+path,{headers:signed.headers});
  assert.equal(response.status,200,response.status!==200?await response.text():undefined);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);assert.equal(response.headers.get('cache-control'),'private, no-store');
  assert.equal((await fetch('http://localhost:8799'+path)).status,403);
  await env.DB.prepare("UPDATE media SET storage_key=? WHERE id=?").bind('backups/'+key,id).run();
  const refused=await signCMSRequest(config,path,crypto.randomUUID());assert.equal((await fetch('http://localhost:8799'+path,{headers:refused.headers})).status,404);
  console.log('Actual native EmDash image preview passed: populated media lookup, private R2 bytes, unsigned denial and staging-key refusal.');
 }finally{await env.DB.prepare('DELETE FROM media WHERE id=?').bind(id).run();await env.MEDIA.delete(key);}
}
