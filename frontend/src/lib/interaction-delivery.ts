import {jsonDigest} from '../../../src/project-specification/v2/json';
import type {InteractionReceipt,Mutation} from '../../../src/chat-interactions/types';
import {canRecoverChat} from './chat-delivery';

export async function matchesInteractionReceipt(request:Mutation,receipt:InteractionReceipt){
 return receipt.version===1&&receipt.requestId===request.requestId&&receipt.interactionId===request.interactionId&&receipt.operation===request.operation&&receipt.answerRevision===request.expectedAnswerRevision+1&&receipt.requestDigest===await jsonDigest(request,32768);
}
export async function recoverInteraction(request:Mutation,read:(id:string)=>Promise<InteractionReceipt>){
 const receipt=await read(request.requestId);if(!await matchesInteractionReceipt(request,receipt))throw Error('The saved receipt does not match this exact request. Keep this tab open and check again.');return receipt;
}
/** A lost reply permits readback only; explicit retries reuse the exact request. */
export async function deliverInteraction(request:Mutation,post:(r:Mutation)=>Promise<InteractionReceipt>,read:(id:string)=>Promise<InteractionReceipt>){
 try{const receipt=await post(request);if(!await matchesInteractionReceipt(request,receipt))throw Error('Unconfirmed form receipt');return receipt;}
 catch(error){if(canRecoverChat(error)){try{return await recoverInteraction(request,read);}catch{/* Keep the exact unresolved operation. */}}throw error;}
}
