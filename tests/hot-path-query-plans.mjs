import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {currentSchemaArtifact} from '../tools/current-schema.mjs';

// WH-051: the per-request D1 reads of the public site host (src/site-host.ts) must be answered from an index. The SQL is read out of the source so it cannot drift from this test;
// the plan comes from SQLite on the complete current schema (D1 is SQLite, but its planner statistics differ: this proves the access path, not production latency).
const source=readFileSync(new URL('../src/site-host.ts',import.meta.url),'utf8');
const hot=[
 ['custom-domain host mapping',/prepare\("(SELECT c\.project_id FROM domain_connections c JOIN projects p[^"]*)"\)/,['good-host',new Date().toISOString()]],
 ['native CMS article',/prepare\("(SELECT public_html,digest FROM cms_live_articles[^"]*)"\)/,['p','c','i'],'known'],
 ['published page',/prepare\(`(SELECT v\.id,v\.html,v\.component_id,EXISTS[^`]*)`\)/,['p']],
];
const db=new DatabaseSync(':memory:');db.exec((await currentSchemaArtifact()).sql);
let checked=0,knownCount=0;
// 'known': a recorded finding, not a pass. The cms_live_articles view scans a table inside its blocked_cms_publications co-routine on every article read. CMS work is owner-deferred, so it is
// left alone here; the test still asserts the scan exists so this entry must be deleted when the view is fixed.
for(const [name,pattern,binds,known] of hot){
 const match=source.match(pattern);assert.ok(match,`${name}: the query is no longer in src/site-host.ts; update this test with it`);
 const sql=match[1];assert.ok(!sql.includes('${'),`${name}: an interpolated query needs its own fixture`);
 const plan=db.prepare('EXPLAIN QUERY PLAN '+sql).all(...binds).map(r=>r.detail);
 // Any SCAN, including a scan of a whole index, reads every row (D1 bills rows read). Only a table-valued function (json_each over one row's own JSON, shown as VIRTUAL TABLE) is fine.
 const scans=plan.filter(d=>/^SCAN /.test(d)&&!/VIRTUAL TABLE/.test(d));
 if(known){assert.ok(scans.length>0,`${name} no longer scans: remove its 'known' mark`);knownCount++;continue;}
 assert.deepEqual(scans,[],`${name} reads a whole table: ${JSON.stringify(plan)}`);
 assert.ok(plan.some(d=>/SEARCH /.test(d)),`${name} has no indexed search: ${JSON.stringify(plan)}`);
 checked++;
}
// The same assertion catches a regression: a lookup on an unindexed column is a scan.
const bad=db.prepare('EXPLAIN QUERY PLAN SELECT project_id FROM domain_connections WHERE provider_id=?').all('x').map(r=>r.detail);
assert.ok(bad.some(d=>/^SCAN /.test(d)),'the scan detector sees a full scan: '+JSON.stringify(bad));
console.log(`Hot-path query plans passed (${checked} per-request site-host reads on the complete current schema: every one an indexed search with no scan except the recorded CMS article view finding; the detector fires on an unindexed lookup); SQLite plan only, not D1 latency.`);
