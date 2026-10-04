import type {ReactNode} from 'react';
import {cn} from '@/lib/utils';
import {Icon,type IconName} from './icon';
export type Status='ready'|'working'|'attention'|'idle';
// Colour is never the only signal: every status carries an icon and a word.
const statuses:Record<Status,{icon:IconName;label:string;className:string}>={
 ready:{icon:'check',label:'Ready',className:'bg-ready-soft text-ready-ink'},
 working:{icon:'clock',label:'Working',className:'bg-spark-soft text-spark-ink'},
 attention:{icon:'alert',label:'Needs you',className:'bg-attention-soft text-attention-ink'},
 idle:{icon:'spark',label:'Not started',className:'bg-surface-sunken text-ink-muted'},
};
export function StatusBadge({status='idle',children,className}:{status?:Status;children?:ReactNode;className?:string}){
 const s=statuses[status];
 return <span className={cn('inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-full pl-1.5 pr-2 text-xs font-medium',s.className,className)}><Icon name={s.icon} size={14}/>{children??s.label}</span>;
}
