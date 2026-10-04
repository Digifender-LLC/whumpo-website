import {useId,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {api,message} from './lib/api';
import {Button} from './components/ui/button';
export type WordPressMediaPlan={status?:string;imageCount:number;images:{position:number;attachmentId:number|null;alt:string;caption?:string;issues:string[]}[];issues:string[]};
export function canMapWordPressImages(article:{reasons:string[];mediaPlan?:WordPressMediaPlan}){
 const plan=article.mediaPlan;
 return !!plan&&plan.status==='needs_local_media'&&plan.imageCount>0&&plan.imageCount<=4&&plan.images.length===plan.imageCount&&!plan.issues.length&&article.reasons.every(reason=>reason==='media_requires_reviewed_local_import');
}
type Uploads={uploads:{requestId:string;filename:string;status:string;safety?:'approved'|'pending'|'blocked';result:{mediaId:string;width:number;height:number}|null}[]};
export function CMSWordPressImages({project,plan,onReview,disabled=false}:{project:string;plan:WordPressMediaPlan;onReview:(ids:string[])=>void;disabled?:boolean}){
 const labelId=useId(),[choices,setChoices]=useState<Record<number,string>>({}),[failed,setFailed]=useState<Record<string,boolean>>({});
 const uploads=useQuery({queryKey:['cms-uploads',project],queryFn:()=>api<Uploads>(`/cms/${project}/media/uploads`),retry:false});
 const saved=Array.from(new Map((uploads.data?.uploads??[]).filter(row=>row.status==='saved'&&row.result&&/^[0-9A-HJKMNP-TV-Z]{26}$/.test(row.result.mediaId)).map(row=>[row.result!.mediaId,row])).values());
 const ids=plan.images.map(image=>choices[image.position]??''),ready=ids.length>0&&ids.every(id=>saved.some(row=>row.result!.mediaId===id&&row.safety==='approved')&&!failed[id]);
 return <div className="space-y-4 rounded-xl border bg-muted/30 p-3 sm:p-4">
  <div><h5 className="font-semibold text-sm">Match your images</h5><p className="mt-2 text-sm text-muted-foreground">Choose an uploaded image for each place in this article. Original captions and descriptions stay with the article. We won’t download images from your old website.</p></div>
  {uploads.isPending?<p role="status" className="text-sm">Loading your saved images…</p>:uploads.error?<p role="alert" className="text-sm">{message(uploads.error)}</p>:!saved.length?<p className="text-sm">Add images in the Media library on this page, then refresh this list. Only confirmed uploads from this publishing space can be used.</p>:<div className="space-y-5">{plan.images.map(image=>{
   const selected=saved.find(row=>row.result!.mediaId===choices[image.position]),selectId=labelId+'-'+image.position;
   return <div key={image.position} className="space-y-2 min-w-0"><label htmlFor={selectId} className="block text-sm font-medium">Image {image.position+1}{image.alt?' · '+image.alt:''}</label><p className="text-xs text-muted-foreground">WordPress attachment {image.attachmentId}{image.caption?' · '+image.caption:''}</p>
    <select id={selectId} value={selected?.result?.mediaId??''} disabled={disabled||uploads.isFetching} onChange={e=>setChoices({...choices,[image.position]:e.target.value})} className="w-full min-w-0 min-h-11 rounded-md border border-input bg-background px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-ring"><option value="">Choose a saved image</option>{saved.map(row=><option key={row.result!.mediaId} value={row.result!.mediaId}>{row.filename} · {row.result!.width} × {row.result!.height}</option>)}</select>
    {selected&&(selected.safety!=='approved'?<p role="alert" className="text-sm">{selected.safety==='blocked'?'This image did not pass a safety review. Choose another upload.':'This image is held for a safety review. It can be used for an import review after it is cleared.'}</p>:failed[selected.result!.mediaId]?<p role="alert" className="text-sm text-destructive">This image couldn’t be opened. Refresh to retry or choose another upload.</p>:<img src={`/api/cms/${project}/media/${selected.result!.mediaId}/preview`} alt={'Selected upload: '+selected.filename} onError={()=>setFailed(previous=>({...previous,[selected.result!.mediaId]:true}))} className="w-full max-h-48 object-contain rounded-lg bg-background"/>)}
   </div>;
  })}</div>}
  <div className="flex flex-col sm:flex-row gap-2"><Button type="button" variant="outline" className="min-h-11" disabled={disabled||uploads.isFetching} onClick={()=>{setFailed({});void uploads.refetch();}}>Refresh saved images</Button><Button type="button" className="min-h-11" disabled={disabled||uploads.isFetching||!!uploads.error||!ready} onClick={()=>{if(ready)onReview(ids);}}>Review with these images in Chat</Button></div>
  <p className="text-xs text-muted-foreground">You’ll review the complete article before importing. Nothing is published. Image choices are saved when the review is prepared.</p>
 </div>;
}
