import assert from 'node:assert/strict';
import {build} from 'esbuild';
const bundle=await build({stdin:{contents:"export * from './src/fair-use-policy';export * from './src/fair-use-mode';",resolveDir:process.cwd()},bundle:true,format:'esm',platform:'node',write:false});
const {assessFairUse,fairUseThresholds,fairUseMode}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const light={cost30dMicros:100000,turns7d:10,classifiedTurns7d:10,unrelatedTurns7d:10,createdProjects7d:3,completedExportDeleteCycles7d:3,review:{unrelatedConfirmed:false,churnConfirmed:false,noticeDelivered:false,unrelatedAfterNotice:0,churnAfterNotice:0}};
assert.equal(assessFairUse('starter',light).suggestedAction,'none');
const heavy={...light,cost30dMicros:11000000,turns7d:100,classifiedTurns7d:100,unrelatedTurns7d:80,createdProjects7d:5,completedExportDeleteCycles7d:4};
assert.equal(assessFairUse('starter',heavy).suggestedAction,'review_behavior');assert.equal(assessFairUse('business-pro',heavy).suggestedAction,'none');
const legitimate={...heavy,unrelatedTurns7d:0,completedExportDeleteCycles7d:0,cost30dMicros:100000000};assert.equal(assessFairUse('starter',legitimate).suggestedAction,'review_legitimate_capacity');assert.deepEqual(assessFairUse('starter',legitimate).restrictions,[]);
const confirmed={...heavy,review:{...heavy.review,unrelatedConfirmed:true,churnConfirmed:true}};assert.equal(assessFairUse('starter',confirmed).suggestedAction,'explain_and_warn');
const notice={...confirmed,review:{...confirmed.review,noticeDelivered:true,unrelatedAfterNotice:9,churnAfterNotice:1}};assert.equal(assessFairUse('starter',notice).suggestedAction,'explain_and_warn');
const continued={...notice,review:{...notice.review,unrelatedAfterNotice:10,churnAfterNotice:2}};const result=assessFairUse('starter',continued);assert.equal(result.suggestedAction,'restrict_flagged_requests');assert.equal(result.enforcementEnabled,false);assert.deepEqual(result.restrictions,['unrelated_chat','new_project_generation']);assert.ok(result.preserve.includes('source_export'));assert.ok(result.preserve.includes('deletion'));assert.ok(result.preserve.includes('existing_site_maintenance'));
assert.deepEqual(assessFairUse('starter',{...continued,cost30dMicros:100000,turns7d:10,classifiedTurns7d:10,unrelatedTurns7d:10}).restrictions,[]);
assert.equal(assessFairUse('starter',{...heavy,classifiedTurns7d:19,unrelatedTurns7d:19,completedExportDeleteCycles7d:0}).suggestedAction,'review_legitimate_capacity');
assert.equal(assessFairUse('starter',{...heavy,unrelatedTurns7d:69,completedExportDeleteCycles7d:0}).signals.length,0);
assert.throws(()=>assessFairUse('explore',light));assert.throws(()=>assessFairUse('starter',{...light,unrelatedTurns7d:11}));assert.throws(()=>assessFairUse('starter',{...light,cost30dMicros:NaN}));
for(const [plan,t] of Object.entries(fairUseThresholds)){assert.ok(t.monitorCostMicros<t.reviewCostMicros&&t.reviewCostMicros<t.heavyCostMicros);assert.equal(assessFairUse(plan,{...light,cost30dMicros:t.monitorCostMicros,classifiedTurns7d:0,unrelatedTurns7d:0,completedExportDeleteCycles7d:0}).suggestedAction,'observe');}
console.log('Fair-use shadow policy passed: tier sensitivity, light-user bypass, cost-only non-abuse review, sampled behavior evidence, contextual confirmation, notice/continuation gates and protected ownership/maintenance actions.');

const now=Date.now();
const declining={verified:true,asOf:now,previous:{revenueMicros:1000000000,costMicros:400000000,days:30},current:{revenueMicros:1000000000,costMicros:500000000,days:30}};
assert.equal(fairUseMode('monitor',declining,now).mode,'monitor');
assert.equal(fairUseMode('enforce',undefined,now).mode,'monitor');
assert.equal(fairUseMode('enforce',{...declining,verified:false},now).mode,'monitor');
assert.equal(fairUseMode('enforce',declining,now).enforcementEligible,true);
assert.equal(fairUseMode('enforce',{...declining,current:{...declining.current,costMicros:350000000}},now).mode,'monitor');
assert.equal(fairUseMode('enforce',{...declining,current:{...declining.current,revenueMicros:800000000}},now).reason,'revenue_changed');
assert.equal(fairUseMode('enforce',{...declining,asOf:now-7*86400000-1},now).mode,'monitor');
assert.equal(fairUseMode('enforce',{...declining,asOf:now+1},now).mode,'monitor');
assert.equal(fairUseMode('enforce',{...declining,current:{...declining.current,days:29}},now).mode,'monitor');
assert.equal(fairUseMode('enforce',{...declining,current:{...declining.current,costMicros:450000000}},now).mode,'enforce');
assert.equal(fairUseMode('enforce',{...declining,current:{...declining.current,costMicros:449999999}},now).mode,'monitor');
assert.throws(()=>fairUseMode('invalid',declining,now));
assert.throws(()=>fairUseMode('enforce',{...declining,asOf:NaN},now));
for(const mode of ['monitor','enforce']){
 const assessment=assessFairUse('starter',continued,{mode,economics:declining,now});
 assert.equal(assessment.enforcementEnabled,false);
 assert.deepEqual(assessment.activeRestrictions,[]);
}
assert.equal(assessFairUse('starter',continued).mode,'monitor');
console.log('Monitor mode passed: explicit operator choice, missing/stale finance fallback, stable revenue and declining profit eligibility, exact margin boundary, no active restrictions.');
