import {ProjectStatusFacts,CheckedAt} from './workspace-view-components';
import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {readProjectStatusCard} from '../../src/chat-interactions/card-shape';
import {APIError,api,message} from './lib/api';
import {Button} from './components/ui/button';

/** Read facts only. This component never creates a domain review or action. */
export function ProjectStatusDisplay({value}:{value:unknown}){
 const card=readProjectStatusCard(value);
 if(!card)return <p role="alert" className="text-sm">Update Whumpo to read this status.</p>;
 if(card.status!=='ready')return <p role="status" className="text-sm">{card.status==='denied'?'This status is not available with your current access.':'Project status is temporarily unavailable. Try refreshing it.'}</p>;
 return <div className="space-y-3 text-sm"><ProjectStatusFacts value={card.data}/><CheckedAt value={card.asOf}/></div>;
}
function ProjectStatusRead({owner,interactionId,digest,projectId}:{owner:string;interactionId:string;digest:string;projectId:string}){
 const query=useQuery({queryKey:['chat-interaction-card',owner,interactionId,digest,'project-status'],queryFn:async({signal})=>{
  const raw=await api('/chat/interactions/v1/card',{method:'POST',body:JSON.stringify({version:1,interactionId,definitionDigest:digest,cardId:'project-status'}),signal}),card=readProjectStatusCard(raw);
  if(!card||card.interactionId!==interactionId||card.definitionDigest!==digest||card.status==='ready'&&card.data.projectId!==projectId)throw new APIError('Update Whumpo to read this status.',409,'client_update_required');
  return card;
 },staleTime:0,gcTime:0,retry:false});
 return <div className="space-y-3 p-3 pt-0">
  {query.isFetching?<p role="status" className="text-sm">Checking current project status…</p>:query.error?<p role="alert" className="text-sm">{message(query.error)}</p>:query.data?<ProjectStatusDisplay value={query.data}/>:null}
  <Button type="button" variant="secondary" className="min-h-11" disabled={query.isFetching} onClick={()=>void query.refetch()}>Refresh status</Button>
 </div>;
}
/** Closed maintained display adapter. Mounting a closed panel reads no data. */
export function ChatInteractionCards(props:{owner:string;interactionId:string;digest:string;projectId:string}){
 const [open,setOpen]=useState(false);
 return <details className="rounded-md border bg-secondary/20" onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary className="min-h-11 cursor-pointer p-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Current project status</summary>
  {open&&<ProjectStatusRead {...props}/>}
 </details>;
}
