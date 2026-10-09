Error.stackTraceLimit=0;
import {timingSafeEqual} from 'node:crypto';
// Workers exposes this Web Crypto extension; Node's test runtime needs the equivalent.
crypto.subtle.timingSafeEqual=(a,b)=>timingSafeEqual(Buffer.from(a),Buffer.from(b));
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,workspaceSession,interceptDatabase} from './helpers/workspace-identity.mjs';
const bundle=await build({stdin:{contents:"export * from './src/profile';export {default as worker} from './src/index';export {hashToken,newSessionToken} from './src/security';export {admitWorkspace} from './src/workspace-identity/admission';export {resolveIdentity} from './src/workspace-identity/authority';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const m=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const {readProfile,updateProfile,agentProfile,updateProfilePhoto,profilePhoto,worker}=m;
const dir=await mkdtemp((process.env.TMPDIR||'/tmp')+'/whumpo-profile-'),fixture=await databaseFixture({d1:true,r2:true}),rawDB=fixture.db;
execFileSync('python3',['-c',"from PIL import Image; import sys; Image.new('RGB',(128,128),(90,125,95)).save(sys.argv[1]+'/avatar.jpg'); Image.new('RGB',(300,300)).save(sys.argv[1]+'/large.jpg')",dir]);
const jpeg=await readFile(dir+'/avatar.jpg');
const env={...fixture.env,ENVIRONMENT:'test',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})}};
const user=crypto.randomUUID(),other=crypto.randomUUID();
try{
 const owner=await workspaceFixture(rawDB,m,user),foreign=await workspaceFixture(rawDB,m,other),db=await owner.scope(),otherDB=await foreign.scope();
 assert.equal((await readProfile(db,user)).name,'');assert.equal(await agentProfile(db,user),null);
 await updateProfile(db,user,{revision:0,name:'River',about_me:'I edit a local journal.'});assert.equal(await agentProfile(db,user),null);
 await updateProfile(db,user,{revision:1,share_context:true,theme:'dark'});assert.deepEqual(await agentProfile(db,user),{name:'River',about_me:'I edit a local journal.'});assert.equal(await agentProfile(otherDB,other),null);
 for(const value of [{revision:2,email:'other@example.test'},{revision:2,theme:'bad'},{revision:2,theme:['dark']},{revision:2,name:'x'.repeat(81)},{revision:2,photo:'script'},{revision:2,user_id:other}])await assert.rejects(()=>updateProfile(db,user,value));
 await assert.rejects(()=>updateProfile(db,user,{revision:0,name:'stale'}),/changed/);
 const results=await Promise.allSettled([updateProfile(db,user,{revision:2,name:'A'}),updateProfile(db,user,{revision:2,name:'B'})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 function photo(body,revision=3){return new Request('https://whumpo.com/api/profile/photo',{method:'PUT',headers:{'content-type':'image/jpeg','if-match':String(revision)},body});}
 const marker=Buffer.from('private-metadata'),len=marker.length+2,withMetadata=Buffer.concat([jpeg.subarray(0,2),Buffer.from([255,225,len>>8,len&255]),marker,jpeg.subarray(2)]);
 await updateProfilePhoto(db,user,photo(withMetadata));
 assert.equal((await readProfile(db,user)).hasPhoto,0);assert.equal((await readProfile(db,user)).photoSafety,'pending');
 await assert.rejects(()=>profilePhoto(db,user),e=>e.status===423);
 await assert.rejects(()=>updateProfile(db,user,{revision:4,photoSafety:'approved'}));
 await assert.rejects(()=>rawDB.prepare("UPDATE profile_photo_safety SET state='approved',csam_check='clear',scanner_reference='synthetic-only',expires_at=? WHERE user_id=?").bind(new Date(Date.now()+60000).toISOString(),user).run());
 // Synthetic trusted receipt tests serving gates; no real scanner is configured.
 await rawDB.prepare("UPDATE profile_photo_safety SET state='approved',csam_check='clear',sexual_check='clear',scanner_reference='synthetic-only',expires_at=? WHERE user_id=?").bind(new Date(Date.now()+60000).toISOString(),user).run();
 const response=await profilePhoto(db,user);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.ok(!Buffer.from(await response.arrayBuffer()).includes(marker));assert.equal((await readProfile(db,user)).hasPhoto,1);await assert.rejects(()=>profilePhoto(otherDB,other));
 const large=await readFile(dir+'/large.jpg');await assert.rejects(()=>updateProfilePhoto(db,user,photo(large,4)));await assert.rejects(()=>updateProfilePhoto(db,user,photo(Buffer.alloc(40000),4)));await assert.rejects(()=>updateProfilePhoto(db,user,photo(Buffer.from('<svg/>'),4)));
 await rawDB.prepare("UPDATE profile_photo_safety SET state='blocked' WHERE user_id=?").bind(user).run();
 assert.equal((await readProfile(db,user)).photoSafety,'blocked');await assert.rejects(()=>profilePhoto(db,user),e=>e.status===423);
 await assert.rejects(()=>rawDB.prepare("UPDATE profile_photo_safety SET state='approved' WHERE user_id=?").bind(user).run());
 await updateProfile(db,user,{revision:4,share_context:false});assert.equal(await agentProfile(db,user),null);
 await updateProfilePhoto(db,user,new Request('https://whumpo.com/api/profile/photo',{method:'DELETE',headers:{'if-match':'5'}}));assert.equal((await readProfile(db,user)).hasPhoto,0);assert.equal((await rawDB.prepare('SELECT count(*) n FROM profile_photo_safety WHERE user_id=?').bind(user).first()).n,0);await assert.rejects(()=>profilePhoto(db,user));
 const token=owner.token,second=await workspaceSession(rawDB,m,owner);
 async function api(path,method='GET',body,session=token,origin='https://whumpo.com',database=rawDB){return worker.fetch(new Request('https://whumpo.com/api'+path,{method,headers:{origin,'content-type':'application/json',cookie:'__Host-whumpo_session='+session},body:body?JSON.stringify(body):undefined}),{...env,DB:database},{waitUntil(){}});}
 assert.equal((await api('/profile','GET',null,'')).status,401);assert.equal((await api('/profile','PATCH',{revision:6,name:'No'},token,'https://evil.example')).status,403);
 const current=await (await api('/profile')).json();assert.equal(current.accountId,user);assert.equal(Object.hasOwn(current,'passwordEnabled'),false);
 for(const retired of ['/profile/password','/auth/login','/auth/register','/auth/recover'])assert.equal((await api(retired,'POST',{})).status,404);
 const beforeWrite=interceptDatabase(rawDB,/UPDATE user_profiles/,()=>owner.revoke());
 const denied=await api('/profile','PATCH',{revision:current.revision,name:'Revoked edit'},token,'https://whumpo.com',beforeWrite);
 assert.equal(denied.status,409);assert.equal((await denied.json()).code,'identity_changed');
 assert.notEqual((await rawDB.prepare('SELECT name FROM user_profiles WHERE user_id=?').bind(user).first()).name,'Revoked edit');
 assert.equal((await api('/profile')).status,401);assert.equal((await api('/profile','GET',null,second.token)).status,200);
 // Unapproved bytes and expired/malformed approvals must never become visible.
 await rawDB.prepare('INSERT INTO user_profiles(user_id,photo) VALUES(?,?)').bind(other,jpeg.toString('base64')).run();
 assert.equal((await readProfile(otherDB,other)).photoSafety,'pending');await assert.rejects(()=>profilePhoto(otherDB,other),e=>e.status===423);
 for(const expiry of ['invalid-date','2000-01-01T00:00:00.000Z']){
  let p=await readProfile(otherDB,other);await updateProfile(otherDB,other,{revision:p.revision,avatar_id:'star'});p=await readProfile(otherDB,other);await updateProfilePhoto(otherDB,other,photo(jpeg,p.revision));
  await rawDB.prepare("UPDATE profile_photo_safety SET state='approved',csam_check='clear',sexual_check='clear',scanner_reference='synthetic-only',expires_at=? WHERE user_id=?").bind(expiry,other).run();
  assert.equal((await readProfile(otherDB,other)).hasPhoto,0);await assert.rejects(()=>profilePhoto(otherDB,other),e=>e.status===423);
 }
 assert.ok(!JSON.stringify(await readProfile(otherDB,other)).includes('scanner_reference'));
 console.log('Profile checks passed: private photo/metadata isolation, opt-in AI context, CAS edits, strict fields, owner/session/CSRF boundaries, retired-route refusal and commit-time current-session revocation.');
}finally{await fixture.close();await rm(dir,{recursive:true,force:true});}
