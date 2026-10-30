import {ModuleError} from './shared-modules/policy';
import {notificationCatalog,notificationDigest,renderCatalogNotification,validateNotificationConfiguration,variableTypes,NotificationCatalogError} from './notification-catalog';
import {assertFeature} from './feature-admission';
import {featureRequest,inclusionPredicate,FeatureInclusionError} from './feature-inclusion';
import {assertWorkspace} from './workspace-identity/admission';
import {receiptStatement,reviewedReply,reviewChangedMessage} from './chat-review-receipts';
import {enqueueNotice} from './notification-outbox';
/**
 * WH-158 customer notification configuration for the standard appointment presets (docs/notifications.md, gap G-N8).
 * An owner turns on up to three notices for one records form through an exact Chat review (`/review-notification-setup`, prepared by the owner's typed
 * control or by the model) that only a separate typed `confirm` control applies (`/confirm-notification-setup`; the trigger refuses any other confirmer):
 * a notice to the owner's verified address, a notice to opted-in staff, and a receipt to a verified signed-in visitor who consented on that submission.
 * The review binds the template digests, the platform sender, the scopes, the limits, the provider price and the business name, so a changed catalog,
 * price or form makes it stale. Configuring provisions nothing. The resolver below is the one `approved-configuration` resolver for `form.accepted`
 * (WH-069 reuses it); it writes outbox rows through `enqueueNotice` only and never reaches the model or maintainer credentials.
 */
type Db=Pick<D1Database,'prepare'|'batch'>;
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
export type NoticeFlags={owner:boolean;staff:boolean;receipt:boolean};
/** The standard presets (docs/notifications.md#standard-appointment-request-rules-as-configuration). Nothing here is customer-supplied except the business name. */
export const appointmentPresets=Object.freeze([
 {id:'appointment-owner',flag:'owner',template:'appointment.staff-notice@1',scope:'owner-destination',limits:{perRecipientHour:10,perRecipientDay:50}},
 {id:'appointment-staff',flag:'staff',template:'appointment.staff-notice@1',scope:'project-staff',limits:{perRecipientHour:10,perRecipientDay:50}},
 {id:'appointment-receipt',flag:'receipt',template:'appointment.request-receipt@1',scope:'submitter',limits:{perRecipientHour:3,perRecipientDay:10}},
] as const);
const configuredFlag=(template:string,scope:string):keyof NoticeFlags|null=>appointmentPresets.find(p=>p.template===template&&p.scope===scope)?.flag??null;
/** True for a catalog template that only a customer configuration may queue. */
export const isConfiguredTemplate=(template:string)=>notificationCatalog.templates[template]?.template.authority==='approved-configuration';
export const reviewMs=600000;
const invalid=(message:string)=>new ModuleError('invalid_request',message);
const choices=(f:{options?:{value:string}[]}|undefined)=>f?.options?.map(o=>o.value)??[];
type RecordsConfig={forms:{id:string;recordId:string;submit:'public'|'visitor'|'staff'}[];schemas:{id:string;fields:{key:string;type:string;options?:{value:string}[]}[]}[]};

