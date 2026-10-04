/** Pure WH-037 fact shape shared by the server read binding, the shared client validator and the owner card.
 * Owner-scoped aggregates only: no visitor identifier, request header, form body, address or provider credential. */
export type TelemetryState='unavailable'|'not_published'|'delayed'|'gaps'|'partial'|'complete';
export type TrafficTelemetry={windowStart:string;windowEnd:string;coveredFrom:string|null;retentionDays:30;currentDayPartial:true;projects:{projectId:string;state:TelemetryState;excludedRequests:number;missedMeasurements:number;lastGapAt:string|null}[]};
export type Severity='ok'|'info'|'attention';
export type Area='publication'|'health'|'domain'|'form'|'traffic';
export type HealthStatus='unpublished'|'not_checked'|'changed'|'checking'|'interrupted'|'stale'|'healthy'|'unhealthy'|'superseded';
export type DomainState='none'|'awaiting_dns'|'ownership_verified'|'proof_expired'|'review'|'creating'|'uncertain'|'provisioning'|'active'|'needs_check'|'disconnecting'|'disconnected';
export type Finding={area:Area;code:string;severity:Severity;message:string;action:{label:string;command:string}|null};
export type ProjectDiagnostics={
 projectId:string;name:string;
 publication:{state:'published'|'unpublished';versionId:string|null;revision:number|null;evidenceAt:string|null};
 health:{status:HealthStatus;detail:string|null;checkedAt:string|null;evidenceAt:string|null};
 domain:{state:DomainState;hostname:string|null;providerStatus:string;certificateStatus:string;evidenceAt:string|null};
 form:{state:'not_enabled'|'live'|'not_live';contact:'off'|'live'|'needs_republish'|'held';submissionsRetained:number;evidenceAt:string|null};
 traffic:{state:TelemetryState;requests:number;excludedRequests:number;missedMeasurements:number;windowStart:string;windowEnd:string;evidenceAt:string};
 findings:Finding[];
};
export type SiteDiagnosticsFacts={items:ProjectDiagnostics[];retentionDays:30;healthEvidenceMaxAgeHours:6};
export const healthStatuses:readonly HealthStatus[]=['unpublished','not_checked','changed','checking','interrupted','stale','healthy','unhealthy','superseded'];
export const domainStates:readonly DomainState[]=['none','awaiting_dns','ownership_verified','proof_expired','review','creating','uncertain','provisioning','active','needs_check','disconnecting','disconnected'];
export const telemetryStates:readonly TelemetryState[]=['unavailable','not_published','delayed','gaps','partial','complete'];
/** Closed command vocabulary: read-only reports and owner-run checks that already exist as Chat shortcuts. Never a mutation. */
export const recommendedCommand=/^\/(?:health|check-site|project|check-hosting|verify-domain) [0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$|^\/(?:hosting|domains|traffic)$/;

export const telemetryText:Record<TelemetryState,string>={
 unavailable:'Measurement is not available, so no request count can be trusted.',
 not_published:'The website is not published, so no new requests are expected.',
 delayed:'Some recent measurements failed or were shed and may still be late. Counts are a lower bound.',
 gaps:'Some measurements in this window were missed. Counts are a lower bound.',
 partial:'Collection began inside this window, so earlier days are not measured.',
 complete:'No measurement gaps were recorded. Today is still partial.'
};
