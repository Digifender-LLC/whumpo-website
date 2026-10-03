import {copyJSON} from '../project-specification/v2/json';
import type {Answer,Continuation,FieldType} from './types';

type Identity={version:1;id:string;previousInteractionId:string|null;replacementInteractionId:string|null;answerRevision:number};
export type HistoryInteraction=Identity&({state:'removed';removal:{reason:'discarded'|'inactive';completedAt:string|null}}|{
 kind:'form'|'view';state:'open'|'submitted'|'canceled'|'superseded'|'expired';title:string;summary:string;
 fields:{id:string;label:string;help:string;type:FieldType;required:boolean;defaultProvenance?:'saved'|'user'|'suggested'}[];
 submission:null|{answers:Record<string,Answer>;submittedAt:string;continuation:null|{state:Continuation['state'];reason:string|null}};
});
export type InteractionCursor={createdAt:string;interactionId:string};
export type InteractionIndex={version:1;items:{interactionId:string;projectId:string|null;projectName:string|null;task:{id:string;revision:number};originTurnId:string;createdAt:string;expiresAt:string;state:'open'|'submitted';answerRevision:number;hasDraft:boolean;continuation:null|{id:string;state:Continuation['state'];reason:string|null}}[];nextBefore:InteractionCursor|null};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const shape=(v:unknown,keys:string[],optional:string[]=[])=>object(v)&&keys.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>keys.includes(k)||optional.includes(k));
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
const integer=(v:unknown)=>Number.isSafeInteger(v)&&(v as number)>=0;
const iso=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const text=(v:unknown,n:number)=>typeof v==='string'&&v.length<=n;
const states=['not-started','pending','succeeded','failed','unknown'];
const reason=(v:unknown)=>v===null||['changed','stopped','unavailable'].includes(v as string);
const fieldTypes=['text','long-text','choice','multi-choice','boolean','number','date','datetime','resource','attachment'];
const answer=(v:unknown)=>typeof v==='string'&&v.length<=2000||typeof v==='boolean'||typeof v==='number'&&Number.isFinite(v)||Array.isArray(v)&&v.length<=20&&v.every(s=>text(s,2000));

/** Current nonactionable facts only. Never interpret historical text as a binding. */
export function readHistoryInteraction(input:unknown):HistoryInteraction|null{
 try{
  const d=copyJSON(input,32768) as HistoryInteraction,base=['version','id','previousInteractionId','replacementInteractionId','answerRevision','state'];
  if(!object(d)||d.version!==1||!uuid(d.id)||![d.previousInteractionId,d.replacementInteractionId].every(v=>v===null||uuid(v))||!integer(d.answerRevision))return null;
  if(d.state==='removed')return shape(d,[...base,'removal'])&&shape(d.removal,['reason','completedAt'])&&['inactive','discarded'].includes(d.removal.reason)&&(d.removal.completedAt===null||iso(d.removal.completedAt))?d:null;
  if(!shape(d,[...base,'kind','title','summary','fields','submission'])||!['open','submitted','canceled','superseded','expired'].includes(d.state)||!text(d.title,100)||!text(d.summary,400)||!Array.isArray(d.fields)||d.fields.length>12)return null;
  if(!['form','view'].includes(d.kind)||d.kind==='view'&&(d.fields.length!==0||d.submission!==null||d.state==='submitted'))return null;
  if(!d.fields.every(f=>shape(f,['id','label','help','type','required'],['defaultProvenance'])&&/^[a-z][a-z0-9-]{0,39}$/.test(f.id)&&!['__proto__','constructor','prototype'].includes(f.id)&&text(f.label,80)&&text(f.help,240)&&fieldTypes.includes(f.type)&&typeof f.required==='boolean'&&(!Object.hasOwn(f,'defaultProvenance')||['saved','user','suggested'].includes(f.defaultProvenance!)))||new Set(d.fields.map(f=>f.id)).size!==d.fields.length)return null;
  const s=d.submission;
  if((d.state==='submitted')!==(s!==null))return null;
  if(s!==null&&(!shape(s,['answers','submittedAt','continuation'])||!object(s.answers)||!Object.entries(s.answers).every(([key,value])=>d.fields.some(f=>f.id===key)&&answer(value))||!iso(s.submittedAt)||s.continuation!==null&&(!shape(s.continuation,['state','reason'])||!states.includes(s.continuation.state)||!reason(s.continuation.reason))))return null;
  return d;
 }catch{return null;}
}
/** Resume metadata is a locator, never an issued definition or a dispatch instruction. */
export function readInteractionIndex(input:unknown):InteractionIndex|null{
 try{
  const d=copyJSON(input,32768) as InteractionIndex;
  if(!shape(d,['version','items','nextBefore'])||d.version!==1||!Array.isArray(d.items)||d.items.length>20)return null;
  if(!d.items.every(i=>shape(i,['interactionId','projectId','projectName','task','originTurnId','createdAt','expiresAt','state','answerRevision','hasDraft','continuation'])&&uuid(i.interactionId)&&uuid(i.originTurnId)&&(i.projectId===null?i.projectName===null:uuid(i.projectId)&&text(i.projectName,100))&&shape(i.task,['id','revision'])&&uuid(i.task.id)&&integer(i.task.revision)&&iso(i.createdAt)&&iso(i.expiresAt)&&['open','submitted'].includes(i.state)&&integer(i.answerRevision)&&typeof i.hasDraft==='boolean'&&(i.continuation===null||shape(i.continuation,['id','state','reason'])&&uuid(i.continuation.id)&&states.includes(i.continuation.state)&&reason(i.continuation.reason))))return null;
  if(new Set(d.items.map(i=>i.interactionId)).size!==d.items.length)return null;
  if(d.nextBefore!==null&&(!shape(d.nextBefore,['createdAt','interactionId'])||!iso(d.nextBefore.createdAt)||!uuid(d.nextBefore.interactionId)))return null;
  return d;
 }catch{return null;}
}
