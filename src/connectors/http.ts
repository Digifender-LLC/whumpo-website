import {prepareConnectorLookup,confirmConnectorLookup,executeConnectorLookup,readConnectorLookup,cancelConnectorLookup,ConnectorLookupError,type ConnectorLookupOptions} from './lookups';
const prefix='/api/connectors/lookups/v1/';
const headers={'content-type':'application/json; charset=utf-8','cache-control':'private, no-store','pragma':'no-cache','x-content-type-options':'nosniff','referrer-policy':'no-referrer'};
const respond=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers});
/** Index supplies authenticated scoped workspace, same-origin writes and request rate limits. */
export async function handleConnectorLookupRequest(request:Request,db:D1Database,user:string,options:ConnectorLookupOptions):Promise<Response|null>{
 const url=new URL(request.url);if(!url.pathname.startsWith('/api/connectors/lookups/'))return null;
 if(!url.pathname.startsWith(prefix)||url.search)throw new ConnectorLookupError(400,'invalid_lookup');
 const action=url.pathname.slice(prefix.length);
 if(/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(action)){
  if(request.method==='GET')return respond(await readConnectorLookup(db,user,action));
  if(request.method==='DELETE')return respond(await cancelConnectorLookup(db,user,action));
 }
 if(request.method!=='POST')return respond({error:'Method not allowed'},405);
 // Stream-bound input. No URL query parameters, query logging, persisted content or automatic retries.
 if(!/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/i.test(request.headers.get('content-type')??''))throw new ConnectorLookupError(415,'invalid_lookup');
 const declared=request.headers.get('content-length');
 if(declared!==null&&(!/^\d+$/.test(declared)||!Number.isSafeInteger(Number(declared))))throw new ConnectorLookupError(400,'invalid_lookup');
 if(declared!==null&&Number(declared)>12288){void request.body?.cancel().catch(()=>{});throw new ConnectorLookupError(413,'invalid_lookup');}
 const reader=request.body?.getReader();if(!reader)throw new ConnectorLookupError(400,'invalid_lookup');
 const chunks:Uint8Array[]=[];let length=0;
 try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>12288)throw new ConnectorLookupError(413,'invalid_lookup');chunks.push(value);}}catch(error){if(error instanceof ConnectorLookupError)throw error;throw new ConnectorLookupError(400,'invalid_lookup');}finally{void reader.cancel().catch(()=>{});reader.releaseLock();}
 if(declared!==null&&Number(declared)!==length)throw new ConnectorLookupError(400,'invalid_lookup');
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 let value:unknown;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes));}catch{throw new ConnectorLookupError(400,'invalid_lookup');}
 if(action==='prepare')return respond(await prepareConnectorLookup(db,user,value,options));
 if(action==='execute')return respond(await executeConnectorLookup(db,user,value,options));
 if(action==='confirm'){
  const v=value as Record<string,unknown>;
  if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!=='paramsDigest,request')throw new ConnectorLookupError(400,'invalid_lookup');
  return respond(await confirmConnectorLookup(db,user,v.request,v.paramsDigest,options));
 }
 return respond({error:'Lookup route not found'},404);
}
