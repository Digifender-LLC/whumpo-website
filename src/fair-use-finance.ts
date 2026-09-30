import {fairUseMode} from './fair-use-mode';
export const companyCostCategories=['inference','hosting','domains','paymentFees','refunds','support','other'] as const;
type Costs=Record<typeof companyCostCategories[number],number|null>;
type Period={start:string;endExclusive:string;revenueMicros:number|null;costs:Costs;review:{complete:boolean;reviewedAt:string;evidenceDigest:string}};
export type CompanyFinanceInput={version:1;currency:'USD';basis:'earned-revenue-before-refunds-excluding-tax';previous:Period;current:Period};
const day=86400000;
function keys(v:unknown,expected:readonly string[]):asserts v is Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).length!==expected.length||expected.some(k=>!Object.hasOwn(v,k)))throw Error('Invalid finance summary shape');}
function date(value:unknown){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('Use UTC calendar dates');const ms=Date.parse(value+'T00:00:00.000Z');if(!Number.isSafeInteger(ms)||ms<0||new Date(ms).toISOString().slice(0,10)!==value)throw Error('Invalid finance period');return ms;}
function amount(value:unknown){if(value!==null&&(!Number.isSafeInteger(value)||typeof value!=='number'||value<0))throw Error('Use nonnegative integer USD millionths or null');}
function period(value:unknown,now:number):Period{
 keys(value,['start','endExclusive','revenueMicros','costs','review']);const start=date(value.start),end=date(value.endExclusive);if(end<=start||end>now)throw Error('Choose a closed finance period');
 amount(value.revenueMicros);keys(value.costs,companyCostCategories);for(const n of Object.values(value.costs))amount(n);
 keys(value.review,['complete','reviewedAt','evidenceDigest']);
 const review=value.review;if(typeof review.complete!=='boolean'||typeof review.reviewedAt!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(review.reviewedAt)||!Number.isSafeInteger(Date.parse(review.reviewedAt))||new Date(review.reviewedAt).toISOString()!==review.reviewedAt||Date.parse(review.reviewedAt)<end||Date.parse(review.reviewedAt)>now||typeof review.evidenceDigest!=='string'||!/^[a-f0-9]{64}$/.test(review.evidenceDigest))throw Error('A dated review and evidence digest are required');
 return value as unknown as Period;
}
function total(costs:Costs){if(Object.values(costs).some(n=>n===null))return null;const result=Object.values(costs).reduce<bigint>((sum,n)=>sum+BigInt(n!),0n);if(result>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Finance total exceeds supported precision');return Number(result);}
/** Operator-attested data only. Never feed this result into customer admission or billing. */
export function companyFinanceReview(input:unknown,now=Date.now()){
 if(!Number.isSafeInteger(now)||now<0)throw Error('Invalid comparison time');keys(input,['version','currency','basis','previous','current']);
 if(input.version!==1||input.currency!=='USD'||input.basis!=='earned-revenue-before-refunds-excluding-tax')throw Error('Unsupported company finance basis');
 const previous=period(input.previous,now),current=period(input.current,now);
 const missing=[previous,current].flatMap((p,i)=>[...(p.revenueMicros===null?[`${i?'current':'previous'}.revenue`]:[]),...companyCostCategories.filter(k=>p.costs[k]===null).map(k=>`${i?'current':'previous'}.${k}`)]);
 const summaries=[previous,current].map(p=>{const cost=total(p.costs);return {start:p.start,endExclusive:p.endExclusive,days:(date(p.endExclusive)-date(p.start))/day,revenueMicros:p.revenueMicros,costMicros:cost,profitMicros:cost!==null&&p.revenueMicros!==null?p.revenueMicros-cost:null,costs:p.costs};});
 let reason:string;
 if(missing.length)reason='missing_finance_categories';
 else if(!previous.review.complete||!current.review.complete)reason='company_wide_review_required';
 else if(previous.endExclusive!==current.start)reason='adjacent_periods_required';
 else if(now-date(current.endExclusive)>7*day)reason='closed_period_stale';
 else{
  const [p,c]=summaries;
  const result=fairUseMode('enforce',{verified:true,asOf:Date.parse(current.review.reviewedAt),previous:{revenueMicros:p.revenueMicros!,costMicros:p.costMicros!,days:p.days},current:{revenueMicros:c.revenueMicros!,costMicros:c.costMicros!,days:c.days}},now);
  reason=result.enforcementEligible?'profit_decline_needs_operator_review':result.reason;
 }
 const changes=companyCostCategories.map(category=>({category,changeMicros:previous.costs[category]!==null&&current.costs[category]!==null?current.costs[category]!-previous.costs[category]!:null}));
 return {version:1,asOf:new Date(now).toISOString(),currency:'USD',basis:input.basis,source:'operator_attested_summary',independentlyVerified:false,action:'observe_only',enforcementEnabled:false,activeRestrictions:[],reason,reviewSuggested:reason==='profit_decline_needs_operator_review',missing,previous:summaries[0],current:summaries[1],costChanges:changes,
  limitations:['Evidence digests are references, not proof that the underlying books are complete or correct.','No payment or provider statement reconciliation is connected.','Company cost changes do not establish misuse by any customer.','Monitor mode and customer request handling are unchanged.']};
}
