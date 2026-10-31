// WH-075 acceptance line 2: main has no shared or permission-sensitive cache. This guard fails when one appears, so a
// later cache must first meet the line (key and invalidate by tenant and authorization revision) and update this test.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
const wrangler=['wrangler.jsonc','wrangler.sites.jsonc','wrangler.apps.jsonc','wrangler.runtime.jsonc'];
const code=/\bcaches\s*\.\s*(?:default|open)\b|\bcf\s*:\s*\{[^}]*\bcache(?:Key|Everything|Ttl)|\bKV(?:Namespace)?\b|\bcacheTtl\b/;
const config=/"(?:kv_namespaces|caches?|durable_objects|vectorize)"/;
const violations=(file,text)=>(file.endsWith('.ts')?code:config).test(text)?[file]:[];
async function* walk(dir){for(const e of await readdir(dir,{withFileTypes:true})){const p=dir+'/'+e.name;if(e.isDirectory())yield* walk(p);else if(p.endsWith('.ts'))yield p;}}
// The scanner itself catches each shape (mutation check).
for(const sample of ['await caches.default.match(r)','caches.open("x")','fetch(u,{cf:{cacheKey:k}})','fetch(u,{cf:{cacheEverything:true}})','env.SESSIONS: KVNamespace','{cacheTtl:60}'])assert.equal(violations('x.ts',sample).length,1,sample);
assert.equal(violations('wrangler.jsonc','{"kv_namespaces":[]}').length,1);
const found=[];
for await(const file of walk('src'))found.push(...violations(file,await readFile(file,'utf8')));
for(const file of wrangler)found.push(...violations(file,await readFile(file,'utf8')));
assert.deepEqual(found,[],'A shared cache needs tenant and authorization-revision keys first (WH-075 line 2): '+found.join(', '));
// Tenant-facing responses stay no-store: the sites Worker's base headers.
assert.match(await readFile('src/site-host.ts','utf8'),/'cache-control':'no-store'/);
console.log('Shared cache guard passed: no caches API, cf cache key, KV or durable binding in src or the Worker configs; scanner mutation-checked.');
