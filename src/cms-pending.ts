import {CMSProjectError} from './cms-error';
const uuid=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/;
type Kind='setup'|'import'|'draft'|'edit'|'publish'|'unpublish'|'discard';
type Row={kind:Kind;id:string;project_id:string;name:string;status:string;created_at:string;priority:number};
export function cmsPendingRequest(content:string){
 const text=content.trim().toLowerCase();
 if(['show unfinished publishing work','show pending cms work'].includes(text))return {page:1};
 if(!/^\/cms-pending(?:\s|$)/.test(text))return;
 const parts=text.split(/\s+/).slice(1);if(parts.length>2||parts[0]&&parts[0]!=='all'&&!uuid.test(parts[0])||parts[1]&&!/^(?:[1-9]\d?|100)$/.test(parts[1]))return {error:'Use /cms-pending [PROJECT_ID or all] [PAGE].'};
 return {projectId:parts[0]&&parts[0]!=='all'?parts[0]:undefined,page:Number(parts[1]??1)};
}
/** Read-only owner inventory. No provider requests, inference, confirmation or retry. */
export async function pendingCMSWork(db:Pick<D1Database,'prepare'>,user:string,project?:string,page=1,now=Date.now()){
 if(project!==undefined&&!uuid.test(project)||!Number.isSafeInteger(page)||page<1||page>100||!Number.isSafeInteger(now)||now<0)throw new CMSProjectError(400,'Choose a project and a valid publishing-work page');
 if(project&&!await db.prepare('SELECT id FROM projects WHERE id=? AND owner_user_id=?').bind(project,user).first())throw new CMSProjectError(404,'Project not found');
 const {results}=await db.prepare(`WITH owned AS (SELECT id,name FROM projects WHERE owner_user_id=? AND (? IS NULL OR id=?)), first_work AS MATERIALIZED (
 SELECT 'setup' kind,r.id,r.project_id,p.name,r.status,r.created_at,CASE WHEN r.status='approved' THEN 0 ELSE 1 END priority,r.expires_at FROM cms_setup_reviews r JOIN owned p ON p.id=r.project_id LEFT JOIN cms_instances c ON c.project_id=r.project_id LEFT JOIN cms_deployments deployment ON deployment.project_id=r.project_id WHERE r.user_id=? AND (c.project_id IS NULL OR c.review_id=r.id AND (c.state<>'ready' OR coalesce(deployment.state,'')<>'connected'))
 UNION ALL SELECT 'import',r.id,r.project_id,p.name,r.status,r.created_at,CASE WHEN r.status='approved' THEN 0 ELSE 1 END,r.expires_at FROM cms_import_reviews r JOIN owned p ON p.id=r.project_id WHERE r.user_id=? AND r.source_upload_id IS NOT NULL AND r.status IN ('pending','approved')
 UNION ALL SELECT 'draft',d.id,d.project_id,p.name,'unresolved',d.created_at,0,NULL FROM cms_draft_requests d JOIN owned p ON p.id=d.project_id WHERE d.user_id=? AND d.item_id IS NULL AND NOT EXISTS(SELECT 1 FROM cms_import_reviews r WHERE r.id=d.id)
 UNION ALL SELECT 'edit',e.id,d.project_id,p.name,'unresolved',e.created_at,0,NULL FROM cms_edit_requests e JOIN cms_draft_requests d ON d.id=e.draft_request_id JOIN owned p ON p.id=d.project_id WHERE d.user_id=? AND e.result IS NULL
), later_work AS MATERIALIZED (
 SELECT 'publish',r.id,r.project_id,p.name,r.status,r.created_at,CASE WHEN r.status='approved' THEN 0 ELSE 1 END,r.expires_at FROM cms_publication_reviews r JOIN owned p ON p.id=r.project_id WHERE r.user_id=? AND r.status IN ('pending','approved')
 UNION ALL SELECT 'unpublish',r.id,c.project_id,p.name,r.status,r.created_at,CASE WHEN r.status='approved' THEN 0 ELSE 1 END,r.expires_at FROM cms_unpublish_reviews r JOIN cms_publication_reviews c ON c.id=r.publication_id JOIN owned p ON p.id=c.project_id WHERE r.user_id=? AND c.user_id=? AND r.status IN ('pending','approved')
 UNION ALL SELECT 'discard',r.id,c.project_id,p.name,r.status,r.created_at,CASE WHEN r.status='approved' THEN 0 ELSE 1 END,r.expires_at FROM cms_discard_reviews r JOIN cms_publication_reviews c ON c.id=r.publication_id JOIN owned p ON p.id=c.project_id WHERE r.user_id=? AND c.user_id=? AND r.status IN ('pending','approved')
 ), work AS (SELECT * FROM first_work UNION ALL SELECT * FROM later_work) SELECT kind,id,project_id,name,status,created_at,priority FROM work WHERE status<>'pending' OR expires_at>? ORDER BY priority,created_at,kind,id LIMIT 21 OFFSET ?`).bind(user,project??null,project??null,user,user,user,user,user,user,user,user,user,new Date(now).toISOString(),(page-1)*20).all<Row>();
 const rows=results.slice(0,20).map(row=>{
  const commands:Record<Kind,string>={setup:'/cms-review '+row.id,import:'/cms-import-review '+row.id,draft:'/cms-retry '+row.project_id+' '+row.id,edit:'/cms-retry-edit '+row.project_id+' '+row.id,publish:'/cms-publication '+row.id,unpublish:'/cms-unpublish-review '+row.id,discard:'/cms-discard-review '+row.id};
  const labels:Record<Kind,string>={setup:'Publishing space setup',import:'WordPress import',draft:'Article creation',edit:'Article edit',publish:'Article publication',unpublish:'Take article offline',discard:'Discard staged edits'};
  if(!Object.hasOwn(commands,row.kind)||!uuid.test(row.id)||!uuid.test(row.project_id))throw Error('Invalid publishing work record');
  return {kind:row.kind,id:row.id,projectId:row.project_id,projectName:row.name.slice(0,80),label:labels[row.kind],state:row.status==='pending'?'Awaiting your review':row.kind==='setup'?'Approved; awaiting operator provisioning':'Saved operation; outcome needs checking',command:commands[row.kind]};
 });
 return {rows,page,hasMore:results.length>20};
}
export function describePendingCMS(work:Awaited<ReturnType<typeof pendingCMSWork>>,project?:string){
 const heading='Unfinished publishing work';
 if(!work.rows.length)return heading+'\n'+(work.page===1?'No unfinished CMS work was found.':'No more unfinished CMS work was found.')+' Expired, unapproved reviews and completed requests are omitted. This checks saved Whumpo records, not the current provider state.';
 return heading+' — page '+work.page+'\n\n'+work.rows.map(r=>`${r.label} · ${JSON.stringify(r.projectName)}\n${r.state}\n${r.command}`).join('\n\n')+(work.hasMore?'\n\nNext: /cms-pending '+(project??'all')+' '+(work.page+1):'')+'\n\nNothing was retried, approved or published by opening this list. Read a saved review before confirming it. Retry commands recover the existing draft/edit request; do not create a replacement. This list covers CMS work only; uploads remain in the publishing desk.';
}
