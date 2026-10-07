import {copyJSON,requireSpec as check,shape} from '../project-specification/v2/json';
import type {ModuleInstance} from '../project-specification/v3/modules';

/** Presentation is data. Neither the custom card nor the maintained blocks accept code, styles, URLs or authority. */
export type PortalBlock=
 |{id:string;kind:'form';instanceId:string;targetId:string;title:string}
 |{id:string;kind:'records';instanceId:string;targetId:string;title:string}
 |{id:string;kind:'gallery';instanceId:string;targetId:string;title:string}
 |{id:string;kind:'directory';instanceId:string;targetId:string;title:string}
 |{id:string;kind:'custom-card';title:string;paragraphs:string[];emphasis:'quiet'|'strong'};
export type PortalPresentation={version:1;template:'module-portal@1';layout:'studio'|'journal'|'desk';title:string;introduction:string;accessInstanceId:string;blocks:PortalBlock[]};
const local=(v:unknown)=>typeof v==='string'&&/^[a-z][a-z0-9-]{0,39}$/.test(v)&&!['constructor','prototype','tojson'].includes(v);
const text=(v:unknown,max:number,empty=false)=>check(typeof v==='string'&&v.length<=max&&(empty||v.trim().length>0)&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v),'INVALID_TEXT','presentation');
export function validatePresentation(input:unknown,instances:ModuleInstance[]|null):PortalPresentation{
 const p=copyJSON(input,12000) as PortalPresentation;
 shape(p,['version','template','layout','title','introduction','accessInstanceId','blocks'],'presentation');
 check(p.version===1&&p.template==='module-portal@1','UNSUPPORTED_VERSION','presentation');
 check(['studio','journal','desk'].includes(p.layout),'INCOMPATIBLE','presentation.layout');
 text(p.title,100);text(p.introduction,400,true);
 check(local(p.accessInstanceId),'INVALID_ID','presentation.accessInstanceId');
 const access=instances?.find(i=>i.id===p.accessInstanceId&&i.kind==='access');
 check(instances===null||access,'MISSING_DEPENDENCY','presentation.accessInstanceId');
 check(Array.isArray(p.blocks)&&p.blocks.length>0&&p.blocks.length<=8,'INVALID_LIST','presentation.blocks');
 const ids=new Set<string>();
 for(const b of p.blocks){
  check(b&&typeof b==='object'&&!Array.isArray(b),'INVALID_SHAPE','presentation.blocks');
  shape(b,b.kind==='custom-card'?['id','kind','title','paragraphs','emphasis']:['id','kind','instanceId','targetId','title'],'presentation.blocks');
  check(local(b.id)&&!ids.has(b.id),'DUPLICATE_ID','presentation.blocks.id');ids.add(b.id);text(b.title,80);
  if(b.kind==='custom-card'){
   check(Array.isArray(b.paragraphs)&&b.paragraphs.length>0&&b.paragraphs.length<=4,'INVALID_LIST','presentation.blocks.paragraphs');
   b.paragraphs.forEach(v=>text(v,400));check(['quiet','strong'].includes(b.emphasis),'INCOMPATIBLE','presentation.blocks.emphasis');continue;
  }
  check(['form','records','gallery','directory'].includes(b.kind)&&local(b.instanceId)&&local(b.targetId),'INCOMPATIBLE','presentation.blocks');
  if(instances===null)continue;
  const i=instances.find(i=>i.id===b.instanceId);check(i,'MISSING_REFERENCE','presentation.blocks.instanceId');
  check(i.kind==='content'||i.dependencies.includes(access!.id),'MISSING_DEPENDENCY','presentation.blocks.instanceId');
  if(b.kind==='form')check(i.kind==='records'&&i.config.forms.some(f=>f.id===b.targetId&&f.submit!=='public'),'INCOMPATIBLE','presentation.blocks.form');
  if(b.kind==='records')check(i.kind==='records'&&i.config.views.some(v=>v.id===b.targetId),'MISSING_REFERENCE','presentation.blocks.view');
  if(b.kind==='gallery')check(i.kind==='files'&&i.config.collections.some(c=>c.id===b.targetId&&c.gallery!==null),'MISSING_REFERENCE','presentation.blocks.gallery');
  if(b.kind==='directory')check(i.kind==='content'&&i.config.collections.some(c=>c.id===b.targetId),'MISSING_REFERENCE','presentation.blocks.directory');
 }
 return p;
}
export const portalDependencies=(p:PortalPresentation)=>[...new Set([p.accessInstanceId,...p.blocks.flatMap(b=>b.kind==='custom-card'?[]:[b.instanceId])])].sort();
