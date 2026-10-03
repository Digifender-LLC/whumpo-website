/** Trusted question meanings for owner website planning. The model composes
 * descriptors; it never supplies question wording, options, defaults or effects. */
import {canonicalJSON,copyJSON} from '../project-specification/v2/json';
import {InteractionError,validateDefinition} from './protocol';
import type {Definition,Field} from './types';

export const purposes={
 'site.services@1':{title:'Your services',summary:'Help Whumpo plan your service pages. Share public business details only; leave out account secrets and private customer information.'},
 'site.presentation@1':{title:'Your website direction',summary:'Choose a direction for this website. Share your preferences; leave out account secrets and private customer information.'}
} as const;
export type InformationPurpose=keyof typeof purposes;
export type QuestionRequest={id:string;questionId:string;required:boolean;when?:{fieldId:string;equals:boolean|string}};
const services=['site.services@1'] as const,presentation=['site.presentation@1'] as const,both=['site.services@1','site.presentation@1'] as const;
const common={binding:'answer.value@1' as const,required:false};
const questions:Record<string,{purposes:readonly InformationPurpose[];field:Field}>={
 'gallery-photos':{purposes:presentation,field:{...common,id:'gallery-photos',type:'resource',label:'Which photos should we plan with?',help:'Choose up to four approved photos already in this project. This shares their names and dimensions with Whumpo, not image contents. It does not publish them.',constraints:{collection:'photos',multiple:true,maxItems:4}}},
 'services':{purposes:services,field:{...common,id:'services',type:'long-text',label:'What services do you offer?',help:'Describe the work visitors can ask you to do. Leave out private customer details.',constraints:{maxLength:1000}}},
 'service-area':{purposes:services,field:{...common,id:'service-area',type:'text',label:'Where do you offer your services?',help:'Cities, neighborhoods or a general service area are enough. Do not give a private home address.',constraints:{maxLength:200}}},
 'visits-customers':{purposes:services,field:{...common,id:'visits-customers',type:'boolean',label:'Do you travel to your customers?',help:'This helps describe where people can use your services.',constraints:{}}},
 'travel-radius':{purposes:services,field:{...common,id:'travel-radius',type:'number',label:'How far will you travel?',help:'Enter your travel radius in miles.',constraints:{min:0,max:500,step:1}}},
 'vehicle-sizes':{purposes:services,field:{...common,id:'vehicle-sizes',type:'multi-choice',label:'Which vehicles do you work on?',help:'Choose the types your service supports.',constraints:{options:[{id:'car',label:'Car'},{id:'suv',label:'SUV'},{id:'truck',label:'Truck'},{id:'van',label:'Van'},{id:'camper',label:'Camper'}]}}},
 'service-extras':{purposes:services,field:{...common,id:'service-extras',type:'long-text',label:'Do you offer any extras?',help:'Describe optional services or add-ons you want visitors to know about.',constraints:{maxLength:1000}}},
 'starting-price':{purposes:services,field:{...common,id:'starting-price',type:'number',label:'What starting price should visitors see?',help:'US dollars. This is public pricing information, not a payment or billing instruction.',constraints:{min:0,max:100000,step:0.01}}},
 'audience':{purposes:both,field:{...common,id:'audience',type:'long-text',label:'Who is this website for?',help:'Describe the audience in general terms. Do not list individual customers.',constraints:{maxLength:500}}},
 'target-date':{purposes:both,field:{...common,id:'target-date',type:'date',label:'When would you like the website ready?',help:'A planning preference; saving this date does not schedule publication.',constraints:{}}},
 'visual-style':{purposes:presentation,field:{...common,id:'visual-style',type:'choice',label:'What feel would you like?',help:'Choose a starting direction for this website.',constraints:{options:[{id:'simple',label:'Simple and clear'},{id:'warm',label:'Warm and welcoming'},{id:'bold',label:'Bold and colorful'},{id:'elegant',label:'Quiet and elegant'}]}}},
 'colors':{purposes:presentation,field:{...common,id:'colors',type:'text',label:'Any colors you would like to use?',help:'Color names or hex colors are enough. Leave this optional if you want Whumpo to suggest a palette.',constraints:{maxLength:200}}},
 'sections':{purposes:presentation,field:{...common,id:'sections',type:'multi-choice',label:'What should visitors find?',help:'Choose the sections you want to plan.',constraints:{options:[{id:'about',label:'About us'},{id:'services',label:'Services'},{id:'gallery',label:'Gallery'},{id:'faq',label:'Common questions'},{id:'contact',label:'Contact details'}]}}}
};
const identifier=(v:unknown):v is string=>typeof v==='string'&&/^[a-z][a-z0-9-]{0,39}$/.test(v)&&!['constructor','prototype','__proto__'].includes(v);
export function informationDefinition(purpose:unknown,input:unknown):Definition{
 if(typeof purpose!=='string'||!Object.hasOwn(purposes,purpose))throw new InteractionError('PURPOSE');
 const fields=copyJSON(input,8192) as QuestionRequest[];
 if(!Array.isArray(fields)||!fields.length||fields.length>12)throw new InteractionError('SHAPE');
 const seen=new Set<string>();
 const compiled=fields.map((r,index)=>{
  if(!r||typeof r!=='object'||Array.isArray(r)||Object.keys(r).some(k=>!['id','questionId','required','when'].includes(k))||!identifier(r.id)||typeof r.questionId!=='string'||!Object.hasOwn(questions,r.questionId)||typeof r.required!=='boolean')throw new InteractionError('SHAPE');
  const q=questions[r.questionId];
  if(seen.has(r.questionId)||!q.purposes.includes(purpose as InformationPurpose))throw new InteractionError('PURPOSE',r.id);
  seen.add(r.questionId);
  if(r.questionId==='travel-radius'&&(!r.when||r.when.equals!==true||!fields.slice(0,index).some(f=>f.id===r.when!.fieldId&&f.questionId==='visits-customers')))throw new InteractionError('CONDITION',r.id);
  return {...q.field,id:r.id,questionId:r.questionId,required:r.required,...(Object.hasOwn(r,'when')?{when:r.when}:{})};
 });
 return validateDefinition({version:1,kind:'form',template:'custom@1',purpose,...purposes[purpose as InformationPurpose],presentation:'inline',fields:compiled,cards:[],submitBinding:'interaction.answers@1',continuationBinding:'agent.task-continue@1'});
}
export function informationQuestions(definition:Definition):QuestionRequest[]{
 return definition.fields.map(f=>({id:f.id,questionId:f.questionId!,required:f.required,...(f.when?{when:f.when as QuestionRequest['when']}:{})}));
}
/** Structural custom fixtures are not runtime authority. Only exact compiled
 * questions plus server-carried user/suggested defaults are admitted here. */
export function isInformationDefinition(input:Definition):boolean{
 try{
  const d=validateDefinition(input);
  if(d.template!=='custom@1')return false;
  const expected=informationDefinition(d.purpose,informationQuestions(d));
  const actual={...d,fields:d.fields.map(({default:initial,...field})=>field)};
  return canonicalJSON(expected)===canonicalJSON(actual);
 }catch{return false;}
}
/** Small metadata catalogue, with no customer values or resource authority. */
export const informationCatalog=Object.entries(purposes).map(([purpose,details])=>({purpose,title:details.title,questions:Object.entries(questions).filter(([,q])=>q.purposes.includes(purpose as InformationPurpose)).map(([questionId,q])=>({questionId,label:q.field.label,type:q.field.type,...(questionId==='travel-radius'?{requires:'earlier visits-customers=true'}:{})}))}));
