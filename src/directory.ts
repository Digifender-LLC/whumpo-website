import {hashToken} from './security';
export class DirectoryError extends Error {constructor(public status:number,message:string){super(message);}}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export type Listing={id:string;title:string;description:string;url:string};
export function listing(value:unknown):Listing{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new DirectoryError(400,'Use a title, description and optional HTTPS link.');
 const v=value as Record<string,unknown>;
 if(Object.keys(v).some(k=>!['id','title','description','url'].includes(k))||typeof v.id!=='string'||!uuid.test(v.id)||typeof v.title!=='string'||!v.title.trim()||v.title.length>100||typeof v.description!=='string'||v.description.length>500||typeof v.url!=='string'||v.url.length>250||/[\u0000-\u001f\u007f]/.test(v.title+v.description+v.url))throw new DirectoryError(400,'Listing fields must be plain text: title up to 100, description up to 500 and link up to 250 characters.');
 let url=v.url.trim();if(url){try{const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password)throw Error();url=u.href;}catch{throw new DirectoryError(400,'Links must use HTTPS without embedded credentials.');}}
 return {id:v.id,title:v.title.trim(),description:v.description.trim(),url};
}
function entries(json:string){const data:unknown=JSON.parse(json);if(!Array.isArray(data)||data.length>25)throw new DirectoryError(400,'A directory supports up to 25 listings.');const list=data.map(listing);if(new Set(list.map(x=>x.id)).size!==list.length||new TextEncoder().encode(JSON.stringify(list)).length>24576)throw new DirectoryError(400,'Directory is too large or has duplicate listing IDs.');return list;}
export const directoryURL=(id:string)=>'https://'+id+'.whumpo.site/directory';
export async function readDirectory(db:D1Database,user:string,project:string){
 if(!uuid.test(project))throw new DirectoryError(400,"Choose one of your projects.");
 const p=await db.prepare('SELECT p.id,p.name,COALESCE(d.revision,0) AS revision,COALESCE(d.draft_json,\'[]\') AS draft_json,d.live_json,d.publication_revision,d.published_at,s.revision AS current_publication,s.version_id FROM projects p LEFT JOIN directories d ON d.project_id=p.id LEFT JOIN publications s ON s.project_id=p.id WHERE p.id=? AND p.owner_user_id=?').bind(project,user).first<{id:string;name:string;revision:number;draft_json:string;live_json:string|null;publication_revision:number|null;published_at:string|null;current_publication:number|null;version_id:string|null}>();
 if(!p)throw new DirectoryError(404,'Project not found.');
 return {...p,draft:entries(p.draft_json),published:!!p.version_id&&p.live_json!==null&&p.publication_revision===p.current_publication};
}
import {requireRebuiltReply,rebuiltGuard} from './reviewed-rebuild';
import {receiptStatement,reviewedReply,reviewChangedMessage} from './chat-review-receipts';
const directoryReply=(name:string,change:string,kind:string,review:string,digest:string)=>`${name}\n\n${change}\n\n${kind==='edit'?'Your existing public snapshot will not change. ':''}Review ${review}\nSnapshot SHA-256: ${digest}\nNothing changes until you use this review’s confirmation button within 10 minutes.`;
/** The reply a directory review shows, rebuilt from the saved row; undefined for edit, remove and restore, whose text embeds the
 * draft at review time (not saved on the row), so they cannot be rebuilt without a schema change. */
