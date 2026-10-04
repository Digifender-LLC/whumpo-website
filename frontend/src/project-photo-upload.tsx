import {useEffect,useId,useRef,useState} from 'react';
import {readPhotoUploadStatus,samePhotoUpload,type PhotoUpload,type PhotoHandoff} from '../../src/photo-upload-shape';
import {api,message} from './lib/api';
import {prepareProjectPhoto} from './lib/prepare-project-photo';
import {readPhotoRecovery,writePhotoRecovery,resolvePhotoRecovery} from './lib/photo-upload-recovery';
import {Button} from './components/ui/button';
import {Input} from './components/ui/input';
const changed='whumpo:photo-recovery-changed';

/** Same explicit upload operation in Photos and Chat. Remount per account/project. */
export function ProjectPhotoUpload({owner,project,disabled=false,onSaved,handoff=null}:{owner:string;project:string;disabled?:boolean;handoff?:PhotoHandoff|null;onSaved?:()=>void}){
 const label=useId(),form=useRef<HTMLFormElement>(null),active=useRef(true),working=useRef(false),prepared=useRef<{id:string;blob:Blob}|null>(null);
 const [pending,setPending]=useState<PhotoUpload|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState(''),[checked,setChecked]=useState(false);
 function load(){const saved=readPhotoRecovery(sessionStorage,owner,project);setPending(saved);if(prepared.current?.id!==saved?.id)prepared.current=null;return saved;}
 async function check(upload:PhotoUpload){
  const data=readPhotoUploadStatus(await api(`/projects/${project}/files/${upload.id}`,{headers:{'x-whumpo-photo-handoff':JSON.stringify(upload.handoff)}}));if(!active.current)return;
  if(!data)throw Error('The upload status needs the current Whumpo response.');
  if(data.photo&&!samePhotoUpload(upload,data.photo))throw Error('This upload ID refers to different photo details. Keep the original request for review.');
  if(data.closedHandoff){
   if(!upload.handoff||data.closedHandoff.interactionId!==upload.handoff.interactionId||data.closedHandoff.definitionDigest!==upload.handoff.definitionDigest)throw Error('The closed uploader does not match this request. Keep its recovery details for review.');
   resolvePhotoRecovery(sessionStorage,owner,upload);prepared.current=null;setPending(null);setChecked(false);form.current?.reset();window.dispatchEvent(new Event(changed));
   setNotice('The earlier uploader closed before this upload was reserved. Its request cannot start now. You can choose a photo in this uploader.');
  }else if(data.photo?.status==='ready'){
   resolvePhotoRecovery(sessionStorage,owner,upload);prepared.current=null;setPending(null);setChecked(false);form.current?.reset();window.dispatchEvent(new Event(changed));
   setNotice(data.photo.safetyStatus==='approved'?'Photo saved privately and cleared for use. Ask Whumpo to add it to your website.':data.photo.safetyStatus==='blocked'?'Photo saved privately but unavailable for use.':'Photo saved privately. It is held for safety checks and cannot be displayed or used yet.');onSaved?.();
  }else{setChecked(true);setNotice(data.photo?'The upload started but is not confirmed. Retry the same photo to finish it.':'No saved upload was found yet. This does not prove an earlier request stopped. Retry uses the original upload ID.');}
 }
 async function run(action:()=>Promise<void>){
  if(working.current||!active.current)return;working.current=true;setBusy(true);setError('');
  try{await action();}catch(e){if(active.current)setError(message(e));}finally{working.current=false;if(active.current)setBusy(false);}
 }
 useEffect(()=>{
  active.current=true;const reset=()=>{active.current=false;prepared.current=null;setPending(null);setNotice('');setError('');};
  const refresh=()=>{if(active.current)try{load();}catch(e){setError(message(e));}};
  window.addEventListener('whumpo:workspace-reset',reset);window.addEventListener(changed,refresh);
  try{const saved=load();if(saved)void run(()=>check(saved));}catch(e){setError(message(e));}
  return()=>{active.current=false;prepared.current=null;window.removeEventListener('whumpo:workspace-reset',reset);window.removeEventListener(changed,refresh);};
 // Restored requests are read only. Network retries require a new explicit click.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[owner,project]);
 async function save(element:HTMLFormElement){
  let upload=load();if(upload&&!checked)throw Error('Check the saved upload before retrying.');
  let blob=prepared.current?.id===upload?.id?prepared.current?.blob:null;
  if(!blob){
   const data=new FormData(element),file=data.get('photo');if(!(file instanceof File)||!file.size)throw Error(upload?'Choose the original photo to retry this upload.':'Choose a photo.');
   const next=await prepareProjectPhoto(file);if(!active.current)return;
   const candidate:PhotoUpload={id:upload?.id??crypto.randomUUID(),projectId:project,name:upload?.name??String(data.get('name')).trim(),digest:next.digest,size:next.size,width:next.width,height:next.height,handoff:upload?upload.handoff:handoff};
   if(upload&&!samePhotoUpload(upload,candidate))throw Error('That file does not match the original prepared photo. Choose the original file; nothing has been sent.');
   upload=candidate;blob=next.blob;
  }
  if(!active.current||!upload)return;
  // Persist before dispatch. Storage failures block the send, not just recovery.
  writePhotoRecovery(sessionStorage,owner,upload);prepared.current={id:upload.id,blob};setPending(upload);setChecked(false);window.dispatchEvent(new Event(changed));
  setNotice('Saving your private photo…');
  try{await api(`/projects/${project}/files/${upload.id}`,{method:'PUT',headers:{'content-type':'image/jpeg','x-photo-name':encodeURIComponent(upload.name),'x-whumpo-photo-handoff':JSON.stringify(upload.handoff)},body:blob});}
  catch(e){if(active.current)setNotice('Upload not confirmed. Check its saved status before retrying.');throw e;}
  if(active.current)await check(upload);
 }
 return <div className="space-y-4 min-w-0" data-photo-upload={project}>
  <p className="text-sm text-muted-foreground">Photos stay private until safety checks clear them. Scanning is not available yet. Uploading does not change or publish your website.</p>
  {notice&&<p role="status" className="text-sm break-words">{notice}</p>}
  {error&&<p role="alert" className="text-sm break-words">{error}</p>}
  {pending&&<div className="rounded-md border bg-secondary/40 p-3 space-y-3"><p className="text-sm break-words">Unconfirmed upload: <strong>{pending.name}</strong>. Closing this card keeps its recovery details in this browser tab.</p><Button type="button" variant="outline" className="min-h-11" disabled={busy||disabled} onClick={()=>void run(async()=>{setChecked(false);setNotice('');await check(pending);})}>Check upload status</Button></div>}
  <form ref={form} className="space-y-4" onSubmit={e=>{e.preventDefault();const element=e.currentTarget;void run(()=>save(element));}}>
   {!pending&&<div className="space-y-2"><label htmlFor={label+'-name'} className="text-sm font-medium">Photo name</label><Input id={label+'-name'} name="name" maxLength={100} required disabled={busy||disabled} className="min-h-11"/></div>}
   {(!pending||!prepared.current)&&<div className="space-y-2"><label htmlFor={label+'-file'} className="text-sm font-medium">{pending?'Original photo':'Choose a photo'}</label><Input id={label+'-file'} name="photo" type="file" accept="image/jpeg,image/png,image/webp" required disabled={busy||disabled} className="min-h-11 max-w-full" aria-describedby={label+'-help'}/><p id={label+'-help'} className="text-xs text-muted-foreground">JPEG, PNG or WebP, up to 10 MB. Whumpo resizes it and removes image metadata before uploading.</p></div>}
   <Button type="submit" className="min-h-11" disabled={busy||disabled||!!pending&&!checked}>{busy?'Working…':pending?'Retry same upload':'Save private photo'}</Button>
  </form>
 </div>;
}
