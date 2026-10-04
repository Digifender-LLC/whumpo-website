import assert from 'node:assert/strict';
import {build} from 'esbuild';
const b=await build({entryPoints:['frontend/src/lib/workspace-navigation.ts'],bundle:true,format:'esm',platform:'node',write:false});
const {providerReturn,chatLocationTarget}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
for(const provider of ['cloudflare','github']){
 const result=providerReturn('?connection='+provider+'&connection_error=authorization');
 assert.equal(result.view,'connections');assert.match(result.notice,/needs a status check/);
 assert.match(providerReturn('?connection='+provider).notice,/Checking/);
}
assert.equal(providerReturn('?checkout=canceled').view,'billing');assert.match(providerReturn('?checkout=canceled').notice,/canceled/);
assert.match(providerReturn('?checkout=returned').notice,/Checking/);
assert.equal(providerReturn('?project=example'),undefined);
const handoff=crypto.randomUUID();
assert.deepEqual(providerReturn('?connection=github&interaction='+handoff),{view:'chat',interactionId:handoff,notice:'Checking the latest connection status…'});
for(const bad of ['https://evil.invalid','undefined','../settings'])assert.equal(providerReturn('?connection=github&interaction='+bad).view,'connections');
assert.equal(providerReturn('?connection=evil&interaction='+handoff).view,'connections');
const injected=providerReturn('?connection=evil&connection_error=PRIVATE_CODE&redirect=https://evil.invalid');
assert.equal(injected.view,'connections');assert.ok(!injected.notice.includes('PRIVATE_CODE'));assert.ok(!injected.notice.includes('evil'));
// The return never carries or selects a project: a Chat handoff's project comes from its current interaction read.
const owned=crypto.randomUUID();
assert.deepEqual(providerReturn('?connection=cloudflare&interaction='+handoff+'&project='+owned),{view:'chat',interactionId:handoff,notice:'Checking the latest connection status…'});
assert.equal('project' in providerReturn('?connection=github&project='+owned),false);
console.log('Provider return checks passed: exact callback failure markers, fixed destinations, no reflected query data and no premature success claims.');

assert.deepEqual(chatLocationTarget('?interaction='+handoff),{kind:'interaction',id:handoff});
assert.deepEqual(chatLocationTarget('?turn='+handoff),{kind:'turn',id:handoff});
assert.equal(providerReturn('?connection=github&interaction='+handoff+'&turn='+handoff).view,'connections');
for(const search of ['', '?turn=../settings','?turn='+handoff+'&turn='+handoff,'?turn='+handoff+'&interaction='+handoff, '?interaction=../settings','?interaction='+handoff+'&interaction='+handoff])assert.equal(chatLocationTarget(search),null);
