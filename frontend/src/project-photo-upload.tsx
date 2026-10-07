import {useEffect,useId,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {readPhotoUploadStatus,samePhotoUpload,type PhotoHandoff} from '../../src/photo-upload-shape';
import type {OwnerFileCollections} from '../../src/shared-modules/shape';
import {api,message} from './lib/api';
import {prepareProjectPhoto} from './lib/prepare-project-photo';
import {readPhotoRecovery,writePhotoRecovery,resolvePhotoRecovery,type PhotoRecovery} from './lib/photo-upload-recovery';
import {photoCollectionStatus,finishPhotoCollection} from './lib/photo-upload-collection';
import {collectionKey,collectionLabel,fileableCollections,ownerCollectionsPath} from './lib/photo-collections';
import {Button} from './components/ui/button';
import {Input} from './components/ui/input';
const changed='whumpo:photo-recovery-changed';

/** Same explicit upload operation in Photos and Chat. Remount per account/project. */
export function ProjectPhotoUpload({owner,project,disabled=false,onSaved,handoff=null}:{owner:string;project:string;disabled?:boolean;handoff?:PhotoHandoff|null;onSaved?:()=>void}){
 const label=useId(),form=useRef<HTMLFormElement>(null),active=useRef(true),working=useRef(false),prepared=useRef<{id:string;blob:Blob}|null>(null);
 const [pending,setPending]=useState<PhotoRecovery|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState(''),[checked,setChecked]=useState(false),[savedPhoto,setSavedPhoto]=useState(false),[choice,setChoice]=useState('');
 const collections=useQuery({queryKey:['photo-collections',owner,project],queryFn:()=>api<OwnerFileCollections>(ownerCollectionsPath(project)),gcTime:0}),options=fileableCollections(collections.data);
 function load(){const saved=readPhotoRecovery(sessionStorage,owner,project);setPending(saved);if(prepared.current?.id!==saved?.id)prepared.current=null;return saved;}
 async function check(upload:PhotoRecovery,finish=false,keepPhoto=false){
  const data=readPhotoUploadStatus(await api(`/projects/${project}/files/${upload.id}`,{headers:{'x-whumpo-photo-handoff':JSON.stringify(upload.handoff)}}));if(!active.current)return;
  if(!data)throw Error('The upload status needs the current Whumpo response.');
  if(data.photo&&!samePhotoUpload(upload,data.photo))throw Error('This upload ID refers to different photo details. Keep the original request for review.');
  if(data.closedHandoff){
   if(!upload.handoff||data.closedHandoff.interactionId!==upload.handoff.interactionId||data.closedHandoff.definitionDigest!==upload.handoff.definitionDigest)throw Error('The closed uploader does not match this request. Keep its recovery details for review.');
   resolvePhotoRecovery(sessionStorage,owner,upload);prepared.current=null;setPending(null);setChecked(false);setSavedPhoto(false);form.current?.reset();window.dispatchEvent(new Event(changed));
   setNotice('The earlier uploader closed before this upload was reserved. Its request cannot start now. You can choose a photo in this uploader.');
  }else if(data.photo?.status==='ready'){
   setSavedPhoto(true);setChecked(true);prepared.current=null;
   if(keepPhoto&&upload.collection){
    resolvePhotoRecovery(sessionStorage,owner,upload);setPending(null);setChecked(false);setSavedPhoto(false);form.current?.reset();window.dispatchEvent(new Event(changed));
    setNotice('Photo saved privately. This tab will not retry its collection request. A request already sent may still finish; Project photos shows current membership.');onSaved?.();return;
   }
   const filed=await photoCollectionStatus(api,upload);if(!active.current)return;
   if(filed==='different')throw Error('This photo is in a different collection. Open Project photos to review it; the original collection request is kept.');
   if(filed==='pending'){
    setNotice(`Photo saved privately. Adding it to ${upload.collection!.collectionId} is not confirmed. Continue with the same collection request; no photo bytes are sent again.`);
    if(!finish)return;
    await finishPhotoCollection(api,upload);if(!active.current)return;
   }
   resolvePhotoRecovery(sessionStorage,owner,upload);prepared.current=null;setPending(null);setChecked(false);setSavedPhoto(false);form.current?.reset();window.dispatchEvent(new Event(changed));
   const location=upload.collection?`Photo saved privately in ${upload.collection.collectionId}. `:'Photo saved privately. ';
   setNotice(location+(data.photo.safetyStatus==='approved'?'Safety checks passed. Ask Whumpo to add it to your website.':data.photo.safetyStatus==='blocked'?'It is unavailable for use.':'It is held for safety checks and cannot be displayed or used yet.'));onSaved?.();
  }else{setSavedPhoto(false);setChecked(true);setNotice(data.photo?'The upload started but is not confirmed. Retry the same photo to finish it.':'No saved upload was found yet. This does not prove an earlier request stopped. Retry uses the original upload ID.');}
 }
 async function run(action:()=>Promise<void>){
  if(working.current||!active.current)return;working.current=true;setBusy(true);setError('');
  try{await action();}catch(e){if(active.current)setError(message(e));}finally{working.current=false;if(active.current)setBusy(false);}
 }
 useEffect(()=>{
  active.current=true;const reset=()=>{active.current=false;prepared.current=null;setPending(null);setSavedPhoto(false);setNotice('');setError('');};
  const refresh=()=>{if(active.current)try{load();}catch(e){setError(message(e));}};
  window.addEventListener('whumpo:workspace-reset',reset);window.addEventListener(changed,refresh);
  try{const saved=load();if(saved)void run(()=>check(saved));}catch(e){setError(message(e));}
  return()=>{active.current=false;prepared.current=null;window.removeEventListener('whumpo:workspace-reset',reset);window.removeEventListener(changed,refresh);};
 // Restored requests are read only. Network retries require a new explicit click.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[owner,project]);
 async function save(element:HTMLFormElement){
  let upload=load();if(upload&&!checked)throw Error('Check the saved upload before retrying.');
  if(upload&&savedPhoto){await check(upload,true);return;}
  let blob=prepared.current?.id===upload?.id?prepared.current?.blob:null;
  if(!blob){
   const data=new FormData(element),file=data.get('photo');if(!(file instanceof File)||!file.size)throw Error(upload?'Choose the original photo to retry this upload.':'Choose a photo.');
   const next=await prepareProjectPhoto(file);if(!active.current)return;
   const selected=choice?options.find(c=>collectionKey(c)===choice):null;
   if(!upload&&choice&&!selected)throw Error('That collection is no longer available. Choose a current collection before uploading.');
   const candidate:PhotoRecovery={id:upload?.id??crypto.randomUUID(),projectId:project,name:upload?.name??String(data.get('name')).trim(),digest:next.digest,size:next.size,width:next.width,height:next.height,handoff:upload?upload.handoff:handoff,
    collection:upload?upload.collection:selected?{resourceId:selected.resourceId,configRevision:selected.configRevision,collectionId:selected.collectionId,requestId:crypto.randomUUID()}:null};
   if(upload&&!samePhotoUpload(upload,candidate))throw Error('That file does not match the original prepared photo. Choose the original file; nothing has been sent.');
   upload=candidate;blob=next.blob;
  }
  if(!active.current||!upload)return;
  // Persist before dispatch. Storage failures block the send, not just recovery.
  writePhotoRecovery(sessionStorage,owner,upload);prepared.current={id:upload.id,blob};setPending(upload);setChecked(false);window.dispatchEvent(new Event(changed));
  setNotice('Saving your private photo…');
  try{await api(`/projects/${project}/files/${upload.id}`,{method:'PUT',headers:{'content-type':'image/jpeg','x-photo-name':encodeURIComponent(upload.name),'x-whumpo-photo-handoff':JSON.stringify(upload.handoff)},body:blob});}
  catch(e){if(active.current)setNotice('Upload not confirmed. Check its saved status before retrying.');throw e;}
  if(active.current)await check(upload,true);
 }
 return <div className="space-y-4 min-w-0" data-photo-upload={project}>
  <p className="text-sm text-muted-foreground">Photos stay private until safety checks clear them. Scanning is not available yet. Uploading does not change or publish your website.</p>
  {notice&&<p role="status" className="text-sm break-words">{notice}</p>}
  {error&&<p role="alert" className="text-sm break-words">{error}</p>}
  {pending&&<div className="rounded-md border bg-secondary/40 p-3 space-y-3"><p className="text-sm break-words">{savedPhoto?pending.collection?'Saved photo; collection not confirmed':'Saved photo; recovery needs confirmation':'Unconfirmed upload'}: <strong>{pending.name}</strong>{pending.collection?` · ${pending.collection.collectionId}`:''}. Closing this card keeps its recovery details in this browser tab.</p><Button type="button" variant="secondary" className="min-h-11" disabled={busy||disabled} onClick={()=>void run(async()=>{setChecked(false);setNotice('');await check(pending);})}>Check upload status</Button></div>}
  {pending?.collection&&savedPhoto&&<div className="space-y-2"><Button type="button" variant="quiet" className="min-h-11" disabled={busy||disabled} onClick={()=>void run(()=>check(pending,false,true))}>Keep photo and stop collection retries</Button><p className="text-xs text-muted-foreground">The photo stays saved privately. A collection request already sent may still finish; stopping retries does not cancel it.</p></div>}
  <form ref={form} className="space-y-4" onSubmit={e=>{e.preventDefault();const element=e.currentTarget;void run(()=>save(element));}}>
   {!pending&&<div className="space-y-2"><label htmlFor={label+'-name'} className="text-sm font-medium">Photo name</label><Input id={label+'-name'} name="name" maxLength={100} required disabled={busy||disabled} className="min-h-11"/></div>}
   {!pending&&(options.length>0||!!choice)&&<div className="space-y-2"><label htmlFor={label+'-collection'} className="text-sm font-medium">Save in</label><select id={label+'-collection'} value={choice} onChange={e=>setChoice(e.target.value)} disabled={busy||disabled} className="h-11 w-full px-3 border rounded-md bg-card"><option value="">Project photos only</option>{choice&&!options.some(c=>collectionKey(c)===choice)&&<option value={choice} disabled>Selected collection unavailable</option>}{options.map(c=><option key={collectionKey(c)} value={collectionKey(c)}>{collectionLabel(c)}</option>)}</select><p className="text-xs text-muted-foreground">A collection keeps this photo private. It still needs safety checks and a separate website review.</p></div>}
   {!pending&&collections.isError&&<p className="text-xs text-muted-foreground">Collections could not be loaded. You can still save a private project photo.</p>}
   {(!pending||!prepared.current&&!savedPhoto)&&<div className="space-y-2"><label htmlFor={label+'-file'} className="text-sm font-medium">{pending?'Original photo':'Choose a photo'}</label><Input id={label+'-file'} name="photo" type="file" accept="image/jpeg,image/png,image/webp" required disabled={busy||disabled} className="min-h-11 max-w-full" aria-describedby={label+'-help'}/><p id={label+'-help'} className="text-xs text-muted-foreground">JPEG, PNG or WebP, up to 10 MB. Whumpo resizes it and removes image metadata before uploading.</p></div>}
   <Button type="submit" className="min-h-11" disabled={busy||disabled||!!pending&&!checked}>{busy?'Working…':pending?savedPhoto?pending.collection?'Add saved photo to collection':'Confirm saved photo':'Retry same upload':'Save private photo'}</Button>
  </form>
 </div>;
}
