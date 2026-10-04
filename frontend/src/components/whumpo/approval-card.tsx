import type {ReactNode} from 'react';
import {cn} from '@/lib/utils';
import {Button} from '../ui/button';
import {StatusBadge} from './status-badge';
// Outcome, cost and risk in plain language before paid or risky work.
export function ApprovalCard({title,outcome,cost,risk,approveLabel='Approve',declineLabel='Not now',onApprove,onDecline,busy,children,className}:{title:ReactNode;outcome:ReactNode;cost:ReactNode;risk?:ReactNode;approveLabel?:ReactNode;declineLabel?:ReactNode;onApprove?:()=>void;onDecline?:()=>void;busy?:boolean;children?:ReactNode;className?:string}){
 return <section aria-label={typeof title==='string'?title:undefined} className={cn('max-w-[460px] rounded-lg border border-line bg-surface-raised p-5 text-ink shadow-lg',className)}>
  <div className="flex flex-col items-start gap-2"><StatusBadge status="attention">Needs your approval</StatusBadge><h3 className="font-sans text-lg leading-[26px] font-semibold">{title}</h3></div>
  <dl className="mt-4 mb-5 flex flex-col gap-3">
   <div><dt className="text-xs font-semibold tracking-[.08em] uppercase text-ink-muted">What happens</dt><dd className="mt-0.5 text-[15px] leading-[22px]">{outcome}</dd></div>
   <div><dt className="text-xs font-semibold tracking-[.08em] uppercase text-ink-muted">Cost</dt><dd className="mt-0.5 text-[15px] leading-[22px] font-semibold">{cost}</dd></div>
   {risk&&<div><dt className="text-xs font-semibold tracking-[.08em] uppercase text-ink-muted">Risk</dt><dd className="mt-0.5 text-[15px] leading-[22px]">{risk}</dd></div>}
  </dl>
  {children}
  {(onApprove||onDecline)&&<div className="flex flex-wrap gap-2">{onApprove&&<Button disabled={busy} onClick={onApprove}>{approveLabel}</Button>}{onDecline&&<Button variant="quiet" disabled={busy} onClick={onDecline}>{declineLabel}</Button>}</div>}
 </section>;
}
