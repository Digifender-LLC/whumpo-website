import {Globe,LockKeyhole} from 'lucide-react';
import type {AppPageReviewPresentation} from '../../src/app-page-review-shape';
import {Input} from './components/ui/input';
import {Button} from './components/ui/button';

export function AppPageReviewCard({review}:{review:AppPageReviewPresentation}){
 const {form,state}=review,applied=state==='applied';
 const status={ready:'Waiting for your approval',applied:'Page change recorded',expired:'Review expired',changed:'A new review is needed'}[state];
 return <section aria-label="Visitor page review" className="rounded-lg border bg-card p-4 sm:p-5 space-y-4">
  <div className="flex items-start gap-3"><Globe className="size-5 text-link shrink-0 mt-1"/><div className="min-w-0"><p className="text-xs text-muted-foreground">{status}</p><h3 className="font-bold text-lg mt-1 break-words">{applied?(form?'Visitor page publication approved':'Taking the visitor page offline was approved'):form?'Review your visitor page':'Take your visitor page offline'}</h3><p className="text-sm mt-1 break-words">{review.projectName}</p></div></div>
  {form?<>
   <div className="rounded-md border bg-background p-4 space-y-4" aria-label="Proposed form preview">
    <p className="text-xs font-semibold text-muted-foreground">FORM PREVIEW · NOT INTERACTIVE</p>
    <h4 className="text-lg font-bold break-words">{form.title}</h4>{form.description&&<p className="whitespace-pre-wrap break-words">{form.description}</p>}
    <fieldset disabled className="space-y-4"><legend className="sr-only">Proposed visitor inputs</legend>{form.fields.map(field=><label key={field.key} className={'text-sm font-medium '+(field.type==='boolean'?'flex items-start gap-3':'block space-y-2')}>
     {field.type==='boolean'?<><input type="checkbox" disabled className="size-5 shrink-0 mt-0.5"/><span className="break-words">{field.label}</span></>:<><span className="block break-words">{field.label}</span>{field.type==='choice'?<><select disabled className="min-h-11 w-full rounded-md border bg-background px-3" defaultValue=""><option value="">Choose an option</option>{field.options.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}</select><ul className="list-disc pl-5 text-sm font-normal" aria-label={'Choices for '+field.label}>{field.options.map(o=><li key={o.value} className="break-words">{o.label}</li>)}</ul></>:<Input disabled type={field.type} className="min-h-11" placeholder={field.type==='number'?'Number':field.optional?'Optional text':'Text, up to 300 characters'}/>}</>}
    </label>)}<Button type="button" disabled className="min-h-11 h-auto w-full whitespace-normal break-words">{form.buttonLabel}</Button></fieldset>
    <p className="text-xs text-muted-foreground">Preview of the proposed fields. Nothing here runs the app or saves data. This form has not been tested by this review.</p>
   </div>
   <p className="text-sm">The title, description and field labels become public when you approve publication.</p>
   <div className="rounded-md bg-secondary/60 p-3 flex items-start gap-2"><LockKeyhole className="size-4 shrink-0 mt-1"/><p>Visitors need an invitation and a passkey to use the form. Their input and private saved data go to your approved app. Results appear as text.</p></div>
   <div><p className="text-xs text-muted-foreground mb-1">Visitor address after publication</p><p className="text-sm break-all">https://app-{review.projectId}.whumpo.site/</p></div>
  </>:<p>This takes the visitor page and its data API offline. Stored visitor data and activity history remain.</p>}
  <p className="text-sm text-muted-foreground">This change signs out every visitor and cancels pending sign-ins. It does not change your separate website or stateless tools.</p>
  <p className="text-xs text-muted-foreground leading-relaxed">Signed-in visitors can export their data and delete their account. Automatic retention and whole-app recovery are still being built.</p>
  {state==='ready'&&<p className="text-xs text-muted-foreground">Review the details, then use the approval button below. This review expires {new Date(review.expiresAt).toLocaleString()}.</p>}
  {(state==='expired'||state==='changed')&&<p className="text-sm font-medium">Ask Whumpo for a fresh review. This saved review can no longer be approved.</p>}
  {applied&&<p className="text-sm font-medium">This is a historical receipt. It does not confirm the page is currently online.</p>}
  <details className="border-t pt-2"><summary className="cursor-pointer min-h-11 py-3 font-medium">Exact configuration and review details</summary><div className="text-xs space-y-3 text-muted-foreground pb-1"><dl className="space-y-2 break-all"><div><dt>Review</dt><dd>{review.id}</dd></div><div><dt>Program revision</dt><dd>{review.programRevision}</dd></div><div><dt>Page revision before change</dt><dd>{review.pageRevision}</dd></div></dl>{form&&<pre className="whitespace-pre-wrap break-all rounded-md bg-muted p-3 text-foreground font-mono">{JSON.stringify(form,null,2)}</pre>}</div></details>
 </section>;
}
