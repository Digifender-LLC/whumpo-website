import assert from 'node:assert/strict';
import {ciCommit,ciReview,ciPreflight,ciRelease} from '../tools/deploy-ci.mjs';
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

let touched=false;
await assert.rejects(()=>ciRelease(process.cwd(),{observe:async()=>{touched=true;}},{env:{}}),/only in Cloudflare Workers Builds/);
assert.equal(touched,false);
console.log('CI release: commit identity, generated schema-unchanged review, schema/database/CMS refusals and the Workers Builds-only guard passed. No provider calls.');
