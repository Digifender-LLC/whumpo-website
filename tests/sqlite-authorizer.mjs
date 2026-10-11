import assert from 'node:assert/strict';
import {sqliteD1,authorizerProbe,unavailableAuthorizerProbe,authorizerLimitations} from './sqlite-d1.mjs';
import {databaseFixture} from './helpers/current-database.mjs';
import {DatabaseSync} from 'node:sqlite';

// WH-054 packet 1a: the report-only SQLite authorizer probe, and what it can and cannot show about tenant
// isolation. `--d1-fixture` additionally opens a real miniflare fixture (slow) to confirm it reports unavailable.
const seed=sql=>sql.exec(`
 INSERT INTO users(id,email,created_at) VALUES ('workspace-a','a@example.invalid','2026-10-01'),('workspace-b','b@example.invalid','2026-10-01');
 INSERT INTO projects(id,owner_user_id,name,created_at,updated_at) VALUES ('project-a','workspace-a','MARKER-PROJECT-A','2026-10-01','2026-10-01'),('project-b','workspace-b','MARKER-PROJECT-B','2026-10-01','2026-10-01');
 INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,mode,status,created_at) VALUES
  ('turn-a','workspace-a',1,'MARKER-CHAT-A','','ai','pending','2026-10-01'),('turn-b','workspace-b',1,'MARKER-CHAT-B','','ai','pending','2026-10-01');`);

// ---- 1. unused: nothing changes ----
const plain=await sqliteD1();
assert.deepEqual(Object.keys(plain).sort(),['close','db','sql'],'without probe the fixture shape is exactly sql, db, close');
seed(plain.sql);
const probed=await sqliteD1({probe:true});
assert.deepEqual(Object.keys(probed).sort(),['authorizer','close','db','sql']);
seed(probed.sql);
// Identical observable behavior through the adapter, including a batch that rolls back.
const exercise=async fixture=>{
 const out=[];
 out.push((await fixture.db.prepare('SELECT name FROM projects WHERE owner_user_id=? ORDER BY id').bind('workspace-a').all()).results);
 out.push(await fixture.db.prepare('SELECT count(*) AS n FROM chat_turns').first('n'));
 out.push((await fixture.db.prepare("UPDATE projects SET purpose='x' WHERE id=?").bind('project-a').run()).meta.changes);
 try{await fixture.db.batch([fixture.db.prepare("UPDATE projects SET purpose='y' WHERE id=?").bind('project-a'),fixture.db.prepare('INSERT INTO projects(id) VALUES(?)').bind('incomplete')]);out.push('no error');}catch(error){out.push(error.message);}
 out.push(await fixture.db.prepare('SELECT purpose FROM projects WHERE id=?').bind('project-a').first('purpose'));
 return out;
};
assert.deepEqual(await exercise(probed),await exercise(plain),'the probe changes no result, rollback or error');
plain.close();

// ---- 2. direct and trigger-origin actions are captured, tagged and scoped ----
const probe=probed.authorizer;
assert.equal(probe.available,true);
await probe.scope('delete-a-project',()=>probed.db.prepare('DELETE FROM projects WHERE id=?').bind('project-none').run());
const report=probe.report('delete-a-project');
assert.deepEqual(report.tables.projects.direct.delete,[],'a DELETE of the projects table is recorded as a direct table action');
assert.ok(report.tables.projects.direct.read.includes('id'));
// The same DELETE reads other tables only through triggers and views, and those are tagged with their name and kind.
const hold=report.tables.safety_preservation_holds;
assert.deepEqual(hold.direct,{},'the statement itself never names the holds table');
assert.deepEqual(hold.trigger.safety_hold_project_retained.read.sort(),['project_id','released_at','scope','subject_user_id']);
assert.ok(hold.view.safety_held_projects.read.includes('subject_user_id'),'view-origin access is tagged separately from trigger-origin access');
assert.ok(Object.keys(report.tables).length>100,'one DELETE reaches well over a hundred tables through triggers');
assert.equal(report.proof,'none: a report of references, not a proof of tenant isolation');
assert.equal(probe.references('safety_preservation_holds','subject_user_id','delete-a-project'),true);
assert.equal(probe.references('safety_preservation_holds','subject_user_id','no-such-scope'),false);
// Recording is per scope: nothing outside a scope is kept, and the innermost scope wins.
const outside=probed.db.prepare('SELECT count(*) AS n FROM users').first('n');await outside;
assert.equal(probe.report('delete-a-project').ignoredOutsideScope>0,true);
assert.equal(probe.actions().filter(a=>a.scope===null).length,0);
await probe.scope('outer',async()=>{
 await probed.db.prepare('SELECT name FROM projects WHERE id=?').bind('project-a').first();
 await probe.scope('inner',async()=>{await probed.db.prepare('SELECT email FROM users WHERE id=?').bind('workspace-a').first();});
 await probed.db.prepare('SELECT purpose FROM projects WHERE id=?').bind('project-a').first();
});
assert.deepEqual(probe.report('outer').tables.projects.direct.read.sort(),['id','name','purpose']);
assert.deepEqual(Object.keys(probe.report('outer').tables),['projects']);
assert.deepEqual(probe.report('inner').tables.users.direct.read.sort(),['email','id']);
await assert.rejects(probe.scope('throws',async()=>{throw Error('boom');}),/boom/);
assert.throws(()=>probe.scope('throws-sync',()=>{throw Error('sync boom');}),/sync boom/);
const after=probe.actions().length;
probed.sql.prepare('SELECT 1 FROM users');
assert.equal(probe.actions().length,after,'the scope was restored after both failures');
assert.throws(()=>authorizerProbe(probed.sql),/already installed/);

