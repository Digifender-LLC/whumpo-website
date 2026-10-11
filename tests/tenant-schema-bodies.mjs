import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {currentSchema,currentSchemaArtifact} from '../tools/current-schema.mjs';
import {parseObject,tokenize,Analyzer,UnsupportedSQL} from '../tools/sql-structure.mjs';
import {validateBodies,schemaObjects,validatorLimitations} from '../tools/schema-body-validator.mjs';

// WH-054 packet 1a: the trigger/view reparse validator and the cross-type lint. Every database here is a
// disposable in-memory copy; the validator itself only prepares statements and never executes one.
const schema=await currentSchema();
const database=extra=>{const db=new DatabaseSync(':memory:');db.exec(schema+'\n'+(extra??''));return db;};
const problems=(extra,options)=>{const db=database(extra);try{return validateBodies(db,options);}finally{db.close();}};
const mention=(result,pattern)=>assert.ok(result.problems.some(p=>pattern.test(p)),`expected ${pattern} in:\n${result.problems.join('\n')}`);
const clean=problems('',{overlay:new Map()}); // the current schema before any canary is added

// ---- 1. the premise: SQLite accepts these bodies, so the existing artifact check cannot see them ----
const canaries=`
CREATE TRIGGER canary_stale_column BEFORE INSERT ON projects BEGIN SELECT RAISE(ABORT,'x') WHERE NEW.owner_user_idx IS NULL; END;
CREATE TRIGGER canary_stale_alias AFTER DELETE ON projects BEGIN DELETE FROM activity_events WHERE EXISTS(SELECT 1 FROM projects p WHERE p.nope=OLD.id); END;
CREATE TRIGGER canary_update_of_missing AFTER UPDATE OF no_such_column, name ON projects BEGIN SELECT RAISE(ABORT,'x') WHERE NEW.also_missing=1; END;
CREATE TRIGGER canary_update_of_inert AFTER UPDATE OF no_such_column ON projects BEGIN SELECT 1; END;
CREATE VIEW canary_stale_view AS SELECT p.nosuchcolumn FROM projects p;
CREATE VIEW canary_view_on_view AS SELECT * FROM canary_stale_view;`;
{
 const db=database();
 db.exec(canaries); // would throw if SQLite rejected a stale body at creation time
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[],'the artifact check (execute + foreign_key_check) is green');
 // The nuance: UPDATE OF a nonexistent column is silently inert. Preparing the update that would fire the trigger succeeds.
 assert.doesNotThrow(()=>db.prepare('UPDATE projects SET purpose=purpose'));
 assert.throws(()=>db.prepare('UPDATE projects SET name=name'),/no such column: NEW\.also_missing/);
 assert.throws(()=>db.prepare('INSERT INTO projects DEFAULT VALUES'),/no such column: NEW\.owner_user_idx/);
 assert.throws(()=>db.prepare('DELETE FROM projects'),/no such column: p\.nope/);
 assert.throws(()=>db.prepare('SELECT * FROM canary_view_on_view'),/no such column: p\.nosuchcolumn/);
 db.close();
}
{
 const result=problems(canaries,{overlay:new Map()});
 mention(result,/trigger canary_stale_column no longer compiles: no such column: NEW\.owner_user_idx/);
 mention(result,/trigger canary_stale_alias no longer compiles: no such column: p\.nope/);
 mention(result,/trigger canary_update_of_missing no longer compiles: no such column: NEW\.also_missing/);
 mention(result,/trigger canary_update_of_missing is UPDATE OF no_such_column, which projects does not have/);
 mention(result,/trigger canary_update_of_inert is UPDATE OF no_such_column/);
 mention(result,/view canary_stale_view no longer compiles: no such column: p\.nosuchcolumn/);
 // The dependent view is attributed to the view that is actually broken.
 const dependent=result.reparse.views.failed.find(f=>f.name==='canary_view_on_view');
 assert.deepEqual(dependent.brokenDependencies,['canary_stale_view']);
 assert.equal(result.ok,false);
 // Coverage is reported, not implied: the unaffected objects still verified.
 const t=result.coverage.triggers,v=result.coverage.views;
 assert.equal(t.total,clean.coverage.triggers.total+4);assert.equal(v.total,clean.coverage.views.total+2);
 // canary_update_of_inert has a valid body once the missing OF column is dropped, so it compiles but is still reported.
 assert.deepEqual([t.verified,t.failed,t.updateOfMissing],[clean.coverage.triggers.verified+1,3,2]);
 assert.deepEqual([v.verified,v.failed],[clean.coverage.views.verified,2]);
}

