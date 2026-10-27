import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ciCommit,ciReview,ciPreflight,ciRelease,scrubCIOverrides} from '../tools/deploy-ci.mjs';
import {validateCompatibility} from '../tools/release-manifest.mjs';

// Synthetic only: no provider, credential or remote call.
const expected={sha256:'e'.repeat(64),objects:3,tables:2},artifact={sqlSha256:'s'.repeat(64),expected};
const db='11111111-1111-4111-8111-111111111111';
const driver={configs:{platform:{d1_databases:[{binding:'DB',database_id:db}]}}};
const observed=(over={})=>({schema:expected,cms:[],workers:{platform:{databases:[{binding:'DB',id:db}]}},...over});

const source=ciCommit({WORKERS_CI_COMMIT_SHA:'a'.repeat(40)},()=>'');
assert.deepEqual(source,{commit:'a'.repeat(40),dirty:false,branch:null});
assert.equal(ciCommit({},args=>args[0]==='rev-parse'?'abcdef1':' M x').dirty,true);
assert.throws(()=>ciCommit({},()=>{throw Error('no git');}),/source commit is unknown/);
assert.equal(ciCommit({WORKERS_CI_COMMIT_SHA:'main'},args=>args[0]==='rev-parse'?'b'.repeat(40):'').commit,'b'.repeat(40));
assert.throws(()=>ciCommit({WORKERS_CI_COMMIT_SHA:'main'},()=>{throw Error('no git');}),/source commit is unknown/);

const review=ciReview({inputs:{sha256:'b'.repeat(64)}},artifact,source);
assert.equal(review.schemaChange,'none');assert.ok(review.review.includes(source.commit));
validateCompatibility(review,{mode:'none',sqlSha256:artifact.sqlSha256});
assert.throws(()=>validateCompatibility(review,{mode:'initialize',sqlSha256:artifact.sqlSha256}),/schema change/);

ciPreflight(driver,observed(),artifact);
assert.throws(()=>ciPreflight(driver,observed({schema:{...expected,sha256:'f'.repeat(64)}}),artifact),/does not match the current schema/);
assert.throws(()=>ciPreflight(driver,observed({schema:{sha256:'0'.repeat(64),objects:0,tables:0}}),artifact),/owner cutover/);
assert.throws(()=>ciPreflight(driver,observed({workers:{platform:{databases:[{binding:'DB',id:'22222222-2222-4222-8222-222222222222'}]}}}),artifact),/control database differs/);
assert.throws(()=>ciPreflight(driver,observed({cms:[{project_id:'x'}]}),artifact),/CMS registrations/);

const scrubbed=scrubCIOverrides({WRANGLER_CI_OVERRIDE_NAME:'whumpo-platform',WRANGLER_CI_MATCH_TAG:'t',KEEP:'1'});
assert.deepEqual(scrubbed,{KEEP:'1'});
assert.throws(()=>scrubCIOverrides({WRANGLER_CI_OVERRIDE_NAME:'whumpo-runtime'}),/linked to whumpo-runtime/);
let touched=false;
await assert.rejects(()=>ciRelease(process.cwd(),{observe:async()=>{touched=true;}},{env:{}}),/only in Cloudflare Workers Builds/);
assert.equal(touched,false);
// Race guard: synthetic prepare/apply, real ciRelease control flow.
const raceError=()=>Error('Worker changed outside this release');
const prepareError=()=>Error('Build or remote baseline changed during preparation');
const race=async(outcomes,prepareErrors=[])=>{
 const prepares=[],logs=[];let n=0,p=0,observes=0;
 const deps={env:{WORKERS_CI:'1'},log:m=>logs.push(m),commit:()=>source,snapshot:async()=>({inputs:{sha256:'b'.repeat(64)}}),schema:async()=>artifact,
  prepare:async()=>{const e=prepareErrors[p++];if(e)throw e;const directory=mkdtempSync(join(tmpdir(),'ci-race-'));prepares.push(directory);return {directory,manifest:{id:'r'+prepares.length,schema:{mode:'none'}}};},
  apply:async directory=>{const o=outcomes[n++];if(o.journal)writeFileSync(join(directory,'journal.json'),JSON.stringify({steps:o.journal}));if(o.error)throw o.error;}};
 const result=await ciRelease(process.cwd(),{observe:async()=>{observes++;return observed();},configs:driver.configs},deps).then(r=>({r}),error=>({error}));
 return {...result,prepares,logs,applies:n,observes,prepareCalls:p};
};
const pending={schema:{status:'pending'},runtime:{status:'pending'}};
let out=await race([{error:raceError(),journal:pending},{}]);
assert.ok(out.r&&out.applies===2&&out.prepares.length===2);
assert.ok(out.logs.some(m=>m.startsWith('Retrying once')));
// No journal file means apply stopped before saving anything: still all pending.
out=await race([{error:raceError()},{}]);
assert.ok(out.r&&out.applies===2);
for(const status of ['running','unknown','confirmed']){
 out=await race([{error:raceError(),journal:{...pending,runtime:{status}}},{}]);
 assert.equal(out.error?.message,'Worker changed outside this release');assert.equal(out.applies,1);
}
out=await race([{error:Error('Release stopped at apps.'),journal:pending},{}]);
assert.match(out.error.message,/Release stopped/);assert.equal(out.applies,1);
out=await race([{error:raceError(),journal:pending},{error:raceError(),journal:pending},{}]);
assert.equal(out.error?.message,'Worker changed outside this release');assert.equal(out.applies,2);
// Prepare-time baseline refusal: one retry in total, whichever phase triggered it.
out=await race([{}],[prepareError()]);
assert.ok(out.r&&out.prepareCalls===2&&out.applies===1&&out.observes===2); // preflight reran before the retry
assert.ok(out.logs.some(m=>m.startsWith('Retrying once')));
out=await race([],[prepareError(),prepareError()]);
assert.equal(out.error?.message,'Build or remote baseline changed during preparation');assert.equal(out.prepareCalls,2);assert.equal(out.applies,0);
out=await race([],[Error('Release source changed during preparation')]);
assert.match(out.error.message,/Release source changed/);assert.equal(out.prepareCalls,1);
out=await race([{error:raceError(),journal:pending},{}]);
assert.ok(out.r&&out.applies===2&&out.observes===2);
out=await race([{error:raceError(),journal:pending}],[prepareError()]);
assert.equal(out.error?.message,'Worker changed outside this release');assert.equal(out.prepareCalls,2);assert.equal(out.applies,1);
console.log('CI release: commit identity, generated schema-unchanged review, schema/database/CMS refusals and Workers Builds name-override removal, the Workers Builds-only guard and the single retry (prepare baseline or pending-only apply) after a concurrent merge passed. No provider calls.');
