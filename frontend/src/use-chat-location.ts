import {useCallback,useEffect,useRef,useState} from 'react';
import {readChatLocation,saveChatLocation,type ChatLocation} from './lib/chat-location';

/** Only explicit opens update the locator lifetime. Reconnecting never sends
 * answers, resumes inference, changes the selected project or approves work. */
export function useChatLocation(owner:string,requested:ChatLocation|null,invalid=false){
 const [initial]=useState(()=>{try{return {id:readChatLocation(sessionStorage,owner),failed:false};}catch{return {id:null,failed:true};}});
 const [id,setId]=useState(initial.id),[storageFailed,setFailed]=useState(initial.failed),active=useRef(true);
 useEffect(()=>{active.current=true;const reset=()=>{active.current=false;};window.addEventListener('whumpo:workspace-reset',reset);return()=>{active.current=false;window.removeEventListener('whumpo:workspace-reset',reset);};},[]);
 const select=useCallback((next:ChatLocation|null)=>{
  if(!active.current)return;
  try{saveChatLocation(sessionStorage,owner,next);setFailed(false);}catch{setFailed(true);}
  setId(next);
 },[owner]);
 const lastRequested=useRef<string|null>(null),requestedKey=invalid?'invalid':requested?requested.kind+':'+requested.id:null;
 useEffect(()=>{if(invalid){if(lastRequested.current!=='invalid'){lastRequested.current='invalid';select(null);}return;}if(requested&&requestedKey!==lastRequested.current){lastRequested.current=requestedKey;select(requested);}else if(!requested)lastRequested.current=null;},[invalid,requested,requestedKey,select]);
 return {target:invalid?null:requested??id,select,storageFailed};
}
