import {photoConfig} from '../../components';
import {SpecificationError,canonicalJSON,copyJSON,plain,requireSpec as check,shape as exactShape} from '../v2/json';
import {classifyModuleChange,staffRole,validateInstances,type ModuleInstance} from './modules';
import type {ProjectSpecification,SpecificationOperation,SpecificationReview,SpecificationPage,SpecificationMigration} from './types';
const copy=copyJSON;
const same=(a:unknown,b:unknown)=>canonicalJSON(a)===canonicalJSON(b);
function fail(code:string,path:string):never{throw new SpecificationError(code,path);}
function shape(value:unknown,required:string[],_optional:string[]=[],path='request'):asserts value is Record<string,unknown>{exactShape(value,required,path);}
const moduleVersions=Object.freeze({content:2,notifications:1,automation:1});
function text(v:unknown,max:number,path:string,empty=false){check(typeof v==='string'&&v.length<=max&&(empty||v.trim().length>0)&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v),'INVALID_TEXT',path);}
const identity=(v:unknown,path:string)=>check(typeof v==='string'&&/^[a-z][a-z0-9-]{0,39}$/.test(v)&&!['constructor','prototype','tojson'].includes(v),'INVALID_ID',path);
function list(v:unknown,max:number,path:string){check(Array.isArray(v)&&v.length<=max,'INVALID_LIST',path);}
function unique(rows:unknown[],key:string,path:string){const seen=new Set();for(const row of rows){check(plain(row),'INVALID_SHAPE',path);check(!seen.has(row[key]),'DUPLICATE_ID',path);seen.add(row[key]);}}
/** Schema 3 only. Schema 2 and earlier documents are rejected, never read or converted. */
export function validateSpecification(input:unknown):ProjectSpecification {
  // Public JSON transport must enforce a streaming byte bound before parsing too.
  const spec=copyJSON(input) as ProjectSpecification;
  check(plain(spec),'INVALID_SHAPE','request');check(spec.schemaVersion===3,'UNSUPPORTED_VERSION','schemaVersion');
  shape(spec,['schemaVersion','name','design','modules','content','pages','instances','integrations','rules']);
  text(spec.name,100,'name');
  shape(spec.design,['theme'],[],'design');check(['ocean','clay','forest'].includes(spec.design.theme),'INCOMPATIBLE','design.theme');
  list(spec.modules,3,'modules');unique(spec.modules,'id','modules');
  const modules=new Set<string>();
  for(const m of spec.modules){shape(m,['id','version'],[],'modules');identity(m.id,'modules.id');check(Object.hasOwn(moduleVersions,m.id),'UNKNOWN_MODULE','modules.id');check(m.version===moduleVersions[m.id],'UNSUPPORTED_VERSION','modules.version');modules.add(m.id);}
  check(modules.has('content'),'INCOMPATIBLE','modules.content');
  const instances=validateInstances(spec.instances),staff=staffRole(instances);
  // Notifications address the staff role; automation connects records to notifications.
  check(!modules.has('notifications')||staff,'MISSING_DEPENDENCY','modules.notifications');
  check(!modules.has('automation')||modules.has('notifications')&&instances.some(i=>i.kind==='records'),'INCOMPATIBLE','modules.dependencies');
  const requireModule=(id:string,rows:unknown[])=>check(!rows.length||modules.has(id),'INCOMPATIBLE',id);
  list(spec.content,40,'content');unique(spec.content,'id','content');
  for(const c of spec.content){shape(c,['id','text'],[],'content');identity(c.id,'content.id');text(c.text,1000,'content.text',true);}
  const content=new Map(spec.content.map(c=>[c.id,c.text]));
  function value(id:string){identity(id,'content.reference');check(content.has(id),'MISSING_REFERENCE','content');return content.get(id)!;}
  list(spec.pages,4,'pages');check(spec.pages.length>0,'INVALID_LIST','pages');unique(spec.pages,'id','pages');unique(spec.pages,'path','pages');
  for(const p of spec.pages){
   shape(p,['id','path','component','audience','headline','description','aboutTitle','aboutText','sections','photos'],[],'pages');identity(p.id,'pages.id');
   check(typeof p.path==='string'&&/^(?:\/|\/[a-z][a-z0-9-]{0,39})$/.test(p.path)&&!['/api','/assets','/backend','/cms','/contact','/directory','/workspace'].includes(p.path),'INCOMPATIBLE','pages.path');
   check(['site-page@1','photo-page@1'].includes(p.component),'UNSUPPORTED_VERSION','pages.component');check(['public','staff'].includes(p.audience),'INCOMPATIBLE','pages.audience');
   check(p.audience!=='staff'||staff,'INCOMPATIBLE','pages.access');
   list(p.photos,4,'pages.photos');check(p.component===(p.photos.length?'photo-page@1':'site-page@1'),'INCOMPATIBLE','pages.component');
   list(p.sections,6,'pages.sections');for(const s of p.sections)shape(s,['heading','text'],[],'pages.sections');
   try{photoConfig({photos:p.photos,name:spec.name,theme:spec.design.theme,headline:value(p.headline),description:value(p.description),aboutTitle:value(p.aboutTitle),aboutText:value(p.aboutText),sections:p.sections.map(s=>({heading:value(s.heading),text:value(s.text)}))});}catch(e){if(e instanceof SpecificationError)throw e;fail('INCOMPATIBLE','pages.componentConfiguration');}
  }
  list(spec.integrations,2,'integrations');unique(spec.integrations,'id','integrations');requireModule('notifications',spec.integrations);
  for(const i of spec.integrations){shape(i,['id','capability'],[],'integrations');identity(i.id,'integrations.id');check(i.capability==='email.staff','INCOMPATIBLE','integrations.capability');}
  list(spec.rules,8,'rules');unique(spec.rules,'id','rules');requireModule('automation',spec.rules);
  for(const r of spec.rules){
   shape(r,['id','trigger','effect'],[],'rules');identity(r.id,'rules.id');shape(r.trigger,['type','formId'],[],'rules.trigger');shape(r.effect,['type','integrationId','recipient','template'],[],'rules.effect');
   check(r.trigger.type==='form.accepted'&&r.effect.type==='notification.send'&&r.effect.recipient==='staff'&&r.effect.template==='submission-link@1','INCOMPATIBLE','rules.operation');
   const owner=instances.find((i):i is Extract<ModuleInstance,{kind:'records'}>=>i.kind==='records'&&i.config.forms.some(f=>f.id===r.trigger.formId));check(owner,'MISSING_REFERENCE','rules.formId');
   const form=owner.config.forms.find(f=>f.id===r.trigger.formId)!,schema=owner.config.schemas.find(s=>s.id===form.recordId)!;
   check(schema.fields.some(f=>f.read!=='owner'),'INCOMPATIBLE','rules.recipientAccess');
   check(spec.integrations.some(i=>i.id===r.effect.integrationId),'MISSING_REFERENCE','rules.integrationId');
  }
  return spec;
 }
