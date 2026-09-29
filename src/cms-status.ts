import {deriveCMSSecret,verifyCMSInitialization} from './cms-bridge';
import {CMSProjectError} from './cms-projects';
export async function readCMSStatus(db:D1Database,user:string,project:string,environment:Record<string,unknown>){
 const row=await db.prepare("SELECT c.user_id,d.origin FROM cms_instances c JOIN projects p ON p.id=c.project_id JOIN cms_deployments d ON d.project_id=c.project_id WHERE c.project_id=? AND c.user_id=? AND p.owner_user_id=? AND c.state='ready' AND d.state='connected'").bind(project,user,user).first<{user_id:string;origin:string}>();
 if(!row)throw new CMSProjectError(404,'An initialized CMS was not found for this project');
 const master=environment.CMS_BRIDGE_MASTER_KEY,service=environment['CMS_'+project.replaceAll('-','')] as Fetcher|undefined;
 if(typeof master!=='string'||typeof service?.fetch!=='function')throw new CMSProjectError(503,'CMS connection is not configured');
 try{const secret=await deriveCMSSecret(master,project,user,row.origin),state=await verifyCMSInitialization(service,{projectId:project,ownerId:user,origin:row.origin,secret});return {projectId:project,...state};}catch{throw new CMSProjectError(503,'CMS initialization or owner checks could not be confirmed');}
}
