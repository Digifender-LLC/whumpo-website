import assert from 'node:assert/strict';
import {cloudflareClient} from '../tools/cms-cloudflare.mjs';
const account='a'.repeat(32),old={type:'oauth',token:'synthetic-old'},fresh={type:'oauth',token:'synthetic-new'};
let loads=0;const requests=[];
const api=cloudflareClient(account,async(url,init)=>{requests.push({url,...init});return requests.length===1?Response.json({success:false},{status:403}):Response.json({success:true,result:{ok:true}});},undefined,()=>++loads===1?old:fresh);
assert.equal((await api('/d1/database/test/query',{sql:'SELECT 1',params:[]})).success,true);
assert.equal(requests.length,2);assert.equal(requests[0].body,requests[1].body);assert.equal(requests[0].url,requests[1].url);assert.equal(requests[0].headers.authorization,'Bearer synthetic-old');assert.equal(requests[1].headers.authorization,'Bearer synthetic-new');
for(const status of [400,401,429,500,503]){let calls=0;await assert.rejects(cloudflareClient(account,async()=>{calls++;return Response.json({success:false},{status});},undefined,()=>old)('/test'));assert.equal(calls,1);}
let explicitCalls=0;await assert.rejects(cloudflareClient(account,async()=>{explicitCalls++;return Response.json({success:false},{status:403});},old,()=>old)('/test'));assert.equal(explicitCalls,1);
let sameCalls=0;await assert.rejects(cloudflareClient(account,async()=>{sameCalls++;return Response.json({success:false},{status:403});},undefined,()=>old)('/test'));assert.equal(sameCalls,1);
let lostCalls=0;await assert.rejects(cloudflareClient(account,async()=>{lostCalls++;throw Error('lost acknowledgment');},undefined,()=>old)('/test',{}));assert.equal(lostCalls,1);
console.log('Cloudflare credential refresh passed: changed ambient OAuth token retries confirmed 403 once; explicit credentials and uncertain outcomes never retry.');
