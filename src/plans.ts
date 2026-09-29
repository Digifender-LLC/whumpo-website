/** Draft launch catalogue. Checkout, domain redemption and resource targets are not live. */
export const plans = [
  { id: 'explore', name: 'Explore', monthlyCents: 0, annualCents: 0, publishedSites: 1, monthlyUnits: 50, targetProjects: 1, targetStorageGB: 0, targetDomains: 0, annualDomains: 0 },
  { id: 'starter', name: 'Starter', monthlyCents: 1700, annualCents: 17000, publishedSites: 1, monthlyUnits: 250, targetProjects: 1, targetStorageGB: 10, targetDomains: 2, annualDomains: 1 },
  { id: 'personal', name: 'Personal', monthlyCents: 3000, annualCents: 30000, publishedSites: 5, monthlyUnits: 800, targetProjects: 5, targetStorageGB: 50, targetDomains: 5, annualDomains: 1 },
  { id: 'business', name: 'Business', monthlyCents: 7900, annualCents: 79000, publishedSites: 10, monthlyUnits: 1600, targetProjects: 10, targetStorageGB: 200, targetDomains: 15, annualDomains: 1 },
  { id: 'business-pro', name: 'Business Pro', monthlyCents: 13900, annualCents: 139000, publishedSites: 25, monthlyUnits: 3200, targetProjects: 25, targetStorageGB: 500, targetDomains: 50, annualDomains: 2 }
] as const;
// Preserve historical receipts; never silently relabel or reprice an old entitlement.
export const legacyPlans = [
  { id: 'launch', name: 'Launch (legacy)', monthlyCents: 1200, publishedSites: 3, monthlyUnits: 250 },
  { id: 'studio', name: 'Studio (legacy)', monthlyCents: 2900, publishedSites: 10, monthlyUnits: 800 }
] as const;
export const entitlementPlans = [...plans, ...legacyPlans];
export const internalAITargetCents = { starter: 200, personal: 500, business: 1000, 'business-pro': 2000 } as const;
export const domainBenefit = { wholesaleCapCents: 2000, currency: 'USD', premiumEligible: false, redemptionEnabled: false } as const;
export const creditPack = { cents: 500, credits: 100, currency: 'USD' } as const; // Legacy test pack, not API dollars.
export const publicPlans = plans.map(({ monthlyUnits, publishedSites, targetStorageGB, ...plan }) => plan);
export function describePlans() {
  return 'Draft launch plans (USD):\n' + plans.filter(p => p.monthlyCents).map(p => `${p.name}: $${p.monthlyCents / 100}/month or $${p.annualCents / 100}/year. Annual: ${p.annualDomains} standard domain${p.annualDomains === 1 ? '' : 's'}.`).join('\n')
    + '\n\nAnnual prices include two months of subscription savings. Each annual domain allowance covers up to $20/year wholesale for an eligible registration or renewal; premium domains excluded. Domain redemption is not enabled.\n\nAI assistance is included in the planned subscriptions. Start with Starter unless an existing workload needs more. Plans provide flexible shared hosting, storage, database and processing capacity, with internal safety limits. Storage figures are not fixed inclusions. Optional temporary overage protection requires an explicit dollar ceiling and approval; it is not enabled during this preview. Plan changes are never automatic. Recommend upgrades only when sustained needs or total cost justify them; suggest downgrades after two complete low-use periods with 35% headroom. Dedicated resources need separate approval. Annual upgrades preserve the renewal date; downgrades take effect at renewal. BYOC/BYOI: contact us for a custom deployment. No self-service infrastructure credentials or automatic paid upgrades.\n\nThe invite-only Explore preview remains free with a limited test allowance. Paid subscriptions are not available yet. Use /usage for current test limits.';
}
/** Quote eligibility only. No purchase, claim of ownership, renewal or allowance redemption. */
export function quoteDomainBenefit(planId: string, interval: 'month' | 'year', wholesaleCents: number, premium: boolean) {
  if (!Number.isSafeInteger(wholesaleCents) || wholesaleCents < 0 || !['month','year'].includes(interval) || typeof premium !== 'boolean') throw new Error('Invalid domain quote');
  const plan = plans.find(p => p.id === planId);
  if (!plan) throw new Error('Unknown plan');
  const eligible = interval === 'year' && plan.annualDomains > 0 && !premium;
  const coveredCents = eligible ? Math.min(wholesaleCents, domainBenefit.wholesaleCapCents) : 0;
  return { eligible, coveredCents, remainingWholesaleCents: wholesaleCents - coveredCents, annualDomainCount: eligible ? plan.annualDomains : 0, redemptionEnabled: false as const };
}

/** Sum all model calls in an operation before rounding. Read-only tools cost zero. */
export function buildUnits(inputTokens: number, outputTokens: number): number {
  if (![inputTokens, outputTokens].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error("Invalid token usage");
  const weighted = inputTokens + outputTokens * 4;
  if (!Number.isSafeInteger(weighted)) throw new Error("Token usage overflow");
  return Math.ceil(weighted / 1000);
}
