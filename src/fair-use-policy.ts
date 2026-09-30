/** Proposed launch thresholds. Shadow assessment only; not a customer quota or live blocker. */
export const fairUsePolicyVersion='site-maintenance-fair-use-v1';
export const fairUseThresholds={
 starter:{monitorCostMicros:3000000,reviewCostMicros:6000000,heavyCostMicros:10000000,monitorTurns7d:100,reviewTurns7d:250,churnCycles7d:3},
 personal:{monitorCostMicros:6000000,reviewCostMicros:12000000,heavyCostMicros:20000000,monitorTurns7d:250,reviewTurns7d:600,churnCycles7d:6},
 business:{monitorCostMicros:16000000,reviewCostMicros:32000000,heavyCostMicros:50000000,monitorTurns7d:750,reviewTurns7d:1800,churnCycles7d:12},
 'business-pro':{monitorCostMicros:28000000,reviewCostMicros:56000000,heavyCostMicros:90000000,monitorTurns7d:1500,reviewTurns7d:3500,churnCycles7d:20},
} as const;
export type FairUsePlan=keyof typeof fairUseThresholds;
export type FairUseEvidence={
 // Rolling standard-plan inference cost; excludes separately paid premium work.
 cost30dMicros:number;turns7d:number;
 // Only high-confidence classifications count; site-adjacent work is in-scope.
 classifiedTurns7d:number;unrelatedTurns7d:number;
 createdProjects7d:number;completedExportDeleteCycles7d:number;
 review:{unrelatedConfirmed:boolean;churnConfirmed:boolean;noticeDelivered:boolean;unrelatedAfterNotice:number;churnAfterNotice:number};
};
export function assessFairUse(plan:FairUsePlan,e:FairUseEvidence){
 const t=fairUseThresholds[plan];if(!t)throw Error('Fair-use plan is not configured');
 for(const n of [e.cost30dMicros,e.turns7d,e.classifiedTurns7d,e.unrelatedTurns7d,e.createdProjects7d,e.completedExportDeleteCycles7d,e.review.unrelatedAfterNotice,e.review.churnAfterNotice])if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid fair-use evidence');
 for(const v of [e.review.unrelatedConfirmed,e.review.churnConfirmed,e.review.noticeDelivered])if(typeof v!=='boolean')throw Error('Invalid fair-use review');
 if(e.classifiedTurns7d>e.turns7d||e.unrelatedTurns7d>e.classifiedTurns7d||e.completedExportDeleteCycles7d>e.createdProjects7d)throw Error('Inconsistent fair-use evidence');
 const monitored=e.cost30dMicros>=t.monitorCostMicros||e.turns7d>=t.monitorTurns7d;
 const reviewSpend=e.cost30dMicros>=t.reviewCostMicros||e.turns7d>=t.reviewTurns7d;
 const heavy=e.cost30dMicros>=t.heavyCostMicros||e.turns7d>=t.reviewTurns7d*2;
 // Volume/cost alone never establish misuse; brief/light use does not run this escalation.
 const unrelated=monitored&&e.classifiedTurns7d>=20&&BigInt(e.unrelatedTurns7d)*100n>=BigInt(e.classifiedTurns7d)*70n;
 const churn=monitored&&e.completedExportDeleteCycles7d>=t.churnCycles7d&&BigInt(e.completedExportDeleteCycles7d)*100n>=BigInt(e.createdProjects7d)*80n;
 const signals=[...(unrelated?['repeated_unrelated_chat']:[]),...(churn?['rapid_export_delete_cycles']:[])];
 const confirmedUnrelated=unrelated&&e.review.unrelatedConfirmed,confirmedChurn=churn&&e.review.churnConfirmed;
 const restrictions:string[]=[];
 if(heavy&&e.review.noticeDelivered){
  if(confirmedUnrelated&&e.review.unrelatedAfterNotice>=10)restrictions.push('unrelated_chat');
  if(confirmedChurn&&e.review.churnAfterNotice>=2)restrictions.push('new_project_generation');
 }
 const suggestedAction=restrictions.length?'restrict_flagged_requests':confirmedUnrelated||confirmedChurn?'explain_and_warn':signals.length?'review_behavior':reviewSpend?'review_legitimate_capacity':monitored?'observe':'none';
 return {policy:fairUsePolicyVersion,enforcementEnabled:false as const,plan,suggestedAction,signals,restrictions,
  preserve:['existing_site_maintenance','hosting','account_access','source_export','backups','deletion','appeal'],
  reason:restrictions.length?'confirmed_pattern_continued_after_notice':signals.length?'pattern_needs_context':reviewSpend?'cost_alone_is_not_abuse':monitored?'internal_monitoring_only':'light_usage',
 };
}
