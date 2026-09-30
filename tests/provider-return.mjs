import assert from 'node:assert/strict';
import {build} from 'esbuild';
const b=await build({entryPoints:['frontend/src/lib/workspace-navigation.ts'],bundle:true,format:'esm',platform:'node',write:false});
const {providerReturn}=await import('data:text/javascript;base64,'+Buffer.from(b.outputFiles[0].text).toString('base64'));
for(const provider of ['cloudflare','github']){
 const result=providerReturn('?connection='+provider+'&connection_error=authorization');
 assert.equal(result.view,'connections');assert.match(result.notice,/not completed/);
 assert.match(providerReturn('?connection='+provider).notice,/Checking/);
}
assert.equal(providerReturn('?checkout=canceled').view,'billing');assert.match(providerReturn('?checkout=canceled').notice,/canceled/);
assert.match(providerReturn('?checkout=returned').notice,/Checking/);
assert.equal(providerReturn('?project=example'),undefined);
const injected=providerReturn('?connection=evil&connection_error=PRIVATE_CODE&redirect=https://evil.invalid');
assert.equal(injected.view,'connections');assert.ok(!injected.notice.includes('PRIVATE_CODE'));assert.ok(!injected.notice.includes('evil'));
console.log('Provider return checks passed: exact callback failure markers, fixed destinations, no reflected query data and no premature success claims.');
