import {currentSiteFixtureHandlers,createFixtureProject,changeFixtureWebsite} from './current-site-fixture.mjs';
Error.stackTraceLimit=0;
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {unzipSync,strFromU8} from 'fflate';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture} from './helpers/workspace-identity.mjs';
const m=await currentSiteFixtureHandlers(),store=await databaseFixture({d1:true,r2:true}),db=store.db,env=store.env,scopes=new Map(),scope=user=>scopes.get(user),ownedEnv=user=>({...env,DB:scope(user)});
async function accountAuthority(user){const authority=await workspaceFixture(db,m,user);scopes.set(user,await authority.scope());}
const {uploadPhoto,readPhoto,listPhotos,sendChat,readChat,getBilling,ownedPreview,ownedExport,reserveStorage,host}=m;
const dir=await mkdtemp((process.env.TMPDIR||'/tmp')+'/whumpo-photo-versions-');execFileSync('python3',['-c',"from PIL import Image; import sys; Image.new('RGB',(32,24),(80,120,60)).save(sys.argv[1])",dir+'/photo.jpg']);const jpeg=new Uint8Array(await readFile(dir+'/photo.jpg'));
async function account(){const id=crypto.randomUUID();await accountAuthority(id);return id;}
async function chat(user,content,id=crypto.randomUUID(),revision){const state=await readChat(scope(user),user);return {id,result:await sendChat(scope(user),user,{id,content,revision:revision??state.state.revision})};}
async function project(user,name){return createFixtureProject(scope(user),user,name,'A neighborhood website','clay');}
async function attach(user,project,photos){return {id:await changeFixtureWebsite(scope(user),user,project,[{type:'pages.setPhotos',pageId:'home',photos}]),result:{status:200}};}
async function photo(user,project,name){const id=crypto.randomUUID();await uploadPhoto(new Request('https://whumpo.com/',{method:'PUT',headers:{'content-type':'image/jpeg','x-whumpo-photo-handoff':'null','x-photo-name':encodeURIComponent(name)},body:jpeg}),ownedEnv(user),user,project,id);return id;}
const url=id=>'https://'+id+'.whumpo.site';
const get=(path,method='GET')=>host.fetch(new Request('https://'+path.split('/')[2]+'.whumpo.site/'+path.split('/').slice(3).join('/'),{method}),env);
async function publish(user,version){const review=await chat(user,'/publish '+version);assert.ok((await readChat(scope(user),user)).turns.at(-1).assistant_text.includes('attached photos'));await chat(user,'/confirm '+review.id);}
try{
 const owner=await account(),other=await account();const a=await project(owner,'Alpha'),b=await project(owner,'Beta'),c=await project(other,'Other');
 const first=await photo(owner,a.project,'Garden <script>'),second=await photo(owner,a.project,'Flowers'),wrongProject=await photo(owner,b.project,'Other project'),foreign=await photo(other,c.project,'Private other owner');
 assert.equal((await listPhotos(scope(owner),owner,a.project)).files[0].safetyStatus,'pending');
 await assert.rejects(()=>readPhoto(ownedEnv(owner),owner,first),{status:423});await assert.rejects(()=>attach(owner,a.project,[{id:first,alt:'Garden <script>'}]),{status:423});
 await assert.rejects(()=>db.prepare('INSERT INTO version_photos(version_id,file_id,position,alt) VALUES(?,?,0,?)').bind(a.version,first,'Synthetic').run(),/photo_safety_required/);
 // Synthetic trusted results only: no real detection provider is configured.
 await assert.rejects(()=>db.prepare("UPDATE project_photo_safety SET state='approved',csam_check='clear',scanner_reference='synthetic',expires_at=? WHERE file_id=?").bind(new Date(Date.now()+3600000).toISOString(),first).run());
 for(const id of [first,second,wrongProject,foreign])await db.prepare("UPDATE project_photo_safety SET state='approved',csam_check='clear',sexual_check='clear',scanner_reference='synthetic',expires_at=? WHERE file_id=?").bind(new Date(Date.now()+3600000).toISOString(),id).run();
 const expired=await photo(owner,a.project,'Expired synthetic receipt');
 await assert.rejects(()=>db.prepare("UPDATE project_photo_safety SET state='approved',csam_check='clear',sexual_check='clear',scanner_reference='synthetic',expires_at='not-a-date' WHERE file_id=?").bind(expired).run());
 await db.prepare("UPDATE project_photo_safety SET state='approved',csam_check='clear',sexual_check='clear',scanner_reference='synthetic',expires_at='2000-01-01T00:00:00.000Z' WHERE file_id=?").bind(expired).run();
 await assert.rejects(()=>readPhoto(ownedEnv(owner),owner,expired),{status:423});assert.equal((await listPhotos(scope(owner),owner,a.project)).files.find(f=>f.id===expired).safetyStatus,'pending');
 const action=await attach(owner,a.project,[{id:first,alt:'Garden <script>'}]);assert.equal(action.result.status,200);let version=await db.prepare('SELECT * FROM site_versions WHERE id=?').bind(action.id).first();assert.equal(version.component_id,'photo-page@1');assert.equal(version.base_version_id,a.version);assert.ok(version.html.includes('assets/'+first+'.jpg'));assert.ok(version.html.includes('Garden &lt;script&gt;'));assert.ok(!version.html.includes('<script>'));
 for(const id of [foreign,wrongProject])await assert.rejects(attach(owner,a.project,[{id,alt:'Wrong owner or project'}]),{status:423});
 const preview=await ownedPreview(ownedEnv(owner),owner,action.id);assert.equal(preview.status,200);const privateHTML=await preview.text();assert.ok(privateHTML.includes('src="data:image/jpeg;base64,'));assert.ok(!privateHTML.includes('src="assets/'));assert.ok(preview.headers.get('content-security-policy').includes('img-src data:'));assert.equal(await ownedPreview(ownedEnv(other),other,action.id),null);
 assert.equal((await get('/s/'+a.project+'/assets/'+first+'.jpg')).status,404);
 await publish(owner,action.id);assert.equal((await get('/s/'+a.project)).status,200);const page=await get('/s/'+a.project+'/');assert.equal(page.status,200);assert.equal(await page.text(),version.html);
 const publicPhoto=await get('/s/'+a.project+'/assets/'+first+'.jpg');assert.equal(publicPhoto.status,200);const photoBytes=new Uint8Array(await publicPhoto.arrayBuffer());assert.equal(publicPhoto.headers.get('cache-control'),'no-store');const head=await get('/s/'+a.project+'/assets/'+first+'.jpg','HEAD');assert.equal(head.status,200);assert.equal(await head.text(),'');assert.equal((await get('/s/'+a.project+'/assets/'+second+'.jpg')).status,404);assert.equal((await get('/s/'+b.project+'/assets/'+first+'.jpg')).status,404);
 const domainClaim=await chat(owner,'/domain photos.example.com '+a.project),hostingID=crypto.randomUUID(),hostingNow=new Date().toISOString(),hostingExpiry=new Date(Date.now()+600000).toISOString();
 await db.prepare("INSERT INTO domain_connections(id,user_id,claim_id,project_id,hostname,zone_id,target,proof_hash,state,created_at,expires_at) VALUES(?,?,?,?,'photos.example.com',?,'hosting.whumpo.site','fixture','review',?,?)").bind(hostingID,owner,domainClaim.id,a.project,'a'.repeat(32),hostingNow,hostingExpiry).run();
 await db.prepare("UPDATE domain_connections SET state='active',provider_id=?,serve_until=? WHERE id=?").bind(crypto.randomUUID(),hostingExpiry,hostingID).run();
 const custom=path=>host.fetch(new Request('https://photos.example.com'+path),env);
 assert.equal(await(await custom('/')).text(),version.html);assert.deepEqual(new Uint8Array(await(await custom('/assets/'+first+'.jpg')).arrayBuffer()),photoBytes);assert.equal((await custom('/assets/'+wrongProject+'.jpg')).status,404);assert.equal((await custom('/s/'+b.project)).status,404);
 // Forged object metadata must not substitute for checking the actual bytes.
 const objectKey=(await db.prepare('SELECT object_key FROM project_files WHERE id=?').bind(first).first()).object_key,corrupt=photoBytes.slice();corrupt[corrupt.length-5]^=1;
 const digest=(await db.prepare('SELECT digest FROM project_files WHERE id=?').bind(first).first()).digest;
 await env.FILES.put(objectKey,corrupt,{customMetadata:{sha256:digest}});
 assert.equal((await get('/s/'+a.project+'/assets/'+first+'.jpg')).status,503);await assert.rejects(()=>readPhoto(ownedEnv(owner),owner,first),{status:503});
 await env.FILES.put(objectKey,photoBytes,{customMetadata:{sha256:digest}});
 const expanded=await attach(owner,a.project,[{id:first,alt:'Garden <script>'},{id:second,alt:'Flowers'}]);assert.equal((await get('/s/'+a.project+'/assets/'+second+'.jpg')).status,404);await publish(owner,expanded.id);assert.equal((await get('/s/'+a.project+'/assets/'+second+'.jpg')).status,200);
 const archive=await ownedExport(scope(owner),owner,expanded.id,env.FILES);const files=unzipSync(archive);assert.equal(Object.keys(files).length,6);assert.deepEqual(files['public/assets/'+first+'.jpg'],photoBytes);const exportedHTML=strFromU8(files['public/index.html']);assert.ok(exportedHTML.includes('src="assets/'+second+'.jpg"'));const manifest=JSON.parse(strFromU8(files['whumpo/site.json']));assert.equal(manifest.photos.length,2);assert.ok(!JSON.stringify(manifest).includes('object_key'));assert.equal(await ownedExport(scope(other),other,expanded.id,env.FILES),null);
 await writeFile(dir+'/site.zip',archive);execFileSync('python3',['-c',"import zipfile,sys,io; from PIL import Image; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; photos=[p for p in z.namelist() if p.endswith('.jpg')]; assert len(photos)==2; [Image.open(io.BytesIO(z.read(p))).load() for p in photos]",dir+'/site.zip']);
 const restored=await chat(owner,'/restore '+action.id);await chat(owner,'/confirm '+restored.id);assert.equal((await get('/s/'+a.project+'/assets/'+first+'.jpg')).status,200);assert.equal((await get('/s/'+a.project+'/assets/'+second+'.jpg')).status,404);
 assert.equal((await custom('/assets/'+second+'.jpg')).status,404);
 const removed=await chat(owner,'/unpublish '+a.project);await chat(owner,'/confirm '+removed.id);assert.equal((await get('/s/'+a.project+'/assets/'+first+'.jpg')).status,404);assert.equal((await ownedPreview(ownedEnv(owner),owner,expanded.id)).status,200);
 assert.equal((await custom('/')).status,404);assert.equal((await custom('/assets/'+first+'.jpg')).status,404);
 const original=await chat(owner,'/restore '+a.version);await chat(owner,'/confirm '+original.id);assert.equal((await get('/s/'+a.project+'/assets/'+first+'.jpg')).status,404);assert.equal((await get('/s/'+a.project)).status,200);
 const firstRow=await db.prepare('SELECT object_key,digest FROM project_files WHERE id=?').bind(first).first();await env.FILES.delete(firstRow.object_key);await assert.rejects(ownedExport(scope(owner),owner,action.id,env.FILES),{status:503});await env.FILES.put(firstRow.object_key,photoBytes,{customMetadata:{sha256:firstRow.digest},httpMetadata:{contentType:'image/jpeg'}});
 await publish(owner,action.id);const period=new Date().toISOString().slice(0,7);await db.prepare('UPDATE storage_usage SET read_ops=99999 WHERE period=?').bind(period).run();const attempts=await Promise.allSettled([reserveStorage(db,'read'),reserveStorage(db,'read')]);assert.equal(attempts.filter(x=>x.status==='fulfilled').length,1);assert.equal((await get('/s/'+a.project+'/assets/'+first+'.jpg')).status,503);assert.equal((await get('/s/'+a.project+'/')).status,200);assert.equal((await getBilling(scope(owner),owner)).standardAI.creditCharge,0);
 await db.prepare("UPDATE project_photo_safety SET state='blocked' WHERE file_id=?").bind(first).run();
 assert.equal((await get('/s/'+a.project+'/assets/'+first+'.jpg')).status,404);assert.equal((await custom('/assets/'+first+'.jpg')).status,404);
 await assert.rejects(()=>readPhoto(ownedEnv(owner),owner,first),{status:423});await assert.rejects(()=>ownedPreview(ownedEnv(owner),owner,action.id),{status:423});await assert.rejects(()=>ownedExport(scope(owner),owner,action.id,env.FILES),{status:423});
 await assert.rejects(()=>db.prepare('UPDATE publications SET version_id=? WHERE project_id=?').bind(expanded.id,a.project).run(),/photo_safety_required/);
 await assert.rejects(()=>db.prepare("UPDATE project_photo_safety SET state='approved' WHERE file_id=?").bind(first).run());
 const review=await chat(owner,'/restore '+action.id),beforeRevision=(await readChat(scope(owner),owner)).state.revision;
 const refused=await chat(owner,'/confirm '+review.id);assert.equal(refused.result.status,423);assert.equal((await readChat(scope(owner),owner)).state.revision,beforeRevision);
 console.log('Photo safety gate passed: pending denial, exact-digest checks, both required checks, metadata tampering, revocation across preview/export/public/custom domains, and atomic publication rollback.');
 console.log('Photo version checks passed: exact private dependencies, cross-project/owner rejection, sandboxed inline preview, confirmed public visibility, restore/unpublish revocation, portable ZIP images, missing-asset failures and atomic storage limits.');
}finally{await store.close();await rm(dir,{recursive:true,force:true});}
