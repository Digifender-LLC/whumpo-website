import {boundAppointment,standardAppointmentFormId} from './shared-modules/records-setup';
import type {RecordField} from './project-specification/v3/modules';
import {servingStopped} from './operator-serving';

/** WH-070 hosted standard appointment request page, `GET /forms/appointment` on a project's application host. Server-rendered
 * into a fixed template from the registered records instance: resource id, configuration revision, field labels and the
 * business name only, so no new module operation exists. Submitting is the existing visitor-gateway `forms.submit`
 * (`POST /modules`), whose public admission (Turnstile, per-connection allowance) and commit triggers are unchanged.
 * The page is open only while the form is bound to the live website version AND the deployed Worker has the Turnstile
 * secret (`secretPresent`); every other state renders one identical closed page that gives no reason and has no submit.
 * Copy says request, never a confirmed booking, and promises no email. The open page alone gets `appointmentPolicy`, which adds
 * https://challenges.cloudflare.com to script-src, frame-src and connect-src (as the contact page needs) and allows inline styles for the widget; the closed page keeps the strict application-host policy. */
export const appointmentPolicy="default-src 'none'; script-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; connect-src 'self' https://challenges.cloudflare.com; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const head=(title:string)=>`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><meta name="color-scheme" content="light dark"><title>${esc(title)}</title><link rel="stylesheet" href="/design-tokens.css"><link rel="stylesheet" href="/appointment.css">`;
const html=(body:string)=>new Response(body,{headers:{'content-type':'text/html; charset=utf-8'}});

/** One closed page for every state that is not open: no reason, no business name, no form and no submit control. */
export const closedAppointmentPage=()=>html(`${head('This form isn’t open yet')}</head><body><main class="page"><section class="panel" aria-labelledby="title"><h1 id="title">This form isn’t open yet</h1><p>Please check back later, or contact the business another way.</p></section></main></body></html>`);

type Config={retentionDays:number;schemas:{id:string;fields:RecordField[]}[]};
function control(f:RecordField){
 const id='f-'+f.key,err=`e-${f.key}`,opt=f.optional?' <span class="opt">(optional)</span>':'';
 if(f.type==='choice')return `<fieldset class="field" data-key="${esc(f.key)}" data-type="choice" aria-describedby="${err}"><legend>${esc(f.label)}${opt}</legend><div class="choices">${f.options.map((o,i)=>`<label class="choice"><input type="radio" name="${esc(f.key)}" value="${esc(o.value)}" id="${id}-${i}"><span>${esc(o.label)}</span></label>`).join('')}</div><p class="error" id="${err}" hidden></p></fieldset>`;
 if(f.type==='boolean')return `<div class="field" data-key="${esc(f.key)}" data-type="boolean"><label class="choice"><input type="checkbox" id="${id}" name="${esc(f.key)}" aria-describedby="${err}"><span>${esc(f.label)}</span></label><p class="error" id="${err}" hidden></p></div>`;
 const note=f.key==='note',type=f.type==='number'?'number':'text',auto=f.key==='name'?' autocomplete="name"':'';
 const input=note?`<textarea id="${id}" name="${esc(f.key)}" rows="4" maxlength="300" aria-describedby="${err}"></textarea>`:`<input id="${id}" name="${esc(f.key)}" type="${type}"${type==='number'?' step="any" inputmode="decimal"':' maxlength="300"'}${auto} aria-describedby="${err}">`;
 return `<div class="field" data-key="${esc(f.key)}" data-type="${f.type}"><label for="${id}">${esc(f.label)}${opt}</label>${input}<p class="error" id="${err}" hidden></p></div>`;
}

/** `open` is decided by the caller from the deployed environment: local, or a configured Turnstile secret and site key. */
export async function appointmentPage(db:D1Database,project:string,open:{local:boolean;secretPresent:boolean;siteKey:string|null}):Promise<{response:Response;open:boolean}>{
 const closed=()=>({response:closedAppointmentPage(),open:false});
 if(!open.local&&(!open.secretPresent||!open.siteKey))return closed();
 if(await servingStopped(db,project))return closed();
 const bound=await boundAppointment(db,project),found=bound?{id:bound.row.id,revision:bound.row.config_revision,config:bound.instance.config as Config}:null;
 const name=(await db.prepare('SELECT name FROM projects WHERE id=?').bind(project).first<{name:string}>())?.name;
 const form=found?.config.schemas.find(s=>s.id==='appointment')??null;
 if(!found||!name||!form)return closed();
 const business=esc(name),local=open.local,modules=local?`/apps/${project}/modules`:'/modules';
 return {open:true,response:html(`${head('Request an appointment · '+name)}<script defer src="/appointment.js"></script></head><body><main class="page">
<header class="intro"><p class="eyebrow">${business}</p><h1 id="title">Request an appointment</h1><p class="lede">Tell us what you need and when suits you. This sends a request to ${business}. Nothing is booked until they agree a time with you.</p></header>
<section class="panel" aria-labelledby="title"><form id="form" novalidate data-modules="${esc(modules)}" data-resource="${esc(found.id)}" data-revision="${found.revision}" data-form="${standardAppointmentFormId}" data-site-key="${local?'':esc(open.siteKey!)}">
<div id="summary" class="summary" role="alert" tabindex="-1" hidden></div>
${form.fields.map(control).join('\n')}
${local?'':`<div class="field check" id="check-field"><p class="check-title" id="check-title">Quick security check</p><div id="widget" aria-labelledby="check-title"></div><p class="error" id="e-check" hidden></p></div>`}
<div class="actions"><button type="submit" id="send" class="primary">Send request</button><p id="progress" class="progress" role="status" aria-live="polite"></p></div>
<p class="fine">This form is run for ${business} by Whumpo. ${business} can see your answers in Whumpo for up to ${found.config.retentionDays} days. They are not sent to AI. Please don’t include passwords or payment details. <a href="https://digifender.com/legal/whumpo/privacy" target="_blank" rel="noopener noreferrer">Draft privacy policy</a></p>
</form>
<div id="done" class="done" hidden tabindex="-1"><h2>Request sent</h2><p class="ref">Your reference: <strong id="reference"></strong></p><p>${business} can now see your request. They will use the details you gave to arrange a time. Nothing is booked yet, and this page does not send you an email.</p><button type="button" id="again">Send another request</button></div>
<noscript><p class="error-static">This form needs JavaScript to send a request. Please turn it on, or contact the business another way.</p></noscript>
</section></main></body></html>`)};
}
