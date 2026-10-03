import type {Answer,Answers,Field} from '../../../src/chat-interactions/types';
import {isFieldVisible} from '../../../src/chat-interactions/protocol';

/** Number editing retains raw text locally, including unfinished input. Only
 * an explicit save/submission converts complete decimal text into a wire number. */
export function fieldAnswerSnapshot(fields:Field[],answers:Answers):Answers{
 const snapshot={...answers};
 for(const f of fields){
  // Keep the editor's hidden draft, but never send it. Unknown keys remain so
  // validation rejects them rather than silently accepting a malformed record.
  if(!isFieldVisible(f,answers)){delete snapshot[f.id];continue;}
  const value=snapshot[f.id];
  if(f.type==='number'&&typeof value==='string'&&/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())){
   const number=Number(value);if(Number.isFinite(number))snapshot[f.id]=number;
  }
 }
 return snapshot;
}
type Parts={year:number;month:number;day:number;hour:number;minute:number;second:number;millisecond:number};
const utc=(p:Parts)=>{const d=new Date(0);d.setUTCFullYear(p.year,p.month-1,p.day);d.setUTCHours(p.hour,p.minute,p.second,p.millisecond);return d.getTime();};
const pad=(n:number,length=2)=>String(n).padStart(length,'0');
const wall=(p:Parts)=>`${pad(p.year,4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}:${pad(p.second)}.${pad(p.millisecond,3)}`;
function formatter(zone:string){return new Intl.DateTimeFormat('en-US',{timeZone:zone,calendar:'gregory',numberingSystem:'latn',era:'short',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3,hourCycle:'h23'});}
function parts(format:Intl.DateTimeFormat,instant:number):Parts{
 const p=Object.fromEntries(format.formatToParts(new Date(instant)).map(p=>[p.type,p.value]));
 return {year:p.era==='BC'?1-Number(p.year):Number(p.year),month:Number(p.month),day:Number(p.day),hour:Number(p.hour),minute:Number(p.minute),second:Number(p.second),millisecond:Number(p.fractionalSecond)};
}
function parseWall(input:string):Parts|null{
 const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(input);if(!m)return null;
 const p={year:Number(m[1]),month:Number(m[2]),day:Number(m[3]),hour:Number(m[4]),minute:Number(m[5]),second:Number(m[6]??0),millisecond:Number((m[7]??'').padEnd(3,'0'))};
 if(p.year<1||p.year>9999||!Number.isFinite(utc(p))||new Date(utc(p)).toISOString()!==wall(p)+'Z')return null;
 return p;
}
export function dateTimeInput(value:Answer|undefined,zone:string):{date:string;time:string}{
 const raw=typeof value==='string'?value:'';
 const local=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(raw)&&Number.isFinite(Date.parse(raw))?wall(parts(formatter(zone),Date.parse(raw))):raw;
 const [date='',time='']=local.split('T');return {date,time};
}
function offsetLabel(milliseconds:number){
 const seconds=Math.abs(milliseconds)/1000,hours=Math.floor(seconds/3600),minutes=Math.floor(seconds%3600/60),remainder=Math.floor(seconds%60);
 return `UTC${milliseconds<0?'−':'+'}${pad(hours)}:${pad(minutes)}${remainder?':'+pad(remainder):''}`;
}
/** Enumerate matching instants instead of guessing through a clock gap/fold.
 * Offsets are sampled around the requested wall time and verified by round-trip. */
export function dateTimeCandidates(input:string,zone:string):{instant:string;offset:string}[]{
 const p=parseWall(input);if(!p)return [];
 const format=formatter(zone),nominal=utc(p),offsets=new Set<number>();
 for(let hours=-48;hours<=48;hours+=12){const sample=nominal+hours*3600000;offsets.add(utc(parts(format,sample))-sample);}
 return [...offsets].map(offset=>({instant:new Date(nominal-offset).toISOString(),offset:offsetLabel(offset)}))
  .filter(c=>/^\d{4}-/.test(c.instant)&&!c.instant.startsWith('0000-')&&wall(parts(format,Date.parse(c.instant)))===wall(p))
  .sort((a,b)=>a.instant.localeCompare(b.instant));
}
export function validWallTime(input:string){return parseWall(input)!==null;}
