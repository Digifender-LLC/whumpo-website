import {useState} from 'react';
import {send,message,queryClient,type Profile} from './lib/api';
import {Button} from './components/ui/button';

const explanation='Optional and off unless you turn it on. Whumpo then records content-free milestones, such as finishing welcome, saving a draft, publishing or finishing passkey setup, with only a category and the minute it happened. Your answers, project text, Chat messages, email, passkeys, recovery details and files are never included. Turning this off deletes what was recorded.';

/** WH-025 opt-in. Unchecked by default; the server also defaults to no measurement. */
export function MeasurementConsentChoice({checked,onChange,disabled}:{checked:boolean;onChange:(value:boolean)=>void;disabled?:boolean}){
 return <label className="flex items-start gap-3 text-sm py-2"><input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)} disabled={disabled} className="mt-1 size-5 shrink-0"/><span>Help improve Whumpo with content-free progress measurements.<span className="block text-xs text-muted-foreground mt-2 leading-relaxed">{explanation}</span></span></label>;
}

export function MeasurementConsentSettings({profile,notify}:{profile:Profile;notify:(text:string)=>void}){
 const [busy,setBusy]=useState(false),enabled=!!profile.measurement_consent;
 async function change(value:boolean){
  setBusy(true);
  try{queryClient.setQueryData(['session'],await send<Profile>('/profile',{revision:profile.revision,measurement_consent:value},'PATCH'));notify(value?'Content-free measurements are on.':'Measurements are off and recorded milestones were deleted.');}
  catch(e){notify(message(e));}finally{setBusy(false);}
 }
 return <div className="space-y-4"><p className="text-sm text-muted-foreground">{explanation}</p><p className="text-sm" role="status">{enabled?'On: content-free milestones are recorded.':'Off: nothing is recorded.'}</p><Button variant="outline" disabled={busy} aria-pressed={enabled} onClick={()=>void change(!enabled)}>{enabled?'Turn off and delete measurements':'Turn on content-free measurements'}</Button></div>;
}
