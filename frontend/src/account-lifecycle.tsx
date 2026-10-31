import {useEffect,useRef,useState} from 'react';
import {Link} from '@tanstack/react-router';
import {ArrowLeft} from 'lucide-react';
import {Brand} from './components/brand';
import {Button} from './components/ui/button';
import {Card,CardHeader,CardTitle,CardDescription,CardContent} from './components/ui/card';
import {Input} from './components/ui/input';
import {StatusBadge,type Status} from './components/whumpo/status-badge';
import {identityCeremony} from './lib/identity';
import {identityGeneration} from './lib/identity-invalidation';
import {useLocation} from '@tanstack/react-router';
import {prepareAccountExport,downloadAccountExport,prepareAccountClosure,confirmAccountClosure,resumeAccountClosure,readAccountClosure,newAccountRequestId,closureStepLabels,closureStateLabels,closureDetail,
 type AccountTransport,type ExportReview,type ClosureReview,type ClosureStatus} from './lib/account-lifecycle';

const wrap='min-h-11 h-auto whitespace-normal text-left';
const transport:AccountTransport={fetch:(url,init)=>fetch(url,init),reauth:()=>identityCeremony('reauth')};
const time=(seconds:number)=>new Date(seconds*1000).toLocaleString();
const removeLabels:Record<string,string>={projects:'Projects',liveWebsites:'Live websites',savedWebsiteVersions:'Saved website versions',photos:'Photos',chatTurns:'Chat messages',moduleRecords:'Module records',moduleFiles:'Module file uploads',guestPreviewLinks:'Guest preview links',connectedProviders:'Connected providers'};
const badge=(state:string):Status=>state==='done'||state==='complete'?'ready':state==='waiting'||state==='closing'?'working':state==='blocked'?'attention':'idle';

/** Identity-only owner page for the WH-018 account export and closure. It renders without profile, Chat or dashboard
 * reads (all of which refuse a closing account) and is not reachable from Chat, generated pages or the model. */
export function AccountLifecyclePage(){
 const heading=useRef<HTMLHeadingElement>(null),mounted=useRef(true);
 const [closure,setClosure]=useState<ClosureStatus|null|undefined>(undefined),[loadError,setLoadError]=useState('');
 useEffect(()=>{mounted.current=true;document.title='Account data and closure — Whumpo';heading.current?.focus();void load();return()=>{mounted.current=false;};},[]);
 async function load(){
  const generation=identityGeneration();setLoadError('');
  try{const r=await readAccountClosure(transport);if(!mounted.current||generation!==identityGeneration())return;if(r.state==='ok')setClosure(r.value);else setLoadError(r.message);}
  catch{if(mounted.current)setLoadError('Account status could not load. Try again.');}
 }
 return <main className="min-h-dvh bg-surface px-5 py-6 sm:px-8 sm:py-9"><div className="mx-auto max-w-2xl space-y-8">
  <Brand/>
  <Button asChild variant="quiet" className={wrap}><Link to="/workspace/$view" params={{view:'security'}} search={{}}><ArrowLeft className="size-4"/>Account & security</Link></Button>
  <header><h1 ref={heading} tabIndex={-1} className="text-3xl font-bold break-words">Account data and closure</h1>
   <p className="mt-3 text-ink-muted">Download a private copy of your account data, or close your Whumpo account. Both work without Chat, and each download or confirmation asks for a recent passkey check.</p></header>
  {loadError&&<div className="space-y-3"><p role="alert" className="rounded-md border border-attention-ink/40 bg-attention-soft p-4 text-body-sm text-attention-ink">{loadError}</p><Button variant="secondary" className={wrap} onClick={()=>void load()}>Try again</Button></div>}
  <ExportSection/>
  {closure===undefined?!loadError&&<p role="status" className="text-body-sm">Checking account status…</p>
   :closure?<ClosureProgress initial={closure}/>:<ClosureSection onStarted={setClosure}/>}
 </div></main>;
}

