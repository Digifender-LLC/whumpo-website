import {useRef,useState} from 'react';
import {useQueryClient} from '@tanstack/react-query';
import {send,message,type Turn} from './lib/api';
import {canRecoverChat} from './lib/chat-delivery';
import {chatControl,type ChatControl} from '../../src/chat-controls';
import {identityCeremony} from './lib/identity';
import {SavedChatTurn} from './saved-chat-turn';
import {TurnActions} from './chat-turn-actions';
import {Button} from './components/ui/button';

/** WH-212 / D-5. Confirms an existing saved review through the same exact Chat
 * action endpoint, with no model and no new approval path. Controls come only
 * from a fresh read of the saved turn. The turn's own revision is the
 * conversation fence: if anything was said after it, the server refuses. A lost
 * reply keeps the same request ID for the next click; nothing is stored or replayed on reload. */
export function SavedReviewConfirm({owner,turnId}:{owner:string;turnId:string}){
 const [open,setOpen]=useState(false),[done,setDone]=useState(false),[uncertain,setUncertain]=useState(false);
 const requests=useRef(new Map<string,{id:string;revision:number}>()),queryClient=useQueryClient();
 const confirm=(turn:Turn)=>async(action:ChatControl)=>{
  const control=chatControl(action);if(!control)throw Error('This action is not available.');
  if(control.recentAuth)await identityCeremony('reauth');
  const key=JSON.stringify(control.action),request=requests.current.get(key)??{id:crypto.randomUUID(),revision:turn.revision};
  requests.current.set(key,request);
  try{await send('/chat/actions',{id:request.id,revision:request.revision,action:control.action});}
  catch(error){
   if(canRecoverChat(error)){setUncertain(true);throw Error('The connection dropped before Whumpo could confirm this. Use the button again to check the same request without starting it twice.');}
   requests.current.delete(key);
   throw Error(/changed in another tab/.test(message(error))?'This review is no longer the latest message in Chat, so it cannot be confirmed from here. Open it in Chat.':message(error));
  }
  requests.current.delete(key);setUncertain(false);setDone(true);
  void queryClient.invalidateQueries({queryKey:['saved-chat-turn',owner]});
 };
 return <div className="space-y-2">
  <Button variant="secondary" className="min-h-11 h-auto whitespace-normal text-left" aria-expanded={open} onClick={()=>{setOpen(value=>!value);}}>{open?'Hide review':'Read this review here'}</Button>
  {done&&<p role="status" className="text-sm">Confirmed. Open Chat to see the result.</p>}
  {open&&<SavedChatTurn owner={owner} id={turnId}>{turn=><div data-saved-review-confirm>
   <p className="text-sm text-muted-foreground">This is a fresh read. Nothing is approved until you choose a button below. If no button appears, this review cannot be confirmed here; open it in Chat.{uncertain&&' A previous attempt is not confirmed yet.'}</p>
   <TurnActions turn={turn} onAction={confirm(turn)}/>
  </div>}</SavedChatTurn>}
 </div>;
}
