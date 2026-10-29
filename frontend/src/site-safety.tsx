import {ReturnLink} from './navigation-links';
import {ServiceSafetyActions,ServiceSafetyPanel} from './service-safety';
import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Link,useNavigate,useRouterState} from '@tanstack/react-router';
import {useQuery} from '@tanstack/react-query';
import {ShieldCheck} from 'lucide-react';
import type {SiteSafetyInventory,SiteSafetyReview,SiteSafetyReviews} from '../../src/site-safety-shape';
import {identityGeneration} from './lib/identity-invalidation';
import {api,send,message,queryClient} from './lib/api';
import {Brand} from './components/brand';
import {Button} from './components/ui/button';
import {AccountHelp} from './account-help';
import {Skeleton} from './components/ui/skeleton';
import {StatusBadge} from './components/whumpo/status-badge';
import {Deadline,TimeAgo} from './lib/time-ago';

const base='/workspace/site-safety',key=['site-safety'];
type Receipt={version:1;review:SiteSafetyReview};
const wrap='min-h-11 h-auto whitespace-normal text-left',alert='rounded-md border border-attention-ink/40 bg-attention-soft p-4 text-body-sm text-attention-ink',checking=(text:string)=><div role="status" className="space-y-2"><span className="sr-only">{text}</span><Skeleton className="h-16"/></div>;
export function SiteSafetyLink(){return <Button asChild variant="secondary" className={wrap}><Link to="/workspace/$view" params={{view:'safety'}} search={{}}><ShieldCheck className="size-4 shrink-0"/>Site & app safety</Link></Button>;}

/** Outside profile/Chat/dashboard reads; only current identity and the server's
 * first-project gate admit this fixed recovery surface. No generated controls. */
