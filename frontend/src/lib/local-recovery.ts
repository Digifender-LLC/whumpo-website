import {readRecovery} from './chat-recovery';
import {readChatLocation,type ChatLocation} from './chat-location';
import {listFormRecovery} from './interaction-recovery';
import {listPhotoRecovery,type PhotoRecovery} from './photo-upload-recovery';
import {matchesChatRequest,type ChatRequest} from './chat-delivery';
import {matchesInteractionReceipt} from './interaction-delivery';
import {samePhotoUpload,type PhotoUploadStatus} from '../../../src/photo-upload-shape';
import type {InteractionReceipt,Mutation} from '../../../src/chat-interactions/types';
import type {Turn} from './api';

/** A read-only summary of this tab's existing validated recovery stores. It
 * keeps no copy: text, answers and photo bytes stay in their own stores, and
 * opening an item lets its current page resolve or retry it explicitly. */
export type LocalRecoveryItem=
 {key:string;kind:'chat-draft'}|
 {key:string;kind:'chat-request';request:ChatRequest}|
 {key:string;kind:'form-draft';interactionId:string}|
 {key:string;kind:'form-request';interactionId:string;request:Mutation}|
 {key:string;kind:'photo';upload:PhotoRecovery}|
 {key:string;kind:'location';target:ChatLocation};
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;

/** Each store applies its own owner, version, expiry and cleanup rules. */
export function readLocalRecovery(store:Store,owner:string,now=Date.now()):{items:LocalRecoveryItem[];failed:boolean}{
 const items:LocalRecoveryItem[]=[];let failed=false;
 const attempt=(read:()=>void)=>{try{read();}catch{failed=true;}};
 attempt(()=>{const chat=readRecovery(store,owner,now);if(chat?.pending)items.push({key:'chat-request:'+chat.pending.id,kind:'chat-request',request:chat.pending});if(chat?.draft.trim())items.push({key:'chat-draft',kind:'chat-draft'});});
 attempt(()=>{for(const form of listFormRecovery(store,owner,now))items.push(form.pending?{key:'form-request:'+form.interactionId,kind:'form-request',interactionId:form.interactionId,request:form.pending}:{key:'form-draft:'+form.interactionId,kind:'form-draft',interactionId:form.interactionId});});
 attempt(()=>{for(const upload of listPhotoRecovery(store,owner))items.push({key:'photo:'+upload.id,kind:'photo',upload});});
 attempt(()=>{const target=readChatLocation(store,owner,now);if(target)items.push({key:'location:'+target.kind+':'+target.id,kind:'location',target});});
 return {items,failed};
}
export const localRecoveryNeedsCheck=(item:LocalRecoveryItem)=>item.kind==='chat-request'||item.kind==='form-request'||item.kind==='photo';

export type LocalCheck=
 {state:'absent'}|{state:'confirmed';detail:'pending'|'completed'|'failed'|'uncertain'|'saved'|'approved'|'held'|'blocked'}|
 {state:'started'}|{state:'closed'}|{state:'different'}|{state:'collection'};
/** `read` returns null only for the server's "not found" reply. */
export async function checkChatRequest(request:ChatRequest,read:(id:string)=>Promise<Turn|null>):Promise<LocalCheck>{
 const turn=await read(request.id);if(!turn)return {state:'absent'};
 return matchesChatRequest(turn,request)?{state:'confirmed',detail:turn.status as 'pending'|'completed'|'failed'|'uncertain'}:{state:'different'};
}
export async function checkFormRequest(request:Mutation,read:(requestId:string)=>Promise<InteractionReceipt|null>):Promise<LocalCheck>{
 const receipt=await read(request.requestId);if(!receipt)return {state:'absent'};
 return await matchesInteractionReceipt(request,receipt)?{state:'confirmed',detail:'saved'}:{state:'different'};
}
export function checkPhotoUpload(upload:PhotoRecovery,status:PhotoUploadStatus):LocalCheck{
 if(status.closedHandoff)return upload.handoff&&status.closedHandoff.interactionId===upload.handoff.interactionId&&status.closedHandoff.definitionDigest===upload.handoff.definitionDigest?{state:'closed'}:{state:'different'};
 if(!status.photo)return {state:'absent'};
 if(!samePhotoUpload(upload,status.photo))return {state:'different'};
 if(status.photo.status!=='ready')return {state:'started'};
 if(upload.collection)return {state:'collection'};
 return {state:'confirmed',detail:status.photo.safetyStatus==='approved'?'approved':status.photo.safetyStatus==='blocked'?'blocked':'held'};
}

