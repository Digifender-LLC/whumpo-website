import assert from 'node:assert/strict';
import {comparisonFixture} from './fixtures/comparison-state.mjs';
const f=await comparisonFixture(),before=f.state();
try{
 async function response(path,options={},env=f.env){return f.worker.fetch(f.request(path,options),env,f.ctx);}
 async function document(path,status,heading,options={},env){
  const r=await response(path,options,env);assert.equal(r.status,status);assert.match(r.headers.get('content-type'),/^text\/html/);assert.match(r.headers.get('cache-control'),/private, no-store/);assert.match(r.headers.get('content-security-policy'),/default-src 'none'/);assert.match(r.headers.get('content-security-policy'),/form-action 'none'/);assert.equal(r.headers.get('x-frame-options'),'DENY');assert.match(r.headers.get('vary'),/Accept/);
  const html=await r.text();assert.ok(html.includes(heading));assert.ok(html.includes('href="/workspace/"'));assert.ok(!/<(?:script|form|iframe)\b/i.test(html));return html;
 }
 const success=await document(f.paths.fresh,200,'Review website changes');assert.ok(success.includes('River &amp; Garden'));assert.ok(success.includes('&lt;script&gt;'));assert.ok(success.includes('<dt>Before</dt>'));assert.ok(success.includes('<dt>After</dt>'));assert.ok(!success.includes('<table'));assert.ok(success.includes('Before version')===false,'Empty baseline has no misleading version details');assert.ok(success.includes('After version details'));assert.ok(!success.includes('<button'));
 const expired=await document(f.paths.expired,409,'Let’s get a fresh review');assert.ok(!expired.includes('River'));assert.ok(!expired.includes('Thoughtful'));assert.ok(!expired.includes('Version details'));assert.ok(expired.includes('Opening this page did not publish'));
 const foreign=await document(f.paths.fresh,404,'This comparison isn’t available',{token:f.otherToken});const missing=await document(f.paths.missing,404,'This comparison isn’t available');assert.equal(foreign,missing,'No existence disclosure for other owners');
 await document(f.paths.fresh,401,'Sign in to see your comparison',{token:null});
 await document(f.paths.comparison+'?base=none&base=none',400,'This comparison link isn’t valid');
 await document(f.paths.corrupt,503,'We couldn’t open this comparison');
 await document(f.paths.fresh,429,'A short pause',{}, {...f.env,API_LIMITER:{limit:async()=>({success:false})}});
 for(const accept of ['application/json','*/*','text/html;q=0,application/json','text/html;q=0.0']){
  const r=await response(f.paths.expired,{accept});assert.equal(r.status,409);assert.match(r.headers.get('content-type'),/^application\/json/);assert.deepEqual(await r.json(),{error:'This review changed or expired. Prepare a fresh publication review.'});
 }
 for(const [path,options,status] of [[f.paths.fresh,{method:'POST'},403],['/api/profile',{token:null},401]]){const r=await response(path,options);assert.equal(r.status,status);assert.match(r.headers.get('content-type'),/^application\/json/);}
 const held=f.comparisonErrorResponse(f.request(f.paths.fresh),Response.json({error:'PRIVATE_INTERNAL_DETAIL'},{status:423,headers:{'retry-after':'30','content-length':'42'}}));assert.equal(held.status,423);assert.equal(held.headers.get('retry-after'),'30');assert.equal(held.headers.get('content-length'),null);const heldHTML=await held.text();assert.ok(heldHTML.includes('This content is on hold'));assert.ok(!heldHTML.includes('PRIVATE_INTERNAL_DETAIL'));
 const savedError=console.error;const logs=[];try{console.error=message=>logs.push(message);const html=await document(f.paths.fresh,500,'We couldn’t open this comparison',{}, {...f.env,DB:{prepare(){throw Error('synthetic internal failure');}}});assert.ok(!html.includes('synthetic internal failure'));assert.equal(logs.length,1);}finally{console.error=savedError;}
 assert.equal(f.state(),before,'Reads and error presentation must not mutate reviews, versions or publication');
 console.log('Comparison HTTP passed: actual Worker 200/400/401/404/409/429/500/503 handling, JSON compatibility, exact error statuses, generic foreign/missing pages, escaping, labeled values, headers, held-state presentation and zero state mutations. In-memory SQLite; no network/inference/scanner.');
}finally{f.close();}
