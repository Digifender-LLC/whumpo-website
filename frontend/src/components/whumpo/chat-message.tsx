import type {ReactNode} from 'react';
import {cn} from '@/lib/utils';
// One chat turn from Whumpo or the customer. Whumpo's bubble is the soft sky tint;
// the customer's is a raised card aligned to the end.
export function ChatMessage({from,avatarSrc,time,label,children,className}:{from:'whumpo'|'you';avatarSrc?:string;time?:ReactNode;label?:ReactNode;children:ReactNode;className?:string}){
 const you=from==='you';
 return <article className={cn('flex items-end gap-2',you?'ml-auto max-w-[88%] justify-end':'max-w-full',className)}>
  {!you&&avatarSrc&&<img src={avatarSrc} alt="" width={32} height={32} className="size-8 shrink-0 rounded-full object-cover"/>}
  <div className={cn('flex min-w-0 flex-col gap-1',you&&'items-end')}>
   <div className={cn('min-w-0 max-w-full rounded-md px-4 py-2.5 text-body text-ink',you?'rounded-br-[4px] border border-line bg-surface-raised':'rounded-bl-[4px] bg-action-soft')}>
    {label&&<p className="mb-1 text-xs font-semibold text-ink-muted">{label}</p>}
    {children}
   </div>
   {time&&<p className="px-1 text-xs text-ink-muted">{time}</p>}
  </div>
 </article>;
}
// Shown under a reply that is still being written. Decorative: the live region announces the reply.
export function TypingDots(){
 return <div aria-hidden="true" data-typing-indicator className="inline-flex items-center gap-1.5 rounded-md rounded-bl-[4px] bg-action-soft px-4 py-3">{[0,1,2].map(i=><span key={i} style={{animationDelay:i*150+'ms'}} className="size-2 animate-pulse rounded-full bg-ink-muted"/>)}</div>;
}
