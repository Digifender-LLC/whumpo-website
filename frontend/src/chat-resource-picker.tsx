import {useEffect} from 'react';
import {useInfiniteQuery} from '@tanstack/react-query';
import type {Answer,Field} from '../../src/chat-interactions/types';
import {readResourcePage,type ResourceCursor,type ResourceOption} from '../../src/chat-interactions/resource-shape';
import {APIError,api,message} from './lib/api';
import {Button} from './components/ui/button';

type ResourceField=Extract<Field,{type:'resource'|'attachment'}>;
type ControlProps={field:ResourceField;id:string;description:string;invalid:boolean;locked:boolean;ready:boolean;items:ResourceOption[];value:Answer|undefined;onChange:(value:Answer|undefined)=>void};
/** Metadata-only controls; photo selections never request or embed image bytes. */
export function ChatResourceOptions({field,id,description,invalid,locked,ready,items,value,onChange}:ControlProps){
 const {collection,multiple,maxItems}=field.constraints,selected=multiple?(Array.isArray(value)?value:[]):typeof value==='string'?[value]:[],missing=selected.filter(v=>!items.some(i=>i.id===v)),photo=collection==='photos';
 const clear=()=>{onChange(undefined);document.getElementById(id)?.focus();};
 if(collection==='projects'&&!multiple)return <select id={id} data-field={field.id} aria-describedby={description} aria-invalid={invalid||missing.length>0} required={field.required} disabled={locked||!ready} value={String(value??'')} onChange={e=>onChange(e.target.value||undefined)} className="min-h-11 w-full min-w-0 rounded-xl border border-input bg-background px-3 py-2 text-base text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70">
  <option value="">Choose a project</option>{missing.length>0&&<option value={String(value)} disabled>Saved project not in this list</option>}{items.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}
 </select>;
 return <div className="space-y-2">
  <fieldset disabled={locked||!ready} aria-describedby={description} aria-invalid={invalid||missing.length>0} className="min-w-0 space-y-2"><legend className="sr-only">{field.label}</legend>
   {multiple&&<p className="text-xs text-muted-foreground">Choose up to {maxItems}. {selected.length} selected.</p>}
   {items.map((item,index)=>{const checked=selected.includes(item.id);return <label key={item.id} htmlFor={index?id+'-'+item.id:id} className={'flex min-h-12 gap-3 items-center rounded-xl border p-3 text-sm '+(checked?'border-primary bg-primary/5':'bg-background')}>
    <input id={index?id+'-'+item.id:id} data-field={index?undefined:field.id} type={multiple?'checkbox':'radio'} name={id} checked={checked} disabled={multiple&&!checked&&selected.length>=maxItems} required={!multiple&&field.required} aria-describedby={description} aria-invalid={invalid} onChange={()=>onChange(multiple?(checked?selected.filter(s=>s!==item.id):[...selected,item.id]):item.id)} className="size-5 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"/>
    <span className="min-w-0 break-words">{item.name}{photo&&item.photo&&<span className="block text-xs text-muted-foreground mt-1">{item.photo.width} × {item.photo.height} · {Math.ceil(item.photo.size/1024)} KB</span>}</span>
   </label>;})}
  </fieldset>
  {ready&&missing.length>0&&<p role="status" className="text-sm">{missing.length} saved {missing.length===1?'selection is':'selections are'} not in this list. Load more or clear the selection.</p>}
  {selected.length>0&&!locked&&<Button type="button" variant="ghost" className="min-h-11" onClick={clear}>Clear selection</Button>}
 </div>;
}

/** Current API projection. New resource-bearing definitions need their own
 * server admission/lifecycle before this shared renderer can receive them. */
export function ChatResourcePicker({field,owner,interactionId,digest,id,description,invalid,locked,value,onChange,onReady}:{field:ResourceField;owner:string;interactionId:string;digest:string;id:string;description:string;invalid:boolean;locked:boolean;value:Answer|undefined;onChange:(value:Answer|undefined)=>void;onReady:(ready:boolean)=>void}){
 const query=useInfiniteQuery({queryKey:['chat-interaction-resources',owner,interactionId,digest,field.id,field.constraints.collection],initialPageParam:null as ResourceCursor|null,queryFn:async({signal,pageParam})=>{
  const raw=await api<unknown>('/chat/interactions/v1/resources',{method:'POST',body:JSON.stringify({version:1,interactionId,definitionDigest:digest,fieldId:field.id,limit:20,before:pageParam}),signal}),p=readResourcePage(raw);
  if(!p||p.interactionId!==interactionId||p.definitionDigest!==digest||p.fieldId!==field.id||p.collection!==field.constraints.collection)throw new APIError('Update Whumpo to choose a resource.',409,'client_update_required');
  if(pageParam&&p.items.some(i=>i.id===pageParam.id))throw new APIError('This list changed. Check it again.',409,'interaction_changed');
  return p;
 },getNextPageParam:p=>p.nextBefore??undefined,staleTime:0,gcTime:0});
 const loaded=query.data?.pages.flatMap(p=>p.items)??[],duplicates=new Set(loaded.map(i=>i.id)).size!==loaded.length,ready=query.isSuccess&&!query.isFetching&&!query.error&&!duplicates;
 // Failed or refreshing reads never display names from the earlier query.
 const items=ready?loaded:[],selected=Array.isArray(value)?value:typeof value==='string'?[value]:[],missing=selected.some(v=>!items.some(i=>i.id===v)),plural=field.constraints.collection;
 useEffect(()=>{onReady(ready&&!missing);return()=>onReady(false);},[ready,missing,onReady]);
 return <div className="space-y-2">
  <ChatResourceOptions {...{field,id,description,invalid,locked,ready,items,value,onChange}}/>
  {query.isFetching&&<p role="status" className="text-xs text-muted-foreground">Checking your {plural}…</p>}
  {ready&&!items.length&&<p className="text-sm text-muted-foreground">{plural==='photos'?'No eligible photos are available in this project. Photos awaiting checks cannot be selected.':'You have no projects to choose from. Ask Whumpo to help you start one.'}</p>}
  {ready&&missing&&plural==='projects'&&!field.constraints.multiple&&<p className="text-sm text-muted-foreground">{query.hasNextPage?'Load more projects to find your saved choice.':'Your saved choice is unavailable. Choose a current project to continue.'}</p>}
  {(query.error||duplicates)&&<p role="alert" className="text-sm">{duplicates?'This list changed. Check it again.':message(query.error)}</p>}
  <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={query.isFetching} onClick={()=>void query.refetch()}>Check {plural}</Button>{query.hasNextPage&&<Button type="button" variant="outline" className="min-h-11" disabled={query.isFetching||!!query.error||duplicates} onClick={()=>void query.fetchNextPage()}>Load more {plural}</Button>}</div>
 </div>;
}
