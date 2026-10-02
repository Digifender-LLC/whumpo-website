import {useState} from 'react';
import {useQuery} from '@tanstack/react-query';
import {readSpecificationReviewDisplay,readSpecificationReviewIdentity,type SpecificationReviewIdentity} from '../../src/project-specification/review-display';
import {APIError,api,message} from './lib/api';
import {Button} from './components/ui/button';

/** The display contains facts only. TurnActions owns the existing approval. */
export function SpecificationComparison({value}:{value:unknown}){
 const display=readSpecificationReviewDisplay(value);
 if(!display)return <p role="alert">Update Whumpo to read this comparison.</p>;
 return <div className="space-y-4 text-sm">
  <div><h3 className="font-semibold break-words">{display.project.name}</h3><p className="text-muted-foreground">{display.operation==='restore'?'Restore a saved website as a new private version.':'Save these changes as a new private version.'} Publishing requires a separate review.</p></div>
  {display.changes.length?<ol className="space-y-3">{display.changes.map(change=><li key={change.label} className="rounded-xl border overflow-hidden">
   <h4 className="bg-secondary/40 px-3 py-2 font-medium break-words">{change.label}</h4>
   <dl className="grid sm:grid-cols-2"><div className="min-w-0 p-3"><dt className="text-xs font-medium text-muted-foreground mb-1">Before</dt><dd className="whitespace-pre-wrap [overflow-wrap:anywhere]">{change.before===null?<span className="italic text-muted-foreground">Not included</span>:change.before===''?<span className="italic text-muted-foreground">Empty</span>:change.before}</dd></div><div className="min-w-0 border-t sm:border-t-0 sm:border-l bg-primary/5 p-3"><dt className="text-xs font-medium text-muted-foreground mb-1">After</dt><dd className="whitespace-pre-wrap [overflow-wrap:anywhere]">{change.after===null?<span className="italic text-muted-foreground">Not included</span>:change.after===''?<span className="italic text-muted-foreground">Empty</span>:change.after}</dd></div></dl>
  </li>)}</ol>:<p>The website text and theme are unchanged. Saving creates a new private version.</p>}
  <p className="text-xs text-muted-foreground">Review expires <time dateTime={display.expiresAt}>{new Date(display.expiresAt).toLocaleString()}</time>. Use the review button below to save this exact change.</p>
 </div>;
}
function CurrentComparison({owner,review}:{owner:string;review:SpecificationReviewIdentity}){
 const query=useQuery({queryKey:['specification-review-details',owner,review.id,review.proposalDigest,review.expectedRevision],queryFn:async({signal})=>{
  const raw=await api('/specification-reviews/'+review.id+'/details',{signal}),display=readSpecificationReviewDisplay(raw);
  if(!display||display.review.id!==review.id||display.review.proposalDigest!==review.proposalDigest||display.review.expectedRevision!==review.expectedRevision)throw new APIError('This comparison no longer matches the saved review. Ask Whumpo for a fresh review.',409);
  return display;
 },staleTime:0,gcTime:0,retry:false});
 return <div className="space-y-3 p-3 pt-0">
  {query.isFetching?<p role="status" className="text-sm">Checking the saved comparison…</p>:query.error?<p role="alert" className="text-sm">{message(query.error)}</p>:query.data?<SpecificationComparison value={query.data}/>:null}
  <Button type="button" variant="outline" className="min-h-11" disabled={query.isFetching} onClick={()=>void query.refetch()}>Refresh comparison</Button>
 </div>;
}
export function SpecificationReviewDetails({owner,value}:{owner:string;value:unknown}){
 const [open,setOpen]=useState(false),review=readSpecificationReviewIdentity(value);
 if(!review)return null;
 return <details className="rounded-xl border bg-card mt-4" onToggle={e=>setOpen(e.currentTarget.open)}>
  <summary className="min-h-11 cursor-pointer p-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">Proposed website changes</summary>
  {open&&<CurrentComparison owner={owner} review={review}/>}
 </details>;
}