// ---- 2. the current schema is clean on the reparse and unsupported checks ----
{
 const result=clean;
 assert.deepEqual(result.reparse.triggers.failed,[]);assert.deepEqual(result.reparse.triggers.updateOfMissing,[]);assert.deepEqual(result.reparse.triggers.unsupported,[]);
 assert.deepEqual(result.reparse.views.failed,[]);assert.deepEqual(result.lint.unsupported,[]);
 assert.equal(result.coverage.triggers.verified,result.coverage.triggers.total);assert.ok(result.coverage.triggers.total>=640&&result.coverage.views.total>=27);
 assert.equal(result.coverage.lint.triggersAnalyzed,result.coverage.triggers.total);assert.equal(result.coverage.lint.viewsAnalyzed,result.coverage.views.total);assert.equal(result.coverage.lint.unresolvedOperands,0);
 assert.ok(result.coverage.triggers.statementsPrepared>=result.coverage.triggers.total);
 assert.ok(result.limitations.length>=5&&result.limitations===validatorLimitations);
}

// ---- 3. no production writes: only prepares, on a disposable copy ----
{
 const db=database();
 db.exec("INSERT INTO users(id,email,created_at) VALUES('u1','u1@example.invalid','2026-10-01'); INSERT INTO projects(id,owner_user_id,name,created_at,updated_at) VALUES('p1','u1','KEEP','2026-10-01','2026-10-01');");
 db.exec("CREATE TABLE canary_audit(note TEXT); CREATE TRIGGER canary_writes AFTER DELETE ON projects BEGIN INSERT INTO canary_audit VALUES('fired'); END;");
 const digest=()=>createHash('sha256').update(JSON.stringify(db.prepare("SELECT type,name,sql FROM sqlite_master ORDER BY name").all())+JSON.stringify(db.prepare('SELECT * FROM projects').all())+JSON.stringify(db.prepare('SELECT * FROM canary_audit').all())).digest('hex');
 const before=digest();
 const result=validateBodies(db,{overlay:new Map()});
 assert.equal(digest(),before,'the validated database is untouched');
 assert.equal(db.prepare('SELECT count(*) AS n FROM canary_audit').get().n,0,'no trigger body was executed');
 assert.equal(db.prepare('SELECT count(*) AS n FROM projects').get().n,1);
 assert.equal(result.reparse.triggers.failed.length,0);
 db.close();
}

