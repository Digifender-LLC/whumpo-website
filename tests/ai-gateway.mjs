import assert from 'node:assert/strict';
import {build} from 'esbuild';
const built=await build({entryPoints:['src/ai-gateway.ts'],bundle:true,format:'esm',platform:'node',write:false});
const {completeGateway}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const config={accountId:'a'.repeat(32),gatewayId:'whumpo-test',apiToken:'synthetic-private-token',model:'@cf/example/model',protocol:'chat',maxOutputTokens:512,timeoutMs:5000};
const messages=[{role:'user',content:'Draft a page for a synthetic bakery.'}];
let calls=0;
const transport=async(url,request)=>{
 calls++;
 assert.equal(String(url),`https://api.cloudflare.com/client/v4/accounts/${config.accountId}/ai/v1/chat/completions`);
 assert.equal(request.method,'POST');assert.equal(request.redirect,'manual');assert.ok(request.signal);
 const headers=new Headers(request.headers);
 for(const [key,value] of Object.entries({'authorization':'Bearer '+config.apiToken,'cf-aig-gateway-id':config.gatewayId,'cf-aig-skip-cache':'true','cf-aig-collect-log':'false','cf-aig-max-attempts':'1','cf-aig-no-wholesale':'true','cf-aig-request-timeout':'5000'}))assert.equal(headers.get(key),value);
 assert.equal(headers.has('cf-aig-metadata'),false);assert.equal(headers.has('x-opencode-session'),false);
 const body=JSON.parse(request.body);assert.deepEqual(body,{model:config.model,messages,max_tokens:512,stream:false});
 return Response.json({model:config.model,choices:[{finish_reason:'stop',message:{role:'assistant',content:'A private draft.'}}],usage:{prompt_tokens:12,completion_tokens:4}});
};
assert.deepEqual(await completeGateway(config,messages,transport),{text:'A private draft.',inputTokens:12,outputTokens:4});assert.equal(calls,1);
for(const override of [{accountId:'../other'},{gatewayId:'x\r\nsecret: leaked'},{model:'dynamic/default'+'?key=secret'},{model:'dynamic-route'},{model:'dynamic/route'},{protocol:'messages'},{apiToken:'token\nvalue'},{apiToken:''},{maxOutputTokens:undefined},{maxOutputTokens:100000},{timeoutMs:0}]){
 await assert.rejects(completeGateway({...config,...override},messages,transport),{kind:'configuration'});
}assert.equal(calls,1,'Invalid configuration must not dispatch');
let responseCalls=0;
const responses={...config,model:'example/model',protocol:'responses'};
assert.equal((await completeGateway(responses,messages,async(url,request)=>{
 responseCalls++;assert.ok(String(url).endsWith('/ai/v1/responses'));
 const body=JSON.parse(request.body);assert.equal(body.store,false);assert.equal(body.max_output_tokens,512);assert.equal(body.model,'example/model');assert.equal(body.stream,false);
 return Response.json({model:responses.model,status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:'Ready.'}]}],usage:{input_tokens:15,output_tokens:2}});
})).text,'Ready.');assert.equal(responseCalls,1);
for(const status of [302,429,500]){
 let attempts=0;
 await assert.rejects(completeGateway(config,messages,async()=>{attempts++;return new Response('private provider body '+config.apiToken,{status,headers:{location:'https://other.invalid'}});}),error=>!error.message.includes(config.apiToken)&&['unavailable','rejected'].includes(error.kind));
 assert.equal(attempts,1,'No retry or fallback after provider failure');
}
await assert.rejects(completeGateway(config,messages,async()=>{throw new DOMException(config.apiToken,'TimeoutError');}),{kind:'unavailable',reason:'timeout',message:'AI provider unavailable'});
await assert.rejects(completeGateway(config,messages,async()=>Response.json({model:config.model,choices:[{finish_reason:'stop',message:{content:config.apiToken}}],usage:{prompt_tokens:1,completion_tokens:1}})),{kind:'invalid_response'});
await assert.rejects(completeGateway(config,messages,async()=>Response.json({model:config.model,choices:[{finish_reason:'stop',message:{content:'Draft'}}],usage:{prompt_tokens:1}})),{kind:'invalid_response'});
console.log('Gateway transport checks passed: explicit endpoints/models, privacy and billing headers, both protocols, bounded usage, sanitized errors, no retries/redirects/fallback.');

const originalFetch=globalThis.fetch;
try{globalThis.fetch=async function(...args){assert.equal(this,globalThis);return transport(...args);};await completeGateway(config,messages);}finally{globalThis.fetch=originalFetch;}
console.log('Native transport retains the Workers global receiver.');
