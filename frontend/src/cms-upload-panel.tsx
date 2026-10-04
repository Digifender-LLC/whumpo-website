import {useEffect,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {api,message,queryClient} from './lib/api';
import {prepareCMSImage,cmsImageFilename} from './lib/prepare-cms-image';
import {useCMSEditGuard} from './cms-edit-guard';
import {Button} from './components/ui/button';
import {Input} from './components/ui/input';
import {Field} from './workspace-pages';
type Receipt={requestId:string;filename:string;status:'saved'|'unresolved';createdAt:string};
type Inventory={uploadEnabled:boolean;uploads:Receipt[]};
type Prepared={id:string;name:string;blob:Blob|null};
export function CMSUploadPanel({project}:{project:string}){
 const uploads=useQuery({queryKey:['cms-uploads',project],queryFn:()=>api<Inventory>(`/cms/${project}/media/uploads`),retry:false});
 const [pending,setPending]=useState<Prepared|null>(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState(''),[error,setError]=useState('');
 const current=useRef<Prepared|null>(null),alive=useRef(true),lock=useRef(false),{protect}=useCMSEditGuard();
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;current.current=null;protect('clean','media-upload');}},[protect]);
 const set=(value:Prepared|null)=>{current.current=value;setPending(value);protect(value?'uncertain':'clean','media-upload');};
 async function choose(file?:File){
  if(!file||lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');protect('saving','media-upload');
  try{const blob=await prepareCMSImage(file);if(alive.current)set({id:current.current?.id??crypto.randomUUID(),name:current.current?.name??cmsImageFilename(file.name),blob});}
  catch(e){if(alive.current)setError(message(e));}
  finally{lock.current=false;if(alive.current){setBusy(false);protect(current.current?'uncertain':'clean','media-upload');}}
 }
 async function save(){
  const upload=current.current;if(!upload?.blob||lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');protect('saving','media-upload');
  try{
   await api(`/cms/${project}/media/uploads/${upload.id}`,{method:'PUT',headers:{'content-type':'image/jpeg','x-photo-name':encodeURIComponent(upload.name)},body:upload.blob});
   if(alive.current){set(null);setNotice('Image saved privately. It stays held for a safety review before it can be previewed or published, and it has not been sent to the agent.');}
   await Promise.all([queryClient.invalidateQueries({queryKey:['cms-uploads',project]}),queryClient.invalidateQueries({queryKey:['cms-media',project]})]);
  }catch(e){if(alive.current)setError(message(e));void uploads.refetch();}
  finally{lock.current=false;if(alive.current){setBusy(false);protect(current.current?'uncertain':'clean','media-upload');}}
 }
 const unresolved=uploads.data?.uploads.filter(row=>row.status==='unresolved')??[];
 return <div className="rounded-2xl border bg-muted/30 p-4 sm:p-5 space-y-4">
  <div><h3 className="font-semibold">Add an image</h3><p className="mt-1 text-sm text-muted-foreground">Saved privately in this publishing space. Choose saved images from your article editor.</p></div>
  {uploads.isPending?<p role="status" className="text-sm">Checking image uploads…</p>:uploads.error?<div role="alert" className="space-y-3"><p className="text-sm">{message(uploads.error)}</p><Button variant="outline" onClick={()=>void uploads.refetch()}>Check again</Button></div>:!uploads.data?.uploadEnabled?<p className="text-sm text-muted-foreground">This publishing space needs an update before it can accept images.</p>:<>
   {!pending&&unresolved.length>0&&<p className="text-sm">Check the unfinished uploads below before adding a replacement.</p>}
   <Field label={pending?'Re-select the original image if needed':'Choose an image'}><Input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={e=>{const file=e.target.files?.[0];e.target.value='';void choose(file);}}/></Field>
   <p className="text-xs text-muted-foreground">JPEG, PNG or WebP · up to 10 MB. We resize to 1600 pixels and prepare a JPEG under 1 MB.</p>
   {pending&&<div className="space-y-3"><p className="text-sm font-medium break-all">{pending.name}</p><p className="text-xs text-muted-foreground">Keep this page open until the save is confirmed. Retries use the same request and prepared image.</p><Button className="w-full sm:w-auto" disabled={busy||!pending.blob} onClick={()=>void save()}>{busy?'Working…':pending.blob?'Save or retry this image':'Choose the original image above'}</Button></div>}
  </>}
  {error&&<p role="alert" className="text-sm break-words">{error}</p>}{notice&&<p role="status" className="text-sm">{notice}</p>}
  {unresolved.length>0&&<div className="border-t pt-4 space-y-3"><h4 className="font-medium text-sm">Uploads to check</h4><p className="text-xs text-muted-foreground">After reopening this page, select the original image on the same browser to recover its upload. A different image is refused. If recovery cannot be confirmed, keep this request for support rather than making a replacement.</p><ul className="space-y-3">{unresolved.map(row=><li key={row.requestId} className="rounded-xl border bg-background p-3 space-y-2"><p className="text-sm break-all">{row.filename}</p><p className="text-xs text-muted-foreground break-all">Request {row.requestId}</p><Button variant="outline" disabled={busy||!!pending||!uploads.data?.uploadEnabled} onClick={()=>{setError('');setNotice('Choose the original image above to recover this request.');set({id:row.requestId,name:row.filename,blob:null});}}>Recover this upload</Button></li>)}</ul></div>}
  <Button variant="ghost" disabled={busy||uploads.isFetching} onClick={()=>void uploads.refetch()}>Refresh upload status</Button>
 </div>;
}
