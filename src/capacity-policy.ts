import { plans } from './plans';
export const capacityPolicy = {
 defaultPlan:'starter', automaticPlanChanges:false, overageChargingEnabled:false,
 overagePresetsCents:[0,1000,2500,5000,10000], downgradeHeadroomPercent:65,
 upgradePeriods:2, downgradePeriods:2, infrastructureBudgets:null, retailOverageTariff:null,
 dedicatedResourcesRequireSeparateApproval:true
} as const;
const integer=(n:number)=>{if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid amount');return n;};
/** Preview only; never grants entitlements or charges money. Keeps the renewal date. */
export function planChangeQuote(from:string,to:string,interval:'month'|'year',start:number,end:number,at:number){
 const a=plans.find(p=>p.id===from&&p.monthlyCents),b=plans.find(p=>p.id===to&&p.monthlyCents);
 if(!a||!b||!['month','year'].includes(interval)||![start,end,at].every(Number.isSafeInteger)||end<=start||at<start||at>=end)throw Error('Invalid plan quote');
 const old=interval==='year'?a.annualCents:a.monthlyCents,next=interval==='year'?b.annualCents:b.monthlyCents;
 const difference=BigInt(Math.max(0,next-old))*BigInt(end-at),duration=BigInt(end-start);
 return {kind:next>old?'upgrade':next<old?'downgrade':'unchanged',dueCents:Number((difference+duration-1n)/duration),effectiveAt:next>old?at:end,renewalAt:end,renewalCents:next,approvalRequired:true,checkoutEnabled:false};
}
export function capacityNotice(projectedPercent:number|null,sustained:boolean){
 if(projectedPercent===null)return 'unavailable';
 if(!Number.isFinite(projectedPercent)||projectedPercent<0)throw Error('Invalid capacity');
 return projectedPercent>=100?'capacity-review':projectedPercent>=90?'recommend-review':projectedPercent>=85?'inform':projectedPercent>=75&&sustained?'monitor':'comfortable';
}
export function overageNotice(usedCents:number,limitCents:number){
 integer(usedCents);integer(limitCents);
 if(!limitCents)return 'disabled';
 return usedCents>=limitCents?'cap':usedCents*100>=limitCents*94?'urgent':usedCents*100>=limitCents*80?'warning':usedCents*2>=limitCents?'inform':'within-limit';
}
/** Periods are verified, consecutive, fully closed billing cycles, oldest first.
 * Missing/incomplete periods prohibit recommendations. Costs are retail, not provider costs. */
export function recommendPlan(periods:{complete:boolean;currentTotalCents:number;candidateTotalCents:number;candidateCapacityPercent:number;periodEnd:number;periodStart:number}[],direction:'upgrade'|'downgrade'){
 const last=periods.slice(-2);
 if(last.length!==2||last.some(p=>!p.complete)||last[0].periodEnd!==last[1].periodStart)return {recommend:false,reason:'Need two consecutive complete billing periods'};
 for(const p of last){integer(p.currentTotalCents);integer(p.candidateTotalCents);if(!Number.isFinite(p.candidateCapacityPercent)||p.candidateCapacityPercent<0||p.periodEnd<=p.periodStart)throw Error('Invalid period');}
 const fits=last.every(p=>p.candidateCapacityPercent<=(direction==='downgrade'?65:100));
 const savings=last.every(p=>p.candidateTotalCents<p.currentTotalCents);
 return {recommend:fits&&savings,reason:fits&&savings?'Lower projected bill with sufficient capacity':'Keep current plan',approvalRequired:true};
}