function rebuiltDirectoryReply(r:{id:string;kind:string;snapshot_json:string;digest:string;source_review_id:string|null;project_id:string;name:string}){
 const change=r.kind==='publish'?'Publish this exact directory snapshot for anyone to read:\n\n'+summary(entries(r.snapshot_json))+'\n\nPage: '+directoryURL(r.project_id)+'\nPublic JSON: '+directoryURL(r.project_id)+'.json\nPublishing/restoring your website disables the directory until reviewed again. Public copies cannot be recalled.'
  :r.kind==='unpublish'?'Take this directory page and its JSON API offline. The private draft and review history remain.'
  :(()=>{const added=r.source_review_id===null?entries(r.snapshot_json).find(x=>x.id===r.id):undefined;return added?'Add this listing to the private draft:\n'+summary([added]):undefined;})();
 return change===undefined?undefined:directoryReply(r.name,change,r.kind,r.id,r.digest);
}
function summary(items:Listing[]){return items.length?items.map(x=>`${x.title}\nListing: ${x.id}\n${x.description}${x.url?'\n'+x.url:''}`).join('\n\n'):'No listings.';}
/** Only applied snapshots are recovery sources; pending proposals are never backups. */
export async function directorySnapshot(db:D1Database,user:string,project:string,review:string){
 if(!uuid.test(project)||!uuid.test(review))throw new DirectoryError(400,"Choose a saved snapshot from this project’s directory history.");
 const row=await db.prepare("SELECT r.id,r.snapshot_json,r.digest,r.kind,r.source_review_id,t.created_at AS applied_at,p.name FROM directory_reviews r JOIN projects p ON p.id=r.project_id AND p.owner_user_id=r.user_id JOIN chat_turns t ON t.id=r.confirmed_by AND t.user_id=r.user_id WHERE r.id=? AND r.project_id=? AND r.user_id=? AND r.status='applied' AND r.kind IN ('edit','publish')").bind(review,project,user).first<{id:string;snapshot_json:string;digest:string;kind:string;source_review_id:string|null;applied_at:string;name:string}>();
 if(!row){
  if(await db.prepare("SELECT 1 FROM review_receipts WHERE family='directory_reviews' AND id=? AND project_id=? AND owner_user_id=? AND kind='change' AND outcome='applied'").bind(review,project,user).first())throw new DirectoryError(404,'This snapshot is digest-only: its listings were compacted, so it can no longer be restored or exported.');
  throw new DirectoryError(404,'Saved directory snapshot not found.');
 }
 if(await hashToken(row.snapshot_json)!==row.digest)throw new DirectoryError(409,'The saved directory snapshot failed its integrity check.');
 return {...row,listings:entries(row.snapshot_json)};
}
export async function directoryHistory(db:D1Database,user:string,project:string){
 const p=await readDirectory(db,user,project);
 const {results}=await db.prepare("SELECT r.id,r.kind,r.expected_revision+1 AS revision,r.digest,r.source_review_id AS restoredFrom,t.created_at AS appliedAt,json_array_length(r.snapshot_json) AS listingCount FROM directory_reviews r JOIN chat_turns t ON t.id=r.confirmed_by AND t.user_id=r.user_id WHERE r.project_id=? AND r.user_id=? AND r.status='applied' AND r.kind IN ('edit','publish') ORDER BY r.expected_revision DESC LIMIT 100").bind(project,user).all<{id:string;kind:string;revision:number;digest:string;restoredFrom:string|null;appliedAt:string;listingCount:number}>();
 // Snapshots compacted out of the history window survive only as sealed receipts (kind 'change', outcome 'applied' = edit or publish): digest only, never restorable.
 const {results:gone}=await db.prepare("SELECT id,payload_digest AS digest,applied_at AS appliedAt FROM review_receipts WHERE family='directory_reviews' AND project_id=? AND owner_user_id=? AND kind='change' AND outcome='applied' AND id NOT IN (SELECT id FROM directory_reviews WHERE project_id=?) ORDER BY sealed_at DESC LIMIT 100").bind(project,user,project).all<{id:string;digest:string;appliedAt:string|null}>();
 return {projectId:project,name:p.name,currentRevision:p.revision,snapshots:[...results.map(r=>({...r,digestOnly:false as const})),...gone.map(r=>({...r,digestOnly:true as const}))].slice(0,100)};
}
export async function exportDirectory(db:D1Database,user:string,project:string,review:string){
 const r=await directorySnapshot(db,user,project,review);
 return {format:'whumpo-directory',schemaVersion:1,project:{id:project,name:r.name},snapshot:{id:r.id,appliedAt:r.applied_at,kind:r.kind,restoredFrom:r.source_review_id,listingsSha256:r.digest},listings:r.listings};
}
/** Import validation for the `whumpo-directory` v1 export above (WH-129 content-collections export hook): the exact
 * wrapper, current listing bounds and the listing SHA-256. Validation only: nothing imports or restores a file. */
