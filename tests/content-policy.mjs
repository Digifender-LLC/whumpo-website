import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundled=await build({stdin:{resolveDir:process.cwd(),contents:"export {default as platform} from './src/index';export {passkeyOptions,passkeyVerify} from './src/passkeys';export * from './src/content-policy';"},bundle:true,platform:'node',format:'esm',write:false});
const {platform,passkeyOptions,passkeyVerify,acceptsCustomerEligibility,agentContentPolicy}=await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const db={prepare(){throw Error('No database operation permitted before eligibility');}};
const env={ENVIRONMENT:'test',DB:db,API_LIMITER:{limit:async()=>({success:true})},AUTH_LIMITER:{limit:async()=>({success:true})}};
const request=()=>new Request('https://whumpo.com/api/auth/register',{method:'POST',headers:{origin:'https://whumpo.com','content-type':'application/json'},body:JSON.stringify({email:'test@example.test',password:'fixture-password'})});
for(const usBased of [undefined,false,'true','US',1,{},[]]){
 assert.equal(acceptsCustomerEligibility({usBased}),false);
 for(const fn of [passkeyOptions,passkeyVerify])await assert.rejects(()=>fn(request(),env,'signup',{usBased},null),e=>e.status===403&&/US-based/.test(e.message));
 const response=await platform.fetch(new Request(request(),{body:JSON.stringify({usBased})}),env,{});
 assert.equal(response.status,403);assert.match(await response.text(),/US-based/);assert.equal(response.headers.get('set-cookie'),null);
}
assert.equal(acceptsCustomerEligibility({usBased:true}),true);
// Eligibility permits the next validation step, not an account or session by itself.
const accepted=await platform.fetch(new Request(request(),{body:JSON.stringify({usBased:true})}),env,{});assert.equal(accepted.status,400);
for(const text of ['CSAM','sexual content','piracy','scams','hate','gambling','Graphic violence alone is not','Monitor mode never relaxes','background scan'])assert.ok(agentContentPolicy.includes(text));
console.log('Content policy baseline passed: US declaration required before password/passkey signup work, strict boolean, no cookies/database access on rejection, and explicit content-policy scope.');
