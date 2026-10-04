import {cn} from '@/lib/utils';
import {Icon} from './icon';
export type ProgressStep={label:string;state?:'done'|'active'|'pending'};
// Real workflow progress: the ring fills only as steps complete.
export function ProgressCard({title,steps,percent,className}:{title:string;steps:ProgressStep[];percent?:number;className?:string}){
 const done=steps.filter(s=>s.state==='done').length,value=Math.max(0,Math.min(100,percent??(steps.length?done/steps.length*100:0)));
 const r=26,c=2*Math.PI*r;
 return <section className={cn('rounded-lg border border-line bg-surface-raised p-5 text-ink shadow-md',className)}>
  <h3 className="font-sans text-lg leading-[26px] font-semibold">{title}</h3>
  <div className="mt-4 flex items-center gap-5">
   <div role="progressbar" aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100} aria-label={title} className="relative size-16 shrink-0">
    <svg width="64" height="64" viewBox="0 0 64 64" className="block"><circle cx="32" cy="32" r={r} fill="none" strokeWidth="7" className="stroke-action-soft"/><circle cx="32" cy="32" r={r} fill="none" strokeWidth="7" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c*(1-value/100)} transform="rotate(-90 32 32)" className="stroke-action transition-[stroke-dashoffset] duration-400 ease-out"/></svg>
    <span className="absolute inset-0 grid place-items-center text-sm font-semibold">{Math.round(value)}%</span>
   </div>
   <ol className="flex flex-col gap-1.5 text-sm">{steps.map((s,i)=>{const state=s.state??'pending';return <li key={i} className={cn('flex items-center gap-2',state==='done'&&'text-ready-ink',state==='active'&&'font-medium text-link',state==='pending'&&'text-ink-muted')}>
    {state==='done'?<Icon name="check" size={16}/>:state==='active'?<Icon name="clock" size={16}/>:<span aria-hidden="true" className="size-4 shrink-0 rounded-full border-2 border-line-strong"/>}
    <span className={state==='pending'?undefined:'text-ink'}>{s.label}</span><span className="sr-only">{state==='done'?' (done)':state==='active'?' (in progress)':' (not started)'}</span>
   </li>;})}</ol>
  </div>
 </section>;
}
