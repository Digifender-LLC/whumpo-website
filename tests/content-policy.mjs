import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundled=await build({stdin:{resolveDir:process.cwd(),contents:"export {default as platform} from './src/index';export * from './src/content-policy';"},bundle:true,platform:'node',format:'esm',write:false});
const {platform,acceptsCustomerEligibility,agentContentPolicy}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
let reads=0;const db={prepare(sql){reads++;assert.match(sql,/SELECT 1 FROM invitations/);return {bind(){return {first:async()=>null}}};}};
const env={ENVIRONMENT:'test',DB:db,API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})},TURNSTILE_SECRET:'fixture'};
const request=usBased=>new Request('https://whumpo.com/api/auth/identity/v1/signup/options',{method:'POST',headers:{origin:'https://whumpo.com','content-type':'application/json'},body:JSON.stringify({version:1,email:'test@example.test',inviteCode:'fixture-invite',turnstileToken:'',usBased})});
for(const usBased of [undefined,false,'true','US',1,{},[]]){
 assert.equal(acceptsCustomerEligibility({usBased}),false);
 const response=await platform.fetch(request(usBased),env,{});
 assert.equal(response.status,usBased===undefined?400:403);
 if(usBased!==undefined)assert.match(await response.text(),/United States/);
 assert.equal(response.headers.get('set-cookie'),null);
}
assert.equal(reads,0);
assert.equal(acceptsCustomerEligibility({usBased:true}),true);
// Declaration alone cannot pass the current Turnstile/invitation admission.
assert.equal((await platform.fetch(request(true),env,{})).status,401);assert.equal(reads,1);
for(const text of ['CSAM','sexual content','piracy','scams','hate','gambling','Graphic violence alone is not','Monitor mode never relaxes','background scan'])assert.ok(agentContentPolicy.includes(text));
console.log('Content policy baseline passed: US declaration required before current passkey signup work, strict boolean, no cookies/database access on rejection, and explicit content-policy scope.');
