import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {Link} from '@tanstack/react-router';
import {useInfiniteQuery,useQueries,type InfiniteData} from '@tanstack/react-query';
import {ArrowLeft,History} from 'lucide-react';
import {savedWorkKinds,type SavedWorkItem,type SavedWorkKind,type SavedWorkList} from '../../src/saved-work-shape';
import {api,APIError,message} from './lib/api';
import {identityGeneration} from './lib/identity-invalidation';
import {isSavedWorkKind,readSavedTurn,readSavedWorkList,savedWorkDestination,savedWorkExpiry,savedWorkPath,savedWorkStatus,type SavedWorkView} from './lib/saved-work';
import {Brand} from './components/brand';
import {Button} from './components/ui/button';
import {AccountHelp} from './account-help';
import {useWorkspaceAccount} from './identity/flow';
import {checkChatRequest,checkFormRequest,checkPhotoUpload,localRecoveryCopy,localRecoveryDestination,localRecoveryNeedsCheck,readLocalRecovery,type LocalCheck,type LocalRecoveryItem} from './lib/local-recovery';
import {readPhotoUploadStatus} from '../../src/photo-upload-shape';
import {StatusBadge,type Status} from './components/whumpo/status-badge';
import type {InteractionReceipt} from '../../src/chat-interactions/types';

const wrap='min-h-11 h-auto whitespace-normal text-left';
export function SavedWorkLink({onNavigate}:{onNavigate?:()=>void}){return <Button asChild variant="secondary" className={wrap}><Link to="/workspace/$view" params={{view:'saved-work'}} search={{}} onClick={onNavigate}><History className="size-4 shrink-0"/>Saved work</Link></Button>;}

/** Identity-only fixed page, outside profile/Chat/dashboard reads. It lists
 * stored metadata and links to existing exact destinations; it never approves,
 * retries, reconciles or selects a project. */
