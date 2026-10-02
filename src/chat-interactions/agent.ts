import {BackendError} from '../backend-versions';
import {FeatureInclusionError} from '../feature-inclusion';
import {InteractionError} from './protocol';
import {interactionActionRequest} from './agent-request';
import {InteractionStoreError,prepareContentBrief,prepareReplacementContentBrief,readInteraction} from './store';

export const interactionAgentActions=`Owner Chat information requests (not visitor forms): prefer a conversational question for one simple missing detail. For several website text pieces, offer the smallest useful maintained form, after reading the current specification for real content IDs. No custom forms or model-authored questions are available.
- {"kind":"interaction","operation":"requestContent","projectId":ID,"contentIds":[CONTENT_ID]} offers 1–8 existing website text fields. Whumpo supplies labels, limits and current saved defaults. Creating or rendering the form does not submit answers, call another model, save a website or publish.
- {"kind":"interaction","operation":"read","interactionId":ID} reads owned current metadata (digest, answer revision, task/project, field IDs/content mapping and continuation status) with at most one lookup follow-up. Draft/default/answer values are not supplied to the model. Use current Chat form references from workspace context. If absent or ambiguous, ask which form the user means.
- {"kind":"interaction","operation":"replaceContent","previousInteractionId":ID,"definitionDigest":DIGEST,"expectedAnswerRevision":N,"contentIds":[CONTENT_ID]} proposes a corrected set of fields on the same project/task after reading the current form. Retain unrequested content IDs. The server carries forward explicit user answers by content ID and derives any other defaults from the current website. It cannot edit answers from prose, switch projects or replace pending/unknown work. Ask the user to enter changed text in the form. Never request credentials, invent fields/bindings, or send answers, defaults, URLs or approval controls in these actions. Submission, continuation, private save and publication each use their own existing controls; no agent action can confirm them.`;

export async function interactionAgentAction(db:D1Database,userId:string,turnId:string,input:unknown){
 const statements=[] as D1PreparedStatement[];
 if(!interactionActionRequest(input))return {reply:'That form request could not be accepted. Ask for a maintained website text form using the current website fields.',statements};
 try{
  if(input.operation==='read'){
   const saved=await readInteraction(db,userId,input.interactionId),e=saved.envelope;
   if(e.definition.template!=='content-change@1')throw new InteractionStoreError(409,'adapter_unavailable');
   // Explicit provider projection: never spread a read, field, default or submission.
   const metadata={version:1,interactionId:e.id,projectId:e.scope.projectId,taskId:e.scope.taskId,template:e.definition.template,
    definitionDigest:e.definitionDigest,answerRevision:saved.answerRevision,state:saved.state,
    previousInteractionId:saved.previousInteractionId,replacementInteractionId:saved.replacementInteractionId,
    fields:e.definition.fields.map(f=>({id:f.id,label:f.label,contentId:f.source!.contentId,revision:f.source!.revision})),
    continuation:saved.submission?.continuation?{state:saved.submission.continuation.state,resultTurnId:saved.submission.continuation.resultTurnId}:null};
   return {reply:`The website text form is ${saved.state}. It has ${metadata.fields.length} fields. Open its Chat card to review your answers.`,inspection:JSON.stringify({type:'chat_interaction_metadata',data:metadata}),statements};
  }
  const prepared=input.operation==='requestContent'
   ?await prepareContentBrief(db,userId,{originTurnId:turnId,projectId:input.projectId,contentIds:input.contentIds})
   :await prepareReplacementContentBrief(db,userId,{originTurnId:turnId,previousInteractionId:input.previousInteractionId,definitionDigest:input.definitionDigest,expectedAnswerRevision:input.expectedAnswerRevision,contentIds:input.contentIds});
  return {reply:input.operation==='requestContent'?'Review the website text in this form. Your answers can prepare a private preview; saving and publishing each need a separate review.':'I’ve prepared a replacement form for the same project, carrying forward your saved answers where the fields match. Review it before preparing a private preview. Nothing has been saved to your website or published.',statements:prepared.statements};
 }catch(error){
  if(error instanceof InteractionStoreError||error instanceof FeatureInclusionError||error instanceof BackendError)return {reply:error.message,statements};
  if(error instanceof InteractionError)return {reply:'Those fields are not available for this website text form. Read the current website and choose up to eight of its text fields.',statements};
  throw error;
 }
}
