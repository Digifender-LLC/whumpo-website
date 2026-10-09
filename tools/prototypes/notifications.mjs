// WH-068 offline notification contract reference (WH-154). Validates the frozen template, sender, provider and
// configuration shapes and runs a synthetic in-memory runtime for the conformance harness in
// tests/notifications-contract.mjs. It is not D1 storage, a scheduler, an HTTP handler or a provider adapter. No Worker
// imports it. Production code must repeat every predicate inside its committing statements (see docs/notifications.md).
import {createHash} from 'node:crypto';

export class NotificationContractError extends Error {
 constructor(code,path){super(`${code}: ${path}`);this.code=code;}
}
const check=(ok,code,path)=>{if(!ok)throw new NotificationContractError(code,path);};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
function shape(v,keys,path,optional=[]){
 check(plain(v),'INVALID_SHAPE',path);
 check(Object.keys(v).every(k=>keys.includes(k)||optional.includes(k)),'UNKNOWN_FIELD',path);
 check(keys.every(k=>Object.hasOwn(v,k)),'MISSING_FIELD',path);
}
function canonical(v,depth=0){
 check(depth<=12,'TOO_DEEP','json');
 if(v===null||typeof v==='string'||typeof v==='boolean')return JSON.stringify(v);
 if(typeof v==='number'){check(Number.isFinite(v),'INVALID_NUMBER','json');return JSON.stringify(v);}
 if(Array.isArray(v))return '['+v.map(x=>canonical(x,depth+1)).join(',')+']';
 check(plain(v),'INVALID_SHAPE','json');
 return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k],depth+1)).join(',')+'}';
}
export const digest=v=>createHash('sha256').update(canonical(v)).digest('hex');

/** Frozen vocabularies (contract version 1). */
export const contractVersion=1;
export const recipientScopes=Object.freeze(['owner-destination','project-staff','submitter']);
export const authorityClasses=Object.freeze(['platform-obligation','approved-configuration']);
export const triggers=Object.freeze(['contact.accepted','destination.verification','form.accepted']);
export const readinessLevels=Object.freeze(['planned','synthetic-conformant','source','live-accepted']);
export const receiptStates=Object.freeze(['queued','dispatching','accepted','delivered','deferred','bounced','complained','failed','cancelled','unknown-outcome','unresolved']);
/** Allowed receipt transitions. Nothing leaves a terminal state; nothing returns to queued/dispatching after an uncertain call. */
export const transitions=Object.freeze({
 queued:['dispatching','cancelled'],
 dispatching:['accepted','deferred','failed','cancelled','unknown-outcome'],
 deferred:['dispatching','cancelled','failed'],
 accepted:['delivered','bounced','complained'],
 delivered:['complained'],
 'unknown-outcome':['accepted','delivered','bounced','complained','unresolved'],
 bounced:[],complained:[],failed:[],cancelled:[],unresolved:[],
});
export const bounds=Object.freeze({maxAttempts:6,leaseMs:60000,reconcileReads:3,reconcileWindowMs:72*3600000,noticeTtlMs:24*3600000,subjectChars:120,bodyChars:4000,perRecipientHour:10,perRecipientDay:50});
/** Fixed platform links. A template names one by ID; no variable, caller or configuration supplies a URL. */
export const platformLinks=Object.freeze({'workspace-inbox':'https://whumpo.com/workspace/inbox','workspace-records':'https://whumpo.com/workspace/records'});

// Keys that would let a caller, configuration or template choose a destination, header, URL or credential.
const relayKeys=new Set(['to','cc','bcc','recipient','recipients','address','addresses','email','emails','replyto','reply_to','from','headers','header','url','urls','href','webhook','callback','returnpath','return_path']);
const secretKey=/^(api[_-]?key|token|secret|password|authorization|credential|credentials|bearer|private[_-]?key|binding)$/i;
function noRelayOrSecret(v,path,depth=0){
 check(depth<=12,'TOO_DEEP',path);
 if(Array.isArray(v)){v.forEach((x,i)=>noRelayOrSecret(x,`${path}[${i}]`,depth+1));return;}
 if(!plain(v))return;
 for(const [k,x] of Object.entries(v)){
  check(!secretKey.test(k),'SECRET_FIELD',`${path}.${k}`);
  check(!relayKeys.has(k.toLowerCase()),'OPEN_RELAY',`${path}.${k}`);
  noRelayOrSecret(x,`${path}.${k}`,depth+1);
 }
}
const separators=[String.fromCharCode(0x2028),String.fromCharCode(0x2029)];
const lineSafe=v=>!/[\u0000-\u001f\u007f]/.test(v)&&!separators.some(c=>v.includes(c));
const urlOrAddress=v=>/@|[a-z][a-z0-9+.-]*:\/\/|\bwww\.|\.(com|net|org|io|site|app)\b/i.test(v);
/** Variable types. Every value is validated at render; values are inserted as data and never re-parsed. */
export const variableTypes=Object.freeze({
 'text-line':v=>typeof v==='string'&&v.length>=1&&v.length<=80&&lineSafe(v)&&!/[<>]/.test(v)&&!urlOrAddress(v),
 choice:(v,field)=>typeof v==='string'&&Array.isArray(field?.options)&&field.options.includes(v)&&lineSafe(v)&&v.length<=80,
 number:v=>Number.isSafeInteger(v)&&Math.abs(v)<=1e9,
 boolean:v=>typeof v==='boolean',
 reference:v=>typeof v==='string'&&/^[A-F0-9]{8}$/.test(v),
 code:v=>typeof v==='string'&&/^[A-Z0-9]{8}$/.test(v),
});
const variableSources=Object.freeze({config:['text-line'],record:['choice','number','boolean'],platform:['reference','code']});

