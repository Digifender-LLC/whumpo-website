/** WH-105 offline reference, NOT runtime admission, storage, UI or an action dispatcher. */
import {createHash} from 'node:crypto';

export const bounds = Object.freeze({definitionBytes:24576,answerBytes:16384,depth:10,nodes:1024,fields:12,cards:8,choices:12});
// Frozen contract names. All interaction adapters are planned; source names identify
// existing domain foundations, not callable new endpoints or authorization grants.
export const bindings = Object.freeze({
  'answer.value@1': {mode:'collect',feature:'core.editing',source:null,handler:null},
  'interaction.answers@1': {mode:'submit',feature:'core.editing',source:null,handler:null},
  'owned.projects@1': {mode:'select',feature:'core.editing',source:'src/workspace-dashboard.ts',handler:'dashboardData',scope:'account'},
  'owned.photos@1': {mode:'select',feature:'core.editing',source:'src/files.ts',handler:'listPhotos',scope:'project'},
  'site.content@1': {mode:'read',feature:'core.editing',source:'src/project-specification/store.ts',handler:'readSpecification',scope:'project'},
  'site.content-prepare@1': {mode:'prepare',feature:'core.editing',source:'src/project-specification/store.ts',handler:'prepareSpecification',scope:'project'},
  'workspace.projects@1': {mode:'read',feature:'core.editing',source:'src/workspace-dashboard.ts',handler:'dashboardData',scope:'account',displays:['summary','table']},
  'project.status@1': {mode:'read',feature:'core.editing',source:'src/workspace-dashboard.ts',handler:'dashboardData',scope:'project',displays:['status','key-values']},
  'project.traffic@1': {mode:'read',feature:'core.insights',source:'src/site-traffic.ts',handler:'readTraffic',scope:'project',displays:['summary','table']},
  'site.comparison@1': {mode:'read',feature:'core.editing',source:'src/project-specification/store.ts',handler:'specificationPreview',scope:'review',displays:['comparison']},
  'site.preview@1': {mode:'read',feature:'core.editing',source:'src/project-specification/store.ts',handler:'specificationPreview',scope:'review',displays:['preview']},
});
export const collectionBindings=Object.freeze({projects:'owned.projects@1',photos:'owned.photos@1'});
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const name=/^[a-z][a-z0-9-]{0,39}$/;
const own=(o,k)=>Object.hasOwn(o,k);
const plain=o=>o!==null&&typeof o==='object'&&!Array.isArray(o)&&Object.getPrototypeOf(o)===Object.prototype;
const fail=code=>{throw Object.assign(new Error(code),{code});};
const check=(ok,code)=>{if(!ok)fail(code);};
function shape(o,required,optional=[]) {
  check(plain(o),'SHAPE');
  check(Object.keys(o).every(k=>required.includes(k)||optional.includes(k)),'UNKNOWN_FIELD');
  check(required.every(k=>own(o,k)),'MISSING_FIELD');
}
function text(s,max,empty=false){check(typeof s==='string'&&s.length<=max&&(empty||s.trim().length>0)&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s),'TEXT');}
const integer=(n,min,max)=>check(Number.isSafeInteger(n)&&n>=min&&n<=max,'NUMBER');
const identifier=s=>check(typeof s==='string'&&name.test(s)&&!['constructor','prototype','__proto__'].includes(s),'ID');
const list=(a,max)=>check(Array.isArray(a)&&a.length<=max,'LIST');
const unique=(a,key)=>{check(a.every(plain),'SHAPE');check(new Set(a.map(x=>x[key])).size===a.length,'DUPLICATE');};
function copyJSON(input,max) {
  let nodes=0;
  function walk(v,depth){
    check(++nodes<=bounds.nodes&&depth<=bounds.depth,'COMPLEXITY');
    if(v===null||typeof v==='boolean'||typeof v==='string')return;
    if(typeof v==='number'){check(Number.isFinite(v),'NUMBER');return;}
    check(Array.isArray(v)||plain(v),'SHAPE');
    for(const value of Object.values(v))walk(value,depth+1);
  }
  walk(input,0);const json=JSON.stringify(input);check(Buffer.byteLength(json)<=max,'BYTES');return JSON.parse(json);
}
function canonical(v){return Array.isArray(v)?'['+v.map(canonical).join(',')+']':plain(v)?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);}
const hash=v=>createHash('sha256').update(canonical(v)).digest('hex');

