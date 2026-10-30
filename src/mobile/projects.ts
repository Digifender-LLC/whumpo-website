// WH-084 M4: project list/read, site versions and activity. The same statements as the web handlers, run behind the M2 workspace gate
// (admitWorkspace + workspaceBindings + assertWorkspace) with the bearer principal; only the wire shape is mapped.
import type {IdentityPrincipal} from '../workspace-identity/authority';
import {MobileError,ok,type MobileEnvironment} from './transport';
import {iso,workspace} from './workspace';

type Row=Record<string,any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const encode=(o:object)=>btoa(JSON.stringify(o)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
/** The web lists are bounded at 100 rows, so a cursor is an offset bound to the account and endpoint. */
function offsetOf(account:string,endpoint:string,cursor:string|null){
 if(cursor===null)return 0;
 try{const c=JSON.parse(atob(cursor.replace(/-/g,'+').replace(/_/g,'/')));if(c.a===account&&c.e===endpoint&&Number.isSafeInteger(c.o)&&c.o>=1&&c.o<100)return c.o as number;}catch{/* malformed */}
 throw new MobileError('invalid_cursor');
}
/** `limit` (1..max, default 25) and, when allowed, one `cursor`; any other or repeated key is unknown_field. */
function params(request:Request,max:number,cursor:boolean){
 const q=new URL(request.url).searchParams;
 for(const k of q.keys())if(!['limit',...(cursor?['cursor']:[])].includes(k)||q.getAll(k).length!==1)throw new MobileError('unknown_field');
 const limit=Number(q.get('limit')??25);
 if(!/^\d+$/.test(q.get('limit')??'25')||limit<1||limit>max)throw new MobileError('invalid_request');
 return {limit,cursor:q.get('cursor')};
}
const project=(r:Row)=>({id:r.id,name:r.name,purpose:r.purpose,status:r.status,siteLive:!!r.site_live,backendLive:!!r.backend_live,createdAt:iso(r.created_at),updatedAt:iso(r.updated_at)});
function page(account:string,endpoint:string,rows:Row[],limit:number,offset:number,map:(r:Row)=>object){
 const items=rows.slice(offset,offset+limit).map(map),more=offset+limit<rows.length;
 return ok({items,nextCursor:more?encode({a:account,e:endpoint,o:offset+limit}):null});
}

export const projectList=(request:Request,env:MobileEnvironment,p:IdentityPrincipal)=>workspace(env,p,true,async(scoped,user)=>{
 const {limit,cursor}=params(request,50,true),offset=offsetOf(user,'projects',cursor);
 const {results}=await scoped.DB.prepare('SELECT id,name,purpose,service_status AS status,site_live,backend_live,created_at,updated_at FROM project_service_status WHERE owner_user_id = ? ORDER BY updated_at DESC,id LIMIT 100').bind(user).all<Row>();
 return page(user,'projects',results,limit,offset,project);
});

export const projectRead=(env:MobileEnvironment,p:IdentityPrincipal,id:string)=>workspace(env,p,true,async(scoped,user)=>{
 const row=await scoped.DB.prepare('SELECT id,name,purpose,service_status AS status,site_live,backend_live,created_at,updated_at FROM project_service_status WHERE id = ? AND owner_user_id = ?').bind(id,user).first<Row>();
 if(!row)throw new MobileError('not_found');
 return ok({project:project(row)});
});

export const projectVersions=(request:Request,env:MobileEnvironment,p:IdentityPrincipal,id:string)=>workspace(env,p,true,async(scoped,user)=>{
 const {limit}=params(request,25,false);
 if(!await scoped.DB.prepare('SELECT id FROM projects WHERE id = ? AND owner_user_id = ?').bind(id,user).first())throw new MobileError('not_found');
 const {results}=await scoped.DB.prepare('SELECT id,component_id,digest,created_at FROM site_versions WHERE project_id = ? ORDER BY created_at DESC,id DESC LIMIT 25').bind(id).all<Row>();
 return ok({items:results.slice(0,limit).map(r=>({id:r.id,componentId:r.component_id,digest:r.digest,createdAt:iso(r.created_at),preview:{path:`/api/site-versions/${r.id}/preview`}}))});
});

export const activityList=(request:Request,env:MobileEnvironment,p:IdentityPrincipal)=>workspace(env,p,true,async(scoped,user)=>{
 const {limit,cursor}=params(request,50,true),offset=offsetOf(user,'activity',cursor);
 const {results}=await scoped.DB.prepare('SELECT id, project_id, action, summary, created_at FROM activity_events WHERE user_id = ? ORDER BY created_at DESC,id DESC LIMIT 100').bind(user).all<Row>();
 return page(user,'activity',results,limit,offset,r=>({id:r.id,projectId:r.project_id,action:r.action,summary:r.summary,createdAt:iso(r.created_at)}));
});
