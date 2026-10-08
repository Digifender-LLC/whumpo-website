import {SpecificationError,canonicalJSON,copyJSON,plain} from '../project-specification/v2/json';
import {ModuleError} from './policy';

/** WH-093 lead pipeline domain core (docs/business-leads.md). Pure and synchronous: no storage, clock, timezone, network,
 * inference, catalog or Chat. Callers pass every time, id and reference date explicitly, so a later handler can read a
 * lead, call this once and commit the returned state with no `await` between the read and the compare-and-swap.
 * Stage vocabulary, note bounds and civil-date rules are current-only: unknown stages, fields, shapes or coercible values
 * are refused, never repaired. Errors reuse the fixed `ModuleError` messages and never echo a submitted value. Nothing here
 * decides retention, intake source, timezone or a revision cap; those are owner decisions or storage rules for later. */

/** Closed stage vocabulary. A lead with no stored state is `new`; any stage may move to any other. */
export const leadStages=Object.freeze(['new','contacted','qualified','won','lost'] as const);
export type LeadStage=typeof leadStages[number];
/** Stages still being worked; only these can be overdue. `won` and `lost` keep their due date as history. */
export const activeLeadStages=Object.freeze(['new','contacted','qualified'] as const satisfies readonly LeadStage[]);
export const leadLimits=Object.freeze({notes:20,noteCodePoints:1000,notesJsonBytes:16384,filterStages:leadStages.length,requestJsonBytes:8192});
/** Bit set describing what one change touched, for a later content-free history row. */
export const leadChangeBits=Object.freeze({stage:1,dueOn:2,notes:4});

export type LeadNote={id:string;text:string;createdAt:number;updatedAt:number};
export type LeadState={stage:LeadStage;stageChangedAt:number|null;dueOn:string|null;notes:readonly LeadNote[];revision:number;updatedAt:number|null};
export type LeadNoteChange={op:'add';text:string}|{op:'edit';noteId:string;text:string}|{op:'remove';noteId:string};
export type LeadChanges={stage?:LeadStage;dueOn?:string|null;note?:LeadNoteChange};
export type LeadFilter={stages:readonly LeadStage[]|null;hasNotes:boolean|null;dueFrom:string|null;dueTo:string|null};
export type LeadDueBucket='none'|'inactive'|'overdue'|'today'|'week'|'later';

const invalid=()=>new ModuleError('invalid_request');
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
const seconds=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>0;
const stageOf=(v:unknown):v is LeadStage=>typeof v==='string'&&(leadStages as readonly string[]).includes(v);
// Same control class as records text values (tab, newline and carriage return allowed), plus unpaired surrogates, which
// cannot be stored as UTF-8.
const control=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;

function freeze<T>(value:T):T{
 if(value!==null&&typeof value==='object'&&!Object.isFrozen(value)){for(const key of Object.keys(value))freeze((value as Record<string,unknown>)[key]);Object.freeze(value);}
 return value;
}
/** Plain-JSON snapshot: `canonicalJSON` refuses accessors, symbols, non-plain objects, `undefined`, non-finite numbers and
 * excess depth or size without invoking `toJSON` or getters, so everything after this sees inert data. */
function snapshot(value:unknown,maxBytes:number):unknown{
 try{return copyJSON(value,maxBytes);}catch(error){if(error instanceof SpecificationError)throw invalid();throw error;}
}
function exact(value:unknown,required:readonly string[],optional:readonly string[]=[]):Record<string,unknown>{
 if(!plain(value))throw invalid();
 const keys=Object.keys(value);
 if(!keys.every(k=>required.includes(k)||optional.includes(k))||!required.every(k=>Object.hasOwn(value,k)))throw invalid();
 return value;
}

