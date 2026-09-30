import assert from 'node:assert/strict';
import {createHmac,createHash} from 'node:crypto';
import {build} from 'esbuild';
const bundle=await build({entryPoints:['src/content-screening.ts'],bundle:true,format:'esm',platform:'node',write:false});
const {planContentScreening}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const now=Date.UTC(2026,8,30),userId='synthetic-owner',key='9b'.repeat(32),digest='a'.repeat(64);
const benign=Array.from({length:28},(_,i)=>({userId,incidentId:`b-${i}`,occurredAt:now-(i%7)*86400000,kind:'verified_benign',disposition:'active'}));
const history={userId,complete:true,events:benign};
const target={userId,digest,kind:'chat_text'};
const first=await planContentScreening(history,target,key,now);
assert.deepEqual(await planContentScreening(history,{...target,requestId:'different'},key,now+1000),first);
assert.equal(first.permissionGranted,false);
for(const kind of ['media','imported_code']){
 const decision=await planContentScreening(history,{...target,kind},undefined,now);
 assert.equal(decision.required,true);assert.equal(decision.reason,'mandatory_format');
}
for(const samplingKey of [undefined,'', 'bad', 'g'.repeat(64)]){
 const decision=await planContentScreening(history,target,samplingKey,now);
 assert.equal(decision.required,true);assert.equal(decision.reason,'sampling_unavailable');
}
for(const altered of [{...history,complete:false},{...history,currentContentFlag:true},{...history,events:[{userId,incidentId:'evasion',occurredAt:now,kind:'confirmed_evasion',disposition:'active'}]}]){
 assert.equal((await planContentScreening(altered,target,key,now)).required,true);
}
for(const malformed of [{...target,userId:'foreign'},{...target,digest:'bad'},{...target,kind:'unknown'}])await assert.rejects(()=>planContentScreening(history,malformed,key,now));
const originalSign=crypto.subtle.sign;
try {
 crypto.subtle.sign=async()=>{throw Error('Synthetic crypto failure');};
 assert.equal((await planContentScreening(history,target,key,now)).reason,'sampling_unavailable');
} finally {crypto.subtle.sign=originalSign;}
assert.equal(Object.hasOwn(first,'bucket'),false);assert.equal(Object.hasOwn(first,'samplingKey'),false);
// Independently check the Web Crypto decisions against Node's HMAC implementation.
let selected=0,skipped=0;
for(let i=0;i<128;i++){
 const d=createHash('sha256').update(`synthetic-content-${i}`).digest('hex');
 for(const kind of ['chat_text','generated_artifact']){
  const t={...target,digest:d,kind},decision=await planContentScreening(history,t,key,now),rate=kind==='chat_text'?5:10;
  const encoded=JSON.stringify(['whumpo-supplemental-screening-v1',decision.policy,userId,kind,d]);
  const value=createHmac('sha256',Buffer.from(key,'hex')).update(encoded).digest().readUInt32BE(0);
  assert.equal(decision.required,value<Math.floor(2**32*rate/100));
  if(decision.required)selected++;else skipped++;
  const newUser=await planContentScreening({...history,events:[]},t,key,now);
  if(decision.required)assert.equal(newUser.required,true); // raising scrutiny cannot unselect work
 }
}
assert.ok(selected>0&&skipped>0);
console.log('Screening planner passed: stable content-bound selection, independent HMAC verification, tenant/format validation, mandatory media/import checks, risk overrides, conservative missing-key handling, and no action authorization.');
