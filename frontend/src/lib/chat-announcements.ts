type Reply={id:string;status:string;assistant_text:string};

/** Initial history and identical polling snapshots are silent. */
export function updatedReplies(previous:readonly Reply[]|undefined,current:readonly Reply[]):string[]{
 if(!previous)return [];
 const seen=new Map(previous.map(reply=>[reply.id,reply]));
 return current.filter(reply=>{
  if(reply.status==='pending'||!reply.assistant_text.trim())return false;
  const old=seen.get(reply.id);
  return !old||old.status==='pending'||old.assistant_text!==reply.assistant_text;
 }).map(reply=>reply.id);
}
