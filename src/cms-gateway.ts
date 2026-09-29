import {cmsBridgeConfig,verifyCMSRequest,cmsRequestAllowed,CMSBridgeError} from './cms-bridge';
const reply=(status:number,message:string)=>Response.json({error:message},{status,headers:{'cache-control':'no-store'}});
// Reserved namespace in each isolated CMS database; never the platform account DB.
export async function cmsGateway(request:Request,env:Record<string,unknown>&{DB:D1Database},dispatch:(request:Request)=>Promise<Response>){
 try{
  const config=cmsBridgeConfig(env),verified=await verifyCMSRequest(request,config);
  if(!cmsRequestAllowed(request.method,verified.path,verified.body))return reply(403,'CMS operation not available');
  const headers=new Headers({'content-type':'application/json','origin':config.origin,'x-emdash-request':'1'});
  for(const name of ['x-whumpo-cms-id','x-whumpo-cms-expires','x-whumpo-cms-signature'])headers.set(name,request.headers.get(name)!);
  const internal=new Request(request.url,{method:request.method,headers,...(request.method==='POST'?{body:verified.body}:{})});
  if(request.method==='GET')return await dispatch(internal);
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS _whumpo_requests(id TEXT PRIMARY KEY,request_hash TEXT NOT NULL,status INTEGER,response TEXT,created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))").run();
  type Receipt={request_hash:string;status:number|null;response:string|null};
  const read=()=>env.DB.prepare('SELECT request_hash,status,response FROM _whumpo_requests WHERE id=?').bind(verified.id).first<Receipt>();
  const receipt=(row:Receipt)=>row.request_hash!==verified.requestHash?reply(409,'CMS request ID already used'):row.status===null?reply(409,'CMS outcome unknown; inspect the existing request receipt before preparing another request'):new Response(row.response,{status:row.status,headers:{'content-type':'application/json','cache-control':'no-store'}});
  const old=await read();if(old)return receipt(old);
  try{
   const reserved=await env.DB.prepare('INSERT INTO _whumpo_requests(id,request_hash) SELECT ?,? WHERE (SELECT count(*) FROM _whumpo_requests)<100').bind(verified.id,verified.requestHash).run();
   if(reserved.meta.changes!==1)return reply(429,'CMS write receipt storage is full');
  }catch{const found=await read();return found?receipt(found):reply(503,'CMS request reservation unavailable');}
  // Never replay uncertain writes. Only JSON, bounded responses are retained; never session cookies.
  try{
   const response=await dispatch(internal),reader=response.body?.getReader(),parts:Uint8Array[]=[];let length=0;
   if(!response.headers.get('content-type')?.startsWith('application/json')||!reader)return reply(502,'CMS response unavailable; inspect the existing request receipt');
   for(;;){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>65536){await reader.cancel();return reply(502,'CMS response exceeds its bound; inspect the existing request receipt');}parts.push(part.value);}
   const data=new Uint8Array(length);let offset=0;for(const part of parts){data.set(part,offset);offset+=part.length;}
   const text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(data);JSON.parse(text);
   await env.DB.prepare('UPDATE _whumpo_requests SET status=?,response=? WHERE id=? AND status IS NULL').bind(response.status,text,verified.id).run();
  }catch{/* Dispatch or acknowledgment failed. Retain the reservation and reconcile by read. */}
  const final=await read();return final?receipt(final):reply(503,'CMS receipt unavailable');
 }catch(error){return error instanceof CMSBridgeError?reply(error.status,error.message):reply(503,'CMS gateway unavailable');}
}
