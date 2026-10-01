import assert from 'node:assert/strict';
import {build} from 'esbuild';

const bundle=await build({stdin:{contents:"export * from './frontend/src/lib/api.ts'; export * as dns from './src/cloudflare-dns.ts';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {api,APIError,requireCurrentAccountIdentity,dns}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const accountId='11111111-1111-4111-8111-111111111111';
requireCurrentAccountIdentity({accountId,email:'current@example.invalid'});
for(const value of [null,[],{}, {email:'old@example.invalid'},{accountId:null},{accountId:''},{accountId:'old@example.invalid'},{accountId:[accountId]}])assert.throws(()=>requireCurrentAccountIdentity(value),e=>e instanceof APIError&&e.status===409);
const oldFetch=globalThis.fetch;let calls=0;
try{
 for(const data of [{email:'old@example.invalid'},{accountId,email:'current@example.invalid'}]){
  globalThis.fetch=async(url,init)=>{calls++;assert.equal(url,'/api/profile');assert.equal(init.credentials,'same-origin');return Response.json(data);};
  if(data.accountId)assert.deepEqual(await api('/profile'),data);
  else await assert.rejects(api('/profile'),e=>e.status===409);
 }
 globalThis.fetch=async()=>Response.json({error:'Sign in required'},{status:401});
 await assert.rejects(api('/profile'),e=>e.status===401&&e.message==='Sign in required');
}finally{globalThis.fetch=oldFetch;}
assert.equal(calls,2);assert.equal(typeof dns.confirmDNS,'function');assert(!Object.hasOwn(dns,'confirmTXT'));
console.log('Current interfaces passed: profile UUID required, older/malformed response rejected, auth errors preserved, DNS legacy alias absent. Synthetic transport only.');
