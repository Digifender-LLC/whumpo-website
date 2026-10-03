import {useCallback,useEffect,useRef,useState} from 'react';
import {readChatLocation,saveChatLocation} from './lib/chat-location';

/** Only explicit opens update the locator lifetime. Reconnecting never sends
 * answers, resumes inference, changes the selected project or approves work. */
export function useChatLocation(owner:string,requested:string|null){
 const [initial]=useState(()=>{try{return {id:readChatLocation(sessionStorage,owner),failed:false};}catch{return {id:null,failed:true};}});
 const [id,setId]=useState(initial.id),[storageFailed,setFailed]=useState(initial.failed),active=useRef(true);
 useEffect(()=>{active.current=true;const reset=()=>{active.current=false;};window.addEventListener('whumpo:workspace-reset',reset);return()=>{active.current=false;window.removeEventListener('whumpo:workspace-reset',reset);};},[]);
 const select=useCallback((next:string|null)=>{
  if(!active.current)return;
  try{saveChatLocation(sessionStorage,owner,next);setFailed(false);}catch{setFailed(true);}
  setId(next);
 },[owner]);
 const lastRequested=useRef<string|null>(null);
 useEffect(()=>{if(requested&&requested!==lastRequested.current){lastRequested.current=requested;select(requested);}else if(!requested)lastRequested.current=null;},[requested,select]);
 return {id:requested??id,select,storageFailed};
}
