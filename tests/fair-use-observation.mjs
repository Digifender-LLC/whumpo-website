import {paidPlan} from './helpers/paid-plan.mjs';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';

const bundle=await build({stdin:{contents:"export * from './src/fair-use-observation';export * from './src/fair-use-report';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {noteSourceExport,readFairUseObservation,cleanupFairUseObservations,fairUseReport}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const store=await databaseFixture({d1:true}),db=store.db;
try{
 const owner=crypto.randomUUID(),other=crypto.randomUUID(),created=new Date(Date.now()-60000).toISOString();
 for(const user of [owner,other])await db.prepare("INSERT INTO users(id,email,created_at) VALUES(?,?,?)").bind(user,user+'@example.test',created).run();
 const project=crypto.randomUUID(),version=crypto.randomUUID();
 await db.prepare("INSERT INTO projects(id,owner_user_id,name,created_at,updated_at) VALUES(?,?,'Test',?,?)").bind(project,owner,created,created).run();
 const lifecycle=()=>db.prepare('SELECT * FROM fair_use_project_lifecycle WHERE project_id=?').bind(project).first();
 assert.equal((await lifecycle()).ai_saved_at,null);
 await db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) VALUES(?,?,1,'private prompt','private answer',?,'ai','pending')").bind(version,owner,created).run();
 await db.prepare("INSERT INTO site_versions(id,project_id,component_id,config_json,html,digest,created_at) VALUES(?,?,'site-page@1','{}','<p>Test</p>','test',?)").bind(version,project,created).run();
 await noteSourceExport(db,owner,version);assert.equal((await lifecycle()).export_prepared_at,null);
 await db.prepare("UPDATE chat_turns SET status='completed' WHERE id=?").bind(version).run();assert.ok((await lifecycle()).ai_saved_at);
 await noteSourceExport(db,other,version);assert.equal((await lifecycle()).export_prepared_at,null);
 await noteSourceExport(db,owner,version);const exported=await lifecycle();assert.ok(exported.export_prepared_at);
 await noteSourceExport(db,owner,version);assert.deepEqual(await lifecycle(),exported);
 await assert.rejects(db.prepare("UPDATE fair_use_project_lifecycle SET export_prepared_at=NULL WHERE project_id=?").bind(project).run());
 await db.prepare("INSERT INTO version_removals(id,user_id,project_id,version_id,digest,component_id,version_created_at,expires_at) VALUES(?,?,?,?,'test','site-page@1',?,?)").bind(version,owner,project,version,created,new Date(Date.now()+60000).toISOString()).run();
 const confirmTurn=crypto.randomUUID();await db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status,action_json) VALUES(?,?,?,'Synthetic confirm','Synthetic confirm',datetime('now'),'guided','completed',?)").bind(confirmTurn,owner,100001,JSON.stringify({type:'confirm',kind:'version',reviewId:version})).run();await db.prepare("UPDATE version_removals SET status='applied',confirmed_by=? WHERE id=?").bind(confirmTurn,version).run();assert.equal((await lifecycle()).removed_at,null);
 let observed=await readFairUseObservation(db,owner,'starter');assert.equal(observed.metrics.completedAITurns7d,1);assert.equal(observed.metrics.observedExportRemovalCycles7d,0);assert.equal(observed.assessment.mode,'monitor');assert.equal(observed.metrics.verifiedStandardProviderMicros30d,null);
 await db.prepare('DELETE FROM projects WHERE id=?').bind(project).run();assert.ok((await lifecycle()).removed_at);
 observed=await readFairUseObservation(db,owner,'starter');assert.equal(observed.metrics.observedExportRemovalCycles7d,1);assert.deepEqual(observed.assessment.activeRestrictions,[]);
 assert.equal((await readFairUseObservation(db,other,'starter')).metrics.createdProjects7d,0);
 assert.ok(!JSON.stringify(observed).includes('private prompt'));
 await db.prepare("UPDATE fair_use_control SET requested_mode='enforce' WHERE id=1").run();observed=await readFairUseObservation(db,owner,'starter');assert.equal(observed.assessment.mode,'monitor');assert.equal(observed.assessment.modeDecision.reason,'verified_economics_required');
 await assert.rejects(db.prepare("UPDATE fair_use_control SET requested_mode='invalid' WHERE id=1").run());
 await db.prepare("INSERT INTO fair_use_project_lifecycle(project_id,user_id,created_at,removed_at) VALUES('old',?,?,?)").bind(owner,'2020-01-01T00:00:00.000Z','2020-01-02T00:00:00.000Z').run();
 await cleanupFairUseObservations(db);assert.equal(await db.prepare("SELECT project_id FROM fair_use_project_lifecycle WHERE project_id='old'").first(),null);assert.ok(await lifecycle());
 // Operator reporting reads current-period entitlement receipts without creating billing state.
 const readOnly={prepare(sql){assert.match(sql,/^(SELECT|WITH)\b/);return db.prepare(sql);}};
 let report=await fairUseReport(readOnly);assert.equal(report.totals.accounts,2);assert.equal(report.totals.unassessedAccounts,2);assert.equal(report.totals.completedAITurns7d,1);assert.equal(report.totals.observedExportRemovalCycles7d,1);assert.equal(report.mode.mode,'monitor');assert.equal(report.economics.profitMicros,null);
 for(const canary of [owner,other,'example.test','private prompt','private answer',project,version])assert.ok(!JSON.stringify(report).includes(canary));

 const period=new Date().toISOString().slice(0,7);
 await paidPlan(db,owner,'business-pro',{start:1577836800,end:1580515200});
 assert.equal((await fairUseReport(readOnly,owner)).byPlan.explore.accounts,1);
 await paidPlan(db,owner,'starter');
 await db.prepare("WITH RECURSIVE n(i) AS (SELECT 2 UNION ALL SELECT i+1 FROM n WHERE i<100) INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,created_at,mode,status) SELECT 'report-turn-'||i,?,i,'private prompt','private answer',?,'ai','completed' FROM n").bind(owner,created).run();
 report=await fairUseReport(readOnly,owner);assert.equal(report.totals.completedAITurns7d,100);assert.equal(report.byPlan.starter.accounts,1);assert.equal(report.totals.observationCandidates,1);assert.equal(report.totals.reviewCandidates,0);assert.equal(report.totals.createdProjects7d,1);assert.equal(report.accountAssessment.mode,'monitor');assert.deepEqual(report.activeRestrictions,[]);
 assert.equal((await fairUseReport(readOnly,other)).totals.completedAITurns7d,0);
 await assert.rejects(fairUseReport(readOnly,crypto.randomUUID()));await assert.rejects(fairUseReport(readOnly,"' OR 1=1"));
 await paidPlan(db,owner,'business');
 report=await fairUseReport(readOnly,owner);assert.equal(report.byPlan.business.accounts,1);assert.equal(report.totals.observationCandidates,0);
 await db.prepare('DELETE FROM users WHERE id=?').bind(owner).run();assert.equal(await lifecycle(),null);
 console.log('Operator report passed: read-only queries, no identity/content exposure, current-period highest entitlement, old receipts excluded, Explore not misclassified, aggregate counts not multiplied, owner scoping and missing financial data explicit.');
 console.log('Actual D1 fair-use observation passed: owner isolation, AI provenance, export deduplication, immutable timestamps, version deletion exclusion, ordered project cycle, retention, account erasure and Monitor pending verified economics.');
}finally{await store.close();}
