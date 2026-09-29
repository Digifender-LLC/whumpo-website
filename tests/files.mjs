import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
async function module(path){const b=await build({entryPoints:[path],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {cleanPhoto,uploadPhoto,readPhoto,listPhotos,cleanupPhotos}=await module('src/files.ts');const {getBilling}=await module('src/billing.ts');const worker=(await module('src/index.ts')).default;
const dir=await mkdtemp('/tmp/whumpo-files-');execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',dir],{stdio:'pipe'});
execFileSync('python3',['-c',"from PIL import Image; import sys; im=Image.new('RGB',(32,24),(80,120,60)); im.save(sys.argv[1]+'/fixture.jpg'); im.save(sys.argv[1]+'/progressive.jpg',progressive=True); Image.new('RGB',(1601,1)).save(sys.argv[1]+'/oversized.jpg')",dir]);
const jpeg=new Uint8Array(await readFile(dir+'/fixture.jpg'));
const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB,env=proxy.env;
async function account(){const id=crypto.randomUUID(),project=crypto.randomUUID();await db.prepare("INSERT INTO users(id,email,password_salt,password_hash,created_at) VALUES(?,?,?,'test',?)").bind(id,id+'@example.com','00',new Date().toISOString()).run();await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Photos','Synthetic test','draft',?,?)").bind(project,id,new Date().toISOString(),new Date().toISOString()).run();return {id,project};}
function request(bytes=jpeg,name='Garden photo'){return new Request('https://digifender.com/api/test',{method:'PUT',headers:{'content-type':'image/jpeg','x-photo-name':encodeURIComponent(name)},body:bytes});}
try{
 const owner=await account(),other=await account(),id=crypto.randomUUID();
 const marker=Buffer.from('private GPS EXIF sentinel'),len=marker.length+2;const metadata=Buffer.concat([jpeg.subarray(0,2),Buffer.from([255,225,len>>8,len&255]),marker,jpeg.subarray(2)]);
 const clean=cleanPhoto(metadata);assert.equal(clean.width,32);assert.equal(clean.height,24);assert.ok(!Buffer.from(clean.bytes).includes(marker));
 for(const invalid of [new TextEncoder().encode('<svg onload="alert(1)"></svg>'),jpeg.subarray(0,100),Buffer.concat([jpeg,Buffer.from('trailing data')]),new Uint8Array(await readFile(dir+'/progressive.jpg')),new Uint8Array(await readFile(dir+'/oversized.jpg'))])assert.throws(()=>cleanPhoto(invalid),{status:400});
 const pair=await Promise.all([uploadPhoto(request(metadata),env,owner.id,owner.project,id),uploadPhoto(request(metadata),env,owner.id,owner.project,id)]);assert.ok(pair.every(p=>p.status==='ready'));
 const listed=await listPhotos(db,owner.id,owner.project);assert.equal(listed.files.length,1);assert.equal((await env.FILES.list()).objects.length,1);
 const photo=await readPhoto(env,owner.id,id);assert.equal(photo.headers.get('content-type'),'image/jpeg');assert.equal(photo.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(new Uint8Array(await photo.arrayBuffer()),clean.bytes);
 // Independent pixel decoding confirms stripping metadata retained a real, readable image.
 execFileSync('python3',['-c',"from PIL import Image; import sys,io; im=Image.open(io.BytesIO(sys.stdin.buffer.read())); im.load(); assert im.size==(32,24)"] ,{input:clean.bytes});
 await assert.rejects(readPhoto(env,other.id,id),{status:404});await assert.rejects(listPhotos(db,other.id,owner.project),{status:404});await assert.rejects(uploadPhoto(request(),env,other.id,owner.project,crypto.randomUUID()),{status:404});await assert.rejects(uploadPhoto(request(),env,other.id,other.project,id),{status:409});await assert.rejects(uploadPhoto(request(jpeg,'different'),env,owner.id,owner.project,id),{status:409});
 await assert.rejects(uploadPhoto(request(new Uint8Array(1048577)),env,owner.id,owner.project,crypto.randomUUID()),{status:413});await assert.rejects(uploadPhoto(request(jpeg,'../bad'),env,owner.id,owner.project,crypto.randomUUID()),{status:400});
 // Retry after R2 accepted bytes but the caller lost the response.
 let lost=false;const lossyBucket=new Proxy(env.FILES,{get(target,key){if(key==='put')return async(...args)=>{const r=await target.put(...args);if(!lost){lost=true;throw Error('lost R2 acknowledgement');}return r;};const v=target[key];return typeof v==='function'?v.bind(target):v;}});
 const pending=crypto.randomUUID();await assert.rejects(uploadPhoto(request(),{...env,FILES:lossyBucket},owner.id,owner.project,pending),{status:503});assert.equal((await listPhotos(db,owner.id,owner.project)).files.find(f=>f.id===pending).status,'pending');assert.equal((await uploadPhoto(request(),env,owner.id,owner.project,pending)).status,'ready');assert.equal((await env.FILES.list()).objects.length,2);
 // Retry after D1 committed the ready state and its audit event.
 lost=false;const lossyDB=new Proxy(db,{get(target,key){if(key==='batch')return async(...args)=>{const r=await target.batch(...args);if(!lost){lost=true;throw Error('lost D1 acknowledgement');}return r;};const v=target[key];return typeof v==='function'?v.bind(target):v;}});
 const committed=crypto.randomUUID();await assert.rejects(uploadPhoto(request(),{...env,DB:lossyDB},owner.id,owner.project,committed),{status:503});await uploadPhoto(request(),env,owner.id,owner.project,committed);assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM activity_events WHERE id=?").bind('file:'+committed).first()).n,1);
 for(let n=3;n<20;n++)await uploadPhoto(request(),env,owner.id,owner.project,crypto.randomUUID());await assert.rejects(uploadPhoto(request(),env,owner.id,owner.project,crypto.randomUUID()),{status:409});assert.equal((await env.FILES.list()).objects.length,20);assert.equal((await getBilling(db,owner.id)).quota.spent,0);
 const apiEnv={...env,ENVIRONMENT:'local',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}};
 assert.equal((await worker.fetch(new Request('https://digifender.com/api/files/'+id),apiEnv)).status,401);
 assert.equal((await worker.fetch(new Request('https://digifender.com/api/projects/'+owner.project+'/files/'+id,{method:'PUT'}),apiEnv)).status,403);
 const future=new Date(Date.now()+7200000);await cleanupPhotos(env,future);assert.equal((await env.FILES.list()).objects.length,20);
 await db.prepare('DELETE FROM projects WHERE id=?').bind(owner.project).run();assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM file_cleanup').first()).n,20);await cleanupPhotos(env,future);assert.equal((await env.FILES.list()).objects.length,0);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM file_cleanup').first()).n,0);
 // A late orphan write is removed by reconciliation even after the deletion queue was acknowledged.
 await env.FILES.put('photos/removed-project/late.jpg',jpeg);await cleanupPhotos(env,future);assert.equal((await env.FILES.list()).objects.length,0);
 console.log('Photo checks passed: JPEG bounds/metadata stripping, independent decoding, private access, concurrency, conflicting replay, lost R2/D1 acknowledgements, quota-before-storage, API gates, zero AI units and deletion/orphan cleanup.');
}finally{await proxy.dispose();await rm(dir,{recursive:true,force:true});}
