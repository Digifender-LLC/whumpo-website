import {contentFieldLimit} from './protocol';

type Request={kind:'interaction';operation:'requestContent';projectId:string;contentIds:string[]};
type Read={kind:'interaction';operation:'read';interactionId:string};
type Intake={kind:'interaction';operation:'requestProjectBrief'}|{kind:'interaction';operation:'requestProjectSelection'};
type SubmittedIntake={kind:'interaction';operation:'readSubmittedIntake';interactionId:string;taskId:string;submissionId:string};
type Replace={kind:'interaction';operation:'replaceContent';previousInteractionId:string;definitionDigest:string;expectedAnswerRevision:number;contentIds:string[]};
type ReplaceIntake={kind:'interaction';operation:'replaceProjectIntake';previousInteractionId:string;definitionDigest:string;expectedAnswerRevision:number};
export type InteractionAction=Request|Read|Replace|Intake|SubmittedIntake|ReplaceIntake;
const uuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
/** The agent chooses maintained targets only; it cannot write questions, answers or effects. */
export function interactionActionRequest(value:unknown):value is InteractionAction{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const a=value as Record<string,unknown>;if(a.kind!=='interaction')return false;
 if(a.operation==='requestProjectBrief'||a.operation==='requestProjectSelection')return Object.keys(a).sort().join(',')==='kind,operation';
 if(a.operation==='readSubmittedIntake')return Object.keys(a).sort().join(',')==='interactionId,kind,operation,submissionId,taskId'&&uuid(a.interactionId)&&uuid(a.taskId)&&uuid(a.submissionId);
 if(a.operation==='read')return Object.keys(a).sort().join(',')==='interactionId,kind,operation'&&uuid(a.interactionId);
 if(a.operation==='replaceProjectIntake')return Object.keys(a).sort().join(',')==='definitionDigest,expectedAnswerRevision,kind,operation,previousInteractionId'&&uuid(a.previousInteractionId)&&typeof a.definitionDigest==='string'&&/^[a-f0-9]{64}$/.test(a.definitionDigest)&&Number.isSafeInteger(a.expectedAnswerRevision)&&(a.expectedAnswerRevision as number)>=0;
 const ids=a.contentIds;
 if(!Array.isArray(ids)||!ids.length||ids.length>contentFieldLimit||new Set(ids).size!==ids.length||ids.some(v=>typeof v!=='string'||!/^[a-z][a-z0-9-]{0,39}$/.test(v)))return false;
 if(a.operation==='requestContent')return Object.keys(a).sort().join(',')==='contentIds,kind,operation,projectId'&&uuid(a.projectId);
 return a.operation==='replaceContent'&&Object.keys(a).sort().join(',')==='contentIds,definitionDigest,expectedAnswerRevision,kind,operation,previousInteractionId'&&uuid(a.previousInteractionId)&&typeof a.definitionDigest==='string'&&/^[a-f0-9]{64}$/.test(a.definitionDigest)&&Number.isSafeInteger(a.expectedAnswerRevision)&&(a.expectedAnswerRevision as number)>=0;
}
