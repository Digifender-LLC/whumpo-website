import {cmsCapabilitiesPath,supportsStructuredCMS,supportsCMSImages} from './cms-capability-contract';
import {callCMS,deriveCMSSecret,verifyCMSInitialization} from './cms-bridge';
import {CMSProjectError} from './cms-projects';
export async function cmsConnection(db:D1Database,user:string,project:string,environment:Record<string,unknown>){
 const row=await db.prepare("SELECT c.user_id,d.origin FROM cms_instances c JOIN projects p ON p.id=c.project_id JOIN cms_deployments d ON d.project_id=c.project_id WHERE c.project_id=? AND c.user_id=? AND p.owner_user_id=? AND c.state='ready' AND d.state='connected'").bind(project,user,user).first<{user_id:string;origin:string}>();
 if(!row)throw new CMSProjectError(404,'An initialized CMS was not found for this project');
 const master=environment.CMS_BRIDGE_MASTER_KEY,service=environment['CMS_'+project.replaceAll('-','')] as Fetcher|undefined;
 if(typeof master!=='string'||typeof service?.fetch!=='function')throw new CMSProjectError(503,'CMS connection is not configured');
 const secret=await deriveCMSSecret(master,project,user,row.origin);return {service,config:{projectId:project,ownerId:user,origin:row.origin,secret}};
}

export async function readCMSStatus(db:D1Database,user:string,project:string,environment:Record<string,unknown>){
 const {service,config}=await cmsConnection(db,user,project,environment);
 try{return {projectId:project,...await verifyCMSInitialization(service,config)};}catch{throw new CMSProjectError(503,'CMS initialization or owner checks could not be confirmed');}
}

// A failed discovery never enables writes. Ownership/connection failures remain explicit errors.
export async function readCMSCapabilities(db:D1Database,user:string,project:string,environment:Record<string,unknown>){
 const {service,config}=await cmsConnection(db,user,project,environment);
 try{
  const value=await callCMS(service,config,cmsCapabilitiesPath,crypto.randomUUID());
  const supported=supportsStructuredCMS(value);
  return {projectId:project,status:supported?'supported':'unsupported',structuredContent:supported,imageContent:supportsCMSImages(value)};
 }catch{return {projectId:project,status:'unavailable',structuredContent:false,imageContent:false};}
}

export async function requireStructuredCMS(db:D1Database,user:string,project:string,env:Record<string,unknown>){
 if(!(await readCMSCapabilities(db,user,project,env)).structuredContent)throw new CMSProjectError(409,'Formatted editing could not be confirmed for this publishing space. No write was attempted by this call. If recovering a saved request, its earlier outcome is unchanged; retry that same request after its CMS connection is updated.');
}

export async function requireCMSImages(db:D1Database,user:string,project:string,env:Record<string,unknown>){if(!(await readCMSCapabilities(db,user,project,env)).imageContent)throw new CMSProjectError(409,'Article images require an updated publishing space. No new image write was attempted.');}
