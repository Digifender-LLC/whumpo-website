import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
const req=createRequire(import.meta.resolve('wrangler'));
const {Miniflare,convertV4MiniflareOptions}=req('miniflare');
const bundle=await build({stdin:{contents:`import {complete} from './src/ai'; export default {async fetch(){let calls=0; const result=await complete({baseURL:'https://provider.test/v1',apiKey:'synthetic-key',model:'test'},[{role:'user',content:'test'}],async (url,init)=>{const request=new Request(url,init);if(request.redirect!=='manual')throw Error('Redirects must not be followed');calls++;return Response.json({choices:[{finish_reason:'stop',message:{content:'done'}}],usage:{prompt_tokens:1,completion_tokens:1}})});return Response.json({result,calls})}};`,resolveDir:process.cwd()},bundle:true,format:'esm',write:false});
const mf=new Miniflare(convertV4MiniflareOptions({modules:true,compatibilityDate:'2026-09-28',script:bundle.outputFiles[0].text}));
try {
 const response=await mf.dispatchFetch('http://localhost/');assert.equal(response.status,200);
 assert.deepEqual(await response.json(),{result:{text:'done',inputTokens:1,outputTokens:1},calls:1});
 console.log('Actual Workers runtime accepts provider request options; redirects remain manual.');
} finally {await mf.dispose();}
