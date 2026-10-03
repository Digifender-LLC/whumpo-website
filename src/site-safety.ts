import type {ProjectRow,ReviewRow,SiteSafetyReview,SiteSafetyInventory,SiteSafetyReviews} from './site-safety-shape';
import {DiffError} from './version-diff';
import {publicationConfirmationStatement,siteURL} from './publications';
import {assertWorkspace} from './workspace-identity/admission';

const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
const exact=(value:unknown,keys:string[]):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const reviewSelect=`SELECT a.id,a.project_id AS projectId,p.name,a.expected_revision AS expectedRevision,a.expires_at AS expiresAt,a.status,
 s.revision,s.version_id AS versionId,e.created_at AS appliedAt FROM publication_actions a
 JOIN projects p ON p.id=a.project_id AND p.owner_user_id=a.user_id JOIN publications s ON s.project_id=p.id
 LEFT JOIN activity_events e ON e.id='publication:'||a.id AND e.user_id=a.user_id`;
const presentation=(r:ReviewRow):SiteSafetyReview=>({...r,url:siteURL(r.projectId),state:r.status==='applied'?'applied':r.expiresAt<=new Date().toISOString()?'expired':r.revision!==r.expectedRevision||!r.versionId?'changed':'pending'});
function identifier(value:unknown):asserts value is string{if(typeof value!=='string'||!uuid.test(value))throw new DiffError(400,'Choose a current project or saved review.');}

/** A layout, billing or conversation read cannot be a prerequisite for stopping a website. */
export async function siteSafetyInventory(db:D1Database,user:string,after:string|null):Promise<SiteSafetyInventory>{
 if(after!==null)identifier(after);
 const {results}=await db.prepare(`SELECT p.id,p.name,COALESCE(s.revision,0) AS revision,s.version_id AS versionId FROM projects p
 LEFT JOIN publications s ON s.project_id=p.id WHERE p.owner_user_id=? AND (? IS NULL OR p.id>?) ORDER BY p.id LIMIT 51`).bind(user,after,after).all<ProjectRow>();
 await assertWorkspace(db,user);
 return {version:1,projects:results.slice(0,50).map(p=>({...p,url:siteURL(p.id)})),next:results.length>50?results[49].id:null};
}
/** ID pagination keeps every saved withdrawal discoverable, including lost replies. */
export async function siteSafetyReviews(db:D1Database,user:string,project:string,after:string|null):Promise<SiteSafetyReviews>{
 identifier(project);if(after!==null)identifier(after);
 if(!await db.prepare('SELECT id FROM projects WHERE id=? AND owner_user_id=?').bind(project,user).first())throw new DiffError(404,'Project not found.');
 const {results}=await db.prepare(reviewSelect+` WHERE a.user_id=? AND a.project_id=? AND a.kind='unpublish' AND (? IS NULL OR a.id>?) ORDER BY a.id LIMIT 21`).bind(user,project,after,after).all<ReviewRow>();
 await assertWorkspace(db,user);
 return {version:1,reviews:results.slice(0,20).map(presentation),next:results.length>20?results[19].id:null};
}
export async function readSiteSafetyReview(db:D1Database,user:string,id:string):Promise<SiteSafetyReview>{
 identifier(id);
 const row=await db.prepare(reviewSelect+" WHERE a.id=? AND a.user_id=? AND a.kind='unpublish'").bind(id,user).first<ReviewRow>();
 if(!row)throw new DiffError(404,'Saved website withdrawal not found.');
 await assertWorkspace(db,user);return presentation(row);
}
/** Store an ordinary publication review against the exact displayed revision.
 * No Chat turn, generated layout, content parser or provider is needed. */
export async function prepareSiteSafetyReview(db:D1Database,user:string,value:unknown){
 if(!exact(value,['version','id','projectId','expectedRevision'])||value.version!==1||!Number.isSafeInteger(value.expectedRevision)||Number(value.expectedRevision)<0)throw new DiffError(400,'Use the current website withdrawal request.');
 identifier(value.id);identifier(value.projectId);
 await db.prepare(`INSERT INTO publication_actions(id,user_id,project_id,kind,version_id,expected_revision,expires_at)
 SELECT ?,?,p.id,'unpublish',NULL,s.revision,strftime('%Y-%m-%dT%H:%M:%fZ','now','+10 minutes')
 FROM projects p JOIN publications s ON s.project_id=p.id WHERE p.id=? AND p.owner_user_id=? AND s.revision=? AND s.version_id IS NOT NULL
 ON CONFLICT(id) DO NOTHING`).bind(value.id,user,value.projectId,user,value.expectedRevision).run();
 let saved:SiteSafetyReview;
 try{saved=await readSiteSafetyReview(db,user,value.id);}catch(error){if(error instanceof DiffError&&error.status===404)throw new DiffError(409,'The website changed or is already offline. Check its current status before preparing a review.');throw error;}
 if(saved.projectId!==value.projectId||saved.expectedRevision!==value.expectedRevision)throw new DiffError(409,'This request ID already belongs to different work. Check the saved review.');
 return {version:1 as const,review:saved};
}
/** Same immutable publication receipt and transactional revision/expiry checks
 * as Chat. Only this human route may confirm an unpublish review directly. */
export async function confirmSiteSafetyReview(db:D1Database,user:string,id:string,value:unknown){
 if(!exact(value,['version','confirmation'])||value.version!==1||value.confirmation!=='UNPUBLISH_WEBSITE')throw new DiffError(400,'Confirm this exact website withdrawal.');
 const review=await readSiteSafetyReview(db,user,id);
 if(review.state==='applied')return {version:1 as const,review};
 if(review.state!=='pending')throw new DiffError(409,'This review changed or expired. Check the website and prepare a fresh review.');
 try{await publicationConfirmationStatement(db,user,id,id).run();}catch(error){
  if(/publication_(changed|expired|version)/.test(String(error)))throw new DiffError(409,'This review changed or expired. Check the saved result before trying again.');
  throw error;
 }
 return {version:1 as const,review:await readSiteSafetyReview(db,user,id)};
}
