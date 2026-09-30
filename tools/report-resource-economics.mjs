import { plans } from '../src/plans.ts';
import { resourceProposal as p, resourceTariff, planEconomics, estimateWorkload } from '../src/resource-economics.ts';
const scenarios = {
  'Small business site': { quick: 100, standard: 30, intensive: 2, workerRequests: .1, workerCPU: 1, r2Storage: 5, r2Reads: .02, r2Writes: .001, d1Storage: .1, d1Reads: 10, d1Writes: .01 },
  'Active personal app': { quick: 200, standard: 80, intensive: 8, workerRequests: 1, workerCPU: 10, r2Storage: 20, r2Reads: .1, r2Writes: .005, d1Storage: .5, d1Reads: 20, d1Writes: .05 },
  'Business with video': { quick: 300, standard: 100, intensive: 10, workerRequests: 2, workerCPU: 20, r2Storage: 50, d1Storage: 1, d1Writes: .1, streamStorage: 300, streamDelivery: 2000 },
  'Always-on 1 GiB container': { containerCPU: 73, containerMemory: 730, containerDisk: 2920, containerEgress: 10 },
};
console.log(JSON.stringify({ proposal: p, caveat: 'Planning estimates only; no metering, payments, paid services or enforcement enabled.',
  plans: plans.filter(plan => Object.hasOwn(p.allowances, plan.id)).map(plan => {
    const units = p.allowances[plan.id];
    const annual = planEconomics(plan, units, 'year');
    const maxUnitsAt60Percent = Math.floor((annual.grossUSD * .4 - annual.paymentUSD - annual.domainReserveUSD - annual.operatingReserveUSD) / (p.ceilingUSDPerUnit * (1 + p.costContingency)));
    return { plan: plan.name, monthlyUSD: plan.monthlyCents / 100, annualUSD: plan.annualCents / 100, units, capacityMultiplier: units / p.allowances.starter, maxUnitsAt60Percent,
      monthly: planEconomics(plan, units, 'month'), annual: planEconomics(plan, units, 'year'),
      annualRolloverBurst: planEconomics(plan, units, 'year', 2),
      annualDoubleProviderCost: planEconomics(plan, units, 'year', 2),
      annualRolloverAndDoubleCost: planEconomics(plan, units, 'year', 4) };
  }), workloads: Object.entries(scenarios).map(([name, quantities]) => ({ name, quantities, ...estimateWorkload(quantities) })),
  tariff: resourceTariff }, null, 2));
