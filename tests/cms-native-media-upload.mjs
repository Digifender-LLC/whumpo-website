import assert from 'node:assert/strict';import {mkdtemp,readFile,rm} from 'node:fs/promises';import {execFileSync} from 'node:child_process';import {build} from 'esbuild';
export async function verifyNativeMediaUpload(env,vars){
 const b=await build({stdin:{contents:"export * from './src/cms-media-upload-bridge';export * from './src/cms-bridge';export {cleanPhoto} from './src/files';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
 const {signCMSMediaUpload,signCMSRequest,cleanPhoto}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
 const config={projectId:vars.TOWNHELLO_CMS_PROJECT_ID,ownerId:vars.TOWNHELLO_CMS_OWNER_ID,origin:vars.TOWNHELLO_CMS_ORIGIN,secret:vars.TOWNHELLO_CMS_BRIDGE_KEY},id=crypto.randomUUID(),dir=await mkdtemp('/tmp/whumpo-native-upload-');let item;
 try{
  execFileSync('python3',['-c',"from PIL import Image; import sys; Image.new('RGB',(32,24),(80,120,60)).save(sys.argv[1])",dir+'/photo.jpg']);const bytes=new Uint8Array(await readFile(dir+'/photo.jpg'));
  const send=async(name='studio.jpg')=>{const request=await signCMSMediaUpload(config,id,bytes,name);return fetch('http://localhost:8799/_emdash/api/media',{method:'POST',headers:request.headers,body:await request.arrayBuffer()});};
  const response=await send();assert.equal(response.status,201,await response.clone().text());const result=await response.json();assert.equal(result.success,true);item=result.data.item;assert.equal(item.mimeType,'image/jpeg');assert.equal(item.status,'ready');assert.match(item.storageKey,/^[0-9A-HJKMNP-TV-Z]{26}\.jpg$/);
  assert.deepEqual(await(await send()).json(),result);assert.equal((await send('different.jpg')).status,409);
  assert.equal((await env.DB.prepare('SELECT count(*) n FROM media WHERE id=?').bind(item.id).first()).n,1);
  const path='/_emdash/api/whumpo/media/'+item.id+'/preview',signed=await signCMSRequest(config,path,crypto.randomUUID()),preview=await fetch('http://localhost:8799'+path,{headers:signed.headers});assert.equal(preview.status,200);assert.deepEqual(new Uint8Array(await preview.arrayBuffer()),cleanPhoto(bytes).bytes);
  assert.equal((await fetch('http://localhost:8799/_emdash/api/media',{method:'POST',body:'unsigned'})).status,403);
  assert.equal((await fetch('http://localhost:8799/_emdash/api/media/file/'+item.storageKey)).status,403);
  console.log('Actual native CMS upload passed: signed bounded JPEG, ready media record, private R2 preview, exact retry without duplication, conflicting retry denial and no public file route.');
 }finally{if(item){await env.DB.prepare('DELETE FROM media WHERE id=?').bind(item.id).run();await env.MEDIA.delete(item.storageKey);}await rm(dir,{recursive:true,force:true});}
}
