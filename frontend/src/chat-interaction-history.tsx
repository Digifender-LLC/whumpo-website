import {readHistoryInteraction} from '../../src/chat-interactions/history-shape';
import type {Answer,Continuation} from '../../src/chat-interactions/types';
import {Button} from './components/ui/button';

export function continuationLabel(state:Continuation['state'],reason:string|null){
 return state==='not-started'?'Preview not started':state==='succeeded'?'Preview prepared':state==='failed'?reason==='stopped'?'Preview stopped':'Preview could not be prepared':'Preview outcome needs a status check';
}
const answerText=(value:Answer)=>typeof value==='boolean'?value?'Yes':'No':Array.isArray(value)?value.join(', '):String(value);
/** Plain current historical facts, with only navigation to a fresh scoped read. */
export function ChatInteractionHistory({value,onOpen}:{value:unknown;onOpen:(id:string)=>void}){
 const form=readHistoryInteraction(value);
 if(!form)return <p role="status" className="rounded-md border p-4 text-sm">This form record needs the current Whumpo response. Refresh before opening it.</p>;
 const replacement=form.replacementInteractionId;
 return <section aria-label="Saved form record" className="rounded-md border bg-card p-4 space-y-3 text-sm min-w-0">
  {form.state==='removed'?<><h3 className="font-semibold">Form removed</h3><p>{form.removal.reason==='discarded'?'This unsubmitted form was discarded.':'This unsubmitted form reached seven days of inactivity.'} Its answers and starting values are no longer available.</p></>:<>
   <h3 className="font-semibold break-words">{form.title}</h3><p className="text-muted-foreground break-words">{form.summary}</p>
   <p className="font-medium">{form.kind==='view'?'Saved Chat view':{open:'Answers not submitted',submitted:'Answers saved',superseded:'Replaced by a newer form',expired:'Answer window closed',canceled:'Form discarded'}[form.state]}</p>
   {form.submission?<><dl className="space-y-3">{form.fields.filter(f=>Object.hasOwn(form.submission!.answers,f.id)).map(f=><div key={f.id}><dt className="font-medium break-words">{f.label}</dt><dd className="mt-1 whitespace-pre-wrap break-words">{answerText(form.submission!.answers[f.id])}</dd></div>)}</dl><p className="text-xs text-muted-foreground">Submitted <time dateTime={form.submission.submittedAt}>{new Date(form.submission.submittedAt).toLocaleString()}</time> · {form.submission.continuation?continuationLabel(form.submission.continuation.state,form.submission.continuation.reason):'Information saved; no work was started'}</p></>:<p className="text-muted-foreground">{form.kind==='view'?'This history record does not confirm an upload, safety clearance or any other action. It contains no current measurements. Reopen the current Chat item to check available information.':'No answers were submitted. Draft text is only shown after opening the current form.'}</p>}
   {!replacement&&form.state!=='canceled'&&<Button variant="outline" className="min-h-11" data-resume-id={form.id} onClick={()=>onOpen(form.id)}>Open saved form</Button>}
  </>}
  {replacement&&<Button variant="outline" className="min-h-11" data-resume-id={replacement} onClick={()=>onOpen(replacement)}>Open replacement form</Button>}
 </section>;
}
