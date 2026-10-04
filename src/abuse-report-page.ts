/** WH-016 public abuse-report page at https://whumpo.com/report. No account, Chat or AI is involved: the page works when
 * the workspace, onboarding or inference is unavailable. Same submission boundary as the contact form (exact Origin,
 * URL-encoded allowlisted fields, a 16 KiB streaming bound, the API rate limiter, a per-connection daily allowance and
 * server-side Turnstile), then src/abuse-reports.ts stores the report in the restricted operator queue. Submitted values,
 * tokens and verification responses are never logged. */
import {publicClientKey,reservePublicClient,PublicClientLimitError} from './public-admission';
import {abuseReportCategories,abuseReportInput,resolveAbuseReportTarget,saveAbuseReport,AbuseReportError,maxReportDetails} from './abuse-reports';
import {verifyTurnstile} from './turnstile';

export const abuseReportPath='/report';
export const abuseTurnstile=Object.freeze({action:'abuse_report',cdata:'abuse-report'});
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const headers={'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','x-frame-options':'DENY','x-robots-tag':'noindex','content-security-policy':"default-src 'none'; script-src https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; connect-src https://challenges.cloudflare.com; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'"};
const urgent='<p class="note"><strong>If someone is in immediate danger, contact emergency services (911 in the US).</strong> To report suspected child sexual exploitation, you can also use the NCMEC CyberTipline at <a href="https://report.cybertip.org/">report.cybertip.org</a>.</p>';
function page(title:string,html:string,status=200){return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} · Whumpo</title><style>*{box-sizing:border-box}body{margin:0;background:#f8fafc;color:#0f2d5b;font:17px/1.6 Arial,sans-serif}main{max-width:650px;margin:5vh auto;padding:24px 16px}h1{font:40px/1.15 Georgia,serif;overflow-wrap:anywhere}label{display:block;margin:22px 0 6px;font-weight:bold}input,select,textarea{width:100%;padding:12px;border:1px solid #86a4a8;border-radius:8px;font:inherit;background:white;color:inherit}textarea{min-height:160px}input:focus,select:focus,textarea:focus,button:focus,a:focus{outline:3px solid #0f2d5b;outline-offset:2px}button{padding:12px 24px;background:#0f2d5b;color:white;border:0;border-radius:8px;font:inherit;margin:22px 0}a{color:inherit}.note,.hint{font-size:15px}.hint{margin:4px 0 0}code{overflow-wrap:anywhere}small{letter-spacing:.1em}</style></head><body><main><small>WHUMPO SAFETY REPORT</small><h1>${esc(title)}</h1>${html}</main></body></html>`,{status,headers});}
async function readForm(request:Request){
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/x-www-form-urlencoded'))throw new AbuseReportError(415,'Submit the report from this page.');
 const reader=request.body?.getReader();if(!reader)throw new AbuseReportError(400,'Complete the form.');
 let size=0;const chunks:Uint8Array[]=[];
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>16384){await reader.cancel();throw new AbuseReportError(413,'Report too large.');}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
 const form=new URLSearchParams(new TextDecoder().decode(bytes));
 const allowed=['id','site','category','details','cf-turnstile-response'];
 for(const key of form.keys())if(!allowed.includes(key)||form.getAll(key).length!==1)throw new AbuseReportError(400,'Reload the report form.');
 return form;
}
function formHTML(env:Pick<Env,'TURNSTILE_SITE_KEY'>,local:boolean,site:string){
 const options=Object.entries(abuseReportCategories).map(([value,label])=>`<option value="${value}">${esc(label)}</option>`).join('');
 return `<p>Tell Whumpo's safety reviewers about a published Whumpo website or app that breaks the <a href="https://digifender.com/legal/whumpo">Acceptable Use Policy</a>. You do not need an account.</p>${urgent}<form method="post"><input type="hidden" name="id" value="${crypto.randomUUID()}"><label for="site">Address of the site or app</label><input id="site" name="site" maxlength="2048" inputmode="url" autocomplete="off" spellcheck="false" required aria-describedby="site-hint" value="${esc(site)}"><p class="hint" id="site-hint">For example <code>https://…whumpo.site/</code> or the site's own domain.</p><label for="category">What is the problem?</label><select id="category" name="category" required><option value="">Choose one</option>${options}</select><label for="details">What did you see? (optional)</label><textarea id="details" name="details" maxlength="${maxReportDetails}" aria-describedby="details-hint"></textarea><p class="hint" id="details-hint">Up to ${maxReportDetails.toLocaleString('en-US')} characters. Describe it and say where on the page it is. <strong>Do not paste or upload prohibited material, passwords or payment details.</strong></p><p class="note">Reports go to Whumpo's safety reviewers. They are not sent to the site's owner or to any AI. We do not store your IP address or ask for your contact details. Formal copyright notices follow the <a href="https://digifender.com/legal/whumpo">Copyright and Abuse Policy</a>.</p>${local?'':`<div class="cf-turnstile" data-sitekey="${esc(env.TURNSTILE_SITE_KEY)}" data-action="${abuseTurnstile.action}" data-cdata="${abuseTurnstile.cdata}"></div><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`}<button type="submit">Send report</button></form>`;
}
export async function abuseReportPage(request:Request,env:Pick<Env,'DB'|'API_LIMITER'|'ENVIRONMENT'|'TURNSTILE_SITE_KEY'>&{TURNSTILE_SECRET?:string},fetcher:typeof fetch=fetch):Promise<Response>{
 let stage='availability';
 try{
  if(!['GET','POST','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405,headers:{...headers,allow:'GET, HEAD, POST'}});
  const url=new URL(request.url);
  if(request.method==='POST'&&request.headers.get('origin')!==url.origin)throw new AbuseReportError(403,'Open the report form before sending a report.');
  const ip=request.headers.get('cf-connecting-ip')||'local';
  if(!(await env.API_LIMITER.limit({key:'abuse-report:'+ip})).success)throw new AbuseReportError(429,'Too many requests. Please try again later.');
  const local=String(env.ENVIRONMENT)==='local';
  if(!local&&(!env.TURNSTILE_SECRET||!env.TURNSTILE_SITE_KEY))throw new AbuseReportError(503,'Reporting is temporarily unavailable. Please email legal@digifender.com.');
  if(request.method!=='POST'){
   const site=(url.searchParams.get('site')??'').slice(0,2048);
   return request.method==='HEAD'?new Response(null,{headers}):page('Report a site or app',formHTML(env,local,site));
  }
  stage='form-read';
  const form=await readForm(request);
  const input=abuseReportInput({id:form.get('id'),category:form.get('category'),details:form.get('details')});
  stage='target';
  const target=await resolveAbuseReportTarget(env.DB,form.get('site'));
  // One connection may send at most three reports about the same project per UTC day, counted before verification.
  stage='client-allowance';
  try{await reservePublicClient(env.DB,'abuse',target.projectId,await publicClientKey(request,'abuse',target.projectId));}
  catch(cause){if(cause instanceof PublicClientLimitError)throw new AbuseReportError(429,'You have already sent several reports about this site today. Our reviewers have them.');throw cause;}
  if(!local){
   const token=form.get('cf-turnstile-response');if(!token||token.length>2048)throw new AbuseReportError(400,'Complete verification before sending.');
   const outcome=await verifyTurnstile(fetcher,env.TURNSTILE_SECRET!,token,ip,{hostname:url.hostname,...abuseTurnstile},s=>{stage=s;});
   if(outcome==='unavailable')throw new AbuseReportError(503,'Verification is unavailable. Try again later, or email legal@digifender.com.');
   if(outcome==='failed')throw new AbuseReportError(400,'Verification failed. Reload the form and try again.');
  }
  stage='save-report';
  const {receipt}=await saveAbuseReport(env.DB,target,input);
  return page('Report received',`<p>Thank you. Your report is in Whumpo's restricted safety review queue.</p><p>Receipt: <code>${esc(receipt)}</code></p><p>Keep this receipt if you contact <a href="mailto:legal@digifender.com">legal@digifender.com</a> about this report. Reviewers decide what happens next. This page does not show case details or outcomes, and your report is not sent to the site owner.</p>${urgent}`);
 }catch(cause){
  if(cause instanceof AbuseReportError)return page('Unable to send report',`<p role="alert">${esc(cause.message)}</p><p><a href="${abuseReportPath}">Open a fresh form</a></p>`,cause.status);
  console.error(JSON.stringify({event:'abuse_report.failed',stage,category:'unexpected'}));
  return page('Temporarily unavailable','<p>Please try again later, or email <a href="mailto:legal@digifender.com">legal@digifender.com</a>. If you already submitted, your receipt is still valid.</p>',503);
 }
}
