import {copyJSON,jsonDigest,plain,SpecificationError} from './project-specification/v2/json';
/**
 * WH-155 source notification catalog (docs/notifications.md, contract version 1). One maintained, deeply frozen catalog holds the
 * templates with their canonical digests, the fixed platform sender, the reviewed provider facts and the provider error classes,
 * with closed validators and a deterministic plain-text segment renderer. The WH-036 contact notices are rendered through it.
 *
 * This is a catalog and renderer only. It stores nothing, calls no provider, reads no binding, schedules nothing and changes no
 * schema. A catalog entry never activates anything: `readiness` is metadata, the planned appointment templates stay `planned`
 * and `renderNotification` refuses them. No model, owner-maintenance context or credential is reachable from this module; the
 * offline reference it must agree with (tools/prototypes/notifications.mjs) is never imported by a Worker.
 */
export class NotificationCatalogError extends Error {
 constructor(readonly code:string,readonly path:string){super(`${code}: ${path}`);}
}
function check(ok:unknown,code:string,path:string):asserts ok {if(!ok)throw new NotificationCatalogError(code,path);}
// Untrusted JSON is validated field by field; its shape is checked before any member is read.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json=any;
function shape(value:unknown,keys:readonly string[],path:string){
 check(plain(value),'INVALID_SHAPE',path);
 check(Object.keys(value).every(key=>keys.includes(key)),'UNKNOWN_FIELD',path);
 check(keys.every(key=>Object.hasOwn(value,key)),'MISSING_FIELD',path);
}
/** Copies caller-owned data before any await or repeated read. Accessors, toJSON hooks and non-JSON values are refused. */
function snapshot(value:unknown,path:string,maxBytes=32768):Json {
 try{return copyJSON(value,maxBytes);}
 catch(cause){if(cause instanceof SpecificationError)throw new NotificationCatalogError(cause.code,path);throw cause;}
}
function deepFreeze<T>(value:T):T {
 if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const member of Object.values(value))deepFreeze(member);}
 return value;
}

export type NotificationScope='owner-destination'|'project-staff'|'submitter';
export type NotificationAuthority='platform-obligation'|'approved-configuration';
export type NotificationTrigger='contact.accepted'|'destination.verification'|'form.accepted';
export type NotificationReadiness='planned'|'synthetic-conformant'|'source'|'live-accepted';
export type VariableType='text-line'|'choice'|'number'|'boolean'|'reference'|'code';
export type Segment={text:string}|{var:string}|{link:string};
export type NotificationTemplate={contractVersion:1;id:string;version:number;purpose:'transactional';authority:NotificationAuthority;trigger:NotificationTrigger;audiences:readonly NotificationScope[];variables:Readonly<Record<string,{source:'config'|'record'|'platform';type:VariableType}>>;subject:readonly Segment[];body:readonly Segment[]};
export type CatalogTemplate={state:'available'|'withdrawn';readiness:NotificationReadiness;digest:string;template:NotificationTemplate};
export type CatalogSender={address:string;displayName:string;provider:string;domainOwner:'platform'|'customer';state:'verified'|'unverified'|'planned';dnsReview:string};
export type CatalogProvider={readiness:NotificationReadiness;review:{reference:string;reviewedAt:string}|null;price:{basis:'metered'|'flat';currency:string;microsPerCall:number;includedPerMonth:number;checkedAt:string;entitlement:'requires-verification'|'verified'}|null;ceiling:{callsPer32Days:number}|null;idempotency:'none'|'provider-idempotency-key';events:'not-configured'|'authenticated';lookup:'none'|'by-notice-marker'|'by-message-id';errorClasses:{notTaken:readonly string[];rejected:readonly string[];suppressed:readonly string[]}};
export type NotificationCatalog={contractVersion:1;providers:Readonly<Record<string,CatalogProvider>>;senders:Readonly<Record<string,CatalogSender>>;templates:Readonly<Record<string,CatalogTemplate>>};
export type ProviderErrorClass='suppressed'|'not-taken'|'rejected'|'uncertain';

