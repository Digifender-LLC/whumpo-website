/** Shared fixed contact records store. No model, Chat, provider, or alternate intake path. */
export class ContactError extends Error {constructor(public status:number,message:string){super(message);}}
export async function activeContact(db:D1Database,projectId:string){
 return db.prepare('SELECT p.name,c.revision FROM contact_settings c JOIN publications s ON s.project_id=c.project_id JOIN projects p ON p.id=c.project_id WHERE c.project_id=? AND c.enabled=1 AND s.version_id IS NOT NULL AND s.revision=c.publication_revision AND NOT EXISTS(SELECT 1 FROM service_client_blocked_contacts WHERE project_id=c.project_id)').bind(projectId).first<{name:string;revision:number}>();
}
export async function contactInbox(db:D1Database,userId:string,projectId:string){
 const project=await db.prepare('SELECT p.name,c.enabled,c.publication_revision,s.revision,s.version_id FROM projects p LEFT JOIN contact_settings c ON c.project_id=p.id LEFT JOIN publications s ON s.project_id=p.id WHERE p.id=? AND p.owner_user_id=?').bind(projectId,userId).first<{name:string;enabled:number|null;publication_revision:number|null;revision:number|null;version_id:string|null}>();
 if(!project)throw new ContactError(404,'Project not found.');
 const {results}=await db.prepare('SELECT m.id,m.name,m.email,m.message,m.created_at,m.expires_at FROM contact_submissions m JOIN projects p ON p.id=m.project_id WHERE p.id=? AND p.owner_user_id=? AND m.expires_at>? ORDER BY m.created_at DESC,m.id DESC LIMIT 100').bind(projectId,userId,new Date().toISOString()).all();
 return {project:{id:projectId,name:project.name},enabled:!!await activeContact(db,projectId),messages:results};
}