/* ---- Civil dates: proleptic Gregorian `YYYY-MM-DD`, years 1-9999, no time of day and no timezone. ---- */
const datePattern=/^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
export const isLeapYear=(year:number)=>year%4===0&&(year%100!==0||year%400===0);
const monthDays=(year:number,month:number)=>month===2?(isLeapYear(year)?29:28):[4,6,9,11].includes(month)?30:31;
/** The date's parts, or null unless it is a real calendar date. Impossible dates (`2026-02-29`) are never rolled forward. */
export function parseCivilDate(value:unknown):{year:number;month:number;day:number}|null{
 if(typeof value!=='string')return null;
 const m=datePattern.exec(value);if(!m)return null;
 const year=Number(m[1]),month=Number(m[2]),day=Number(m[3]);
 return year>=1&&month>=1&&month<=12&&day>=1&&day<=monthDays(year,month)?{year,month,day}:null;
}
export const isCivilDate=(value:unknown):value is string=>parseCivilDate(value)!==null;
const pad=(n:number,width:number)=>String(n).padStart(width,'0');
/** Days since 1970-01-01 of a valid civil date (integer arithmetic only; no `Date`, so no zone or DST can enter). */
export function civilDayNumber(date:string):number{
 const parts=parseCivilDate(date);if(!parts)throw invalid();
 const y=parts.month<=2?parts.year-1:parts.year,era=Math.floor(y/400),yoe=y-era*400;
 const doy=Math.floor((153*(parts.month+(parts.month>2?-3:9))+2)/5)+parts.day-1;
 return era*146097+yoe*365+Math.floor(yoe/4)-Math.floor(yoe/100)+doy-719468;
}
/** The civil date `days` after (or before) `date`, or null outside years 1-9999. */
export function addCivilDays(date:string,days:number):string|null{
 if(!Number.isSafeInteger(days))throw invalid();
 const z=civilDayNumber(date)+days+719468,era=Math.floor(z/146097),doe=z-era*146097;
 const yoe=Math.floor((doe-Math.floor(doe/1460)+Math.floor(doe/36524)-Math.floor(doe/146096))/365);
 const doy=doe-(365*yoe+Math.floor(yoe/4)-Math.floor(yoe/100)),mp=Math.floor((5*doy+2)/153);
 const day=doy-Math.floor((153*mp+2)/5)+1,month=mp<10?mp+3:mp-9,year=yoe+era*400+(month<=2?1:0);
 return year>=1&&year<=9999?`${pad(year,4)}-${pad(month,2)}-${pad(day,2)}`:null;
}
/** Where a lead's due date falls against a caller-supplied reference date (never an implicit "today"). `won` and `lost`
 * leads are `inactive` and never overdue. `week` is tomorrow through six days ahead; `today` is separate. */
export function leadDueBucket(lead:{stage:LeadStage;dueOn:string|null},referenceDate:string):LeadDueBucket{
 if(!isCivilDate(referenceDate))throw invalid();
 if(lead.dueOn===null)return 'none';
 if(!(activeLeadStages as readonly string[]).includes(lead.stage))return 'inactive';
 const diff=civilDayNumber(lead.dueOn)-civilDayNumber(referenceDate);
 return diff<0?'overdue':diff===0?'today':diff<7?'week':'later';
}
export const isLeadOverdue=(lead:{stage:LeadStage;dueOn:string|null},referenceDate:string)=>leadDueBucket(lead,referenceDate)==='overdue';

/* ---- Notes: owner-authored private text, up to 20 per lead, 1,000 code points each, 16 KiB of canonical JSON in total. ---- */
/** A note's text exactly as submitted (no trimming or Unicode normalization), or `invalid_request`. */
export function leadNoteText(value:unknown):string{
 if(typeof value!=='string'||value.length>leadLimits.noteCodePoints*2||value.trim()===''||control.test(value))throw invalid();
 let points=0;for(const _ of value)points++;
 if(points>leadLimits.noteCodePoints)throw invalid();
 return value;
}
/** Canonical (sorted-key) JSON for storage; more than 16 KiB is `limited`. */
export function leadNotesJson(notes:readonly LeadNote[]):string{
 try{return canonicalJSON(notes,leadLimits.notesJsonBytes);}
 catch(error){if(error instanceof SpecificationError)throw new ModuleError('limited');throw error;}
}
function checkedNotes(value:unknown,updatedAt:number|null):LeadNote[]{
 if(!Array.isArray(value)||value.length>leadLimits.notes||value.length&&updatedAt===null)throw invalid();
 const seen=new Set<string>();
 const notes=value.map(item=>{
  const n=exact(item,['id','text','createdAt','updatedAt']);
  if(!uuid(n.id)||seen.has(n.id)||!seconds(n.createdAt)||!seconds(n.updatedAt)||n.updatedAt<n.createdAt||updatedAt!==null&&n.updatedAt>updatedAt)throw invalid();
  seen.add(n.id);
  return {id:n.id,text:leadNoteText(n.text),createdAt:n.createdAt,updatedAt:n.updatedAt};
 });
 try{canonicalJSON(notes,leadLimits.notesJsonBytes);}catch(error){if(error instanceof SpecificationError)throw invalid();throw error;}
 return notes;
}
/** Notes read back from storage. Only the exact canonical text this module writes is accepted; anything else means the
 * stored row is not a current one and is `unavailable`, not repaired. */
