import {readInteractionCard} from './cards';
import {SpecificationError} from '../project-specification/v2/json';
import {readInteractionInput} from './input';
import {InteractionError,requireCurrentClient} from './protocol';
import {listInteractions,listInteractionResources,readInteraction,readInteractionReceipt,mutateInteraction,InteractionStoreError} from './store';
import {continueContentBrief,stopInteractionContinuation,reconcileContentBrief} from './continuation';
const prefix='/api/chat/interactions/';
const headers={'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','pragma':'no-cache','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
const respond=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers});
function exact(data:unknown,keys:string[]):asserts data is Record<string,unknown>{
 if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).length!==keys.length||keys.some(k=>!Object.hasOwn(data,k)))throw new InteractionError('SHAPE');
 if((data as Record<string,unknown>).version!==1)throw new InteractionError('VERSION');
}
function id(value:unknown):asserts value is string{if(typeof value!=='string'||!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(value))throw new InteractionError('ID');}
/** Index supplies same-origin, limited, welcome-complete current workspace authority. */
export async function handleInteractionRequest(request:Request,db:D1Database,user:string):Promise<Response|null>{
 const url=new URL(request.url);if(!url.pathname.startsWith(prefix))return null;
 try{
  if(!url.pathname.startsWith(prefix+'v1/'))throw new InteractionError('VERSION');
  if(request.method!=='POST'||url.search)throw new InteractionError('BODY');
  const data=await readInteractionInput(request),action=url.pathname.slice((prefix+'v1/').length);
  if(action==='list')return respond(await listInteractions(db,user,data));
  if(action==='card')return respond(await readInteractionCard(db,user,data));
  if(action==='resources')return respond(await listInteractionResources(db,user,data));
  if(action==='read'){
   exact(data,['version','interactionId','client']);id(data.interactionId);
   const interaction=await readInteraction(db,user,data.interactionId);await requireCurrentClient(interaction.envelope,data.client);return respond(interaction);
  }
  if(action==='receipt'){
   exact(data,['version','requestId']);id(data.requestId);return respond(await readInteractionReceipt(db,user,data.requestId));
  }
  if(action==='mutate')return respond(await mutateInteraction(db,user,data));
  if(action==='continue'||action==='stop'||action==='reconcile'){
   exact(data,action==='continue'?['version','submissionId','expectedChatRevision']:['version','submissionId']);id(data.submissionId);
   const result=action==='continue'?await continueContentBrief(db,user,data.submissionId,data.expectedChatRevision as number):action==='stop'?await stopInteractionContinuation(db,user,data.submissionId):await reconcileContentBrief(db,user,data.submissionId);
   return respond({version:1,submissionId:result.submission.id,continuation:result.submission.continuation});
  }
  return respond({error:'Chat interaction route not found.',code:'not_found'},404);
 }catch(error){
  if(error instanceof InteractionStoreError)return respond({error:error.message,code:error.code},error.status);
  if(error instanceof InteractionError){
   const update=['VERSION','CLIENT_UPDATE_REQUIRED'].includes(error.code),stale=['DIGEST','REFERENCE'].includes(error.code),status=update||stale?409:error.fieldId?422:400;
   return respond({error:update?'Update Whumpo to continue.':error.fieldId?'Check the highlighted answer.':'Read the current form and try again.',code:update?'client_update_required':error.code.toLowerCase(),...(error.fieldId?{fieldId:error.fieldId}:{})},status);
  }
  if(error instanceof SpecificationError)return respond({error:'A bounded current JSON request is required.',code:'invalid_request'},400);
  throw error;
 }
}
