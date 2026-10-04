import {useEffect,useRef,useState} from 'react';
import type {GuestPreviewFacts} from '../../src/guest-previews/shape';
import {Button} from './components/ui/button';
import {Input} from './components/ui/input';
import {Label} from './components/ui/label';
import {api,message,send} from './lib/api';

type Readout={requestId:string;project:{id:string;name:string};savedVersion:{id:string;createdAt:string;digest:string};expiresInHours:number;commentsAllowed:boolean;label:string;effect:string};
type Comment={id:string;displayName:string;displayNameVerified:false;text:string;createdAt:number;resolvedAt:number|null};
const when=(seconds:number)=>new Date(seconds*1000).toLocaleString();
const stateText={active:'Active',expired:'Expired',revoked:'Revoked',removed:'Saved version removed'} as const;

/** Owner controls for WH-092 guest links. Every action calls the same owner HTTP handlers that Chat controls use.
 * The one-time link lives only in this component's memory: it is never written to a query cache, storage, Chat
 * or a model request, and it is discarded when dismissed or when this view unmounts. */
export function GuestPreviewsPanel({facts,projectId,onChanged}:{facts:GuestPreviewFacts;projectId:string;onChanged:()=>void}){
 const [versionId,setVersionId]=useState(facts.versions[0]?.id??''),[hours,setHours]=useState(24),[comments,setComments]=useState(true),[label,setLabel]=useState('');
 const [readout,setReadout]=useState<{readout:Readout;confirmation:string}|null>(null),[issued,setIssued]=useState<string|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),lock=useRef(false),from=useRef<HTMLElement|null>(null);
 const [open,setOpen]=useState<{linkId:string;items:Comment[]}|null>(null),[removing,setRemoving]=useState<string|null>(null),[focusId,setFocusId]=useState('');
 useEffect(()=>()=>{setIssued(null);},[]);
 // Controls that replace themselves would drop keyboard and screen-reader focus on the page; move it to a stable target.
 // Buttons disable while a request runs, which drops focus to the page; hand it back to the control that was used.
 useEffect(()=>{if(!busy&&from.current){const el=from.current;from.current=null;if(el.isConnected&&document.activeElement===document.body)el.focus();}},[busy]);
 useEffect(()=>{if(focusId){document.getElementById(focusId)?.focus();setFocusId('');}},[focusId]);
 async function guarded(work:()=>Promise<void>){if(lock.current)return;lock.current=true;from.current=document.activeElement instanceof HTMLElement?document.activeElement:null;setBusy(true);setError('');try{await work();}catch(e){setError(message(e));}finally{setBusy(false);lock.current=false;}}
 const base=`/projects/${projectId}/guest-previews`;
 const request=(id:string)=>({id,versionId,expiresInHours:hours,feedback:comments,...(label.trim()?{label:label.trim()}:{})});
 const review=()=>guarded(async()=>{const id=crypto.randomUUID();setReadout(await send(base+'/prepare',request(id)));setFocusId('guest-confirm');});
 const issue=()=>guarded(async()=>{
  if(!readout)return;
  const result=await send<{token:string|null;url:string|null}>(base,{...request(readout.readout.requestId),confirmation:readout.confirmation});
  setReadout(null);setIssued(result.url);setFocusId('guest-issued');onChanged();
 });
 const revoke=(id:string)=>guarded(async()=>{await send(`/guest-previews/${id}/revoke`);setFocusId('guest-state-'+id);onChanged();});
 const remove=(id:string)=>guarded(async()=>{await api(`/guest-previews/${id}`,{method:'DELETE'});setRemoving(null);setOpen(null);setFocusId('guest-create');onChanged();});
 const showComments=(id:string)=>guarded(async()=>{const r=await api<{feedback:Comment[]}>(`/guest-previews/${id}/feedback`);setOpen({linkId:id,items:r.feedback});});
 const resolve=(link:string,c:Comment)=>guarded(async()=>{const r=await send<{feedback:Comment}>(`/guest-previews/${link}/feedback/${c.id}`,{resolved:c.resolvedAt===null},'PATCH');setOpen(o=>o&&{...o,items:o.items.map(x=>x.id===c.id?r.feedback:x)});onChanged();});
 const deleteComment=(link:string,c:Comment)=>guarded(async()=>{await api(`/guest-previews/${link}/feedback/${c.id}`,{method:'DELETE'});setOpen(o=>o&&{...o,items:o.items.filter(x=>x.id!==c.id)});setFocusId(`guest-hide-${link}`);onChanged();});
 return <div className="space-y-4" data-guest-previews>
  {issued&&<section id="guest-issued" tabIndex={-1} aria-label="New guest link" className="rounded-xl border bg-secondary/60 p-4 space-y-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"><p className="text-sm font-medium">Your link is shown only now. Copy it and share it yourself. Whumpo cannot show it again; revoke it and issue another if it is lost.</p>
   <Input readOnly aria-label="Guest preview link" value={issued} onFocus={e=>e.currentTarget.select()}/>
   <div className="flex flex-wrap gap-2"><Button type="button" className="min-h-11 max-w-full" onClick={()=>void navigator.clipboard?.writeText(issued).catch(()=>{})}>Copy link</Button><Button type="button" variant="outline" className="min-h-11 max-w-full" onClick={()=>{setIssued(null);setFocusId('guest-create');}}>I have copied it</Button></div></section>}
  {error&&<p role="alert" className="text-sm">{error}</p>}
  <ul className="space-y-3">{facts.links.map(l=><li key={l.id} className="rounded-xl bg-background p-4 space-y-2 text-sm">
   <p id={`guest-state-${l.id}`} tabIndex={-1} className="font-medium break-words focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">{l.label||'Guest preview'} <span className="font-normal text-muted-foreground">· {stateText[l.state]}</span></p>
   <p className="text-xs text-muted-foreground">Expires {when(l.expiresAt)} · {l.feedbackEnabled?'Comments allowed':'Comments off'} · {l.feedbackCount} comment(s), {l.openFeedbackCount} open</p>
   <div className="flex flex-wrap gap-2">
    {l.state==='active'&&<Button type="button" variant="outline" className="min-h-11 max-w-full" aria-label={`Revoke link for ${l.label||'Guest preview'}`} disabled={busy} onClick={()=>void revoke(l.id)}>Revoke link</Button>}
    {l.feedbackCount>0&&<Button id={`guest-show-${l.id}`} type="button" variant="outline" className="min-h-11 max-w-full" aria-label={`Show comments for ${l.label||'Guest preview'}`} disabled={busy} onClick={()=>void showComments(l.id)}>Show comments</Button>}
    {removing===l.id?<><Button type="button" variant="destructive" className="min-h-11 max-w-full" disabled={busy} onClick={()=>void remove(l.id)}>Confirm: delete link and {l.feedbackCount} comment(s)</Button><Button type="button" variant="outline" className="min-h-11 max-w-full" onClick={()=>{setRemoving(null);setFocusId(`guest-delete-${l.id}`);}}>Keep</Button></>:<Button id={`guest-delete-${l.id}`} type="button" variant="outline" className="min-h-11 max-w-full" aria-label={`Delete… ${l.label||'Guest preview'}`} disabled={busy} onClick={()=>setRemoving(l.id)}>Delete…</Button>}
   </div>
   {open?.linkId===l.id&&<div className="space-y-2 border-t pt-2"><p className="text-xs text-muted-foreground">Guest comments are shown as plain text. Names are not verified. They are not sent to Whumpo’s assistant unless you ask for that separately.</p>
    {open.items.length?open.items.map(c=><div key={c.id} className="rounded-lg border p-3 space-y-1"><p className="text-xs text-muted-foreground break-words">{c.displayName||'Anonymous'} (not verified) · {when(c.createdAt)}{c.resolvedAt!==null?' · Resolved':''}</p><p className="whitespace-pre-wrap break-words">{c.text}</p>
     <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="min-h-11 max-w-full" aria-label={`${c.resolvedAt===null?'Mark resolved':'Reopen'}: comment from ${c.displayName||'Anonymous'}`} disabled={busy} onClick={()=>void resolve(l.id,c)}>{c.resolvedAt===null?'Mark resolved':'Reopen'}</Button><Button type="button" variant="outline" className="min-h-11 max-w-full" aria-label={`Delete comment from ${c.displayName||'Anonymous'}`} disabled={busy} onClick={()=>void deleteComment(l.id,c)}>Delete comment</Button></div></div>):<p className="text-sm">No comments.</p>}
    <Button id={`guest-hide-${l.id}`} type="button" variant="outline" className="min-h-11 max-w-full" onClick={()=>{setOpen(null);setFocusId(`guest-show-${l.id}`);}}>Hide comments</Button></div>}
  </li>)}{!facts.links.length&&<li className="text-sm text-muted-foreground">No guest preview links yet.</li>}</ul>
  {facts.canIssue?(facts.versions.length?<form className="space-y-3 border-t pt-3" onSubmit={e=>{e.preventDefault();void review();}}>
   <p id="guest-create" tabIndex={-1} className="text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">Create a link for one saved version</p>
   <div className="space-y-1"><Label htmlFor="guest-version">Saved version</Label><select id="guest-version" className="min-h-11 w-full rounded-md border bg-background px-3 text-sm" value={versionId} onChange={e=>{setVersionId(e.target.value);setReadout(null);}}>{facts.versions.map(v=><option key={v.id} value={v.id}>{new Date(v.createdAt).toLocaleString()}</option>)}</select></div>
   <div className="space-y-1"><Label htmlFor="guest-hours">Link lasts (1–168 hours)</Label><Input id="guest-hours" type="number" min={1} max={168} step={1} value={hours} onChange={e=>{setHours(Number(e.target.value));setReadout(null);}}/></div>
   <div className="flex items-center gap-2"><input id="guest-comments" type="checkbox" className="size-5" checked={comments} onChange={e=>{setComments(e.target.checked);setReadout(null);}}/><Label htmlFor="guest-comments">Guests may leave comments</Label></div>
   <div className="space-y-1"><Label htmlFor="guest-label">Label for you (optional)</Label><Input id="guest-label" maxLength={80} value={label} onChange={e=>{setLabel(e.target.value);setReadout(null);}}/></div>
   <Button id="guest-review" type="submit" className="min-h-11 max-w-full" disabled={busy||!versionId}>Review link details</Button>
   {readout&&<section id="guest-confirm" tabIndex={-1} aria-label="Confirm guest link" className="rounded-xl border p-4 space-y-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"><dl className="space-y-2 text-sm"><div><dt className="text-xs text-muted-foreground">Project</dt><dd className="break-words">{readout.readout.project.name}</dd></div><div><dt className="text-xs text-muted-foreground">Exact saved version</dt><dd>{new Date(readout.readout.savedVersion.createdAt).toLocaleString()}</dd></div><div><dt className="text-xs text-muted-foreground">Expires</dt><dd>{readout.readout.expiresInHours} hour(s) after you confirm</dd></div><div><dt className="text-xs text-muted-foreground">Comments</dt><dd>{readout.readout.commentsAllowed?'Allowed':'Not allowed'}</dd></div></dl><p className="text-sm">{readout.readout.effect}</p>
    <div className="flex flex-wrap gap-2"><Button type="button" className="min-h-11 max-w-full" disabled={busy} onClick={()=>void issue()}>Confirm and create link</Button><Button type="button" variant="outline" className="min-h-11 max-w-full" onClick={()=>{setReadout(null);setFocusId('guest-review');}}>Cancel</Button></div></section>}
  </form>:<p className="text-sm text-muted-foreground">Save a website version first to create a guest link.</p>):<p className="text-sm text-muted-foreground">Creating guest links needs Creator or a higher plan. Existing links, comments, revoking and deleting stay available.</p>}
 </div>;
}
