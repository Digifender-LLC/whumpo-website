import {useCallback,useEffect,useRef,useState} from 'react';

/** Follow new messages only while the reader is already at the end. */
export function useChatScroll(active:boolean,updateKey:string){
 const scrollRef=useRef<HTMLDivElement>(null);
 const following=useRef(true);
 const [away,setAway]=useState(false);
 const latest=useCallback(()=>{
  const node=scrollRef.current;if(!node)return;
  following.current=true;setAway(false);node.scrollTo({top:node.scrollHeight,behavior:'instant'});
 },[]);
 const onScroll=useCallback(()=>{
  const node=scrollRef.current;if(!node)return;
  const atEnd=node.scrollHeight-node.scrollTop-node.clientHeight<64;
  following.current=atEnd;setAway(!atEnd);
 },[]);
 useEffect(()=>{if(active)latest();},[active,latest]);
 useEffect(()=>{if(active&&following.current)latest();},[active,updateKey,latest]);
 useEffect(()=>{
  const node=scrollRef.current;if(!active||!node)return;
  const observer=new ResizeObserver(()=>{if(following.current)latest();});
  observer.observe(node);if(node.firstElementChild)observer.observe(node.firstElementChild);
  return()=>observer.disconnect();
 },[active,latest]);
 return {scrollRef,onScroll,away,latest};
}