/** Derives, from current saved records and the catalog only, everything a review binds. */
async function build(db:Pick<D1Database,'prepare'>,user:string,project:string,localId:string,formId:string,flags:NoticeFlags,businessName:string,base:number){
 const row=await db.prepare('SELECT i.id,i.config_json FROM module_instances i JOIN projects p ON p.id=i.project_id WHERE i.project_id=? AND i.local_id=? AND i.kind=\'records\' AND p.owner_user_id=?').bind(project,localId,user).first<{id:string;config_json:string}>();
 if(!row)throw new ModuleError('not_found','That records module is not registered for this project.');
 const config=JSON.parse(row.config_json) as RecordsConfig,form=config.forms.find(f=>f.id===formId);
 if(!form)throw new ModuleError('not_found','That form is not in this records module.');
 const fields=config.schemas.find(s=>s.id===form.recordId)?.fields??[],service=fields.find(f=>f.key==='service'&&f.type==='choice'),day=fields.find(f=>f.key==='day'&&f.type==='choice');
 if(flags.receipt){
  if(form.submit==='public')throw invalid('Receipts need a form that visitors sign in to use. An anonymous form cannot send receipts.');
  if(!service||!day)throw invalid('Receipts need “service” and “day” choice fields on this form.');
 }
 if(!variableTypes['text-line'](businessName))throw invalid('Give a business name of 1 to 80 plain characters, without a link or an email address.');
 const configs=[];
 for(const p of appointmentPresets){
  if(!flags[p.flag])continue;
  const t=notificationCatalog.templates[p.template].template,pin={id:t.id,version:t.version,digest:await notificationDigest(t)};
  const cfg={contractVersion:1,id:p.id,template:pin,trigger:{event:'form.accepted',resourceId:row.id,formId},recipientScope:p.scope,sender:'whumpo-notify',values:{businessName},
   fields:p.flag==='receipt'?{service:'service',day:'day'}:{},limits:p.limits};
  try{configs.push({cfg,digest:(await validateNotificationConfiguration(cfg)).configurationDigest});}
  catch(error){if(error instanceof NotificationCatalogError)throw invalid('These notices cannot be configured right now ('+error.code+').');throw error;}
 }
 const price=notificationCatalog.providers[notificationCatalog.senders['whumpo-notify'].provider].price!;
 const configJson=JSON.stringify(configs.map(c=>c.cfg));
 const digest=await notificationDigest({contract:'notification-setup@1',instanceId:row.id,formId,flags,businessName,configs:configs.map(c=>c.digest),price:{micros:price.microsPerCall,checkedAt:price.checkedAt},
  choices:flags.receipt?{service:choices(service),day:choices(day)}:null,base});
 return {instanceId:row.id,configJson,priceMicros:price.microsPerCall,priceCheckedAt:price.checkedAt,digest};
}
const parseFlags=(list:string)=>{
 const parts=list==='none'?[]:list.split(','),set=new Set(parts);
 if(set.size!==parts.length||parts.some(p=>p!=='owner'&&p!=='staff'&&p!=='receipt'))return null;
 return {owner:set.has('owner'),staff:set.has('staff'),receipt:set.has('receipt')};
};
const dollars=(micros:number)=>'$'+(micros/1e6).toFixed(5).replace(/0+$/,'');
function describe(r:{form:string;flags:NoticeFlags;name:string;micros:number;checked:string;revision:number}){
 const on=[r.flags.owner&&'a notice to your verified notification address when a request arrives',r.flags.staff&&'a notice to staff who opted in and have a verified address',r.flags.receipt&&'an email receipt to a signed-in visitor with a verified address who asks for one on that request'].filter(Boolean) as string[];
 return `Review appointment email notices for the “${r.form}” form\n\n${on.length?'Turn on:\n'+on.map(x=>'- '+x).join('\n'):'Turn all appointment email notices off for this form.'}\n\nBusiness name in the emails: ${r.name}\n`
  +(on.length?`Notices to you and staff only say a request arrived and link to your private request list; they never include the request. A receipt shows only a reference, the chosen service and the chosen day, and says it is a request and not a confirmed booking.\nSent from notify@whumpo.com through Cloudflare Email at ${dollars(r.micros)} per email (price checked ${r.checked}). At most 10 an hour and 50 a day per owner or staff recipient, and 3 an hour and 10 a day for receipts.\n`:'')
  +`Not sending yet: saving this only records the settings. It sets up no sender, domain or provider, and nothing is emailed until Whumpo turns on email delivery and sets its monthly spending limit. Requests that arrive before then are not emailed later.\nThis is configuration revision ${r.revision}. Review expires in 10 minutes. Use the confirmation button for notification setup to save exactly this.`;
}
type Result={reply:string;statements:D1PreparedStatement[]};
/**
 * `/review-notification-setup PROJECT INSTANCE FORM owner,staff,receipt|none BUSINESS NAME` prepares the review; `/confirm-notification-setup REVIEW`
 * (the typed `confirm` control only) applies it atomically in the chat-turn transaction (notification_configuration_review_apply).
 */
