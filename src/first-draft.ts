export {firstDraftProjectId,firstAppProjectId} from './first-draft-command';
export type WelcomeDraftProject={id:string;name:string;purpose:string;audience:string;style_notes:string;preferred_theme:string;details_revision:number;status:string};

/** The welcome record and current ownership, never model output, identify this shortcut. */
export async function welcomeDraftProject(db:D1Database,userId:string,projectId?:string){
 return db.prepare(`SELECT p.id,p.name,p.purpose,p.audience,p.style_notes,p.preferred_theme,p.details_revision,p.service_status AS status
 FROM welcome_onboarding w JOIN project_service_status p ON p.id=w.project_id AND p.owner_user_id=w.user_id
 WHERE w.user_id=? AND w.completed_at IS NOT NULL AND (? IS NULL OR p.id=?)
 AND NOT EXISTS(SELECT 1 FROM welcome_first_drafts WHERE project_id=p.id)
 AND NOT EXISTS(SELECT 1 FROM site_versions WHERE project_id=p.id)
 AND NOT EXISTS(SELECT 1 FROM backend_versions WHERE project_id=p.id)
 AND NOT EXISTS(SELECT 1 FROM cms_instances WHERE project_id=p.id) LIMIT 1`).bind(userId,projectId??null,projectId??null).first<WelcomeDraftProject>();
}

/** Run before the general action dispatcher, which includes other service capabilities. */
export function firstDraftProposalAllowed(raw:string,projectId:string,kind:'website'|'app'='website'){
 let value;try{value=JSON.parse(raw);}catch{return false;}
 return value&&typeof value==='object'&&!Array.isArray(value)&&
  (value.action===null||value.action&&typeof value.action==='object'&&!Array.isArray(value.action)&&value.action.projectId===projectId&&(kind==='app'?value.action.kind==='backend'&&value.action.operation==='buildApplication':value.action.kind==='preview'));
}
