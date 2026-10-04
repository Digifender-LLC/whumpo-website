import type {Answer,Field} from '../../src/chat-interactions/types';
import {Button} from './components/ui/button';
import {Input} from './components/ui/input';
import {Textarea} from './components/ui/textarea';
import {ChatResourcePicker} from './chat-resource-picker';
import {ChatDateTimeField} from './chat-date-time-field';
import {useCallback} from 'react';

/** Shared controls for admitted maintained templates. Unknown fields never
 * become text inputs; the reader must negotiate the current capabilities. */
export function ChatInteractionField({field,owner,interactionId,digest,value,locked,invalid,onChange,onResourceReady}:{
 field:Field;owner:string;interactionId:string;digest:string;value:Answer|undefined;locked:boolean;invalid:boolean;
 onChange:(value:Answer|undefined)=>void;onResourceReady:(fieldId:string,ready:boolean)=>void;
}){
 const resourceReady=useCallback((ready:boolean)=>onResourceReady(field.id,ready),[field.id,onResourceReady]);
 const name='form-'+interactionId+'-'+field.id,help=name+'-help',error=name+'-error',description=help+(field.type==='number'?' '+name+'-range':'')+(invalid?' '+error:'');
 const label=<>{field.label} <span className="text-xs font-normal text-muted-foreground">{field.required?'Required':'Optional'}</span></>;
 const errorText=field.type==='choice'?'Choose an option before continuing.':field.type==='multi-choice'?'Choose at least one option before continuing.':field.type==='boolean'?'Choose Yes or No before continuing.':field.type==='number'?`Enter a number from ${field.constraints.min} to ${field.constraints.max}, in steps of ${field.constraints.step}.`:field.type==='date'?'Choose a complete calendar date.':field.type==='datetime'?'Choose a complete date and time in the shown time zone, including an occurrence if the clocks repeat.':field.type==='resource'||field.type==='attachment'?field.constraints.collection==='photos'?'Choose an available photo from the list.':field.constraints.multiple?'Choose at least one current project.':'Choose a current project from the list.':String(value??'').trim()?'Check this answer’s length and format.':'Add an answer before continuing.';
 const guidance=<><p id={help} className="text-xs text-muted-foreground break-words">{field.help}{field.default&&<span className="block mt-1">{field.default.provenance==='suggested'?'Starting value: suggested by Whumpo. Review before saving.':`Starting value: ${field.default.provenance==='saved'?'saved website text':'your earlier answer'}.`}</span>}</p>{invalid&&<p id={error} role="alert" className="text-sm text-destructive">{errorText}</p>}</>;
 if(field.type==='choice'||field.type==='multi-choice'||field.type==='boolean'){
  const multiple=field.type==='multi-choice',options=field.type==='boolean'?[{id:'yes',label:'Yes',value:true},{id:'no',label:'No',value:false}]:field.constraints.options.map(o=>({...o,value:o.id}));
  return <fieldset disabled={locked} aria-describedby={description} aria-invalid={invalid} className="min-w-0 space-y-2">
  <legend className="mb-2 text-sm font-medium break-words">{label}</legend>
  <div className="space-y-2">{options.map((option,index)=>{const selected=multiple?Array.isArray(value)&&value.includes(option.id):value===option.value;return <label key={option.id} htmlFor={index?name+'-'+option.id:name} className={'flex min-h-12 items-center gap-3 rounded-md border px-3 py-2 text-sm break-words '+(selected?'border-link bg-action-soft':'bg-background')+(locked?' opacity-70':' cursor-pointer hover:bg-secondary/50')}>
   <input id={index?name+'-'+option.id:name} data-field={index?undefined:field.id} type={multiple?'checkbox':'radio'} name={name} value={option.id} checked={selected} required={!multiple&&field.required} aria-describedby={description} aria-invalid={invalid} onChange={()=>onChange(multiple?options.filter(o=>o.id===option.id?!selected:Array.isArray(value)&&value.includes(o.id)).map(o=>o.id):option.value)} className="size-5 shrink-0 accent-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"/>
   <span className="min-w-0">{option.label}</span>
  </label>;})}</div>
  {guidance}
  {value!==undefined&&!locked&&<Button type="button" variant="quiet" className="min-h-11" onClick={()=>{onChange(undefined);document.getElementById(name)?.focus();}}>Clear selection</Button>}
 </fieldset>;
 }
 if(field.type==='datetime')return <div className="min-w-0 space-y-2"><p className="text-sm font-medium break-words">{label}</p><ChatDateTimeField id={name} fieldId={field.id} label={field.label} zone={field.constraints.zone} value={value} required={field.required} locked={locked} invalid={invalid} description={description} onChange={onChange}/>{guidance}{value!==undefined&&!locked&&<Button type="button" variant="quiet" className="min-h-11" onClick={()=>{onChange(undefined);document.getElementById(name)?.focus();}}>Clear date and time</Button>}</div>;
 if(field.type==='number'||field.type==='date')return <div className="min-w-0 space-y-2"><label htmlFor={name} className="block text-sm font-medium break-words">{label}</label><Input id={name} data-field={field.id} type={field.type==='date'?'date':'text'} inputMode={field.type==='number'?'decimal':undefined} min={field.type==='date'?'0001-01-01':undefined} max={field.type==='date'?'9999-12-31':undefined} maxLength={field.type==='number'?80:undefined} autoComplete="off" aria-describedby={description} aria-invalid={invalid} required={field.required} readOnly={locked} value={String(value??'')} onChange={e=>onChange(e.target.value===''?undefined:e.target.value)} className="min-h-11 min-w-0 text-base"/>{field.type==='number'&&<p id={name+'-range'} className="text-xs text-muted-foreground">{field.constraints.min} to {field.constraints.max} · steps of {field.constraints.step}</p>}{guidance}</div>;
 if(field.type==='resource'||field.type==='attachment')return <div className="space-y-2"><label htmlFor={name} className="block text-sm font-medium break-words">{label}</label><ChatResourcePicker field={field} owner={owner} interactionId={interactionId} digest={digest} id={name} description={description} invalid={invalid} locked={locked} value={value} onChange={onChange} onReady={resourceReady}/>{guidance}</div>;
 if(field.type!=='text'&&field.type!=='long-text')throw new Error('Unsupported current Chat field adapter');
 const props={id:name,'data-field':field.id,'aria-describedby':description,'aria-invalid':invalid,required:field.required,readOnly:locked,value:String(value??''),maxLength:'maxLength'in field.constraints?field.constraints.maxLength:undefined,onChange:(event:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>)=>onChange(event.target.value),autoComplete:'off',className:'min-h-11 text-base'};
 return <div className="space-y-2"><label htmlFor={name} className="block text-sm font-medium break-words">{label}</label>{field.type==='long-text'?<Textarea {...props} rows={3}/>:<Input {...props}/>} {guidance}</div>;
}
