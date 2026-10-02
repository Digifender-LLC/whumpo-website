Error.stackTraceLimit=0;
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
const m=await currentSiteFixtureHandlers(),{cleanPhoto,uploadPhoto,readPhotoUpload,readPhoto,listPhotos,cleanupPhotos,getBilling,worker}=m;
const dir=await mkdtemp('/tmp/whumpo-files-');
execFileSync('python3',['-c',"from PIL import Image; import sys; im=Image.new('RGB',(32,24),(80,120,60)); im.save(sys.argv[1]+'/fixture.jpg'); im.save(sys.argv[1]+'/progressive.jpg',progressive=True); Image.new('RGB',(1601,1)).save(sys.argv[1]+'/oversized.jpg')",dir]);
const jpeg=new Uint8Array(await readFile(dir+'/fixture.jpg'));
const fixture=await databaseFixture({d1:true,r2:true}),db=fixture.db,env=fixture.env;
async function account(){const authority=await workspaceFixture(db,m),id=authority.account,project=crypto.randomUUID();await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Photos','Synthetic test','draft',?,?)").bind(project,id,new Date().toISOString(),new Date().toISOString()).run();return {...authority,id,project,env:{...env,DB:await authority.scope()}};}
function request(bytes=jpeg,name='Garden photo'){return new Request('https://whumpo.com/api/test',{method:'PUT',headers:{'content-type':'image/jpeg','x-photo-name':encodeURIComponent(name)},body:bytes});}
try{
 const owner=await account(),other=await account(),id=crypto.randomUUID();
 const marker=Buffer.from('private GPS EXIF sentinel'),len=marker.length+2;const metadata=Buffer.concat([jpeg.subarray(0,2),Buffer.from([255,225,len>>8,len&255]),marker,jpeg.subarray(2)]);
 const clean=cleanPhoto(metadata);assert.equal(clean.width,32);assert.equal(clean.height,24);assert.ok(!Buffer.from(clean.bytes).includes(marker));
 for(const invalid of [new TextEncoder().encode('<svg onload="alert(1)"></svg>'),jpeg.subarray(0,100),Buffer.concat([jpeg,Buffer.from('trailing data')]),new Uint8Array(await readFile(dir+'/progressive.jpg')),new Uint8Array(await readFile(dir+'/oversized.jpg'))])assert.throws(()=>cleanPhoto(invalid),{status:400});
 const pair=await Promise.all([uploadPhoto(request(metadata),owner.env,owner.id,owner.project,id),uploadPhoto(request(metadata),owner.env,owner.id,owner.project,id)]);assert.ok(pair.every(p=>p.status==='ready'));
 const listed=await listPhotos(owner.env.DB,owner.id,owner.project);assert.equal(listed.files.length,1);assert.equal((await env.FILES.list()).objects.length,1);
 const status=await readPhotoUpload(owner.env.DB,owner.id,owner.project,id);assert.equal(status.photo.status,'ready');assert.equal(status.photo.safetyStatus,'pending');assert.equal(status.photo.digest,await crypto.subtle.digest('SHA-256',clean.bytes).then(v=>Buffer.from(v).toString('hex')));assert(!JSON.stringify(status).includes('object_key'));assert.equal((await readPhotoUpload(owner.env.DB,owner.id,owner.project,crypto.randomUUID())).photo,null);await assert.rejects(()=>readPhotoUpload(other.env.DB,other.id,owner.project,id),{status:404});assert.equal((await readPhotoUpload(other.env.DB,other.id,other.project,id)).photo,null);
 assert.equal(listed.files[0].safetyStatus,'pending');await assert.rejects(()=>readPhoto(owner.env,owner.id,id),{status:423});
 // Synthetic trusted receipt for storage/decoder regression, not a real scan.
 await db.prepare("UPDATE project_photo_safety SET state='approved',csam_check='clear',sexual_check='clear',scanner_reference='synthetic',expires_at=? WHERE file_id=?").bind(new Date(Date.now()+3600000).toISOString(),id).run();
 const photo=await readPhoto(owner.env,owner.id,id);assert.equal(photo.headers.get('content-type'),'image/jpeg');assert.equal(photo.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(new Uint8Array(await photo.arrayBuffer()),clean.bytes);
 // Independent pixel decoding confirms stripping metadata retained a real, readable image.
 execFileSync('python3',['-c',"from PIL import Image; import sys,io; im=Image.open(io.BytesIO(sys.stdin.buffer.read())); im.load(); assert im.size==(32,24)"] ,{input:clean.bytes});
 await assert.rejects(readPhoto(other.env,other.id,id),{status:404});await assert.rejects(listPhotos(other.env.DB,other.id,owner.project),{status:404});await assert.rejects(uploadPhoto(request(),other.env,other.id,owner.project,crypto.randomUUID()),{status:404});await assert.rejects(uploadPhoto(request(),other.env,other.id,other.project,id),{status:409});await assert.rejects(uploadPhoto(request(jpeg,'different'),owner.env,owner.id,owner.project,id),{status:409});
 await assert.rejects(uploadPhoto(request(new Uint8Array(1048577)),owner.env,owner.id,owner.project,crypto.randomUUID()),{status:413});await assert.rejects(uploadPhoto(request(jpeg,'../bad'),owner.env,owner.id,owner.project,crypto.randomUUID()),{status:400});
 // Retry after R2 accepted bytes but the caller lost the response.
 let lost=false;const lossyBucket=new Proxy(env.FILES,{get(target,key){if(key==='put')return async(...args)=>{const r=await target.put(...args);if(!lost){lost=true;throw Error('lost R2 acknowledgement');}return r;};const v=target[key];return typeof v==='function'?v.bind(target):v;}});
 const pending=crypto.randomUUID();await assert.rejects(uploadPhoto(request(),{...owner.env,FILES:lossyBucket},owner.id,owner.project,pending),{status:503});assert.equal((await listPhotos(owner.env.DB,owner.id,owner.project)).files.find(f=>f.id===pending).status,'pending');assert.equal((await readPhotoUpload(owner.env.DB,owner.id,owner.project,pending)).photo.status,'pending');assert.equal((await uploadPhoto(request(),owner.env,owner.id,owner.project,pending)).status,'ready');assert.equal((await env.FILES.list()).objects.length,2);
 // Retry after D1 committed the ready state and its audit event.
 lost=false;const lossyDB=await owner.scope(interceptDatabase(db,/UPDATE project_files SET status='ready'/,async()=>{},async()=>{if(!lost){lost=true;throw Error('lost D1 acknowledgement');}}));
 const committed=crypto.randomUUID();await assert.rejects(uploadPhoto(request(),{...owner.env,DB:lossyDB},owner.id,owner.project,committed),{status:503});assert.equal((await readPhotoUpload(owner.env.DB,owner.id,owner.project,committed)).photo.status,'ready');await uploadPhoto(request(),owner.env,owner.id,owner.project,committed);assert.equal((await db.prepare("SELECT COUNT(*) AS n FROM activity_events WHERE id=?").bind('file:'+committed).first()).n,1);
 for(let n=3;n<20;n++)await uploadPhoto(request(),owner.env,owner.id,owner.project,crypto.randomUUID());await assert.rejects(uploadPhoto(request(),owner.env,owner.id,owner.project,crypto.randomUUID()),{status:409});assert.equal((await env.FILES.list()).objects.length,20);assert.equal((await getBilling(owner.env.DB,owner.id)).standardAI.creditCharge,0);
 const apiEnv={...env,ENVIRONMENT:'local',API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}};
 assert.equal((await worker.fetch(new Request('https://whumpo.com/api/files/'+id),apiEnv)).status,401);
 assert.equal((await worker.fetch(new Request('https://whumpo.com/api/projects/'+owner.project+'/files/'+id),apiEnv)).status,401);
 assert.equal((await worker.fetch(new Request('https://whumpo.com/api/projects/'+owner.project+'/files/'+id,{method:'PUT'}),apiEnv)).status,403);
 // Status readback must refuse ownership/session changes while its projection is read.
 const moving=await account(),movingId=crypto.randomUUID();await uploadPhoto(request(),moving.env,moving.id,moving.project,movingId);let transferred=false;
 const transferScope=await moving.scope(interceptDatabase(db,/SELECT f.id,f.project_id AS projectId/,async()=>{},async()=>{if(!transferred){transferred=true;await db.prepare('UPDATE projects SET owner_user_id=? WHERE id=?').bind(other.id,moving.project).run();}}));
 await assert.rejects(()=>readPhotoUpload(transferScope,moving.id,moving.project,movingId),{status:409});await db.prepare('DELETE FROM projects WHERE id=?').bind(moving.project).run();
 const revoked=await account();let expired=false;const revokedScope=await revoked.scope(interceptDatabase(db,/SELECT f.id,f.project_id AS projectId/,async()=>{},async()=>{if(!expired){expired=true;await revoked.revoke();}}));
 await assert.rejects(()=>readPhotoUpload(revokedScope,revoked.id,revoked.project,crypto.randomUUID()));await db.prepare('DELETE FROM projects WHERE id=?').bind(revoked.project).run();
 const future=new Date(Date.now()+7200000);await cleanupPhotos(env,future);assert.equal((await env.FILES.list()).objects.length,20);
 await db.prepare('DELETE FROM projects WHERE id=?').bind(owner.project).run();assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM file_cleanup').first()).n,20);await cleanupPhotos(env,future);assert.equal((await env.FILES.list()).objects.length,0);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM file_cleanup').first()).n,0);
 // A late orphan write is removed by reconciliation even after the deletion queue was acknowledged.
 await env.FILES.put('photos/removed-project/late.jpg',jpeg);await cleanupPhotos(env,future);assert.equal((await env.FILES.list()).objects.length,0);
 console.log('Photo checks passed: JPEG bounds/metadata stripping, independent decoding, private access and exact metadata status with late ownership/session refusal, concurrency, conflicting replay, lost R2/D1 acknowledgements, quota-before-storage, API gates, zero AI units and deletion/orphan cleanup.');
}finally{await fixture.close();await rm(dir,{recursive:true,force:true});}
