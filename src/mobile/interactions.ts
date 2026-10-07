import type {AIConfig} from '../ai';
import {BillingError} from '../billing';
import {SpecificationError} from '../project-specification/v2/json';
import {InteractionError,requireCurrentClient} from '../chat-interactions/protocol';
import {listInteractions,listInteractionResources,readInteraction,readInteractionReceipt,mutateInteraction,InteractionStoreError} from '../chat-interactions/store';
import {continueContentBrief,stopInteractionContinuation,reconcileContentBrief} from '../chat-interactions/continuation';
import {continueInformationTask,stopInformationTask,reconcileInformationTask} from '../chat-interactions/model-continuation';
import type {ConnectionReadOptions} from '../chat-interactions/connection-results';
import {MobileError,minimumBuild,mobileResponse,versioned,type MobileClient} from './protocol';

async function admittedForm(db:D1Database,user:string,id:unknown,client:MobileClient,env:Env){
 if(typeof id!=='string')throw new MobileError('invalid_request');
 const form=await readInteraction(db,user,id);
 if(form.envelope.definition.kind!=='form'||form.envelope.definition.cards.length)throw new MobileError('client_update_required',{minimumBuild:minimumBuild(env),contract:1,next:'update_app'});
 await requireCurrentClient(form.envelope,client.interaction);return form;
}
/** Explicit information-only form adapters. No definition, view or dispatch is accepted from the client. */
export async function nativeInteraction(action:string,input:unknown,db:D1Database,user:string,client:MobileClient,env:Env,ai:AIConfig|undefined,transport:typeof fetch,connections:ConnectionReadOptions){
 try{
  if(action==='list')return mobileResponse(await listInteractions(db,user,input));
  if(action==='receipt'){const d=versioned(input,['requestId'],env);if(typeof d.requestId!=='string')throw new MobileError('invalid_request');return mobileResponse(await readInteractionReceipt(db,user,d.requestId));}
  if(action==='read'){
   const d=versioned(input,['interactionId','client'],env);
   // The header is the one capability declaration for the entire request.
   if(JSON.stringify(d.client)!==JSON.stringify(client.interaction))throw new MobileError('invalid_request');
   return mobileResponse(await admittedForm(db,user,d.interactionId,client,env));
  }
  if(action==='mutate'){
   if(!input||typeof input!=='object'||Array.isArray(input))throw new MobileError('invalid_request');
   const d=input as Record<string,unknown>;
   // A committed request can be read back even after cancel erased its envelope.
   // Shared mutate compares the exact canonical request digest before returning a receipt.
   const prior=typeof d.requestId==='string'?await db.prepare('SELECT 1 FROM chat_interaction_requests WHERE user_id=? AND request_id=?').bind(user,d.requestId).first():null;
   if(!prior)await admittedForm(db,user,d.interactionId,client,env);
   return mobileResponse(await mutateInteraction(db,user,input));
  }
  if(action==='resources'){
   const d=versioned(input,['interactionId','definitionDigest','fieldId','limit','before'],env);await admittedForm(db,user,d.interactionId,client,env);
   return mobileResponse(await listInteractionResources(db,user,input));
  }
  const d=versioned(input,action==='continue'?['submissionId','expectedChatRevision']:['submissionId'],env);
  if(typeof d.submissionId!=='string')throw new MobileError('invalid_request');
  const source=await db.prepare('SELECT interaction_id FROM chat_interaction_submissions WHERE id=? AND user_id=?').bind(d.submissionId,user).first<{interaction_id:string}>();
  if(!source)throw new MobileError('not_found');
  const form=await admittedForm(db,user,source.interaction_id,client,env),model=form.envelope.definition.continuationBinding==='agent.task-continue@1';
  const result=model?(action==='continue'?await continueInformationTask(db,user,d.submissionId,d.expectedChatRevision as number,ai,transport,connections):action==='stop'?await stopInformationTask(db,user,d.submissionId):await reconcileInformationTask(db,user,d.submissionId,true)):action==='continue'?await continueContentBrief(db,user,d.submissionId,d.expectedChatRevision as number):action==='stop'?await stopInteractionContinuation(db,user,d.submissionId):await reconcileContentBrief(db,user,d.submissionId);
  return mobileResponse({submissionId:result.submission.id,continuation:result.submission.continuation});
 }catch(error){
  // WH-105 codes and field identity are preserved; domain/provider exception text is never serialized.
  if(error instanceof InteractionError){
   if(['VERSION','CLIENT_UPDATE_REQUIRED'].includes(error.code))throw new MobileError('client_update_required',{minimumBuild:minimumBuild(env),contract:1,next:'update_app'});
   const status=['DIGEST','REFERENCE'].includes(error.code)?409:error.fieldId?422:400;
   return mobileResponse({error:{code:error.code.toLowerCase(),message:error.fieldId?'Check the highlighted answer.':'Read the current form and try again.',...(error.fieldId?{fieldId:error.fieldId}:{})}},status);
  }
  if(error instanceof InteractionStoreError)return mobileResponse({error:{code:error.code,message:'Read the current form or saved request receipt before continuing.'}},error.status);
  if(error instanceof SpecificationError)throw new MobileError('invalid_request');
  if(error instanceof BillingError)return mobileResponse({error:{code:'continuation_unavailable',message:'This continuation is unavailable. Read the saved result before trying again.'}},error.status);
  throw error;
 }
}
