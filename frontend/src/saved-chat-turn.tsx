import type {ReactNode} from 'react';
import {useQuery} from '@tanstack/react-query';
import {api,APIError,message,type Turn} from './lib/api';
import {Button} from './components/ui/button';

/** A saved location only supplies an ID. Always read its current server
 * projection; cached controls disappear while refreshing or after failure. */
export function SavedChatTurn({owner,id,children}:{owner:string;id:string;children:(turn:Turn)=>ReactNode}){
 const saved=useQuery({queryKey:['saved-chat-turn',owner,id],queryFn:async({signal})=>{
  const result=await api<{version:number;turn:Turn}>('/chat/turns/'+id,{signal});
  const turn=result?.turn;
  if(result?.version!==1||!turn||turn.id!==id||!Number.isSafeInteger(turn.revision)||turn.revision<1||typeof turn.user_text!=='string'||typeof turn.assistant_text!=='string'||!['pending','completed','failed'].includes(turn.status))throw new APIError('Refresh Whumpo to read this saved message.',409,'client_update_required');
  return turn;
 },staleTime:0,gcTime:0,refetchOnWindowFocus:true,refetchInterval:q=>q.state.data?.status==='pending'?2500:false});
 return <section data-saved-turn-id={id} tabIndex={-1} aria-label="Reopened message" className="rounded-2xl border p-4 sm:p-6 mb-8">
  <div className="flex flex-wrap items-center justify-between gap-3 mb-4"><h2 className="font-semibold">Saved message</h2><Button variant="ghost" className="min-h-11 h-auto max-w-full whitespace-normal text-left" disabled={saved.isFetching} onClick={()=>void saved.refetch()}>Check saved message</Button></div>
  {saved.isFetching||saved.isPending?<p role="status">Checking this saved message…</p>:saved.error?<p role="alert">{message(saved.error)} Use Check saved message to try again.</p>:saved.data?children(saved.data):null}
 </section>;
}
