/**
 * WH-155 source notification catalog (contract version 1, docs/notifications.md). One server catalog of transactional
 * templates, the verified platform sender and provider facts, with closed validators and a plain-text segment renderer.
 * It closes gaps G-N1 to G-N3: the WH-036 contact notices render through it byte for byte, and the contact adapter takes
 * its sender, ceiling and error classes from here. It provisions nothing: no table, binding, provider, sender, DNS record
 * or schedule. tests/notifications-contract.mjs checks it agrees exactly with the frozen reference in
 * tools/prototypes/notifications.mjs. Nothing here reaches owner-maintenance inference.
 */
export class NotificationCatalogError extends Error {
 constructor(readonly code:string,readonly path:string){super(`${code}: ${path}`);}
}
const check=(ok:unknown,code:string,path:string):void=>{if(!ok)throw new NotificationCatalogError(code,path);};
type Plain=Record<string,unknown>;
const plain=(v:unknown):v is Plain=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
function shape(v:unknown,keys:readonly string[],path:string):asserts v is Plain{
 check(plain(v),'INVALID_SHAPE',path);
 const o=v as Plain;
 check(Object.keys(o).every(k=>keys.includes(k)),'UNKNOWN_FIELD',path);
 check(keys.every(k=>Object.hasOwn(o,k)),'MISSING_FIELD',path);
}
function canonical(v:unknown,depth=0):string{
 check(depth<=12,'TOO_DEEP','json');
 if(v===null||typeof v==='string'||typeof v==='boolean')return JSON.stringify(v);
 if(typeof v==='number'){check(Number.isFinite(v),'INVALID_NUMBER','json');return JSON.stringify(v);}
 if(Array.isArray(v))return '['+v.map(x=>canonical(x,depth+1)).join(',')+']';
 check(plain(v),'INVALID_SHAPE','json');
 const o=v as Plain;
 return '{'+Object.keys(o).sort().map(k=>JSON.stringify(k)+':'+canonical(o[k],depth+1)).join(',')+'}';
}
/** SHA-256 hex of canonical JSON (sorted keys), identical to the reference `digest`. */
export async function notificationDigest(v:unknown){
 const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical(v))));
 return Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}

export const notificationContractVersion=1;
export const recipientScopes=['owner-destination','project-staff','submitter','account-email'] as const;
export const authorityClasses=['platform-obligation','approved-configuration'] as const;
export const notificationTriggers=['contact.accepted','destination.verification','form.accepted','account.notice'] as const;
export const readinessLevels=['planned','synthetic-conformant','source','live-accepted'] as const;
export type RecipientScope=typeof recipientScopes[number];
export const notificationBounds=Object.freeze({subjectChars:120,bodyChars:4000,perRecipientHour:10,perRecipientDay:50});
/** Fixed platform links. A template names one by ID; no variable, caller or configuration supplies a URL. */
export const platformLinks:Readonly<Record<string,string>>=Object.freeze({'workspace-inbox':'https://whumpo.com/workspace/inbox','workspace-records':'https://whumpo.com/workspace/records','workspace-settings':'https://whumpo.com/workspace/settings'});

export type Segment={text:string}|{var:string}|{link:string};
export type VariableSpec={source:'config';type:'text-line'}|{source:'record';type:'choice'|'number'|'boolean'}|{source:'platform';type:'reference'|'code'|'token'};
export type NotificationTemplate={contractVersion:1;id:string;version:number;purpose:'transactional';authority:typeof authorityClasses[number];trigger:typeof notificationTriggers[number];audiences:RecipientScope[];variables:Record<string,VariableSpec>;subject:Segment[];body:Segment[]};
export type ProviderFacts={readiness:typeof readinessLevels[number];review:{reference:string;reviewedAt:string}|null;
 price:{basis:'metered';currency:'USD';microsPerCall:number;includedPerMonth:number;checkedAt:string;entitlement:'requires-verification'}|null;
 ceiling:{callsPer32Days:number}|null;idempotency:'none'|'provider-idempotency-key';events:'not-configured';lookup:'none';
 errorClasses:{notTaken:string[];rejected:string[];suppressed:string[]}};