export function SiteSafetyPage(){
 const navigate=useNavigate(),search=useRouterState({select:s=>s.location.search}),reviewId=search.review,projectId=search.project,service=search.service;
 const [after,setAfter]=useState<string|null>(null),[reviewAfter,setReviewAfter]=useState<string|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const lock=useRef(false),heading=useRef<HTMLHeadingElement>(null),mounted=useRef(true),lastReview=useRef('');
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const inventory=useQuery({queryKey:[...key,'inventory',after],queryFn:()=>api<SiteSafetyInventory>(base+(after?'?after='+after:'')),staleTime:0,gcTime:0,refetchOnWindowFocus:true});
 const reviews=useQuery({queryKey:[...key,'reviews',projectId,reviewAfter],queryFn:()=>api<SiteSafetyReviews>(base+'/reviews?project='+projectId+(reviewAfter?'&after='+reviewAfter:'')),enabled:!!projectId&&service===undefined,staleTime:0,gcTime:0,refetchOnWindowFocus:true});
 const detail=useQuery({queryKey:[...key,'review',reviewId],queryFn:()=>api<Receipt>(base+'/reviews/'+reviewId),enabled:!!reviewId&&service===undefined,staleTime:0,gcTime:0,refetchOnWindowFocus:true});
 useEffect(()=>{document.title='Site & app safety — Whumpo';heading.current?.focus();},[]);
 useEffect(()=>{setError('');},[reviewId,projectId]);
 const current=detail.data&&!detail.error&&!detail.isFetching?detail.data.review:undefined;
 useLayoutEffect(()=>{if(!current)return;const stamp=current.id+':'+current.state;if(lastReview.current===stamp)return;lastReview.current=stamp;if(document.activeElement===document.body||document.activeElement?.textContent==='Review taking website offline')document.querySelector<HTMLElement>('[data-withdrawal-title]')?.focus();},[current]);
 async function showReview(id:string,project=projectId){await navigate({to:'/workspace/$view',params:{view:'safety'},search:{project,review:id}});}
 async function act(fn:()=>Promise<Receipt>,id:string,project=projectId){
  if(lock.current)return;const generation=identityGeneration(),present=()=>mounted.current&&generation===identityGeneration();lock.current=true;setBusy(true);setError('');
  try{const saved=await fn();if(!present())return;queryClient.setQueryData([...key,'review',id],saved);await showReview(id,project);}
  catch(e){if(!present())return;await showReview(id,project);setError((e instanceof SyntaxError?'The response was interrupted.':message(e))+' Check the saved result before deciding what to do next. This action will not be sent again automatically.');}
  finally{lock.current=false;if(present()){setBusy(false);void queryClient.invalidateQueries({queryKey:key});void queryClient.invalidateQueries({queryKey:['dashboard']});}}
 }
 return <main className="min-h-dvh bg-surface px-5 py-6 sm:px-8 sm:py-9"><div className="mx-auto max-w-3xl space-y-7">
  <Brand/><div className="flex flex-wrap items-center justify-between gap-3"><ReturnLink/><AccountHelp/></div>
  <header><h1 ref={heading} tabIndex={-1} className="text-title">Site & app safety</h1><p className="mt-3 text-ink-muted">Take published work offline while keeping its saved versions and data. These controls work independently of Chat.</p><details className="mt-3 text-body-sm text-ink-muted"><summary className="min-h-11 cursor-pointer py-3 font-medium text-ink">What to know</summary><p>Each review names exactly what it takes offline: a website, backend tool or visitor app. CMS articles have separate publishing controls and are outside this page.</p></details></header>
  {error&&<p role="alert" className={alert}>{error}</p>}
  {reviewId&&service===undefined&&<section aria-label="Website withdrawal review" className="rounded-lg border bg-surface-raised p-5 sm:p-6 space-y-4">
   <h2 tabIndex={-1} className="text-heading">Saved withdrawal</h2>
   {detail.isFetching&&checking('Checking the saved review…')}
   {detail.error&&<p role="alert" className={alert}>{message(detail.error)}</p>}
   {current&&<Withdrawal review={current} busy={busy} confirm={()=>void act(()=>send<Receipt>(base+'/reviews/'+current.id+'/confirm',{version:1,confirmation:'UNPUBLISH_WEBSITE'}),current.id,current.projectId)}/>}
   <div className="flex flex-wrap gap-3"><Button variant="secondary" className={wrap} disabled={busy||detail.isFetching} onClick={()=>void detail.refetch()}>Check saved result</Button><Button asChild variant="quiet" className={wrap}><Link to="/workspace/$view" params={{view:'safety'}} search={{project:projectId}}>Close review</Link></Button></div>
  </section>}
  {service!==undefined&&(service==='backend'||service==='application'?<ServiceSafetyPanel key={service+projectId} kind={service} project={projectId} review={reviewId}/>:<p role="alert" className={alert}>This saved service link is not valid. Choose a current service below.</p>)}
  <section className="space-y-4" aria-labelledby="safety-websites"><div className="flex flex-wrap items-center justify-between gap-3"><h2 id="safety-websites" className="text-heading">Your published work</h2><Button variant="secondary" className={wrap} disabled={busy||inventory.isFetching} onClick={()=>void inventory.refetch()}>Check publication status</Button></div>
   {inventory.isFetching&&checking('Checking your published work…')}{inventory.error&&<p role="alert" className={alert}>{message(inventory.error)}</p>}
   {inventory.data&&!inventory.error&&!inventory.isFetching&&<>{inventory.data.projects.map(project=><article key={project.id} className="rounded-lg border bg-surface-raised p-5 space-y-3" aria-label={project.name}>
    <h3 className="text-heading break-words">{project.name}</h3><p className="text-body-sm break-all">{project.url}</p><p className="text-body-sm"><StatusBadge status={project.versionId?'ready':'idle'}>{project.versionId?'Website published':'Website offline'}</StatusBadge></p><div className="flex flex-wrap gap-3">
     {project.versionId&&<Button variant="secondary" className={wrap} disabled={busy} onClick={()=>{const id=crypto.randomUUID();void act(()=>send<Receipt>(base+'/reviews',{version:1,id,projectId:project.id,expectedRevision:project.revision}),id,project.id);}}>Review taking website offline</Button>}
     <Button variant="quiet" className={wrap} disabled={busy} onClick={()=>{setReviewAfter(null);void navigate({to:'/workspace/$view',params:{view:'safety'},search:{project:project.id}});}}>Saved withdrawals</Button>
    </div>{project.services.map(resource=><ServiceSafetyActions key={resource.kind} resource={resource}/>)}</article>)}{!inventory.data.projects.length&&<p>No projects on this page.</p>}<div className="flex flex-wrap gap-3">{after&&<Button variant="secondary" className={wrap} onClick={()=>setAfter(null)}>First projects</Button>}{inventory.data.next&&<Button variant="secondary" className={wrap} onClick={()=>setAfter(inventory.data!.next)}>More projects</Button>}</div></>}
  </section>
  {projectId&&service===undefined&&<section aria-label="Saved website withdrawals" className="space-y-4"><h2 className="text-heading">Saved website withdrawals</h2><p className="text-body-sm text-ink-muted">Open a saved review or result. Reading one never retries or approves it.</p>
   <Button variant="secondary" className={wrap} disabled={busy||reviews.isFetching} onClick={()=>void reviews.refetch()}>Check saved withdrawals</Button>
   {reviews.isFetching&&checking('Checking saved withdrawals…')}{reviews.error&&<p role="alert" className={alert}>{message(reviews.error)}</p>}
   {reviews.data&&!reviews.error&&!reviews.isFetching&&<>{reviews.data.reviews.map(review=><Button key={review.id} variant="secondary" className={wrap+' w-full justify-start'} onClick={()=>void showReview(review.id)}>{review.name} · {stateLabel(review.state)} · {review.appliedAt?<>Applied <TimeAgo value={review.appliedAt}/></>:<>Review expires <TimeAgo value={review.expiresAt}/></>}</Button>)}{!reviews.data.reviews.length&&<p>No saved withdrawals on this page.</p>}<div className="flex flex-wrap gap-3">{reviewAfter&&<Button variant="secondary" className={wrap} onClick={()=>setReviewAfter(null)}>First withdrawals</Button>}{reviews.data.next&&<Button variant="secondary" className={wrap} onClick={()=>setReviewAfter(reviews.data!.next)}>More withdrawals</Button>}</div></>}
  </section>}
 </div></main>;
}
const stateLabel=(state:SiteSafetyReview['state'])=>({pending:'Awaiting confirmation',applied:'Withdrawal applied',expired:'Review expired',changed:'Website changed'})[state];
function Withdrawal({review:r,busy,confirm}:{review:SiteSafetyReview;busy:boolean;confirm:()=>void}){
 return <div className="space-y-4"><h3 data-withdrawal-title tabIndex={-1} className="text-heading">{stateLabel(r.state)}: {r.name}</h3><p className="text-body-sm break-all">{r.url}</p>
  {r.state==='pending'?<><p>Taking this website offline removes its public page and stops its attached contact form and tool. Saved versions stay private.</p><p className="text-body-sm text-ink-muted">Confirm before <Deadline value={r.expiresAt}/>.</p><details className="text-body-sm text-ink-muted"><summary className="min-h-11 cursor-pointer py-3 font-medium text-ink">Review details</summary><p>Publication revision {r.expectedRevision}</p><p className="mt-2">Saved version: <span className="break-all">{r.versionId}</span></p></details><Button className={wrap} disabled={busy} onClick={confirm}>Confirm taking this website offline</Button></>:r.state==='applied'?<><p role="status">This withdrawal was applied{r.appliedAt?<> <TimeAgo value={r.appliedAt}/></>:null}.</p><p>{r.versionId?'A website is published now. This earlier withdrawal does not take a later publication offline.':'The website is currently offline.'}</p></>:<p>This review can no longer be confirmed. Check the current website status to prepare a fresh review.</p>}
 </div>;
}
