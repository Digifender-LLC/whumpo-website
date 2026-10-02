import {copyJSON} from '../project-specification/v2/json';

export type ProjectStatusCard={version:1;interactionId:string;definitionDigest:string;cardId:string;binding:'project.status@1';source:'project_service_status';asOf:string}&(
 {status:'ready';data:{projectId:string;name:string;state:'draft'|'building'|'live'|'error';websitePublished:boolean}}|
 {status:'unavailable'|'denied';data:null}
);
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const shape=(v:unknown,keys:string[])=>object(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
/** Current read facts, not executable definitions or approval metadata. */
export function readProjectStatusCard(value:unknown):ProjectStatusCard|null{
 try{
  const c=copyJSON(value,4096) as ProjectStatusCard;
  if(!shape(c,['version','interactionId','definitionDigest','cardId','binding','source','asOf','status','data'])||c.version!==1||!uuid(c.interactionId)||typeof c.definitionDigest!=='string'||!/^[a-f0-9]{64}$/.test(c.definitionDigest)||c.cardId!=='project-status'||c.binding!=='project.status@1'||c.source!=='project_service_status'||typeof c.asOf!=='string'||!Number.isFinite(Date.parse(c.asOf))||new Date(c.asOf).toISOString()!==c.asOf)return null;
  if(c.status==='denied'||c.status==='unavailable')return c.data===null?c:null;
  if(c.status!=='ready'||!shape(c.data,['projectId','name','state','websitePublished'])||!uuid(c.data.projectId)||typeof c.data.name!=='string'||!c.data.name.trim()||c.data.name.length>100||!['draft','building','live','error'].includes(c.data.state)||typeof c.data.websitePublished!=='boolean')return null;
  return c;
 }catch{return null;}
}