export function readLeadNotes(text:unknown):readonly LeadNote[]{
 const bad=()=>new ModuleError('unavailable');
 if(typeof text!=='string'||text.length>leadLimits.notesJsonBytes)throw bad();
 try{
  const parsed:unknown=JSON.parse(text);
  const notes=checkedNotes(parsed,Array.isArray(parsed)&&parsed.length?Number.MAX_SAFE_INTEGER:null);
  if(leadNotesJson(notes)!==text)throw bad();
  return freeze(notes);
 }catch{throw bad();}
}

/* ---- Lead state ---- */
/** A lead with no stored row: stage `new`, no due date, no notes, revision 0. */
export const emptyLeadState:LeadState=freeze({stage:'new',stageChangedAt:null,dueOn:null,notes:[],revision:0,updatedAt:null});
/** Strict validation of a state before it is trusted: exact keys, vocabulary, real dates, consistent timestamps. */
export function leadState(value:unknown):LeadState{
 const s=exact(snapshot(value,leadLimits.notesJsonBytes+leadLimits.requestJsonBytes),['stage','stageChangedAt','dueOn','notes','revision','updatedAt']);
 if(!stageOf(s.stage)||!Number.isSafeInteger(s.revision)||(s.revision as number)<0)throw invalid();
 const revision=s.revision as number;
 if(s.dueOn!==null&&!isCivilDate(s.dueOn))throw invalid();
 if(revision===0){
  if(s.stage!=='new'||s.stageChangedAt!==null||s.dueOn!==null||s.updatedAt!==null||!Array.isArray(s.notes)||s.notes.length)throw invalid();
  return emptyLeadState;
 }
 if(!seconds(s.updatedAt)||s.stageChangedAt!==null&&(!seconds(s.stageChangedAt)||s.stageChangedAt>s.updatedAt)||s.stageChangedAt===null&&s.stage!=='new')throw invalid();
 return freeze({stage:s.stage,stageChangedAt:s.stageChangedAt as number|null,dueOn:s.dueOn as string|null,notes:checkedNotes(s.notes,s.updatedAt),revision,updatedAt:s.updatedAt});
}

/* ---- Changes ---- */
/** `{changes:{stage?,dueOn?,note?}}`: at least one change, each at most once, nothing else. `dueOn: null` clears the date. */
export function parseLeadUpdate(input:unknown):{changes:LeadChanges}{
 const changes=exact(exact(snapshot(input,leadLimits.requestJsonBytes),['changes']).changes,[],['stage','dueOn','note']);
 const out:LeadChanges={};
 if(Object.keys(changes).length===0)throw invalid();
 if(Object.hasOwn(changes,'stage')){if(!stageOf(changes.stage))throw invalid();out.stage=changes.stage;}
 if(Object.hasOwn(changes,'dueOn')){if(changes.dueOn!==null&&!isCivilDate(changes.dueOn))throw invalid();out.dueOn=changes.dueOn as string|null;}
 if(Object.hasOwn(changes,'note')){
  const n=changes.note;
  if(!plain(n))throw invalid();
  if(n.op==='add'){exact(n,['op','text']);out.note={op:'add',text:leadNoteText(n.text)};}
  else if(n.op==='edit'){exact(n,['op','noteId','text']);if(!uuid(n.noteId))throw invalid();out.note={op:'edit',noteId:n.noteId,text:leadNoteText(n.text)};}
  else if(n.op==='remove'){exact(n,['op','noteId']);if(!uuid(n.noteId))throw invalid();out.note={op:'remove',noteId:n.noteId};}
  else throw invalid();
 }
 return freeze({changes:out});
}

export type LeadChangeResult={state:LeadState;mask:number;noteId:string|null};
/** One revision-checked change, applied to a copy. `expectedRevision` must equal the state's revision (`stale_configuration`
 * otherwise); a request that changes nothing is `invalid_request`, not a silent revision bump. `now` is epoch seconds and
 * never moves a timestamp backwards. `noteId` is the caller's fresh id for an `add` (a replayed request reuses its saved
 * id). The input state is never mutated and the result is deeply frozen. */
