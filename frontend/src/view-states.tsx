import type {ReactNode} from 'react';
import {Skeleton} from './components/ui/skeleton';

/** "2 min ago". Rendered once, not ticking: pages re-read often and the absolute time is always in the title. */
export function relativeAgo(value:string|number|Date,now=Date.now()){
 const t=new Date(value).getTime();if(!Number.isFinite(t))return '';
 const s=Math.max(0,Math.round((now-t)/1000));
 if(s<45)return 'just now';
 const m=Math.round(s/60);if(m<60)return `${m} min ago`;
 const h=Math.round(m/60);if(h<24)return `${h} hr ago`;
 const d=Math.round(h/24);return d<=30?`${d} ${d===1?'day':'days'} ago`:new Date(t).toLocaleDateString();
}
export function RelativeTime({value,prefix}:{value:string;prefix?:string}){
 const at=new Date(value);
 return <time dateTime={value} title={at.toLocaleString()}>{prefix?prefix+' ':''}{relativeAgo(value)}</time>;
}
/** Designed empty / denied state (D9): mascot, one sentence, optional second line and one action. */
export function StateNote({title,children,action,role='status'}:{title:string;children?:ReactNode;action?:ReactNode;role?:'status'|'alert'}){
 return <div role={role} className="flex items-start gap-3 rounded-md bg-surface-sunken p-4">
  <span aria-hidden="true" className="size-12 shrink-0 bg-[url(/brand/whumpo-mascot.png)] bg-contain bg-center bg-no-repeat"/>
  <div className="min-w-0 space-y-1"><p className="text-body-sm font-medium text-ink">{title}</p>{children&&<p className="text-body-sm text-ink-muted">{children}</p>}{action}</div>
 </div>;
}
/** Loading placeholder for a known layout. The label stays available to assistive technology. */
export function SkeletonCard({label,lines=3}:{label:string;lines?:number}){
 return <div role="status" aria-live="polite" className="space-y-3 rounded-md border border-line bg-surface-raised p-4">
  <span className="sr-only">{label}</span>
  <Skeleton className="h-5 w-1/3"/>
  {Array.from({length:lines},(_,i)=><Skeleton key={i} className={i===lines-1?'h-4 w-2/3':'h-4 w-full'}/>)}
 </div>;
}
