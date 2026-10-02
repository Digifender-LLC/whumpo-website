import {interactionHistory} from './chat-interactions/history';
export const transcriptRequests=['/export-chat','export my chat','download my chat','download my chat history','export my conversation'];
export const transcriptReply='Your saved Chat messages and replies are ready to download below as a JSON file. This includes information you shared in Chat, including private review conversations. The download reads your current saved history; it does not include project files or account credentials stored elsewhere. No AI call or credit charge is needed.';
export const isTranscriptRequest=(content:string)=>transcriptRequests.includes(content.trim().toLowerCase());
type TranscriptTurn={id:string;revision:number;user_text:string;assistant_text:string;created_at:string;status:string};
/** Owner-authenticated endpoint. Bounded pages keep the full transcript out of model context and memory. */
export async function exportChatTranscript(request:Request,db:D1Database,userId:string){
 if(new URL(request.url).search)return Response.json({error:'Chat download does not accept filters.'},{status:400,headers:{'cache-control':'no-store'}});
 const upper=(await db.prepare('SELECT coalesce(max(revision),0) revision FROM chat_turns WHERE user_id=?').bind(userId).first<{revision:number}>())?.revision??0;
 const encoder=new TextEncoder();let after=0,first=true,cancelled=false;
 const stream=new ReadableStream<Uint8Array>({
  start(controller){controller.enqueue(encoder.encode(JSON.stringify({format:'whumpo-chat-v2',generatedAt:new Date().toISOString(),throughRevision:upper}).slice(0,-1)+',"turns":['));},
  async pull(controller){
   try{
    const {results}=await db.prepare('SELECT id,revision,user_text,assistant_text,created_at,status FROM chat_turns WHERE user_id=? AND revision>? AND revision<=? ORDER BY revision LIMIT 50').bind(userId,after,upper).all<TranscriptTurn>();
    const interactions=await interactionHistory(db,userId,results.map(t=>t.id));
    if(cancelled)return;
    if(results.length){controller.enqueue(encoder.encode((first?'':',')+results.map(t=>JSON.stringify({id:t.id,revision:t.revision,user_text:t.user_text,assistant_text:t.assistant_text,created_at:t.created_at,status:t.status,...(interactions.has(t.id)?{interaction:interactions.get(t.id)}:{})})).join(',')));first=false;after=results[results.length-1].revision;}
    if(results.length<50){controller.enqueue(encoder.encode('],"complete":true}'));controller.close();}
   }catch{if(!cancelled)controller.error(new Error('Chat download interrupted. Request a fresh download.'));}
  },
  cancel(){cancelled=true;},
 });
 return new Response(stream,{headers:{'content-type':'application/json; charset=utf-8','content-disposition':'attachment; filename="whumpo-chat.json"','cache-control':'private, no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox",'referrer-policy':'no-referrer'}});
}
