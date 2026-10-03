import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Link,useNavigate,useRouterState} from '@tanstack/react-router';
import {useQuery} from '@tanstack/react-query';
import {ArrowLeft,ShieldCheck} from 'lucide-react';
import type {SiteSafetyInventory,SiteSafetyReview,SiteSafetyReviews} from '../../src/site-safety-shape';
import {identityGeneration} from './lib/identity-invalidation';
import {api,send,message,queryClient} from './lib/api';
import {Brand} from './components/brand';
import {Button} from './components/ui/button';
import {AccountHelp} from './account-help';

const base='/workspace/site-safety',key=['site-safety'];
type Receipt={version:1;review:SiteSafetyReview};
const wrap='min-h-11 h-auto whitespace-normal text-left';
export function SiteSafetyLink(){return <Button asChild variant="outline" className={wrap}><Link to="/workspace/$view" params={{view:'safety'}} search={{}}><ShieldCheck className="size-4 shrink-0"/>Website safety</Link></Button>;}

/** Outside profile/Chat/dashboard reads; only current identity and the server's
 * first-project gate admit this fixed recovery surface. No generated controls. */
export function SiteSafetyPage(){
 const navigate=useNavigate(),search=useRouterState({select:s=>s.location.search}),reviewId=search.review,projectId=search.project;
 const [after,setAfter]=useState<string|null>(null),[reviewAfter,setReviewAfter]=useState<string|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const lock=useRef(false),heading=useRef<HTMLHeadingElement>(null),mounted=useRef(true),lastReview=useRef('');
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const inventory=useQuery({queryKey:[...key,'inventory',after],queryFn:()=>api<SiteSafetyInventory>(base+(after?'?after='+after:'')),staleTime:0,gcTime:0,refetchOnWindowFocus:true});
 const reviews=useQuery({queryKey:[...key,'reviews',projectId,reviewAfter],queryFn:()=>api<SiteSafetyReviews>(base+'/reviews?project='+projectId+(reviewAfter?'&after='+reviewAfter:'')),enabled:!!projectId,staleTime:0,gcTime:0,refetchOnWindowFocus:true});
 const detail=useQuery({queryKey:[...key,'review',reviewId],queryFn:()=>api<Receipt>(base+'/reviews/'+reviewId),enabled:!!reviewId,staleTime:0,gcTime:0,refetchOnWindowFocus:true});
 useEffect(()=>{document.title='Website safety — Whumpo';heading.current?.focus();},[]);
 useEffect(()=>{setError('');},[reviewId,projectId]);
 const current=detail.data&&!detail.error&&!detail.isFetching?detail.data.review:undefined;
 useLayoutEffect(()=>{if(!current)return;const stamp=current.id+':'+current.state;if(lastReview.current===stamp)return;lastReview.current=stamp;if(document.activeElement===document.body||document.activeElement?.textContent==='Review taking website offline')document.querySelector<HTMLElement>('[data-withdrawal-title]')?.focus();},[current]);
 async function showReview(id:string,project=projectId){await navigate({to:'/workspace/$view',params:{view:'safety'},search:{project,review:id}});}
 async function act(fn:()=>Promise<Receipt>,id:string,project=projectId){
  if(lock.current)return;const generation=identityGeneration(),present=()=>mounted.current&&generation===identityGeneration();lock.current=true;setBusy(true);setError('');
  try{const saved=await fn();if(!present())return;queryClient.setQueryData([...key,'review',id],saved);await showReview(id,project);}
  catch(e){if(!present())return;await showReview(id,project);setError(message(e)+' Check the saved result before deciding what to do next. This action will not be sent again automatically.');}
  finally{lock.current=false;if(present()){setBusy(false);void queryClient.invalidateQueries({queryKey:key});void queryClient.invalidateQueries({queryKey:['dashboard']});}}
 }
 return <main className="min-h-dvh bg-background px-5 py-6 sm:px-8 sm:py-9"><div className="mx-auto max-w-3xl space-y-7">
  <Brand/><div className="flex flex-wrap items-center justify-between gap-3"><Button asChild variant="ghost" className={wrap}><Link to="/workspace/$view" params={{view:'dashboard'}} search={{}}><ArrowLeft className="size-4"/>Back to Dashboard</Link></Button><AccountHelp/></div>
  <header><h1 ref={heading} tabIndex={-1} className="text-3xl font-extrabold">Website safety</h1><p className="mt-3 text-muted-foreground">Take a published website offline while keeping its saved versions. These controls work independently of Chat.</p><p className="mt-3 text-sm text-muted-foreground">This controls the website at its main address, including its attached contact form and tool. Separately published apps, backend endpoints and CMS articles are outside this withdrawal.</p></header>
  {error&&<p role="alert" className="rounded-xl border p-4 text-sm">{error}</p>}
  {reviewId&&<section aria-label="Website withdrawal review" className="rounded-2xl border bg-card p-5 sm:p-6 space-y-4">
   <h2 tabIndex={-1} className="text-xl font-bold">Saved withdrawal</h2>
   {detail.isFetching&&<p role="status">Checking the saved review…</p>}
   {detail.error&&<p role="alert">{message(detail.error)}</p>}
   {current&&<Withdrawal review={current} busy={busy} confirm={()=>void act(()=>send<Receipt>(base+'/reviews/'+current.id+'/confirm',{version:1,confirmation:'UNPUBLISH_WEBSITE'}),current.id,current.projectId)}/>}
   <div className="flex flex-wrap gap-3"><Button variant="outline" className={wrap} disabled={busy||detail.isFetching} onClick={()=>void detail.refetch()}>Check saved result</Button><Button asChild variant="ghost" className={wrap}><Link to="/workspace/$view" params={{view:'safety'}} search={{project:projectId}}>Close review</Link></Button></div>
  </section>}
  <section className="space-y-4" aria-labelledby="safety-websites"><div className="flex flex-wrap items-center justify-between gap-3"><h2 id="safety-websites" className="text-xl font-bold">Your websites</h2><Button variant="outline" className={wrap} disabled={busy||inventory.isFetching} onClick={()=>void inventory.refetch()}>Check website status</Button></div>
   {inventory.isFetching&&<p role="status">Checking your websites…</p>}{inventory.error&&<p role="alert">{message(inventory.error)}</p>}
   {inventory.data&&!inventory.error&&!inventory.isFetching&&<>{inventory.data.projects.map(project=><article key={project.id} className="rounded-2xl border bg-card p-5 space-y-3" aria-label={project.name}>
    <h3 className="font-bold text-lg break-words">{project.name}</h3><p className="text-sm break-all">{project.url}</p><p className="text-sm">{project.versionId?'Website published':'Website offline'}</p><div className="flex flex-wrap gap-3">
     {project.versionId&&<Button variant="outline" className={wrap} disabled={busy} onClick={()=>{const id=crypto.randomUUID();void act(()=>send<Receipt>(base+'/reviews',{version:1,id,projectId:project.id,expectedRevision:project.revision}),id,project.id);}}>Review taking website offline</Button>}
     <Button variant="ghost" className={wrap} disabled={busy} onClick={()=>{setReviewAfter(null);void navigate({to:'/workspace/$view',params:{view:'safety'},search:{project:project.id}});}}>Saved withdrawals</Button>
    </div></article>)}{!inventory.data.projects.length&&<p>No websites on this page.</p>}<div className="flex flex-wrap gap-3">{after&&<Button variant="outline" className={wrap} onClick={()=>setAfter(null)}>First websites</Button>}{inventory.data.next&&<Button variant="outline" className={wrap} onClick={()=>setAfter(inventory.data!.next)}>More websites</Button>}</div></>}
  </section>
  {projectId&&<section aria-label="Saved website withdrawals" className="space-y-4"><h2 className="text-xl font-bold">Saved website withdrawals</h2><p className="text-sm text-muted-foreground">Open a saved review or result. Reading one never retries or approves it.</p>
   <Button variant="outline" className={wrap} disabled={busy||reviews.isFetching} onClick={()=>void reviews.refetch()}>Check saved withdrawals</Button>
   {reviews.isFetching&&<p role="status">Checking saved withdrawals…</p>}{reviews.error&&<p role="alert">{message(reviews.error)}</p>}
   {reviews.data&&!reviews.error&&!reviews.isFetching&&<>{reviews.data.reviews.map(review=><Button key={review.id} variant="outline" className={wrap+' w-full justify-start'} onClick={()=>void showReview(review.id)}>{review.name} · {stateLabel(review.state)} · {review.appliedAt?'Applied '+new Date(review.appliedAt).toLocaleString():'Review expires '+new Date(review.expiresAt).toLocaleString()}</Button>)}{!reviews.data.reviews.length&&<p>No saved withdrawals on this page.</p>}<div className="flex flex-wrap gap-3">{reviewAfter&&<Button variant="outline" className={wrap} onClick={()=>setReviewAfter(null)}>First withdrawals</Button>}{reviews.data.next&&<Button variant="outline" className={wrap} onClick={()=>setReviewAfter(reviews.data!.next)}>More withdrawals</Button>}</div></>}
  </section>}
 </div></main>;
}
const stateLabel=(state:SiteSafetyReview['state'])=>({pending:'Awaiting confirmation',applied:'Withdrawal applied',expired:'Review expired',changed:'Website changed'})[state];
function Withdrawal({review:r,busy,confirm}:{review:SiteSafetyReview;busy:boolean;confirm:()=>void}){
 return <div className="space-y-4"><h3 data-withdrawal-title tabIndex={-1} className="text-lg font-bold">{stateLabel(r.state)}: {r.name}</h3><p className="text-sm break-all">{r.url}</p>
  {r.state==='pending'?<><p>Taking this website offline removes its public page and stops its attached contact form and tool. Saved versions stay private.</p><p className="text-sm text-muted-foreground">Confirm before {new Date(r.expiresAt).toLocaleString()}.</p><details className="text-sm text-muted-foreground"><summary className="min-h-11 cursor-pointer py-3">Review details</summary><p>Publication revision {r.expectedRevision}</p><p className="mt-2">Saved version: <span className="break-all">{r.versionId}</span></p></details><Button className={wrap} disabled={busy} onClick={confirm}>Confirm taking this website offline</Button></>:r.state==='applied'?<><p role="status">This withdrawal was applied{r.appliedAt?' on '+new Date(r.appliedAt).toLocaleString():''}.</p><p>{r.versionId?'A website is published now. This earlier withdrawal does not take a later publication offline.':'The website is currently offline.'}</p></>:<p>This review can no longer be confirmed. Check the current website status to prepare a fresh review.</p>}
 </div>;
}