export type SenderEntry={address:string;displayName:string;provider:string;domainOwner:'platform'|'customer';state:'verified'|'unverified'|'planned';dnsReview:string|null};
export type CatalogEntry={state:'available'|'withdrawn';readiness:typeof readinessLevels[number];template:NotificationTemplate};
export type NotificationCatalog={contractVersion:1;providers:Record<string,ProviderFacts>;senders:Record<string,SenderEntry>;templates:Record<string,CatalogEntry>};

// Keys that would let a caller, configuration or template choose a destination, header, URL or credential.
const relayKeys=new Set(['to','cc','bcc','recipient','recipients','address','addresses','email','emails','replyto','reply_to','from','headers','header','url','urls','href','webhook','callback','returnpath','return_path']);
// Field names that would carry a credential; the same pattern as the reference, built from its alternatives.
const credentialFieldNames=['api[_-]?key','token','secret','password','authorization','credential','credentials','bearer','private[_-]?key','binding'];
const credentialField=new RegExp(`^(${credentialFieldNames.join('|')})$`,'i');
function noRelayOrSecret(v:unknown,path:string,depth=0):void{
 check(depth<=12,'TOO_DEEP',path);
 if(Array.isArray(v)){v.forEach((x,i)=>noRelayOrSecret(x,`${path}[${i}]`,depth+1));return;}
 if(!plain(v))return;
 for(const [k,x] of Object.entries(v)){
  check(!credentialField.test(k),'SECRET_FIELD',`${path}.${k}`);
  check(!relayKeys.has(k.toLowerCase()),'OPEN_RELAY',`${path}.${k}`);
  noRelayOrSecret(x,`${path}.${k}`,depth+1);
 }
}
const separators=[String.fromCharCode(0x2028),String.fromCharCode(0x2029)];
const lineSafe=(v:string)=>!/[\u0000-\u001f\u007f]/.test(v)&&!separators.some(c=>v.includes(c));
const urlOrAddress=(v:string)=>/@|[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\.(com|net|org|io|site|app)\b/i.test(v);
/** Variable types. Every value is validated at render; values are inserted as data and never re-parsed. */
export const variableTypes:Readonly<Record<VariableSpec['type'],(v:unknown,field?:{options?:unknown})=>boolean>>=Object.freeze({
 'text-line':v=>typeof v==='string'&&v.length>=1&&v.length<=80&&lineSafe(v)&&!/[<>]/.test(v)&&!urlOrAddress(v),
 choice:(v,field)=>typeof v==='string'&&Array.isArray(field?.options)&&field.options.includes(v)&&lineSafe(v)&&v.length<=80,
 number:v=>Number.isSafeInteger(v)&&Math.abs(v as number)<=1e9,
 boolean:v=>typeof v==='boolean',
 reference:v=>typeof v==='string'&&/^[A-F0-9]{8}$/.test(v),
 code:v=>typeof v==='string'&&/^[A-Z0-9]{8}$/.test(v),
 token:v=>typeof v==='string'&&/^[A-Za-z0-9_-]{43}$/.test(v),
});
const variableSources:Readonly<Record<string,readonly string[]>>=Object.freeze({config:['text-line'],record:['choice','number','boolean'],platform:['reference','code','token']});

const contactFooter:Segment[]=[{text:'\n\nYou receive this because this address was added and verified for contact-form notices in Whumpo. To stop them, remove the address in Dashboard → Contact inbox ('},{link:'workspace-inbox'},{text:').'}];
const stopStaff:Segment[]=[{text:'\n\nYou receive this because you turned on appointment notices for this business in its staff area. Turn them off there at any time.'}];
const stopSubmitter:Segment[]=[{text:'\n\nYou receive this because you asked for an email receipt when you sent the request. This is a one-time receipt; you will not be added to any mailing list.'}];
type TemplateInput=Omit<NotificationTemplate,'contractVersion'|'purpose'|'variables'>&{variables?:Record<string,VariableSpec>};
const template=(o:TemplateInput):NotificationTemplate=>({contractVersion:1,purpose:'transactional',variables:{},...o});
function deepFreeze<T>(v:T):T{if(v&&typeof v==='object'){for(const x of Object.values(v))deepFreeze(x);Object.freeze(v);}return v;}

/** Account notices (WH-202, gap G-E10): platform-obligation, to the account's own verified address (the new address for the confirmation only). Content-free: no address, token (except the new-address code), device or credential detail; every other notice links to Settings. */
const accountFooter:Segment[]=[{text:'\n\nReview your account in Whumpo: '},{link:'workspace-settings'},{text:'\n\nYou receive this because of a security-relevant change to your Whumpo account. If this was not you, open Whumpo and review your account security now.'}];
const tpl=(e:readonly [string,CatalogEntry])=>Object.fromEntries([e]);
const accountTemplate=(id:string,subject:string,lead:string)=>[`${id}@1`,{state:'available',readiness:'planned',template:template({id,version:1,authority:'platform-obligation',trigger:'account.notice',audiences:['account-email'],subject:[{text:subject}],body:[{text:lead},...accountFooter]})}] as const;

/**
 * Frozen v1 catalog, value-identical to the reference. Planned entries are declarations only: no adapter, sender or schedule
 * exists for them. Cloudflare Email Service price and limits: https://developers.cloudflare.com/email-service/platform/pricing/
 * (read October 8, 2026; beta pricing whose account entitlement requires verification). The ceiling is the owner's $5 per
 * month (issue #146): floor($5 / $0.00035) = 14,285 calls in any 32 days, ignoring the account-wide included quota.
 */
export const notificationCatalog:NotificationCatalog=deepFreeze({
 contractVersion:1,
 providers:{
  'cloudflare-email':{readiness:'source',review:{reference:'issue-146-2026-10-04',reviewedAt:'2026-10-04'},
   price:{basis:'metered',currency:'USD',microsPerCall:350,includedPerMonth:3000,checkedAt:'2026-10-08',entitlement:'requires-verification'},
   ceiling:{callsPer32Days:Math.floor(5_000_000/350)},idempotency:'none',events:'not-configured',lookup:'none',
   errorClasses:{
    notTaken:['E_RATE_LIMIT_EXCEEDED','E_DAILY_LIMIT_EXCEEDED','E_SENDER_NOT_VERIFIED','E_SENDER_DOMAIN_NOT_AVAILABLE'],
    rejected:['E_VALIDATION_ERROR','E_FIELD_MISSING','E_TOO_MANY_RECIPIENTS','E_TOO_MANY_ATTACHMENTS','E_RECIPIENT_NOT_ALLOWED','E_CONTENT_TOO_LARGE','E_DELIVERY_FAILED','E_HEADER_NOT_ALLOWED','E_HEADER_USE_API_FIELD','E_HEADER_VALUE_INVALID','E_HEADER_VALUE_TOO_LONG','E_HEADER_NAME_INVALID','E_HEADERS_TOO_LARGE','E_HEADERS_TOO_MANY'],
    suppressed:['E_RECIPIENT_SUPPRESSED']}},
 },
 senders:{
  'whumpo-notify':{address:'notify@whumpo.com',displayName:'Whumpo',provider:'cloudflare-email',domainOwner:'platform',state:'verified',dnsReview:'2026-10-04-whumpo-com-email-sending'},
 },
 templates:{
  'contact.new-message@1':{state:'available',readiness:'source',template:template({id:'contact.new-message',version:1,authority:'platform-obligation',trigger:'contact.accepted',audiences:['owner-destination'],
   subject:[{text:'New contact-form message in Whumpo'}],
   body:[{text:'A visitor sent a new message through a contact form on one of your Whumpo websites.\n\nRead it in your private inbox: '},{link:'workspace-inbox'},{text:'\n\nThis notice does not include the message.'},...contactFooter]})},
  'owner.destination-verification@1':{state:'available',readiness:'source',template:template({id:'owner.destination-verification',version:1,authority:'platform-obligation',trigger:'destination.verification',audiences:['owner-destination'],
   variables:{code:{source:'platform',type:'code'}},
   subject:[{text:'Your Whumpo verification code'}],
   body:[{text:'Your Whumpo verification code is '},{var:'code'},{text:'\n\nEnter it in Dashboard → Contact inbox within one hour to receive contact-form notices at this address. If you did not ask for this, ignore this email; nothing will be sent unless the code is entered.'}]})},
  'appointment.staff-notice@1':{state:'available',readiness:'planned',template:template({id:'appointment.staff-notice',version:1,authority:'approved-configuration',trigger:'form.accepted',audiences:['owner-destination','project-staff'],
   variables:{businessName:{source:'config',type:'text-line'}},
   subject:[{text:'New appointment request for '},{var:'businessName'}],
   body:[{text:'A new appointment request arrived for '},{var:'businessName'},{text:'.\n\nOpen the request list to review it: '},{link:'workspace-records'},{text:'\n\nThis notice does not include the request details.'},...stopStaff]})},
  'appointment.request-receipt@1':{state:'available',readiness:'planned',template:template({id:'appointment.request-receipt',version:1,authority:'approved-configuration',trigger:'form.accepted',audiences:['submitter'],
   variables:{businessName:{source:'config',type:'text-line'},reference:{source:'platform',type:'reference'},service:{source:'record',type:'choice'},day:{source:'record',type:'choice'}},
   subject:[{text:'We received your appointment request ('},{var:'reference'},{text:')'}],
   body:[{text:''},{var:'businessName'},{text:' received your appointment request.\n\nReference: '},{var:'reference'},{text:'\nService: '},{var:'service'},{text:'\nPreferred day: '},{var:'day'},{text:'\n\nThis is a request, not a confirmed booking. The business will contact you to confirm.'},...stopSubmitter]})},
  'account.email-confirm@1':{state:'available',readiness:'planned',template:template({id:'account.email-confirm',version:1,authority:'platform-obligation',trigger:'account.notice',audiences:['account-email'],
   variables:{confirmationCode:{source:'platform',type:'token'}},
   subject:[{text:'Confirm your new Whumpo account email'}],
   body:[{text:'Someone asked to use this address as the email for a Whumpo account. Your confirmation code is '},{var:'confirmationCode'},{text:'\n\nWhile signed in, enter it in Settings within one hour: '},{link:'workspace-settings'},{text:'\n\nIf you did not ask for this, ignore this email; nothing changes unless the code is entered in a signed-in session.'}]})},
  ...tpl(accountTemplate('account.email-change-requested','A change to your Whumpo account email was requested','A request was made to change the email address of your Whumpo account. Nothing has changed yet. You can cancel the request in Settings.')),
  ...tpl(accountTemplate('account.email-change-completed','Your Whumpo account email was changed','The email address of your Whumpo account was changed. You can undo the change in Settings for a limited time.')),
  ...tpl(accountTemplate('account.email-change-undone','A Whumpo account email change was undone','A change to the email address of a Whumpo account was undone.')),
  ...tpl(accountTemplate('account.security-review-completed','Your Whumpo security review was completed','A security review of your Whumpo account was completed. Access that was removed or replaced no longer works.')),
  ...tpl(accountTemplate('account.passkey-added','A passkey was added to your Whumpo account','A new passkey was added to your Whumpo account.')),
  ...tpl(accountTemplate('account.passkey-removed','A passkey was removed from your Whumpo account','A passkey was removed from your Whumpo account.')),
  ...tpl(accountTemplate('account.recovery-started','Recovery was started on your Whumpo account','Account recovery was started for your Whumpo account. You can rotate your recovery kit from a signed-in session to stop it.')),
  ...tpl(accountTemplate('account.recovery-secured','Recovery was completed on your Whumpo account','Account recovery was completed and a new passkey now secures your Whumpo account.')),
  ...tpl(accountTemplate('account.kit-rotated','Your Whumpo recovery kit was replaced','The recovery kit for your Whumpo account was replaced. The old kit no longer works.')),
  'support.response-saved@1':{state:'available',readiness:'planned',template:template({id:'support.response-saved',version:1,authority:'platform-obligation',trigger:'account.notice',audiences:['account-email'],variables:{},
   subject:[{text:'A response to your Whumpo request is saved'}],
   body:[{text:'A response to your Whumpo request is saved in your account. This email does not contain the response.\n\nOpen Whumpo to read it: '},{link:'workspace-settings'},{text:'\n\nIf you did not make a request to Whumpo, open Whumpo and review your account security.'}]})},
 },
});

export function validateNotificationTemplate(t:unknown,path='template'):t is NotificationTemplate{
 noRelayOrSecret(t,path);
 shape(t,['contractVersion','id','version','purpose','authority','trigger','audiences','variables','subject','body'],path);
 check(t.contractVersion===notificationContractVersion,'UNSUPPORTED_VERSION',`${path}.contractVersion`);
 check(typeof t.id==='string'&&/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/.test(t.id)&&t.id.length<=60,'INVALID_ID',`${path}.id`);
 check(Number.isSafeInteger(t.version)&&(t.version as number)>=1,'INVALID_VERSION',`${path}.version`);
 check(t.purpose==='transactional','NOT_TRANSACTIONAL',`${path}.purpose`);
 check((authorityClasses as readonly unknown[]).includes(t.authority),'UNKNOWN_AUTHORITY',`${path}.authority`);
 check((notificationTriggers as readonly unknown[]).includes(t.trigger),'UNKNOWN_TRIGGER',`${path}.trigger`);
 const audiences=t.audiences;
 check(Array.isArray(audiences)&&audiences.length>=1&&audiences.every(a=>(recipientScopes as readonly unknown[]).includes(a))&&new Set(audiences).size===audiences.length,'UNKNOWN_SCOPE',`${path}.audiences`);
 const scopes=audiences as unknown[];
 // Platform obligations notify the owner's own verified destination; customer configurations run only on accepted records.
 if(t.authority==='platform-obligation')check(t.trigger!=='form.accepted'&&scopes.every(a=>a==='owner-destination'||a==='account-email'),'AUTHORITY_MISMATCH',path);
 else check(t.trigger==='form.accepted','AUTHORITY_MISMATCH',path);
 const variables=t.variables;
 check(plain(variables),'INVALID_SHAPE',`${path}.variables`);
 for(const [name,v] of Object.entries(variables as Plain)){
  check(/^[a-z][A-Za-z0-9]{0,30}$/.test(name),'INVALID_ID',`${path}.variables.${name}`);
  shape(v,['source','type'],`${path}.variables.${name}`);
  check(typeof v.source==='string'&&Object.hasOwn(variableSources,v.source)&&variableSources[v.source].includes(v.type as string),'INVALID_VARIABLE',`${path}.variables.${name}`);
  // Owner and staff notices are content-free: no visitor-submitted value leaves the private panel by email.
  if(v.source==='record')check(scopes.length===1&&scopes[0]==='submitter','CONTENT_IN_NOTICE',`${path}.variables.${name}`);
  if(v.type==='code')check(t.trigger==='destination.verification','INVALID_VARIABLE',`${path}.variables.${name}`);
  if(v.type==='token')check(t.trigger==='account.notice','INVALID_VARIABLE',`${path}.variables.${name}`);
 }
 const used=new Set<string>();
 const segments=(list:unknown,where:string,multiline:boolean,maxChars:number)=>{
  check(Array.isArray(list)&&list.length>=1&&list.length<=40,'INVALID_SHAPE',`${path}.${where}`);
  let chars=0;
  (list as unknown[]).forEach((s,i)=>{
   const p=`${path}.${where}[${i}]`;check(plain(s)&&Object.keys(s).length===1,'INVALID_SEGMENT',p);
   const seg=s as Plain;
   if(Object.hasOwn(seg,'text')){
    const text=seg.text;
    check(typeof text==='string'&&(multiline?!/[\u0000-\u0009\u000b-\u001f\u007f]/.test(text):lineSafe(text)),'HEADER_INJECTION',p);
    check(!/\{\{|\}\}|\$\{/.test(text as string),'TEMPLATE_SYNTAX',p);chars+=(text as string).length;
   }else if(Object.hasOwn(seg,'var')){check(typeof seg.var==='string'&&Object.hasOwn(variables as Plain,seg.var),'UNDECLARED_VARIABLE',p);used.add(seg.var as string);chars+=80;}
   else if(Object.hasOwn(seg,'link')){check(multiline&&typeof seg.link==='string'&&Object.hasOwn(platformLinks,seg.link),'UNKNOWN_LINK',p);chars+=platformLinks[seg.link as string].length;}
   else check(false,'INVALID_SEGMENT',p);
  });
  check(chars<=maxChars,'TOO_LONG',`${path}.${where}`);
 };
 segments(t.subject,'subject',false,notificationBounds.subjectChars);
 segments(t.body,'body',true,notificationBounds.bodyChars);
 check(Object.keys(variables as Plain).every(n=>used.has(n)),'UNUSED_VARIABLE',`${path}.variables`);
 return true;
}

export function validateNotificationCatalog(c:unknown):c is NotificationCatalog{
 shape(c,['contractVersion','providers','senders','templates'],'catalog');
 check(c.contractVersion===notificationContractVersion,'UNSUPPORTED_VERSION','catalog.contractVersion');
 check(plain(c.providers)&&plain(c.senders)&&plain(c.templates),'INVALID_SHAPE','catalog');
 const providers=c.providers as Plain;
 for(const [id,p] of Object.entries(providers)){
  const path=`providers.${id}`;
  shape(p,['readiness','review','price','ceiling','idempotency','events','lookup','errorClasses'],path);
  check((readinessLevels as readonly unknown[]).includes(p.readiness),'UNKNOWN_READINESS',path);
  check(p.review===null||(plain(p.review)&&typeof p.review.reference==='string'&&p.review.reference.length>0),'INVALID_REVIEW',path);
  if(p.price!==null){shape(p.price,['basis','currency','microsPerCall','includedPerMonth','checkedAt','entitlement'],`${path}.price`);check(Number.isSafeInteger(p.price.microsPerCall)&&(p.price.microsPerCall as number)>=0,'INVALID_PRICE',path);}
  check(p.ceiling===null||(plain(p.ceiling)&&Number.isSafeInteger(p.ceiling.callsPer32Days)&&(p.ceiling.callsPer32Days as number)>0),'INVALID_CEILING',path);
  check(['none','provider-idempotency-key'].includes(p.idempotency as string),'INVALID_IDEMPOTENCY',path);
  shape(p.errorClasses,['notTaken','rejected','suppressed'],`${path}.errorClasses`);
 }
 for(const [id,s] of Object.entries(c.senders as Plain)){
  const path=`senders.${id}`;
  shape(s,['address','displayName','provider','domainOwner','state','dnsReview'],path);
  check(typeof s.provider==='string'&&Object.hasOwn(providers,s.provider),'UNKNOWN_PROVIDER',path);
  check(['verified','unverified','planned'].includes(s.state as string),'INVALID_SENDER',path);
  check(['platform','customer'].includes(s.domainOwner as string),'INVALID_SENDER',path);
  check(typeof s.displayName==='string'&&/^[A-Za-z0-9 ]{1,40}$/.test(s.displayName),'HEADER_INJECTION',`${path}.displayName`);
  if(s.state==='verified')check(typeof s.dnsReview==='string'&&s.dnsReview.length>0,'UNREVIEWED_SENDER',path);
 }
 for(const [key,e] of Object.entries(c.templates as Plain)){
  shape(e,['state','readiness','template'],`templates.${key}`);
  check(['available','withdrawn'].includes(e.state as string),'INVALID_STATE',`templates.${key}`);
  check((readinessLevels as readonly unknown[]).includes(e.readiness),'UNKNOWN_READINESS',`templates.${key}`);
  const t=e.template;
  check(validateNotificationTemplate(t,`templates.${key}.template`)&&key===`${t.id}@${t.version}`,'INVALID_ID',`templates.${key}`);
 }
 return true;
}
export const notificationTemplateDigest=(t:NotificationTemplate)=>notificationDigest(t);

export type ProviderErrorClass='suppressed'|'not-taken'|'rejected'|'uncertain';
/** Classify a provider error code. Unknown codes, internal errors, throws and timeouts are uncertain. */
export function classifyProviderError(providerId:string,code:string,catalog:NotificationCatalog=notificationCatalog):ProviderErrorClass{
 const e=Object.hasOwn(catalog.providers,providerId)?catalog.providers[providerId].errorClasses:null;
 if(!e)return 'uncertain';
 if(e.suppressed.includes(code))return 'suppressed';
 if(e.notTaken.includes(code))return 'not-taken';
 if(e.rejected.includes(code))return 'rejected';
 return 'uncertain';
}

/** Customer notification configuration v1: one template, one trigger, one recipient scope, one sender. Never an address. */
export async function validateNotificationConfiguration(cfg:unknown,catalog:NotificationCatalog=notificationCatalog){
 noRelayOrSecret(cfg,'configuration');
 shape(cfg,['contractVersion','id','template','trigger','recipientScope','sender','values','fields','limits'],'configuration');
 check(cfg.contractVersion===notificationContractVersion,'UNSUPPORTED_VERSION','configuration.contractVersion');
 check(typeof cfg.id==='string'&&/^[a-z][a-z0-9-]{0,39}$/.test(cfg.id),'INVALID_ID','configuration.id');
 const pin=cfg.template;
 shape(pin,['id','version','digest'],'configuration.template');
 const key=`${String(pin.id)}@${String(pin.version)}`;
 check(Object.hasOwn(catalog.templates,key),'UNKNOWN_TEMPLATE','configuration.template');
 const entry=catalog.templates[key];
 check(entry.state==='available','TEMPLATE_WITHDRAWN','configuration.template');
 const t=entry.template;
 check(pin.digest===await notificationTemplateDigest(t),'STALE_TEMPLATE','configuration.template.digest');
 check(t.authority==='approved-configuration','PLATFORM_TEMPLATE','configuration.template');
 const trigger=cfg.trigger;
 shape(trigger,['event','resourceId','formId'],'configuration.trigger');
 check(trigger.event===t.trigger,'TRIGGER_MISMATCH','configuration.trigger.event');
 check(typeof trigger.resourceId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(trigger.resourceId),'INVALID_ID','configuration.trigger.resourceId');
 check(typeof trigger.formId==='string'&&/^[a-z][a-z0-9-]{0,39}$/.test(trigger.formId),'INVALID_ID','configuration.trigger.formId');
 check((t.audiences as unknown[]).includes(cfg.recipientScope),'SCOPE_NOT_ALLOWED','configuration.recipientScope');
 check(typeof cfg.sender==='string'&&Object.hasOwn(catalog.senders,cfg.sender),'UNKNOWN_SENDER','configuration.sender');
 const sender=catalog.senders[cfg.sender as string];
 check(sender.state==='verified','SENDER_NOT_VERIFIED','configuration.sender');
 const provider=catalog.providers[sender.provider];
 check(provider.review,'UNREVIEWED_PROVIDER','configuration.sender');
 check(provider.price,'UNPRICED_PROVIDER','configuration.sender');
 check(provider.ceiling,'UNBOUNDED_CHARGE','configuration.sender');
 const values=cfg.values,fields=cfg.fields;
 check(plain(values)&&plain(fields),'INVALID_SHAPE','configuration');
 const vals=values as Plain,flds=fields as Plain;
 const configVars=Object.entries(t.variables).filter(([,v])=>v.source==='config').map(([n])=>n);
 const recordVars=Object.entries(t.variables).filter(([,v])=>v.source==='record').map(([n])=>n);
 check(Object.keys(vals).every(k=>configVars.includes(k))&&configVars.every(k=>Object.hasOwn(vals,k)),'UNKNOWN_FIELD','configuration.values');
 for(const k of configVars){
  const v=vals[k];
  check(typeof v==='string'&&lineSafe(v),'HEADER_INJECTION',`configuration.values.${k}`);
  check(!urlOrAddress(v as string),'CONFIG_URL',`configuration.values.${k}`);
  check(variableTypes['text-line'](v),'INVALID_VALUE',`configuration.values.${k}`);
 }
 check(Object.keys(flds).every(k=>recordVars.includes(k))&&recordVars.every(k=>Object.hasOwn(flds,k)),'UNKNOWN_FIELD','configuration.fields');
 for(const k of recordVars)check(typeof flds[k]==='string'&&/^[a-z][a-z0-9_]{0,39}$/.test(flds[k] as string),'INVALID_ID',`configuration.fields.${k}`);
 const limits=cfg.limits;
 shape(limits,['perRecipientHour','perRecipientDay'],'configuration.limits');
 const hour=limits.perRecipientHour as number,day=limits.perRecipientDay as number;
 check(Number.isSafeInteger(hour)&&hour>=1&&hour<=notificationBounds.perRecipientHour,'LIMIT_TOO_HIGH','configuration.limits.perRecipientHour');
 check(Number.isSafeInteger(day)&&day>=hour&&day<=notificationBounds.perRecipientDay,'LIMIT_TOO_HIGH','configuration.limits.perRecipientDay');
 return {template:t,sender,provider,price:provider.price,configurationDigest:await notificationDigest(cfg)};
}

/** Render a template with typed values. Returns plain text; values are data, never template syntax or markup. */
export function renderNotification(t:NotificationTemplate,values:Readonly<Record<string,unknown>>,fields:Readonly<Record<string,{options?:unknown}>>={}){
 const value=(name:string)=>{
  const spec=t.variables[name],v=Object.hasOwn(values,name)?values[name]:undefined;
  check(spec&&variableTypes[spec.type](v,Object.hasOwn(fields,name)?fields[name]:undefined),'INVALID_VARIABLE',`render.${name}`);
  return String(v);
 };
 const join=(list:Segment[])=>list.map(s=>'text' in s?s.text:'var' in s?value(s.var):platformLinks[s.link]).join('');
 const subject=join(t.subject),text=join(t.body);
 check(lineSafe(subject)&&subject.length<=notificationBounds.subjectChars,'HEADER_INJECTION','render.subject');
 return {subject,text};
}
/** Render an available catalog entry by key. Unknown and withdrawn templates are refused; there is no fallback version. */
export function renderCatalogNotification(key:string,values:Readonly<Record<string,unknown>>={},fields:Readonly<Record<string,{options?:unknown}>>={},catalog:NotificationCatalog=notificationCatalog){
 check(Object.hasOwn(catalog.templates,key),'UNKNOWN_TEMPLATE',key);
 const entry=catalog.templates[key];
 check(entry.state==='available','TEMPLATE_WITHDRAWN',key);
 return renderNotification(entry.template,values,fields);
}
