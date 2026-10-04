import {useRef,useState} from 'react';
import type {OwnerFileCollections} from '../../src/shared-modules/shape';
import {Button} from './components/ui/button';
import {api,message} from './lib/api';
import {candidateOf,collectionFiler,collectionRemover,collectionKey,collectionLabel,collectionOf,fileableCollections,filesActivationAction,filesSetupAction,galleryReady,galleryReviewAction} from './lib/photo-collections';
import {useWorkspace} from './workspace';

const states={inactive:'Disabled',active:'Active',suspended:'Suspended',migrating:'Migrating'} as const;

/** WH-128 "Add to collection" on one Photos panel card: files an existing ready owner photo into an active owner
 * collection with the owner `files.putBytes` module request (id and exact digest; no bytes are sent again). Filing
 * changes no safety state, and the photo stays in the owner's library. A filed photo offers "Remove from collection",
 * which removes only its collection row (refused while the saved or published website shows the photo). */
export function PhotoCollectionControl({project,fileId,data,onFiled}:{project:string;fileId:string;data:OwnerFileCollections|undefined;onFiled:()=>void}){
 const filer=useRef(collectionFiler((path,init)=>api(path,init))),remover=useRef(collectionRemover((path,init)=>api(path,init))),[choice,setChoice]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const filed=collectionOf(data,fileId),candidate=candidateOf(data,fileId),options=fileableCollections(data);
 async function remove(){
  if(busy||!filed)return;setBusy(true);setError('');
  try{await remover.current(project,filed,fileId);onFiled();}catch(e){setError(message(e));}finally{setBusy(false);}
 }
 if(filed)return <div className="flex flex-wrap items-center gap-2">
  <p className="text-xs text-muted-foreground">In collection {collectionLabel(filed)}.</p>
  <Button type="button" variant="quiet" size="sm" className="min-h-11" disabled={busy} onClick={()=>void remove()}>Remove from collection</Button>
  {error&&<p role="alert" className="w-full text-xs">{error}</p>}
 </div>;
 if(!candidate||!options.length)return null;
 const selected=options.find(c=>collectionKey(c)===choice)??options[0];
 async function add(){
  if(busy)return;setBusy(true);setError('');
  try{await filer.current(project,selected,candidate!);onFiled();}catch(e){setError(message(e));}finally{setBusy(false);}
 }
 return <div className="flex flex-wrap items-end gap-2">
  {options.length>1&&<label className="flex flex-col gap-1 text-xs font-medium">Collection<select value={collectionKey(selected)} onChange={e=>setChoice(e.target.value)} className="h-11 px-3 border rounded-md bg-card">{options.map(c=><option key={collectionKey(c)} value={collectionKey(c)}>{collectionLabel(c)}</option>)}</select></label>}
  <Button type="button" variant="secondary" size="sm" className="min-h-11" disabled={busy} onClick={()=>void add()}>{options.length>1?'Add to collection':`Add to ${selected.collectionId}`}</Button>
  {error&&<p role="alert" className="w-full text-xs">{error}</p>}
 </div>;
}

/** WH-128 standard photo collection setup. Buttons only prepare an exact review in Chat: `filesModuleReview` (the fixed
 * owner-only files instance through the existing website review, saved after a recent sign-in) and then
 * `moduleActivationReview` (the separate activation review). States and ids only. */
