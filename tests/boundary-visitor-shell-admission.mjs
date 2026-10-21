// WH-004 regression: the per-IP API_LIMITER on the visitor application page shell (src/app-host.ts), recorded in
// docs/boundary-audit.json (visitor-app-shell, admission cell: "no test asserts its 429"). Calls the whumpo-apps
// Worker's handler with a stub limiter, a stub live-page lookup and a stub ASSETS binding; no network, no provider.
//   1. A denying limiter answers the shell GET with 429 "Please try again in a minute." and the hardened headers; the
//      limiter key is `page:<cf-connecting-ip>` (`page:unknown` without the header); the refusal happens before the
//      live-page lookup and before the shell asset is fetched.
//   2. A foreign host is refused (404) before the limiter is consulted.
// Negative control: the identical request with an admitting limiter serves the shell (200) after the page lookup.
import assert from 'node:assert/strict';
import {currentSiteFixtureHandlers} from './current-site-fixture.mjs';

const m=await currentSiteFixtureHandlers();
const project=crypto.randomUUID(),url=`https://app-${project}.whumpo.site/`;
let admit=true;const keys=[],lookups=[],assetPaths=[];
const limiter={limit:async({key})=>{keys.push(key);return {success:admit};}};
const db={prepare:()=>({bind:(...values)=>({first:async()=>{lookups.push(values[0]);return {id:crypto.randomUUID(),project_id:values[0]};}})})};
const assets={fetch:async request=>{assetPaths.push(new URL(request.url).pathname);return new Response('controlled application shell');}};
const env={DB:db,ENVIRONMENT:'test',API_LIMITER:limiter,ASSETS:assets};
const get=(target=url,ip)=>m.appHost.fetch(new Request(target,{headers:ip?{'cf-connecting-ip':ip}:{}}),env);
const reset=()=>{keys.length=0;lookups.length=0;assetPaths.length=0;};

// 1. Denying limiter.
admit=false;
for(const [ip,key] of [['198.51.100.50','page:198.51.100.50'],[undefined,'page:unknown']]){
 reset();
 const response=await get(url,ip);
 assert.equal(response.status,429,`limited shell GET (${ip??'no cf-connecting-ip'})`);
 assert.equal(await response.text(),'Please try again in a minute.');
 assert.equal(response.headers.get('cache-control'),'private, no-store','refusal is not cached');
 assert.equal(response.headers.get('x-frame-options'),'DENY','refusal is not framed');
 assert.match(response.headers.get('content-security-policy'),/frame-ancestors 'none'/);
 assert.deepEqual(keys,[key],'the limiter is keyed by the connecting address');
 assert.deepEqual(lookups,[],'a limited request never reads the live page');
 assert.deepEqual(assetPaths,[],'a limited request never fetches the shell asset');
}

// 2. A foreign host is refused before the limiter is consulted.
reset();
assert.equal((await get(`https://whumpo.com/apps/${project}/`,'198.51.100.50')).status,404,'foreign host refused');
assert.deepEqual(keys,[],'the host check runs before the limiter');

// Negative control: the same request with an admitting limiter serves the shell.
admit=true;reset();
const ok=await get(url,'198.51.100.50');
assert.equal(ok.status,200,'negative control: an admitted shell GET succeeds');
assert.equal(await ok.text(),'controlled application shell');
assert.deepEqual(keys,['page:198.51.100.50']);
assert.deepEqual(lookups,[project],'negative control: the live page was looked up');
assert.deepEqual(assetPaths,['/index.html'],'negative control: the shell asset was served');
console.log('boundary-visitor-shell-admission: ok');
