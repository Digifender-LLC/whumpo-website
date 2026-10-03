import {useEffect} from 'react';
import {useQuery} from '@tanstack/react-query';
import {isProjectFacts,readViewComponentData,viewBinding,type ProjectFacts} from '../../src/workspace-view-data';
import type {WidgetKind} from '../../src/workspace-view-contract';
import {api,APIError,message,queryClient} from './lib/api';
import {Button} from './components/ui/button';
import {TrafficCard} from './traffic-card';

export const viewLabels:Record<WidgetKind,string>={projects:'Projects',usage:'AI assistance',storage:'File storage',activity:'Recent activity',traffic:'Page requests',cms:'Publishing desk',performance:'Processing performance'};
export function CheckedAt({value}:{value:string}){return <p className="text-xs text-muted-foreground">Checked <time dateTime={value}>{new Date(value).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</time>. Saved status; refresh to check again.</p>;}
/** The same trusted project element appears in Chat and saved/temporary views. */
export function ProjectStatusFacts({value}:{value:ProjectFacts}){
 if(!isProjectFacts(value))return <p role="alert" className="text-sm">Update Whumpo to read this status.</p>;
 return <div className="space-y-3 text-sm"><p className="font-medium break-words">{value.name}</p><dl className="space-y-2"><div className="flex flex-wrap justify-between gap-x-4 gap-y-1"><dt className="text-muted-foreground">Project</dt><dd>{{draft:'Private draft',building:'Building',live:'Live services',error:'Needs attention'}[value.state]}</dd></div><div className="flex flex-wrap justify-between gap-x-4 gap-y-1"><dt className="text-muted-foreground">Website</dt><dd>{value.websitePublished?'Published':'Not published'}</dd></div></dl></div>;
}
export function ViewComponentDisplay({value}:{value:unknown}){
 const c=readViewComponentData(value);
 if(!c)return <p role="alert" className="text-sm">Update Whumpo to read this view.</p>;
 if(c.status!=='ready')return <p role="status" className="text-sm">{c.status==='denied'?'This information is not available with your current access.':c.kind==='performance'?'No processing telemetry is connected. Creating a page does not provision processing services.':'This information is temporarily unavailable. Try refreshing it.'}</p>;
 return <div className="space-y-4">
  {c.kind==='projects'&&(c.data.items.length?<div className="space-y-4">{c.data.items.map(p=><div key={p.projectId} className="rounded-xl bg-background p-4"><ProjectStatusFacts value={p}/></div>)}</div>:<p className="text-sm text-muted-foreground">Your next idea starts here. Tell Whumpo what you’d like to make.</p>)}
  {c.kind==='usage'&&<><p className="text-2xl font-bold">Standard AI included</p><p className="text-sm text-muted-foreground">Build and maintain your projects without spending credits, under fair use.</p><p className="text-xs text-muted-foreground">Advanced models are not enabled yet. Resource capacity and historical usage are separate.</p></>}
  {c.kind==='storage'&&<><p className="text-4xl font-bold">{(c.data.bytes/1048576).toFixed(1)} MB</p><p className="text-sm text-muted-foreground">{c.data.files.toLocaleString()} saved project photos. CMS media and database storage are not included in this measurement.</p></>}
  {c.kind==='activity'&&(c.data.items.length?<div className="space-y-4">{c.data.items.map(a=><div key={a.id} className="border-b pb-3 last:border-0"><p className="text-sm break-words">{a.summary}</p><time className="text-xs text-muted-foreground mt-1" dateTime={a.createdAt}>{new Date(a.createdAt).toLocaleString()}</time></div>)}</div>:<p className="text-sm text-muted-foreground">New project activity will appear here.</p>)}
  {c.kind==='traffic'&&<TrafficCard traffic={c.data} projectId={c.projectId}/>}
  {c.kind==='cms'&&<div className="space-y-4">{c.data.items.map(p=><div key={p.projectId}><p className="font-semibold break-words">{p.name}</p><p className="text-sm text-muted-foreground">{p.publishedArticles} published articles</p></div>)}</div>}
  <CheckedAt value={c.asOf}/>
 </div>;
}
/** Owner/revision/scoped cache, evicted on unmount. Never show old private facts
 * while access is being refreshed or after the current read fails. */
export function SavedViewComponent({owner,pageId,revision,kind,projectId}:{owner:string;pageId:string;revision:number;kind:WidgetKind;projectId:string|null}){
 const query=useQuery({queryKey:['workspace-view-component',owner,pageId,revision,kind,projectId],queryFn:async({signal})=>{
  const raw=await api('/workspace/views/v1/component',{method:'POST',body:JSON.stringify({version:1,pageId,revision,kind}),signal}),value=readViewComponentData(raw);
  if(!value||value.kind!==kind||value.projectId!==projectId||value.binding!==viewBinding(kind,projectId))throw new APIError('Update Whumpo to read this view.',409,'client_update_required');
  return value;
 },staleTime:0,gcTime:0,retry:false,refetchOnWindowFocus:true});
 useEffect(()=>{if(query.error instanceof APIError&&query.error.code==='workspace_layout_changed')void queryClient.invalidateQueries({queryKey:['dashboard']});},[query.error]);
 return <div data-view-component={kind} className="space-y-4">
  {query.isFetching?<p role="status" className="text-sm">Checking current information…</p>:query.error?<p role="alert" className="text-sm">{message(query.error)}</p>:query.data?<ViewComponentDisplay value={query.data}/>:null}
  <Button type="button" variant="outline" className="min-h-11" disabled={query.isFetching} onClick={()=>void query.refetch()}>Refresh {viewLabels[kind].toLowerCase()}</Button>
 </div>;
}
