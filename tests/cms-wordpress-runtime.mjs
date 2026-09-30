import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import {analyzeWordPress} from '../tools/cms-wordpress-stage.mjs';
assert.equal(JSON.parse(await readFile('integrations/emdash/package.json','utf8')).dependencies.emdash,'1.0.1');
assert.equal(JSON.parse(await readFile('node_modules/@emdash-cms/gutenberg-to-portable-text/package.json','utf8')).version,'1.0.1');
assert.deepEqual(await readFile('src/vendor/emdash-wxr.ts'),await readFile('integrations/emdash/node_modules/emdash/src/cli/wxr/parser.ts'));
const require=createRequire(import.meta.resolve('wrangler')),{Miniflare,convertV4MiniflareOptions}=require('miniflare');
const bundle=await build({stdin:{resolveDir:process.cwd(),contents:`import {analyzeWordPress} from './src/cms-wordpress-analysis';export default {async fetch(request){globalThis.fetch=()=>{throw Error('Network forbidden during analysis');};try{return Response.json(await analyzeWordPress(new Uint8Array(await request.arrayBuffer())));}catch(e){return Response.json({error:e.message},{status:400});}}};`},bundle:true,format:'esm',platform:'browser',write:false});
const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,compatibilityDate:'2026-09-28',script:bundle.outputFiles[0].text}));
const item=(id,html='<p>A <strong>WordPress</strong> story.</p>')=>`<item><title>Example article</title><wp:post_id>${id}</wp:post_id><wp:post_type>post</wp:post_type><wp:status>publish</wp:status><content:encoded><![CDATA[${html}]]></content:encoded></item>`;
const wxr=items=>`<rss xmlns:wp="http://wordpress.org/export/1.2/" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><wp:wxr_version>1.2</wp:wxr_version>${items}</channel></rss>`;
const send=xml=>runtime.dispatchFetch('http://localhost/',{method:'POST',body:xml});
try{
 const xml=wxr(item(1)+item(2,'<p>Image</p><img src="https://external.test/photo.jpg">')),response=await send(xml);assert.equal(response.status,200,await response.clone().text());const result=await response.json();
 assert.deepEqual(result,await analyzeWordPress(new TextEncoder().encode(xml)));assert.equal(result.summary.reviewable,1);assert.equal(result.summary.needsChanges,1);assert.equal(result.sourceRetained,false);
 const repeated=await send(xml);assert.deepEqual(await repeated.json(),result);
 for(const invalid of [wxr(item(1)).replace('<rss','<!DOCTYPE rss [<!ENTITY x SYSTEM "https://external.test/">]><rss'),'<rss>',wxr(item(1)+item(1)),wxr(Array.from({length:101},(_,i)=>item(i+1)).join(''))])assert.equal((await send(invalid)).status,400);
 const maximum=await send(wxr(Array.from({length:100},(_,i)=>item(i+1,'<p>'+'text '.repeat(800)+'</p>')).join('')));assert.equal(maximum.status,200);assert.equal((await maximum.json()).summary.needsChanges,100);
 assert.equal((await send(new Uint8Array(1048577))).status,400);
 console.log('Actual Worker WordPress analysis passed: pinned upstream source, browser-only bundle without Node compatibility, exact Node/Worker report parity, deterministic replay, no network, malformed/DTD/duplicate/count/size rejection and 100-item workload. Bundle bytes: '+bundle.outputFiles[0].text.length);
}finally{await runtime.dispose();}
