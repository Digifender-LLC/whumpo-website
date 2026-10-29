import {useState} from 'react';
import {Check} from 'lucide-react';
import {publicPlans} from '../../src/plans';
import {commonFeatureNotice,connectionProviderNames,guestFeedbackNotice,launchAvailabilityNotice,launchFeatureCatalogue,launchHighlights,launchPackaging} from '../../src/plan-features';

export function PlanFeatureDetails({planId}:{planId:string}) {
  const packaging=launchPackaging(planId),plan=publicPlans.find(p=>p.id===planId);
  if(!packaging||!plan||planId==='explore')return null;
  const included=new Set<string>(packaging.featureIds),parent=publicPlans.find(p=>p.id===packaging.inherits);
  return <details className="min-w-0 rounded-md border border-current/15 p-4 text-sm">
    <summary className="min-h-11 cursor-pointer content-center rounded-md font-semibold focus-visible:outline-2 focus-visible:outline-offset-4">{plan.name}: planned features</summary>
    <div className="mt-3 space-y-4 leading-relaxed">
      {parent&&<p>Everything in {parent.name}, plus more.</p>}
      <p>{launchAvailabilityNotice}</p>
      <ul className="space-y-3">{launchFeatureCatalogue.features.filter(f=>included.has(f.id)).map(f=><li key={f.id}>
        <span className="block font-medium">{f.name}</span>
        <span className="block text-xs opacity-75">{f.implementation==='planned'?'Planned — not available yet':'In testing — launch availability pending'}{f.connection?' · Setup and customer consent required':''}</span>
      </li>)}</ul>
      <p>{packaging.externalConnections?`Planned connections: ${connectionProviderNames}.`:'External account connections are not included. Custom domains, source downloads and Whumpo sign-in are separate.'}</p>
      {included.has('creator.guest-feedback')&&<p>{guestFeedbackNotice}</p>}
      <p>{commonFeatureNotice}</p>
    </div>
  </details>;
}

/** Selection remains a draft preference; changing it grants no access or spending. */
export function PlanPreferenceField({initialPlan}:{initialPlan:string}) {
  const [selected,setSelected]=useState(initialPlan);
  return <div className="min-w-0 space-y-4">
    <label className="grid gap-2 text-sm font-medium">Preferred launch plan
      <select className="min-h-11 w-full min-w-0 rounded-md border bg-background px-3" name="plan" value={selected} onChange={e=>setSelected(e.target.value)}>
        {publicPlans.filter(p=>p.monthlyCents).map(p=><option key={p.id} value={p.id}>{p.name} · ${p.monthlyCents/100}/month</option>)}
      </select>
    </label>
    <PlanFeatureDetails planId={selected}/>
  </div>;
}

const audiencePlans={personal:['starter','personal'],business:['business','business-pro']} as const;
const recommendedPlan={personal:'personal',business:'business'} as const;
const dollars=(cents:number)=>'$'+cents/100;

/** Native plan cards from the draft catalogue. Display only: nothing here grants access or starts a purchase. */
export function PlanCards({audience,billingInterval}:{audience:'personal'|'business';billingInterval:'monthly'|'annual'}) {
  const plans=audiencePlans[audience].map(id=>publicPlans.find(p=>p.id===id)!);
  return <ul className={'grid list-none gap-6 p-0 md:grid-cols-2'}>
    {plans.map(plan=>{
      const recommended=recommendedPlan[audience]===plan.id,annual=billingInterval==='annual';
      return <li key={plan.id} className={'flex min-w-0 flex-col gap-4 rounded-xl border bg-surface-raised p-6 shadow-sm '+(recommended?'border-action':'border-line')}>
        <div className="flex min-h-8 flex-wrap items-center justify-between gap-2">
          <h3 className="font-sans text-heading text-ink">{plan.name}</h3>
          {recommended&&<span className="inline-flex h-6 items-center rounded-full bg-action-soft px-2 text-caption font-semibold text-ink">Recommended</span>}
        </div>
        <p className="text-caption font-semibold text-ink-muted">Planned launch pricing — not available yet</p>
        <p className="text-title text-ink">{dollars(annual?plan.annualCents:plan.monthlyCents)}<span className="text-body-sm font-normal text-ink-muted">{annual?' / year':' / month'}</span></p>
        <ul className="grid list-none gap-2 p-0 text-body-sm text-ink">
          {launchHighlights[plan.id as keyof typeof launchHighlights].slice(0,3).map(h=><li key={h} className="flex gap-2"><Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ready-ink"/>{h}</li>)}
        </ul>
        <div className="mt-auto"><PlanFeatureDetails planId={plan.id}/></div>
      </li>;
    })}
  </ul>;
}
