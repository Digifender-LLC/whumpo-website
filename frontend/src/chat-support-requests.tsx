import {useEffect,useRef,useState} from 'react';
import {Link} from '@tanstack/react-router';
import {useQuery} from '@tanstack/react-query';
import {deliveryLabel,readSupportRequestsCard,type SupportRequest} from '../../src/support-shape';
import {APIError,api,message,send} from './lib/api';
import {identityGeneration} from './lib/identity-invalidation';
import {Button} from './components/ui/button';
import {kindLabel,readLabel,responseLabel,when} from './support';

/** WH-035 Chat support view. Reads the owner's own requests through the issued card; opening a saved
 * response records the customer read with the existing Support read receipt. Never submits or answers. */
export function ChatSupportRequests({owner,interactionId,digest}:{owner:string;interactionId:string;digest:string}){
 const [openId,setOpenId]=useState<string|null>(null),marked=useRef(new Set<string>()),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const query=useQuery({queryKey:['chat-interaction-card',owner,interactionId,digest,'support-requests'],queryFn:async({signal})=>{
  const raw=await api('/chat/interactions/v1/card',{method:'POST',body:JSON.stringify({version:1,interactionId,definitionDigest:digest,cardId:'support-requests'}),signal}),card=readSupportRequestsCard(raw);
  if(!card||card.interactionId!==interactionId||card.definitionDigest!==digest)throw new APIError('Update Whumpo to read your support requests.',409,'client_update_required');
  return card;
 },staleTime:0,gcTime:0,retry:false});
 const requests=query.data&&!query.isFetching&&!query.error?query.data.data.requests:[];
 const opened=requests.find(r=>r.id===openId);
 // Same rule as the Support page: the read is recorded only after the saved response is displayed.
 useEffect(()=>{
  if(!opened||opened.read.state!=='unread'||marked.current.has(opened.id))return;
  marked.current.add(opened.id);const generation=identityGeneration();
  send('/support/v1/requests/'+opened.id+'/read',{version:1}).then(()=>{if(mounted.current&&generation===identityGeneration())void query.refetch();}).catch(()=>marked.current.delete(opened.id));
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[opened?.id,opened?.read.state]);
 return <div className="space-y-3">
  {query.isFetching?<p role="status" className="text-sm">Checking your support requests…</p>:query.error?<p role="alert" className="text-sm">{message(query.error)}</p>:query.data&&!requests.length?<p className="text-sm">You have not made a support request yet. Tell Whumpo what you need help with.</p>:null}
  {!!requests.length&&<ul className="grid gap-3">{requests.map((r:SupportRequest)=><li key={r.id}><article aria-label={kindLabel(r.kind)+' '+when(r.createdAt)} className="rounded-md border p-3 space-y-2 text-sm">
   <h4 className="font-semibold">{kindLabel(r.kind)} · {when(r.createdAt)}</h4>
   <dl className="grid gap-1"><div><dt className="inline font-medium">Response: </dt><dd className="inline">{responseLabel(r)}</dd></div><div><dt className="inline font-medium">Notification: </dt><dd className="inline">{r.response.saved?deliveryLabel(r.delivery.state):'None yet'}</dd></div><div><dt className="inline font-medium">Read: </dt><dd className="inline">{readLabel(r)}</dd></div></dl>
   <Button type="button" variant="secondary" className="min-h-11" aria-expanded={openId===r.id} onClick={()=>setOpenId(openId===r.id?null:r.id)}>{openId===r.id?'Hide details':r.response.saved?'Open response':'Open request'}</Button>
   {openId===r.id&&<div className="space-y-2 border-t pt-2"><p className="font-medium">Your request:</p><p className="whitespace-pre-wrap break-words">{r.statement}</p>{r.publicResponse&&<><p className="font-medium">Response{r.answeredAt?' · '+when(r.answeredAt):''}:</p><p className="whitespace-pre-wrap break-words" data-support-response>{r.publicResponse}</p></>}</div>}
  </article></li>)}</ul>}
  <div className="flex flex-wrap items-center gap-2"><Button type="button" variant="secondary" className="min-h-11" disabled={query.isFetching} onClick={()=>void query.refetch()}>Refresh</Button><Button asChild variant="link" className="min-h-11 px-0 h-auto whitespace-normal"><Link to="/workspace/$view" params={{view:'support'}} search={{}}>Open Support</Link></Button></div>
 </div>;
}
