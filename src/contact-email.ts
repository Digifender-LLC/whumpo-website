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
/** Platform-fixed sender (owner decision). The binding should also restrict `allowed_sender_addresses` to this address. */
export const contactNotificationSender='notify@whumpo.com';
export type ContactEmailBinding={send(message:{from:{email:string;name:string};to:string;subject:string;text:string;headers:Record<string,string>}):Promise<{messageId?:unknown}>};
export type ContactEmailEnv=ContactNotificationEnv&{CONTACT_EMAIL?:unknown};
/** Provider did not take the message: safe to retry later. Configuration and rate errors are documented as refusals before sending. */
const notTaken=new Set(['E_RATE_LIMIT_EXCEEDED','E_DAILY_LIMIT_EXCEEDED','E_SENDER_NOT_VERIFIED','E_SENDER_DOMAIN_NOT_AVAILABLE']);
/** Permanent refusal of this exact message (invalid payload, recipient not allowed by the binding, delivery failure, header errors). */
const rejected=new Set(['E_VALIDATION_ERROR','E_FIELD_MISSING','E_TOO_MANY_RECIPIENTS','E_TOO_MANY_ATTACHMENTS','E_RECIPIENT_NOT_ALLOWED','E_CONTENT_TOO_LARGE','E_DELIVERY_FAILED','E_HEADER_NOT_ALLOWED','E_HEADER_USE_API_FIELD','E_HEADER_VALUE_INVALID','E_HEADER_VALUE_TOO_LONG','E_HEADER_NAME_INVALID','E_HEADERS_TOO_LARGE','E_HEADERS_TOO_MANY']);
/** Maps a thrown send error. E_INTERNAL_SERVER_ERROR, unknown codes and transport failures are uncertain: never resent. */
export function cloudflareEmailOutcome(cause:unknown):ContactProviderOutcome{
 const code=cause&&typeof cause==='object'&&typeof (cause as {code?:unknown}).code==='string'?(cause as {code:string}).code:'';
 if(code==='E_RECIPIENT_SUPPRESSED')return {accepted:false,retryable:false,suppressed:true};
 if(notTaken.has(code))return {accepted:false,retryable:true};
 if(rejected.has(code))return {accepted:false,retryable:false};
 return {accepted:false,retryable:false,uncertain:true};
}
export function contactEmailMessage(notice:ContactNotice){
 const inbox='https://whumpo.com/workspace/inbox';
 const footer=`\n\nYou receive this because this address was added and verified for contact-form notices in Whumpo. To stop them, remove the address in Dashboard → Contact inbox (${inbox}).`;
 if(notice.kind==='verification'){
  if(!notice.verificationCode||!/^[A-Z0-9]{8}$/.test(notice.verificationCode))throw Error('Invalid verification notice');
  return {subject:'Your Whumpo verification code',text:`Your Whumpo verification code is ${notice.verificationCode}\n\nEnter it in Dashboard → Contact inbox within one hour to receive contact-form notices at this address. If you did not ask for this, ignore this email; nothing will be sent unless the code is entered.`};
 }
 return {subject:'New contact-form message in Whumpo',text:`A visitor sent a new message through a contact form on one of your Whumpo websites.\n\nRead it in your private inbox: ${inbox}\n\nThis notice does not include the message.${footer}`};
}
export function cloudflareEmailSender(binding:ContactEmailBinding):ContactSender{
 return async(notice)=>{
  const {subject,text}=contactEmailMessage(notice);
  try{
   const sent=await binding.send({from:{email:contactNotificationSender,name:'Whumpo'},to:notice.recipient,subject,text,headers:{'X-Whumpo-Notice-Id':notice.outboxId}});
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
