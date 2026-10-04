import {useState} from 'react';
import {StripePricingTable} from './stripe-pricing-table';

type Audience = 'personal' | 'business';
type BillingInterval = 'monthly' | 'annual';

function Switch<T extends string>({label, value, options, onChange}: {label:string; value:T; options:{value:T; label:string}[]; onChange:(value:T)=>void}) {
  return <div className="flex items-center gap-3 flex-wrap justify-center"><span className="text-sm font-semibold text-[#526780]">{label}</span><div role="group" aria-label={label} className="pricing-switch"><span aria-hidden="true" className={'pricing-switch-indicator '+(value===options[1].value?'pricing-switch-indicator-right':'')}/>{options.map(option=><button key={option.value} type="button" aria-pressed={value===option.value} onClick={()=>onChange(option.value)} className={'pricing-switch-option '+(value===option.value?'text-white':'text-[#526780] hover:text-[#0f2d5b]')}>{option.label}</button>)}</div></div>;
}

export function Pricing() {
  const [audience,setAudience]=useState<Audience>('personal');
  const [billingInterval,setBillingInterval]=useState<BillingInterval>('monthly');
  return <section id="pricing" className="landing-container py-24" aria-labelledby="pricing-heading">
    <div className="text-center"><p className="text-xs font-bold tracking-[.18em] text-[#206fb7]">ROOM FOR YOUR NEXT CHAPTER</p><h2 id="pricing-heading" className="mt-4 text-4xl font-bold sm:text-5xl">Start small. Dream bigger.</h2><p className="mt-4 text-[#526780]">Find room for your next idea. The invite-only preview is free; paid plans are not available yet.</p></div>
    <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
      <Switch label="Plans for" value={audience} options={[{value:'personal',label:'Personal'},{value:'business',label:'Business'}]} onChange={setAudience}/>
      <Switch label="Billing" value={billingInterval} options={[{value:'monthly',label:'Monthly'},{value:'annual',label:'Annual'}]} onChange={setBillingInterval}/>
    </div>
    <div className={'mt-9 '+(audience==='personal'?'mx-auto max-w-4xl':'')}><StripePricingTable audience={audience} billingInterval={billingInterval}/></div>
    <p className="mx-auto mt-7 max-w-3xl text-center text-xs text-[#526780]">{billingInterval==='annual'?'Annual plans save two months and propose eligible standard domains up to $20/year wholesale each. Premium domains are excluded; redemption is not available yet. ':''}Plan changes and future spending require your approval.</p>
  </section>;
}