// ---- 4. cross-type lint on structural types (a synthetic C2-style schema; no overlay, types come from the foreign-key graph) ----
const typed=`
CREATE TABLE users(id TEXT PRIMARY KEY, email TEXT);
CREATE TABLE workspaces(id TEXT PRIMARY KEY);
CREATE TABLE projects(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), name TEXT);
CREATE TABLE reviews(id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), project_id TEXT REFERENCES projects(id), user_id TEXT REFERENCES users(id), note TEXT);
CREATE TABLE holds(id TEXT PRIMARY KEY, subject TEXT, user_id TEXT REFERENCES users(id));`;
const lint=(triggers)=>{const db=new DatabaseSync(':memory:');db.exec(typed+'\n'+triggers);try{return validateBodies(db,{overlay:new Map()});}finally{db.close();}};
{
 const clean=lint(`
 CREATE TRIGGER same_workspace BEFORE INSERT ON reviews BEGIN SELECT RAISE(ABORT,'x') WHERE NOT EXISTS(SELECT 1 FROM projects p WHERE p.id=NEW.project_id AND p.workspace_id=NEW.workspace_id); END;
 CREATE TRIGGER same_account BEFORE UPDATE ON holds BEGIN SELECT RAISE(ABORT,'x') WHERE NOT EXISTS(SELECT 1 FROM users u WHERE u.id=NEW.user_id); END;
 CREATE TRIGGER untyped_text BEFORE DELETE ON holds BEGIN SELECT RAISE(ABORT,'x') WHERE OLD.subject=(SELECT name FROM projects LIMIT 1); END;`);
 assert.deepEqual(clean.lint.findings,[]);assert.equal(clean.ok,true,clean.problems.join('\n'));
 assert.ok(clean.lint.comparisons>=4);
}
{
 const flagged=lint(`
 CREATE TRIGGER direct_cross BEFORE INSERT ON reviews BEGIN SELECT RAISE(ABORT,'x') WHERE EXISTS(SELECT 1 FROM users WHERE id=NEW.workspace_id); END;
 CREATE TRIGGER aliased_join BEFORE DELETE ON reviews BEGIN SELECT RAISE(ABORT,'x') WHERE EXISTS(SELECT 1 FROM projects p JOIN users u ON u.id=p.workspace_id WHERE p.id=OLD.project_id); END;
 CREATE TRIGGER in_subquery BEFORE UPDATE ON reviews BEGIN SELECT RAISE(ABORT,'x') WHERE NEW.workspace_id IN (SELECT x.id FROM users x); END;
 CREATE TRIGGER nested_correlated BEFORE INSERT ON holds BEGIN SELECT RAISE(ABORT,'x') WHERE EXISTS(SELECT 1 FROM reviews r WHERE EXISTS(SELECT 1 FROM projects q WHERE q.workspace_id=NEW.user_id AND q.id=r.project_id)); END;
 CREATE TRIGGER coalesce_cross BEFORE INSERT ON reviews BEGIN SELECT RAISE(ABORT,'x') WHERE coalesce(NEW.user_id,NEW.user_id)=NEW.workspace_id; END;
 CREATE VIEW cross_view AS SELECT r.id FROM reviews r JOIN users u ON u.id=r.workspace_id;
 CREATE VIEW via_derived AS SELECT d.rid FROM (SELECT r.id AS rid, r.user_id AS uid FROM reviews r) d JOIN projects p ON p.workspace_id=d.uid;
 CREATE TRIGGER through_view BEFORE INSERT ON holds BEGIN SELECT RAISE(ABORT,'x') WHERE EXISTS(SELECT 1 FROM via_derived v JOIN workspaces w ON w.id=NEW.user_id); END;`);
 const objects=new Map(flagged.lint.findings.map(f=>[f.object,f]));
 for(const name of ['direct_cross','aliased_join','in_subquery','nested_correlated','coalesce_cross','cross_view','via_derived','through_view'])assert.ok(objects.has(name),`${name} not flagged: ${flagged.lint.findings.map(f=>f.object)}`);
 assert.equal(objects.get('direct_cross').comparison,'users.id = reviews.workspace_id');
 assert.equal(objects.get('aliased_join').comparison,'users.id = projects.workspace_id');
 assert.equal(objects.get('via_derived').comparison,'projects.workspace_id = reviews.user_id');
 assert.equal(objects.get('through_view').comparison,'workspaces.id = holds.user_id');
 mention(flagged,/trigger direct_cross compares users\.id = reviews\.workspace_id \(account\/workspace\); fingerprint [0-9a-f]{16} is not in the baseline/);
 // Stable fingerprints: formatting, aliasing and statement order do not move them; changing the comparison does.
 const rewritten=lint(`
 CREATE TRIGGER direct_cross BEFORE INSERT ON reviews
 BEGIN
   SELECT RAISE(ABORT,'different message') WHERE EXISTS(SELECT 1 FROM users AS person WHERE person.id = NEW.workspace_id);
 END;`);
 assert.equal(rewritten.lint.findings.length,1);assert.equal(rewritten.lint.findings[0].fingerprint,objects.get('direct_cross').fingerprint);
 const changed=lint(`CREATE TRIGGER direct_cross BEFORE INSERT ON reviews BEGIN SELECT RAISE(ABORT,'x') WHERE EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND id<>NEW.workspace_id); END;`);
 assert.notEqual(changed.lint.findings[0].fingerprint,objects.get('direct_cross').fingerprint);
 // Accepted exactly by fingerprint; the same finding in another trigger is still new, and a vanished one is a stale exception.
 const accepted={crossTypeFindings:[objects.get('direct_cross')]};
 const db=new DatabaseSync(':memory:');db.exec(typed+`\nCREATE TRIGGER direct_cross BEFORE INSERT ON reviews BEGIN SELECT RAISE(ABORT,'x') WHERE EXISTS(SELECT 1 FROM users WHERE id=NEW.workspace_id); END;`);
 const ok=validateBodies(db,{overlay:new Map(),baseline:accepted});assert.equal(ok.ok,true,ok.problems.join('\n'));assert.deepEqual(ok.findings,{total:1,baselined:1,new:0,stale:0});
 db.exec(`CREATE TRIGGER second_cross BEFORE DELETE ON reviews BEGIN SELECT RAISE(ABORT,'x') WHERE EXISTS(SELECT 1 FROM users WHERE id=OLD.workspace_id); END; DROP TRIGGER direct_cross;`);
 const drift=validateBodies(db,{overlay:new Map(),baseline:accepted});
 mention(drift,/trigger second_cross compares users\.id = reviews\.workspace_id/);mention(drift,/baseline exception [0-9a-f]{16} no longer matches any finding/);
 db.close();
}
{
 // What the lint does not claim: function results, CASE and CAST are untyped, so they are counted but never reported.
 const result=lint(`
 CREATE TRIGGER via_function BEFORE INSERT ON reviews BEGIN SELECT RAISE(ABORT,'x') WHERE lower(NEW.workspace_id)=(SELECT id FROM users LIMIT 1); END;
 CREATE TRIGGER via_cast BEFORE INSERT ON reviews BEGIN SELECT RAISE(ABORT,'x') WHERE CAST(NEW.workspace_id AS TEXT)=(SELECT id FROM users LIMIT 1); END;`);
 assert.deepEqual(result.lint.findings,[]);
 assert.ok(result.coverage.lint.byTypePair['account/untyped']>=2,JSON.stringify(result.coverage.lint.byTypePair));
 assert.ok(validatorLimitations.some(l=>/CASE branches, CAST results/.test(l)));
 assert.ok(validatorLimitations.some(l=>/not proof|not a proof|proves a body resolves/.test(l)));
}

