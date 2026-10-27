import {useEffect,useRef,useState} from 'react';
import {Link,useRouterState} from '@tanstack/react-router';
import {useQuery} from '@tanstack/react-query';
import {LifeBuoy} from 'lucide-react';
import {deliveryLabel,lockoutContact,parseSupportReference,type SupportKind,type SupportOverview,type SupportRequest} from '../../src/support-shape';
import {api,send,message,queryClient} from './lib/api';
import {identityGeneration} from './lib/identity-invalidation';
import {Brand} from './components/brand';
import {Button} from './components/ui/button';
import {Textarea} from './components/ui/textarea';
import {AccountHelp} from './account-help';
import {ReturnLink} from './navigation-links';

const wrap='min-h-11 h-auto whitespace-normal text-left',key=['support'];
export function SupportLink({onNavigate}:{onNavigate?:()=>void}){return <Button asChild variant="secondary" className={wrap}><Link to="/workspace/$view" params={{view:'support'}} search={{}} onClick={onNavigate}><LifeBuoy className="size-4 shrink-0"/>Support</Link></Button>;}
export const when=(value:string)=>new Date(value).toLocaleString();
export const responseLabel=(r:SupportRequest)=>r.response.saved?'Response saved in Whumpo':'Waiting for an operator to read it';
export const readLabel=(r:SupportRequest)=>r.read.state==='read'?'You read the response '+when(r.read.at!):r.read.state==='unread'?'You have not opened the response yet':'No response to read yet';
export const kindLabel=(kind:SupportKind)=>kind==='help'?'Help request':'Usage review';
type Receipt={version:1;request:SupportRequest};

