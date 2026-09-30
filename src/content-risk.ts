/** Internal planning policy. Inputs must come from trusted, tenant-scoped safety records.
 * Not a classifier, scan receipt, publication permission, or account-ban decision. */
export const contentRiskPolicyVersion = 'content-risk-2026-09-30-v1';
export type ContentRiskEvent = {
  userId: string;
  incidentId: string;
  occurredAt: number;
  kind: 'verified_benign' | 'uncertain_flag' | 'confirmed_violation' | 'confirmed_evasion' | 'critical_incident';
  disposition: 'active' | 'overturned';
};
export type ContentRiskHistory = {
  userId: string;
  complete: boolean;
  currentContentFlag?: boolean;
  events: readonly ContentRiskEvent[];
};
const day = 86_400_000;
const weights = {verified_benign:0, uncertain_flag:3, confirmed_violation:15, confirmed_evasion:25, critical_incident:100} as const;

export function assessContentRisk(history: ContentRiskHistory, now = Date.now()) {
  if (typeof history.userId !== 'string' || !history.userId || (history.currentContentFlag !== undefined && typeof history.currentContentFlag !== 'boolean') || typeof history.complete !== 'boolean' || !Number.isSafeInteger(now) || now < 0 || !Array.isArray(history.events) || history.events.length > 10000) throw Error('Invalid content-risk history');
  // One incident can produce several retries/detectors. Count its strongest active signal once.
  const incidents = new Map<string, ContentRiskEvent>();
  const overturned = new Set<string>();
  for (const event of history.events as readonly ContentRiskEvent[]) {
    if (event.userId !== history.userId || typeof event.incidentId !== 'string' || !/^[a-zA-Z0-9_.:-]{1,128}$/.test(event.incidentId) || !Object.hasOwn(weights,event.kind) || !['active','overturned'].includes(event.disposition) || !Number.isSafeInteger(event.occurredAt) || event.occurredAt < 0 || event.occurredAt > now) throw Error('Invalid content-risk event');
    if (event.disposition === 'overturned') { overturned.add(event.incidentId); continue; }
    const old = incidents.get(event.incidentId);
    if (!old || weights[event.kind] > weights[old.kind] || (weights[event.kind] === weights[old.kind] && event.occurredAt < old.occurredAt)) incidents.set(event.incidentId,event);
  }
  let points = 0, uncertainty = 0, recentConfirmed = 0, benign = 0;
  const benignDays = new Set<number>();
  let critical = false;
  for (const event of incidents.values()) {
    if (overturned.has(event.incidentId)) continue;
    const age = (now - event.occurredAt) / day;
    if (event.kind === 'critical_incident') { critical = true; continue; }
    if (age > 90) continue;
    if (event.kind === 'verified_benign') {
      if (age <= 30) { benign++; benignDays.add(Math.floor(event.occurredAt / day)); }
      continue;
    }
    const contribution = weights[event.kind] * 2 ** (-age / 30);
    if (event.kind === 'uncertain_flag') uncertainty += contribution;
    else { points += contribution; if (age <= 7) recentConfirmed++; }
  }
  // Uncertain classifiers cannot alone put a customer in a high-risk category.
  const score = critical ? 100 : Math.min(100, Math.round(points + Math.min(10,uncertainty) + Math.min(20,Math.max(0,recentConfirmed - 1)*10)));
  const band = score >= 80 ? 'review' : score >= 50 ? 'high' : score >= 20 ? 'elevated' : 'low';
  const established = history.complete && !history.currentContentFlag && !critical && points === 0 && uncertainty === 0 && benign >= 20 && benignDays.size >= 7;
  const enhanced = !history.complete || history.currentContentFlag === true || score >= 20;
  return {
    policy: contentRiskPolicyVersion, score, band, established,
    historyComplete: history.complete,
    // These percentages are planning defaults, not a calibrated probability of abuse.
    supplementalTextScanPercent: enhanced ? 100 : established ? 5 : 25,
    generatedArtifactScanPercent: enhanced || !established ? 100 : 10,
    baseline: {agentPolicyAlways:true, mediaChecksAlways:true, importedCodeChecksAlways:true, publicationGatesAlways:true},
    reviewRequired: critical || score >= 80,
    unresolvedCriticalIncident: critical,
    automaticAccountBlock: false,
    enforcementEnabled: false,
  } as const;
}