/** Closed vocabularies (contract version 1). Everything below is deeply frozen: no caller can widen a registry. */
export const notificationContractVersion=1;
export const recipientScopes:readonly NotificationScope[]=deepFreeze(['owner-destination','project-staff','submitter']);
export const authorityClasses:readonly NotificationAuthority[]=deepFreeze(['platform-obligation','approved-configuration']);
export const notificationTriggers:readonly NotificationTrigger[]=deepFreeze(['contact.accepted','destination.verification','form.accepted']);
export const readinessLevels:readonly NotificationReadiness[]=deepFreeze(['planned','synthetic-conformant','source','live-accepted']);
/** Readiness levels whose templates may be rendered for a notice. `planned` and `synthetic-conformant` entries are declarations only. */
export const renderableReadiness:readonly NotificationReadiness[]=deepFreeze(['source','live-accepted']);
export const notificationBounds=deepFreeze({maxAttempts:6,leaseMs:60000,reconcileReads:3,reconcileWindowMs:72*3600000,noticeTtlMs:24*3600000,subjectChars:120,bodyChars:4000,perRecipientHour:10,perRecipientDay:50});
/** Fixed platform links. A template names one by ID; no variable, configuration or caller supplies a URL. */
export const platformLinks:Readonly<Record<string,string>>=deepFreeze({'workspace-inbox':'https://whumpo.com/workspace/inbox','workspace-records':'https://whumpo.com/workspace/records'});
// Keys that would let a caller, configuration or template choose a destination, header, URL or credential.
const relayKeys:readonly string[]=deepFreeze(['to','cc','bcc','recipient','recipients','address','addresses','email','emails','replyto','reply_to','from','headers','header','url','urls','href','webhook','callback','returnpath','return_path']);
const secretKey=/^(api[_-]?key|token|secret|password|authorization|credential|credentials|bearer|private[_-]?key|binding)$/i;
function noRelayOrSecret(value:unknown,path:string,depth=0){
 check(depth<=12,'TOO_DEEP',path);
 if(Array.isArray(value)){value.forEach((member,i)=>noRelayOrSecret(member,`${path}[${i}]`,depth+1));return;}
 if(!plain(value))return;
 for(const [key,member] of Object.entries(value)){
  check(!secretKey.test(key),'SECRET_FIELD',`${path}.${key}`);
  check(!relayKeys.includes(key.toLowerCase()),'OPEN_RELAY',`${path}.${key}`);
  noRelayOrSecret(member,`${path}.${key}`,depth+1);
 }
}
const separators=[String.fromCharCode(0x2028),String.fromCharCode(0x2029)];
const lineSafe=(value:string)=>!/[\u0000-\u001f\u007f]/.test(value)&&!separators.some(c=>value.includes(c));
const urlOrAddress=(value:string)=>/@|[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\.(com|net|org|io|site|app)\b/i.test(value);
type FieldSpec={options?:readonly string[]}|undefined;
/** Variable types. Every value is validated at render; values are inserted as data and never re-parsed. */
export const variableTypes:Readonly<Record<VariableType,(value:unknown,field?:FieldSpec)=>boolean>>=deepFreeze({
 'text-line':(v:unknown)=>typeof v==='string'&&v.length>=1&&v.length<=80&&lineSafe(v)&&!/[<>]/.test(v)&&!urlOrAddress(v),
 choice:(v:unknown,field?:FieldSpec)=>typeof v==='string'&&Array.isArray(field?.options)&&field.options.includes(v)&&lineSafe(v)&&v.length<=80,
 number:(v:unknown)=>typeof v==='number'&&Number.isSafeInteger(v)&&Math.abs(v)<=1e9,
 boolean:(v:unknown)=>typeof v==='boolean',
 reference:(v:unknown)=>typeof v==='string'&&/^[A-F0-9]{8}$/.test(v),
 code:(v:unknown)=>typeof v==='string'&&/^[A-Z0-9]{8}$/.test(v),
});
const variableSources:Readonly<Record<string,readonly VariableType[]>>=deepFreeze({config:['text-line'],record:['choice','number','boolean'],platform:['reference','code']});

const contactFooter:readonly Segment[]=[{text:'\n\nYou receive this because this address was added and verified for contact-form notices in Whumpo. To stop them, remove the address in Dashboard → Contact inbox ('},{link:'workspace-inbox'},{text:').'}];
const stopStaff:readonly Segment[]=[{text:'\n\nYou receive this because you turned on appointment notices for this business in its staff area. Turn them off there at any time.'}];
const stopSubmitter:readonly Segment[]=[{text:'\n\nYou receive this because you asked for an email receipt when you sent the request. This is a one-time receipt; you will not be added to any mailing list.'}];
const template=(o:Omit<NotificationTemplate,'contractVersion'|'purpose'|'variables'>&{variables?:NotificationTemplate['variables']}):NotificationTemplate=>({contractVersion:1,purpose:'transactional',variables:{},...o});

/**
 * Frozen v1 catalog. `digest` is the SHA-256 of the template's canonical JSON, pinned here so any template edit is visible and
 * must be accepted by `validateNotificationCatalog`. The WH-036 provider review and Cloudflare facts below are the historical
 * October 4, 2026 owner review and the October 8, 2026 documentation read recorded in docs/notifications.md; this slice does not
 * re-verify them, add a provider, sender, binding or DNS record, or claim any activation. Planned entries are declarations only.
 */
export const notificationCatalog:NotificationCatalog=deepFreeze({
 contractVersion:1,
 providers:{
  'cloudflare-email':{readiness:'source',review:{reference:'issue-146-2026-10-04',reviewedAt:'2026-10-04'},
   price:{basis:'metered',currency:'USD',microsPerCall:350,includedPerMonth:3000,checkedAt:'2026-10-08',entitlement:'requires-verification'},
   ceiling:{callsPer32Days:14285},idempotency:'none',events:'not-configured',lookup:'none',
   errorClasses:{
    notTaken:['E_RATE_LIMIT_EXCEEDED','E_DAILY_LIMIT_EXCEEDED','E_SENDER_NOT_VERIFIED','E_SENDER_DOMAIN_NOT_AVAILABLE'],
    rejected:['E_VALIDATION_ERROR','E_FIELD_MISSING','E_TOO_MANY_RECIPIENTS','E_TOO_MANY_ATTACHMENTS','E_RECIPIENT_NOT_ALLOWED','E_CONTENT_TOO_LARGE','E_DELIVERY_FAILED','E_HEADER_NOT_ALLOWED','E_HEADER_USE_API_FIELD','E_HEADER_VALUE_INVALID','E_HEADER_VALUE_TOO_LONG','E_HEADER_NAME_INVALID','E_HEADERS_TOO_LARGE','E_HEADERS_TOO_MANY'],
    suppressed:['E_RECIPIENT_SUPPRESSED']}},
 },
 senders:{
  'whumpo-notify':{address:'notify@whumpo.com',displayName:'Whumpo',provider:'cloudflare-email',domainOwner:'platform',state:'verified',dnsReview:'2026-10-04-whumpo-com-email-sending'},
 },
 templates:{
  'contact.new-message@1':{state:'available',readiness:'source',digest:'484d37777ee887c27a9dc5a2eed9decfff721c9fb4a7778b7528e99502f73ad6',template:template({id:'contact.new-message',version:1,authority:'platform-obligation',trigger:'contact.accepted',audiences:['owner-destination'],
   subject:[{text:'New contact-form message in Whumpo'}],
   body:[{text:'A visitor sent a new message through a contact form on one of your Whumpo websites.\n\nRead it in your private inbox: '},{link:'workspace-inbox'},{text:'\n\nThis notice does not include the message.'},...contactFooter]})},
  'owner.destination-verification@1':{state:'available',readiness:'source',digest:'76a687aae34eaf2a7dc49db21d8a492c72e78e9d4e524c95556abcd66b6f0706',template:template({id:'owner.destination-verification',version:1,authority:'platform-obligation',trigger:'destination.verification',audiences:['owner-destination'],
   variables:{code:{source:'platform',type:'code'}},
   subject:[{text:'Your Whumpo verification code'}],
   body:[{text:'Your Whumpo verification code is '},{var:'code'},{text:'\n\nEnter it in Dashboard → Contact inbox within one hour to receive contact-form notices at this address. If you did not ask for this, ignore this email; nothing will be sent unless the code is entered.'}]})},
  'appointment.staff-notice@1':{state:'available',readiness:'planned',digest:'16c4a9053f54c1257774ac5a5d7f3620b74bcc6cf9d6f5eab6020dedf8d47f70',template:template({id:'appointment.staff-notice',version:1,authority:'approved-configuration',trigger:'form.accepted',audiences:['owner-destination','project-staff'],
   variables:{businessName:{source:'config',type:'text-line'}},
   subject:[{text:'New appointment request for '},{var:'businessName'}],
   body:[{text:'A new appointment request arrived for '},{var:'businessName'},{text:'.\n\nOpen the request list to review it: '},{link:'workspace-records'},{text:'\n\nThis notice does not include the request details.'},...stopStaff]})},
  'appointment.request-receipt@1':{state:'available',readiness:'planned',digest:'f9a0b68948e32ed4f152844c975146321f0089ae045478567725b70035082fe7',template:template({id:'appointment.request-receipt',version:1,authority:'approved-configuration',trigger:'form.accepted',audiences:['submitter'],
   variables:{businessName:{source:'config',type:'text-line'},reference:{source:'platform',type:'reference'},service:{source:'record',type:'choice'},day:{source:'record',type:'choice'}},
   subject:[{text:'We received your appointment request ('},{var:'reference'},{text:')'}],
   body:[{text:''},{var:'businessName'},{text:' received your appointment request.\n\nReference: '},{var:'reference'},{text:'\nService: '},{var:'service'},{text:'\nPreferred day: '},{var:'day'},{text:'\n\nThis is a request, not a confirmed booking. The business will contact you to confirm.'},...stopSubmitter]})},
 },
});

/** Validates one template and returns a private, frozen copy. Nothing is parsed as a template language: text is literal. */
export function validateNotificationTemplate(input:unknown,path='template'):NotificationTemplate {
 const t=snapshot(input,path);
 noRelayOrSecret(t,path);
 shape(t,['contractVersion','id','version','purpose','authority','trigger','audiences','variables','subject','body'],path);
 check(t.contractVersion===notificationContractVersion,'UNSUPPORTED_VERSION',`${path}.contractVersion`);
 check(typeof t.id==='string'&&/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/.test(t.id)&&t.id.length<=60,'INVALID_ID',`${path}.id`);
 check(Number.isSafeInteger(t.version)&&t.version>=1,'INVALID_VERSION',`${path}.version`);
 check(t.purpose==='transactional','NOT_TRANSACTIONAL',`${path}.purpose`);
 check(authorityClasses.includes(t.authority),'UNKNOWN_AUTHORITY',`${path}.authority`);
 check(notificationTriggers.includes(t.trigger),'UNKNOWN_TRIGGER',`${path}.trigger`);
 check(Array.isArray(t.audiences)&&t.audiences.length>=1&&t.audiences.every((a:unknown)=>recipientScopes.includes(a as NotificationScope))&&new Set(t.audiences).size===t.audiences.length,'UNKNOWN_SCOPE',`${path}.audiences`);
 // Platform obligations notify the owner's own verified destination; customer configurations run only on accepted records.
 if(t.authority==='platform-obligation')check(t.trigger!=='form.accepted'&&t.audiences.every((a:string)=>a==='owner-destination'),'AUTHORITY_MISMATCH',path);
 else check(t.trigger==='form.accepted','AUTHORITY_MISMATCH',path);
 check(plain(t.variables),'INVALID_SHAPE',`${path}.variables`);
 for(const [name,variable] of Object.entries<Json>(t.variables)){
  check(/^[a-z][A-Za-z0-9]{0,30}$/.test(name),'INVALID_ID',`${path}.variables.${name}`);
  shape(variable,['source','type'],`${path}.variables.${name}`);
  check(Object.hasOwn(variableSources,variable.source)&&variableSources[variable.source].includes(variable.type),'INVALID_VARIABLE',`${path}.variables.${name}`);
  // Owner and staff notices are content-free: no visitor-submitted value leaves the private panel by email.
  if(variable.source==='record')check(t.audiences.length===1&&t.audiences[0]==='submitter','CONTENT_IN_NOTICE',`${path}.variables.${name}`);
  if(variable.type==='code')check(t.trigger==='destination.verification','INVALID_VARIABLE',`${path}.variables.${name}`);
 }
 const used=new Set<string>();
 const segments=(list:unknown,where:string,multiline:boolean,maxChars:number)=>{
  check(Array.isArray(list)&&list.length>=1&&list.length<=40,'INVALID_SHAPE',`${path}.${where}`);
  let chars=0;
  list.forEach((s:Json,i:number)=>{
   const at=`${path}.${where}[${i}]`;check(plain(s)&&Object.keys(s).length===1,'INVALID_SEGMENT',at);
   if(Object.hasOwn(s,'text')){
    check(typeof s.text==='string'&&(multiline?!/[\u0000-\u0009\u000b-\u001f\u007f]/.test(s.text):lineSafe(s.text)),'HEADER_INJECTION',at);
    check(!/\{\{|\}\}|\$\{/.test(s.text),'TEMPLATE_SYNTAX',at);chars+=s.text.length;
   }else if(Object.hasOwn(s,'var')){check(typeof s.var==='string'&&Object.hasOwn(t.variables,s.var),'UNDECLARED_VARIABLE',at);used.add(s.var);chars+=80;}
   else if(Object.hasOwn(s,'link')){check(multiline&&typeof s.link==='string'&&Object.hasOwn(platformLinks,s.link),'UNKNOWN_LINK',at);chars+=platformLinks[s.link].length;}
   else check(false,'INVALID_SEGMENT',at);
  });
  check(chars<=maxChars,'TOO_LONG',`${path}.${where}`);
 };
 segments(t.subject,'subject',false,notificationBounds.subjectChars);
 segments(t.body,'body',true,notificationBounds.bodyChars);
 check(Object.keys(t.variables).every(n=>used.has(n)),'UNUSED_VARIABLE',`${path}.variables`);
 return deepFreeze(t);
}

/** SHA-256 (hex) of the canonical JSON. The canonical text is computed before the first await, so later caller edits cannot change it. */
export async function templateDigest(templateValue:unknown):Promise<string> {return jsonDigest(templateValue);}
const isoDate=/^\d{4}-\d{2}-\d{2}$/;
const mailbox=/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const catalogBytes=65536;

/**
 * Validates a whole catalog (providers, senders, templates and every pinned template digest) and returns a frozen private copy.
 * Async only because Web Crypto digests are; the input is copied before the first await.
 */
export async function validateNotificationCatalog(input:unknown):Promise<NotificationCatalog> {
 const c=snapshot(input,'catalog',catalogBytes);
 shape(c,['contractVersion','providers','senders','templates'],'catalog');
 check(c.contractVersion===notificationContractVersion,'UNSUPPORTED_VERSION','catalog.contractVersion');
 check(plain(c.providers)&&plain(c.senders)&&plain(c.templates),'INVALID_SHAPE','catalog');
 for(const [id,p] of Object.entries<Json>(c.providers)){
  const path=`providers.${id}`;
  check(/^[a-z][a-z0-9-]{0,39}$/.test(id),'INVALID_ID',path);
  shape(p,['readiness','review','price','ceiling','idempotency','events','lookup','errorClasses'],path);
  check(readinessLevels.includes(p.readiness),'UNKNOWN_READINESS',path);
  if(p.review!==null){shape(p.review,['reference','reviewedAt'],`${path}.review`);check(typeof p.review.reference==='string'&&p.review.reference.length>0&&p.review.reference.length<=200&&lineSafe(p.review.reference)&&typeof p.review.reviewedAt==='string'&&isoDate.test(p.review.reviewedAt),'INVALID_REVIEW',path);}
  if(p.price!==null){
   shape(p.price,['basis','currency','microsPerCall','includedPerMonth','checkedAt','entitlement'],`${path}.price`);
   check(['metered','flat'].includes(p.price.basis)&&typeof p.price.currency==='string'&&/^[A-Z]{3}$/.test(p.price.currency)&&Number.isSafeInteger(p.price.microsPerCall)&&p.price.microsPerCall>=0&&Number.isSafeInteger(p.price.includedPerMonth)&&p.price.includedPerMonth>=0&&typeof p.price.checkedAt==='string'&&isoDate.test(p.price.checkedAt)&&['requires-verification','verified'].includes(p.price.entitlement),'INVALID_PRICE',path);
  }
  if(p.ceiling!==null){shape(p.ceiling,['callsPer32Days'],`${path}.ceiling`);check(Number.isSafeInteger(p.ceiling.callsPer32Days)&&p.ceiling.callsPer32Days>0,'INVALID_CEILING',path);}
  check(['none','provider-idempotency-key'].includes(p.idempotency),'INVALID_IDEMPOTENCY',path);
  check(['not-configured','authenticated'].includes(p.events),'INVALID_EVENTS',path);
  check(['none','by-notice-marker','by-message-id'].includes(p.lookup),'INVALID_LOOKUP',path);
  shape(p.errorClasses,['notTaken','rejected','suppressed'],`${path}.errorClasses`);
  const seen=new Set<string>();
  for(const kind of ['notTaken','rejected','suppressed']){
   check(Array.isArray(p.errorClasses[kind])&&p.errorClasses[kind].every((code:unknown)=>typeof code==='string'&&/^E_[A-Z_]{2,60}$/.test(code)),'INVALID_ERROR_CLASS',`${path}.errorClasses.${kind}`);
   // A code in two classes would make the outcome depend on lookup order.
   for(const code of p.errorClasses[kind]){check(!seen.has(code),'INVALID_ERROR_CLASS',`${path}.errorClasses.${kind}`);seen.add(code);}
  }
 }
 for(const [id,s] of Object.entries<Json>(c.senders)){
  const path=`senders.${id}`;
  check(/^[a-z][a-z0-9-]{0,39}$/.test(id),'INVALID_ID',path);
  shape(s,['address','displayName','provider','domainOwner','state','dnsReview'],path);
  check(typeof s.provider==='string'&&Object.hasOwn(c.providers,s.provider),'UNKNOWN_PROVIDER',path);
  check(['verified','unverified','planned'].includes(s.state),'INVALID_SENDER',path);
  check(['platform','customer'].includes(s.domainOwner),'INVALID_SENDER',path);
  check(typeof s.address==='string'&&s.address.length<=254&&mailbox.test(s.address),'INVALID_SENDER',`${path}.address`);
  check(typeof s.displayName==='string'&&/^[A-Za-z0-9 ]{1,40}$/.test(s.displayName),'HEADER_INJECTION',`${path}.displayName`);
  check(typeof s.dnsReview==='string'&&lineSafe(s.dnsReview),'INVALID_SENDER',`${path}.dnsReview`);
  if(s.state==='verified')check(s.dnsReview.length>0,'UNREVIEWED_SENDER',path);
 }
 const pinned:[string,string,unknown][]=[];
 for(const [key,e] of Object.entries<Json>(c.templates)){
  const path=`templates.${key}`;
  shape(e,['state','readiness','digest','template'],path);
  check(['available','withdrawn'].includes(e.state),'INVALID_STATE',path);
  check(readinessLevels.includes(e.readiness),'UNKNOWN_READINESS',path);
  check(typeof e.digest==='string'&&/^[0-9a-f]{64}$/.test(e.digest),'INVALID_DIGEST',`${path}.digest`);
  const valid=validateNotificationTemplate(e.template,`${path}.template`);
  check(key===`${valid.id}@${valid.version}`,'INVALID_ID',path);
  pinned.push([path,e.digest,e.template]);
 }
 // Digests are checked after every synchronous rule, so a structural error always wins and no rejected promise is left behind.
 const actual=await Promise.all(pinned.map(([,,templateValue])=>templateDigest(templateValue)));
 pinned.forEach(([path,digest],i)=>check(actual[i]===digest,'DIGEST_MISMATCH',`${path}.digest`));
 return deepFreeze(c);
}

/** Classifies a provider error code from the reviewed catalog. Unknown codes, internal errors, throws and timeouts are uncertain. */
export function classifyProviderError(catalog:Pick<NotificationCatalog,'providers'>,providerId:string,code:string):ProviderErrorClass {
 const e=Object.hasOwn(catalog.providers,providerId)?catalog.providers[providerId].errorClasses:null;
 if(!e)return 'uncertain';
 if(e.suppressed.includes(code))return 'suppressed';
 if(e.notTaken.includes(code))return 'not-taken';
 if(e.rejected.includes(code))return 'rejected';
 return 'uncertain';
}

export type ValidatedConfiguration={template:NotificationTemplate;readiness:NotificationReadiness;sender:CatalogSender;provider:CatalogProvider;price:NonNullable<CatalogProvider['price']>;configurationDigest:string};
/**
 * Customer notification configuration v1: one pinned template, one trigger, one recipient scope, one verified sender, closed
 * text slots and bounded limits. Never an address, header, URL, provider or credential. The configuration and a non-default
 * catalog are copied before the first await, and the result is built only from those copies. Validity does not activate a
 * template: `readiness` is returned so the later admission step (WH-158) can refuse `planned` entries.
 */
export async function validateNotificationConfiguration(input:unknown,catalogInput:unknown=notificationCatalog):Promise<ValidatedConfiguration> {
 const cfg=snapshot(input,'configuration'),catalog:NotificationCatalog=catalogInput===notificationCatalog?notificationCatalog:snapshot(catalogInput,'catalog',catalogBytes);
 noRelayOrSecret(cfg,'configuration');
 shape(cfg,['contractVersion','id','template','trigger','recipientScope','sender','values','fields','limits'],'configuration');
 check(cfg.contractVersion===notificationContractVersion,'UNSUPPORTED_VERSION','configuration.contractVersion');
 check(typeof cfg.id==='string'&&/^[a-z][a-z0-9-]{0,39}$/.test(cfg.id),'INVALID_ID','configuration.id');
 shape(cfg.template,['id','version','digest'],'configuration.template');
 check(typeof cfg.template.id==='string'&&Number.isSafeInteger(cfg.template.version),'UNKNOWN_TEMPLATE','configuration.template');
 const key=`${cfg.template.id}@${cfg.template.version}`;
 check(plain(catalog.templates)&&Object.hasOwn(catalog.templates,key),'UNKNOWN_TEMPLATE','configuration.template');
 const entry=catalog.templates[key];
 check(entry.state==='available','TEMPLATE_WITHDRAWN','configuration.template');
 const t=entry.template;
 const [pinned,configurationDigest]=await Promise.all([templateDigest(t),jsonDigest(cfg)]);
 check(cfg.template.digest===pinned,'STALE_TEMPLATE','configuration.template.digest');
 check(t.authority==='approved-configuration','PLATFORM_TEMPLATE','configuration.template');
 shape(cfg.trigger,['event','resourceId','formId'],'configuration.trigger');
 check(cfg.trigger.event===t.trigger,'TRIGGER_MISMATCH','configuration.trigger.event');
 check(typeof cfg.trigger.resourceId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(cfg.trigger.resourceId),'INVALID_ID','configuration.trigger.resourceId');
 check(typeof cfg.trigger.formId==='string'&&/^[a-z][a-z0-9-]{0,39}$/.test(cfg.trigger.formId),'INVALID_ID','configuration.trigger.formId');
 check(t.audiences.includes(cfg.recipientScope),'SCOPE_NOT_ALLOWED','configuration.recipientScope');
 check(typeof cfg.sender==='string'&&plain(catalog.senders)&&Object.hasOwn(catalog.senders,cfg.sender),'UNKNOWN_SENDER','configuration.sender');
 const sender=catalog.senders[cfg.sender];
 check(sender.state==='verified','SENDER_NOT_VERIFIED','configuration.sender');
 check(Object.hasOwn(catalog.providers,sender.provider),'UNKNOWN_PROVIDER','configuration.sender');
 const provider=catalog.providers[sender.provider];
 check(provider.review,'UNREVIEWED_PROVIDER','configuration.sender');
 check(provider.price,'UNPRICED_PROVIDER','configuration.sender');
 check(provider.ceiling,'UNBOUNDED_CHARGE','configuration.sender');
 check(plain(cfg.values)&&plain(cfg.fields),'INVALID_SHAPE','configuration');
 const names=(source:string)=>Object.entries(t.variables).filter(([,v])=>v.source===source).map(([name])=>name);
 const configVars=names('config'),recordVars=names('record');
 check(Object.keys(cfg.values).every(k=>configVars.includes(k))&&configVars.every(k=>Object.hasOwn(cfg.values,k)),'UNKNOWN_FIELD','configuration.values');
 for(const k of configVars){
  const v=cfg.values[k];
  check(typeof v==='string'&&lineSafe(v),'HEADER_INJECTION',`configuration.values.${k}`);
  check(!urlOrAddress(v),'CONFIG_URL',`configuration.values.${k}`);
  check(variableTypes['text-line'](v),'INVALID_VALUE',`configuration.values.${k}`);
 }
 check(Object.keys(cfg.fields).every(k=>recordVars.includes(k))&&recordVars.every(k=>Object.hasOwn(cfg.fields,k)),'UNKNOWN_FIELD','configuration.fields');
 for(const k of recordVars)check(typeof cfg.fields[k]==='string'&&/^[a-z][a-z0-9_]{0,39}$/.test(cfg.fields[k]),'INVALID_ID',`configuration.fields.${k}`);
 shape(cfg.limits,['perRecipientHour','perRecipientDay'],'configuration.limits');
 check(Number.isSafeInteger(cfg.limits.perRecipientHour)&&cfg.limits.perRecipientHour>=1&&cfg.limits.perRecipientHour<=notificationBounds.perRecipientHour,'LIMIT_TOO_HIGH','configuration.limits.perRecipientHour');
 check(Number.isSafeInteger(cfg.limits.perRecipientDay)&&cfg.limits.perRecipientDay>=cfg.limits.perRecipientHour&&cfg.limits.perRecipientDay<=notificationBounds.perRecipientDay,'LIMIT_TOO_HIGH','configuration.limits.perRecipientDay');
 return {template:t,readiness:entry.readiness,sender,provider,price:provider.price,configurationDigest};
}

/**
 * Renders a template with typed values to plain text. Synchronous and deterministic: the template, values and field specs are
 * copied and validated first, values are inserted as data (never re-parsed, never markup), and an unknown value name, a missing
 * value or a value of the wrong type is refused. The subject must remain a single safe line.
 */
export function renderNotificationTemplate(templateValue:unknown,valuesValue:unknown={},fieldsValue:unknown={}):{subject:string;text:string} {
 const t=validateNotificationTemplate(templateValue),values=snapshot(valuesValue,'render.values',4096),fields=snapshot(fieldsValue,'render.fields',4096);
 check(plain(values)&&plain(fields),'INVALID_SHAPE','render');
 check(Object.keys(values).every(name=>Object.hasOwn(t.variables,name)),'UNKNOWN_FIELD','render.values');
 const value=(name:string)=>{
  const v=Object.hasOwn(values,name)?values[name]:undefined;
  check(variableTypes[t.variables[name].type](v,Object.hasOwn(fields,name)?(fields as Record<string,FieldSpec>)[name]:undefined),'INVALID_VARIABLE',`render.${name}`);
  return String(v);
 };
 const join=(list:readonly Segment[])=>list.map(s=>'text' in s?s.text:'var' in s?value(s.var):platformLinks[s.link]).join('');
 const subject=join(t.subject),text=join(t.body);
 check(lineSafe(subject)&&subject.length<=notificationBounds.subjectChars,'HEADER_INJECTION','render.subject');
 return {subject,text};
}

/** Renders a maintained catalog template by key. Withdrawn entries and entries that are not yet source are refused: no fallback to another version. */
export function renderNotification(key:string,values:unknown={},fields:unknown={},catalogInput:unknown=notificationCatalog):{subject:string;text:string} {
 const catalog:NotificationCatalog=catalogInput===notificationCatalog?notificationCatalog:snapshot(catalogInput,'catalog',catalogBytes);
 check(typeof key==='string'&&plain(catalog.templates)&&Object.hasOwn(catalog.templates,key),'UNKNOWN_TEMPLATE','render.template');
 const entry=catalog.templates[key];
 check(entry.state==='available','TEMPLATE_WITHDRAWN','render.template');
 check(renderableReadiness.includes(entry.readiness),'TEMPLATE_NOT_IMPLEMENTED','render.template');
 return renderNotificationTemplate(entry.template,values,fields);
}
