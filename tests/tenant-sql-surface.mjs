import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {extractSurface,checkAllowlist,loadBaseline,surfaceReport,isDynamic,isTableInterpolation,surfaceLimitations,tenantHelpers} from '../tools/tenant-sql-surface.mjs';

// WH-054 packet 1a: the AST report of the SQL surface and its dynamic allowlist. Negative controls replace the
// source text of a path in memory (the compiler parses a temporary copy); no repository file is touched.
const baseline=loadBaseline();
const read=path=>readFileSync(path,'utf8');
const clean=extractSurface();
const dynamic=clean.sites.filter(isDynamic);

// ---- the committed allowlist matches the current source exactly ----
assert.deepEqual(checkAllowlist(clean,baseline),[]);
assert.equal(baseline.allowlist.length,dynamic.length);
assert.ok(dynamic.length>0&&dynamic.filter(isTableInterpolation).length>0);
for(const entry of baseline.allowlist){assert.ok(entry.reason.length>=20&&entry.file.startsWith('src/')&&['table-interpolation','non-literal'].includes(entry.kind),entry.fingerprint);}
assert.equal(new Set(dynamic.map(s=>s.fingerprint)).size,dynamic.length,'fingerprints are unique');
assert.ok(!JSON.stringify(baseline.allowlist).includes('"line"'),'identities do not depend on line numbers');

// ---- syntax-tree facts, not text matches ----
const kinds=new Set(clean.sites.map(s=>s.kind));
for(const kind of ['literal','static-template','interpolated-template','concatenation','non-literal'])assert.ok(kinds.has(kind),kind);
// A table name interpolated by a template nested inside another template's interpolation is found (connection-rotation.ts).
assert.ok(clean.sites.some(s=>s.file==='src/connection-rotation.ts'&&isTableInterpolation(s)&&/stores\.map/.test(s.argument)&&/NOT EXISTS/.test(s.argument)));
// Template parts that merely look like interpolation are not table names (a `?` placeholder list, a predicate fragment).
assert.ok(clean.sites.some(s=>s.kind==='interpolated-template'&&!isTableInterpolation(s)));
for(const helper of tenantHelpers)assert.ok(clean.helperCalls[helper].definedIn.length>=1,`${helper} is defined in src`);
assert.deepEqual(clean.helperCalls.assertWorkspace.definedIn,['src/workspace-identity/admission.ts']);
assert.ok(clean.helperCalls.assertWorkspace.calls>0&&clean.helperCalls.assertFeature.calls>0&&clean.helperCalls.featurePredicate.calls>0&&clean.helperCalls.requireFeature.calls>0&&clean.helperCalls.connectionInclusion.calls>0);

// ---- negative controls ----
const append=(path,code)=>({[path]:read(path)+'\n'+code+'\n'});
const mutated=extractSurface({overrides:{
 ...append('src/support.ts','export async function probeTableInterpolation(db:D1Database,table:string){return db.prepare(`SELECT 1 FROM ${table} WHERE id=?`).bind("x").first();}'),
 ...append('src/site-health.ts','export function probeNonLiteral(db:D1Database,statement:string){return db.prepare(statement);}'),
 ...append('src/site-safety.ts','export function probeNested(db:D1Database,tables:string[]){return db.prepare(`SELECT 1 WHERE ${tables.map(t=>`EXISTS(SELECT 1 FROM ${t})`).join(" AND ")}`);}'),
 // A reviewed statement edited in place: its identity changes, so the old entry is stale and the new text needs review.
 'src/cms-media-uploads.ts':read('src/cms-media-uploads.ts').replace("uploadSQL+' WHERE u.id=?'","uploadSQL+' WHERE u.id=? OR 1=1'"),
 // A reviewed dynamic statement replaced by a literal: its allowlist entry is stale.
 'src/domain-recovery.ts':read('src/domain-recovery.ts').replace("'SELECT '+fields+' FROM domain_connections WHERE id=?'","'SELECT id FROM domain_connections WHERE id=?'"),
}});
const drift=checkAllowlist(mutated,baseline);
const mention=pattern=>assert.ok(drift.some(p=>pattern.test(p)),`expected ${pattern} in:\n${drift.join('\n')}`);
mention(/New table-interpolation SQL site in src\/support\.ts \(probeTableInterpolation\)/);
mention(/New non-literal SQL site in src\/site-health\.ts \(probeNonLiteral\)/);
mention(/New table-interpolation SQL site in src\/site-safety\.ts \(probeNested\)/);
mention(/New non-literal SQL site in src\/cms-media-uploads\.ts \(uploadCMSMedia\.read\)/);
mention(/Stale allowlist entry [0-9a-f]{16} \(src\/cms-media-uploads\.ts uploadCMSMedia\.read\)/);
mention(/Stale allowlist entry [0-9a-f]{16} \(src\/domain-recovery\.ts connection\)/);
assert.equal(drift.length,6,drift.join('\n'));
assert.equal(mutated.sites.length,clean.sites.length+3);
// An entry whose kind no longer matches, and an entry without a reviewed reason, are both rejected.
const wrongKind=structuredClone(baseline);wrongKind.allowlist.find(a=>a.kind==='non-literal').kind='table-interpolation';
assert.ok(checkAllowlist(clean,wrongKind).some(p=>/is table-interpolation, the site is now a non-literal/.test(p)));
const noReason=structuredClone(baseline);noReason.allowlist[0].reason='';
assert.ok(checkAllowlist(clean,noReason).some(p=>/needs a file, kind and a reviewed reason/.test(p)));
const duplicated=structuredClone(baseline);duplicated.allowlist.push(duplicated.allowlist[0]);
assert.ok(checkAllowlist(clean,duplicated).some(p=>/duplicate fingerprint/.test(p)));