// ---- 3. what the probe cannot show: two workspaces with unique markers ----
const statements={
 scoped:{sql:'SELECT name FROM projects WHERE owner_user_id=?',params:['workspace-a']},
 tautology:{sql:'SELECT name FROM projects WHERE owner_user_id=owner_user_id',params:[]},
 wrongBinding:{sql:'SELECT name FROM projects WHERE owner_user_id=?',params:['workspace-b']},
 unscoped:{sql:'SELECT name FROM projects',params:[]},
};
const markers={};
for(const [name,{sql,params}] of Object.entries(statements)){
 markers[name]=await probe.scope('isolation-'+name,async()=>(await probed.db.prepare(sql).bind(...params).all()).results.map(r=>r.name));
}
const reads=name=>JSON.stringify(probe.report('isolation-'+name).tables.projects.direct);
// Value level (the only real proof): only the scoped statement keeps workspace B's marker out of workspace A's view.
assert.deepEqual(markers.scoped,['MARKER-PROJECT-A']);
assert.ok(markers.tautology.includes('MARKER-PROJECT-B'),'a tautology predicate leaks');
assert.deepEqual(markers.wrongBinding,['MARKER-PROJECT-B'],'right SQL, wrong bound value: leaks');
assert.ok(markers.unscoped.includes('MARKER-PROJECT-B'));
// Reference level (what the authorizer sees): the scoped, tautology and wrong-binding statements are indistinguishable.
assert.equal(reads('scoped'),reads('tautology'));assert.equal(reads('scoped'),reads('wrongBinding'));
assert.equal(probe.references('projects','owner_user_id','isolation-tautology'),true,'a reference to the tenant column is not proof of isolation');
// It does catch a statement that never mentions the tenant column at all, which is its useful signal.
assert.equal(probe.references('projects','owner_user_id','isolation-unscoped'),false);
assert.notEqual(reads('scoped'),reads('unscoped'));
// Triggers are visible to it but values are not: a chat row insert shows trigger-origin reads, never the marker.
await probe.scope('chat-insert',()=>probed.db.prepare("INSERT INTO chat_turns(id,user_id,revision,user_text,assistant_text,mode,status,created_at) VALUES('turn-a2','workspace-a',2,'MARKER-CHAT-A2','','ai','completed','2026-10-01')").run());
assert.ok(!JSON.stringify(probe.actions('chat-insert')).includes('MARKER'),'the authorizer never sees bound or literal values');
assert.ok(authorizerLimitations.some(l=>/does not see predicates or bound values/.test(l))&&authorizerLimitations.some(l=>/--d1/.test(l)));
// Restoring clears; it cannot restore an authorizer set by other code, and the limitations say so rather than claim it.
assert.ok(authorizerLimitations.some(l=>/cannot read an existing authorizer.*replaced and then cleared/.test(l)));

// ---- 4. cleanup per fixture: the hook is restored and a later fixture is unaffected ----
const sql=probed.sql;
probed.close();
assert.throws(()=>sql.prepare('SELECT 1'),/database is not open|not open/i);
const second=await sqliteD1({probe:true});
const count=second.authorizer.actions().length;
await second.authorizer.scope('x',()=>second.db.prepare('SELECT 1 FROM users').first());
assert.ok(second.authorizer.actions().length>count);
second.authorizer.restore();
const frozen=second.authorizer.actions().length;
await second.authorizer.scope('after-restore',()=>second.db.prepare('SELECT email FROM users').all());
assert.equal(second.authorizer.actions().length,frozen,'after restore the hook records nothing');
assert.doesNotThrow(()=>authorizerProbe(second.sql).restore(),'a restored database can be probed again');
second.close();
// A plain DatabaseSync that was never probed is untouched by the module.
const raw=new DatabaseSync(':memory:');raw.exec('CREATE TABLE t(a)');assert.doesNotThrow(()=>raw.prepare('SELECT a FROM t'));raw.close();

// ---- 5. D1 is unavailable, clearly ----
assert.equal(unavailableAuthorizerProbe.available,false);
assert.match(unavailableAuthorizerProbe.reason,/miniflare, --d1/);
assert.equal(unavailableAuthorizerProbe.scope('x',()=>42),42);
assert.deepEqual(unavailableAuthorizerProbe.report('x').tables,{});assert.equal(unavailableAuthorizerProbe.report().available,false);
// Reading actions fails loudly, so `references(...) === false` can never pass vacuously on an unprobed D1 fixture.
assert.throws(()=>unavailableAuthorizerProbe.references('projects','owner_user_id'),/exists only for the in-memory SQLite fixture/);
assert.throws(()=>unavailableAuthorizerProbe.actions(),/exists only for the in-memory SQLite fixture/);
assert.throws(()=>unavailableAuthorizerProbe.compile('SELECT 1'),/exists only for the in-memory SQLite fixture/);
if(process.argv.includes('--d1-fixture')){
 const fixture=await databaseFixture({d1:true,probe:true,allowedArguments:['--d1-fixture']});
 try{assert.equal(fixture.authorizer.available,false);assert.match(fixture.authorizer.reason,/--d1/);}finally{await fixture.close();}
}
console.log('SQLite authorizer probe verified: report-only, scoped, trigger-origin tagged, restored per fixture; D1 reported unavailable; marker fixture shows its limits.');