/** Applies operations to a detached candidate and classifies the net instance change against the saved base. */
export function changeSpecification(before:unknown,input:unknown){
  const operations=copyJSON(input) as SpecificationOperation[];
  list(operations,8,'operations');check(operations.length>0,'INVALID_LIST','operations');const base=validateSpecification(before),next=validateSpecification(base),reviews=new Set<SpecificationReview>();
  const found=<T extends {id:string}>(rows:T[],id:string,path:string):T=>{identity(id,path);const row=rows.find(x=>x.id===id);check(row,'MISSING_REFERENCE',path);return row;};
  for(const op of operations){
   check(plain(op),'INVALID_SHAPE','operations');
   switch(op.type){
    case 'content.replace':shape(op,['type','contentId','text']);text(op.text,1000,'operations.text',true);found(next.content,op.contentId,'contentId').text=op.text;break;
    case 'project.setName':shape(op,['type','name']);text(op.name,100,'operations.name');next.name=op.name;break;
    case 'pages.setSections':{
     shape(op,['type','pageId','sections']);list(op.sections,6,'operations.sections');
     const page=found(next.pages,op.pageId,'pageId'),otherReferences=new Set(next.pages.flatMap(p=>[p.headline,p.description,p.aboutTitle,p.aboutText,...(p===page?[]:p.sections.flatMap(s=>[s.heading,s.text]))]));
     const unused=new Set(page.sections.flatMap(s=>[s.heading,s.text]).filter(id=>!otherReferences.has(id)));
     next.content=next.content.filter(c=>!unused.has(c.id));
     const ids=new Set(next.content.map(c=>c.id));let counter=1;
     const add=(value:string)=>{let id;do{id=`section-copy-${counter++}`;}while(ids.has(id));ids.add(id);next.content.push({id,text:value});return id;};
     page.sections=op.sections.map(section=>{shape(section,['heading','text']);text(section.heading,100,'operations.sections.heading');text(section.text,800,'operations.sections.text');return {heading:add(section.heading),text:add(section.text)};});break;
    }
    case 'pages.setPhotos':{shape(op,['type','pageId','photos']);list(op.photos,4,'operations.photos');const page=found(next.pages,op.pageId,'pageId');page.photos=copy(op.photos);page.component=page.photos.length?'photo-page@1':'site-page@1';break;}
    case 'design.setTheme':shape(op,['type','theme']);next.design.theme=op.theme;break;
    case 'modules.put':{
     shape(op,['type','instance']);check(plain(op.instance),'INVALID_SHAPE','instance');identity(op.instance.id,'instance.id');
     const at=next.instances.findIndex(i=>i.id===op.instance.id);if(at<0)next.instances.push(copy(op.instance));else next.instances[at]=copy(op.instance);break;
    }
    case 'records.addField':{
     shape(op,['type','instanceId','schemaId','field']);check(plain(op.field),'INVALID_SHAPE','field');
     // Only optional additions are additive; a required field needs a reviewed migration hook (WH-076) or a test data reset.
     check(op.field.optional===true,'MIGRATION_REQUIRED','field');
     const instance=found(next.instances,op.instanceId,'instanceId');check(instance.kind==='records','INCOMPATIBLE','instanceId');
     const schema=found(instance.config.schemas,op.schemaId,'schemaId');check(!schema.fields.some(f=>f.key===op.field.key),'INCOMPATIBLE','field.key');
     schema.fields.push(copy(op.field) as typeof schema.fields[number]);schema.fieldsRevision++;break;
    }
    case 'pages.setAudience':shape(op,['type','pageId','audience']);found(next.pages,op.pageId,'pageId').audience=op.audience;reviews.add('permissions');break;
    case 'rules.put':{
     shape(op,['type','rule']);check(plain(op.rule),'INVALID_SHAPE','rule');identity(op.rule.id,'rule.id');const at=next.rules.findIndex(r=>r.id===op.rule.id);if(at<0)next.rules.push(copy(op.rule));else next.rules[at]=copy(op.rule);reviews.add('integration');reviews.add('spending');break;
    }
    default:fail('UNSUPPORTED_OPERATION','operations.type');
   }
  }
  const spec=validateSpecification(next);check(!same(base,spec),'NO_CHANGE','operations');
  const {migration}=classifyInstances(base,spec,reviews);
  return {spec,reviews:[...reviews].sort(),migration};
 }