function fieldValue(f,v,owned) {
  const c=f.constraints;
  if(['text','long-text'].includes(f.type))text(v,c.maxLength,!f.required);
  else if(f.type==='boolean')check(typeof v==='boolean','VALUE');
  else if(f.type==='number'){
    check(typeof v==='number'&&Number.isFinite(v)&&v>=c.min&&v<=c.max,'VALUE');
    const steps=(v-c.min)/c.step;check(Math.abs(steps-Math.round(steps))<1e-7,'VALUE');
  }else if(f.type==='choice')check(c.options.some(o=>o.id===v),'VALUE');
  else if(f.type==='multi-choice'){
    list(v,c.options.length);check(new Set(v).size===v.length&&(!f.required||v.length>0)&&v.every(x=>c.options.some(o=>o.id===x)),'VALUE');
  }else if(f.type==='date')check(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v+'T00:00:00.000Z'))&&new Date(v+'T00:00:00.000Z').toISOString().slice(0,10)===v,'VALUE');
  else if(f.type==='datetime')check(typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v,'VALUE');
  else {
    const values=c.multiple?v:[v];list(values,c.maxItems);
    check(new Set(values).size===values.length&&(!f.required||values.length>0)&&values.every(x=>typeof x==='string'&&uuid.test(x)),'VALUE');
    // Supplied fixture resolver only. Runtime must recheck project/tenant/safety.
    if(owned)check(values.every(x=>owned[c.collection]?.includes(x)),'RESOURCE_UNAVAILABLE');
  }
}
function field(f,prior) {
  shape(f,['id','type','label','help','required','binding','constraints'],['default','when','source','group']);
  identifier(f.id);text(f.label,80);text(f.help,240,true);check(typeof f.required==='boolean','VALUE');
  check(f.binding==='answer.value@1','BINDING');
  check(['text','long-text','choice','multi-choice','boolean','number','date','datetime','resource','attachment'].includes(f.type),'FIELD_TYPE');
  const c=f.constraints;
  if(['text','long-text'].includes(f.type)){shape(c,['maxLength']);integer(c.maxLength,1,f.type==='text'?200:2000);}
  else if(['choice','multi-choice'].includes(f.type)){
    shape(c,['options']);list(c.options,bounds.choices);check(c.options.length>0,'LIST');unique(c.options,'id');
    for(const o of c.options){shape(o,['id','label']);identifier(o.id);text(o.label,80);}
  }else if(f.type==='number'){
    shape(c,['min','max','step']);check([c.min,c.max,c.step].every(Number.isFinite)&&c.min>=-1e9&&c.max<=1e9&&c.min<=c.max&&c.step>0&&c.step<=1e9,'NUMBER');
  }else if(f.type==='datetime'){
    shape(c,['zone']);text(c.zone,80);try{new Intl.DateTimeFormat('en-US',{timeZone:c.zone});}catch{fail('ZONE');}
  }else if(['resource','attachment'].includes(f.type)){
    shape(c,['collection','multiple','maxItems']);check(['projects','photos'].includes(c.collection)&&(f.type!=='attachment'||c.collection==='photos'),'BINDING');
    check(typeof c.multiple==='boolean','VALUE');integer(c.maxItems,1,c.multiple?5:1);
  }else shape(c,[]);
  if(own(f,'group'))integer(f.group,0,2);
  if(own(f,'when')){
    shape(f.when,['fieldId','equals']);const controller=prior.find(x=>x.id===f.when.fieldId);
    check(controller&&!controller.when&&['choice','boolean'].includes(controller.type),'CONDITION');fieldValue(controller,f.when.equals);
  }
  if(own(f,'source')){shape(f.source,['binding','contentId','revision']);check(f.source.binding==='site.content@1'&&['text','long-text'].includes(f.type),'BINDING');identifier(f.source.contentId);integer(f.source.revision,0,Number.MAX_SAFE_INTEGER);}
  if(own(f,'default')){
    shape(f.default,['value','provenance']);check(['saved','user','suggested'].includes(f.default.provenance),'PROVENANCE');
    check(f.default.provenance!=='saved'||!!f.source,'PROVENANCE');fieldValue(f,f.default.value);
  }
}
export function validateDefinition(input) {
  const d=copyJSON(input,bounds.definitionBytes);
  shape(d,['version','kind','template','title','summary','presentation','fields','cards','submitBinding','continuationBinding']);
  check(d.version===1,'VERSION');check(['form','view'].includes(d.kind),'KIND');
  text(d.title,100);text(d.summary,400);check(['inline','panel','dialog'].includes(d.presentation),'PRESENTATION');
  list(d.fields,bounds.fields);list(d.cards,bounds.cards);unique(d.fields,'id');unique(d.cards,'id');
  d.fields.forEach((f,i)=>field(f,d.fields.slice(0,i)));
  for(const c of d.cards){
    shape(c,['id','binding','display','limit','reviewId']);identifier(c.id);
    const b=own(bindings,c.binding)?bindings[c.binding]:null;
    check(b?.mode==='read'&&b.displays?.includes(c.display),'BINDING');integer(c.limit,1,20);
    check(b.scope==='review'?typeof c.reviewId==='string'&&uuid.test(c.reviewId):c.reviewId===null,'REFERENCE');
  }
  if(d.kind==='view')check(d.template==='status@1'&&d.fields.length===0&&d.cards.length>0&&d.submitBinding===null&&d.continuationBinding===null,'TEMPLATE');
  else {
    check(['content-change@1','project-brief@1','project-select@1','choice@1','custom@1'].includes(d.template)&&d.fields.length>0&&d.submitBinding==='interaction.answers@1','TEMPLATE');
    check(d.continuationBinding===null||d.continuationBinding==='site.content-prepare@1','BINDING');
    if(d.template==='content-change@1')check(d.continuationBinding==='site.content-prepare@1','TEMPLATE');
    if(d.template==='project-brief@1'){
      check(d.continuationBinding===null&&d.fields.length===2&&d.fields[0].id==='name'&&d.fields[0].type==='text'&&d.fields[0].constraints.maxLength<=100&&d.fields[0].required&&d.fields[1].id==='purpose'&&d.fields[1].type==='long-text'&&d.fields[1].constraints.maxLength<=1000&&d.fields[1].required&&!d.fields.some(f=>f.source||f.when),'TEMPLATE');
    }
    if(d.template==='project-select@1')check(d.continuationBinding===null&&d.fields.length===1&&d.fields[0].id==='project'&&d.fields[0].type==='resource'&&d.fields[0].constraints.collection==='projects'&&!d.fields[0].constraints.multiple&&d.fields[0].required&&!d.fields[0].when,'TEMPLATE');
    if(d.template==='choice@1')check(d.continuationBinding===null&&d.fields.length===1&&['choice','multi-choice'].includes(d.fields[0].type)&&!d.fields[0].when,'TEMPLATE');
    if(d.continuationBinding){
      check(d.fields.every(f=>f.source&&f.required&&!f.when&&f.constraints.maxLength<=1000),'CONTENT_MAPPING');
      unique(d.fields.map(f=>({id:f.source.contentId})),'id');
      check(new Set(d.fields.map(f=>f.source.revision)).size===1,'CONTENT_MAPPING');
    }
  }
  return d;
}
export function validateAnswers(definition,input,{owned,partial=false}={}){
  const d=validateDefinition(definition),a=copyJSON(input,bounds.answerBytes);
  check(d.kind==='form','KIND');shape(a,[],d.fields.map(f=>f.id));
  for(const f of d.fields){
    const visible=!f.when||(own(a,f.when.fieldId)&&a[f.when.fieldId]===f.when.equals);
    if(!visible){check(!own(a,f.id),'HIDDEN_VALUE');continue;}
    check(partial||!f.required||own(a,f.id),'REQUIRED');if(own(a,f.id))fieldValue(partial?{...f,required:false}:f,a[f.id],owned);
  }
  return a; // No defaults implicitly inserted and no effect dispatched.
}
export function contentRequest(definition,answers,projectId){
  const d=validateDefinition(definition),a=validateAnswers(d,answers);
  check(d.continuationBinding==='site.content-prepare@1'&&typeof projectId==='string'&&uuid.test(projectId),'BINDING');
  return {kind:'specification',operation:'change',projectId,expectedRevision:d.fields[0].source.revision,
    operations:d.fields.map(f=>({type:'content.replace',contentId:f.source.contentId,text:a[f.id]}))};
}
export function sealDefinition(input){
  const e=copyJSON(input,32768);shape(e,['version','id','scope','createdAt','expiresAt','definition']);check(e.version===1,'VERSION');check(typeof e.id==='string'&&uuid.test(e.id),'ID');
  shape(e.scope,['accountId','actorId','conversationId','projectId','taskId','originTurnId']);
  for(const [key,v] of Object.entries(e.scope))check(key==='projectId'&&v===null||typeof v==='string'&&uuid.test(v),'ID');
  check([e.createdAt,e.expiresAt].every(v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v),'TIME');
  check(Date.parse(e.expiresAt)>Date.parse(e.createdAt)&&Date.parse(e.expiresAt)-Date.parse(e.createdAt)<=604800000,'TIME');
  e.definition=validateDefinition(e.definition);
  const projectNeeded=e.definition.fields.some(f=>f.source||f.type==='attachment'||f.constraints.collection==='photos')||e.definition.cards.some(c=>bindings[c.binding].scope!=='account')||e.definition.continuationBinding;
  check(!projectNeeded||e.scope.projectId!==null,'PROJECT');
  return {...e,definitionDigest:hash(e)};
}
export function verifyEnvelope(input){
  const e=copyJSON(input,32768);shape(e,['version','id','scope','createdAt','expiresAt','definition','definitionDigest']);
  const {definitionDigest,...unsigned}=e,sealed=sealDefinition(unsigned);check(sealed.definitionDigest===definitionDigest,'DIGEST');return sealed;
}
/** Structure and binding only; runtime checks stored state, current authority,
 * expiry, request uniqueness and answer revision inside its transaction. */
