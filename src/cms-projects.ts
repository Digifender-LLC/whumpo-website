export class CMSProjectError extends Error {constructor(readonly status:number,message:string){super(message);}}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type Review={id:string;project_id:string;user_id:string;title:string;tagline:string;status:string;expires_at:string};
async function own(db:D1Database,user:string,project:string){if(!uuid.test(project)||!await db.prepare('SELECT id FROM projects WHERE id=? AND owner_user_id=?').bind(project,user).first())throw new CMSProjectError(404,'Project not found');}
export async function listCMS(db:D1Database,user:string,project?:string){
 if(project)await own(db,user,project);
 const {results}=await db.prepare('SELECT c.project_id,p.name,c.state,r.title,r.tagline,c.created_at FROM cms_instances c JOIN projects p ON p.id=c.project_id JOIN cms_setup_reviews r ON r.id=c.review_id WHERE c.user_id=? AND p.owner_user_id=? AND (? IS NULL OR c.project_id=?) ORDER BY c.created_at DESC LIMIT 5').bind(user,user,project??null,project??null).all();return results;
}
export async function readCMSReview(db:D1Database,user:string,id:string){
 const review=await db.prepare('SELECT r.* FROM cms_setup_reviews r JOIN projects p ON p.id=r.project_id WHERE r.id=? AND r.user_id=? AND p.owner_user_id=?').bind(id,user,user).first<Review>();if(!review)throw new CMSProjectError(404,'CMS setup review not found');return review;
}
export async function prepareCMS(db:D1Database,user:string,id:string,project:string,title:string,tagline:string){
 await own(db,user,project);
 if(!uuid.test(id)||!title.trim()||title.length>100||tagline.length>200)throw new CMSProjectError(400,'Choose a title of 1–100 characters and a tagline up to 200 characters');
 const read=()=>db.prepare('SELECT * FROM cms_setup_reviews WHERE id=?').bind(id).first<Review>();
 let row=await read();
 if(!row){try{await db.prepare('INSERT INTO cms_setup_reviews(id,project_id,user_id,title,tagline) VALUES(?,?,?,?,?)').bind(id,project,user,title,tagline).run();}catch{/* Read back a possibly committed exact review. */}row=await read();}
 if(!row)throw new CMSProjectError(409,'CMS is already requested for this project or review storage is full');
 if(row.user_id!==user||row.project_id!==project||row.title!==title||row.tagline!==tagline)throw new CMSProjectError(409,'CMS review ID already used');return row;
}
export async function confirmCMS(db:D1Database,user:string,id:string){
 const row=await readCMSReview(db,user,id);if(row.status==='approved')return row;
 try{await db.prepare("UPDATE cms_setup_reviews SET status='approved' WHERE id=? AND user_id=? AND status='pending'").bind(id,user).run();}catch{
  const found=await readCMSReview(db,user,id);if(found.status==='approved')return found;
  throw new CMSProjectError(409,'CMS review expired, this project already has a request, or the beta capacity is full');
 }
 return readCMSReview(db,user,id);
}
export function describeCMSReview(row:Review){
 if(row.status==='approved')return `CMS setup request approved for project ${row.project_id}. It is queued for isolated resource provisioning; the CMS is not ready or public yet. Use /cms ${row.project_id} to check status.`;
 return `Review EmDash CMS setup\nProject: ${row.project_id}\nTitle: ${row.title}\nTagline: ${row.tagline||'(none)'}\nCreate a private CMS with a dedicated Worker, database, media bucket and session store using existing included Cloudflare allowances. Start with empty content. Only your Whumpo identity can administer it. Plugins and public routing are disabled. This queues provisioning; it does not promise an immediately available CMS. Initial beta capacity is two CMS projects per account and five total.\nExpires: ${row.expires_at}\nSend /confirm-cms ${row.id} to approve this exact setup request.`;
}
export function cmsChatCommand(db:D1Database,user:string,turn:string,content:string){
 const match=content.match(/^\/(cms|cms-review|setup-cms|confirm-cms)(?:\s+([\s\S]+))?$/i);if(!match)return;
 return async()=>{try{
  const verb=match[1].toLowerCase(),rest=match[2]?.trim()??'';
  if(verb==='cms'){
   if(rest&&!uuid.test(rest))throw new CMSProjectError(400,'Use /cms or /cms PROJECT_ID');
   const rows=await listCMS(db,user,rest||undefined);return rows.length?rows.map(r=>`${r.name}: ${r.state}\nProject: ${r.project_id}\nCMS title: ${r.title}`).join('\n\n'):'No CMS instance requested. Use /setup-cms PROJECT_ID | title | optional tagline to review creating one. EmDash setup and public CMS launch are still being integrated.';
  }
  if(verb==='setup-cms'){
   const parts=rest.split('|').map(x=>x.trim());if(parts.length<2||parts.length>3)throw new CMSProjectError(400,'Use /setup-cms PROJECT_ID | title | optional tagline');
   return describeCMSReview(await prepareCMS(db,user,turn,parts[0],parts[1],parts[2]??''));
  }
  if(!uuid.test(rest))throw new CMSProjectError(400,'Choose a CMS review ID');
  return describeCMSReview(await (verb==='confirm-cms'?confirmCMS(db,user,rest):readCMSReview(db,user,rest)));
 }catch(error){return error instanceof CMSProjectError?error.message:'CMS status could not be saved. Inspect /cms before trying a new setup request.';}};
}
export async function cmsAction(db:D1Database,user:string,turn:string,action:Record<string,unknown>){
 let command:string;
 if(action.operation==='setup'){
  if(Object.keys(action).some(k=>!['kind','operation','projectId','title','tagline'].includes(k))||typeof action.projectId!=='string'||typeof action.title!=='string'||typeof action.tagline!=='string')throw new CMSProjectError(400,'Invalid CMS setup proposal');
  return {reply:describeCMSReview(await prepareCMS(db,user,turn,action.projectId,action.title,action.tagline)),statements:[] as D1PreparedStatement[]};
 }
 if(action.operation==='list'&&Object.keys(action).every(k=>['kind','operation','projectId'].includes(k))&&(action.projectId===undefined||typeof action.projectId==='string'))command='/cms'+(action.projectId?' '+action.projectId:'');
 else if(action.operation==='review'&&Object.keys(action).every(k=>['kind','operation','reviewId'].includes(k))&&typeof action.reviewId==='string')command='/cms-review '+action.reviewId;
 else throw new CMSProjectError(400,'Unsupported CMS action; only the user can confirm setup');
 return {reply:await cmsChatCommand(db,user,turn,command)!(),statements:[] as D1PreparedStatement[]};
}