{
 // Review regressions. A view's own comparison belongs to the view, never to an object that only reads it (it used to
 // be recorded again in whichever object first read the view, so findings depended on object order).
 const reader=lint(`
 CREATE VIEW leaky AS SELECT r.id FROM reviews r JOIN users u ON u.id=r.workspace_id;
 CREATE TRIGGER reads_leaky BEFORE INSERT ON holds BEGIN SELECT RAISE(ABORT,'x') WHERE EXISTS(SELECT 1 FROM leaky WHERE id=NEW.id); END;`);
 assert.deepEqual(reader.lint.findings.map(f=>f.object),['leaky']);
 const alone=lint(`CREATE VIEW leaky AS SELECT r.id FROM reviews r JOIN users u ON u.id=r.workspace_id;`);
 assert.equal(alone.lint.findings[0].fingerprint,reader.lint.findings[0].fingerprint);
 assert.equal(reader.coverage.lint.comparisons,alone.coverage.lint.comparisons+1);
 // An operand that can carry an account (a UNION view column, COALESCE with an untyped value) is still cross-type
 // against a workspace column; row values compare element by element.
 const mixed=lint(`
 CREATE VIEW either AS SELECT user_id AS k FROM holds UNION ALL SELECT id FROM projects;
 CREATE TRIGGER union_cross BEFORE INSERT ON reviews BEGIN SELECT RAISE(ABORT,'x') WHERE EXISTS(SELECT 1 FROM either WHERE k=NEW.workspace_id); END;
 CREATE TRIGGER coalesce_untyped BEFORE INSERT ON reviews BEGIN SELECT RAISE(ABORT,'x') WHERE coalesce(NEW.user_id,NEW.note)=NEW.workspace_id; END;
 CREATE TRIGGER row_value BEFORE INSERT ON reviews BEGIN SELECT RAISE(ABORT,'x') WHERE (NEW.id,NEW.user_id)=(NEW.id,NEW.workspace_id); END;
 CREATE TRIGGER row_in BEFORE INSERT ON reviews BEGIN SELECT RAISE(ABORT,'x') WHERE (NEW.project_id,NEW.user_id) IN (SELECT id,workspace_id FROM projects); END;`);
 const flagged=new Map(mixed.lint.findings.map(f=>[f.object,f]));
 for(const name of ['union_cross','coalesce_untyped','row_value','row_in'])assert.ok(flagged.has(name),`${name} not flagged: ${mixed.lint.findings.map(f=>f.comparison)}`);
 assert.equal(flagged.get('union_cross').types,'mixed/workspace');assert.equal(flagged.get('row_in').comparison,'reviews.user_id IN projects.workspace_id');
 assert.equal(mixed.lint.findings.filter(f=>f.object==='row_value').length,1,'the same-typed element pair is not a finding');
 // Row values or IN operands the resolver cannot pair fail closed instead of producing no comparison.
 const unpaired=lint(`
 CREATE TRIGGER in_table BEFORE INSERT ON reviews BEGIN SELECT RAISE(ABORT,'x') WHERE NEW.workspace_id IN users; END;
 CREATE TRIGGER row_vs_scalar BEFORE INSERT ON reviews BEGIN SELECT RAISE(ABORT,'x') WHERE (NEW.id,NEW.user_id) IN (SELECT id FROM users); END;`);
 mention(unpaired,/trigger in_table uses unsupported SQL: IN users/);mention(unpaired,/trigger row_vs_scalar uses unsupported SQL: IN \(SELECT \.\.\.\) whose row width/);
 assert.equal(unpaired.coverage.lint.triggersAnalyzed,0);
}

