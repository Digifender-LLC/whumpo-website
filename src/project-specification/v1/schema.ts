import {siteConfig} from '../../components';
import {backendFormConfig} from '../../backend-form-config';
import {SpecificationError,canonicalJSON,copyJSON,plain,requireSpec as check,shape as exactShape} from './json';
import type {ProjectSpecification,SpecificationOperation,SpecificationReview,SpecificationPage} from './types';
const copy=copyJSON;
const same=(a:unknown,b:unknown)=>canonicalJSON(a)===canonicalJSON(b);
const fail=(code:string,path:string):never=>{throw new SpecificationError(code,path);};
function shape(value:unknown,required:string[],_optional:string[]=[],path='request'):asserts value is Record<string,unknown>{exactShape(value,required,path);}
const moduleVersions=Object.freeze({content:1,records:1,files:1,access:1,notifications:1,automation:1});
const dependencies:Record<string,string[]>={records:['content'],files:['access'],notifications:['access'],automation:['records','notifications','access']};
function text(v:unknown,max:number,path:string,empty=false){check(typeof v==='string'&&v.length<=max&&(empty||v.trim().length>0)&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v),'INVALID_TEXT',path);}
const identity=(v:unknown,path:string)=>check(typeof v==='string'&&/^[a-z][a-z0-9-]{0,39}$/.test(v)&&!['constructor','prototype','tojson'].includes(v),'INVALID_ID',path);
const integer=(v:unknown,min:number,max:number,path:string)=>check(typeof v==='number'&&Number.isSafeInteger(v)&&v>=min&&v<=max,'INVALID_NUMBER',path);
function list(v:unknown,max:number,path:string){check(Array.isArray(v)&&v.length<=max,'INVALID_LIST',path);}
function unique(rows:unknown[],key:string,path:string){const seen=new Set();for(const row of rows){check(plain(row),'INVALID_SHAPE',path);check(!seen.has(row[key]),'DUPLICATE_ID',path);seen.add(row[key]);}}
export function validateSpecification(input:unknown):ProjectSpecification {
  // Public JSON transport must enforce a streaming byte bound before parsing too.
  const spec=copyJSON(input) as ProjectSpecification;
  shape(spec,['schemaVersion','name','design','modules','content','pages','records','forms','files','access','integrations','rules']);
  check(spec.schemaVersion===1,'UNSUPPORTED_VERSION','schemaVersion');text(spec.name,100,'name');
  shape(spec.design,['theme'],[],'design');check(['ocean','clay','forest'].includes(spec.design.theme),'INCOMPATIBLE','design.theme');
  list(spec.modules,6,'modules');unique(spec.modules,'id','modules');
  const modules=new Set<string>();
  for(const m of spec.modules){shape(m,['id','version'],[],'modules');identity(m.id,'modules.id');check(Object.hasOwn(moduleVersions,m.id),'UNKNOWN_MODULE','modules.id');check(m.version===moduleVersions[m.id],'UNSUPPORTED_VERSION','modules.version');modules.add(m.id);}
  check(modules.has('content'),'INCOMPATIBLE','modules.content');
  for(const [id,required] of Object.entries(dependencies))if(modules.has(id))check(required.every(k=>modules.has(k)),'INCOMPATIBLE','modules.dependencies');
  const requireModule=(id:string,rows:unknown[])=>check(!rows.length||modules.has(id),'INCOMPATIBLE',id);
  list(spec.content,40,'content');unique(spec.content,'id','content');
  for(const c of spec.content){shape(c,['id','text'],[],'content');identity(c.id,'content.id');text(c.text,1000,'content.text',true);}
  const content=new Map(spec.content.map(c=>[c.id,c.text]));
  function value(id:string){identity(id,'content.reference');check(content.has(id),'MISSING_REFERENCE','content');return content.get(id)!;}
  list(spec.pages,4,'pages');check(spec.pages.length>0,'INVALID_LIST','pages');unique(spec.pages,'id','pages');unique(spec.pages,'path','pages');
  for(const p of spec.pages){
   shape(p,['id','path','component','audience','headline','description','aboutTitle','aboutText','sections'],[],'pages');identity(p.id,'pages.id');
   check(typeof p.path==='string'&&/^(?:\/|\/[a-z][a-z0-9-]{0,39})$/.test(p.path)&&!['/api','/assets','/backend','/cms','/contact','/directory','/workspace'].includes(p.path),'INCOMPATIBLE','pages.path');
   check(p.component==='site-page@1','UNSUPPORTED_VERSION','pages.component');check(['public','staff'].includes(p.audience),'INCOMPATIBLE','pages.audience');
   check(p.audience!=='staff'||modules.has('access'),'INCOMPATIBLE','pages.access');
   list(p.sections,6,'pages.sections');for(const s of p.sections)shape(s,['heading','text'],[],'pages.sections');
   try{siteConfig({name:spec.name,theme:spec.design.theme,headline:value(p.headline),description:value(p.description),aboutTitle:value(p.aboutTitle),aboutText:value(p.aboutText),sections:p.sections.map(s=>({heading:value(s.heading),text:value(s.text)}))});}catch(e){if(e instanceof SpecificationError)throw e;fail('INCOMPATIBLE','pages.componentConfiguration');}
  }
  shape(spec.access,['roles'],[],'access');list(spec.access.roles,1,'access.roles');check(same(spec.access.roles,[])||same(spec.access.roles,['staff']),'INCOMPATIBLE','access.roles');
  check(modules.has('access')===(spec.access.roles.length===1&&spec.access.roles[0]==='staff'),'INCOMPATIBLE','access.module');
  list(spec.records,4,'records');unique(spec.records,'id','records');requireModule('records',spec.records);
  for(const r of spec.records){
   shape(r,['id','schemaVersion','fields','read','write'],[],'records');identity(r.id,'records.id');check(r.schemaVersion===1,'UNSUPPORTED_VERSION','records.schemaVersion');
   check(['owner','staff'].includes(r.read)&&['owner','staff'].includes(r.write),'INCOMPATIBLE','records.policy');
   check((r.read!=='staff'&&r.write!=='staff')||modules.has('access'),'INCOMPATIBLE','records.access');
   check(r.write!=='staff'||r.read==='staff','INCOMPATIBLE','records.policy');
   try{backendFormConfig({title:'Schema',description:'',buttonLabel:'Submit',fields:r.fields});}catch{fail('INCOMPATIBLE','records.fields');}
  }
  list(spec.files,4,'files');unique(spec.files,'id','files');requireModule('files',spec.files);
  for(const f of spec.files){
   shape(f,['id','read','upload','maxBytes','mimeTypes'],[],'files');identity(f.id,'files.id');
   check(['owner','staff'].includes(f.read)&&f.upload==='visitor','INCOMPATIBLE','files.policy');integer(f.maxBytes,1,5*1024*1024,'files.maxBytes');
   list(f.mimeTypes,2,'files.mimeTypes');check(f.mimeTypes.length>0&&new Set(f.mimeTypes).size===f.mimeTypes.length&&f.mimeTypes.every(m=>['image/jpeg','image/png'].includes(m)),'INCOMPATIBLE','files.mimeTypes');
  }
  list(spec.forms,4,'forms');unique(spec.forms,'id','forms');requireModule('records',spec.forms);
  for(const f of spec.forms){
   shape(f,['id','recordId','title','description','buttonLabel','submit','uploadCollectionId'],[],'forms');identity(f.id,'forms.id');
   const r=spec.records.find(r=>r.id===f.recordId);check(r,'MISSING_REFERENCE','forms.recordId');
   check(['public','visitor'].includes(f.submit),'INCOMPATIBLE','forms.submit');check(f.submit!=='visitor'||modules.has('access'),'INCOMPATIBLE','forms.access');
   check(f.uploadCollectionId===null||f.submit==='visitor'&&spec.files.some(c=>c.id===f.uploadCollectionId),'INCOMPATIBLE','forms.uploadCollectionId');
   try{backendFormConfig({title:f.title,description:f.description,buttonLabel:f.buttonLabel,fields:r.fields});}catch{fail('INCOMPATIBLE','forms.configuration');}
  }
  list(spec.integrations,2,'integrations');unique(spec.integrations,'id','integrations');requireModule('notifications',spec.integrations);
  for(const i of spec.integrations){shape(i,['id','capability'],[],'integrations');identity(i.id,'integrations.id');check(i.capability==='email.staff','INCOMPATIBLE','integrations.capability');}
  list(spec.rules,8,'rules');unique(spec.rules,'id','rules');requireModule('automation',spec.rules);
  for(const r of spec.rules){
   shape(r,['id','trigger','effect'],[],'rules');identity(r.id,'rules.id');shape(r.trigger,['type','formId'],[],'rules.trigger');shape(r.effect,['type','integrationId','recipient','template'],[],'rules.effect');
   check(r.trigger.type==='form.accepted'&&r.effect.type==='notification.send'&&r.effect.recipient==='staff'&&r.effect.template==='submission-link@1','INCOMPATIBLE','rules.operation');
   const form=spec.forms.find(f=>f.id===r.trigger.formId);check(form,'MISSING_REFERENCE','rules.formId');
   check(spec.records.find(d=>d.id===form.recordId)?.read==='staff','INCOMPATIBLE','rules.recipientAccess');
   check(spec.integrations.some(i=>i.id===r.effect.integrationId),'MISSING_REFERENCE','rules.integrationId');
  }
  return spec;
 }