// ---- the tree, not the text: comments, strings and line moves create or hide nothing ----
const decoy=extractSurface({overrides:{
 'src/support.ts':'// db.prepare(`SELECT 1 FROM ${table}`) and assertWorkspace(db,user) in a comment\nconst decoy="x.prepare(`DELETE FROM ${table}`); assertFeature(a,b)";\n\n\n'+read('src/support.ts').replace(/^/,'\n\n\n'),
 'src/site-health.ts':'/* db.prepare(statement) */\n\n'+read('src/site-health.ts'),
}});
assert.equal(decoy.sites.length,clean.sites.length);
assert.deepEqual(checkAllowlist(decoy,baseline),[],'moved lines keep every fingerprint');
assert.deepEqual(Object.fromEntries(Object.entries(decoy.helperCalls).map(([k,v])=>[k,v.calls])),Object.fromEntries(Object.entries(clean.helperCalls).map(([k,v])=>[k,v.calls])),'helper names in comments and strings are not calls');

// ---- the report ----
const tenantTables=['projects','chat_turns','gateway_spend_buckets'];
const report=surfaceReport(clean,{baseline,tenantTables});
assert.equal(report.scope.prepareCalls,clean.sites.length);
assert.equal(Object.values(report.byKind).reduce((a,b)=>a+b,0),report.scope.prepareCalls);
assert.equal(report.tableInterpolations+report.nonLiteral,dynamic.length);
assert.ok(report.documented.note.includes('syntax tree can differ'));
assert.equal(report.helpers.assertWorkspace.calls,clean.helperCalls.assertWorkspace.calls);
assert.ok(report.helpers.assertWorkspace.outsideDefiningFile.calls<report.helpers.assertWorkspace.calls);
assert.ok(report.workers.every(w=>w.main.startsWith('src/')));
assert.ok(report.workers.find(w=>w.worker==='whumpo-platform').reachableSqlSites>0);
assert.deepEqual(report.workers.find(w=>w.worker==='whumpo-runtime').reachableSqlSites,0,'the QuickJS runtime worker reaches no control-database SQL');
assert.ok(report.sitesNamingATenantTable>0);
assert.ok(report.limitations===surfaceLimitations&&surfaceLimitations.some(l=>/Nothing here proves/.test(l))&&surfaceLimitations.some(l=>/Trigger-side writes/.test(l)));

// ---- the command line ----
const cli=args=>spawnSync(process.execPath,['tools/tenant-sql-surface.mjs',...args],{encoding:'utf8'});
const check=cli([]);assert.equal(check.status,0,check.stderr);assert.match(check.stdout,/prepare calls, \d+ dynamic sites, allowlist \d+ entries/);
const full=cli(['report','--json']);assert.equal(full.status,0,full.stderr);assert.deepEqual(JSON.parse(full.stdout).problems,[]);
assert.equal(cli(['bogus']).status,1);
console.log('SQL surface verified: dynamic allowlist matches; new, edited and removed dynamic sites fail; comments and line moves do not.');
