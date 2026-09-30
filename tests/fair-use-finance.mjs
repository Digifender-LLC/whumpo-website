import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {build} from 'esbuild';
import {readCompanyFinance} from '../tools/company-finance-input.mjs';
const code=await build({entryPoints:['src/fair-use-finance.ts'],bundle:true,format:'esm',platform:'node',write:false});
const {companyFinanceReview}=await import('data:text/javascript;base64,'+Buffer.from(code.outputFiles[0].text).toString('base64'));
const now=Date.parse('2026-10-01T12:00:00.000Z'),base={version:1,currency:'USD',basis:'earned-revenue-before-refunds-excluding-tax',previous:{start:'2026-08-01',endExclusive:'2026-08-31',revenueMicros:1000000000,costs:{inference:200000000,hosting:100000000,domains:20000000,paymentFees:30000000,refunds:0,support:50000000,other:0},review:{complete:true,reviewedAt:'2026-09-01T00:00:00.000Z',evidenceDigest:'a'.repeat(64)}},current:{start:'2026-08-31',endExclusive:'2026-09-30',revenueMicros:1000000000,costs:{inference:400000000,hosting:100000000,domains:20000000,paymentFees:30000000,refunds:0,support:50000000,other:0},review:{complete:true,reviewedAt:'2026-09-30T12:00:00.000Z',evidenceDigest:'b'.repeat(64)}}};
const run=(change=()=>{})=>{const v=structuredClone(base);change(v);const result=companyFinanceReview(v,now);assert.equal(result.action,'observe_only');assert.equal(result.enforcementEnabled,false);assert.equal(result.independentlyVerified,false);assert.deepEqual(result.activeRestrictions,[]);assert.ok(!JSON.stringify(result).includes('a'.repeat(64)));return result;};
let r=run();assert.equal(r.reviewSuggested,true);assert.equal(r.reason,'profit_decline_needs_operator_review');assert.equal(r.previous.profitMicros,600000000);assert.equal(r.current.profitMicros,400000000);assert.deepEqual(r.costChanges[0],{category:'inference',changeMicros:200000000});
assert.equal(run(v=>{v.current.costs.inference=200000000;}).reason,'profit_decline_not_established');
assert.equal(run(v=>{v.current.costs.inference=250000000;}).reviewSuggested,true);
assert.equal(run(v=>{v.current.costs.inference=249999999;}).reviewSuggested,false);
assert.equal(run(v=>{v.current.revenueMicros=1050000001;}).reason,'revenue_changed');
assert.equal(run(v=>{v.current.revenueMicros=950000000;}).reviewSuggested,true);
assert.equal(run(v=>{v.current.revenueMicros=949999999;}).reason,'revenue_changed');
assert.equal(run(v=>{v.current.revenueMicros=0;}).reason,'comparable_periods_required');
assert.equal(run(v=>{v.current.costs.inference=1500000000;}).current.profitMicros,-700000000);
assert.equal(run(v=>{v.current.costs.support=null;}).current.costMicros,null);
assert.equal(run(v=>{v.current.costs.support=null;}).reason,'missing_finance_categories');
assert.equal(run(v=>{v.current.revenueMicros=null;}).current.profitMicros,null);
assert.equal(run(v=>{v.previous.review.complete=false;}).reason,'company_wide_review_required');
assert.equal(run(v=>{v.current.start='2026-09-01';}).reason,'adjacent_periods_required');
assert.equal(run(v=>{v.current.endExclusive='2026-09-29';}).reason,'comparable_periods_required');
assert.equal(companyFinanceReview(base,Date.parse('2026-10-08T00:00:00.001Z')).reason,'closed_period_stale');
for(const change of [v=>{v.previous.start='2026-02-30';},v=>{v.current.endExclusive='2026-10-02';},v=>{v.current.review.reviewedAt='2026-09-20T00:00:00.000Z';},v=>{v.current.review.reviewedAt='2026-10-02T00:00:00.000Z';},v=>{v.current.review.evidenceDigest='fake';},v=>{delete v.current.costs.support;},v=>{v.current.costs.misc=0;},v=>{v.current.costs.inference=-1;},v=>{v.current.revenueMicros=1.5;},v=>{v.currency='EUR';},v=>{v.basis='cash';},v=>{v.privateEmail='canary@example.test';},v=>{v.current.costs.inference=Number.MAX_SAFE_INTEGER;}])assert.throws(()=>run(change));
const dir=await mkdtemp('/tmp/whumpo-finance-');const originalFetch=globalThis.fetch;globalThis.fetch=()=>{throw Error('Finance review must stay offline');};
try{
 const path=dir+'/input.json';await writeFile(path,JSON.stringify(base));const first=await readCompanyFinance(path,now);assert.match(first.inputDigest,/^[a-f0-9]{64}$/);assert.deepEqual(await readCompanyFinance(path,now),first);
 await writeFile(path,JSON.stringify(base,null,2));assert.notEqual((await readCompanyFinance(path,now)).inputDigest,first.inputDigest);
 for(const invalid of ['private-finance-canary', ' '.repeat(65537),Buffer.from([255])]){await writeFile(path,invalid);await assert.rejects(readCompanyFinance(path,now));}
 const cli=spawnSync(process.execPath,['tools/report-fair-use.mjs','--economics',path],{encoding:'utf8'});assert.equal(cli.status,1);assert.equal(cli.stdout,'');assert.ok(!cli.stderr.includes('private-finance-canary'));assert.ok(!cli.stderr.includes(path));
 for(const args of [['--account','bad'],['--economics'],['--unknown','x'],['--economics','a','--economics','b']]){const cli=spawnSync(process.execPath,['tools/report-fair-use.mjs',...args],{encoding:'utf8'});assert.equal(cli.status,1);assert.match(cli.stderr,/Usage:/);}
 console.log('Finance review passed: exact USD arithmetic, profit/margin/revenue boundaries, loss reporting, unknown costs, review/date/evidence/period bounds, strict shapes, bounded private files, input digests, safe CLI failures, no network, no enforcement.');
}finally{globalThis.fetch=originalFetch;await rm(dir,{recursive:true,force:true});}
