import {useEffect} from 'react';
import {useInfiniteQuery} from '@tanstack/react-query';
import {APIError,api,message} from './lib/api';
import {Button} from './components/ui/button';

type Project={id:string;name:string};
type Page={version:1;interactionId:string;definitionDigest:string;fieldId:'project';items:Project[];nextBefore:Project|null};
const exact=(v:object,keys:string[])=>Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const project=(v:unknown):v is Project=>!!v&&typeof v==='object'&&!Array.isArray(v)&&exact(v,['id','name'])&&typeof (v as Project).id==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test((v as Project).id)&&typeof (v as Project).name==='string'&&!!(v as Project).name.trim()&&(v as Project).name.length<=100;

/** Native selection keeps the system picker on phones; all names are plain text. */
export function ChatProjectPicker({owner,interactionId,digest,id,description,invalid,required,locked,value,onChange,onReady}:{owner:string;interactionId:string;digest:string;id:string;description:string;invalid:boolean;required:boolean;locked:boolean;value:string;onChange:(value:string)=>void;onReady:(ready:boolean)=>void}){
 const query=useInfiniteQuery({queryKey:['chat-interaction-resources',owner,interactionId,digest],initialPageParam:null as Project|null,queryFn:async({signal,pageParam})=>{
  const p=await api<Page>('/chat/interactions/v1/resources',{method:'POST',body:JSON.stringify({version:1,interactionId,fieldId:'project',limit:20,before:pageParam}),signal});
  if(!p||typeof p!=='object'||!exact(p,['version','interactionId','definitionDigest','fieldId','items','nextBefore'])||p.version!==1||p.interactionId!==interactionId||p.definitionDigest!==digest||p.fieldId!=='project'||!Array.isArray(p.items)||p.items.length>20||!p.items.every(project)||new Set(p.items.map(i=>i.id)).size!==p.items.length||!(p.nextBefore===null||project(p.nextBefore)))throw new APIError('Update Whumpo to choose a project.',409,'client_update_required');
  if(p.nextBefore&&(!p.items.length||p.nextBefore.id!==p.items.at(-1)!.id||p.nextBefore.name!==p.items.at(-1)!.name||pageParam?.id===p.nextBefore.id))throw new APIError('The project list changed. Check it again.',409,'interaction_changed');
  return p;
 },getNextPageParam:p=>p.nextBefore??undefined,staleTime:0,gcTime:0});
 const items=[...new Map((query.data?.pages.flatMap(p=>p.items)??[]).map(p=>[p.id,p])).values()],missing=!!value&&!items.some(p=>p.id===value),ready=query.isSuccess&&!query.isFetching&&!query.error;
 useEffect(()=>{onReady(ready&&!missing);return()=>onReady(false);},[ready,missing,onReady]);
 return <div className="space-y-2">
  <select id={id} data-field="project" aria-describedby={description} aria-invalid={invalid} required={required} disabled={locked||!ready} value={value} onChange={e=>onChange(e.target.value)} className="min-h-11 w-full min-w-0 rounded-xl border border-input bg-background px-3 py-2 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70">
   <option value="">Choose a project</option>{missing&&<option value={value} disabled>Saved project not in this list</option>}{items.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
  </select>
  {query.isPending&&<p role="status" className="text-xs text-muted-foreground">Loading your projects…</p>}
  {ready&&!items.length&&<p className="text-sm text-muted-foreground">You have no projects to choose from. Ask Whumpo to help you start one.</p>}
  {ready&&missing&&<p className="text-sm text-muted-foreground">{query.hasNextPage?'Load more projects to find your saved choice.':'Your saved choice is unavailable. Choose a current project to continue.'}</p>}
  {query.error&&<p role="alert" className="text-sm">{message(query.error)}</p>}
  {query.error&&<Button type="button" variant="outline" className="min-h-11" disabled={query.isFetching} onClick={()=>void query.refetch()}>Check projects</Button>}
  {query.hasNextPage&&<Button type="button" variant="outline" className="min-h-11" disabled={query.isFetching} onClick={()=>void query.fetchNextPage()}>Load more projects</Button>}
 </div>;
}
