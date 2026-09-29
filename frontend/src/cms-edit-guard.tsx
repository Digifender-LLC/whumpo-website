import {createContext,useCallback,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import {useBlocker} from '@tanstack/react-router';
import {Dialog,DialogContent,DialogDescription,DialogTitle} from './components/ui/dialog';
import {Button} from './components/ui/button';

type Protection='clean'|'edited'|'saving'|'uncertain';
type Guard={run:(action:()=>void)=>void;protect:(state:Protection)=>void};
const Context=createContext<Guard|null>(null);
export function useCMSEditGuard(){const value=useContext(Context);if(!value)throw Error('CMS edit guard is missing');return value;}

/** One guard covers router transitions, editor switches and native page unloads. */
export function CMSEditGuard({children,label='draft'}:{children:ReactNode;label?:string}){
 const [protection,setProtection]=useState<Protection>('clean');
 const state=useRef<Protection>('clean');
 const protect=useCallback((value:Protection)=>{state.current=value;setProtection(value)},[]);
 const [pending,setPending]=useState<(()=>void)|null>(null);
 const run=useCallback((action:()=>void)=>{if(state.current==='clean')action();else setPending(()=>action)},[]);
 const blocker=useBlocker({shouldBlockFn:()=>state.current!=='clean',enableBeforeUnload:()=>state.current!=='clean',withResolver:true});
 const open=!!pending||blocker.status==='blocked';
 const stay=()=>{setPending(null);if(blocker.status==='blocked')blocker.reset()};
 const leave=()=>{if(state.current==='saving')return;const action=pending;setPending(null);protect('clean');if(blocker.status==='blocked')blocker.proceed();else action?.()};
 return <Context.Provider value={{run,protect}}>{children}<Dialog open={open} onOpenChange={value=>{if(!value)stay()}}><DialogContent><DialogTitle>{protection==='clean'?'Your '+label+' is saved':protection==='saving'?'Your '+label+' is saving':protection==='uncertain'?'This save needs checking':'Leave your unsaved changes?'}</DialogTitle><DialogDescription>{protection==='clean'?'Your save finished. You can continue to the page you selected.':protection==='saving'?'Wait for the save to finish before switching content.':protection==='uncertain'?'The save may have reached the server. Stay here to retry the same request, or return later and check the saved request before creating a replacement.':'Your latest writing has not been saved. Stay here to save it, or leave and discard these local changes.'}</DialogDescription><div className="flex flex-wrap justify-end gap-3"><Button onClick={stay}>Stay here</Button>{protection!=='saving'&&<Button variant="outline" onClick={leave}>{protection==='uncertain'?'Leave and check later':protection==='clean'?'Continue':'Discard local changes'}</Button>}</div></DialogContent></Dialog></Context.Provider>;
}
export function useCMSProtection(value:Protection){
 const {protect}=useCMSEditGuard();
 useEffect(()=>{protect(value);return()=>protect('clean')},[value,protect]);
}
