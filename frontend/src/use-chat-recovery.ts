import {useCallback,useEffect,useRef,useState,type SetStateAction} from 'react';
import {readRecovery,writeRecovery,type Recovery} from './lib/chat-recovery';
import type {ChatRequest} from './lib/chat-delivery';

/** Mount a fresh instance for each authenticated account. Never resends anything. */
export function useChatRecovery(owner:string){
 const [initial]=useState(()=>{try{return {value:readRecovery(sessionStorage,owner),failed:false};}catch{return {value:null,failed:true};}});
 const current=useRef<Recovery>(initial.value??{draft:'',pending:null,updatedAt:Date.now()});
 const pending=useRef<ChatRequest|null>(current.current.pending);
 const [draft,setDraftState]=useState(current.current.draft);
 const [storageFailed,setStorageFailed]=useState(initial.failed);
 const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
 const persist=useCallback(()=>{if(!mounted.current)return;try{writeRecovery(sessionStorage,owner,current.current);setStorageFailed(false);}catch{setStorageFailed(true);}},[owner]);
 const setDraft=useCallback((update:SetStateAction<string>)=>{
  const next=typeof update==='function'?update(current.current.draft):update;
  current.current={...current.current,draft:next,updatedAt:Date.now()};setDraftState(next);persist();
 },[persist]);
 const setPending=useCallback((value:ChatRequest|null)=>{
  pending.current=value;current.current={...current.current,pending:value};persist();
 },[persist]);
 return {draft,setDraft,pending,setPending,restored:initial.value?.pending??null,storageFailed};
}
