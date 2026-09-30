/** Economics gate for a proposed fair-use enforcement decision; never a billing calculation. */
export type FairUseMode='monitor'|'enforce';
export type FairUseEconomics={
 verified:boolean;asOf:number;
 previous:{revenueMicros:number;costMicros:number;days:number};
 current:{revenueMicros:number;costMicros:number;days:number};
};
export function fairUseMode(requested:FairUseMode,economics:FairUseEconomics|undefined,now=Date.now()){
 if(!['monitor','enforce'].includes(requested)||!Number.isSafeInteger(now)||now<0)throw Error('Invalid fair-use mode');
 const result=(eligible:boolean,reason:string)=>({requested,mode:eligible?'enforce' as const:'monitor' as const,enforcementEligible:eligible,reason});
 if(requested==='monitor')return result(false,'operator_monitor_mode');
 if(!economics||economics.verified!==true)return result(false,'verified_economics_required');
 const e=economics;for(const n of [e.asOf,e.previous.revenueMicros,e.previous.costMicros,e.previous.days,e.current.revenueMicros,e.current.costMicros,e.current.days])if(!Number.isSafeInteger(n)||n<0)throw Error('Invalid fair-use economics');
 if(e.asOf>now||now-e.asOf>7*86400000)return result(false,'economics_stale');
 if(e.previous.days<28||e.current.days!==e.previous.days||e.previous.days>31||!e.previous.revenueMicros||!e.current.revenueMicros)return result(false,'comparable_periods_required');
 const before=BigInt(e.previous.revenueMicros),after=BigInt(e.current.revenueMicros),change=after>before?after-before:before-after;
 // Initial review tolerances: revenue within 5%, margin down at least 5 percentage
 // points, and absolute profit lower. These trigger eligibility, never auto-enable.
 if(change*100n>before*5n)return result(false,'revenue_changed');
 const previousProfit=before-BigInt(e.previous.costMicros),currentProfit=after-BigInt(e.current.costMicros);
 if(currentProfit>=previousProfit||100n*(previousProfit*after-currentProfit*before)<5n*before*after)return result(false,'profit_decline_not_established');
 return result(true,'operator_enabled_with_profit_decline');
}
