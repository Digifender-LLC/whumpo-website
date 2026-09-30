/** Read-only historical transcript. Old text never recreates confirmation authority. */
export async function chatHistory(request:Request,db:D1Database,userId:string){
 const value=new URL(request.url).searchParams.get('before');
 if(!value||!/^[1-9][0-9]{0,15}$/.test(value)||!Number.isSafeInteger(Number(value)))return Response.json({error:'Choose a valid conversation position.'},{status:400});
 const {results}=await db.prepare('SELECT id,revision,user_text,assistant_text,created_at,status FROM chat_turns WHERE user_id=? AND revision<? ORDER BY revision DESC LIMIT 51').bind(userId,Number(value)).all<{id:string;revision:number;user_text:string;assistant_text:string;created_at:string;status:string}>();
 const turns=results.slice(0,50),nextBefore=results.length>50?turns[turns.length-1].revision:null;
 return Response.json({turns:turns.reverse(),nextBefore},{headers:{'cache-control':'no-store'}});
}
