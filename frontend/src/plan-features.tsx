import {useState} from 'react';
import {publicPlans} from '../../src/plans';
import {commonFeatureNotice,connectionProviderNames,guestFeedbackNotice,launchAvailabilityNotice,launchFeatureCatalogue,launchPackaging} from '../../src/plan-features';

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
