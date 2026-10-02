import {contentFieldLimit} from './protocol';
import type {Answers} from './types';
import {canonicalJSON} from '../project-specification/v2/json';

type Request={kind:'interaction';operation:'requestContent';projectId:string;contentIds:string[]};
type Read={kind:'interaction';operation:'read';interactionId:string};
type Intake={kind:'interaction';operation:'requestProjectBrief'}|{kind:'interaction';operation:'requestProjectSelection'}|{kind:'interaction';operation:'requestWritingStyle'};
type SubmittedIntake={kind:'interaction';operation:'readSubmittedIntake';interactionId:string;taskId:string;submissionId:string};
type Replace={kind:'interaction';operation:'replaceContent';previousInteractionId:string;definitionDigest:string;expectedAnswerRevision:number;contentIds:string[]};
type ReplaceIntake={kind:'interaction';operation:'replaceProjectIntake';previousInteractionId:string;definitionDigest:string;expectedAnswerRevision:number};
type PhotoIntake={kind:'interaction';operation:'requestPhotoUpload';projectId:string};
type ProposeAnswers={kind:'interaction';operation:'proposeAnswers';previousInteractionId:string;definitionDigest:string;expectedAnswerRevision:number;changes:Answers};
export type InteractionAction=PhotoIntake|Request|Read|Replace|Intake|SubmittedIntake|ReplaceIntake|ProposeAnswers;
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
function answerChanges(value:unknown):boolean{
 try{
  const parsed:unknown=JSON.parse(canonicalJSON(value,16384));
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return false;
  const entries=Object.entries(parsed);
  return entries.length>0&&entries.length<=12&&entries.every(([id,v])=>/^[a-z][a-z0-9-]{0,39}$/.test(id)&&!['constructor','prototype','__proto__'].includes(id)&&(typeof v==='string'&&v.length<=2000||typeof v==='number'&&Number.isFinite(v)||typeof v==='boolean'||Array.isArray(v)&&v.length<=12&&v.every(x=>typeof x==='string'&&x.length<=2000)));
 }catch{return false;}
}
/** Maintained targets only. Proposed values are unapproved suggestions; the
 * domain validates them against saved fields before creating a new form. */
export function interactionActionRequest(value:unknown):value is InteractionAction{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const a=value as Record<string,unknown>;if(a.kind!=='interaction')return false;
 if(a.operation==='requestProjectBrief'||a.operation==='requestProjectSelection'||a.operation==='requestWritingStyle')return Object.keys(a).sort().join(',')==='kind,operation';
 if(a.operation==='requestPhotoUpload')return Object.keys(a).sort().join(',')==='kind,operation,projectId'&&uuid(a.projectId);
 if(a.operation==='readSubmittedIntake')return Object.keys(a).sort().join(',')==='interactionId,kind,operation,submissionId,taskId'&&uuid(a.interactionId)&&uuid(a.taskId)&&uuid(a.submissionId);
 if(a.operation==='read')return Object.keys(a).sort().join(',')==='interactionId,kind,operation'&&uuid(a.interactionId);
 if(a.operation==='proposeAnswers')return Object.keys(a).sort().join(',')==='changes,definitionDigest,expectedAnswerRevision,kind,operation,previousInteractionId'&&uuid(a.previousInteractionId)&&typeof a.definitionDigest==='string'&&/^[a-f0-9]{64}$/.test(a.definitionDigest)&&Number.isSafeInteger(a.expectedAnswerRevision)&&(a.expectedAnswerRevision as number)>=0&&answerChanges(a.changes);
 if(a.operation==='replaceProjectIntake')return Object.keys(a).sort().join(',')==='definitionDigest,expectedAnswerRevision,kind,operation,previousInteractionId'&&uuid(a.previousInteractionId)&&typeof a.definitionDigest==='string'&&/^[a-f0-9]{64}$/.test(a.definitionDigest)&&Number.isSafeInteger(a.expectedAnswerRevision)&&(a.expectedAnswerRevision as number)>=0;
 const ids=a.contentIds;
 if(!Array.isArray(ids)||!ids.length||ids.length>contentFieldLimit||new Set(ids).size!==ids.length||ids.some(v=>typeof v!=='string'||!/^[a-z][a-z0-9-]{0,39}$/.test(v)))return false;
 if(a.operation==='requestContent')return Object.keys(a).sort().join(',')==='contentIds,kind,operation,projectId'&&uuid(a.projectId);
 return a.operation==='replaceContent'&&Object.keys(a).sort().join(',')==='contentIds,definitionDigest,expectedAnswerRevision,kind,operation,previousInteractionId'&&uuid(a.previousInteractionId)&&typeof a.definitionDigest==='string'&&/^[a-f0-9]{64}$/.test(a.definitionDigest)&&Number.isSafeInteger(a.expectedAnswerRevision)&&(a.expectedAnswerRevision as number)>=0;
}
