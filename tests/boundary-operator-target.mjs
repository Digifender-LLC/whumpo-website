// WH-004 finding B4 reproduction (offline, static). Operator tools that write the control database should
// target the database bound in wrangler.jsonc, as every other remote tool does via d1_databases. This reads the
// tool source and the config only; it never runs the tool or contacts Cloudflare. Expected to exit 1 while
// tools/reconcile-domain-hosting.mjs still hard-codes a retired database. Not part of any verify profile.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
const bound=config.d1_databases.find(d=>d.binding==='DB').database_id;
const tool=readFileSync('tools/reconcile-domain-hosting.mjs','utf8');
const targets=[...tool.matchAll(/\/accounts\/([0-9a-f]{32})\/d1\/database\/([0-9a-f-]{36})\//g)].map(m=>({account:m[1],database:m[2]}));
assert.ok(targets.length>0,'reconcile-domain-hosting no longer hard-codes a D1 endpoint; re-read how it selects the database');
assert.equal(new Set(targets.map(t=>t.account)).size,1);
assert.equal(targets[0].account,config.account_id,'the tool targets a different Cloudflare account');
const stale=targets.filter(t=>t.database!==bound);
if(stale.length){
 console.error(`B4 reproduced: tools/reconcile-domain-hosting.mjs reads and writes D1 database ${stale[0].database}, but the control database bound in wrangler.jsonc is ${bound} (${config.d1_databases.find(d=>d.binding==='DB').database_name}). Its inspect/apply would act on a retired database while live hosting state is unchanged.`);
 process.exit(1);
}
console.log('reconcile-domain-hosting targets the bound control database.');
