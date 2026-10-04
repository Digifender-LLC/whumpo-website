import {useState} from 'react';
import type {GitHubGrantReview} from '../../src/github-grant-shape';
import type {ChatControl} from '../../src/chat-controls';
import {Button} from './components/ui/button';
import {message} from './lib/api';

export function GitHubGrantReviewCard({review,onAction,busy=false}:{review:GitHubGrantReview;onAction:(action:ChatControl)=>Promise<void>;busy?:boolean}){
 const [working,setWorking]=useState(false),[error,setError]=useState('');
 const state=review.state==='review'&&review.expiresAt<=new Date().toISOString()?'expired':review.state;
 const status={review:'Your approval is needed',expired:'Review expired',cancelled:'Cancelled',dispatching:'Waiting for a confirmed result',uncertain:'Result needs recovery',revoked:'Access removal confirmed'}[state];
 const act=async(operation:'confirm'|'cancel')=>{if(busy||working)return;setWorking(true);setError('');try{await onAction(operation==='confirm'?{type:'githubGrant',operation,reviewId:review.id,confirmation:'REVOKE_APP_ACCESS'}:{type:'githubGrant',operation,reviewId:review.id});}catch(e){setError(message(e))}finally{setWorking(false)}};
 return <section aria-label="GitHub access review" className="rounded-lg border bg-card p-4 sm:p-5 space-y-4 text-sm min-w-0">
  <div><h3 className="font-bold text-base">Remove GitHub app access</h3><p className="text-muted-foreground mt-1" role="status">{status}</p></div>
  <dl className="space-y-2"><div><dt className="text-xs text-muted-foreground">GitHub account</dt><dd className="font-semibold break-words">{review.login} <span className="font-normal text-muted-foreground">· ID {review.githubUserId}</span></dd></div><div><dt className="text-xs text-muted-foreground">Saved credentials covered</dt><dd>{review.credentialCount}</dd></div></dl>
  <p className="leading-relaxed break-words">{review.disclosure}</p>
  {state==='review'&&<><p className="text-xs text-muted-foreground">Expires {new Date(review.expiresAt).toLocaleString()}. Confirm with your passkey.</p><div className="flex flex-col sm:flex-row gap-2"><Button variant="destructive" className="min-h-11 h-auto py-3 whitespace-normal" disabled={busy||working} onClick={()=>void act('confirm')}>Revoke all GitHub app access</Button><Button variant="outline" className="min-h-11" disabled={busy||working} onClick={()=>void act('cancel')}>Cancel review</Button></div></>}
  {state==='expired'&&<p>Ask Whumpo for a new review if you still want to remove access.</p>}
  {state==='cancelled'&&<p>This review made no request to GitHub.</p>}
  {['dispatching','uncertain'].includes(state)&&<p>Whumpo has disabled the reviewed local access. We need to recover the provider result before proceeding. This request will not be sent again.</p>}
  {state==='revoked'&&<p>GitHub confirmed this request{review.settledAt?' on '+new Date(review.settledAt).toLocaleString():''}. Later authorizations are separate.</p>}
  {error&&<p role="alert" className="text-destructive break-words">{error}</p>}
 </section>;
}