/** Identity-only fixed page: it reads no profile, Chat, dashboard or AI state, so it works when those are unavailable. */
export function SupportPage(){
 const search=useRouterState({select:s=>s.location.searchStr});
 const initial=new URLSearchParams(search).get('ref'),[ref,setRef]=useState<string|null>(initial&&parseSupportReference(initial)?initial:null);
 const [kind,setKind]=useState<SupportKind>('help'),[statement,setStatement]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[openId,setOpenId]=useState<string|null>(null),[done,setDone]=useState('');
 const draftId=useRef(crypto.randomUUID()),lock=useRef(false),heading=useRef<HTMLHeadingElement>(null),mounted=useRef(true),statementBox=useRef<HTMLTextAreaElement>(null),marked=useRef(new Set<string>());
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{document.title='Support — Whumpo';heading.current?.focus();},[]);
 const overview=useQuery({queryKey:key,queryFn:()=>api<SupportOverview>('/support/v1'),staleTime:0,gcTime:0,refetchOnWindowFocus:true});
 const data=overview.data&&!overview.error?overview.data:undefined;
 const opened=data?.requests.find(r=>r.id===openId);
 // The customer read is recorded only after the saved response has been displayed on this page.
 useEffect(()=>{
  if(!opened||opened.read.state!=='unread'||marked.current.has(opened.id))return;
  marked.current.add(opened.id);const generation=identityGeneration();
  send<Receipt>('/support/v1/requests/'+opened.id+'/read',{version:1}).then(()=>{if(mounted.current&&generation===identityGeneration())void queryClient.invalidateQueries({queryKey:key});}).catch(()=>marked.current.delete(opened.id));
 },[opened?.id,opened?.read.state]);
 async function submit(event:React.FormEvent){
  event.preventDefault();if(lock.current)return;
  const generation=identityGeneration(),present=()=>mounted.current&&generation===identityGeneration();lock.current=true;setBusy(true);setError('');setDone('');
  try{
   const saved=await send<Receipt>('/support/v1/requests',{version:1,id:draftId.current,kind,statement,...(ref?{reference:ref}:{})});
   if(!present())return;draftId.current=crypto.randomUUID();setStatement('');setRef(null);setOpenId(saved.request.id);setDone('Your request is saved for a platform operator. We reply on business days.');
  }catch(e){if(!present())return;setError(message(e)+' If you are unsure whether it saved, check “Your requests” before sending again; the same draft is never saved twice.');}
  finally{lock.current=false;if(present()){setBusy(false);void queryClient.invalidateQueries({queryKey:key});}}
 }
 const status=ref&&parseSupportReference(ref),statusCard=status&&status.kind==='status'?data?.statusLinks.find(l=>l.code===status.code):undefined;
 const operation=status&&status.kind==='operation'?data?.operations.find(o=>o.id===status.id):undefined;
 return <main className="min-h-dvh bg-background px-5 py-6 sm:px-8 sm:py-9"><div className="mx-auto max-w-3xl space-y-8">
  <Brand/><div className="flex flex-wrap items-center justify-between gap-3"><ReturnLink/><AccountHelp/></div>
  <header><h1 ref={heading} tabIndex={-1} className="text-3xl font-bold">Support</h1>
   <p className="mt-3 text-muted-foreground">Ask for help, look at operations that may be stuck, or ask an operator to review a usage decision. This page works even when Chat, the AI assistant or your welcome questions are unavailable.</p>
   <p className="mt-3 text-sm text-muted-foreground">Requests are read by platform operators. We reply on business days, and nothing here changes your limits, billing or account by itself. Never include passwords, keys or your recovery kit.</p></header>
  {overview.isFetching&&!data&&<p role="status">Checking support…</p>}{overview.error&&<div role="alert" className="rounded-md border p-4 text-sm space-y-3"><p>{message(overview.error)}</p><Button variant="secondary" className={wrap} onClick={()=>void overview.refetch()}>Try again</Button></div>}
  {data&&<>
   <section aria-labelledby="support-hours" className="rounded-lg border bg-card p-5 space-y-2"><h2 id="support-hours" className="text-xl font-bold">Hours and contact</h2>
    {data.config.hours?<p>Support hours: {data.config.hours}</p>:<p>Support hours have not been set by the platform owner. Do not assume anyone is available at a particular time.</p>}
    <p>Start with your Whumpo agent in Chat. When Chat is unavailable, use the request form below; responses appear on this page.</p>
    <p>Email <a className="underline" href={'mailto:'+lockoutContact}>{lockoutContact}</a> for help, including sign-in lockouts. We reply on business days. Never send your recovery key.</p>
    <p className="text-sm text-muted-foreground">{data.config.notifications.enabled?'An external notification may tell you a response exists. Its content stays here.':'External notifications are not configured. Check this page for a response.'}</p></section>
   <section aria-labelledby="support-status" className="space-y-4"><h2 id="support-status" className="text-xl font-bold">Status and error help</h2>
    {statusCard&&<div role="status" className="rounded-lg border bg-card p-5 space-y-2"><h3 className="font-bold">{statusCard.title}</h3><p>{statusCard.meaning}</p><p className="text-sm text-muted-foreground">{statusCard.next}</p></div>}
    <ul className="grid gap-3">{data.statusLinks.map(link=><li key={link.code}><Button variant="secondary" className={wrap+' w-full justify-start'+(ref==='status:'+link.code?' bg-action-soft border-link':'')} aria-pressed={ref==='status:'+link.code} onClick={()=>{setRef('status:'+link.code);statementBox.current?.focus();}}>{link.title}</Button></li>)}</ul></section>
   <section aria-labelledby="support-operations" className="space-y-4"><h2 id="support-operations" className="text-xl font-bold">Operations that may be stuck</h2>
    <p className="text-sm text-muted-foreground">Only your own unfinished work is listed, with its state and age. Never repeat an action that says uncertain; ask about it instead.</p>
    {!data.operations.length&&<p>No unfinished operations were found.</p>}
    <ul className="grid gap-3">{data.operations.map(o=><li key={o.id}><article aria-label={o.label+' '+o.state} className="rounded-lg border bg-card p-5 space-y-2"><h3 className="font-bold">{o.label}: {o.state}</h3><p className="text-sm">Since {when(o.since)}{o.ageMinutes!==null?' ('+o.ageMinutes+' minutes)':''}. {o.needsAttention?'It needs attention.':'It may still be finishing.'}</p><p className="text-sm text-muted-foreground">{o.next}</p><Button variant="secondary" className={wrap} onClick={()=>{setRef(o.reference);setKind('help');statementBox.current?.focus();}}>Ask about this</Button></article></li>)}</ul></section>
   <section aria-labelledby="support-new" className="rounded-lg border bg-card p-5 sm:p-6"><h2 id="support-new" className="text-xl font-bold mb-4">Ask for help</h2>
    <form onSubmit={e=>void submit(e)} className="space-y-4">
     <fieldset className="space-y-2"><legend className="text-sm font-medium">What do you need?</legend>
      {(['help','usage_review'] as SupportKind[]).map(k=><label key={k} className="flex min-h-11 items-center gap-3 text-sm"><input type="radio" name="support-kind" className="size-5" checked={kind===k} onChange={()=>setKind(k)}/>{k==='help'?'Help with a problem or a stuck operation':'Review a usage decision or limit'}</label>)}</fieldset>
     {ref&&<p className="text-sm rounded-md border p-3">Related to: {operation?operation.label+' ('+operation.state+')':statusCard?statusCard.title:ref} <Button type="button" variant="quiet" className="min-h-11" onClick={()=>setRef(null)}>Remove link</Button></p>}
     <label className="grid gap-2 text-sm font-medium">Describe what happened (up to 950 characters)<Textarea ref={statementBox} value={statement} maxLength={950} required rows={5} onChange={e=>setStatement(e.target.value)}/></label>
     <p className="text-xs text-muted-foreground">{statement.length}/950. One open {kind==='help'?'help request':'usage review'} at a time; an answered one allows a follow-up.</p>
     {error&&<p role="alert" className="rounded-md border p-4 text-sm">{error}</p>}{done&&<p role="status" className="rounded-md border p-4 text-sm">{done}</p>}
     <Button type="submit" className={wrap} disabled={busy||!statement.trim()}>{busy?'Saving…':'Save request'}</Button></form></section>
   <section aria-labelledby="support-requests" className="space-y-4"><h2 id="support-requests" className="text-xl font-bold">Your requests</h2>
    {!data.requests.length&&<p>You have not made a request yet.</p>}
    <ul className="grid gap-3">{data.requests.map(r=><li key={r.id}><article aria-label={kindLabel(r.kind)+' '+r.id} className="rounded-lg border bg-card p-5 space-y-2">
     <h3 className="font-bold">{kindLabel(r.kind)} · {when(r.createdAt)}</h3>
     <dl className="grid gap-1 text-sm"><div><dt className="inline font-medium">Response: </dt><dd className="inline">{responseLabel(r)}</dd></div><div><dt className="inline font-medium">Notification: </dt><dd className="inline">{r.response.saved?deliveryLabel(r.delivery.state):'None yet'}</dd></div><div><dt className="inline font-medium">Read: </dt><dd className="inline">{readLabel(r)}</dd></div></dl>
     <Button variant="secondary" className={wrap} aria-expanded={openId===r.id} onClick={()=>setOpenId(openId===r.id?null:r.id)}>{openId===r.id?'Hide details':'Open request'}</Button>
     {openId===r.id&&<div className="space-y-3 border-t pt-3"><p className="text-sm">Your statement:</p><p className="whitespace-pre-wrap break-words">{r.statement}</p>{r.publicResponse&&<><p className="text-sm font-medium">Response{r.answeredAt?' · '+when(r.answeredAt):''}:</p><p className="whitespace-pre-wrap break-words" data-support-response>{r.publicResponse}</p></>}</div>}
    </article></li>)}</ul></section>
  </>}
 </div></main>;
}
