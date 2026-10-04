import {SpecificationReviewDetails} from './specification-review-details';
import {useEffect} from 'react';
import {useQuery} from '@tanstack/react-query';
import {isProjectFacts,readViewComponentData,viewBinding,type ProjectFacts} from '../../src/workspace-view-data';
import type {WidgetKind} from '../../src/workspace-view-contract';
import {api,APIError,message,queryClient} from './lib/api';
import {Button} from './components/ui/button';
import {StatusBadge,type Status} from './components/whumpo/status-badge';
import {TrafficCard} from './traffic-card';
import {GuestPreviewsPanel} from './guest-previews-panel';
import {SiteHealthCard} from './site-health-card';
import {ModuleInstancesCard} from './module-instances-card';
import {AccessRolesCard} from './access-roles-card';
import {RecordsSummaryCard} from './records-panel';

export const viewLabels:Record<WidgetKind,string>={projects:'Projects',usage:'AI assistance',storage:'File storage',activity:'Recent activity',traffic:'Page requests',cms:'Publishing desk',performance:'Processing performance',reviews:'Website reviews','guest-previews':'Guest preview links','site-health':'Website health',modules:'Modules','access-roles':'Staff roles','records-summary':'Form records'};
export function CheckedAt({value}:{value:string}){return <p className="text-xs text-muted-foreground">Checked <time dateTime={value}>{new Date(value).toLocaleTimeString([],{hour:'numeric',minute:'2-digit'})}</time>. Saved status; refresh to check again.</p>;}
const projectStatus:Record<ProjectFacts['state'],Status>={draft:'idle',building:'working',live:'ready',error:'attention'};
/** The same trusted project element appears in Chat and saved/temporary views. */
export function ProjectStatusFacts({value}:{value:ProjectFacts}){
 if(!isProjectFacts(value))return <p role="alert" className="text-sm">Update Whumpo to read this status.</p>;
 return <div className="space-y-3 text-sm"><p className="font-medium break-words">{value.name}</p><dl className="space-y-2"><div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1"><dt className="text-muted-foreground">Project</dt><dd><StatusBadge status={projectStatus[value.state]}>{{draft:'Private draft',building:'Building',live:'Live services',error:'Needs attention'}[value.state]}</StatusBadge></dd></div><div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1"><dt className="text-muted-foreground">Website</dt><dd><StatusBadge status={value.websitePublished?'ready':'idle'}>{value.websitePublished?'Published':'Not published'}</StatusBadge></dd></div></dl></div>;
}
export function ViewComponentDisplay({value,owner,onChanged}:{value:unknown;owner?:string;onChanged?:()=>void}){
 const c=readViewComponentData(value);
 if(!c)return <p role="alert" className="text-sm">Update Whumpo to read this view.</p>;
 if(c.status!=='ready')return <p role="status" className="text-sm">{c.status==='denied'?'This information is not available with your current access.':c.kind==='performance'?'No processing telemetry is connected. Creating a page does not provision processing services.':'This information is temporarily unavailable. Try refreshing it.'}</p>;
 return <div className="space-y-4">
  {c.kind==='projects'&&(c.data.items.length?<div className="space-y-4">{c.data.items.map(p=><div key={p.projectId} className="rounded-md bg-surface-sunken p-4"><ProjectStatusFacts value={p}/></div>)}</div>:<p className="text-sm text-muted-foreground">Your next idea starts here. Tell Whumpo what you’d like to make.</p>)}
  {c.kind==='usage'&&<><p className="text-2xl font-bold">Standard AI included</p><p className="text-sm text-muted-foreground">Build and maintain your projects without spending credits, under fair use.</p><p className="text-xs text-muted-foreground">Advanced models are not enabled yet. Resource capacity and historical usage are separate.</p></>}
  {c.kind==='storage'&&<><p className="text-4xl font-bold">{(c.data.bytes/1048576).toFixed(1)} MB</p><p className="text-sm text-muted-foreground">{c.data.files.toLocaleString()} saved project photos. CMS media and database storage are not included in this measurement.</p></>}
  {c.kind==='activity'&&(c.data.items.length?<div className="space-y-4">{c.data.items.map(a=><div key={a.id} className="border-b pb-3 last:border-0"><p className="text-sm break-words">{a.summary}</p><time className="text-xs text-muted-foreground mt-1" dateTime={a.createdAt}>{new Date(a.createdAt).toLocaleString()}</time></div>)}</div>:<p className="text-sm text-muted-foreground">New project activity will appear here.</p>)}
  {c.kind==='traffic'&&<TrafficCard traffic={c.data} projectId={c.projectId}/>}
  {c.kind==='reviews'&&<div className="space-y-4"><p className="text-xs text-muted-foreground">Up to five recent website change reviews. Opening a comparison does not save or publish anything.</p>{c.data.items.map(item=><section key={item.review.id} className="space-y-2"><p className="text-sm font-medium break-words">{item.project.name}</p><p className="text-xs text-muted-foreground">{item.operation==='restore'?'Restore a saved website version':'Proposed website changes'}</p>{owner&&<SpecificationReviewDetails owner={owner} value={item.review}/>}</section>)}{!c.data.items.length&&!c.data.denied&&!c.data.unavailable&&<p className="text-sm">No current website change reviews.</p>}{c.data.denied>0&&<p role="status" className="text-sm">Some reviews are not available with your current access.</p>}{c.data.unavailable>0&&<p role="status" className="text-sm">Some saved reviews changed or could not be checked. Refresh, or ask Whumpo for a fresh review.</p>}<p className="text-xs text-muted-foreground">Approve changes only through their separate review in Chat.</p></div>}
  {c.kind==='guest-previews'&&(c.projectId&&owner&&onChanged?<GuestPreviewsPanel facts={c.data} projectId={c.projectId} onChanged={onChanged}/>:<p className="text-sm">{c.data.links.length} guest preview link(s). Open this page to manage them.</p>)}
  {c.kind==='site-health'&&<SiteHealthCard facts={c.data} projectId={c.projectId} onChanged={owner?onChanged:undefined}/>}
  {c.kind==='modules'&&c.projectId&&<ModuleInstancesCard facts={c.data} projectId={c.projectId} owner={!!owner}/>}
  {c.kind==='access-roles'&&c.projectId&&<AccessRolesCard facts={c.data} projectId={c.projectId} owner={!!owner}/>}
  {c.kind==='records-summary'&&c.projectId&&<RecordsSummaryCard facts={c.data} projectId={c.projectId}/>}
  {c.kind==='cms'&&<div className="space-y-4">{c.data.items.map(p=><div key={p.projectId}><p className="font-semibold break-words">{p.name}</p><p className="text-sm text-muted-foreground">{p.publishedArticles} published articles</p></div>)}</div>}
  <CheckedAt value={c.asOf}/>
 </div>;
}
/** Owner/revision/scoped cache, evicted on unmount. Never show old private facts
 * while access is being refreshed or after the current read fails. */
