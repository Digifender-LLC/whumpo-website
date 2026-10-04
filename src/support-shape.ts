/** Shared by the Worker and the support page. No server imports. */
export type SupportKind='usage_review'|'help';
export type SupportDeliveryState='none'|'queued'|'delivered'|'failed'|'cancelled';
export type SupportRequest={id:string;kind:SupportKind;reference:string|null;statement:string;createdAt:string;state:'open'|'answered';publicResponse:string|null;answeredAt:string|null;
 /** Saved in Whumpo, external provider acceptance, and customer read are three separate facts. */
 response:{saved:boolean};delivery:{state:SupportDeliveryState};read:{state:'unread'|'read'|'not_applicable';at:string|null}};
export type SupportOperation={id:string;family:'chat'|'standard_ai'|'hosting'|'backup'|'dns';label:string;state:string;since:string;ageMinutes:number|null;needsAttention:boolean;reference:string;next:string};
export type SupportConfigView={hours:string|null;contact:string|null;notifications:{enabled:boolean}};
export type SupportOverview={version:1;config:SupportConfigView;requests:SupportRequest[];operations:SupportOperation[];statusLinks:SupportStatusLink[]};
export type SupportStatusLink={code:StatusCode;title:string;meaning:string;next:string;href:string};
export const statusCodes=['onboarding_required','chat_unavailable','usage_limit'] as const;
export type StatusCode=typeof statusCodes[number];
export const operationFamilies=['chat','standard_ai','hosting','backup','dns'] as const;
const copy:Record<StatusCode,{title:string;meaning:string;next:string}>={
 onboarding_required:{title:'Finish the first-project welcome',meaning:'Chat and the workspace stay closed until your first project is started.',next:'Finish the welcome questions, or ask for help here. Support, recovery and export do not need it.'},
 chat_unavailable:{title:'Chat is unavailable',meaning:'The AI provider, platform testing capacity or a previous reply may be holding Chat.',next:'Your saved work, exports and this support page still work. Try Chat later, or ask for help below.'},
 usage_limit:{title:'A usage limit was reached',meaning:'A request-rate or testing-capacity limit stopped this action. It does not delete saved work.',next:'You can ask an operator to review a usage decision below. No response time is promised.'}
};
/** Stable, content-free link to the support page for an error or status code. */
export const supportLink=(code:StatusCode)=>'/workspace/support?ref='+encodeURIComponent('status:'+code);
export const supportStatusLinks=():SupportStatusLink[]=>statusCodes.map(code=>({code,...copy[code],href:supportLink(code)}));
export const operationReference=(family:SupportOperation['family'],id:string)=>'operation:'+family+':'+id;
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
/** Structured references only; free text belongs in the statement. */
export function parseSupportReference(value:unknown):{kind:'status';code:StatusCode}|{kind:'operation';family:SupportOperation['family'];id:string}|null{
 if(typeof value!=='string')return null;
 const status=/^status:([a-z_]+)$/.exec(value);if(status&&(statusCodes as readonly string[]).includes(status[1]))return {kind:'status',code:status[1] as StatusCode};
 const operation=/^operation:([a-z_]+):([0-9a-f-]{36})$/.exec(value);if(operation&&(operationFamilies as readonly string[]).includes(operation[1])&&uuid.test(operation[2]))return {kind:'operation',family:operation[1] as SupportOperation['family'],id:operation[2]};
 return null;
}
export const deliveryLabel=(state:SupportDeliveryState)=>({none:'Saved in Whumpo only (no external notification is configured)',queued:'External notification queued',delivered:'External notification accepted by the provider',failed:'External notification failed; the saved response is still here',cancelled:'External notification cancelled because you had already read the response'})[state];
