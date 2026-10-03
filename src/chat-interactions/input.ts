import {bounds,InteractionError} from './protocol';

/** Read the current JSON transport without first materializing an unbounded body. */
export async function readInteractionInput(request:Request):Promise<unknown>{
 const type=request.headers.get('content-type')??'';
 if(!/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(type))throw new InteractionError('CONTENT_TYPE');
 const length=request.headers.get('content-length');
 if(length!==null&&(!/^\d+$/.test(length)||!Number.isSafeInteger(Number(length))))throw new InteractionError('BODY');
 if(length!==null&&Number(length)>bounds.requestBytes){void request.body?.cancel().catch(()=>{});throw new InteractionError('BYTES');}
 const reader=request.body?.getReader();if(!reader)throw new InteractionError('BODY');
 const bytes=new Uint8Array(bounds.requestBytes);let size=0;
 try{
  while(true){
   const chunk=await reader.read();if(chunk.done)break;
   if(chunk.value.byteLength>bounds.requestBytes-size)throw new InteractionError('BYTES');
   bytes.set(chunk.value,size);size+=chunk.value.byteLength;
  }
 }catch(error){
  if(error instanceof InteractionError)throw error;
  throw new InteractionError('BODY');
 }finally{
  // A hostile stream's cancellation hook must not hold a rejected request open.
  void reader.cancel().catch(()=>{});reader.releaseLock();
 }
 if(length!==null&&Number(length)!==size)throw new InteractionError('BODY');
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes.subarray(0,size))) as unknown;}
 catch{throw new InteractionError('BODY');}
}