// ---- 5. unsupported SQL is reported, never skipped ----
{
 const unsupported=lint(`
 CREATE TRIGGER uses_with AFTER INSERT ON reviews BEGIN INSERT INTO holds(id) WITH t AS (SELECT 1) SELECT 'x'; END;
 CREATE TRIGGER uses_window AFTER INSERT ON reviews BEGIN SELECT row_number() OVER (ORDER BY id) FROM reviews; END;`);
 mention(unsupported,/trigger uses_with uses unsupported SQL: WITH clauses are not supported/);
 mention(unsupported,/trigger uses_window uses unsupported SQL: Window and FILTER clauses are not supported/);
 assert.equal(unsupported.coverage.lint.unsupported,2);
 assert.equal(unsupported.coverage.lint.triggersAnalyzed,0);
 assert.equal(unsupported.coverage.triggers.verified,2,'the reparse still compiled both bodies; only the lint is unsupported');
 assert.equal(unsupported.ok,false);
 assert.throws(()=>parseObject('CREATE TRIGGER t AFTER INSERT ON reviews BEGIN VACUUM; END'),UnsupportedSQL);
 assert.throws(()=>tokenize("SELECT 'unterminated"),UnsupportedSQL);
}

// ---- 6. the parser reads the constructs the current schema uses ----
{
 const parse=sql=>parseObject(sql);
 const view=parse("CREATE VIEW v AS SELECT a.x AS y, count(*) c, CASE WHEN a.z BETWEEN 1 AND 2 THEN 'a' ELSE 'b' END k FROM t a LEFT JOIN u ON u.id=a.uid AND u.n NOT IN ('p','q') WHERE a.x IS NOT NULL AND NOT EXISTS(SELECT 1 FROM w WHERE w.id=a.x) UNION ALL SELECT 1,2,3 ORDER BY 1 LIMIT 5 OFFSET 1");
 assert.equal(view.kind,'view');assert.equal(view.select.parts.length,2);assert.equal(view.select.parts[1].op,'UNION ALL');
 const trigger=parse("CREATE TRIGGER tr BEFORE UPDATE OF a,b ON t WHEN NEW.a<>OLD.a BEGIN INSERT OR IGNORE INTO l(a) VALUES(NEW.a) ON CONFLICT(a) DO UPDATE SET a=excluded.a WHERE l.a<>excluded.a; DELETE FROM l WHERE a IN (SELECT value FROM json_each(NEW.b)); SELECT RAISE(ABORT,'no'); END");
 assert.deepEqual([trigger.timing,trigger.event,trigger.ofColumns,trigger.table],['BEFORE','UPDATE',['a','b'],'t']);assert.equal(trigger.body.length,3);
 // SQLite binds || above * and NOT below comparison; the tree has to agree for typed operands to pair correctly.
 const t2=parse("CREATE TRIGGER tr AFTER INSERT ON t BEGIN SELECT 1 WHERE NOT NEW.a = NEW.b OR NEW.a || 'x' = NEW.b || 'y' AND NEW.c BETWEEN 1 AND 2; END");
 const analyzer=new Analyzer({tables:new Map([['t',['a','b','c']]]),views:new Map(),typeOf:()=>undefined});
 const analysis=analyzer.analyzeTrigger(t2);
 assert.deepEqual(analysis.comparisons.map(c=>c.op),['=','=','BETWEEN','BETWEEN']);
 assert.deepEqual(analysis.comparisons[0].left.refs,[{table:'t',column:'a'}]);assert.equal(analysis.comparisons[1].left.type,'untyped');
}

// ---- 7. the existing artifact check really is blind to these bodies ----
{
 const artifact=await currentSchemaArtifact();
 const db=new DatabaseSync(':memory:');db.exec(artifact.sql+'\n'+canaries);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 assert.ok(schemaObjects(db).some(o=>o.name==='canary_stale_column'));
 db.close();
}
console.log('Trigger/view validator verified: stale-body, UPDATE OF, alias, view and cross-type canaries fire; unsupported SQL is reported; nothing is written.');
