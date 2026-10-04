import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {connectionReadiness} from '../tools/report-connections.mjs';

const names=['GITHUB_APP_ID','GITHUB_APP_SLUG','GITHUB_CLIENT_ID','GITHUB_CLIENT_SECRET','CLOUDFLARE_CLIENT_ID','CLOUDFLARE_CLIENT_SECRET','CONNECTION_ENCRYPTION_KEYRING'];
let secretNames=[],row={total:0,revoking:0},calls=[];
const api=async(...args)=>{assert.deepEqual(args,['/workers/scripts/whumpo-platform/secrets']);calls.push('read');return {result:secretNames.map(name=>({name,irrelevant:'DO_NOT_PRINT'}))};};
const db={prepare(sql){assert.match(sql,/^SELECT COUNT\(\*\).* FROM (github|cloudflare)_token_vault$/);assert.doesNotMatch(sql,/ciphertext|user_id|login/);return {first:async()=>row};}};
let report=await connectionReadiness(api,db,'whumpo-platform');
assert.equal(report.providers.github.bindingPresence,'incomplete');
assert.equal(report.providers.github.missing.length,5);
assert.equal(report.providers.cloudflare.missing.length,3);
secretNames=names;report=await connectionReadiness(api,db,'whumpo-platform');
assert.equal(report.providers.github.bindingPresence,'present_unvalidated');
assert.equal(report.providers.cloudflare.bindingPresence,'present_unvalidated');
assert.ok(!JSON.stringify(report).includes('DO_NOT_PRINT'));
for(const provider of ['github','cloudflare']){
 const source=await readFile(`src/${provider}-connection.ts`,'utf8');
 assert.ok(source.includes(`const callback='${report.providers[provider].callback}'`));
}
secretNames=names.filter(n=>n!=='CONNECTION_ENCRYPTION_KEYRING');row={total:2,revoking:1};
report=await connectionReadiness(api,db,'whumpo-platform');
assert.equal(report.providers.github.recoveryRequired,true);
assert.equal(report.providers.cloudflare.pendingRevocations,1);
row={total:0,revoking:1};await assert.rejects(()=>connectionReadiness(api,db,'whumpo-platform'));
await assert.rejects(()=>connectionReadiness(api,db,'../other-worker'));
await assert.rejects(()=>connectionReadiness(async()=>({result:{}}),db,'whumpo-platform'));
await assert.rejects(()=>connectionReadiness(async()=>{throw Error('PRIVATE_PROVIDER_ERROR');},db,'whumpo-platform'));
assert.equal(calls.length,4);
console.log('Connection readiness checks passed: missing configuration, unvalidated presence, vault recovery, read-only scope and callback alignment.');
