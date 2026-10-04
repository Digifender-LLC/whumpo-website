import {isWorkspaceViewDefinition} from './view-definition';
import {viewComponents} from '../workspace-view-contract';
/** Current protocol validation only. Domain storage owns issuance, authority and effects. */
import {canonicalJSON,jsonDigest,SpecificationError} from '../project-specification/v2/json';
import type {Field,Definition,Answers,OwnedResources,UnsignedInteraction,IssuedInteraction,Mutation,ClientCapabilities} from './types';
export type * from './types';

export const bounds = Object.freeze({requestBytes:32768,definitionBytes:24576,answerBytes:16384,depth:10,nodes:1024,fields:12,cards:8,choices:12});
// One content field becomes one compiler operation; the current compiler accepts eight.
export const contentFieldLimit=8;
// Closed binding vocabulary. Registry entries never grant access or dispatch an action.
export const bindings:Readonly<Record<string,{mode:string;feature:'core.editing'|'core.insights'|'creator.guest-feedback';source:string|null;handler:string|null;scope?:string;displays?:readonly string[]}>> = Object.freeze({
  'answer.value@1': {mode:'collect',feature:'core.editing',source:null,handler:null},
  'interaction.answers@1': {mode:'submit',feature:'core.editing',source:null,handler:null},
  // WH-035: the owner's explicit submission of the maintained support form also saves one existing support request.
  'support.request@1': {mode:'submit',feature:'core.editing',source:'src/chat-interactions/store.ts',handler:'mutateInteraction',scope:'account'},
  // Identity and ownership only: the owner's own support requests and saved operator responses (src/support.ts).
  'support.requests@1': {mode:'read',feature:'core.editing',source:'src/support.ts',handler:'listOwnedSupportRequests',scope:'account',displays:['support']},
  'owned.projects@1': {mode:'select',feature:'core.editing',source:'src/chat-interactions/resource-options.ts',handler:'readOwnedResourceOptions',scope:'account'},
  'owned.photos@1': {mode:'select',feature:'core.editing',source:'src/chat-interactions/resource-options.ts',handler:'readOwnedResourceOptions',scope:'project'},
  'site.content@1': {mode:'read',feature:'core.editing',source:'src/project-specification/store.ts',handler:'readSpecification',scope:'project'},
  'agent.task-continue@1': {mode:'prepare',feature:'core.editing',source:'src/chat-interactions/task-context.ts',handler:'prepareInformationTask',scope:'project'},
  'site.content-prepare@1': {mode:'prepare',feature:'core.editing',source:'src/project-specification/store.ts',handler:'prepareSpecification',scope:'project'},
  'workspace.projects@1': {mode:'read',feature:viewComponents.projects.feature,source:'src/workspace-view-bindings.ts',handler:'readViewBinding',scope:'account',displays:['workspace','summary','table']},
  'connection.github@1': {mode:'read',feature:'core.editing',source:'src/chat-interactions/connection-handoff.ts',handler:'readConnectionHandoff',scope:'account',displays:['consent']},
  'connection.cloudflare@1': {mode:'read',feature:'core.editing',source:'src/chat-interactions/connection-handoff.ts',handler:'readConnectionHandoff',scope:'account',displays:['consent']},
  'project.photos@1': {mode:'read',feature:'core.editing',source:'src/files.ts',handler:'readPhotoUpload',scope:'project',displays:['photos']},
  'project.status@1': {mode:'read',feature:viewComponents.projects.feature,source:'src/workspace-view-bindings.ts',handler:'readViewBinding',scope:'project',displays:['workspace','status','key-values']},
  'project.traffic@1': {mode:'read',feature:viewComponents.traffic.feature,source:'src/workspace-view-bindings.ts',handler:'readViewBinding',scope:'workspace',displays:['workspace','summary','table']},
  'account.usage@1': {mode:'read',feature:viewComponents.usage.feature,source:'src/workspace-view-bindings.ts',handler:'readViewBinding',scope:'workspace',displays:['workspace']},
  'project.storage@1': {mode:'read',feature:viewComponents.storage.feature,source:'src/workspace-view-bindings.ts',handler:'readViewBinding',scope:'workspace',displays:['workspace']},
  'owner.activity@1': {mode:'read',feature:viewComponents.activity.feature,source:'src/workspace-view-bindings.ts',handler:'readViewBinding',scope:'workspace',displays:['workspace']},
  'cms.status@1': {mode:'read',feature:viewComponents.cms.feature,source:'src/workspace-view-bindings.ts',handler:'readViewBinding',scope:'workspace',displays:['workspace']},
  'project.performance@1': {mode:'read',feature:viewComponents.performance.feature,source:'src/workspace-view-bindings.ts',handler:'readViewBinding',scope:'workspace',displays:['workspace']},
  'workspace.reviews@1': {mode:'read',feature:viewComponents.reviews.feature,source:'src/workspace-view-bindings.ts',handler:'readViewBinding',scope:'workspace',displays:['workspace']},
  // Feature family only: management reads stay ungated (viewComponents feature null) so revoke/delete outlive inclusion; issuance re-checks it.
  'project.guest-previews@1': {mode:'read',feature:'creator.guest-feedback',source:'src/workspace-view-bindings.ts',handler:'readViewBinding',scope:'project',displays:['workspace']},
  // Identity and ownership only (viewComponents feature null): the saved health report never needs insight inclusion.
  'project.site-health@1': {mode:'read',feature:'core.editing',source:'src/workspace-view-bindings.ts',handler:'readViewBinding',scope:'workspace',displays:['workspace']},
  // WH-125 module instance status. Feature family only: like guest previews, the view read is identity and ownership only
  // (viewComponents feature null) so owner read/disable outlive plan loss; activation re-checks core.forms/core.editing itself.
  'module.instances@1': {mode:'read',feature:'core.editing',source:'src/workspace-view-bindings.ts',handler:'readViewBinding',scope:'project',displays:['workspace']},
  // WH-126 staff roster. Identity and ownership only (viewComponents feature null) so reading and removing roles outlive
  // plan loss; granting re-checks core.editing in its own review. Opaque visitor ids and dates; no credentials or values.
  'access.roles@1': {mode:'read',feature:'core.editing',source:'src/workspace-view-bindings.ts',handler:'readViewBinding',scope:'project',displays:['workspace']},
  // WH-127 records counts. Identity and ownership only (viewComponents feature null): owner reads of collected data stay
  // reachable after plan loss. Counts, ids and states only; visitor-submitted values stay in the owner records panel.
  'records.summary@1': {mode:'read',feature:'core.editing',source:'src/workspace-view-bindings.ts',handler:'readViewBinding',scope:'project',displays:['workspace']},
  'site.comparison@1': {mode:'read',feature:'core.editing',source:'src/project-specification/store.ts',handler:'specificationReviewDetails',scope:'review',displays:['comparison']},
  'site.preview@1': {mode:'read',feature:'core.editing',source:'src/project-specification/store.ts',handler:'specificationPreview',scope:'review',displays:['preview']},
});
export const collectionBindings=Object.freeze({projects:'owned.projects@1',photos:'owned.photos@1'});
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const name=/^[a-z][a-z0-9-]{0,39}$/;
const own=(o:object,k:PropertyKey)=>Object.hasOwn(o,k);
const plain=(o:unknown):o is Record<string,unknown>=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&Object.getPrototypeOf(o)===Object.prototype;
export class InteractionError extends Error {constructor(readonly code:string,readonly fieldId:string|null=null){super('Chat interaction '+code);}}
function fail(code:string):never {throw new InteractionError(code);}
function check(ok:unknown,code:string):asserts ok {if(!ok)fail(code);}
function shape(o:unknown,required:readonly string[],optional:readonly string[]=[]) {
  check(plain(o),'SHAPE');
  check(Object.keys(o).every(k=>required.includes(k)||optional.includes(k)),'UNKNOWN_FIELD');
  check(required.every(k=>own(o,k)),'MISSING_FIELD');
}
function text(s:unknown,max:number,empty=false){check(typeof s==='string'&&s.length<=max&&(empty||s.trim().length>0)&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s),'TEXT');}
const integer=(n:unknown,min:number,max:number)=>check(typeof n==='number'&&Number.isSafeInteger(n)&&n>=min&&n<=max,'NUMBER');
const identifier=(s:unknown)=>check(typeof s==='string'&&name.test(s)&&!['constructor','prototype','__proto__'].includes(s),'ID');
function list(a:unknown,max:number):asserts a is unknown[] {check(Array.isArray(a)&&a.length<=max,'LIST');}
const unique=(a:readonly object[],key:string)=>{check(a.every(plain),'SHAPE');check(new Set(a.map(x=>x[key])).size===a.length,'DUPLICATE');};
function copyJSON<T>(input:unknown,max:number):T {
  // The maintained encoder refuses getters, symbols, sparse arrays and toJSON
  // before anything can evaluate user-controlled object behavior.
  let json:string;
  try {json=canonicalJSON(input,max);}catch(error){
    if(error instanceof SpecificationError)fail(error.code==='INPUT_TOO_LARGE'?'BYTES':error.code==='INPUT_TOO_DEEP'?'COMPLEXITY':error.code==='INVALID_NUMBER'?'NUMBER':'SHAPE');
    throw error;
  }
  const result:unknown=JSON.parse(json);let nodes=0;
  function visit(v:unknown,depth:number){check(++nodes<=bounds.nodes&&depth<=bounds.depth,'COMPLEXITY');if(v&&typeof v==='object')for(const child of Object.values(v))visit(child,depth+1);}
  visit(result,0);return result as T;
}
const hash=(v:unknown)=>jsonDigest(v,32768);

