// WH-004 finding B4 regression (offline, static). Operator tools that write the control database must target the
// database bound in wrangler.jsonc, as every other remote tool does via d1_databases. tools/reconcile-domain-hosting.mjs
// used to hard-code a retired database; it now reads the account and database from wrangler.jsonc. This reads the tool
// source and the config only; it never runs the tool or contacts Cloudflare. Not part of any verify profile.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
const tool=readFileSync('tools/reconcile-domain-hosting.mjs','utf8');
assert.deepEqual([...tool.matchAll(/\/accounts\/[0-9a-f]{32}\/d1\/database\/[0-9a-f-]{36}\//g)].map(m=>m[0]),[],
 'tools/reconcile-domain-hosting.mjs hard-codes a D1 endpoint; read the bound control database from wrangler.jsonc instead');
assert.ok(tool.includes("readFile('wrangler.jsonc','utf8')")&&tool.includes("d.binding==='DB'")&&tool.includes('bound.account_id'),'The tool must read the account and the DB binding from wrangler.jsonc');
assert.ok(tool.includes('/accounts/${account}/d1/database/${database}/query'),'The query endpoint must be built from the configured account and database');
assert.ok(config.d1_databases.some(d=>d.binding==='DB'&&/^[0-9a-f-]{36}$/.test(d.database_id))&&/^[0-9a-f]{32}$/.test(config.account_id),'wrangler.jsonc must bind the control database as DB');
// No other remote operator tool may pin a database either.
import {readdirSync} from 'node:fs';
const pinned=readdirSync('tools').filter(f=>f.endsWith('.mjs')&&/\/d1\/database\/[0-9a-f-]{36}\//.test(readFileSync('tools/'+f,'utf8')));
assert.deepEqual(pinned,[],'These operator tools pin a D1 database: '+pinned.join(', '));
console.log('B4 resolved: reconcile-domain-hosting targets the control database bound in wrangler.jsonc; no operator tool pins a database id.');
