// Digital Asset Links for com.whumpo.android, served by the platform Worker's real default export (no network, no database).
import assert from 'node:assert/strict';
import {build} from 'esbuild';
const built=await build({stdin:{contents:"export {default as worker} from './src/index';export {androidPasskeyOrigins} from './src/android-signing';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {worker,androidPasskeyOrigins}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const appSigning='40:8B:8F:8E:AA:DF:43:A9:5F:D6:CB:6A:ED:83:D6:E4:BD:8A:01:D3:E3:2F:88:1B:D9:2D:EE:31:F2:E9:DC:FE';
const uploadKey='26:39:DF:A4:76:DC:6A:A5:BE:7F:E4:76:24:47:A2:B9:22:2F:7C:D8:14:FD:B6:81:E6:5F:47:58:1E:73:C0:63';
const expected=`[
  {
    "relation": [
      "delegate_permission/common.get_login_creds",
      "delegate_permission/common.handle_all_urls"
    ],
    "target": {
      "namespace": "android_app",
      "package_name": "com.whumpo.android",
      "sha256_cert_fingerprints": [
        "${appSigning}",
        "${uploadKey}"
      ]
    }
  }
]
`;
const env={ENVIRONMENT:'test',ASSETS:{fetch:async()=>new Response('asset',{status:404})}},get=(path='/.well-known/assetlinks.json',method='GET')=>worker.fetch(new Request('https://whumpo.com'+path,{method}),env,{waitUntil(){}});
const res=await get();
assert.equal(res.status,200);assert.equal(res.redirected,false);
assert.equal(res.headers.get('content-type'),'application/json');
assert.equal(res.headers.get('cache-control'),'public, max-age=3600');
assert.equal(await res.text(),expected);
// Only the exact GET path: a neighbour or other method never gets the file.
assert.equal((await get('/.well-known/assetlinks.json/')).status,404);assert.equal((await get(undefined,'POST')).status,404);
// The origin is the base64url of the app-signing SHA-256 bytes, and only that key is allowed.
const hash=hex=>Buffer.from(hex.replaceAll(':',''),'hex').toString('base64url');
assert.deepEqual([...androidPasskeyOrigins],['android:apk-key-hash:'+hash(appSigning)]);
assert.equal(hash(appSigning),'QIuPjqrfQ6lf1stq7YPW5L2KAdPjL4gb2S3uMfLp3P4');
console.log('android assetlinks tests passed');