const contactFooter=[{text:'\n\nYou receive this because this address was added and verified for contact-form notices in Whumpo. To stop them, remove the address in Dashboard → Contact inbox ('},{link:'workspace-inbox'},{text:').'}];
const stopStaff=[{text:'\n\nYou receive this because you turned on appointment notices for this business in its staff area. Turn them off there at any time.'}];
const stopSubmitter=[{text:'\n\nYou receive this because you asked for an email receipt when you sent the request. This is a one-time receipt; you will not be added to any mailing list.'}];
const template=(o)=>({contractVersion:1,purpose:'transactional',variables:{},...o});

/** Frozen v1 catalog. Planned entries are contract declarations only: no adapter, sender or schedule exists for them. */
export const notificationCatalog=Object.freeze({
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
 },
});

export function validateTemplate(t,path='template'){
 noRelayOrSecret(t,path);
 shape(t,['contractVersion','id','version','purpose','authority','trigger','audiences','variables','subject','body'],path);
 check(t.contractVersion===contractVersion,'UNSUPPORTED_VERSION',`${path}.contractVersion`);
 check(typeof t.id==='string'&&/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/.test(t.id)&&t.id.length<=60,'INVALID_ID',`${path}.id`);
 check(Number.isSafeInteger(t.version)&&t.version>=1,'INVALID_VERSION',`${path}.version`);
 check(t.purpose==='transactional','NOT_TRANSACTIONAL',`${path}.purpose`);
 check(authorityClasses.includes(t.authority),'UNKNOWN_AUTHORITY',`${path}.authority`);
 check(triggers.includes(t.trigger),'UNKNOWN_TRIGGER',`${path}.trigger`);
 check(Array.isArray(t.audiences)&&t.audiences.length>=1&&t.audiences.every(a=>recipientScopes.includes(a))&&new Set(t.audiences).size===t.audiences.length,'UNKNOWN_SCOPE',`${path}.audiences`);
 // Platform obligations notify the owner's own verified destination; customer configurations run only on accepted records.
 if(t.authority==='platform-obligation')check(t.trigger!=='form.accepted'&&t.audiences.every(a=>a==='owner-destination'),'AUTHORITY_MISMATCH',path);
 else check(t.trigger==='form.accepted','AUTHORITY_MISMATCH',path);
 check(plain(t.variables),'INVALID_SHAPE',`${path}.variables`);
 for(const [name,v] of Object.entries(t.variables)){
  check(/^[a-z][A-Za-z0-9]{0,30}$/.test(name),'INVALID_ID',`${path}.variables.${name}`);
  shape(v,['source','type'],`${path}.variables.${name}`);
  check(Object.hasOwn(variableSources,v.source)&&variableSources[v.source].includes(v.type),'INVALID_VARIABLE',`${path}.variables.${name}`);
  // Owner and staff notices are content-free: no visitor-submitted value leaves the private panel by email.
  if(v.source==='record')check(t.audiences.length===1&&t.audiences[0]==='submitter','CONTENT_IN_NOTICE',`${path}.variables.${name}`);
  if(v.type==='code')check(t.trigger==='destination.verification','INVALID_VARIABLE',`${path}.variables.${name}`);
 }
 const used=new Set();
 const segments=(list,where,multiline,maxChars)=>{
  check(Array.isArray(list)&&list.length>=1&&list.length<=40,'INVALID_SHAPE',`${path}.${where}`);
  let chars=0;
  list.forEach((s,i)=>{
   const p=`${path}.${where}[${i}]`;check(plain(s)&&Object.keys(s).length===1,'INVALID_SEGMENT',p);
   if(Object.hasOwn(s,'text')){
    check(typeof s.text==='string'&&(multiline?!/[\u0000-\u0009\u000b-\u001f\u007f]/.test(s.text):lineSafe(s.text)),'HEADER_INJECTION',p);
    check(!/\{\{|\}\}|\$\{/.test(s.text),'TEMPLATE_SYNTAX',p);chars+=s.text.length;
   }else if(Object.hasOwn(s,'var')){check(Object.hasOwn(t.variables,s.var),'UNDECLARED_VARIABLE',p);used.add(s.var);chars+=80;}
   else if(Object.hasOwn(s,'link')){check(!multiline?false:Object.hasOwn(platformLinks,s.link),'UNKNOWN_LINK',p);chars+=platformLinks[s.link].length;}
   else check(false,'INVALID_SEGMENT',p);
  });
  check(chars<=maxChars,'TOO_LONG',`${path}.${where}`);
 };
 segments(t.subject,'subject',false,bounds.subjectChars);
 segments(t.body,'body',true,bounds.bodyChars);
 check(Object.keys(t.variables).every(n=>used.has(n)),'UNUSED_VARIABLE',`${path}.variables`);
 return true;
}

export function validateCatalog(c){
 shape(c,['contractVersion','providers','senders','templates'],'catalog');
 check(c.contractVersion===contractVersion,'UNSUPPORTED_VERSION','catalog.contractVersion');
 for(const [id,p] of Object.entries(c.providers)){
  const path=`providers.${id}`;
  shape(p,['readiness','review','price','ceiling','idempotency','events','lookup','errorClasses'],path);
  check(readinessLevels.includes(p.readiness),'UNKNOWN_READINESS',path);
  check(p.review===null||(plain(p.review)&&typeof p.review.reference==='string'&&p.review.reference.length>0),'INVALID_REVIEW',path);
  if(p.price!==null){shape(p.price,['basis','currency','microsPerCall','includedPerMonth','checkedAt','entitlement'],`${path}.price`);check(Number.isSafeInteger(p.price.microsPerCall)&&p.price.microsPerCall>=0,'INVALID_PRICE',path);}
  check(p.ceiling===null||(plain(p.ceiling)&&Number.isSafeInteger(p.ceiling.callsPer32Days)&&p.ceiling.callsPer32Days>0),'INVALID_CEILING',path);
  check(['none','provider-idempotency-key'].includes(p.idempotency),'INVALID_IDEMPOTENCY',path);
  shape(p.errorClasses,['notTaken','rejected','suppressed'],`${path}.errorClasses`);
 }
 for(const [id,s] of Object.entries(c.senders)){
  const path=`senders.${id}`;
  shape(s,['address','displayName','provider','domainOwner','state','dnsReview'],path);
  check(Object.hasOwn(c.providers,s.provider),'UNKNOWN_PROVIDER',path);
  check(['verified','unverified','planned'].includes(s.state),'INVALID_SENDER',path);
  check(['platform','customer'].includes(s.domainOwner),'INVALID_SENDER',path);
  check(typeof s.displayName==='string'&&/^[A-Za-z0-9 ]{1,40}$/.test(s.displayName),'HEADER_INJECTION',`${path}.displayName`);
  if(s.state==='verified')check(typeof s.dnsReview==='string'&&s.dnsReview.length>0,'UNREVIEWED_SENDER',path);
 }
 for(const [key,e] of Object.entries(c.templates)){
  shape(e,['state','readiness','template'],`templates.${key}`);
  check(['available','withdrawn'].includes(e.state),'INVALID_STATE',`templates.${key}`);
  check(readinessLevels.includes(e.readiness),'UNKNOWN_READINESS',`templates.${key}`);
  validateTemplate(e.template,`templates.${key}.template`);
  check(key===`${e.template.id}@${e.template.version}`,'INVALID_ID',`templates.${key}`);
 }
 return true;
}
export const templateDigest=t=>digest(t);

/** Classify a provider error code. Unknown codes, internal errors, throws and timeouts are uncertain. */
export function classifyProviderError(catalog,providerId,code){
 const e=catalog.providers[providerId]?.errorClasses;
 if(!e)return 'uncertain';
 if(e.suppressed.includes(code))return 'suppressed';
 if(e.notTaken.includes(code))return 'not-taken';
 if(e.rejected.includes(code))return 'rejected';
 return 'uncertain';
}

/** Customer notification configuration v1: one template, one trigger, one recipient scope, one sender. Never an address. */
export function validateConfiguration(cfg,catalog=notificationCatalog){
 noRelayOrSecret(cfg,'configuration');
 shape(cfg,['contractVersion','id','template','trigger','recipientScope','sender','values','fields','limits'],'configuration');
 check(cfg.contractVersion===contractVersion,'UNSUPPORTED_VERSION','configuration.contractVersion');
 check(typeof cfg.id==='string'&&/^[a-z][a-z0-9-]{0,39}$/.test(cfg.id),'INVALID_ID','configuration.id');
 shape(cfg.template,['id','version','digest'],'configuration.template');
 const entry=catalog.templates[`${cfg.template.id}@${cfg.template.version}`];
 check(entry,'UNKNOWN_TEMPLATE','configuration.template');
 check(entry.state==='available','TEMPLATE_WITHDRAWN','configuration.template');
 const t=entry.template;
 check(cfg.template.digest===templateDigest(t),'STALE_TEMPLATE','configuration.template.digest');
 check(t.authority==='approved-configuration','PLATFORM_TEMPLATE','configuration.template');
 shape(cfg.trigger,['event','resourceId','formId'],'configuration.trigger');
 check(cfg.trigger.event===t.trigger,'TRIGGER_MISMATCH','configuration.trigger.event');
 check(typeof cfg.trigger.resourceId==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(cfg.trigger.resourceId),'INVALID_ID','configuration.trigger.resourceId');
 check(typeof cfg.trigger.formId==='string'&&/^[a-z][a-z0-9-]{0,39}$/.test(cfg.trigger.formId),'INVALID_ID','configuration.trigger.formId');
 check(t.audiences.includes(cfg.recipientScope),'SCOPE_NOT_ALLOWED','configuration.recipientScope');
 const sender=catalog.senders[cfg.sender];
 check(sender,'UNKNOWN_SENDER','configuration.sender');
 check(sender.state==='verified','SENDER_NOT_VERIFIED','configuration.sender');
 const provider=catalog.providers[sender.provider];
 check(provider.review,'UNREVIEWED_PROVIDER','configuration.sender');
 check(provider.price,'UNPRICED_PROVIDER','configuration.sender');
 check(provider.ceiling,'UNBOUNDED_CHARGE','configuration.sender');
 check(plain(cfg.values)&&plain(cfg.fields),'INVALID_SHAPE','configuration');
 const configVars=Object.entries(t.variables).filter(([,v])=>v.source==='config').map(([n])=>n);
 const recordVars=Object.entries(t.variables).filter(([,v])=>v.source==='record').map(([n])=>n);
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
 check(Number.isSafeInteger(cfg.limits.perRecipientHour)&&cfg.limits.perRecipientHour>=1&&cfg.limits.perRecipientHour<=bounds.perRecipientHour,'LIMIT_TOO_HIGH','configuration.limits.perRecipientHour');
 check(Number.isSafeInteger(cfg.limits.perRecipientDay)&&cfg.limits.perRecipientDay>=cfg.limits.perRecipientHour&&cfg.limits.perRecipientDay<=bounds.perRecipientDay,'LIMIT_TOO_HIGH','configuration.limits.perRecipientDay');
 return {template:t,sender,provider,price:provider.price,configurationDigest:digest(cfg)};
}

/** The exact owner review binds the configuration digest and the provider price shown to the owner. */
export function prepareReview(cfg,catalog=notificationCatalog){
 const v=validateConfiguration(cfg,catalog);
 return {configurationDigest:v.configurationDigest,sender:cfg.sender,price:structuredClone(v.price),reviewDigest:digest({c:v.configurationDigest,p:v.price,s:cfg.sender})};
}
function checkReview(cfg,review,catalog){
 const v=validateConfiguration(cfg,catalog);
 shape(review,['configurationDigest','sender','price','reviewDigest'],'review');
 check(review.configurationDigest===v.configurationDigest,'STALE_REVIEW','review.configurationDigest');
 check(canonical(review.price)===canonical(v.price),'PRICE_MISMATCH','review.price');
 check(review.reviewDigest===digest({c:v.configurationDigest,p:v.price,s:cfg.sender}),'STALE_REVIEW','review.reviewDigest');
 return v;
}

/** Standard appointment-request rules expressed as configuration over maintained templates. */
export function standardAppointmentConfigurations({resourceId,formId,serviceField,dayField,businessName},catalog=notificationCatalog){
 const pin=key=>{const t=catalog.templates[key].template;return {id:t.id,version:t.version,digest:templateDigest(t)};};
 const base={contractVersion:1,trigger:{event:'form.accepted',resourceId,formId},sender:'whumpo-notify'};
 return [
  {...base,id:'appointment-staff',template:pin('appointment.staff-notice@1'),recipientScope:'project-staff',values:{businessName},fields:{},limits:{perRecipientHour:10,perRecipientDay:50}},
  {...base,id:'appointment-owner',template:pin('appointment.staff-notice@1'),recipientScope:'owner-destination',values:{businessName},fields:{},limits:{perRecipientHour:10,perRecipientDay:50}},
  {...base,id:'appointment-receipt',template:pin('appointment.request-receipt@1'),recipientScope:'submitter',values:{businessName},fields:{service:serviceField,day:dayField},limits:{perRecipientHour:3,perRecipientDay:10}},
 ];
}

/** Render a template with typed values. Returns plain text; values are data, never template syntax or markup. */
export function render(t,values,fields={}){
 const value=(name)=>{
  const spec=t.variables[name],v=values[name];
  check(variableTypes[spec.type](v,fields[name]),'INVALID_VARIABLE',`render.${name}`);
  return String(v);
 };
 const join=list=>list.map(s=>Object.hasOwn(s,'text')?s.text:Object.hasOwn(s,'var')?value(s.var):platformLinks[s.link]).join('');
 const subject=join(t.subject),text=join(t.body);
 check(lineSafe(subject)&&subject.length<=bounds.subjectChars,'HEADER_INJECTION','render.subject');
 return {subject,text};
}

/** A synthetic provider adapter. Only the adapter closure holds the credential; the runtime never sees it. */
export function createSyntheticAdapter({secret}){
 const plan=[],calls=[],effects=[];let ref=0;
 return {
  plan,calls,effects,
  async send(message){
   check(typeof secret==='string'&&secret.length>0,'NOT_CONFIGURED','adapter');
   calls.push(structuredClone(message));
   const mode=plan.shift()??'accept';
   if(mode==='timeout-before')return {kind:'uncertain'};
   if(mode==='throw')throw Error('transport failure');
   if(mode==='timeout-after'){effects.push(message.headers['X-Whumpo-Notice-Id']);return {kind:'uncertain'};}
   if(['not-taken','rejected','suppressed'].includes(mode))return {kind:mode};
   effects.push(message.headers['X-Whumpo-Notice-Id']);
   return {kind:'accepted',providerRef:`msg-${++ref}`};
  },
 };
}

/** Synthetic in-memory reference runtime. State is a plain object so tests can inspect every stored byte. */
export function createReferenceRuntime({catalog=notificationCatalog,adapter,start=Date.UTC(2026,9,8,12)}={}){
 validateCatalog(catalog);
 let now=start,seq=0;
 const id=p=>`${p}-${++seq}`;
 const s={projects:{},outbox:{},keys:{},ledger:{calls:0},suppressions:[],providerEvents:[],derived:[]};
 const faults={derive:false,crashAfterCall:false};
 const project=pid=>{const p=s.projects[pid];check(p,'NOT_FOUND','project');return p;};
 const owner=(principal,pid)=>{check(principal?.kind==='owner','FORBIDDEN','principal');const p=s.projects[pid];check(p&&p.ownerId===principal.ownerId,'NOT_FOUND','project');return p;};
 const move=(n,to,reason=null)=>{check(transitions[n.state].includes(to),'INVALID_TRANSITION',`${n.state}->${to}`);n.state=to;n.history.push(to);if(reason)n.reason=reason;};
 const suppressed=(ownerId,address)=>s.suppressions.includes(`${ownerId}|${address}`);
 const suppress=(ownerId,address)=>{
  if(!suppressed(ownerId,address))s.suppressions.push(`${ownerId}|${address}`);
  for(const n of Object.values(s.outbox))if(['queued','deferred'].includes(n.state)&&n.ownerId===ownerId&&addressOf(n)===address)move(n,'cancelled','suppressed');
 };
 function addressOf(n){
  const p=s.projects[n.projectId];if(!p)return null;
  if(n.recipientRef==='owner')return p.ownerDestination?.state==='verified'?p.ownerDestination.address:null;
  const v=p.visitors[n.recipientRef];return v?.emailVerified?v.email:null;
 }
 // Current eligibility, read at derive time and again immediately before every provider call.
 function eligible(p,n,cfg,record){
  if(!cfg||!cfg.enabled||cfg.digest!==n.configurationDigest)return 'configuration-changed';
  const entry=catalog.templates[`${cfg.configuration.template.id}@${cfg.configuration.template.version}`];
  if(entry?.state!=='available')return 'template-withdrawn';
  if(!record)return 'record-removed';
  const address=addressOf(n);
  if(!address)return 'recipient-revoked';
  if(cfg.configuration.recipientScope==='project-staff'){const st=p.staff[n.recipientRef];if(!st||st.revoked||!p.visitors[n.recipientRef]?.notify)return 'recipient-revoked';}
  if(cfg.configuration.recipientScope==='submitter'&&!(record.submitter.kind==='visitor'&&record.submitter.visitorId===n.recipientRef&&record.receiptConsent))return 'recipient-revoked';
  if(suppressed(p.ownerId,address))return 'suppressed';
  return null;
 }
 function recipients(p,cfg,record){
  const scope=cfg.configuration.recipientScope;
  if(scope==='owner-destination')return p.ownerDestination?.state==='verified'?['owner']:[];
  if(scope==='project-staff')return Object.entries(p.staff).filter(([vid,st])=>!st.revoked&&p.visitors[vid]?.emailVerified&&p.visitors[vid]?.notify).map(([vid])=>vid);
  // Anonymous submitters never receive mail: a typed address is not a verified recipient (no open relay).
  if(record.submitter.kind==='visitor'&&record.receiptConsent&&p.visitors[record.submitter.visitorId]?.emailVerified)return [record.submitter.visitorId];
  return [];
 }
 function derive(){
  if(faults.derive)throw Error('notification storage unavailable');
  let queued=0;
  for(const [pid,p] of Object.entries(s.projects))for(const ev of p.events){
   for(const cfg of Object.values(p.configurations)){
    const c=cfg.configuration;
    if(!cfg.enabled||ev.type!=='form.accepted'||ev.resourceId!==c.trigger.resourceId||ev.formId!==c.trigger.formId)continue;
    const mark=`${c.id}:${cfg.digest}:${ev.id}`;if(s.derived.includes(mark))continue;s.derived.push(mark);
    if(now-ev.at>bounds.noticeTtlMs)continue;
    const record=p.records[ev.recordId];if(!record)continue;
    for(const ref of recipients(p,cfg,record)){
     const key=`cfg:${c.id}:${cfg.digest.slice(0,16)}:${ev.id}:${ref}`;
     if(s.keys[key])continue;
     const recent=Object.values(s.outbox).filter(n=>n.projectId===pid&&n.configurationId===c.id&&n.recipientRef===ref);
     if(recent.filter(n=>now-n.createdAt<3600000).length>=c.limits.perRecipientHour||recent.filter(n=>now-n.createdAt<86400000).length>=c.limits.perRecipientDay)continue;
     const n={id:id('notice'),key,projectId:pid,ownerId:p.ownerId,configurationId:c.id,configurationDigest:cfg.digest,eventId:ev.id,recordId:ev.recordId,recipientRef:ref,
      provider:catalog.senders[c.sender].provider,state:'queued',history:['queued'],attempts:0,dueAt:now,createdAt:now,expiresAt:now+bounds.noticeTtlMs,claimedAt:null,providerRef:null,reason:null,reconcileReads:0,uncertainAt:null};
     s.outbox[n.id]=n;s.keys[key]=n.id;queued++;
    }
   }
  }
  return queued;
 }
 async function dispatch(n,result){
  const p=s.projects[n.projectId],cfg=p?.configurations[n.configurationId],record=p?.records[n.recordId];
  if(now>=n.expiresAt){move(n,'cancelled','expired');result.cancelled++;return;}
  const denied=p?eligible(p,n,cfg,record):'project-removed';
  if(denied){move(n,'cancelled',denied);result.cancelled++;return;}
  const provider=catalog.providers[n.provider];
  if(s.ledger.calls>=provider.ceiling.callsPer32Days){move(n,'cancelled','ceiling');result.cancelled++;return;}
  const c=cfg.configuration,entry=catalog.templates[`${c.template.id}@${c.template.version}`],t=entry.template;
  const values={...c.values},fieldSpecs={};
  for(const [name,spec] of Object.entries(t.variables)){
   if(spec.source==='record'){values[name]=record.values[c.fields[name]];fieldSpecs[name]=p.forms[c.trigger.resourceId]?.[c.trigger.formId]?.[c.fields[name]];}
   if(spec.type==='reference')values[name]=record.reference;
  }
  let message;
  try{message=render(t,values,fieldSpecs);}catch(e){if(e.code!=='INVALID_VARIABLE'&&e.code!=='HEADER_INJECTION')throw e;move(n,'cancelled','render-refused');result.cancelled++;return;}
  // Claim and count the attempt before the call, so a crash cannot double-send or double-count.
  move(n,'dispatching');n.attempts++;n.claimedAt=now;s.ledger.calls++;
  const sender=catalog.senders[c.sender];
  let outcome;
  try{outcome=await adapter.send({noticeId:n.id,idempotencyKey:`${n.key}:${n.attempts}`,from:{email:sender.address,name:sender.displayName},to:addressOf(n),subject:message.subject,text:message.text,headers:{'X-Whumpo-Notice-Id':n.id}});}
  catch{outcome={kind:'uncertain'};}
  if(faults.crashAfterCall)throw Error('worker interrupted before the result was saved');
  settle(n,outcome,result);
 }
 function settle(n,outcome,result){
  if(n.state!=='dispatching')return;
  if(outcome?.kind==='accepted'){n.providerRef=typeof outcome.providerRef==='string'?outcome.providerRef.slice(0,100):null;move(n,'accepted');result.accepted++;}
  else if(outcome?.kind==='not-taken'){
   if(n.attempts>=bounds.maxAttempts){move(n,'failed','exhausted');result.failed++;}
   else{move(n,'deferred','not-taken');n.dueAt=now+Math.min(360,5*2**(n.attempts-1))*60000;result.deferred++;}
  }
  else if(outcome?.kind==='rejected'){move(n,'failed','rejected');result.failed++;}
  else if(outcome?.kind==='suppressed'){const a=addressOf(n);move(n,'failed','suppressed');if(a)suppress(n.ownerId,a);result.failed++;}
  else{move(n,'unknown-outcome','uncertain');n.uncertainAt=now;result.uncertain++;}
 }
 return {
  state:s,faults,
  now:()=>now,advance(ms){now+=ms;},
  // ---- Trusted fixture setup (stands in for the access/records modules and the owner destination flow). ----
  addProject(pid,ownerId){s.projects[pid]={ownerId,ownerDestination:null,visitors:{},staff:{},forms:{},records:{},events:[],configurations:{},requests:{}};},
  setOwnerDestination(pid,address,state='verified'){project(pid).ownerDestination={address,state};},
  addVisitor(pid,visitorId,{email=null,emailVerified=false,notify=false}={}){project(pid).visitors[visitorId]={email,emailVerified,notify};},
  grantStaff(pid,visitorId){project(pid).staff[visitorId]={revoked:false};},
  revokeStaff(pid,visitorId){const st=project(pid).staff[visitorId];if(st)st.revoked=true;},
  setVisitorNotify(pid,visitorId,notify){project(pid).visitors[visitorId].notify=notify;},
  defineForm(pid,resourceId,formId,fields){const p=project(pid);(p.forms[resourceId]??={})[formId]=structuredClone(fields);},
  // ---- Form intake: commits the record and its content-free event; never touches notification state. ----
  submitForm(pid,{resourceId,formId,requestId,values,submitter,receiptConsent=false}){
   const p=project(pid),form=p.forms[resourceId]?.[formId];check(form,'NOT_FOUND','form');
   const prior=p.requests[requestId];
   if(prior){check(prior.digest===digest({resourceId,formId,values,submitter,receiptConsent}),'REQUEST_CONFLICT','requestId');return {recordId:prior.recordId,reference:p.records[prior.recordId]?.reference??prior.reference};}
   for(const [k,f] of Object.entries(form)){const v=values[k];check(v!==undefined&&(f.type==='text'?typeof v==='string'&&v.length<=300:variableTypes[f.type](v,f)),'INVALID_VALUE',`values.${k}`);}
   check(Object.keys(values).every(k=>Object.hasOwn(form,k)),'UNKNOWN_FIELD','values');
   const recordId=id('record'),reference=createHash('sha256').update(recordId).digest('hex').slice(0,8).toUpperCase();
   p.records[recordId]={values:structuredClone(values),submitter:structuredClone(submitter),receiptConsent:!!receiptConsent&&submitter.kind==='visitor',reference,at:now};
   p.events.push({id:id('event'),type:'form.accepted',resourceId,formId,recordId,at:now});
   p.requests[requestId]={recordId,reference,digest:digest({resourceId,formId,values,submitter,receiptConsent})};
   return {recordId,reference};
  },
  readRecord(principal,pid,recordId){const p=owner(principal,pid);const r=p.records[recordId];check(r,'NOT_FOUND','record');return structuredClone(r);},
  removeRecord(principal,pid,recordId){delete owner(principal,pid).records[recordId];},
  // ---- Owner configuration through the exact review. ----
  configure(principal,pid,configuration,review){
   const p=owner(principal,pid);
   const v=checkReview(configuration,review,catalog);
   const form=p.forms[configuration.trigger.resourceId]?.[configuration.trigger.formId];
   check(form,'NOT_FOUND','configuration.trigger');
   for(const [name,key] of Object.entries(configuration.fields)){
    const f=form[key];check(f,'UNKNOWN_FIELD',`configuration.fields.${name}`);
    check(f.type!=='text','FREE_TEXT_VARIABLE',`configuration.fields.${name}`);
    check(f.type===v.template.variables[name].type,'TYPE_MISMATCH',`configuration.fields.${name}`);
   }
   p.configurations[configuration.id]={configuration:structuredClone(configuration),digest:v.configurationDigest,enabled:true};
   return {configurationId:configuration.id,configurationDigest:v.configurationDigest};
  },
  disable(principal,pid,configurationId){const c=owner(principal,pid).configurations[configurationId];check(c,'NOT_FOUND','configuration');c.enabled=false;},
  // ---- The deterministic scheduled pass. A failure here never reaches form intake or records. ----
  async runPass({limit=25}={}){
   const result={queued:0,accepted:0,deferred:0,failed:0,cancelled:0,uncertain:0,errors:0};
   for(const n of Object.values(s.outbox))if(n.state==='dispatching'&&now-n.claimedAt>=bounds.leaseMs){move(n,'unknown-outcome','interrupted');n.uncertainAt=now;result.uncertain++;}
   try{result.queued=derive();}catch{result.errors++;}
   const due=Object.values(s.outbox).filter(n=>['queued','deferred'].includes(n.state)&&n.dueAt<=now).slice(0,limit);
   for(const n of due){try{await dispatch(n,result);}catch{result.errors++;}}
   return result;
  },
  // ---- Authenticated provider events (signature/credential checks live in the adapter). ----
  applyProviderEvent({providerEventId,noticeId,type,authenticated}){
   check(authenticated===true,'EVENT_NOT_AUTHENTICATED','event');
   check(['delivered','bounced','complained','deferred'].includes(type),'UNKNOWN_EVENT','event.type');
   if(s.providerEvents.includes(providerEventId))return {applied:false,duplicate:true};
   s.providerEvents.push(providerEventId);
   const n=s.outbox[noticeId];if(!n)return {applied:false};
   if(type==='deferred'||!transitions[n.state].includes(type))return {applied:false,state:n.state};
   const address=addressOf(n);move(n,type,`provider-${type}`);
   if((type==='bounced'||type==='complained')&&address)suppress(n.ownerId,address);
   return {applied:true,state:n.state};
  },
  // ---- Bounded read-only reconciliation of an unknown outcome. Never sends. ----
  reconcile(noticeId,lookup){
   const n=s.outbox[noticeId];check(n,'NOT_FOUND','notice');
   check(n.state==='unknown-outcome','NOT_UNCERTAIN',n.state);
   n.reconcileReads++;
   const found=lookup?.found??null;
   if(['accepted','delivered','bounced'].includes(found)){const a=addressOf(n);move(n,found,'reconciled');if(found==='bounced'&&a)suppress(n.ownerId,a);return n.state;}
   if(n.reconcileReads>=bounds.reconcileReads||now-n.uncertainAt>=bounds.reconcileWindowMs)move(n,'unresolved','reconcile-bound');
   return n.state;
  },
  // ---- Owner controls. Retry is offered only for a definite not-taken deferral; nothing is ever resent after uncertainty. ----
  retryNow(principal,noticeId){const n=s.outbox[noticeId];check(n,'NOT_FOUND','notice');owner(principal,n.projectId);check(n.state==='deferred','NO_REDISPATCH',n.state);n.dueAt=now;},
  cancel(principal,noticeId){const n=s.outbox[noticeId];check(n,'NOT_FOUND','notice');owner(principal,n.projectId);check(['queued','deferred'].includes(n.state),'CANNOT_RECALL',n.state);move(n,'cancelled','owner-cancelled');},
  receipt(noticeId){const n=s.outbox[noticeId];check(n,'NOT_FOUND','notice');return {id:n.id,configurationId:n.configurationId,recipientScope:s.projects[n.projectId]?.configurations[n.configurationId]?.configuration.recipientScope??null,state:n.state,attempts:n.attempts,reason:n.reason,providerRef:n.providerRef};},
  notices(){return Object.values(s.outbox).map(n=>n.id);},
 };
}

/** Existing WH-036 contact outbox states mapped to contract receipt states ({state: contractState | {last_error: contractState}}). */
export const contactStateMap=Object.freeze({
 queued:{null:'queued',unavailable:'deferred'},
 dispatching:'dispatching',
 accepted:'accepted',
 uncertain:'unknown-outcome',
 failed:{rejected:'failed',exhausted:'failed',suppressed:'failed',uncertain:'unknown-outcome'},
 cancelled:{null:'cancelled',suppressed:'cancelled',expired:'cancelled',contained:'cancelled',ceiling:'cancelled',not_sent:'cancelled'},
 bounced:'bounced',
 complained:'complained',
});
