import {copyJSON} from './v2/json';

export type SpecificationReviewIdentity={id:string;proposalDigest:string;expectedRevision:number};
export type SpecificationReviewDisplay={version:1;source:'project_spec_proposals';observedAt:string;expiresAt:string;
 review:SpecificationReviewIdentity;project:{id:string;name:string};operation:'change'|'restore';
 changes:{label:string;before:string|null;after:string|null}[]};
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v:unknown,keys:string[])=>object(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
const iso=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const text=(v:unknown,max:number)=>typeof v==='string'&&v.length<=max;
/** Identity comes only from the server review, never prose or display labels. */
export function readSpecificationReviewIdentity(value:unknown):SpecificationReviewIdentity|null{
 try{
  const r=copyJSON(value,1024) as SpecificationReviewIdentity;
  return exact(r,['id','proposalDigest','expectedRevision'])&&uuid(r.id)&&typeof r.proposalDigest==='string'&&/^[a-f0-9]{64}$/.test(r.proposalDigest)&&Number.isSafeInteger(r.expectedRevision)&&r.expectedRevision>=0?r:null;
 }catch{return null;}
}
/** Read-only projection. No HTML, URLs or approval instructions are accepted. */
export function readSpecificationReviewDisplay(value:unknown):SpecificationReviewDisplay|null{
 try{
  // The saved comparison allows 64 KiB; leave room for its bounded identity
  // and timestamps instead of rejecting a valid near-limit comparison.
  const r=copyJSON(value,73728) as SpecificationReviewDisplay;
  if(!exact(r,['version','source','observedAt','expiresAt','review','project','operation','changes'])||r.version!==1||r.source!=='project_spec_proposals'||!iso(r.observedAt)||!iso(r.expiresAt)||Date.parse(r.expiresAt)<=Date.parse(r.observedAt)||!readSpecificationReviewIdentity(r.review))return null;
  if(!exact(r.project,['id','name'])||!uuid(r.project.id)||!text(r.project.name,100)||!r.project.name.trim()||!['change','restore'].includes(r.operation)||!Array.isArray(r.changes)||r.changes.length>20)return null;
  if(new Set(r.changes.map(c=>c?.label)).size!==r.changes.length||r.changes.some(c=>!exact(c,['label','before','after'])||!text(c.label,80)||!c.label.trim()||![c.before,c.after].every(v=>v===null||text(v,16384))))return null;
  return r;
 }catch{return null;}
}
