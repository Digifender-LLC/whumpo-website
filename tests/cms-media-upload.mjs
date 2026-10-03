import assert from 'node:assert/strict';import {mkdtemp,readFile,rm} from 'node:fs/promises';import {execFileSync} from 'node:child_process';import {build} from 'esbuild';
const buildResult=await build({stdin:{contents:"export * from './src/cms-media-upload-bridge';export * from './src/cms-bridge';export {cleanPhoto} from './src/photo-format';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {signCMSMediaUpload:sign,verifyCMSMediaUpload:verify,signCMSRequest,cleanPhoto}=await import('data:text/javascript;base64,'+Buffer.from(buildResult.outputFiles[0].text).toString('base64'));
const config={projectId:crypto.randomUUID(),ownerId:crypto.randomUUID(),secret:'synthetic-secret-for-media-uploads-'.repeat(2),origin:'https://cms.test'},id=crypto.randomUUID(),dir=await mkdtemp('/tmp/whumpo-cms-upload-');
try{
 execFileSync('python3',['-c',"from PIL import Image; import sys; Image.new('RGB',(32,24),(80,120,60)).save(sys.argv[1]); Image.new('RGB',(1601,1)).save(sys.argv[2])",dir+'/photo.jpg',dir+'/wide.jpg']);
 const bytes=new Uint8Array(await readFile(dir+'/photo.jpg')),now=Date.now(),first=await sign(config,id,bytes,'studio.jpg',now),second=await sign(config,id,bytes,'studio.jpg',now+1000);
 const one=await verify(first,config,now),two=await verify(second,config,now+1000);assert.equal(one.requestHash,two.requestHash);assert.notEqual(one.contentType,two.contentType);
 const form=await new Request(first.url,{method:'POST',headers:{'content-type':one.contentType},body:one.body}).formData();assert.deepEqual(new Uint8Array(await form.get('file').arrayBuffer()),cleanPhoto(bytes).bytes);
 assert.notEqual((await verify(await sign(config,id,bytes,'other.jpg'),config)).requestHash,one.requestHash);
 for(const patch of [{ownerId:crypto.randomUUID()},{projectId:crypto.randomUUID()},{origin:'https://other.test'},{secret:'different'.repeat(10)}])await assert.rejects(verify(first,{...config,...patch},now));
 await assert.rejects(verify(first,config,now+61000));
 for(const [key,value] of [['cookie','session=x'],['authorization','Bearer x'],['content-encoding','gzip'],['content-type','multipart/form-data; boundary=changed']]){const headers=new Headers(first.headers);headers.set(key,value);await assert.rejects(verify(new Request(first.url,{method:'POST',headers,body:one.body}),config,now));}
 const tampered=one.body.slice();tampered[tampered.length-10]^=1;await assert.rejects(verify(new Request(first.url,{method:'POST',headers:first.headers,body:tampered}),config,now));
 await assert.rejects(verify(new Request(first.url+'?extra=1',{method:'POST',headers:first.headers,body:one.body}),config,now));
 await assert.rejects(verify(new Request(first.url,{method:'POST',headers:first.headers,body:new Uint8Array(1048576+8193)}),config,now),e=>e.status===413);
 await assert.rejects(sign(config,id,new Uint8Array(await readFile(dir+'/wide.jpg')),'wide.jpg'));
 await assert.rejects(sign(config,id,bytes,'../private.jpg'));await assert.rejects(sign(config,id,bytes,'photo.svg'));
 await assert.rejects(signCMSRequest(config,'/_emdash/api/setup',id,{text:'x'.repeat(4097)}),e=>e.status===413);
 console.log('CMS upload signing passed: isolated signature domain, owner/project/origin binding, fresh-boundary replay identity, sanitized JPEG bytes, bounded dimensions/body, tamper/expiry/header/path refusal and unchanged JSON limit.');
}finally{await rm(dir,{recursive:true,force:true});}