function ExportSection(){
 const [visitorData,setVisitorData]=useState(false),[review,setReview]=useState<ExportReview|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState('');
 const request=useRef<{id:string;visitorData:boolean}|null>(null);
 async function prepare(){
  if(busy)return;setBusy(true);setError('');setDone('');
  if(request.current?.visitorData!==visitorData)request.current={id:newAccountRequestId(),visitorData};
  try{const r=await prepareAccountExport(request.current.id,visitorData,transport);if(r.state==='ok')setReview(r.value);else{setError(r.message);if(r.code==='stale_review'||r.code==='request_conflict')request.current=null;}}
  catch{setError('The export review could not be prepared. Try again.');}finally{setBusy(false);}
 }
 async function download(){
  if(busy||!review)return;setBusy(true);setError('');
  try{
   const r=await downloadAccountExport(review,transport);
   if(r.state==='error'){setError(r.message);if(r.code==='stale_review'){setReview(null);request.current=null;}return;}
   const url=URL.createObjectURL(r.value),link=document.createElement('a');link.href=url;link.download='whumpo-account-export.zip';document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
   setDone('Your export was downloaded. Check that manifest.json is inside: an archive without it is incomplete.');setReview(null);request.current=null;
  }catch{setError('The download was interrupted. Prepare a fresh export.');}finally{setBusy(false);}
 }
 return <Card><CardHeader><CardTitle role="heading" aria-level={2}>Download your account data</CardTitle><CardDescription>Review exactly what is included, then download a ZIP built from your current data.</CardDescription></CardHeader><CardContent className="space-y-4">
  {!review?<>
   <label className="flex items-start gap-3 text-body-sm"><input type="checkbox" className="mt-1 size-4" checked={visitorData} disabled={busy} onChange={e=>setVisitorData(e.target.checked)}/><span>Include visitor datasets (module records and approved file uploads, with visitor identifiers). Leave this off unless you need them.</span></label>
   <Button className={wrap} disabled={busy} onClick={()=>void prepare()}>{busy?'Preparing…':'Review export'}</Button>
  </>:<section aria-label="Export review" className="space-y-3">
   <p className="text-body-sm">{review.projects} {review.projects===1?'project':'projects'} · visitor datasets {review.visitorData?'included':'not included'} · review valid until {time(review.expiresAt)}</p>
   <h3 className="font-semibold">Included</h3><ul className="list-disc pl-5 text-body-sm space-y-1">{review.includes.map(i=><li key={i}>{i}</li>)}</ul>
   <h3 className="font-semibold">Not included</h3><ul className="list-disc pl-5 text-body-sm space-y-1">{review.excludes.map(i=><li key={i}>{i}</li>)}</ul>
   <p className="text-body-sm text-ink-muted">{review.notice}</p>
   <div className="flex flex-wrap gap-3"><Button className={wrap} disabled={busy} onClick={()=>void download()}>{busy?'Downloading…':'Check passkey and download'}</Button><Button variant="quiet" className={wrap} disabled={busy} onClick={()=>{setReview(null);setError('');}}>Change scope</Button></div>
  </section>}
  {error&&<p role="alert" className="rounded-md border border-attention-ink/40 bg-attention-soft p-3 text-body-sm text-attention-ink">{error}</p>}
  {done&&<p role="status" className="rounded-md border border-ready-ink/30 bg-ready-soft p-3 text-body-sm text-ready-ink">{done}</p>}
 </CardContent></Card>;
}

function ClosureSection({onStarted}:{onStarted:(status:ClosureStatus)=>void}){
 const [review,setReview]=useState<ClosureReview|null>(null),[confirmation,setConfirmation]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const lock=useRef(false);
 async function prepare(){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');setConfirmation('');
  try{const r=await prepareAccountClosure(newAccountRequestId(),transport);if(r.state==='ok')setReview(r.value);else setError(r.message);}
  catch{setError('The closure review could not be prepared. Try again.');}finally{lock.current=false;setBusy(false);}
 }
 async function confirm(){
  if(lock.current||!review||confirmation!=='CLOSE')return;lock.current=true;setBusy(true);setError('');
  try{
   const r=await confirmAccountClosure(review,transport);
   if(r.state==='ok'){onStarted(r.value);return;}
   setError(r.message);if(r.code==='stale_review'||r.code==='action_required')setReview(null);
   if(r.code==='closure_exists'){const s=await readAccountClosure(transport);if(s.state==='ok'&&s.value)onStarted(s.value);}
  }catch{setError('Closure confirmation did not finish. Check the account status before retrying.');}finally{lock.current=false;setBusy(false);}
 }
 return <Card><CardHeader><CardTitle role="heading" aria-level={2}>Close your account</CardTitle><CardDescription>Closing permanently deletes your Whumpo account after the steps below finish. Review exactly what is removed and what remains first.</CardDescription></CardHeader><CardContent className="space-y-4">
  {!review?<Button variant="secondary" className={wrap} disabled={busy} onClick={()=>void prepare()}>{busy?'Preparing…':'Review account closure'}</Button>
  :<section aria-label="Closure review" className="space-y-4">
   <p className="text-body-sm">Review valid until {time(review.expiresAt)}.</p>
   {review.requiredBeforeClosure.length>0&&<div className="rounded-md border p-3 space-y-2" role="group" aria-labelledby="closure-required"><h3 id="closure-required" className="font-semibold">Finish these first</h3><ul className="list-disc pl-5 text-body-sm space-y-1">{review.requiredBeforeClosure.map(r=><li key={r.id}>{r.action} ({r.count})</li>)}</ul></div>}
   <h3 className="font-semibold">Removed</h3>
   <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-body-sm">{Object.entries(review.removes).map(([k,v])=><div key={k} className="contents"><dt>{removeLabels[k]??k}</dt><dd className="text-right tabular-nums">{v}</dd></div>)}</dl>
   <h3 className="font-semibold">What happens</h3><ol className="list-decimal pl-5 text-body-sm space-y-1">{review.effects.map(e=><li key={e}>{e}</li>)}</ol>
   <h3 className="font-semibold">What remains after closure</h3><ul className="list-disc pl-5 text-body-sm space-y-1">{review.remainsAfterClosure.map(e=><li key={e}>{e}</li>)}</ul>
   {review.needsSupport&&<div className="rounded-md border border-attention-ink/40 bg-attention-soft p-4 text-body-sm text-attention-ink space-y-3" role="group" aria-labelledby="closure-support"><h3 id="closure-support" className="font-semibold">Support is needed first</h3><p>{review.supportMessage}</p><Button asChild variant="secondary" className={wrap}><Link to="/workspace/$view" params={{view:'support'}} search={{}}>Contact support</Link></Button></div>}
   {review.canConfirm?<>
    <label className="grid gap-2 text-body-sm font-medium">Type CLOSE to confirm<Input value={confirmation} onChange={e=>setConfirmation(e.target.value)} disabled={busy} autoComplete="off" autoCapitalize="characters" spellCheck={false} className="min-h-11"/></label>
    <div className="flex flex-wrap gap-3"><Button variant="destructive" className={wrap} disabled={busy||confirmation!=='CLOSE'} onClick={()=>void confirm()}>{busy?'Closing…':'Check passkey and close account'}</Button><Button variant="quiet" className={wrap} disabled={busy} onClick={()=>{setReview(null);setError('');}}>Cancel</Button></div>
   </>:<div className="flex flex-wrap gap-3"><Button variant="secondary" className={wrap} disabled={busy} onClick={()=>void prepare()}>Review again</Button><Button variant="quiet" className={wrap} disabled={busy} onClick={()=>setReview(null)}>Cancel</Button></div>}
  </section>}
  {error&&<p role="alert" className="rounded-md border border-attention-ink/40 bg-attention-soft p-3 text-body-sm text-attention-ink">{error}</p>}
 </CardContent></Card>;
}

