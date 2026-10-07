import {useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import type {PortalPresentation} from '../../src/visitor-presentation/contract';
import {Button} from './components/ui/button';
import {api,message} from './lib/api';
import {useWorkspace} from './workspace';

type Facts={state:'website-required'|'access-required'|'modules-required'|'ready'|'saved';presentation:PortalPresentation|null;versionId?:string|null};
export function VisitorPortalSetup({project}:{project:string}){
 const query=useQuery({queryKey:['visitor-presentation',project],queryFn:()=>api<Facts>(`/projects/${project}/presentation`)});
 return <section aria-label="Visitor portal setup" className="space-y-3 rounded-md border p-4 text-sm"><h3 className="font-semibold">Visitor portal</h3>
  <p>Arrange the project’s forms, records and photos. Save an exact private design review in Chat, then review publishing that saved website version separately. Modules need their own activation.</p>
  {query.error&&<p role="alert">{message(query.error)}</p>}
  {query.data?.state==='website-required'&&<p>Draft the project’s private website first.</p>}
  {query.data?.state==='access-required'&&<p>Set up and activate visitor access first.</p>}
  {query.data?.state==='modules-required'&&<p>Set up a records form or file collection first.</p>}
  {query.data?.presentation&&<PortalEditor key={JSON.stringify(query.data.presentation)} project={project} initial={query.data.presentation}/>}
  {query.data?.versionId&&<a className="inline-flex min-h-11 items-center underline" href={`/api/site-versions/${query.data.versionId}/presentation`} target="_blank" rel="noopener noreferrer">Preview saved visitor portal</a>}
  <Button variant="quiet" onClick={()=>void query.refetch()}>Refresh portal setup</Button>
 </section>;
}
function PortalEditor({project,initial}:{project:string;initial:PortalPresentation}){
 const {runAction,commandBusy}=useWorkspace(),[draft,setDraft]=useState(initial),[error,setError]=useState(''),lock=useRef(false);
 const card=draft.blocks.find(b=>b.kind==='custom-card');
 async function review(){if(lock.current)return;lock.current=true;setError('');try{
  const action={type:'presentationReview' as const,projectId:project,presentation:draft};
  if(JSON.stringify(action).length>2048)throw Error('This design is too large for one review. Shorten its text or use fewer components.');
  await runAction(action);
 }catch(e){setError(message(e));}finally{lock.current=false;}}
 function move(index:number){const blocks=[...draft.blocks];[blocks[index-1],blocks[index]]=[blocks[index],blocks[index-1]];setDraft({...draft,blocks});}
 return <div className="space-y-3">
  <label className="block">Layout<select aria-label="Layout" value={draft.layout} onChange={e=>setDraft({...draft,layout:e.target.value as PortalPresentation['layout']})} className="block min-h-11 w-full border rounded-md p-2 bg-card"><option value="studio">Studio · soft cards</option><option value="journal">Journal · reading layout</option><option value="desk">Desk · compact workspace</option></select></label>
  <label className="block">Portal title<input value={draft.title} maxLength={100} onChange={e=>setDraft({...draft,title:e.target.value})} className="block min-h-11 w-full border rounded-md p-2 bg-card"/></label>
  <ol className="space-y-2">{draft.blocks.map((b,index)=><li key={b.id} className="flex items-center justify-between gap-3"><span>{b.title}</span>{index>0&&<Button variant="quiet" size="sm" className="min-h-11" onClick={()=>move(index)}>Move earlier<span className="sr-only">: {b.title}</span></Button>}</li>)}</ol>
  {card?.kind==='custom-card'?<fieldset className="space-y-2"><legend className="font-medium">Custom welcome card</legend>
   <label className="block">Card heading<input value={card.title} maxLength={80} className="block min-h-11 w-full border rounded-md p-2 bg-card" onChange={e=>setDraft({...draft,blocks:draft.blocks.map(b=>b===card?{...card,title:e.target.value}:b)})}/></label>
   <label className="block">Card text<textarea aria-label="Card text" value={card.paragraphs.join('\n')} maxLength={300} className="block min-h-24 w-full border rounded-md p-2 bg-card" onChange={e=>setDraft({...draft,blocks:draft.blocks.map(b=>b===card?{...card,paragraphs:[e.target.value]}:b)})}/></label>
  </fieldset>:draft.blocks.length<8&&<Button variant="secondary" onClick={()=>setDraft({...draft,blocks:[{id:'welcome-card',kind:'custom-card',title:'Welcome',paragraphs:['Share an update or check your information below.'],emphasis:'strong'},...draft.blocks]})}>Add a custom welcome card</Button>}
  <Button disabled={commandBusy} onClick={()=>void review()}>Review visitor portal design</Button>
  {error&&<p role="alert">{error}</p>}
  <p className="text-muted-foreground">After publication, the portal uses this project’s visitor address at /portal. Sign-in and data access follow the existing module rules.</p>
 </div>;
}
