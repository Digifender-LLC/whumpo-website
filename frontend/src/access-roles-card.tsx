import {useRef,useState} from 'react';
import type {AccessRoleFacts} from '../../src/shared-modules/shape';
import {Button} from './components/ui/button';
import {message} from './lib/api';
import {useWorkspace} from './workspace';

const states={inactive:'Disabled',active:'Active',suspended:'Suspended',migrating:'Migrating'} as const;
const day=(value:string)=>new Date(value).toLocaleDateString([],{year:'numeric',month:'short',day:'numeric'});
/** WH-126 staff roster. Buttons only prepare an exact review in Chat (accessRoleReview); the separate review card there
 * applies it after a recent sign-in. Opaque visitor ids and dates only: no credentials, documents or submitted values. */
export function AccessRolesCard({facts,projectId,owner}:{facts:AccessRoleFacts;projectId:string;owner:boolean}){
 const {runAction,commandBusy}=useWorkspace(),[error,setError]=useState(''),lock=useRef(false);
 async function review(instanceId:string,visitorId:string,action:'grant'|'revoke'){
  if(lock.current)return;lock.current=true;setError('');
  try{await runAction({type:'accessRoleReview',projectId,instanceId,visitorId,action});}catch(e){setError(message(e));}finally{lock.current=false;}
 }
 if(!facts.items.length)return <p className="text-sm text-muted-foreground">No visitor access module is active for this project.</p>;
 return <div className="space-y-4">{facts.items.map(i=><section key={i.localId} aria-label={i.localId+' staff roles'} className="space-y-2 rounded-md bg-background p-4 text-sm">
   <p className="font-semibold break-words">{i.localId} · {states[i.state]}</p>
   {!i.staffRole&&<p className="text-muted-foreground">This module does not declare the staff role.</p>}
   {!i.visitors.length&&<p className="text-muted-foreground">No enrolled visitors yet.</p>}
   <ul className="space-y-2">{i.visitors.map(v=><li key={v.visitorId} className="flex flex-wrap items-center gap-2">
    <span className="break-words">Visitor {v.visitorId.slice(0,8)} · enrolled {day(v.enrolledAt)}{v.revoked?' · access revoked':v.staff?` · staff${v.staffChangedAt?' since '+day(v.staffChangedAt):''}`:''}</span>
    {owner&&!v.revoked&&v.staff&&<Button type="button" variant="secondary" className="min-h-11" disabled={commandBusy} onClick={()=>void review(i.localId,v.visitorId,'revoke')}>Review staff removal</Button>}
    {owner&&!v.revoked&&!v.staff&&i.staffRole&&i.state==='active'&&<Button type="button" variant="secondary" className="min-h-11" disabled={commandBusy} onClick={()=>void review(i.localId,v.visitorId,'grant')}>Review staff grant</Button>}
   </li>)}</ul>
  </section>)}
  {error&&<p role="alert" className="text-sm">{error}</p>}
  <p className="text-xs text-muted-foreground">Each role change needs its own review in Chat. Staff never get workspace sign-in, Chat, publishing, spending or account management.</p>
 </div>;
}