export function SavedWorkPage(){
 const [view,setView]=useState<SavedWorkView>('open'),[kind,setKind]=useState<SavedWorkKind|null>(null),[localRevision,setLocalRevision]=useState(0),owner=useWorkspaceAccount();
 const heading=useRef<HTMLHeadingElement>(null),results=useRef<HTMLHeadingElement>(null),mounted=useRef(true),wasHidden=useRef(false),focusIndex=useRef<number|null>(null);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 useEffect(()=>{document.title='Saved work — Whumpo';heading.current?.focus();},[]);
 const list=useInfiniteQuery<SavedWorkList,Error,InfiniteData<SavedWorkList,string|null>,(string|null)[],string|null>({queryKey:['saved-work',view,kind],initialPageParam:null as string|null,getNextPageParam:last=>last.next,staleTime:0,gcTime:0,refetchOnWindowFocus:true,
  queryFn:async({pageParam,signal})=>{
   const generation=identityGeneration(),value=await api<unknown>(savedWorkPath(view,kind,pageParam),{signal,cache:'no-store'});
   if(generation!==identityGeneration())throw new APIError('Account access changed. Check your current workspace.',401);
   const page=readSavedWorkList(value,pageParam);if(!page)throw new APIError('Refresh Whumpo to read your current saved work.',409,'client_update_required');return page;
  }});
 // Cached rows disappear while every loaded page is re-read or after that read fails.
 const refreshing=list.isFetching&&!list.isFetchingNextPage,visible=!!list.data&&!refreshing&&(!list.error||list.isFetchNextPageError);
 const items=visible?list.data!.pages.flatMap(page=>page.items):[];
 const groups=items.reduce<{kind:SavedWorkKind;items:SavedWorkItem[]}[]>((all,item)=>{const last=all.at(-1);if(last&&last.kind===item.kind)last.items.push(item);else all.push({kind:item.kind,items:[item]});return all;},[]);
 useLayoutEffect(()=>{
  if(!visible){wasHidden.current=true;return;}
  // Show more moves focus to the first newly loaded entry once it is rendered.
  const index=focusIndex.current;
  if(index!==null&&items.length>index){focusIndex.current=null;if(document.activeElement===document.body||document.activeElement?.hasAttribute('data-saved-work-more'))document.querySelector<HTMLElement>('[data-saved-work-key="'+CSS.escape(items[index].key)+'"]')?.focus();return;}
  if(wasHidden.current&&document.activeElement===document.body)results.current?.focus();
  wasHidden.current=false;
 },[visible,items.length]);
 async function showMore(){
  focusIndex.current=items.length;
  const result=await list.fetchNextPage();
  if(mounted.current&&result.isFetchNextPageError)focusIndex.current=null;
 }
 const viewLabel=view==='open'?'Open work':'All saved work';
 return <main className="min-h-dvh bg-background px-5 py-6 sm:px-8 sm:py-9"><div className="mx-auto max-w-3xl space-y-7">
  <Brand/><div className="flex flex-wrap items-center justify-between gap-3"><Button asChild variant="quiet" className={wrap}><Link to="/workspace/$view" params={{view:'dashboard'}} search={{}}><ArrowLeft className="size-4"/>Back to Dashboard</Link></Button><AccountHelp/></div>
  <header><h1 ref={heading} tabIndex={-1} className="text-3xl font-bold">Saved work</h1><p className="mt-3 text-muted-foreground">Find requests, reviews and forms Whumpo saved for you, then open each one in its exact place.</p><p className="mt-3 text-sm text-muted-foreground">This page only reads saved records. It never approves, retries or sends anything. The page you open shows the current state, which can differ from the saved status here.</p></header>
  {owner&&<LocalRecoverySection key={owner} owner={owner} revision={localRevision}/>}
  <section aria-label="Saved work filters" className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-4">
   <div role="group" aria-label="Which saved work to show" className="flex flex-wrap gap-2">{(['open','all'] as const).map(value=><Button key={value} type="button" variant={view===value?'primary':'secondary'} aria-pressed={view===value} className={wrap} onClick={()=>{focusIndex.current=null;setView(value);}}>{value==='open'?'Open work':'All saved work'}</Button>)}</div>
   <div className="flex flex-col gap-2 min-w-0"><label htmlFor="saved-work-kind" className="text-sm font-medium">Type</label><select id="saved-work-kind" value={kind??''} onChange={event=>{focusIndex.current=null;setKind(isSavedWorkKind(event.target.value)?event.target.value:null);}} className="min-h-11 w-full sm:w-auto max-w-full rounded-md border bg-background px-3">
    <option value="">All types</option>{(Object.entries(savedWorkKinds) as [SavedWorkKind,string][]).map(([value,label])=><option key={value} value={value}>{label}</option>)}
   </select></div>
  </section>
  <section aria-labelledby="saved-work-results" className="space-y-4">
   <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="saved-work-results" ref={results} tabIndex={-1} className="text-xl font-bold">{viewLabel}{kind?' · '+savedWorkKinds[kind]:''}</h2><Button variant="secondary" className={wrap} disabled={list.isFetching} onClick={()=>{setLocalRevision(value=>value+1);void list.refetch();}}>Check saved work again</Button></div>
   {refreshing&&<p role="status">Checking your saved work…</p>}
   {list.error&&!list.isFetchNextPageError&&!refreshing&&<div role="alert" className="rounded-md border bg-card p-4 space-y-3 text-sm"><p>{message(list.error)}</p><p>Saved records are unchanged by this page. Use Check saved work again to retry.</p></div>}
   {visible&&<>
    <p role="status" className="text-sm text-muted-foreground">{items.length?`Showing ${items.length} saved ${items.length===1?'item':'items'}${list.hasNextPage?'. More are available.':'.'}`:view==='open'?'No open saved work. Choose All saved work to include finished and expired items.':'No saved work matches this filter.'}</p>
    {groups.map(group=><section key={group.kind} aria-labelledby={'saved-work-group-'+group.kind} className="space-y-3"><h3 id={'saved-work-group-'+group.kind} className="text-lg font-bold break-words">{savedWorkKinds[group.kind]}</h3>
     <ul className="space-y-3">{group.items.map(item=><li key={item.key}><SavedWorkEntry item={item}/></li>)}</ul>
    </section>)}
    {list.isFetchNextPageError&&<p role="alert" className="rounded-md border bg-card p-4 text-sm">{message(list.error)} The items above are from the last completed check.</p>}
    {list.hasNextPage&&<Button data-saved-work-more variant="secondary" className={wrap} disabled={list.isFetchingNextPage} onClick={()=>void showMore()}>{list.isFetchingNextPage?'Loading more…':'Show more'}</Button>}
   </>}
  </section>
 </div></main>;
}
// Status colour follows the design system; the phase word stays the signal.
const phaseStatus:Record<SavedWorkItem['phase'],Status>={review:'attention',form:'attention',working:'working',uncertain:'working',attention:'attention',finished:'ready',expired:'idle'};
function SavedWorkEntry({item}:{item:SavedWorkItem}){
 const status=savedWorkStatus(item),expiry=savedWorkExpiry(item),destination=savedWorkDestination(item),place=item.projectName??'Your account',id='saved-work-'+item.kind+'-'+item.id;
 return <article data-saved-work-key={item.key} tabIndex={-1} aria-labelledby={id} className="rounded-lg border bg-card p-4 sm:p-5 space-y-2 min-w-0">
  <h4 id={id} className="font-semibold break-words">{place}<span className="sr-only">, {savedWorkKinds[item.kind]}</span></h4>
  <p className="text-sm font-medium" data-saved-work-phase={item.phase}><StatusBadge status={phaseStatus[item.phase]}>{status.label}</StatusBadge></p>
  <p className="text-sm text-muted-foreground">{status.detail}</p>
  {expiry&&<p className="text-sm">{expiry}</p>}
  {destination?<Button asChild variant="secondary" className={wrap}>{destination.kind==='safety'
   ?<Link to="/workspace/$view" params={{view:'safety'}} search={destination.search}>{destination.label}<span className="sr-only"> for {savedWorkKinds[item.kind]}, {place}</span></Link>
   :<Link to="/workspace" search={destination.search}>{destination.label}<span className="sr-only"> for {savedWorkKinds[item.kind]}, {place}</span></Link>}</Button>
  :<p className="text-sm text-muted-foreground">No linked Chat message or review page. This status is shown for reference.</p>}
 </article>;
}