export function applyLeadChanges(stateInput:unknown,changesInput:unknown,context:{expectedRevision:number;now:number;noteId:string|null}):LeadChangeResult{
 const state=leadState(stateInput),{changes}=parseLeadUpdate({changes:changesInput});
 const c=exact(snapshot(context,256),['expectedRevision','now','noteId']);
 if(!Number.isSafeInteger(c.expectedRevision)||(c.expectedRevision as number)<0||!seconds(c.now)||c.noteId!==null&&!uuid(c.noteId))throw invalid();
 if(c.expectedRevision!==state.revision)throw new ModuleError('stale_configuration');
 if(state.revision>=Number.MAX_SAFE_INTEGER)throw new ModuleError('limited');
 const at=Math.max(c.now as number,state.updatedAt??0);
 let mask=0,stage=state.stage,stageChangedAt=state.stageChangedAt,dueOn=state.dueOn,notes=state.notes,noteId:string|null=null;
 if(changes.stage!==undefined&&changes.stage!==stage){stage=changes.stage;stageChangedAt=at;mask|=leadChangeBits.stage;}
 if(Object.hasOwn(changes,'dueOn')&&changes.dueOn!==dueOn){dueOn=changes.dueOn as string|null;mask|=leadChangeBits.dueOn;}
 const note=changes.note;
 if(note?.op==='add'){
  if(notes.length>=leadLimits.notes)throw new ModuleError('limited');
  if(c.noteId===null||notes.some(n=>n.id===c.noteId))throw invalid();
  noteId=c.noteId as string;notes=[...notes,{id:noteId,text:note.text,createdAt:at,updatedAt:at}];mask|=leadChangeBits.notes;
 }else if(note){
  const index=notes.findIndex(n=>n.id===note.noteId);
  if(index<0)throw new ModuleError('not_found');
  if(note.op==='remove'){notes=notes.filter((_,i)=>i!==index);mask|=leadChangeBits.notes;}
  else if(notes[index].text!==note.text){notes=notes.map((n,i)=>i===index?{...n,text:note.text,updatedAt:at}:n);mask|=leadChangeBits.notes;}
 }
 if(mask===0)throw invalid();
 if(mask&leadChangeBits.notes)leadNotesJson(notes);
 return freeze({state:{stage,stageChangedAt,dueOn,notes:notes.map(n=>({...n})),revision:state.revision+1,updatedAt:at},mask,noteId});
}

/* ---- Filters: only the decision-independent fields. Due-date buckets depend on a reference date and are separate. ---- */
/** `{stages?, hasNotes?, dueFrom?, dueTo?}` with absent keys meaning "no constraint". Stages are 1-5 distinct vocabulary
 * values; dates are real civil dates with `dueFrom <= dueTo`. The result is canonical (stages in vocabulary order). */
export function parseLeadFilter(input:unknown):LeadFilter{
 const f=exact(snapshot(input,leadLimits.requestJsonBytes),[],['stages','hasNotes','dueFrom','dueTo']);
 let stages:LeadStage[]|null=null;
 if(Object.hasOwn(f,'stages')){
  const list=f.stages;
  if(!Array.isArray(list)||list.length<1||list.length>leadLimits.filterStages||!list.every(stageOf)||new Set(list).size!==list.length)throw invalid();
  stages=leadStages.filter(s=>list.includes(s));
 }
 if(Object.hasOwn(f,'hasNotes')&&typeof f.hasNotes!=='boolean')throw invalid();
 for(const key of ['dueFrom','dueTo'])if(Object.hasOwn(f,key)&&!isCivilDate(f[key]))throw invalid();
 const dueFrom=(f.dueFrom??null) as string|null,dueTo=(f.dueTo??null) as string|null;
 if(dueFrom!==null&&dueTo!==null&&dueFrom>dueTo)throw invalid();
 return freeze({stages,hasNotes:(f.hasNotes??null) as boolean|null,dueFrom,dueTo});
}
/** Reference semantics for a parsed filter; a later SQL query must agree. Both date bounds are inclusive, regardless of
 * stage, and a lead with no due date never matches a date bound. */
export function matchesLeadFilter(lead:{stage:LeadStage;dueOn:string|null;notes:readonly unknown[]},filter:LeadFilter):boolean{
 if(filter.stages&&!filter.stages.includes(lead.stage))return false;
 if(filter.hasNotes!==null&&filter.hasNotes!==(lead.notes.length>0))return false;
 if(filter.dueFrom!==null&&(lead.dueOn===null||lead.dueOn<filter.dueFrom))return false;
 return filter.dueTo===null||lead.dueOn!==null&&lead.dueOn<=filter.dueTo;
}
