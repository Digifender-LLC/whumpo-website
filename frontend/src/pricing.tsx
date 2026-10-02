import {useState} from 'react';
import {Check} from 'lucide-react';
import {Button} from './components/ui/button';
import {StripePricingTable} from './stripe-pricing-table';

type Audience = 'personal' | 'business';
type BillingInterval = 'monthly' | 'annual';

function Switch<T extends string>({label, value, options, onChange}: {label:string; value:T; options:{value:T; label:string}[]; onChange:(value:T)=>void}) {
  return <div className="flex items-center gap-3 flex-wrap justify-center"><span className="text-sm font-semibold text-[#526780]">{label}</span><div role="group" aria-label={label} className="pricing-switch"><span aria-hidden="true" className={'pricing-switch-indicator '+(value===options[1].value?'pricing-switch-indicator-right':'')}/>{options.map(option=><button key={option.value} type="button" aria-pressed={value===option.value} onClick={()=>onChange(option.value)} className={'pricing-switch-option '+(value===option.value?'text-white':'text-[#526780] hover:text-[#0f2d5b]')}>{option.label}</button>)}</div></div>;
}

function Features({items}: {items:string[]}) {
  return <ul className="my-7 space-y-3 text-sm">{items.map(item=><li key={item} className="flex gap-2"><Check aria-hidden="true" className="size-4 shrink-0 mt-0.5 text-[#338cdf]"/><span>{item}</span></li>)}</ul>;
}

function EnterpriseCard() {
  return <article className="flex min-w-0 flex-col rounded-3xl border border-[#dce6ef] bg-transparent p-6">
    <h3 className="text-xl font-extrabold">Enterprise</h3>
    <p className="mt-6 text-4xl font-bold tracking-tight">Custom</p>
    <p className="mt-1 min-h-6 text-sm text-[#526780]">Pricing and terms tailored to your team</p>
    <Features items={['SSO integrations planned','Custom integrations for your needs','Deployment and capacity scoped together']}/>
    <Button variant="outline" className="mt-auto w-full rounded-full bg-white" disabled>Contact us</Button>
    <p className="mt-3 text-center text-xs text-[#526780]">Sales contact is not connected yet.</p>
  </article>;
}

export function Pricing() {
  const [audience,setAudience]=useState<Audience>('personal');
  const [billingInterval,setBillingInterval]=useState<BillingInterval>('monthly');
  return <section id="pricing" className="landing-container py-24" aria-labelledby="pricing-heading">
    <div className="text-center"><p className="text-xs font-bold tracking-[.18em] text-[#338cdf]">ROOM FOR YOUR NEXT CHAPTER</p><h2 id="pricing-heading" className="mt-4 text-4xl font-extrabold sm:text-5xl">Start small. Dream bigger.</h2><p className="mt-4 text-[#526780]">Find room for your next idea. The invite-only preview is free; paid plans are not available yet.</p></div>
    <div className="mt-10 flex flex-wrap items-center justify-center gap-x-8 gap-y-4">
      <Switch label="Plans for" value={audience} options={[{value:'personal',label:'Personal'},{value:'business',label:'Business'}]} onChange={setAudience}/>
      <Switch label="Billing" value={billingInterval} options={[{value:'monthly',label:'Monthly'},{value:'annual',label:'Annual'}]} onChange={setBillingInterval}/>
    </div>
    <div className={'mt-9 grid gap-4 '+(audience==='personal'?'mx-auto max-w-4xl md:grid-cols-2':'md:grid-cols-3')}><StripePricingTable audience={audience} billingInterval={billingInterval}/>{audience==='business'&&<EnterpriseCard/>}</div>
    <p className="mx-auto mt-7 max-w-3xl text-center text-xs text-[#526780]">{billingInterval==='annual'?'Annual plans save two months and propose eligible standard domains up to $20/year wholesale each. Premium domains are excluded; redemption is not available yet. ':''}Plan changes and future spending require your approval.</p>
  </section>;
}
