import type {Answer,Field} from '../../src/chat-interactions/types';
import {Button} from './components/ui/button';
import {Input} from './components/ui/input';
import {Textarea} from './components/ui/textarea';
import {ChatProjectPicker} from './chat-project-picker';

/** Shared controls for admitted maintained templates. Unknown fields never
 * become text inputs; the reader must negotiate the current capabilities. */
export function ChatInteractionField({field,owner,interactionId,digest,value,locked,invalid,onChange,onResourceReady}:{
 field:Field;owner:string;interactionId:string;digest:string;value:Answer|undefined;locked:boolean;invalid:boolean;
 onChange:(value:string|undefined)=>void;onResourceReady:(ready:boolean)=>void;
}){
 const name='form-'+interactionId+'-'+field.id,help=name+'-help',error=name+'-error',description=help+(invalid?' '+error:'');
 const label=<>{field.label} <span className="text-xs font-normal text-muted-foreground">{field.required?'Required':'Optional'}</span></>;
 const guidance=<><p id={help} className="text-xs text-muted-foreground break-words">{field.help}{field.default&&<span className="block mt-1">Starting value: {field.default.provenance==='saved'?'saved website text':field.default.provenance==='user'?'your earlier answer':'a suggestion to review'}.</span>}</p>{invalid&&<p id={error} role="alert" className="text-sm text-destructive">{field.type==='choice'?'Choose an option before continuing.':field.type==='resource'?'Choose a current project from the list.':String(value??'').trim()?'Check this answer’s length and format.':'Add an answer before continuing.'}</p>}</>;
 if(field.type==='choice')return <fieldset disabled={locked} aria-describedby={description} aria-invalid={invalid} className="min-w-0 space-y-2">
  <legend className="mb-2 text-sm font-medium break-words">{label}</legend>
  <div className="space-y-2">{field.constraints.options.map((option,index)=><label key={option.id} htmlFor={index?name+'-'+option.id:name} className={'flex min-h-12 items-center gap-3 rounded-xl border px-3 py-2 text-sm break-words '+(value===option.id?'border-primary bg-primary/5':'bg-background')+(locked?' opacity-70':' cursor-pointer hover:bg-secondary/50')}>
   <input id={index?name+'-'+option.id:name} data-field={index?undefined:field.id} type="radio" name={name} value={option.id} checked={value===option.id} required={field.required} aria-describedby={description} aria-invalid={invalid} onChange={()=>onChange(option.id)} className="size-5 shrink-0 rounded-full accent-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"/>
   <span className="min-w-0">{option.label}</span>
  </label>)}</div>
  {guidance}
  {value!==undefined&&!locked&&<Button type="button" variant="ghost" className="min-h-11" onClick={()=>{onChange(undefined);document.getElementById(name)?.focus();}}>Clear selection</Button>}
 </fieldset>;
 if(field.type!=='text'&&field.type!=='long-text'&&field.type!=='resource')throw new Error('Unsupported current Chat field');
 const props={id:name,'data-field':field.id,'aria-describedby':description,'aria-invalid':invalid,required:field.required,readOnly:locked,value:String(value??''),maxLength:'maxLength'in field.constraints?field.constraints.maxLength:undefined,onChange:(event:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>)=>onChange(event.target.value),autoComplete:'off',className:'min-h-11 text-base'};
 return <div className="space-y-2"><label htmlFor={name} className="block text-sm font-medium break-words">{label}</label>{field.type==='resource'?<ChatProjectPicker owner={owner} interactionId={interactionId} digest={digest} id={name} description={description} invalid={invalid} required={field.required} locked={locked} value={props.value} onChange={onChange} onReady={onResourceReady}/>:field.type==='long-text'?<Textarea {...props} rows={3}/>:<Input {...props}/>} {guidance}</div>;
}
