import {useCallback,useEffect,useRef,useState,type SetStateAction} from 'react';
import {readRecovery,writeRecovery,type Recovery} from './lib/chat-recovery';
import type {ChatRequest} from './lib/chat-delivery';
import {prepareInteractionRecovery} from './lib/interaction-recovery';

/** Mount a fresh instance for each authenticated account. Never resends anything. */
export function useChatRecovery(owner:string){
 const [initial]=useState(()=>{
  let value:Recovery|null=null,failed=false;
  try{value=readRecovery(sessionStorage,owner);}catch{failed=true;}
  // Failure cleaning up another store must not hide a valid pending Chat send.
  try{prepareInteractionRecovery(sessionStorage,owner);}catch{failed=true;}
  return {value,failed};
 });
 const current=useRef<Recovery>(initial.value??{draft:'',pending:null,updatedAt:Date.now()});
 const pending=useRef<ChatRequest|null>(current.current.pending);
 const [draft,setDraftState]=useState(current.current.draft);
 const [storageFailed,setStorageFailed]=useState(initial.failed);
 const mounted=useRef(true);
 useEffect(()=>{mounted.current=true;const reset=()=>{mounted.current=false;};window.addEventListener('whumpo:workspace-reset',reset);return()=>{mounted.current=false;window.removeEventListener('whumpo:workspace-reset',reset);};},[]);
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