function fieldValue(f:Field,v:unknown,owned?:OwnedResources) {
  if((f.type==='text'||f.type==='long-text'))text(v,f.constraints.maxLength,!f.required);
  else if(f.type==='boolean')check(typeof v==='boolean','VALUE');
  else if(f.type==='number'){
    check(typeof v==='number'&&Number.isFinite(v)&&v>=f.constraints.min&&v<=f.constraints.max,'VALUE');
    const steps=(v-f.constraints.min)/f.constraints.step;check(Math.abs(steps-Math.round(steps))<1e-7,'VALUE');
  }else if(f.type==='choice')check(f.constraints.options.some(o=>o.id===v),'VALUE');
  else if(f.type==='multi-choice'){
    list(v,f.constraints.options.length);check(new Set(v).size===v.length&&(!f.required||v.length>0)&&v.every(x=>f.constraints.options.some(o=>o.id===x)),'VALUE');
  }else if(f.type==='date')check(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!v.startsWith('0000-')&&Number.isFinite(Date.parse(v+'T00:00:00.000Z'))&&new Date(v+'T00:00:00.000Z').toISOString().slice(0,10)===v,'VALUE');
  else if(f.type==='datetime'){
    check(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)&&!v.startsWith('0000-')&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v,'VALUE');
    const local=new Intl.DateTimeFormat('en-US',{timeZone:f.constraints.zone,calendar:'gregory',numberingSystem:'latn',era:'short',year:'numeric'}).formatToParts(new Date(v));
    check(local.find(p=>p.type==='era')?.value==='AD'&&Number(local.find(p=>p.type==='year')?.value)<=9999,'VALUE');
  }
  else if(f.type==='resource'||f.type==='attachment') {
    const values=f.constraints.multiple?v:[v];list(values,f.constraints.maxItems);
    check(new Set(values).size===values.length&&(!f.required||values.length>0)&&values.every(x=>typeof x==='string'&&uuid.test(x)),'VALUE');
    // Domain adapters must supply fresh project/tenant/safety-filtered resource IDs.
    if(owned)check(values.every(x=>owned[f.constraints.collection]?.includes(x as string)),'RESOURCE_UNAVAILABLE');
  }else fail('FIELD_TYPE');
}
function field(f:Field,prior:Field[]) {
  shape(f,['id','type','label','help','required','binding','constraints'],['default','when','source','group','questionId']);
  identifier(f.id);text(f.label,80);text(f.help,240,true);check(typeof f.required==='boolean','VALUE');
  check(f.binding==='answer.value@1','BINDING');
  check(['text','long-text','choice','multi-choice','boolean','number','date','datetime','resource','attachment'].includes(f.type),'FIELD_TYPE');
  if((f.type==='text'||f.type==='long-text')){shape(f.constraints,['maxLength']);integer(f.constraints.maxLength,1,f.type==='text'?200:2000);}
  else if((f.type==='choice'||f.type==='multi-choice')){
    shape(f.constraints,['options']);list(f.constraints.options,bounds.choices);check(f.constraints.options.length>0,'LIST');unique(f.constraints.options,'id');
    for(const o of f.constraints.options){shape(o,['id','label']);identifier(o.id);text(o.label,80);}
  }else if(f.type==='number'){
    shape(f.constraints,['min','max','step']);check([f.constraints.min,f.constraints.max,f.constraints.step].every(Number.isFinite)&&f.constraints.min>=-1e9&&f.constraints.max<=1e9&&f.constraints.min<=f.constraints.max&&f.constraints.step>0&&f.constraints.step<=1e9,'NUMBER');
  }else if(f.type==='datetime'){
    shape(f.constraints,['zone']);text(f.constraints.zone,80);try{new Intl.DateTimeFormat('en-US',{timeZone:f.constraints.zone});}catch{fail('ZONE');}
  }else if((f.type==='resource'||f.type==='attachment')){
    shape(f.constraints,['collection','multiple','maxItems']);check(['projects','photos'].includes(f.constraints.collection)&&(f.type!=='attachment'||('collection' in f.constraints&&f.constraints.collection==='photos')),'BINDING');
    check(typeof f.constraints.multiple==='boolean','VALUE');integer(f.constraints.maxItems,1,f.constraints.multiple?5:1);
  }else shape(f.constraints,[]);
  if(own(f,'questionId'))identifier(f.questionId);
  if(own(f,'group'))integer(f.group,0,2);
  if(own(f,'when')){
    const when=f.when;shape(when,['fieldId','equals']);check(when,'SHAPE');const controller=prior.find(x=>x.id===when.fieldId);
    check(controller&&!controller.when&&['choice','boolean'].includes(controller.type),'CONDITION');fieldValue(controller,when.equals);
  }
  if(own(f,'source')){shape(f.source,['binding','contentId','revision']);check(f.source?.binding==='site.content@1'&&(f.type==='text'||f.type==='long-text'),'BINDING');identifier(f.source.contentId);integer(f.source.revision,0,Number.MAX_SAFE_INTEGER);}
  if(own(f,'default')){
    const preset=f.default;shape(preset,['value','provenance']);check(preset,'SHAPE');check(['saved','user','suggested'].includes(preset.provenance),'PROVENANCE');
    // Carried user drafts may be incomplete. Submission still validates the
    // original required field; saved-site and suggested defaults stay complete.
    check(preset.provenance!=='saved'||!!f.source,'PROVENANCE');fieldValue(preset.provenance==='user'?{...f,required:false}:f,preset.value);
  }
}
export function validateDefinition(input:unknown):Definition {
  const d=copyJSON<Definition>(input,bounds.definitionBytes);
  shape(d,['version','kind','template','title','summary','presentation','fields','cards','submitBinding','continuationBinding'],['purpose','workspaceView']);
  if(own(d,'workspaceView'))check(isWorkspaceViewDefinition(d),'TEMPLATE');
  if(d.template==='custom@1')text(d.purpose,80);else check(!own(d,'purpose'),'PURPOSE');
  check(d.version===1,'VERSION');check(['form','view'].includes(d.kind),'KIND');
  text(d.title,100);text(d.summary,400);check(['inline','panel','dialog'].includes(d.presentation),'PRESENTATION');
  list(d.fields,bounds.fields);list(d.cards,bounds.cards);unique(d.fields,'id');unique(d.cards,'id');
  d.fields.forEach((f,i)=>field(f,d.fields.slice(0,i)));
  if(d.template!=='custom@1')check(!d.fields.some(f=>own(f,'questionId')),'PURPOSE');
  for(const c of d.cards){
    shape(c,['id','binding','display','limit','reviewId']);identifier(c.id);
    const b=own(bindings,c.binding)?bindings[c.binding]:null;
    check(b?.mode==='read'&&b.displays?.includes(c.display),'BINDING');integer(c.limit,1,20);
    check(b.scope==='review'?typeof c.reviewId==='string'&&uuid.test(c.reviewId):c.reviewId===null,'REFERENCE');
  }
  if(!own(d,'workspaceView'))check(!d.cards.some(c=>c.display==='workspace'),'TEMPLATE');
  if(d.kind==='view')check(d.template==='status@1'&&d.fields.length===0&&d.cards.length>0&&d.submitBinding===null&&d.continuationBinding===null,'TEMPLATE');
  else {
    check(['content-change@1','project-brief@1','project-select@1','choice@1','custom@1','support-request@1'].includes(d.template)&&d.fields.length>0&&d.submitBinding===(d.template==='support-request@1'?'support.request@1':'interaction.answers@1'),'TEMPLATE');
    check(d.continuationBinding===null||d.continuationBinding==='site.content-prepare@1'||['custom@1','project-select@1','project-brief@1'].includes(d.template)&&d.continuationBinding==='agent.task-continue@1','BINDING');
    if(d.template==='content-change@1')check(d.continuationBinding==='site.content-prepare@1','TEMPLATE');
    if(d.template==='project-brief@1'){
      check(d.continuationBinding==='agent.task-continue@1'&&d.fields.length===2&&d.fields[0].id==='name'&&d.fields[0].type==='text'&&d.fields[0].constraints.maxLength<=100&&d.fields[0].required&&d.fields[1].id==='purpose'&&d.fields[1].type==='long-text'&&d.fields[1].constraints.maxLength<=1000&&d.fields[1].required&&!d.fields.some(f=>f.source||f.when),'TEMPLATE');
    }
    if(d.template==='project-select@1')check(d.continuationBinding==='agent.task-continue@1'&&d.fields.length===1&&d.fields[0].id==='project'&&d.fields[0].type==='resource'&&d.fields[0].constraints.collection==='projects'&&!d.fields[0].constraints.multiple&&d.fields[0].required&&!d.fields[0].when,'TEMPLATE');
    if(d.template==='support-request@1')check(d.continuationBinding===null&&d.fields.length===1&&d.fields[0].id==='statement'&&d.fields[0].type==='long-text'&&d.fields[0].constraints.maxLength===950&&d.fields[0].required&&!d.fields[0].when&&!d.fields[0].source&&d.cards.length===0,'TEMPLATE');
    if(d.template==='choice@1')check(d.continuationBinding===null&&d.fields.length===1&&['choice','multi-choice'].includes(d.fields[0].type)&&!d.fields[0].when,'TEMPLATE');
    if(d.continuationBinding==='site.content-prepare@1'){
      check(d.fields.length<=contentFieldLimit,'CONTENT_MAPPING');
      check(d.fields.every(f=>f.source&&f.required&&!f.when&&'maxLength' in f.constraints&&f.constraints.maxLength<=1000),'CONTENT_MAPPING');
      unique(d.fields.map(f=>({id:f.source!.contentId})),'id');
      check(new Set(d.fields.map(f=>f.source!.revision)).size===1,'CONTENT_MAPPING');
    }
  }
  return d;
}
/** A validated definition permits only an earlier unconditional choice/boolean
 * controller. No implicit defaults, coercion, expression evaluation or cascades. */
