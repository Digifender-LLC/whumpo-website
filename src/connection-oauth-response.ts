export type OAuthProvider='github'|'cloudflare';
export type OAuthSettlement={state:'rejected'|'revoked';reason:string;httpStatus:number};
type TokenResponse={kind:'token';data:Record<string,unknown>}|{kind:'rejected';settlement:OAuthSettlement};
const errors={
 github:['incorrect_client_credentials','redirect_uri_mismatch','bad_verification_code','unverified_user_email'],
 cloudflare:['invalid_request','invalid_client','invalid_grant','unauthorized_client','unsupported_grant_type','invalid_scope'],
};
const unavailable=()=>new Error('OAuth token response could not be classified.');

// JSON.parse accepts duplicate names by discarding earlier values. A discarded
// refresh credential would escape custody. Scan top-level keys after syntax
// validation; quoted content and nested values cannot masquerade as field names.
function uniqueResponseFields(text:string){
 const names=new Set<string>();let depth=0;
 for(let i=0;i<text.length;i++){
  const c=text[i];
  if(c==='{'||c==='['){depth++;continue;}
  if(c==='}'||c===']'){depth--;continue;}
  if(c!=='"')continue;
  const start=i++;
  while(i<text.length&&text[i]!=='"'){if(text[i]==='\\')i++;i++;}
  let next=i+1;while(/\s/.test(text[next]??'')&&next<text.length)next++;
  if(depth===1&&text[next]===':'){
   const name:string=JSON.parse(text.slice(start,i+1));if(names.has(name))throw unavailable();names.add(name);
  }
 }
}

// A denial has only string fields. Parse each pair so duplicate/escaped names,
// credentials mixed with errors, and unknown fields cannot be hidden by JSON.parse.
function denialFields(text:string){
 const fields:Record<string,string>=Object.create(null);
 const pair=/\s*("(?:[^"\\]|\\.)*")\s*:\s*("(?:[^"\\]|\\.)*")\s*/y;
 const source=text.trim();if(!source.startsWith('{')||!source.endsWith('}'))throw unavailable();
 let offset=1;
 for(;;){
  pair.lastIndex=offset;const match=pair.exec(source);if(!match)throw unavailable();
  const key:string=JSON.parse(match[1]),value:string=JSON.parse(match[2]);
  if(!['error','error_description','error_uri'].includes(key)||Object.hasOwn(fields,key))throw unavailable();
  fields[key]=value;offset=pair.lastIndex;
  if(offset===source.length-1)break;
  if(source[offset]!==',')throw unavailable();offset++;
 }
 return fields;
}

/** The response must come directly from the one admitted token dispatch. This
 * classifier never accepts a callback query, persisted client value or retry as
 * evidence that an earlier, unknown exchange did not issue a credential. */
export async function readOAuthTokenResponse(provider:OAuthProvider,response:Response):Promise<TokenResponse>{
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,timer:ReturnType<typeof setTimeout>|undefined;
 const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{void reader?.cancel().catch(()=>{});reject(unavailable());},10000);});
 try{
  if(response.redirected||!response.body||!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??''))throw unavailable();
  reader=response.body.getReader();
  const text=await Promise.race([timeout,(async()=>{
   const chunks:Uint8Array[]=[];let length=0;
   for(;;){const part=await reader!.read();if(part.done)break;length+=part.value.length;if(length>16384)throw unavailable();chunks.push(part.value);}
   const bytes=new Uint8Array(length);let offset=0;for(const part of chunks){bytes.set(part,offset);offset+=part.length;}
   return new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes);
  })()]);
  const data:unknown=JSON.parse(text);
  if(!data||typeof data!=='object'||Array.isArray(data))throw unavailable();
  uniqueResponseFields(text);
  if(Object.hasOwn(data,'error')){
   const fields=denialFields(text),reason=fields.error;
   // GitHub documents its JSON error envelope; Cloudflare uses the RFC 6749
   // token endpoint contract. Status alone (especially 429/5xx) settles nothing.
   const statusAllowed=provider==='github'?response.status===200||response.status===400:
    response.status===400||response.status===401&&reason==='invalid_client';
   if(!statusAllowed||!errors[provider].includes(reason))throw unavailable();
   return {kind:'rejected',settlement:{state:'rejected',reason,httpStatus:response.status}};
  }
  if(response.status!==200)throw unavailable();
  return {kind:'token',data:data as Record<string,unknown>};
 }catch{throw unavailable();}
 finally{clearTimeout(timer);if(reader){void reader.cancel().catch(()=>{});}else{void response.body?.cancel().catch(()=>{});}}
}
