import {activeContact,saveContact,ContactError} from './contacts';
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const headers={'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY','content-security-policy':"default-src 'none'; script-src https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src https://challenges.cloudflare.com; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"};
function page(title:string,html:string,status=200){return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Whumpo</title><style>*{box-sizing:border-box}body{margin:0;background:#f8fafc;color:#0f2d5b;font:17px/1.6 Arial,sans-serif}main{max-width:650px;margin:5vh auto;padding:32px}h1{font:44px/1.15 Georgia,serif;overflow-wrap:anywhere}label{display:block;margin:22px 0 6px}input,textarea{width:100%;padding:12px;border:1px solid #86a4a8;border-radius:8px;font:inherit}textarea{min-height:180px}button{padding:12px 24px;background:#0f2d5b;color:white;border:0;border-radius:8px;font:inherit;margin:22px 0}a{color:inherit}.note{font-size:14px}small{letter-spacing:.1em}</style></head><body><main><small>WHUMPO CONTACT</small><h1>${esc(title)}</h1>${html}</main></body></html>`,{status,headers});}
async function readForm(request:Request){
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/x-www-form-urlencoded'))throw new ContactError(415,'Submit the form from this page.');
 const reader=request.body?.getReader();if(!reader)throw new ContactError(400,'Complete the form.');
 let size=0;const chunks:Uint8Array[]=[];
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>32768){await reader.cancel();throw new ContactError(413,'Message too large.');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const form=new URLSearchParams(new TextDecoder().decode(bytes));
 const allowed=['id','revision','name','email','message','cf-turnstile-response'];
 for(const key of form.keys())if(!allowed.includes(key)||form.getAll(key).length!==1)throw new ContactError(400,'Reload the contact form.');
 return form;
}
export async function contactPage(request:Request,env:Env,projectId:string,fetcher:typeof fetch=fetch):Promise<Response>{
 let stage='availability';
 try{
  if(!['GET','POST','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{...headers,allow:'GET, HEAD, POST'}});
  if(request.method==='POST'&&request.headers.get('origin')!==new URL(request.url).origin)throw new ContactError(403,'Open the contact form before sending a message.');
  const ip=request.headers.get('cf-connecting-ip')||'local';
  if(!(await env.API_LIMITER.limit({key:'contact:'+ip})).success)throw new ContactError(429,'Too many requests. Please try again later.');
  const local=String(env.ENVIRONMENT)==='local';
  if(!local&&(!env.TURNSTILE_SECRET||!env.TURNSTILE_SITE_KEY))throw new ContactError(503,'Contact forms are temporarily unavailable.');
  const target=await activeContact(env.DB,projectId);if(!target)throw new ContactError(404,'This contact form is unavailable.');
  if(request.method==='POST'){
   stage='form-read';
   const form=await readForm(request),revision=Number(form.get('revision'));
   if(!Number.isSafeInteger(revision)||revision!==target.revision)throw new ContactError(409,'The form changed. Reload the website before sending.');
   if(!local){
    const token=form.get('cf-turnstile-response');if(!token||token.length>2048)throw new ContactError(400,'Complete verification before sending.');
    stage='verification-request';
    const response=await fetcher('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',body:new URLSearchParams({secret:env.TURNSTILE_SECRET!,response:token,remoteip:ip}),redirect:'manual',signal:AbortSignal.timeout(10000)});
    // Siteverify response is read with a hard bound, including chunked responses.
    stage='verification-response';
    const reader=response.body?.getReader();if(!response.ok||!reader)throw new ContactError(503,'Verification is unavailable. Try again later.');
    let raw='',size=0;const decoder=new TextDecoder();while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>8192){await reader.cancel();throw new ContactError(503,'Verification is unavailable.');}raw+=decoder.decode(value,{stream:true});}raw+=decoder.decode();
    let check:{success?:boolean;hostname?:string;action?:string;cdata?:string};try{check=JSON.parse(raw);}catch{throw new ContactError(503,'Verification is unavailable.');}
    if(check?.success!==true||check.hostname!==new URL(request.url).hostname||check.action!=='contact'||check.cdata!==projectId)throw new ContactError(400,'Verification failed. Reload the form and try again.');
   }
   stage='save-message';
   await saveContact(env.DB,projectId,revision,{id:form.get('id'),name:form.get('name'),email:form.get('email'),message:form.get('message')});
   return page('Message received','<p>Your message is in the site owner’s private inbox. No email was sent automatically.</p><p>You can close this page.</p>');
  }
  const html=`<p>Send a message to ${esc(target.name)}.</p><form method="post"><input type="hidden" name="id" value="${crypto.randomUUID()}"><input type="hidden" name="revision" value="${target.revision}"><label for="name">Name</label><input id="name" name="name" maxlength="100" autocomplete="name" required><label for="email">Email</label><input id="email" name="email" type="email" maxlength="254" autocomplete="email" required><label for="message">Message</label><textarea id="message" name="message" maxlength="2000" required></textarea><p class="note">Your name, email and message are visible to this site’s owner in Whumpo for up to 30 days. Messages are not sent to AI. Avoid passwords, payment details or other sensitive information.</p>${local?'':`<div class="cf-turnstile" data-sitekey="${esc(env.TURNSTILE_SITE_KEY)}" data-action="contact" data-cdata="${projectId}"></div><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`}<button type="submit">Send message</button></form>`;
  return request.method==='HEAD'?new Response(null,{headers}):page('Contact '+target.name,html);
 }catch(cause){if(cause instanceof ContactError)return page('Unable to send',`<p>${esc(cause.message)}</p><p><a href="/contact/${projectId}">Open a fresh form</a></p>`,cause.status);console.error(JSON.stringify({event:'contact.failed',stage,errorName:cause instanceof Error?cause.name:'Unknown'}));return page('Temporarily unavailable','<p>Please try again later. If you already submitted, check with the site owner before resending.</p>',503);}
}
