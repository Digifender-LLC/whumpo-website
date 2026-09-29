import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const root=new URL('../integrations/emdash/',import.meta.url);
const source=JSON.parse(await readFile(new URL('wrangler.jsonc',root),'utf8'));
const built=JSON.parse(await readFile(new URL('dist/server/wrangler.json',root),'utf8'));
for(const config of [source,built]){
 assert.equal(config.workers_dev,false,'CMS bootstrap must remain private');
 assert.equal(config.preview_urls,false);
 assert.equal((config.routes??[]).length,0,'Public routing requires verified owner bootstrap');
 for(const key of ['worker_loaders','services','dispatch_namespaces','send_email'])assert.equal((config[key]??[]).length,0,'Unapproved binding: '+key);
 assert.ok(!config.images?.binding,'Image transformation binding is outside this profile');
 assert.equal(config.d1_databases.length,1);
 assert.equal(config.d1_databases[0].database_name,'townhello-emdash-preview');
 assert.equal(config.r2_buckets.length,1);
 assert.equal(config.r2_buckets[0].bucket_name,'townhello-emdash-preview-media');
}
console.log('EmDash profile checked: private bootstrap, isolated CMS stores, no Worker Loader, Images, provider service or email bindings.');
