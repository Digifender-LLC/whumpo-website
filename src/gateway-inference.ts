import {captureGatewayReceipt} from './gateway-provider-receipt';
import {completeGateway,validateGatewayConfig,type GatewayConfig} from './ai-gateway';
import {type ChatMessage,type Completion} from './ai';
import {GatewaySpendError,dispatchGatewaySpend,settleGatewaySpend,uncertainGatewaySpend} from './gateway-spend';
import {type planInferenceRoute} from './inference-routing';
type Selection=NonNullable<ReturnType<typeof planInferenceRoute>['selected']>;
type Stored={snapshot:string;status:string;request_hash:string|null;result_json:string|null};
export type GatewayInputCounter=(model:string,protocol:'chat'|'responses',messages:ChatMessage[])=>number;
async function read(db:D1Database,owner:string,id:string){return db.prepare('SELECT a.snapshot,a.status,r.request_hash,r.result_json FROM gateway_spend_attempts a LEFT JOIN gateway_inference_requests r ON r.attempt_id=a.id WHERE a.id=? AND a.user_id=?').bind(id,owner).first<Stored>();}
async function digest(value:unknown){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value))))].map(byte=>byte.toString(16).padStart(2,'0')).join('');}

/** Server-only. Counter must be approved for the exact model/protocol; not a client estimate. */
export async function runGatewayInference(db:D1Database,owner:string,id:string,settings:GatewayConfig,input:ChatMessage[],countInput:GatewayInputCounter,transport?:typeof fetch){
 // Capture caller data before any await; concurrent mutations cannot change what was reviewed.
 const config={...settings},messages=structuredClone(input);
 validateGatewayConfig(config);
 if(!Array.isArray(messages)||!messages.length||messages.length>50||messages.some(message=>!message||!['system','user','assistant'].includes(message.role)||typeof message.content!=='string'||message.content.length>16000))throw new GatewaySpendError(400,'Invalid inference messages');
 const row=await read(db,owner,id);if(!row)throw new GatewaySpendError(404,'Inference reservation not found');
 const selected=JSON.parse(row.snapshot) as Selection;
 if(config.model!==selected.model||config.protocol!==selected.protocol||config.maxOutputTokens!==selected.outputBound||(selected.host==='workers-ai')!==config.model.startsWith('@cf/'))throw new GatewaySpendError(409,'Inference route does not match its reservation');
 const inputBound=countInput(config.model,config.protocol,structuredClone(messages));
 if(!Number.isSafeInteger(inputBound)||inputBound<1||inputBound>selected.inputBound)throw new GatewaySpendError(409,'Inference input exceeds its reservation');
 const requestHash=await digest({accountId:config.accountId,gatewayId:config.gatewayId,model:config.model,protocol:config.protocol,outputBound:config.maxOutputTokens,timeoutMs:config.timeoutMs??60000,inputBound,messages});
 if(!row.request_hash){
  if(row.status!=='reserved')throw new GatewaySpendError(409,'Inference attempt cannot be dispatched');
  try{await db.prepare('INSERT INTO gateway_inference_requests(attempt_id,request_hash) VALUES(?,?)').bind(id,requestHash).run();}catch{
   // A concurrent identical request or a lost insert response may already own the record.
   const saved=await read(db,owner,id);if(saved?.request_hash!==requestHash)throw new GatewaySpendError(409,'Inference request could not be recorded');
  }
 }
 const saved=await read(db,owner,id);
 if(saved?.request_hash!==requestHash)throw new GatewaySpendError(409,'Inference attempt already has a different request');
 async function finish(result:Completion,replayed:boolean){
  const costs=await settleGatewaySpend(db,owner,id,result.inputTokens,result.outputTokens);
  return {status:'settled' as const,result,costs,replayed};
 }
 if(saved.result_json)return finish(JSON.parse(saved.result_json) as Completion,true);
 if(saved.status!=='reserved')return {status:saved.status,replayed:true};
 // This atomic claim is the only path to provider dispatch. No retries after a lost claim response.
 if(!await dispatchGatewaySpend(db,owner,id))return {status:(await read(db,owner,id))?.status??'uncertain',replayed:true};
 try{
  const result=await completeGateway(config,messages,async (url,request)=>{
   const response=await (transport??globalThis.fetch.bind(globalThis))(url,request);
   try{await captureGatewayReceipt(db,owner,id,config,response);}catch(error){await response.body?.cancel();throw error;}
   return response;
  });
  await db.prepare('UPDATE gateway_inference_requests SET result_json=? WHERE attempt_id=? AND request_hash=? AND result_json IS NULL').bind(JSON.stringify(result),id,requestHash).run();
  return await finish(result,false);
 }catch{
  // Even a provider rejection may have incurred work. Keep holds until usage is reconciled.
  await uncertainGatewaySpend(db,owner,id);
  return {status:'uncertain',replayed:false};
 }
}
