// Component acceptance fixture only; it creates no server interaction or action.
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ChatResourceOptions} from '../../frontend/src/chat-resource-picker';
import {ChatInteractionFields} from '../../frontend/src/chat-interaction-fields';
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
declare global{interface Window{fixtureAnswers:()=>Answers;fixtureSubmitted:()=>Answers|null;fixtureResources:()=>Answers;fixtureConditional:()=>{answers:Answers;submitted:Answers|null};}}
const ready=()=>{};
function Fixture(){
 const recovery=useInteractionRecovery(owner,id),answers=recovery.value?.answers??{},[error,setError]=useState<string|null>(null),[submitted,setSubmitted]=useState<Answers|null>(null),[locked,setLocked]=useState(false);
 window.fixtureAnswers=()=>answers;window.fixtureSubmitted=()=>submitted;
 function change(key:string,value:Answer|undefined){const next={...answers};if(value===undefined)delete next[key];else next[key]=value;recovery.save({definitionDigest:digest,answerRevision:0,answers:next,updatedAt:Date.now(),dismissed:false,pending:null});setError(null);}
 return <main className="mx-auto max-w-2xl p-5 space-y-6"><h1 className="font-bold text-xl">Chat field component acceptance</h1><form noValidate className="space-y-6" onSubmit={e=>{e.preventDefault();try{const result=validateAnswers(definition,fieldAnswerSnapshot(definition.fields,answers));setSubmitted(result);setLocked(true);setError(null);}catch(error){if(!(error instanceof InteractionError))throw error;setError(error.fieldId);requestAnimationFrame(()=>document.querySelector<HTMLElement>('[data-field="'+error.fieldId+'"]')?.focus());}}}>
 <ChatInteractionFields fields={definition.fields} answers={answers} owner={owner} interactionId={id} digest={digest} locked={locked} fieldError={error} onChange={change} onResourceReady={ready}/>
 <Button type="submit" className="min-h-11" disabled={locked}>Validate answers</Button>{locked&&<Button type="button" variant="outline" className="min-h-11" onClick={()=>setLocked(false)}>Continue editing</Button>}
 </form>{submitted&&<p role="status">Typed answers validated. No server request was made.</p>}{recovery.storageFailed&&<p role="alert">Recovery storage failed.</p>}<ResourceFixture/><ConditionalFixture/></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);

const resourceFields=validateDefinition({version:1,kind:'form',template:'custom@1',title:'Resources component fixture',summary:'No server issuance',presentation:'inline',cards:[],submitBinding:'interaction.answers@1',continuationBinding:null,fields:[
 {...common,id:'projects',type:'resource',label:'Projects',constraints:{collection:'projects',multiple:true,maxItems:2}},
 {...common,id:'photos',type:'attachment',label:'Project photos',constraints:{collection:'photos',multiple:true,maxItems:2}},
 {...common,id:'cover',type:'attachment',label:'Cover photo',constraints:{collection:'photos',multiple:false,maxItems:1}}
]}).fields;
const resourceItems=Array.from({length:3},(_,i)=>({id:'33333333-3333-4333-8333-'+String(i+1).padStart(12,'0'),name:['Garden','Workshop','<img src=x onerror=alert(1)>'][i],photo:{width:640,height:480,size:1536}}));
function ResourceFixture(){
 const recovery=useInteractionRecovery(owner,'44444444-4444-4444-8444-444444444444'),answers=recovery.value?.answers??{},[locked,setLocked]=useState(false);
 window.fixtureResources=()=>answers;
 return <section className="space-y-6" aria-label="Resource component acceptance"><h2>Owned resource controls</h2>{resourceFields.map(field=>{if(field.type!=='resource'&&field.type!=='attachment')throw Error('Fixture field');return <section key={field.id} data-resource-field={field.id} className="space-y-2"><h3 className="text-sm font-medium">{field.label}</h3><p id={'resource-'+field.id+'-help'} className="text-xs">Choose saved metadata. No image bytes are loaded.</p><ChatResourceOptions field={field} id={'resource-'+field.id} description={'resource-'+field.id+'-help'} invalid={false} locked={locked} ready={true} items={resourceItems.map(i=>({...i,photo:field.constraints.collection==='photos'?i.photo:null}))} value={answers[field.id]} onChange={value=>{const next={...answers};if(value===undefined)delete next[field.id];else next[field.id]=value;recovery.save({definitionDigest:digest,answerRevision:0,answers:next,updatedAt:Date.now(),dismissed:false,pending:null});}}/></section>;})}<Button onClick={()=>setLocked(v=>!v)}>{locked?'Unlock resources':'Lock resources'}</Button></section>;
}


const conditionalDefinition=validateDefinition({version:1,kind:'form',template:'custom@1',title:'Service details',summary:'Component fixture; no server issuance',presentation:'inline',cards:[],submitBinding:'interaction.answers@1',continuationBinding:null,fields:[
 {...common,id:'mobile',type:'boolean',label:'Do you travel to customers?',constraints:{}},
 {...common,id:'radius',type:'number',label:'Travel radius in miles',constraints:{min:0,max:100,step:1},when:{fieldId:'mobile',equals:true}},
 {...common,id:'area',type:'text',label:'Town you serve',constraints:{maxLength:100},when:{fieldId:'mobile',equals:false}},
 {...common,id:'offering',type:'choice',label:'Main service',constraints:{options:[{id:'garden',label:'Garden care'},{id:'cleaning',label:'House cleaning'}]}},
 {...common,id:'details',type:'long-text',label:'Garden services',constraints:{maxLength:400},when:{fieldId:'offering',equals:'garden'}},
 {...common,id:'with-photo',type:'boolean',label:'Include a saved photo?',required:false,constraints:{}},
 {...common,id:'photo',type:'attachment',label:'Saved photo',required:false,constraints:{collection:'photos',multiple:false,maxItems:1},when:{fieldId:'with-photo',equals:true}}
]});
function ConditionalFixture(){
 const id='55555555-5555-4555-8555-555555555555',recovery=useInteractionRecovery(owner,id),answers=recovery.value?.answers??{},[error,setError]=useState<string|null>(null),[submitted,setSubmitted]=useState<Answers|null>(null);
 window.fixtureConditional=()=>({answers,submitted});
 function change(key:string,value:Answer|undefined){const next={...answers};if(value===undefined)delete next[key];else next[key]=value;recovery.save({definitionDigest:digest,answerRevision:0,answers:next,updatedAt:Date.now(),dismissed:false,pending:null});setError(null);}
 return <section aria-label="Conditional form acceptance"><h2>Service details</h2><form noValidate className="space-y-5" onSubmit={e=>{e.preventDefault();try{setSubmitted(validateAnswers(conditionalDefinition,fieldAnswerSnapshot(conditionalDefinition.fields,answers)));setError(null);}catch(error){if(!(error instanceof InteractionError))throw error;setError(error.fieldId);requestAnimationFrame(()=>document.querySelector<HTMLElement>('[data-field="'+error.fieldId+'"]')?.focus());}}}>
  <ChatInteractionFields fields={conditionalDefinition.fields} answers={answers} owner={owner} interactionId={id} digest={digest} locked={false} fieldError={error} onChange={change} onResourceReady={ready}/>
  <Button type="submit" className="min-h-11">Save service details</Button>
 </form>{submitted&&<p role="status">Service details validated locally.</p>}</section>;
}
