import assert from 'node:assert/strict';
import { plans } from '../src/plans.ts';
import { resourceProposal as p, resourceTariff, estimateWorkload, planEconomics, rolloverProposal } from '../src/resource-economics.ts';
for (const rate of Object.values(resourceTariff)) assert.ok(rate.costUSD / rate.units <= p.ceilingUSDPerUnit);
for (const plan of plans.filter(x => Object.hasOwn(p.allowances, x.id))) {
  const units = p.allowances[plan.id];
  // Full use, annual discounts, domain redemption, fees, contingency and operating reserve.
  assert.ok(planEconomics(plan, units, 'year').margin >= .60, plan.id);
  assert.ok(planEconomics(plan, units, 'month').margin >= .60, plan.id);
  assert.ok(planEconomics(plan, units, 'year', 2).contributionUSD > 0, plan.id);
}
const starter = plans.find(x => x.id === 'starter');
assert.ok(Math.abs(planEconomics(starter, 1000, 'year').domainReserveUSD - 20 / 12) < 1e-9);
assert.equal(planEconomics(starter, 1000, 'month').domainReserveUSD, 0);
assert.equal(estimateWorkload({ standard: 10, r2Storage: 5 }).units, 150);
// Partitioning usage cannot inflate charges through per-event rounding.
assert.equal(estimateWorkload({ workerRequests: .001 }).units * 1000, estimateWorkload({ workerRequests: 1 }).units);
assert.equal(rolloverProposal(800, 1000, 2500), 800);
assert.equal(rolloverProposal(8000, 14000, 1000), 1000);
assert.equal(rolloverProposal(1000, 1000, 0), 0);
for (const bad of [-1, NaN, Infinity, 1e13, '10', undefined]) assert.throws(() => estimateWorkload({ standard: bad }));
assert.throws(() => estimateWorkload({ unknown: 1 }));
assert.throws(() => estimateWorkload(JSON.parse('{"__proto__":1}')));
assert.throws(() => planEconomics(starter, 1000, 'bad'));
assert.throws(() => planEconomics(starter, -1, 'year'));
assert.throws(() => rolloverProposal(-1, 1000, 1000));
console.log('Resource economics: full-use margins, stressed contribution, tariff envelopes, exact dimensions, invalid inputs and rollover caps passed.');
