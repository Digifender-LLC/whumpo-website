import {useEffect,useRef,useState} from 'react';
import {Link} from '@tanstack/react-router';
import {ArrowLeft} from 'lucide-react';
import {Brand} from './components/brand';
import {Button} from './components/ui/button';
import {Card,CardHeader,CardTitle,CardDescription,CardContent} from './components/ui/card';
import {readPolicies,acceptPolicies,type PolicyConsentView} from './lib/policy-consent';

const wrap='min-h-11 h-auto whitespace-normal text-left';
const send=(url:string,init:RequestInit)=>fetch(url,init);

/** WH-016 identity-only policies page: shows the current adopted Terms, Acceptable Use Policy and Privacy Policy version
 * and records the owner's acceptance of that exact version. Works without Chat, AI or onboarding. */
export function PoliciesPage(){
 const heading=useRef<HTMLHeadingElement>(null),mounted=useRef(true);
 const [view,setView]=useState<PolicyConsentView|null>(null),[error,setError]=useState(''),[read,setRead]=useState(false),[busy,setBusy]=useState(false),[done,setDone]=useState('');
 useEffect(()=>{mounted.current=true;document.title='Policies — Whumpo';heading.current?.focus();void load();return()=>{mounted.current=false;};},[]);
 async function load(){
  setError('');
  try{const r=await readPolicies(send);if(!mounted.current)return;if(r.state==='ok')setView(r.value);else setError(r.message);}
  catch{if(mounted.current)setError('Policies could not load. Try again.');}
 }
 async function accept(){
  if(busy||!view?.current)return;setBusy(true);setError('');setDone('');
  try{
   const r=await acceptPolicies(view.current,send);if(!mounted.current)return;
   if(r.state==='ok'){setView(r.value);setDone('Thank you. Your acceptance of this version is recorded.');}
   else{setError(r.message);if(r.code==='policy_changed'){setRead(false);void load();}}
  }catch{if(mounted.current)setError('Your acceptance could not be recorded. Try again.');}finally{if(mounted.current)setBusy(false);}
 }
 return <main className="min-h-dvh bg-background px-5 py-6 sm:px-8 sm:py-9"><div className="mx-auto max-w-2xl space-y-8">
  <Brand/>
  <Button asChild variant="quiet" className={wrap}><Link to="/workspace/$view" params={{view:'security'}} search={{}}><ArrowLeft className="size-4"/>Account & security</Link></Button>
  <header><h1 ref={heading} tabIndex={-1} className="text-3xl font-bold">Whumpo policies</h1>
   <p className="mt-3 text-muted-foreground">Publishing a website or turning on an app requires accepting the current Terms of Service, Acceptable Use Policy and Privacy Policy. When they change, you review and accept the new version.</p></header>
  {error&&<div className="space-y-3"><p role="alert" className="rounded-md border p-3 text-sm">{error}</p><Button variant="secondary" className={wrap} onClick={()=>void load()}>Try again</Button></div>}
  {!view?!error&&<p role="status" className="text-sm">Loading policies…</p>
   :<Card><CardHeader><CardTitle>{view.current?'Current version '+view.current.version:'No version adopted yet'}</CardTitle>
    <CardDescription>{view.current?(view.accepted?'You accepted this version'+(view.acceptedAt?' on '+new Date(view.acceptedAt*1000).toLocaleString():'')+'.':'You have not accepted this version yet.'):'The policies are still drafts under review. There is nothing to accept yet, and publishing is not blocked by this page.'}</CardDescription></CardHeader>
    <CardContent className="space-y-4">
     <ul className="list-disc space-y-1 pl-5 text-sm">{view.documents.map(d=><li key={d.id}><a className="inline-flex min-h-11 items-center underline underline-offset-4" href={d.url} target="_blank" rel="noreferrer">{d.title}</a></li>)}</ul>
     {view.current&&!view.accepted&&<>
      <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 size-4" checked={read} disabled={busy} onChange={e=>setRead(e.target.checked)}/><span>I have read and accept the Terms of Service, Acceptable Use Policy and Privacy Policy, version {view.current.version}.</span></label>
      <Button className={wrap} disabled={busy||!read} onClick={()=>void accept()}>{busy?'Recording…':'Accept these policies'}</Button>
     </>}
     {done&&<p role="status" className="text-sm">{done}</p>}
    </CardContent></Card>}
 </div></main>;
}
