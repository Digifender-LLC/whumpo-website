// Component acceptance fixture only; it creates no server interaction or action.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ChatInteractionField} from '../../frontend/src/chat-interaction-field';
import {useInteractionRecovery} from '../../frontend/src/use-interaction-recovery';
import {fieldAnswerSnapshot} from '../../frontend/src/lib/interaction-fields';
import {InteractionError,validateDefinition,validateAnswers} from '../../src/chat-interactions/protocol';
import type {Answer,Answers} from '../../src/chat-interactions/types';
import {Button} from '../../frontend/src/components/ui/button';
import '../../frontend/src/styles.css';
const owner='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222',digest='a'.repeat(64);
const common={help:'',required:true,binding:'answer.value@1'},definition=validateDefinition({version:1,kind:'form',template:'custom@1',title:'Typed field fixture',summary:'No server issuance',presentation:'inline',cards:[],submitBinding:'interaction.answers@1',continuationBinding:null,fields:[
 {...common,id:'features',type:'multi-choice',label:'Web features',constraints:{options:[{id:'contact',label:'Contact form'},{id:'gallery',label:'Photo gallery'},{id:'hours',label:'Opening hours'}]}},
 {...common,id:'enabled',type:'boolean',label:'Show business hours?',constraints:{}},
 {...common,id:'amount',type:'number',label:'Starting amount',constraints:{min:0,max:100,step:0.5}},
 {...common,id:'date',type:'date',label:'Launch date',constraints:{}},
 {...common,id:'meeting',type:'datetime',label:'Appointment',constraints:{zone:'America/Chicago'}}
]});
declare global{interface Window{fixtureAnswers:()=>Answers;fixtureSubmitted:()=>Answers|null;}}
const ready=()=>{};
function Fixture(){
 const recovery=useInteractionRecovery(owner,id),answers=recovery.value?.answers??{},[error,setError]=useState<string|null>(null),[submitted,setSubmitted]=useState<Answers|null>(null),[locked,setLocked]=useState(false);
 window.fixtureAnswers=()=>answers;window.fixtureSubmitted=()=>submitted;
 function change(key:string,value:Answer|undefined){const next={...answers};if(value===undefined)delete next[key];else next[key]=value;recovery.save({definitionDigest:digest,answerRevision:0,answers:next,updatedAt:Date.now(),dismissed:false,pending:null});setError(null);}
 return <main className="mx-auto max-w-2xl p-5 space-y-6"><h1 className="font-bold text-xl">Chat field component acceptance</h1><form noValidate className="space-y-6" onSubmit={e=>{e.preventDefault();try{const result=validateAnswers(definition,fieldAnswerSnapshot(definition.fields,answers));setSubmitted(result);setLocked(true);setError(null);}catch(error){if(!(error instanceof InteractionError))throw error;setError(error.fieldId);requestAnimationFrame(()=>document.querySelector<HTMLElement>('[data-field="'+error.fieldId+'"]')?.focus());}}}>
 {definition.fields.map(field=><section key={field.id} data-fixture-field={field.id}><ChatInteractionField field={field} owner={owner} interactionId={id} digest={digest} value={answers[field.id]} locked={locked} invalid={error===field.id} onChange={v=>change(field.id,v)} onResourceReady={ready}/></section>)}
 <Button type="submit" className="min-h-11" disabled={locked}>Validate answers</Button>{locked&&<Button type="button" variant="outline" className="min-h-11" onClick={()=>setLocked(false)}>Continue editing</Button>}
 </form>{submitted&&<p role="status">Typed answers validated. No server request was made.</p>}{recovery.storageFailed&&<p role="alert">Recovery storage failed.</p>}</main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
