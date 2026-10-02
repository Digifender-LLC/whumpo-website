import {currentSiteFixtureHandlers,createFixtureWebsite} from './current-site-fixture.mjs';
Error.stackTraceLimit=0;
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {databaseFixture} from './helpers/current-database.mjs';
import {workspaceFixture,interceptDatabase} from './helpers/workspace-identity.mjs';
const m=await currentSiteFixtureHandlers(),store=await databaseFixture({d1:true,r2:true}),db=store.db,env=store.env,owners=new Map(),scopes=new Map(),scope=user=>scopes.get(user),ownedEnv=user=>({...env,DB:scope(user)});
async function accountAuthority(user){const authority=await workspaceFixture(db,m,user);owners.set(user,authority);scopes.set(user,await authority.scope());}
const {uploadPhoto,readPhoto,listPhotos,cleanupPhotos,sendChat,readChat,getBilling}=m;
const dir=await mkdtemp('/tmp/tellumo-photo-removal-');
execFileSync('python3',['-c',"from PIL import Image; import sys; Image.new('RGB',(32,24),(80,120,60)).save(sys.argv[1]+'/fixture.jpg')",dir]);const jpeg=new Uint8Array(await readFile(dir+'/fixture.jpg'));
async function account(){const id=crypto.randomUUID(),project=crypto.randomUUID();await accountAuthority(id);await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Photos','Synthetic test','draft',?,?)").bind(project,id,new Date().toISOString(),new Date().toISOString()).run();await readChat(scope(id),id);return {id,project};}
function request(){return new Request('https://whumpo.com/api/test',{method:'PUT',headers:{'content-type':'image/jpeg','x-photo-name':'Garden'},body:jpeg});}
async function upload(owner){const id=crypto.randomUUID();await uploadPhoto(request(),ownedEnv(owner.id),owner.id,owner.project,id);/* Synthetic receipt isolates removal behavior; no provider scan. */await db.prepare("UPDATE project_photo_safety SET state='approved',csam_check='clear',sexual_check='clear',scanner_reference='synthetic',expires_at=? WHERE file_id=?").bind(new Date(Date.now()+3600000).toISOString(),id).run();return id;}
async function chat(owner,content,connection=scope(owner.id)){const state=await readChat(scope(owner.id),owner.id),id=crypto.randomUUID(),input={id,content,revision:state.state.revision};const result=await sendChat(connection,owner.id,input);return {id,input,result};}
async function review(owner,file){const r=await chat(owner,'/delete-photo '+file);assert.equal(r.result.status,200);return r;}
try{
 const owner=await account(),other=await account(),file=await upload(owner),key=`photos/${owner.project}/${file}.jpg`;
 const r=await review(owner,file);assert.equal((await readChat(scope(owner.id),owner.id)).turns.at(-1).photo_confirmation_id,r.id);assert.ok(await env.FILES.head(key));assert.equal((await listPhotos(scope(owner.id),owner.id,owner.project)).files.length,1);
 const foreign=await chat(other,'/confirm-photo-delete '+r.id);assert.equal(foreign.result.status,200);assert.match((await readChat(scope(other.id),other.id)).turns.at(-1).assistant_text,/not found/);assert.equal((await listPhotos(scope(owner.id),owner.id,owner.project)).files.length,1);
 const confirm=await chat(owner,'/confirm-photo-delete '+r.id);assert.equal(confirm.result.status,200);assert.equal((await listPhotos(scope(owner.id),owner.id,owner.project)).files.length,0);await assert.rejects(readPhoto(ownedEnv(owner.id),owner.id,file),{status:404});assert.ok(await env.FILES.head(key));assert.ok(await db.prepare('SELECT object_key FROM file_cleanup WHERE object_key=?').bind(key).first());
 assert.equal((await sendChat(scope(owner.id),owner.id,confirm.input)).status,200);assert.equal((await db.prepare("SELECT COUNT(*) n FROM activity_events WHERE action='file.removed' AND user_id=?").bind(owner.id).first()).n,1);
 await assert.rejects(uploadPhoto(request(),ownedEnv(owner.id),owner.id,owner.project,file),{status:409});
 await cleanupPhotos(env,new Date(Date.now()+7200000));assert.equal(await env.FILES.head(key),null);await assert.rejects(uploadPhoto(request(),ownedEnv(owner.id),owner.id,owner.project,file),{status:409});
 // A pending upload can be removed. Its delayed write is orphaned, never revived.
 const pending=crypto.randomUUID(),pendingKey=`photos/${owner.project}/${pending}.jpg`;
 await db.prepare("INSERT INTO project_files(id,project_id,name,object_key,digest,size,width,height,created_at) VALUES(?,?,'Pending',?,'fixture',10,1,1,?)").bind(pending,owner.project,pendingKey,new Date().toISOString()).run();
 const pendingReview=await review(owner,pending);assert.equal((await chat(owner,'/confirm-photo-delete '+pendingReview.id)).result.status,200);await cleanupPhotos(env,new Date(Date.now()+7200000));await env.FILES.put(pendingKey,jpeg);await cleanupPhotos(env,new Date(Date.now()+7200000));assert.equal(await env.FILES.head(pendingKey),null);
 // A photo added to a version after review cannot be removed, even by direct SQL.
 const retained=await upload(owner),beforeUse=await review(owner,retained);await createFixtureWebsite(scope(owner.id),owner.id,owner.project,{name:'Photos',headline:'Garden photos',description:'Synthetic testing',theme:'ocean',aboutTitle:'About',aboutText:'Testing',sections:[],photos:[{id:retained,alt:'Garden'}]});
 const blocked=await chat(owner,'/confirm-photo-delete '+beforeUse.id);assert.equal(blocked.result.status,409);assert.equal((await readPhoto(ownedEnv(owner.id),owner.id,retained)).status,200);await assert.rejects(db.prepare('DELETE FROM project_files WHERE id=?').bind(retained).run(),/photo_removal_referenced/);
 const blockedReview=await review(owner,retained);assert.equal((await readChat(scope(owner.id),owner.id)).turns.at(-1).photo_confirmation_id,null);assert.match((await readChat(scope(owner.id),owner.id)).turns.at(-1).assistant_text,/retained/);assert.equal((await listPhotos(scope(owner.id),owner.id,owner.project)).files.find(f=>f.id===retained).saved_versions,1);
 // Two different confirmation messages cannot apply the same review twice.
 const raceFile=await upload(owner),raceReview=await review(owner,raceFile),raceState=await readChat(scope(owner.id),owner.id);
 const raceInputs=Array.from({length:2},()=>({id:crypto.randomUUID(),revision:raceState.state.revision,content:'/confirm-photo-delete '+raceReview.id}));
 const raced=await Promise.all(raceInputs.map(input=>sendChat(scope(owner.id),owner.id,input)));assert.deepEqual(raced.map(r=>r.status).sort(),[200,409]);assert.equal((await db.prepare("SELECT COUNT(*) n FROM activity_events WHERE id=?").bind('photo-removal:'+raceFile).first()).n,1);
 await assert.rejects(db.prepare("UPDATE photo_removals SET file_id=? WHERE id=?").bind(retained,raceReview.id).run(),/photo_removal_immutable/);
 for(const content of ['/files '+owner.project,'/files']){const state=await readChat(scope(owner.id),owner.id),input={id:crypto.randomUUID(),revision:state.state.revision,content};assert.equal((await sendChat(scope(owner.id),owner.id,input,{baseURL:'https://unused.example/v1',apiKey:'unused',model:'unused',protocol:'responses'})).status,200);const saved=await db.prepare('SELECT assistant_text,mode FROM chat_turns WHERE id=?').bind(input.id).first();assert.match(saved.assistant_text,/32 × 24 pixels/);assert.match(saved.assistant_text,/retained by 1 saved version/);assert.match(saved.assistant_text,/not image bytes/);assert.equal(saved.mode,'guided');assert.ok(!saved.assistant_text.includes('photos/'));assert.equal((await sendChat(scope(owner.id),owner.id,input)).status,200);}
 const foreignFiles=await chat(other,'/files '+owner.project);assert.match((await db.prepare('SELECT assistant_text FROM chat_turns WHERE id=?').bind(foreignFiles.id).first()).assistant_text,/No matching project/);
 const invalidFiles=await chat(owner,'/files invalid');assert.equal(invalidFiles.result.status,400);
 const photoList=await chat(owner,'/photos '+owner.project);assert.equal(photoList.result.status,200);assert.match((await readChat(scope(owner.id),owner.id)).turns.at(-1).assistant_text,new RegExp(retained));
 // Review expiry is rechecked inside the mutation, not just in application reads.
 const expiredFile=await upload(owner),expiredReview=await review(owner,expiredFile);
 let expired=false;const expireProxy=await owners.get(owner.id).scope(interceptDatabase(db,/^UPDATE photo_removals SET/,async()=>{if(expired)return;expired=true;await db.prepare('DROP TRIGGER photo_removal_identity').run();await db.prepare("UPDATE photo_removals SET expires_at='2000-01-01' WHERE id=?").bind(expiredReview.id).run();}));
 // Only intercept the confirmation write; readChat uses the real DB.
 assert.equal((await chat(owner,'/confirm-photo-delete '+expiredReview.id,expireProxy)).result.status,409);assert.equal(expired,true);assert.equal((await readPhoto(ownedEnv(owner.id),owner.id,expiredFile)).status,200);
 // Lost commit acknowledgement recovers the saved turn and exact deletion without repeats.
 const lostFile=await upload(owner),lostReview=await review(owner,lostFile);let lost=false;
 const lossy=await owners.get(owner.id).scope(interceptDatabase(db,/^UPDATE photo_removals SET/,async()=>{},async()=>{if(!lost){lost=true;throw Error('Lost acknowledgement');}}));
 assert.equal((await chat(owner,'/confirm-photo-delete '+lostReview.id,lossy)).result.status,200);assert.ok(lost);assert.equal((await db.prepare("SELECT COUNT(*) n FROM activity_events WHERE id=?").bind('photo-removal:'+lostFile).first()).n,1);
 // Pending physical deletions count against storage capacity before any new R2 write.
 await db.prepare("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<500) INSERT INTO file_cleanup(object_key,created_at) SELECT 'fixture-capacity/'||x,? FROM n").bind(new Date().toISOString()).run();await assert.rejects(upload(owner),{status:409});
 assert.equal((await getBilling(scope(owner.id),owner.id)).standardAI.creditCharge,0);
 await db.prepare('DELETE FROM users WHERE id=?').bind(owner.id).run();assert.equal((await db.prepare('SELECT COUNT(*) n FROM photo_removals WHERE user_id=?').bind(owner.id).first()).n,0);
 console.log('Photo removal passed: owner-only review/confirmation, no mutation before approval, replay tombstones, delayed R2 cleanup, pending-upload orphans, saved-version protection including review races, expiry at commit, lost acknowledgement, storage capacity and account cascade.');
}finally{await store.close();await rm(dir,{recursive:true,force:true});}
