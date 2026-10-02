import {interactionHistory} from './chat-interactions/history';
/** Read-only historical transcript. Old text never recreates confirmation authority. */
export async function chatHistory(request:Request,db:D1Database,userId:string){
 const params=new URL(request.url).searchParams,value=params.get('before'),query=(params.get('q')??'').trim();
 if(query.length>100||/[\x00-\x1f\x7f]/.test(query))return Response.json({error:'Search with up to 100 characters of plain text.'},{status:400});
 if(!value||!/^[1-9][0-9]{0,15}$/.test(value)||!Number.isSafeInteger(Number(value)))return Response.json({error:'Choose a valid conversation position.'},{status:400});
 const {results}=await db.prepare('SELECT id,revision,user_text,assistant_text,created_at,status,mode FROM chat_turns WHERE user_id=? AND revision<? AND (?=\'\' OR instr(lower(user_text),lower(?))>0 OR instr(lower(assistant_text),lower(?))>0) ORDER BY revision DESC LIMIT 51').bind(userId,Number(value),query,query,query).all<{id:string;revision:number;user_text:string;assistant_text:string;created_at:string;status:string;mode:string}>();
 const turns=results.slice(0,50),nextBefore=results.length>50?turns[turns.length-1].revision:null;
 const interactions=await interactionHistory(db,userId,turns.map(t=>t.id));
 return Response.json({turns:turns.reverse().map(t=>({...t,...(interactions.has(t.id)?{interaction:interactions.get(t.id)}:{})})),nextBefore},{headers:{'cache-control':'no-store'}});
}
