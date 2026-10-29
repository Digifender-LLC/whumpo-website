import {useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {api,send,message,queryClient,APIError} from './lib/api';
import {useWorkspace} from './workspace';
import {Button} from './components/ui/button';
import {Input} from './components/ui/input';
import {Field} from './workspace-layout';
import {Skeleton} from './components/ui/skeleton';
import {StatusBadge} from './components/whumpo/status-badge';
import {Deadline} from './lib/time-ago';

type EmailState={version:1;email:string;verified:boolean;pending:{changeId:string;expiresAt:number}|null;undo:{changeId:string;until:number}|null;deliveryAvailable:boolean};
type ChangeResult={status:string;changeId?:string;expiresAt?:number};
const when=(ms:number)=>new Date(ms).toLocaleString();
/** Text for a change request answer; delivery_unavailable means nothing was stored. */
export const changeText=(r:ChangeResult)=>r.status==='delivery_unavailable'?'Email confirmation is not connected yet. Nothing was changed.':r.status==='pending-confirmation'?'Confirmation sent. Paste the code from the email below before '+when(r.expiresAt??0)+'.':'This request could not finish.';

export function AccountEmailView({state,busy,result,onChange,onConfirm,onCancel,onUndo}:{state:EmailState;busy:boolean;result:string;onChange:(address:string)=>void;onConfirm:(token:string)=>void;onCancel:()=>void;onUndo:()=>void}){
 const [token,setToken]=useState('');
 return <div className="grid gap-5">
  <p className="text-body-sm">Current address: <strong>{state.email}</strong> <StatusBadge status={state.verified?'ready':'attention'} className="ml-1 align-middle">{state.verified?'Verified':'Not verified yet'}</StatusBadge></p>
  {!state.deliveryAvailable&&<p className="text-body-sm text-ink-muted">Email confirmation is not connected yet, so email change requests are paused.</p>}
  <form className="grid gap-3" onSubmit={e=>{e.preventDefault();onChange(String(new FormData(e.currentTarget).get('newAddress')??''))}}><Field label="New email address"><Input name="newAddress" type="email" autoComplete="email" required maxLength={254}/></Field><Button variant={state.pending?'secondary':'primary'} className="justify-self-start min-h-11" disabled={busy}>Send confirmation</Button></form>
  {state.pending&&<form className="grid gap-3" onSubmit={e=>{e.preventDefault();const t=token.trim();setToken('');onConfirm(t)}}><p className="text-body-sm">A change is waiting for confirmation until <Deadline value={state.pending.expiresAt}/>.</p><Field label="Confirmation code from the email"><Input value={token} onChange={e=>setToken(e.target.value)} autoComplete="off" spellCheck={false} required/></Field><div className="flex flex-wrap gap-3"><Button className="min-h-11" disabled={busy||!token.trim()}>Confirm</Button><Button type="button" variant="secondary" className="min-h-11" disabled={busy} onClick={onCancel}>Cancel</Button></div></form>}
  {state.undo&&<div className="grid gap-3"><p className="text-body-sm">You can undo the last email change until <Deadline value={state.undo.until}/>.</p><Button type="button" variant="secondary" className="min-h-11 justify-self-start" disabled={busy} onClick={onUndo}>Undo email change</Button></div>}
  {result&&<p className="text-body-sm" role="status">{result}</p>}
 </div>;
}

/** Direct owner control for WH-201; tokens live only in the confirm input's state. */
export function AccountEmailSettings(){
 const {notify}=useWorkspace(),[busy,setBusy]=useState(false),[result,setResult]=useState(''),attempt=useRef<{address:string;id:string}|null>(null);
 const q=useQuery({queryKey:['account-email'],queryFn:()=>api<EmailState>('/account/email')});
 async function run(action:()=>Promise<string>){setBusy(true);try{const text=await action();setResult(text);notify(text);await queryClient.invalidateQueries({queryKey:['account-email']});await queryClient.invalidateQueries({queryKey:['session']});}catch(e){const text=message(e);setResult(text);notify(text);if(e instanceof APIError)attempt.current=null;}finally{setBusy(false)}}
 if(q.isPending)return <div role="status" className="grid gap-3"><span className="sr-only">Loading your email settings.</span><Skeleton className="h-6 w-2/3"/><Skeleton className="h-11"/></div>;
 if(q.isError||!q.data)return <p className="rounded-md border border-attention-ink/40 bg-attention-soft p-4 text-body-sm text-attention-ink" role="alert">{message(q.error)}</p>;
 const s=q.data,pending=s.pending,undo=s.undo;
 return <AccountEmailView state={s} busy={busy} result={result}
  onChange={address=>void run(async()=>{const a=address.trim();if(attempt.current?.address!==a)attempt.current={address:a,id:crypto.randomUUID()};const r=await send<ChangeResult>('/account/email/change',{version:1,requestId:attempt.current.id,newAddress:a});attempt.current=null;return changeText(r)})}
  onConfirm={token=>void run(async()=>{const r=await send<{email:string}>('/account/email/confirm',{version:1,token});return 'Your email is now '+r.email+'.'})}
  onCancel={()=>void run(async()=>{await send('/account/email/cancel',{version:1,changeId:pending?.changeId});return 'The email change was cancelled.'})}
  onUndo={()=>void run(async()=>{const r=await send<{email:string}>('/account/email/undo',{version:1,changeId:undo?.changeId});return 'Your email is back to '+r.email+'.'})}/>;
}
