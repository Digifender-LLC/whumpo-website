// WH-086 FCM HTTP v1 sender. A Google OAuth access token is minted from the send-only service-account JSON (RS256 JWT, Web Crypto) and the message is posted to
// the whumpo-18331 project. The transport is injected: tests use a fake one and a synthetic key; nothing here calls Google unless a caller passes `fetch`.
// The data payload is exactly {v,eventId,kind}: no project name, message text, source, photo or credential ever enters it.
export const fcmProjectId='whumpo-18331';
export const fcmSendUrl=`https://fcm.googleapis.com/v1/projects/${fcmProjectId}/messages:send`;
const tokenUrl='https://oauth2.googleapis.com/token',scope='https://www.googleapis.com/auth/firebase.messaging',timeoutMs=10000;
export type PushTransport=(url:string,init:RequestInit)=>Promise<Response>;
export type PushMessage={token:string;eventId:string;kind:'review_pending'|'operation_completed'|'attention_required'};
/** accepted: FCM took it (not a display or delivery receipt). invalid-token: the registration is dead, withdraw it. retry: refused for certain, try later. uncertain: no answer, never blind-redispatch. */
/** config-error (SENDER_ID_MISMATCH) and payload-error (any other 400) are permanent: never retried, and never a reason to withdraw the registration. */
export type PushOutcome={result:'accepted'|'invalid-token'|'config-error'|'payload-error'|'retry'|'uncertain';status?:number};
export interface PushSender{send(message:PushMessage):Promise<PushOutcome>}
const encoder=new TextEncoder();
const b64url=(bytes:Uint8Array|string)=>btoa(String.fromCharCode(...(typeof bytes==='string'?encoder.encode(bytes):bytes))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
type Account={client_email:string;private_key:string;project_id:string};
function account(json:string):Account{
 let a:Record<string,unknown>|null;
 try{a=JSON.parse(json);}catch{throw Error('push_credential');}
 if(!a||typeof a!=='object'||typeof a.client_email!=='string'||typeof a.private_key!=='string'||a.project_id!==fcmProjectId||!a.private_key.includes('BEGIN PRIVATE KEY'))throw Error('push_credential');
 return a as Account;
}
async function signingKey(pem:string){
 const der=Uint8Array.from(atob(pem.replace(/-----[A-Z ]+-----/g,'').replace(/\s+/g,'')),c=>c.charCodeAt(0));
 return crypto.subtle.importKey('pkcs8',der,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
}
/** The FCM v1 error code (details[].errorCode, else error.status) and message; empty when the body is not the documented shape. */
async function errorOf(response:Response){
 try{
  const e=(await response.json() as {error?:{status?:unknown;message?:unknown;details?:{errorCode?:unknown}[]}}).error;
  const detail=e?.details?.find(d=>typeof d?.errorCode==='string')?.errorCode,code=typeof detail==='string'?detail:typeof e?.status==='string'?e.status:'';
  return {code,message:typeof e?.message==='string'?e.message:''};
 }catch{return {code:'',message:''};}
}
export function fcmSender(serviceAccountJson:string,transport:PushTransport,now:()=>number=()=>Date.now()):PushSender{
 const sa=account(serviceAccountJson);
 let cached:{value:string;until:number}|null=null;
 const init=(body:BodyInit,headers:Record<string,string>):RequestInit=>({method:'POST',headers,body,signal:AbortSignal.timeout(timeoutMs)});
 async function accessToken(){
  if(cached&&cached.until>now())return cached.value;
  const iat=Math.floor(now()/1000),head=b64url(JSON.stringify({alg:'RS256',typ:'JWT'})),claims=b64url(JSON.stringify({iss:sa.client_email,scope,aud:tokenUrl,iat,exp:iat+3600}));
  const signature=await crypto.subtle.sign('RSASSA-PKCS1-v1_5',await signingKey(sa.private_key),encoder.encode(`${head}.${claims}`));
  const response=await transport(tokenUrl,init(new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${head}.${claims}.${b64url(new Uint8Array(signature))}`}),{'content-type':'application/x-www-form-urlencoded'}));
  if(!response.ok)throw Error('push_credential');
  const data=await response.json() as {access_token?:unknown;expires_in?:unknown};
  if(typeof data.access_token!=='string'||!data.access_token)throw Error('push_credential');
  cached={value:data.access_token,until:now()+Math.max(60,Math.min(Number(data.expires_in)||3600,3600)-60)*1000};
  return cached.value;
 }
 return {async send(m){
  let bearer:string;
  try{bearer=await accessToken();}catch{return {result:'retry'};} // no message was sent, so a retry is safe
  const body=JSON.stringify({message:{token:m.token,data:{v:'1',eventId:m.eventId,kind:m.kind},android:{priority:m.kind==='review_pending'?'HIGH':'NORMAL',ttl:'86400s'}}});
  let response:Response;
  try{response=await transport(fcmSendUrl,init(body,{authorization:`Bearer ${bearer}`,'content-type':'application/json; charset=UTF-8'}));}
  catch{return {result:'uncertain'};} // the request may have reached FCM
  if(response.ok)return {result:'accepted',status:response.status};
  if(response.status===401)cached=null;
  // Classify by the FCM error code, not the HTTP status. 429/5xx/401/403 are refusals before acceptance and are retried.
  const {code,message}=await errorOf(response);
  if(code==='UNREGISTERED'||code==='NOT_FOUND'||(response.status===404&&!code))return {result:'invalid-token',status:response.status};
  if(code==='SENDER_ID_MISMATCH')return {result:'config-error',status:response.status};
  if(code==='INVALID_ARGUMENT'||response.status===400)return {result:/registration token/i.test(message)&&code==='INVALID_ARGUMENT'?'invalid-token':'payload-error',status:response.status};
  return {result:'retry',status:response.status};
 }};
}
