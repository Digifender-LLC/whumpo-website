import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {build} from 'esbuild';import wrangler from 'wrangler';
async function mod(path){const b=await build({entryPoints:[path],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const recovery=await mod('src/app-document-recovery.ts'),backend=await mod('src/backend-versions.ts'),activation=await mod('src/app-activation.ts'),data=await mod('src/app-data.ts');
const dir=await mkdtemp('/tmp/whumpo-app-recovery-');let proxy;
const id=()=>crypto.randomUUID(),now=()=>new Date().toISOString();
const service={fetch:async(_url,init)=>Response.json({ok:true,value:{state:JSON.parse(init.body).input.input,result:'saved'}})};
try{
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','whumpo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB;
 const user=id(),other=id(),project=id(),version=id(),run=id();
 for(const u of [user,other])await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(u,u+'@example.test',now()).run();
 await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Recovery','','draft',?,?)").bind(project,user,now(),now()).run();
 await backend.saveBackend(db,user,project,version,'export default ({state,input})=>({state:input,result:"saved"})');await backend.testBackend(db,service,user,project,version,run,{state:{},input:{}});
 async function toggle(enabled){const review=id();await activation.prepareApplication(db,user,project,review,enabled?'enable':'disable',enabled?version:null,enabled?run:null);await activation.confirmApplication(db,user,review);}
 await toggle(true);
 async function visitor(){const v=id();await db.prepare('INSERT INTO app_visitors(id,project_id) VALUES(?,?)').bind(v,project).run();return {id:v,token:await data.issueAppSession(db,v)};}
 const a=await visitor(),b=await visitor();
 await data.transitionAppData(db,service,a.token,project,id(),0,{private:'original A'});await data.transitionAppData(db,service,b.token,project,id(),0,{private:'original B'});
 const point=id();await recovery.createRecoveryPoint(db,user,project,point);
 await assert.rejects(recovery.listRecoveryPoints(db,other,project),e=>e.status===404);
 assert.equal((await recovery.listRecoveryPoints(db,user,project))[0].retainedDocuments,2);
 assert.ok(!JSON.stringify(await recovery.listRecoveryPoints(db,user,project)).includes('original A'));
 await assert.rejects(db.prepare("UPDATE app_recovery_documents SET state_json='{}' WHERE point_id=?").bind(point).run());await assert.rejects(db.prepare('DELETE FROM app_recovery_documents WHERE point_id=?').bind(point).run());
 await assert.rejects(recovery.prepareAppRestore(db,user,project,point,id()),e=>e.status===409);
 await data.transitionAppData(db,service,a.token,project,id(),1,{private:'new A'});await data.transitionAppData(db,service,b.token,project,id(),1,{private:'new B'});
 await toggle(false);
 const review=id();assert.equal((await recovery.prepareAppRestore(db,user,project,point,review)).documents,2);
 await assert.rejects(recovery.confirmAppRestore(db,user,project,review,'restore'),e=>e.status===400);await assert.rejects(recovery.confirmAppRestore(db,other,project,review,'RESTORE'),e=>e.status===404);
 // Force failure on the second document: the first document and review must roll back.
 await db.exec(`CREATE TRIGGER recovery_fixture_fail BEFORE UPDATE ON app_documents WHEN NEW.visitor_id='${b.id}' BEGIN SELECT RAISE(ABORT,'fixture'); END;`);
 await assert.rejects(recovery.confirmAppRestore(db,user,project,review,'RESTORE'),e=>e.status===409);
 assert.equal((await db.prepare('SELECT revision FROM app_documents WHERE visitor_id=?').bind(a.id).first()).revision,2);await db.exec('DROP TRIGGER recovery_fixture_fail');
 const lossy=new Proxy(db,{get(target,key){if(key==='prepare')return sql=>{const statement=target.prepare(sql);if(!sql.startsWith('UPDATE app_restore_reviews'))return statement;return {bind(...args){const bound=statement.bind(...args);return {async run(){await bound.run();throw Error('Lost acknowledgment');}}}};};const v=target[key];return typeof v==='function'?v.bind(target):v;}});
 assert.equal((await recovery.confirmAppRestore(lossy,user,project,review,'RESTORE')).status,'applied');
 assert.ok((await Promise.all([1,2,3].map(()=>recovery.confirmAppRestore(db,user,project,review,'RESTORE')))).every(r=>r.status==='applied'));
 for(const [v,value] of [[a,'original A'],[b,'original B']]){const d=await db.prepare('SELECT * FROM app_documents WHERE visitor_id=?').bind(v.id).first();assert.equal(d.revision,3);assert.equal(JSON.parse(d.state_json).private,value);}
 assert.equal((await db.prepare('SELECT attempts FROM app_daily_usage WHERE project_id=?').bind(project).first()).attempts,4);
 assert.equal((await db.prepare('SELECT enabled FROM app_spaces WHERE project_id=?').bind(project).first()).enabled,0);
 assert.equal((await db.prepare('SELECT count(*) n FROM app_sessions').first()).n,0);
 // Changing an active roster invalidates a review; revoked snapshots are removed.
 const stale=id();await recovery.prepareAppRestore(db,user,project,point,stale);
 await db.prepare('UPDATE app_visitors SET revoked=1 WHERE id=?').bind(b.id).run();
 assert.equal((await db.prepare('SELECT count(*) n FROM app_recovery_documents WHERE visitor_id=?').bind(b.id).first()).n,0);
 await assert.rejects(recovery.confirmAppRestore(db,user,project,stale,'RESTORE'),e=>e.status===409);
 await db.prepare('DELETE FROM app_visitors WHERE id=?').bind(b.id).run();
 const fresh=id();assert.equal((await recovery.prepareAppRestore(db,user,project,point,fresh)).documents,1);assert.ok((await Promise.all([1,2,3].map(()=>recovery.confirmAppRestore(db,user,project,fresh,'RESTORE')))).every(r=>r.status==='applied'));assert.equal(await db.prepare('SELECT id FROM app_visitors WHERE id=?').bind(b.id).first(),null);
 // Expired reviews cannot apply, even with an unchanged disabled app.
 const expired=id();await db.prepare("INSERT INTO app_restore_reviews(id,user_id,project_id,point_id,base_revision,roster_json,expires_at) SELECT ?,?,?,?,a.revision,r.roster_json,'2000-01-01T00:00:00.000Z' FROM app_spaces a JOIN app_recovery_rosters r ON r.project_id=a.project_id WHERE a.project_id=?").bind(expired,user,project,point,project).run();await assert.rejects(recovery.confirmAppRestore(db,user,project,expired,'RESTORE'),e=>e.status===409);
 // Erasure of an active visitor also cascades saved documents without resurrection.
 await db.prepare('DELETE FROM app_visitors WHERE id=?').bind(a.id).run();assert.equal((await recovery.listRecoveryPoints(db,user,project))[0].retainedDocuments,0);
 await toggle(true);const c=await visitor();await toggle(false);await assert.rejects(recovery.prepareAppRestore(db,user,project,point,id()),e=>e.status===409);
 await assert.rejects(db.prepare('INSERT INTO app_recovery_documents SELECT ?,visitor_id,revision,state_json FROM app_documents WHERE visitor_id=?').bind(point,c.id).run());
 // Replaying a snapshot request never captures the later roster.
 await recovery.createRecoveryPoint(db,user,project,point);assert.equal((await recovery.listRecoveryPoints(db,user,project))[0].retainedDocuments,0);
 console.log('Application recovery passed: atomic snapshots/restoration, private summaries, sealed documents, disabled-only review, owner/confirmation guards, lost-response and concurrent replay, rollback on partial failure, monotonic revisions, preserved usage, roster conflicts, revoked/erased document removal and no identity resurrection.');
}finally{await proxy?.dispose();await rm(dir,{recursive:true,force:true});}
