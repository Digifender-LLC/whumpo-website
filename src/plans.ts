/** Draft catalogue. Paid entitlements are not enabled until checkout and metering ship. */
export const plans = [
  { id: "explore", name: "Explore", monthlyCents: 0, publishedSites: 1, monthlyUnits: 50 },
  { id: "launch", name: "Launch", monthlyCents: 1200, publishedSites: 3, monthlyUnits: 250 },
  { id: "studio", name: "Studio", monthlyCents: 2900, publishedSites: 10, monthlyUnits: 800 }
] as const;
export const creditPack = { cents: 500, credits: 100, currency: "USD" } as const;

/** Sum all model calls in an operation before rounding. Read-only tools cost zero. */
export function buildUnits(inputTokens: number, outputTokens: number): number {
  if (![inputTokens, outputTokens].every(value => Number.isSafeInteger(value) && value >= 0)) throw new Error("Invalid token usage");
  const weighted = inputTokens + outputTokens * 4;
  if (!Number.isSafeInteger(weighted)) throw new Error("Token usage overflow");
  return Math.ceil(weighted / 1000);
}
