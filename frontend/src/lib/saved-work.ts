import {savedWorkKinds,type SavedWorkItem,type SavedWorkKind,type SavedWorkList,type SavedWorkPhase} from '../../../src/saved-work-shape';
import type {Turn} from './api';

/** Saved-work entries are navigation hints from stored metadata. They never
 * confer approval, and the destination's current reader stays authoritative. */
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const id=(v:unknown):v is string=>typeof v==='string'&&uuid.test(v);
const nullableId=(v:unknown)=>v===null||id(v);
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exactKeys=(v:Record<string,unknown>,keys:string[])=>Object.keys(v).sort().join(',')===[...keys].sort().join(',');
export const savedWorkPhases=['review','working','uncertain','attention','finished','expired','form'] as const satisfies readonly SavedWorkPhase[];
export const savedWorkPageSize=30;
const itemKeys=['expiresAt','id','interactionId','key','kind','phase','projectId','projectName','safety','state','turnId'];
export const isSavedWorkKind=(v:unknown):v is SavedWorkKind=>typeof v==='string'&&Object.hasOwn(savedWorkKinds,v);
/** SQLite `datetime()` values have no zone marker; every stored time is UTC. */
export function savedWorkTime(value:string){const text=/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value)?value.replace(' ','T')+'Z':value;const time=Date.parse(text);return Number.isFinite(time)?new Date(time):null;}
function item(v:unknown):v is SavedWorkItem{
 if(!record(v)||!exactKeys(v,itemKeys))return false;
 if(!isSavedWorkKind(v.kind)||!id(v.id)||v.key!==v.kind+':'+v.id)return false;
 if(!nullableId(v.projectId)||!(v.projectName===null||typeof v.projectName==='string'&&v.projectName.length<=200)||(v.projectId===null)!==(v.projectName===null))return false;
 if(typeof v.state!=='string'||!v.state||v.state.length>64||!savedWorkPhases.includes(v.phase as SavedWorkPhase))return false;
 // Only an open review/form (or one that expired unapproved) carries an expiry.
 if(v.expiresAt!==null&&(typeof v.expiresAt!=='string'||v.expiresAt.length>40||!savedWorkTime(v.expiresAt)||!['review','form','expired'].includes(v.phase as string)))return false;
 if(!nullableId(v.turnId)||!nullableId(v.interactionId))return false;
 return v.safety===null||['website','backend','application'].includes(v.safety as string)&&v.projectId!==null;
}
/** Strict current-version reader. A mismatch asks for a refresh instead of guessing. */
export function readSavedWorkList(value:unknown,after:string|null=null):SavedWorkList|null{
 if(!record(value)||!exactKeys(value,['items','next','version'])||value.version!==1||!Array.isArray(value.items)||value.items.length>savedWorkPageSize)return null;
 const items=value.items;if(!items.every(item))return null;
 for(let n=0;n<items.length;n++){const key=items[n].key;if(n?key<=items[n-1].key:after!==null&&key<=after)return null;}
 if(value.next!==null&&(typeof value.next!=='string'||items.length!==savedWorkPageSize||value.next!==items.at(-1)!.key))return null;
 return {version:1,items,next:value.next};
}
export type SavedWorkView='open'|'all';
export function savedWorkPath(view:SavedWorkView,kind:SavedWorkKind|null,after:string|null){
 const params=new URLSearchParams({view});if(kind)params.set('kind',kind);if(after)params.set('after',after);
 return '/workspace/saved-work?'+params.toString();
}
type Copy={label:string;detail:string};
const phaseCopy:Record<SavedWorkPhase,Copy>={
 review:{label:'Waiting for your review',detail:'Open it to read the current review. Opening it does not approve anything.'},
 form:{label:'Waiting for your answers',detail:'This form is still open. Opening it does not send anything.'},
 working:{label:'In progress',detail:'This work was still running at the last check. Check again later.'},
 uncertain:{label:'Outcome not known yet',detail:'Whumpo has not confirmed whether this finished. It will not be sent again automatically. Check its saved state before trying again.'},
 attention:{label:'Needs attention',detail:'This did not finish or needs a decision before anything else happens.'},
 finished:{label:'Finished',detail:'Recorded as finished. This is saved history, not a live status check.'},
 expired:{label:'Expired',detail:'This review or form can no longer be used. Ask Whumpo for a fresh one if you still need it.'},
};
// Photo states come from the trusted safety view; only a current approval reads as cleared.
const photoCopy:Partial<Record<SavedWorkPhase,Copy>>={
 uncertain:{label:'Upload not confirmed',detail:'Whumpo has not confirmed that this photo arrived. It is not cleared for use.'},
 attention:{label:'Not cleared for use',detail:'This photo has not passed a current safety check, or was blocked. It is not used until a current check approves it.'},
 finished:{label:'Approved by the current safety check',detail:'Recorded as approved. This is saved history, not a live status check.'},
};
export function savedWorkStatus(item:Pick<SavedWorkItem,'kind'|'phase'>):Copy{return (item.kind==='photo'?photoCopy[item.phase]:undefined)??phaseCopy[item.phase];}
export function savedWorkExpiry(item:Pick<SavedWorkItem,'phase'|'expiresAt'>,locale?:string){
 const time=item.expiresAt?savedWorkTime(item.expiresAt):null;if(!time)return null;
 const text=time.toLocaleString(locale);
 return item.phase==='expired'?'Expired '+text:item.phase==='form'?'Answer by '+text:'Review by '+text;
}
export type SavedWorkDestination=
 {kind:'safety';label:string;search:{project:string;review:string;service?:'backend'|'application'}}|
 {kind:'interaction'|'turn';label:string;search:{signup:false;interaction?:string;turn?:string}};
/** Exact existing destinations only: withdrawal review, Chat form, then Chat message. */
export function savedWorkDestination(item:SavedWorkItem):SavedWorkDestination|null{
 if(item.safety&&item.projectId)return {kind:'safety',label:'Open withdrawal review',search:item.safety==='website'?{project:item.projectId,review:item.id}:{project:item.projectId,service:item.safety,review:item.id}};
 if(item.interactionId)return {kind:'interaction',label:'Open saved form in Chat',search:{signup:false,interaction:item.interactionId}};
 if(item.turnId)return {kind:'turn',label:'Open message in Chat',search:{signup:false,turn:item.turnId}};
 return null;
}
export const savedTurnStatuses=['pending','completed','failed','uncertain'] as const;
/** Current `/chat/turns/:id` reader. `uncertain` is a schema status: its outcome is unknown, never success. */
export function readSavedTurn(value:unknown,expected:string):Turn|null{
 if(!record(value)||value.version!==1||!record(value.turn))return null;
 const turn=value.turn;
 if(turn.id!==expected||!Number.isSafeInteger(turn.revision)||(turn.revision as number)<1||typeof turn.user_text!=='string'||typeof turn.assistant_text!=='string'||!savedTurnStatuses.includes(turn.status as typeof savedTurnStatuses[number]))return null;
 return turn as Turn;
}
export const savedTurnFallback=(status:string)=>status==='pending'?'Whumpo is working on your request…':status==='uncertain'?'Whumpo could not confirm whether this request finished. It will not be sent again automatically. Check your saved work before asking again.':'No saved reply is available for this message.';
