import {timingSafeEqual} from 'node:crypto';
// Workers exposes this Web Crypto extension; Node's test runtime needs the equivalent.
crypto.subtle.timingSafeEqual=(a,b)=>timingSafeEqual(Buffer.from(a),Buffer.from(b));
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
async function module(path){const b=await build({entryPoints:[path],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const {readProfile,updateProfile,agentProfile,updateProfilePhoto,profilePhoto}=await module('src/profile.ts');
const worker=(await module('src/index.ts')).default;
const {hashToken,hashPassword,verifyPassword}=await module('src/security.ts');
const dir=await mkdtemp('/tmp/townhello-profile-');execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','tellumo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
execFileSync('python3',['-c',"from PIL import Image; import sys; Image.new('RGB',(128,128),(90,125,95)).save(sys.argv[1]+'/avatar.jpg'); Image.new('RGB',(300,300)).save(sys.argv[1]+'/large.jpg')",dir]);
const jpeg=await readFile(dir+'/avatar.jpg');
const proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false}),db=proxy.env.DB;
const env={...proxy.env,ENVIRONMENT:'local',AUTH_LIMITER:{limit:async()=>({success:true})},API_LIMITER:{limit:async()=>({success:true})}};
const user=crypto.randomUUID(),other=crypto.randomUUID(),pepper='local-development-only-pepper-not-for-production',password='Synthetic-initial-password',nextPassword='Synthetic-replacement-password';
try{
 const passwordInfo=await hashPassword(password,pepper);
 for(const id of [user,other])await db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').bind(id,id+'@example.test',passwordInfo.salt,passwordInfo.hash,new Date().toISOString()).run();
 assert.equal((await readProfile(db,user)).name,'');assert.equal(await agentProfile(db,user),null);
 await updateProfile(db,user,{revision:0,name:'River',about_me:'I edit a local journal.'});assert.equal(await agentProfile(db,user),null);
 await updateProfile(db,user,{revision:1,share_context:true,theme:'dark'});assert.deepEqual(await agentProfile(db,user),{name:'River',about_me:'I edit a local journal.'});assert.equal(await agentProfile(db,other),null);
 for(const value of [{revision:2,email:'other@example.test'},{revision:2,theme:'bad'},{revision:2,theme:['dark']},{revision:2,name:'x'.repeat(81)},{revision:2,photo:'script'},{revision:2,user_id:other}])await assert.rejects(()=>updateProfile(db,user,value));
 await assert.rejects(()=>updateProfile(db,user,{revision:0,name:'stale'}),/changed/);
 const results=await Promise.allSettled([updateProfile(db,user,{revision:2,name:'A'}),updateProfile(db,user,{revision:2,name:'B'})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 function photo(body,revision=3){return new Request('https://whumpo.com/api/profile/photo',{method:'PUT',headers:{'content-type':'image/jpeg','if-match':String(revision)},body});}
 const marker=Buffer.from('private-metadata'),len=marker.length+2,withMetadata=Buffer.concat([jpeg.subarray(0,2),Buffer.from([255,225,len>>8,len&255]),marker,jpeg.subarray(2)]);
 await updateProfilePhoto(db,user,photo(withMetadata));const response=await profilePhoto(db,user);assert.equal(response.headers.get('cache-control'),'private, no-store');assert.ok(!Buffer.from(await response.arrayBuffer()).includes(marker));assert.equal((await readProfile(db,user)).hasPhoto,1);await assert.rejects(()=>profilePhoto(db,other));
 const large=await readFile(dir+'/large.jpg');await assert.rejects(()=>updateProfilePhoto(db,user,photo(large,4)));await assert.rejects(()=>updateProfilePhoto(db,user,photo(Buffer.alloc(40000),4)));await assert.rejects(()=>updateProfilePhoto(db,user,photo(Buffer.from('<svg/>'),4)));
 await updateProfile(db,user,{revision:4,share_context:false});assert.equal(await agentProfile(db,user),null);
 await updateProfilePhoto(db,user,new Request('https://whumpo.com/api/profile/photo',{method:'DELETE',headers:{'if-match':'5'}}));assert.equal((await readProfile(db,user)).hasPhoto,0);await assert.rejects(()=>profilePhoto(db,user));
 const token='a'.repeat(64),second='b'.repeat(64),stamp=new Date().toISOString();for(const t of [token,second])await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').bind(await hashToken(t),user,new Date(Date.now()+3600000).toISOString(),stamp).run();
 async function api(path,method='GET',body,session=token,origin='https://whumpo.com'){return worker.fetch(new Request('https://whumpo.com/api'+path,{method,headers:{origin,'content-type':'application/json',cookie:'tellumo_session='+session},body:body?JSON.stringify(body):undefined}),env,{waitUntil(){}});}
 assert.equal((await api('/profile','GET',null,'')).status,401);assert.equal((await api('/profile','PATCH',{revision:5,name:'No'},token,'https://evil.example')).status,403);
 assert.equal((await api('/profile/password','POST',{newPassword:nextPassword,currentPassword:'wrong'})).status,400);
 await db.prepare('UPDATE sessions SET created_at=? WHERE token_hash=?').bind(new Date(Date.now()-700000).toISOString(),await hashToken(token)).run();
 assert.equal((await api('/profile/password','POST',{newPassword:nextPassword,currentPassword:password})).status,401);
 const changed=await api('/profile/password','POST',{newPassword:nextPassword,currentPassword:password},second);assert.equal(changed.status,200);assert.ok(changed.headers.get('set-cookie'));
 assert.equal((await api('/profile','GET',null,second)).status,401);assert.equal((await api('/profile','GET',null,token)).status,401);
 const saved=await db.prepare('SELECT password_salt,password_hash FROM users WHERE id=?').bind(user).first();assert.equal(await verifyPassword(nextPassword,saved.password_salt,saved.password_hash,pepper),true);
 // Session pruning triggers must not turn a valid eleventh login into a failure.
 for(let i=0;i<11;i++){const login=await worker.fetch(new Request('https://whumpo.com/api/auth/login',{method:'POST',headers:{origin:'https://whumpo.com','content-type':'application/json'},body:JSON.stringify({email:user+'@example.test',password:nextPassword})}),env,{waitUntil(){}});assert.equal(login.status,200);assert.ok(login.headers.get('set-cookie'));}
 assert.equal((await db.prepare('SELECT count(*) AS n FROM sessions WHERE user_id=?').bind(user).first()).n,10);
 // A password login already verifying the old credential cannot mint a session
 // after a concurrent password replacement commits.
 const raced=await hashPassword('Concurrent-replacement-password',pepper);
 const racingDB=new Proxy(db,{get(target,key){if(key==='prepare')return sql=>{const stmt=target.prepare(sql);if(!sql.startsWith('SELECT id, email, password_salt, password_hash FROM users'))return stmt;return {bind(...args){const bound=stmt.bind(...args);return {async first(){const snapshot=await bound.first();await target.prepare('UPDATE users SET password_hash=?,password_salt=? WHERE id=?').bind(raced.hash,raced.salt,user).run();return snapshot;}};}};};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 const raceResponse=await worker.fetch(new Request('https://whumpo.com/api/auth/login',{method:'POST',headers:{origin:'https://whumpo.com','content-type':'application/json'},body:JSON.stringify({email:user+'@example.test',password:nextPassword})}),{...env,DB:racingDB},{waitUntil(){}});assert.equal(raceResponse.status,401);assert.equal(raceResponse.headers.get('set-cookie'),null);
 console.log('Profile checks passed: private photo/metadata isolation, opt-in AI context, CAS edits, strict fields, owner/session/CSRF boundaries, fresh password proof, atomic credential update and old-session revocation.');
}finally{await proxy.dispose();await rm(dir,{recursive:true,force:true});}
