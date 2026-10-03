import {useCallback,useEffect,useRef,useState} from 'react';
import {interactionDraftLifetime,readFormRecovery,writeFormRecovery,type FormRecovery} from './lib/interaction-recovery';

/** Remount per account/form. Late network completion cannot repopulate cleared state. */
export function useInteractionRecovery(owner:string,id:string){
 const [initial]=useState(()=>{try{return {value:readFormRecovery(sessionStorage,owner,id),failed:false};}catch{return {value:null,failed:true};}});
 const [value,setValue]=useState(initial.value),[storageFailed,setFailed]=useState(initial.failed);
 const current=useRef(value),active=useRef(true);
 useEffect(()=>{active.current=true;const reset=()=>{active.current=false;current.current=null;setValue(null);};window.addEventListener('whumpo:workspace-reset',reset);return()=>{active.current=false;window.removeEventListener('whumpo:workspace-reset',reset);};},[]);
 const save=useCallback((next:FormRecovery|null)=>{
  if(!active.current)return;current.current=next;setValue(next);
  try{writeFormRecovery(sessionStorage,owner,id,next);setFailed(false);}catch{setFailed(true);}
 },[owner,id]);
 useEffect(()=>{
  if(!value||value.answers===null)return;
  const remaining=value.updatedAt+interactionDraftLifetime-Date.now();
  const timer=setTimeout(()=>{const latest=current.current;if(latest&&latest.updatedAt===value.updatedAt)save({...latest,answers:null});},Math.max(0,remaining));
  return()=>clearTimeout(timer);
 },[value,save]);
 return {value,current,save,storageFailed,active};
}