/** Net instance change against the saved base. A removed instance is destructive (MIGRATION_REQUIRED), never a silent drop. */
function classifyInstances(base:ProjectSpecification,spec:ProjectSpecification,reviews:Set<SpecificationReview>){
 let migration:SpecificationMigration='none';
 for(const prior of base.instances)check(spec.instances.some(i=>i.id===prior.id),'MIGRATION_REQUIRED','instances');
 for(const instance of spec.instances){
  const prior=base.instances.find(i=>i.id===instance.id);if(prior&&same(prior,instance))continue;
  const change=classifyModuleChange(prior,instance);
  if(change.schema)reviews.add('schema');if(change.permissions)reviews.add('permissions');if(change.migration==='additive-optional')migration='additive-optional';
 }
 return {migration};
}
/** Review classes for a whole-document forward transition (restore): the same instance hook table as edits,
 * plus permissions for any changed page audience and integration/spending for any changed rule. */
export function transitionReviews(before:unknown,after:unknown){
 const base=validateSpecification(before),next=validateSpecification(after),reviews=new Set<SpecificationReview>();
 const {migration}=classifyInstances(base,next,reviews);
 if(next.pages.some(p=>p.audience!==(base.pages.find(b=>b.id===p.id)?.audience??'public')))reviews.add('permissions');
 if(!same(base.rules,next.rules)){reviews.add('integration');reviews.add('spending');}
 return {reviews:[...reviews].sort(),migration};
}

function pageConfiguration(spec:ProjectSpecification,page:SpecificationPage){
 const value=(id:string)=>spec.content.find(c=>c.id===id)!.text;
 return photoConfig({photos:page.photos,name:spec.name,theme:spec.design.theme,headline:value(page.headline),description:value(page.description),aboutTitle:value(page.aboutTitle),aboutText:value(page.aboutText),sections:page.sections.map(s=>({heading:value(s.heading),text:value(s.text)}))});
}
export function projectPage(input:unknown,pageId:string){
 const spec=validateSpecification(input),page=spec.pages.find(p=>p.id===pageId);
 check(page,'MISSING_REFERENCE','pageId');return pageConfiguration(spec,page);
}
export type SpecificationDifference={path:string;before:unknown;after:unknown};
export function specificationDifference(before:unknown,after:unknown):SpecificationDifference[]{
 const left=validateSpecification(before),right=validateSpecification(after);
 function difference(a:unknown,b:unknown,path:string):SpecificationDifference[]{
  if(same(a,b))return [];
  if(plain(a)&&plain(b))return [...new Set([...Object.keys(a),...Object.keys(b)])].sort().flatMap(key=>difference(a[key]??null,b[key]??null,path+'/'+key));
  return [{path,before:copyJSON(a),after:copyJSON(b)}];
 }
 return difference(left,right,'');
}
