import {classifyProviderError,NotificationCatalogError,notificationCatalog,renderNotification} from './notification-catalog';
import {contactNotificationConfig,type ContactNotice,type ContactNotificationEnv,type ContactNotificationSettings,type ContactProviderOutcome,type ContactSender} from './contact-notifications';
/**
 * WH-036 Cloudflare Email Service adapter (owner decision, October 4, 2026). Inactive unless the owner configures all of:
 * `CONTACT_NOTIFICATION_PROVIDER="cloudflare-email"`, a `CONTACT_NOTIFICATION_REVIEW` reference and a `send_email` binding
 * named `CONTACT_EMAIL` (docs/contact-forms.md lists the exact steps; none is configured in this repository).
 *
 * Binding shape checked against https://developers.cloudflare.com/email-service/api/send-emails/workers-api/ (last updated
 * September 16, 2026; read October 4, 2026): `send({from,to,subject,text,headers})` resolves `{messageId}` and failures throw an
 * Error with a `code`. Email Sending is a beta on Workers Paid; it documents no idempotency key, so the runner never retries an
 * uncertain outcome. Only content-free text is sent: no visitor name, email, message, project name or AI output.
 */
export const cloudflareEmailProvider='cloudflare-email';
/** Platform-fixed sender (owner decision) from the source notification catalog (WH-155). The binding should also restrict `allowed_sender_addresses` to this address. */
const platformSender=notificationCatalog.senders['whumpo-notify'];
export const contactNotificationSender=platformSender.address;
export type ContactEmailBinding={send(message:{from:{email:string;name:string};to:string;subject:string;text:string;headers:Record<string,string>}):Promise<{messageId?:unknown}>};
export type ContactEmailEnv=ContactNotificationEnv&{CONTACT_EMAIL?:unknown};
/**
 * Maps a thrown send error through the reviewed provider error classes in the catalog (WH-036 behavior, unchanged):
 * not-taken is safe to retry later, rejected is a permanent refusal of this exact message, and E_INTERNAL_SERVER_ERROR,
 * unknown codes and transport failures are uncertain and never resent.
 */
export function cloudflareEmailOutcome(cause:unknown):ContactProviderOutcome{
 const code=cause&&typeof cause==='object'&&typeof (cause as {code?:unknown}).code==='string'?(cause as {code:string}).code:'';
 switch(classifyProviderError(notificationCatalog,cloudflareEmailProvider,code)){
  case 'suppressed':return {accepted:false,retryable:false,suppressed:true};
  case 'not-taken':return {accepted:false,retryable:true};
  case 'rejected':return {accepted:false,retryable:false};
  default:return {accepted:false,retryable:false,uncertain:true};
 }
}
/** Rendered from the catalog templates `contact.new-message@1` and `owner.destination-verification@1`; the text is byte-identical to the WH-036 notices. */
export function contactEmailMessage(notice:ContactNotice){
 if(notice.kind!=='verification')return renderNotification('contact.new-message@1');
 // A missing, non-string, malformed or oversized code is refused with the one WH-036 error; nothing else is swallowed.
 const code:unknown=notice.verificationCode;
 if(typeof code!=='string')throw Error('Invalid verification notice');
 try{return renderNotification('owner.destination-verification@1',{code});}
 catch(cause){if(cause instanceof NotificationCatalogError&&(cause.code==='INVALID_VARIABLE'||cause.code==='INPUT_TOO_LARGE'))throw Error('Invalid verification notice');throw cause;}
}
export function cloudflareEmailSender(binding:ContactEmailBinding):ContactSender{
 return async(notice)=>{
  const {subject,text}=contactEmailMessage(notice);
  try{
   const sent=await binding.send({from:{email:contactNotificationSender,name:platformSender.displayName},to:notice.recipient,subject,text,headers:{'X-Whumpo-Notice-Id':notice.outboxId}});
   const ref=typeof sent?.messageId==='string'&&sent.messageId.length>=1&&sent.messageId.length<=100?sent.messageId:undefined;
   return {accepted:true,...(ref?{providerRef:ref}:{})};
  }catch(cause){return cloudflareEmailOutcome(cause);}
 };
}
/**
 * The only path to a live sender. Returns null (nothing reachable) unless the owner selected and reviewed `cloudflare-email`
 * and bound `CONTACT_EMAIL`. The scheduled handler and verification requests both go through here.
 */
export function contactDelivery(env:ContactEmailEnv):{settings:ContactNotificationSettings;sender:ContactSender}|null{
 const {settings}=contactNotificationConfig(env),binding=env.CONTACT_EMAIL as {send?:unknown}|undefined;
 if(!settings||settings.provider!==cloudflareEmailProvider||!binding||typeof binding.send!=='function')return null;
 return {settings,sender:cloudflareEmailSender(binding as ContactEmailBinding)};
}
