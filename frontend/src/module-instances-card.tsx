import {useRef,useState} from 'react';
import type {ModuleInstanceFacts} from '../../src/shared-modules/shape';
import {Button} from './components/ui/button';
import {message} from './lib/api';
import {useWorkspace} from './workspace';
import {StateNote} from './view-states';
import {PublicFormNote} from './records-panel';

const kinds={content:'Content collection',records:'Records and forms',files:'Files and galleries',access:'Visitor access'} as const;
const states={unregistered:'Configured, not activated',inactive:'Disabled',active:'Active',suspended:'Suspended',migrating:'Migrating'} as const;
/** WH-125 module status. Buttons only prepare an exact review in Chat (moduleActivationReview); the separate review card
 * there applies it after a recent sign-in. States and revisions only: no configuration or visitor-submitted value. */
export function ModuleInstancesCard({facts,projectId,owner}:{facts:ModuleInstanceFacts;projectId:string;owner:boolean}){
 const {runAction,commandBusy}=useWorkspace(),[error,setError]=useState(''),lock=useRef(false);
 async function review(instanceId:string,action:'activate'|'disable'){
  if(lock.current)return;lock.current=true;setError('');
  try{await runAction({type:'moduleActivationReview',projectId,instanceId,action});}catch(e){setError(message(e));}finally{lock.current=false;}
 }
 if(!facts.items.length)return <StateNote title={facts.specification==='unavailable'?'The saved website configuration could not be read.':'No modules are configured for this project.'}>{facts.specification==='unavailable'?'Try refreshing in a moment.':'Ask Whumpo in Chat to add one.'}</StateNote>;
 return <div className="space-y-4">{facts.items.map(i=><section key={i.localId} aria-label={i.localId+' module'} className="space-y-2 rounded-md bg-surface-sunken p-4 text-body-sm">
   <p className="font-semibold break-words">{i.localId} · {kinds[i.kind]}</p>
   <p>{states[i.state]}{i.configRevision!==null?` · configuration revision ${i.configRevision}`:''}{i.state==='active'&&!i.serving?' · not serving':''}</p>
   <PublicFormNote state={i.publicForm}/>
   {i.configChanged&&<p className="text-ink-muted">The saved configuration changed. Review activation to apply it.</p>}
   {!i.inSpecification&&<p className="text-ink-muted">No longer in the saved website configuration.</p>}
   {i.catalog!=='available'&&<p className="text-ink-muted">{i.catalog==='withdrawn'?'This module version was withdrawn.':'This module version is no longer current.'}</p>}
   {owner&&<div className="flex flex-wrap gap-2">
    {i.inSpecification&&i.catalog==='available'&&i.canActivate&&(i.state!=='active'||i.configChanged||i.publicForm==='stale')&&<Button type="button" variant="secondary" className="min-h-11" disabled={commandBusy} onClick={()=>void review(i.localId,'activate')}>Review activation</Button>}
    {(i.state==='active'||i.state==='suspended')&&<Button type="button" variant="secondary" className="min-h-11" disabled={commandBusy} onClick={()=>void review(i.localId,'disable')}>Review disabling</Button>}
   </div>}
  </section>)}
  {error&&<p role="alert" className="text-body-sm">{error}</p>}
  <p className="text-caption text-ink-muted">Activation and disabling each need their own review in Chat. Visitor-submitted values never appear in Chat.</p>
 </div>;
}
