/** Offline proposal only. Never use these estimates to debit a customer or authorize a provider. */
export const resourceProposal = {
  version: 'whumpo-pool-proposal-2026-09-30', status: 'proposal',
  allowances: { starter: 1000, personal: 2500, business: 7500, 'business-pro': 14000 },
  // Internal stress envelope, NOT a redeemable dollar value or customer exchange rate.
  ceilingUSDPerUnit: 0.002,
  costContingency: 0.20,
  paymentFraction: 0.03, paymentFixedUSD: 0.30, // assumptions, not a Stripe quote
  monthlyOperatingReserveUSD: 1,
  topup: { units: 1000, priceUSD: 10, enabled: false },
} as const;

type Rate = { basis: string; units: number; costUSD: number; category: string };
/** Fractional units accumulate; never round every request up to a whole unit. Costs are marginal estimates. */
export const resourceTariff = {
  quick: { basis: 'completed quick interaction', units: 1, costUSD: .001, category: 'Agent activity' },
  standard: { basis: 'completed standard task', units: 10, costUSD: .015, category: 'Agent activity' },
  intensive: { basis: 'reviewed intensive task', units: 50, costUSD: .08, category: 'Agent activity' },
  workerRequests: { basis: 'million dynamic requests', units: 200, costUSD: .30, category: 'Apps & websites' },
  workerCPU: { basis: 'million CPU milliseconds', units: 15, costUSD: .02, category: 'Apps & websites' },
  r2Storage: { basis: 'GB-month, Standard', units: 10, costUSD: .015, category: 'Storage' },
  r2Writes: { basis: 'million Class A operations', units: 3000, costUSD: 4.50, category: 'Storage' },
  r2Reads: { basis: 'million Class B operations', units: 240, costUSD: .36, category: 'Storage' },
  d1Reads: { basis: 'million rows scanned', units: 1, costUSD: .001, category: 'Apps & websites' },
  d1Writes: { basis: 'million rows written', units: 700, costUSD: 1, category: 'Apps & websites' },
  d1Storage: { basis: 'GB-month', units: 500, costUSD: .75, category: 'Storage' },
  containerCPU: { basis: 'active vCPU-hour', units: 50, costUSD: .072, category: 'Apps & websites' },
  containerMemory: { basis: 'provisioned GiB-hour while running', units: 6, costUSD: .009, category: 'Apps & websites' },
  containerDisk: { basis: 'provisioned GB-hour while running', units: .2, costUSD: .000252, category: 'Storage' },
  containerEgress: { basis: 'GB, conservative highest listed region', units: 35, costUSD: .05, category: 'Apps & websites' },
  doRequests: { basis: 'million requests', units: 100, costUSD: .15, category: 'Apps & websites' },
  doDuration: { basis: 'million GB-seconds', units: 8500, costUSD: 12.50, category: 'Apps & websites' },
  doReads: { basis: 'million SQLite rows read', units: 1, costUSD: .001, category: 'Apps & websites' },
  doWrites: { basis: 'million SQLite rows written', units: 700, costUSD: 1, category: 'Apps & websites' },
  doStorage: { basis: 'SQLite GB-month', units: 150, costUSD: .20, category: 'Storage' },
  streamStorage: { basis: 'stored video minute-month', units: 4, costUSD: .005, category: 'Video' },
  streamDelivery: { basis: 'delivered video minute', units: .7, costUSD: .001, category: 'Video' },
} as const satisfies Record<string, Rate>;
export type Resource = keyof typeof resourceTariff;

function nonnegative(value: number) {
  if (!Number.isFinite(value) || value < 0 || value > 1e12) throw Error('Invalid scenario quantity');
  return value;
}
/** Scenario input only: quantities must be provider dimensions, not customer-reported billing evidence. */
export function estimateWorkload(quantities: Partial<Record<Resource, number>>) {
  let units = 0, costUSD = 0;
  const categories: Record<string, number> = {};
  for (const [key, quantity] of Object.entries(quantities)) {
    if (!Object.hasOwn(resourceTariff, key)) throw Error('Unknown resource');
    const rate = resourceTariff[key as Resource], amount = nonnegative(quantity as number);
    units += amount * rate.units;
    costUSD += amount * rate.costUSD;
    categories[rate.category] = (categories[rate.category] ?? 0) + amount * rate.units;
  }
  return { version: resourceProposal.version, units, costUSD, categories };
}

export function planEconomics(plan: { monthlyCents: number; annualCents: number; annualDomains: number },
  allowance: number, interval: 'month' | 'year', consumptionMultiplier = 1) {
  if (!['month', 'year'].includes(interval)) throw Error('Invalid interval');
  const periods = interval === 'year' ? 12 : 1;
  const grossUSD = nonnegative(interval === 'year' ? plan.annualCents : plan.monthlyCents) / 100 / periods;
  if (grossUSD === 0) throw Error('Paid plan required');
  const paymentUSD = grossUSD * resourceProposal.paymentFraction + resourceProposal.paymentFixedUSD / periods;
  const domainReserveUSD = interval === 'year' ? nonnegative(plan.annualDomains) * 20 / 12 : 0;
  const variableUSD = nonnegative(allowance) * nonnegative(consumptionMultiplier) * resourceProposal.ceilingUSDPerUnit;
  const contingencyUSD = variableUSD * resourceProposal.costContingency;
  const contributionUSD = grossUSD - paymentUSD - domainReserveUSD - variableUSD - contingencyUSD - resourceProposal.monthlyOperatingReserveUSD;
  return { grossUSD, paymentUSD, domainReserveUSD, variableUSD, contingencyUSD,
    operatingReserveUSD: resourceProposal.monthlyOperatingReserveUSD, contributionUSD, margin: contributionUSD / grossUSD };
}

/** Only unused NEW subscription units may carry; old rollover and purchased credits never roll again. */
export function rolloverProposal(unusedFreshUnits: number, previousAllowance: number, nextAllowance: number) {
  return Math.min(nonnegative(unusedFreshUnits), nonnegative(previousAllowance), nonnegative(nextAllowance));
}
