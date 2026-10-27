// Offline self-check (mocked fetch): fixture-email guard, livemode refusal, sk_test_ check, sweep never touches other customers.
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stripeClient,deleteFixtureCustomer,sweepFixtureCustomers} from '../tools/stripe-sandbox.mjs';
const good='checkout-fixture-'+crypto.randomUUID()+'@example.test',calls=[];
const customers={cus_good:{id:'cus_good',email:good},cus_other:{id:'cus_other',email:'real@example.com'},cus_live:{id:'cus_live',email:good,livemode:true}};
globalThis.fetch=async(url,init)=>{
 const path=new URL(url).pathname.replace('/v1/',''),method=init.method;calls.push(method+' '+path);
 const reply=b=>({ok:true,status:200,json:async()=>b});
 if(path==='customers')return reply({data:Object.values(customers).filter(c=>!c.livemode),has_more:false});
 const c=customers[path.split('/')[1]];
 return reply(method==='DELETE'?{id:c.id,deleted:true}:c);
};
const dir=await mkdtemp(join(tmpdir(),'stripe-'));
await writeFile(join(dir,'stripe-test.key'),'sk_test_abc123');
const api=await stripeClient(dir);
assert.equal(await deleteFixtureCustomer(api,'cus_good',good),true);
assert.ok(calls.includes('DELETE customers/cus_good'));
// Email mismatch or non-fixture address: no DELETE.
calls.length=0;
assert.equal(await deleteFixtureCustomer(api,'cus_good','checkout-fixture-'+crypto.randomUUID()+'@example.test'),false);
await assert.rejects(()=>deleteFixtureCustomer(api,'cus_other','real@example.com'),/non-fixture/);
assert.ok(!calls.some(c=>c.startsWith('DELETE')));
// Livemode refusal.
await assert.rejects(()=>api('customers/cus_live'),/Live Stripe object refused/);
// Sweep: dry run deletes nothing; apply deletes only the fixture customer.
calls.length=0;
assert.deepEqual((await sweepFixtureCustomers(api)).map(c=>c.id),['cus_good']);
assert.ok(!calls.some(c=>c.startsWith('DELETE')));
await sweepFixtureCustomers(api,true);
assert.deepEqual(calls.filter(c=>c.startsWith('DELETE')),['DELETE customers/cus_good']);
// Key check.
await writeFile(join(dir,'stripe-test.key'),'sk_live_abc123');
await assert.rejects(()=>stripeClient(dir),/sk_test_/);
console.log('stripe-sandbox-cleanup: ok');
