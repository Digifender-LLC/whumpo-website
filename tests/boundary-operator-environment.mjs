// WH-004 R14 regression (offline). The deploy and provisioning tools act on invocation, so they pin the test
// platform, and the Stripe sandbox tool pins the Whumpo sandbox account. No network, Wrangler or database is used.
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assertTestPlatform,deployPlatform} from '../tools/deploy-platform.mjs';
import {configure,expectedAccount} from '../tools/stripe-sandbox.mjs';

// deploy-platform: the shipped configuration passes; any other ENVIRONMENT (or none) is refused before any API client exists.
const shipped=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
assertTestPlatform(shipped);
for(const vars of [{ENVIRONMENT:'production'},{ENVIRONMENT:'local'},{},undefined])
 assert.throws(()=>assertTestPlatform({...shipped,vars}),/Only the test platform/);
await assert.rejects(deployPlatform({config:{...shipped,vars:{ENVIRONMENT:'production'}}}),/Only the test platform/);

// provision-cms runs at import, so its pin is a source assertion: the check precedes the first remote client.
const provision=readFileSync(new URL('../tools/provision-cms.mjs',import.meta.url),'utf8');
const pin=provision.indexOf('assertTestPlatform(base)'),client=provision.indexOf('cloudflareClient(base.account_id)');
assert.ok(pin>0&&pin<client,'provision-cms must pin the test platform before creating a Cloudflare client');

// stripe-sandbox: a sandbox key for another account is refused before any write; the Whumpo account passes.
const dir=mkdtempSync(join(tmpdir(),'whumpo-stripe-pin-')),realFetch=globalThis.fetch,calls=[];
try{
 writeFileSync(join(dir,'stripe-test.key'),'sk_'+'test_synthetic0000');
 const stub=account=>async(url,{method='GET'}={})=>{calls.push(method+' '+url);const path=String(url).replace('https://api.stripe.com/v1/','');return Response.json(path==='balance'?{livemode:false}:{id:account,livemode:false});};
 globalThis.fetch=stub('acct_someoneelse');
 await assert.rejects(configure(dir,true),/different Stripe account/);
 assert.ok(calls.every(c=>c.startsWith('GET ')),'nothing is written for a foreign account: '+calls);
 calls.length=0;globalThis.fetch=stub(expectedAccount);
 await configure(dir,false);
 assert.deepEqual(calls.map(c=>c.replace('https://api.stripe.com/v1/','')),['GET balance','GET account']);
}finally{globalThis.fetch=realFetch;rmSync(dir,{recursive:true,force:true});}
console.log('Operator environment pins: deploy-platform and provision-cms refuse a non-test ENVIRONMENT; stripe-sandbox refuses a foreign Stripe account before any write.');