export function isFieldVisible(field:Field,answers:Answers):boolean{
  return !field.when||(own(answers,field.when.fieldId)&&answers[field.when.fieldId]===field.when.equals);
}
export function validateAnswers(definition:unknown,input:unknown,{owned,partial=false}:{owned?:OwnedResources;partial?:boolean}={}):Answers{
  const d=validateDefinition(definition),a=copyJSON<Answers>(input,bounds.answerBytes);
  check(d.kind==='form','KIND');shape(a,[],d.fields.map(f=>f.id));
  for(const f of d.fields){
    try{
      const visible=isFieldVisible(f,a);
      if(!visible){check(!own(a,f.id),'HIDDEN_VALUE');continue;}
      check(partial||!f.required||own(a,f.id),'REQUIRED');if(own(a,f.id))fieldValue(partial?{...f,required:false}:f,a[f.id],owned);
    }catch(error){if(error instanceof InteractionError)throw new InteractionError(error.code,f.id);throw error;}
  }
  return a; // No defaults implicitly inserted and no effect dispatched.
}
export function contentRequest(definition:unknown,answers:unknown,projectId:string){
  const d=validateDefinition(definition),a=validateAnswers(d,answers);
  check(d.continuationBinding==='site.content-prepare@1'&&typeof projectId==='string'&&uuid.test(projectId),'BINDING');
  return {kind:'specification' as const,operation:'change' as const,projectId,expectedRevision:d.fields[0].source!.revision,
    operations:d.fields.map(f=>({type:'content.replace' as const,contentId:f.source!.contentId,text:a[f.id] as string}))};
}
export async function sealDefinition(input:unknown):Promise<IssuedInteraction>{
  const e=copyJSON<UnsignedInteraction>(input,32768);shape(e,['version','id','scope','createdAt','expiresAt','definition']);check(e.version===1,'VERSION');check(typeof e.id==='string'&&uuid.test(e.id),'ID');
  shape(e.scope,['accountId','actorId','conversationId','projectId','taskId','originTurnId']);
  for(const [key,v] of Object.entries(e.scope))check(key==='projectId'&&v===null||typeof v==='string'&&uuid.test(v),'ID');
  check([e.createdAt,e.expiresAt].every(v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v),'TIME');
  check(Date.parse(e.expiresAt)>Date.parse(e.createdAt)&&Date.parse(e.expiresAt)-Date.parse(e.createdAt)<=604800000,'TIME');
  e.definition=validateDefinition(e.definition);
  if(e.definition.workspaceView)check(e.definition.workspaceView.projectId===e.scope.projectId,'PROJECT');
  const projectNeeded=e.definition.fields.some(f=>f.source||f.type==='attachment'||('collection' in f.constraints&&f.constraints.collection==='photos'))||e.definition.cards.some(c=>['project','review'].includes(bindings[c.binding].scope??''))||(e.definition.continuationBinding!==null&&!['project-select@1','project-brief@1'].includes(e.definition.template));
  check(!projectNeeded||e.scope.projectId!==null,'PROJECT');
  if(['project-select@1','project-brief@1','support-request@1'].includes(e.definition.template))check(e.scope.projectId===null,'PROJECT');
  return {...e,definitionDigest:await hash(e)};
}
export async function verifyEnvelope(input:unknown):Promise<IssuedInteraction>{
  const e=copyJSON<IssuedInteraction>(input,32768);shape(e,['version','id','scope','createdAt','expiresAt','definition','definitionDigest']);
  const {definitionDigest,...unsigned}=e,sealed=await sealDefinition(unsigned);check(sealed.definitionDigest===definitionDigest,'DIGEST');return sealed;
}
/** Structure and binding only; runtime checks stored state, current authority,
 * expiry, request uniqueness and answer revision inside its transaction. */
