import {useEffect,useRef,useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {api,message,queryClient,APIError} from './lib/api';
import {useCMSEditGuard} from './cms-edit-guard';
import {useWorkspace} from './workspace';
import {Button} from './components/ui/button';
import {Input} from './components/ui/input';
import {Section,Field} from './workspace-pages';

type Source={id:string;filename:string;digest:string;size:number;state:'pending'|'ready'};
type Review={id:string;title:string;status:string;expires_at:string};
type Report={summary:{reviewable:number;needsChanges:number;attachments:number};articles:{sourceId:number;title:string;status:string;reasons:string[];mediaPlan?:{imageCount:number;images:{position:number;attachmentId:number|null;alt:string;issues:string[]}[];issues:string[]}}[]};
const reasonLabels:Record<string,string>={
 custom_taxonomies_require_mapping:'Custom WordPress taxonomies need a separate mapping.',
 page_taxonomies_require_mapping:'Categories and tags on pages need a separate mapping.',
 taxonomy_locale_requires_review:'This article’s language or translations need review before term mapping.',
 too_many_initial_terms:'Split or simplify this article’s category and tag assignments before importing.',
 missing_term_definition:'Export the full category and tag definitions from WordPress.',
 conflicting_term_labels:'The export has conflicting names for the same category or tag.',
 category_hierarchy_requires_mapping:'Nested categories need a hierarchy mapping before import.',
 term_descriptions_require_mapping:'Category or tag descriptions need a separate mapping.',
 term_shape_requires_changes:'A category or tag name or slug needs adjustment before import.',
 initial_term_request_exceeds_limit:'This article’s category and tag mapping is too large for one import.',
 unsupported_post_type:'Only posts and pages can be imported.',
 password_protected_content:'This article is password protected. Review its privacy before preparing an import.',
 unsupported_source_status:'This article’s WordPress status is not supported.',
 source_provenance_exceeds_review_limit:'This article’s original content or metadata exceeds the comparison review limits.',
 media_requires_reviewed_local_import:'This article contains media. Add reviewed images separately before publishing.',
 active_content_requires_manual_conversion:'Interactive or executable content needs to be rewritten as article content.',
 shortcode_requires_manual_conversion:'Replace WordPress shortcodes with their intended article content.',
 converted_content_outside_supported_article_shape:'The converted article has unsupported formatting or exceeds the current article size limit.'
};
type Pending={id:string;name:string;file:File|null;digest?:string;attempted:boolean};
export function CMSWordPressPanel({project}:{project:string}){
 const [open,setOpen]=useState(false),[selected,setSelected]=useState(''),[pending,setPending]=useState<Pending|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const current=useRef<Pending|null>(null),alive=useRef(true),lock=useRef(false),{protect,run}=useCMSEditGuard(),{sendMessage}=useWorkspace();
 const base=`/cms/${project}/wordpress`;
 const sources=useQuery({queryKey:['wordpress-sources',project],queryFn:()=>api<{sources:Source[]}>(base+'/sources'),enabled:open,retry:false});
 const reviews=useQuery({queryKey:['wordpress-reviews',project],queryFn:()=>api<{reviews:Review[]}>(base+'/import-reviews'),enabled:open,retry:false});
 const report=useQuery({queryKey:['wordpress-report',project,selected],queryFn:()=>api<{report:Report}>(base+'/sources/'+selected),enabled:open&&!!selected,retry:false});
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;current.current=null;protect('clean','wordpress-upload');}},[protect]);
 function remember(value:Pending|null){current.current=value;setPending(value);protect(value?(value.attempted?'uncertain':'edited'):'clean','wordpress-upload');}
 async function choose(file?:File){
  if(!file||lock.current)return;lock.current=true;setBusy(true);setError('');
  try{
   if(!file.size||file.size>1048576||!file.name.toLowerCase().endsWith('.xml'))throw Error('Choose a WordPress XML export up to 1 MB. Split larger exports into smaller batches.');
   const previous=current.current;
   if(previous?.digest){const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),n=>n.toString(16).padStart(2,'0')).join('');if(digest!==previous.digest)throw Error('This is a different export. Choose the original file to recover this upload.');}
   const name=previous?.name??(file.name.slice(0,-4).replace(/[^A-Za-z0-9 _.-]/g,'_').replace(/^[^A-Za-z0-9]+/,'').slice(0,96)||'wordpress')+'.xml';
   if(alive.current)remember({id:previous?.id??crypto.randomUUID(),name,file,digest:previous?.digest,attempted:previous?.attempted??false});
  }catch(e){if(alive.current)setError(message(e));}finally{lock.current=false;if(alive.current)setBusy(false);}
 }
 async function upload(){
  const value=current.current;if(!value?.file||lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');remember({...value,attempted:true});protect('saving','wordpress-upload');
  try{
   const saved=await api<Source>(base+'/sources/'+value.id,{method:'PUT',headers:{'content-type':'application/xml','x-source-name':encodeURIComponent(value.name)},body:value.file});
   if(alive.current){remember(null);setSelected(saved.id);setNotice('Export saved privately. Review individual articles before importing; nothing is published.');}
   await queryClient.invalidateQueries({queryKey:['wordpress-sources',project]});
  }catch(e){if(alive.current){setError(message(e));if(e instanceof APIError&&[400,413,415].includes(e.status)&&!value.digest)remember({...value,attempted:false});}void sources.refetch();}
  finally{lock.current=false;if(alive.current){setBusy(false);protect(current.current?(current.current.attempted?'uncertain':'edited'):'clean','wordpress-upload');}}
 }
 const chat=(command:string)=>run(()=>void sendMessage(command));
 return <Section title="Bring your WordPress articles" description="Move your writing into Whumpo, one reviewed draft at a time.">
  <Button variant="outline" aria-expanded={open} onClick={()=>setOpen(!open)}>{open?'Hide WordPress imports':'Import from WordPress'}</Button>
  {open&&<div className="mt-5 space-y-5 min-w-0">
   <p className="text-sm text-muted-foreground">Choose a WordPress XML export containing up to 100 items and 1 MB. Your original export stays private. Images, plugins, themes and author accounts are not imported. Original metadata is kept for comparison.</p>
   <div className="rounded-2xl border bg-muted/30 p-4 space-y-3">
    <Field label={pending?.attempted?'Original export for recovery':'Choose your WordPress export'}><Input type="file" accept=".xml,application/xml,text/xml" disabled={busy||!!pending?.file&&pending.attempted} onChange={e=>{const file=e.target.files?.[0];e.target.value='';void choose(file);}}/></Field>
    {pending&&<><p className="text-sm break-all">{pending.name}</p><p className="text-xs text-muted-foreground">Keep this page open until the upload is confirmed. Retrying uses this same file and request.</p><Button className="w-full sm:w-auto" disabled={busy||!pending.file} onClick={()=>void upload()}>{busy?'Saving export…':pending.attempted?'Retry this export':'Save private export'}</Button>{!pending.attempted&&<Button variant="ghost" disabled={busy} onClick={()=>remember(null)}>Clear selection</Button>}</>}
    {error&&<p role="alert" className="text-sm break-words">{error}</p>}{notice&&<p role="status" className="text-sm">{notice}</p>}
   </div>
   <div className="space-y-3"><h3 className="font-semibold">Saved exports</h3>
    {sources.isPending?<p role="status">Loading exports…</p>:sources.error?<p role="alert">{message(sources.error)}</p>:!sources.data?.sources.length?<p className="text-sm text-muted-foreground">Your saved exports will appear here.</p>:sources.data.sources.map(source=><div key={source.id} className="rounded-xl border p-4 space-y-3 min-w-0"><p className="font-medium text-sm break-all">{source.filename}</p><p className="text-xs text-muted-foreground">{source.state==='ready'?'Saved privately':'Upload needs recovery'} · {Math.ceil(source.size/1024)} KB</p><div className="flex flex-col sm:flex-row gap-2">
     {source.state==='ready'&&<><Button variant="outline" disabled={busy} onClick={()=>setSelected(source.id)}>Review articles</Button><Button variant="ghost" asChild><a href={'/api'+base+'/sources/'+source.id+'/download'} download>Download original</a></Button></>}
     <Button variant="ghost" disabled={busy||!!pending} onClick={()=>{remember({id:source.id,name:source.filename,file:null,digest:source.digest,attempted:true});setError('');setNotice('Choose the original export above. Its contents must match the saved file.');}}>Recover original upload</Button>
    </div></div>)}
    <Button variant="ghost" disabled={sources.isFetching||reviews.isFetching} onClick={()=>{void sources.refetch();void reviews.refetch();}}>Refresh imports</Button>
   </div>
   {selected&&<div className="space-y-3"><h3 className="font-semibold">Article conversion review</h3>{report.isPending?<p role="status">Checking the saved export…</p>:report.error?<div role="alert"><p>{message(report.error)}</p><Button variant="outline" onClick={()=>void report.refetch()}>Check again</Button></div>:report.data&&<>
    <p className="text-sm text-muted-foreground">{report.data.report.summary.reviewable} ready to review · {report.data.report.summary.needsChanges} need changes · {report.data.report.summary.attachments} attachments not imported</p>
    {report.data.report.articles.map(article=><div key={article.sourceId} className="rounded-xl border p-4 space-y-3"><h4 className="font-medium break-words">{article.title||'Untitled article'}</h4><p className="text-xs text-muted-foreground">Source item {article.sourceId}</p>{article.mediaPlan&&article.mediaPlan.imageCount>0&&<details><summary className="min-h-11 cursor-pointer text-sm flex items-center">{article.mediaPlan.imageCount} source images · not imported</summary><p className="text-xs text-muted-foreground mb-3">Images still need a reviewed local upload mapping before this article can be imported. No remote files have been fetched.</p><ul className="space-y-2 text-sm">{article.mediaPlan.images.map(image=><li key={image.position} className="break-words">Image {image.position+1}: {image.attachmentId===null?'attachment not identified':'WordPress attachment '+image.attachmentId}{image.alt?' · '+image.alt:''}{image.issues.length>0?' · source details need review':''}</li>)}</ul>{article.mediaPlan.imageCount>article.mediaPlan.images.length&&<p className="text-xs mt-3">Only the first four are listed. This article exceeds the current four-image limit.</p>}</details>}{article.status!=='needs_review'?<ul className="list-disc pl-5 text-sm space-y-1">{article.reasons.map(reason=><li key={reason}>{reasonLabels[reason]??'This article needs manual conversion before import.'}</li>)}</ul>:<Button className="w-full sm:w-auto" variant="outline" onClick={()=>chat(`/import-wordpress ${project} ${selected} ${article.sourceId}`)}>Review this draft in Chat</Button>}</div>)}
   </>}</div>}
   <div className="space-y-3"><h3 className="font-semibold">Saved import reviews</h3>{reviews.error?<p role="alert">{message(reviews.error)}</p>:reviews.isPending?<p role="status">Loading reviews…</p>:!reviews.data?.reviews.length?<p className="text-sm text-muted-foreground">Your article reviews and import receipts will appear here.</p>:reviews.data.reviews.map(review=><div key={review.id} className="rounded-xl border p-4 space-y-3"><p className="font-medium break-words">{review.title}</p><p className="text-xs text-muted-foreground">{review.status==='imported'?'Imported privately':review.status==='approved'?'Import needs recovery':review.status==='superseded'?'Replaced review':review.expires_at<=new Date().toISOString()?'Review expired':'Awaiting your review'}</p><Button className="w-full sm:w-auto" variant="outline" onClick={()=>chat('/cms-import-review '+review.id)}>Open in Chat</Button></div>)}</div>
  </div>}
 </Section>;
}
