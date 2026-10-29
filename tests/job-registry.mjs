// WH-052 P-1: the every-minute job-type registry. Caps, per-owner fairness, provider concurrency, the 20 s admission deadline,
// rotation and independent settlement. Run on SQLite (default) or local D1 (`--d1`); each claimed job does a real database read.
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {databaseFixture} from './helpers/current-database.mjs';
const bundled=await build({stdin:{contents:"export * from './src/job-dispatcher';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {dispatchJobs,dispatchBounds}=await import('data:text/javascript,'+encodeURIComponent(bundled.outputFiles[0].text));
const store=await databaseFixture({d1:process.argv.includes('--d1')}),{db}=store;
assert.deepEqual({...dispatchBounds},{perType:10,perOwner:2,providerCalls:2,admissionMs:20000});
const read=()=>db.prepare('SELECT count(*) n FROM users').first();
/** A type that offers `owners` (one entry per due job, in order) and does one provider-guarded read per claimed job. */
const lane=(type,owners,done)=>({type,async run(ctx){for(const owner of owners){const c=ctx.claim(owner);if(c==='stop')break;if(c==='owner-cap')continue;await ctx.provider(read);done.push(owner);}}});
try{
 // At most 10 claims per type per run, whatever is due.
 let done=[];await dispatchJobs([lane('a',Array.from({length:40},(_,i)=>'o'+i),done)]);assert.equal(done.length,10);
 // At most 2 per owner; the cap skips the noisy owner instead of ending the run, so the others are still served.
 done=[];await dispatchJobs([lane('a',[...Array(8).fill('noisy'),'x','y','z'],done)]);
 assert.deepEqual(done,['noisy','noisy','x','y','z']);
 // Counters are per type: a second type may serve the same owner again.
 done=[];await dispatchJobs([lane('a',['o','o','o'],done),lane('b',['o','o','o'],done)]);assert.equal(done.length,4);
 // At most 2 provider calls at once across all types.
 let live=0,peak=0;const slow=type=>({type,async run(ctx){await Promise.all(Array.from({length:6},()=>ctx.provider(async()=>{peak=Math.max(peak,++live);await new Promise(r=>setTimeout(r,5));live--;})));}});
 await dispatchJobs([slow('a'),slow('b')]);assert.equal(peak,2);assert.equal(live,0);
 // A failing provider call releases its slot and does not strand waiting calls.
 await dispatchJobs([{type:'a',async run(ctx){await Promise.allSettled(Array.from({length:5},()=>ctx.provider(async()=>{throw Error('x');})));assert.equal(await ctx.provider(async()=>7),7);}}]);
 // Stops taking new work after 20 s of wall time; work already claimed finishes.
 let t=1000000;done=[];await dispatchJobs([{type:'a',async run(ctx){for(const o of ['a','b','c','d']){if(ctx.claim(o)==='stop')break;done.push(o);t+=o==='b'?dispatchBounds.admissionMs:1;}}}],{now:()=>t});
 assert.deepEqual(done,['a','b']);
 t=0;done=[];await dispatchJobs([{type:'a',async run(ctx){t=19999;done.push(ctx.claim('a'));t=20000;done.push(ctx.claim('b'));}}],{now:()=>t});assert.deepEqual(done,['ok','stop']);
 // Types rotate by minute so the deadline does not always cut the same one.
 const started=[],first=async m=>{await dispatchJobs(['a','b','c'].map(type=>({type,async run(){started.push(type);}})),{now:()=>m*60000});return started.splice(0)[0];};
 assert.deepEqual([await first(0),await first(1),await first(2),await first(3)],['a','b','c','a']);
 // Types settle independently: a failing type does not stop the other, and the first failure escapes raw.
 let ran=false;await assert.rejects(dispatchJobs([{type:'a',async run(){throw Error('RAW_JOB_FAILURE');}},{type:'b',async run(){ran=true;}}]),/RAW_JOB_FAILURE/);assert.ok(ran);
 await assert.rejects(dispatchJobs([{type:'a',async run(){}},{type:'a',async run(){}}]),/Invalid job registry/);
}finally{await store.close?.();}
console.log(`Job registry passed (${process.argv.includes('--d1')?'local D1':'SQLite'}).`);
