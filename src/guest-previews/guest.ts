import {savedVersionHTML,type SavedVersionRow} from '../photo-versions';
import {StorageLimitError} from '../storage-budget';
import {guestPreviewOrigin} from '../hosts';
import {GuestPreviewError,guestPreviewLimits as limits,guestTokenHash,sha256Hex,guestInclusion,guestLinkCurrent} from './policy';

/** WH-092 anonymous guest boundary, served only by the sites Worker on the fixed preview host.
 * A guest presents the bearer token in a POST body (never a URL path or query), so it is not
 * in request logs, Referer headers or caches. No workspace session, cookie or account is read
 * or created; responses are no-store/noindex. Guest text is stored as inert plain text and is
 * never forwarded to Chat, a model, a notification or any other processor. */
type Env={DB:D1Database;FILES:R2Bucket};
type Link={id:string;owner_user_id:string;project_id:string};
const robots='noindex, nofollow, noarchive, nosnippet';
const common={'cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-robots-tag':robots,
 'permissions-policy':'camera=(), microphone=(), geolocation=()','cross-origin-resource-policy':'same-origin'};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...common,'content-type':'application/json; charset=utf-8'}});
const unavailable=()=>json({error:'This preview link is unavailable.'},404);
// The exact owner preview policy, except that the sandboxed document may be framed by the
// guest page on the same preview origin. It still runs no script and has an opaque origin.
const frameHeaders={...common,'content-type':'text/html; charset=utf-8','x-frame-options':'SAMEORIGIN','cross-origin-opener-policy':'same-origin',
 'content-security-policy':"sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'"};
