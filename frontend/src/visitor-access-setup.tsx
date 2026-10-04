import {useRef,useState} from 'react';
import {Button} from './components/ui/button';
import {message} from './lib/api';
import {useWorkspace} from './workspace';

export type AccessSetup={state:'website-required'|'not-configured'|'saved'|'registered'|'unavailable';instanceId:string|null};
/** WH-126 owner visitor access setup. Buttons only prepare an exact review in Chat: `accessModuleReview` (the fixed
 * standard access instance through the existing website review, saved after a recent sign-in) and then
 * `moduleActivationReview` (the separate activation review). States and ids only. */
export function VisitorAccessSetup({projectId,setup,state}:{projectId:string;setup:AccessSetup|undefined;state:string|null|undefined}){
 const {runAction,commandBusy}=useWorkspace(),[error,setError]=useState(''),lock=useRef(false);
 async function run(action:Parameters<typeof runAction>[0]){
  if(lock.current)return;lock.current=true;setError('');
  try{await runAction(action);}catch(e){setError(message(e));}finally{lock.current=false;}
 }
 if(!setup||state==='active')return null;
 const activate=setup.instanceId&&(setup.state==='saved'||setup.state==='registered'&&(state===null||state==='inactive'));
 return <div className="mb-5 space-y-3 rounded-md bg-secondary/50 p-4 text-sm">
  {setup.state==='website-required'&&<p>Visitor access is saved in this project’s website configuration. Ask Whumpo to draft the project’s private website first.</p>}
  {setup.state==='unavailable'&&<p>The saved website configuration could not be read.</p>}
  {setup.state==='not-configured'&&<><p>Set up invitation-only visitor sign-in for this project. Chat shows the exact website configuration change to save (no staff role, nothing published); activating it is a separate review.</p><Button type="button" variant="secondary" className="min-h-11" disabled={commandBusy} onClick={()=>void run({type:'accessModuleReview',projectId})}>Set up visitor access</Button></>}
  {activate&&<><p>Visitor access is saved but not active. Review activating it in Chat.</p><Button type="button" variant="secondary" className="min-h-11" disabled={commandBusy} onClick={()=>void run({type:'moduleActivationReview',projectId,instanceId:setup.instanceId!,action:'activate'})}>Review activating visitor access</Button></>}
  {error&&<p role="alert">{error}</p>}
 </div>;
}
