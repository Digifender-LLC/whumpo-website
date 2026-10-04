import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {useNavigate} from '@tanstack/react-router';
import {useQuery} from '@tanstack/react-query';
import type {SafetyService,ServiceSafetyResource,ServiceSafetyReview,ServiceSafetyReceipt,ServiceSafetyReviews} from '../../src/service-safety-shape';
import {api,send,message,queryClient} from './lib/api';
import {identityGeneration} from './lib/identity-invalidation';
import {Button} from './components/ui/button';

const base='/workspace/service-safety/reviews',key=['service-safety'],wrap='min-h-11 h-auto whitespace-normal text-left';
const label=(kind:SafetyService)=>kind==='backend'?'Backend tool':'Visitor app';
const status=(state:ServiceSafetyReview['state'])=>({pending:'Awaiting confirmation',applied:'Withdrawal applied',expired:'Review expired',changed:'Publication changed'})[state];
function useWithdrawal(){
 const navigate=useNavigate(),[busy,setBusy]=useState(false),[error,setError]=useState(''),lock=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 async function run(kind:SafetyService,projectId:string,id:string,work:()=>Promise<ServiceSafetyReceipt>){
  if(lock.current)return;lock.current=true;setBusy(true);setError('');const generation=identityGeneration(),present=()=>mounted.current&&identityGeneration()===generation;
  try{const result=await work();if(!present())return;queryClient.setQueryData([...key,'review',kind,id],result);await navigate({to:'/workspace/$view',params:{view:'safety'},search:{project:projectId,service:kind,review:id}});}
  catch(e){if(!present())return;setError((e instanceof SyntaxError?'The response was interrupted.':message(e))+' Check the saved result. This action will not be sent again automatically.');await navigate({to:'/workspace/$view',params:{view:'safety'},search:{project:projectId,service:kind,review:id}});}
  finally{lock.current=false;if(present()){setBusy(false);void queryClient.invalidateQueries({queryKey:key});void queryClient.invalidateQueries({queryKey:['site-safety']});void queryClient.invalidateQueries({queryKey:['dashboard']});}}
 }
 return {run,busy,error};
}
export function ServiceSafetyActions({resource:r}:{resource:ServiceSafetyResource}){
 const action=useWithdrawal(),navigate=useNavigate();
 return <section aria-label={label(r.kind)+' for '+r.name} className="border-t pt-4 space-y-3"><h4 className="font-semibold">{label(r.kind)}</h4><p className="break-all text-sm">{r.url}</p><p className="text-sm">{r.published?'Published':'Offline'}</p>
  {action.error&&<p role="alert" className="text-sm">{action.error}</p>}<div className="flex flex-wrap gap-3">
   {r.published&&<Button variant="secondary" className={wrap} disabled={action.busy} onClick={()=>{const id=crypto.randomUUID();void action.run(r.kind,r.projectId,id,()=>send<ServiceSafetyReceipt>(base,{version:1,id,kind:r.kind,projectId:r.projectId,expectedRevision:r.revision,programRevision:r.programRevision,versionId:r.versionId}));}}>Review taking {label(r.kind).toLowerCase()} offline</Button>}
   <Button variant="quiet" className={wrap} disabled={action.busy} onClick={()=>void navigate({to:'/workspace/$view',params:{view:'safety'},search:{project:r.projectId,service:r.kind}})}>Saved {label(r.kind).toLowerCase()} withdrawals</Button>
  </div></section>;
}
export function ServiceSafetyPanel({kind,project,review}:{kind:SafetyService;project?:string;review?:string}){
 const navigate=useNavigate(),action=useWithdrawal(),heading=useRef<HTMLHeadingElement>(null),resultHeading=useRef<HTMLHeadingElement>(null),lastResult=useRef(''),[after,setAfter]=useState<string|null>(null);
 const detail=useQuery({queryKey:[...key,'review',kind,review],queryFn:()=>api<ServiceSafetyReceipt>(base+'/'+kind+'/'+review),enabled:!!review,staleTime:0,gcTime:0,refetchOnWindowFocus:true});
 const list=useQuery({queryKey:[...key,'list',kind,project,after],queryFn:()=>api<ServiceSafetyReviews>(base+'?kind='+kind+'&project='+project+(after?'&after='+after:'')),enabled:!!project,staleTime:0,gcTime:0,refetchOnWindowFocus:true});
 const current=detail.data&&!detail.error&&!detail.isFetching?detail.data.review:undefined;
 useEffect(()=>{heading.current?.focus();},[kind,review]);
 useLayoutEffect(()=>{
  if(!current)return;const stamp=current.id+':'+current.state;if(lastResult.current===stamp)return;lastResult.current=stamp;
  if(document.activeElement===document.body||document.activeElement?.textContent?.startsWith('Confirm taking '))resultHeading.current?.focus();
 },[current]);
 return <section aria-label={label(kind)+' withdrawals'} className="rounded-lg border bg-card p-5 sm:p-6 space-y-4">
  <h2 ref={heading} tabIndex={-1} className="text-xl font-bold">{label(kind)} withdrawals</h2>
  {action.error&&<p role="alert" className="text-sm">{action.error}</p>}
  {review&&<><div className="flex flex-wrap gap-3"><Button className={wrap} variant="secondary" disabled={detail.isFetching||action.busy} onClick={()=>void detail.refetch()}>Check saved result</Button><Button variant="quiet" className={wrap} onClick={()=>void navigate({to:'/workspace/$view',params:{view:'safety'},search:{project,service:kind}})}>Close review</Button></div>
   {detail.isFetching&&<p role="status">Checking saved result…</p>}{detail.error&&<p role="alert">{message(detail.error)}</p>}
   {current&&<div className="space-y-4"><h3 ref={resultHeading} tabIndex={-1} className="text-lg font-bold" role={current.state==='applied'?'status':undefined}>{status(current.state)}: {current.name}</h3><p className="break-all text-sm">{current.url}</p>
    {current.state==='pending'?<><p>{kind==='backend'?'This stops new requests to the backend tool and disables any website form attached to it. Requests already admitted may finish. Saved code and private data are kept.':'This takes the visitor page and its API offline. Visitors stay signed in to your project’s visitor access, but data changes sent through this page that have not committed are rejected. Saved app data and history are kept.'}</p><p className="text-sm text-muted-foreground">Your website and other published services stay as they are.</p><p className="text-sm text-muted-foreground">Confirm before {new Date(current.expiresAt).toLocaleString()}.</p><details className="text-sm"><summary className="min-h-11 py-3 cursor-pointer">Review details</summary><p>Publication revision {current.expectedRevision}</p>{current.programRevision!==null&&<p>Program revision {current.programRevision}</p>}{current.versionId&&<p className="break-all">Saved version: {current.versionId}</p>}</details><Button className={wrap} disabled={action.busy} onClick={()=>void action.run(kind,current.projectId,current.id,()=>send<ServiceSafetyReceipt>(base+'/'+kind+'/'+current.id+'/confirm',{version:1,confirmation:'TAKE_OFFLINE'}))}>Confirm taking {label(kind).toLowerCase()} offline</Button></>:current.state==='applied'?<><p>This withdrawal was applied.</p><p>{current.publishedNow?'This service is published now. The earlier withdrawal does not take a later publication offline.':'This service is currently offline.'}</p></>:<p>This review can no longer be confirmed. Check current status to prepare a fresh review.</p>}
   </div>}
  </>}
  {project&&<div className="space-y-3 border-t pt-4"><h3 className="font-semibold">Saved reviews and results</h3><p className="text-sm text-muted-foreground">Opening a saved item never retries or approves it.</p><Button className={wrap} variant="secondary" disabled={list.isFetching||action.busy} onClick={()=>void list.refetch()}>Check saved withdrawals</Button>
   {list.isFetching&&<p role="status">Checking saved withdrawals…</p>}{list.error&&<p role="alert">{message(list.error)}</p>}
   {list.data&&!list.error&&!list.isFetching&&<>{list.data.reviews.map(r=><Button key={r.id} variant="secondary" className={wrap+' w-full justify-start'} onClick={()=>void navigate({to:'/workspace/$view',params:{view:'safety'},search:{project,service:kind,review:r.id}})}>{r.name} · {status(r.state)} · Review expires {new Date(r.expiresAt).toLocaleString()}</Button>)}{!list.data.reviews.length&&<p>No saved withdrawals on this page.</p>}<div className="flex flex-wrap gap-3">{after&&<Button className={wrap} variant="secondary" onClick={()=>setAfter(null)}>First withdrawals</Button>}{list.data.next&&<Button className={wrap} variant="secondary" onClick={()=>setAfter(list.data!.next)}>More withdrawals</Button>}</div></>}
  </div>}
 </section>;
}