const frameMessage=(status:number,message:string)=>new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Preview unavailable</title><p style="font:16px/1.5 system-ui,sans-serif;padding:24px">${message}</p></html>`,{status,headers:frameHeaders});

async function bounded(request:Request,max:number){
 if(Number(request.headers.get('content-length')??0)>max||!request.body)return null;
 const reader=request.body.getReader(),chunks:Uint8Array[]=[];let length=0;
 while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>max){await reader.cancel();return null;}chunks.push(value);}
 const bytes=new Uint8Array(length);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:false}).decode(bytes);}catch{return null;}
}
async function jsonBody(request:Request){
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))return null;
 const text=await bounded(request,8192);if(text===null)return null;
 try{const value:unknown=JSON.parse(text);return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:null;}catch{return null;}
}
async function findLink(db:D1Database,token:unknown){
 const hash=await guestTokenHash(token);if(!hash)return null;
 const link=await db.prepare('SELECT id,owner_user_id,project_id FROM guest_preview_links WHERE token_hash=?').bind(hash).first<Link>();
 return link?{...link,hash}:null;
}
/** Exact current capability: same token hash, current link/version/hold state, no operator serving stop and the owner's
 * current feature inclusion for that project, evaluated together in one statement. */
function current(link:Link&{hash:string},t='guest_preview_links'){
 const included=guestInclusion(link.owner_user_id,link.project_id);
 return {sql:`${t}.id=? AND ${t}.token_hash=? AND ${guestLinkCurrent(t)} AND NOT EXISTS(SELECT 1 FROM operator_serving_stopped WHERE project_id=${t}.project_id) AND ${included.sql}`,params:[link.id,link.hash,...included.params]};
}
async function stillCurrent(db:D1Database,link:Link&{hash:string}){
 const gate=current(link,'l');
 return !!await db.prepare(`SELECT 1 FROM guest_preview_links l WHERE ${gate.sql}`).bind(...gate.params).first();
}
/** Atomically admit one view within the per-link window; null means unavailable or busy. */
async function admitView(db:D1Database,link:Link&{hash:string}){
 const window=Math.floor(Date.now()/1000/limits.windowSeconds),gate=current(link);
 return db.prepare(`UPDATE guest_preview_links SET rate_window=?,rate_views=CASE WHEN rate_window=? THEN rate_views+1 ELSE 1 END
  WHERE ${gate.sql} AND (rate_window!=? OR rate_views<?) RETURNING version_id,expires_at,feedback_enabled`)
  .bind(window,window,...gate.params,window,limits.viewsPerWindow).first<{version_id:string;expires_at:number;feedback_enabled:number}>();
}
async function busy(db:D1Database,link:Link&{hash:string}){
 const window=Math.floor(Date.now()/1000/limits.windowSeconds),gate=current(link,'l');
 return !!await db.prepare(`SELECT 1 FROM guest_preview_links l WHERE ${gate.sql} AND l.rate_window=? AND l.rate_views>=?`).bind(...gate.params,window,limits.viewsPerWindow).first();
}

async function linkStatus(request:Request,env:Env){
 const data=await jsonBody(request);
 if(!data||Object.keys(data).join()!=='token')return json({error:'Use the exact preview link.'},400);
 const link=await findLink(env.DB,data.token);if(!link)return unavailable();
 const gate=current(link,'l');
 const row=await env.DB.prepare(`SELECT l.expires_at,l.feedback_enabled FROM guest_preview_links l WHERE ${gate.sql}`).bind(...gate.params).first<{expires_at:number;feedback_enabled:number}>();
 if(!row)return unavailable();
 return json({version:1,expiresAt:row.expires_at,feedback:row.feedback_enabled===1});
}
async function view(request:Request,env:Env){
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/x-www-form-urlencoded'))return frameMessage(400,'Open this preview from its link.');
 const text=await bounded(request,512),form=text===null?null:new URLSearchParams(text);
 if(!form||[...form.keys()].join()!=='token')return frameMessage(400,'Open this preview from its link.');
 const link=await findLink(env.DB,form.get('token'));if(!link)return frameMessage(404,'This preview link is unavailable.');
 const admitted=await admitView(env.DB,link);
 if(!admitted)return await busy(env.DB,link)?frameMessage(429,'This preview is busy. Please try again in a few minutes.'):frameMessage(404,'This preview link is unavailable.');
 const row=await env.DB.prepare('SELECT v.id,v.html,v.component_id,v.config_json FROM site_versions v WHERE v.id=? AND v.project_id=?').bind(admitted.version_id,link.project_id).first<SavedVersionRow>();
 if(!row)return frameMessage(404,'This preview link is unavailable.');
 let html:string;
 try{html=await savedVersionHTML(env,row);}
 catch(error){return error instanceof StorageLimitError?frameMessage(503,'This preview is temporarily unavailable.'):frameMessage(404,'This preview link is unavailable.');}
 // Revocation, expiry, removal, a hold or lost inclusion during rendering wins over the read.
 if(!await stillCurrent(env.DB,link))return frameMessage(404,'This preview link is unavailable.');
 return new Response(html,{headers:frameHeaders});
}
function feedbackInput(data:Record<string,unknown>|null){
 const allowed=['token','requestId','name','text'];
 if(!data||Object.keys(data).some(k=>!allowed.includes(k))||!['token','requestId','text'].every(k=>Object.hasOwn(data,k)))throw new GuestPreviewError(400,'Write a comment to send.');
 const name=data.name??'',text=data.text;
 if(typeof data.requestId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(data.requestId))throw new GuestPreviewError(400,'Reload the page and try again.');
 if(typeof name!=='string'||typeof text!=='string')throw new GuestPreviewError(400,'Write a comment to send.');
 // Plain text only: no control characters except line breaks/tabs in the comment.
 const cleanName=name.normalize('NFC').trim(),cleanText=text.normalize('NFC').replace(/\r\n?/g,'\n').trim();
 if(cleanName.length>limits.nameLength||/[\u0000-\u001f\u007f]/.test(cleanName))throw new GuestPreviewError(400,`Use a single-line name of at most ${limits.nameLength} characters.`);
 if(!cleanText||cleanText.length>limits.textLength||/[\u0000-\u0008\u000b-\u001f\u007f]/.test(cleanText))throw new GuestPreviewError(400,`Write a comment of 1 to ${limits.textLength} characters.`);
 return {requestId:data.requestId,name:cleanName,text:cleanText};
}
async function feedback(request:Request,env:Env){
 const data=await jsonBody(request);let input;
 try{input=feedbackInput(data);}catch(error){return json({error:(error as Error).message},400);}
 const link=await findLink(env.DB,data!.token);if(!link)return unavailable();
 const requestHash=await sha256Hex(JSON.stringify(['guest-feedback@1',input.name,input.text]));
 const receipt=async()=>{
  const row=await env.DB.prepare('SELECT id,request_hash,created_at FROM guest_preview_feedback WHERE link_id=? AND request_id=?').bind(link.id,input.requestId).first<{id:string;request_hash:string;created_at:number}>();
  if(!row)return null;
  if(row.request_hash!==requestHash)return json({error:'This comment request was already used for different text. Reload and try again.'},409);
  return json({version:1,id:row.id,createdAt:row.created_at});
 };
 const gate=current(link,'l');
 // A replay is answered only while the link is still current; revocation stops it too.
 if(!await env.DB.prepare(`SELECT 1 FROM guest_preview_links l WHERE ${gate.sql} AND l.feedback_enabled=1`).bind(...gate.params).first())return unavailable();
 const replay=await receipt();if(replay)return replay;
 try{
  await env.DB.prepare(`INSERT INTO guest_preview_feedback(id,link_id,request_id,request_hash,display_name,body,created_at)
   SELECT ?,l.id,?,?,?,?,unixepoch() FROM guest_preview_links l WHERE ${gate.sql} AND l.feedback_enabled=1
   ON CONFLICT(link_id,request_id) DO NOTHING`).bind(crypto.randomUUID(),input.requestId,requestHash,input.name,input.text,...gate.params).run();
 }catch(error){
  const text=String(error);
  if(text.includes('guest_feedback_rate'))return json({error:'Too many comments right now. Please wait a few minutes and try again.'},429);
  if(text.includes('guest_preview_capacity'))return json({error:'This preview is not accepting more comments.'},429);
  if(text.includes('guest_preview_unavailable'))return unavailable();
  throw error;
 }
 return await receipt()??unavailable();
}

// Static platform source. No link, owner, project or guest value is ever interpolated.
export const guestShellScript=`(()=>{const token=location.hash.slice(1),status=document.getElementById('status'),frame=document.getElementById('preview'),form=document.getElementById('feedback'),note=document.getElementById('feedback-status'),expiry=document.getElementById('expiry'),button=document.getElementById('send');const off=m=>{status.textContent=m;frame.hidden=true;form.hidden=true;};const gone='This preview link is unavailable. It may have expired or been turned off by its owner.';if(!/^[A-Za-z0-9_-]{43}$/.test(token)){off(gone);return;}const post=(path,data)=>fetch(path,{method:'POST',headers:{'content-type':'application/json'},credentials:'omit',cache:'no-store',redirect:'error',body:JSON.stringify(data)});let requestId=crypto.randomUUID();(async()=>{let link;try{const r=await post('api/link',{token});if(r.status===429){off('This preview is busy. Please try again in a few minutes.');return;}if(!r.ok){off(gone);return;}link=await r.json();}catch{off('The preview could not be reached. Check your connection and reload.');return;}expiry.textContent='Available until '+new Date(link.expiresAt*1000).toLocaleString()+'.';const opener=document.createElement('form');opener.method='post';opener.action='view';opener.target='preview';opener.hidden=true;const input=document.createElement('input');input.type='hidden';input.name='token';input.value=token;opener.append(input);document.body.append(opener);frame.hidden=false;opener.submit();status.textContent='';form.hidden=!link.feedback;})();for(const field of form.querySelectorAll('input,textarea'))field.addEventListener('input',()=>{requestId=crypto.randomUUID();});form.addEventListener('submit',async event=>{event.preventDefault();if(button.disabled||!form.reportValidity())return;button.disabled=true;note.textContent='Sending…';try{const r=await post('api/feedback',{token,requestId,name:document.getElementById('guest-name').value,text:document.getElementById('guest-comment').value});if(r.ok){requestId=crypto.randomUUID();document.getElementById('guest-comment').value='';note.textContent='Thank you. Your comment was sent to the owner.';}else note.textContent=r.status===429?'Too many comments right now. Please wait a few minutes and try again.':r.status===404?'This preview link no longer accepts comments.':'Your comment could not be sent. Please check it and try again.';}catch{note.textContent='Your comment could not be sent. Check your connection and try again.';}finally{button.disabled=false;}});})();`;
export const guestShellStyle=`:root{color-scheme:light dark;--ink:#1f2a24;--paper:#f7f8f4;--line:#c9d0c6;--accent:#2f5d46}@media (prefers-color-scheme:dark){:root{--ink:#e8ece6;--paper:#151a17;--line:#3b463f;--accent:#9cc8ad}}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:1rem/1.5 system-ui,sans-serif}main{max-width:1100px;margin:0 auto;padding:16px}h1{font-size:1.25rem;margin:0 0 4px}h2{font-size:1.1rem;margin:0}p{margin:0 0 12px}iframe{display:block;width:100%;height:70vh;min-height:420px;border:1px solid var(--line);border-radius:12px;background:#fff}form{margin-top:20px;display:grid;gap:12px;max-width:640px}label{display:grid;gap:4px;font-weight:600}input,textarea{font:inherit;color:inherit;background:transparent;border:1px solid var(--line);border-radius:8px;padding:10px;width:100%}textarea{min-height:120px;resize:vertical}button{justify-self:start;min-height:44px;padding:10px 18px;font:inherit;font-weight:600;border:0;border-radius:10px;background:var(--accent);color:var(--paper);cursor:pointer}button:disabled{opacity:.6}:focus-visible{outline:3px solid var(--accent);outline-offset:2px}.hint{font-weight:400;font-size:.9rem}[hidden]{display:none!important}`;
const shellHTML=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="${robots}"><meta name="referrer" content="same-origin"><title>Private website preview</title><style>${guestShellStyle}</style></head><body><main><h1>Private website preview</h1><p id="expiry">Shared privately by its owner. This link expires and can be turned off at any time.</p><p id="status" role="status" aria-live="polite">Opening preview…</p><iframe id="preview" name="preview" title="Website preview" sandbox="" hidden></iframe><form id="feedback" hidden><h2>Send a comment to the owner</h2><p class="hint">No account is needed. Comments are plain text and go only to the owner of this preview.</p><label for="guest-name">Your name <span class="hint">(optional, not verified)</span><input id="guest-name" name="displayName" maxlength="${limits.nameLength}" autocomplete="name"></label><label for="guest-comment">Comment<textarea id="guest-comment" name="comment" maxlength="${limits.textLength}" required></textarea></label><button id="send" type="submit">Send comment</button><p id="feedback-status" role="status" aria-live="polite"></p></form></main><script>${guestShellScript}</script></body></html>`;
async function sourceHash(source:string){const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source)));return "'sha256-"+btoa(String.fromCharCode(...bytes))+"'";}
async function shell(request:Request){
 const csp=`default-src 'none'; script-src ${await sourceHash(guestShellScript)}; style-src ${await sourceHash(guestShellStyle)}; connect-src 'self'; form-action 'self'; frame-src 'self'; img-src 'none'; base-uri 'none'; frame-ancestors 'none'`;
 // same-origin (not no-referrer): browsers send Origin: null on a no-referrer form navigation,
 // and /view requires the exact guest origin. Fragments are never sent in Referer.
 return new Response(request.method==='HEAD'?null:shellHTML,{headers:{...common,'referrer-policy':'same-origin','content-type':'text/html; charset=utf-8','x-frame-options':'DENY','cross-origin-opener-policy':'same-origin','content-security-policy':csp}});
}

/** Route one request already identified as the guest preview host (or the local prefix). */
export async function guestPreviewRequest(request:Request,env:Env,local:boolean):Promise<Response>{
 const url=new URL(request.url),base=local?'/guest-preview':'',path=url.pathname.slice(base.length)||'/';
 if(local&&url.pathname===base)return new Response(null,{status:308,headers:{...common,location:base+'/'}});
 if(url.search)return json({error:'Use the exact preview link.'},400);
 if(path==='/'){
  if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method not allowed',{status:405,headers:{...common,allow:'GET, HEAD'}});
  return shell(request);
 }
 if(!['/view','/api/link','/api/feedback'].includes(path))return json({error:'Not found'},404);
 if(request.method!=='POST')return new Response('Method not allowed',{status:405,headers:{...common,allow:'POST'}});
 if(request.headers.get('origin')!==(local?url.origin:guestPreviewOrigin))return json({error:'Origin check failed'},403);
 try{
  if(path==='/view')return await view(request,env);
  if(path==='/api/link')return await linkStatus(request,env);
  return await feedback(request,env);
 }catch{
  // Never log or echo the request: it carries the bearer token and guest text.
  return path==='/view'?frameMessage(503,'This preview is temporarily unavailable.'):json({error:'This preview is temporarily unavailable.'},503);
 }
}
