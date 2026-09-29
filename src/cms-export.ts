import {readCMSDraft} from './cms-content';
import {CMSProjectError} from './cms-projects';
export const cmsExportMessage='Your saved article download is ready. Use Download CMS content below. It reads the latest saved content when opened; unsaved editor changes and media files are not included. This is a content export, not a complete CMS backup.';
export async function cmsExport(db:D1Database,user:string,project:string,request:string,env:Record<string,unknown>){
 const snapshot=await readCMSDraft(db,user,project,request,env),item=snapshot.item;
 if(!item?.data||typeof item.data!=='object'||Array.isArray(item.data)||typeof snapshot.revision!=='string'||!['draft','published','archived'].includes(item.status))throw new CMSProjectError(409,'This saved content cannot be exported in the current format');
 const document={format:'whumpo-cms-content',formatVersion:1,exportedAt:new Date().toISOString(),projectId:project,requestId:request,collection:snapshot.collection,itemId:item.id,revision:snapshot.revision,status:item.status,hasStagedChanges:!!item.draftRevisionId,data:item.data,...(item.liveData&&typeof item.liveData==='object'?{publishedData:item.liveData}:{}),scope:{included:['Current saved content fields','Published content fields when staged changes exist'],excluded:['Unsaved editor changes','Media file bytes','Revision history','Themes and plugins','Account and authentication data','Whumpo publication records'],restoreSupported:false}};
 return new Response(JSON.stringify(document,null,2)+'\n',{headers:{'content-type':'application/json; charset=utf-8','content-disposition':`attachment; filename="whumpo-content-${request}.json"`,'cache-control':'private, no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox"}});
}
export async function prepareCMSExport(db:D1Database,user:string,project:string,request:string,turn:string,env:Record<string,unknown>){
 await readCMSDraft(db,user,project,request,env);
 try{await db.prepare('INSERT INTO cms_export_links(turn_id,user_id,project_id,draft_request_id) VALUES(?,?,?,?) ON CONFLICT(turn_id) DO NOTHING').bind(turn,user,project,request).run();}catch{/* Read back an existing receipt after a lost acknowledgment. */}
 const row=await db.prepare('SELECT turn_id FROM cms_export_links WHERE turn_id=? AND user_id=? AND project_id=? AND draft_request_id=?').bind(turn,user,project,request).first();
 if(!row)throw new CMSProjectError(409,'This download request is unavailable or its ID already refers to other content');
 return cmsExportMessage;
}
export async function cmsExportLinks(db:D1Database,user:string){return (await db.prepare("SELECT l.turn_id,l.project_id,l.draft_request_id FROM cms_export_links l JOIN cms_draft_requests d ON d.id=l.draft_request_id JOIN projects p ON p.id=l.project_id JOIN chat_turns t ON t.id=l.turn_id AND t.user_id=l.user_id WHERE l.user_id=? AND d.user_id=l.user_id AND d.project_id=l.project_id AND p.owner_user_id=l.user_id AND t.status='completed' AND instr(t.assistant_text,?)>0 ORDER BY t.revision DESC LIMIT 100").bind(user,cmsExportMessage).all()).results;}