const notFound=(error:unknown)=>error instanceof APIError&&error.status===404;
/** Reads only. Server checks never resend, upload, approve or clear this tab's
 * records; the item's own page resolves them. Late replies are fenced. */
async function checkLocal(item:LocalRecoveryItem,signal:AbortSignal):Promise<LocalCheck>{
 const generation=identityGeneration(),options={signal,cache:'no-store' as const};
 let result:LocalCheck;
 if(item.kind==='chat-request')result=await checkChatRequest(item.request,async id=>{
  try{const turn=readSavedTurn(await api<unknown>('/chat/turns/'+id,options),id);if(!turn)throw new APIError('Refresh Whumpo to check this message.',409,'client_update_required');return turn;}
  catch(error){if(notFound(error))return null;throw error;}
 });
 else if(item.kind==='form-request')result=await checkFormRequest(item.request,async requestId=>{
  try{return await api<InteractionReceipt>('/chat/interactions/v1/receipt',{...options,method:'POST',body:JSON.stringify({version:1,requestId})});}
  catch(error){if(notFound(error))return null;throw error;}
 });
 else if(item.kind==='photo'){
  const status=readPhotoUploadStatus(await api<unknown>(`/projects/${item.upload.projectId}/files/${item.upload.id}`,{...options,headers:{'x-whumpo-photo-handoff':JSON.stringify(item.upload.handoff)}}));
  if(!status)throw new APIError('Refresh Whumpo to check this upload.',409,'client_update_required');
  result=checkPhotoUpload(item.upload,status);
 }else throw Error('Nothing to check.');
 if(generation!==identityGeneration())throw new APIError('Account access changed. Check your current workspace.',401);
 return result;
}
function LocalRecoverySection({owner,revision}:{owner:string;revision:number}){
 const [local,setLocal]=useState(()=>{try{return readLocalRecovery(sessionStorage,owner);}catch{return {items:[] as LocalRecoveryItem[],failed:true};}});
 const first=useRef(true);
 useEffect(()=>{if(first.current){first.current=false;return;}try{setLocal(readLocalRecovery(sessionStorage,owner));}catch{setLocal({items:[],failed:true});}},[owner,revision]);
 useEffect(()=>{const reset=()=>setLocal({items:[],failed:false});window.addEventListener('whumpo:workspace-reset',reset);return()=>window.removeEventListener('whumpo:workspace-reset',reset);},[]);
 const checked:LocalRecoveryItem[]=local.items.filter(localRecoveryNeedsCheck);
 const checks=useQueries({queries:checked.map(item=>({queryKey:['local-recovery',owner,item.key,revision],queryFn:({signal}:{signal:AbortSignal})=>checkLocal(item,signal),staleTime:0,gcTime:0,retry:false}))});
 const state=(item:LocalRecoveryItem):LocalCheck|'checking'|'error'|null=>{const index=checked.indexOf(item);if(index<0)return null;const q=checks[index];return q.isFetching||q.isPending?'checking':q.error?'error':q.data??null;};
 if(!local.items.length&&!local.failed)return null;
 return <section aria-labelledby="saved-work-local" className="space-y-3" data-local-recovery-section>
  <h2 id="saved-work-local" className="text-xl font-bold">On this device</h2>
  <p className="text-sm text-muted-foreground">Only this browser tab keeps these records. They are not saved to your account and clear when you sign out or change accounts. Checking them never sends anything again.</p>
  {local.failed&&<p role="alert" className="text-sm">Some recovery details in this tab could not be read. Keep this tab open and open Chat to check your work.</p>}
  <ul className="space-y-3">{local.items.map(item=>{const check=state(item),copy=localRecoveryCopy(item,check),destination=localRecoveryDestination(item),id='saved-work-local-'+item.key.replace(/[^a-z0-9-]/g,'-'),status=check==='checking'?'checking':check==='error'?'error':check?check.state:item.kind==='location'?'location':'unsaved';
   return <li key={item.key}><article data-local-recovery={item.kind} data-local-state={status} aria-labelledby={id} className="rounded-lg border border-dashed bg-card p-4 sm:p-5 space-y-2 min-w-0">
    <h3 id={id} className="font-semibold break-words">{copy.title}</h3>
    <p className="text-sm font-medium" role={check==='checking'?'status':undefined}>{copy.label}</p>
    <p className="text-sm text-muted-foreground">{copy.detail}</p>
    <Button asChild variant="secondary" className={wrap}>{destination.kind==='photos'
     ?<Link to="/workspace/$view" params={{view:'photos'}} search={destination.search}>{destination.label}<span className="sr-only">: {copy.title}</span></Link>
     :<Link to="/workspace" search={destination.search}>{destination.label}<span className="sr-only">: {copy.title}</span></Link>}</Button>
   </article></li>;})}</ul>
 </section>;
}