export async function validateDirectoryExport(value:unknown){
 const fail=():never=>{throw new DirectoryError(400,'This is not a current Whumpo directory export.');};
 const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===[...keys].sort().join();
 if(!exact(value,['format','schemaVersion','project','snapshot','listings'])||value.format!=='whumpo-directory'||value.schemaVersion!==1)return fail();
 const {project,snapshot}=value;
 if(!exact(project,['id','name'])||!exact(snapshot,['id','appliedAt','kind','restoredFrom','listingsSha256']))return fail();
 if(typeof project.id!=='string'||!uuid.test(project.id)||typeof project.name!=='string'||typeof snapshot.id!=='string'||!uuid.test(snapshot.id)||typeof snapshot.appliedAt!=='string'||!['edit','publish'].includes(String(snapshot.kind))||snapshot.restoredFrom!==null&&(typeof snapshot.restoredFrom!=='string'||!uuid.test(snapshot.restoredFrom)))return fail();
 let list:Listing[]=[];try{list=entries(JSON.stringify(value.listings));}catch{fail();}
 const json=JSON.stringify(list);
 if(json!==JSON.stringify(value.listings)||await hashToken(json)!==snapshot.listingsSha256)fail();
 return {projectId:project.id,snapshotId:snapshot.id,listings:list};
}
export async function directoryAction(db:D1Database,user:string,turn:string,action:Record<string,unknown>){
 const op=action.operation,project=action.projectId;
 if(!['list','history','restore','export','add','edit','remove','publish','unpublish'].includes(String(op))||typeof project!=='string'||Object.keys(action).some(k=>!['operation','projectId','listingId','title','description','url','snapshotId'].includes(k)))throw new DirectoryError(400,'Unsupported directory operation.');
 const fields=['title','description','url'];
 if(!['restore','export'].includes(String(op))&&'snapshotId'in action||['restore','export'].includes(String(op))&&(typeof action.snapshotId!=='string'||!uuid.test(action.snapshotId))||!['add','edit'].includes(String(op))&&fields.some(k=>k in action)||!['edit','remove'].includes(String(op))&&'listingId'in action)throw new DirectoryError(400,'Unexpected directory fields.');
 const p=await readDirectory(db,user,project),result=(reply:string,statements:D1PreparedStatement[]=[])=>({reply,statements});
 if(op==='history'){const h=await directoryHistory(db,user,project);return result(`${h.name} · saved directory snapshots\nCurrent draft revision: ${h.currentRevision}\n\n`+(h.snapshots.map(r=>r.digestOnly?`Digest-only (listings compacted; not restorable or exportable)\nSnapshot: ${r.id}\nApplied: ${r.appliedAt??'unknown'}\nListings SHA-256: ${r.digest}`:`Revision ${r.revision} · ${r.kind}${r.restoredFrom?' (restored from '+r.restoredFrom+')':''} · ${r.listingCount} listings\nSnapshot: ${r.id}\nApplied: ${r.appliedAt}\nListings SHA-256: ${r.digest}`).join('\n\n')||'No applied snapshots yet.')+"\n\nAsk to review restoring a snapshot to the private draft, or download its saved data. Neither action publishes it.");}
 if(op==='export'){const r=await directorySnapshot(db,user,project,String(action.snapshotId));return result(`Download the saved directory data for ${p.name}.\nSnapshot: ${r.id}\nListings SHA-256: ${r.digest}\nThis private JSON export contains the saved listings and recovery metadata. It does not contain credentials or a deployable backend.`,[db.prepare('INSERT INTO directory_exports(turn_id,review_id) SELECT ?,? WHERE EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=?)').bind(turn,r.id,turn,user)]);}
 if(op==='list')return result(`${p.name} directory · ${p.published?'published':'private / offline'}\nDraft revision: ${p.revision}\n\n${summary(p.draft)}\n\n${p.published?'Published page: '+directoryURL(project)+'\nPublic JSON: '+directoryURL(project)+'.json\nDraft edits do not change this public snapshot.':'No directory is publicly served.'}\nAsk to review publishing this snapshot or taking the directory offline.`);
 let draft=[...p.draft],change='',source:string|null=null;
 if(op==='restore'){const saved=await directorySnapshot(db,user,project,String(action.snapshotId));draft=saved.listings;source=saved.id;change='Replace the current private directory draft with this saved snapshot:\nSnapshot: '+saved.id+'\nApplied: '+saved.applied_at+'\n\nCurrent private draft:\n'+summary(p.draft)+'\n\nReplacement:\n'+summary(draft)+'\n\nListings missing from the replacement will be removed from the private draft. This does not restore website HTML or publish directory data.';}
 if(op==='add'||op==='edit'){
  const item=listing({id:op==='add'?turn:action.listingId,title:action.title,description:action.description,url:action.url??''});
  if(op==='add'){draft.push(item);change='Add this listing to the private draft:\n'+summary([item]);}
  else {const i=draft.findIndex(x=>x.id===item.id);if(i<0)throw new DirectoryError(404,'Listing not found in this project.');change='Replace this private listing:\n'+summary([draft[i]])+'\n\nWith:\n'+summary([item]);draft[i]=item;}
 }else if(op==='remove'){const item=draft.find(x=>x.id===action.listingId);if(!item)throw new DirectoryError(404,'Listing not found in this project.');draft=draft.filter(x=>x.id!==item.id);change='Remove this listing from the private draft:\n'+summary([item]);}
 const snapshot=JSON.stringify(entries(JSON.stringify(draft))),kind=op==='publish'?'publish':op==='unpublish'?'unpublish':'edit';
 if(kind==='publish'&&!p.version_id)throw new DirectoryError(409,'Publish a website version before publishing its directory.');
 if(kind==='publish')change='Publish this exact directory snapshot for anyone to read:\n\n'+summary(draft)+'\n\nPage: '+directoryURL(project)+'\nPublic JSON: '+directoryURL(project)+'.json\nPublishing/restoring your website disables the directory until reviewed again. Public copies cannot be recalled.';
 if(kind==='unpublish')change='Take this directory page and its JSON API offline. The private draft and review history remain.';
 const digest=await hashToken(snapshot);
 const reply=directoryReply(p.name,change,kind,turn,digest);
 return result(reply,[
  db.prepare('INSERT OR IGNORE INTO directories(project_id) SELECT ? WHERE EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=?)').bind(project,turn,user),
  db.prepare('INSERT INTO directory_reviews(id,user_id,project_id,kind,snapshot_json,digest,expected_revision,publication_revision,expires_at,source_review_id) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=?)').bind(turn,user,project,kind,snapshot,digest,p.revision,p.current_publication??-1,new Date(Date.now()+600000).toISOString(),source,turn,user),
  await receiptStatement(db,user,turn,'directory',turn,reply)
 ]);
}
export async function directoryCommand(db:D1Database,user:string,turn:string,command:string){
 const match=command.match(/^(\/directory(?:-add|-edit|-remove|-publish|-off|-history|-restore|-export)?|\/confirm-directory)(?:\s+(.*))?$/s);if(!match)return;
 const [verb,rest]=[match[1],match[2]??''],result=(reply:string,statements:D1PreparedStatement[]=[])=>({reply,statements});
 try{
  if(verb==='/directory'&&!rest){const {results}=await db.prepare('SELECT p.id,p.name FROM projects p WHERE p.owner_user_id=? ORDER BY p.created_at DESC LIMIT 20').bind(user).all<{id:string;name:string}>();return result((results.map(p=>p.name+"\nProject: "+p.id).join('\n\n')||"No projects yet. Start a project first.")+'\n\nDirectories support private editable listings and a separately reviewed public page/JSON API.');}
  if(verb==='/confirm-directory'){
   if(!uuid.test(rest))throw new DirectoryError(400,"Choose the exact directory review using its confirmation control.");
   if(!await reviewedReply(db,user,'directory',rest))throw new DirectoryError(409,reviewChangedMessage);
   const r=await db.prepare('SELECT r.*,p.name FROM directory_reviews r JOIN projects p ON p.id=r.project_id WHERE r.id=? AND r.user_id=?').bind(rest,user).first<{id:string;status:string;kind:string;project_id:string;expires_at:string;snapshot_json:string;digest:string;source_review_id:string|null;name:string}>();
   if(!r)throw new DirectoryError(404,'Directory review not found.');
   if(r.status==='applied')return result("That review was already applied. Ask to read the current directory for project "+r.project_id+' for current state.');
   if(r.expires_at<=new Date().toISOString())throw new DirectoryError(409,'This review expired. Prepare a fresh review.');
   const expected=rebuiltDirectoryReply(r),g=rebuiltGuard(user,expected===undefined?undefined:await requireRebuiltReply(db,user,rest,expected));
   return result(r.kind==='publish'?'Directory snapshot published at '+directoryURL(r.project_id)+'\nPublic JSON: '+directoryURL(r.project_id)+'.json':r.kind==='unpublish'?'Directory page and JSON API taken offline.':"Private directory draft updated. Its public snapshot has not changed. Ask to read the directory for project "+r.project_id+' to inspect it.',[db.prepare("UPDATE directory_reviews SET status='applied',confirmed_by=? WHERE id=? AND user_id=? AND status='pending' AND EXISTS(SELECT 1 FROM chat_turns WHERE id=? AND user_id=?)"+g.sql).bind(turn,rest,user,turn,user,...g.params)]);
  }
  const parts=rest.split('|').map(s=>s.trim()),ids=parts[0].split(/\s+/),op=({'/directory':'list','/directory-add':'add','/directory-edit':'edit','/directory-remove':'remove','/directory-publish':'publish','/directory-off':'unpublish','/directory-history':'history','/directory-restore':'restore','/directory-export':'export'} as Record<string,string>)[verb];
  const needsSnapshot=op==='restore'||op==='export',needsListing=op==='edit'||op==='remove',hasText=op==='add'||op==='edit';
  if(ids.length!==(needsListing||needsSnapshot?2:1)||!uuid.test(ids[0])||(needsListing||needsSnapshot)&&!uuid.test(ids[1])||hasText&&(parts.length<3||parts.length>4)||!hasText&&parts.length!==1)throw new DirectoryError(400,"Choose the project and requested directory change. Ask to inspect listings, add or edit a listing, prepare removal, review publication or withdrawal, or read and restore a saved snapshot.");
  return await directoryAction(db,user,turn,{operation:op,projectId:ids[0],...(needsListing?{listingId:ids[1]}:{}),...(needsSnapshot?{snapshotId:ids[1]}:{}),...(hasText?{title:parts[1],description:parts[2],url:parts[3]??''}:{})});
 }catch(cause){if(cause instanceof DirectoryError)return result(cause.message);throw cause;}
}
export async function publicDirectory(db:D1Database,project:string){
 const p=await db.prepare('SELECT p.name,d.live_json,d.live_digest,d.published_at FROM directories d JOIN projects p ON p.id=d.project_id JOIN publications s ON s.project_id=d.project_id WHERE d.project_id=? AND d.live_json IS NOT NULL AND s.version_id IS NOT NULL AND d.publication_revision=s.revision').bind(project).first<{name:string;live_json:string;live_digest:string|null;published_at:string}>();
 if(!p)return null;
 // WH-183: the served listings must still hash to the digest the approved review recorded; legacy rows without one hash their own bytes.
 const digest=await hashToken(p.live_json);if(p.live_digest&&p.live_digest!==digest)throw new DirectoryError(503,'The live directory failed its integrity check.');
 return {name:p.name,publishedAt:p.published_at,listings:entries(p.live_json),digest};
}
