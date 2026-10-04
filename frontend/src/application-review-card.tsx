import {ShieldCheck,Info} from 'lucide-react';
import type {ApplicationReviewPresentation} from '../../src/application-review-shape';

export function ApplicationReviewCard({review}:{review:ApplicationReviewPresentation}){
 const enable=review.operation==='enable',applied=review.state==='applied';
 const status={ready:'Waiting for your approval',applied:'Approval recorded',expired:'Review expired',changed:'A new review is needed'}[review.state];
 return <section aria-label="Application approval" className="rounded-2xl border bg-card p-4 sm:p-5 space-y-4">
  <div className="flex items-start gap-3"><ShieldCheck className="size-5 text-link shrink-0 mt-1"/><div className="min-w-0"><p className="text-xs text-muted-foreground">{status}</p><h3 className="font-bold text-lg mt-1 break-words">{applied?(enable?'App data access approved':'Disabling the app was approved'):enable?'Let your app save each visitor’s data':'Disable your app'}</h3><p className="text-sm mt-1 break-words">{review.projectName}</p></div></div>
  <p>{enable?'Your app can read a signed-in visitor’s saved data and submitted input, then replace that visitor’s saved data and return a result. Each visitor has their own separate data.':'This stops the app and signs out every visitor. Saved data and past activity stay stored. Work already saved stays saved; unfinished changes will be rejected.'}</p>
  {enable&&<p className="text-muted-foreground">It cannot access other visitors’ data, your workspace data, credentials, or the internet.</p>}
  <div className="rounded-xl bg-secondary/60 p-3 flex items-start gap-2"><Info className="size-4 shrink-0 mt-1"/><p>{enable?'This approves the app’s data access. A separate page approval is needed before visitors can use it. Reapproving an existing app hides its current visitor page until reviewed again.':'This does not delete visitor data. Any separately published stateless tools are unchanged.'}</p></div>
  {enable&&<p className="text-xs text-muted-foreground leading-relaxed">A successful example was tested, but that does not prove every input works. Saved data and results remain in private storage and activity history. Visitors can export their data and delete their own account. Automatic retention and full-app recovery are still being built. After visitors join, changing the code needs a data migration workflow that is not available yet.</p>}
  {review.state==='ready'&&<p className="text-xs text-muted-foreground">Review the details, then use the approval button below. This review expires {new Date(review.expiresAt).toLocaleString()}.</p>}
  {(review.state==='expired'||review.state==='changed')&&<p className="text-sm font-medium">Ask Whumpo for a fresh review. This saved review can no longer be approved.</p>}
  {applied&&<p className="text-sm font-medium">This is a historical receipt. It does not confirm the app’s current availability or publish a visitor page.</p>}
  <details className="border-t pt-2"><summary className="cursor-pointer min-h-11 py-3 font-medium">Technical details and exact code</summary><div className="space-y-3 pb-1 text-xs text-muted-foreground">
   {enable&&<p>Test-stage limits: 4 KiB per visitor document, 100 visitors per project, 20 attempts per visitor per day, and 100 per project per day. Changing code after visitors join requires a data migration; that workflow is not available yet.</p>}
   <dl className="space-y-2 break-all"><div><dt>Review</dt><dd>{review.id}</dd></div><div><dt>Source SHA-256</dt><dd>{review.digest}</dd></div>{review.testId&&<div><dt>Successful test receipt</dt><dd>{review.testId}</dd></div>}</dl>
   <p>Saved source is shown as text. Displaying it does not run it.</p><pre className="whitespace-pre-wrap break-all rounded-xl bg-muted p-3 text-foreground font-mono">{review.source}</pre>
  </div></details>
 </section>;
}