export function changeSpecification(before:unknown,input:unknown){
  const operations=copyJSON(input) as SpecificationOperation[];
  list(operations,8,'operations');check(operations.length>0,'INVALID_LIST','operations');const next=validateSpecification(before),reviews=new Set<SpecificationReview>();
  const found=<T extends {id:string}>(rows:T[],id:string,path:string):T=>{identity(id,path);const row=rows.find(x=>x.id===id);check(row,'MISSING_REFERENCE',path);return row;};
  for(const op of operations){
   check(plain(op),'INVALID_SHAPE','operations');
   switch(op.type){
    case 'content.replace':shape(op,['type','contentId','text']);text(op.text,1000,'operations.text',true);found(next.content,op.contentId,'contentId').text=op.text;break;
    case 'design.setTheme':shape(op,['type','theme']);next.design.theme=op.theme;break;
    case 'records.addField':shape(op,['type','recordId','field']);check(plain(op.field)&&op.field.type==='text'&&op.field.optional===true,'MIGRATION_REQUIRED','field');found(next.records,op.recordId,'recordId').fields.push(copy(op.field));reviews.add('schema');break;
    case 'files.setPolicy':shape(op,['type','collectionId','read','upload']);Object.assign(found(next.files,op.collectionId,'collectionId'),{read:op.read,upload:op.upload});reviews.add('permissions');break;
    case 'pages.setAudience':shape(op,['type','pageId','audience']);found(next.pages,op.pageId,'pageId').audience=op.audience;reviews.add('permissions');break;
    case 'rules.put':{
     shape(op,['type','rule']);check(plain(op.rule),'INVALID_SHAPE','rule');identity(op.rule.id,'rule.id');const at=next.rules.findIndex(r=>r.id===op.rule.id);if(at<0)next.rules.push(copy(op.rule));else next.rules[at]=copy(op.rule);reviews.add('integration');reviews.add('spending');break;
    }
    default:fail('UNSUPPORTED_OPERATION','operations.type');
   }
  }
  const spec=validateSpecification(next);check(!same(before,spec),'NO_CHANGE','operations');return {spec,reviews:[...reviews].sort()};
 }

function pageConfiguration(spec:ProjectSpecification,page:SpecificationPage){
 const value=(id:string)=>spec.content.find(c=>c.id===id)!.text;
 return siteConfig({name:spec.name,theme:spec.design.theme,headline:value(page.headline),description:value(page.description),aboutTitle:value(page.aboutTitle),aboutText:value(page.aboutText),sections:page.sections.map(s=>({heading:value(s.heading),text:value(s.text)}))});
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
