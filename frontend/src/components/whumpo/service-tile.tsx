import type {ReactNode} from 'react';
import {cn} from '@/lib/utils';
import {Icon,type IconName} from './icon';
import {StatusBadge,type Status} from './status-badge';
// One service in "Your online presence".
export function ServiceTile({name,icon='globe',status='ready',statusLabel,className}:{name:ReactNode;icon?:IconName;status?:Status;statusLabel?:ReactNode;className?:string}){
 return <div className={cn('flex min-w-0 items-center gap-3 rounded-md border border-line bg-surface-raised px-4 py-3',className)}>
  <span className="grid size-10 shrink-0 place-items-center rounded-sm bg-action-soft text-link"><Icon name={icon}/></span>
  <span className="flex min-w-0 flex-col items-start gap-0.5"><span className="text-body-sm font-semibold break-words">{name}</span><StatusBadge status={status}>{statusLabel}</StatusBadge></span>
 </div>;
}
