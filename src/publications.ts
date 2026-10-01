export const siteURL = (projectId: string) => `https://${projectId}.whumpo.site`;
export type PublicationCommand = {reply:string; statements:D1PreparedStatement[]};
const uuid = /^[0-9a-f-]{36}$/;

/** Planning and confirmation are distinct. All writes are gated on the new chat turn. */
export async function publicationCommand(db:D1Database,userId:string,turnId:string,command:string):Promise<PublicationCommand | undefined> {
 const [verb,arg,...rest]=command.split(/\s+/);
 if (!['/publish','/restore','/unpublish','/confirm','/versions'].includes(verb)) return;
 const result=(reply:string,statements:D1PreparedStatement[]=[]):PublicationCommand=>({reply,statements});
 if (rest.length || (arg && !uuid.test(arg))) return result("Choose one exact saved version, project or review.");
 if (verb === '/versions') {
  const {results}=await db.prepare('SELECT v.id,v.project_id,v.component_id,v.created_at,p.name,s.version_id AS live_id FROM site_versions v JOIN projects p ON p.id=v.project_id LEFT JOIN publications s ON s.project_id=p.id WHERE p.owner_user_id=? AND (? IS NULL OR p.id=?) ORDER BY v.created_at DESC,v.id DESC LIMIT 25').bind(userId,arg??null,arg??null).all<{id:string;project_id:string;component_id:string;created_at:string;name:string;live_id:string|null}>();
  return result(results.length ? results.map(v=>`${v.name} · ${v.created_at.slice(0,19)}${v.id===v.live_id?' · LIVE':''}\nVersion: ${v.id}\n${v.component_id}`).join('\n\n')+"\n\nAsk to review publishing a saved version, restoring a previous version to the live site or removing an unused version." : "No saved versions found. Ask to create a private draft first.");
 }
 if (verb === '/confirm') {
  if (!arg) return result('Include the confirmation ID from the publication review.');
  const action=await db.prepare('SELECT a.*,p.name FROM publication_actions a JOIN projects p ON p.id=a.project_id WHERE a.id=? AND a.user_id=? AND p.owner_user_id=?').bind(arg,userId,userId).first<{id:string;project_id:string;version_id:string|null;kind:string;status:string;expires_at:string}>();
  if (!action) return result('Confirmation not found. Request a fresh publication review.');
  if(action.status==='applied')return result("That confirmation was already applied. Ask for the project’s current status.");
  if(action.expires_at<=new Date().toISOString())return result("That review expired. Ask for a fresh publication, restore or withdrawal review.");
  return result(action.kind==='unpublish'?'The site is unpublished. Saved previews remain private and available.':`The reviewed version is published at ${siteURL(action.project_id)}\nVersion: ${action.version_id}\nAvailability has not been checked yet.`,[db.prepare("UPDATE publication_actions SET status='applied',confirmed_by=? WHERE id=? AND user_id=? AND status='pending' AND EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=?)").bind(turnId,arg,userId,turnId,userId)]);
 }
 if(verb==='/restore'&&!arg)return result("Choose the exact saved version you want to restore.");
 const target=verb==='/unpublish'
 ? await db.prepare('SELECT p.id AS project_id,p.name,NULL AS version_id,NULL AS digest,s.revision FROM projects p JOIN publications s ON s.project_id=p.id WHERE p.owner_user_id=? AND s.version_id IS NOT NULL AND (? IS NULL OR p.id=?) ORDER BY p.updated_at DESC,p.id DESC LIMIT 1').bind(userId,arg??null,arg??null).first<{project_id:string;name:string;version_id:string|null;digest:string|null;revision:number}>()
 : await db.prepare('SELECT p.id AS project_id,p.name,v.id AS version_id,v.digest,COALESCE(s.revision,0) AS revision FROM site_versions v JOIN projects p ON p.id=v.project_id LEFT JOIN publications s ON s.project_id=p.id WHERE p.owner_user_id=? AND (? IS NULL OR v.id=?) ORDER BY v.created_at DESC,v.id DESC LIMIT 1').bind(userId,arg??null,arg??null).first<{project_id:string;name:string;version_id:string|null;digest:string|null;revision:number}>();
 if(!target)return result(verb==='/unpublish'?'No matching live site found.':"No matching saved version found. Create a private draft first.");
 const kind=verb.slice(1),expiry=new Date(Date.now()+600000).toISOString();
 const review=kind==='unpublish'?`Unpublish “${target.name}” at ${siteURL(target.project_id)}? Its saved versions will remain private.`:`${kind==='restore'?'Restore':'Publish'} “${target.name}” at ${siteURL(target.project_id)}?\nVersion: ${target.version_id}\nThis makes all content in this saved version, including any attached photos, publicly accessible. It replaces any currently live version at this address.`;
 return result(review+`\nAny attached backend tool is hidden after this change and needs a new form review. Any enabled contact form stops accepting messages after this change. Ask to review enabling the contact form for the new live version.\n\nConfirm within 10 minutes using this review’s confirmation button. Nothing changes until you confirm. Open “Review website changes” below to compare this action with the live site.`,[
 db.prepare('INSERT OR IGNORE INTO publications(project_id) SELECT id FROM projects WHERE id=? AND owner_user_id=? AND EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=?)').bind(target.project_id,userId,turnId,userId),
 db.prepare('INSERT INTO publication_actions(id,user_id,project_id,kind,version_id,expected_revision,expires_at) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=?)').bind(turnId,userId,target.project_id,kind,target.version_id,target.revision,expiry,turnId,userId)
 ]);
}
