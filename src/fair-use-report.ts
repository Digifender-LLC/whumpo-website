import {assessFairUse,fairUseThresholds,type FairUsePlan} from './fair-use-policy';
import {fairUseMode,type FairUseMode} from './fair-use-mode';
/** Operator-only aggregate report. Never mount this on a customer API or send it to a model. */
export async function fairUseReport(db:Pick<D1Database,'prepare'>,owner?:string,now=Date.now()){
 if(owner!==undefined&&!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(owner))throw Error('Invalid account identifier');
 if(!Number.isSafeInteger(now)||now<0)throw Error('Invalid report time');
 const end=new Date(now).toISOString(),start7=new Date(now-7*86400000).toISOString(),start30=new Date(now-30*86400000).toISOString();
 const control=await db.prepare('SELECT requested_mode FROM fair_use_control WHERE id=1').first<{requested_mode:FairUseMode}>();
 if(!control)throw Error('Monitor configuration unavailable');
 const mode=fairUseMode(control.requested_mode,undefined,now);
 // Aggregate before joining: project counts cannot multiply inference cost or turns.
 // Plan receipts, not the old billing_accounts.plan_id cache, are authoritative.
 const {results}=await db.prepare(`WITH
 turns AS (SELECT user_id,COUNT(*) n FROM chat_turns WHERE mode='ai' AND status='completed' AND created_at>=? AND created_at<=? GROUP BY user_id),
 lifecycle AS (SELECT user_id,COUNT(*) n,SUM(CASE WHEN ai_saved_at>=created_at AND export_prepared_at>=ai_saved_at AND removed_at>=export_prepared_at AND removed_at<=? AND julianday(removed_at)-julianday(created_at)<=3 THEN 1 ELSE 0 END) cycles FROM fair_use_project_lifecycle WHERE created_at>=? AND created_at<=? GROUP BY user_id),
 shadow AS (SELECT c.user_id,SUM(c.estimated_micros) micros FROM inference_calls c JOIN chat_turns t ON t.id=c.turn_id AND t.user_id=c.user_id WHERE c.cost_basis='subscription-shadow' AND c.status='observed' AND t.status='completed' AND c.created_at>=? AND c.created_at<=? GROUP BY c.user_id)
 SELECT COALESCE((SELECT c.id FROM plan_grants g JOIN plan_catalog c ON c.id=g.plan_id WHERE g.user_id=u.id AND g.period=? ORDER BY c.tier DESC,c.monthly_units DESC,c.published_sites DESC,c.id LIMIT 1),'explore') plan,
 COALESCE(t.n,0) turns,COALESCE(l.n,0) projects,COALESCE(l.cycles,0) cycles,COALESCE(s.micros,0) shadow
 FROM users u LEFT JOIN turns t ON t.user_id=u.id LEFT JOIN lifecycle l ON l.user_id=u.id LEFT JOIN shadow s ON s.user_id=u.id
 WHERE (? IS NULL OR u.id=?) ORDER BY u.id LIMIT 1001`).bind(start7,end,end,start7,end,start30,end,end.slice(0,7),owner??null,owner??null).all<{plan:string;turns:number;projects:number;cycles:number;shadow:number}>();
 if(results.length>1000)throw Error('Report exceeds supported account count');
 if(owner&&results.length!==1)throw Error('Account not found');
 const empty=()=>({accounts:0,completedAITurns7d:0,createdProjects7d:0,observedExportRemovalCycles7d:0,museShadowMicros30d:0,observationCandidates:0,reviewCandidates:0,behaviorSignals:0,unassessedAccounts:0});
 const totals=empty(),byPlan:Record<string,ReturnType<typeof empty>>={};let accountAssessment:ReturnType<typeof assessFairUse>|null=null;
 for(const row of results){
  for(const value of [row.turns,row.projects,row.cycles,row.shadow])if(!Number.isSafeInteger(value)||value<0)throw Error('Invalid report aggregate');
  if(!['explore','launch','studio',...Object.keys(fairUseThresholds)].includes(row.plan))throw Error('Unknown entitlement');
  const assessed=Object.hasOwn(fairUseThresholds,row.plan)?assessFairUse(row.plan as FairUsePlan,{cost30dMicros:0,turns7d:row.turns,classifiedTurns7d:0,unrelatedTurns7d:0,createdProjects7d:row.projects,completedExportDeleteCycles7d:row.cycles,review:{unrelatedConfirmed:false,churnConfirmed:false,noticeDelivered:false,unrelatedAfterNotice:0,churnAfterNotice:0}},{mode:control.requested_mode,now}):null;
  if(owner)accountAssessment=assessed;
  for(const group of [totals,byPlan[row.plan]??=empty()]){
   group.accounts++;group.completedAITurns7d+=row.turns;group.createdProjects7d+=row.projects;group.observedExportRemovalCycles7d+=row.cycles;group.museShadowMicros30d+=row.shadow;
   if(!assessed)group.unassessedAccounts++;
   else {if(assessed.suggestedAction!=='none')group.observationCandidates++;if(!['none','observe'].includes(assessed.suggestedAction))group.reviewCandidates++;if(assessed.signals.length)group.behaviorSignals++;}
   if(Object.values(group).some(value=>!Number.isSafeInteger(value)))throw Error('Report aggregate overflow');
  }
 }
 return {asOf:end,scope:owner?'one_account':'all_accounts',mode,activeRestrictions:[],windows:{activityFrom:start7,costFrom:start30},totals,byPlan,...(owner?{accountAssessment}:{}),economics:{verified:false,revenueMicros:null,costMicros:null,profitMicros:null,reason:'Financial reporting is not connected. Plan prices and Muse shadow estimates are not revenue or actual expense.'},coverage:{purpose:'not_classified',providerExpense:'not_attributed',exports:'archive_preparation_not_download_confirmation',projectRemoval:'database_deletion_only_no_customer_removal_flow',exploreAndLegacy:'no_launch_fair_use_policy_applied',consistency:'Read-only observation at query time; not an audited financial snapshot.'}};
}