export function mutationHeader(input:unknown):Mutation{
  const r=copyJSON<Mutation>(input,bounds.requestBytes);
  shape(r,['version','requestId','interactionId','definitionDigest','expectedAnswerRevision','operation'],['answers']);
  check(r.version===1,'VERSION');check(typeof r.requestId==='string'&&uuid.test(r.requestId)&&typeof r.interactionId==='string'&&uuid.test(r.interactionId),'ID');
  check(typeof r.definitionDigest==='string'&&/^[a-f0-9]{64}$/.test(r.definitionDigest),'SHAPE');
  integer(r.expectedAnswerRevision,0,Number.MAX_SAFE_INTEGER-1);check(['save-draft','submit','cancel'].includes(r.operation),'OPERATION');
  if(r.operation==='cancel')check(!own(r,'answers'),'UNKNOWN_FIELD');else check(own(r,'answers'),'MISSING_FIELD');
  return r;
}
export async function validateMutation(input:unknown,envelope:unknown,options:{owned?:OwnedResources}={}){
  const e=await verifyEnvelope(envelope),r=mutationHeader(input);
  check(r.interactionId===e.id,'REFERENCE');check(r.definitionDigest===e.definitionDigest,'DIGEST');check(e.definition.kind==='form'||r.operation==='cancel','KIND');
  if(r.operation!=='cancel')r.answers=validateAnswers(e.definition,r.answers,{owned:options.owned,partial:r.operation==='save-draft'});
  return {request:r,requestHash:await hash(r)};
}
export async function requireCurrentClient(envelope:unknown,input:unknown){
  const e=await verifyEnvelope(envelope),client=copyJSON<ClientCapabilities>(input,8192);
  shape(client,['versions','fieldTypes','bindings']);list(client.versions,4);list(client.fieldTypes,20);list(client.bindings,64);
  const needed=[e.definition.submitBinding,e.definition.continuationBinding,...e.definition.fields.map(f=>f.binding),...e.definition.fields.filter(f=>f.source).map(f=>f.source!.binding),...e.definition.fields.filter(f=>(f.type==='resource'||f.type==='attachment')).map(f=>collectionBindings[(f.constraints as {collection:'projects'|'photos'}).collection]),...e.definition.cards.map(c=>c.binding)].filter((b):b is string=>typeof b==='string');
  check(new Set(client.fieldTypes).size===client.fieldTypes.length&&client.fieldTypes.every(t=>['text','long-text','choice','multi-choice','boolean','number','date','datetime','resource','attachment'].includes(t))&&new Set(client.bindings).size===client.bindings.length&&client.bindings.every(b=>typeof b==='string'&&own(bindings,b)),'CLIENT_UPDATE_REQUIRED');
  const supported=client.versions.length===1&&client.versions[0]===e.version&&e.definition.fields.every(f=>client.fieldTypes.includes(f.type))&&needed.every(b=>client.bindings.includes(b));
  check(supported,'CLIENT_UPDATE_REQUIRED');
  return {canSubmit:e.definition.kind==='form',canApprove:false};
}
