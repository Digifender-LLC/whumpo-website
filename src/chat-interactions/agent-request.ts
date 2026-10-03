import {workspaceViewDefinition} from './view-definition';
import type {WorkspaceView} from '../workspace-view-contract';
import {purposes,informationDefinition,type InformationPurpose,type QuestionRequest} from './composition';
import {contentFieldLimit} from './protocol';
import type {Answers} from './types';
import {canonicalJSON} from '../project-specification/v2/json';

type Request={kind:'interaction';operation:'requestContent';projectId:string;contentIds:string[]};
type Read={kind:'interaction';operation:'read';interactionId:string};
type Intake={kind:'interaction';operation:'requestProjectBrief'}|{kind:'interaction';operation:'requestProjectSelection'}|{kind:'interaction';operation:'requestWritingStyle'};
type ResumeTask={kind:'interaction';operation:'resumeTask';taskId:string;projectId:string;submissionId:string};
type SubmittedAnswers={kind:'interaction';operation:'readSubmittedAnswers';interactionId:string;taskId:string;projectId:string|null;submissionId:string;fieldIds:string[]};
type RequestInformation={kind:'interaction';operation:'requestInformation';projectId:string;purpose:InformationPurpose;fields:QuestionRequest[]};
type ReplaceInformation={kind:'interaction';operation:'replaceInformation';previousInteractionId:string;definitionDigest:string;expectedAnswerRevision:number;fields:QuestionRequest[]};
type Replace={kind:'interaction';operation:'replaceContent';previousInteractionId:string;definitionDigest:string;expectedAnswerRevision:number;contentIds:string[]};
type ReplaceIntake={kind:'interaction';operation:'replaceProjectIntake';previousInteractionId:string;definitionDigest:string;expectedAnswerRevision:number};
type PhotoIntake={kind:'interaction';operation:'requestPhotoUpload';projectId:string};
type ProposeAnswers={kind:'interaction';operation:'proposeAnswers';previousInteractionId:string;definitionDigest:string;expectedAnswerRevision:number;changes:Answers};
type WorkspaceViewRequest={kind:'interaction';operation:'showView';view:WorkspaceView};
type ReplaceView={kind:'interaction';operation:'replaceView';previousInteractionId:string;definitionDigest:string;expectedAnswerRevision:number;view:WorkspaceView};
type ConnectionIntake={kind:'interaction';operation:'requestConnection';projectId:string|null;provider:'github'|'cloudflare'};
export type InteractionAction=ConnectionIntake|ReplaceView|WorkspaceViewRequest|ResumeTask|PhotoIntake|Request|Read|Replace|Intake|SubmittedAnswers|ReplaceIntake|ProposeAnswers|RequestInformation|ReplaceInformation;
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
function answerChanges(value:unknown):boolean{
 try{
  const parsed:unknown=JSON.parse(canonicalJSON(value,16384));
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return false;
  const entries=Object.entries(parsed);
  return entries.length>0&&entries.length<=12&&entries.every(([id,v])=>/^[a-z][a-z0-9-]{0,39}$/.test(id)&&!['constructor','prototype','__proto__'].includes(id)&&(typeof v==='string'&&v.length<=2000||typeof v==='number'&&Number.isFinite(v)||typeof v==='boolean'||Array.isArray(v)&&v.length<=12&&v.every(x=>typeof x==='string'&&x.length<=2000)));
 }catch{return false;}
}
/** Maintained targets and purpose-admitted question composition only. Proposed values are unapproved suggestions; the
 * domain validates them against saved fields before creating a new form. */