function ClosureProgress({initial}:{initial:ClosureStatus}){
 const [status,setStatus]=useState(initial),[busy,setBusy]=useState(false),[error,setError]=useState('');
 async function resume(){
  if(busy)return;setBusy(true);setError('');
  try{const r=await resumeAccountClosure(transport);if(r.state==='ok')setStatus(r.value);else setError(r.message);}
  catch{setError('Closure could not continue right now. Try again shortly.');}finally{setBusy(false);}
 }
 const complete=status.state==='complete';
 return <Card><CardHeader><CardTitle role="heading" aria-level={2}>{complete?'Your account is closed':'Your account is closing'}</CardTitle>
  <CardDescription>{complete?'Your account data was deleted. Keep this receipt; you will not be able to sign in to this account again.':'New work is stopped. Each step below runs once and can be resumed safely; nothing is repeated or released because it is retried. Waiting steps are also checked automatically about once an hour, so closure finishes even if you do not return.'}</CardDescription></CardHeader>
  <CardContent className="space-y-4">
   <p className="text-body-sm"><StatusBadge status={badge(status.state)}>{closureStateLabels[status.state]}</StatusBadge> <span className="break-all">Closure {status.id}</span></p>
   <ol className="space-y-2" aria-label="Closure steps">{status.steps.map(s=><li key={s.step} className="rounded-md border p-3 text-body-sm space-y-1">
    <p className="flex flex-wrap items-center gap-2"><span className="font-medium">{closureStepLabels[s.step]}</span><StatusBadge status={badge(s.state)}>{closureStateLabels[s.state]}</StatusBadge></p>
    {closureDetail(s.detail).map(d=><p key={d} className="text-ink-muted">{d}</p>)}
    {s.origin==='maintenance'&&<p className="text-ink-muted">Last checked automatically.</p>}
   </li>)}</ol>
   {!complete&&<div className="flex flex-wrap gap-3"><Button className={wrap} disabled={busy} onClick={()=>void resume()}>{busy?'Continuing…':'Continue closure'}</Button><Button asChild variant="secondary" className={wrap}><Link to="/workspace/$view" params={{view:'support'}} search={{}}>Get support</Link></Button></div>}
   {error&&<p role="alert" className="rounded-md border border-attention-ink/40 bg-attention-soft p-3 text-body-sm text-attention-ink">{error}</p>}
  </CardContent></Card>;
}

/** Shown on every workspace page once the server refuses an action because the account is closing (the api client raises the event). It is the way
 * back to the one page that still works, instead of a raw error. */
export function AccountClosingNotice(){
 const [closing,setClosing]=useState(false),location=useLocation();
 useEffect(()=>{const on=()=>setClosing(true);window.addEventListener('whumpo:account-closing',on);return()=>window.removeEventListener('whumpo:account-closing',on);},[]);
 if(!closing||location.pathname==='/workspace/account')return null;
 return <div role="alert" className="fixed inset-x-0 top-0 z-50 flex flex-wrap items-center gap-3 border-b border-attention-ink/40 bg-attention-soft px-5 py-3 text-body-sm text-attention-ink">
  <p className="min-w-0 flex-1 break-words">Your account is closing, so other workspace actions are paused.</p>
  <Button asChild variant="secondary" className={wrap}><Link to="/workspace/$view" params={{view:'account'}} search={{}}>Open closure status</Link></Button>
 </div>;
}
