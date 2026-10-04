import type {Answer} from '../../src/chat-interactions/types';
import {dateTimeCandidates,dateTimeInput,validWallTime} from './lib/interaction-fields';
import {Input} from './components/ui/input';

export function ChatDateTimeField({id,fieldId,label,zone,value,required,locked,invalid,description,onChange}:{id:string;fieldId:string;label:string;zone:string;value:Answer|undefined;required:boolean;locked:boolean;invalid:boolean;description:string;onChange:(value:Answer|undefined)=>void}){
 const {date,time}=dateTimeInput(value,zone),local=date+'T'+time,candidates=dateTimeCandidates(local,zone),gap=validWallTime(local)&&candidates.length===0,ambiguous=candidates.length>1,zoneId=id+'-zone';
 const focusTarget=!date?'date':!time||gap?'time':ambiguous&&!candidates.some(c=>c.instant===value)?'occurrence':'date';
 // Ordinary appointments use minutes. Retained seconds/milliseconds stay exact
 // and visible when present instead of being rounded during a later edit.
 const shownTime=time.endsWith(':00.000')?time.slice(0,-7):time.endsWith('.000')?time.slice(0,-4):time;
 const step=/\.\d*[1-9]\d*$/.test(shownTime)?'0.001':shownTime.split(':').length>2?'1':'60';
 const change=(d:string,t:string)=>{if(!d&&!t){onChange(undefined);return;}const local=d+'T'+t,found=dateTimeCandidates(local,zone);onChange(found.length===1?found[0].instant:local);};
 return <div className="space-y-2">
  <p id={zoneId} className="text-xs text-muted-foreground">Time zone: {zone}</p>
  <div className="grid gap-3 sm:grid-cols-2"><div className="min-w-0 space-y-1"><label htmlFor={id} className="block text-xs text-muted-foreground">Date</label><Input id={id} data-field={focusTarget==='date'?fieldId:undefined} type="date" min="0001-01-01" max="9999-12-31" aria-label={label+' — date'} aria-describedby={description+' '+zoneId} aria-invalid={invalid||gap} required={required} readOnly={locked} value={date} onChange={e=>change(e.target.value,time)} className="min-h-11 min-w-0 text-base"/></div>
   <div className="min-w-0 space-y-1"><label htmlFor={id+'-time'} className="block text-xs text-muted-foreground">Time</label><Input id={id+'-time'} data-field={focusTarget==='time'?fieldId:undefined} type="time" step={step} aria-label={label+' — time'} aria-describedby={description+' '+zoneId} aria-invalid={invalid||gap} required={required} readOnly={locked} value={shownTime} onChange={e=>change(date,e.target.value)} className="min-h-11 min-w-0 text-base"/></div></div>
  {gap&&<p role="alert" className="text-sm text-destructive">This local time is unavailable in this time zone. Some times are skipped when the clocks change. Choose a different time.</p>}
  {ambiguous&&<fieldset disabled={locked} className="space-y-2"><legend className="text-sm mb-2">The clocks repeat this time. Choose which occurrence you mean.</legend>{candidates.map((c,i)=><label key={c.instant} className="flex min-h-12 items-center gap-3 rounded-md border px-3 py-2 text-sm"><input data-field={focusTarget==='occurrence'&&i===0?fieldId:undefined} type="radio" name={id+'-occurrence'} value={c.instant} checked={value===c.instant} required={required} aria-describedby={description} onChange={()=>onChange(c.instant)} className="size-5 shrink-0 accent-primary"/><span>{i===0?'First':'Second'} occurrence ({c.offset})</span></label>)}</fieldset>}
 </div>;
}