export function interactionActionRequest(value:unknown):value is InteractionAction{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const a=value as Record<string,unknown>;if(a.kind!=='interaction')return false;
 if(a.operation==='replaceView'){if(Object.keys(a).sort().join(',')!=='definitionDigest,expectedAnswerRevision,kind,operation,previousInteractionId,view'||!uuid(a.previousInteractionId)||typeof a.definitionDigest!=='string'||!/^[a-f0-9]{64}$/.test(a.definitionDigest)||!Number.isSafeInteger(a.expectedAnswerRevision)||Number(a.expectedAnswerRevision)<0)return false;try{workspaceViewDefinition(a.view);return true;}catch{return false;}}
 if(a.operation==='showView'){if(Object.keys(a).sort().join(',')!=='kind,operation,view')return false;try{workspaceViewDefinition(a.view);return true;}catch{return false;}}
 if(a.operation==='requestProjectBrief'||a.operation==='requestProjectSelection'||a.operation==='requestWritingStyle')return Object.keys(a).sort().join(',')==='kind,operation';
 if(a.operation==='resumeTask')return Object.keys(a).sort().join(',')==='kind,operation,projectId,submissionId,taskId'&&uuid(a.taskId)&&uuid(a.projectId)&&uuid(a.submissionId);
 if(a.operation==='requestConnection')return Object.keys(a).sort().join(',')==='kind,operation,projectId,provider'&&(a.projectId===null||uuid(a.projectId))&&(a.provider==='github'||a.provider==='cloudflare');
 if(a.operation==='requestPhotoUpload')return Object.keys(a).sort().join(',')==='kind,operation,projectId'&&uuid(a.projectId);
 if(a.operation==='readSubmittedAnswers')return Object.keys(a).sort().join(',')==='fieldIds,interactionId,kind,operation,projectId,submissionId,taskId'&&uuid(a.interactionId)&&uuid(a.taskId)&&(a.projectId===null||uuid(a.projectId))&&uuid(a.submissionId)&&Array.isArray(a.fieldIds)&&a.fieldIds.length>0&&a.fieldIds.length<=12&&new Set(a.fieldIds).size===a.fieldIds.length&&a.fieldIds.every(id=>typeof id==='string'&&/^[a-z][a-z0-9-]{0,39}$/.test(id));
 if(a.operation==='requestInformation'){
  if(Object.keys(a).sort().join(',')!=='fields,kind,operation,projectId,purpose'||!uuid(a.projectId))return false;
  try{informationDefinition(a.purpose,a.fields);return true;}catch{return false;}
 }
 if(a.operation==='replaceInformation'){
  if(Object.keys(a).sort().join(',')!=='definitionDigest,expectedAnswerRevision,fields,kind,operation,previousInteractionId'||!uuid(a.previousInteractionId)||typeof a.definitionDigest!=='string'||!/^[a-f0-9]{64}$/.test(a.definitionDigest)||!Number.isSafeInteger(a.expectedAnswerRevision)||(a.expectedAnswerRevision as number)<0)return false;
  // The domain obtains the immutable purpose from the owned predecessor.
  return Object.keys(purposes).some(p=>{try{informationDefinition(p,a.fields);return true;}catch{return false;}});
 }
 if(a.operation==='read')return Object.keys(a).sort().join(',')==='interactionId,kind,operation'&&uuid(a.interactionId);
 if(a.operation==='proposeAnswers')return Object.keys(a).sort().join(',')==='changes,definitionDigest,expectedAnswerRevision,kind,operation,previousInteractionId'&&uuid(a.previousInteractionId)&&typeof a.definitionDigest==='string'&&/^[a-f0-9]{64}$/.test(a.definitionDigest)&&Number.isSafeInteger(a.expectedAnswerRevision)&&(a.expectedAnswerRevision as number)>=0&&answerChanges(a.changes);
 if(a.operation==='replaceProjectIntake')return Object.keys(a).sort().join(',')==='definitionDigest,expectedAnswerRevision,kind,operation,previousInteractionId'&&uuid(a.previousInteractionId)&&typeof a.definitionDigest==='string'&&/^[a-f0-9]{64}$/.test(a.definitionDigest)&&Number.isSafeInteger(a.expectedAnswerRevision)&&(a.expectedAnswerRevision as number)>=0;
 const ids=a.contentIds;
 if(!Array.isArray(ids)||!ids.length||ids.length>contentFieldLimit||new Set(ids).size!==ids.length||ids.some(v=>typeof v!=='string'||!/^[a-z][a-z0-9-]{0,39}$/.test(v)))return false;
 if(a.operation==='requestContent')return Object.keys(a).sort().join(',')==='contentIds,kind,operation,projectId'&&uuid(a.projectId);
 return a.operation==='replaceContent'&&Object.keys(a).sort().join(',')==='contentIds,definitionDigest,expectedAnswerRevision,kind,operation,previousInteractionId'&&uuid(a.previousInteractionId)&&typeof a.definitionDigest==='string'&&/^[a-f0-9]{64}$/.test(a.definitionDigest)&&Number.isSafeInteger(a.expectedAnswerRevision)&&(a.expectedAnswerRevision as number)>=0;
}
