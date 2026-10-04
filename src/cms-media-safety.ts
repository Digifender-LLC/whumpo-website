import {CMSProjectError} from './cms-error';
/** WH-013: CMS media reuse the photo coverage contract. Only the trusted `approved_cms_media`
 * view (exact owner/project/native ID/digest, current policy, both checks, scanner reference,
 * unexpired clearance and unambiguous receipt) can release bytes. Absence is a hold. */
export type CMSMediaSafety='approved'|'pending'|'blocked';
export const cmsMediaHeldMessage='This image is held for a safety review and cannot be shown, previewed or published yet. Your saved text is unaffected.';
export const cmsMediaBlockedMessage='This image did not pass a safety review and cannot be shown, previewed or published.';
const stateSQL=`CASE WHEN EXISTS(SELECT 1 FROM approved_cms_media a WHERE a.user_id=? AND a.project_id=? AND a.media_id=v.value)
 THEN 'approved' WHEN EXISTS(SELECT 1 FROM cms_media_uploads u JOIN cms_media_safety s ON s.upload_id=u.id WHERE u.user_id=? AND u.project_id=? AND json_extract(u.result,'$.mediaId')=v.value AND s.state='blocked')
 THEN 'blocked' ELSE 'pending' END`;
/** Metadata-only safety state per native media ID. Missing receipts, stale, expired or incomplete checks are `pending`. */
export async function cmsMediaSafety(db:D1Database,user:string,project:string,ids:string[]):Promise<Map<string,CMSMediaSafety>>{
 const unique=[...new Set(ids)],states=new Map<string,CMSMediaSafety>();if(!unique.length)return states;
 const rows=(await db.prepare(`SELECT v.value AS media_id,${stateSQL} AS safety FROM json_each(?) v`).bind(user,project,user,project,JSON.stringify(unique)).all<{media_id:string;safety:CMSMediaSafety}>()).results;
 for(const id of unique)states.set(id,rows.find(r=>r.media_id===id)?.safety??'pending');
 return states;
}
type Approved={media_id:string;digest:string;size:number;width:number;height:number};
/** Release gate for every byte-delivering alias. Exact digest/size/dimensions must still match the delivered bytes. */
export async function requireApprovedCMSMedia(db:D1Database,user:string,project:string,images:{mediaId:string;digest?:string}[]):Promise<Map<string,Approved>>{
 const approved=new Map<string,Approved>();if(!images.length)return approved;
 const states=await cmsMediaSafety(db,user,project,images.map(i=>i.mediaId));
 if([...states.values()].includes('blocked'))throw new CMSProjectError(423,cmsMediaBlockedMessage);
 if([...states.values()].some(s=>s!=='approved'))throw new CMSProjectError(423,cmsMediaHeldMessage);
 const rows=(await db.prepare("SELECT a.media_id,a.digest,a.size,a.width,a.height FROM approved_cms_media a JOIN json_each(?) v ON v.value=a.media_id WHERE a.user_id=? AND a.project_id=?").bind(JSON.stringify([...states.keys()]),user,project).all<Approved>()).results;
 for(const row of rows)approved.set(row.media_id,row);
 for(const image of images){const row=approved.get(image.mediaId);if(!row||(image.digest!==undefined&&row.digest!==image.digest))throw new CMSProjectError(423,cmsMediaHeldMessage);}
 return approved;
}