export type LocalCopy={title:string;label:string;detail:string};
export const localRecoveryLabels={unsaved:'Unsaved on this device',absent:'Not found on the server',confirmed:'Saved receipt confirmed'} as const;
const titles:Record<LocalRecoveryItem['kind'],string>={'chat-draft':'Unsent Chat message','chat-request':'Chat message sent from this tab','form-draft':'Form answers','form-request':'Form request sent from this tab',photo:'Photo upload from this tab',location:'Last opened Chat item'};
const confirmedDetail:Record<Extract<LocalCheck,{state:'confirmed'}>['detail'],string>={
 pending:'Whumpo saved this message and is still working on it. Open Chat to see the reply.',
 completed:'Whumpo saved this message. Open Chat to see it; this device record clears there.',
 failed:'Whumpo saved this message, but it did not finish. Open Chat to read what happened.',
 uncertain:'Whumpo saved this message but could not confirm its outcome. It will not be sent again automatically.',
 saved:'Whumpo saved this exact form request. Open the form to see its current state; this device record clears there.',
 approved:'Saved privately and approved by the current safety check. Open Photos to see it.',
 held:'Saved privately. It is held for safety checks and is not cleared for use.',
 blocked:'Saved privately, but it is not cleared for use.',
};
/** Three primary states stay distinct: device-only, missing server record, proven receipt. */
export function localRecoveryCopy(item:LocalRecoveryItem,check:LocalCheck|'checking'|'error'|null):LocalCopy{
 const title=item.kind==='photo'?titles.photo+': '+item.upload.name:titles[item.kind];
 if(item.kind==='chat-draft')return {title,label:localRecoveryLabels.unsaved,detail:'Text you typed in Chat has not been sent. It stays only in this browser tab and expires after a day without changes.'};
 if(item.kind==='form-draft')return {title,label:localRecoveryLabels.unsaved,detail:'Answers you changed in this form have not been saved to Whumpo. Unsent answers expire after seven days without changes.'};
 if(item.kind==='location')return {title,label:'Saved in this tab',detail:'A link back to the last saved message or form you opened. It is only a bookmark; opening it reads the current saved state.'};
 if(check==='checking'||check===null)return {title,label:'Checking the server…',detail:'This device has a request whose result is not confirmed yet.'};
 if(check==='error')return {title,label:'Could not check yet',detail:'This device still has the original request. Use Check saved work again. Nothing is sent again automatically.'};
 if(check.state==='confirmed')return {title,label:localRecoveryLabels.confirmed,detail:confirmedDetail[check.detail]};
 if(check.state==='absent')return {title,label:localRecoveryLabels.absent,detail:item.kind==='photo'?'No saved upload was found yet. That does not prove the earlier upload stopped. Retry in Photos uses the original upload ID and the original file.':'No saved record was found yet. That does not prove the request stopped. Opening it lets you retry the same request; nothing is sent automatically.'};
 if(check.state==='started')return {title,label:'Started, not confirmed',detail:'The upload started but did not finish. Retry the same photo in Photos to complete it.'};
 if(check.state==='collection')return {title,label:'Photo saved; collection needs checking',detail:'The photo is saved privately. Open Photos to check or finish the original collection request without uploading the image again.'};
 if(check.state==='closed')return {title,label:localRecoveryLabels.absent,detail:'The uploader closed before this upload was reserved, so it cannot start. Open Photos to clear this device record or choose a new photo.'};
 return {title,label:'Different saved record',detail:'The server has a different record for this request ID. Keep this tab open and open the item to review it before doing anything else.'};
}
export type LocalDestination={label:string}&({kind:'chat';search:{signup:false;interaction?:string;turn?:string}}|{kind:'photos';search:{project:string}});
/** Existing resume paths only. Opening never resends, uploads or approves. */
export function localRecoveryDestination(item:LocalRecoveryItem):LocalDestination{
 if(item.kind==='form-draft'||item.kind==='form-request')return {kind:'chat',label:'Open form in Chat',search:{signup:false,interaction:item.interactionId}};
 if(item.kind==='photo')return {kind:'photos',label:'Open Photos for this project',search:{project:item.upload.projectId}};
 if(item.kind==='location')return {kind:'chat',label:item.target.kind==='turn'?'Open message in Chat':'Open form in Chat',search:item.target.kind==='turn'?{signup:false,turn:item.target.id}:{signup:false,interaction:item.target.id}};
 return {kind:'chat',label:'Open Chat',search:{signup:false}};
}
