import {ContactError,contactInbox} from '../contact-store';
import {hashToken} from '../security';
import {plain} from '../project-specification/v2/json';
import {assertWorkspace} from '../workspace-identity/admission';
import {ModuleError,type ModulePrincipal,type ModuleRequest} from './policy';
import type {RecordsSummaryFacts} from './shape';

/** A maintained fixed resource, not a configurable records schema or another copy of the inbox. The original
 * contact intake/review/removal APIs retain their bounds, bot verification, receipts, holds and 30-day retention. */
export async function contactResourceId(project:string){
 const digest=await hashToken('whumpo:fixed-contact-records:1:'+project);
 return `${digest.slice(0,8)}-${digest.slice(8,12)}-${digest.slice(12,16)}-${digest.slice(16,20)}-${digest.slice(20,32)}`;
}
const fields=[{key:'name',label:'Name',type:'text'},{key:'email',label:'Email',type:'text'},{key:'message',label:'Message',type:'text'}];
const exact=(v:unknown,keys:string[]):v is Record<string,unknown>=>plain(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const uuid=(v:unknown)=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v);
async function revision(db:D1Database,user:string,project:string){
 const row=await db.prepare('SELECT coalesce(c.revision,0)+1 revision FROM projects p LEFT JOIN contact_settings c ON c.project_id=p.id WHERE p.id=? AND p.owner_user_id=?').bind(project,user).first<{revision:number}>();
 if(!row)throw new ModuleError('not_found');return row.revision;
}
export async function contactRecordsSummary(db:D1Database,user:string,project:string):Promise<RecordsSummaryFacts['items'][number]|null>{
 const row=await db.prepare(`SELECT c.revision+1 revision,
  CASE WHEN c.enabled=1 AND p.version_id IS NOT NULL AND p.revision=c.publication_revision AND NOT EXISTS(SELECT 1 FROM service_client_blocked_contacts WHERE project_id=c.project_id) THEN 1 ELSE 0 END active,
  (SELECT count(*) FROM contact_submissions m WHERE m.project_id=c.project_id AND m.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')) n
  FROM contact_settings c JOIN projects owner ON owner.id=c.project_id LEFT JOIN publications p ON p.project_id=c.project_id WHERE c.project_id=? AND owner.owner_user_id=?`).bind(project,user).first<{revision:number;active:number;n:number}>();
 if(!row)return null;
 return {localId:'contact-inbox',resourceId:await contactResourceId(project),state:row.active?'active':'inactive',configRevision:row.revision,retentionDays:30,
  schemas:[{recordId:'messages',fieldsRevision:1,fields:3,records:{public:row.n,visitor:0,staff:0}}],
  forms:[{formId:'contact',recordId:'messages',submit:'public',attachments:false}],views:[]};
}
export async function readContactRecords(db:D1Database,user:string,project:string,resourceId:string,recordId:string,after:string|null){
 if(recordId!=='messages'||resourceId!==await contactResourceId(project))throw new ModuleError('not_found');
 if(after!==null)throw new ModuleError('invalid_request');
 try{
  const configRevision=await revision(db,user,project),inbox=await contactInbox(db,user,project);
  return {resourceId,recordId,configRevision,fields,removal:'contact' as const,items:inbox.messages.map(m=>({entryId:m.id as string,revision:1,fieldsRevision:1,
   createdAt:m.created_at as string,updatedAt:m.created_at as string,submittedBy:'public' as const,visitorId:null,
   values:{name:m.name,email:m.email,message:m.message},attachments:[]})),next:null};
 }catch(error){if(error instanceof ContactError)throw new ModuleError('not_found');throw error;}
}

/** Owner-only records.get/view over the same bounded inbox reader. Mutations remain on the existing contact controls;
 * a module request cannot bypass contact admission, change its fixed fields, add staff readers, or alter retention. */
export async function fixedContactRequest(db:D1Database,principal:ModulePrincipal,request:ModuleRequest){
 if(request.resourceId!==await contactResourceId(principal.projectId))return null;
 if(principal.kind!=='owner')throw new ModuleError('forbidden');
 await assertWorkspace(db,principal.userId);
 const current=await revision(db,principal.userId,principal.projectId);
 if(request.configRevision!==current)throw new ModuleError('stale_configuration');
 if(request.operation!=='records.get'&&request.operation!=='records.view')throw new ModuleError('forbidden','Use the existing contact controls for this fixed inbox.');
 if(request.input!==null)throw new ModuleError('invalid_request');
 const t=request.target;
 if(request.operation==='records.get'?!exact(t,['recordId','entryId'])||t.recordId!=='messages'||!uuid(t.entryId):!exact(t,['viewId','cursor'])||t.viewId!=='inbox'||t.cursor!==null)throw new ModuleError('invalid_request');
 const page=await readContactRecords(db,principal.userId,principal.projectId,request.resourceId,'messages',null);
 const result=request.operation==='records.get'?page.items.find(i=>i.entryId===t!.entryId):{viewId:'inbox',items:page.items,next:null};
 if(!result)throw new ModuleError('not_found');
 await assertWorkspace(db,principal.userId);
 if(await revision(db,principal.userId,principal.projectId)!==current)throw new ModuleError('stale_configuration');
 return {api:'whumpo-modules' as const,version:1 as const,operation:request.operation,resourceId:request.resourceId,configRevision:current,requestId:null,receipt:null,result};
}
