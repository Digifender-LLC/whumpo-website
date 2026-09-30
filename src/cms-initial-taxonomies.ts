import {initialTaxonomies} from './cms-initial-taxonomy-shape';
import {initialTaxonomySchema} from './cms-native-schema.generated';
const reply=(status:number,message:string)=>Response.json({error:message},{status,headers:{'cache-control':'no-store'}});
/** Pinned native schema operation. Assignment rows, version advance and receipt commit together. */
export async function assignInitialTaxonomies(db:D1Database,id:string,hash:string,body:string){
 const intent=initialTaxonomies(JSON.parse(body));
 await db.batch(initialTaxonomySchema.map(sql=>db.prepare(sql)));
 type Receipt={request_hash:string;status:number|null;response:string|null};
 const read=()=>db.prepare('SELECT request_hash,status,response FROM _townhello_requests WHERE id=?').bind(id).first<Receipt>();
 const response=(row:Receipt)=>row.request_hash!==hash?reply(409,'CMS request ID already used'):row.status===null?reply(409,'This native receipt is unresolved'):new Response(row.response,{status:row.status,headers:{'content-type':'application/json','cache-control':'no-store'}});
 const old=await read();if(old)return response(old);
 const result=JSON.stringify({success:true,data:{itemId:intent.itemId,draftRequestId:intent.draftRequestId,terms:intent.terms,version:2}});
 try{
  const applied=await db.batch([
   db.prepare('INSERT INTO _townhello_requests(id,request_hash,status,response) SELECT ?,?,200,? WHERE (SELECT count(*) FROM _townhello_requests)<100').bind(id,hash,result),
   db.prepare('INSERT INTO _townhello_initial_taxonomies(id,draft_request_id,item_id,body) SELECT id,?,?,? FROM _townhello_requests WHERE id=? AND request_hash=?').bind(intent.draftRequestId,intent.itemId,body,id,hash),
  ]);
  if(applied[0].meta.changes!==1)return reply(429,'CMS write receipt storage is full');
 }catch{const saved=await read();return saved?response(saved):reply(409,'The draft or reviewed terms changed, or assignment is unavailable. No mapping was committed.');}
 const saved=await read();return saved?response(saved):reply(503,'CMS assignment receipt unavailable; retry this exact request');
}