export async function notificationSetupCommand(db:D1Database,userId:string,turnId:string,command:string):Promise<Result|undefined>{
 const result=(reply:string,statements:D1PreparedStatement[]=[]):Result=>({reply,statements});
 if(command.startsWith('/confirm-notification-setup ')){
  const id=command.slice(28).trim();
  if(!uuid.test(id))return result('Choose the appointment notice review to confirm.');
  if(!await reviewedReply(db,userId,'notificationConfiguration',id))return result(reviewChangedMessage);
  const r=await db.prepare('SELECT r.* FROM notification_configuration_reviews r JOIN projects p ON p.id=r.project_id WHERE r.id=? AND r.user_id=? AND p.owner_user_id=?').bind(id,userId,userId).first<ReviewRow>();
  if(!r)return result('Appointment notice review not found.');
  if(r.status==='applied')return result('That review was already applied. Open Dashboard → Form records for the current notice settings.');
  if(r.expires_at<=new Date().toISOString())return result('That review expired. Request a fresh appointment notice review.');
  try{
   await assertWorkspace(db,userId);
   await assertFeature(db,featureRequest({userId,projectId:r.project_id,featureId:'core.forms',operation:'confirm'}));
  }catch(error){if(error instanceof FeatureInclusionError)throw new ModuleError('forbidden','Appointment notices need Starter or a higher plan, or an explicit scoped test grant. Saved settings stay readable.');throw error;}
  const local=(await db.prepare('SELECT local_id FROM module_instances WHERE id=?').bind(r.instance_id).first<{local_id:string}>())?.local_id??'';
  const now=await build(db,userId,r.project_id,local,r.form_id,{owner:!!r.owner_notice,staff:!!r.staff_notice,receipt:!!r.receipt},r.business_name,r.base_revision).catch(()=>null);
  if(!now||now.digest!==r.digest||now.configJson!==r.config_json||now.priceMicros!==r.price_micros||now.priceCheckedAt!==r.price_checked_at)return result('The form, the notice templates or the price changed since this review. Request a fresh appointment notice review.');
  return result(`Saved the appointment email notices for the “${r.form_id}” form at configuration revision ${r.base_revision+1}. Nothing is emailed yet: delivery starts only after Whumpo turns on email delivery and sets its monthly spending limit, and a request that arrives before then is not emailed later.`,[
   db.prepare("UPDATE notification_configuration_reviews SET status='applied',confirmed_by=? WHERE id=? AND user_id=? AND status='pending'").bind(turnId,id,userId)]);
 }
 if(!command.startsWith('/review-notification-setup '))return;
 const m=/^\/review-notification-setup ([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}) ([a-z][a-z0-9-]{0,39}) ([a-z][a-z0-9-]{0,39}) ((?:owner|staff|receipt)(?:,(?:owner|staff|receipt)){0,2}|none) (.{1,80})$/.exec(command.trim());
 const flags=m&&parseFlags(m[4]);
 if(!m||!flags)throw invalid('Choose a project, a records module, a form, which notices to turn on and a plain business name.');
 const [,project,local,form,,name]=m;
 await assertWorkspace(db,userId);
 try{await assertFeature(db,featureRequest({userId,projectId:project,featureId:'core.forms',operation:'prepare'}));}
 catch(error){if(error instanceof FeatureInclusionError)throw new ModuleError('forbidden','Appointment notices need Starter or a higher plan, or an explicit scoped test grant.');throw error;}
 const current=await db.prepare('SELECT c.revision,c.owner_notice,c.staff_notice,c.receipt,c.business_name,c.config_json FROM notification_configurations c JOIN module_instances i ON i.id=c.instance_id JOIN projects p ON p.id=i.project_id WHERE i.project_id=? AND i.local_id=? AND c.form_id=? AND p.owner_user_id=?').bind(project,local,form,userId)
  .first<{revision:number;owner_notice:number;staff_notice:number;receipt:number;business_name:string;config_json:string}>();
 const built=await build(db,userId,project,local,form,flags,name,current?.revision??0);
 if(current&&current.config_json===built.configJson&&current.business_name===name&&!!current.owner_notice===flags.owner&&!!current.staff_notice===flags.staff&&!!current.receipt===flags.receipt)
  return result('These appointment notices are already set for the “'+form+'” form. Open Dashboard → Form records to see their status.');
 if(!current&&!flags.owner&&!flags.staff&&!flags.receipt)throw invalid('Choose at least one notice to turn on.');
 const reply=describe({form,flags,name,micros:built.priceMicros,checked:built.priceCheckedAt,revision:(current?.revision??0)+1});

 return result(reply,[
  db.prepare('INSERT INTO notification_configuration_reviews(id,user_id,project_id,instance_id,form_id,owner_notice,staff_notice,receipt,business_name,config_json,price_micros,price_checked_at,base_revision,digest,expires_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
   .bind(turnId,userId,project,built.instanceId,form,+flags.owner,+flags.staff,+flags.receipt,name,built.configJson,built.priceMicros,built.priceCheckedAt,current?.revision??0,built.digest,new Date(Date.now()+reviewMs).toISOString()),
  await receiptStatement(db,userId,turnId,'notificationConfiguration',turnId,reply)]);
}
type ReviewRow={id:string;project_id:string;instance_id:string;form_id:string;owner_notice:number;staff_notice:number;receipt:number;business_name:string;config_json:string;price_micros:number;price_checked_at:string;base_revision:number;digest:string;expires_at:string;status:string};

export type DeliveryState='inactive'|'spending-limit-unset'|'active';
/** What the dashboard says about sending: inactive (no provider binding), active-but-no-spending-limit (every configured notice is cancelled at send time) or active. */
export const deliveryState=(delivery:{settings:{customerCeilingCents?:number}}|null):DeliveryState=>!delivery?'inactive':delivery.settings.customerCeilingCents?'active':'spending-limit-unset';
/** Owner dashboard read: per form of each owned records module its saved notice settings and counts of the configured notices. Counts and flags only, never an address or a value. */
export async function readNotificationSetup(db:Pick<D1Database,'prepare'>,user:string,project:string,delivery:DeliveryState){
 if(!uuid.test(project)||!await db.prepare('SELECT 1 FROM projects WHERE id=? AND owner_user_id=?').bind(project,user).first())throw new ModuleError('not_found','Project not found.');
 const rows=(await db.prepare('SELECT c.instance_id,i.local_id,c.form_id,c.owner_notice,c.staff_notice,c.receipt,c.business_name,c.revision FROM notification_configurations c JOIN module_instances i ON i.id=c.instance_id WHERE c.project_id=? ORDER BY i.local_id,c.form_id LIMIT 32').bind(project).all<{instance_id:string;local_id:string;form_id:string;owner_notice:number;staff_notice:number;receipt:number;business_name:string;revision:number}>()).results;
 const counts=(await db.prepare("SELECT state,reason,count(*) n FROM notification_notices WHERE project_id=? AND template IN ('appointment.staff-notice@1','appointment.request-receipt@1') GROUP BY state,reason").bind(project).all<{state:string;reason:string|null;n:number}>()).results;
 const sum=(f:(c:{state:string;reason:string|null})=>boolean)=>counts.filter(f).reduce((a,c)=>a+c.n,0);
 return {delivery,forms:rows.map(r=>({instanceId:r.local_id,formId:r.form_id,notices:{owner:!!r.owner_notice,staff:!!r.staff_notice,receipt:!!r.receipt},businessName:r.business_name,revision:r.revision})),
  notices:{sent:sum(c=>['accepted','delivered'].includes(c.state)),waiting:sum(c=>['queued','dispatching','deferred','unknown-outcome'].includes(c.state)),
   notSent:sum(c=>c.state==='cancelled'||c.state==='failed'||c.state==='bounced'||c.state==='complained'||c.state==='unresolved')}};
}

/**
 * The approved-configuration resolver for `form.accepted` (inside the every-minute lane's queue step). Each accepted record after a configuration took effect,
 * within 24 hours, gets one outbox row per current recipient of each enabled notice, through `enqueueNotice`. No backfill, no model, no provider call.
 * Whether the notice is ever sent is decided at send time (`resolveConfiguredNotice`), including the owner's monthly spending limit.
 * shortcut: newest 50 events a pass, so a project taking more than 50 accepted records a minute leaves the oldest unqueued; revisit with WH-159 volumes.
 */
export async function queueConfiguredNotices(db:Db,nowMs:number,limit=50){
 const events=(await db.prepare(`SELECT e.entry_id,e.project_id,e.instance_id,c.form_id,c.revision,c.owner_notice,c.staff_notice,c.receipt,p.owner_user_id AS user_id,r.receipt_consent
   FROM module_record_events e JOIN notification_configurations c ON c.instance_id=e.instance_id AND c.project_id=e.project_id
   JOIN module_records r ON r.id=e.entry_id AND r.instance_id=e.instance_id AND r.form_id=c.form_id JOIN projects p ON p.id=e.project_id
   WHERE e.event='form.accepted' AND e.created_at>=c.created_at AND e.created_at>?1 AND c.owner_notice+c.staff_notice+c.receipt>0
    AND NOT EXISTS(SELECT 1 FROM notification_notices n WHERE n.project_id=e.project_id AND n.event_ref='form:'||e.entry_id||':r'||c.revision)
   ORDER BY e.created_at DESC LIMIT ?2`).bind(Math.floor(nowMs/1000)-86400,limit).all<{entry_id:string;project_id:string;instance_id:string;form_id:string;revision:number;owner_notice:number;staff_notice:number;receipt:number;user_id:string;receipt_consent:number}>()).results;
 const admitted=new Map<string,boolean>();
 const included=async(user:string,project:string)=>{
  const key=user+project;if(admitted.has(key))return admitted.get(key)!;
  const ok=await includedNow(db,user,project);admitted.set(key,ok);return ok;
 };
 const refs=async(project:string,scope:'owner'|'staff'|'submitter',ref?:string)=>(await db.prepare('SELECT ref FROM notification_recipients WHERE project_id=?1 AND scope=?2 AND (?3 IS NULL OR ref=?3) LIMIT 20').bind(project,scope,ref??null).all<{ref:string}>()).results.map(x=>x.ref);
 let queued=0;
 for(const e of events){
  if(!await included(e.user_id,e.project_id))continue;
  const eventRef=`form:${e.entry_id}:r${e.revision}`,base={userId:e.user_id,projectId:e.project_id,eventRef,now:nowMs};
  const one=async(spec:Parameters<typeof enqueueNotice>[1])=>{if((await enqueueNotice(db,spec)).queued)queued++;};
  if(e.owner_notice)for(const ref of await refs(e.project_id,'owner'))await one({...base,scope:'owner-destination',destinationId:ref,template:'appointment.staff-notice@1'});
  if(e.staff_notice)for(const ref of await refs(e.project_id,'staff'))await one({...base,scope:'project-staff',recipientRef:ref,template:'appointment.staff-notice@1'});
  if(e.receipt&&e.receipt_consent)for(const ref of await refs(e.project_id,'submitter',e.entry_id))await one({...base,scope:'submitter',recipientRef:ref,template:'appointment.request-receipt@1',caps:{hour:3,day:10}});
 }
 return queued;
}

/** Current `core.forms` inclusion for a background effect. The scheduled lane runs with platform authority, not a signed-in session, so this is the actor-free inclusion predicate (invoice or scoped preview grant) over the exact owned project. */
async function includedNow(db:Pick<D1Database,'prepare'>,user:string,project:string){
 const gate=inclusionPredicate(featureRequest({userId:user,projectId:project,featureId:'core.forms',operation:'dispatch'}));
 return !!await db.prepare(`SELECT 1 WHERE ${gate.sql}`).bind(...gate.params).first();
}
export type ConfiguredDeny='record-removed'|'configuration-changed'|'recipient-revoked'|'contained';
export type ConfiguredSend={recipient?:string;variables:Record<string,string>;fields:Record<string,{options:string[]}>};
/**
 * Everything read again immediately before the provider call for a configured notice: the record, the configuration revision and its switch for this
 * scope, current feature inclusion (`core.forms`), the recipient and the rendered values. An owner-destination recipient is the verified destination the
 * caller already read; staff and submitter addresses come from the `notification_recipients` view. A render refusal is a changed configuration, never a send.
 */
export async function resolveConfiguredNotice(db:Pick<D1Database,'prepare'>,n:{user_id:string;project_id:string|null;scope:string;template:string;event_ref:string;recipient_ref:string|null;contained:number}):Promise<ConfiguredSend|ConfiguredDeny>{
 const m=/^form:([0-9a-f-]{36}):r(\d{1,9})$/.exec(n.event_ref),flag=configuredFlag(n.template,n.scope);
 if(!m||!n.project_id||!flag)return 'record-removed';
 if(n.contained)return 'contained';
 const rec=await db.prepare('SELECT r.instance_id,r.form_id,r.values_json,r.receipt_consent,i.config_json FROM module_records r JOIN module_instances i ON i.id=r.instance_id WHERE r.id=? AND r.project_id=?').bind(m[1],n.project_id).first<{instance_id:string;form_id:string;values_json:string;receipt_consent:number;config_json:string}>();
 if(!rec)return 'record-removed';
 const c=await db.prepare('SELECT business_name,revision,owner_notice,staff_notice,receipt,config_json FROM notification_configurations WHERE instance_id=? AND form_id=?').bind(rec.instance_id,rec.form_id).first<{business_name:string;revision:number;owner_notice:number;staff_notice:number;receipt:number;config_json:string}>();
 const on=c&&(flag==='owner'?c.owner_notice:flag==='staff'?c.staff_notice:c.receipt);
 if(!c||c.revision!==Number(m[2])||!on)return 'configuration-changed';
 if(!await includedNow(db,n.user_id,n.project_id))return 'configuration-changed';
 let recipient:string|undefined;
 if(n.scope!=='owner-destination'){
  if(!n.recipient_ref||(flag==='receipt'&&(n.recipient_ref!==m[1]||!rec.receipt_consent)))return 'recipient-revoked';
  recipient=(await db.prepare('SELECT address FROM notification_recipients WHERE project_id=? AND scope=? AND ref=?').bind(n.project_id,flag==='staff'?'staff':'submitter',n.recipient_ref).first<{address:string}>())?.address;
  if(!recipient)return 'recipient-revoked';
 }
 const variables:Record<string,string>={businessName:c.business_name},fields:ConfiguredSend['fields']={};
 if(flag==='receipt'){
  const entry=(JSON.parse(c.config_json) as {id:string;fields:Record<string,string>}[]).find(x=>x.id==='appointment-receipt');
  const records=JSON.parse(rec.config_json) as RecordsConfig,schema=records.schemas.find(s=>s.id===records.forms.find(f=>f.id===rec.form_id)?.recordId);
  if(!entry||!schema)return 'configuration-changed';
  const values=JSON.parse(rec.values_json) as Record<string,unknown>;
  variables.reference=m[1].slice(0,8).toUpperCase();
  for(const [name,key] of Object.entries(entry.fields)){
   const v=values[key];if(typeof v!=='string')return 'configuration-changed';
   variables[name]=v;fields[name]={options:choices(schema.fields.find(f=>f.key===key))};
  }
 }
 try{renderCatalogNotification(n.template,variables,fields);}catch(error){if(error instanceof NotificationCatalogError)return 'configuration-changed';throw error;}
 return {...(recipient?{recipient}:{}),variables,fields};
}