export function SavedViewComponent(props:{owner:string;pageId:string;revision:number;kind:WidgetKind;projectId:string|null}){
 const {owner,pageId,revision,kind,projectId}=props;
 return <ViewComponentRead owner={owner} queryKey={['workspace-view-component',owner,pageId,revision,kind,projectId]} path="/workspace/views/v1/component" request={{version:1,pageId,revision,kind}} kind={kind} projectId={projectId}/>;
}
export function TemporaryViewComponent({owner,interactionId,digest,kind,projectId}:{owner:string;interactionId:string;digest:string;kind:WidgetKind;projectId:string|null}){
 return <ViewComponentRead owner={owner} queryKey={['temporary-view-component',owner,interactionId,digest,kind,projectId]} path="/chat/interactions/v1/view-component" request={{version:1,interactionId,definitionDigest:digest,kind}} kind={kind} projectId={projectId}/>;
}
function ViewComponentRead({owner,queryKey,path,request,kind,projectId}:{owner:string;queryKey:(string|number|null)[];path:string;request:unknown;kind:WidgetKind;projectId:string|null}){
 const query=useQuery({queryKey,queryFn:async({signal})=>{
  const raw=await api(path,{method:'POST',body:JSON.stringify(request),signal}),value=readViewComponentData(raw);
  if(!value||value.kind!==kind||value.projectId!==projectId||value.binding!==viewBinding(kind,projectId))throw new APIError('Update Whumpo to read this view.',409,'client_update_required');
  return value;
 },staleTime:0,gcTime:0,retry:false,refetchOnWindowFocus:true});
 useEffect(()=>{if(query.error instanceof APIError&&query.error.code==='workspace_layout_changed')void queryClient.invalidateQueries({queryKey:['dashboard']});},[query.error]);
 return <div data-view-component={kind} className="space-y-4">
  {query.isFetching&&!(kind==='guest-previews'&&query.data&&!query.error)?<p role="status" className="text-sm">Checking current information…</p>:query.error?<p role="alert" className="text-sm">{message(query.error)}</p>:query.data?<ViewComponentDisplay value={query.data} owner={owner} onChanged={()=>void query.refetch()}/>:null}
  <Button type="button" variant="secondary" className="min-h-11" disabled={query.isFetching} onClick={()=>void query.refetch()}>Refresh {viewLabels[kind].toLowerCase()}</Button>
 </div>;
}