export function validateMutation(input,envelope,options={}){
  const e=verifyEnvelope(envelope),r=copyJSON(input,32768);
  shape(r,['version','requestId','interactionId','definitionDigest','expectedAnswerRevision','operation'],['answers']);
  check(r.version===1,'VERSION');check(typeof r.requestId==='string'&&uuid.test(r.requestId),'ID');
  check(r.interactionId===e.id,'REFERENCE');check(r.definitionDigest===e.definitionDigest,'DIGEST');
  integer(r.expectedAnswerRevision,0,Number.MAX_SAFE_INTEGER);check(['save-draft','submit','cancel'].includes(r.operation),'OPERATION');
  check(e.definition.kind==='form','KIND');
  if(r.operation==='cancel')check(!own(r,'answers'),'UNKNOWN_FIELD');
  else r.answers=validateAnswers(e.definition,r.answers,{owned:options.owned,partial:r.operation==='save-draft'});
  return {request:r,requestHash:hash(r)};
}
export function requireCurrentClient(envelope,client){
  const e=verifyEnvelope(envelope);
  shape(client,['versions','fieldTypes','bindings']);list(client.versions,4);list(client.fieldTypes,20);list(client.bindings,64);
  const needed=[e.definition.submitBinding,e.definition.continuationBinding,...e.definition.fields.map(f=>f.binding),...e.definition.fields.filter(f=>f.source).map(f=>f.source.binding),...e.definition.fields.filter(f=>['resource','attachment'].includes(f.type)).map(f=>collectionBindings[f.constraints.collection]),...e.definition.cards.map(c=>c.binding)].filter(Boolean);
  const supported=client.versions.length===1&&client.versions[0]===e.version&&e.definition.fields.every(f=>client.fieldTypes.includes(f.type))&&needed.every(b=>client.bindings.includes(b));
  check(supported,'CLIENT_UPDATE_REQUIRED');
  return {canSubmit:e.definition.kind==='form',canApprove:false};
}