export function PhotoCollectionSetup({project,data}:{project:string;data:OwnerFileCollections|undefined}){
 const {runAction,commandBusy}=useWorkspace(),[error,setError]=useState(''),lock=useRef(false);
 async function run(action:Parameters<typeof runAction>[0]){
  if(lock.current)return;lock.current=true;setError('');
  try{await runAction(action);}catch(e){setError(message(e));}finally{lock.current=false;}
 }
 const setup=data?.setup,activate=filesActivationAction(project,data);
 if(!setup||setup.state==='registered'&&!activate)return null;
 return <div className="space-y-3 rounded-md bg-secondary/50 p-4 text-sm">
  {setup.state==='website-required'&&<p>Photo collections are saved in this project’s website configuration. Ask Whumpo to draft the project’s private website first.</p>}
  {setup.state==='unavailable'&&<p>The saved website configuration could not be read.</p>}
  {setup.state==='not-configured'&&<><p>Set up a private photo collection that only you can add to. Chat shows the exact website configuration change to save (no staff or visitor uploads, nothing published); activating it is a separate review.</p><Button type="button" variant="secondary" className="min-h-11" disabled={commandBusy} onClick={()=>void run(filesSetupAction(project))}>Set up photo collection</Button></>}
  {activate&&<><p>The photo collection is saved but not active. Review activating it in Chat.</p><Button type="button" variant="secondary" className="min-h-11" disabled={commandBusy} onClick={()=>void run(activate)}>Review activating photo collection</Button></>}
  {error&&<p role="alert">{error}</p>}
 </div>;
}

/** WH-128 "Prepare gallery page": per owner collection, a page choice and a button that sends the typed
 * `galleryPageReview` Chat control. Chat answers with the existing exact website review (newest approved photos, at most
 * four); saving and publishing keep their own reviews. Ids only: nothing here is sent to AI. */
export function CollectionGalleries({project,data}:{project:string;data:OwnerFileCollections|undefined}){
 const {runAction,commandBusy}=useWorkspace(),[pages,setPages]=useState<Record<string,string>>({}),[error,setError]=useState(''),[sent,setSent]=useState(''),lock=useRef(false);
 if(!data?.collections.length)return null;
 async function prepare(c:OwnerFileCollections['collections'][number],pageId:string){
  if(lock.current)return;lock.current=true;setError('');setSent('');
  try{await runAction(galleryReviewAction(project,c,pageId));setSent(collectionKey(c));}catch(e){setError(message(e));}finally{lock.current=false;}
 }
 return <div className="space-y-4">{data.collections.map(c=>{
   const key=collectionKey(c),approved=c.files.filter(f=>f.safety==='approved').length,pageId=pages[key]&&data.pages.some(p=>p.id===pages[key])?pages[key]:data.pages[0]?.id??'';
   return <section key={key} aria-label={collectionLabel(c)+' collection'} className="space-y-2 rounded-md bg-background p-4 text-sm">
    <p className="font-semibold break-words">{collectionLabel(c)} · {states[c.state]}</p>
    <p>{c.files.length} photo{c.files.length===1?'':'s'} · {approved} ready for a page{c.files.length>approved?` · ${c.files.length-approved} waiting or unavailable`:''}</p>
    {!data.pages.length&&<p className="text-muted-foreground">Ask Whumpo to draft the project’s private website before making a gallery page.</p>}
    {data.pages.length>0&&!approved&&<p className="text-muted-foreground">Photos need to pass safety checks before they can go on a page.</p>}
    {galleryReady(c,data.pages)&&<div className="flex flex-wrap items-end gap-2">
     {data.pages.length>1&&<label className="flex flex-col gap-1 text-xs font-medium">Page<select value={pageId} onChange={e=>setPages({...pages,[key]:e.target.value})} className="h-11 px-3 border rounded-md bg-card">{data.pages.map(p=><option key={p.id} value={p.id}>{p.path}</option>)}</select></label>}
     <Button type="button" variant="secondary" className="min-h-11" disabled={commandBusy} onClick={()=>void prepare(c,pageId)}>Prepare gallery page</Button>
    </div>}
    {sent===key&&<p role="status" className="text-muted-foreground">Chat shows the exact website change to review and save.</p>}
   </section>;})}
  {error&&<p role="alert" className="text-sm">{error}</p>}
  <p className="text-xs text-muted-foreground">A gallery page uses up to four of the newest approved photos in the collection. Saving the change and publishing it each need their own review.</p>
 </div>;
}
