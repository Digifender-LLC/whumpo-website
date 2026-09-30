Error.stackTraceLimit=0;
import assert from 'node:assert/strict';import {createRequire} from 'node:module';
import {mkdtemp,rm,readdir} from 'node:fs/promises';import {execFileSync} from 'node:child_process';import {build} from 'esbuild';import wrangler from 'wrangler';
async function mod(path){const b=await build({entryPoints:[path],bundle:true,format:'esm',platform:'node',write:false});return import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));}
const approvals=await mod('src/app-migration-approval.ts');
const migration=await mod('src/app-migration-checks.ts'),backend=await mod('src/backend-versions.ts'),activation=await mod('src/app-activation.ts'),recovery=await mod('src/app-document-recovery.ts');
const dir=await mkdtemp('/tmp/whumpo-migration-check-');let proxy,runtime;const id=()=>crypto.randomUUID(),now=()=>new Date().toISOString();
try{
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','d1','migrations','apply','tellumo-control','--local','--persist-to',dir],{stdio:'pipe',maxBuffer:16*1024*1024});
 execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','deploy','--config','wrangler.runtime.jsonc','--dry-run','--outdir',dir+'/runtime'],{stdio:'pipe',maxBuffer:16*1024*1024});
 const require=createRequire(import.meta.resolve('wrangler')),{Miniflare,convertV4MiniflareOptions}=require('miniflare');runtime=new Miniflare(convertV4MiniflareOptions({modulesRoot:dir+'/runtime',modules:[{type:'ESModule',path:dir+'/runtime/worker.js'},...(await readdir(dir+'/runtime')).filter(p=>p.endsWith('.wasm')).map(p=>({type:'CompiledWasm',path:dir+'/runtime/'+p}))],compatibilityDate:'2026-09-29'}));
 proxy=await wrangler.getPlatformProxy({persist:{path:dir+'/v3'},remoteBindings:false});const db=proxy.env.DB;let calls=0;const service={fetch:async(url,init)=>{calls++;assert.deepEqual(Object.keys(JSON.parse(init.body)),['version','source','input']);assert.equal(new Headers(init.headers).has('cookie'),false);return runtime.dispatchFetch(url,init);}};
 const user=id(),other=id(),project=id(),v1=id(),v2=id(),transform=id(),badTransform=id(),run1=id(),run2=id();
 for(const u of [user,other])await db.prepare("INSERT INTO users VALUES(?,?,'00','fixture',?)").bind(u,u+'@example.test',now()).run();
 await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Migration','','draft',?,?)").bind(project,user,now(),now()).run();
 await backend.saveBackend(db,user,project,v1,'export default ({state,input})=>({state:input,result:"saved"})');await backend.testBackend(db,service,user,project,v1,run1,{state:{},input:{}});
 await backend.saveBackend(db,user,project,v2,'export default ({state,input})=>({state:{...state,note:input.note},result:"saved"})');await backend.testBackend(db,service,user,project,v2,run2,{state:{schema:2},input:{note:'synthetic'}},{expected:{state:{schema:2,note:'synthetic'},result:'saved'}});
 await backend.saveBackend(db,user,project,transform,'export default ({state})=>({state:{schema:2,note:state.note}})');await backend.saveBackend(db,user,project,badTransform,'export default ()=>"not a document"');
 const enable=id();await activation.prepareApplication(db,user,project,enable,'enable',v1,run1);await activation.confirmApplication(db,user,enable);
 const visitors=[];for(let i=0;i<4;i++){const visitor=id();visitors.push(visitor);await db.prepare('INSERT INTO app_visitors(id,project_id) VALUES(?,?)').bind(visitor,project).run();await db.prepare('UPDATE app_documents SET revision=revision+1,state_json=? WHERE visitor_id=?').bind(JSON.stringify({note:'private-'+i}),visitor).run();}
 const start=(request,version=transform,database=db)=>migration.beginMigrationCheck(database,user,project,request,v2,version,run2);
 await assert.rejects(start(id()),e=>e.status===409);
 const disable=id();await activation.prepareApplication(db,user,project,disable,'disable',null,null);await activation.confirmApplication(db,user,disable);
 const failed=id();await assert.rejects(migration.beginMigrationCheck(db,user,project,failed,v2,transform,run1),e=>e.status===409);assert.equal(await db.prepare('SELECT id FROM app_recovery_points WHERE id=?').bind(failed).first(),null,'Failed admission rolls back recovery copy');
 const checkpoint=id(),lossyBatch=new Proxy(db,{get(t,k){if(k==='batch')return async s=>{await t.batch(s);throw Error('Lost commit');};const v=t[k];return typeof v==='function'?v.bind(t):v;}});
 assert.equal((await start(checkpoint,transform,lossyBatch)).documents,4);await assert.rejects(migration.readMigrationCheck(db,other,checkpoint),e=>e.status===404);
 const before=calls;await Promise.all([1,2].map(()=>migration.advanceMigrationCheck(db,service,user,checkpoint)));let progress=await migration.advanceMigrationCheck(db,service,user,checkpoint);assert.equal(progress.state,'ready');assert.equal(calls-before,4);assert.ok(!JSON.stringify(progress).includes('private-'));assert.ok(visitors.every(v=>!JSON.stringify(progress).includes(v)));
 await start(checkpoint);await migration.advanceMigrationCheck(db,service,user,checkpoint);assert.equal(calls-before,4);
 const staged=(await db.prepare('SELECT next_json FROM app_migration_documents WHERE migration_id=?').bind(checkpoint).all()).results;assert.ok(staged.every(d=>JSON.parse(d.next_json).schema===2));
 const unchanged=(await db.prepare('SELECT revision,state_json FROM app_documents').all()).results;assert.ok(unchanged.every(d=>d.revision===1&&!Object.hasOwn(JSON.parse(d.state_json),'schema')));assert.equal((await db.prepare('SELECT version_id,enabled FROM app_spaces WHERE project_id=?').bind(project).first()).version_id,v1);
 // A lost dispatch claim must not execute that row or retry it later.
 const uncertain=id();await start(uncertain);const lossyClaim=new Proxy(db,{get(t,k){if(k==='prepare')return sql=>{const stmt=t.prepare(sql);if(!sql.includes("SET state='running'"))return stmt;return {bind(...args){const bound=stmt.bind(...args);return {async run(){await bound.run();throw Error('Lost claim');}}}};};const v=t[k];return typeof v==='function'?v.bind(t):v;}});
 const beforeUnknown=calls;assert.equal((await migration.advanceMigrationCheck(lossyClaim,service,user,uncertain)).state,'uncertain');await migration.advanceMigrationCheck(db,service,user,uncertain);assert.equal(calls,beforeUnknown);
 // Invalid transformer output fails without touching the original document.
 const invalid=id();await start(invalid,badTransform);assert.equal((await migration.advanceMigrationCheck(db,service,user,invalid)).state,'failed');
 // Erasure during execution removes both recovery and staged copies and fences late results.
 const erased=id();await start(erased);let killed=false;const erasing={fetch:async(url,init)=>{if(!killed){killed=true;await db.prepare('DELETE FROM app_visitors WHERE id=?').bind(visitors[0]).run();}return service.fetch(url,init);}};
 assert.equal((await migration.advanceMigrationCheck(db,erasing,user,erased)).state,'changed');assert.equal((await db.prepare('SELECT count(*) n FROM app_migration_documents WHERE visitor_id=?').bind(visitors[0]).first()).n,0);assert.equal((await migration.readMigrationCheck(db,user,checkpoint)).state,'changed');
 // Removing the recovery point removes staged payloads and makes progress unavailable.
 const removed=id();await start(removed);await recovery.removeRecoveryPoint(db,user,project,removed,'REMOVE');assert.equal((await migration.advanceMigrationCheck(db,service,user,removed)).state,'changed');assert.equal((await db.prepare('SELECT count(*) n FROM app_migration_documents WHERE migration_id=?').bind(removed).first()).n,0);
 assert.equal((await db.prepare('SELECT count(*) n FROM inference_calls').first()).n,0);assert.equal((await db.prepare('SELECT enabled FROM app_spaces WHERE project_id=?').bind(project).first()).enabled,0);
 // A separate application exercises reviewed atomic code/data replacement.
 const up=id(),old=id(),target=id(),converter=id(),oldTest=id(),targetTest=id();
 await db.prepare("INSERT INTO projects(id,owner_user_id,name,purpose,status,created_at,updated_at) VALUES(?,?,'Upgrade','','draft',?,?)").bind(up,user,now(),now()).run();
 for(const [to,from]of [[old,v1],[target,v2],[converter,transform]]){const source=await db.prepare('SELECT source FROM backend_versions WHERE id=?').bind(from).first();await backend.saveBackend(db,user,up,to,source.source);}
 await backend.testBackend(db,service,user,up,old,oldTest,{state:{},input:{}});
 await backend.testBackend(db,service,user,up,target,targetTest,{state:{schema:2},input:{note:'synthetic'}},{expected:{state:{schema:2,note:'synthetic'},result:'saved'}});
 const opening=id();await activation.prepareApplication(db,user,up,opening,'enable',old,oldTest);await activation.confirmApplication(db,user,opening);
 const people=[id(),id()];for(const visitor of people){await db.prepare('INSERT INTO app_visitors(id,project_id) VALUES(?,?)').bind(visitor,up).run();await db.prepare('UPDATE app_documents SET revision=1,state_json=? WHERE visitor_id=?').bind(JSON.stringify({note:'upgrade-private-'+visitor}),visitor).run();}
 const closing=id();await activation.prepareApplication(db,user,up,closing,'disable',null,null);await activation.confirmApplication(db,user,closing);
 const upgrade=id();await migration.beginMigrationCheck(db,user,up,upgrade,target,converter,targetTest);
 await assert.rejects(approvals.confirmMigration(db,user,upgrade,'UPGRADE'),e=>e.status===409);
 await migration.advanceMigrationCheck(db,service,user,upgrade);const review=await approvals.readMigrationReview(db,user,upgrade);assert.equal(review.changedDocuments,2);assert.ok(!JSON.stringify(review).includes('upgrade-private-'));assert.equal(review.target.source,(await db.prepare('SELECT source FROM backend_versions WHERE id=?').bind(target).first()).source);
 const bypass=id();await activation.prepareApplication(db,user,up,bypass,'enable',target,targetTest);await assert.rejects(activation.confirmApplication(db,user,bypass),e=>e.status===409);
 await assert.rejects(approvals.confirmMigration(db,user,upgrade,'upgrade'),e=>e.status===400);await assert.rejects(approvals.confirmMigration(db,other,upgrade,'UPGRADE'),e=>e.status===404);
 const original=(await db.prepare('SELECT * FROM app_documents WHERE visitor_id IN (?,?) ORDER BY visitor_id').bind(...people).all()).results;
 // Force the program update to fail after document writes: every write must roll back.
 await db.exec(`CREATE TRIGGER upgrade_fixture_fail BEFORE UPDATE ON app_spaces WHEN NEW.project_id='${up}' BEGIN SELECT RAISE(ABORT,'fixture'); END;`);
 await assert.rejects(approvals.confirmMigration(db,user,upgrade,'UPGRADE'),e=>e.status===409);
 assert.deepEqual((await db.prepare('SELECT * FROM app_documents WHERE visitor_id IN (?,?) ORDER BY visitor_id').bind(...people).all()).results,original);
 assert.equal((await db.prepare('SELECT version_id FROM app_spaces WHERE project_id=?').bind(up).first()).version_id,old);assert.equal(await db.prepare('SELECT id FROM app_migration_approvals WHERE id=?').bind(upgrade).first(),null);await db.exec('DROP TRIGGER upgrade_fixture_fail');
 const lostApproval=new Proxy(db,{get(t,k){if(k==='prepare')return sql=>{const stmt=t.prepare(sql);if(!sql.startsWith('INSERT INTO app_migration_approvals'))return stmt;return {bind(...args){const bound=stmt.bind(...args);return {async run(){await bound.run();throw Error('Lost approval response');}}}};};const v=t[k];return typeof v==='function'?v.bind(t):v;}});
 const preApplyCalls=calls;assert.ok((await Promise.all([approvals.confirmMigration(lostApproval,user,upgrade,'UPGRADE'),approvals.confirmMigration(db,user,upgrade,'UPGRADE')])).every(r=>r.state==='applied'));assert.equal(calls,preApplyCalls,'Approval never executes guest code');
 const upgraded=await db.prepare('SELECT * FROM app_spaces WHERE project_id=?').bind(up).first();assert.equal(upgraded.version_id,target);assert.equal(upgraded.enabled,0);assert.equal(upgraded.revision,3);assert.equal(upgraded.migration_id,upgrade);
 for(const visitor of people){const document=await db.prepare('SELECT * FROM app_documents WHERE visitor_id=?').bind(visitor).first();assert.equal(document.revision,2);assert.equal(JSON.parse(document.state_json).schema,2);assert.equal(JSON.parse(document.state_json).note,'upgrade-private-'+visitor);const backup=await db.prepare('SELECT state_json FROM app_recovery_documents WHERE point_id=? AND visitor_id=?').bind(upgrade,visitor).first();assert.ok(!Object.hasOwn(JSON.parse(backup.state_json),'schema'));}
 await assert.rejects(db.prepare('UPDATE app_spaces SET version_id=?,revision=revision+1 WHERE project_id=?').bind(old,up).run());
 await assert.rejects(db.prepare('DELETE FROM app_migration_approvals WHERE id=?').bind(upgrade).run());
 // Reopening the newly reviewed program still needs the ordinary separate approval.
 const reopen=id();await activation.prepareApplication(db,user,up,reopen,'enable',target,targetTest);await activation.confirmApplication(db,user,reopen);assert.equal((await db.prepare('SELECT enabled FROM app_spaces WHERE project_id=?').bind(up).first()).enabled,1);
 await recovery.removeRecoveryPoint(db,user,up,upgrade,'REMOVE');const afterRemoval=await approvals.confirmMigration(db,user,upgrade,'UPGRADE');assert.equal(afterRemoval.state,'applied');assert.equal(afterRemoval.changedDocuments,2);assert.equal((await db.prepare('SELECT revision FROM app_documents WHERE visitor_id=?').bind(people[0]).first()).revision,2);
 assert.equal((await db.prepare('SELECT count(*) n FROM app_live_pages WHERE project_id=?').bind(up).first()).n,0);
 console.log('Atomic migration approval passed: exact source review, ready-only and typed confirmation, owner isolation, whole-transaction rollback, concurrent/lost-response retry, stable changed-count receipt, monotonic data/program revisions, retained pre-upgrade recovery, no runtime dispatch or automatic activation/publication, separate reactivation and no replay after point removal.');
 console.log('Migration checks passed with actual QuickJS: atomic recovery capture, successful target-test gate, owned aggregate reads, bounded claimed executions, concurrent/replay safety, lost capture and claim recovery, invalid-output refusal, unchanged live documents/program, erasure fencing, point-removal cleanup and zero inference.');
}finally{await runtime?.dispose();await proxy?.dispose();await rm(dir,{recursive:true,force:true});}
