import {readSpecificationReviewIdentity,type SpecificationReviewIdentity} from './project-specification/review-display';
import {copyJSON} from './project-specification/v2/json';
import {exact,object,uuid,viewComponents,type WidgetKind} from './workspace-view-contract';
import type {GuestPreviewFacts} from './guest-previews/shape';

export type ProjectFacts={projectId:string;name:string;state:'draft'|'building'|'live'|'error';websitePublished:boolean};
export type WorkspaceReviewSummary={review:SpecificationReviewIdentity;project:{id:string;name:string};operation:'change'|'restore';expiresAt:string};
export type WorkspaceReviewQueue={items:WorkspaceReviewSummary[];denied:number;unavailable:number};
export type ViewFacts={
 projects:{items:ProjectFacts[]};
 usage:{standardIncluded:true;advancedEnabled:false};
 storage:{files:number;bytes:number};
 activity:{items:{id:string;projectId:string|null;summary:string;createdAt:string}[]};
 traffic:{enabledAt:string;days:30;rows:{project_id:string;day:string;requests:number}[];metric:'successful_html_requests'};
 cms:{items:{projectId:string;name:string;publishedArticles:number}[]};
 reviews:WorkspaceReviewQueue;
 performance:never;
 'guest-previews':GuestPreviewFacts;
};
type Header<K extends WidgetKind>={version:1;kind:K;binding:string;projectId:string|null;asOf:string};
export type ViewComponentData={[K in WidgetKind]:Header<K>&({status:'ready';data:ViewFacts[K]}|{status:'denied'|'unavailable';data:null})}[WidgetKind];
export const viewBinding=(kind:WidgetKind,projectId:string|null)=>kind==='projects'&&projectId===null?'workspace.projects@1':viewComponents[kind].binding;
const integer=(v:unknown)=>Number.isSafeInteger(v)&&Number(v)>=0;
const text=(v:unknown,max:number)=>typeof v==='string'&&!!v.trim()&&v.length<=max;
export const iso=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const shape=(v:unknown,keys:string[]):v is Record<string,unknown>=>object(v)&&exact(v,keys);
export function isProjectFacts(v:unknown):v is ProjectFacts{return shape(v,['projectId','name','state','websitePublished'])&&uuid(v.projectId)&&text(v.name,100)&&['draft','building','live','error'].includes(String(v.state))&&typeof v.websitePublished==='boolean';}
/** Exact current facts; a malformed or denied response never retains data. */
export function readViewComponentData(input:unknown):ViewComponentData|null{
 try{
  const c=copyJSON(input,131072);
  if(!shape(c,['version','kind','binding','projectId','asOf','status','data'])||c.version!==1||typeof c.kind!=='string'||!Object.hasOwn(viewComponents,c.kind)||!(c.projectId===null||uuid(c.projectId))||!iso(c.asOf)||c.binding!==viewBinding(c.kind as WidgetKind,c.projectId))return null;
  if(c.status==='denied'||c.status==='unavailable')return c.data===null?c as ViewComponentData:null;
  if(c.status!=='ready'||!object(c.data))return null;
  const d=c.data,scoped=(p:unknown)=>uuid(p)&&(c.projectId===null||p===c.projectId);
  let valid=false;
  if(c.kind==='projects')valid=exact(d,['items'])&&Array.isArray(d.items)&&d.items.length<=20&&(c.projectId===null||d.items.length===1)&&d.items.every(p=>isProjectFacts(p)&&scoped(p.projectId))&&new Set(d.items.map(p=>p.projectId)).size===d.items.length;
  if(c.kind==='usage')valid=exact(d,['standardIncluded','advancedEnabled'])&&d.standardIncluded===true&&d.advancedEnabled===false;
  if(c.kind==='storage')valid=exact(d,['files','bytes'])&&integer(d.files)&&integer(d.bytes);
  if(c.kind==='activity')valid=exact(d,['items'])&&Array.isArray(d.items)&&d.items.length<=20&&d.items.every(a=>shape(a,['id','projectId','summary','createdAt'])&&text(a.id,200)&&(a.projectId===null?c.projectId===null:scoped(a.projectId))&&text(a.summary,500)&&iso(a.createdAt));
  if(c.kind==='traffic')valid=exact(d,['enabledAt','days','rows','metric'])&&iso(d.enabledAt)&&d.days===30&&d.metric==='successful_html_requests'&&Array.isArray(d.rows)&&d.rows.length<=600&&d.rows.every(r=>shape(r,['project_id','day','requests'])&&scoped(r.project_id)&&typeof r.day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(r.day)&&iso(r.day+'T00:00:00.000Z')&&integer(r.requests));
  if(c.kind==='reviews')valid=exact(d,['items','denied','unavailable'])&&Array.isArray(d.items)&&integer(d.denied)&&integer(d.unavailable)&&d.items.length+Number(d.denied)+Number(d.unavailable)<=5&&d.items.every(r=>shape(r,['review','project','operation','expiresAt'])&&!!readSpecificationReviewIdentity(r.review)&&shape(r.project,['id','name'])&&scoped(r.project.id)&&text(r.project.name,100)&&['change','restore'].includes(String(r.operation))&&iso(r.expiresAt)&&r.expiresAt>String(c.asOf))&&new Set(d.items.map(r=>(r as {review:{id:string}}).review.id)).size===d.items.length;
  if(c.kind==='guest-previews')valid=c.projectId!==null&&exact(d,['canIssue','versions','links'])&&typeof d.canIssue==='boolean'&&Array.isArray(d.versions)&&d.versions.length<=10&&d.versions.every(v=>shape(v,['id','createdAt'])&&uuid(v.id)&&text(v.createdAt,40))&&Array.isArray(d.links)&&d.links.length<=200&&d.links.every(l=>shape(l,['id','versionId','label','feedbackEnabled','createdAt','expiresAt','revokedAt','state','feedbackCount','openFeedbackCount'])&&uuid(l.id)&&(l.versionId===null||uuid(l.versionId))&&typeof l.label==='string'&&l.label.length<=80&&typeof l.feedbackEnabled==='boolean'&&integer(l.createdAt)&&integer(l.expiresAt)&&(l.revokedAt===null||integer(l.revokedAt))&&['active','expired','revoked','removed'].includes(String(l.state))&&integer(l.feedbackCount)&&integer(l.openFeedbackCount)&&Number(l.openFeedbackCount)<=Number(l.feedbackCount))&&new Set(d.links.map(l=>(l as {id:string}).id)).size===d.links.length;
  if(c.kind==='cms')valid=exact(d,['items'])&&Array.isArray(d.items)&&d.items.length<=20&&(c.projectId===null||d.items.length===1)&&d.items.every(p=>shape(p,['projectId','name','publishedArticles'])&&scoped(p.projectId)&&text(p.name,100)&&integer(p.publishedArticles));
  return valid?c as ViewComponentData:null;
 }catch{return null;}
}
