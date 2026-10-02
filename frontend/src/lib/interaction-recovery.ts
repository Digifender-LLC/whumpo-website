import {mutationHeader} from '../../../src/chat-interactions/protocol';
import type {Answers,Mutation} from '../../../src/chat-interactions/types';

export const interactionRecoveryKey='whumpo.chat-forms.v1';
export const interactionDraftLifetime=7*24*60*60*1000;
type StoragePort=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export type FormRecovery={definitionDigest:string;answerRevision:number;answers:Answers|null;updatedAt:number;dismissed:boolean;pending:Mutation|null};
type Saved={version:1;owner:string;forms:Record<string,FormRecovery>};
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
const exact=(v:object,keys:string[])=>Object.keys(v).sort().join(',')===[...keys].sort().join(',');
function record(value:unknown,id:string):FormRecovery{
 if(!value||typeof value!=='object'||Array.isArray(value)||!exact(value,['definitionDigest','answerRevision','answers','updatedAt','dismissed','pending']))throw Error('Invalid form recovery');
 const v=value as FormRecovery;
 if(!/^[a-f0-9]{64}$/.test(v.definitionDigest)||!Number.isSafeInteger(v.answerRevision)||v.answerRevision<0||!Number.isSafeInteger(v.updatedAt)||v.updatedAt<0||typeof v.dismissed!=='boolean')throw Error('Invalid form recovery');
 // Current bounded answer values and raw unfinished number/time input. Domain
 // field validation remains required before a pending wire mutation is created.
 const answer=(a:unknown)=>typeof a==='string'?a.length<=2000:typeof a==='boolean'||typeof a==='number'&&Number.isFinite(a)&&Math.abs(a)<=1e9||Array.isArray(a)&&a.length<=12&&a.every(v=>typeof v==='string'&&v.length<=2000)&&new Set(a).size===a.length;
 const answers=(values:Answers)=>values&&typeof values==='object'&&!Array.isArray(values)&&Object.entries(values).length<=12&&Object.entries(values).every(([key,a])=>/^[a-z][a-z0-9-]{0,39}$/.test(key)&&!['constructor','prototype','__proto__'].includes(key)&&answer(a))&&new TextEncoder().encode(JSON.stringify(values)).length<=16384;
 if(v.answers!==null&&!answers(v.answers))throw Error('Invalid draft');
 if(v.pending!==null){const p=mutationHeader(v.pending);if(p.interactionId!==id||p.definitionDigest!==v.definitionDigest||p.expectedAnswerRevision!==v.answerRevision||(p.operation!=='cancel'&&!answers(p.answers)))throw Error('Invalid pending request');}
 return v;
}
function readAll(store:StoragePort,owner:string,now:number):Saved{
 if(!uuid(owner))throw Error('Invalid account');
 const empty:Saved={version:1,owner,forms:{}},raw=store.getItem(interactionRecoveryKey);if(!raw)return empty;
 let result:Saved,changed=false;
 try{
  if(raw.length>2_000_000||new TextEncoder().encode(raw).length>2_000_000)throw Error('Oversized recovery');
  result=JSON.parse(raw);
  if(!result||typeof result!=='object'||!exact(result,['version','owner','forms'])||result.version!==1||result.owner!==owner||!result.forms||typeof result.forms!=='object'||Array.isArray(result.forms)||Object.keys(result.forms).length>100)throw Error('Invalid recovery');
  for(const [id,value] of Object.entries(result.forms)){
   if(!uuid(id))throw Error('Invalid form');const r=record(value,id);
   if(r.answers!==null&&(now<r.updatedAt||now-r.updatedAt>=interactionDraftLifetime)){r.answers=null;changed=true;}
   // An unresolved mutation retains its exact payload independently of draft TTL.
   if(r.answers===null&&!r.pending&&!r.dismissed){delete result.forms[id];changed=true;}
  }
 }catch{store.removeItem(interactionRecoveryKey);return empty;}
 // A storage failure must not be mistaken for malformed data and erase receipts.
 if(changed)persist(store,result);
 return result;
}
function persist(store:StoragePort,value:Saved){
 if(!Object.keys(value.forms).length){store.removeItem(interactionRecoveryKey);return;}
 const raw=JSON.stringify(value);if(raw.length>2_000_000||new TextEncoder().encode(raw).length>2_000_000||Object.keys(value.forms).length>100)throw Error('Form recovery is full');store.setItem(interactionRecoveryKey,raw);
}
export function readFormRecovery(store:StoragePort,owner:string,id:string,now=Date.now()){return readAll(store,owner,now).forms[id]??null;}
export function prepareInteractionRecovery(store:StoragePort,owner:string){readAll(store,owner,Date.now());}
export function writeFormRecovery(store:StoragePort,owner:string,id:string,value:FormRecovery|null,now=Date.now()){
 if(!uuid(id))throw Error('Invalid form');const saved=readAll(store,owner,now);
 if(value){const r=record(value,id);if(r.answers!==null||r.pending||r.dismissed)saved.forms[id]=r;else delete saved.forms[id];}else delete saved.forms[id];persist(store,saved);
}
export function clearInteractionRecovery(){try{sessionStorage.removeItem(interactionRecoveryKey);}catch{/* Browser storage can be unavailable. */}}
