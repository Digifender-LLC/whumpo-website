import {BackendError} from './backend-versions';
import {readApplication} from './app-activation';

// Owner metadata only. Visitor documents, recovery codes and credential material
// must not appear here or in agent context. WH-126: visitor identities, invitations and sessions belong to the
// project's access module instance, so this works with or without a visitor application.
export async function readAppAccess(db:D1Database,user:string,project:string){
 const application=await readApplication(db,user,project);
 const visitors=await db.prepare(`SELECT v.id,v.revoked,v.created_at,
 (SELECT count(*) FROM app_passkeys k WHERE k.visitor_id=v.id) AS passkeys,
 (SELECT count(*) FROM app_sessions s WHERE s.visitor_id=v.id AND s.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) AS sessions
 FROM app_visitors v JOIN projects p ON p.id=v.project_id
 WHERE v.project_id=? AND p.owner_user_id=? ORDER BY v.created_at DESC,v.id LIMIT 100`).bind(project,user).all();
 const invitations=await db.prepare(`SELECT i.code_hash AS id,i.expires_at,
 CASE WHEN i.used_by IS NOT NULL THEN 'used' WHEN i.revoked=1 THEN 'cancelled' WHEN i.expires_at<=strftime('%Y-%m-%dT%H:%M:%fZ','now') THEN 'expired' WHEN ac.state IS NOT 'active' OR i.activation_revision<>ac.revision THEN 'inactive' ELSE 'ready' END AS status
 FROM app_invitations i JOIN projects p ON p.id=i.project_id LEFT JOIN module_activations ac ON ac.instance_id=i.access_id
 WHERE i.project_id=? AND p.owner_user_id=? ORDER BY i.expires_at DESC,i.code_hash LIMIT 100`).bind(project,user).all();
 return {...application,visitors:visitors.results,invitations:invitations.results};
}

export async function cancelAppInvitation(db:D1Database,user:string,project:string,id:string){
 if(!/^[0-9a-f]{64}$/.test(id))throw new BackendError(400,'Choose an application invitation');
 const result=await db.prepare(`UPDATE app_invitations SET revoked=1 WHERE code_hash=? AND project_id=? AND used_by IS NULL
 AND EXISTS(SELECT 1 FROM projects p WHERE p.id=? AND p.owner_user_id=?)`).bind(id,project,project,user).run();
 if(result.meta.changes!==1)throw new BackendError(404,'Unused invitation not found');
 return {cancelled:true};
}
