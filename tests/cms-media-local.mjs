// Actual workerd R2 capture and isolated restore, using only disposable local buckets.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {gzipSync} from 'node:zlib';
import wrangler from 'wrangler';
import {captureCMSMedia,verifyCapturedCMSMedia} from '../tools/cms-media-snapshot.mjs';
const dir=await mkdtemp(join(tmpdir(),'cms-media-local-'));let proxy;
try{
 const config=join(dir,'wrangler.json');await writeFile(config,JSON.stringify({name:'cms-media-fixture',compatibility_date:'2026-09-29',r2_buckets:[{binding:'SOURCE',bucket_name:'fixture-source'},{binding:'TARGET',bucket_name:'fixture-target'}]}));
 proxy=await wrangler.getPlatformProxy({configPath:config,persist:{path:join(dir,'state')},remoteBindings:false});const {SOURCE,TARGET}=proxy.env;
 const bytes=gzipSync('Private CMS image fixture');await SOURCE.put('folder/雪.gz',bytes,{httpMetadata:{contentType:'application/octet-stream',contentEncoding:'gzip',cacheControl:'private'},customMetadata:{caption:'A private caption'}});await SOURCE.put('empty',new Uint8Array());
 const provider={async list(cursor){const result=await SOURCE.list({limit:1,...(cursor?{cursor}:{}),include:['httpMetadata','customMetadata']});return {success:true,result:result.objects.map(o=>({key:o.key,size:o.size,etag:o.etag,last_modified:o.uploaded.toISOString(),http_metadata:o.httpMetadata,custom_metadata:o.customMetadata,storage_class:'Standard',ssec:false})),result_info:{is_truncated:result.truncated,...(result.truncated?{cursor:result.cursor}:{})}};},async get(key){const object=await SOURCE.get(key);if(!object)return new Response(null,{status:404});const headers=new Headers({etag:object.httpEtag,'content-length':String(object.size)});object.writeHttpMetadata(headers);return new Response(object.body,{headers});}};
 const captured=await captureCMSMedia(provider,join(dir,'media'));assert.equal(captured.objects.length,2);assert.equal(await verifyCapturedCMSMedia(join(dir,'media'),captured),true);
 assert.equal((await TARGET.list()).objects.length,0);
 for(const object of captured.objects)await TARGET.put(object.key,await readFile(join(dir,'media',object.file)),{httpMetadata:object.metadata.http_metadata,customMetadata:object.metadata.custom_metadata});
 for(const object of captured.objects){const original=await SOURCE.get(object.key),restored=await TARGET.get(object.key);assert.deepEqual(new Uint8Array(await restored.arrayBuffer()),new Uint8Array(await original.arrayBuffer()));assert.deepEqual(restored.httpMetadata,original.httpMetadata);assert.deepEqual(restored.customMetadata,original.customMetadata);}
 console.log('Actual local R2 passed: paginated capture, empty and compressed objects, saved checksums and isolated byte/metadata restore.');
}finally{await proxy?.dispose();await rm(dir,{recursive:true,force:true});}
