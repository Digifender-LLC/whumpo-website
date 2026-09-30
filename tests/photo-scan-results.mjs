Error.stackTraceLimit=0;
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';
import wrangler from 'wrangler';
const b=await build({stdin:{resolveDir:process.cwd(),contents:"export * from './src/photo-scan-results';export * from './src/profile';export {uploadPhoto,readPhoto} from './src/files';"},bundle:true,format:'esm',platform:'node',write:false});
const {reservePhotoScan,recordPhotoScan,updateProfile,updateProfilePhoto,profilePhoto,uploadPhoto,readPhoto}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
const dir=await mkdtemp('/tmp/whumpo-scan-results-');
let proxy;
try{
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','tellumo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
 execFileSync('python3',['-c',"from PIL import Image; import sys; Image.new('RGB',(128,128),(40,120,80)).save(sys.argv[1]+'/photo.jpg')",dir]);
 const jpeg=await readFile(dir+'/photo.jpg');
 proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB;
 async function fixture(){const user=crypto.randomUUID();await db.prepare('INSERT INTO users VALUES(?,?,?,?,?)').bind(user,user+'@example.test','fixture','fixture',new Date().toISOString()).run();await updateProfile(db,user,{revision:0,name:'Synthetic'});await updateProfilePhoto(db,user,new Request('https://whumpo.com/api/profile/photo',{method:'PUT',headers:{'content-type':'image/jpeg','if-match':'1'},body:jpeg}));return user;}
 const payload=(t,csam='clear',sexual='clear')=>({digest:t.digest,policyVersion:t.policyVersion,csam:{verdict:csam,reference:'synthetic-csam'},sexual:{verdict:sexual,reference:'synthetic-sexual'}});
 const owner=await fixture(),ticket=await reservePhotoScan(db,'profile',owner,owner);
 assert.notEqual((await db.prepare('SELECT authority_hash FROM photo_scan_tickets WHERE id=?').bind(ticket.id).first()).authority_hash,ticket.authority);
 await assert.rejects(()=>reservePhotoScan(db,'profile',crypto.randomUUID(),owner),e=>e.status===404);
 await assert.rejects(()=>reservePhotoScan(db,'profile',owner,owner),e=>e.status===409);
 await assert.rejects(()=>recordPhotoScan(db,ticket.id,'a'.repeat(64),payload(ticket)),e=>e.status===403);
 for(const bad of [{...payload(ticket),digest:'f'.repeat(64)},{...payload(ticket),policyVersion:'old'},{...payload(ticket),expiresAt:'2099'},{...payload(ticket),sexual:{verdict:'clear'}},{...payload(ticket),sexual:{verdict:{toString:()=> 'clear'},reference:'x'}}])await assert.rejects(()=>recordPhotoScan(db,ticket.id,ticket.authority,bad));
 await assert.rejects(()=>profilePhoto(db,owner),e=>e.status===423);
 const accepted=await recordPhotoScan(db,ticket.id,ticket.authority,payload(ticket));assert.equal(accepted.applied,true);assert.equal(accepted.outcome,'approved');assert.equal((await profilePhoto(db,owner)).status,200);
 assert.equal((await recordPhotoScan(db,ticket.id,ticket.authority,payload(ticket))).replayed,true);
 await assert.rejects(()=>recordPhotoScan(db,ticket.id,ticket.authority,payload(ticket,'matched')),e=>e.status===409);
 for(const [csam,sexual,state] of [['matched','clear','blocked'],['clear','matched','blocked'],['inconclusive','clear','held']]){
  const user=await fixture(),t=await reservePhotoScan(db,'profile',user,user),result=await recordPhotoScan(db,t.id,t.authority,payload(t,csam,sexual));assert.equal(result.outcome,state);assert.equal(result.applied,state!=='held');await assert.rejects(()=>profilePhoto(db,user),e=>e.status===423);
 }
 const changed=await fixture(),old=await reservePhotoScan(db,'profile',changed,changed);
 await updateProfilePhoto(db,changed,new Request('https://whumpo.com/api/profile/photo',{method:'DELETE',headers:{'if-match':'2'}}));
 const stale=await recordPhotoScan(db,old.id,old.authority,payload(old));assert.equal(stale.state,'stale');assert.equal(stale.outcome,'held');assert.equal(stale.applied,false);
 const racer=await fixture(),r=await reservePhotoScan(db,'profile',racer,racer);
 const raced=await Promise.allSettled([recordPhotoScan(db,r.id,r.authority,payload(r)),recordPhotoScan(db,r.id,r.authority,payload(r,'matched'))]);
 assert.equal(raced.filter(x=>x.status==='fulfilled').length,1);assert.equal(raced.find(x=>x.status==='rejected').reason.status,409);
 const actual=await db.prepare('SELECT state FROM profile_photo_safety WHERE user_id=?').bind(racer).first();assert.equal(actual.state,raced.find(x=>x.status==='fulfilled').value.outcome);
 // A lost batch acknowledgement must return the committed result without applying a second transition.
 const lostUser=await fixture(),lost=await reservePhotoScan(db,'profile',lostUser,lostUser);
 const lostDB=new Proxy(db,{get(target,key){if(key==='batch')return async statements=>{await target.batch(statements);throw Error('Synthetic lost acknowledgement');};const value=target[key];return typeof value==='function'?value.bind(target):value;}});
 const recovered=await recordPhotoScan(lostDB,lost.id,lost.authority,payload(lost));assert.equal(recovered.replayed,true);assert.equal(recovered.applied,true);
 const project=crypto.randomUUID(),file=crypto.randomUUID(),stamp=new Date().toISOString();
 await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Synthetic','Safety fixture','draft',?,?)").bind(project,owner,stamp,stamp).run();
 await uploadPhoto(new Request('https://whumpo.com/api/test',{method:'PUT',headers:{'content-type':'image/jpeg','x-photo-name':'Synthetic'},body:jpeg}),proxy.env,owner,project,file);
 await assert.rejects(()=>readPhoto(proxy.env,owner,file),err=>err.status===423);
 await assert.rejects(()=>reservePhotoScan(db,'project',lostUser,file),err=>err.status===404);
 const projectTicket=await reservePhotoScan(db,'project',owner,file);
 assert.equal((await recordPhotoScan(db,projectTicket.id,projectTicket.authority,payload(projectTicket))).applied,true);
 assert.equal((await readPhoto(proxy.env,owner,file)).status,200);
 await assert.rejects(()=>db.prepare("UPDATE photo_scan_tickets SET state='reserved' WHERE id=?").bind(projectTicket.id).run());
 // Check a genuinely expired ticket without changing production immutable trigger rules.
 const expiredUser=await fixture(),e=await reservePhotoScan(db,'profile',expiredUser,expiredUser);
 await db.prepare('DROP TRIGGER photo_scan_ticket_immutable').run();
 await db.prepare("UPDATE photo_scan_tickets SET expires_at='2000-01-01T00:00:00Z' WHERE id=?").bind(e.id).run();
 const expired=await recordPhotoScan(db,e.id,e.authority,payload(e));assert.equal(expired.state,'stale');assert.equal(expired.applied,false);await assert.rejects(()=>profilePhoto(db,expiredUser),err=>err.status===423);
 console.log('Photo scan results passed: exact ownership/digest/policy, strict coverage, authority hashing, duplicate/conflicting results, concurrent decisions, held/blocked/stale outcomes, lost acknowledgement recovery, and private delivery gate. Synthetic fixtures only.');
}finally{if(proxy)await proxy.dispose();await rm(dir,{recursive:true,force:true});}
